import chalk from 'chalk';
import { AnalysisCandidate, DependencyAnalysisResult } from '../analyzers/dependency-analysis-engine';
import { ConfidenceCalculationResult } from './confidence-calculator';

/**
 * Formatting options for analysis output
 */
export interface AnalysisFormattingOptions {
  format: 'table' | 'json';
  verbose: boolean;
  showConfidence: boolean;
  showMetadata: boolean;
  groupBy?: 'file' | 'confidence' | 'impact' | 'none';
  sortBy?: 'name' | 'confidence' | 'impact' | 'file';
  sortOrder?: 'asc' | 'desc';
  maxItems?: number;
  colors: boolean;
}

/**
 * Formatted analysis output
 */
export interface FormattedAnalysisOutput {
  content: string;
  metadata: {
    itemCount: number;
    groupCount: number;
    formattingTime: number;
    warnings: string[];
  };
}

/**
 * Group of analysis items
 */
export interface AnalysisGroup<T = AnalysisCandidate> {
  key: string;
  title: string;
  items: T[];
  summary: GroupSummary;
}

/**
 * Summary statistics for a group
 */
export interface GroupSummary {
  itemCount: number;
  averageConfidence: number;
  impactDistribution: {
    low: number;
    medium: number;
    high: number;
  };
}

/**
 * Unified Analysis Formatter
 * 
 * Extracted from safe-delete to provide consistent, rich CLI output
 * across all dependency analysis operations (safe-delete, dep commands, etc.)
 * 
 * Features inherited from safe-delete:
 * - Rich colored table output with proper alignment
 * - JSON output for automation and scripting
 * - Flexible grouping and sorting options
 * - Confidence-based color coding
 * - Verbose mode with detailed metadata
 * - Progress indicators and summary statistics
 */
export class AnalysisFormatter {
  private static readonly DEFAULT_OPTIONS: AnalysisFormattingOptions = {
    format: 'table',
    verbose: false,
    showConfidence: true,
    showMetadata: false,
    groupBy: 'file',
    sortBy: 'confidence',
    sortOrder: 'desc',
    colors: true
  };

  /**
   * Format analysis results using inherited safe-delete patterns
   */
  static formatAnalysisResults<T extends AnalysisCandidate>(
    results: DependencyAnalysisResult<T>,
    title: string,
    options: Partial<AnalysisFormattingOptions> = {}
  ): FormattedAnalysisOutput {
    const startTime = Date.now();
    const config = { ...this.DEFAULT_OPTIONS, ...options };
    const warnings: string[] = [];

    try {
      if (config.format === 'json') {
        return this.formatAsJSON(results, config, startTime);
      } else {
        return this.formatAsTable(results, title, config, startTime, warnings);
      }
    } catch (error) {
      warnings.push(`Formatting error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: JSON.stringify(results, null, 2),
        metadata: {
          itemCount: results.analysisResults.length,
          groupCount: 0,
          formattingTime: Date.now() - startTime,
          warnings
        }
      };
    }
  }

  /**
   * Format as JSON (inherited from safe-delete JSON output)
   */
  private static formatAsJSON<T extends AnalysisCandidate>(
    results: DependencyAnalysisResult<T>,
    config: AnalysisFormattingOptions,
    startTime: number
  ): FormattedAnalysisOutput {
    const output = {
      summary: {
        totalResults: results.analysisResults.length,
        errors: results.errors.length,
        warnings: results.warnings.length,
        metadata: config.showMetadata ? results.metadata : undefined
      },
      results: results.analysisResults.map(item => ({
        function: {
          id: item.functionInfo.id,
          name: item.functionInfo.name,
          filePath: item.functionInfo.filePath,
          location: `${item.functionInfo.startLine}-${item.functionInfo.endLine}`,
          isExported: item.functionInfo.isExported
        },
        analysis: {
          confidence: item.confidenceScore,
          reason: item.analysisReason,
          impact: item.estimatedImpact,
          metadata: config.showMetadata ? item.metadata : undefined
        }
      })),
      errors: results.errors,
      warnings: results.warnings
    };

    return {
      content: JSON.stringify(output, null, 2),
      metadata: {
        itemCount: results.analysisResults.length,
        groupCount: 1,
        formattingTime: Date.now() - startTime,
        warnings: []
      }
    };
  }

  /**
   * Format as rich table (inherited from safe-delete table output)
   */
  private static formatAsTable<T extends AnalysisCandidate>(
    results: DependencyAnalysisResult<T>,
    title: string,
    config: AnalysisFormattingOptions,
    startTime: number,
    warnings: string[]
  ): FormattedAnalysisOutput {
    const lines: string[] = [];
    
    // Title section (inherited from safe-delete header style)
    this.addTableHeader(lines, title, config.colors);
    
    // Summary section (inherited from safe-delete summary)
    this.addSummarySection(lines, results, config.colors);
    
    // Error and warning sections (inherited from safe-delete error handling)
    this.addErrorsAndWarnings(lines, results, config.colors);
    
    if (results.analysisResults.length === 0) {
      lines.push(this.colorize('green', '\n✅ No analysis results found', config.colors));
      return {
        content: lines.join('\n'),
        metadata: {
          itemCount: 0,
          groupCount: 0,
          formattingTime: Date.now() - startTime,
          warnings
        }
      };
    }

    // Group and sort results
    const groups = this.groupAndSortResults(results.analysisResults, config);
    
    // Results section with grouping (inherited from safe-delete grouping)
    this.addResultsSection(lines, groups, config, warnings);
    
    // Summary statistics (inherited from safe-delete statistics)
    this.addSummaryStatistics(lines, results.analysisResults, config.colors);
    
    // Metadata section (if requested)
    if (config.showMetadata && results.metadata) {
      this.addMetadataSection(lines, results.metadata, config.colors);
    }

    return {
      content: lines.join('\n'),
      metadata: {
        itemCount: results.analysisResults.length,
        groupCount: groups.length,
        formattingTime: Date.now() - startTime,
        warnings
      }
    };
  }

  /**
   * Add table header (inherited from safe-delete header style)
   */
  private static addTableHeader(lines: string[], title: string, colors: boolean): void {
    lines.push(this.colorize('bold', `\n🔍 ${title}\n`, colors));
  }

  /**
   * Add summary section (inherited from safe-delete summary)
   */
  private static addSummarySection<T extends AnalysisCandidate>(
    lines: string[],
    results: DependencyAnalysisResult<T>,
    colors: boolean
  ): void {
    lines.push(`Results found:        ${this.colorize('cyan', results.analysisResults.length.toString(), colors)}`);
    lines.push(`Errors encountered:   ${this.colorize('red', results.errors.length.toString(), colors)}`);
    lines.push(`Warnings:            ${this.colorize('yellow', results.warnings.length.toString(), colors)}`);
    
    if (results.metadata?.processingTime) {
      lines.push(`Processing time:     ${this.colorize('blue', `${results.metadata.processingTime.total}ms`, colors)}`);
    }
  }

  /**
   * Add errors and warnings section (inherited from safe-delete error handling)
   */
  private static addErrorsAndWarnings<T extends AnalysisCandidate>(
    lines: string[],
    results: DependencyAnalysisResult<T>,
    colors: boolean
  ): void {
    if (results.errors.length > 0) {
      lines.push(this.colorize('red', '\n❌ Errors:', colors));
      results.errors.forEach(error => {
        lines.push(`  • ${error}`);
      });
    }

    if (results.warnings.length > 0) {
      lines.push(this.colorize('yellow', '\n⚠️  Warnings:', colors));
      results.warnings.forEach(warning => {
        lines.push(`  • ${warning}`);
      });
    }
  }

  /**
   * Group and sort results based on options
   */
  private static groupAndSortResults<T extends AnalysisCandidate>(
    results: T[],
    config: AnalysisFormattingOptions
  ): AnalysisGroup<T>[] {
    // Apply item limit if specified
    const limitedResults = config.maxItems ? results.slice(0, config.maxItems) : results;
    
    // Sort results
    const sortedResults = this.sortResults(limitedResults, config);
    
    // Group results
    return this.groupResults(sortedResults, config);
  }

  /**
   * Sort results based on configuration
   */
  private static sortResults<T extends AnalysisCandidate>(
    results: T[],
    config: AnalysisFormattingOptions
  ): T[] {
    const sortedResults = [...results];
    
    sortedResults.sort((a, b) => {
      let comparison = 0;
      
      switch (config.sortBy) {
        case 'name':
          comparison = a.functionInfo.name.localeCompare(b.functionInfo.name);
          break;
        case 'confidence':
          comparison = b.confidenceScore - a.confidenceScore; // Higher confidence first by default
          break;
        case 'impact':
          const impactOrder = { low: 0, medium: 1, high: 2 };
          comparison = impactOrder[b.estimatedImpact] - impactOrder[a.estimatedImpact];
          break;
        case 'file':
          comparison = a.functionInfo.filePath.localeCompare(b.functionInfo.filePath);
          break;
      }
      
      return config.sortOrder === 'asc' ? comparison : -comparison;
    });
    
    return sortedResults;
  }

  /**
   * Group results based on configuration
   */
  private static groupResults<T extends AnalysisCandidate>(
    results: T[],
    config: AnalysisFormattingOptions
  ): AnalysisGroup<T>[] {
    if (config.groupBy === 'none') {
      return [{
        key: 'all',
        title: 'All Results',
        items: results,
        summary: this.calculateGroupSummary(results)
      }];
    }

    const groupMap = new Map<string, T[]>();
    
    for (const result of results) {
      let groupKey: string;
      
      switch (config.groupBy) {
        case 'file':
          groupKey = result.functionInfo.filePath;
          break;
        case 'confidence':
          if (result.confidenceScore >= 0.9) groupKey = 'high-confidence';
          else if (result.confidenceScore >= 0.7) groupKey = 'medium-confidence';
          else groupKey = 'low-confidence';
          break;
        case 'impact':
          groupKey = `${result.estimatedImpact}-impact`;
          break;
        default:
          groupKey = 'default';
      }
      
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, []);
      }
      groupMap.get(groupKey)!.push(result);
    }

    return Array.from(groupMap.entries()).map(([key, items]) => ({
      key,
      title: this.formatGroupTitle(key, config.groupBy!),
      items,
      summary: this.calculateGroupSummary(items)
    }));
  }

  /**
   * Add results section with grouping (inherited from safe-delete results display)
   */
  private static addResultsSection<T extends AnalysisCandidate>(
    lines: string[],
    groups: AnalysisGroup<T>[],
    config: AnalysisFormattingOptions,
    _warnings: string[]
  ): void {
    lines.push(this.colorize('bold', '\n📊 Analysis Results\n', config.colors));

    for (const group of groups) {
      if (groups.length > 1) {
        lines.push(this.colorize('underline', group.title, config.colors));
        lines.push(`   Items: ${group.items.length}, Avg Confidence: ${(group.summary.averageConfidence * 100).toFixed(1)}%\n`);
      }

      for (const item of group.items) {
        this.addResultItem(lines, item, config);
      }

      if (groups.length > 1) {
        lines.push(''); // Empty line between groups
      }
    }
  }

  /**
   * Add individual result item (inherited from safe-delete item display)
   */
  private static addResultItem<T extends AnalysisCandidate>(
    lines: string[],
    item: T,
    config: AnalysisFormattingOptions
  ): void {
    const { functionInfo, confidenceScore, estimatedImpact, analysisReason } = item;
    const location = `${functionInfo.startLine}-${functionInfo.endLine}`;
    const size = `${functionInfo.endLine - functionInfo.startLine + 1} lines`;

    const icon = this.getImpactIcon(estimatedImpact);
    const nameColor = this.getConfidenceColor(confidenceScore, estimatedImpact, config.colors);
    const functionName = config.colors ? nameColor(functionInfo.name) : functionInfo.name;

    let line = `  ${icon} ${functionName} ${this.colorize('gray', `(${location}, ${size})`, config.colors)}`;
    
    if (config.showConfidence) {
      const confidenceText = `${(confidenceScore * 100).toFixed(1)}%`;
      line += ` ${this.colorize('dim', `[${confidenceText}]`, config.colors)}`;
    }

    lines.push(line);

    if (config.verbose) {
      lines.push(this.colorize('gray', `     Reason: ${analysisReason}`, config.colors));
      lines.push(this.colorize('gray', `     Impact: ${estimatedImpact}`, config.colors));
      lines.push(this.colorize('gray', `     File: ${functionInfo.filePath}`, config.colors));
    }
  }

  /**
   * Add summary statistics (inherited from safe-delete statistics)
   */
  private static addSummaryStatistics<T extends AnalysisCandidate>(
    lines: string[],
    results: T[],
    colors: boolean
  ): void {
    const totalItems = results.length;
    const impactDistribution = {
      low: results.filter(r => r.estimatedImpact === 'low').length,
      medium: results.filter(r => r.estimatedImpact === 'medium').length,
      high: results.filter(r => r.estimatedImpact === 'high').length
    };

    const avgConfidence = totalItems > 0 
      ? results.reduce((sum, r) => sum + r.confidenceScore, 0) / totalItems 
      : 0;

    lines.push(this.colorize('dim', '─'.repeat(50), colors));
    lines.push(this.colorize('bold', `Total items: ${totalItems}`, colors));
    lines.push(`Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    lines.push(`Impact distribution: ${impactDistribution.low} low, ${impactDistribution.medium} medium, ${impactDistribution.high} high`);
  }

  /**
   * Add metadata section
   */
  private static addMetadataSection(
    lines: string[],
    metadata: any,
    colors: boolean
  ): void {
    lines.push(this.colorize('bold', '\n📋 Analysis Metadata', colors));
    
    if (metadata.processingTime?.phases) {
      lines.push('\nProcessing phases:');
      for (const [phase, time] of Object.entries(metadata.processingTime.phases)) {
        lines.push(`  ${phase}: ${time}ms`);
      }
    }
    
    if (metadata.entryPoints?.length > 0) {
      lines.push(`\nEntry points detected: ${metadata.entryPoints.length}`);
    }
  }

  /**
   * Calculate group summary statistics
   */
  private static calculateGroupSummary<T extends AnalysisCandidate>(items: T[]): GroupSummary {
    const averageConfidence = items.length > 0 
      ? items.reduce((sum, item) => sum + item.confidenceScore, 0) / items.length 
      : 0;

    const impactDistribution = {
      low: items.filter(item => item.estimatedImpact === 'low').length,
      medium: items.filter(item => item.estimatedImpact === 'medium').length,
      high: items.filter(item => item.estimatedImpact === 'high').length
    };

    return {
      itemCount: items.length,
      averageConfidence,
      impactDistribution
    };
  }

  /**
   * Format group title based on grouping type
   */
  private static formatGroupTitle(key: string, groupBy: string): string {
    switch (groupBy) {
      case 'file':
        return key;
      case 'confidence':
        return key.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
      case 'impact':
        return key.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
      default:
        return key;
    }
  }

  /**
   * Get icon based on impact level (inherited from safe-delete icons)
   */
  private static getImpactIcon(impact: 'low' | 'medium' | 'high'): string {
    switch (impact) {
      case 'low': return '🟢';
      case 'medium': return '🟡';
      case 'high': return '🔴';
    }
  }

  /**
   * Get color function based on confidence and impact (inherited from safe-delete colors)
   */
  private static getConfidenceColor(
    confidenceScore: number,
    estimatedImpact: 'low' | 'medium' | 'high',
    colors: boolean
  ) {
    if (!colors) return (text: string) => text;

    if (confidenceScore >= 0.95 && estimatedImpact === 'low') {
      return chalk.green;
    } else if (confidenceScore < 0.7 || estimatedImpact === 'high') {
      return chalk.red;
    }
    return chalk.yellow;
  }

  /**
   * Apply color if colors are enabled
   */
  private static colorize(
    color: 'red' | 'green' | 'yellow' | 'blue' | 'cyan' | 'gray' | 'dim' | 'bold' | 'underline',
    text: string,
    colors: boolean
  ): string {
    if (!colors) return text;

    switch (color) {
      case 'red': return chalk.red(text);
      case 'green': return chalk.green(text);
      case 'yellow': return chalk.yellow(text);
      case 'blue': return chalk.blue(text);
      case 'cyan': return chalk.cyan(text);
      case 'gray': return chalk.gray(text);
      case 'dim': return chalk.dim(text);
      case 'bold': return chalk.bold(text);
      case 'underline': return chalk.underline(text);
      default: return text;
    }
  }

  /**
   * Format confidence calculation results for debugging
   */
  static formatConfidenceDetails(
    result: ConfidenceCalculationResult,
    colors: boolean = true
  ): string {
    const lines: string[] = [];
    
    lines.push(this.colorize('bold', 'Confidence Calculation Details:', colors));
    lines.push(`Base Score: ${result.baseScore.toFixed(3)}`);
    lines.push(`Final Score: ${this.colorize('cyan', result.finalScore.toFixed(3), colors)}`);
    lines.push(`Method: ${result.metadata.calculationMethod}`);
    
    if (result.adjustments.length > 0) {
      lines.push('\nAdjustments:');
      for (const adjustment of result.adjustments) {
        const sign = adjustment.adjustment >= 0 ? '+' : '';
        const adjustmentColor = adjustment.adjustment >= 0 ? 'green' : 'red';
        lines.push(`  ${adjustment.factor}: ${this.colorize(adjustmentColor, `${sign}${adjustment.adjustment.toFixed(3)}`, colors)} (${adjustment.reason})`);
      }
    }
    
    return lines.join('\n');
  }
}