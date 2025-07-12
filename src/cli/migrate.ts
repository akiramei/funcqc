import { OptionValues } from 'commander';
import chalk from 'chalk';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import * as path from 'path';

const logger = new Logger();

/**
 * Migration status command
 */
export async function statusCommand(_options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Starting migration status check...');
    
    const config = await new ConfigManager().load();
    const storageAdapter = new PGLiteStorageAdapter(config.storage.path!);
    
    const status = await storageAdapter.getMigrationStatus();
    const backupTables = await storageAdapter.listBackupTables();
    
    console.log(chalk.bold('\n📋 Migration Status\n'));
    
    // Applied migrations
    console.log(chalk.green('✅ Applied Migrations:'));
    if (status.applied.length === 0) {
      console.log('  No migrations applied yet');
    } else {
      status.applied.forEach(migration => {
        console.log(`  ${chalk.cyan(migration.name)} (v${migration.version}) - ${migration.executedAt?.toISOString()}`);
      });
    }
    
    // Pending migrations
    console.log(chalk.yellow('\n⏳ Pending Migrations:'));
    if (status.pending.length === 0) {
      console.log('  No pending migrations');
    } else {
      status.pending.forEach(migration => {
        console.log(`  ${chalk.yellow(migration)}`);
      });
    }
    
    // Backup tables
    console.log(chalk.blue('\n💾 Backup Tables:'));
    if (backupTables.length === 0) {
      console.log('  No backup tables found');
    } else {
      backupTables.forEach(table => {
        console.log(`  ${chalk.blue(table)}`);
      });
    }
    
    console.log('');
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to get migration status',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Migration cleanup command
 */
export async function cleanupCommand(options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Starting migration cleanup...');
    
    const config = await new ConfigManager().load();
    const storageAdapter = new PGLiteStorageAdapter(config.storage.path!);
    
    const daysOld = parseInt(options['days']) || 30;
    
    console.log(chalk.yellow(`🧹 Cleaning up backup tables older than ${daysOld} days...`));
    
    const deletedCount = await storageAdapter.cleanupOldBackups(daysOld);
    
    if (deletedCount > 0) {
      console.log(chalk.green(`✅ Cleaned up ${deletedCount} old backup table(s)`));
    } else {
      console.log(chalk.blue('ℹ️  No old backup tables to clean up'));
    }
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to cleanup old migrations',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Migration reset command (for development only)
 */
export async function resetCommand(options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    if (!options['force']) {
      console.log(chalk.red('⚠️  Migration reset requires --force flag'));
      console.log(chalk.yellow('This will delete all migration history (but preserve data)'));
      console.log(chalk.yellow('Usage: funcqc migrate reset --force'));
      return;
    }
    
    logger.debug('Starting migration reset...');
    
    const config = await new ConfigManager().load();
    const storageAdapter = new PGLiteStorageAdapter(config.storage.path!);
    const migrationManager = storageAdapter.getMigrationManager();
    
    console.log(chalk.yellow('🔄 Resetting migration history...'));
    
    await migrationManager.resetMigrations();
    
    console.log(chalk.green('✅ Migration history reset completed'));
    console.log(chalk.blue('ℹ️  Your data has been preserved, only migration tracking was reset'));
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to reset migrations',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Migration create command
 */
export async function createCommand(options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    if (!options['name']) {
      console.log(chalk.red('❌ Migration name is required'));
      console.log(chalk.yellow('Usage: funcqc migrate create --name "migration_name"'));
      return;
    }
    
    logger.debug(`Creating migration: ${options['name']}`);
    
    const migrationName = options['name'].replace(/\s+/g, '_').toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:-]/g, '_').replace(/\..+/, '');
    const filename = `${timestamp}_${migrationName}.sql`;
    
    // Create migrations directory if it doesn't exist
    const migrationsDir = path.join(process.cwd(), 'migrations');
    
    try {
      const fs = await import('fs/promises');
      await fs.mkdir(migrationsDir, { recursive: true });
      
      const migrationContent = `-- Migration: ${options['name']}
-- Created: ${new Date().toISOString()}
-- 
-- Add your migration SQL here
-- Example:
-- 
-- ALTER TABLE functions ADD COLUMN new_field TEXT;
-- 
-- Note: This migration system preserves data by default.
-- Use funcqc migrate status to see applied migrations.

-- Add your SQL statements below:

`;

      const migrationPath = path.join(migrationsDir, filename);
      await fs.writeFile(migrationPath, migrationContent);
      
      console.log(chalk.green(`✅ Migration file created: ${filename}`));
      console.log(chalk.blue(`📁 Location: ${migrationPath}`));
      console.log(chalk.yellow('Edit the file to add your migration SQL, then run: funcqc migrate run'));
      
    } catch (error) {
      throw new Error(`Failed to create migration file: ${error}`);
    }
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to create migration',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Migration info command
 */
export async function infoCommand(_options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Getting migration system information...');
    
    const config = await new ConfigManager().load();
    const storageAdapter = new PGLiteStorageAdapter(config.storage.path!);
    
    console.log(chalk.bold('\n📊 Migration System Information\n'));
    
    console.log(chalk.cyan('Database Path:'), config.storage.path!);
    console.log(chalk.cyan('Migration System:'), 'SimpleMigrationManager (PGLite)');
    console.log(chalk.cyan('Schema Source:'), 'src/schemas/database.sql');
    
    const status = await storageAdapter.getMigrationStatus();
    const backupTables = await storageAdapter.listBackupTables();
    
    console.log(chalk.cyan('Applied Migrations:'), status.applied.length);
    console.log(chalk.cyan('Pending Migrations:'), status.pending.length);
    console.log(chalk.cyan('Backup Tables:'), backupTables.length);
    
    if (backupTables.length > 0) {
      console.log(chalk.cyan('Oldest Backup:'), backupTables[backupTables.length - 1]);
      console.log(chalk.cyan('Latest Backup:'), backupTables[0]);
    }
    
    console.log(chalk.green('\n✅ Migration system is operational'));
    console.log(chalk.blue('ℹ️  Use "funcqc migrate status" for detailed information'));
    console.log('');
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to get migration info',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}