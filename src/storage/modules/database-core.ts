/**
 * Core database operations and transaction management
 */

import { Kysely } from 'kysely';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PGliteDialect } from '../dialects/pglite-dialect';
import { Database } from '../types/kysely-types';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext, TransactionHandler } from './types';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
   * Initialize database schema from SQL file
   */
  private async initializeSchema(): Promise<void> {
    const cacheKey = this.context.dbPath;

    // Check schema cache first
    if (DatabaseCore.schemaCache.get(cacheKey)) {
      return;
    }

    try {
      // Check if tables exist
      const result = await this.context.db.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'snapshots'
      `);

      if (parseInt((result.rows[0] as { count: string })?.count || '0') > 0) {
        DatabaseCore.schemaCache.set(cacheKey, true);
        return;
      }

      // Load and execute schema
      const schemaPath = path.join(__dirname, '../../schemas/database.sql');
      if (!existsSync(schemaPath)) {
        throw new Error(`Database schema file not found: ${schemaPath}`);
      }

      const schemaSql = readFileSync(schemaPath, 'utf8');
      await this.context.db.exec(schemaSql);

      DatabaseCore.schemaCache.set(cacheKey, true);
      this.context.logger?.log('Database schema initialized successfully');
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        'Failed to initialize database schema',
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