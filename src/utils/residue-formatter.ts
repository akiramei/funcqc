/**
 * Debug Residue Formatter
 * 
 * Formats debug residue findings for various output formats
 */

import chalk from 'chalk';
import { table } from 'table';
import * as path from 'path';
import {
  ResidueCheckResult,
  ResidueFinding,
  ResidueKind,
  AIOptimizedOutput,
  AIOptimizedFinding,
  GlobalProjectContext,
  DecisionFactors,
  RecommendedAction,
  ReplacementOption
} from '../types/debug-residue';

/**
 * Format residue check results based on options
 */
export class ResidueFormatter {
  /**
   * Format results based on output options
   */
  static format(
    result: ResidueCheckResult,
    options: {
      json?: boolean;
      aiMode?: boolean;
      verbose?: boolean;
      quiet?: boolean;
    } = {}
  ): string {
    if (options.json && options.aiMode) {
      return this.formatAIOptimized(result);
    }
    
    if (options.json) {
      return JSON.stringify(result, null, 2);
    }
    
    if (options.quiet) {
      return this.formatQuiet(result);
    }
    
    return this.formatTable(result, options.verbose || false);
  }

  /**
   * Format as human-readable table
   */
  private static formatTable(result: ResidueCheckResult, verbose: boolean): string {
    const output: string[] = [];
    
    // Header
    output.push(chalk.bold('\n🔍 Debug Residue Check Report'));
    output.push('=' .repeat(60));
    
    // Group findings by kind
    const groupedFindings = this.groupByKind(result.findings);
    
    // AutoRemove section
    if (groupedFindings.AutoRemove.length > 0) {
      output.push('\n' + chalk.red.bold(`AutoRemove (${groupedFindings.AutoRemove.length} items):`));
      output.push(this.formatFindingsTable(groupedFindings.AutoRemove, verbose));
    }
    
    // NeedsReview section
    if (groupedFindings.NeedsReview.length > 0) {
      output.push('\n' + chalk.yellow.bold(`NeedsReview (${groupedFindings.NeedsReview.length} items):`));
      output.push(this.formatFindingsTable(groupedFindings.NeedsReview, verbose));
    }
    
    // Exempt section (only if verbose)
    if (verbose && groupedFindings.Exempt.length > 0) {
      output.push('\n' + chalk.green.bold(`Exempt (${groupedFindings.Exempt.length} items):`));
      output.push(this.formatFindingsTable(groupedFindings.Exempt, verbose));
    }
    
    // Summary
    output.push('\n' + chalk.bold('Summary:'));
    output.push(this.formatSummary(result));
    
    // Exit code hint
    const exitCode = result.summary.autoRemove > 0 ? 1 : 0;
    output.push(`\nExit code: ${exitCode} ${exitCode > 0 ? '(AutoRemove items found)' : '(Clean)'}`);
    
    return output.join('\n');
  }

  /**
   * Format findings as a table
   */
  private static formatFindingsTable(findings: ResidueFinding[], verbose: boolean): string {
    if (!verbose) {
      // Simple format
      const rows = findings.map(f => {
        const location = `${this.formatPath(f.filePath)}:${f.line}:${f.column}`;
        const code = this.truncateCode(f.code, 40);
        const reason = `[${f.reason}]`;
        return `  ${location.padEnd(40)} ${code.padEnd(45)} ${reason}`;
      });
      return rows.join('\n');
    }
    
    // Detailed table format
    const headers = ['File', 'Line', 'Pattern', 'Code', 'Reason'];
    const rows = findings.map(f => [
      this.formatPath(f.filePath),
      f.line.toString(),
      f.pattern,
      this.truncateCode(f.code, 30),
      f.reason
    ]);
    
    const tableConfig = {
      columns: {
        0: { width: 30 },
        1: { width: 6, alignment: 'right' as const },
        2: { width: 15 },
        3: { width: 35 },
        4: { width: 25 }
      }
    };
    
    return table([headers, ...rows], tableConfig);
  }

  /**
   * Format summary statistics
   */
  private static formatSummary(result: ResidueCheckResult): string {
    const { summary } = result;
    const lines: string[] = [];
    
    lines.push(`  Total findings: ${summary.total}`);
    lines.push(`  ${chalk.red('AutoRemove')}: ${summary.autoRemove} (should be removed)`);
    lines.push(`  ${chalk.yellow('NeedsReview')}: ${summary.needsReview} (requires human verification)`);
    lines.push(`  ${chalk.green('Exempt')}: ${summary.exempt} (valid user-facing output)`);
    lines.push(`  Files analyzed: ${summary.filesAnalyzed}`);
    lines.push(`  Functions analyzed: ${summary.functionsAnalyzed}`);
    
    return lines.join('\n');
  }

  /**
   * Format quiet output (minimal)
   */
  private static formatQuiet(result: ResidueCheckResult): string {
    const { summary } = result;
    return `AutoRemove: ${summary.autoRemove}, NeedsReview: ${summary.needsReview}, Exempt: ${summary.exempt}`;
  }

  /**
   * Format AI-optimized output
   */
  private static formatAIOptimized(result: ResidueCheckResult): string {
    const aiOutput: AIOptimizedOutput = {
      version: '1.0',
      mode: 'ai-optimized',
      findings: result.findings.map((f, index) => this.convertToAIFinding(f, index)),
      globalContext: this.inferGlobalContext(result)
    };
    
    return JSON.stringify(aiOutput, null, 2);
  }

  /**
   * Convert regular finding to AI-optimized finding
   */
  private static convertToAIFinding(finding: ResidueFinding, index: number): AIOptimizedFinding {
    const aiFinding: AIOptimizedFinding = {
      ...finding,
      id: `finding-${String(index + 1).padStart(3, '0')}`,
      confidence: this.calculateConfidence(finding)
    };
    
    // Add actionable info for non-exempt findings
    if (finding.kind !== 'Exempt') {
      aiFinding.actionableInfo = {
        currentCode: finding.code,
        availableReplacements: this.getAvailableReplacements(finding),
        sideEffects: {
          unusedVariables: [],
          breakingChanges: false,
          testImpact: 'low'
        }
      };
    }
    
    // Add decision factors for NeedsReview
    if (finding.kind === 'NeedsReview') {
      aiFinding.decisionFactors = this.calculateDecisionFactors(finding);
      aiFinding.recommendedAction = this.getRecommendedAction(finding);
    }
    
    return aiFinding;
  }

  /**
   * Calculate confidence score for a finding
   */
  private static calculateConfidence(finding: ResidueFinding): number {
    if (finding.kind === 'AutoRemove') {
      // High confidence for explicit debug patterns
      if (finding.pattern === 'debugger' || finding.pattern === 'debug-marker') {
        return 1.0;
      }
      return 0.95;
    }
    
    if (finding.kind === 'NeedsReview') {
      // Lower confidence for ambiguous patterns
      if (finding.reason.includes('NODE_ENV')) {
        return 0.7;
      }
      return 0.65;
    }
    
    return 0.9; // Exempt
  }

  /**
   * Get available replacements for a finding
   */
  private static getAvailableReplacements(finding: ResidueFinding): Record<string, ReplacementOption> {
    const replacements: Record<string, ReplacementOption> = {};
    
    if (finding.pattern === 'console.log' || finding.pattern === 'console.error') {
      replacements['logger'] = {
        available: true,
        suggestedCall: `logger.${finding.pattern === 'console.error' ? 'error' : 'info'}(${this.extractArgs(finding.code)})`,
        rationale: 'Use structured logging for production'
      };
      
      if (finding.context?.functionPurpose === 'authentication') {
        replacements['notifyUser'] = {
          available: true,
          suggestedCall: `notifyUser('Login successful')`,
          rationale: 'User-facing notification'
        };
      }
    }
    
    return replacements;
  }

  /**
   * Calculate decision factors
   */
  private static calculateDecisionFactors(finding: ResidueFinding): DecisionFactors {
    const factors: DecisionFactors = {
      isUserFacing: 0.3,
      isAuditLog: 0.3,
      isDebugOnly: 0.4,
      inProductionCode: !finding.filePath.includes('test'),
      hasAlternative: true
    };
    
    // Adjust based on context
    if (finding.context) {
      if (finding.context.functionPurpose === 'authentication') {
        factors.isAuditLog = 0.8;
        factors.isUserFacing = 0.7;
        factors.isDebugOnly = 0.2;
      }
      
      if (finding.context.fileType === 'api-handler') {
        factors.isUserFacing = 0.6;
      }
      
      if (finding.context.isUnderNodeEnvGuard) {
        factors.isDebugOnly = 0.8;
      }
    }
    
    return factors;
  }

  /**
   * Get recommended action
   */
  private static getRecommendedAction(finding: ResidueFinding): RecommendedAction {
    const factors = this.calculateDecisionFactors(finding);
    
    if (factors.isDebugOnly > 0.7) {
      return {
        primary: 'remove',
        reasoning: 'High probability of debug-only code'
      };
    }
    
    if (factors.isAuditLog > 0.6) {
      return {
        primary: 'replace_with_logger',
        fallback: 'keep_with_comment',
        reasoning: 'Likely audit logging - should use structured logger'
      };
    }
    
    if (factors.isUserFacing > 0.6) {
      return {
        primary: 'replace_with_notifier',
        fallback: 'keep',
        reasoning: 'Likely user-facing message - should use notification system'
      };
    }
    
    return {
      primary: 'keep_with_comment',
      reasoning: 'Unclear intent - needs human review'
    };
  }

  /**
   * Infer global project context
   */
  private static inferGlobalContext(result: ResidueCheckResult): GlobalProjectContext {
    const hasLoggerImports = result.findings.some(f => 
      f.context?.imports?.some(imp => imp.includes('logger'))
    );
    
    const hasNotifyImports = result.findings.some(f => 
      f.context?.imports?.some(imp => imp.includes('notifyUser'))
    );
    
    // Infer project type from file paths
    let projectType = 'unknown';
    if (result.findings.some(f => f.filePath.includes('/api/'))) {
      projectType = 'web-api';
    } else if (result.findings.some(f => f.filePath.includes('/cli/'))) {
      projectType = 'cli-tool';
    }
    
    const context: GlobalProjectContext = {
      projectType,
      hasLogger: hasLoggerImports,
      hasNotificationSystem: hasNotifyImports,
      loggingConvention: hasLoggerImports ? 'winston' : undefined,
      outputConvention: undefined
    };

    if (hasLoggerImports || hasNotifyImports) {
      context.outputConvention = {
        userFacing: ['notifyUser', 'printUsage'],
        debugging: ['debugLog', 'console.debug'],
        logging: ['logger.info', 'logger.warn', 'logger.error']
      };
    }

    return context;
  }

  /**
   * Group findings by kind
   */
  private static groupByKind(findings: ResidueFinding[]): Record<ResidueKind, ResidueFinding[]> {
    return {
      AutoRemove: findings.filter(f => f.kind === 'AutoRemove'),
      NeedsReview: findings.filter(f => f.kind === 'NeedsReview'),
      Exempt: findings.filter(f => f.kind === 'Exempt')
    };
  }

  /**
   * Format file path for display
   */
  private static formatPath(filePath: string): string {
    return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  }

  /**
   * Truncate code for display
   */
  private static truncateCode(code: string, maxLength: number): string {
    const cleaned = code.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) {
      return cleaned;
    }
    return cleaned.substring(0, maxLength - 3) + '...';
  }

  /**
   * Extract arguments from code
   */
  private static extractArgs(code: string): string {
    const match = code.match(/\((.*)\)/);
    return match ? match[1] : '';
  }
}