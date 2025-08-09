/**
 * Common types and interfaces for PGLite storage modules
 */

import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { GitProvider } from '../../utils/git/index.js';
import { Database } from '../types/kysely-types';

/**
 * Base interface for all storage operation modules
 */
export interface StorageOperationModule {
  readonly db: PGlite;
  readonly kysely: Kysely<Database>;
}

/**
 * Shared context for all storage operations
 */
export interface StorageContext {
  db: PGlite;
  kysely: Kysely<Database>;
  git: GitProvider;
  dbPath: string;
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  utilityOps?: import('./utility-operations').UtilityOperations;
}

/**
 * Transaction handler type
 */
export type TransactionHandler<T> = (trx: Kysely<Database>) => Promise<T>;

/**
 * Common error types
 */
export enum StorageErrorCode {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  TRANSACTION_ERROR = 'TRANSACTION_ERROR',
  QUERY_ERROR = 'QUERY_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  DUPLICATE_KEY = 'DUPLICATE_KEY',
}

/**
 * Storage operation result type
 */
export interface OperationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: StorageErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}