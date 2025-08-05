import chalk from 'chalk';
import { OptionValues } from 'commander';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { ErrorCode, createErrorHandler } from '../../../utils/error-handler';
import { BackupManager, BackupOptions } from '../../../storage/backup/backup-manager';

/**
 * Database export command - Create comprehensive database backups
 */
export const dbExportCommand: VoidCommand<OptionValues> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const backupManager = new BackupManager(env.config, env.storage);
      
      const backupOptions: BackupOptions = {
        label: options['label'],
        outputDir: options['outputDir'],
        includeSourceCode: options['includeSourceCode'] || false,
        compress: options['compress'] || false,
        format: options['format'] || 'json',
        dryRun: options['dryRun'] || false,
      };

      console.log(chalk.blue('🗄️  Starting database export...'));
      console.log();

      if (backupOptions.dryRun) {
        console.log(chalk.yellow('⚡ DRY RUN MODE - No files will be created'));
        console.log();
      }

      const result = await backupManager.createBackup(backupOptions);

      if (result.success) {
        console.log(chalk.green('✅ Database export completed successfully!'));
        console.log();
        console.log(chalk.cyan('📊 Export Statistics:'));
        console.log(`  • Tables exported: ${result.stats.tablesExported}`);
        console.log(`  • Total rows: ${result.stats.totalRows.toLocaleString()}`);
        console.log(`  • Backup size: ${result.stats.backupSize}`);
        console.log(`  • Duration: ${(result.duration / 1000).toFixed(2)}s`);
        console.log();
        console.log(chalk.blue('📁 Export Location:'));
        console.log(`  ${result.backupPath}`);
        
        if (result.warnings && result.warnings.length > 0) {
          console.log();
          console.log(chalk.yellow('⚠️  Warnings:'));
          result.warnings.forEach(warning => {
            console.log(`  • ${warning}`);
          });
        }

        // Show manifest information
        if (result.manifest && !backupOptions.dryRun) {
          console.log();
          console.log(chalk.cyan('📋 Backup Manifest:'));
          console.log(`  • Schema hash: ${result.manifest.schemaHash}`);
          console.log(`  • Table order: ${result.manifest.tableOrder.length} tables`);
          console.log(`  • Format: ${result.manifest.metadata.backupFormat}`);
          console.log(`  • Compressed: ${result.manifest.metadata.compressed ? 'Yes' : 'No'}`);
          console.log(`  • Includes source: ${result.manifest.metadata.includesSourceCode ? 'Yes' : 'No'}`);
          
          if (result.manifest.schemaInfo.circularDeps.length > 0) {
            console.log(chalk.yellow(`  • Circular dependencies: ${result.manifest.schemaInfo.circularDeps.length}`));
          }
        }

        console.log();
        console.log(chalk.gray('💡 Use "funcqc db import" to restore this backup'));
        console.log(chalk.gray('💡 Use "funcqc db list-backups" to see all available backups'));

      } else {
        console.log(chalk.red('❌ Database export failed!'));
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
        `Database export failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
      process.exit(1);
    }
  };