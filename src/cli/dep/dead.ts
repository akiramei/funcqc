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
    
    // For JSON format, redirect console.log to stderr to avoid JSON contamination
    const isJsonFormat = options.format === 'json';
    let originalConsoleLog: typeof console.log | undefined;
    let originalConsoleInfo: typeof console.info | undefined;
    
    if (isJsonFormat) {
      // Redirect all console output to stderr during JSON analysis
      originalConsoleLog = console.log;
      originalConsoleInfo = console.info;
      console.log = console.error;
      console.info = console.error;
    }
    
    const spinner = isJsonFormat 
      ? { 
          start: () => ({ text: '', succeed: () => {}, fail: (msg: string) => console.error(msg) }),
          text: '',
          succeed: () => {},
          fail: (msg: string) => console.error(msg)
        }
      : ora('Analyzing dead code...').start();

    // For JSON format, suppress all logging to avoid output contamination (ensure restoration in finally)
    let restoreInfo: null | (() => void) = null;

    if (isJsonFormat && typeof env.commandLogger.info === 'function') {
      const originalInfoFn = env.commandLogger.info;
      env.commandLogger.info = () => {};
      restoreInfo = () => {
        env.commandLogger.info = originalInfoFn;
      };
    }

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
        const message = 'No functions found in the latest snapshot.';
        if (isJsonFormat) {
          console.error(chalk.yellow(message));
        } else {
          spinner.fail(chalk.yellow(message));
        }
        return;
      }

      spinner.text = 'Detecting entry points...';

      // Parse layer entry points if specified
      const layerEntryPoints = options.layerEntryPoints
        ? options.layerEntryPoints.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : undefined;
      
      // Detect entry points (suppress verbose output for JSON format)
      const entryPointDetector = new EntryPointDetector({
        ...(options.verbose !== undefined && !isJsonFormat && { verbose: options.verbose }),
        ...(options.verbose !== undefined && !isJsonFormat && { debug: options.verbose }),
        ...(layerEntryPoints && { layerEntryPoints }),
        ...(options.excludeStaticMethods && { excludeStaticMethods: options.excludeStaticMethods })
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

      if (options.excludeStaticMethods) {
        // Remove static method functions from entry points
        entryPoints = entryPoints.filter(ep => ep.reason !== 'static-method');
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

      // Get static methods information (for enhanced reporting)
      const staticMethodsInfo = getStaticMethodsInfo(deadCodeInfo, functions);

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
          staticMethodsInfo,
          options
        );
      }
    } catch (error) {
      const message = 'Failed to analyze dead code';
      if (isJsonFormat) {
        console.error(message);
        // For JSON format, output error to stderr without using errorHandler to avoid stdout contamination
        console.error(error instanceof Error ? error.message : String(error));
      } else {
        spinner.fail(message);
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      // Restore original console methods for JSON format
      if (isJsonFormat && originalConsoleLog && originalConsoleInfo) {
        console.log = originalConsoleLog;
        console.info = originalConsoleInfo;
      }
      // Restore original commandLogger.info if suppressed
      if (restoreInfo) {
        restoreInfo();
      }
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

  // Use process.stdout.write instead of console.log to ensure it goes to stdout
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

/**
 * Output dead code results as formatted table
 */
function outputDepDeadTable(
  deadCodeInfo: DeadCodeInfo[],
  unusedExportInfo: DeadCodeInfo[],
  reachabilityResult: ReachabilityResult,
  totalFunctions: number,
  staticMethodsInfo: { staticMethods: DeadCodeInfo[]; byClass: Map<string, DeadCodeInfo[]> },
  options: DepDeadOptions
): void {
  displayDeadCodeSummary(reachabilityResult, totalFunctions, deadCodeInfo, unusedExportInfo, staticMethodsInfo, options);
  
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

  if (staticMethodsInfo.staticMethods.length > 0) {
    console.log(chalk.bold('🏗️ Unused Static Methods by Class:\n'));
    for (const [className, methods] of staticMethodsInfo.byClass) {
      console.log(`${chalk.cyan(className)}:`);
      methods.forEach((method, index) => {
        console.log(`  ${index + 1}. ${chalk.magenta(method.functionName)} (${method.filePath}:${method.startLine})`);
      });
    }
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
  staticMethodsInfo: { staticMethods: DeadCodeInfo[]; byClass: Map<string, DeadCodeInfo[]> },
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
  
  if (staticMethodsInfo.staticMethods.length > 0) {
    console.log(`Static methods:       ${chalk.magenta(staticMethodsInfo.staticMethods.length)} (${staticMethodsInfo.byClass.size} classes)`);
  }
  
  console.log();
}

/**
 * Get information about static methods in dead code
 */
function getStaticMethodsInfo(
  deadCodeInfo: DeadCodeInfo[],
  functions: import('../../types').FunctionInfo[]
): {
  staticMethods: DeadCodeInfo[];
  byClass: Map<string, DeadCodeInfo[]>;
} {
  const staticMethods: DeadCodeInfo[] = [];
  const byClass = new Map<string, DeadCodeInfo[]>();

  for (const deadInfo of deadCodeInfo) {
    const func = functions.find(f => f.id === deadInfo.functionId);
    if (func && func.contextPath && func.contextPath.length > 0) {
      staticMethods.push(deadInfo);
      
      const className = func.contextPath[func.contextPath.length - 1]; // Use the last element as class name
      if (!byClass.has(className)) {
        byClass.set(className, []);
      }
      byClass.get(className)!.push(deadInfo);
    }
  }

  return { staticMethods, byClass };
}