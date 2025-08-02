import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { createErrorHandler } from '../../../utils/error-handler';
import { IneffectiveSplitDetector, IneffectiveSplitFinding, IneffectiveSplitRule } from '../../../analyzers/ineffective-split-detector';
import { DetectCommandOptions, IneffectiveSplitsOutput, SeverityLevel } from './types';

/**
 * Detect ineffective function splits
 */
export const detectIneffectiveSplitsCommand: VoidCommand<DetectCommandOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Analyzing functions for ineffective splits...').start();

    try {
      // Get snapshot
      const snapshot = options.snapshot 
        ? await env.storage.getSnapshot(options.snapshot)
        : await env.storage.getLatestSnapshot();
        
      if (!snapshot) {
        spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      spinner.text = 'Loading functions and call graph...';

      // Load functions and call edges
      const functions = await env.storage.findFunctionsInSnapshot(snapshot.id);
      const callEdges = await env.storage.getCallEdgesBySnapshot(snapshot.id);

      if (functions.length === 0) {
        spinner.fail(chalk.yellow('No functions found in snapshot.'));
        return;
      }

      spinner.text = 'Detecting ineffective function splits...';

      // Create detector and analyze
      const detector = new IneffectiveSplitDetector();
      const detectionOptions: import('../../../analyzers/ineffective-split-detector').DetectionOptions = {
        includeTest: options.includeTest || false,
        includeBoundaries: options.includeBoundaries || false,
      };
      
      if (options.threshold) {
        detectionOptions.threshold = parseFloat(options.threshold);
      }
      
      const findings = detector.detectIneffectiveSplits(functions, callEdges, detectionOptions);

      // Apply severity filter
      const filteredFindings = filterBySeverity(findings, options.minSeverity);
      
      // Apply limit
      const limitedFindings = options.limit 
        ? filteredFindings.slice(0, parseInt(options.limit, 10))
        : filteredFindings;

      spinner.succeed(`Found ${findings.length} ineffective splits, displaying ${limitedFindings.length}`);

      // Output results
      if (options.json || options.format === 'json') {
        outputJSON(findings, limitedFindings, options);
      } else {
        outputTable(findings, limitedFindings, functions);
      }

    } catch (error) {
      spinner.fail('Failed to analyze ineffective splits');
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  };

/**
 * Filter findings by severity
 */
function filterBySeverity(
  findings: IneffectiveSplitFinding[], 
  minSeverity?: string
): IneffectiveSplitFinding[] {
  if (!minSeverity) return findings;
  
  const severityOrder: Record<SeverityLevel, number> = {
    'High': 3,
    'Medium': 2,
    'Low': 1
  };
  
  const minLevel = severityOrder[minSeverity as SeverityLevel] || 1;
  
  return findings.filter(f => severityOrder[f.severity] >= minLevel);
}

/**
 * Output findings as JSON
 */
function outputJSON(
  allFindings: IneffectiveSplitFinding[],
  displayedFindings: IneffectiveSplitFinding[],
  options: DetectCommandOptions
): void {
  const output: IneffectiveSplitsOutput = {
    summary: {
      totalFindings: allFindings.length,
      displayedFindings: displayedFindings.length,
      severityBreakdown: {
        high: allFindings.filter(f => f.severity === 'High').length,
        medium: allFindings.filter(f => f.severity === 'Medium').length,
        low: allFindings.filter(f => f.severity === 'Low').length
      },
      displayedSeverityBreakdown: {
        high: displayedFindings.filter(f => f.severity === 'High').length,
        medium: displayedFindings.filter(f => f.severity === 'Medium').length,
        low: displayedFindings.filter(f => f.severity === 'Low').length
      },
      filters: {
        ...(options.minSeverity && { minSeverity: options.minSeverity }),
        includeTest: options.includeTest || false,
        includeBoundaries: options.includeBoundaries || false,
        ...(options.threshold && { threshold: parseFloat(options.threshold) })
      }
    },
    findings: displayedFindings.map(f => ({
      id: f.functionId,
      name: f.name,
      file: f.file,
      line: f.range.startLine,
      severity: f.severity,
      score: f.totalScore,
      rules: f.rulesHit.map(r => ({
        code: r.code,
        evidence: r.evidence
      })),
      metrics: f.metrics,
      suggestions: f.suggestions,
      callers: f.related.callers,
      callees: f.related.callees
    }))
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output findings as formatted table
 */
function outputTable(
  allFindings: IneffectiveSplitFinding[],
  displayedFindings: IneffectiveSplitFinding[],
  functions: import('../../../types').FunctionInfo[]
): void {
  console.log(chalk.bold('\n🔍 Ineffective Function Split Analysis\n'));
  
  // Summary
  console.log(`Total findings: ${chalk.cyan(allFindings.length)}`);
  console.log(`Displayed after filtering: ${chalk.yellow(displayedFindings.length)}\n`);
  
  // Severity breakdown
  const severityBreakdown = {
    high: displayedFindings.filter(f => f.severity === 'High').length,
    medium: displayedFindings.filter(f => f.severity === 'Medium').length,
    low: displayedFindings.filter(f => f.severity === 'Low').length
  };
  
  if (severityBreakdown.high > 0 || severityBreakdown.medium > 0 || severityBreakdown.low > 0) {
    console.log(chalk.bold('📊 Severity Summary:'));
    if (severityBreakdown.high > 0) {
      console.log(`  🚨 High: ${chalk.red.bold(severityBreakdown.high)} (Thin wrappers with no value)`);
    }
    if (severityBreakdown.medium > 0) {
      console.log(`  🔶 Medium: ${chalk.yellow.bold(severityBreakdown.medium)} (Questionable splits)`);
    }
    if (severityBreakdown.low > 0) {
      console.log(`  💡 Low: ${chalk.gray(severityBreakdown.low)} (Consider consolidation)`);
    }
    console.log();
  }
  
  if (displayedFindings.length === 0) {
    console.log(chalk.green('✅ No problematic function splits found!'));
    return;
  }
  
  // Group by severity
  const grouped = groupBySeverity(displayedFindings);
  
  // Display each severity group
  for (const [severity, findings] of Object.entries(grouped)) {
    if (findings.length === 0) continue;
    
    const icon = getSeverityIcon(severity as SeverityLevel);
    const color = getSeverityColor(severity as SeverityLevel);
    
    console.log(color(`${icon} ${severity.toUpperCase()} SEVERITY:`));
    
    findings.forEach((finding, index) => {
      const isLast = index === findings.length - 1;
      const prefix = isLast ? '└──' : '├──';
      
      // Main rule description (highest score first)
      const sortedRules = [...finding.rulesHit].sort((a, b) => b.score - a.score);
      const mainRule = sortedRules[0];
      const ruleDesc = getRuleDescription(mainRule.code);
      
      console.log(`${prefix} ${color(`${ruleDesc} (${mainRule.code})`)} - score: ${finding.totalScore.toFixed(1)}/10`);
      
      // Function info
      console.log(`    ├──→ ${chalk.cyan(finding.name)} ${chalk.gray(`(${finding.file}:${finding.range.startLine})`)}`);
      
      // Related functions
      if (finding.related.callees.length > 0) {
        const functionMap = new Map(functions.map(f => [f.id, f]));
        const callee = functionMap.get(finding.related.callees[0]);
        if (callee) {
          console.log(`    │   └──→ ${chalk.cyan(callee.name)} ${chalk.gray(`(${callee.filePath}:${callee.startLine})`)}`);
        }
      }
      
      // Evidence
      console.log(`    │       ${chalk.gray(mainRule.evidence)}`);
      
      // Additional rules (sorted by score)
      if (sortedRules.length > 1) {
        console.log(`    │       ${chalk.gray(`Also matches: ${sortedRules.slice(1).map(r => r.code).join(', ')}`)}`);
      }
      
      // Suggestions
      console.log(chalk.dim('    💡 Recommendations:'));
      finding.suggestions.slice(0, 3).forEach(suggestion => {
        console.log(chalk.dim(`       • ${suggestion}`));
      });
      
      if (!isLast) console.log();
    });
    
    console.log();
  }
  
  // Tips
  console.log(chalk.dim('💡 Tips:'));
  console.log(chalk.dim('   • Use --json for machine-readable output'));
  console.log(chalk.dim('   • Add --include-test to analyze test files'));
  console.log(chalk.dim('   • Use --min-severity Medium to filter results'));
}

/**
 * Group findings by severity
 */
function groupBySeverity(findings: IneffectiveSplitFinding[]): Record<SeverityLevel, IneffectiveSplitFinding[]> {
  return {
    'High': findings.filter(f => f.severity === 'High'),
    'Medium': findings.filter(f => f.severity === 'Medium'),
    'Low': findings.filter(f => f.severity === 'Low')
  };
}

/**
 * Get severity icon
 */
function getSeverityIcon(severity: SeverityLevel): string {
  switch (severity) {
    case 'High': return '🚨';
    case 'Medium': return '🔶';
    case 'Low': return '💡';
  }
}

/**
 * Get severity color function
 */
function getSeverityColor(severity: SeverityLevel): (text: string) => string {
  switch (severity) {
    case 'High': return chalk.red.bold;
    case 'Medium': return chalk.yellow.bold;
    case 'Low': return chalk.gray;
  }
}

/**
 * Get human-readable rule description
 */
function getRuleDescription(rule: IneffectiveSplitRule): string {
  switch (rule) {
    case IneffectiveSplitRule.INLINE_CANDIDATE:
      return 'Single-use helper';
    case IneffectiveSplitRule.THIN_WRAPPER:
      return 'Thin wrapper';
    case IneffectiveSplitRule.LINEAR_CHAIN_CC1:
      return 'CC=1 chain';
    case IneffectiveSplitRule.PARENT_CC_UNCHANGED:
      return 'Parent complexity unchanged';
    case IneffectiveSplitRule.GENERIC_NAME_LOW_REUSE:
      return 'Generic name, low reuse';
    case IneffectiveSplitRule.PSEUDO_BOUNDARY:
      return 'Pseudo boundary';
    case IneffectiveSplitRule.LOCAL_THROWAWAY:
      return 'Local throwaway';
  }
}