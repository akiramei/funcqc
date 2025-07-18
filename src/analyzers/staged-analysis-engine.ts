import { Project, Node, TypeChecker, CallExpression, ModuleResolutionKind } from 'ts-morph';
import { IdealCallEdge, ResolutionLevel, FunctionMetadata } from './ideal-call-graph-analyzer';
import { CHAAnalyzer, UnresolvedMethodCall, MethodInfo } from './cha-analyzer';
import { RTAAnalyzer } from './rta-analyzer';
import { RuntimeTraceIntegrator } from './runtime-trace-integrator';
import * as crypto from 'crypto';
import * as ts from 'typescript';

/**
 * Staged Analysis Engine
 * 
 * Performs call graph analysis in stages with increasing sophistication:
 * 1. Local Exact - Same file calls (confidence: 1.0)
 * 2. Import Exact - Cross-file imports via TypeChecker (confidence: 0.95)
 * 3. CHA Resolved - Class Hierarchy Analysis (confidence: 0.8)
 * 4. RTA Resolved - Rapid Type Analysis (confidence: 0.9)
 * 5. Runtime Confirmed - V8 Coverage integration (confidence: 1.0)
 * 
 * Each stage only adds edges it can resolve with high confidence.
 */
export class StagedAnalysisEngine {
  private project: Project;
  private typeChecker: TypeChecker;
  private fullProject: Project | null = null; // Full project with tsconfig and libs
  private fullTypeChecker: TypeChecker | null = null;
  private edges: IdealCallEdge[] = [];
  private edgeKeys: Set<string> = new Set(); // Track unique caller->callee relationships
  private functionLookupMap: Map<string, string> = new Map(); // filePath+positionId -> funcId for O(1) lookup
  private unresolvedMethodCalls: UnresolvedMethodCall[] = [];
  private unresolvedMethodCallsForRTA: UnresolvedMethodCall[] = [];
  private chaAnalyzer: CHAAnalyzer;
  private rtaAnalyzer: RTAAnalyzer;
  private runtimeTraceIntegrator: RuntimeTraceIntegrator;
  private chaCandidates: Map<string, MethodInfo[]> = new Map();

  constructor(project: Project, typeChecker: TypeChecker) {
    this.project = project;
    this.typeChecker = typeChecker;
    this.chaAnalyzer = new CHAAnalyzer(project, typeChecker);
    this.rtaAnalyzer = new RTAAnalyzer(project, typeChecker);
    this.runtimeTraceIntegrator = new RuntimeTraceIntegrator();
    
    // Initialize full project for enhanced type resolution
    this.initializeFullProject();
  }

  /**
   * Initialize full project with tsconfig and library files for enhanced type resolution
   */
  private initializeFullProject(): void {
    try {
      // Create a full project with tsconfig.json and library files
      this.fullProject = new Project({
        tsConfigFilePath: 'tsconfig.json',
        skipAddingFilesFromTsConfig: false,
        skipLoadingLibFiles: false,
        compilerOptions: {
          // Override to ensure we get full type information
          noEmit: true,
          allowJs: true,
          checkJs: false,
          declaration: false,
          declarationMap: false,
          sourceMap: false,
          skipLibCheck: true, // Skip lib check for performance
          
          // Enable module resolution
          moduleResolution: ModuleResolutionKind.NodeJs,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          
          // Type checking options
          strict: false, // Don't fail on type errors
          noImplicitAny: false,
          strictNullChecks: false,
          strictFunctionTypes: false,
          strictBindCallApply: false,
          strictPropertyInitialization: false,
          noImplicitThis: false,
          noImplicitReturns: false,
          noUnusedLocals: false,
          noUnusedParameters: false,
        }
      });
      
      this.fullTypeChecker = this.fullProject.getTypeChecker();
      console.log('   📚 Full project initialized with tsconfig and libraries');
    } catch (error) {
      console.log(`   ⚠️  Failed to initialize full project: ${error}`);
      // Fall back to lightweight project
      this.fullProject = null;
      this.fullTypeChecker = null;
    }
  }

  /**
   * Get the appropriate TypeChecker for symbol resolution
   */
  private getTypeChecker(): TypeChecker {
    return this.fullTypeChecker || this.typeChecker;
  }

  /**
   * Get the appropriate Project for node resolution
   */
  private getProject(): Project {
    return this.fullProject || this.project;
  }

  /**
   * Build function lookup map for O(1) function resolution
   */
  private buildFunctionLookupMap(functions: Map<string, FunctionMetadata>): void {
    this.functionLookupMap.clear();
    
    for (const func of functions.values()) {
      // Add position-based lookup if available
      if (func.positionId) {
        const positionKey = `${func.filePath}:${func.positionId}`;
        this.functionLookupMap.set(positionKey, func.id);
      }
      
      // Add line-based lookup as fallback
      const lineKey = `${func.filePath}:${func.startLine}`;
      if (!this.functionLookupMap.has(lineKey)) {
        this.functionLookupMap.set(lineKey, func.id);
      }
    }
    
    console.log(`   🗺️  Built function lookup map with ${this.functionLookupMap.size} entries`);
  }

  /**
   * Fast function lookup using position or line-based keys
   */
  private fastFunctionLookup(filePath: string, positionId?: string, startLine?: number): string | undefined {
    // Try position-based lookup first (most precise)
    if (positionId) {
      const positionKey = `${filePath}:${positionId}`;
      const result = this.functionLookupMap.get(positionKey);
      if (result) return result;
    }
    
    // Fallback to line-based lookup
    if (startLine !== undefined) {
      const lineKey = `${filePath}:${startLine}`;
      return this.functionLookupMap.get(lineKey);
    }
    
    return undefined;
  }

  /**
   * Perform staged analysis with maximum precision
   */
  async performStagedAnalysis(functions: Map<string, FunctionMetadata>): Promise<IdealCallEdge[]> {
    this.edges = [];
    this.edgeKeys.clear();
    
    // Build function lookup map for O(1) function resolution
    this.buildFunctionLookupMap(functions);
    
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
    
    console.log('   🔍 Stage 5: Runtime trace integration...');
    const runtimeIntegratedEdges = await this.performRuntimeTraceIntegration(functions);
    console.log(`      Integrated ${runtimeIntegratedEdges} runtime traces`);
    
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
      // Copy unresolved method calls for RTA analysis before CHA clears them
      this.unresolvedMethodCallsForRTA = [...this.unresolvedMethodCalls];
      
      const chaEdges = await this.chaAnalyzer.performCHAAnalysis(functions, this.unresolvedMethodCalls);
      
      // Add CHA edges to our collection
      for (const edge of chaEdges) {
        this.addEdge(edge);
      }
      
      // Collect CHA candidates for RTA analysis
      this.collectCHACandidatesForRTA();
      
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
   * Collect CHA candidates for RTA analysis
   */
  private collectCHACandidatesForRTA(): void {
    // Get method candidates from CHA analyzer
    const methodIndex = this.chaAnalyzer.getMethodIndex();
    
    for (const [methodName, methodInfoSet] of methodIndex) {
      if (methodInfoSet.size > 0) {
        this.chaCandidates.set(methodName, Array.from(methodInfoSet));
      }
    }
    
    console.log(`   📋 Collected ${this.chaCandidates.size} CHA candidate groups for RTA`);
  }

  /**
   * Stage 4: RTA Analysis  
   * Rapid Type Analysis with constructor tracking
   */
  private async performRTAAnalysis(functions: Map<string, FunctionMetadata>): Promise<number> {
    if (this.chaCandidates.size === 0) {
      console.log('   ℹ️  No CHA candidates for RTA analysis');
      return 0;
    }
    
    try {
      const rtaEdges = await this.rtaAnalyzer.performRTAAnalysis(functions, this.chaCandidates, this.unresolvedMethodCallsForRTA);
      
      // Add RTA edges to our collection
      for (const edge of rtaEdges) {
        this.addEdge(edge);
      }
      
      // Clear CHA candidates and RTA data after successful RTA analysis
      this.chaCandidates.clear();
      this.unresolvedMethodCallsForRTA.length = 0;
      
      console.log(`   ✅ RTA refined ${rtaEdges.length} method calls`);
      return rtaEdges.length;
    } catch (error) {
      console.log(`   ⚠️  RTA analysis failed: ${error}`);
      return 0;
    }
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
          const type = this.getTypeChecker().getTypeAtLocation(receiverExpression);
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
   * Resolve aliased symbols (re-exports) to their original declaration
   * Handles complex re-export chains: export * from './module'
   */
  private resolveAliasedSymbol(symbol: ts.Symbol): ts.Symbol {
    let currentSymbol = symbol;
    
    // Follow the alias chain until we reach the original symbol
    while (currentSymbol.flags & ts.SymbolFlags.Alias) {
      const aliasedSymbol = this.typeChecker.compilerObject.getAliasedSymbol(currentSymbol);
      if (aliasedSymbol && aliasedSymbol !== currentSymbol) {
        currentSymbol = aliasedSymbol;
      } else {
        // Break if we can't resolve further or hit a cycle
        break;
      }
    }
    
    return currentSymbol;
  }

  /**
   * Resolve default export to actual function declaration
   * Handles: export default function, export default expr, module.exports
   */
  private resolveDefaultExport(
    defaultSymbol: ts.Symbol,
    _functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      // Get the module symbol that contains this default export
      const moduleSymbol = (defaultSymbol as ts.Symbol & { parent?: ts.Symbol }).parent;
      if (!moduleSymbol) return undefined;
      
      // Get exports of the module to find the default export
      const moduleExports = this.getTypeChecker().compilerObject.getExportsOfModule(moduleSymbol);
      if (!moduleExports) return undefined;
      
      // Find the default export symbol
      const defaultExportSymbol = moduleExports.find(exp => exp.getName() === 'default');
      if (!defaultExportSymbol) return undefined;
      
      // Get the value declaration of the default export
      const valueDeclaration = defaultExportSymbol.valueDeclaration;
      if (!valueDeclaration) return undefined;
      
      // Convert TypeScript declaration to ts-morph node
      const sourceFile = this.getProject().getSourceFile(valueDeclaration.getSourceFile().fileName);
      if (!sourceFile) return undefined;
      
      const morphDeclaration = sourceFile.getDescendantAtPos(valueDeclaration.getStart());
      if (!morphDeclaration) return undefined;
      
      // Handle different default export patterns
      let actualFunctionNode: Node | undefined;
      
      if (Node.isExportAssignment(morphDeclaration)) {
        // export = function() {} or export default function() {}
        const expression = morphDeclaration.getExpression();
        if (Node.isFunctionExpression(expression) || Node.isArrowFunction(expression)) {
          actualFunctionNode = expression;
        } else if (Node.isIdentifier(expression)) {
          // export default myFunction - resolve the identifier
          const funcSymbol = this.getTypeChecker().getSymbolAtLocation(expression);
          if (funcSymbol) {
            const funcDeclarations = funcSymbol.getDeclarations();
            if (funcDeclarations && funcDeclarations.length > 0) {
              const funcDecl = funcDeclarations[0];
              if (Node.isFunctionDeclaration(funcDecl) || Node.isArrowFunction(funcDecl)) {
                actualFunctionNode = funcDecl;
              }
            }
          }
        }
      } else if (Node.isFunctionDeclaration(morphDeclaration)) {
        // export default function myFunction() {}
        actualFunctionNode = morphDeclaration;
      } else if (Node.isVariableDeclaration(morphDeclaration)) {
        // const myFunc = () => {}; export default myFunc;
        const initializer = morphDeclaration.getInitializer();
        if (initializer && (Node.isFunctionExpression(initializer) || Node.isArrowFunction(initializer))) {
          actualFunctionNode = initializer;
        }
      }
      
      if (!actualFunctionNode) return undefined;
      
      // Find matching function in our registry using O(1) lookup
      const declFilePath = actualFunctionNode.getSourceFile().getFilePath();
      const declStartPos = actualFunctionNode.getStart();
      const declEndPos = actualFunctionNode.getEnd();
      
      // Create position ID for precise matching
      const positionId = this.generatePositionId(declFilePath, declStartPos, declEndPos);
      const declStartLine = actualFunctionNode.getStartLineNumber();
      
      // Use fast lookup instead of linear search
      const functionId = this.fastFunctionLookup(declFilePath, positionId, declStartLine);
      if (functionId) {
        return functionId;
      }
      
      return undefined;
    } catch {
      // If default export resolution fails, return undefined
      return undefined;
    }
  }
  
  /**
   * Check if identifier is from a type-only import
   * Prevents false positives in dead code detection
   */
  private isTypeOnlyImport(identifier: Node): boolean {
    // Walk up the AST to find the import declaration
    let current = identifier.getParent();
    while (current) {
      if (Node.isImportDeclaration(current)) {
        // Check if entire import is type-only
        if (current.isTypeOnly()) {
          return true;
        }
        
        // Check if specific import specifier is type-only
        const importClause = current.getImportClause();
        if (importClause) {
          const namedBindings = importClause.getNamedBindings();
          if (namedBindings && Node.isNamedImports(namedBindings)) {
            const elements = namedBindings.getElements();
            for (const element of elements) {
              if (element.getName() === identifier.getText() && element.isTypeOnly()) {
                return true;
              }
            }
          }
        }
        break;
      }
      current = current.getParent();
    }
    
    return false;
  }
  
  /**
   * Generate position-based ID for precise function identification
   * Uses character offset for maximum accuracy regardless of formatting changes
   */
  private generatePositionId(filePath: string, startPos: number, endPos: number): string {
    return crypto.createHash('sha256')
      .update(`${filePath}:${startPos}-${endPos}`)
      .digest('hex')
      .slice(0, 16); // Shorter hash for position-based IDs
  }

  /**
   * Resolve cross-file import calls using TypeChecker with re-export and default export support
   */
  private resolveImportCall(
    callNode: CallExpression,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      const expression = callNode.getExpression();
      
      if (Node.isIdentifier(expression)) {
        // Check if this is a type-only import (skip for call graph analysis)
        if (this.isTypeOnlyImport(expression)) {
          return undefined;
        }
        
        // Get symbol from TypeChecker (use full TypeChecker for better resolution)
        const symbol = this.getTypeChecker().getSymbolAtLocation(expression);
        if (!symbol) return undefined;
        
        // Resolve re-exported symbols to their original declaration
        const resolvedSymbol = this.resolveAliasedSymbol(symbol.compilerSymbol);
        
        // Handle default exports - check if symbol name is "default"
        if (resolvedSymbol.getName() === 'default') {
          return this.resolveDefaultExport(resolvedSymbol, functions);
        }
        
        // Get the declaration from the resolved symbol
        const declarations = resolvedSymbol.getDeclarations();
        if (!declarations || declarations.length === 0) return undefined;
        
        const tsDeclaration = declarations[0];
        
        // Convert TypeScript declaration to ts-morph node for validation
        const sourceFile = this.getProject().getSourceFile(tsDeclaration.getSourceFile().fileName);
        if (!sourceFile) return undefined;
        
        const morphDeclaration = sourceFile.getDescendantAtPos(tsDeclaration.getStart());
        if (!morphDeclaration) return undefined;
        
        // Validate it's a function-like declaration
        if (!Node.isFunctionDeclaration(morphDeclaration) && 
            !Node.isMethodDeclaration(morphDeclaration) && 
            !Node.isArrowFunction(morphDeclaration) && 
            !Node.isFunctionExpression(morphDeclaration)) {
          return undefined;
        }
        
        // Find matching function in our registry using O(1) lookup
        const declFilePath = morphDeclaration.getSourceFile().getFilePath();
        const declStartPos = morphDeclaration.getStart();
        const declEndPos = morphDeclaration.getEnd();
        
        // Create position ID for precise matching
        const positionId = this.generatePositionId(declFilePath, declStartPos, declEndPos);
        const declStartLine = morphDeclaration.getStartLineNumber();
        
        // Use fast lookup instead of linear search
        const functionId = this.fastFunctionLookup(declFilePath, positionId, declStartLine);
        if (functionId) {
          return functionId;
        }
      }
      
      if (Node.isPropertyAccessExpression(expression)) {
        // Method call through import: importedObj.method()
        const methodName = expression.getName();
        const receiverExpression = expression.getExpression();
        
        // Try to resolve receiver type
        let receiverType: string | undefined;
        try {
          const type = this.getTypeChecker().getTypeAtLocation(receiverExpression);
          receiverType = type.getSymbol()?.getName();
        } catch {
          // TypeChecker failed, collect for CHA analysis
        }
        
        // Try direct resolution first with re-export support
        const symbol = this.getTypeChecker().getSymbolAtLocation(expression);
        if (symbol) {
          // Resolve re-exported symbols to their original declaration
          const resolvedSymbol = this.resolveAliasedSymbol(symbol.compilerSymbol);
          
          // Handle default exports in property access (e.g., defaultExport.method())
          if (resolvedSymbol.getName() === 'default') {
            return this.resolveDefaultExport(resolvedSymbol, functions);
          }
          
          const declarations = resolvedSymbol.getDeclarations();
          if (declarations && declarations.length > 0) {
            const tsDeclaration = declarations[0];
            
            // Convert TypeScript declaration to ts-morph node for validation
            const sourceFile = this.getProject().getSourceFile(tsDeclaration.getSourceFile().fileName);
            if (sourceFile) {
              const morphDeclaration = sourceFile.getDescendantAtPos(tsDeclaration.getStart());
              if (morphDeclaration && (Node.isFunctionDeclaration(morphDeclaration) || 
                                     Node.isMethodDeclaration(morphDeclaration) || 
                                     Node.isArrowFunction(morphDeclaration) || 
                                     Node.isFunctionExpression(morphDeclaration))) {
                const declFilePath = morphDeclaration.getSourceFile().getFilePath();
                const declStartPos = morphDeclaration.getStart();
                const declEndPos = morphDeclaration.getEnd();
                
                // Create position ID for precise matching
                const positionId = this.generatePositionId(declFilePath, declStartPos, declEndPos);
                const declStartLine = morphDeclaration.getStartLineNumber();
                
                // Use fast lookup instead of linear search
                const functionId = this.fastFunctionLookup(declFilePath, positionId, declStartLine);
                if (functionId) {
                  return functionId;
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
   * Stage 5: Runtime Trace Integration
   * Integrate V8 coverage data and execution traces
   */
  private async performRuntimeTraceIntegration(functions: Map<string, FunctionMetadata>): Promise<number> {
    try {
      // Integrate runtime traces
      const integratedEdges = await this.runtimeTraceIntegrator.integrateTraces(this.edges, functions);
      
      // Update edges with integrated data
      this.edges = integratedEdges;
      
      // Count how many edges were actually enhanced with runtime data
      const enhancedEdges = integratedEdges.filter(edge => edge.runtimeConfirmed).length;
      
      // Get coverage statistics
      const coverageStats = this.runtimeTraceIntegrator.getCoverageStats();
      if (coverageStats.totalCoveredFunctions > 0) {
        console.log(`   📊 Coverage: ${coverageStats.totalCoveredFunctions} functions, ${coverageStats.totalExecutions} executions`);
      }
      
      return enhancedEdges;
    } catch (error) {
      console.log(`   ⚠️  Runtime trace integration failed: ${error}`);
      return 0;
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
    // Check for duplicates using caller->callee key
    const edgeKey = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
    if (this.edgeKeys.has(edgeKey)) {
      return; // Skip duplicate edge
    }
    this.edgeKeys.add(edgeKey);
    
    // Generate stable edge ID based on caller->callee relationship
    const edgeId = this.generateStableEdgeId(edge.callerFunctionId!, edge.calleeFunctionId!);
    
    // Create complete edge with required CallEdge properties
    const completeEdge: IdealCallEdge = {
      // Required CallEdge properties
      id: edgeId,
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
    
    // Check for duplicates using stable ID
    const exists = this.edges.some(existing => existing.id === edgeId);
    
    if (!exists) {
      this.edges.push(completeEdge);
    }
  }

  /**
   * Generate stable edge ID based on caller->callee relationship
   */
  private generateStableEdgeId(callerFunctionId: string, calleeFunctionId: string): string {
    const edgeKey = `${callerFunctionId}->${calleeFunctionId}`;
    const hash = crypto.createHash('md5').update(edgeKey).digest('hex');
    return `edge_${hash.substring(0, 8)}`;
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
    this.edgeKeys.clear();
    this.functionLookupMap.clear();
    this.unresolvedMethodCalls = [];
    this.unresolvedMethodCallsForRTA = [];
    this.chaCandidates.clear();
    this.chaAnalyzer.clear();
    this.rtaAnalyzer.clear();
    this.runtimeTraceIntegrator.clear();
    
    // Clean up full project resources
    if (this.fullProject) {
      this.fullProject.saveSync();
      this.fullProject = null;
      this.fullTypeChecker = null;
    }
  }
}