import { OptionValues } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { EntryPointDetector } from '../analyzers/entry-point-detector';
import { ReachabilityAnalyzer } from '../analyzers/reachability-analyzer';
// import { formatFileSize } from '../utils/format-utils';

interface DeadCodeOptions extends OptionValues {
  excludeTests?: boolean;
  excludeExports?: boolean;
  excludeSmall?: boolean;
  threshold?: string;
  format?: 'table' | 'json';
  showReasons?: boolean;
  verbose?: boolean;
}

/**
 * Detect and report dead code (unreachable functions)
 */
export const deadCommand: VoidCommand<DeadCodeOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Analyzing dead code...').start();

    try {
      // Get the latest snapshot
      const snapshot = await env.storage.getLatestSnapshot();
      if (!snapshot) {
        spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      spinner.text = 'Loading functions and call graph...';

      // Get all functions and call edges
      const [functions, callEdges] = await Promise.all([
        env.storage.getFunctionsBySnapshot(snapshot.id),
        env.storage.getCallEdgesBySnapshot(snapshot.id),
      ]);

      if (functions.length === 0) {
        spinner.fail(chalk.yellow('No functions found in the latest snapshot.'));
        return;
      }

      spinner.text = 'Detecting entry points...';

      // Detect entry points
      const entryPointDetector = new EntryPointDetector();
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
        callEdges,
        entryPoints
      );

      // Get detailed dead code information
      const deadCodeInfo = reachabilityAnalyzer.getDeadCodeInfo(
        reachabilityResult.unreachable,
        functions,
        callEdges,
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
        callEdges,
        {
          excludeTests: false,
          excludeSmallFunctions: false,
          minFunctionSize: 1,
        }
      );

      spinner.succeed('Dead code analysis complete');

      // Output results
      if (options.format === 'json') {
        outputDeadCodeJSON(
          deadCodeInfo,
          unusedExportInfo,
          reachabilityResult,
          functions.length,
          options
        );
      } else {
        outputDeadCodeTable(
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
function outputDeadCodeJSON(
  deadCodeInfo: any[],
  unusedExportInfo: any[],
  reachabilityResult: any,
  totalFunctions: number,
  options: DeadCodeOptions
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
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output dead code results as a formatted table
 */
function outputDeadCodeTable(
  deadCodeInfo: any[],
  unusedExportInfo: any[],
  reachabilityResult: any,
  totalFunctions: number,
  options: DeadCodeOptions
): void {
  // Summary
  console.log(chalk.bold('\n📊 Dead Code Analysis Summary\n'));
  
  const coverage = (reachabilityResult.reachable.size / totalFunctions) * 100;
  console.log(`Total functions:      ${chalk.cyan(totalFunctions)}`);
  console.log(`Entry points:         ${chalk.green(reachabilityResult.entryPoints.size)}`);
  console.log(`Reachable functions:  ${chalk.green(reachabilityResult.reachable.size)} (${coverage.toFixed(1)}%)`);
  console.log(`Unreachable functions: ${chalk.red(reachabilityResult.unreachable.size)} (${(100 - coverage).toFixed(1)}%)`);
  console.log(`Dead code found:      ${chalk.yellow(deadCodeInfo.length)} functions`);
  console.log(`Unused exports:       ${chalk.yellow(unusedExportInfo.length)} functions\n`);

  if (deadCodeInfo.length === 0) {
    console.log(chalk.green('✅ No dead code found with current filters!'));
    return;
  }

  // Group by file
  const deadCodeByFile = new Map<string, typeof deadCodeInfo>();
  for (const info of deadCodeInfo) {
    if (!deadCodeByFile.has(info.filePath)) {
      deadCodeByFile.set(info.filePath, []);
    }
    deadCodeByFile.get(info.filePath)!.push(info);
  }

  console.log(chalk.bold('🚫 Dead Code Details\n'));

  // Display by file
  for (const [filePath, functions] of deadCodeByFile) {
    console.log(chalk.underline(filePath));
    
    for (const func of functions) {
      const location = `${func.startLine}-${func.endLine}`;
      const size = `${func.size} lines`;
      
      let reasonIcon = '❓';
      let reasonText = func.reason;
      
      switch (func.reason) {
        case 'no-callers':
          reasonIcon = '🚫';
          reasonText = 'Never called';
          break;
        case 'unreachable':
          reasonIcon = '🔗';
          reasonText = 'Unreachable';
          break;
        case 'test-only':
          reasonIcon = '🧪';
          reasonText = 'Test only';
          break;
      }

      const line = `  ${reasonIcon} ${chalk.yellow(func.functionName)} ${chalk.gray(`(${location}, ${size})`)}`;
      console.log(line);
      
      if (options.showReasons && options.verbose) {
        console.log(chalk.gray(`     Reason: ${reasonText}`));
      }
    }
    
    console.log(); // Empty line between files
  }

  // Display unused export functions
  if (unusedExportInfo.length > 0) {
    console.log(chalk.bold('⚠️  Unused Export Functions (Review Required)\n'));
    
    // Group unused exports by file
    const unusedExportsByFile = new Map<string, typeof unusedExportInfo>();
    for (const info of unusedExportInfo) {
      if (!unusedExportsByFile.has(info.filePath)) {
        unusedExportsByFile.set(info.filePath, []);
      }
      unusedExportsByFile.get(info.filePath)!.push(info);
    }
    
    for (const [filePath, functions] of unusedExportsByFile) {
      console.log(chalk.underline(filePath));
      
      for (const func of functions) {
        const location = `${func.startLine}-${func.endLine}`;
        const size = `${func.size} lines`;
        
        console.log(`  📦 ${chalk.yellow(func.functionName)} (${chalk.gray(location)}, ${chalk.gray(size)})`);
      }
      
      console.log(); // Empty line between files
    }
    
    console.log(chalk.dim('💡 These export functions are not used internally but may be public APIs.'));
    console.log(chalk.dim('💡 Review manually to determine if they should be removed or kept.\n'));
  }

  // Summary statistics
  const totalLines = deadCodeInfo.reduce((sum, info) => sum + info.size, 0);
  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.bold(`Total dead code: ${deadCodeInfo.length} functions, ${totalLines} lines`));
  
  if (unusedExportInfo.length > 0) {
    const unusedExportLines = unusedExportInfo.reduce((sum, info) => sum + info.size, 0);
    console.log(chalk.bold(`Unused exports: ${unusedExportInfo.length} functions, ${unusedExportLines} lines`));
  }

  // Suggestions
  if (!options.excludeTests && deadCodeInfo.some(info => info.reason === 'test-only')) {
    console.log(chalk.dim('\n💡 Tip: Use --exclude-tests to hide test-only functions'));
  }

  if (!options.excludeSmall && deadCodeInfo.some(info => info.size < 5)) {
    console.log(chalk.dim('💡 Tip: Use --exclude-small to hide small functions'));
  }
}