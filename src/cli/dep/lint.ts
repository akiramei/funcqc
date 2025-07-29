import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler } from '../../utils/error-handler';
import { DatabaseError } from '../../storage/pglite-adapter';
import { ArchitectureConfigManager } from '../../config/architecture-config';
import { ArchitectureValidator } from '../../analyzers/architecture-validator';
import { ArchitectureViolation, ArchitectureAnalysisResult } from '../../types/architecture';
import { loadComprehensiveCallGraphData, validateCallGraphRequirements } from '../../utils/lazy-analysis';
import { DepLintOptions } from './types';
import { getCallTypeColor } from './utils';

/**
 * Lint architecture dependencies against defined rules
 */
export const depLintCommand: VoidCommand<DepLintOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Loading architecture configuration...').start();

    try {
      // Load architecture configuration
      const configManager = new ArchitectureConfigManager();
      const archConfig = configManager.load(options.config);

      if (Object.keys(archConfig.layers).length === 0) {
        spinner.fail(chalk.yellow('No architecture layers defined. Create a .funcqc-arch.yaml configuration file.'));
        console.log(chalk.dim('\nExample configuration:'));
        console.log(chalk.cyan(`layers:
  cli: ["src/cli/**"]
  core: ["src/core/**"]
  storage: ["src/storage/**"]
rules:
  - type: forbid
    from: "storage"
    to: "cli"
    description: "Storage should not depend on CLI"
    severity: error`));
        return;
      }

      spinner.text = 'Loading snapshot data...';

      // Use comprehensive call graph data including internal call edges
      const { allEdges, functions } = await loadComprehensiveCallGraphData(env, {
        showProgress: false, // We manage progress with our own spinner
        snapshotId: options.snapshot
      });

      // Validate that we have sufficient call graph data
      validateCallGraphRequirements(allEdges, 'dep lint');

      spinner.text = 'Loading functions and call graph...';

      if (functions.length === 0) {
        spinner.fail(chalk.yellow('No functions found in the snapshot.'));
        return;
      }

      if (allEdges.length === 0) {
        spinner.fail(chalk.yellow('No call graph data found. The call graph analyzer may need to be run.'));
        return;
      }

      spinner.text = 'Analyzing architecture compliance...';

      // Validate architecture
      const validator = new ArchitectureValidator(archConfig);
      const analysisResult = validator.analyzeArchitecture(functions, allEdges);

      spinner.succeed('Architecture analysis complete');

      // Apply filters
      let filteredViolations = analysisResult.violations;

      // Filter by severity
      if (options.severity) {
        const severityOrder = { info: 1, warning: 2, error: 3 };
        const minSeverity = severityOrder[options.severity];
        filteredViolations = filteredViolations.filter(v => 
          severityOrder[v.severity] >= minSeverity
        );
      }

      // Apply limit
      if (options.maxViolations) {
        const limit = parseInt(options.maxViolations, 10);
        if (!isNaN(limit) && limit > 0) {
          filteredViolations = filteredViolations.slice(0, limit);
        }
      }

      // Output results
      if (options.format === 'json') {
        outputArchLintJSON(analysisResult, filteredViolations, options);
      } else {
        outputArchLintTable(analysisResult, filteredViolations, options);
      }

      // Exit with error code if there are violations
      if (filteredViolations.some(v => v.severity === 'error')) {
        process.exit(1);
      }

    } catch (error) {
      spinner.fail('Failed to analyze architecture');
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

/**
 * Output architecture lint results as JSON
 */
function outputArchLintJSON(
  analysisResult: ArchitectureAnalysisResult,
  violations: ArchitectureViolation[],
  options: DepLintOptions
): void {
  const result = {
    summary: analysisResult.summary,
    violations: violations,
    ...(options.includeMetrics && {
      metrics: analysisResult.metrics,
      layerAssignments: analysisResult.layerAssignments,
    }),
    filters: {
      severity: options.severity,
      maxViolations: options.maxViolations,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output architecture lint results as formatted table
 */
function outputArchLintTable(
  analysisResult: ArchitectureAnalysisResult,
  violations: ArchitectureViolation[],
  options: DepLintOptions
): void {
  const { summary } = analysisResult;

  displayArchLintHeader(summary);
  displayViolationSummary(summary);

  if (violations.length === 0) {
    console.log(chalk.green('✅ No architecture violations found!'));
    return;
  }

  displayViolationDetails(violations);

  if (options.includeMetrics && analysisResult.metrics) {
    displayArchitectureMetrics(analysisResult.metrics);
  }

  displayArchLintSuggestions(summary, violations.length);
}

/**
 * Output architecture lint report header and summary
 */
function displayArchLintHeader(summary: ArchitectureAnalysisResult['summary']): void {
  console.log(chalk.bold('\n🏗️  Architecture Lint Report\n'));
  console.log(`Total functions: ${chalk.cyan(summary.totalFunctions)}`);
  console.log(`Total layers: ${chalk.cyan(summary.totalLayers)}`);
  console.log(`Total rules: ${chalk.cyan(summary.totalRules)}`);
  console.log(`Layer coverage: ${chalk.yellow((summary.layerCoverage * 100).toFixed(1))}%`);
  console.log();
}

/**
 * Display violation summary statistics
 */
function displayViolationSummary(summary: ArchitectureAnalysisResult['summary']): void {
  const violationSummary = [
    { label: 'Error violations', count: summary.errorViolations, color: chalk.red },
    { label: 'Warning violations', count: summary.warningViolations, color: chalk.yellow },
    { label: 'Info violations', count: summary.infoViolations, color: chalk.blue },
  ];

  console.log(chalk.bold('📊 Violation Summary:'));
  violationSummary.forEach(({ label, count, color }) => {
    if (count > 0) {
      console.log(`  ${color('●')} ${label}: ${color(count)}`);
    }
  });
  console.log();
}

/**
 * Display violations organized by severity and file
 */
function displayViolationDetails(violations: ArchitectureViolation[]): void {
  const violationsBySeverity = groupViolationsBySeverity(violations);
  const severityOrder: Array<'error' | 'warning' | 'info'> = ['error', 'warning', 'info'];
  const severityIcons = { error: '❌', warning: '⚠️', info: 'ℹ️' };
  const severityColors = { error: chalk.red, warning: chalk.yellow, info: chalk.blue };

  for (const severity of severityOrder) {
    const severityViolations = violationsBySeverity[severity];
    if (!severityViolations || severityViolations.length === 0) continue;

    console.log(severityColors[severity].bold(`${severityIcons[severity]} ${severity.toUpperCase()} Violations (${severityViolations.length}):`));
    console.log();

    displayViolationsByFile(severityViolations, severityColors[severity]);
  }
}

/**
 * Group violations by severity level
 */
function groupViolationsBySeverity(violations: ArchitectureViolation[]): Record<string, ArchitectureViolation[]> {
  return violations.reduce((groups, violation) => {
    if (!groups[violation.severity]) {
      groups[violation.severity] = [];
    }
    groups[violation.severity].push(violation);
    return groups;
  }, {} as Record<string, ArchitectureViolation[]>);
}

/**
 * Group and display violations by file
 */
function displayViolationsByFile(violations: ArchitectureViolation[], severityColor: typeof chalk.red): void {
  const violationsByFile = violations.reduce((groups, violation) => {
    const file = violation.source.filePath;
    if (!groups[file]) {
      groups[file] = [];
    }
    groups[file].push(violation);
    return groups;
  }, {} as Record<string, ArchitectureViolation[]>);

  for (const [filePath, fileViolations] of Object.entries(violationsByFile)) {
    console.log(chalk.underline(filePath));
    
    fileViolations.forEach(violation => {
      const { source, target, message, context } = violation;
      
      console.log(`  ${severityColor('●')} ${chalk.cyan(source.functionName)} → ${chalk.green(target.functionName)}`);
      console.log(`    ${chalk.gray('Layer:')} ${source.layer} → ${target.layer}`);
      console.log(`    ${chalk.gray('Rule:')} ${message}`);
      
      if (context?.lineNumber) {
        console.log(`    ${chalk.gray('Line:')} ${context.lineNumber}`);
      }
      
      if (context?.callType) {
        console.log(`    ${chalk.gray('Call type:')} ${getCallTypeColor(context.callType)(context.callType)}`);
      }
      
      console.log();
    });
  }
}

/**
 * Display architecture metrics if enabled
 */
function displayArchitectureMetrics(metrics: NonNullable<ArchitectureAnalysisResult['metrics']>): void {
  console.log(chalk.bold('📈 Architecture Metrics:'));
  console.log();
  
  const { layerCoupling, layerCohesion } = metrics;
  
  // Layer cohesion
  console.log(chalk.bold('Layer Cohesion (higher is better):'));
  for (const [layer, cohesion] of Object.entries(layerCohesion)) {
    const cohesionValue = cohesion as number;
    const percentage = (cohesionValue * 100).toFixed(1);
    const color = cohesionValue > 0.7 ? chalk.green : cohesionValue > 0.4 ? chalk.yellow : chalk.red;
    console.log(`  ${layer}: ${color(percentage)}%`);
  }
  console.log();
  
  // Layer coupling matrix
  console.log(chalk.bold('Layer Coupling Matrix:'));
  const layers = Object.keys(layerCoupling);
  if (layers.length > 0) {
    console.log(`${''.padEnd(12)} ${layers.map(l => l.padEnd(8)).join('')}`);
    
    for (const fromLayer of layers) {
      const row = layers.map(toLayer => {
        const count = layerCoupling[fromLayer]?.[toLayer] || 0;
        return count.toString().padEnd(8);
      });
      console.log(`${fromLayer.padEnd(12)} ${row.join('')}`);
    }
  }
}

/**
 * Display helpful suggestions based on analysis results
 */
function displayArchLintSuggestions(summary: ArchitectureAnalysisResult['summary'], violationCount: number): void {
  console.log(chalk.dim('─'.repeat(60)));
  
  if (summary.layerCoverage < 0.8) {
    console.log(chalk.dim('💡 Tip: Consider adding layer patterns to improve coverage'));
  }
  
  if (summary.errorViolations > 0) {
    console.log(chalk.dim('💡 Fix error violations to pass architecture validation'));
  }
  
  if (violationCount > 10) {
    console.log(chalk.dim('💡 Use --max-violations to limit output or --severity to filter by level'));
  }
}