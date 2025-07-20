import { Project, SourceFile, CallExpression, Node, SyntaxKind } from 'ts-morph';
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
    callExpression: CallExpression,
    callerFunction: FunctionInfo,
    calleeName: string,
    functionsByName: Map<string, FunctionInfo[]>,
    snapshotId: string,
    filePath: string
  ): InternalCallEdge | null {
    // Check if there are functions with this name in the same file
    const candidateFunctions = functionsByName.get(calleeName);
    if (!candidateFunctions || candidateFunctions.length === 0) {
      return null;
    }

    // Find functions in the same file (should be all of them since we're analyzing one file)
    const sameFileFunctions = candidateFunctions.filter(func => func.filePath === callerFunction.filePath);
    if (sameFileFunctions.length === 0) {
      return null;
    }

    // Take the first match (in case of overloads, we'll record the call anyway)
    const calleeFunction = sameFileFunctions[0];

    // Don't record self-calls (recursive calls are handled by regular call edges)
    if (calleeFunction.id === callerFunction.id) {
      return null;
    }

    const lineNumber = callExpression.getStartLineNumber();
    const columnNumber = callExpression.getStart() - callExpression.getStartLinePos();

    return {
      id: uuidv4(),
      snapshotId,
      filePath,
      callerFunctionId: callerFunction.id,
      calleeFunctionId: calleeFunction.id,
      callerName: callerFunction.name,
      calleeName: calleeFunction.name,
      lineNumber,
      columnNumber,
      callContext: this.determineCallContext(callExpression),
      confidenceScore: 1.0, // AST analysis has high confidence
      detectedBy: 'ast',
      createdAt: new Date().toISOString(),
    };
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
   * Clean up resources
   */
  dispose(): void {
    if (this.project) {
      this.project.getSourceFiles().forEach(sf => this.project!.removeSourceFile(sf));
      this.project = null;
    }
  }
}