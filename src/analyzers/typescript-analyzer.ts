import {
  Project,
  SourceFile,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  SyntaxKind,
  ClassDeclaration,
  ConstructorDeclaration,
  Node,
  ModuleDeclaration,
  VariableStatement,
} from 'ts-morph';
import * as path from 'path';
import { determineFunctionType } from './shared/function-type-utils';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { FunctionInfo, ParameterInfo, ReturnTypeInfo, CallEdge, TypeDefinition, TypeRelationship } from '../types';
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
import { FunctionIdGenerator } from '../utils/function-id-generator';
import { TypeExtractionResult } from '../types/type-system';

interface FunctionMetadata {
  signature: string;
  sourceCodeText: string;
  astHash: string;
  signatureHash: string;
  returnType: ReturnTypeInfo | undefined;
  contextPath: string[];
  modifiers: string[];
  functionType: 'function' | 'method' | 'arrow' | 'local';
  nestingLevel: number;
  startLine: number;
  startColumn: number;
}

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
  // Note: currentSnapshotId removed as physical IDs are now snapshot-independent
  
  // Static cache for QualityCalculator module to avoid repeated dynamic imports
  private static qualityCalculatorPromise: Promise<typeof import('../metrics/quality-calculator')> | null = null;
  
  /**
   * Get cached QualityCalculator module to avoid repeated dynamic imports
   */
  private static async getQualityCalculator(): Promise<typeof import('../metrics/quality-calculator')> {
    if (!TypeScriptAnalyzer.qualityCalculatorPromise) {
      TypeScriptAnalyzer.qualityCalculatorPromise = import('../metrics/quality-calculator');
    }
    return TypeScriptAnalyzer.qualityCalculatorPromise;
  }
  
  private unifiedAnalyzer: UnifiedASTAnalyzer;
  private batchFileReader: BatchFileReader;
  private typeSystemAnalyzer: TypeSystemAnalyzer;

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
    this.batchFileReader = new BatchFileReader({
      concurrency: Math.min(maxSourceFilesInMemory, 10),
      encoding: 'utf-8',
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      timeout: 30000 // 30 second timeout per file
    });
    
    // Initialize type system analyzer
    this.typeSystemAnalyzer = new TypeSystemAnalyzer(this.project, this.logger);
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
            // Generate new physical IDs for cached functions to ensure uniqueness
            return cachedResult.map(func => ({
              ...func,
              id: this.generatePhysicalId(filePath, func.name, func.contextPath || null, func.startLine, func.startColumn, snapshotId),
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
      const functions: FunctionInfo[] = unifiedResults.map(result => {
        const functionInfo = result.functionInfo;
        const qualityMetrics = result.qualityMetrics;
        
        return {
          ...functionInfo,
          id: this.generatePhysicalId(filePath, functionInfo.name, functionInfo.contextPath || null, functionInfo.startLine, functionInfo.startColumn, snapshotId), // Generate deterministic ID
          metrics: qualityMetrics,
          complexity: qualityMetrics.cyclomaticComplexity || 1
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
   * Analyze TypeScript content from string instead of file
   * Used for analyzing stored file content
   */
  async analyzeContent(content: string, virtualPath: string, snapshotId?: string): Promise<FunctionInfo[]> {
    const functions: FunctionInfo[] = [];
    
    try {
      // Create virtual source file from content
      const sourceFile = this.project.createSourceFile(virtualPath, content, {
        overwrite: true,
      });
      
      const relativePath = path.relative(process.cwd(), virtualPath);
      const fileHash = this.calculateFileHash(content);
      
      // Extract all function types
      for (const func of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
        const info = await this.extractFunctionInfo(func, relativePath, fileHash, sourceFile, snapshotId || 'unknown');
        if (info) functions.push(info);
      }
      
      for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
        const info = await this.extractMethodInfo(method, relativePath, fileHash, sourceFile, snapshotId || 'unknown');
        if (info) functions.push(info);
      }
      
      for (const classDecl of sourceFile.getClasses()) {
        for (const constructor of classDecl.getConstructors()) {
          const info = await this.extractConstructorInfo(
            constructor,
            relativePath,
            fileHash,
            sourceFile,
            snapshotId || 'unknown'
          );
          if (info) functions.push(info);
        }
      }
      
      // Arrow functions and function expressions
      const variableFunctions = await this.extractVariableFunctions(sourceFile, relativePath, fileHash, content, snapshotId || 'unknown');
      for (const info of variableFunctions) {
        functions.push(info);
      }
      
      // Clean up virtual source file
      this.project.removeSourceFile(sourceFile);
      this.manageMemory();
      
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

  private async extractFunctionInfo(
    func: FunctionDeclaration,
    relativePath: string,
    fileHash: string,
    _sourceFile: SourceFile,
    snapshotId: string = 'unknown'
  ): Promise<FunctionInfo | null> {
    const name = func.getName();
    if (!name) return null;

    const signature = this.getFunctionSignature(func);
    const sourceCodeText = func.getFullText().trim();
    const startLine = func.getStartLineNumber();
    const startColumn = func.getStart() - func.getStartLinePos();
    
    // Use optimized hash cache for all hash calculations
    const hashes = globalHashCache.getOrCalculateHashes(
      relativePath,
      sourceCodeText,
      undefined, // No modification time available
      signature
    );
    const astHash = hashes.astHash;
    const signatureHash = hashes.signatureHash;
    const returnType = this.extractFunctionReturnType(func);

    // Extract comprehensive function context
    const contextPath = this.extractContextPath(func);
    const modifiers = this.extractModifiers(func);
    const functionType = determineFunctionType(func);
    const nestingLevel = this.calculateNestingLevel(func);

    // Generate 3D identification system
    const className = contextPath.length > 0 ? contextPath[contextPath.length - 1] : null;
    const physicalId = this.generatePhysicalId(func.getSourceFile().getFilePath(), name, className, startLine, startColumn, snapshotId);
    const semanticId = this.generateSemanticId(
      relativePath,
      name,
      signature,
      contextPath,
      modifiers
    );
    const contentId = this.generateContentId(astHash, sourceCodeText);

    const functionInfo: FunctionInfo = {
      id: physicalId,
      snapshotId,
      semanticId,
      contentId,
      name,
      displayName: name,
      signature,
      signatureHash,
      filePath: relativePath,
      fileHash,
      startLine: func.getStartLineNumber(),
      endLine: func.getEndLineNumber(),
      startColumn: func.getStart() - func.getStartLinePos(),
      endColumn: func.getEnd() - func.getStartLinePos(),
      positionId: this.generatePositionId(relativePath, func.getStart(), func.getEnd()),
      astHash,

      // Enhanced function identification
      contextPath,
      functionType,
      modifiers,
      nestingLevel,

      // Existing function attributes
      isExported: func.isExported(),
      isAsync: func.isAsync(),
      isGenerator: !!func.getAsteriskToken(),
      isArrowFunction: false,
      isMethod: false,
      isConstructor: false,
      isStatic: false,
      sourceCode: sourceCodeText,
      parameters: this.extractParameters(func),
    };

    if (returnType) {
      functionInfo.returnType = returnType;
    }

    // Calculate metrics directly from ts-morph node while we have it
    const qualityCalculator = new (await import('../metrics/quality-calculator')).QualityCalculator();
    functionInfo.metrics = qualityCalculator.calculateFromTsMorphNode(func, functionInfo);

    return functionInfo;
  }

  private async extractMethodInfo(
    method: MethodDeclaration,
    relativePath: string,
    fileHash: string,
    _sourceFile: SourceFile,
    snapshotId: string = 'unknown'
  ): Promise<FunctionInfo | null> {
    const name = method.getName();
    if (!name) return null;

    // Safely get the parent class name
    const parent = method.getParent();
    let className = 'Unknown';
    
    // Check if the parent is a ClassDeclaration
    if (parent && parent.getKind() === SyntaxKind.ClassDeclaration) {
      const classDecl = parent as ClassDeclaration;
      const parentName = classDecl.getName();
      if (parentName) {
        className = parentName;
      }
    }
    
    const fullName = name === 'constructor' ? `${className}.constructor` : `${className}.${name}`;
    const signature = this.getMethodSignature(method, className);
    const sourceCodeText = method.getFullText().trim();
    const startLine = method.getStartLineNumber();
    const startColumn = method.getStart() - method.getStartLinePos();
    
    // Use optimized hash cache for all hash calculations
    const hashes = globalHashCache.getOrCalculateHashes(
      relativePath,
      sourceCodeText,
      undefined, // No modification time available
      signature
    );
    const astHash = hashes.astHash;
    const signatureHash = hashes.signatureHash;

    const methodParent = method.getParent();
    let isClassExported = false;
    if (methodParent && methodParent.getKind() === SyntaxKind.ClassDeclaration) {
      isClassExported = (methodParent as ClassDeclaration).isExported();
    }

    const returnType = this.extractMethodReturnType(method);

    // Extract comprehensive function context
    const contextPath = this.extractContextPath(method);
    const modifiers = this.extractModifiers(method);
    const functionType = determineFunctionType(method);
    const nestingLevel = this.calculateNestingLevel(method);

    // Generate 3D identification system
    const physicalId = this.generatePhysicalId(method.getSourceFile().getFilePath(), fullName, className, startLine, startColumn, snapshotId);
    const semanticId = this.generateSemanticId(
      relativePath,
      fullName,
      signature,
      contextPath,
      modifiers
    );
    const contentId = this.generateContentId(astHash, sourceCodeText);

    const functionInfo: FunctionInfo = {
      id: physicalId,
      snapshotId,
      semanticId,
      contentId,
      name: name,
      displayName: fullName,
      signature,
      signatureHash,
      filePath: relativePath,
      fileHash,
      startLine: method.getStartLineNumber(),
      endLine: method.getEndLineNumber(),
      startColumn: method.getStart() - method.getStartLinePos(),
      endColumn: method.getEnd() - method.getStartLinePos(),
      positionId: this.generatePositionId(relativePath, method.getStart(), method.getEnd()),
      astHash,

      // Enhanced function identification
      contextPath,
      functionType,
      modifiers,
      nestingLevel,
      className,

      // Existing function attributes
      isExported: isClassExported,
      isAsync: method.isAsync(),
      isGenerator: !!method.getAsteriskToken(),
      isArrowFunction: false,
      isMethod: true,
      isConstructor: false,
      isStatic: method.isStatic(),
      sourceCode: sourceCodeText,
      parameters: this.extractParameters(method),
    };

    if (returnType) {
      functionInfo.returnType = returnType;
    }

    // Note: accessModifier and contextPath are now handled by UnifiedASTAnalyzer

    // Calculate metrics directly from ts-morph node while we have it
    const qualityCalculator = new (await import('../metrics/quality-calculator')).QualityCalculator();
    functionInfo.metrics = qualityCalculator.calculateFromTsMorphNode(method, functionInfo);

    return functionInfo;
  }

  private async extractConstructorInfo(
    ctor: ConstructorDeclaration,
    relativePath: string,
    fileHash: string,
    _sourceFile: SourceFile,
    snapshotId: string = 'unknown'
  ): Promise<FunctionInfo | null> {
    const className = (ctor.getParent() as ClassDeclaration)?.getName() || 'Unknown';
    const fullName = `${className}.constructor`;
    const signature = this.getConstructorSignature(ctor, className);
    const sourceCodeText = ctor.getFullText().trim();
    const startLine = ctor.getStartLineNumber();
    const startColumn = ctor.getStart() - ctor.getStartLinePos();
    
    // Use optimized hash cache for all hash calculations
    const hashes = globalHashCache.getOrCalculateHashes(
      relativePath,
      sourceCodeText,
      undefined, // No modification time available
      signature
    );
    const astHash = hashes.astHash;
    const signatureHash = hashes.signatureHash;

    const parent = ctor.getParent();
    let isClassExported = false;
    if (parent && parent.getKind() === SyntaxKind.ClassDeclaration) {
      isClassExported = (parent as ClassDeclaration).isExported();
    }

    // Extract comprehensive function context
    const contextPath = this.extractConstructorContextPath(ctor);
    const modifiers: string[] = [];
    if (isClassExported) modifiers.push('exported');

    const functionType = 'method'; // Constructors are a type of method
    const nestingLevel = this.calculateConstructorNestingLevel(ctor);

    // Generate 3D identification system
    const physicalId = this.generatePhysicalId(ctor.getSourceFile().getFilePath(), fullName, className, startLine, startColumn, snapshotId);
    const semanticId = this.generateSemanticId(
      relativePath,
      fullName,
      signature,
      contextPath,
      modifiers
    );
    const contentId = this.generateContentId(astHash, sourceCodeText);

    const functionInfo: FunctionInfo = {
      id: physicalId,
      snapshotId,
      semanticId,
      contentId,
      name: 'constructor',
      displayName: fullName,
      signature,
      signatureHash,
      filePath: relativePath,
      fileHash,
      startLine: ctor.getStartLineNumber(),
      endLine: ctor.getEndLineNumber(),
      startColumn: ctor.getStart() - ctor.getStartLinePos(),
      endColumn: ctor.getEnd() - ctor.getStartLinePos(),
      positionId: this.generatePositionId(relativePath, ctor.getStart(), ctor.getEnd()),
      astHash,

      // Enhanced function identification
      contextPath,
      functionType,
      modifiers,
      nestingLevel,
      className,

      // Existing function attributes
      isExported: isClassExported,
      isAsync: false,
      isGenerator: false,
      isArrowFunction: false,
      isMethod: false,
      isConstructor: true,
      isStatic: false,
      sourceCode: sourceCodeText,
      parameters: this.extractParameters(ctor),
    };

    const scope = ctor.getScope();
    if (scope && scope !== 'public') {
      functionInfo.accessModifier = scope;
    }

    // Calculate metrics directly from ts-morph node while we have it
    const qualityCalculator = new (await import('../metrics/quality-calculator')).QualityCalculator();
    functionInfo.metrics = qualityCalculator.calculateFromTsMorphNode(ctor, functionInfo);

    return functionInfo;
  }

  /**
   * Extracts function node from variable declaration initializer
   */
  private extractFunctionNodeFromVariable(initializer: Node): ArrowFunction | FunctionExpression | null {
    if (initializer.getKind() === SyntaxKind.ArrowFunction) {
      return initializer as ArrowFunction;
    } else if (initializer.getKind() === SyntaxKind.FunctionExpression) {
      return initializer as FunctionExpression;
    }
    return null;
  }

  /**
   * Extracts metadata for a function node
   */
  private extractFunctionMetadata(
    functionNode: ArrowFunction | FunctionExpression,
    name: string,
    stmt: VariableStatement
  ): FunctionMetadata {
    const signature = this.getArrowFunctionSignature(name, functionNode);
    const sourceCodeText = functionNode.getFullText().trim();
    
    // Use optimized hash cache for all hash calculations
    const hashes = globalHashCache.getOrCalculateHashes(
      'temp', // No file path available in this context
      sourceCodeText,
      undefined, // No modification time available
      signature
    );
    const astHash = hashes.astHash;
    const signatureHash = hashes.signatureHash;
    const returnType = this.extractArrowFunctionReturnType(functionNode);

    const contextPath = this.extractContextPath(functionNode as ArrowFunction);
    const modifiers: string[] = [];
    if (functionNode.isAsync()) modifiers.push('async');
    if (stmt.isExported()) modifiers.push('exported');

    const functionType = determineFunctionType(functionNode as ArrowFunction) as 'function' | 'method' | 'arrow' | 'local';
    const nestingLevel = this.calculateNestingLevel(functionNode as ArrowFunction);

    const startLine = functionNode.getStartLineNumber();
    const startColumn = functionNode.getStart() - functionNode.getStartLinePos();
    
    return {
      signature,
      sourceCodeText,
      astHash,
      signatureHash,
      returnType,
      contextPath,
      modifiers,
      functionType,
      nestingLevel,
      startLine,
      startColumn,
    };
  }

  /**
   * Creates FunctionInfo object from extracted metadata
   */
  private async createVariableFunctionInfo(
    functionNode: ArrowFunction | FunctionExpression,
    name: string,
    metadata: FunctionMetadata,
    relativePath: string,
    fileHash: string,
    stmt: VariableStatement,
    snapshotId: string = 'unknown'
  ): Promise<FunctionInfo> {
    const className = metadata.contextPath.length > 0 ? metadata.contextPath[metadata.contextPath.length - 1] : null;
    const physicalId = this.generatePhysicalId(stmt.getSourceFile().getFilePath(), name, className, metadata.startLine, metadata.startColumn, snapshotId);
    const semanticId = this.generateSemanticId(
      relativePath,
      name,
      metadata.signature,
      metadata.contextPath,
      metadata.modifiers
    );
    const contentId = this.generateContentId(metadata.astHash, metadata.sourceCodeText);

    const functionInfo: FunctionInfo = {
      id: physicalId,
      snapshotId,
      semanticId,
      contentId,
      name,
      displayName: name,
      signature: metadata.signature,
      signatureHash: metadata.signatureHash,
      filePath: relativePath,
      fileHash,
      startLine: functionNode.getStartLineNumber(),
      endLine: functionNode.getEndLineNumber(),
      startColumn: functionNode.getStart() - functionNode.getStartLinePos(),
      endColumn: functionNode.getEnd() - functionNode.getStartLinePos(),
      positionId: this.generatePositionId(relativePath, functionNode.getStart(), functionNode.getEnd()),
      astHash: metadata.astHash,
      contextPath: metadata.contextPath,
      functionType: metadata.functionType,
      modifiers: metadata.modifiers,
      nestingLevel: metadata.nestingLevel,
      isExported: stmt.isExported(),
      isAsync: functionNode.isAsync(),
      isGenerator:
        functionNode.getKind() === SyntaxKind.FunctionExpression
          ? !!(functionNode as FunctionExpression).getAsteriskToken()
          : false,
      isArrowFunction: functionNode.getKind() === SyntaxKind.ArrowFunction,
      isMethod: false,
      isConstructor: false,
      isStatic: false,
      sourceCode: metadata.sourceCodeText,
      parameters: this.extractParameters(functionNode),
    };

    if (metadata.returnType) {
      functionInfo.returnType = metadata.returnType;
    }

    // Calculate metrics directly from ts-morph node while we have it
    const { QualityCalculator } = await TypeScriptAnalyzer.getQualityCalculator();
    const qualityCalculator = new QualityCalculator();
    functionInfo.metrics = qualityCalculator.calculateFromTsMorphNode(functionNode, functionInfo);

    return functionInfo;
  }

  private async extractVariableFunctions(
    sourceFile: SourceFile,
    relativePath: string,
    fileHash: string,
    _fileContent: string,
    snapshotId: string = 'unknown'
  ): Promise<FunctionInfo[]> {
    const functions: FunctionInfo[] = [];

    for (const stmt of sourceFile.getVariableStatements()) {
      for (const decl of stmt.getDeclarations()) {
        const initializer = decl.getInitializer();
        if (!initializer) continue;

        const name = decl.getName();
        const functionNode = this.extractFunctionNodeFromVariable(initializer);

        if (functionNode) {
          const metadata = this.extractFunctionMetadata(functionNode, name, stmt);
          const functionInfo = await this.createVariableFunctionInfo(functionNode, name, metadata, relativePath, fileHash, stmt, snapshotId);
          functions.push(functionInfo);
        }
      }
    }

    return functions;
  }

  private getFunctionSignature(func: FunctionDeclaration): string {
    const name = func.getName() || 'anonymous';
    const params = func
      .getParameters()
      .map(p => p.getText())
      .join(', ');
    const returnType = func.getReturnTypeNode()?.getText() || 'void';
    const asyncModifier = func.isAsync() ? 'async ' : '';

    return `${asyncModifier}${name}(${params}): ${returnType}`;
  }

  private getMethodSignature(method: MethodDeclaration, className: string): string {
    const name = method.getName();
    const params = method
      .getParameters()
      .map(p => p.getText())
      .join(', ');
    const returnType = method.getReturnTypeNode()?.getText() || 'void';
    const asyncModifier = method.isAsync() ? 'async ' : '';
    const accessibility = method.getScope() || 'public';

    return `${accessibility} ${asyncModifier}${className}.${name}(${params}): ${returnType}`;
  }

  private getArrowFunctionSignature(
    name: string,
    func: ArrowFunction | FunctionExpression
  ): string {
    const params = func
      .getParameters()
      .map(p => p.getText())
      .join(', ');
    const returnType = func.getReturnTypeNode()?.getText() || 'unknown';
    const asyncModifier = func.isAsync() ? 'async ' : '';

    return `${asyncModifier}${name} = (${params}): ${returnType} => {...}`;
  }

  private getConstructorSignature(ctor: ConstructorDeclaration, className: string): string {
    const params = ctor
      .getParameters()
      .map(p => p.getText())
      .join(', ');
    const accessibility = ctor.getScope() || 'public';

    return `${accessibility} ${className}(${params})`;
  }

  /**
   * Extract parameters from any function-like node
   * Unified method to handle all function types consistently
   */
  private extractParameters(
    node:
      | FunctionDeclaration
      | MethodDeclaration
      | ArrowFunction
      | FunctionExpression
      | ConstructorDeclaration
  ): ParameterInfo[] {
    return node.getParameters().map((param, index) => {
      const paramInfo: ParameterInfo = {
        name: param.getName(),
        type: param.getTypeNode()?.getText() || 'any',
        typeSimple: this.simplifyType(param.getTypeNode()?.getText() || 'any'),
        position: index,
        isOptional: param.hasQuestionToken(),
        isRest: param.isRestParameter(),
      };

      const defaultValue = param.getInitializer()?.getText();
      if (defaultValue) {
        paramInfo.defaultValue = defaultValue;
      }

      return paramInfo;
    });
  }


  private extractFunctionReturnType(func: FunctionDeclaration): ReturnTypeInfo | undefined {
    const returnTypeNode = func.getReturnTypeNode();
    if (!returnTypeNode) return undefined;

    const typeText = returnTypeNode.getText();
    const returnInfo: ReturnTypeInfo = {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<'),
    };

    const promiseType = this.extractPromiseType(typeText);
    if (promiseType) {
      returnInfo.promiseType = promiseType;
    }

    return returnInfo;
  }

  private extractMethodReturnType(method: MethodDeclaration): ReturnTypeInfo | undefined {
    const returnTypeNode = method.getReturnTypeNode();
    if (!returnTypeNode) return undefined;

    const typeText = returnTypeNode.getText();
    const returnInfo: ReturnTypeInfo = {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<'),
    };

    const promiseType = this.extractPromiseType(typeText);
    if (promiseType) {
      returnInfo.promiseType = promiseType;
    }

    return returnInfo;
  }

  private extractArrowFunctionReturnType(
    func: ArrowFunction | FunctionExpression
  ): ReturnTypeInfo | undefined {
    const returnTypeNode = func.getReturnTypeNode();
    if (!returnTypeNode) return undefined;

    const typeText = returnTypeNode.getText();
    const returnInfo: ReturnTypeInfo = {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<'),
    };

    const promiseType = this.extractPromiseType(typeText);
    if (promiseType) {
      returnInfo.promiseType = promiseType;
    }

    return returnInfo;
  }


  private simplifyType(typeText: string): string {
    if (typeText.includes('string')) return 'string';
    if (typeText.includes('number')) return 'number';
    if (typeText.includes('boolean')) return 'boolean';
    if (typeText.includes('Promise<')) return 'Promise';
    if (typeText.includes('[]')) return 'array';
    if (typeText.includes('{}') || typeText.includes('object')) return 'object';
    return typeText;
  }

  private extractPromiseType(typeText: string): string | undefined {
    const match = typeText.match(/Promise<(.+)>/);
    return match?.[1];
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
   * Generate a semantic ID that identifies the same function role across versions
   * Excludes position information for stability during refactoring
   */
  private generateSemanticId(
    filePath: string,
    name: string,
    signature: string,
    contextPath: string[],
    modifiers: string[]
  ): string {
    const components = [
      filePath,
      ...contextPath,
      name || '<anonymous>',
      signature,
      ...modifiers.sort(),
      // Position information deliberately excluded for stability
    ];

    return crypto.createHash('sha256').update(components.join('|')).digest('hex');
  }

  /**
   * Generate a content ID that identifies the same implementation
   * Changes when function body or AST structure changes
   * Uses raw source code instead of AST hash to ensure implementation differences are captured
   */
  private generateContentId(astHash: string, sourceCode: string): string {
    // Primary component: the actual source code (trimmed but preserving structure)
    const normalizedSource = sourceCode.trim()
      .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, '') // Remove multiline comments
      .replace(/\/\/.*$/gm, '') // Remove single-line comments
      .replace(/^\s+/gm, '') // Remove leading whitespace
      .replace(/\s+$/gm, ''); // Remove trailing whitespace
    
    // Secondary component: AST hash for additional structural information
    const contentComponents = [normalizedSource, astHash];

    return crypto.createHash('sha256').update(contentComponents.join('|')).digest('hex');
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
   * Extract hierarchical context path for a function
   */
  private extractContextPath(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | ConstructorDeclaration | FunctionExpression
  ): string[] {
    return this.traverseParents(node, (parent) => {
      if (parent.getKind() === SyntaxKind.ClassDeclaration) {
        return (parent as ClassDeclaration).getName();
      } else if (parent.getKind() === SyntaxKind.ModuleDeclaration) {
        return (parent as ModuleDeclaration).getName();
      } else if (parent.getKind() === SyntaxKind.FunctionDeclaration) {
        return (parent as FunctionDeclaration).getName();
      }
      return undefined;
    });
  }

  /**
   * Extract function modifiers as string array
   */
  private extractModifiers(node: FunctionDeclaration | MethodDeclaration): string[] {
    if (Node.isFunctionDeclaration(node)) {
      return this.extractFunctionModifiers(node);
    }
    
    if (Node.isMethodDeclaration(node)) {
      return this.extractMethodModifiers(node);
    }
    
    return [];
  }

  /**
   * Extract modifiers specific to function declarations
   */
  private extractFunctionModifiers(node: FunctionDeclaration): string[] {
    const modifiers: string[] = [];
    
    if (node.isAsync()) modifiers.push('async');
    if (node.isExported()) modifiers.push('exported');
    if (node.getAsteriskToken()) modifiers.push('generator');
    
    return modifiers;
  }

  /**
   * Extract modifiers specific to method declarations
   */
  private extractMethodModifiers(node: MethodDeclaration): string[] {
    const modifiers: string[] = [];
    
    if (node.isAsync()) modifiers.push('async');
    if (node.isStatic()) modifiers.push('static');
    if (node.getAsteriskToken()) modifiers.push('generator');

    // Extract access modifier (public, private, protected)
    const accessModifier = node
      .getModifiers()
      .find(m =>
        [
          SyntaxKind.PublicKeyword,
          SyntaxKind.PrivateKeyword,
          SyntaxKind.ProtectedKeyword,
        ].includes(m.getKind())
      );
    
    if (accessModifier) {
      modifiers.push(accessModifier.getText());
    } else {
      modifiers.push('public'); // Default access modifier in TypeScript
    }
    
    return modifiers;
  }

  // Removed: determineFunctionType - now using shared implementation

  /**
   * Calculate nesting level for the function
   */
  private calculateNestingLevel(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | ConstructorDeclaration | FunctionExpression
  ): number {
    return this.countParents(node, (parent) => {
      return (
        Node.isFunctionDeclaration(parent) ||
        Node.isMethodDeclaration(parent) ||
        Node.isArrowFunction(parent) ||
        Node.isFunctionExpression(parent) ||
        Node.isConstructorDeclaration(parent)
      );
    });
  }

  /**
   * Extract hierarchical context path for a constructor
   */
  private extractConstructorContextPath(ctor: ConstructorDeclaration): string[] {
    const path: string[] = [];

    // For constructors, we know the immediate parent is a class
    const parent = ctor.getParent();
    if (parent && parent.getKind() === SyntaxKind.ClassDeclaration) {
      const className = (parent as ClassDeclaration).getName();
      if (className) path.push(className);
    }

    return path;
  }

  /**
   * Calculate nesting level for a constructor
   */
  private calculateConstructorNestingLevel(_ctor: ConstructorDeclaration): number {
    // Constructors are not typically nested, but we can check for nested classes
    return 0;
  }

  /**
   * Generic utility to traverse parent nodes and extract values
   */
  private traverseParents(
    node: Node,
    extractor: (parent: Node) => string | undefined
  ): string[] {
    const results: string[] = [];
    let current = node.getParent();

    while (current && !Node.isSourceFile(current)) {
      const extracted = extractor(current);
      if (extracted) {
        results.unshift(extracted);
      }
      const nextParent = current.getParent();
      if (!nextParent) break;
      current = nextParent;
    }

    return results;
  }

  /**
   * Generic utility to count parent nodes matching a condition
   */
  private countParents(
    node: Node,
    condition: (parent: Node) => boolean
  ): number {
    let count = 0;
    let current = node.getParent();

    while (current && !Node.isSourceFile(current)) {
      if (condition(current)) {
        count++;
      }
      const nextParent = current.getParent();
      if (!nextParent) break;
      current = nextParent;
    }

    return count;
  }

  /**
   * Manage memory by cleaning up project if too many source files are loaded
   */
  private manageMemory(): void {
    const sourceFiles = this.project.getSourceFiles();
    const warningThreshold = this.maxSourceFilesInMemory * ANALYZER_CONSTANTS.MEMORY_WARNING_THRESHOLD_FACTOR;
    
    if (sourceFiles.length > warningThreshold) {
      this.logger.warn(`Warning: ${sourceFiles.length} SourceFiles in memory (threshold: ${warningThreshold})`);
      
      // Force garbage collection if available (Node.js with --expose-gc)
      if (global.gc && sourceFiles.length > this.maxSourceFilesInMemory * 2) {
        this.logger.debug('Forcing garbage collection due to high memory usage');
        global.gc();
      }
      
      // Remove oldest virtual source files if memory usage is critical
      if (sourceFiles.length > this.maxSourceFilesInMemory * 3) {
        const virtualFiles = sourceFiles.filter(sf => sf.getFilePath().includes('virtual-'));
        if (virtualFiles.length > 0) {
          // Remove oldest 20% of virtual files
          const toRemove = Math.floor(virtualFiles.length * 0.2);
          for (let i = 0; i < toRemove; i++) {
            this.project.removeSourceFile(virtualFiles[i]);
          }
          this.logger.debug(`Removed ${toRemove} virtual source files to manage memory`);
        }
      }
    }
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
