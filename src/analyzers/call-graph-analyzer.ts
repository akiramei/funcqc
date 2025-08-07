import {
  Project,
  SourceFile,
  CallExpression,
  Node,
  TypeChecker,
} from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';
import { CallEdge } from '../types';
import { AnalysisCache, CacheStats } from '../utils/analysis-cache';
import { CacheProvider } from '../utils/cache-interfaces';
import { CacheServiceLocator } from '../utils/cache-injection';
import { buildImportIndex, resolveCallee, CalleeResolution } from './symbol-resolver';
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
  private importResolutionCache: Map<string, Node | undefined> = new Map();
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
   * Extract call expressions from a function node
   */
  private extractCallExpressions(functionNode: Node): CallExpression[] {
    const callExpressions: CallExpression[] = [];
    functionNode.forEachDescendant((node, traversal) => {
      if (Node.isCallExpression(node)) {
        callExpressions.push(node);
      }
      // Skip traversing into nested function declarations
      if (this.isFunctionDeclaration(node) && node !== functionNode) {
        traversal.skip();
      }
    });
    return callExpressions;
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
    importIndex: Map<string, { module: string; kind: "namespace" | "named" | "default" | "require"; local: string; imported?: string }>,
    allowedFunctionIdSet: Set<string>,
    getFunctionIdByDeclaration: (decl: Node) => string | undefined
  ): Promise<CallEdge[]> {
    const callEdges: CallEdge[] = [];
    let idMismatchCount = 0;
    let resolvedCount = 0;

    for (const callExpr of callExpressions) {
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
            this.logger?.debug(`ID mismatch: Resolved function ID ${resolution.functionId} not found in allowed functions set (${resolution.via})`);
            continue;
          }
          const callEdge = this.createCallEdgeFromResolution(
            callExpr,
            sourceFunctionId,
            resolution
          );
          callEdges.push(callEdge);
        }
        // External calls are ignored as they don't contribute to circular dependencies
        // Unknown calls are also ignored as they're likely external or unresolvable
      } catch (error) {
        // Continue processing other calls if one fails
        this.logger?.warn(`Failed to resolve call in ${filePath}:${callExpr.getStartLineNumber()}: ${error}`);
      }
    }

    // Report statistics (CRITICAL for debugging ID space issues)
    if (resolvedCount > 0 || idMismatchCount > 0) {
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
      const importIndex = buildImportIndex(sourceFile);
      this.profiler.recordDetail('import_index_building', 'imports_processed', importIndex.size);
      this.profiler.endPhase();
      
      // Clean up debug logging - import index construction is working correctly

      // Get all function nodes in the file
      this.profiler.startPhase('function_node_discovery');
      const functionNodes = this.getAllFunctionNodes(sourceFile);
      this.profiler.recordDetail('function_node_discovery', 'nodes_found', functionNodes.length);
      this.profiler.endPhase();
      
      // Build function node index for efficient lookup (using local functions only)
      this.profiler.startPhase('function_index_building');
      const localDeclIndex = this.buildFunctionNodeIndex(functionNodes, functionMap);
      this.profiler.recordDetail('function_index_building', 'mappings_created', localDeclIndex.size);
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
          if (functionInfo.name === 'performSingleFunctionAnalysis') {
            console.log(`🅱️ STEP B: Function node found for ${functionInfo.name}`);
            console.log(`   Node lines: ${functionNode.getStartLineNumber()}-${functionNode.getEndLineNumber()}`);
          }
          // Extract call expressions from function body
          const callExpressions = this.extractCallExpressions(functionNode);
          

          // Process call expressions and create call edges
          const functionCallEdges = await this.processCallEdges(
            callExpressions,
            functionInfo.id,
            filePath,
            sourceFile,
            typeChecker,
            importIndex,
            actualAllowedFunctionIdSet,
            declarationLookup
          );
          
          
          callEdges.push(...functionCallEdges);
        }
      }

      this.profiler.endPhase(); // End file_analysis phase
      
      // Print performance summary if debug logging is enabled
      if (process.env['FUNCQC_DEBUG_PERFORMANCE']) {
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
    
    const cacheKey = `${moduleSpecifier}:${exportedName}`;
    
    // Check if we have cached result for this specific import resolution
    if (this.importResolutionCache.has(cacheKey)) {
      this.profiler.recordDetail('import_resolution', 'cache_hits', 1);
      return this.importResolutionCache.get(cacheKey)!;
    }

    this.profiler.recordDetail('import_resolution', 'cache_misses', 1);
    
    return measureSync(() => {
      if (exportedName === 'buildDependencyTree') {
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
        
        if (exportedName === 'buildDependencyTree') {
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
            resolvedPath = path.join('/virtual', projectRoot, 'src', relativePath);
          } else {
            resolvedPath = path.join(projectRoot, 'src', relativePath);
          }
        } else if (moduleSpecifier.startsWith('#/')) {
          // #/ -> project root mapping
          const relativePath = moduleSpecifier.substring(2); // Remove '#/'
          if (isVirtual) {
            resolvedPath = path.join('/virtual', projectRoot, relativePath);
          } else {
            resolvedPath = path.join(projectRoot, relativePath);
          }
        } else {
          return undefined;
        }
      } else if (moduleSpecifier.startsWith('/')) {
        // 🔧 CRITICAL FIX: Absolute path with proper handling
        if (isVirtual) {
          resolvedPath = path.join('/virtual', moduleSpecifier);
        } else {
          resolvedPath = path.resolve(moduleSpecifier);
        }
      } else {
        // External module or unsupported pattern
        this.profiler.recordDetail('import_resolution', 'external_modules', 1);
        return undefined;
      }
      
      // Try to find the source file with comprehensive extension support
      const extensionCandidates = [
        '.ts', '.tsx',           // TypeScript files
        '.js', '.jsx',           // JavaScript files  
        '.mts', '.cts',          // TS 4.7+ ESM/CJS modules
        '/index.ts', '/index.tsx', // Index files
        '/index.js', '/index.jsx'
      ];
      
      let targetSourceFile;
      for (const ext of extensionCandidates) {
        const tryPathRaw = resolvedPath + ext;
        
        // 🔧 CRITICAL FIX: パス正規化（ts-morph は登録時の表記差で取りこぼしが出ます）
        const tryPath = path.resolve(tryPathRaw);

        targetSourceFile = this.project.getSourceFile(tryPath);
        
        // 🔧 CRITICAL FIX: インポート先ファイルの遅延ロード
        if (!targetSourceFile && fs.existsSync(tryPath)) {
          try {
            targetSourceFile = this.project.addSourceFileAtPath(tryPath);
            if (exportedName === 'buildDependencyTree') {
              console.log(`       📥 Added target source file: ${tryPath}`);
            }
            this.logger?.debug(`Added missing source file: ${tryPath}`);
          } catch (e) {
            this.logger?.debug(`Failed to add source file: ${tryPath}: ${String(e)}`);
          }
        }

        if (targetSourceFile) {
          if (exportedName === 'buildDependencyTree') {
            console.log(`       ✅ Found target source file: ${tryPath}`);
          }
          this.logger?.debug(`🔍 FOUND: ${tryPath}`);
          break;
        } else if (exportedName === 'buildDependencyTree') {
          console.log(`       ❌ Not found: ${tryPath}`);
        }
      }
      
      this.logger?.debug(`Target source file: ${targetSourceFile?.getFilePath() || 'not found'}`);
      
      if (targetSourceFile) {
        this.profiler.recordDetail('import_resolution', 'files_found', 1);
        
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
        
        // Find the exported function
        const decls = fileExportsCache.get(exportedName);
        this.logger?.debug(`Exported declarations for ${exportedName}: ${decls?.length || 0} found`);
        
        if (decls && decls.length > 0) {
          // Return the first declaration (function/method)
          for (const decl of decls) {
            this.logger?.debug(`Checking declaration: ${decl.getKindName()}`);
            if (this.isFunctionDeclaration(decl)) {
              this.logger?.debug(`Found function declaration for ${exportedName}`);
              this.profiler.recordDetail('import_resolution', 'successful_resolutions', 1);
              // Cache the successful result
              this.importResolutionCache.set(cacheKey, decl);
              return decl;
            }
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
    await Promise.all([
      this.cache.clear(),
      this.callEdgeCache.clear()
    ]);
    this.exportDeclarationsByFile.clear();
    this.importResolutionCache.clear();
  }
}