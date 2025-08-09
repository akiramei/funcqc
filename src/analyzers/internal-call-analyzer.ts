import { Project, SourceFile, CallExpression, NewExpression, Node, SyntaxKind } from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';
import { FunctionInfo, InternalCallEdge } from '../types';
import { Logger } from '../utils/cli-utils';

/**
 * Analyzer for detecting intra-file function calls
 * Used to support safe-delete analysis with snapshot consistency
 */
export class InternalCallAnalyzer {
  private logger: Logger;
  private project: Project;

  constructor(project: Project, logger?: Logger) {
    this.project = project;
    this.logger = logger || new Logger(false, false);
  }

  /**
   * Analyze a file to detect all intra-file function calls
   * Returns internal call edges for storage in the database
   */
  async analyzeFileForInternalCalls(
    filePath: string,
    functions: FunctionInfo[],
    snapshotId: string
  ): Promise<InternalCallEdge[]> {
    try {
      // Use existing source file or add if not already loaded
      let sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(filePath);
      }
      
      // Initialize line number cache
      sourceFile.getFullText();
      const internalCallEdges: InternalCallEdge[] = [];

      // Create lookup maps using qualified names for accurate resolution
      const functionsByQualifiedName = new Map<string, FunctionInfo[]>();

      for (const func of functions) {
        // Create qualified name considering context path
        const qualifiedName = this.createQualifiedName(func);
        const simpleName = func.name;
        
        // Map both qualified and simple names for flexible lookup
        [qualifiedName, simpleName].forEach(name => {
          if (!functionsByQualifiedName.has(name)) {
            functionsByQualifiedName.set(name, []);
          }
          functionsByQualifiedName.get(name)!.push(func);
        });
      }

      // Precompute function-like nodes and an index (one pass per file)
      const fnDecls = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
      const methodDecls = sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration);
      const arrowFns = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
      const fnExprs = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression);
      const functionNodes = [...fnDecls, ...methodDecls, ...arrowFns, ...fnExprs];
      const functionIndex = new Map<string, Node>();
      for (const n of functionNodes) {
        functionIndex.set(`${n.getStartLineNumber()}:${n.getEndLineNumber()}`, n);
      }

      // Analyze each function for calls to other functions in the same file
      for (const callerFunction of functions) {
        const callEdges = await this.findInternalCallsInFunction(
          sourceFile,
          callerFunction,
          functionsByQualifiedName,
          snapshotId,
          filePath,
          functionNodes,
          functionIndex
        );
        internalCallEdges.push(...callEdges);
      }

      return internalCallEdges;
    } catch (error) {
      this.logger.warn(`Internal call analysis failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    } finally {
      // No cleanup needed - project is shared and managed externally
    }
  }

  /**
   * Find all calls from a specific function to other functions in the same file
   */
  private async findInternalCallsInFunction(
    sourceFile: SourceFile,
    callerFunction: FunctionInfo,
    functionsByQualifiedName: Map<string, FunctionInfo[]>,
    snapshotId: string,
    filePath: string,
    functionNodes: Node[],
    functionIndex: Map<string, Node>
  ): Promise<InternalCallEdge[]> {
    const callEdges: InternalCallEdge[] = [];

    try {
      // Find the specific function node using precomputed index (tolerant to minor line drift)
      let functionNode = functionIndex.get(`${callerFunction.startLine}:${callerFunction.endLine}`);

      if (!functionNode) {
        // Fallback: choose the smallest node fully covering the caller's line range
        const candidates = functionNodes.filter(n => {
          const st = n.getStartLineNumber();
          const ed = n.getEndLineNumber();
          return st >= callerFunction.startLine && ed <= callerFunction.endLine;
        });
        if (candidates.length > 0) {
          candidates.sort((a,b) => (a.getEndLineNumber()-a.getStartLineNumber()) - (b.getEndLineNumber()-b.getStartLineNumber()));
          functionNode = candidates[0];
        }
      }

      if (!functionNode) {
        // As a last resort, pick the closest by start/end distance
        let best: Node | undefined;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const n of functionNodes) {
          const st = n.getStartLineNumber();
          const ed = n.getEndLineNumber();
          const score = Math.abs(st - callerFunction.startLine) + Math.abs(ed - callerFunction.endLine);
          if (score < bestScore) { best = n; bestScore = score; }
        }
        functionNode = best as Node | undefined;
      }

      if (!functionNode) {
        // Function node not found - possibly due to line number mismatch
        return callEdges;
      }

      // Find all call expressions within this function
      const callExpressions = functionNode.getDescendantsOfKind(SyntaxKind.CallExpression);
      const newExpressions = functionNode.getDescendantsOfKind(SyntaxKind.NewExpression);

      // Process regular function calls
      for (const callExpression of callExpressions) {
        const edge = this.analyzeCallExpression(
          callExpression as CallExpression,
          callerFunction,
          functionsByQualifiedName,
          snapshotId,
          filePath
        );
        if (edge) {
          callEdges.push(edge);
        }
      }

      // Process constructor calls (new ClassName())
      for (const newExpression of newExpressions) {
        const edge = this.analyzeNewExpression(
          newExpression as NewExpression,
          callerFunction,
          functionsByQualifiedName,
          snapshotId,
          filePath
        );
        if (edge) {
          callEdges.push(edge);
        }
      }
    } catch (error) {
      this.logger.debug(`Failed to analyze function ${callerFunction.name}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return callEdges;
  }

  /**
   * Analyze a call expression to create an internal call edge if it calls another function in the same file
   */
  /**
   * Create qualified name considering context path for accurate function resolution
   */
  private createQualifiedName(func: FunctionInfo): string {
    if (func.contextPath && func.contextPath.length > 0) {
      return `${func.contextPath.join('.')}.${func.name}`;
    }
    return func.name;
  }

  /**
   * Resolve qualified method name considering receiver context
   */
  private resolveQualifiedMethodName(
    receiver: Node,
    methodName: string,
    callerFunction: FunctionInfo
  ): string {
    // Handle 'this' receiver - use caller's class context
    if (Node.isThisExpression(receiver)) {
      if (callerFunction.contextPath && callerFunction.contextPath.length > 0) {
        return `${callerFunction.contextPath[0]}.${methodName}`;
      }
    }
    
    // Handle identifier receiver (e.g., obj.method)
    if (Node.isIdentifier(receiver)) {
      const receiverName = receiver.getText();
      // For now, return as-is, but could be enhanced with type analysis
      return `${receiverName}.${methodName}`;
    }
    
    // Default to method name only
    return methodName;
  }

  private analyzeCallExpression(
    callExpression: CallExpression,
    callerFunction: FunctionInfo,
    functionsByQualifiedName: Map<string, FunctionInfo[]>,
    snapshotId: string,
    filePath: string
  ): InternalCallEdge | null {
    try {
      const expression = callExpression.getExpression();

      // Handle simple function calls (identifier)
      if (Node.isIdentifier(expression)) {
        const calleeName = expression.getText();
        return this.createCallEdgeIfInternal(
          callExpression,
          callerFunction,
          calleeName,
          functionsByQualifiedName,
          snapshotId,
          filePath
        );
      }

      // Handle method calls (property access) with context awareness
      if (Node.isPropertyAccessExpression(expression)) {
        const methodName = expression.getName();
        const receiver = expression.getExpression();
        
        // Resolve qualified method name based on receiver
        const qualifiedMethodName = this.resolveQualifiedMethodName(
          receiver, 
          methodName, 
          callerFunction
        );
        
        return this.createCallEdgeIfInternal(
          callExpression,
          callerFunction,
          qualifiedMethodName,
          functionsByQualifiedName,
          snapshotId,
          filePath
        );
      }

      // TODO: Handle other call patterns if needed (computed property access, etc.)
      return null;
    } catch (error) {
      this.logger.debug(`Failed to analyze call expression: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Create an internal call edge if the called function exists in the same file
   */
  private createCallEdgeIfInternal(
    callExpression: CallExpression | NewExpression,
    callerFunction: FunctionInfo,
    calleeName: string,
    functionsByQualifiedName: Map<string, FunctionInfo[]>,
    snapshotId: string,
    filePath: string,
    className?: string
  ): InternalCallEdge | null {
    let candidateFunctions: FunctionInfo[] | undefined;
    
    // Try qualified name first, then fallback to simple name
    candidateFunctions = functionsByQualifiedName.get(calleeName);
    
    // Special handling for constructor calls
    if (calleeName === 'constructor' && className) {
      const qualifiedConstructorName = `${className}.constructor`;
      candidateFunctions = functionsByQualifiedName.get(qualifiedConstructorName) || 
                         functionsByQualifiedName.get('constructor');
      
      // Log for debugging
      this.logger.debug(`Looking for constructor of class ${className} in ${filePath}, found ${candidateFunctions?.length || 0} candidates`);
    }
    
    // If no qualified match found, try simple name
    if (!candidateFunctions || candidateFunctions.length === 0) {
      // Extract simple name from qualified name if needed
      const simpleName = calleeName.includes('.') ? calleeName.split('.').pop()! : calleeName;
      candidateFunctions = functionsByQualifiedName.get(simpleName);
    }
    
    if (!candidateFunctions || candidateFunctions.length === 0) {
      return null;
    }

    // Find functions in the same file (should be all of them since we're analyzing one file)
    const sameFileFunctions = candidateFunctions.filter(func => func.filePath === callerFunction.filePath);
    if (sameFileFunctions.length === 0) {
      return null;
    }

    // For constructors with multiple matches, we need a better strategy
    // Since we don't have class context, we'll create edges for ALL constructors
    // This is conservative but ensures we don't miss any real calls
    if (calleeName === 'constructor' && sameFileFunctions.length > 1) {
      // Log multiple constructor situation
      this.logger.debug(`Found ${sameFileFunctions.length} constructors for class ${className || 'unknown'}`);
      
      // For now, pick the first one, but this should ideally use AST position info
      // TODO: Use AST analysis to match the correct constructor based on class position
    }

    // Take the first match (in case of overloads, we'll record the call anyway)
    const calleeFunction = sameFileFunctions[0];

    // Don't record self-calls (recursive calls are handled by regular call edges)
    if (calleeFunction.id === callerFunction.id) {
      return null;
    }

    let lineNumber: number;
    let columnNumber: number;
    
    try {
      // Use the stable method to get line number
      const pos = callExpression.getStart();
      const lineAndColumn = callExpression.getSourceFile().getLineAndColumnAtPos(pos);
      lineNumber = lineAndColumn.line;
      columnNumber = lineAndColumn.column;
    } catch (error) {
      this.logger.debug(`Failed to get line/column for call expression: ${error}`);
      lineNumber = 0;
      columnNumber = 0;
    }

    const callerClassName = this.extractClassName(callerFunction);
    const calleeClassName = className || this.extractClassName(calleeFunction);

    return {
      id: uuidv4(),
      snapshotId,
      filePath,
      callerFunctionId: callerFunction.id,
      calleeFunctionId: calleeFunction.id,
      callerName: callerFunction.name,
      calleeName: calleeFunction.name,
      ...(callerClassName && { callerClassName }),
      ...(calleeClassName && { calleeClassName }),
      lineNumber,
      columnNumber,
      callType: this.determineCallType(callExpression),
      callContext: Node.isCallExpression(callExpression) 
        ? this.determineCallContext(callExpression) 
        : 'constructor',
      confidenceScore: 1.0, // AST analysis has high confidence
      detectedBy: 'ast',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Determine the type of function call based on syntax and context
   */
  private determineCallType(callExpression: CallExpression | NewExpression): 'direct' | 'conditional' | 'async' | 'dynamic' {
    // Check for await expression (async call)
    const parent = callExpression.getParent();
    if (Node.isAwaitExpression(parent)) {
      return 'async';
    }

    // Check for conditional context
    if (this.isInConditionalContext(callExpression)) {
      return 'conditional';
    }

    // Check for dynamic call (computed property access)
    if (Node.isCallExpression(callExpression)) {
      const expression = callExpression.getExpression();
      if (Node.isElementAccessExpression(expression) || 
          (Node.isPropertyAccessExpression(expression) && 
           Node.isElementAccessExpression(expression.getExpression()))) {
        return 'dynamic';
      }
    }

    return 'direct';
  }

  /**
   * Check if call expression is in a conditional context
   */
  private isInConditionalContext(node: Node): boolean {
    let parent = node.getParent();
    
    while (parent) {
      if (Node.isIfStatement(parent) || 
          Node.isConditionalExpression(parent) || 
          Node.isBinaryExpression(parent)) {
        // Check if it's a logical operator
        if (Node.isBinaryExpression(parent)) {
          const operator = parent.getOperatorToken().getKind();
          if (operator === SyntaxKind.AmpersandAmpersandToken || 
              operator === SyntaxKind.BarBarToken) {
            return true;
          }
        } else {
          return true;
        }
      }
      parent = parent.getParent();
    }
    
    return false;
  }

  /**
   * Determine the context of a function call (normal, conditional, loop, etc.)
   */
  private determineCallContext(callExpression: CallExpression): string {
    let parent = callExpression.getParent();
    
    while (parent) {
      if (Node.isIfStatement(parent)) {
        return 'conditional';
      }
      if (Node.isForStatement(parent) || Node.isWhileStatement(parent) || Node.isDoStatement(parent)) {
        return 'loop';
      }
      if (Node.isTryStatement(parent)) {
        return 'try';
      }
      if (Node.isCatchClause(parent)) {
        return 'catch';
      }
      parent = parent.getParent();
    }

    return 'normal';
  }

  /**
   * Analyze a new expression (constructor call) to create an internal call edge
   */
  private analyzeNewExpression(
    newExpression: NewExpression,
    callerFunction: FunctionInfo,
    functionsByQualifiedName: Map<string, FunctionInfo[]>,
    snapshotId: string,
    filePath: string
  ): InternalCallEdge | null {
    try {
      const expression = newExpression.getExpression();

      // Handle constructor calls (new ClassName())
      if (Node.isIdentifier(expression)) {
        const className = expression.getText();
        // Look for constructor function with the class name
        return this.createCallEdgeIfInternal(
          newExpression,
          callerFunction,
          'constructor', // Constructor functions are named 'constructor'
          functionsByQualifiedName,
          snapshotId,
          filePath,
          className // Pass class name as additional context
        );
      }

      // Handle property access (new namespace.ClassName())
      if (Node.isPropertyAccessExpression(expression)) {
        const className = expression.getName();
        return this.createCallEdgeIfInternal(
          newExpression,
          callerFunction,
          'constructor',
          functionsByQualifiedName,
          snapshotId,
          filePath,
          className
        );
      }
    } catch (error) {
      this.logger.debug(`Failed to analyze new expression: ${error instanceof Error ? error.message : String(error)}`);
    }

    return null;
  }

  /**
   * Extract class name from function info based on context path
   */
  private extractClassName(func: FunctionInfo): string | null {
    // Check if function is a method or constructor with class context
    if (func.contextPath && func.contextPath.length > 0) {
      // For methods and constructors, the class name is typically the first element in context path
      return func.contextPath[0] || null;
    }
    
    // Check if function type indicates it's a method
    if (func.functionType === 'method' || func.isMethod || func.isConstructor) {
      // Try to extract class name from display name (e.g., "ClassName.methodName")
      const displayNameParts = func.displayName.split('.');
      if (displayNameParts.length >= 2) {
        return displayNameParts[0];
      }
    }
    
    return null;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // No cleanup needed - project is shared and managed externally
  }
}