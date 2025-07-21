import {
  Project,
  SourceFile,
  CallExpression,
  PropertyAccessExpression,
  Node,
} from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';
import { CallEdge } from '../types';
import { AnalysisCache, CacheStats } from '../utils/analysis-cache';

interface CallContext {
  type: 'normal' | 'conditional' | 'loop' | 'try' | 'catch';
  depth: number;
}

interface DetectedCall {
  callerFunctionId: string;
  calleeName: string;
  calleeSignature?: string;
  isAsync: boolean;
  isChained: boolean;
  lineNumber: number;
  columnNumber: number;
  context: CallContext;
  confidenceScore: number;
  isExternal: boolean;
  metadata: Record<string, unknown>;
}

/**
 * Analyzes TypeScript code to extract function call relationships
 * Identifies calls between functions, methods, and external libraries
 */
export class CallGraphAnalyzer {
  private project: Project;
  private cache: AnalysisCache;
  private readonly builtInFunctions = new Set([
    'console.log', 'console.error', 'console.warn', 'console.info',
    'JSON.parse', 'JSON.stringify',
    'Object.keys', 'Object.values', 'Object.entries',
    'Array.from', 'Array.isArray',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Promise.resolve', 'Promise.reject', 'Promise.all', 'Promise.race',
    'Math.abs', 'Math.max', 'Math.min', 'Math.random',
    'Date.now', 'new Date',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  ]);

  constructor(project?: Project, enableCache: boolean = true) {
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
   * Analyze a TypeScript file to extract call graph relationships
   */
  async analyzeFile(
    filePath: string,
    functionMap: Map<string, { id: string; name: string; startLine: number; endLine: number }>
  ): Promise<CallEdge[]> {
    try {
      // 🔧 CRITICAL FIX: Use existing source file if already loaded, avoid double parsing
      // This ensures consistent AST node references and line numbers with TypeScriptAnalyzer
      let sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(filePath);
      }
      const callEdges: CallEdge[] = [];

      // Get all function nodes in the file
      const functionNodes = this.getAllFunctionNodes(sourceFile);

      for (const [, functionInfo] of functionMap.entries()) {
        // Allow ±1 line tolerance for better matching robustness
        // This handles cases where line numbers might be slightly off due to:
        // - Different parsing contexts
        // - Trailing comments or whitespace
        // - BOM or line ending differences
        const functionNode = functionNodes.find(node => {
          const nodeStart = node.getStartLineNumber();
          const nodeEnd = node.getEndLineNumber();
          const startDiff = Math.abs(nodeStart - functionInfo.startLine);
          const endDiff = Math.abs(nodeEnd - functionInfo.endLine);
          
          // Exact match or within 1 line tolerance
          return startDiff <= 1 && endDiff <= 1;
        });

        if (functionNode) {
          const calls = this.extractCallsFromFunction(
            functionNode,
            functionInfo.id,
            functionInfo.name
          );
          
          for (const call of calls) {
            // Enhanced validation before creating call edge
            if (call.calleeName && call.calleeName.trim().length > 0) {
              const callEdge = this.createCallEdge(call, functionMap);
              callEdges.push(callEdge);
            }
          }
        } else {
          // Function not found in AST - this can happen with dynamic functions or parsing issues
          // This is handled gracefully by not adding any call edges for this function
        }
      }

      // Note: Don't remove SourceFile here - it may still be referenced by other analyzers
      // Project disposal will be handled by the parent FunctionAnalyzer
      
      return callEdges;
    } catch (error) {
      throw new Error(
        `Failed to analyze file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Extract all function calls from a function node
   */
  private extractCallsFromFunction(
    functionNode: Node,
    callerFunctionId: string,
    _callerFunctionName: string
  ): DetectedCall[] {
    const calls: DetectedCall[] = [];
    const context: CallContext = { type: 'normal', depth: 0 };

    functionNode.forEachDescendant((node, traversal) => {
      // Update context based on node type
      const nodeContext = this.getCallContext(node, context);
      
      if (Node.isCallExpression(node)) {
        const call = this.analyzeCallExpression(
          node,
          callerFunctionId,
          nodeContext
        );
        if (call) {
          calls.push(call);
        }
      }

      // Skip traversing into nested function declarations
      if (this.isFunctionDeclaration(node) && node !== functionNode) {
        traversal.skip();
      }
    });

    return calls;
  }

  /**
   * Analyze a call expression to extract call information
   */
  private analyzeCallExpression(
    callExpr: CallExpression,
    callerFunctionId: string,
    context: CallContext
  ): DetectedCall | null {
    try {
      const expression = callExpr.getExpression();
      const lineNumber = callExpr.getStartLineNumber();
      const columnNumber = callExpr.getSourceFile().getLineAndColumnAtPos(callExpr.getStart()).column;
      
      // Check if this is an await expression
      const isAsync = Node.isAwaitExpression(callExpr.getParent());
      
      // Analyze the call expression type
      if (Node.isIdentifier(expression)) {
        // Simple function call: functionName()
        return this.createDetectedCall({
          callerFunctionId,
          calleeName: expression.getText(),
          isAsync,
          isChained: false,
          lineNumber,
          columnNumber,
          context,
          isExternal: this.isExternalFunction(expression.getText()),
        });
      } else if (Node.isPropertyAccessExpression(expression)) {
        // Method call: object.method()
        return this.analyzePropertyAccess(
          expression,
          callerFunctionId,
          isAsync,
          lineNumber,
          columnNumber,
          context
        );
      } else if (Node.isElementAccessExpression(expression)) {
        // Dynamic call: object[method]()
        return this.createDetectedCall({
          callerFunctionId,
          calleeName: expression.getText(),
          isAsync,
          isChained: false,
          lineNumber,
          columnNumber,
          context,
          isExternal: true, // Assume dynamic calls are external
          confidenceScore: 0.7, // Lower confidence for dynamic calls
        });
      }

      return null;
    } catch (error) {
      // Return a low-confidence call for error cases
      return this.createDetectedCall({
        callerFunctionId,
        calleeName: 'unknown',
        isAsync: false,
        isChained: false,
        lineNumber: callExpr.getStartLineNumber(),
        columnNumber: 0,
        context,
        isExternal: true,
        confidenceScore: 0.3,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  /**
   * Analyze property access expressions (method calls)
   */
  private analyzePropertyAccess(
    propAccess: PropertyAccessExpression,
    callerFunctionId: string,
    isAsync: boolean,
    lineNumber: number,
    columnNumber: number,
    context: CallContext
  ): DetectedCall {
    const object = propAccess.getExpression();
    const property = propAccess.getName();
    
    // Check for method chaining
    const isChained = Node.isCallExpression(object) || 
                     Node.isPropertyAccessExpression(object);
    
    const fullCallName = propAccess.getText();
    
    return this.createDetectedCall({
      callerFunctionId,
      calleeName: property,
      calleeSignature: fullCallName,
      isAsync,
      isChained,
      lineNumber,
      columnNumber,
      context,
      isExternal: this.isExternalFunction(fullCallName),
    });
  }

  /**
   * Determine the call context based on the surrounding AST nodes
   */
  private getCallContext(node: Node, parentContext: CallContext): CallContext {
    const ancestors = node.getAncestors();
    
    for (const ancestor of ancestors) {
      if (Node.isIfStatement(ancestor) || 
          Node.isConditionalExpression(ancestor) ||
          Node.isSwitchStatement(ancestor)) {
        return { type: 'conditional', depth: parentContext.depth + 1 };
      }
      
      if (Node.isWhileStatement(ancestor) || 
          Node.isForStatement(ancestor) ||
          Node.isForInStatement(ancestor) ||
          Node.isForOfStatement(ancestor)) {
        return { type: 'loop', depth: parentContext.depth + 1 };
      }
      
      if (Node.isTryStatement(ancestor)) {
        return { type: 'try', depth: parentContext.depth + 1 };
      }
      
      if (Node.isCatchClause(ancestor)) {
        return { type: 'catch', depth: parentContext.depth + 1 };
      }
    }
    
    return parentContext;
  }

  /**
   * Check if a function call is to an external library or built-in
   */
  private isExternalFunction(callName: string): boolean {
    // Check built-in functions
    if (this.builtInFunctions.has(callName)) {
      return true;
    }
    
    // Check for common library patterns
    const externalPatterns = [
      /^[a-z]+\./,  // lodash.get, axios.get, etc.
      /^[A-Z][a-z]+\./,  // React.useState, Vue.ref, etc.
      /^require\(/,  // require() calls
      /^import\(/,   // dynamic imports
    ];
    
    return externalPatterns.some(pattern => pattern.test(callName));
  }

  /**
   * Create a DetectedCall object with defaults
   */
  private createDetectedCall(params: {
    callerFunctionId: string;
    calleeName: string;
    calleeSignature?: string;
    isAsync: boolean;
    isChained: boolean;
    lineNumber: number;
    columnNumber: number;
    context: CallContext;
    isExternal: boolean;
    confidenceScore?: number;
    metadata?: Record<string, unknown>;
  }): DetectedCall {
    return {
      confidenceScore: 1.0,
      metadata: {},
      ...params,
    };
  }

  /**
   * Convert DetectedCall to CallEdge
   */
  private createCallEdge(
    call: DetectedCall,
    functionMap: Map<string, { id: string; name: string }>
  ): CallEdge {
    // Try to find the callee function in the same file with improved matching
    let calleeFunctionId: string | undefined;
    let bestMatch: { id: string; score: number } | undefined;
    
    for (const [id, info] of functionMap.entries()) {
      if (info.name === call.calleeName) {
        // Exact name match - highest priority
        calleeFunctionId = id;
        break;
      } else if (info.name.includes(call.calleeName) || call.calleeName.includes(info.name)) {
        // Partial match - consider as fallback
        const score = Math.max(info.name.length, call.calleeName.length) - 
                     Math.abs(info.name.length - call.calleeName.length);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { id, score };
        }
      }
    }
    
    // Use best match if no exact match found
    if (!calleeFunctionId && bestMatch) {
      calleeFunctionId = bestMatch.id;
    }

    // Determine call type
    let callType: CallEdge['callType'];
    if (call.isExternal || !calleeFunctionId) {
      callType = 'external';
    } else if (call.isAsync) {
      callType = 'async';
    } else if (call.context.type === 'conditional') {
      callType = 'conditional';
    } else if (call.metadata['error']) {
      callType = 'dynamic';
    } else {
      callType = 'direct';
    }

    return {
      id: uuidv4(),
      callerFunctionId: call.callerFunctionId,
      calleeFunctionId,
      calleeName: call.calleeName,
      calleeSignature: call.calleeSignature,
      callType,
      callContext: call.context.type,
      lineNumber: call.lineNumber,
      columnNumber: call.columnNumber,
      isAsync: call.isAsync,
      isChained: call.isChained,
      confidenceScore: call.confidenceScore,
      metadata: call.metadata,
      createdAt: new Date().toISOString(),
    };
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