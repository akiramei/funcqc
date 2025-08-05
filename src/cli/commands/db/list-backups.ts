import chalk from 'chalk';
import { OptionValues } from 'commander';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { ErrorCode, createErrorHandler } from '../../../utils/error-handler';
import { BackupManager } from '../../../storage/backup/backup-manager';
import * as path from 'path';

/**
 * List available database backups command
 */
export const dbListBackupsCommand: VoidCommand<OptionValues> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const backupManager = new BackupManager(env.config, env.storage);
      
      console.log(chalk.blue('📂 Listing available database backups...'));
      console.log();

      const backups = await backupManager.listBackups();

      if (backups.length === 0) {
        console.log(chalk.yellow('No backups found.'));
        console.log(chalk.gray('💡 Use "funcqc db export" to create your first backup'));
        return;
      }

      if (options['json']) {
        const output = {
          count: backups.length,
          backups: backups.map(backup => ({
            path: backup.path,
            name: path.basename(backup.path),
            manifest: backup.manifest,
            size: backup.size,
            age: backup.age,
          }))
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      console.log(chalk.cyan(`Found ${backups.length} backup${backups.length === 1 ? '' : 's'}:`));
      console.log();

      // Table headers
      const headers = ['Name', 'Created', 'Size', 'Tables', 'Format', 'Label'];
      const maxWidths = [
        Math.max(20, ...backups.map(b => path.basename(b.path).length)),
        12, // Date format
        8,  // Size
        6,  // Tables
        6,  // Format
        15  // Label
      ];

      // Print header
      const headerRow = headers.map((header, i) => header.padEnd(maxWidths[i])).join(' | ');
      console.log(chalk.bold(headerRow));
      console.log(headers.map((_, i) => '-'.repeat(maxWidths[i])).join('-|-'));

      // Print backup rows
      for (const backup of backups) {
        const name = path.basename(backup.path).padEnd(maxWidths[0]);
        const created = new Date(backup.manifest.createdAt).toLocaleDateString().padEnd(maxWidths[1]);
        const size = backup.size.padEnd(maxWidths[2]);
        const tableCount = Object.keys(backup.manifest.tables).length.toString().padEnd(maxWidths[3]);
        const format = backup.manifest.metadata.backupFormat.padEnd(maxWidths[4]);
        const label = (backup.manifest.label || '-').substring(0, 15).padEnd(maxWidths[5]);

        const row = [name, created, size, tableCount, format, label].join(' | ');
        
        // Color coding based on age
        const ageInDays = Math.floor((Date.now() - new Date(backup.manifest.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        if (ageInDays < 1) {
          console.log(chalk.green(row));
        } else if (ageInDays < 7) {
          console.log(chalk.white(row));
        } else {
          console.log(chalk.gray(row));
        }
      }

      console.log();
      
      // Summary information
      const totalSize = backups.reduce((sum, backup) => {
        const match = backup.size.match(/^([\d.]+)\s*(\w+)$/);
        if (match) {
          const value = parseFloat(match[1]);
          const unit = match[2].toLowerCase();
          let bytes = value;
          if (unit === 'kb') bytes *= 1024;
          else if (unit === 'mb') bytes *= 1024 * 1024;
          else if (unit === 'gb') bytes *= 1024 * 1024 * 1024;
          return sum + bytes;
        }
        return sum;
      }, 0);

      const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
      };

      console.log(chalk.cyan('📊 Summary:'));
      console.log(`  • Total backups: ${backups.length}`);
      console.log(`  • Total size: ${formatBytes(totalSize)}`);
      console.log(`  • Newest: ${backups[0].age}`);
      console.log(`  • Oldest: ${backups[backups.length - 1].age}`);

      // Show schema info from latest backup
      const latest = backups[0];
      if (latest.manifest.schemaInfo) {
        console.log();
        console.log(chalk.cyan('🏗️  Latest Schema Info:'));
        console.log(`  • Schema hash: ${latest.manifest.schemaHash}`);
        console.log(`  • Tables: ${Object.keys(latest.manifest.tables).length}`);
        console.log(`  • Total rows: ${Object.values(latest.manifest.tables).reduce((sum, table) => sum + table.rows, 0).toLocaleString()}`);
        
        if (latest.manifest.schemaInfo.circularDeps.length > 0) {
          console.log(chalk.yellow(`  • Circular dependencies: ${latest.manifest.schemaInfo.circularDeps.length}`));
        }
      }

      console.log();
      console.log(chalk.gray('💡 Use "funcqc db import --backup <path>" to restore a backup'));
      console.log(chalk.gray('💡 Use "funcqc db export --label <name>" to create a new backup'));

    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to list backups: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
      process.exit(1);
    }
  };