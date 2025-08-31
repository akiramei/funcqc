import { StorageContext } from './types';
import { ErrorCode } from '../../utils/error-handler';
import { DatabaseError } from '../errors/database-error';

/**
 * Table statistics information for database maintenance
 */
export interface TableStats {
  tableName: string;
  rowCount: number;
  tableSize: string;
  deadTuples: number;
  deadTuplesPercent: number;
  lastVacuum: string | null;
  lastAnalyze: string | null;
  needsMaintenance: boolean;
}

/**
 * Maintenance operation options
 */
export interface MaintenanceOptions {
  tables?: string[];
  full?: boolean;
  verbose?: boolean;
}

/**
 * Maintenance operation result
 */
export interface MaintenanceResult {
  success: boolean;
  operation: string;
  duration: number;
  tablesProcessed: string[];
  errors?: string[] | undefined;
  warnings?: string[] | undefined;
}

/**
 * Database maintenance operations for PostgreSQL/PGLite
 * Provides VACUUM, ANALYZE, REINDEX, and statistics functionality
 */
export class MaintenanceOperations {
  constructor(private context: StorageContext) {}

  /**
   * Get comprehensive statistics for all user tables
   */
  async getTableStats(): Promise<TableStats[]> {
    try {
      // Get all user tables first
      const tables = await this.getAllUserTables();
      const stats: TableStats[] = [];

      for (const tableName of tables) {
        try {
          // Get row count
          const countResult = await this.context.db.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
          const rowCount = parseInt((countResult.rows[0] as { count: string }).count, 10);

          // Get table size (PGLite may not support pg_size_pretty, so we'll use a simple approach)
          let tableSize = 'N/A';
          try {
            const sizeResult = await this.context.db.query(`SELECT pg_size_pretty(pg_total_relation_size($1)) as size`, [tableName]);
            tableSize = (sizeResult.rows[0] as { size: string })?.size || 'N/A';
          } catch {
            // Fallback for PGLite - estimate size based on row count
            const estimatedBytes = rowCount * 1000; // rough estimate
            if (estimatedBytes > 1024 * 1024) {
              tableSize = `~${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
            } else if (estimatedBytes > 1024) {
              tableSize = `~${(estimatedBytes / 1024).toFixed(1)} kB`;
            } else {
              tableSize = `~${estimatedBytes} bytes`;
            }
          }

          // Try to get more sophisticated maintenance recommendations
          let needsMaintenance = false;
          let deadTuples = 0;
          let deadTuplesPercent = 0;
          let lastVacuum: string | null = null;
          let lastAnalyze: string | null = null;

          try {
            // Try to use PostgreSQL statistics if available
            const pgStatQuery = `
              SELECT 
                n_dead_tup,
                n_live_tup,
                last_autovacuum,
                last_vacuum,
                last_autoanalyze,
                last_analyze
              FROM pg_stat_user_tables 
              WHERE relname = $1
            `;
            const pgStatResult = await this.context.db.query(pgStatQuery, [tableName]);
            
            if (pgStatResult.rows.length > 0) {
              const row = pgStatResult.rows[0] as {
                n_dead_tup: number;
                n_live_tup: number;
                last_autovacuum: string | null;
                last_vacuum: string | null;
                last_autoanalyze: string | null;
                last_analyze: string | null;
              };

              deadTuples = row.n_dead_tup || 0;
              const liveTuples = row.n_live_tup || 0;
              const totalTuples = deadTuples + liveTuples;
              
              if (totalTuples > 0) {
                deadTuplesPercent = Math.round((deadTuples / totalTuples) * 100);
              }

              // Set last vacuum/analyze timestamps
              lastVacuum = row.last_vacuum || row.last_autovacuum;
              lastAnalyze = row.last_analyze || row.last_autoanalyze;

              // Sophisticated maintenance decision logic
              const deadTupleThreshold = 20; // 20% dead tuples
              const oldVacuumThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
              const oldAnalyzeThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

              const highDeadTuples = deadTuplesPercent >= deadTupleThreshold;
              const oldVacuum = !lastVacuum || (Date.now() - new Date(lastVacuum).getTime() > oldVacuumThreshold);
              const oldAnalyze = !lastAnalyze || (Date.now() - new Date(lastAnalyze).getTime() > oldAnalyzeThreshold);

              needsMaintenance = highDeadTuples || (oldVacuum && rowCount > 1000) || (oldAnalyze && rowCount > 1000);
            }
          } catch {
            // Fall back to PGLite simple logic if pg_stat_user_tables is not available
            needsMaintenance = rowCount > 10000; // Only recommend maintenance for larger tables in PGLite
          }

          stats.push({
            tableName,
            rowCount,
            tableSize,
            deadTuples,
            deadTuplesPercent,
            lastVacuum,
            lastAnalyze,
            needsMaintenance
          });
        } catch (tableError) {
          // Skip tables we can't access
          console.warn(`Warning: Could not get stats for table ${tableName}: ${tableError}`);
        }
      }

      return stats;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get table statistics: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Run VACUUM operation on specified tables or all tables
   */
  async vacuum(options: MaintenanceOptions = {}): Promise<MaintenanceResult> {
    const startTime = Date.now();
    const operation = options.full ? 'VACUUM FULL' : 'VACUUM';
    
    try {
      const tables = options.tables || await this.getAllUserTables();
      const tablesProcessed: string[] = [];
      const errors: string[] = [];

      for (const table of tables) {
        try {
          const vacuumCommand = options.full ? `VACUUM FULL "${table}"` : `VACUUM "${table}"`;
          await this.context.db.query(vacuumCommand);
          tablesProcessed.push(table);
        } catch (error) {
          const errorMsg = `Failed to vacuum table ${table}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          if (options.verbose) {
            console.warn(`⚠️ ${errorMsg}`);
          }
        }
      }

      const duration = Date.now() - startTime;
      
      return {
        success: errors.length === 0,
        operation,
        duration,
        tablesProcessed,
        ...(errors.length > 0 && { errors })
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Vacuum operation failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Run ANALYZE operation on specified tables or all tables
   */
  async analyze(options: MaintenanceOptions = {}): Promise<MaintenanceResult> {
    const startTime = Date.now();
    
    try {
      const tables = options.tables || await this.getAllUserTables();
      const tablesProcessed: string[] = [];
      const errors: string[] = [];

      for (const table of tables) {
        try {
          await this.context.db.query(`ANALYZE "${table}"`);
          tablesProcessed.push(table);
        } catch (error) {
          const errorMsg = `Failed to analyze table ${table}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          if (options.verbose) {
            console.warn(`⚠️ ${errorMsg}`);
          }
        }
      }

      const duration = Date.now() - startTime;
      
      return {
        success: errors.length === 0,
        operation: 'ANALYZE',
        duration,
        tablesProcessed,
        ...(errors.length > 0 && { errors })
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Analyze operation failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Run REINDEX operation on specified tables or all tables
   */
  async reindex(options: MaintenanceOptions = {}): Promise<MaintenanceResult> {
    const startTime = Date.now();
    
    try {
      const tables = options.tables || await this.getAllUserTables();
      const tablesProcessed: string[] = [];
      const errors: string[] = [];

      for (const table of tables) {
        try {
          await this.context.db.query(`REINDEX TABLE "${table}"`);
          tablesProcessed.push(table);
        } catch (error) {
          const errorMsg = `Failed to reindex table ${table}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          if (options.verbose) {
            console.warn(`⚠️ ${errorMsg}`);
          }
        }
      }

      const duration = Date.now() - startTime;
      
      return {
        success: errors.length === 0,
        operation: 'REINDEX',
        duration,
        tablesProcessed,
        ...(errors.length > 0 && { errors })
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Reindex operation failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Run comprehensive maintenance (VACUUM + ANALYZE or VACUUM FULL + REINDEX + ANALYZE)
   */
  async maintain(options: MaintenanceOptions = {}): Promise<MaintenanceResult[]> {
    const results: MaintenanceResult[] = [];

    if (options.full) {
      // Full maintenance: VACUUM FULL + REINDEX + ANALYZE
      results.push(await this.vacuum({ ...options, full: true }));
      results.push(await this.reindex(options));
      results.push(await this.analyze(options));
    } else {
      // Standard maintenance: VACUUM + ANALYZE
      results.push(await this.vacuum(options));
      results.push(await this.analyze(options));
    }

    return results;
  }

  /**
   * Get list of all user tables
   */
  private async getAllUserTables(): Promise<string[]> {
    const query = `
      SELECT table_name as tablename
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    
    const result = await this.context.db.query(query);
    return result.rows.map((row: unknown) => (row as { tablename: string }).tablename);
  }
}