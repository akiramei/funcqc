import chalk from 'chalk';
import { OptionValues } from 'commander';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { ErrorCode, createErrorHandler } from '../../../utils/error-handler';
import { BackupManager, RestoreOptions } from '../../../storage/backup/backup-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Database import command - Restore from database backups
 */
export const dbImportCommand: VoidCommand<OptionValues> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const backupManager = new BackupManager(env.config, env.storage);
      
      // Resolve backup path
      const backupPath = options['backup'];
      if (!backupPath) {
        console.log(chalk.yellow('📂 No backup path specified. Listing available backups...'));
        console.log();
        
        const backups = await backupManager.listBackups();
        if (backups.length === 0) {
          console.log(chalk.yellow('No backups found.'));
          console.log(chalk.gray('💡 Use "funcqc db export" to create a backup first'));
          return;
        }

        console.log(chalk.cyan('Available backups:'));
        backups.forEach((backup, index) => {
          const date = new Date(backup.manifest.createdAt).toLocaleString();
          const label = backup.manifest.label ? ` (${backup.manifest.label})` : '';
          console.log(`  ${index + 1}. ${path.basename(backup.path)}${label} - ${date} - ${backup.size}`);
        });
        console.log();
        console.log(chalk.gray('💡 Use --backup <path> to specify which backup to restore'));
        return;
      }

      // Verify backup exists
      try {
        await fs.access(backupPath);
      } catch {
        console.log(chalk.red(`❌ Backup not found: ${backupPath}`));
        return;
      }

      const restoreOptions: RestoreOptions = {
        backupPath,
        verifySchema: options['verifySchema'] !== false, // Default to true
        dryRun: options['dryRun'] || false,
        overwrite: options['overwrite'] || false,
      };

      console.log(chalk.blue('📥 Starting database import...'));
      console.log();

      if (restoreOptions.dryRun) {
        console.log(chalk.yellow('⚡ DRY RUN MODE - No data will be modified'));
        console.log();
      }

      // Show warning for overwrite mode
      if (restoreOptions.overwrite && !restoreOptions.dryRun) {
        console.log(chalk.red('⚠️  WARNING: Overwrite mode enabled - existing data will be replaced!'));
        console.log();
      }

      const result = await backupManager.restoreBackup(restoreOptions);

      if (result.success) {
        console.log(chalk.green('✅ Database import completed successfully!'));
        console.log();
        console.log(chalk.cyan('📊 Import Statistics:'));
        console.log(`  • Tables restored: ${result.tablesRestored}`);
        console.log(`  • Total rows restored: ${result.rowsRestored.toLocaleString()}`);
        console.log(`  • Duration: ${(result.duration / 1000).toFixed(2)}s`);
        
        if (result.warnings && result.warnings.length > 0) {
          console.log();
          console.log(chalk.yellow('⚠️  Warnings:'));
          result.warnings.forEach(warning => {
            console.log(`  • ${warning}`);
          });
        }

        console.log();
        console.log(chalk.gray('💡 Use "funcqc health" to verify data integrity'));
        console.log(chalk.gray('💡 Use "funcqc list" to see imported functions'));

      } else {
        console.log(chalk.red('❌ Database import failed!'));
        console.log();
        
        if (result.errors && result.errors.length > 0) {
          console.log(chalk.red('🚨 Errors:'));
          result.errors.forEach(error => {
            console.log(`  • ${error}`);
          });
        }
        
        process.exit(1);
      }

    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Database import failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
      process.exit(1);
    }
  };