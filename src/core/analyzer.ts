import { FunctionInfo, FuncqcConfig, CallEdge, StorageAdapter } from '../types';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { IdealCallGraphAnalyzer } from '../analyzers/ideal-call-graph-analyzer';
import { Project } from 'ts-morph';
import { Logger } from '../utils/cli-utils';
import { simpleHash } from '../utils/hash-utils';
import chalk from 'chalk';

export class FunctionAnalyzer {
  private tsAnalyzer: TypeScriptAnalyzer;
  private idealCallGraphAnalyzer: IdealCallGraphAnalyzer | null = null;
  private project: Project | null = null;
  private logger: import('../utils/cli-utils').Logger;

  constructor(private config: FuncqcConfig, options: { logger?: Logger } = {}) {
    this.tsAnalyzer = new TypeScriptAnalyzer();
    this.logger = options.logger || new Logger();
    this.logger.debug('Analyzer initialized with config:', this.config.roots);
  }

  /**
   * Convert ideal call edges to legacy format without ID mapping (unified paths)
   */
  private convertCallEdgesToLegacy(
    edges: import('../analyzers/ideal-call-graph-analyzer').IdealCallEdge[]
  ): CallEdge[] {
    return edges.map((edge, index) => {
      return {
        id: edge.id || `edge_${index}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        callerFunctionId: edge.callerFunctionId,
        calleeFunctionId: edge.calleeFunctionId || undefined,
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
    }).filter(Boolean) as CallEdge[];
  }

  /**
   * Analyze call graph from stored file content (for fast scan deferred analysis)
   */
  async analyzeCallGraphFromContent(
    _fileContentMap: Map<string, string>, 
    functions: FunctionInfo[],
    snapshotId: string,
    storage?: StorageAdapter,
    env?: import('../types/environment').CommandEnvironment
  ): Promise<{ callEdges: CallEdge[]; internalCallEdges: import('../types').InternalCallEdge[] }> {
    const startTime = performance.now();
    this.logger.debug('[PATH] CONTENT - Starting call graph analysis from stored content');
    this.logger.debug('Starting call graph analysis from stored content...');
    
    try {
      // Use shared virtual project for true integration (reuse from BASIC analysis)
      this.logger.debug('[PATH] CONTENT-UNIFIED - Attempting to reuse shared virtual project...');
      
      // Get existing shared project via environment (no creation)
      const virtualProject = env?.projectManager?.getCachedProject(snapshotId);
      
      if (!virtualProject) {
        throw new Error(`No shared project found for snapshot ${snapshotId}. Project should be created by dependency manager.`);
      }
      
      // Virtual project ready for call graph analysis
      
      this.logger.debug(`Using virtual project with ${virtualProject.getSourceFiles().length} files`);
      
      // No need to create lookup mappings since deterministic UUID generation handles consistency
      
      
      // Initialize ideal call graph analyzer with virtual project
      const idealCallGraphAnalyzer = new IdealCallGraphAnalyzer(virtualProject, { 
        logger: this.logger,
        ...(snapshotId && { snapshotId }),
        ...(storage && { storage })
      });
      
      try {
        // Perform call graph analysis on virtual project using existing functions
        const analysisStartTime = performance.now();
        const callGraphResult = await idealCallGraphAnalyzer.analyzeProject(functions);
        const analysisEndTime = performance.now();
        console.log(chalk.gray(`⏱️  Call graph analysis: ${((analysisEndTime - analysisStartTime) / 1000).toFixed(2)}s`));
        
        // Convert to legacy format for compatibility (no ID mapping needed)
        const mappingStartTime = performance.now();
        const callEdges = this.convertCallEdgesToLegacy(callGraphResult.edges);
        const mappingEndTime = performance.now();
        console.log(chalk.gray(`⏱️  Edge conversion: ${((mappingEndTime - mappingStartTime) / 1000).toFixed(2)}s`));
        
        // Perform internal call analysis on virtual project
        const internalStartTime = performance.now();
        const internalCallEdges = await this.analyzeInternalCallsUnified(
          virtualProject,
          functions,
          snapshotId
        );
        const internalEndTime = performance.now();
        console.log(chalk.gray(`⏱️  Internal call analysis: ${((internalEndTime - internalStartTime) / 1000).toFixed(2)}s`));
        
        const totalTime = performance.now() - startTime;
        console.log(chalk.yellow(`⏱️  Total call graph analysis time: ${(totalTime / 1000).toFixed(2)}s`));
        
        
        // Call graph analysis completed successfully
        
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

  /**
   * Analyze internal calls from virtual project with unified path handling
   * No virtual path mapping needed since original paths are used
   */
  private async analyzeInternalCallsUnified(
    virtualProject: Project,
    functions: FunctionInfo[],
    snapshotId: string = 'temp'
  ): Promise<import('../types').InternalCallEdge[]> {
    this.logger.debug(`Starting unified internal call analysis with ${virtualProject.getSourceFiles().length} virtual source files`);

    const { InternalCallAnalyzer } = await import('../analyzers/internal-call-analyzer');
    const debugLogger = new (await import('../utils/cli-utils')).Logger(
      !!process.env['FUNCQC_DEBUG_INTERNAL_CALLS'], 
      !!process.env['FUNCQC_DEBUG_INTERNAL_CALLS']
    );
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

      // Analyze each file for internal function calls using original paths
      for (const [filePath, fileFunctions] of functionsByFile.entries()) {
        if (fileFunctions.length > 1) { // Only analyze files with multiple functions
          try {
            // Use original file path directly (no virtual path mapping needed)
            const internalEdges = await internalCallAnalyzer.analyzeFileForInternalCalls(
              filePath,
              fileFunctions,
              snapshotId
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
