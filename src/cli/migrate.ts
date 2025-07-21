import { OptionValues } from 'commander';
import chalk from 'chalk';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { ConfigManager } from '../core/config';
import { FuncqcConfig } from '../types';
import { KyselyMigrationManager } from '../migrations/kysely-migration-manager';
import { PGlite } from '@electric-sql/pglite';
import * as path from 'path';

const logger = new Logger();

/**
 * Helper function to create migration components and provide cleanup
 */
async function createMigrationComponents(config: FuncqcConfig) {
  const pglite = new PGlite(config.storage.path!);
  
  // Get the correct migration folder path relative to the project root
  const migrationFolder = path.join(__dirname, '..', 'migrations');
  const migrationManager = new KyselyMigrationManager(pglite, { migrationFolder });
  
  return {
    pglite,
    migrationManager,
    async cleanup() {
      await migrationManager.close();
      await pglite.close();
    }
  };
}

/**
 * Migration up command - apply all pending migrations
 */
export async function upCommand(_options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Starting migration up...');
    
    const config = await new ConfigManager().load();
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      console.log(chalk.bold('\n🚀 Running migrations to latest version...\n'));
      
      const result = await migrationManager.migrateToLatest();
      
      if (result.error) {
        throw result.error;
      }
      
      const appliedMigrations = result.results?.filter(r => r.status === 'Success') || [];
      
      if (appliedMigrations.length === 0) {
        console.log(chalk.blue('ℹ️  No pending migrations to apply'));
      } else {
        console.log(chalk.green(`✅ Applied ${appliedMigrations.length} migrations successfully:`));
        appliedMigrations.forEach(migration => {
          console.log(`  ${chalk.cyan('✓')} ${migration.migrationName}`);
        });
      }
    } finally {
      await cleanup();
    }
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to run migrations',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Migration down command - rollback one migration
 */
export async function downCommand(_options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Starting migration down...');
    
    const config = await new ConfigManager().load();
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      console.log(chalk.bold('\n🔄 Rolling back one migration...\n'));
      
      const result = await migrationManager.migrateDown();
      
      if (result.error) {
        throw result.error;
      }
      
      const rolledBackMigrations = result.results?.filter(r => r.status === 'Success') || [];
      
      if (rolledBackMigrations.length === 0) {
        console.log(chalk.blue('ℹ️  No migrations to roll back'));
      } else {
        console.log(chalk.green(`✅ Rolled back ${rolledBackMigrations.length} migration(s) successfully:`));
        rolledBackMigrations.forEach(migration => {
          console.log(`  ${chalk.cyan('↩️')} ${migration.migrationName}`);
        });
      }
    } finally {
      await cleanup();
    }
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to rollback migration',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Migration status command
 */
export async function statusCommand(_options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Starting migration status check...');
    
    const config = await new ConfigManager().load();
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      console.log(chalk.bold('\n📋 Migration Status\n'));
      
      const migrations = await migrationManager.getMigrationStatus();
      const backupTables = await migrationManager.listBackupTables();
      
      // Applied migrations
      const appliedMigrations = migrations.filter(m => m.executedAt);
      const pendingMigrations = migrations.filter(m => !m.executedAt);
      
      console.log(chalk.green('✅ Applied Migrations:'));
      if (appliedMigrations.length === 0) {
        console.log('  No migrations applied yet');
      } else {
        appliedMigrations.forEach(migration => {
          const date = migration.executedAt ? new Date(migration.executedAt).toLocaleString() : 'Unknown';
          console.log(`  ${chalk.cyan(migration.name)} - ${date}`);
        });
      }
      
      // Pending migrations
      console.log(chalk.yellow('\n⏳ Pending Migrations:'));
      if (pendingMigrations.length === 0) {
        console.log('  No pending migrations');
      } else {
        pendingMigrations.forEach(migration => {
          console.log(`  ${chalk.yellow(migration.name)}`);
        });
      }
      
      // Backup tables
      console.log(chalk.blue('\n💾 Backup Tables:'));
      if (backupTables.length === 0) {
        console.log('  No backup tables found');
      } else {
        backupTables.forEach(backup => {
          const dateStr = backup.created ? ` (${backup.created.toLocaleString()})` : '';
          console.log(`  ${chalk.blue(backup.name)}${dateStr}`);
        });
      }
      
      console.log('');
    } finally {
      await cleanup();
    }
    
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
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      const daysOld = parseInt(options['days']) || 30;
      
      console.log(chalk.yellow(`🧹 Cleaning up backup tables older than ${daysOld} days...`));
      
      const deletedCount = await migrationManager.cleanupOldBackups(daysOld);
      
      if (deletedCount > 0) {
        console.log(chalk.green(`✅ Cleaned up ${deletedCount} old backup table(s)`));
      } else {
        console.log(chalk.blue('ℹ️  No old backup tables to clean up'));
      }
    } finally {
      await cleanup();
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
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      const db = migrationManager.getKyselyInstance();
      
      console.log(chalk.yellow('🔄 Resetting migration history...'));
      
      // Drop Kysely migration table
      await db.schema.dropTable('kysely_migration').ifExists().execute();
      await db.schema.dropTable('kysely_migration_lock').ifExists().execute();
      
      console.log(chalk.green('✅ Migration history reset completed'));
      console.log(chalk.blue('ℹ️  Your data has been preserved, only migration tracking was reset'));
    } finally {
      await cleanup();
    }
    
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
    
    const config = await new ConfigManager().load();
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      const migrationName = options['name'].replace(/\s+/g, '_').toLowerCase();
      
      console.log(chalk.blue(`📝 Creating migration: ${migrationName}...`));
      
      const migrationPath = await migrationManager.createMigration(migrationName);
      
      console.log(chalk.green(`✅ Migration file created successfully`));
      console.log(chalk.blue(`📁 Location: ${migrationPath}`));
      console.log(chalk.yellow('Edit the file to add your migration logic, then run: funcqc migrate up'));
    } finally {
      await cleanup();
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
 * Migration health check command
 */
export async function doctorCommand(_options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Running migration health check...');
    
    const config = await new ConfigManager().load();
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      const healthResult = await migrationManager.diagnoseMigrationHealth();
      
      // Exit with appropriate code
      process.exitCode = healthResult.healthy ? 0 : 1;
      
    } finally {
      await cleanup();
    }
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to run migration health check',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Migration restore command
 */
export async function restoreCommand(_options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Starting migration restore...');
    
    const config = await new ConfigManager().load();
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      const result = await migrationManager.restoreMissingMigrations();
      
      // Exit with appropriate code based on results
      if (result.failed.length > 0) {
        process.exitCode = 1;
      } else if (result.restored.length === 0 && result.skipped.length === 0) {
        process.exitCode = 0; // No missing files
      } else {
        process.exitCode = 0; // Successfully restored or skipped
      }
      
    } finally {
      await cleanup();
    }
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.MIGRATION_FAILED,
      'Failed to restore migrations',
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Displays basic system information
 */
function displaySystemInfo(config: FuncqcConfig): void {
  console.log(chalk.bold('\n📊 Migration System Information\n'));
  console.log(chalk.cyan('Database Path:'), config.storage.path!);
  console.log(chalk.cyan('Migration System:'), 'KyselyMigrationManager (PGLite + Kysely)');
  console.log(chalk.cyan('Migration Folder:'), path.join(process.cwd(), 'migrations'));
  console.log(chalk.cyan('Schema Source:'), 'TypeScript migration files (.ts)');
}

/**
 * Displays migration statistics
 */
function displayMigrationStats(migrations: Record<string, unknown>[], backupTables: Record<string, unknown>[]): void {
  const appliedCount = migrations.filter(m => m['executedAt']).length;
  const pendingCount = migrations.filter(m => !m['executedAt']).length;
  
  console.log(chalk.cyan('Applied Migrations:'), appliedCount);
  console.log(chalk.cyan('Pending Migrations:'), pendingCount);
  console.log(chalk.cyan('Backup Tables:'), backupTables.length);
}

/**
 * Displays backup table information
 */
function displayBackupInfo(backupTables: Record<string, unknown>[]): void {
  if (backupTables.length === 0) return;
  
  const sortedBackups = backupTables.sort((a, b) => {
    const aCreated = a['created'] as Date | undefined;
    const bCreated = b['created'] as Date | undefined;
    if (!aCreated || !bCreated) return 0;
    return aCreated.getTime() - bCreated.getTime();
  });
  
  const oldestBackup = sortedBackups[0];
  const oldestCreated = oldestBackup?.['created'] as Date | undefined;
  if (oldestCreated) {
    console.log(chalk.cyan('Oldest Backup:'), `${oldestBackup['name']} (${oldestCreated.toLocaleString()})`);
  }
  
  const latestBackup = sortedBackups[sortedBackups.length - 1];
  const latestCreated = latestBackup?.['created'] as Date | undefined;
  if (latestCreated) {
    console.log(chalk.cyan('Latest Backup:'), `${latestBackup['name']} (${latestCreated.toLocaleString()})`);
  }
}

/**
 * Displays completion message
 */
function displayCompletionMessage(): void {
  console.log(chalk.green('\n✅ Migration system is operational'));
  console.log(chalk.blue('ℹ️  Use "funcqc migrate status" for detailed information'));
  console.log('');
}

/**
 * Migration info command
 */
export async function infoCommand(_options: OptionValues): Promise<void> {
  const errorHandler = createErrorHandler(logger);

  try {
    logger.debug('Getting migration system information...');
    
    const config = await new ConfigManager().load();
    const { migrationManager, cleanup } = await createMigrationComponents(config);
    
    try {
      displaySystemInfo(config);
      
      const migrations = await migrationManager.getMigrationStatus();
      const backupTables = await migrationManager.listBackupTables();
      
      displayMigrationStats(migrations as unknown as Record<string, unknown>[], backupTables);
      displayBackupInfo(backupTables);
      displayCompletionMessage();
    } finally {
      await cleanup();
    }
    
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