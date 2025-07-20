import { FunctionInfo, FuncqcConfig, AnalysisResult, FuncqcError, CallEdge } from '../types';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { QualityCalculator } from '../metrics/quality-calculator';
import { IdealCallGraphAnalyzer } from '../analyzers/ideal-call-graph-analyzer';
import { Project } from 'ts-morph';

export class FunctionAnalyzer {
  private tsAnalyzer: TypeScriptAnalyzer;
  private qualityCalculator: QualityCalculator;
  private idealCallGraphAnalyzer: IdealCallGraphAnalyzer | null = null;
  private project: Project | null = null;
  private logger: import('../utils/cli-utils').Logger;

  constructor(private config: FuncqcConfig, options: { logger?: import('../utils/cli-utils').Logger } = {}) {
    this.tsAnalyzer = new TypeScriptAnalyzer();
    this.qualityCalculator = new QualityCalculator();
    this.logger = options.logger || new (require('../utils/cli-utils').Logger)();
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
    errors: FuncqcError[]; 
    warnings: string[] 
  }> {
    this.logger.debug('Starting ideal call graph analysis...');
    
    try {
      // Initialize ts-morph project
      await this.initializeProject(filePaths);
      
      if (!this.project || !this.idealCallGraphAnalyzer) {
        throw new Error('Failed to initialize ideal call graph analyzer');
      }
      
      // Perform ideal call graph analysis
      const callGraphResult = await this.idealCallGraphAnalyzer.analyzeProject();
      
      // Convert to legacy format for compatibility
      const functions = await this.convertToLegacyFormat(callGraphResult.functions);
      const callEdges = this.convertCallEdges(callGraphResult.edges);
      
      return {
        functions,
        callEdges,
        errors: [],
        warnings: []
      };
      
    } catch (error) {
      this.logger.debug('Ideal call graph analysis failed:', error);
      
      // Fallback to regular analysis
      this.logger.debug('Falling back to regular analysis...');
      const result = await this.analyzeFiles(filePaths);
      
      return {
        functions: result.data || [],
        callEdges: [],
        errors: result.errors,
        warnings: result.warnings
      };
    }
  }

  /**
   * Initialize ts-morph project for ideal analysis
   */
  private async initializeProject(_filePaths: string[]): Promise<void> {
    this.logger.debug('Initializing ts-morph project...');
    
    // Find tsconfig.json
    const tsConfigPath = await this.findTsConfigPath();
    
    const projectOptions: import('ts-morph').ProjectOptions = {
      skipAddingFilesFromTsConfig: false, // Load all files for maximum precision
      skipLoadingLibFiles: true,
      useInMemoryFileSystem: false
    };
    
    if (tsConfigPath) {
      projectOptions.tsConfigFilePath = tsConfigPath;
    }
    
    this.project = new Project(projectOptions);
    
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
    
    for (const func of functions.values()) {
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
        sourceCode: '', // Will be populated if needed
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
    
    return legacyFunctions;
  }

  /**
   * Convert ideal call edges to legacy format
   */
  private convertCallEdges(edges: import('../analyzers/ideal-call-graph-analyzer').IdealCallEdge[]): CallEdge[] {
    return edges.map((edge, index) => ({
      id: `edge_${index}`,
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId,
      calleeName: edge.calleeFunctionId || 'unknown',
      calleeSignature: '', // Not available in ideal system
      callType: 'direct' as const,
      callContext: edge.resolutionSource,
      lineNumber: 0, // Not available in ideal system
      columnNumber: 0, // Not available in ideal system
      isAsync: false, // Not available in ideal system
      isChained: false, // Not available in ideal system
      confidenceScore: edge.confidenceScore,
      metadata: {
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
    }));
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
      this.project = null;
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
    return this.simpleHash(combined);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
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
