import type { StorageContext } from '../modules/types';

/**
 * Base class for storage operations with common initialization
 */
export abstract class BaseStorageOperations {
  readonly db;
  readonly kysely;
  protected readonly logger;

  constructor(context: StorageContext) {
    this.db = context.db;
    this.kysely = context.kysely;
    this.logger = context.logger;
  }
}