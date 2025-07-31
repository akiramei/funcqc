import {
  Project,
  SourceFile,
  CallExpression,
  Node,
} from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';
import { CallEdge } from '../types';
import { AnalysisCache, CacheStats } from '../utils/analysis-cache';
import { buildImportIndex, resolveCallee, CalleeResolution } from './symbol-resolver';
import { Logger } from '../utils/cli-utils';

// Removed legacy CallContext - no longer needed with symbol resolution

// Removed legacy interface - no longer needed with symbol resolution

/**
 * Analyzes TypeScript code to extract function call relationships
 * Identifies calls between functions, methods, and external libraries
 */
export class CallGraphAnalyzer {
  private project: Project;
  private cache: AnalysisCache;
  private logger: Logger | undefined;
// Built-in functions moved to symbol-resolver.ts - no longer needed here

  constructor(project?: Project, enableCache: boolean = true, logger?: Logger) {
    this.logger = logger ?? undefined;
    // 🔧 CRITICAL FIX: Share Project instance with TypeScriptAnalyzer to ensure consistent parsing
    // This prevents line number mismatches that cause call edge detection failures
    this.project = project || new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
      compilerOptions: {
        isolatedModules: true,
      },
    });
    this.cache = new AnalysisCache({
      maxMemoryEntries: enableCache ? 100 : 0,
      maxMemorySize: enableCache ? 10 : 0, // 10MB cache
    });
  }

  /**
   * Analyze a TypeScript file to extract call graph relationships using symbol resolution
   */
  async analyzeFile(
    filePath: string,
    functionMap: Map<string, { id: string; name: string; startLine: number; endLine: number }>,
    getFunctionIdByDeclaration?: (decl: Node) => string | undefined
  ): Promise<CallEdge[]> {
    try {
      // Use existing source file if already loaded, avoid double parsing
      let sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(filePath);
      }
      
      const callEdges: CallEdge[] = [];
      const typeChecker = this.project.getTypeChecker();
      const importIndex = buildImportIndex(sourceFile);

      // Get all function nodes in the file
      const functionNodes = this.getAllFunctionNodes(sourceFile);
      // 🔧 Local fallback: declaration Node -> functionId for immediate symbol resolution
      const localDeclIndex = new Map<Node, string>();

      // First pass: Build the complete localDeclIndex before processing any calls
      for (const [, functionInfo] of functionMap.entries()) {
        // Find matching function node with line tolerance
        const functionNode = functionNodes.find(node => {
          const nodeStart = node.getStartLineNumber();
          const nodeEnd = node.getEndLineNumber();
          const startDiff = Math.abs(nodeStart - functionInfo.startLine);
          const endDiff = Math.abs(nodeEnd - functionInfo.endLine);
          
          return startDiff <= 1 && endDiff <= 1;
        });

        if (functionNode) {
          // 🔧 Link declaration node to its functionId for symbol resolver fallback
          localDeclIndex.set(functionNode, functionInfo.id);
        }
      }

      // Second pass: Process calls now that localDeclIndex is complete
      for (const [, functionInfo] of functionMap.entries()) {
        // Find matching function node with line tolerance
        const functionNode = functionNodes.find(node => {
          const nodeStart = node.getStartLineNumber();
          const nodeEnd = node.getEndLineNumber();
          const startDiff = Math.abs(nodeStart - functionInfo.startLine);
          const endDiff = Math.abs(nodeEnd - functionInfo.endLine);
          
          return startDiff <= 1 && endDiff <= 1;
        });

        if (functionNode) {
          // Extract call expressions from function body
          const callExpressions: CallExpression[] = [];
          functionNode.forEachDescendant((node, traversal) => {
            if (Node.isCallExpression(node)) {
              callExpressions.push(node);
            }
            // Skip traversing into nested function declarations
            if (this.isFunctionDeclaration(node) && node !== functionNode) {
              traversal.skip();
            }
          });

          // Process each call expression with symbol resolution
          for (const callExpr of callExpressions) {
            try {
              const resolution = resolveCallee(callExpr, {
                sourceFile,
                typeChecker,
                importIndex,
                internalModulePrefixes: ["src/", "@/", "#/"],
                getFunctionIdByDeclaration:
                  getFunctionIdByDeclaration ??
                  ((decl: Node) => localDeclIndex.get(decl)),
              });


              // Only create edges for internal function calls
              if (resolution.kind === "internal" && resolution.functionId) {
                // Verify the resolved function ID exists in our function map
                if (!Array.from(functionMap.values()).some(f => f.id === resolution.functionId)) {
                  this.logger?.warn(`Resolved function ID ${resolution.functionId} not found in function map`);
                  continue;
                }
                const callEdge = this.createCallEdgeFromResolution(
                  callExpr,
                  functionInfo.id,
                  resolution
                );
                callEdges.push(callEdge);
              }
              // External calls are ignored as they don't contribute to circular dependencies
              // Unknown calls are also ignored as they're likely external or unresolvable
            } catch (error) {
              // Continue processing other calls if one fails
              this.logger?.warn(`Failed to resolve call in ${filePath}:${callExpr.getStartLineNumber()}: ${error}`);
            }
          }
        }
      }

      return callEdges;
    } catch (error) {
      throw new Error(
        `Failed to analyze file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create CallEdge from symbol resolution result
   */
  private createCallEdgeFromResolution(
    callExpr: CallExpression,
    callerFunctionId: string,
    resolution: CalleeResolution
  ): CallEdge {
    const lineNumber = callExpr.getStartLineNumber();
    const columnNumber = callExpr.getSourceFile().getLineAndColumnAtPos(callExpr.getStart()).column;
    
    // Check if this is an await expression
    const isAsync = Node.isAwaitExpression(callExpr.getParent());
    
    // Determine call type based on resolution confidence and context
    let callType: CallEdge['callType'];
    if (isAsync) {
      callType = 'async';
    } else if (resolution.confidence < 0.8) {
      callType = 'dynamic';
    } else {
      callType = 'direct';
    }

    return {
      id: uuidv4(),
      callerFunctionId,
      calleeFunctionId: resolution.kind === "internal" ? resolution.functionId : undefined,
      calleeName: this.extractCalleeNameFromExpression(callExpr.getExpression()),
      calleeSignature: callExpr.getExpression().getText(),
      callType,
      callContext: 'normal', // Context analysis can be added later if needed
      lineNumber,
      columnNumber,
      isAsync,
      isChained: this.isChainedCall(callExpr),
      confidenceScore: resolution.confidence,
      metadata: { via: resolution.kind === "internal" ? resolution.via : "external" },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Extract callee name from call expression
   */
  private extractCalleeNameFromExpression(expr: Node): string {
    if (Node.isIdentifier(expr)) {
      return expr.getText();
    } else if (Node.isPropertyAccessExpression(expr)) {
      return expr.getName();
    } else {
      return expr.getText();
    }
  }

  /**
   * Check if a call expression is chained
   */
  private isChainedCall(callExpr: CallExpression): boolean {
    const expr = callExpr.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) {
      return false;
    }
    
    const leftExpr = expr.getExpression();
    return Node.isCallExpression(leftExpr) || Node.isPropertyAccessExpression(leftExpr);
  }

  /**
   * Get all function-like nodes from a source file
   */
  private getAllFunctionNodes(sourceFile: SourceFile): Node[] {
    const nodes: Node[] = [];
    
    sourceFile.forEachDescendant(node => {
      if (this.isFunctionDeclaration(node)) {
        nodes.push(node);
      }
    });
    
    return nodes;
  }

  /**
   * Check if a node is a function declaration of any type
   */
  private isFunctionDeclaration(node: Node): boolean {
    return Node.isFunctionDeclaration(node) ||
           Node.isMethodDeclaration(node) ||
           Node.isArrowFunction(node) ||
           Node.isFunctionExpression(node) ||
           Node.isConstructorDeclaration(node);
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clear the analysis cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}