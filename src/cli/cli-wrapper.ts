import { OptionValues } from 'commander';
import { createAppEnvironment, createLightweightAppEnvironment, createCommandEnvironment, destroyAppEnvironment } from '../core/environment';
import { AppEnvironment, CommandEnvironment } from '../types/environment';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { SystemChecker } from '../utils/system-checker';
import { AsyncReader } from '../types/reader';
import { BaseCommandOptions } from '../types/command';
import { loadComprehensiveCallGraphData } from '../utils/lazy-analysis';

/**
 * Performs system check if enabled
 */
function performSystemCheck(parentOpts: OptionValues): void {
  if (!parentOpts['noCheck'] && !parentOpts['checkSystem']) {
    const logger = new Logger(parentOpts['verbose'], parentOpts['quiet']);
    const systemChecker = new SystemChecker(logger);
    systemChecker.checkSystem();
  }
}

/**
 * Detects if JSON output mode is enabled
 */
function isJsonOutputMode<TOptions extends BaseCommandOptions>(options: TOptions): boolean {
  return Boolean(options['json']) || process.argv.includes('--json');
}

/**
 * Creates application environment with appropriate settings
 */
async function createAppEnv(parentOpts: OptionValues, isJsonOutput: boolean): Promise<AppEnvironment> {
  return await createAppEnvironment({
    configPath: parentOpts['config'],
    dbPath: parentOpts['cwd'] ? `${parentOpts['cwd']}/.funcqc/funcqc.db` : undefined,
    quiet: Boolean(parentOpts['quiet']) || isJsonOutput,
    verbose: Boolean(parentOpts['verbose']) && !isJsonOutput,
  });
}

/**
 * Creates lightweight application environment for read-only commands
 * Optimized for fast startup
 */
async function createLightweightAppEnv(parentOpts: OptionValues, isJsonOutput: boolean): Promise<AppEnvironment> {
  return await createLightweightAppEnvironment({
    configPath: parentOpts['config'],
    dbPath: parentOpts['cwd'] ? `${parentOpts['cwd']}/.funcqc/funcqc.db` : undefined,
    quiet: Boolean(parentOpts['quiet']) || isJsonOutput,
    verbose: Boolean(parentOpts['verbose']) && !isJsonOutput,
  });
}

/**
 * Creates command environment with appropriate settings
 */
function createCmdEnv<TOptions extends BaseCommandOptions>(
  appEnv: AppEnvironment,
  options: TOptions,
  parentOpts: OptionValues,
  isJsonOutput: boolean
): CommandEnvironment {
  return createCommandEnvironment(appEnv, {
    quiet: Boolean(options['quiet'] ?? parentOpts['quiet']) || isJsonOutput,
    verbose: Boolean(options['verbose'] ?? parentOpts['verbose']) && !isJsonOutput,
  });
}

/**
 * Handles and logs errors with proper formatting
 */
function handleCommandError(error: unknown, parentOpts: OptionValues): never {
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
}

/**
 * List of commands that can use lightweight initialization
 */
const LIGHTWEIGHT_COMMANDS = ['list', 'show', 'files', 'search', 'history', 'similar', 'explain'];

/**
 * List of commands that require call graph analysis
 */
const CALL_GRAPH_COMMANDS = ['health', 'dep', 'safe-delete', 'detect'];

/**
 * Determines if the current command is lightweight
 */
function isLightweightCommand(): boolean {
  const command = process.argv[2];
  return LIGHTWEIGHT_COMMANDS.includes(command);
}

/**
 * Determines if the current command requires call graph analysis
 */
function requiresCallGraphAnalysis(): boolean {
  const command = process.argv[2];
  return CALL_GRAPH_COMMANDS.includes(command);
}

/**
 * Get the list of commands that require call graph analysis
 */
export function getCallGraphCommands(): string[] {
  return [...CALL_GRAPH_COMMANDS];
}

/**
 * Ensures call graph data is available for commands that require it
 */
async function ensureCallGraphAnalysis(commandEnv: CommandEnvironment, mergedOptions: BaseCommandOptions & { json?: boolean; aiOptimized?: boolean; snapshot?: string }): Promise<void> {
  if (requiresCallGraphAnalysis()) {
    try {
      // Determine if we should show progress (not for JSON modes)
      const isJsonMode = mergedOptions.json || mergedOptions.aiOptimized || process.argv.includes('--json');
      
      const callGraphData = await loadComprehensiveCallGraphData(commandEnv, {
        showProgress: !isJsonMode,
        snapshotId: mergedOptions.snapshot
      });
      
      // Attach call graph data to the command environment (only if snapshot exists)
      if (callGraphData.snapshot) {
        commandEnv.callGraphData = {
          ...callGraphData,
          snapshot: callGraphData.snapshot
        };
      }
    } catch {
      // Let the individual commands handle the error appropriately
      // This ensures call graph analysis failure doesn't break the wrapper
      // Don't throw here - let the command handle it
    }
  }
}

/**
 * Higher-order function that wraps Reader-based commands with environment injection
 */
export function withEnvironment<TOptions extends BaseCommandOptions>(
  commandReader: (options: TOptions) => AsyncReader<CommandEnvironment, void>
) {
  return async (options: TOptions, parentCommand?: { opts(): OptionValues; parent?: { opts(): OptionValues } }): Promise<void> => {
    // Extract parent options correctly - check if parentCommand is the command itself or has a parent
    const parentOpts = parentCommand?.parent?.opts?.() || parentCommand?.opts?.() || {};
    let appEnv: AppEnvironment | null = null;
    
    // Merge parent options into command options for global options like --verbose
    const mergedOptions: TOptions = { ...options };
    for (const [key, value] of Object.entries(parentOpts)) {
      if (!(key in mergedOptions) || mergedOptions[key as keyof TOptions] === undefined) {
        (mergedOptions as Record<string, unknown>)[key] = value;
      }
    }
    
    
    try {
      performSystemCheck(parentOpts);
      
      const isJsonOutput = isJsonOutputMode(mergedOptions);
      
      // Use lightweight environment for read-only commands
      if (isLightweightCommand()) {
        appEnv = await createLightweightAppEnv(parentOpts, isJsonOutput);
      } else {
        appEnv = await createAppEnv(parentOpts, isJsonOutput);
      }
      
      const commandEnv = createCmdEnv(appEnv, mergedOptions, parentOpts, isJsonOutput);

      // Ensure call graph analysis is available for commands that require it
      await ensureCallGraphAnalysis(commandEnv, mergedOptions);

      const readerFn = commandReader(mergedOptions);
      await readerFn(commandEnv);

    } catch (error) {
      handleCommandError(error, parentOpts);
    } finally {
      if (appEnv) {
        await destroyAppEnvironment(appEnv);
      }
    }
  };
}

/**
 * Legacy command wrapper for commands that haven't been refactored yet
 */
export function withLegacyCommand<TOptions extends Record<string, unknown>>(
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