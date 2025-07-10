/**
 * Output formatter for vectorize command results
 * Supports both console and JSON output formats
 */

import chalk from 'chalk';
import {
  VectorizeResult,
  VectorizeData,
  StatusData,
  IndexData,
  BenchmarkData,
} from './vectorize-use-case';
import { OutputFormat } from './vectorize-options';

export interface FormatterOptions {
  format: OutputFormat;
  quiet?: boolean;
  color?: boolean; // For console output
}

/**
 * Formats vectorize command results for different output formats
 */
export class OutputFormatter {
  constructor(private options: FormatterOptions) {}

  /**
   * Format and output the result
   */
  format(result: VectorizeResult): string {
    if (this.options.format === 'json') {
      return this.formatJSON(result);
    } else {
      return this.formatConsole(result);
    }
  }

  /**
   * Format result as JSON
   */
  private formatJSON(result: VectorizeResult): string {
    // Create a clean JSON structure
    const jsonOutput = {
      success: result.success,
      operation: result.operation,
      timestamp: new Date().toISOString(),
      timeTaken: result.timeTaken,
      data: result.data,
      errors: result.errors,
    };

    return JSON.stringify(jsonOutput, null, 2);
  }

  /**
   * Format result for console output
   */
  private formatConsole(result: VectorizeResult): string {
    if (!result.success) {
      return this.formatErrors(result.errors || []);
    }

    switch (result.operation) {
      case 'vectorize':
        return this.formatVectorizeResult(result.data as VectorizeData, result.timeTaken);
      case 'status':
        return this.formatStatusResult(result.data as StatusData);
      case 'rebuild-index':
        return this.formatIndexResult(result.data as IndexData, result.timeTaken);
      case 'benchmark':
        return this.formatBenchmarkResult(result.data as BenchmarkData);
      case 'index-stats':
        return this.formatIndexStatsResult(result.data as IndexData);
      default:
        return 'Unknown operation result';
    }
  }

  /**
   * Format vectorization results
   */
  private formatVectorizeResult(data: VectorizeData, timeTaken?: number): string {
    if (data.functionsProcessed === 0) {
      return this.colorize('⚠️  No functions to vectorize found.', 'yellow');
    }

    const lines = [
      this.colorize('✅ Vectorization completed:', 'green'),
      this.colorize('─'.repeat(40), 'gray'),
      `Functions processed: ${this.colorize(data.functionsProcessed.toString(), 'cyan')}`,
      `Model used: ${this.colorize(data.model, 'cyan')}`,
      `Embedding dimension: ${this.colorize(data.dimension.toString(), 'cyan')}`,
      `Batch size: ${this.colorize(data.batchSize.toString(), 'cyan')}`,
    ];

    if (timeTaken) {
      lines.push(`Time taken: ${this.colorize(`${(timeTaken / 1000).toFixed(2)}s`, 'cyan')}`);
    }

    if (!this.options.quiet && data.embeddings.length > 0) {
      lines.push('', this.colorize('Recent embeddings:', 'gray'));
      const recentEmbeddings = data.embeddings.slice(0, 5);
      recentEmbeddings.forEach(emb => {
        lines.push(`  • ${emb.functionId} (${emb.model})`);
      });

      if (data.embeddings.length > 5) {
        lines.push(`  ... and ${data.embeddings.length - 5} more`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format status results
   */
  private formatStatusResult(data: StatusData): string {
    const lines = [
      this.colorize('📊 Vectorization Status:', 'blue'),
      this.colorize('─'.repeat(40), 'gray'),
      `Total functions with descriptions: ${this.colorize(data.total.toString(), 'cyan')}`,
      `Functions with embeddings: ${this.colorize(data.withEmbeddings.toString(), 'green')}`,
      `Functions without embeddings: ${this.colorize(data.withoutEmbeddings.toString(), 'yellow')}`,
      `Coverage: ${this.colorize(`${data.coverage}%`, data.coverage >= 80 ? 'green' : data.coverage >= 50 ? 'yellow' : 'red')}`,
    ];

    if (data.models.length > 0) {
      lines.push('', this.colorize('Embedding models used:', 'gray'));
      data.models.forEach(model => {
        lines.push(`  • ${model}`);
      });
    }

    if (data.indexStatus) {
      lines.push('', this.colorize('ANN Index Status:', 'gray'));
      lines.push(
        `Built: ${this.colorize(data.indexStatus.isBuilt ? 'Yes' : 'No', data.indexStatus.isBuilt ? 'green' : 'red')}`
      );

      if (data.indexStatus.isBuilt) {
        if (data.indexStatus.algorithm) {
          lines.push(`Algorithm: ${data.indexStatus.algorithm}`);
        }
        if (data.indexStatus.vectorCount !== undefined) {
          lines.push(`Vector count: ${data.indexStatus.vectorCount}`);
        }
        if (data.indexStatus.lastBuilt) {
          const lastBuilt = new Date(data.indexStatus.lastBuilt).toLocaleString();
          lines.push(`Last built: ${lastBuilt}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Format index rebuild results
   */
  private formatIndexResult(data: IndexData, timeTaken?: number): string {
    const lines = [
      this.colorize('🔧 Index rebuild completed:', 'green'),
      this.colorize('─'.repeat(40), 'gray'),
      `Algorithm: ${this.colorize(data.algorithm, 'cyan')}`,
      `Vectors indexed: ${this.colorize(data.vectorCount.toString(), 'cyan')}`,
      `Index size: ${this.colorize(this.formatBytes(data.indexSize), 'cyan')}`,
    ];

    if (timeTaken) {
      lines.push(`Build time: ${this.colorize(`${(timeTaken / 1000).toFixed(2)}s`, 'cyan')}`);
    }

    return lines.join('\n');
  }

  /**
   * Format benchmark results
   */
  private formatBenchmarkResult(data: BenchmarkData): string {
    const lines = [
      this.colorize('📈 Benchmark Results:', 'blue'),
      this.colorize('─'.repeat(40), 'gray'),
      `Algorithm: ${this.colorize(data.algorithm, 'cyan')}`,
      `Queries: ${this.colorize(data.queryCount.toString(), 'cyan')}`,
      `Average query time: ${this.colorize(`${data.avgQueryTime.toFixed(2)}ms`, 'cyan')}`,
      `Accuracy: ${this.colorize(`${(data.accuracy * 100).toFixed(1)}%`, data.accuracy >= 0.9 ? 'green' : 'yellow')}`,
      `Throughput: ${this.colorize(`${data.throughput.toFixed(1)} queries/sec`, 'cyan')}`,
    ];

    return lines.join('\n');
  }

  /**
   * Format index statistics results
   */
  private formatIndexStatsResult(data: IndexData): string {
    const lines = [
      this.colorize('📊 Index Statistics:', 'blue'),
      this.colorize('─'.repeat(40), 'gray'),
      `Algorithm: ${this.colorize(data.algorithm, 'cyan')}`,
      `Vector count: ${this.colorize(data.vectorCount.toString(), 'cyan')}`,
      `Index size: ${this.colorize(this.formatBytes(data.indexSize), 'cyan')}`,
    ];

    if (data.buildTime > 0) {
      lines.push(
        `Last build time: ${this.colorize(`${(data.buildTime / 1000).toFixed(2)}s`, 'cyan')}`
      );
    }

    return lines.join('\n');
  }

  /**
   * Format error messages
   */
  private formatErrors(errors: string[]): string {
    const lines = [
      this.colorize('❌ Operation failed:', 'red'),
      this.colorize('─'.repeat(40), 'gray'),
    ];

    errors.forEach(error => {
      lines.push(this.colorize(`Error: ${error}`, 'red'));
    });

    return lines.join('\n');
  }

  /**
   * Apply color to text (if color is enabled)
   */
  private colorize(text: string, color: string): string {
    if (!this.options.color) {
      return text;
    }

    switch (color) {
      case 'red':
        return chalk.red(text);
      case 'green':
        return chalk.green(text);
      case 'yellow':
        return chalk.yellow(text);
      case 'blue':
        return chalk.blue(text);
      case 'cyan':
        return chalk.cyan(text);
      case 'gray':
        return chalk.gray(text);
      default:
        return text;
    }
  }

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}
