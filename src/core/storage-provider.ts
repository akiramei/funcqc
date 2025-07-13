import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from './config';
import { Logger } from '../utils/cli-utils';
import { FuncqcConfig } from '../types';

/**
 * Singleton provider for storage adapter instances
 */
export class StorageProvider {
  private static instance: StorageProvider;
  private storageAdapter: PGLiteStorageAdapter | null = null;
  private initPromise: Promise<PGLiteStorageAdapter> | null = null;

  private constructor() {}

  static getInstance(): StorageProvider {
    if (!StorageProvider.instance) {
      StorageProvider.instance = new StorageProvider();
    }
    return StorageProvider.instance;
  }

  /**
   * Get or create storage adapter instance
   * Note: logger and config are only used during initial creation
   * Subsequent calls will return the same instance regardless of parameters
   */
  async getStorage(options?: {
    config?: FuncqcConfig;
    logger?: Logger;
    forceNew?: boolean;
  }): Promise<PGLiteStorageAdapter> {
    // Return existing instance if available and not forcing new
    if (this.storageAdapter && !options?.forceNew) {
      return this.storageAdapter;
    }

    // Return existing initialization promise to prevent race conditions
    if (this.initPromise && !options?.forceNew) {
      return this.initPromise;
    }

    // Create new initialization promise
    this.initPromise = this.initializeStorage(options);
    
    try {
      this.storageAdapter = await this.initPromise;
      return this.storageAdapter;
    } finally {
      this.initPromise = null;
    }
  }

  private async initializeStorage(options?: {
    config?: FuncqcConfig;
    logger?: Logger;
  }): Promise<PGLiteStorageAdapter> {
    // Use provided config or load default
    const config = options?.config || await this.loadConfig();
    const logger = options?.logger || new Logger();

    // Create storage adapter
    const storage = new PGLiteStorageAdapter(
      config.storage.path || '.funcqc/funcqc.db',
      logger
    );

    // Initialize storage
    await storage.init();

    // Future initialization steps can be added here
    // await storage.runMigrations();
    // await storage.validateSchema();
    // await storage.warmCache();

    return storage;
  }

  private async loadConfig(): Promise<FuncqcConfig> {
    const configManager = new ConfigManager();
    return await configManager.load();
  }

  /**
   * Close storage connection and reset instance
   */
  async close(): Promise<void> {
    if (this.storageAdapter) {
      await this.storageAdapter.close();
      this.storageAdapter = null;
    }
  }

  /**
   * Reset the singleton instance (mainly for testing)
   */
  static reset(): void {
    if (StorageProvider.instance?.storageAdapter) {
      StorageProvider.instance.storageAdapter.close().catch(() => {
        // Ignore errors during reset
      });
    }
    StorageProvider.instance = undefined!;
  }
}

/**
 * Convenience function to get storage adapter
 */
export async function getStorage(options?: {
  config?: FuncqcConfig;
  logger?: Logger;
}): Promise<PGLiteStorageAdapter> {
  const provider = StorageProvider.getInstance();
  return provider.getStorage(options);
}