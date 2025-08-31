import chalk from 'chalk';
import { OptionValues } from 'commander';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { ErrorCode, createErrorHandler } from '../../../utils/error-handler';
import { TableStats } from '../../../storage/modules/maintenance-operations';

/**
 * Database statistics command - Show database health and maintenance recommendations
 */
export const dbStatsCommand: VoidCommand<OptionValues> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      console.log(chalk.blue('📊 Database Statistics'));
      console.log(chalk.blue('━'.repeat(80)));

      const stats = await env.storage.getTableStats();

      if (stats.length === 0) {
        console.log(chalk.yellow('No tables found. Run `funcqc scan` to create data.'));
        return;
      }

      // Display table statistics
      displayTableStats(stats, options['json'] || false);

      // Show maintenance recommendations
      const needsMaintenance = stats.filter(stat => stat.needsMaintenance);
      if (needsMaintenance.length > 0 && !options['json']) {
        displayMaintenanceRecommendations(needsMaintenance);
      }

    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Database stats failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
      process.exit(1);
    }
  };

/**
 * Display table statistics in a formatted table
 */
function displayTableStats(stats: TableStats[], jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify({ 
      timestamp: new Date().toISOString(),
      tables: stats 
    }, null, 2));
    return;
  }

  // Calculate column widths
  const maxTableNameLength = Math.max(15, ...stats.map(s => s.tableName.length));
  const rowsWidth = 10;
  const sizeWidth = 8;
  const deadPercentWidth = 8;
  const lastVacuumWidth = 12;

  // Header
  const header = [
    'Table'.padEnd(maxTableNameLength),
    'Rows'.padStart(rowsWidth),
    'Size'.padStart(sizeWidth), 
    'Dead%'.padStart(deadPercentWidth),
    'Last Vacuum'.padEnd(lastVacuumWidth)
  ].join(' | ');

  console.log(chalk.bold(header));
  console.log('━'.repeat(header.length));

  // Rows
  for (const stat of stats) {
    const deadPercent = stat.deadTuplesPercent.toFixed(1);
    const lastVacuum = formatLastOperation(stat.lastVacuum);
    
    let rowColor = chalk.white;
    let statusIcon = '';
    
    if (stat.needsMaintenance && stat.rowCount > 0) {
      rowColor = chalk.blue;
      statusIcon = ' 📊';
    } else if (stat.rowCount === 0) {
      rowColor = chalk.dim;
      statusIcon = ' ⚪';
    }

    const row = [
      stat.tableName.padEnd(maxTableNameLength),
      stat.rowCount.toLocaleString().padStart(rowsWidth),
      stat.tableSize.padStart(sizeWidth),
      `${deadPercent}%`.padStart(deadPercentWidth),
      lastVacuum.padEnd(lastVacuumWidth)
    ].join(' | ');

    console.log(rowColor(row + statusIcon));
  }

  console.log('━'.repeat(header.length));

  // Legend
  console.log();
  console.log(chalk.dim('Legend: 📊 Has data (maintenance recommended)  ⚪ Empty table'));
}

/**
 * Display maintenance recommendations
 */
function displayMaintenanceRecommendations(needsMaintenance: TableStats[]): void {
  console.log();
  console.log(chalk.yellow('⚠️  Maintenance Recommendations:'));

  const tablesWithData = needsMaintenance.filter(s => s.rowCount > 0);

  if (tablesWithData.length > 0) {
    const tableNames = tablesWithData.map(s => s.tableName).join(', ');
    console.log(`• ${chalk.blue('Info')}: ${tableNames} contain data and could benefit from maintenance`);
    console.log(`  Run ${chalk.bold('funcqc db maintain')} for basic optimization`);
    console.log(`  Run ${chalk.bold('funcqc db maintain --full')} for thorough optimization (requires brief locks)`);
  } else {
    console.log(`• ${chalk.green('Good')}: No tables require immediate maintenance`);
  }

  console.log();
  console.log(chalk.dim('💡 Regular maintenance: Run `funcqc db maintain` after bulk data operations'));
  console.log(chalk.dim('💡 Full maintenance: Run `funcqc db maintain --full` weekly/monthly for optimal performance'));
  console.log(chalk.dim('💡 PGLite Note: Dead tuple tracking is limited - maintenance is based on table activity'));
}

/**
 * Format last operation timestamp for display
 */
function formatLastOperation(timestamp: string | null): string {
  if (!timestamp) {
    return 'Never';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return '1 day ago';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  } else {
    const years = Math.floor(diffDays / 365);
    return years === 1 ? '1 year ago' : `${years} years ago`;
  }
}