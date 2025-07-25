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

    // Check schema cache first
    if (DatabaseCore.schemaCache.get(cacheKey)) {
      return;
    }

    try {
      // Check if basic tables already exist
      const result = await this.context.db.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'snapshots'
      `);

      const tablesExist = parseInt((result.rows[0] as { count: string })?.count || '0') >= 1;
      
      if (tablesExist) {
        this.context.logger?.debug('Database schema already exists');
      } else {
        this.context.logger?.debug('Initializing database schema from database.sql');
        
        const path = await import('path');
        const fs = await import('fs');
        
        // Get the path to database.sql
        const schemaPath = path.join(process.cwd(), 'src/schemas/database.sql');
        
        // Check if schema file exists
        if (!fs.existsSync(schemaPath)) {
          throw new Error(`Database schema file not found: ${schemaPath}`);
        }

        // Read schema content
        const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
        
        if (!schemaContent.trim()) {
          throw new Error('Database schema file is empty');
        }

        // Execute the complete schema
        await this.context.db.exec(schemaContent);
        
        this.context.logger?.debug('Database schema initialized successfully');
      }

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