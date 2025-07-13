import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from './config';
import { Logger } from '../utils/cli-utils';

/**
 * Global storage manager - initialized once per application lifecycle
 */
export class StorageManager {
  private static instance: PGLiteStorageAdapter | null = null;
  private static initPromise: Promise<PGLiteStorageAdapter> | null = null;

  /**
   * Initialize storage adapter with global settings
   * Should be called once at application startup
   */
  static async initialize(): Promise<PGLiteStorageAdapter> {
    // Return existing instance
    if (StorageManager.instance) {
      return StorageManager.instance;
    }

    // Return existing initialization promise to prevent race conditions
    if (StorageManager.initPromise) {
      return StorageManager.initPromise;
    }

    // Create initialization promise
    StorageManager.initPromise = StorageManager.createStorage();
    
    try {
      StorageManager.instance = await StorageManager.initPromise;
      return StorageManager.instance;
    } finally {
      StorageManager.initPromise = null;
    }
  }

  private static async createStorage(): Promise<PGLiteStorageAdapter> {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    // Use a global logger for storage operations
    // Individual commands can still have their own loggers for command-specific logging
    const logger = new Logger();
    
    const storage = new PGLiteStorageAdapter(
      config.storage.path || '.funcqc/funcqc.db',
      logger
    );

    await storage.init();
    return storage;
  }

  /**
   * Get the initialized storage instance
   * Throws if not initialized
   */
  static getStorage(): PGLiteStorageAdapter {
    if (!StorageManager.instance) {
      throw new Error('Storage not initialized. Call StorageManager.initialize() first.');
    }
    return StorageManager.instance;
  }

  /**
   * Get storage instance, initializing if necessary
   */
  static async getOrInitialize(): Promise<PGLiteStorageAdapter> {
    if (StorageManager.instance) {
      return StorageManager.instance;
    }
    return StorageManager.initialize();
  }

  /**
   * Close storage connection
   */
  static async close(): Promise<void> {
    if (StorageManager.instance) {
      await StorageManager.instance.close();
      StorageManager.instance = null;
    }
  }
}