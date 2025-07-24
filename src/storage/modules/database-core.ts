/**
 * Core database operations and transaction management
 */

import { Kysely } from 'kysely';
import { PGliteDialect } from '../dialects/pglite-dialect';
import { Database } from '../types/kysely-types';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext, TransactionHandler } from './types';


export class DatabaseCore {
  private transactionDepth: number = 0;
  private static schemaCache = new Map<string, boolean>();

  constructor(private context: StorageContext) {}

  /**
   * Initialize database connection and schema
   */
  async initialize(): Promise<void> {
    try {
      // Wait for PGlite to be ready first
      await this.context.db.waitReady;
      
      // Create Kysely instance with PGLite dialect
      this.context.kysely = new Kysely<Database>({
        dialect: new PGliteDialect({
          database: this.context.db,
        }),
      });

      // Initialize schema
      await this.initializeSchema();
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        'Failed to initialize database',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Lightweight initialization for health checks and basic operations
   */
  async lightweightInit(): Promise<void> {
    try {
      // Wait for PGlite to be ready
      await this.context.db.waitReady;

      // Create Kysely instance with minimal setup
      this.context.kysely = new Kysely<Database>({
        dialect: new PGliteDialect({
          database: this.context.db,
        }),
      });

      // Initialize schema if needed for database operations
      await this.initializeSchema();
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        'Failed to lightweight initialize database',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Initialize database schema with migrations
   */
  private async initializeSchema(): Promise<void> {
    const cacheKey = this.context.dbPath;

    // Check schema cache first (disabled for N:1 design migration)
    // if (DatabaseCore.schemaCache.get(cacheKey)) {
    //   return;
    // }

    try {
      // Check if N:1 design tables exist
      const result = await this.context.db.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('source_contents', 'source_file_refs')
      `);

      const n1TablesExist = parseInt((result.rows[0] as { count: string })?.count || '0') >= 2;

      if (!n1TablesExist) {
        // N:1 design migration - add new tables only
        this.context.logger?.log('Migrating to N:1 design - adding source_contents and source_file_refs tables');
        
        await this.context.db.exec(`
          -- Create source_contents table for deduplicated content
          CREATE TABLE IF NOT EXISTS source_contents (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            file_size_bytes INTEGER NOT NULL,
            line_count INTEGER NOT NULL,
            language TEXT NOT NULL,
            encoding TEXT DEFAULT 'utf-8',
            export_count INTEGER DEFAULT 0,
            import_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(file_hash, file_size_bytes)
          );

          -- Create source_file_refs table for per-snapshot references
          CREATE TABLE IF NOT EXISTS source_file_refs (
            id TEXT PRIMARY KEY,
            snapshot_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            content_id TEXT NOT NULL,
            file_modified_time TIMESTAMPTZ,
            function_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
            FOREIGN KEY (content_id) REFERENCES source_contents(id) ON DELETE RESTRICT,
            UNIQUE(snapshot_id, file_path)
          );

          -- Add indexes
          CREATE INDEX IF NOT EXISTS idx_source_contents_file_hash ON source_contents(file_hash);
          CREATE INDEX IF NOT EXISTS idx_source_contents_language ON source_contents(language);
          CREATE INDEX IF NOT EXISTS idx_source_contents_created_at ON source_contents(created_at);
          CREATE INDEX IF NOT EXISTS idx_source_file_refs_snapshot_id ON source_file_refs(snapshot_id);
          CREATE INDEX IF NOT EXISTS idx_source_file_refs_file_path ON source_file_refs(file_path);
          CREATE INDEX IF NOT EXISTS idx_source_file_refs_content_id ON source_file_refs(content_id);
          CREATE INDEX IF NOT EXISTS idx_source_file_refs_function_count ON source_file_refs(function_count);

          -- Add new column to functions table if it doesn't exist
          ALTER TABLE functions ADD COLUMN IF NOT EXISTS source_file_ref_id TEXT;
          CREATE INDEX IF NOT EXISTS idx_functions_source_file_ref_id ON functions(source_file_ref_id);
        `);
        
        this.context.logger?.log('N:1 design migration completed successfully');
      }

      // TODO: Re-enable migration system after debugging
      // await this.runMigrations();

      DatabaseCore.schemaCache.set(cacheKey, true);
    } catch (error) {
      this.context.logger?.error(`Schema initialization error: ${error instanceof Error ? error.message : String(error)}`);
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to initialize database schema: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }


  /**
   * Execute a transaction with proper error handling
   */
  async transaction<T>(handler: TransactionHandler<T>): Promise<T> {
    this.transactionDepth++;
    
    try {
      const result = await this.context.kysely.transaction().execute(async (trx) => {
        return await handler(trx);
      });
      
      this.transactionDepth--;
      return result;
    } catch (error) {
      this.transactionDepth--;
      
      if (error instanceof DatabaseError) {
        throw error;
      }
      
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        'Transaction failed',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get current transaction depth
   */
  getTransactionDepth(): number {
    return this.transactionDepth;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.context.kysely) {
      await this.context.kysely.destroy();
    }
    if (this.context.db) {
      await this.context.db.close();
    }
  }

  /**
   * Clear schema cache (useful for tests)
   */
  static clearSchemaCache(): void {
    DatabaseCore.schemaCache.clear();
  }
}