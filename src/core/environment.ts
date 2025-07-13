import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from './config';
import { Logger } from '../utils/cli-utils';
import { AppEnvironment, CommandEnvironment } from '../types/environment';

/**
 * Initialize the application environment
 * This should be called once at application startup
 */
export async function createAppEnvironment(options?: {
  configPath?: string;
  dbPath?: string | undefined;
  quiet?: boolean;
  verbose?: boolean;
}): Promise<AppEnvironment> {
  // Load configuration
  const configManager = new ConfigManager();
  const config = await configManager.load();

  // Override config if options provided
  if (options?.dbPath) {
    config.storage.path = options.dbPath;
  }

  // Create global logger for shared components
  const logger = new Logger(options?.verbose, options?.quiet);

  // Initialize storage with the global logger
  const storage = new PGLiteStorageAdapter(
    config.storage.path || '.funcqc/funcqc.db',
    logger
  );
  await storage.init();

  return {
    storage,
    config,
    logger,
  };
}

/**
 * Create command-specific environment
 * Each command gets its own logger while sharing storage and config
 */
export function createCommandEnvironment(
  appEnv: AppEnvironment,
  options?: {
    quiet?: boolean;
    verbose?: boolean;
  }
): CommandEnvironment {
  const commandLogger = new Logger(options?.verbose, options?.quiet);
  
  return {
    ...appEnv,
    commandLogger,
  };
}

/**
 * Cleanup application environment
 */
export async function destroyAppEnvironment(env: AppEnvironment): Promise<void> {
  await env.storage.close();
}