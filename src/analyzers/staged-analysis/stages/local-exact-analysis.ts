/**
 * Local Exact Analysis Stage
 * Stage 1: Resolves function calls within the same file with perfect confidence
 */

import { CallExpression, NewExpression, Node, SourceFile } from 'ts-morph';
import { IdealCallEdge, FunctionMetadata, ResolutionLevel } from '../../ideal-call-graph-analyzer';
import { Logger } from '../../../utils/cli-utils';
import { generateStableEdgeId } from '../../../utils/edge-id-generator';
import { CONFIDENCE_SCORES, RESOLUTION_LEVELS, RESOLUTION_SOURCES } from '../constants';
import { AnalysisState, InstantiationEvent } from '../types';

export class LocalExactAnalysisStage {
  private logger: Logger;
  private debug: boolean;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger(false);
    this.debug = process.env['DEBUG_STAGED_ANALYSIS'] === 'true';
  }

  /**
   * Perform local exact analysis for a single source file
   */
  async analyzeFile(
    sourceFile: SourceFile,
    fileFunctions: FunctionMetadata[],
    functions: Map<string, FunctionMetadata>,
    state: AnalysisState
  ): Promise<{ localEdges: number, instantiationEvents: InstantiationEvent[] }> {
    const filePath = sourceFile.getFilePath();
    let localEdgesCount = 0;
    const instantiationEvents: InstantiationEvent[] = [];

    if (fileFunctions.length === 0) {
      return { localEdges: 0, instantiationEvents: [] };
    }

    // Create local function lookup maps for this file
    const functionByName = new Map<string, FunctionMetadata[]>();
    const functionByLexicalPath = new Map<string, FunctionMetadata>();

    for (const func of fileFunctions) {
      const existing = functionByName.get(func.name) || [];
      existing.push(func);
      functionByName.set(func.name, existing);
      functionByLexicalPath.set(func.lexicalPath, func);
    }

    // Collect expressions with instantiation events
    const callExpressions: Node[] = [];
    const newExpressions: Node[] = [];
    this.collectExpressionsDirectly(sourceFile, callExpressions, newExpressions, instantiationEvents);

    // Process call expressions
    for (const node of callExpressions) {
      const callerFunction = this.findContainingFunction(node, fileFunctions);
      if (!callerFunction) {
        if (this.debug) {
          this.logger.debug(`[SkipNoCaller] line=${node.getStartLineNumber()}-${node.getEndLineNumber()} file=${filePath}`);
        }
        continue;
      }

      const isOptional = this.isOptionalCallExpression(node);
      const localCalleeId = this.resolveLocalCall(
        node as CallExpression,
        callerFunction,
        functionByName,
        functionByLexicalPath,
        functions
      );

      if (localCalleeId) {
        const calleeFunction = functions.get(localCalleeId);
        const edge: IdealCallEdge = {
          id: generateStableEdgeId(callerFunction.id, localCalleeId),
          callerFunctionId: callerFunction.id,
          calleeFunctionId: localCalleeId,
          calleeName: calleeFunction?.name || 'unknown',
          calleeSignature: undefined,
          callerClassName: callerFunction.className,
          calleeClassName: calleeFunction?.className,
          callType: 'direct',
          callContext: undefined,
          lineNumber: node.getStartLineNumber(),
          columnNumber: node.getStart() - node.getStartLinePos(),
          isAsync: false,
          isChained: false,
          metadata: isOptional ? { optionalChaining: true } : {},
          createdAt: new Date().toISOString(),
          candidates: [localCalleeId],
          confidenceScore: isOptional ? CONFIDENCE_SCORES.LOCAL_EXACT_OPTIONAL : CONFIDENCE_SCORES.LOCAL_EXACT,
          resolutionLevel: RESOLUTION_LEVELS.LOCAL_EXACT as ResolutionLevel,
          resolutionSource: isOptional ? RESOLUTION_SOURCES.LOCAL_EXACT_OPTIONAL : RESOLUTION_SOURCES.LOCAL_EXACT,
          runtimeConfirmed: false,
          analysisMetadata: {
            timestamp: Date.now(),
            analysisVersion: '1.0',
            sourceHash: sourceFile.getFilePath()
          }
        };

        this.addEdge(edge, state);
        localEdgesCount++;
      }
    }

    // Process new expressions
    for (const node of newExpressions) {
      const callerFunction = this.findContainingFunction(node, fileFunctions);
      if (!callerFunction) continue;

      const calleeId = this.resolveNewExpression(node as NewExpression, functions);
      if (calleeId) {
        const calleeFunction = functions.get(calleeId);
        const edge: IdealCallEdge = {
          id: generateStableEdgeId(callerFunction.id, calleeId),
          callerFunctionId: callerFunction.id,
          calleeFunctionId: calleeId,
          calleeName: calleeFunction?.name || 'unknown',
          calleeSignature: undefined,
          callerClassName: callerFunction.className,
          calleeClassName: calleeFunction?.className,
          callType: 'direct',
          callContext: undefined,
          lineNumber: node.getStartLineNumber(),
          columnNumber: node.getStart() - node.getStartLinePos(),
          isAsync: false,
          isChained: false,
          metadata: {},
          createdAt: new Date().toISOString(),
          candidates: [calleeId],
          confidenceScore: CONFIDENCE_SCORES.LOCAL_EXACT,
          resolutionLevel: RESOLUTION_LEVELS.LOCAL_EXACT as ResolutionLevel,
          resolutionSource: RESOLUTION_SOURCES.LOCAL_EXACT,
          runtimeConfirmed: false,
          analysisMetadata: {
            timestamp: Date.now(),
            analysisVersion: '1.0',
            sourceHash: filePath
          }
        };

        this.addEdge(edge, state);
        localEdgesCount++;
      }
    }

    return { localEdges: localEdgesCount, instantiationEvents };
  }

  /**
   * Ultra-fast direct AST expression collection with instantiation event tracking
   */
  private collectExpressionsDirectly(
    sourceFile: SourceFile,
    callExpressions: Node[],
    newExpressions: Node[],
    instantiationEvents: InstantiationEvent[]
  ): void {
    const stack: Node[] = [sourceFile];
    const filePath = sourceFile.getFilePath();

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (Node.isCallExpression(current)) {
        callExpressions.push(current);
      } else if (Node.isNewExpression(current)) {
        newExpressions.push(current);
        
        // Collect instantiation event for RTA optimization
        const className = this.extractClassNameFromNewExpression(current);
        if (className) {
          instantiationEvents.push({
            typeName: className,
            filePath,
            lineNumber: current.getStartLineNumber(),
            instantiationType: 'constructor',
            node: current
          });
        }
      }

      // Add children to stack
      for (const child of current.getChildren()) {
        stack.push(child);
      }
    }
  }

  /**
   * Extract class name from new expression for instantiation tracking
   */
  private extractClassNameFromNewExpression(newExpr: NewExpression): string | undefined {
    const expression = newExpr.getExpression();
    if (Node.isIdentifier(expression)) {
      return expression.getText();
    } else if (Node.isPropertyAccessExpression(expression)) {
      return expression.getName();
    }
    return undefined;
  }

  /**
   * Check if a call expression uses optional chaining
   */
  private isOptionalCallExpression(node: Node): boolean {
    if (!Node.isCallExpression(node)) return false;
    
    // Check for optional chaining operator (?.)
    const expression = node.getExpression();
    if (Node.isPropertyAccessExpression(expression)) {
      return expression.hasQuestionDotToken();
    }
    
    return false;
  }

  /**
   * Find the containing function for a node
   */
  private findContainingFunction(
    node: Node,
    fileFunctions: FunctionMetadata[]
  ): FunctionMetadata | undefined {
    let current = node.getParent();

    while (current) {
      if (Node.isFunctionDeclaration(current) || 
          Node.isMethodDeclaration(current) || 
          Node.isArrowFunction(current) || 
          Node.isFunctionExpression(current) || 
          Node.isConstructorDeclaration(current)) {
        
        const startLine = current.getStartLineNumber();
        const endLine = current.getEndLineNumber();

        // Strategy 1: Exact line match
        let match = fileFunctions.find(f => 
          f.startLine === startLine && f.endLine === endLine
        );
        if (match) return match;

        // Strategy 2: Containment-based matching
        match = fileFunctions.find(f => 
          f.startLine <= startLine && f.endLine >= endLine
        );
        if (match) return match;
      }

      current = current.getParent();
    }

    return undefined;
  }

  /**
   * Resolve local function calls within the same file
   */
  private resolveLocalCall(
    callNode: CallExpression,
    callerFunction: FunctionMetadata,
    functionByName: Map<string, FunctionMetadata[]>,
    _functionByLexicalPath: Map<string, FunctionMetadata>,
    _functions: Map<string, FunctionMetadata>
  ): string | undefined {
    const expression = callNode.getExpression();

    // Handle direct function calls
    if (Node.isIdentifier(expression)) {
      const callName = expression.getText();
      const candidates = functionByName.get(callName);
      
      if (candidates && candidates.length > 0) {
        // Prefer function in same class/scope
        const sameScope = candidates.find(c => 
          c.className === callerFunction.className
        );
        return sameScope?.id || candidates[0].id;
      }
    }

    // Handle method calls (this.methodName)
    if (Node.isPropertyAccessExpression(expression)) {
      const objectExpr = expression.getExpression();
      const methodName = expression.getName();

      if (Node.isThisExpression(objectExpr) && callerFunction.className) {
        // Look for method in same class
        const candidates = functionByName.get(methodName);
        const sameClassMethod = candidates?.find(c => 
          c.className === callerFunction.className
        );
        return sameClassMethod?.id;
      }
    }

    return undefined;
  }

  /**
   * Resolve new expressions to constructor functions
   */
  private resolveNewExpression(
    newNode: NewExpression,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    const expression = newNode.getExpression();
    
    if (Node.isIdentifier(expression)) {
      const className = expression.getText();
      
      // Find constructor for this class
      for (const [id, func] of functions) {
        if (func.className === className && func.name === 'constructor') {
          return id;
        }
      }
    }

    return undefined;
  }

  /**
   * Add edge to state with deduplication
   */
  private addEdge(edge: IdealCallEdge, state: AnalysisState): void {
    const edgeKey = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
    
    if (!state.edgeKeys.has(edgeKey)) {
      state.edges.push(edge);
      state.edgeKeys.add(edgeKey);
      state.edgeIndex.set(edgeKey, edge);
    }
  }
}