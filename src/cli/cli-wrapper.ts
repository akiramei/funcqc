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
 * Convert kebab-case keys to camelCase
 */
function kebabToCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Normalize option keys by converting kebab-case to camelCase
 */
function normalizeOptionKeys<T extends Record<string, unknown>>(options: T): T {
  const normalized = {} as T;
  
  for (const [key, value] of Object.entries(options)) {
    const camelKey = kebabToCamelCase(key);
    (normalized as Record<string, unknown>)[camelKey] = value;
    
    // Keep original key as well for backward compatibility
    if (key !== camelKey) {
      (normalized as Record<string, unknown>)[key] = value;
    }
  }
  
  return normalized;
}

/**
 * Analysis execution state guard to prevent duplicate execution within same context
 */
class AnalysisExecutionGuard {
  private static instance: AnalysisExecutionGuard | null = null;
  private executionMap = new Map<string, Map<string, Promise<unknown>>>();

  static getInstance(): AnalysisExecutionGuard {
    if (!AnalysisExecutionGuard.instance) {
      AnalysisExecutionGuard.instance = new AnalysisExecutionGuard();
    }
    return AnalysisExecutionGuard.instance;
  }

  /**
   * Execute analysis with guard protection
   */
  async executeWithGuard<T>(
    snapshotId: string,
    analysisType: string,
    executionFn: () => Promise<T>
  ): Promise<T> {
    if (!this.executionMap.has(snapshotId)) {
      this.executionMap.set(snapshotId, new Map());
    }
    
    const snapshotMap = this.executionMap.get(snapshotId)!;
    
    // If already executing, wait for completion
    if (snapshotMap.has(analysisType)) {
      const existingPromise = snapshotMap.get(analysisType) as Promise<T>;
      return await existingPromise;
    }
    
    // Start new execution
    const promise = executionFn().finally(() => {
      // Clean up after completion
      snapshotMap.delete(analysisType);
      if (snapshotMap.size === 0) {
        this.executionMap.delete(snapshotId);
      }
    });
    
    snapshotMap.set(analysisType, promise);
    return await promise;
  }

  /**
   * Check if analysis is currently executing
   */
  isExecuting(snapshotId: string, analysisType: string): boolean {
    return this.executionMap.get(snapshotId)?.has(analysisType) ?? false;
  }

  /**
   * Clear all execution state (for testing purposes)
   */
  clear(): void {
    this.executionMap.clear();
  }
}

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
 * Command groups with their initialization requirements
 */
const COMMAND_GROUPS = {
  // Standalone: No DB access required
  STANDALONE: {
    commands: ['init', 'config', 'scan', 'eval', 'measure'],
    requires: []
  },
  
  // Basic: Basic function information only
  BASIC: {
    commands: [], // This level is used as a requirement, not for direct command classification
    requires: ['BASIC']
  },
  
  // Lightweight: Basic function information only
  LIGHTWEIGHT: {
    commands: [
      'list', 'show', 'files', 'search', 'history', 'similar',
      'describe', 'evaluate', 'diff', 'residue-check', 'db'
    ],
    requires: ['BASIC']
  },
  
  // Call graph: Function dependencies required
  CALL_GRAPH: {
    commands: ['safe-delete', 'detect'],
    requires: ['CALL_GRAPH']
  },
  
  // Self-managing: Commands that handle their own call graph loading
  SELF_MANAGING: {
    commands: ['dep'],
    requires: []
  },
  
  // Comprehensive: All data required
  COMPREHENSIVE: {
    commands: ['health'],
    requires: ['BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM', 'COUPLING']
  },
  
  // Type System: Type information only
  TYPE_SYSTEM_ONLY: {
    commands: ['types', 'du'],
    requires: ['BASIC', 'TYPE_SYSTEM']
  },
  
  // Deferred: Runs its own analysis
  DEFERRED: {
    commands: ['analyze'],
    requires: [] // Handles its own requirements
  },

  // === NEW UNIFIED COMMANDS ===
  
  // Unified Lightweight: Fast commands with minimal initialization
  UNIFIED_LIGHTWEIGHT: {
    commands: ['inspect', 'setup', 'manage'],
    requires: ['BASIC']
  },
  
  // Unified Dynamic: Commands with option-dependent initialization
  UNIFIED_DYNAMIC: {
    commands: ['assess', 'improve'],
    requires: [] // Determined dynamically based on options
  },
  
  // Unified Specialized: Heavy analysis commands
  UNIFIED_SPECIALIZED: {
    commands: ['dependencies', 'refactor'],
    requires: ['TYPE_SYSTEM'] // Refactor requires type system analysis
  }
};

/**
 * List of commands that can use lightweight initialization
 */
const LIGHTWEIGHT_COMMANDS = [
  ...COMMAND_GROUPS.LIGHTWEIGHT.commands,
  ...COMMAND_GROUPS.UNIFIED_LIGHTWEIGHT.commands
];

/**
 * List of commands that require call graph analysis
 */
const CALL_GRAPH_COMMANDS = COMMAND_GROUPS.CALL_GRAPH.commands;

/**
 * Determines if the current command is lightweight
 * Includes dynamic classification for commands with mixed responsibilities
 */
function isLightweightCommand(): boolean {
  const command = process.argv[2];
  
  // Handle dynamic classification for measure command
  if (command === 'measure') {
    return isMeasureCommandLightweight();
  }
  
  return LIGHTWEIGHT_COMMANDS.includes(command);
}

/**
 * Determine if measure command should be treated as lightweight
 * based on its options (history display vs actual measurement)
 */
function isMeasureCommandLightweight(): boolean {
  const args = process.argv.slice(3);

  // Check if --history is present (lightweight mode)
  if (args.includes('--history')) {
    return true;
  }

  // Determine level (prioritize level semantics first)
  const levelIndex = args.indexOf('--level');
  const hasForce = args.includes('--force');
  if (levelIndex >= 0 && levelIndex < args.length - 1) {
    const levelValue = args[levelIndex + 1];
    // quick + --force -> heavy (new scan is enforced)
    if (levelValue === 'quick') {
      return !hasForce;
    }
    // levels other than quick imply heavier work
    return false;
  }

  // Check for scanning/analysis options (standalone mode)
  const scanningOptions = [
    '--full',
    '--with-graph', '--with-types', '--with-coupling',
    '--call-graph', '--types', '--coupling'
  ];
  const hasScanning = scanningOptions.some(opt => args.includes(opt)) || hasForce;

  // Default to lightweight when no scanning/analysis indicators
  return !hasScanning;
}

/**
 * Check if measure command is in pure history display mode
 * History display doesn't require analysis - just shows existing snapshots
 */
function isMeasureCommandHistoryOnly(): boolean {
  const args = process.argv.slice(3);
  return args.includes('--history');
}

/**
 * Determines if the current command requires call graph analysis
 */
function requiresCallGraphAnalysis(mergedOptions?: Record<string, unknown>): boolean {
  const command = process.argv[2];
  
  // Handle dynamic classification for measure command
  // measure in standalone mode (scanning) handles its own analysis
  if (command === 'measure') {
    return false; // measure handles its own call graph analysis internally
  }
  
  // Check legacy commands
  if (CALL_GRAPH_COMMANDS.includes(command) || COMMAND_GROUPS.COMPREHENSIVE.commands.includes(command)) {
    return true;
  }
  
  // Check dynamic unified commands
  if (COMMAND_GROUPS.UNIFIED_DYNAMIC.commands.includes(command) && mergedOptions) {
    return unifiedCommandRequires('CALL_GRAPH', command, mergedOptions);
  }
  
  // Check specialized commands
  if (COMMAND_GROUPS.UNIFIED_SPECIALIZED.commands.includes(command) && mergedOptions) {
    return unifiedCommandRequires('CALL_GRAPH', command, mergedOptions);
  }
  
  return false;
}

/**
 * Get the list of commands that require call graph analysis
 */
export function getCallGraphCommands(): string[] {
  return [...CALL_GRAPH_COMMANDS];
}

/**
 * Determines if the current command requires basic analysis
 */
function requiresBasicAnalysis(mergedOptions?: Record<string, unknown>): boolean {
  const command = process.argv[2];
  
  // Handle dynamic classification for measure command
  if (command === 'measure') {
    // History display doesn't require analysis - just shows existing snapshots
    if (isMeasureCommandHistoryOnly()) {
      return false;
    }
    // Other lightweight measure commands may need basic analysis
    return isMeasureCommandLightweight();
  }
  
  // Check legacy lightweight commands
  if (COMMAND_GROUPS.LIGHTWEIGHT.commands.includes(command)) {
    return true;
  }
  
  // Check unified lightweight commands
  if (COMMAND_GROUPS.UNIFIED_LIGHTWEIGHT.commands.includes(command)) {
    return true;
  }
  
  // Check dynamic commands with options
  if (COMMAND_GROUPS.UNIFIED_DYNAMIC.commands.includes(command) && mergedOptions) {
    return unifiedCommandRequires('BASIC', command, mergedOptions);
  }
  
  return false;
}

/**
 * Determines if the current command requires type system analysis
 */
function requiresTypeSystemAnalysis(mergedOptions?: Record<string, unknown>): boolean {
  const command = process.argv[2];
  
  // Handle dynamic classification for measure command
  // measure handles its own type system analysis internally
  if (command === 'measure') {
    return false; // measure handles its own type system analysis internally
  }
  
  // Legacy commands
  if (command === 'types' || COMMAND_GROUPS.COMPREHENSIVE.commands.includes(command)) {
    return true;
  }
  
  // Check dynamic unified commands
  if (COMMAND_GROUPS.UNIFIED_DYNAMIC.commands.includes(command) && mergedOptions) {
    return unifiedCommandRequires('TYPE_SYSTEM', command, mergedOptions);
  }
  
  // Check specialized commands (types, refactor)
  if (COMMAND_GROUPS.UNIFIED_SPECIALIZED.commands.includes(command) && mergedOptions) {
    return unifiedCommandRequires('TYPE_SYSTEM', command, mergedOptions);
  }
  
  return false;
}

/**
 * Check if current command requires coupling analysis
 */
function requiresCouplingAnalysis(mergedOptions?: Record<string, unknown>): boolean {
  const command = process.argv[2];
  
  // Handle dynamic classification for measure command
  // measure handles its own coupling analysis internally
  if (command === 'measure') {
    return false; // measure handles its own coupling analysis internally
  }
  
  // Legacy comprehensive commands
  if (COMMAND_GROUPS.COMPREHENSIVE.commands.includes(command)) {
    return true;
  }
  
  // Check dynamic unified commands
  if (COMMAND_GROUPS.UNIFIED_DYNAMIC.commands.includes(command) && mergedOptions) {
    return unifiedCommandRequires('COUPLING', command, mergedOptions);
  }
  
  return false;
}

/**
 * Determine initialization requirements for unified commands based on options
 */
function determineUnifiedInitRequirements(command: string, options: Record<string, unknown>): string[] {
  // New unified commands use dynamic initialization
  switch (command) {
    case 'assess':
      if (options['quick']) return ['BASIC'];
      if (options['type'] === 'health') return ['BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM', 'COUPLING'];
      if (options['type'] === 'quality') return ['BASIC'];
      // Default: comprehensive assessment
      return ['BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM', 'COUPLING'];
      
    case 'improve':
      if (options['type'] === 'dead-code' || options['type'] === 'antipattern') {
        return ['CALL_GRAPH'];
      }
      // Default: basic improvement (dedupe, debug-code)
      return ['BASIC'];
      
    case 'dependencies':
      // Most dependency analysis requires call graph data
      if (options['action'] === 'stats' || options['action'] === 'lint' || 
          options['action'] === 'dead' || options['action'] === 'cycles' ||
          options['action'] === 'show' || options['action'] === 'list') {
        return ['BASIC', 'CALL_GRAPH'];
      }
      // Default overview needs basic data
      return ['BASIC'];
      
    case 'refactor':
      // Most refactoring operations need type information
      if (options['action'] === 'guard' || options['action'] === 'type-replace') {
        // Guard and type replacement need comprehensive analysis
        return ['BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM'];
      }
      // Other refactoring actions need type system
      return ['BASIC', 'TYPE_SYSTEM'];
      
    case 'inspect':
    case 'setup':
    case 'manage':
      // Always lightweight
      return ['BASIC'];
      
    default:
      return ['BASIC'];
  }
}

/**
 * Check if unified command requires specific analysis type
 */
function unifiedCommandRequires(analysisType: string, command: string, options: Record<string, unknown>): boolean {
  const requirements = determineUnifiedInitRequirements(command, options);
  return requirements.includes(analysisType);
}

/**
 * Ensures basic analysis is available for commands that require it
 */
async function ensureBasicAnalysis(commandEnv: CommandEnvironment, mergedOptions: BaseCommandOptions & { json?: boolean; aiOptimized?: boolean; snapshot?: string }): Promise<void> {
  if (requiresBasicAnalysis(mergedOptions as Record<string, unknown>)) {
    try {
      // Get the latest snapshot (or specified snapshot)
      let snapshot;
      if (mergedOptions.snapshot) {
        snapshot = await commandEnv.storage.getSnapshot(mergedOptions.snapshot);
      } else {
        snapshot = await commandEnv.storage.getLatestSnapshot();
      }
      
      if (!snapshot) {
        return; // No snapshot found - let the command handle this
      }
      
      const guard = AnalysisExecutionGuard.getInstance();
      
      await guard.executeWithGuard(
        snapshot.id,
        'BASIC',
        async () => {
          // Refresh snapshot metadata to get latest state
          const currentSnapshot = await commandEnv.storage.getSnapshot(snapshot.id);
          if (!currentSnapshot) return;
          
          const metadata = currentSnapshot.metadata as Record<string, unknown>;
          const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
          const totalFunctions = Number(metadata?.['totalFunctions'] ?? 0);
          
          if (analysisLevel === 'NONE' || totalFunctions === 0) {
            // Determine if we should show progress (not for JSON modes)
            const isJsonMode = mergedOptions.json || mergedOptions.aiOptimized || process.argv.includes('--json');
            
            if (!isJsonMode) {
              console.log(`🔍 Basic analysis needed for ${snapshot.id.substring(0, 8)}...`);
            }
            
            // Import and execute basic analysis
            const { performDeferredBasicAnalysis } = await import('./commands/scan');
            await performDeferredBasicAnalysis(snapshot.id, commandEnv, !isJsonMode);
            
          }
        }
      );
    } catch {
      // Let the individual commands handle the error appropriately
      // This ensures basic analysis failure doesn't break the wrapper
      // Don't throw here - let the command handle it
    }
  }
}

/**
 * Ensures call graph data is available for commands that require it
 */
async function ensureCallGraphAnalysis(commandEnv: CommandEnvironment, mergedOptions: BaseCommandOptions & { json?: boolean; aiOptimized?: boolean; snapshot?: string }): Promise<void> {
  if (requiresCallGraphAnalysis(mergedOptions as Record<string, unknown>)) {
    try {
      // Get the latest snapshot (or specified snapshot)
      let snapshot;
      if (mergedOptions.snapshot) {
        snapshot = await commandEnv.storage.getSnapshot(mergedOptions.snapshot);
      } else {
        snapshot = await commandEnv.storage.getLatestSnapshot();
      }
      
      if (!snapshot) {
        return; // No snapshot found - let the command handle this
      }
      
      const guard = AnalysisExecutionGuard.getInstance();
      
      await guard.executeWithGuard(
        snapshot.id,
        'CALL_GRAPH',
        async () => {
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
        }
      );
    } catch {
      // Let the individual commands handle the error appropriately
      // This ensures call graph analysis failure doesn't break the wrapper
      // Don't throw here - let the command handle it
    }
  }
}

/**
 * Ensures type system data is available for commands that require it
 */
async function ensureTypeSystemAnalysis(commandEnv: CommandEnvironment, mergedOptions: BaseCommandOptions & { json?: boolean; aiOptimized?: boolean; snapshot?: string }): Promise<void> {
  if (requiresTypeSystemAnalysis(mergedOptions as Record<string, unknown>)) {
    try {
      // Get the latest snapshot (or specified snapshot)
      let snapshot;
      if (mergedOptions.snapshot) {
        snapshot = await commandEnv.storage.getSnapshot(mergedOptions.snapshot);
      } else {
        snapshot = await commandEnv.storage.getLatestSnapshot();
      }
      
      if (!snapshot) {
        return; // No snapshot found - let the command handle this
      }
      
      const guard = AnalysisExecutionGuard.getInstance();
      
      await guard.executeWithGuard(
        snapshot.id,
        'TYPE_SYSTEM',
        async () => {
          // Refresh snapshot metadata to get latest state
          const currentSnapshot = await commandEnv.storage.getSnapshot(snapshot.id);
          if (!currentSnapshot) return;
          
          const metadata = currentSnapshot.metadata as Record<string, unknown>;
          const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
          
          // Also check if actual type definitions exist
          const types = await commandEnv.storage.getTypeDefinitions(snapshot.id);
          
          if (analysisLevel === 'NONE' || analysisLevel === 'BASIC' || analysisLevel === 'CALL_GRAPH' || types.length === 0) {
            // Determine if we should show progress (not for JSON modes)
            const isJsonMode = mergedOptions.json || mergedOptions.aiOptimized || process.argv.includes('--json');
            
            if (!isJsonMode) {
              console.log(`🔍 Type system analysis needed for ${snapshot.id.substring(0, 8)}...`);
            }
            
            // First ensure basic analysis is done
            const metadata = snapshot.metadata as Record<string, unknown>;
            const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
            
            if (analysisLevel === 'NONE') {
              const { performDeferredBasicAnalysis } = await import('./commands/scan');
              await performDeferredBasicAnalysis(snapshot.id, commandEnv, !isJsonMode);
            }
            
            // Import and execute type system analysis
            const { performDeferredTypeSystemAnalysis } = await import('./commands/scan');
            await performDeferredTypeSystemAnalysis(snapshot.id, commandEnv, !isJsonMode);
            // 型分析完了をフラグ＆レベルに反映
            await commandEnv.storage.updateAnalysisLevel(snapshot.id, 'TYPE_SYSTEM');
            
            if (!isJsonMode) {
              console.log(`✓ Type system analysis completed`);
            }
          }
        }
      );
    } catch {
      // Let the individual commands handle the error appropriately
      // This ensures type system analysis failure doesn't break the wrapper
      // Don't throw here - let the command handle it
    }
  }
}

/**
 * Ensure coupling analysis is available for commands that require it
 */
async function ensureCouplingAnalysis(commandEnv: CommandEnvironment, mergedOptions: BaseCommandOptions & { json?: boolean; aiOptimized?: boolean; snapshot?: string }): Promise<void> {
  if (requiresCouplingAnalysis(mergedOptions as Record<string, unknown>)) {
    try {
      // Get the latest snapshot (or specified snapshot)
      let snapshot;
      if (mergedOptions.snapshot) {
        snapshot = await commandEnv.storage.getSnapshot(mergedOptions.snapshot);
      } else {
        snapshot = await commandEnv.storage.getLatestSnapshot();
      }
      
      if (!snapshot) {
        return; // No snapshot found - let the command handle this
      }
      
      const guard = AnalysisExecutionGuard.getInstance();
      
      await guard.executeWithGuard(
        snapshot.id,
        'COUPLING',
        async () => {
          // Refresh snapshot metadata to get latest state
          const currentSnapshot = await commandEnv.storage.getSnapshot(snapshot.id);
          if (!currentSnapshot) return;
          
          const metadata = currentSnapshot.metadata as Record<string, unknown>;
          const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
          
          if (analysisLevel !== 'COUPLING') {
            // Determine if we should show progress (not for JSON modes)
            const isJsonMode = mergedOptions.json || mergedOptions.aiOptimized || process.argv.includes('--json');
            
            if (!isJsonMode) {
              console.log(`🔗 Coupling analysis needed for ${snapshot.id.substring(0, 8)}...`);
            }
            
            // Ensure type system analysis is done first
            if (analysisLevel === 'NONE') {
              await guard.executeWithGuard(
                snapshot.id,
                'BASIC',
                async () => {
                  const { performDeferredBasicAnalysis } = await import('./commands/scan');
                  await performDeferredBasicAnalysis(snapshot.id, commandEnv, !isJsonMode);
                }
              );
            }
            
            // Call graph analysis prerequisite is handled by type system analysis
            // Type system analysis should already be completed by ensureTypeSystemAnalysis()
            // No need to re-run it here
            
            // Import and execute coupling analysis
            const { performDeferredCouplingAnalysis } = await import('./commands/scan');
            await performDeferredCouplingAnalysis(snapshot.id, commandEnv, undefined);
            
            // 結合度分析完了をフラグ＆レベルに反映
            await commandEnv.storage.updateAnalysisLevel(snapshot.id, 'COUPLING');
            
            if (!isJsonMode) {
              console.log(`✓ Coupling analysis completed`);
            }
          }
        }
      );
    } catch {
      // Let the individual commands handle the error appropriately
      // This ensures coupling analysis failure doesn't break the wrapper
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
    
    // Normalize option keys (kebab-case to camelCase) and merge parent options
    const normalizedOptions = normalizeOptionKeys(options as Record<string, unknown>) as TOptions;
    const normalizedParentOpts = normalizeOptionKeys(parentOpts);
    
    const mergedOptions: TOptions = { ...normalizedOptions };
    for (const [key, value] of Object.entries(normalizedParentOpts)) {
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

      // Ensure basic analysis is available for commands that require it
      await ensureBasicAnalysis(commandEnv, mergedOptions);

      // Ensure call graph analysis is available for commands that require it
      await ensureCallGraphAnalysis(commandEnv, mergedOptions);

      // Ensure type system analysis is available for commands that require it
      await ensureTypeSystemAnalysis(commandEnv, mergedOptions);

      // Ensure coupling analysis is available for commands that require it
      await ensureCouplingAnalysis(commandEnv, mergedOptions);

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