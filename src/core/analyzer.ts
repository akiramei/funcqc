import { FunctionInfo, FuncqcConfig, AnalysisResult, FuncqcError } from '../types';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { QualityCalculator } from '../metrics/quality-calculator';

export class FunctionAnalyzer {
  private tsAnalyzer: TypeScriptAnalyzer;
  private qualityCalculator: QualityCalculator;

  constructor(private config: FuncqcConfig) {
    this.tsAnalyzer = new TypeScriptAnalyzer();
    this.qualityCalculator = new QualityCalculator();
    // Config will be used in future enhancements
    console.debug('Analyzer initialized with config:', this.config.roots);
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
