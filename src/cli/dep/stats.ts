import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler } from '../../utils/error-handler';
import { DatabaseError } from '../../storage/pglite-adapter';
import { CallEdge, FunctionInfo } from '../../types';
import { DependencyMetricsCalculator, DependencyMetrics, DependencyStats, DependencyOptions } from '../../analyzers/dependency-metrics';
import { ReachabilityAnalyzer } from '../../analyzers/reachability-analyzer';
import { EntryPointDetector } from '../../analyzers/entry-point-detector';
import { DotGenerator } from '../../visualization/dot-generator';
import { resolveSnapshotId } from '../../utils/snapshot-resolver';
import { DepStatsOptions } from './types';

/**
 * Show dependency statistics and metrics
 */
export const depStatsCommand: VoidCommand<DepStatsOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Calculating dependency metrics...').start();

    try {
      await executeDepStatsAnalysis(env, options, spinner);
    } catch (error) {
      spinner.fail('Failed to calculate dependency metrics');
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
 * Execute the complete dependency statistics analysis
 */
async function executeDepStatsAnalysis(
  env: CommandEnvironment, 
  options: DepStatsOptions, 
  spinner: Ora
): Promise<void> {
  // Load call graph data
  const { callEdges: allEdges, functions } = await loadCallGraphData(env, options, spinner);
  
  // Analyze dependencies
  const { entryPointIds, cyclicFunctions } = await analyzeDependencyStructure(functions, allEdges, spinner);
  
  // Calculate metrics
  const { metrics, stats } = await calculateDependencyMetrics(
    functions, 
    allEdges, 
    entryPointIds, 
    cyclicFunctions, 
    options, 
    spinner
  );
  
  spinner.succeed('Dependency metrics calculated');
  
  // Output results
  outputDepStatsResults(functions, allEdges, metrics, stats, options);
}

/**
 * Load and validate call graph data
 */
async function loadCallGraphData(
  env: CommandEnvironment, 
  options: DepStatsOptions, 
  spinner: Ora
): Promise<{ callEdges: CallEdge[]; functions: FunctionInfo[] }> {
  // Get the target snapshot ID
  const targetSnapshotId = options.snapshot || 'latest';
  const resolvedSnapshotId = await resolveSnapshotId(env, targetSnapshotId);
  
  if (!resolvedSnapshotId) {
    spinner.fail('No snapshot found. Please run "funcqc scan" first.');
    throw new Error('No snapshot found');
  }

  spinner.text = 'Loading functions and call graph...';

  // Load functions from the snapshot (same as health command)
  const functions = await env.storage.findFunctionsInSnapshot(resolvedSnapshotId);
  if (functions.length === 0) {
    spinner.fail(chalk.yellow('No functions found in the snapshot.'));
    throw new Error('No functions found in the snapshot.');
  }

  // Load call edges from the snapshot (same as health command)
  const callEdges = await env.storage.getCallEdgesBySnapshot(resolvedSnapshotId);
  
  // Note: Not validating call graph requirements here to match health behavior
  // This prevents lazy analysis from being triggered
  
  return { callEdges, functions };
}

/**
 * Analyze dependency structure (entry points and cycles)
 */
async function analyzeDependencyStructure(
  functions: FunctionInfo[],
  allEdges: CallEdge[],
  spinner: Ora
): Promise<{ entryPointIds: Set<string>; cyclicFunctions: Set<string> }> {
  spinner.text = 'Detecting entry points...';

  // Detect entry points
  const entryPointDetector = new EntryPointDetector();
  const entryPoints = entryPointDetector.detectEntryPoints(functions);
  const entryPointIds = new Set(entryPoints.map(ep => ep.functionId));

  spinner.text = 'Detecting circular dependencies...';

  // Detect circular dependencies
  const reachabilityAnalyzer = new ReachabilityAnalyzer();
  const cycles = reachabilityAnalyzer.findCircularDependencies(allEdges);
  const cyclicFunctions = new Set<string>();
  cycles.forEach(cycle => cycle.forEach(func => cyclicFunctions.add(func)));
  
  return { entryPointIds, cyclicFunctions };
}

/**
 * Calculate dependency metrics and generate statistics
 */
async function calculateDependencyMetrics(
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  entryPointIds: Set<string>,
  cyclicFunctions: Set<string>,
  options: DepStatsOptions,
  spinner: Ora
): Promise<{ metrics: DependencyMetrics[]; stats: DependencyStats }> {
  spinner.text = 'Calculating dependency metrics...';

  // Calculate dependency metrics
  const metricsCalculator = new DependencyMetricsCalculator();
  const metrics = metricsCalculator.calculateMetrics(
    functions,
    callEdges,
    entryPointIds,
    cyclicFunctions
  );

  // Parse CLI options into dependency options
  const dependencyOptions = parseDependencyOptions(options, spinner);
  
  const stats = metricsCalculator.generateStats(metrics, dependencyOptions);
  
  return { metrics, stats };
}

/**
 * Parse and validate CLI options into DependencyOptions
 */
function parseDependencyOptions(
  options: DepStatsOptions, 
  spinner: Ora
): DependencyOptions {
  const dependencyOptions: DependencyOptions = {};
  
  if (options.hubThreshold) {
    const parsed = parseInt(options.hubThreshold, 10);
    if (isNaN(parsed) || parsed < 0) {
      spinner.fail(`Invalid hub threshold: ${options.hubThreshold}`);
      throw new Error(`Invalid hub threshold: ${options.hubThreshold}`);
    }
    dependencyOptions.hubThreshold = parsed;
  }
  
  if (options.utilityThreshold) {
    const parsed = parseInt(options.utilityThreshold, 10);
    if (isNaN(parsed) || parsed < 0) {
      spinner.fail(`Invalid utility threshold: ${options.utilityThreshold}`);
      throw new Error(`Invalid utility threshold: ${options.utilityThreshold}`);
    }
    dependencyOptions.utilityThreshold = parsed;
  }
  
  if (options.maxHubFunctions) {
    const parsed = parseInt(options.maxHubFunctions, 10);
    if (isNaN(parsed) || parsed < 1) {
      spinner.fail(`Invalid max hub functions: ${options.maxHubFunctions}`);
      throw new Error(`Invalid max hub functions: ${options.maxHubFunctions}`);
    }
    dependencyOptions.maxHubFunctions = parsed;
  }
  
  if (options.maxUtilityFunctions) {
    const parsed = parseInt(options.maxUtilityFunctions, 10);
    if (isNaN(parsed) || parsed < 1) {
      spinner.fail(`Invalid max utility functions: ${options.maxUtilityFunctions}`);
      throw new Error(`Invalid max utility functions: ${options.maxUtilityFunctions}`);
    }
    dependencyOptions.maxUtilityFunctions = parsed;
  }
  
  return dependencyOptions;
}

/**
 * Output dependency statistics results in the requested format
 */
function outputDepStatsResults(
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  metrics: DependencyMetrics[],
  stats: DependencyStats,
  options: DepStatsOptions
): void {
  if (options.format === 'dot') {
    outputDepStatsDot(functions, callEdges, metrics, options);
  } else if (options.json || options.format === 'json') {
    outputDepStatsJSON(metrics, stats, options);
  } else {
    outputDepStatsTable(metrics, stats, functions, options);
  }
}

/**
 * Output dependency stats as DOT format
 */
function outputDepStatsDot(
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  metrics: DependencyMetrics[],
  _options: DepStatsOptions
): void {
  const dotGenerator = new DotGenerator();
  const dotContent = dotGenerator.generateDependencyGraph(functions, callEdges, metrics);
  console.log(dotContent);
}

/**
 * Output dependency stats as JSON
 */
function outputDepStatsJSON(metrics: DependencyMetrics[], stats: DependencyStats, options: DepStatsOptions): void {
  let limit = 20;
  if (options.limit) {
    const parsed = parseInt(options.limit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = parsed;
    }
  }
  const sortField = options.sort || 'fanin';
  
  // Sort metrics
  const sortedMetrics = [...metrics].sort((a, b) => {
    switch (sortField) {
      case 'fanin':
        return b.fanIn - a.fanIn;
      case 'fanout':
        return b.fanOut - a.fanOut;
      case 'depth':
        return b.depthFromEntry - a.depthFromEntry;
      case 'name':
        return a.functionName.localeCompare(b.functionName);
      default:
        return 0;
    }
  });

  const result = {
    summary: stats,
    metrics: sortedMetrics.slice(0, limit),
    filters: {
      sort: sortField,
      limit,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output dependency stats as formatted table
 */
function outputDepStatsTable(
  metrics: DependencyMetrics[], 
  stats: DependencyStats, 
  functions: FunctionInfo[],
  options: DepStatsOptions
): void {
  displayStatsSummary(stats);
  displayHubFunctions(stats, options);
  displayUtilityFunctions(stats, options);
  displayIsolatedFunctions(stats, options);
  displayTopFunctionsTable(metrics, functions, options);
}

/**
 * Display statistical summary
 */
function displayStatsSummary(stats: DependencyStats): void {
  console.log(chalk.bold('\n📊 Dependency Statistics\n'));
  console.log(`Total functions: ${chalk.cyan(stats.totalFunctions)}`);
  console.log(`Average fan-in: ${chalk.yellow(stats.avgFanIn.toFixed(1))}`);
  console.log(`Average fan-out: ${chalk.yellow(stats.avgFanOut.toFixed(1))}`);
  console.log(`Maximum fan-in: ${chalk.red(stats.maxFanIn)}`);
  console.log(`Maximum fan-out: ${chalk.red(stats.maxFanOut)}`);
  console.log();
}

/**
 * Display hub functions (high fan-in)
 */
function displayHubFunctions(stats: DependencyStats, options: DepStatsOptions): void {
  if (!options.showHubs || stats.hubFunctions.length === 0) {
    return;
  }
  
  console.log(chalk.bold('🎯 Hub Functions (High Fan-In):'));
  stats.hubFunctions.forEach((func: DependencyMetrics, index: number) => {
    console.log(`  ${index + 1}. ${chalk.cyan(func.functionName)} (fan-in: ${chalk.yellow(func.fanIn)})`);
  });
  console.log();
}

/**
 * Display utility functions (high fan-out)
 */
function displayUtilityFunctions(stats: DependencyStats, options: DepStatsOptions): void {
  if (!options.showUtility || stats.utilityFunctions.length === 0) {
    return;
  }
  
  console.log(chalk.bold('🔧 Utility Functions (High Fan-Out):'));
  stats.utilityFunctions.forEach((func: DependencyMetrics, index: number) => {
    console.log(`  ${index + 1}. ${chalk.cyan(func.functionName)} (fan-out: ${chalk.yellow(func.fanOut)})`);
  });
  console.log();
}

/**
 * Display isolated functions
 */
function displayIsolatedFunctions(stats: DependencyStats, options: DepStatsOptions): void {
  if (!options.showIsolated || stats.isolatedFunctions.length === 0) {
    return;
  }
  
  console.log(chalk.bold('🏝️ Isolated Functions:'));
  stats.isolatedFunctions.forEach((func: DependencyMetrics, index: number) => {
    console.log(`  ${index + 1}. ${chalk.dim(func.functionName)} (${func.filePath})`);
  });
  console.log();
}

/**
 * Parse display limit from options
 */
function parseDisplayLimit(options: DepStatsOptions): number {
  const defaultLimit = 20;
  
  if (!options.limit) {
    return defaultLimit;
  }
  
  const parsed = parseInt(options.limit, 10);
  return (!isNaN(parsed) && parsed > 0) ? parsed : defaultLimit;
}

/**
 * Sort metrics by specified criteria
 */
function sortMetricsByCriteria(metrics: DependencyMetrics[], sortField: string): DependencyMetrics[] {
  return [...metrics].sort((a, b) => {
    switch (sortField) {
      case 'fanin':
        return b.fanIn - a.fanIn;
      case 'fanout':
        return b.fanOut - a.fanOut;
      case 'depth':
        return b.depthFromEntry - a.depthFromEntry;
      case 'name':
        return a.functionName.localeCompare(b.functionName);
      default:
        return 0;
    }
  });
}

/**
 * Display top functions table
 */
function displayTopFunctionsTable(
  metrics: DependencyMetrics[], 
  functions: FunctionInfo[],
  options: DepStatsOptions
): void {
  const limit = parseDisplayLimit(options);
  const sortField = options.sort || 'fanin';
  const sortedMetrics = sortMetricsByCriteria(metrics, sortField);

  // Create function lookup map
  const functionMap = new Map<string, FunctionInfo>();
  functions.forEach(func => functionMap.set(func.id, func));

  console.log(chalk.bold(`📈 Top ${limit} Functions (by ${sortField}):`));
  console.log(chalk.bold('Name                     Location                              Fan-In  Fan-Out  Depth  Cyclic'));
  console.log('─'.repeat(95));

  sortedMetrics.slice(0, limit).forEach((metric: DependencyMetrics) => {
    displayMetricRow(metric, functionMap);
  });
}

/**
 * Format location with file path and line number
 */
function formatLocation(filePath: string, line?: number, maxLength: number = 35): string {
  const location = line ? `${filePath}:${line}` : filePath;
  
  if (location.length <= maxLength) {
    return location.padEnd(maxLength);
  }
  
  // Truncate from the beginning, keeping the end (file name and line)
  const truncated = '...' + location.slice(-(maxLength - 3));
  return truncated.padEnd(maxLength);
}

/**
 * Display a single metric row in the table
 */
function displayMetricRow(metric: DependencyMetrics, functionMap: Map<string, FunctionInfo>): void {
  const name = metric.functionName.padEnd(25).substring(0, 25);
  
  // Get line number from function info
  const funcInfo = functionMap.get(metric.functionId);
  const location = formatLocation(metric.filePath, funcInfo?.startLine, 35);
  
  const fanIn = metric.fanIn.toString().padStart(6);
  const fanOut = metric.fanOut.toString().padStart(8);
  const depth = metric.depthFromEntry === -1 ? '  N/A' : metric.depthFromEntry.toString().padStart(5);
  
  // Fix the cyclic indicator - use clear text instead of confusing symbols
  const cyclic = metric.isCyclic ? chalk.red(' Yes') : chalk.green('  No');

  console.log(`${name} ${location} ${fanIn}  ${fanOut}  ${depth}  ${cyclic}`);
}