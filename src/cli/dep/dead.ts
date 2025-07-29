import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler } from '../../utils/error-handler';
import { ReachabilityAnalyzer, DeadCodeInfo, ReachabilityResult } from '../../analyzers/reachability-analyzer';
import { EntryPointDetector } from '../../analyzers/entry-point-detector';
import { DotGenerator } from '../../visualization/dot-generator';
import { loadComprehensiveCallGraphData, validateCallGraphRequirements } from '../../utils/lazy-analysis';
import { DepDeadOptions } from './types';

/**
 * Analyze dead code and unreachable functions
 */
export const depDeadCommand: VoidCommand<DepDeadOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    const spinner = ora('Analyzing dead code...').start();

    try {
      // Use comprehensive call graph data including internal call edges
      const { allEdges, functions } = await loadComprehensiveCallGraphData(env, {
        showProgress: false, // We manage progress with our own spinner
        snapshotId: options.snapshot
      });

      // Validate that we have sufficient call graph data
      validateCallGraphRequirements(allEdges, 'dep dead');

      spinner.text = 'Loading functions and call graph...';

      if (functions.length === 0) {
        spinner.fail(chalk.yellow('No functions found in the latest snapshot.'));
        return;
      }

      spinner.text = 'Detecting entry points...';

      // Parse layer entry points if specified
      const layerEntryPoints = options.layerEntryPoints
        ? options.layerEntryPoints.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : undefined;
      
      // Detect entry points
      const entryPointDetector = new EntryPointDetector({
        ...(options.verbose !== undefined && { verbose: options.verbose }),
        ...(options.verbose !== undefined && { debug: options.verbose }),
        ...(layerEntryPoints && { layerEntryPoints })
      });
      let entryPoints = entryPointDetector.detectEntryPoints(functions);

      // Apply entry point filters
      if (options.excludeExports) {
        // Remove exported functions from entry points
        entryPoints = entryPoints.filter(ep => ep.reason !== 'exported');
      }

      if (options.excludeTests) {
        // Remove test functions from entry points
        entryPoints = entryPoints.filter(ep => ep.reason !== 'test');
      }

      spinner.text = 'Analyzing reachability...';

      // Analyze reachability
      const reachabilityAnalyzer = new ReachabilityAnalyzer();
      const reachabilityResult = reachabilityAnalyzer.analyzeReachability(
        functions,
        allEdges,
        entryPoints
      );

      // Get detailed dead code information
      const deadCodeInfo = reachabilityAnalyzer.getDeadCodeInfo(
        reachabilityResult.unreachable,
        functions,
        allEdges,
        {
          excludeTests: options.excludeTests ?? false,
          excludeSmallFunctions: options.excludeSmall ?? false,
          minFunctionSize: options.threshold ? parseInt(options.threshold) : 3,
        }
      );

      // Get unused export functions information
      const unusedExportInfo = reachabilityAnalyzer.getDeadCodeInfo(
        reachabilityResult.unusedExports,
        functions,
        allEdges,
        {
          excludeTests: false,
          excludeSmallFunctions: false,
          minFunctionSize: 1,
        }
      );

      spinner.succeed('Dead code analysis complete');

      // Output results
      if (options.format === 'dot') {
        outputDepDeadDot(
          functions,
          allEdges,
          reachabilityResult,
          options
        );
      } else if (options.format === 'json') {
        outputDepDeadJSON(
          deadCodeInfo,
          unusedExportInfo,
          reachabilityResult,
          functions.length,
          options
        );
      } else {
        outputDepDeadTable(
          deadCodeInfo,
          unusedExportInfo,
          reachabilityResult,
          functions.length,
          options
        );
      }
    } catch (error) {
      spinner.fail('Failed to analyze dead code');
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  };

/**
 * Output dead code results as JSON
 */
function outputDepDeadJSON(
  deadCodeInfo: DeadCodeInfo[],
  unusedExportInfo: DeadCodeInfo[],
  reachabilityResult: ReachabilityResult,
  totalFunctions: number,
  options: DepDeadOptions
): void {
  const result = {
    summary: {
      totalFunctions,
      reachableFunctions: reachabilityResult.reachable.size,
      unreachableFunctions: reachabilityResult.unreachable.size,
      unusedExports: reachabilityResult.unusedExports.size,
      entryPoints: reachabilityResult.entryPoints.size,
      deadCodeCount: deadCodeInfo.length,
      coverage: ((reachabilityResult.reachable.size / totalFunctions) * 100).toFixed(2) + '%',
    },
    deadCode: deadCodeInfo,
    unusedExports: unusedExportInfo,
    filters: {
      excludeTests: options.excludeTests || false,
      excludeExports: options.excludeExports || false,
      excludeSmall: options.excludeSmall || false,
      threshold: options.threshold || 3,
      layerEntryPoints: options.layerEntryPoints?.split(',').map(s => s.trim()) || [],
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output dead code results as formatted table
 */
function outputDepDeadTable(
  deadCodeInfo: DeadCodeInfo[],
  unusedExportInfo: DeadCodeInfo[],
  reachabilityResult: ReachabilityResult,
  totalFunctions: number,
  options: DepDeadOptions
): void {
  displayDeadCodeSummary(reachabilityResult, totalFunctions, deadCodeInfo, unusedExportInfo, options);
  
  if (deadCodeInfo.length > 0) {
    console.log(chalk.bold('🪦 Dead Code Functions:\n'));
    deadCodeInfo.forEach((info, index) => {
      console.log(`${index + 1}. ${chalk.red(info.functionName)} (${info.filePath}:${info.startLine})`);
      if (options.showReasons && info.reason) {
        console.log(`   Reason: ${chalk.dim(info.reason)}`);
      }
    });
    console.log();
  }

  if (unusedExportInfo.length > 0) {
    console.log(chalk.bold('📦 Unused Exports:\n'));
    unusedExportInfo.forEach((info, index) => {
      console.log(`${index + 1}. ${chalk.yellow(info.functionName)} (${info.filePath}:${info.startLine})`);
    });
    console.log();
  }
}

/**
 * Output dead code results as DOT format
 */
function outputDepDeadDot(
  functions: import('../../types').FunctionInfo[],
  callEdges: import('../../types').CallEdge[],
  _reachabilityResult: ReachabilityResult,
  _options: DepDeadOptions
): void {
  const dotGenerator = new DotGenerator();
  // Note: generateReachabilityGraph method may not exist
  // This is a placeholder implementation
  const dotContent = dotGenerator.generateDependencyGraph(functions, callEdges, []);
  console.log(dotContent);
}

/**
 * Display dead code analysis summary
 */
function displayDeadCodeSummary(
  reachabilityResult: ReachabilityResult,
  totalFunctions: number,
  deadCodeInfo: DeadCodeInfo[],
  unusedExportInfo: DeadCodeInfo[],
  options: DepDeadOptions
): void {
  console.log(chalk.bold('\n📊 Dead Code Analysis Summary\n'));
  
  const coverage = (reachabilityResult.reachable.size / totalFunctions) * 100;
  console.log(`Total functions:      ${chalk.cyan(totalFunctions)}`);
  console.log(`Entry points:         ${chalk.green(reachabilityResult.entryPoints.size)}`);
  
  if (options.layerEntryPoints) {
    const layers = options.layerEntryPoints.split(',').map(s => s.trim());
    console.log(`Layer entry points:   ${chalk.blue(layers.join(', '))}`);
  }
  
  console.log(`Reachable functions:  ${chalk.green(reachabilityResult.reachable.size)} (${coverage.toFixed(1)}%)`);
  console.log(`Dead code functions:  ${chalk.red(deadCodeInfo.length)}`);
  console.log(`Unused exports:       ${chalk.yellow(unusedExportInfo.length)}`);
  console.log();
}