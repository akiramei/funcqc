import { FunctionInfo, FuncqcConfig, AnalysisResult, FuncqcError, CallEdge, StorageAdapter } from '../types';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { QualityCalculator } from '../metrics/quality-calculator';
import { IdealCallGraphAnalyzer } from '../analyzers/ideal-call-graph-analyzer';
import { Project, Node } from 'ts-morph';
import { Logger } from '../utils/cli-utils';
import { simpleHash } from '../utils/hash-utils';

export class FunctionAnalyzer {
  private tsAnalyzer: TypeScriptAnalyzer;
  private qualityCalculator: QualityCalculator;
  private idealCallGraphAnalyzer: IdealCallGraphAnalyzer | null = null;
  private project: Project | null = null;
  private logger: import('../utils/cli-utils').Logger;

  constructor(private config: FuncqcConfig, options: { logger?: Logger } = {}) {
    this.tsAnalyzer = new TypeScriptAnalyzer();
    this.qualityCalculator = new QualityCalculator();
    this.logger = options.logger || new Logger();
    this.logger.debug('Analyzer initialized with config:', this.config.roots);
  }

  /**
   * Analyze a single file and extract function information
   */
  async analyzeFile(filePath: string): Promise<AnalysisResult<FunctionInfo[]>> {
    const errors: FuncqcError[] = [];
    const warnings: string[] = [];

    try {
      // Determine analyzer based on file extension
      const analyzer = this.getAnalyzerForFile(filePath);

      if (!analyzer) {
        return {
          success: false,
          errors: [
            {
              name: 'UnsupportedFileType',
              message: `Unsupported file type: ${filePath}`,
              code: 'UNSUPPORTED_FILE_TYPE',
              recoverable: false,
            },
          ],
          warnings: [],
        };
      }

      // Extract functions
      const functions = await analyzer.analyzeFile(filePath);

      // Calculate quality metrics for each function
      for (const func of functions) {
        try {
          func.metrics = await this.qualityCalculator.calculate(func);
        } catch (error) {
          warnings.push(
            `Failed to calculate metrics for ${func.name}: ${(error as Error).message}`
          );
        }
      }

      return {
        success: true,
        data: functions,
        errors: [],
        warnings,
      };
    } catch (error) {
      const err = error as Error;
      errors.push({
        name: err.constructor.name,
        message: err.message,
        code: 'ANALYSIS_ERROR',
        recoverable: true,
        details: { filePath, stack: err.stack },
      });

      return {
        success: false,
        errors,
        warnings,
      };
    }
  }

  /**
   * Analyze multiple files in batch
   */
  async analyzeFiles(filePaths: string[]): Promise<AnalysisResult<FunctionInfo[]>> {
    const allFunctions: FunctionInfo[] = [];
    const allErrors: FuncqcError[] = [];
    const allWarnings: string[] = [];

    for (const filePath of filePaths) {
      const result = await this.analyzeFile(filePath);

      if (result.success && result.data) {
        allFunctions.push(...result.data);
      }

      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }

    return {
      success: allErrors.length === 0,
      data: allFunctions,
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  /**
   * Analyze files with ideal call graph analysis
   */
  async analyzeFilesWithIdealCallGraph(filePaths: string[]): Promise<{ 
    functions: FunctionInfo[]; 
    callEdges: CallEdge[];
    internalCallEdges: import('../types').InternalCallEdge[];
    errors: FuncqcError[]; 
    warnings: string[] 
  }> {
    this.logger.debug('Starting ideal call graph analysis...');
    
    try {
      // Initialize ts-morph project with specific files
      await this.initializeProject(filePaths);
      
      if (!this.project || !this.idealCallGraphAnalyzer) {
        throw new Error('Failed to initialize ideal call graph analyzer');
      }
      
      // Perform ideal call graph analysis
      this.logger.warn('🔍 IDEAL: Starting ideal call graph analysis...');
      this.logger.debug('[PATH] IDEAL - Starting analysis');
      
      // TEMPORARY: Force fallback for debugging
      if (process.env['FUNCQC_FORCE_FALLBACK'] === '1') {
        throw new Error('Forced fallback for debugging');
      }
      
      const callGraphResult = await this.idealCallGraphAnalyzer.analyzeProject();
      
      // Convert to legacy format for compatibility
      const functions = await this.convertToLegacyFormat(callGraphResult.functions);
      
      // CRITICAL FIX: Use ID mapping for IDEAL path consistency
      const functionIdMapping = this.createFunctionIdMapping(callGraphResult.functions, functions);
      const callEdges = this.convertCallEdgesWithMapping(callGraphResult.edges, functionIdMapping);
      
      // Perform internal call analysis while the project is still active
      const internalCallEdges = await this.analyzeInternalCalls(functions);
      
      this.logger.info(`[PATH] IDEAL SUCCESS - Created ${callEdges.length} call edges (${functionIdMapping.size} ID mappings), ${internalCallEdges.length} internal edges`);
      this.logger.warn(`🔍 IDEAL SUCCESS: Created ${callEdges.length} call edges (${functionIdMapping.size} ID mappings), ${internalCallEdges.length} internal edges`);
      
      return {
        functions,
        callEdges,
        internalCallEdges,
        errors: [],
        warnings: []
      };
      
    } catch (error) {
      this.logger.debug('Ideal call graph analysis failed:', error);
      
      // Fallback to regular analysis with improved call graph resolution
      this.logger.debug('[PATH] FALLBACK - Falling back to improved analysis');
      this.logger.warn('🔍 FALLBACK: Falling back to improved call graph analysis...');
      const result = await this.analyzeFiles(filePaths);
      
      // Try to perform improved call graph analysis with global function context
      let callEdges: CallEdge[] = [];
      let internalCallEdges: import('../types').InternalCallEdge[] = [];
      
      if (result.data && result.data.length > 0) {
        try {
          const improvedAnalysisResult = await this.performImprovedCallGraphAnalysis(
            filePaths, 
            result.data
          );
          callEdges = improvedAnalysisResult.callEdges;
          internalCallEdges = improvedAnalysisResult.internalCallEdges;
        } catch (error) {
          this.logger.debug('Improved call graph analysis failed:', error);
          // Continue with empty call edges
        }
      }
      
      return {
        functions: result.data || [],
        callEdges,
        internalCallEdges,
        errors: result.errors,
        warnings: result.warnings
      };
    }
  }

  /**
   * Perform improved call graph analysis with global function context
   * This implements the two-tier index approach: 
   * 1. Collect all functions (already done)
   * 2. Analyze call graph with global allowedFunctionIdSet
   */
  private async performImprovedCallGraphAnalysis(
    filePaths: string[], 
    allFunctions: FunctionInfo[]
  ): Promise<{ callEdges: CallEdge[]; internalCallEdges: import('../types').InternalCallEdge[] }> {
    this.logger.warn('🔍 STARTING: Improved call graph analysis...');
    
    // Initialize ts-morph project for call graph analysis
    await this.initializeProject(filePaths);
    
    if (!this.project) {
      throw new Error('Failed to initialize project for improved analysis');
    }

    // Step 1: Create global allowedFunctionIdSet from all functions
    const allowedFunctionIdSet = new Set(allFunctions.map(f => f.id));
    
    // Step 2: Initialize FunctionRegistry and populate with existing function data
    const { FunctionRegistry } = await import('../analyzers/function-registry');
    const functionRegistry = new FunctionRegistry(this.project);
    const registryFunctions = await functionRegistry.collectAllFunctions();
    
    // Step 2.5: Create registryId → FunctionInfoId bridge mapping (CRITICAL FIX)
    const registryToInfoIdMap = this.createRegistryToInfoIdMapping(registryFunctions, allFunctions);
    this.logger.warn(`🔍 CRITICAL DEBUG: Created registry bridge mapping: ${registryToInfoIdMap.size} entries (registry: ${registryFunctions.size}, info: ${allFunctions.length})`);
    
    // Step 3: Initialize CallGraphAnalyzer with improved configuration
    const { CallGraphAnalyzer } = await import('../analyzers/call-graph-analyzer');
    const callGraphAnalyzer = new CallGraphAnalyzer(this.project, true, this.logger);
    
    const allCallEdges: CallEdge[] = [];
    
    // Step 4: Group functions by file for efficient analysis
    const functionsByFile = new Map<string, FunctionInfo[]>();
    for (const func of allFunctions) {
      if (!functionsByFile.has(func.filePath)) {
        functionsByFile.set(func.filePath, []);
      }
      functionsByFile.get(func.filePath)!.push(func);
    }
    
    // Step 5: Analyze each file with global function context
    for (const [filePath, fileFunctions] of functionsByFile) {
      try {
        // Create local function map for this file
        const localFunctionMap = new Map<string, { id: string; name: string; startLine: number; endLine: number }>();
        
        for (const func of fileFunctions) {
          localFunctionMap.set(func.id, {
            id: func.id,
            name: func.name,
            startLine: func.startLine,
            endLine: func.endLine
          });
        }
        
        // Create composite reverse lookup function (CRITICAL FIX for ID space mismatch)
        const compositeDeclarationLookup = (decl: Node): string | undefined => {
          // First try: registry Node → registryId → FunctionInfoId conversion
          const regId = functionRegistry.getFunctionIdByDeclaration(decl);
          const infoId = regId ? registryToInfoIdMap.get(regId) : undefined;
          if (infoId) {
            return infoId;
          }
          
          // Fallback: use local declaration index (same file matching)
          const localDeclIndex = this.buildLocalDeclarationIndex(fileFunctions, filePath);
          return localDeclIndex.get(decl);
        };
        
        // Analyze with global allowed function set but local function map
        const fileCallEdges = await callGraphAnalyzer.analyzeFile(
          filePath,
          localFunctionMap,
          compositeDeclarationLookup,
          allowedFunctionIdSet
        );
        
        allCallEdges.push(...fileCallEdges);
        
      } catch (error) {
        this.logger.warn(`Call graph analysis failed for ${filePath}: ${error}`);
        // Continue with other files
      }
    }
    
    // Step 6: Analyze internal call edges
    const internalCallEdges = await this.analyzeInternalCalls(allFunctions);
    
    this.logger.debug(`Improved analysis completed: ${allCallEdges.length} call edges, ${internalCallEdges.length} internal edges`);
    
    return {
      callEdges: allCallEdges,
      internalCallEdges
    };
  }

  /**
   * Initialize ts-morph project for ideal analysis
   */
  private async initializeProject(filePaths: string[]): Promise<void> {
    this.logger.debug('Initializing ts-morph project...');
    
    // Find tsconfig.json
    const tsConfigPath = await this.findTsConfigPath();
    
    const projectOptions: import('ts-morph').ProjectOptions = {
      skipAddingFilesFromTsConfig: true, // Don't load all files, we'll add specific ones
      skipLoadingLibFiles: true,
      useInMemoryFileSystem: false
    };
    
    if (tsConfigPath) {
      projectOptions.tsConfigFilePath = tsConfigPath;
    }
    
    this.project = new Project(projectOptions);
    
    // Add specific files we want to analyze with normalized paths
    this.logger.debug(`Adding ${filePaths.length} files to project...`);
    const path = require('path');
    for (const filePath of filePaths) {
      const normalizedPath = path.resolve(filePath); // Ensure absolute path
      this.project.addSourceFileAtPath(normalizedPath);
    }
    
    // Initialize ideal call graph analyzer
    this.idealCallGraphAnalyzer = new IdealCallGraphAnalyzer(this.project, { logger: this.logger });
    
    this.logger.debug(`Project initialized with ${this.project.getSourceFiles().length} files`);
  }

  /**
   * Find tsconfig.json path
   */
  private async findTsConfigPath(): Promise<string | undefined> {
    const fs = await import('fs');
    const path = await import('path');
    
    // Search for tsconfig.json in project roots
    for (const root of this.config.roots) {
      const tsConfigPath = path.join(root, 'tsconfig.json');
      if (fs.existsSync(tsConfigPath)) {
        return tsConfigPath;
      }
    }
    
    // Search in parent directories
    let currentDir = process.cwd();
    while (currentDir !== '/') {
      const tsConfigPath = path.join(currentDir, 'tsconfig.json');
      if (fs.existsSync(tsConfigPath)) {
        return tsConfigPath;
      }
      currentDir = path.dirname(currentDir);
    }
    
    return undefined;
  }

  /**
   * Convert ideal function metadata to legacy FunctionInfo format
   */
  private async convertToLegacyFormat(functions: Map<string, import('../analyzers/ideal-call-graph-analyzer').FunctionMetadata>): Promise<FunctionInfo[]> {
    const legacyFunctions: FunctionInfo[] = [];
    
    // Group functions by file path for efficient source code extraction
    const functionsByFile = new Map<string, import('../analyzers/ideal-call-graph-analyzer').FunctionMetadata[]>();
    for (const func of functions.values()) {
      const existing = functionsByFile.get(func.filePath) || [];
      existing.push(func);
      functionsByFile.set(func.filePath, existing);
    }
    
    for (const [filePath, fileFunctions] of functionsByFile) {
      let fileContent: string;
      try {
        const fs = await import('fs');
        fileContent = await fs.promises.readFile(filePath, 'utf-8');
      } catch (error) {
        this.logger.debug(`Failed to read source file ${filePath}: ${error}`);
        fileContent = '';
      }
      
      for (const func of fileFunctions) {
        // Extract source code from file content
        let sourceCode = '';
        if (fileContent) {
          const lines = fileContent.split('\n');
          const startIndex = Math.max(0, func.startLine - 1); // Convert to 0-based
          const endIndex = Math.min(lines.length, func.endLine); // endLine is inclusive
          sourceCode = lines.slice(startIndex, endIndex).join('\n');
        }
        
        const legacyFunc: FunctionInfo = {
          id: func.id,
          name: func.name,
          filePath: func.filePath,
          startLine: func.startLine,
          endLine: func.endLine,
          startColumn: 0, // Not available in ideal system
          endColumn: 0, // Not available in ideal system
          semanticId: func.contentHash,
          displayName: func.name,
          signature: func.signature,
          contextPath: func.className ? [func.className] : [],
          functionType: func.isMethod ? 'method' : 'function',
          modifiers: func.isExported ? ['export'] : [],
          nestingLevel: 0,
          isExported: func.isExported,
          isAsync: false, // Will be determined by existing analyzer
          isArrowFunction: false, // Will be determined by existing analyzer
          isMethod: func.isMethod,
          parameters: [], // Will be populated by quality calculator
          sourceCode: sourceCode,
          astHash: func.contentHash,
          contentId: func.contentHash,
          
          // Additional required fields
          signatureHash: func.contentHash,
          fileHash: func.contentHash,
          isGenerator: false,
          isConstructor: func.nodeKind === 'ConstructorDeclaration',
          isStatic: false
        };
      
        // Calculate quality metrics
        try {
          legacyFunc.metrics = await this.qualityCalculator.calculate(legacyFunc);
        } catch (error) {
          this.logger.debug(`Failed to calculate metrics for ${func.name}: ${error}`);
        }
        
        legacyFunctions.push(legacyFunc);
      }
    }
    
    return legacyFunctions;
  }

  /**
   * Create mapping between virtual project function IDs and real database function IDs
   */
  private createFunctionIdMapping(
    virtualFunctions: Map<string, import('../analyzers/ideal-call-graph-analyzer').FunctionMetadata>, 
    realFunctions: FunctionInfo[]
  ): Map<string, string> {
    const mapping = new Map<string, string>();
    
    // Create a lookup for real functions by signature
    const realFunctionMap = new Map<string, FunctionInfo>();
    for (const realFunc of realFunctions) {
      // Create a signature key based on file path, function name, and line
      const key = `${realFunc.filePath}:${realFunc.name}:${realFunc.startLine}`;
      realFunctionMap.set(key, realFunc);
    }
    
    // Convert Map to Array
    const virtualFuncArray = Array.from(virtualFunctions.values());
    
    // Map virtual functions to real functions
    for (const virtualFunc of virtualFuncArray) {
      // Check if filePath is defined
      if (!virtualFunc.filePath) {
        this.logger.debug(`Skipping virtual function ${virtualFunc.id} (${virtualFunc.name}): no filePath`);
        continue;
      }
      
      // Convert virtual path back to real path
      const realPath = virtualFunc.filePath.replace('/virtual', '');
      const key = `${realPath}:${virtualFunc.name}:${virtualFunc.startLine || 0}`;
      
      const realFunc = realFunctionMap.get(key);
      if (realFunc) {
        mapping.set(virtualFunc.id, realFunc.id);
      } else {
        // Log warning for unmapped functions
        this.logger.debug(`Could not map virtual function ${virtualFunc.id} (${virtualFunc.name}) to real function at ${key}`);
      }
    }
    
    return mapping;
  }

  /**
   * Convert ideal call edges to legacy format with ID mapping
   */
  private convertCallEdgesWithMapping(
    edges: import('../analyzers/ideal-call-graph-analyzer').IdealCallEdge[], 
    functionIdMapping: Map<string, string>
  ): CallEdge[] {
    return edges.map((edge, index) => {
      // Map virtual function IDs to real function IDs
      const realCallerFunctionId = functionIdMapping.get(edge.callerFunctionId);
      const realCalleeFunctionId = edge.calleeFunctionId ? functionIdMapping.get(edge.calleeFunctionId) : undefined;
      
      // Skip edges where caller function mapping is missing (required)
      if (!realCallerFunctionId) {
        this.logger.debug(`Skipping edge ${index}: caller function ${edge.callerFunctionId} (${edge.calleeName || 'unknown'}) not mapped`);
        return null;
      }
      
      return {
        id: edge.id || `edge_${index}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        callerFunctionId: realCallerFunctionId,
        calleeFunctionId: realCalleeFunctionId,
        calleeName: edge.calleeName || edge.calleeFunctionId || 'unknown',
        calleeSignature: edge.calleeSignature || '', 
        callType: edge.callType || 'direct' as const,
        callContext: edge.resolutionSource,
        lineNumber: edge.lineNumber || 0,
        columnNumber: edge.columnNumber || 0,
        isAsync: edge.isAsync || false,
        isChained: edge.isChained || false,
        confidenceScore: edge.confidenceScore,
        metadata: {
          // Preserve original edge metadata (includes framework-specific data like Commander.js metadata)
          ...(edge.metadata || {}),
          // Add analysis metadata (may override original values if they exist)
          resolutionLevel: edge.resolutionLevel,
          resolutionSource: edge.resolutionSource,
          runtimeConfirmed: edge.runtimeConfirmed
        },
        createdAt: new Date().toISOString(),
        
        // Extensions for ideal system
        calleeCandidates: edge.candidates,
        resolutionLevel: edge.resolutionLevel,
        resolutionSource: edge.resolutionSource,
        runtimeConfirmed: edge.runtimeConfirmed
      };
    }).filter((edge): edge is NonNullable<typeof edge> => edge !== null); // Remove null entries
  }

  /* DEPRECATED: convertCallEdges method removed - use convertCallEdgesWithMapping for proper ID mapping */

  /**
   * Analyze internal function calls while the project is active
   */
  private async analyzeInternalCalls(functions: FunctionInfo[]): Promise<import('../types').InternalCallEdge[]> {
    if (!this.project) {
      this.logger.debug('No project available for internal call analysis');
      return [];
    }

    this.logger.debug(`Starting internal call analysis with ${this.project.getSourceFiles().length} source files loaded`);

    const { InternalCallAnalyzer } = await import('../analyzers/internal-call-analyzer');
    // Enable debug logging for InternalCallAnalyzer
    const debugLogger = new (await import('../utils/cli-utils')).Logger(true, true);
    const internalCallAnalyzer = new InternalCallAnalyzer(this.project, debugLogger);
    const allInternalCallEdges: import('../types').InternalCallEdge[] = [];

    try {
      // Group functions by file for efficient analysis
      const functionsByFile = new Map<string, FunctionInfo[]>();
      for (const func of functions) {
        if (!functionsByFile.has(func.filePath)) {
          functionsByFile.set(func.filePath, []);
        }
        functionsByFile.get(func.filePath)!.push(func);
      }

      // Analyze each file for internal function calls
      for (const [filePath, fileFunctions] of functionsByFile.entries()) {
        if (fileFunctions.length > 1) { // Only analyze files with multiple functions
          try {
            const internalEdges = await internalCallAnalyzer.analyzeFileForInternalCalls(
              filePath,
              fileFunctions,
              'temp' // snapshotId will be set later in scan.ts
            );
            allInternalCallEdges.push(...internalEdges);
          } catch (error) {
            this.logger.debug(`Failed to analyze internal calls in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      return allInternalCallEdges;
    } finally {
      internalCallAnalyzer.dispose();
    }
  }

  /**
   * Analyze call graph from stored file content (for fast scan deferred analysis)
   */
  async analyzeCallGraphFromContent(
    fileContentMap: Map<string, string>, 
    functions: FunctionInfo[],
    snapshotId: string,
    storage?: StorageAdapter
  ): Promise<{ callEdges: CallEdge[]; internalCallEdges: import('../types').InternalCallEdge[] }> {
    this.logger.debug('[PATH] CONTENT - Starting call graph analysis from stored content');
    this.logger.debug('Starting call graph analysis from stored content...');
    
    try {
      // Create a temporary project with virtual files from stored content
      const virtualProject = new Project({
        skipAddingFilesFromTsConfig: true,
        skipLoadingLibFiles: true,
        useInMemoryFileSystem: true // Use in-memory filesystem for virtual files
      });
      
      // Add virtual source files from stored content
      const virtualPaths = new Map<string, string>();
      for (const [filePath, content] of fileContentMap) {
        // Create a virtual path to avoid conflicts with real filesystem
        const virtualPath = `/virtual${filePath}`;
        virtualPaths.set(filePath, virtualPath);
        virtualProject.createSourceFile(virtualPath, content, { overwrite: true });
      }
      
      this.logger.debug(`Created virtual project with ${virtualProject.getSourceFiles().length} files`);
      
      // Initialize ideal call graph analyzer with virtual project
      const idealCallGraphAnalyzer = new IdealCallGraphAnalyzer(virtualProject, { 
        logger: this.logger,
        ...(snapshotId && { snapshotId }),
        ...(storage && { storage })
      });
      
      try {
        // Perform call graph analysis on virtual project
        const callGraphResult = await idealCallGraphAnalyzer.analyzeProject();
        
        // Create mapping between virtual functions and real functions
        const functionIdMapping = this.createFunctionIdMapping(callGraphResult.functions, functions);
        
        // Convert to legacy format for compatibility with ID mapping
        const callEdges = this.convertCallEdgesWithMapping(callGraphResult.edges, functionIdMapping);
        
        // Perform internal call analysis on virtual project
        const internalCallEdges = await this.analyzeInternalCallsFromVirtualProject(
          virtualProject, 
          functions, 
          virtualPaths
        );
        
        this.logger.info(`[PATH] CONTENT SUCCESS - Created ${callEdges.length} call edges (${functionIdMapping.size} ID mappings), ${internalCallEdges.length} internal edges`);
        
        return {
          callEdges,
          internalCallEdges
        };
        
      } finally {
        // Clean up ideal analyzer
        idealCallGraphAnalyzer.dispose();
      }
      
    } catch (error) {
      console.log(`❌ Call graph analysis from content failed:`, error);
      
      // Return empty results on failure
      return {
        callEdges: [],
        internalCallEdges: []
      };
    }
  }

  /**
   * Analyze internal calls from virtual project created from stored content
   */
  private async analyzeInternalCallsFromVirtualProject(
    virtualProject: Project,
    functions: FunctionInfo[],
    virtualPaths: Map<string, string>
  ): Promise<import('../types').InternalCallEdge[]> {
    this.logger.debug(`Starting internal call analysis with ${virtualProject.getSourceFiles().length} virtual source files`);

    const { InternalCallAnalyzer } = await import('../analyzers/internal-call-analyzer');
    const debugLogger = new (await import('../utils/cli-utils')).Logger(true, true);
    const internalCallAnalyzer = new InternalCallAnalyzer(virtualProject, debugLogger);
    const allInternalCallEdges: import('../types').InternalCallEdge[] = [];

    try {
      // Group functions by file for efficient analysis
      const functionsByFile = new Map<string, FunctionInfo[]>();
      for (const func of functions) {
        if (!functionsByFile.has(func.filePath)) {
          functionsByFile.set(func.filePath, []);
        }
        functionsByFile.get(func.filePath)!.push(func);
      }


      // Analyze each file for internal function calls using virtual paths
      for (const [realFilePath, fileFunctions] of functionsByFile.entries()) {
        if (fileFunctions.length > 1) { // Only analyze files with multiple functions
          try {
            // Map real file path to virtual path for analysis
            const virtualPath = virtualPaths.get(realFilePath);
            if (!virtualPath) {
              this.logger.debug(`No virtual path found for ${realFilePath}, skipping internal call analysis`);
              continue;
            }
            
            const internalEdges = await internalCallAnalyzer.analyzeFileForInternalCalls(
              virtualPath, // Use virtual path for analysis
              fileFunctions,
              'temp' // snapshotId will be set later in scan.ts
            );
            allInternalCallEdges.push(...internalEdges);
          } catch (error) {
            this.logger.debug(`Failed to analyze internal calls in ${realFilePath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      return allInternalCallEdges;
    } finally {
      internalCallAnalyzer.dispose();
    }
  }

  /**
   * Create mapping between registry function IDs and FunctionInfo IDs
   * Uses filePath + startLine ±1 matching for robustness
   */
  private createRegistryToInfoIdMapping(
    registryFunctions: Map<string, import('../analyzers/ideal-call-graph-analyzer').FunctionMetadata>,
    allFunctions: FunctionInfo[]
  ): Map<string, string> {
    const mapping = new Map<string, string>();
    
    // Create lookup for FunctionInfo by file and line
    const infoLookup = new Map<string, FunctionInfo[]>();
    for (const func of allFunctions) {
      const key = func.filePath;
      if (!infoLookup.has(key)) {
        infoLookup.set(key, []);
      }
      infoLookup.get(key)!.push(func);
    }
    
    // Match registry functions to FunctionInfo by file path and line (±1 tolerance)
    let matchedCount = 0;
    let unmatchedCount = 0;
    
    for (const [registryId, regFunc] of registryFunctions) {
      const candidates = infoLookup.get(regFunc.filePath) || [];
      let matched = false;
      
      for (const infoFunc of candidates) {
        const lineDiff = Math.abs(infoFunc.startLine - regFunc.startLine);
        const nameDiff = infoFunc.name === regFunc.name;
        
        // Match by line ±1 and exact name match
        if (lineDiff <= 1 && nameDiff) {
          mapping.set(registryId, infoFunc.id);
          this.logger.debug(`Registry bridge: ${regFunc.name} (${registryId.substring(0, 8)}) → ${infoFunc.id.substring(0, 8)}`);
          matched = true;
          matchedCount++;
          break; // First match wins
        }
      }
      
      if (!matched) {
        unmatchedCount++;
        this.logger.debug(`Registry unmatched: ${regFunc.name} at ${regFunc.filePath}:${regFunc.startLine} (${registryId.substring(0, 8)})`);
      }
    }
    
    this.logger.warn(`🔍 Registry bridge stats: matched=${matchedCount}, unmatched=${unmatchedCount}`);
    return mapping;
  }

  /**
   * Build local declaration index for same-file function lookup
   */
  private buildLocalDeclarationIndex(fileFunctions: FunctionInfo[], filePath: string): Map<Node, string> {
    const localIndex = new Map<Node, string>();
    
    if (!this.project) {
      return localIndex;
    }
    
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) {
      return localIndex;
    }
    
    // Get all function nodes in the file
    const functionNodes: Node[] = [];
    sourceFile.forEachDescendant(node => {
      if (this.isFunctionDeclaration(node)) {
        functionNodes.push(node);
      }
    });
    
    // Match function nodes to FunctionInfo by line ±1
    for (const func of fileFunctions) {
      const matchingNode = functionNodes.find(node => {
        const nodeStart = node.getStartLineNumber();
        const startDiff = Math.abs(nodeStart - func.startLine);
        return startDiff <= 1;
      });
      
      if (matchingNode) {
        localIndex.set(matchingNode, func.id);
      }
    }
    
    return localIndex;
  }

  /**
   * Check if a node is a function declaration of any type
   */
  private isFunctionDeclaration(node: Node): boolean {
    return Node.isFunctionDeclaration(node) ||
           Node.isMethodDeclaration(node) ||
           Node.isArrowFunction(node) ||
           Node.isFunctionExpression(node) ||
           Node.isConstructorDeclaration(node) ||
           Node.isGetAccessorDeclaration(node) ||
           Node.isSetAccessorDeclaration(node);
  }

  /**
   * Get the ts-morph Project instance for shared usage
   */
  getProject(): Project | null {
    return this.project;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.idealCallGraphAnalyzer) {
      this.idealCallGraphAnalyzer.dispose();
      this.idealCallGraphAnalyzer = null;
    }
    if (this.project) {
      // Properly dispose the Project to free all SourceFiles and memory
      // This should be the only place where Project disposal happens
      try {
        // Note: ts-morph Project doesn't have a dispose() method, but setting to null
        // allows garbage collection to clean up SourceFiles and TypeScript compiler resources
        this.project = null;
      } catch (error) {
        console.warn('Warning: Error during Project cleanup:', error);
        this.project = null;
      }
    }
  }

  /**
   * Get the appropriate analyzer for a file based on its extension
   */
  private getAnalyzerForFile(filePath: string): TypeScriptAnalyzer | null {
    const extension = filePath.toLowerCase().split('.').pop();

    switch (extension) {
      case 'ts':
      case 'tsx':
        return this.tsAnalyzer;

      // Future: Add support for other languages
      case 'js':
      case 'jsx':
        // For now, treat JS files as TypeScript (with permissive parsing)
        return this.tsAnalyzer;

      default:
        return null;
    }
  }

  /**
   * Check if a file is supported for analysis
   */
  isFileSupported(filePath: string): boolean {
    return this.getAnalyzerForFile(filePath) !== null;
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return ['.ts', '.tsx', '.js', '.jsx'];
  }

  /**
   * Validate function data consistency
   */
  validateFunction(func: FunctionInfo): string[] {
    const issues: string[] = [];

    // Basic validation
    if (!func.name || func.name.trim() === '') {
      issues.push('Function name is missing or empty');
    }

    if (!func.filePath) {
      issues.push('File path is missing');
    }

    if (func.startLine <= 0) {
      issues.push('Invalid start line number');
    }

    if (func.endLine < func.startLine) {
      issues.push('End line is before start line');
    }

    if (!func.signature) {
      issues.push('Function signature is missing');
    }

    if (!func.astHash) {
      issues.push('AST hash is missing');
    }

    // Parameter validation
    if (func.parameters) {
      func.parameters.forEach((param, index) => {
        if (!param.name) {
          issues.push(`Parameter at position ${index} has no name`);
        }

        if (param.position !== index) {
          issues.push(`Parameter position mismatch at index ${index}`);
        }
      });
    }

    // Metrics validation
    if (func.metrics) {
      if (func.metrics.cyclomaticComplexity < 1) {
        issues.push('Cyclomatic complexity cannot be less than 1');
      }

      if (func.metrics.linesOfCode < 0) {
        issues.push('Lines of code cannot be negative');
      }

      if (func.metrics.parameterCount !== func.parameters.length) {
        issues.push('Parameter count mismatch between metrics and actual parameters');
      }
    }

    return issues;
  }

  /**
   * Generate a unique ID for a function based on its characteristics
   */
  generateFunctionId(func: Partial<FunctionInfo>): string {
    const components = [
      func.filePath,
      func.name,
      func.startLine,
      func.astHash || func.signature,
    ].filter(Boolean);

    // Create a simple hash of the components
    const combined = components.join('|');
    return simpleHash(combined);
  }


  /**
   * Compare two functions for similarity (basic structural comparison)
   */
  compareFunctions(func1: FunctionInfo, func2: FunctionInfo): number {
    let similarity = 0;
    let factors = 0;

    // Name similarity
    if (func1.name === func2.name) {
      similarity += 1;
    }
    factors++;

    // Parameter count similarity
    const paramDiff = Math.abs(func1.parameters.length - func2.parameters.length);
    similarity += Math.max(
      0,
      1 - paramDiff / Math.max(func1.parameters.length, func2.parameters.length, 1)
    );
    factors++;

    // AST similarity (exact match)
    if (func1.astHash === func2.astHash) {
      similarity += 1;
    }
    factors++;

    // Metrics similarity
    if (func1.metrics && func2.metrics) {
      const complexityDiff = Math.abs(
        func1.metrics.cyclomaticComplexity - func2.metrics.cyclomaticComplexity
      );
      similarity += Math.max(0, 1 - complexityDiff / 10); // Normalize by max expected complexity
      factors++;

      const linesDiff = Math.abs(func1.metrics.linesOfCode - func2.metrics.linesOfCode);
      similarity += Math.max(
        0,
        1 - linesDiff / Math.max(func1.metrics.linesOfCode, func2.metrics.linesOfCode, 1)
      );
      factors++;
    }

    return factors > 0 ? similarity / factors : 0;
  }
}
