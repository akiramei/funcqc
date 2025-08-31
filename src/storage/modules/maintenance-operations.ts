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

          // For PGLite, we can't get accurate dead tuple information
          // We'll show basic stats and indicate maintenance is recommended for tables with data
          const needsMaintenance = rowCount > 0; // Any table with data could benefit from maintenance

          stats.push({
            tableName,
            rowCount,
            tableSize,
            deadTuples: 0, // PGLite doesn't track this accurately
            deadTuplesPercent: 0, // PGLite doesn't track this accurately
            lastVacuum: null, // PGLite doesn't track vacuum history
            lastAnalyze: null, // PGLite doesn't track analyze history
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
      ORDER BY table_name
    `;
    
    const result = await this.context.db.query(query);
    return result.rows.map((row: unknown) => (row as { tablename: string }).tablename);
  }
}