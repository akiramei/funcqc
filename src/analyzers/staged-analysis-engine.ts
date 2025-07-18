import { Project, Node, TypeChecker, CallExpression } from 'ts-morph';
import { IdealCallEdge, ResolutionLevel, FunctionMetadata } from './ideal-call-graph-analyzer';
import { CHAAnalyzer, UnresolvedMethodCall } from './cha-analyzer';

/**
 * Staged Analysis Engine
 * 
 * Performs call graph analysis in stages with increasing sophistication:
 * 1. Local Exact - Same file calls (confidence: 1.0)
 * 2. Import Exact - Cross-file imports via TypeChecker (confidence: 0.95)
 * 3. CHA Resolved - Class Hierarchy Analysis (confidence: 0.8)
 * 4. RTA Resolved - Rapid Type Analysis (confidence: 0.9)
 * 
 * Each stage only adds edges it can resolve with high confidence.
 */
export class StagedAnalysisEngine {
  private project: Project;
  private typeChecker: TypeChecker;
  private edges: IdealCallEdge[] = [];
  private unresolvedMethodCalls: UnresolvedMethodCall[] = [];
  private chaAnalyzer: CHAAnalyzer;

  constructor(project: Project, typeChecker: TypeChecker) {
    this.project = project;
    this.typeChecker = typeChecker;
    this.chaAnalyzer = new CHAAnalyzer(project, typeChecker);
  }

  /**
   * Perform staged analysis with maximum precision
   */
  async performStagedAnalysis(functions: Map<string, FunctionMetadata>): Promise<IdealCallEdge[]> {
    this.edges = [];
    
    console.log('   🔍 Stage 1: Local exact analysis...');
    await this.performLocalExactAnalysis(functions);
    console.log(`      Found ${this.edges.length} local edges`);
    
    console.log('   🔍 Stage 2: Import exact analysis...');
    const importEdges = await this.performImportExactAnalysis(functions);
    console.log(`      Found ${importEdges} import edges`);
    
    console.log('   🔍 Stage 3: CHA analysis...');
    const chaEdges = await this.performCHAAnalysis(functions);
    console.log(`      Found ${chaEdges} CHA edges`);
    
    console.log('   🔍 Stage 4: RTA analysis...');
    const rtaEdges = await this.performRTAAnalysis(functions);
    console.log(`      Found ${rtaEdges} RTA edges`);
    
    return this.edges;
  }

  /**
   * Stage 1: Local Exact Analysis
   * Analyze calls within the same source file with 100% confidence
   */
  private async performLocalExactAnalysis(functions: Map<string, FunctionMetadata>): Promise<void> {
    const sourceFiles = this.project.getSourceFiles();
    
    for (const sourceFile of sourceFiles) {
      const filePath = sourceFile.getFilePath();
      const fileFunctions = Array.from(functions.values()).filter(f => f.filePath === filePath);
      
      if (fileFunctions.length === 0) continue;
      
      // Create lookup map for functions in this file
      const functionByName = new Map<string, FunctionMetadata>();
      const functionByLexicalPath = new Map<string, FunctionMetadata>();
      
      for (const func of fileFunctions) {
        functionByName.set(func.name, func);
        functionByLexicalPath.set(func.lexicalPath, func);
      }
      
      // Analyze all call expressions in this file
      sourceFile.forEachDescendant(node => {
        if (Node.isCallExpression(node)) {
          const callerFunction = this.findContainingFunction(node, fileFunctions);
          if (!callerFunction) return;
          
          const calleeId = this.resolveLocalCall(node, functionByName, functionByLexicalPath);
          if (calleeId) {
            this.addEdge({
              callerFunctionId: callerFunction.id,
              calleeFunctionId: calleeId,
              candidates: [calleeId],
              confidenceScore: 1.0,
              resolutionLevel: 'local_exact' as ResolutionLevel,
              resolutionSource: 'local_exact',
              runtimeConfirmed: false,
              lineNumber: node.getStartLineNumber(),
              columnNumber: node.getStart() - node.getStartLinePos(),
              analysisMetadata: {
                timestamp: Date.now(),
                analysisVersion: '1.0',
                sourceHash: sourceFile.getFilePath()
              }
            });
          }
        }
      });
    }
  }

  /**
   * Stage 2: Import Exact Analysis
   * Analyze cross-file imports using TypeChecker with high confidence
   */
  private async performImportExactAnalysis(functions: Map<string, FunctionMetadata>): Promise<number> {
    let importEdgesCount = 0;
    const sourceFiles = this.project.getSourceFiles();
    
    for (const sourceFile of sourceFiles) {
      const filePath = sourceFile.getFilePath();
      const fileFunctions = Array.from(functions.values()).filter(f => f.filePath === filePath);
      
      if (fileFunctions.length === 0) continue;
      
      sourceFile.forEachDescendant(node => {
        if (Node.isCallExpression(node)) {
          const callerFunction = this.findContainingFunction(node, fileFunctions);
          if (!callerFunction) return;
          
          const calleeId = this.resolveImportCall(node, functions);
          if (calleeId) {
            this.addEdge({
              callerFunctionId: callerFunction.id,
              calleeFunctionId: calleeId,
              candidates: [calleeId],
              confidenceScore: 0.95,
              resolutionLevel: 'import_exact' as ResolutionLevel,
              resolutionSource: 'typechecker_import',
              runtimeConfirmed: false,
              lineNumber: node.getStartLineNumber(),
              columnNumber: node.getStart() - node.getStartLinePos(),
              analysisMetadata: {
                timestamp: Date.now(),
                analysisVersion: '1.0',
                sourceHash: sourceFile.getFilePath()
              }
            });
            importEdgesCount++;
          }
        }
      });
    }
    
    return importEdgesCount;
  }

  /**
   * Stage 3: CHA Analysis
   * Class Hierarchy Analysis for method calls
   */
  private async performCHAAnalysis(functions: Map<string, FunctionMetadata>): Promise<number> {
    if (this.unresolvedMethodCalls.length === 0) {
      console.log('   ℹ️  No unresolved method calls for CHA analysis');
      return 0;
    }
    
    try {
      const chaEdges = await this.chaAnalyzer.performCHAAnalysis(functions, this.unresolvedMethodCalls);
      
      // Add CHA edges to our collection
      for (const edge of chaEdges) {
        this.addEdge(edge);
      }
      
      // Clear unresolved method calls after successful CHA analysis to prevent memory leaks
      this.unresolvedMethodCalls.length = 0;
      
      console.log(`   ✅ CHA resolved ${chaEdges.length} method calls`);
      return chaEdges.length;
    } catch (error) {
      console.log(`   ⚠️  CHA analysis failed: ${error}`);
      // Don't clear unresolved calls on failure - they might be needed for RTA
      return 0;
    }
  }

  /**
   * Stage 4: RTA Analysis  
   * Rapid Type Analysis with constructor tracking
   */
  private async performRTAAnalysis(_functions: Map<string, FunctionMetadata>): Promise<number> {
    // Implementation will be added in next phase
    // For now, maintain perfect precision by not adding uncertain edges
    return 0;
  }

  /**
   * Resolve local function calls within same file
   */
  private resolveLocalCall(
    callNode: CallExpression,
    functionByName: Map<string, FunctionMetadata>,
    _functionByLexicalPath: Map<string, FunctionMetadata>
  ): string | undefined {
    const expression = callNode.getExpression();
    
    if (Node.isIdentifier(expression)) {
      // Direct function call: foo()
      const name = expression.getText();
      const func = functionByName.get(name);
      return func?.id;
    }
    
    if (Node.isPropertyAccessExpression(expression)) {
      // Method call: obj.method()
      const methodName = expression.getName();
      
      // Try to find exact match first
      const func = functionByName.get(methodName);
      if (func) {
        return func.id;
      }
      
      // If not found locally, collect for CHA analysis
      // We need to find the caller using the file functions
      const fileFunctions = Array.from(functionByName.values());
      const callerFunction = this.findContainingFunction(callNode, fileFunctions);
      if (callerFunction) {
        const receiverExpression = expression.getExpression();
        let receiverType: string | undefined;
        
        // Try to determine receiver type using TypeChecker
        try {
          const type = this.typeChecker.getTypeAtLocation(receiverExpression);
          receiverType = type.getSymbol()?.getName();
        } catch {
          // If TypeChecker fails, we'll try CHA without receiver type
        }
        
        this.unresolvedMethodCalls.push({
          callerFunctionId: callerFunction.id,
          methodName,
          receiverType,
          lineNumber: callNode.getStartLineNumber(),
          columnNumber: callNode.getStart()
        });
      }
    }
    
    return undefined;
  }

  /**
   * Resolve cross-file import calls using TypeChecker
   */
  private resolveImportCall(
    callNode: CallExpression,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      const expression = callNode.getExpression();
      
      if (Node.isIdentifier(expression)) {
        // Get symbol from TypeChecker
        const symbol = this.typeChecker.getSymbolAtLocation(expression);
        if (!symbol) return undefined;
        
        // Get the declaration
        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) return undefined;
        
        const declaration = declarations[0];
        if (!Node.isFunctionDeclaration(declaration) && !Node.isMethodDeclaration(declaration) && !Node.isArrowFunction(declaration) && !Node.isFunctionExpression(declaration)) return undefined;
        
        // Find matching function in our registry
        const declFilePath = declaration.getSourceFile().getFilePath();
        const declStartLine = declaration.getStartLineNumber();
        
        for (const func of functions.values()) {
          if (func.filePath === declFilePath && func.startLine === declStartLine) {
            return func.id;
          }
        }
      }
      
      if (Node.isPropertyAccessExpression(expression)) {
        // Method call through import: importedObj.method()
        const methodName = expression.getName();
        const receiverExpression = expression.getExpression();
        
        // Try to resolve receiver type
        let receiverType: string | undefined;
        try {
          const type = this.typeChecker.getTypeAtLocation(receiverExpression);
          receiverType = type.getSymbol()?.getName();
        } catch {
          // TypeChecker failed, collect for CHA analysis
        }
        
        // Try direct resolution first
        const symbol = this.typeChecker.getSymbolAtLocation(expression);
        if (symbol) {
          const declarations = symbol.getDeclarations();
          if (declarations && declarations.length > 0) {
            const declaration = declarations[0];
            if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration) || Node.isArrowFunction(declaration) || Node.isFunctionExpression(declaration)) {
              const declFilePath = declaration.getSourceFile().getFilePath();
              const declStartLine = declaration.getStartLineNumber();
              
              for (const func of functions.values()) {
                if (func.filePath === declFilePath && func.startLine === declStartLine) {
                  return func.id;
                }
              }
            }
          }
        }
        
        // If direct resolution fails, collect for CHA analysis
        const fileFunctions = Array.from(functions.values()).filter(f => f.filePath === callNode.getSourceFile().getFilePath());
        const callerFunction = this.findContainingFunction(callNode, fileFunctions);
        if (callerFunction) {
          this.unresolvedMethodCalls.push({
            callerFunctionId: callerFunction.id,
            methodName,
            receiverType,
            lineNumber: callNode.getStartLineNumber(),
            columnNumber: callNode.getStart()
          });
        }
      }
      
      return undefined;
    } catch {
      // If TypeChecker fails, don't add edge (maintain precision)
      return undefined;
    }
  }

  /**
   * Find the containing function for a node
   */
  private findContainingFunction(node: Node, fileFunctions: FunctionMetadata[]): FunctionMetadata | undefined {
    let current = node.getParent();
    
    while (current) {
      if (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current) || Node.isArrowFunction(current) || Node.isFunctionExpression(current) || Node.isConstructorDeclaration(current)) {
        const startLine = current.getStartLineNumber();
        const endLine = current.getEndLineNumber();
        
        // Find matching function metadata
        return fileFunctions.find(f => 
          f.startLine === startLine && f.endLine === endLine
        );
      }
      current = current.getParent();
    }
    
    return undefined;
  }


  /**
   * Add edge to results (avoiding duplicates)
   */
  private addEdge(edge: Partial<IdealCallEdge>): void {
    // Create complete edge with required CallEdge properties
    const completeEdge: IdealCallEdge = {
      // Required CallEdge properties
      id: `edge_${this.edges.length}`,
      callerFunctionId: edge.callerFunctionId!,
      calleeFunctionId: edge.calleeFunctionId,
      calleeName: edge.calleeFunctionId || 'unknown',
      calleeSignature: '',
      callType: 'direct',
      callContext: edge.resolutionSource,
      lineNumber: edge.lineNumber || 0,
      columnNumber: edge.columnNumber || 0,
      isAsync: false,
      isChained: false,
      confidenceScore: edge.confidenceScore || 0,
      metadata: {},
      createdAt: new Date().toISOString(),
      
      // Ideal system properties
      resolutionLevel: edge.resolutionLevel!,
      resolutionSource: edge.resolutionSource || '',
      runtimeConfirmed: edge.runtimeConfirmed || false,
      candidates: edge.candidates || [],
      ...(edge.executionCount !== undefined && { executionCount: edge.executionCount }),
      analysisMetadata: edge.analysisMetadata || {
        timestamp: Date.now(),
        analysisVersion: '1.0',
        sourceHash: ''
      }
    };
    
    // Check for duplicates
    const exists = this.edges.some(existing => 
      existing.callerFunctionId === completeEdge.callerFunctionId &&
      existing.calleeFunctionId === completeEdge.calleeFunctionId
    );
    
    if (!exists) {
      this.edges.push(completeEdge);
    }
  }

  /**
   * Get all collected edges
   */
  getEdges(): IdealCallEdge[] {
    return this.edges;
  }

  /**
   * Clear collected edges and reset state
   */
  clear(): void {
    this.edges = [];
    this.unresolvedMethodCalls = [];
    this.chaAnalyzer.clear();
  }
}