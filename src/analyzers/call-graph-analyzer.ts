import {
  Project,
  SourceFile,
  CallExpression,
  Node,
  TypeChecker,
  VariableDeclaration,
  ParameterDeclaration,
  ClassDeclaration,
  NewExpression,
  BinaryExpression,
  CallExpression as TsCallExpression,
  Identifier,
} from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';
import { CallEdge } from '../types';
import { AnalysisCache, CacheStats } from '../utils/analysis-cache';
import { CacheProvider } from '../utils/cache-interfaces';
import { CacheServiceLocator } from '../utils/cache-injection';
import { buildImportIndex, resolveCallee, CalleeResolution, ImportRecord } from './symbol-resolver';
import { Logger } from '../utils/cli-utils';
import { PerformanceProfiler, measureSync } from '../utils/performance-metrics';
import * as fs from 'fs';
import * as path from 'path';

// Removed legacy CallContext - no longer needed with symbol resolution

// Removed legacy interface - no longer needed with symbol resolution

/**
 * Analyzes TypeScript code to extract function call relationships
 * Identifies calls between functions, methods, and external libraries
 */
export class CallGraphAnalyzer {
  protected project: Project;
  private cache: AnalysisCache;
  private callEdgeCache: CacheProvider<CallEdge[]>;
  private logger: Logger | undefined;
  private profiler: PerformanceProfiler;
  private exportDeclarationsByFile: Map<string, ReadonlyMap<string, Node[]>> = new Map();
  private precomputedExportsByFile: Map<string, Map<string, Node[]>> = new Map();
  private resolvingVisited: Set<string> = new Set();
  private importResolutionCache: Map<string, Node | undefined> = new Map();
  private importIndexCache: WeakMap<SourceFile, Map<string, ImportRecord>> = new WeakMap();
  private tsconfigPathsLoaded = false;
  private tsBaseUrl: string | null = null;
  private tsPaths: Array<{ pattern: string; targets: string[] }> = [];
// Built-in functions moved to symbol-resolver.ts - no longer needed here

  constructor(
    project?: Project, 
    enableCache: boolean = true, 
    logger?: Logger,
    callEdgeCache?: CacheProvider<CallEdge[]>
  ) {
    this.logger = logger ?? undefined;
    this.profiler = new PerformanceProfiler('CallGraphAnalyzer');
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
   * Unified AST traversal: collect function nodes and their call expressions in one pass
   * Eliminates O(N*M) double traversal - optimization for large files
   */
  private collectFunctionNodesAndCalls(sourceFile: SourceFile): {
    functionNodes: Node[];
    functionCallsMap: Map<Node, CallExpression[]>;
  } {
    const functionNodes: Node[] = [];
    const functionCallsMap = new Map<Node, CallExpression[]>();
    
    sourceFile.forEachDescendant((node, traversal) => {
      if (this.isFunctionDeclaration(node)) {
        functionNodes.push(node);
        functionCallsMap.set(node, []);
        
        // Collect call expressions and new expressions within this function
        node.forEachDescendant((innerNode, innerTraversal) => {
          if (Node.isCallExpression(innerNode)) {
            const calls = functionCallsMap.get(node);
            if (calls) {
              calls.push(innerNode);
            }
          }
          // Handle constructor calls (new expressions)
          if (Node.isNewExpression(innerNode)) {
            const calls = functionCallsMap.get(node);
            if (calls) {
              // Treat NewExpression as CallExpression for unified processing (temporary cast)
              calls.push(innerNode as unknown as CallExpression);
            }
          }
          // Skip nested function declarations
          if (this.isFunctionDeclaration(innerNode) && innerNode !== node) {
            innerTraversal.skip();
          }
        });
        
        traversal.skip(); // Skip this function's content in outer traversal
      }
    });
    
    return { functionNodes, functionCallsMap };
  }


  /**
   * Extract candidate function names from function map for pre-filtering
   */
  private extractCandidateNames(functionMap: Map<string, { id: string; name: string; startLine: number; endLine: number }>): Set<string> {
    const candidateNames = new Set<string>();
    for (const [, functionInfo] of functionMap.entries()) {
      if (functionInfo.name && functionInfo.name !== 'anonymous') {
        candidateNames.add(functionInfo.name);
      }
    }
    return candidateNames;
  }

  /**
   * Pre-filter call expressions using identifier name matching
   */
  private preFilterCallExpressions(callExpressions: CallExpression[], candidateNames: Set<string>): CallExpression[] {
    return callExpressions.filter(callExpr => {
      const expr = callExpr.getExpression();
      
      // Always keep property access calls (obj.method()) and element access (obj['method']())
      if (Node.isPropertyAccessExpression(expr) || Node.isElementAccessExpression(expr)) {
        return true;
      }
      
      // For simple identifier calls, check if name matches candidate functions
      if (Node.isIdentifier(expr)) {
        const callName = expr.getText();
        return candidateNames.has(callName);
      }
      
      // Keep other complex expressions (computed calls, etc.)
      return true;
    });
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
    importIndex: Map<string, ImportRecord>,
    allowedFunctionIdSet: Set<string>,
    getFunctionIdByDeclaration: (decl: Node) => string | undefined,
    candidateNames: Set<string> | undefined,
    functionNode: Node
  ): Promise<CallEdge[]> {
    const callEdges: CallEdge[] = [];
    let idMismatchCount = 0;
    let resolvedCount = 0;
    
    // Apply pre-filtering to reduce resolveCallee calls
    const filteredCallExpressions = candidateNames ? 
      this.preFilterCallExpressions(callExpressions, candidateNames) : 
      callExpressions;

    // Build a lightweight local RTA map: identifier -> ClassDeclaration node
    const localClassMap = new Map<string, ClassDeclaration>();
    try {
      functionNode.forEachDescendant((n, trav) => {
        // Skip nested function scopes
        if (this.isFunctionDeclaration(n) && n !== functionNode) {
          trav.skip();
          return;
        }
        // Variable declarations: const x = new ClassName()
        if (Node.isVariableDeclaration(n)) {
          const vd: VariableDeclaration = n;
          const name = vd.getName();
          const init = vd.getInitializer();
          if (name && init) {
            if (Node.isNewExpression(init)) {
              const newExpr: NewExpression = init;
              const expr = newExpr.getExpression();
              const sym = expr ? typeChecker.getSymbolAtLocation(expr) : undefined;
              const decl = sym?.getDeclarations()?.[0];
              if (decl && Node.isClassDeclaration(decl)) {
                localClassMap.set(name, decl);
              }
            } else if (Node.isCallExpression(init)) {
              // Factory return type → class symbol
              try {
                const t = typeChecker.getTypeAtLocation(init);
                const sym = t?.getSymbol();
                const decl = sym?.getDeclarations()?.[0];
                if (decl && Node.isClassDeclaration(decl)) {
                  localClassMap.set(name, decl);
                }
              } catch {
                // ignore
              }
            } else if (Node.isIdentifier(init)) {
              // Simple alias: const y = x; if x already mapped to a class, map y as well
              const aliasSource = localClassMap.get(init.getText());
              if (aliasSource) {
                localClassMap.set(name, aliasSource);
              }
            }
          }
        }
        // Simple assignment propagation: x = new C(), x = factory(), x = y
        if (Node.isBinaryExpression(n)) {
          const be: BinaryExpression = n;
          const op = be.getOperatorToken().getText();
          if (op === '=') {
            const left = be.getLeft();
            const right = be.getRight();
            if (Node.isIdentifier(left)) {
              const leftName: string = (left as Identifier).getText();
              if (Node.isNewExpression(right)) {
                const expr = right.getExpression();
                const sym = expr ? typeChecker.getSymbolAtLocation(expr) : undefined;
                const decl = sym?.getDeclarations()?.[0];
                if (decl && Node.isClassDeclaration(decl)) {
                  localClassMap.set(leftName, decl);
                }
              } else if (Node.isCallExpression(right)) {
                try {
                  const t = typeChecker.getTypeAtLocation(right as TsCallExpression);
                  const sym = t?.getSymbol();
                  const decl = sym?.getDeclarations()?.[0];
                  if (decl && Node.isClassDeclaration(decl)) {
                    localClassMap.set(leftName, decl);
                  }
                } catch {
                  // ignore
                }
              } else if (Node.isIdentifier(right)) {
                const src = localClassMap.get(right.getText());
                if (src) {
                  localClassMap.set(leftName, src);
                }
              }
            }
          }
        }
        // Function parameters typed as ClassName
        if (Node.isParameterDeclaration(n)) {
          const pn: ParameterDeclaration = n;
          const name = pn.getName();
          const t = pn.getType();
          const sym = t?.getSymbol();
          const decl = sym?.getDeclarations()?.[0];
          if (name && decl && Node.isClassDeclaration(decl)) {
            localClassMap.set(name, decl);
          }
        }
      });
    } catch {
      // Non-fatal: local RTA map is best-effort
    }

    for (const callExpr of filteredCallExpressions) {
      try {
        const resolution = resolveCallee(callExpr, {
          sourceFile,
          typeChecker,
          importIndex,
          internalModulePrefixes: ["src/", "@/", "#/"],
          getFunctionIdByDeclaration,
          resolveImportedSymbol: (moduleSpecifier: string, exportedName: string) => {
            return this.resolveImportedSymbolWithCache(moduleSpecifier, exportedName, filePath);
          }
        });

        // Only create edges for internal function calls
        if (resolution.kind === "internal" && resolution.functionId) {
          resolvedCount++;
          // Verify the resolved function ID exists in allowed functions set
          if (!allowedFunctionIdSet.has(resolution.functionId)) {
            idMismatchCount++;
            if (process.env['FUNCQC_DEBUG_ID_MISMATCHES']) {
              this.logger?.debug(`ID mismatch: Resolved function ID ${resolution.functionId} not found in allowed functions set (${resolution.via})`);
            }
            continue;
          }
          const callEdge = this.createCallEdgeFromResolution(
            callExpr,
            sourceFunctionId,
            resolution
          );
          callEdges.push(callEdge);
        } else if (resolution.kind === "unknown") {
          // Fallback: property access via import alias (e.g., ns.foo()) that symbol-resolver couldn't map
          const expr = callExpr.getExpression();
          if (Node.isPropertyAccessExpression(expr)) {
            const left = expr.getExpression();
            const name = expr.getNameNode().getText();
            if (Node.isIdentifier(left)) {
              const alias = left.getText();
              const rec = importIndex.get(alias);
              if (rec) {
                // Try resolving through import cache explicitly
                const decl = this.resolveImportedSymbolWithCache(rec.module, name, filePath);
                if (decl) {
                  const fid = getFunctionIdByDeclaration(decl);
                  if (fid && allowedFunctionIdSet.has(fid)) {
                    const fallbackResolution = { kind: 'internal' as const, functionId: fid, confidence: 0.95, via: 'fallback' as const };
                    const callEdge = this.createCallEdgeFromResolution(
                      callExpr,
                      sourceFunctionId,
                      fallbackResolution
                    );
                    callEdges.push(callEdge);
                    resolvedCount++;
                  }
                }
              } else {
                // Local RTA fallback: identifier mapped to a known ClassDeclaration
                const classDecl = localClassMap.get(alias);
                if (classDecl) {
                  // Find method in class
                  const methodDecl = classDecl.getInstanceMethods().find(m => m.getName() === name)
                    || classDecl.getMethods().find(m => m.getName() === name);
                  if (methodDecl) {
                    const fid = getFunctionIdByDeclaration(methodDecl);
                    if (fid && allowedFunctionIdSet.has(fid)) {
                      const fallbackResolution = { kind: 'internal' as const, functionId: fid, confidence: 0.95, via: 'fallback' as const };
                      const callEdge = this.createCallEdgeFromResolution(
                        callExpr,
                        sourceFunctionId,
                        fallbackResolution
                      );
                      callEdges.push(callEdge);
                      resolvedCount++;
                    }
                  }
                }
              }
            }
          }
        }
        // External calls are ignored as they don't contribute to circular dependencies
        // Unknown calls are also ignored as they're likely external or unresolvable
      } catch (error) {
        // Continue processing other calls if one fails
        this.logger?.warn(`Failed to resolve call in ${filePath}:${callExpr.getStartLineNumber()}: ${error}`);
      }
    }

    // Report statistics (CRITICAL for debugging ID space issues)
    if ((resolvedCount > 0 || idMismatchCount > 0) && process.env['FUNCQC_DEBUG_CALL_RESOLUTION']) {
      this.logger?.warn(`🔍 Call resolution stats for ${sourceFunctionId.substring(0, 8)}: resolved=${resolvedCount}, id_mismatch=${idMismatchCount}, edges_created=${callEdges.length}`);
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
    this.profiler.start();
    this.profiler.startPhase('file_analysis');
    
    try {
      // Backward compatibility: if allowedFunctionIdSet not provided, create from functionMap
      const actualAllowedFunctionIdSet = allowedFunctionIdSet || 
        new Set(Array.from(functionMap.values()).map(f => f.id));
      
      // Ensure getFunctionIdByDeclaration is not undefined  
      const actualGetFunctionIdByDeclaration = getFunctionIdByDeclaration || (() => undefined);

      // Use existing source file if already loaded, avoid double parsing
      this.profiler.startPhase('source_file_loading');
      let sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(filePath);
        this.profiler.recordDetail('source_file_loading', 'new_files_loaded', 1);
      } else {
        this.profiler.recordDetail('source_file_loading', 'cached_files_used', 1);
      }
      this.profiler.endPhase();
      
      const callEdges: CallEdge[] = [];
      
      this.profiler.startPhase('type_checking_setup');
      const typeChecker = this.project.getTypeChecker();
      this.profiler.endPhase();
      
      this.profiler.startPhase('import_index_building');
      // Use WeakMap cache for import index to avoid rebuilding for same SourceFile
      let importIndex = this.importIndexCache.get(sourceFile);
      if (!importIndex) {
        importIndex = buildImportIndex(sourceFile);
        this.importIndexCache.set(sourceFile, importIndex);
        this.profiler.recordDetail('import_index_building', 'cache_misses', 1);
      } else {
        this.profiler.recordDetail('import_index_building', 'cache_hits', 1);
      }
      this.profiler.recordDetail('import_index_building', 'imports_processed', importIndex.size);
      this.profiler.endPhase();
      
      // Clean up debug logging - import index construction is working correctly

      // Unified AST traversal: collect function nodes and calls in one pass
      this.profiler.startPhase('unified_ast_traversal');
      const { functionNodes, functionCallsMap } = this.collectFunctionNodesAndCalls(sourceFile);
      this.profiler.recordDetail('unified_ast_traversal', 'nodes_found', functionNodes.length);
      this.profiler.recordDetail('unified_ast_traversal', 'calls_collected', Array.from(functionCallsMap.values()).reduce((sum, calls) => sum + calls.length, 0));
      this.profiler.endPhase();
      
      // Build function node index for efficient lookup (using local functions only)
      this.profiler.startPhase('function_index_building');
      const localDeclIndex = this.buildFunctionNodeIndex(functionNodes, functionMap);
      this.profiler.recordDetail('function_index_building', 'mappings_created', localDeclIndex.size);
      this.profiler.endPhase();
      
      // Extract candidate function names for pre-filtering
      this.profiler.startPhase('candidate_name_extraction');
      const candidateNames = this.extractCandidateNames(functionMap);
      this.profiler.recordDetail('candidate_name_extraction', 'candidate_names', candidateNames.size);
      this.profiler.endPhase();
      
      // Create fallback function for declaration lookup with proper chaining
      const declarationLookup = (decl: Node) =>
        actualGetFunctionIdByDeclaration(decl) ?? localDeclIndex.get(decl);

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
          if (process.env['FUNCQC_DEBUG_SPECIFIC_FUNCTIONS'] && functionInfo.name === 'performSingleFunctionAnalysis') {
            console.log(`🅱️ STEP B: Function node found for ${functionInfo.name}`);
            console.log(`   Node lines: ${functionNode.getStartLineNumber()}-${functionNode.getEndLineNumber()}`);
          }
          
          // Use pre-collected call expressions from unified AST traversal
          const callExpressions = functionCallsMap.get(functionNode) || [];

          // Process call expressions and create call edges
          const functionCallEdges = await this.processCallEdges(
            callExpressions,
            functionInfo.id,
            filePath,
            sourceFile,
            typeChecker,
            importIndex,
            actualAllowedFunctionIdSet,
            declarationLookup,
            candidateNames,
            functionNode
          );
          
          
          callEdges.push(...functionCallEdges);
        }
      }

      this.profiler.endPhase(); // End file_analysis phase
      
      // Print performance summary if debug logging is enabled
      if (process.env['FUNCQC_DEBUG_PERFORMANCE'] || process.env['DEBUG']) {
        this.profiler.printSummary();
      }
      
      this.profiler.recordDetail('file_analysis', 'call_edges_created', callEdges.length);
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
   * Resolve imported symbol with caching and performance metrics
   */
  protected resolveImportedSymbolWithCache(
    moduleSpecifier: string, 
    exportedName: string, 
    currentFilePath: string
  ): Node | undefined {
    
    const cacheKey = `${currentFilePath}:${moduleSpecifier}:${exportedName}`;
    
    // Check if we have cached result for this specific import resolution
    if (this.importResolutionCache.has(cacheKey)) {
      this.profiler.recordDetail('import_resolution', 'cache_hits', 1);
      return this.importResolutionCache.get(cacheKey)!;
    }

    this.profiler.recordDetail('import_resolution', 'cache_misses', 1);
    
    return measureSync(() => {
      if (process.env['FUNCQC_DEBUG_IMPORT_RESOLUTION'] && exportedName === 'buildDependencyTree') {
        console.log(`       Processing path resolution for ${moduleSpecifier}`);
      }
      
      // 🔧 CRITICAL FIX: Handle virtual filesystem paths
      // Check if we're working with virtual paths (used in analyzeCallGraphFromContent)
      const isVirtual = currentFilePath.startsWith('/virtual');
      
      // Enhanced import resolution: relative + tsconfig paths + absolute
      let resolvedPath: string;
      
      if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
        // 🔧 CRITICAL FIX: Use path.resolve for cross-platform compatibility
        const baseDir = path.dirname(path.resolve(currentFilePath));
        resolvedPath = path.resolve(baseDir, moduleSpecifier);
        
        if (process.env['FUNCQC_DEBUG_IMPORT_RESOLUTION'] && exportedName === 'buildDependencyTree') {
          console.log(`       Base directory: '${baseDir}'`);
          console.log(`       Module specifier: '${moduleSpecifier}'`);
          console.log(`       Virtual filesystem detected: ${isVirtual}`);
          console.log(`       Resolved path (before ext): '${resolvedPath}'`);
        }
      } else if (moduleSpecifier.startsWith('@/') || moduleSpecifier.startsWith('#/')) {
        // 🔧 CRITICAL FIX: tsconfig paths aliases with path.join
        const projectRoot = this.findProjectRoot();
        
        if (moduleSpecifier.startsWith('@/')) {
          // @/ -> src/ mapping (common convention)
          const relativePath = moduleSpecifier.substring(2); // Remove '@/'
          if (isVirtual) {
            const mod = [projectRoot.replace(/^\/+/, ''), 'src', relativePath].join('/');
            resolvedPath = `/virtual/${mod}`;
          } else {
            resolvedPath = path.join(projectRoot, 'src', relativePath);
          }
        } else if (moduleSpecifier.startsWith('#/')) {
          // #/ -> project root mapping
          const relativePath = moduleSpecifier.substring(2); // Remove '#/'
          if (isVirtual) {
            const mod = [projectRoot.replace(/^\/+/, ''), relativePath].join('/');
            resolvedPath = `/virtual/${mod}`;
          } else {
            resolvedPath = path.join(projectRoot, relativePath);
          }
        } else {
          return undefined;
        }
      } else if (moduleSpecifier.startsWith('/')) {
        // Absolute path (unified format: all paths start with /)
        if (isVirtual) {
          // 先頭のスラッシュを除去してから /virtual を付与（join は使わない）
          const mod = moduleSpecifier.replace(/^\/+/, '');
          resolvedPath = `/virtual/${mod}`;
        } else {
          resolvedPath = path.resolve(moduleSpecifier);
        }
      } else {
        // Try tsconfig paths mapping for non-relative specifiers
        this.loadTsConfigPathsOnce();
        const mapped = this.resolveWithTsconfigPaths(moduleSpecifier, currentFilePath);
        if (mapped) {
          resolvedPath = mapped;
        } else {
          // External module or unsupported pattern - CRITICAL FIX
          this.profiler.recordDetail('import_resolution', 'external_modules', 1);
          return undefined;
        }
      }
      
      // Try to find the source file with comprehensive extension support
      const knownExts = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];
      const hasKnownExt = knownExts.some(ext => resolvedPath.endsWith(ext));
      const extensionCandidates = hasKnownExt
        ? [''] // そのまま試す
        : [
            ...knownExts,
            '/index.ts', '/index.tsx',
            '/index.js', '/index.jsx'
          ];
      
      let targetSourceFile;
      for (const ext of extensionCandidates) {
        const tryPathRaw = resolvedPath + ext;
        // 🔧 CRITICAL FIX: virtual パスは resolve すると /virtual が落ちるため、そのまま POSIX 形で扱う
        const tryPath =
          resolvedPath.startsWith('/virtual/')
            ? tryPathRaw.replace(/\\/g, '/')
            : path.resolve(tryPathRaw);

        targetSourceFile = this.project.getSourceFile(tryPath);
        
        // 🔧 CRITICAL FIX: インポート先ファイルの遅延ロード
        if (!targetSourceFile && fs.existsSync(tryPath)) {
          try {
            targetSourceFile = this.project.addSourceFileAtPath(tryPath);
            if (process.env['FUNCQC_DEBUG_IMPORT_RESOLUTION'] && exportedName === 'buildDependencyTree') {
              console.log(`       📥 Added target source file: ${tryPath}`);
            }
            this.logger?.debug(`Added missing source file: ${tryPath}`);
          } catch (e) {
            this.logger?.debug(`Failed to add source file: ${tryPath}: ${String(e)}`);
          }
        }

        if (targetSourceFile) {
          if (process.env['FUNCQC_DEBUG_IMPORT_RESOLUTION'] && exportedName === 'buildDependencyTree') {
            console.log(`       ✅ Found target source file: ${tryPath}`);
          }
          this.logger?.debug(`🔍 FOUND: ${tryPath}`);
          break;
        } else if (process.env['FUNCQC_DEBUG_IMPORT_RESOLUTION'] && exportedName === 'buildDependencyTree') {
          console.log(`       ❌ Not found: ${tryPath}`);
        }
      }
      
      this.logger?.debug(`Target source file: ${targetSourceFile?.getFilePath() || 'not found'}`);
      
      if (targetSourceFile) {
        this.profiler.recordDetail('import_resolution', 'files_found', 1);
        
        // Precompute named exports and simple re-exports for this file (once)
        this.ensurePrecomputedExportsForFile(targetSourceFile);
        const preMap = this.precomputedExportsByFile.get(targetSourceFile.getFilePath());
        if (preMap && preMap.has(exportedName)) {
          const nodes = preMap.get(exportedName)!;
          const fn = this.pickFunctionLike(nodes);
          if (fn) {
            this.importResolutionCache.set(cacheKey, fn);
            return fn;
          }
        }

        // Get or create cached export declarations for this file
        const filePath = targetSourceFile.getFilePath();
        let fileExportsCache = this.exportDeclarationsByFile.get(filePath);
        
        if (!fileExportsCache) {
          // Cache miss - build export declarations cache for entire file
          fileExportsCache = measureSync(() => {
            return targetSourceFile!.getExportedDeclarations();
          }, this.profiler, 'get_exported_declarations');
          
          this.exportDeclarationsByFile.set(filePath, fileExportsCache);
          this.profiler.recordDetail('import_resolution', 'export_cache_builds', 1);
        }
        
        // Find the exported function or re-export chain target
        const decls = fileExportsCache.get(exportedName);
        this.logger?.debug(`Exported declarations for ${exportedName}: ${decls?.length || 0} found`);
        
        // Helper: attempt to extract function-like node from a declaration
        const extractFunctionLike = (n: Node): Node | undefined => {
          if (this.isFunctionDeclaration(n)) return n;
          // Variable declaration with function initializer
          if (Node.isVariableDeclaration(n)) {
            const init = n.getInitializer();
            if (init && (Node.isFunctionExpression(init) || Node.isArrowFunction(init))) {
              return init;
            }
          }
          return undefined;
        };

        if (decls && decls.length > 0) {
          for (const decl of decls) {
            const fn = extractFunctionLike(decl);
            if (fn) {
              this.profiler.recordDetail('import_resolution', 'successful_resolutions', 1);
              this.importResolutionCache.set(cacheKey, fn);
              return fn;
            }
          }
        } else {
          // Re-export handling: export { foo as bar } from './mod'; export * from './mod';
          try {
            const exportDecls = targetSourceFile.getExportDeclarations();
            for (const ed of exportDecls) {
              const mod = ed.getModuleSpecifierValue();
              if (!mod) continue; // skip local re-exports without module specifier

              // 1) Named re-exports
              const named = ed.getNamedExports();
              for (const spec of named) {
                const local = spec.getNameNode().getText();
                const aliasNode = spec.getAliasNode();
                const exportedAs = aliasNode ? aliasNode.getText() : local;
                if (exportedAs === exportedName) {
                  // Prevent cycles
                  const vkey = `${currentFilePath}::${moduleSpecifier}::${exportedName}`;
                  if (!this.resolvingVisited.has(vkey)) {
                    this.resolvingVisited.add(vkey);
                    const res = this.resolveImportedSymbolWithCache(mod, local, currentFilePath);
                    if (res) {
                      this.importResolutionCache.set(cacheKey, res);
                      return res;
                    }
                  }
                }
              }

              // 2) Wildcard re-exports: export * from './mod'
              if (ed.isNamespaceExport?.()) {
                // namespace export (export * as ns from ...) — not applicable here
              } else if (ed.isTypeOnly?.() === false && named.length === 0) {
                const vkey2 = `${currentFilePath}::${moduleSpecifier}::*::${exportedName}`;
                if (!this.resolvingVisited.has(vkey2)) {
                  this.resolvingVisited.add(vkey2);
                  const res = this.resolveImportedSymbolWithCache(mod, exportedName, currentFilePath);
                  if (res) {
                    this.importResolutionCache.set(cacheKey, res);
                    return res;
                  }
                }
              }
            }
          } catch (e) {
            this.logger?.debug(`Re-export resolution failed: ${String(e)}`);
          }
        }
      } else {
        this.profiler.recordDetail('import_resolution', 'files_not_found', 1);
      }
      
      this.profiler.recordDetail('import_resolution', 'failed_resolutions', 1);
      // Cache the failed result to avoid repeated attempts
      this.importResolutionCache.set(cacheKey, undefined);
      return undefined;
    }, this.profiler, 'resolve_imported_symbol');
  }

  /**
   * Find project root directory (for tsconfig paths resolution)
   */
  protected findProjectRoot(): string {
    // Simplified project root detection without require()
    return process.cwd();
  }

  /**
   * Load tsconfig paths once for alias-based resolution
   */
  private loadTsConfigPathsOnce(): void {
    if (this.tsconfigPathsLoaded) return;
    this.tsconfigPathsLoaded = true;
    try {
      const projectRoot = this.findProjectRoot();
      const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
      if (!fs.existsSync(tsconfigPath)) return;
      const raw = fs.readFileSync(tsconfigPath, 'utf8');
      const json = JSON.parse(raw);
      const opts = json.compilerOptions || {};
      const baseUrl = typeof opts.baseUrl === 'string' ? opts.baseUrl : '.';
      const paths = opts.paths || {};
      this.tsBaseUrl = baseUrl;
      this.tsPaths = Object.keys(paths).map((k: string) => ({ pattern: k, targets: Array.isArray(paths[k]) ? paths[k] : [paths[k]] }));
    } catch {
      // ignore
    }
  }

  /**
   * Resolve module specifier using tsconfig paths mapping
   */
  private resolveWithTsconfigPaths(moduleSpecifier: string, currentFilePath: string): string | null {
    if (!this.tsPaths.length) return null;
    const projectRoot = this.findProjectRoot();
    const isVirtual = currentFilePath.startsWith('/virtual');

    const tryTargets = (pattern: string, targets: string[]): string | null => {
      // Support simple '*' wildcard mapping
      const starIdx = pattern.indexOf('*');
      const prefix = starIdx >= 0 ? pattern.slice(0, starIdx) : pattern;
      const suffix = starIdx >= 0 ? pattern.slice(starIdx + 1) : '';
      if (starIdx >= 0) {
        if (!moduleSpecifier.startsWith(prefix) || !moduleSpecifier.endsWith(suffix)) return null;
      } else {
        if (moduleSpecifier !== pattern) return null;
      }
      const remainder = starIdx >= 0 ? moduleSpecifier.slice(prefix.length, moduleSpecifier.length - suffix.length) : '';
      for (const t of targets) {
        const replaced = t.replace('*', remainder);
        const base = this.tsBaseUrl || '.';
        const abs = isVirtual
          ? `/virtual/${[projectRoot.replace(/^\/+/, ''), base, replaced].join('/')}`
          : path.join(projectRoot, base, replaced);
        // Probe with known extensions and index files
        const knownExts = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];
        const hasKnownExt = knownExts.some(ext => abs.endsWith(ext));
        const candidates = hasKnownExt ? [''] : [...knownExts, '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
        for (const ext of candidates) {
          const tryPathRaw = abs + ext;
          const tryPath = abs.startsWith('/virtual/') ? tryPathRaw.replace(/\\/g, '/') : path.resolve(tryPathRaw);
          if (fs.existsSync(tryPath)) return tryPath;
        }
      }
      return null;
    };

    for (const { pattern, targets } of this.tsPaths) {
      const res = tryTargets(pattern, targets);
      if (res) return res;
    }
    return null;
  }

  /**
   * Precompute exported declarations for a file, including named and wildcard re-exports (recursive)
   */
  private ensurePrecomputedExportsForFile(file: SourceFile): void {
    const visited = new Set<string>();
    this.precomputeExportsRecursive(file, visited);
  }

  private precomputeExportsRecursive(file: SourceFile, visited: Set<string>): void {
    const filePath = file.getFilePath();
    if (this.precomputedExportsByFile.has(filePath)) return;
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const map = new Map<string, Node[]>();
    try {
      // Direct exports
      const direct = file.getExportedDeclarations();
      for (const [name, nodes] of direct) {
        if (!map.has(name)) map.set(name, []);
        map.get(name)!.push(...nodes);
      }
      // Default export assignments: export default <expr>
      try {
        const typeChecker = this.project.getTypeChecker();
        const exportAssignments = file.getExportAssignments();
        for (const ea of exportAssignments) {
          if (ea.isExportEquals()) continue; // Ignore 'export ='
          const expr = ea.getExpression();
          const collected: Node[] = [];
          if (Node.isIdentifier(expr)) {
            const sym = typeChecker.getSymbolAtLocation(expr);
            const decls = sym?.getDeclarations() || [];
            for (const d of decls) collected.push(d);
          } else if (Node.isFunctionExpression(expr) || Node.isArrowFunction(expr)) {
            collected.push(expr);
          }
          if (collected.length > 0) {
            if (!map.has('default')) map.set('default', []);
            map.get('default')!.push(...collected);
          }
        }
      } catch {
        // ignore default export assignment errors
      }
      // Re-exports (named and wildcard)
      for (const ed of file.getExportDeclarations()) {
        const mod = ed.getModuleSpecifierValue();
        if (!mod) continue;
        const named = ed.getNamedExports();
        if (named.length > 0) {
          // Named re-exports
          for (const spec of named) {
            const local = spec.getNameNode().getText();
            const aliasNode = spec.getAliasNode();
            const exportedAs = aliasNode ? aliasNode.getText() : local;
            try {
              const decl = this.resolveImportedSymbolWithCache(mod, local, filePath);
              if (decl) {
                if (!map.has(exportedAs)) map.set(exportedAs, []);
                map.get(exportedAs)!.push(decl);
              }
            } catch {
              // ignore
            }
          }
        } else {
          // Wildcard re-exports: export * from './mod'
          const target = this.resolveModuleToSourceFile(filePath, mod);
          if (target) {
            // Ensure target precomputed first (recursive)
            this.precomputeExportsRecursive(target, visited);
            const tmap = this.precomputedExportsByFile.get(target.getFilePath());
            if (tmap) {
              for (const [name, nodes] of tmap) {
                if (name === 'default') continue; // export * does not re-export default
                if (!map.has(name)) map.set(name, []);
                map.get(name)!.push(...nodes);
              }
            }
          }
        }
      }
      this.precomputedExportsByFile.set(filePath, map);
    } catch {
      // ignore
    }
  }

  private pickFunctionLike(nodes: Node[]): Node | undefined {
    for (const n of nodes) {
      if (this.isFunctionDeclaration(n)) return n;
      if (Node.isVariableDeclaration(n)) {
        const init = n.getInitializer();
        if (init && (Node.isFunctionExpression(init) || Node.isArrowFunction(init))) {
          return init;
        }
      }
    }
    return undefined;
  }

  /**
   * Resolve module specifier to source file (best-effort), adding to project if on disk
   */
  private resolveModuleToSourceFile(currentFilePath: string, moduleSpecifier: string): SourceFile | undefined {
    const isVirtual = currentFilePath.startsWith('/virtual');
    let resolvedPath: string;
    if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
      const baseDir = path.dirname(path.resolve(currentFilePath));
      resolvedPath = path.resolve(baseDir, moduleSpecifier);
    } else if (moduleSpecifier.startsWith('@/') || moduleSpecifier.startsWith('#/')) {
      const projectRoot = this.findProjectRoot();
      if (moduleSpecifier.startsWith('@/')) {
        const relativePath = moduleSpecifier.substring(2);
        resolvedPath = isVirtual ? `/virtual/${[projectRoot.replace(/^\/+/, ''), 'src', relativePath].join('/')}` : path.join(projectRoot, 'src', relativePath);
      } else {
        const relativePath = moduleSpecifier.substring(2);
        resolvedPath = isVirtual ? `/virtual/${[projectRoot.replace(/^\/+/, ''), relativePath].join('/')}` : path.join(projectRoot, relativePath);
      }
    } else if (moduleSpecifier.startsWith('/')) {
      resolvedPath = isVirtual ? `/virtual/${moduleSpecifier.replace(/^\/+/, '')}` : path.resolve(moduleSpecifier);
    } else {
      // Try tsconfig paths mapping
      this.loadTsConfigPathsOnce();
      const mapped = this.resolveWithTsconfigPaths(moduleSpecifier, currentFilePath);
      if (!mapped) return undefined; // external or unsupported
      resolvedPath = mapped;
    }

    const knownExts = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];
    const hasKnownExt = knownExts.some(ext => resolvedPath.endsWith(ext));
    const extensionCandidates = hasKnownExt ? [''] : [...knownExts, '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
    for (const ext of extensionCandidates) {
      const tryPathRaw = resolvedPath + ext;
      const tryPath = resolvedPath.startsWith('/virtual/') ? tryPathRaw.replace(/\\/g, '/') : path.resolve(tryPathRaw);
      let sf = this.project.getSourceFile(tryPath);
      if (!sf && fs.existsSync(tryPath)) {
        try {
          sf = this.project.addSourceFileAtPath(tryPath);
        } catch {
          // ignore
        }
      }
      if (sf) return sf;
    }
    return undefined;
  }

  /**
   * Check if a declaration node represents a function
   */
  protected isFunctionDeclaration(decl: unknown): boolean {
    if (!decl || typeof decl !== 'object') {
      return false;
    }
    
    const node = decl as Node;
    return Node.isFunctionDeclaration(node) ||
           Node.isMethodDeclaration(node) ||
           Node.isFunctionExpression(node) ||
           Node.isArrowFunction(node);
  }

  /**
   * Get performance metrics from the profiler
   */
  getPerformanceMetrics() {
    return this.profiler.getMetrics();
  }

  /**
   * Print performance summary
   */
  printPerformanceSummary(): void {
    this.profiler.printSummary();
  }

  /**
   * Clear all caches including export declarations cache
   */
  async clearCache(): Promise<void> {
    const clearPromises: Promise<void>[] = [this.cache.clear()];
    
    // Only clear callEdgeCache if it has a clear method (avoid WeakMap issues)
    if ('clear' in this.callEdgeCache && typeof this.callEdgeCache.clear === 'function') {
      clearPromises.push(this.callEdgeCache.clear());
    }
    
    await Promise.all(clearPromises);
    this.exportDeclarationsByFile.clear();
    this.importResolutionCache.clear();
    // WeakMap doesn't need explicit clearing - it's garbage collected automatically
    // this.importIndexCache.clear(); // WeakMap has no clear method
  }
}
