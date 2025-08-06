import {
  Project,
  SourceFile,
  CallExpression,
  Node,
  TypeChecker,
} from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';
import { CallEdge } from '../types';
import { AnalysisCache, CacheStats } from '../utils/analysis-cache';
import { CacheProvider } from '../utils/cache-interfaces';
import { CacheServiceLocator } from '../utils/cache-injection';
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
  private callEdgeCache: CacheProvider<CallEdge[]>;
  private logger: Logger | undefined;
// Built-in functions moved to symbol-resolver.ts - no longer needed here

  constructor(
    project?: Project, 
    enableCache: boolean = true, 
    logger?: Logger,
    callEdgeCache?: CacheProvider<CallEdge[]>
  ) {
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
    this.callEdgeCache = callEdgeCache || CacheServiceLocator.getGenericCache<CallEdge[]>('call-graph-edges');
  }

  /**
   * Analyze a TypeScript file to extract call graph relationships using symbol resolution
   */
  /**
   * Build function node index for efficient lookup
   */
  private buildFunctionNodeIndex(
    functionNodes: Node[],
    functionMap: Map<string, { id: string; name: string; startLine: number; endLine: number }>
  ): Map<Node, string> {
    const localDeclIndex = new Map<Node, string>();

    // Build the complete localDeclIndex before processing any calls
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
        // Link declaration node to its functionId for symbol resolver fallback
        localDeclIndex.set(functionNode, functionInfo.id);
      }
    }

    return localDeclIndex;
  }

  /**
   * Extract call expressions from a function node
   */
  private extractCallExpressions(functionNode: Node): CallExpression[] {
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
    return callExpressions;
  }

  /**
   * Process call expressions and create call edges
   */
  private async processCallEdges(
    callExpressions: CallExpression[],
    sourceFunctionId: string,
    filePath: string,
    sourceFile: SourceFile,
    typeChecker: TypeChecker,
    importIndex: ReturnType<typeof buildImportIndex>,
    allowedFunctionIdSet: Set<string>,
    getFunctionIdByDeclaration: (decl: Node) => string | undefined
  ): Promise<CallEdge[]> {
    const callEdges: CallEdge[] = [];

    for (const callExpr of callExpressions) {
      try {
        const resolution = resolveCallee(callExpr, {
          sourceFile,
          typeChecker,
          importIndex,
          internalModulePrefixes: ["src/", "@/", "#/"],
          getFunctionIdByDeclaration,
        });

        // Only create edges for internal function calls
        if (resolution.kind === "internal" && resolution.functionId) {
          // Verify the resolved function ID exists in allowed functions set
          if (!allowedFunctionIdSet.has(resolution.functionId)) {
            this.logger?.warn(`Resolved function ID ${resolution.functionId} not found in allowed functions set`);
            continue;
          }
          const callEdge = this.createCallEdgeFromResolution(
            callExpr,
            sourceFunctionId,
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

    return callEdges;
  }

  // New signature with allowedFunctionIdSet
  async analyzeFile(
    filePath: string,
    localFunctionMap: Map<string, { id: string; name: string; startLine: number; endLine: number }>,
    getFunctionIdByDeclaration: (decl: Node) => string | undefined,
    allowedFunctionIdSet: Set<string>
  ): Promise<CallEdge[]>;

  // Backward compatibility overload - uses local function map as allowed set
  async analyzeFile(
    filePath: string,
    functionMap: Map<string, { id: string; name: string; startLine: number; endLine: number }>,
    getFunctionIdByDeclaration?: (decl: Node) => string | undefined
  ): Promise<CallEdge[]>;

  async analyzeFile(
    filePath: string,
    functionMap: Map<string, { id: string; name: string; startLine: number; endLine: number }>,
    getFunctionIdByDeclaration?: (decl: Node) => string | undefined,
    allowedFunctionIdSet?: Set<string>
  ): Promise<CallEdge[]> {
    try {
      // Backward compatibility: if allowedFunctionIdSet not provided, create from functionMap
      const actualAllowedFunctionIdSet = allowedFunctionIdSet || 
        new Set(Array.from(functionMap.values()).map(f => f.id));
      
      // Ensure getFunctionIdByDeclaration is not undefined
      const actualGetFunctionIdByDeclaration = getFunctionIdByDeclaration || (() => undefined);

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
      
      // Build function node index for efficient lookup (using local functions only)
      const localDeclIndex = this.buildFunctionNodeIndex(functionNodes, functionMap);
      
      // Create fallback function for declaration lookup
      const declarationLookup = actualGetFunctionIdByDeclaration ?? ((decl: Node) => localDeclIndex.get(decl));

      // Process each function and extract call edges (using local functions only)
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
          const callExpressions = this.extractCallExpressions(functionNode);

          // Process call expressions and create call edges
          const functionCallEdges = await this.processCallEdges(
            callExpressions,
            functionInfo.id,
            filePath,
            sourceFile,
            typeChecker,
            importIndex,
            actualAllowedFunctionIdSet,
            declarationLookup
          );
          
          callEdges.push(...functionCallEdges);
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
    // Use injected cache stats if available, fallback to legacy cache
    if ('getStats' in this.callEdgeCache && typeof this.callEdgeCache.getStats === 'function') {
      const stats = this.callEdgeCache.getStats();
      return {
        totalEntries: stats.totalEntries,
        totalSize: 0, // Not available in simplified interface
        hitRate: stats.hitRate,
        hits: stats.hits,
        misses: stats.misses
      };
    }
    return this.cache.getStats();
  }

  /**
   * Clear the analysis cache
   */
  async clearCache(): Promise<void> {
    await Promise.all([
      this.cache.clear(),
      this.callEdgeCache.clear()
    ]);
  }
}