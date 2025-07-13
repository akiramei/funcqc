import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import { FuncqcConfig } from '../types';

/**
 * Application environment containing all shared dependencies
 */
export interface AppEnvironment {
  storage: PGLiteStorageAdapter;
  config: FuncqcConfig;
  logger: Logger;
}

/**
 * Command-specific environment that extends the app environment
 */
export interface CommandEnvironment extends AppEnvironment {
  commandLogger: Logger;
}