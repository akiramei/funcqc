import { Project, Node } from 'ts-morph';
import * as path from 'path';
import { StorageAdapter } from '../types';
import * as fs from 'fs/promises';
import { FunctionInfo, CallEdge, TypeDefinition, TypeRelationship } from '../types';
import { BatchProcessor } from '../utils/batch-processor';
import { AnalysisCache, CacheStats } from '../utils/analysis-cache';
import { FunctionCacheProvider } from '../utils/cache-interfaces';
import { CacheAware } from '../utils/cache-injection';
import { CallGraphAnalyzer } from './call-graph-analyzer';
import { Logger } from '../utils/cli-utils';
import { UnifiedASTAnalyzer } from './unified-ast-analyzer';
import { BatchFileReader } from '../utils/batch-file-reader';
import { globalHashCache } from '../utils/hash-cache';
import { TypeSystemAnalyzer } from './type-system-analyzer';
import { SharedVirtualProjectManager } from '../core/shared-virtual-project-manager';
import { FunctionIdGenerator } from '../utils/function-id-generator';
import { TypeExtractionResult } from '../types/type-system';


/**
 * Configuration constants for TypeScript analyzer
 */
const ANALYZER_CONSTANTS = {
  // Memory management
  DEFAULT_MAX_SOURCE_FILES: 50,
  HIGH_MEMORY_USAGE_MULTIPLIER: 2,
  
  // TypeScript compiler options
  TARGET_ES_VERSION: 99, // ESNext
  JSX_MODE: 4, // Preserve
  
  // Performance thresholds
  MEMORY_WARNING_THRESHOLD_FACTOR: 2,
} as const;

/**
 * TypeScript analyzer using ts-morph for robust AST parsing
 * Optimized for large-scale projects with streaming and memory management
 */
export class TypeScriptAnalyzer extends CacheAware {
  private project: Project;
  private readonly maxSourceFilesInMemory: number;
  private cache: AnalysisCache;
  private functionCacheProvider: FunctionCacheProvider;
  private callGraphAnalyzer: CallGraphAnalyzer;
  private logger: Logger;
  
  
  
  private unifiedAnalyzer: UnifiedASTAnalyzer;
  private batchFileReader: BatchFileReader;
  private typeSystemAnalyzer: TypeSystemAnalyzer;
  private includeSourceCode: boolean;

  constructor(
    maxSourceFilesInMemory: number = ANALYZER_CONSTANTS.DEFAULT_MAX_SOURCE_FILES, 
    enableCache: boolean = true, 
    logger?: Logger,
    functionCacheProvider?: FunctionCacheProvider
  ) {
    super(functionCacheProvider);
    this.maxSourceFilesInMemory = maxSourceFilesInMemory;
    this.logger = logger || new Logger(false, false);
    this.functionCacheProvider = functionCacheProvider || this.functionCache;
    this.unifiedAnalyzer = new UnifiedASTAnalyzer(maxSourceFilesInMemory);
    const storeEnv = process.env['FUNCQC_STORE_SOURCECODE'];
    // デフォルトは保存（スナップショット再現性重視）。明示的に 'false' または '0' の場合のみ無効化。
    this.includeSourceCode = storeEnv ? !(storeEnv.toLowerCase() === 'false' || storeEnv === '0') : true;
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
      compilerOptions: {
        isolatedModules: true,
        skipLibCheck: true,
        noResolve: true,
        noLib: true,
        target: ANALYZER_CONSTANTS.TARGET_ES_VERSION, // ESNext
        jsx: ANALYZER_CONSTANTS.JSX_MODE, // Preserve
      },
    });

    // Initialize cache if enabled
    if (enableCache) {
      this.cache = new AnalysisCache({
        maxMemoryEntries: Math.max(500, maxSourceFilesInMemory * 10),
        persistentCachePath: path.join(process.cwd(), '.funcqc-cache'),
      });
    } else {
      this.cache = new AnalysisCache({
        maxMemoryEntries: 0,
      });
    }

    // Initialize call graph analyzer with shared Project instance
    // 🔧 CRITICAL FIX: Share Project instance to ensure consistent AST parsing and line numbers
    this.callGraphAnalyzer = new CallGraphAnalyzer(this.project, enableCache);
    
    // Initialize batch file reader for optimized I/O
    // Allow environment override for I/O concurrency (defaults to 10)
    const ioConcEnv = Number.parseInt(process.env['FUNCQC_IO_CONCURRENCY'] || '', 10);
    const ioConcurrency = !Number.isNaN(ioConcEnv) && ioConcEnv > 0
      ? Math.min(ioConcEnv, 64)
      : Math.min(maxSourceFilesInMemory, 10);
    this.batchFileReader = new BatchFileReader({
      concurrency: ioConcurrency,
      encoding: 'utf-8',
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      timeout: 30000 // 30 second timeout per file
    });
    
    // Initialize type system analyzer
    this.typeSystemAnalyzer = new TypeSystemAnalyzer(this.project, this.logger);
  }

  /**
   * Set storage adapter for function ID lookup in type system analysis
   */
  setStorage(storage: unknown): void {
    this.typeSystemAnalyzer.setStorage(storage as StorageAdapter);
  }

  /**
   * Analyze a TypeScript file and extract function information
   * Now uses UnifiedASTAnalyzer for improved performance  
   */
  async analyzeFile(filePath: string, _snapshotId?: string): Promise<FunctionInfo[]> {
    // Note: snapshotId no longer stored as instance state for thread safety
    // Read file content asynchronously
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`File does not exist: ${filePath}`);
      }
      throw error;
    }

    return this.analyzeFileContent(filePath, fileContent, _snapshotId || 'unknown');
  }

  /**
   * Analyze file content (used internally to avoid duplicate I/O)
   * Separated from analyzeFile to support BatchFileReader optimization
   */
  private async analyzeFileContent(filePath: string, fileContent: string, snapshotId: string): Promise<FunctionInfo[]> {
    try {
      // Check cache first using injected cache provider
      // But validate that the cached content is still fresh
      const currentFileHash = this.calculateFileHash(fileContent);
      try {
        const cachedResult = await this.functionCacheProvider.get(filePath);
        if (cachedResult && cachedResult.length > 0) {
          // Check if the cached result is still valid by comparing file hashes
          const cachedFileHash = cachedResult[0].fileHash;
          if (cachedFileHash === currentFileHash) {
            // Update cached functions with current snapshot info
            // IDs remain stable based on function signature, only update snapshot/hash
            return cachedResult.map(func => ({
              ...func,
              snapshotId,
              fileHash: currentFileHash,
            }));
          } else {
            // File has changed, cache is invalid - proceed with fresh analysis
            this.logger.debug(`File hash changed for ${filePath}, invalidating cache`);
          }
        }
      } catch (error) {
        this.logger.warn(
          `Cache retrieval failed for ${filePath}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }

      // Use UnifiedASTAnalyzer for combined analysis
      const unifiedResults = await this.unifiedAnalyzer.analyzeFile(filePath, fileContent);
      
      // Convert to FunctionInfo format and add missing fields
      // UnifiedASTAnalyzer already generates IDs, so we just complete the info
      const functions: FunctionInfo[] = unifiedResults.map(result => {
        const f = result.functionInfo;
        const qm = result.qualityMetrics ?? f.metrics;
        return {
          ...f,
          // Use ID from UnifiedASTAnalyzer (already generated)
          snapshotId,
          fileHash: currentFileHash,
          metrics: qm,
          ...(this.includeSourceCode && !f.sourceCode ? { sourceCode: fileContent } : {}),
        };
      });

      // Cache the results for future use using injected cache provider
      try {
        await this.functionCacheProvider.set(filePath, functions);
      } catch (error) {
        this.logger.warn(
          `Cache storage failed for ${filePath}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }

      // Remove source file from project to manage memory
      const sourceFile = this.project.getSourceFile(filePath);
      if (sourceFile) {
        sourceFile.forget();
      }

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Prepare shared virtual project for batch analysis
   * Creates or reuses cached project for optimal performance
   */
  async prepareSharedProject(
    snapshotId: string,
    fileContentMap: Map<string, string>
  ): Promise<{ project: import('ts-morph').Project; isNewlyCreated: boolean }> {
    return SharedVirtualProjectManager.getOrCreateProject(snapshotId, fileContentMap);
  }

  /**
   * Analyze TypeScript content from string instead of file
   * Used for analyzing stored file content with shared virtual project
   * Now uses UnifiedASTAnalyzer for single-pass analysis
   */
  async analyzeContent(content: string, virtualPath: string, snapshotId?: string): Promise<FunctionInfo[]> {
    try {
      // Use UnifiedASTAnalyzer for optimized single-pass analysis
      const unifiedResults = await this.unifiedAnalyzer.analyzeFile(virtualPath, content, snapshotId);
      
      // Map to complete FunctionInfo (ID/metrics/fileHash/snapshot補完)
      // UnifiedASTAnalyzer already generates IDs, so we just need to add missing fields
      const fileHash = this.calculateFileHash(content);
      const sid = snapshotId ?? 'unknown';
      const functions: FunctionInfo[] = unifiedResults.map(result => {
        const f = result.functionInfo;
        const withMetrics = result.qualityMetrics ?? f.metrics;
        return {
          ...f,
          // Use ID from UnifiedASTAnalyzer (already generated with correct snapshotId)
          snapshotId: sid,
          fileHash,
          metrics: withMetrics,
          ...(this.includeSourceCode && !f.sourceCode ? { sourceCode: content } : {}),
        };
      });

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to analyze content for ${virtualPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Analyze multiple files in batches for optimal memory usage
   * Uses BatchFileReader to eliminate duplicate I/O operations
   */
  async analyzeFilesBatch(
    filePaths: string[],
    onProgress?: (completed: number, total: number) => void,
    snapshotId?: string
  ): Promise<FunctionInfo[]> {
    const batchSize = Math.min(this.maxSourceFilesInMemory, 20); // Conservative batch size
    const allFunctions: FunctionInfo[] = [];

    // First, batch read all files to eliminate duplicate I/O
    this.logger.debug(`Reading ${filePaths.length} files in batches...`);
    const fileResults = await this.batchFileReader.readFiles(filePaths);
    
    // Filter successful reads
    const validFiles: Array<{ filePath: string; content: string }> = [];
    for (const [filePath, result] of fileResults) {
      if (result.exists && result.content && !result.error) {
        validFiles.push({ filePath, content: result.content });
      } else if (result.error) {
        this.logger.warn(
          `Failed to read ${filePath}`,
          { error: result.error.message }
        );
      }
    }

    this.logger.debug(`Successfully read ${validFiles.length}/${filePaths.length} files`);

    // Process files in batches to control memory usage
    const results = await BatchProcessor.processWithProgress(
      validFiles,
      async (fileData: { filePath: string; content: string }) => {
        try {
          return await this.analyzeFileContent(fileData.filePath, fileData.content, snapshotId || 'unknown');
        } catch (error) {
          // Log the error with file path for debugging
          this.logger.warn(
            `Failed to analyze ${fileData.filePath}`,
            { error: error instanceof Error ? error.message : String(error) }
          );
          // Return empty array to continue processing other files
          return [];
        }
      },
      onProgress ? (completed) => onProgress(completed, filePaths.length) : undefined,
      batchSize
    );

    // Flatten results
    for (const batch of results) {
      allFunctions.push(...batch);
    }

    return allFunctions;
  }

  /**
   * Stream analyze files one by one with callback for each file
   * Most memory-efficient approach for very large projects
   */
  async analyzeFilesStream(
    filePaths: string[],
    onFileAnalyzed: (filePath: string, functions: FunctionInfo[]) => Promise<void>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];

      try {
        const functions = await this.analyzeFile(filePath);
        await onFileAnalyzed(filePath, functions);
      } catch (error) {
        this.logger.warn(
          `Failed to analyze ${filePath}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
        await onFileAnalyzed(filePath, []);
      }

      if (onProgress) {
        onProgress(i + 1, filePaths.length);
      }

      // Force garbage collection every 100 files
      if (i % 100 === 0 && global.gc) {
        global.gc();
      }
    }
  }



  private calculateFileHash(content: string, modifiedTime?: Date): string {
    const hashes = globalHashCache.getOrCalculateHashes('temp', content, modifiedTime);
    return hashes.fileHash;
  }

  // These methods are kept for backward compatibility but now use global hash cache
  // private calculateASTHash(content: string): string {
  //   return globalHashCache.getOrCalculateASTHash(content);
  // }

  // private calculateSignatureHash(signature: string): string {
  //   return globalHashCache.getOrCalculateContentHash(signature);
  // }

  /**
   * Generate a deterministic UUID for the physical function instance
   */
  private generatePhysicalId(
    filePath: string,
    functionName: string,
    classNameOrContext: string | string[] | null,
    startLine: number,
    startColumn: number,
    snapshotId: string
  ): string {
    // Extract class name from context if it's an array
    let className: string | null = null;
    if (Array.isArray(classNameOrContext)) {
      className = classNameOrContext.length > 0 ? classNameOrContext[classNameOrContext.length - 1] : null;
    } else {
      className = classNameOrContext;
    }
    
    // Generate snapshot-specific physical ID to avoid duplicate key violations
    return FunctionIdGenerator.generateDeterministicUUID(
      filePath, // Will be normalized internally
      functionName,
      className,
      startLine,
      startColumn,
      snapshotId
    );
  }


  /**
   * Clean up all source files from memory
   */
  async cleanup(): Promise<void> {
    // Note: SourceFile removal disabled - shared Project usage requires SourceFiles to remain
    // Project disposal will be handled by parent FunctionAnalyzer
    
    // Cleanup cache using injected cache provider and legacy cache
    await this.cache.cleanup();
    if ('cleanup' in this.functionCacheProvider && typeof this.functionCacheProvider.cleanup === 'function') {
      await this.functionCacheProvider.cleanup();
    }
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): { sourceFilesInMemory: number; maxSourceFiles: number } {
    return {
      sourceFilesInMemory: this.project.getSourceFiles().length,
      maxSourceFiles: this.maxSourceFilesInMemory,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    // Return stats from the injected cache provider if available
    const injectedStats = this.functionCacheProvider.getStats();
    return {
      totalEntries: injectedStats.totalEntries,
      totalSize: 0, // Not available in simplified interface
      hitRate: injectedStats.hitRate,
      hits: injectedStats.hits,
      misses: injectedStats.misses
    };
  }

  /**
   * Get hash cache statistics
   */
  getHashCacheStats() {
    return globalHashCache.getStats();
  }

  /**
   * Clear hash cache
   */
  clearHashCache(): void {
    globalHashCache.clear();
  }

  /**
   * Analyze file and extract both functions and call edges
   * Returns comprehensive analysis including call graph relationships
   */
  async analyzeFileWithCallGraph(
    filePath: string
  ): Promise<{ functions: FunctionInfo[]; callEdges: CallEdge[] }> {
    // Read file content asynchronously
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`File does not exist: ${filePath}`);
      }
      throw error;
    }

    return this.analyzeFileContentWithCallGraph(filePath, fileContent);
  }

  /**
   * Analyze file content with call graph (used internally to avoid duplicate I/O)
   * Separated to support BatchFileReader optimization
   */
  private async analyzeFileContentWithCallGraph(
    filePath: string,
    _fileContent: string,
    snapshotId: string = 'unknown'
  ): Promise<{ functions: FunctionInfo[]; callEdges: CallEdge[] }> {
    try {
      // First, analyze functions normally
      const functions = await this.analyzeFileContent(filePath, _fileContent, snapshotId);
      
      // Create function map for call graph analysis
      const functionMap = new Map<string, { id: string; name: string; startLine: number; endLine: number }>();
      for (const func of functions) {
        functionMap.set(func.id, {
          id: func.id,
          name: func.name,
          startLine: func.startLine,
          endLine: func.endLine,
        });
      }

      // Analyze call graph if functions exist
      let callEdges: CallEdge[] = [];
      if (functions.length > 0) {
        try {
          // Build a minimal per-file declaration->id resolver using line proximity
          const getIdByDecl = (decl: Node): string | undefined => {
            const ds = decl.getStartLineNumber();
            const de = decl.getEndLineNumber();
            // find the closest FunctionInfo by start/end lines (±1 tolerance)
            let best: { id: string; dist: number } | undefined;
            for (const f of functions) {
              const d = Math.abs(f.startLine - ds) + Math.abs(f.endLine - de);
              if (d <= 2) { // ≤1+≤1
                if (!best || d < best.dist) best = { id: f.id, dist: d };
              }
            }
            return best?.id;
          };

          callEdges = await this.callGraphAnalyzer.analyzeFile(filePath, functionMap, getIdByDecl);
        } catch (error) {
          this.logger.warn(
            `Call graph analysis failed for ${filePath}`,
            { error: error instanceof Error ? error.message : String(error) }
          );
          // Continue with empty call edges rather than failing the entire analysis
        }
      }

      return { functions, callEdges };
    } catch (error) {
      throw new Error(
        `Failed to analyze file with call graph ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Batch analyze files with call graph support
   * Uses BatchFileReader to eliminate duplicate I/O operations
   */
  async analyzeFilesBatchWithCallGraph(
    filePaths: string[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<{ functions: FunctionInfo[]; callEdges: CallEdge[] }> {
    const batchSize = Math.min(this.maxSourceFilesInMemory, 20);
    const allFunctions: FunctionInfo[] = [];
    const allCallEdges: CallEdge[] = [];

    // First, batch read all files to eliminate duplicate I/O
    this.logger.debug(`Reading ${filePaths.length} files for call graph analysis...`);
    const fileResults = await this.batchFileReader.readFiles(filePaths);
    
    // Filter successful reads
    const validFiles: Array<{ filePath: string; content: string }> = [];
    for (const [filePath, result] of fileResults) {
      if (result.exists && result.content && !result.error) {
        validFiles.push({ filePath, content: result.content });
      } else if (result.error) {
        this.logger.warn(
          `Failed to read ${filePath}`,
          { error: result.error.message }
        );
      }
    }

    const results = await BatchProcessor.processWithProgress(
      validFiles,
      async (fileData: { filePath: string; content: string }) => {
        try {
          return await this.analyzeFileContentWithCallGraph(fileData.filePath, fileData.content);
        } catch (error) {
          this.logger.warn(
            `Failed to analyze ${fileData.filePath}`,
            { error: error instanceof Error ? error.message : String(error) }
          );
          return { functions: [], callEdges: [] };
        }
      },
      onProgress ? (completed) => onProgress(completed, filePaths.length) : undefined,
      batchSize
    );

    // Flatten results
    for (const batch of results) {
      allFunctions.push(...batch.functions);
      allCallEdges.push(...batch.callEdges);
    }

    return { functions: allFunctions, callEdges: allCallEdges };
  }

  /**
   * Get call graph analyzer statistics
   */
  getCallGraphStats(): CacheStats {
    return this.callGraphAnalyzer.getCacheStats();
  }

  /**
   * Clear call graph analyzer cache
   */
  clearCallGraphCache(): void {
    this.callGraphAnalyzer.clearCache();
  }

  /**
   * Extract type information from TypeScript files
   */
  async extractTypeInformation(filePaths: string[], snapshotId: string): Promise<TypeExtractionResult> {
    const sourceFiles = filePaths.map(filePath => {
      try {
        return this.project.addSourceFileAtPath(filePath);
      } catch (error) {
        this.logger.warn(`Failed to add source file: ${filePath}`, error);
        return null;
      }
    }).filter((sf): sf is NonNullable<typeof sf> => sf !== null);

    return this.typeSystemAnalyzer.extractTypeInformation(snapshotId, sourceFiles);
  }

  /**
   * Set shared project for performance optimization
   */
  setSharedProject(sharedProject: Project): void {
    this.project = sharedProject;
    // CRITICAL FIX: Recreate CallGraphAnalyzer with shared project to avoid inconsistency
    this.callGraphAnalyzer = new CallGraphAnalyzer(sharedProject, true, this.logger);
    // Keep type analysis consistent with the shared project
    this.typeSystemAnalyzer = new TypeSystemAnalyzer(sharedProject, this.logger);
  }

  /**
   * Extract type information from file contents (for virtual files)
   */
  async extractTypeInformationFromContents(
    fileContents: Map<string, string>,
    snapshotId: string
  ): Promise<TypeExtractionResult> {
    const sourceFiles = Array.from(fileContents.entries()).map(([filePath, content]) => {
      try {
        return this.project.createSourceFile(filePath, content, { overwrite: true });
      } catch (error) {
        this.logger.warn(`Failed to create virtual source file: ${filePath}`, error);
        return null;
      }
    }).filter((sf): sf is NonNullable<typeof sf> => sf !== null);

    return this.typeSystemAnalyzer.extractTypeInformation(snapshotId, sourceFiles);
  }

  /**
   * Extract type information from shared project (performance optimized)
   */
  async extractTypeInformationFromSharedProject(
    snapshotId: string
  ): Promise<TypeExtractionResult> {
    const sourceFiles = this.project.getSourceFiles();
    return this.typeSystemAnalyzer.extractTypeInformation(snapshotId, sourceFiles);
  }

  /**
   * Analyze types from a single file content
   * Used for lazy type system analysis
   */
  async analyzeTypesFromContent(
    filePath: string,
    fileContent: string
  ): Promise<{ types: TypeDefinition[]; relationships: TypeRelationship[] }> {
    try {
      const sourceFile = this.project.createSourceFile(filePath, fileContent, { overwrite: true });
      
      // Use a temporary snapshot ID for type extraction
      const tempSnapshotId = 'temp-type-analysis';
      const result = await this.typeSystemAnalyzer.extractTypeInformation(tempSnapshotId, [sourceFile]);
      
      return {
        types: result.typeDefinitions,
        relationships: result.typeRelationships
      };
    } catch (error) {
      this.logger.warn(`Failed to analyze types for ${filePath}`, error);
      return { types: [], relationships: [] };
    }
  }

  /**
   * Safely traverse parent nodes with callback
   * Currently unused but available for future parent traversal optimization
   */
  // private traverseParents(
  //   node: Node,
  //   callback: (parent: Node) => void | boolean
  // ): void {
  //   let current = node.getParent();
  //   while (current && !Node.isSourceFile(current)) {
  //     if (callback(current) === false) break;
  //     const next = current.getParent();
  //     if (!next) break;
  //     current = next;
  //   }
  // }
}
