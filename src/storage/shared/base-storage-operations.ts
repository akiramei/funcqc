import type { StorageContext } from '../modules/types';

/**
 * Base class for storage operations with common initialization
 */
export abstract class BaseStorageOperations {
  readonly db;
  protected readonly logger;
  private readonly context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
    this.db = context.db;
    this.logger = context.logger;
  }

  /**
   * Get Kysely instance from context (ensures we get the latest instance)
   */
  protected get kysely() {
    return this.context.kysely;
  }
}