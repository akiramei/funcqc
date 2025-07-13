import { OptionValues } from 'commander';
import { createAppEnvironment, createCommandEnvironment, destroyAppEnvironment } from '../core/environment';
import { AppEnvironment, CommandEnvironment } from '../types/environment';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { SystemChecker } from '../utils/system-checker';
import { AsyncReader } from '../types/reader';
import { BaseCommandOptions } from '../types/command';

/**
 * Higher-order function that wraps Reader-based commands with environment injection
 */
export function withEnvironment<TOptions extends BaseCommandOptions>(
  commandReader: (options: TOptions) => AsyncReader<CommandEnvironment, void>
) {
  return async (options: TOptions, parentCommand?: { opts(): OptionValues }): Promise<void> => {
    const parentOpts = parentCommand?.opts() || {};
    let appEnv: AppEnvironment | null = null;
    
    try {
      
      // System check if not disabled
      if (!parentOpts['noCheck'] && !parentOpts['checkSystem']) {
        const logger = new Logger(parentOpts['verbose'], parentOpts['quiet']);
        const systemChecker = new SystemChecker(logger);
        systemChecker.checkSystem();
      }

      // Detect JSON output mode to ensure complete silence
      const isJsonOutput = Boolean(options['json']) || process.argv.includes('--json');
      
      // Create application environment
      appEnv = await createAppEnvironment({
        configPath: parentOpts['config'],
        dbPath: parentOpts['cwd'] ? `${parentOpts['cwd']}/.funcqc/funcqc.db` : undefined,
        quiet: Boolean(parentOpts['quiet']) || isJsonOutput, // Force quiet for JSON output
        verbose: Boolean(parentOpts['verbose']) && !isJsonOutput, // Disable verbose for JSON output
      });

      // Create command-specific environment
      const commandEnv = createCommandEnvironment(appEnv, {
        quiet: Boolean(options['quiet'] ?? parentOpts['quiet']) || isJsonOutput,
        verbose: Boolean(options['verbose'] ?? parentOpts['verbose']) && !isJsonOutput,
      });

      // Execute Reader command with injected environment
      const readerFn = commandReader(options);
      await readerFn(commandEnv);

    } catch (error) {
      const logger = new Logger(parentOpts['verbose'], parentOpts['quiet']);
      const errorHandler = createErrorHandler(logger);
      
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Command failed: ${error instanceof Error ? error.message : String(error)}`,
        { command: process.argv.slice(2) },
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
      process.exit(1);
    } finally {
      // Clean up resources
      if (appEnv) {
        await destroyAppEnvironment(appEnv);
      }
    }
  };
}

/**
 * Legacy command wrapper for commands that haven't been refactored yet
 */
export function withLegacyCommand<TOptions extends Record<string, any>>(
  commandImport: () => Promise<{ [key: string]: (options: TOptions) => Promise<void> }>,
  commandName: string
) {
  return async (options: TOptions): Promise<void> => {
    const module = await commandImport();
    const commandFn = module[commandName];
    if (!commandFn) {
      throw new Error(`Command function ${commandName} not found in module`);
    }
    await commandFn(options);
  };
}