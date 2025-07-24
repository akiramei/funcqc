/**
 * Import Exact Analysis Stage  
 * Stage 2: Resolves cross-file function calls via TypeChecker with high confidence
 */

import { CallExpression, NewExpression, Node, TypeChecker, Project, PropertyAccessExpression } from 'ts-morph';
import { IdealCallEdge, FunctionMetadata, ResolutionLevel } from '../../ideal-call-graph-analyzer';
import { Logger } from '../../../utils/cli-utils';
import { generateStableEdgeId } from '../../../utils/edge-id-generator';
import { CONFIDENCE_SCORES, RESOLUTION_LEVELS, RESOLUTION_SOURCES, NODE_BUILTIN_MODULES } from '../constants';
import { AnalysisState } from '../types';
import { SymbolCache } from '../../../utils/symbol-cache';

export class ImportExactAnalysisStage {
  private logger: Logger;
  private _debug: boolean;
  // @ts-expect-error - Reserved for future use
  private _typeChecker: TypeChecker;
  // @ts-expect-error - Reserved for future use
  private _project: Project;
  private symbolCache: SymbolCache;
  private functionLookupMap: Map<string, string> = new Map();
  // @ts-expect-error - Reserved for future use
  private _positionIdCache: WeakMap<Node, string> = new WeakMap();

  constructor(
    project: Project, 
    typeChecker: TypeChecker, 
    symbolCache: SymbolCache,
    logger?: Logger
  ) {
    this._project = project;
    this._typeChecker = typeChecker;
    this.symbolCache = symbolCache;
    this.logger = logger ?? new Logger(false);
    this._debug = process.env['DEBUG_STAGED_ANALYSIS'] === 'true';
  }

  /**
   * Build function lookup map for efficient resolution
   */
  buildFunctionLookupMap(functions: Map<string, FunctionMetadata>): void {
    this.functionLookupMap.clear();
    
    for (const [id, func] of functions) {
      // Use line-only key for consistency since FunctionMetadata doesn't have startColumn
      const key = `${func.filePath}:${func.startLine}`;
      this.functionLookupMap.set(key, id);
    }
    
    this.logger.debug(`Built function lookup map with ${this.functionLookupMap.size} entries`);
  }

  /**
   * Analyze import-based function calls
   */
  async analyzeImportCalls(
    callExpressions: Node[],
    newExpressions: Node[],
    functions: Map<string, FunctionMetadata>,
    state: AnalysisState
  ): Promise<number> {
    let importEdgesCount = 0;

    // Process call expressions
    for (const node of callExpressions) {
      const calleeId = this.resolveImportCall(node as CallExpression, functions);
      if (calleeId) {
        const callerFunction = this.findCallerFunction(node, functions);
        if (callerFunction) {
          const isOptional = this.isOptionalCallExpression(node);
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
            metadata: isOptional ? { optionalChaining: true } : {},
            createdAt: new Date().toISOString(),
            candidates: [calleeId],
            confidenceScore: isOptional ? CONFIDENCE_SCORES.IMPORT_EXACT_OPTIONAL : CONFIDENCE_SCORES.IMPORT_EXACT,
            resolutionLevel: RESOLUTION_LEVELS.IMPORT_EXACT as ResolutionLevel,
            resolutionSource: isOptional ? RESOLUTION_SOURCES.TYPECHECKER_IMPORT_OPTIONAL : RESOLUTION_SOURCES.TYPECHECKER_IMPORT,
            runtimeConfirmed: false,
            analysisMetadata: {
              timestamp: Date.now(),
              analysisVersion: '1.0',
              sourceHash: node.getSourceFile().getFilePath()
            }
          };

          this.addEdge(edge, state);
          importEdgesCount++;
        }
      }
    }

    // Process new expressions
    for (const node of newExpressions) {
      const calleeId = this.resolveNewExpression(node as NewExpression, functions);
      if (calleeId) {
        const callerFunction = this.findCallerFunction(node, functions);
        if (callerFunction) {
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
            confidenceScore: CONFIDENCE_SCORES.IMPORT_EXACT,
            resolutionLevel: RESOLUTION_LEVELS.IMPORT_EXACT as ResolutionLevel,
            resolutionSource: RESOLUTION_SOURCES.TYPECHECKER_IMPORT,
            runtimeConfirmed: false,
            analysisMetadata: {
              timestamp: Date.now(),
              analysisVersion: '1.0',
              sourceHash: node.getSourceFile().getFilePath()
            }
          };

          this.addEdge(edge, state);
          importEdgesCount++;
        }
      }
    }

    return importEdgesCount;
  }

  /**
   * Resolve import-based function calls using TypeChecker
   */
  private resolveImportCall(
    callNode: CallExpression,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      const expression = callNode.getExpression();
      
      // Handle different call patterns
      if (Node.isIdentifier(expression)) {
        return this.resolveIdentifierCall(expression, functions);
      } else if (Node.isPropertyAccessExpression(expression)) {
        return this.resolvePropertyAccessCall(expression, functions);
      }
      
      return undefined;
    } catch (error) {
      if (this._debug) {
        this.logger.debug(`Import call resolution failed: ${error}`);
      }
      return undefined;
    }
  }

  /**
   * Resolve identifier-based calls (e.g., importedFunction())
   */
  private resolveIdentifierCall(
    identifier: Node,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      const symbol = this.symbolCache.getSymbolAtLocation(identifier);
      if (!symbol) return undefined;

      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) return undefined;

      for (const declaration of declarations) {
        // Check if it's an import declaration
        const importDecl = declaration.getFirstAncestorByKind(268); // ImportDeclaration
        if (importDecl && Node.isImportDeclaration(importDecl)) {
          const moduleSpecifier = importDecl.getModuleSpecifierValue();
          if (this.isNodeBuiltinModule(moduleSpecifier)) {
            return undefined; // Skip Node.js built-ins
          }
        }

        const sourceFile = declaration.getSourceFile();
        const filePath = sourceFile.getFilePath();
        
        // Try to find function by position (line-only for consistency)
        const startLine = declaration.getStartLineNumber();
        
        const lookupKey = `${filePath}:${startLine}`;
        const functionId = this.functionLookupMap.get(lookupKey);
        
        if (functionId && functions.has(functionId)) {
          return functionId;
        }

        // Fallback: search by name and file
        const functionName = identifier.getText();
        for (const [id, func] of functions) {
          if (func.filePath === filePath && func.name === functionName) {
            return id;
          }
        }
      }

      return undefined;
    } catch (error) {
      if (this._debug) {
        this.logger.debug(`Identifier resolution failed: ${error}`);
      }
      return undefined;
    }
  }

  /**
   * Resolve property access calls (e.g., obj.method())
   */
  private resolvePropertyAccessCall(
    propertyAccess: PropertyAccessExpression,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      const symbol = this.symbolCache.getSymbolAtLocation(propertyAccess);
      if (!symbol) return undefined;

      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) return undefined;

      for (const declaration of declarations) {
        const sourceFile = declaration.getSourceFile();
        const filePath = sourceFile.getFilePath();
        
        const startLine = declaration.getStartLineNumber();
        
        const lookupKey = `${filePath}:${startLine}`;
        const functionId = this.functionLookupMap.get(lookupKey);
        
        if (functionId && functions.has(functionId)) {
          return functionId;
        }
      }

      return undefined;
    } catch (error) {
      if (this._debug) {
        this.logger.debug(`Property access resolution failed: ${error}`);
      }
      return undefined;
    }
  }

  /**
   * Resolve new expressions to constructor functions
   */
  private resolveNewExpression(
    newNode: NewExpression,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      const expression = newNode.getExpression();
      
      if (Node.isIdentifier(expression)) {
        const symbol = this.symbolCache.getSymbolAtLocation(expression);
        if (!symbol) return undefined;

        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) return undefined;

        for (const declaration of declarations) {
          if (Node.isClassDeclaration(declaration)) {
            const className = declaration.getName();
            if (!className) continue;

            // Find constructor for this class
            for (const [id, func] of functions) {
              if (func.className === className && func.name === 'constructor') {
                return id;
              }
            }
          }
        }
      }

      return undefined;
    } catch (error) {
      if (this._debug) {
        this.logger.debug(`New expression resolution failed: ${error}`);
      }
      return undefined;
    }
  }

  /**
   * Check if a call expression uses optional chaining
   */
  private isOptionalCallExpression(node: Node): boolean {
    if (!Node.isCallExpression(node)) return false;
    
    const expression = node.getExpression();
    if (Node.isPropertyAccessExpression(expression)) {
      return expression.hasQuestionDotToken();
    }
    
    return false;
  }

  /**
   * Check if module is a Node.js built-in
   */
  private isNodeBuiltinModule(moduleSpecifier: string): boolean {
    return NODE_BUILTIN_MODULES.has(moduleSpecifier);
  }

  /**
   * Find the caller function for a node
   */
  private findCallerFunction(
    node: Node,
    functions: Map<string, FunctionMetadata>
  ): FunctionMetadata | undefined {
    const sourceFile = node.getSourceFile();
    const filePath = sourceFile.getFilePath();
    
    let current = node.getParent();
    while (current) {
      if (Node.isFunctionDeclaration(current) || 
          Node.isMethodDeclaration(current) || 
          Node.isArrowFunction(current) || 
          Node.isFunctionExpression(current) || 
          Node.isConstructorDeclaration(current)) {
        
        const startLine = current.getStartLineNumber();
        
        const lookupKey = `${filePath}:${startLine}`;
        const functionId = this.functionLookupMap.get(lookupKey);
        
        if (functionId && functions.has(functionId)) {
          return functions.get(functionId);
        }
      }
      
      current = current.getParent();
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