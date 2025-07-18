import { Command } from 'commander';
import chalk from 'chalk';
import { confirm, checkbox } from '@inquirer/prompts';
import { StorageProvider } from '../../core/storage-provider.js';
import { ReachabilityAnalyzer, ReachabilityResult } from '../../analyzers/reachability-analyzer.js';
import { EntryPointDetector } from '../../analyzers/entry-point-detector.js';
import { SafeFunctionDeleter, DeletionResult, FunctionDeletionOptions } from '../../tools/function-deleter.js';
import { FunctionInfo } from '../../types/index.js';
import { groupFunctionsByFile, calculateFunctionStats, formatFunctionStats } from '../../utils/function-utils.js';

interface CleanOptions {
  dryRun?: boolean;
  verbose?: boolean;
  backup?: boolean;
  limit?: string;
  confirmed?: boolean;
  skipJsDoc?: boolean;
  interactive?: boolean;
  threshold?: string;
}

/**
 * Clean command - safely remove dead code using ts-morph
 */
export function cleanCommand(): Command {
  return new Command('clean')
    .description('🧹 Safely remove dead code using AST-based analysis')
    .option('--dry-run', 'Show what would be deleted without making changes', false)
    .option('--verbose', 'Show detailed deletion process', false)
    .option('--backup', 'Create backup files before deletion', true)
    .option('--limit <number>', 'Maximum number of functions to delete')
    .option('-y, --confirmed', 'Skip confirmation prompts', false)
    .option('--skip-jsdoc', 'Skip removal of JSDoc comments', false)
    .option('--interactive', 'Interactive function-by-function confirmation', false)
    .option('--threshold <percentage>', 'Only delete if dead code percentage is below threshold (default: 90)', '90')
    .action(async (options: CleanOptions) => {
      await executeCleanCommand(options);
    });
}

export async function executeCleanCommand(options: CleanOptions): Promise<void> {
  console.log(chalk.blue.bold('🧹 funcqc Clean - Safe Dead Code Removal'));
  console.log();

  // Validate options
  const limit = options.limit ? parseInt(options.limit, 10) : undefined;
  const threshold = parseFloat(options.threshold || '90');
  
  if (limit && (isNaN(limit) || limit <= 0)) {
    console.error(chalk.red('❌ Invalid limit value. Must be a positive number.'));
    process.exit(1);
  }

  if (isNaN(threshold) || threshold < 0 || threshold > 100) {
    console.error(chalk.red('❌ Invalid threshold value. Must be between 0 and 100.'));
    process.exit(1);
  }

  try {
    // Initialize storage
    const storage = await StorageProvider.getInstance().getStorage();
    
    // Get latest snapshot
    const snapshots = await storage.getSnapshots({ limit: 1 });

    if (snapshots.length === 0) {
      console.error(chalk.red('❌ No snapshots found. Run `funcqc scan` first.'));
      process.exit(1);
    }

    const latestSnapshot = snapshots[0];
    console.log(chalk.gray(`📊 Using snapshot: ${latestSnapshot.id} (${latestSnapshot.createdAt})`));

    // Get all functions from latest snapshot
    const allFunctions = await storage.getFunctions(latestSnapshot.id);
    
    // Get call edges for reachability analysis
    const callEdges = await storage.getCallEdgesBySnapshot(latestSnapshot.id);

    console.log(chalk.gray(`📈 Total functions analyzed: ${allFunctions.length}`));

    // Detect entry points
    console.log(chalk.blue('🔍 Detecting entry points...'));
    const entryPointDetector = new EntryPointDetector({
      ...(options.verbose !== undefined && { verbose: options.verbose }),
      ...(options.verbose !== undefined && { debug: options.verbose }) // Use verbose flag for debug output
    });
    const entryPoints = entryPointDetector.detectEntryPoints(allFunctions);
    
    // Analyze reachability to find dead code
    console.log(chalk.blue('🔍 Analyzing code reachability...'));
    const reachabilityAnalyzer = new ReachabilityAnalyzer();
    const reachabilityResult: ReachabilityResult = reachabilityAnalyzer.analyzeReachability(allFunctions, callEdges, entryPoints);

    // Convert to function info objects
    const deadFunctions = allFunctions.filter(f => reachabilityResult.unreachable.has(f.id));
    const reachableFunctions = allFunctions.filter(f => reachabilityResult.reachable.has(f.id));
    const deadCodePercentage = (deadFunctions.length / allFunctions.length) * 100;

    console.log();
    console.log(chalk.yellow('📊 Dead Code Analysis Results:'));
    console.log(`  Total functions: ${allFunctions.length}`);
    console.log(`  Entry points: ${entryPoints.length}`);
    console.log(`  Reachable functions: ${reachableFunctions.length} (${((reachableFunctions.length / allFunctions.length) * 100).toFixed(1)}%)`);
    console.log(`  Dead functions: ${deadFunctions.length} (${deadCodePercentage.toFixed(1)}%)`);
    console.log();

    // Check threshold
    if (deadCodePercentage > threshold) {
      console.log(chalk.red(`⚠️  Dead code percentage (${deadCodePercentage.toFixed(1)}%) exceeds threshold (${threshold}%)`));
      console.log(chalk.red('   This suggests the analysis may be incomplete or there are many entry points.'));
      console.log(chalk.red('   Review the results carefully or adjust the threshold.'));
      console.log();
      
      if (!options.confirmed) {
        const proceed = await confirm({ 
          message: 'Do you want to proceed anyway?',
          default: false
        });
        
        if (!proceed) {
          console.log(chalk.yellow('🛑 Operation cancelled by user.'));
          return;
        }
      }
    }

    if (deadFunctions.length === 0) {
      console.log(chalk.green('✅ No dead code found! Your codebase is clean.'));
      return;
    }

    // Apply limit if specified
    let functionsToDelete = deadFunctions;
    if (limit && functionsToDelete.length > limit) {
      console.log(chalk.yellow(`📌 Limiting deletion to ${limit} functions (out of ${functionsToDelete.length} dead functions)`));
      functionsToDelete = functionsToDelete.slice(0, limit);
    }

    // Group by file for display
    const fileStats = groupFunctionsByFile(functionsToDelete);
    const overallStats = calculateFunctionStats(functionsToDelete);
    
    console.log(chalk.yellow('🎯 Functions to be deleted:'));
    console.log(`  ${chalk.gray(formatFunctionStats(overallStats))}`);
    console.log();
    
    for (const [filePath, functions] of fileStats.entries()) {
      console.log(`  ${chalk.cyan(filePath)}: ${functions.length} functions`);
      if (options.verbose) {
        for (const func of functions.slice(0, 3)) {
          console.log(`    - ${func.displayName} (${func.startLine}:${func.startColumn})`);
        }
        if (functions.length > 3) {
          console.log(`    ... and ${functions.length - 3} more`);
        }
      }
    }
    console.log();

    // Dry run info
    if (options.dryRun) {
      console.log(chalk.yellow('🔍 DRY RUN MODE - No files will be modified'));
      console.log();
    }

    // Confirmation
    if (!options.confirmed && !options.dryRun) {
      const proceed = await confirm({ 
        message: `Delete ${functionsToDelete.length} dead functions from ${fileStats.size} files?`,
        default: false
      });
      
      if (!proceed) {
        console.log(chalk.yellow('🛑 Operation cancelled by user.'));
        return;
      }
    }

    // Interactive mode
    if (options.interactive && !options.dryRun) {
      functionsToDelete = await selectFunctionsInteractively(functionsToDelete);
      
      if (functionsToDelete.length === 0) {
        console.log(chalk.yellow('🛑 No functions selected for deletion.'));
        return;
      }
    }

    // Perform deletion
    console.log(chalk.blue('🚀 Starting safe function deletion...'));
    console.log();

    const deleterOptions: { verbose?: boolean } = {};
    if (options.verbose !== undefined) {
      deleterOptions.verbose = options.verbose;
    }
    
    const deleter = new SafeFunctionDeleter(deleterOptions);
    
    const deletionOptions: FunctionDeletionOptions = {};
    if (options.dryRun !== undefined) deletionOptions.dryRun = options.dryRun;
    if (options.verbose !== undefined) deletionOptions.verbose = options.verbose;
    if (options.backup !== undefined) deletionOptions.backupFiles = options.backup;
    if (options.skipJsDoc !== undefined) deletionOptions.skipJsDoc = options.skipJsDoc;
    
    const result: DeletionResult = await deleter.deleteFunctions(functionsToDelete, deletionOptions);

    // Display results
    console.log();
    if (result.success) {
      console.log(chalk.green.bold('✅ Clean operation completed successfully!'));
    } else {
      console.log(chalk.yellow.bold('⚠️  Clean operation completed with some issues'));
    }

    console.log();
    console.log(chalk.blue('📊 Results Summary:'));
    console.log(`  Functions deleted: ${result.functionsDeleted}`);
    console.log(`  Files modified: ${result.filesModified.length}`);
    
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.length}`);
      console.log();
      console.log(chalk.red('❌ Errors:'));
      for (const error of result.errors) {
        console.log(`  ${chalk.red('•')} ${error}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log(`  Warnings: ${result.warnings.length}`);
      if (options.verbose) {
        console.log();
        console.log(chalk.yellow('⚠️  Warnings:'));
        for (const warning of result.warnings) {
          console.log(`  ${chalk.yellow('•')} ${warning}`);
        }
      }
    }

    if (!options.dryRun && result.functionsDeleted > 0) {
      console.log();
      console.log(chalk.green('🎉 Recommendations:'));
      console.log('  1. Run `funcqc scan` to update the analysis');
      console.log('  2. Run your tests to ensure nothing is broken');
      console.log('  3. Commit the changes after verification');
      
      if (options.backup) {
        console.log('  4. Remove backup files after confirming everything works');
      }
    }

    deleter.dispose();

  } catch (error) {
    console.error(chalk.red('❌ Clean operation failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

/**
 * Interactive function selection using checkbox interface
 */
async function selectFunctionsInteractively(functions: FunctionInfo[]): Promise<FunctionInfo[]> {
  console.log(chalk.blue('🎯 Interactive Mode - Select functions to delete:'));
  console.log();

  // Group functions by file for better organization
  const functionsByFile = groupFunctionsByFile(functions);
  const allSelected: FunctionInfo[] = [];

  // Process each file separately for manageable selection
  for (const [filePath, fileFunctions] of functionsByFile.entries()) {
    if (fileFunctions.length === 0) continue;

    console.log(chalk.cyan(`\n📁 ${filePath} (${fileFunctions.length} functions)`));
    
    // Create choices for checkbox selection
    const choices = fileFunctions.map(func => ({
      name: `${func.displayName} (${func.startLine}:${func.startColumn}) ${func.isExported ? '[exported]' : '[private]'}`,
      value: func.id,
      checked: false,
    }));

    // Add "Select All" and "Select None" options
    const allChoices = [
      {
        name: chalk.yellow('📋 Select All'),
        value: '__SELECT_ALL__',
        checked: false,
      },
      {
        name: chalk.yellow('🚫 Select None'),
        value: '__SELECT_NONE__',
        checked: false,
      },
      { name: chalk.gray('─'.repeat(60)), value: '__SEPARATOR__', disabled: true },
      ...choices,
    ];

    try {
      const selectedIds = await checkbox({
        message: `Choose functions to delete from ${filePath}:`,
        choices: allChoices,
        pageSize: 15,
        loop: false,
      });

      // Handle special selections
      if (selectedIds.includes('__SELECT_ALL__')) {
        // If "Select All" is chosen, add all functions from this file
        allSelected.push(...fileFunctions);
        console.log(chalk.green(`  ✅ Selected all ${fileFunctions.length} functions`));
      } else if (selectedIds.includes('__SELECT_NONE__')) {
        // If "Select None" is chosen, don't add any functions
        console.log(chalk.yellow(`  ⏭️  Skipped all functions`));
      } else {
        // Add individual selected functions
        const selectedFunctions = fileFunctions.filter(f => selectedIds.includes(f.id));
        allSelected.push(...selectedFunctions);
        console.log(chalk.green(`  ✅ Selected ${selectedFunctions.length} of ${fileFunctions.length} functions`));
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'ExitPromptError') {
        // User cancelled selection
        console.log(chalk.yellow('\n🛑 Selection cancelled by user.'));
        return [];
      }
      throw error;
    }
  }

  console.log();
  console.log(chalk.blue(`📊 Total selected: ${allSelected.length} functions across ${functionsByFile.size} files`));
  
  if (allSelected.length > 0) {
    const finalConfirm = await confirm({
      message: `Proceed with deleting ${allSelected.length} selected functions?`,
      default: true,
    });

    if (!finalConfirm) {
      console.log(chalk.yellow('🛑 Operation cancelled.'));
      return [];
    }
  }

  return allSelected;
}