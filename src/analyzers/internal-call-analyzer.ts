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
  private project: Project | null = null;

  constructor(logger?: Logger) {
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
      // Create a minimal project for this specific file analysis
      this.project = new Project({
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: true,
        skipLoadingLibFiles: true,
        compilerOptions: {
          isolatedModules: true,
        },
      });

      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const internalCallEdges: InternalCallEdge[] = [];

      // Create lookup maps for efficient function resolution
      const functionsByName = new Map<string, FunctionInfo[]>();

      for (const func of functions) {
        if (!functionsByName.has(func.name)) {
          functionsByName.set(func.name, []);
        }
        functionsByName.get(func.name)!.push(func);
      }

      // Analyze each function for calls to other functions in the same file
      for (const callerFunction of functions) {
        const callEdges = await this.findInternalCallsInFunction(
          sourceFile,
          callerFunction,
          functionsByName,
          snapshotId,
          filePath
        );
        internalCallEdges.push(...callEdges);
      }

      return internalCallEdges;
    } catch (error) {
      this.logger.warn(`Internal call analysis failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    } finally {
      if (this.project) {
        // Clean up memory
        this.project.getSourceFiles().forEach(sf => this.project!.removeSourceFile(sf));
        this.project = null;
      }
    }
  }

  /**
   * Find all calls from a specific function to other functions in the same file
   */
  private async findInternalCallsInFunction(
    sourceFile: SourceFile,
    callerFunction: FunctionInfo,
    functionsByName: Map<string, FunctionInfo[]>,
    snapshotId: string,
    filePath: string
  ): Promise<InternalCallEdge[]> {
    const callEdges: InternalCallEdge[] = [];

    try {
      // Get the function node within the specified line range
      const functionDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
      const methodDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration);
      const arrowFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
      const functionExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression);
      
      // Combine all function-like nodes
      const functionNodes = [
        ...functionDeclarations,
        ...methodDeclarations,
        ...arrowFunctions,
        ...functionExpressions
      ];

      // Find the specific function node by line number matching
      const functionNode = functionNodes.find(node => {
        const start = node.getStartLineNumber();
        const end = node.getEndLineNumber();
        return start >= callerFunction.startLine && end <= callerFunction.endLine;
      });

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
          functionsByName,
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
          functionsByName,
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
  private analyzeCallExpression(
    callExpression: CallExpression,
    callerFunction: FunctionInfo,
    functionsByName: Map<string, FunctionInfo[]>,
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
          functionsByName,
          snapshotId,
          filePath
        );
      }

      // Handle method calls (property access)
      if (Node.isPropertyAccessExpression(expression)) {
        const calleeName = expression.getName();
        return this.createCallEdgeIfInternal(
          callExpression,
          callerFunction,
          calleeName,
          functionsByName,
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
    functionsByName: Map<string, FunctionInfo[]>,
    snapshotId: string,
    filePath: string,
    className?: string
  ): InternalCallEdge | null {
    let candidateFunctions: FunctionInfo[] | undefined;
    
    // Special handling for constructor calls
    if (calleeName === 'constructor' && className) {
      // For constructor calls, we need to find constructor functions that belong to the className
      // funcqc might store constructors with various patterns, so we check multiple possibilities
      candidateFunctions = functionsByName.get('constructor');
      
      if (!candidateFunctions) {
        // Try to find by class name pattern
        candidateFunctions = functionsByName.get(className);
      }
      
      // If still not found, search through all functions for a constructor in the right class
      if (!candidateFunctions) {
        const allFunctions: FunctionInfo[] = [];
        functionsByName.forEach(funcs => allFunctions.push(...funcs));
        candidateFunctions = allFunctions.filter(func => 
          func.name === 'constructor' && 
          func.filePath === filePath
        );
      }
      
      // Log for debugging
      this.logger.debug(`Looking for constructor of class ${className} in ${filePath}, found ${candidateFunctions?.length || 0} candidates`);
    } else {
      // Regular function call
      candidateFunctions = functionsByName.get(calleeName);
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

    const lineNumber = callExpression.getStartLineNumber();
    const columnNumber = callExpression.getStart() - callExpression.getStartLinePos();

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
    functionsByName: Map<string, FunctionInfo[]>,
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
          functionsByName,
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
          functionsByName,
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
    if (this.project) {
      this.project.getSourceFiles().forEach(sf => this.project!.removeSourceFile(sf));
      this.project = null;
    }
  }
}