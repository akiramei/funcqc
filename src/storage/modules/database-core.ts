/**
 * Core database operations and transaction management
 */

import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { PGliteDialect } from '../dialects/pglite-dialect';
import { Database } from '../types/kysely-types';
import { DatabaseError } from '../errors/database-error';
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
        'Failed to initialize database',
        'CONNECTION_ERROR',
        error
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

      if (result.rows[0]?.count > 0) {
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
        'Failed to initialize database schema',
        'SCHEMA_INIT_ERROR',
        error
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
        'Transaction failed',
        'TRANSACTION_ERROR',
        error
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