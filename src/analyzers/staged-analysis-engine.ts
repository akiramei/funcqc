import { Project, Node, TypeChecker, CallExpression, NewExpression, SourceFile, Symbol as TsMorphSymbol, ImportDeclaration, ModuleResolutionKind, ClassDeclaration, MethodDeclaration, PropertyAccessExpression } from 'ts-morph';
import { IdealCallEdge, ResolutionLevel, FunctionMetadata } from './ideal-call-graph-analyzer';
import { CHAAnalyzer, UnresolvedMethodCall, MethodInfo } from './cha-analyzer';
import { RTAAnalyzer } from './rta-analyzer';
import { RuntimeTraceIntegrator } from './runtime-trace-integrator';
import { SymbolCache } from '../utils/symbol-cache';
import { generateStableEdgeId } from '../utils/edge-id-generator';
import { PathNormalizer } from '../utils/path-normalizer';
import * as crypto from 'crypto';
import * as ts from 'typescript';
import * as path from 'path';

/**
 * Confidence scores for different resolution levels
 */
const CONFIDENCE_SCORES = {
  // Perfect confidence - same file, definite resolution
  LOCAL_EXACT: 1.0,
  LOCAL_EXACT_OPTIONAL: 0.95,
  
  // High confidence - TypeChecker verified imports
  IMPORT_EXACT: 0.95,
  IMPORT_EXACT_OPTIONAL: 0.90,
  
  // Medium confidence - CHA analysis
  CHA_BASE: 0.8,
  CHA_ABSTRACT_BONUS: 0.1,
  CHA_CLASS_BONUS: 0.05,
  
  // High confidence - RTA analysis with instance filtering
  RTA_BASE: 0.9,
  
  // Perfect confidence - Runtime verified
  RUNTIME_CONFIRMED: 1.0,
  
  // Optional call penalties
  OPTIONAL_LOCAL_PENALTY: 0.05,  // 1.0 -> 0.95
  OPTIONAL_IMPORT_PENALTY: 0.05, // 0.95 -> 0.90
  OPTIONAL_GENERIC_PENALTY: 0.10 // 0.95 -> 0.85
} as const;

/**
 * Node.js built-in modules that should be excluded from analysis
 */
const NODE_BUILTIN_MODULES = new Set<string>([
  'crypto', 'fs', 'path', 'os', 'util', 'http', 'https', 'url', 'querystring',
  'stream', 'buffer', 'events', 'child_process', 'cluster', 'dgram', 'dns',
  'net', 'tls', 'readline', 'repl', 'string_decoder', 'timers', 'tty',
  'vm', 'zlib', 'assert', 'constants', 'module', 'process', 'v8',
  'worker_threads', 'perf_hooks', 'async_hooks', 'inspector', 'punycode'
]);

/**
 * Resolution levels for type safety and consistency
 */
const RESOLUTION_LEVELS = {
  LOCAL_EXACT: 'local_exact',
  IMPORT_EXACT: 'import_exact', 
  CHA_RESOLVED: 'cha_resolved',
  RTA_RESOLVED: 'rta_resolved',
  RUNTIME_CONFIRMED: 'runtime_confirmed'
} as const;

/**
 * Resolution sources for detailed tracking
 */
const RESOLUTION_SOURCES = {
  LOCAL_EXACT: 'local_exact',
  LOCAL_EXACT_OPTIONAL: 'local_exact_optional',
  TYPECHECKER_IMPORT: 'typechecker_import',
  TYPECHECKER_IMPORT_OPTIONAL: 'typechecker_import_optional',
  CHA_ANALYSIS: 'cha_analysis',
  RTA_ANALYSIS: 'rta_analysis',
  RUNTIME_VERIFIED: 'runtime_verified'
} as const;

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
  private edgeIndex: Map<string, IdealCallEdge> = new Map(); // caller->callee key to edge mapping
  private functionLookupMap: Map<string, string> = new Map(); // filePath+positionId -> funcId for O(1) lookup
  private unresolvedMethodCalls: UnresolvedMethodCall[] = [];
  private unresolvedMethodCallsForRTA: UnresolvedMethodCall[] = [];
  private chaAnalyzer: CHAAnalyzer;
  private rtaAnalyzer: RTAAnalyzer;
  private runtimeTraceIntegrator: RuntimeTraceIntegrator;
  private chaCandidates: Map<string, MethodInfo[]> = new Map();
  private symbolCache: SymbolCache;
  private fullSymbolCache: SymbolCache | null = null;

  constructor(project: Project, typeChecker: TypeChecker) {
    this.project = project;
    this.typeChecker = typeChecker;
    this.symbolCache = new SymbolCache(typeChecker);
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
      this.fullSymbolCache = new SymbolCache(this.fullTypeChecker);
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
   * Get symbol at location with caching
   */
  private getCachedSymbolAtLocation(node: Node): TsMorphSymbol | undefined {
    const cache = this.fullSymbolCache || this.symbolCache;
    return cache.getSymbolAtLocation(node);
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
    this.edgeIndex.clear();
    
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
    
    // Log symbol cache statistics
    this.logCacheStatistics();
    
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
      const fileFunctions = PathNormalizer.filterByPath(Array.from(functions.values()), filePath);
      
      if (fileFunctions.length === 0) continue;
      
      // Create lookup maps for functions in this file
      // Use arrays to handle multiple functions with the same name
      const functionByName = new Map<string, FunctionMetadata[]>();
      const functionByLexicalPath = new Map<string, FunctionMetadata>();
      
      for (const func of fileFunctions) {
        // Array-based storage for same-name functions
        const existing = functionByName.get(func.name) || [];
        existing.push(func);
        functionByName.set(func.name, existing);
        
        // Lexical path should be unique
        functionByLexicalPath.set(func.lexicalPath, func);
      }
      
      // Analyze all call expressions in this file
      sourceFile.forEachDescendant(node => {
        if (Node.isCallExpression(node)) {
          const callerFunction = this.findContainingFunction(node, fileFunctions);
          if (!callerFunction) return;
          
          // Check if this is an optional call expression
          const isOptional = this.isOptionalCallExpression(node);
          
          const calleeId = this.resolveLocalCall(node, functionByName, functionByLexicalPath, functions);
          if (calleeId) {
            const calleeFunction = functions.get(calleeId);
            this.addEdge({
              callerFunctionId: callerFunction.id,
              calleeFunctionId: calleeId,
              calleeName: calleeFunction?.name || 'unknown',
              candidates: [calleeId],
              // Reduce confidence slightly for optional calls due to runtime uncertainty
              confidenceScore: isOptional ? CONFIDENCE_SCORES.LOCAL_EXACT_OPTIONAL : CONFIDENCE_SCORES.LOCAL_EXACT,
              resolutionLevel: RESOLUTION_LEVELS.LOCAL_EXACT as ResolutionLevel,
              resolutionSource: isOptional ? RESOLUTION_SOURCES.LOCAL_EXACT_OPTIONAL : RESOLUTION_SOURCES.LOCAL_EXACT,
              runtimeConfirmed: false,
              lineNumber: node.getStartLineNumber(),
              columnNumber: node.getStart() - node.getStartLinePos(),
              metadata: isOptional ? { optionalChaining: true } : {},
              analysisMetadata: {
                timestamp: Date.now(),
                analysisVersion: '1.0',
                sourceHash: sourceFile.getFilePath()
              }
            });
          } else if (isOptional) {
            // For optional calls that can't be resolved locally, try optional resolution
            const optionalCalleeId = this.resolveOptionalCall(node, functions);
            if (optionalCalleeId) {
              const calleeFunction = functions.get(optionalCalleeId);
              this.addEdge({
                callerFunctionId: callerFunction.id,
                calleeFunctionId: optionalCalleeId,
                calleeName: calleeFunction?.name || 'unknown',
                candidates: [optionalCalleeId],
                confidenceScore: 0.85, // Lower confidence for optional calls
                resolutionLevel: 'local_exact' as ResolutionLevel,
                resolutionSource: 'local_exact_optional',
                runtimeConfirmed: false,
                lineNumber: node.getStartLineNumber(),
                columnNumber: node.getStart() - node.getStartLinePos(),
                metadata: { optionalChaining: true },
                analysisMetadata: {
                  timestamp: Date.now(),
                  analysisVersion: '1.0',
                  sourceHash: sourceFile.getFilePath()
                }
              });
            }
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
    const sourceFiles = this.getProject().getSourceFiles();
    
    for (const sourceFile of sourceFiles) {
      const filePath = sourceFile.getFilePath();
      const fileFunctions = PathNormalizer.filterByPath(Array.from(functions.values()), filePath);
      
      if (fileFunctions.length === 0) continue;
      
      sourceFile.forEachDescendant(node => {
        if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
          const callerFunction = this.findContainingFunction(node, fileFunctions);
          if (!callerFunction) return;
          
          // Check if this is an optional call expression
          const isOptional = Node.isCallExpression(node) ? this.isOptionalCallExpression(node) : false;
          
          const calleeId = Node.isCallExpression(node) 
            ? this.resolveImportCall(node, functions)
            : this.resolveNewExpression(node, functions);
          if (calleeId) {
            const calleeFunction = functions.get(calleeId);
            this.addEdge({
              callerFunctionId: callerFunction.id,
              calleeFunctionId: calleeId,
              calleeName: calleeFunction?.name || 'unknown',
              candidates: [calleeId],
              // Reduce confidence slightly for optional calls
              confidenceScore: isOptional ? CONFIDENCE_SCORES.IMPORT_EXACT_OPTIONAL : CONFIDENCE_SCORES.IMPORT_EXACT,
              resolutionLevel: RESOLUTION_LEVELS.IMPORT_EXACT as ResolutionLevel,
              resolutionSource: isOptional ? RESOLUTION_SOURCES.TYPECHECKER_IMPORT_OPTIONAL : RESOLUTION_SOURCES.TYPECHECKER_IMPORT,
              runtimeConfirmed: false,
              lineNumber: node.getStartLineNumber(),
              columnNumber: node.getStart() - node.getStartLinePos(),
              metadata: isOptional ? { optionalChaining: true } : {},
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
    functionByName: Map<string, FunctionMetadata[]>,
    _functionByLexicalPath: Map<string, FunctionMetadata>,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    const expression = callNode.getExpression();
    
    if (Node.isIdentifier(expression)) {
      // Direct function call: foo()
      const name = expression.getText();
      const candidates = functionByName.get(name);
      if (candidates && candidates.length > 0) {
        // If multiple candidates, use the most appropriate one
        const bestCandidate = this.selectBestFunctionCandidate(callNode, candidates);
        return bestCandidate?.id;
      }
      return undefined;
    }
    
    if (Node.isPropertyAccessExpression(expression)) {
      // Method call: obj.method()
      const methodName = expression.getName();
      const receiverExpression = expression.getExpression();
      
      // Check for this/super calls first
      const thisSuperId = this.resolveThisSuperCall(callNode, receiverExpression, methodName, functionByName, functions);
      if (thisSuperId) {
        return thisSuperId;
      }
      
      // Check for static method calls: ClassName.staticMethod()
      const staticMethodId = this.resolveStaticMethodCall(callNode, receiverExpression, methodName, functionByName);
      if (staticMethodId) {
        return staticMethodId;
      }
      
      // Try to find exact match first
      const candidates = functionByName.get(methodName);
      if (candidates && candidates.length > 0) {
        const bestCandidate = this.selectBestFunctionCandidate(callNode, candidates);
        if (bestCandidate) {
          return bestCandidate.id;
        }
      }
      
      // If not found locally, collect for CHA analysis
      // We need to find the caller using the file functions
      const fileFunctions = Array.from(functionByName.values()).flat();
      const callerFunction = this.findContainingFunction(callNode, fileFunctions);
      if (callerFunction) {
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
   * Resolve this/super method calls within class context
   * Handles: this.method(), super.method()
   */
  private resolveThisSuperCall(
    callNode: CallExpression,
    receiverExpression: Node,
    methodName: string,
    functionByName: Map<string, FunctionMetadata[]>,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      // Check if this is a this/super call
      if (Node.isThisExpression(receiverExpression)) {
        return this.resolveThisCall(callNode, methodName, functionByName, functions);
      }
      
      if (Node.isSuperExpression(receiverExpression)) {
        return this.resolveSuperCall(callNode, methodName, functionByName, functions);
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve this.method() calls
   */
  private resolveThisCall(
    callNode: CallExpression,
    methodName: string,
    functionByName: Map<string, FunctionMetadata[]>,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      // Find the containing class for this call
      const containingClass = this.findContainingClass(callNode);
      if (!containingClass) {
        return undefined;
      }
      
      const className = containingClass.getName();
      if (!className) {
        return undefined;
      }
      
      // Strategy 1: Look for method in the same class
      const directMethod = this.findMethodInClass(containingClass, methodName);
      if (directMethod) {
        // Search for matching function using array-based lookup
        const candidates = functionByName.get(methodName) || [];
        const methodCandidate = candidates.find(func => 
          func.className === className &&
          Math.abs(func.startLine - directMethod.getStartLineNumber()) <= 2
        );
        if (methodCandidate) {
          return methodCandidate.id;
        }
      }
      
      // Strategy 2: Use TypeChecker to resolve this context
      const thisType = this.getTypeChecker().getTypeAtLocation(callNode.getExpression());
      const symbol = thisType.getSymbol();
      if (symbol) {
        const resolvedSymbol = this.resolveAliasedSymbol(symbol.compilerSymbol);
        return this.resolveFunctionFromSymbol(resolvedSymbol, functions);
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve super.method() calls
   */
  private resolveSuperCall(
    callNode: CallExpression,
    methodName: string,
    functionByName: Map<string, FunctionMetadata[]>,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      // Find the containing class for this call
      const containingClass = this.findContainingClass(callNode);
      if (!containingClass) {
        return undefined;
      }
      
      // Get the parent class from extends clause
      const extendsClause = containingClass.getExtends();
      if (!extendsClause) {
        return undefined;
      }
      
      const parentClassName = extendsClause.getExpression().getText();
      
      // Strategy 1: Find parent class in the same file
      const sourceFile = callNode.getSourceFile();
      const parentClass = sourceFile.getClass(parentClassName);
      if (parentClass) {
        const parentMethod = this.findMethodInClass(parentClass, methodName);
        if (parentMethod) {
          // Search for matching function using array-based lookup
          const candidates = functionByName.get(methodName) || [];
          const methodCandidate = candidates.find(func => 
            func.className === parentClassName &&
            Math.abs(func.startLine - parentMethod.getStartLineNumber()) <= 2
          );
          if (methodCandidate) {
            return methodCandidate.id;
          }
        }
      }
      
      // Strategy 2: Use TypeChecker to resolve super context
      try {
        const superExpression = callNode.getExpression() as PropertyAccessExpression;
        const superType = this.getTypeChecker().getTypeAtLocation(superExpression.getExpression());
        const symbol = superType.getSymbol();
        if (symbol) {
          const resolvedSymbol = this.resolveAliasedSymbol(symbol.compilerSymbol);
          return this.resolveFunctionFromSymbol(resolvedSymbol, functions);
        }
      } catch {
        // Continue to next strategy
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find containing class for a given node
   */
  private findContainingClass(node: Node): ClassDeclaration | undefined {
    let current = node.getParent();
    while (current) {
      if (Node.isClassDeclaration(current)) {
        return current;
      }
      current = current.getParent();
    }
    return undefined;
  }

  /**
   * Find method in a class declaration
   */
  private findMethodInClass(classDecl: ClassDeclaration, methodName: string): MethodDeclaration | undefined {
    const methods = classDecl.getMethods();
    return methods.find(method => method.getName() === methodName);
  }

  /**
   * Build method ID in format: filePath#ClassName.methodName
   * NOTE: Currently unused but kept for potential future use
   */
  // @ts-expect-error TS6133
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private buildMethodId(method: MethodDeclaration, className: string, functions: Map<string, FunctionMetadata>): string | undefined {
    const filePath = method.getSourceFile().getFilePath();
    const startLine = method.getStartLineNumber();
    const methodName = method.getName();
    
    // Strategy 1: Fast lookup using position or line
    const positionId = method.getStart().toString();
    const functionId = this.fastFunctionLookup(filePath, positionId, startLine);
    if (functionId) {
      return functionId;
    }
    
    // Strategy 2: Search through functions map for exact match
    for (const [id, func] of functions) {
      if (PathNormalizer.areEqual(func.filePath, filePath) &&
          func.startLine === startLine &&
          func.name === methodName &&
          func.className === className) {
        return id;
      }
    }
    
    // Strategy 3: Match by lexical path (less precise)
    const relativePath = this.getRelativePath(filePath);
    const expectedLexicalPath = `${relativePath}#${className}.${methodName}`;
    
    for (const [id, func] of functions) {
      if (func.lexicalPath === expectedLexicalPath &&
          Math.abs(func.startLine - startLine) <= 2) {
        return id;
      }
    }
    
    // If no match found, warn and return undefined
    console.warn(`buildMethodId: Could not find function ID for method ${className}.${methodName} at ${filePath}:${startLine}`);
    return undefined;
  }

  /**
   * Check if method exists in function registry
   * NOTE: Currently unused but kept for potential future use
   */
  // @ts-expect-error TS6133
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private isMethodInFunctionRegistry(methodId: string | undefined, functionByName: Map<string, FunctionMetadata[]>): boolean {
    if (!methodId) {
      return false;
    }
    
    // Check if any function in registry matches this method ID
    for (const [, functions] of functionByName) {
      if (functions.some(func => func.id === methodId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get relative path for building method IDs
   */
  private getRelativePath(filePath: string): string {
    try {
      const cwd = process.cwd();
      return path.relative(cwd, filePath);
    } catch {
      return path.basename(filePath);
    }
  }

  /**
   * Extract class name and namespace from receiver expression
   * Supports: ClassName and Namespace.ClassName patterns
   */
  private extractClassNameFromReceiver(receiverExpression: Node): { className: string; namespace?: string } | undefined {
    if (Node.isIdentifier(receiverExpression)) {
      // Simple case: ClassName.staticMethod()
      return {
        className: receiverExpression.getText()
      };
    }
    
    if (Node.isPropertyAccessExpression(receiverExpression)) {
      // Namespace case: Namespace.ClassName.staticMethod()
      // The receiverExpression is Namespace.ClassName
      const rightSide = receiverExpression.getName(); // ClassName
      const leftSide = receiverExpression.getExpression(); // Namespace
      
      if (Node.isIdentifier(leftSide)) {
        return {
          className: rightSide,
          namespace: leftSide.getText()
        };
      }
    }
    
    return undefined;
  }

  /**
   * Resolve static method calls: ClassName.staticMethod() and Namespace.ClassName.staticMethod()
   */
  private resolveStaticMethodCall(
    callNode: CallExpression,
    receiverExpression: Node,
    methodName: string,
    functionByName: Map<string, FunctionMetadata[]>
  ): string | undefined {
    try {
      // Extract class name from receiver expression
      const classNameInfo = this.extractClassNameFromReceiver(receiverExpression);
      if (!classNameInfo) {
        return undefined;
      }
      
      const { className, namespace } = classNameInfo;
      
      // Strategy 1: Look for class in the same file (with inheritance chain search)
      const sourceFile = callNode.getSourceFile();
      const classDeclaration = sourceFile.getClass(className);
      if (classDeclaration) {
        const staticMethodResult = this.findStaticMethodInClassWithInheritance(classDeclaration, methodName, functionByName);
        if (staticMethodResult) {
          return staticMethodResult;
        }
      }
      
      // Strategy 2: Use TypeChecker to resolve class symbol
      if (namespace) {
        // Handle namespaced class: Namespace.ClassName.staticMethod()
        const namespacedClassResult = this.resolveNamespacedClass(callNode, namespace, className, methodName, functionByName);
        if (namespacedClassResult) {
          return namespacedClassResult;
        }
      } else {
        // Handle direct class reference: ClassName.staticMethod()
        const classSymbol = this.getCachedSymbolAtLocation(receiverExpression);
        if (classSymbol) {
          // Check if this is a class symbol
          if (classSymbol.compilerSymbol.flags & ts.SymbolFlags.Class) {
            const resolvedSymbol = this.resolveAliasedSymbol(classSymbol.compilerSymbol);
            return this.resolveStaticMethodFromSymbol(resolvedSymbol, methodName, functionByName);
          }
        }
      }
      
      // Strategy 3: Cross-file static method resolution using import analysis
      const importedStaticMethod = this.resolveImportedStaticMethod(receiverExpression, methodName, functionByName);
      if (importedStaticMethod) {
        return importedStaticMethod;
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve namespaced class static methods: Namespace.ClassName.staticMethod()
   */
  private resolveNamespacedClass(
    callNode: CallExpression,
    namespace: string,
    className: string,
    methodName: string,
    functionByName: Map<string, FunctionMetadata[]>
  ): string | undefined {
    try {
      const sourceFile = callNode.getSourceFile();
      
      // Primary strategy: Resolve via module/import analysis (import * as Namespace)
      const moduleNamespaceResult = this.resolveModuleNamespacedClass(sourceFile, namespace, className, methodName, functionByName);
      if (moduleNamespaceResult) {
        return moduleNamespaceResult;
      }
      
      // Secondary strategy: Use TypeChecker to resolve namespace.class via PropertyAccessExpression
      // This handles cases where the namespace might be resolved at the receiver level
      const fullQualifiedName = `${namespace}.${className}`;
      try {
        // Try to find a class that matches the full qualified name pattern
        const candidates = functionByName.get(methodName) || [];
        for (const functionMetadata of candidates) {
          if (functionMetadata.className === className && functionMetadata.name === methodName && functionMetadata.isMethod) {
            // Check if this function's class path matches our namespace pattern
            if (functionMetadata.lexicalPath.includes(fullQualifiedName) || 
                functionMetadata.filePath.includes(namespace)) {
              return functionMetadata.id;
            }
          }
        }
      } catch {
        // Continue if this approach fails
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }


  /**
   * Resolve module-based namespaced class (import * as Namespace)
   */
  private resolveModuleNamespacedClass(
    sourceFile: SourceFile,
    namespace: string,
    className: string,
    methodName: string,
    functionByName: Map<string, FunctionMetadata[]>
  ): string | undefined {
    try {
      // Look for namespace import: import * as Namespace from './module'
      const namespaceImportDecl = this.findNamespaceImportDeclaration(sourceFile, namespace);
      if (!namespaceImportDecl) {
        return undefined;
      }
      
      // Use existing namespace import resolution logic but for class static methods
      const moduleSpecifier = namespaceImportDecl.getModuleSpecifier();
      if (!moduleSpecifier || !Node.isStringLiteral(moduleSpecifier)) {
        return undefined;
      }
      
      // Try to resolve the class symbol from the imported module
      const namespaceSymbol = this.getCachedSymbolAtLocation(sourceFile.getVariableDeclaration(namespace)?.getNameNode() || sourceFile);
      if (namespaceSymbol) {
        const moduleExports = this.typeChecker.compilerObject.getExportsOfModule(namespaceSymbol.compilerSymbol);
        const classSymbol = moduleExports.find(exp => exp.getName() === className);
        
        if (classSymbol && classSymbol.flags & ts.SymbolFlags.Class) {
          const resolvedSymbol = this.resolveAliasedSymbol(classSymbol);
          return this.resolveStaticMethodFromSymbol(resolvedSymbol, methodName, functionByName);
        }
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find static method in a class declaration with inheritance chain search
   */
  private findStaticMethodInClassWithInheritance(
    classDecl: ClassDeclaration, 
    methodName: string, 
    functionByName: Map<string, FunctionMetadata[]>,
    visited = new Set<string>()
  ): string | undefined {
    const className = classDecl.getName();
    if (!className || visited.has(className)) {
      return undefined;
    }
    visited.add(className);
    
    // Check static method in current class
    const staticMethod = this.findStaticMethodInClass(classDecl, methodName);
    if (staticMethod) {
      // Search for matching function using array-based lookup
      const candidates = functionByName.get(methodName) || [];
      const methodCandidate = candidates.find(func => 
        func.className === className &&
        func.isStatic === true &&
        Math.abs(func.startLine - staticMethod.getStartLineNumber()) <= 2
      );
      if (methodCandidate) {
        return methodCandidate.id;
      }
    }
    
    // Search in parent class (inheritance chain)
    const extendsClause = classDecl.getExtends();
    if (extendsClause) {
      const parentClassName = extendsClause.getExpression().getText();
      
      // Look for parent class in the same file
      const sourceFile = classDecl.getSourceFile();
      const parentClass = sourceFile.getClass(parentClassName);
      if (parentClass) {
        const parentResult = this.findStaticMethodInClassWithInheritance(parentClass, methodName, functionByName, visited);
        if (parentResult) {
          return parentResult;
        }
      }
      
      // Use TypeChecker to resolve parent class across files
      try {
        const parentSymbol = this.getCachedSymbolAtLocation(extendsClause.getExpression());
        if (parentSymbol && parentSymbol.compilerSymbol.flags & ts.SymbolFlags.Class) {
          const resolvedParentSymbol = this.resolveAliasedSymbol(parentSymbol.compilerSymbol);
          const parentStaticMethod = this.resolveStaticMethodFromSymbol(resolvedParentSymbol, methodName, functionByName);
          if (parentStaticMethod) {
            return parentStaticMethod;
          }
        }
      } catch {
        // Continue if TypeChecker resolution fails
      }
    }
    
    return undefined;
  }

  /**
   * Find static method in a class declaration
   */
  private findStaticMethodInClass(classDecl: ClassDeclaration, methodName: string): MethodDeclaration | undefined {
    const methods = classDecl.getMethods();
    return methods.find(method => method.getName() === methodName && method.isStatic());
  }

  /**
   * Resolve static method from TypeScript symbol with inheritance chain search
   */
  private resolveStaticMethodFromSymbol(
    classSymbol: ts.Symbol,
    methodName: string,
    functionByName: Map<string, FunctionMetadata[]>,
    visited = new Set<string>()
  ): string | undefined {
    try {
      const symbolName = classSymbol.getName();
      if (visited.has(symbolName)) {
        return undefined;
      }
      visited.add(symbolName);
      
      // Get static members of the class
      const staticType = this.typeChecker.compilerObject.getTypeOfSymbolAtLocation(classSymbol, classSymbol.valueDeclaration!);
      const staticProperties = this.typeChecker.compilerObject.getPropertiesOfType(staticType);
      
      // Find the static method in current class
      const staticMethodSymbol = staticProperties.find(prop => prop.getName() === methodName);
      if (staticMethodSymbol) {
        // Check if it's a method (function)
        const methodType = this.typeChecker.compilerObject.getTypeOfSymbolAtLocation(staticMethodSymbol, staticMethodSymbol.valueDeclaration!);
        if (methodType.getCallSignatures().length > 0) {
          // Search for matching function using array-based lookup
          const candidates = functionByName.get(methodName) || [];
          const methodCandidate = candidates.find(func => 
            func.className === classSymbol.getName() &&
            func.isStatic === true &&
            func.name === methodName
          );
          if (methodCandidate) {
            return methodCandidate.id;
          }
        }
      }
      
      // Search in base classes (inheritance chain)
      const classType = this.typeChecker.compilerObject.getTypeOfSymbolAtLocation(classSymbol, classSymbol.valueDeclaration!);
      const baseTypes = this.typeChecker.compilerObject.getBaseTypes(classType as ts.InterfaceType);
      
      for (const baseType of baseTypes) {
        const baseSymbol = baseType.getSymbol();
        if (baseSymbol && baseSymbol.flags & ts.SymbolFlags.Class) {
          const baseResult = this.resolveStaticMethodFromSymbol(baseSymbol, methodName, functionByName, visited);
          if (baseResult) {
            return baseResult;
          }
        }
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve imported static method calls
   * Handles: import { MyClass } from './module'; MyClass.staticMethod()
   */
  private resolveImportedStaticMethod(
    classIdentifier: Node,
    methodName: string,
    functionByName: Map<string, FunctionMetadata[]>
  ): string | undefined {
    try {
      const className = classIdentifier.getText();
      const sourceFile = classIdentifier.getSourceFile();
      
      // Find import declaration for this class
      const importDecl = this.findClassImportDeclaration(sourceFile, className);
      if (!importDecl) {
        return undefined;
      }
      
      // Use TypeChecker to resolve the imported class symbol
      const classSymbol = this.getCachedSymbolAtLocation(classIdentifier);
      if (classSymbol) {
        const resolvedSymbol = this.resolveAliasedSymbol(classSymbol.compilerSymbol);
        return this.resolveStaticMethodFromSymbol(resolvedSymbol, methodName, functionByName);
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find import declaration for a class name
   */
  private findClassImportDeclaration(sourceFile: SourceFile, className: string): ImportDeclaration | undefined {
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const importClause = importDecl.getImportClause();
      if (!importClause) continue;
      
      // Check named imports
      const namedBindings = importClause.getNamedBindings();
      if (namedBindings && Node.isNamedImports(namedBindings)) {
        const namedImports = namedBindings.getElements();
        for (const namedImport of namedImports) {
          if (namedImport.getName() === className) {
            return importDecl;
          }
        }
      }
      
      // Check default import
      const defaultImport = importClause.getDefaultImport();
      if (defaultImport && defaultImport.getText() === className) {
        return importDecl;
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
          const funcSymbol = this.getCachedSymbolAtLocation(expression);
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
   * Resolve namespace import calls: import * as ns; ns.functionName()
   * Handles the complete namespace resolution process with import statement analysis
   */
  private resolveNamespaceImport(
    receiverExpression: Node,
    methodName: string,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      // Check if receiver is an identifier (namespace)
      if (!Node.isIdentifier(receiverExpression)) {
        return undefined;
      }
      
      const namespaceName = receiverExpression.getText();
      
      // Skip external modules that are not in our function registry
      if (NODE_BUILTIN_MODULES.has(namespaceName)) {
        return undefined;
      }
      
      // Get the namespace symbol
      const namespaceSymbol = this.getCachedSymbolAtLocation(receiverExpression);
      if (!namespaceSymbol) {
        return undefined;
      }
      
      // Strategy 1: Direct namespace resolution
      const directResult = this.resolveDirectNamespace(namespaceSymbol, methodName, functions);
      if (directResult) {
        return directResult;
      }
      
      // Strategy 2: Import statement analysis for 'import * as ns from "module"'
      const importResult = this.resolveNamespaceFromImport(receiverExpression, methodName, functions);
      if (importResult) {
        return importResult;
      }
      
      return undefined;
    } catch {
      // If namespace resolution fails, return undefined
      return undefined;
    }
  }

  /**
   * Resolve namespace through direct symbol analysis
   */
  private resolveDirectNamespace(
    namespaceSymbol: TsMorphSymbol,
    methodName: string,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      // Check if this is a namespace import (SymbolFlags.NamespaceModule or SymbolFlags.ValueModule)
      const isNamespace = (namespaceSymbol.compilerSymbol.flags & ts.SymbolFlags.NamespaceModule) ||
                         (namespaceSymbol.compilerSymbol.flags & ts.SymbolFlags.ValueModule) ||
                         (namespaceSymbol.compilerSymbol.flags & ts.SymbolFlags.Alias);
      
      if (!isNamespace) {
        return undefined;
      }
      
      // Resolve aliased namespace symbols first
      const resolvedNamespace = this.resolveAliasedSymbol(namespaceSymbol.compilerSymbol);
      
      // Get the module declaration that this namespace refers to
      const moduleExports = this.getTypeChecker().compilerObject.getExportsOfModule(resolvedNamespace);
      if (!moduleExports) {
        return undefined;
      }
      
      // Find the specific export with the method name
      const exportSymbol = moduleExports.find(exp => exp.getName() === methodName);
      if (!exportSymbol) {
        return undefined;
      }
      
      // Resolve aliased symbols if needed
      const resolvedExportSymbol = this.resolveAliasedSymbol(exportSymbol);
      
      return this.resolveFunctionFromSymbol(resolvedExportSymbol, functions);
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve namespace from import declaration analysis
   * Uses TypeChecker's getSymbolAtLocation to find the actual imported function
   */
  private resolveNamespaceFromImport(
    namespaceIdentifier: Node,
    methodName: string,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      // Find the import declaration that declares this namespace
      const sourceFile = namespaceIdentifier.getSourceFile();
      const importDeclaration = this.findNamespaceImportDeclaration(sourceFile, namespaceIdentifier.getText());
      
      if (!importDeclaration) {
        return undefined;
      }
      
      // Get the module specifier (the module being imported)
      const moduleSpecifier = importDeclaration.getModuleSpecifier();
      if (!moduleSpecifier || !Node.isStringLiteral(moduleSpecifier)) {
        return undefined;
      }
      
      // Search for any CallExpression in the current file that matches this pattern
      const matchingCall = this.findCallExpressionWithPattern(sourceFile, namespaceIdentifier.getText(), methodName);
      if (matchingCall) {
        // Use the TypeChecker to resolve this expression
        const symbol = this.getCachedSymbolAtLocation(matchingCall);
        if (symbol) {
          const resolvedSymbol = this.resolveAliasedSymbol(symbol.compilerSymbol);
          return this.resolveFunctionFromSymbol(resolvedSymbol, functions);
        }
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find a call expression that matches the namespace.method pattern
   */
  private findCallExpressionWithPattern(sourceFile: SourceFile, namespaceName: string, methodName: string): Node | undefined {
    let foundExpression: Node | undefined;
    
    sourceFile.forEachDescendant((node: Node) => {
      if (foundExpression) return; // Stop when found
      
      if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        if (Node.isPropertyAccessExpression(expression)) {
          const receiver = expression.getExpression();
          if (Node.isIdentifier(receiver) && 
              receiver.getText() === namespaceName && 
              expression.getName() === methodName) {
            foundExpression = expression;
          }
        }
      }
    });
    
    return foundExpression;
  }

  /**
   * Find namespace import declaration: import * as ns from "module"
   */
  private findNamespaceImportDeclaration(sourceFile: SourceFile, namespaceName: string): ImportDeclaration | undefined {
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const importClause = importDecl.getImportClause();
      if (!importClause) continue;
      
      const namedBindings = importClause.getNamedBindings();
      if (!namedBindings || !Node.isNamespaceImport(namedBindings)) continue;
      
      const namespaceImport = namedBindings;
      if (namespaceImport.getName() === namespaceName) {
        return importDecl;
      }
    }
    return undefined;
  }

  /**
   * Resolve function from TypeScript symbol with comprehensive validation
   */
  private resolveFunctionFromSymbol(
    symbol: ts.Symbol,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      // Handle default exports within namespace
      if (symbol.getName() === 'default') {
        return this.resolveDefaultExport(symbol, functions);
      }
      
      // Get the actual function declaration
      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) {
        return undefined;
      }
      
      const tsDeclaration = declarations[0];
      
      // Convert TypeScript declaration to ts-morph node for validation
      const sourceFile = this.getProject().getSourceFile(tsDeclaration.getSourceFile().fileName);
      if (!sourceFile) {
        return undefined;
      }
      
      const morphDeclaration = sourceFile.getDescendantAtPos(tsDeclaration.getStart());
      if (!morphDeclaration) {
        return undefined;
      }
      
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
      
      return undefined;
    } catch {
      return undefined;
    }
  }
  
  /**
   * Resolve new expression (constructor calls) with import resolution
   */
  private resolveNewExpression(
    newNode: NewExpression,
    _functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      const expression = newNode.getExpression();
      
      if (Node.isIdentifier(expression)) {
        
        // Get symbol from TypeChecker
        const symbol = this.getCachedSymbolAtLocation(expression);
        if (!symbol) {
          return undefined;
        }
        
        // Resolve re-exported symbols to their original declaration
        const resolvedSymbol = this.resolveAliasedSymbol(symbol.compilerSymbol);
        
        // Get the constructor declaration
        const declarations = resolvedSymbol.getDeclarations();
        if (!declarations || declarations.length === 0) return undefined;
        
        // Find the class declaration
        const classDecl = declarations.find((d: ts.Declaration) => 
          ts.isClassDeclaration(d) || ts.isConstructorDeclaration(d)
        );
        
        if (!classDecl) return undefined;
        
        // For class declaration, we need to find the constructor
        let constructorDecl: ts.Declaration | undefined;
        if (ts.isClassDeclaration(classDecl)) {
          // Find constructor in class members
          const members = classDecl.members;
          constructorDecl = members?.find((m: ts.ClassElement) => ts.isConstructorDeclaration(m));
          
          // If no explicit constructor, use the class declaration itself
          if (!constructorDecl) {
            constructorDecl = classDecl;
          }
        } else {
          constructorDecl = classDecl;
        }
        
        // Convert TypeScript declaration to ts-morph node
        const sourceFile = this.getProject().getSourceFile(constructorDecl.getSourceFile().fileName);
        if (!sourceFile) return undefined;
        
        const morphDeclaration = sourceFile.getDescendantAtPos(constructorDecl.getStart());
        if (!morphDeclaration) return undefined;
        
        // Find matching function in our registry
        const declFilePath = sourceFile.getFilePath();
        const declStartPos = morphDeclaration.getStart();
        const declEndPos = morphDeclaration.getEnd();
        
        // Create position ID for precise matching
        const positionId = this.generatePositionId(declFilePath, declStartPos, declEndPos);
        const declStartLine = morphDeclaration.getStartLineNumber();
        
        // Use fast lookup
        const functionId = this.fastFunctionLookup(declFilePath, positionId, declStartLine);
        if (functionId) {
          return functionId;
        }
      }
      
      return undefined;
    } catch {
      return undefined;
    }
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
        const symbol = this.getCachedSymbolAtLocation(expression);
        if (!symbol) {
          return undefined;
        }
        
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
        // Method call through import: importedObj.method() or namespace.function()
        const methodName = expression.getName();
        const receiverExpression = expression.getExpression();
        
        // Check for namespace import: import * as ns; ns.functionName()
        const namespaceResult = this.resolveNamespaceImport(receiverExpression, methodName, functions);
        if (namespaceResult) {
          return namespaceResult;
        }
        
        // Try to resolve receiver type
        let receiverType: string | undefined;
        try {
          const type = this.getTypeChecker().getTypeAtLocation(receiverExpression);
          receiverType = type.getSymbol()?.getName();
        } catch {
          // TypeChecker failed, collect for CHA analysis
        }
        
        // Try direct resolution first with re-export support
        const symbol = this.getCachedSymbolAtLocation(expression);
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
        const callNodePath = callNode.getSourceFile().getFilePath();
        const fileFunctions = PathNormalizer.filterByPath(Array.from(functions.values()), callNodePath);
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
   * Find the containing function for a node with improved tolerance
   * Uses containment + position fallback instead of exact line matching
   */
  private findContainingFunction(node: Node, fileFunctions: FunctionMetadata[]): FunctionMetadata | undefined {
    let current = node.getParent();
    
    while (current) {
      if (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current) || Node.isArrowFunction(current) || Node.isFunctionExpression(current) || Node.isConstructorDeclaration(current)) {
        const startLine = current.getStartLineNumber();
        const endLine = current.getEndLineNumber();
        const startPos = current.getStart();
        const endPos = current.getEnd();
        
        // Strategy 1: Exact line match (legacy compatibility)
        let match = fileFunctions.find(f => 
          f.startLine === startLine && f.endLine === endLine
        );
        if (match) return match;
        
        // Strategy 2: Containment-based matching (more tolerant)
        match = fileFunctions.find(f => 
          f.startLine <= startLine && 
          endLine <= f.endLine &&
          // Prevent nested function mismatches by ensuring reasonable size relationship
          (f.endLine - f.startLine) >= (endLine - startLine)
        );
        if (match) return match;
        
        // Strategy 3: Position-based fallback (handles line offset issues)
        if (startPos !== undefined && endPos !== undefined) {
          const positionId = this.generatePositionId(current.getSourceFile().getFilePath(), startPos, endPos);
          match = fileFunctions.find(f => {
            // Try to match by content hash or position ID if available
            if (f.contentHash && f.contentHash.includes(positionId.substring(0, 8))) {
              return true;
            }
            if (f.positionId && f.positionId === positionId) {
              return true;
            }
            // Near-line tolerance (±1 line for minor discrepancies)
            return Math.abs(f.startLine - startLine) <= 1 && 
                   Math.abs(f.endLine - endLine) <= 1;
          });
          if (match) return match;
        }
        
        // Strategy 4: Best effort by function size and proximity
        match = fileFunctions.reduce((best, candidate) => {
          const candidateDistance = Math.abs(candidate.startLine - startLine) + Math.abs(candidate.endLine - endLine);
          const candidateSize = candidate.endLine - candidate.startLine;
          const nodeSize = endLine - startLine;
          
          // Prefer functions with similar size and close proximity
          if (!best || (
            candidateDistance < 3 && 
            Math.abs(candidateSize - nodeSize) < Math.abs((best.endLine - best.startLine) - nodeSize)
          )) {
            return candidate;
          }
          return best;
        }, undefined as FunctionMetadata | undefined);
        
        if (match) return match;
      }
      current = current.getParent();
    }
    
    return undefined;
  }
  
  /**
   * Check if node is an optional call expression (obj?.method() or fn?.())
   * Uses AST-based detection to avoid false positives from string content
   */
  private isOptionalCallExpression(node: Node): boolean {
    if (!Node.isCallExpression(node)) {
      return false;
    }
    
    const callExpr = node as CallExpression;
    const expression = callExpr.getExpression();
    
    // Check if the expression contains optional chaining
    if (Node.isPropertyAccessExpression(expression)) {
      return expression.hasQuestionDotToken();
    }
    
    // Check for direct optional call: fn?.()
    // Use more precise AST analysis instead of text search
    const sourceFile = node.getSourceFile();
    const start = expression.getEnd();
    
    // Find the opening parenthesis by looking at the arguments
    const args = callExpr.getArguments();
    const openParenPos = args.length > 0 ? args[0].getStart() - 1 : callExpr.getEnd() - 1;
    const between = sourceFile.getFullText().slice(start, openParenPos);
    
    // Look for question dot token specifically (more precise than text includes)
    return between.trim() === '?.';
  }

  /**
   * Resolve optional call expression with reduced confidence
   */
  private resolveOptionalCall(
    callNode: CallExpression,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    try {
      const expression = callNode.getExpression();
      
      if (Node.isPropertyAccessExpression(expression)) {
        // obj?.method() pattern
        const receiver = expression.getExpression();
        const methodName = expression.getName();
        
        // Try to resolve the receiver type first
        const symbol = this.getCachedSymbolAtLocation(receiver);
        if (symbol) {
          // Use similar logic to regular method calls but with optional handling
          return this.resolveMethodCall(receiver, methodName, functions);
        }
      } else if (Node.isIdentifier(expression)) {
        // fn?.() pattern - direct function call with optional chaining
        const functionName = expression.getText();
        
        // Try local resolution first
        const localResult = this.resolveLocalFunction(functionName, functions);
        if (localResult) {
          return localResult;
        }
        
        // Try import resolution
        return this.resolveImportCall(callNode, functions);
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve method call (shared logic for regular and optional calls)
   */
  private resolveMethodCall(
    receiver: Node,
    methodName: string,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    // This is a simplified version - in real implementation,
    // this would use the existing CHA/RTA resolution logic
    
    // For now, add to unresolved method calls for CHA/RTA analysis
    const callerFunction = this.findContainingFunction(receiver, Array.from(functions.values()));
    if (callerFunction) {
      this.unresolvedMethodCalls.push({
        callerFunctionId: callerFunction.id,
        methodName,
        receiverType: undefined, // Could be enhanced with type analysis
        lineNumber: receiver.getStartLineNumber(),
        columnNumber: receiver.getStart() - receiver.getStartLinePos() + 1
      });
    }
    
    return undefined; // Will be resolved by CHA/RTA stages
  }

  /**
   * Resolve local function by name
   */
  private resolveLocalFunction(
    functionName: string,
    functions: Map<string, FunctionMetadata>
  ): string | undefined {
    // Search for function by name in the same file or accessible scope
    for (const [functionId, func] of functions) {
      if (func.name === functionName) {
        return functionId;
      }
    }
    return undefined;
  }

  /**
   * Get resolution level priority for edge merging
   */
  private getResolutionPriority(level: ResolutionLevel): number {
    const priorities = {
      'local_exact': 5,
      'import_exact': 4,
      'runtime_confirmed': 3,
      'rta_resolved': 2,
      'cha_resolved': 1
    };
    return priorities[level] || 0;
  }

  /**
   * Add or merge edge with evolution tracking and confidence upgrades
   */
  private addEdge(edge: Partial<IdealCallEdge>): void {
    const edgeKey = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
    
    // Find existing edge
    const existingEdge = this.edgeIndex.get(edgeKey);
    
    if (!existingEdge) {
      // Create new edge
      const edgeId = generateStableEdgeId(edge.callerFunctionId!, edge.calleeFunctionId!);
      
      const completeEdge: IdealCallEdge = {
        // Required CallEdge properties
        id: edgeId,
        callerFunctionId: edge.callerFunctionId!,
        calleeFunctionId: edge.calleeFunctionId!,
        calleeName: edge.calleeName || edge.calleeFunctionId || 'unknown',
        calleeSignature: edge.calleeSignature || '',
        callType: edge.callType || 'direct',
        callContext: edge.callContext || edge.resolutionSource || '',
        lineNumber: edge.lineNumber || 0,
        columnNumber: edge.columnNumber || 0,
        isAsync: edge.isAsync || false,
        isChained: edge.isChained || false,
        confidenceScore: edge.confidenceScore || 0,
        metadata: edge.metadata || {},
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
      
      this.edges.push(completeEdge);
      this.edgeIndex.set(edgeKey, completeEdge);
      this.edgeKeys.add(edgeKey);
    } else {
      // Merge with existing edge - upgrade confidence and resolution level
      const newConfidence = edge.confidenceScore || 0;
      const newResolutionLevel = edge.resolutionLevel!;
      
      // Upgrade confidence to maximum
      existingEdge.confidenceScore = Math.max(existingEdge.confidenceScore, newConfidence);
      
      // Upgrade resolution level based on priority
      if (this.getResolutionPriority(newResolutionLevel) > this.getResolutionPriority(existingEdge.resolutionLevel)) {
        existingEdge.resolutionLevel = newResolutionLevel;
        existingEdge.resolutionSource = edge.resolutionSource || existingEdge.resolutionSource;
        existingEdge.callContext = edge.callContext || existingEdge.callContext;
      }
      
      // Merge runtime information
      if (edge.runtimeConfirmed) {
        existingEdge.runtimeConfirmed = true;
      }
      
      if (edge.executionCount !== undefined) {
        existingEdge.executionCount = Math.max(existingEdge.executionCount || 0, edge.executionCount);
      }
      
      // Merge candidates (avoid duplicates)
      if (edge.candidates && edge.candidates.length > 0) {
        const existingCandidates = new Set(existingEdge.candidates);
        for (const candidate of edge.candidates) {
          existingCandidates.add(candidate);
        }
        existingEdge.candidates = Array.from(existingCandidates);
      }
      
      // Update metadata if provided
      if (edge.metadata && Object.keys(edge.metadata).length > 0) {
        existingEdge.metadata = { ...existingEdge.metadata, ...edge.metadata };
      }
    }
  }


  /**
   * Log symbol cache statistics for performance monitoring
   */
  private logCacheStatistics(): void {
    if (this.fullSymbolCache) {
      this.fullSymbolCache.logStats();
    } else {
      this.symbolCache.logStats();
    }
  }

  /**
   * Get final edges with duplicate ID diagnostics
   */
  getEdges(): IdealCallEdge[] {
    // Step 3: Diagnostic logging for duplicate ID detection
    this.logEdgeDuplicateDiagnostics();
    return this.edges;
  }

  /**
   * Log edge duplicate diagnostics for debugging
   */
  private logEdgeDuplicateDiagnostics(): void {
    const edgeIds = this.edges.map(e => e.id);
    const duplicateIds = edgeIds.filter((id, index) => edgeIds.indexOf(id) !== index);
    
    if (duplicateIds.length > 0) {
      console.warn(`⚠️  Edge duplicate ID detection:`);
      console.warn(`   Total edges: ${this.edges.length}`);
      console.warn(`   Unique IDs: ${new Set(edgeIds).size}`);
      console.warn(`   Duplicate IDs found: ${duplicateIds.length}`);
      
      // Group by duplicate ID
      const duplicateGroups = new Map<string, IdealCallEdge[]>();
      for (const edge of this.edges) {
        if (duplicateIds.includes(edge.id)) {
          if (!duplicateGroups.has(edge.id)) {
            duplicateGroups.set(edge.id, []);
          }
          duplicateGroups.get(edge.id)!.push(edge);
        }
      }
      
      // Log details for each duplicate group
      for (const [edgeId, duplicates] of duplicateGroups) {
        console.warn(`   Duplicate ID "${edgeId}" appears ${duplicates.length} times:`);
        for (const edge of duplicates) {
          console.warn(`     - Caller: ${edge.callerFunctionId}, Callee: ${edge.calleeFunctionId}`);
          console.warn(`       Resolution: ${edge.resolutionLevel}, Confidence: ${edge.confidenceScore}`);
          console.warn(`       Context: ${edge.callContext}, Line: ${edge.lineNumber}`);
        }
      }
    } else {
      console.log(`✅ Edge ID uniqueness check passed: ${this.edges.length} edges, all unique`);
    }
  }

  /**
   * Clear collected edges and reset state
   */
  clear(): void {
    this.edges = [];
    this.edgeKeys.clear();
    this.edgeIndex.clear();
    this.functionLookupMap.clear();
    this.unresolvedMethodCalls = [];
    this.unresolvedMethodCallsForRTA = [];
    this.chaCandidates.clear();
    this.chaAnalyzer.clear();
    this.rtaAnalyzer.clear();
    this.runtimeTraceIntegrator.clear();
    
    // Clear symbol caches
    this.symbolCache.clear();
    if (this.fullSymbolCache) {
      this.fullSymbolCache.clear();
    }
    
    // Clean up full project resources
    if (this.fullProject) {
      this.fullProject.saveSync();
      this.fullProject = null;
      this.fullTypeChecker = null;
    }
  }

  /**
   * Select the best function candidate from multiple same-name functions
   * Uses lexical proximity, scope context, and function type to determine the best match
   */
  private selectBestFunctionCandidate(callNode: CallExpression, candidates: FunctionMetadata[]): FunctionMetadata | undefined {
    if (candidates.length === 1) {
      return candidates[0];
    }

    // Strategy 1: Find candidate in the same lexical scope (closest containing function)
    const callLine = callNode.getStartLineNumber();
    const containingFunction = this.findContainingFunction(callNode, candidates);
    
    // Strategy 2: Lexical proximity - prefer functions defined closer to the call site
    const proximityScored = candidates.map(candidate => ({
      candidate,
      distance: Math.abs(candidate.startLine - callLine),
      isInScope: containingFunction ? containingFunction.id === candidate.id : false
    }));

    // Sort by priority: same scope > lexical proximity > lexical path specificity
    proximityScored.sort((a, b) => {
      // Prioritize functions in the same scope
      if (a.isInScope && !b.isInScope) return -1;
      if (!a.isInScope && b.isInScope) return 1;
      
      // Then by proximity
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      
      // Finally by lexical path specificity (more specific paths preferred)
      return b.candidate.lexicalPath.split('#').length - a.candidate.lexicalPath.split('#').length;
    });

    const best = proximityScored[0];
    
    // Log ambiguity warning if multiple candidates are very close
    if (proximityScored.length > 1 && proximityScored[1].distance <= best.distance + 5) {
      console.warn(`🚨 Ambiguous function resolution for '${candidates[0].name}' at line ${callLine}:`);
      proximityScored.slice(0, Math.min(3, proximityScored.length)).forEach((scored, i) => {
        const symbol = i === 0 ? '✅' : '⚠️ ';
        console.warn(`   ${symbol} ${scored.candidate.lexicalPath} (line ${scored.candidate.startLine}, distance: ${scored.distance})`);
      });
    }

    return best.candidate;
  }
}