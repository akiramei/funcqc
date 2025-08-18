import { ManageCommandOptions, DbCommandOptions, HistoryCommandOptions } from '../../types';
import { DiffCommandOptions } from './diff';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';
import { DatabaseError } from '../../storage/pglite-adapter';

/**
 * Manage command - unified data management interface
 * Consolidates functionality from db, diff, export, import, convert, list-backups commands
 */
export const manageCommand: VoidCommand<ManageCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (!options.quiet) {
        env.commandLogger.log('📊 Starting data management operation...');
      }

      switch (options.action) {
        case 'db':
          await executeDatabase(env, options);
          break;
        case 'diff':
          await executeDiff(env, options);
          break;
        case 'export':
          await executeExport(env, options);
          break;
        case 'import':
          await executeImport(env, options);
          break;
        case 'convert':
          await executeConvert(env, options);
          break;
        case 'list-backups':
          await executeListBackups(env, options);
          break;
        case 'history':
          await executeHistory(env, options);
          break;
        default:
          await executeStatus(env, options);
          break;
      }

      if (!options.quiet) {
        env.commandLogger.log('✅ Data management operation completed!');
      }

    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Management operation failed: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute database operations (db command integration)
 */
async function executeDatabase(env: CommandEnvironment, options: ManageCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('🗄️  Managing database...');
  }

  try {
    // Import and execute db command functionality
    const { dbCommand } = await import('./db');
    const dbOptions: DbCommandOptions = {
      list: options.list || false,
      json: options.json || false,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    };
    if (options.table) dbOptions.table = options.table;
    if (options.where) dbOptions.where = options.where;
    if (options.columns) dbOptions.columns = options.columns;
    if (options.limit) dbOptions.limit = typeof options.limit === 'number' ? options.limit.toString() : options.limit;
    
    await dbCommand(dbOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.log('✅ Database operation completed');
    }
  } catch (error) {
    throw new Error(`Database operation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute diff operations (diff command integration)
 */
async function executeDiff(env: CommandEnvironment, options: ManageCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('🔄 Analyzing differences...');
  }

  try {
    // Import and execute diff command functionality
    const { diffCommand } = await import('./diff');
    const diffOptions: DiffCommandOptions = {
      insights: options.insights || false,
      json: options.json || false,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    };
    if (options.similarityThreshold !== undefined) diffOptions.similarityThreshold = options.similarityThreshold;
    
    await diffCommand(options.from || '', options.to || '')(diffOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.log('✅ Diff analysis completed');
    }
  } catch (error) {
    throw new Error(`Diff operation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute export operations
 */
async function executeExport(env: CommandEnvironment, options: ManageCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('📤 Exporting data...');
  }

  try {
    // Get latest snapshot if no specific snapshot specified
    const latest = await env.storage.getSnapshots({ sort: 'created_at desc', limit: 1 });
    const snapshot = latest[0];
    if (!snapshot) {
      console.log('❌ No snapshots found to export');
      return;
    }

    const format = options.format || 'json';
    const exportData: Record<string, unknown> = {
      metadata: {
        exportedAt: new Date().toISOString(),
        funcqcVersion: process.env['npm_package_version'] || 'unknown',
        format,
        snapshot: {
          id: snapshot.id,
          label: snapshot.label,
          createdAt: snapshot.createdAt,
          scope: snapshot.scope
        }
      }
    };

    // Export snapshots
    const snapshots = await env.storage.getSnapshots({ limit: 10 });
    exportData['snapshots'] = snapshots;

    // Export functions from latest snapshot
    const functions = await env.storage.findFunctionsInSnapshot(snapshot.id, { limit: 1000 });
    exportData['functions'] = functions;

    // Export source files if requested
    if (options.includeSourceCode) {
      const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshot.id);
      exportData['sourceFiles'] = sourceFiles;
    }

    if (options.json) {
      console.log(JSON.stringify(exportData, null, 2));
    } else {
      console.log(`📊 Export Summary:`);
      console.log(`   Snapshot: ${snapshot.label || snapshot.id.substring(0, 8)}`);
      console.log(`   Functions: ${functions.length}`);
      console.log(`   Source Files: ${options.includeSourceCode ? 'included' : 'excluded'}`);
      console.log(`   Format: ${format}`);
      console.log('\n💡 Use --json to get exportable data');
      console.log('💡 Use --format=sql for SQL export (planned)');
    }
    
    if (!options.quiet) {
      env.commandLogger.log('✅ Export completed');
    }
  } catch (error) {
    throw new Error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute import operations
 */
async function executeImport(env: CommandEnvironment, options: ManageCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('📥 Importing data...');
  }

  try {
    if (!options.file) {
      console.log('❌ Import file path required. Use --file=/path/to/backup.json');
      return;
    }

    // Check if file exists (placeholder - would need actual file system check)
    console.log(`📁 Import file: ${options.file}`);
    console.log('📥 Import functionality is planned for future release');
    console.log('\n💡 Current alternatives:');
    console.log('   • Use `funcqc scan --label="imported"` to create new snapshots');
    console.log('   • Use database restore operations for full data recovery');
    console.log('   • Export/import workflows will be available in v2.0');
    
    if (!options.quiet) {
      env.commandLogger.log('ℹ️  Import preparation completed');
    }
  } catch (error) {
    throw new Error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute convert operations
 */
async function executeConvert(env: CommandEnvironment, options: ManageCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('🔄 Converting data format...');
  }

  try {
    const fromFormat = options.from || 'json';
    const toFormat = options.format || 'sql';
    
    if (fromFormat === toFormat) {
      console.log('❌ Source and target formats cannot be the same');
      return;
    }

    console.log(`🔄 Format conversion: ${fromFormat} → ${toFormat}`);
    console.log('\n📋 Supported conversions (planned):');
    console.log('   • json → sql: Convert JSON export to SQL format');
    console.log('   • sql → json: Convert SQL dump to JSON format');
    console.log('   • csv → json: Convert CSV data to JSON format');
    console.log('   • json → csv: Convert JSON data to CSV format');
    
    console.log('\n🚀 Data format conversion will be available in v2.0');
    console.log('💡 Current alternative: Use database export/import tools');
    
    if (!options.quiet) {
      env.commandLogger.log('ℹ️  Conversion planning completed');
    }
  } catch (error) {
    throw new Error(`Convert failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute list-backups operations
 */
async function executeListBackups(env: CommandEnvironment, options: ManageCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('📋 Listing backups...');
  }

  try {
    // List snapshots as current "backup" system
    const snapshots = await env.storage.getSnapshots({
      limit: typeof options.limit === 'number' ? options.limit : parseInt(options.limit || '20'),
      sort: 'created_at'
    });

    if (snapshots.length === 0) {
      console.log('📭 No snapshots/backups found');
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({
        backups: snapshots.map(s => ({
          id: s.id,
          label: s.label,
          createdAt: s.createdAt,
          scope: s.scope,
          gitCommit: s.gitCommit,
          gitBranch: s.gitBranch,
          metadata: s.metadata
        }))
      }, null, 2));
    } else {
      console.log(`\n📋 Found ${snapshots.length} snapshots (current backup system):\n`);
      
      console.log('ID       Label                    Created              Scope    Git                Functions');
      console.log('──────── ──────────────────────── ──────────────────── ──────── ────────────────── ─────────');
      
      for (const snapshot of snapshots) {
        const id = snapshot.id.substring(0, 8);
        const label = (snapshot.label || 'unlabeled').padEnd(20).substring(0, 20);
        const created = new Date(snapshot.createdAt).toISOString().substring(0, 19);
        const scope = (snapshot.scope || 'default').padEnd(8).substring(0, 8);
        const git = (snapshot.gitBranch || snapshot.gitCommit || 'none').padEnd(18).substring(0, 18);
        const functions = (snapshot.metadata?.totalFunctions || 0).toString().padStart(9);
        
        console.log(`${id} ${label} ${created} ${scope} ${git} ${functions}`);
      }
      
      console.log('\n💡 Backup system information:');
      console.log('   • Current backups are stored as snapshots in the database');
      console.log('   • Use `funcqc manage --action=export` to create portable backups');
      console.log('   • Enhanced backup system planned for v2.0');
    }
    
    if (!options.quiet) {
      env.commandLogger.log('✅ Backup listing completed');
    }
  } catch (error) {
    throw new Error(`Backup listing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute history operations (history command integration)
 */
async function executeHistory(env: CommandEnvironment, options: ManageCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('📈 Showing detailed history...');
  }

  try {
    // Import and execute history command functionality
    const { historyCommand } = await import('./history');
    const historyOptions: HistoryCommandOptions = {
      verbose: options.verbose || false,
      json: options.json || false
    };
    if (options.limit !== undefined) historyOptions.limit = typeof options.limit === 'number' ? options.limit.toString() : options.limit;
    if (options.since) historyOptions.since = options.since;
    if (options.until) historyOptions.until = options.until;
    if (options.branch) historyOptions.branch = options.branch;
    if (options.label) historyOptions.label = options.label;
    if (options.scope) historyOptions.scope = options.scope;
    
    await historyCommand(historyOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.log('✅ History display completed');
    }
  } catch (error) {
    throw new Error(`History operation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute status display (default action)
 */
async function executeStatus(env: CommandEnvironment, options: ManageCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('📊 Checking data status...');
  }

  const status = [];
  
  // Check snapshots
  try {
    const snapshots = await env.storage.getSnapshots({ limit: 10 });
    status.push({
      category: 'Snapshots',
      total: snapshots.length,
      latest: snapshots.length > 0 ? snapshots[0].createdAt : null,
      details: snapshots.length > 0 
        ? `Latest: ${snapshots[0].label || snapshots[0].id.substring(0, 8)}`
        : 'No snapshots found'
    });
  } catch (error) {
    status.push({
      category: 'Snapshots',
      total: 0,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Check functions
  try {
    const functions = await env.storage.findFunctions({ sort: 'file_path', limit: 1 });
    status.push({
      category: 'Functions',
      total: 'Available',
      details: functions.length > 0 ? 'Database contains function data' : 'No function data'
    });
  } catch (error) {
    status.push({
      category: 'Functions',
      total: 0,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Output results
  if (options.json) {
    console.log(JSON.stringify({
      status: {
        timestamp: new Date().toISOString(),
        categories: status
      }
    }, null, 2));
  } else {
    console.log('\n📊 Data Management Status:');
    console.log('─────────────────────────');
    
    status.forEach(item => {
      if (item.error) {
        console.log(`❌ ${item.category}: Error - ${item.error}`);
      } else {
        console.log(`✅ ${item.category}: ${item.total} - ${item.details}`);
      }
    });
    
    console.log('\n💡 Available actions:');
    console.log('   • --action=db: Database operations');
    console.log('   • --action=diff: Compare snapshots');
    console.log('   • --action=history: Detailed history');
    console.log('   • --action=export: Export data (planned)');
  }
}