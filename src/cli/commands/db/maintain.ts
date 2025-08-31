import chalk from 'chalk';
import { OptionValues } from 'commander';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { ErrorCode, createErrorHandler } from '../../../utils/error-handler';
import { MaintenanceResult } from '../../../storage/modules/maintenance-operations';
import * as readline from 'readline';

/**
 * Database maintenance command - Run VACUUM, ANALYZE, and REINDEX operations
 */
export const dbMaintainCommand: VoidCommand<OptionValues> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const isFullMaintenance = options['full'] || false;
      const verbose = options['verbose'] || false;

      console.log(chalk.blue(`🔧 ${isFullMaintenance ? 'Full' : 'Standard'} Database Maintenance`));
      console.log();

      if (isFullMaintenance) {
        const confirmed = await confirmFullMaintenance();
        if (!confirmed) {
          console.log(chalk.yellow('❌ Maintenance cancelled'));
          return;
        }
      }

      // Show what operations will be performed
      displayMaintenanceOperations(isFullMaintenance);
      console.log();

      // Perform maintenance
      const maintenanceOptions = { full: isFullMaintenance, verbose };
      const results = await env.storage.maintainDatabase(maintenanceOptions);

      // Display results
      displayMaintenanceResults(results, isFullMaintenance, verbose);

    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Database maintenance failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
      process.exit(1);
    }
  };

/**
 * Ask user confirmation for full maintenance
 */
async function confirmFullMaintenance(): Promise<boolean> {
  console.log(chalk.yellow('⚠️  Full maintenance will lock tables temporarily'));
  console.log(chalk.dim('This operation may take longer and briefly block database access.'));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Continue with full maintenance? (y/N): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Display what operations will be performed
 */
function displayMaintenanceOperations(isFullMaintenance: boolean): void {
  console.log(chalk.cyan('🔍 Operations to perform:'));
  
  if (isFullMaintenance) {
    console.log('  • VACUUM FULL - Reclaim all unused space (requires table locks)');
    console.log('  • REINDEX - Rebuild all indexes (requires index locks)');
    console.log('  • ANALYZE - Update query planner statistics');
  } else {
    console.log('  • VACUUM - Reclaim unused space from dead tuples');
    console.log('  • ANALYZE - Update query planner statistics');
  }
}

/**
 * Display maintenance results
 */
function displayMaintenanceResults(results: MaintenanceResult[], isFullMaintenance: boolean, verbose: boolean): void {
  console.log();
  console.log(chalk.green('✅ Maintenance completed'));
  console.log();

  let totalDuration = 0;
  let allSuccessful = true;
  let totalTablesProcessed = 0;
  const allErrors: string[] = [];

  // Summary for each operation
  for (const result of results) {
    totalDuration += result.duration;
    allSuccessful = allSuccessful && result.success;
    totalTablesProcessed = Math.max(totalTablesProcessed, result.tablesProcessed.length);

    if (result.errors) {
      allErrors.push(...result.errors);
    }

    const statusIcon = result.success ? '✓' : '❌';
    const durationText = formatDuration(result.duration);
    
    console.log(`${statusIcon} ${chalk.cyan(result.operation)}: ${result.tablesProcessed.length} tables (${durationText})`);
    
    if (verbose && result.tablesProcessed.length > 0) {
      console.log(chalk.dim(`   Tables: ${result.tablesProcessed.join(', ')}`));
    }
    
    if (result.errors && result.errors.length > 0) {
      result.errors.forEach(error => {
        console.log(chalk.red(`   ⚠️ ${error}`));
      });
    }
  }

  console.log();
  console.log(chalk.cyan('📊 Summary:'));
  console.log(`  • Total duration: ${formatDuration(totalDuration)}`);
  console.log(`  • Tables processed: ${totalTablesProcessed}`);
  console.log(`  • Operations: ${results.length}/${results.length}`);
  
  if (allErrors.length > 0) {
    console.log(`  • Errors: ${allErrors.length}`);
  }

  // Status
  if (allSuccessful && allErrors.length === 0) {
    console.log();
    console.log(chalk.green('🎉 All maintenance operations completed successfully!'));
  } else if (allErrors.length > 0) {
    console.log();
    console.log(chalk.yellow('⚠️ Maintenance completed with some errors'));
    console.log(chalk.dim('Check the error messages above for details'));
  }

  // Recommendations
  console.log();
  console.log(chalk.dim('💡 Next steps:'));
  if (isFullMaintenance) {
    console.log(chalk.dim('• Full maintenance completed - database is optimized'));
    console.log(chalk.dim('• Run `funcqc db stats` to verify improvements'));
  } else {
    console.log(chalk.dim('• Run `funcqc db stats` to check if further maintenance is needed'));
    console.log(chalk.dim('• For heavy optimization, consider `funcqc db maintain --full`'));
  }
  console.log(chalk.dim('• Schedule regular maintenance (weekly/monthly)'));
}

/**
 * Format duration in a human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  
  if (seconds < 1) {
    return `${ms}ms`;
  } else if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  } else {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }
}