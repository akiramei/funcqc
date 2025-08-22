import { DependenciesCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode, DatabaseErrorLike } from '../../utils/error-handler';

/**
 * Filter out undefined properties from an object
 */
function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * Dependencies command - unified dependency analysis interface
 * Consolidates functionality from dep list, show, stats, lint, dead, cycles subcommands
 */
export const dependenciesCommand: VoidCommand<DependenciesCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (!options.quiet) {
        env.commandLogger.info('🔗 Starting dependency analysis...');
      }

      switch (options.action) {
        case 'list':
          await executeList(env, options);
          break;
        case 'show':
          await executeShow(env, options);
          break;
        case 'stats':
          await executeStats(env, options);
          break;
        case 'lint':
          await executeLint(env, options);
          break;
        case 'dead':
          await executeDead(env, options);
          break;
        case 'cycles':
          await executeCycles(env, options);
          break;
        default:
          await executeOverview(env, options);
          break;
      }

      if (!options.quiet) {
        env.commandLogger.info('✅ Dependency analysis completed!');
      }

    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        const dbErr = error as DatabaseErrorLike;
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          dbErr.message,
          { dbCode: dbErr.code },
          dbErr.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Dependency analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute list dependencies (dep list integration)
 */
async function executeList(env: CommandEnvironment, options: DependenciesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📋 Listing function dependencies...');
  }

  try {
    // Import and execute dep list functionality
    const { depListCommand } = await import('../dep/list');
    const listOptions = filterUndefined({
      caller: options.caller,
      callee: options.callee,
      callerClass: options.callerClass,
      calleeClass: options.calleeClass,
      file: options.file,
      type: options.type,
      limit: options.limit,
      sort: (options.sort as 'caller' | 'callee' | 'file' | 'line') || 'caller',
      desc: options.desc || false,
      json: options.json || false,
      snapshot: options.snapshot,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    }) as import('../dep/types').DepListOptions;
    await depListCommand(listOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Dependency list completed');
    }
  } catch (error) {
    throw new Error(`List dependencies failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute show dependency details (dep show integration)
 */
async function executeShow(env: CommandEnvironment, options: DependenciesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔍 Showing detailed dependency information...');
  }

  try {
    // Import and execute dep show functionality
    const { depShowCommand } = await import('../dep/show');
    const showOptions = filterUndefined({
      direction: options.direction || 'both',
      depth: options.depth,
      includeExternal: options.includeExternal || false,
      externalFilter: options.externalFilter || 'all',
      showComplexity: options.showComplexity || false,
      rankByLength: options.rankByLength || false,
      maxRoutes: options.maxRoutes,
      json: options.json || false,
      snapshot: options.snapshot,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    }) as import('../dep/types').DepShowOptions;
    // depShowCommand expects a functionRef parameter first
    await depShowCommand(undefined)(showOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Dependency details completed');
    }
  } catch (error) {
    throw new Error(`Show dependency details failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute dependency statistics (dep stats integration)
 */
async function executeStats(env: CommandEnvironment, options: DependenciesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📊 Analyzing dependency statistics...');
  }

  try {
    // Import and execute dep stats functionality
    const { depStatsCommand } = await import('../dep/stats');
    const statsOptions = filterUndefined({
      sort: (options.sort as 'fanin' | 'fanout' | 'depth' | 'name') || 'fanin',
      limit: options.limit,
      showHubs: options.showHubs || false,
      showUtility: options.showUtility || false,
      showIsolated: options.showIsolated || false,
      hubThreshold: options.hubThreshold,
      utilityThreshold: options.utilityThreshold,
      maxHubFunctions: options.maxHubFunctions,
      maxUtilityFunctions: options.maxUtilityFunctions,
      json: options.json || false,
      format: options.format,
      snapshot: options.snapshot,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    }) as import('../dep/types').DepStatsOptions;
    await depStatsCommand(statsOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Dependency statistics completed');
    }
  } catch (error) {
    throw new Error(`Dependency statistics failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute dependency linting (dep lint integration)
 */
async function executeLint(env: CommandEnvironment, options: DependenciesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔧 Linting dependency architecture...');
  }

  try {
    // Import and execute dep lint functionality
    const { depLintCommand } = await import('../dep/lint');
    const lintOptions = filterUndefined({
      config: options.config,
      format: (options.format as 'table' | 'json') || 'table',
      severity: options.severity,
      maxViolations: options.maxViolations,
      includeMetrics: options.includeMetrics || false,
      failOn: options.failOn,
      snapshot: options.snapshot,
      showLayers: options.showLayers || false,
      showRules: options.showRules || false,
      showConfig: options.showConfig || false,
      showConsolidation: options.showConsolidation || false,
      dryRun: options.dryRun || false,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    }) as import('../dep/types').DepLintOptions;
    await depLintCommand(lintOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Dependency linting completed');
    }
  } catch (error) {
    throw new Error(`Dependency linting failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute dead code detection (dep dead integration)
 */
async function executeDead(env: CommandEnvironment, options: DependenciesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('💀 Detecting dead code...');
  }

  try {
    // Import and execute dep dead functionality
    const { depDeadCommand } = await import('../dep/dead');
    const deadOptions = filterUndefined({
      excludeTests: options.excludeTests || false,
      excludeExports: options.excludeExports || false,
      excludeSmall: options.excludeSmall || false,
      threshold: options.threshold,
      format: options.format,
      showReasons: options.showReasons || false,
      verbose: options.verbose || false,
      snapshot: options.snapshot,
      layerEntryPoints: options.layerEntryPoints,
      quiet: options.quiet || false
    }) as import('../dep/types').DepDeadOptions;
    await depDeadCommand(deadOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Dead code detection completed');
    }
  } catch (error) {
    throw new Error(`Dead code detection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute cycle detection (dep cycles integration)
 */
async function executeCycles(env: CommandEnvironment, options: DependenciesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔄 Detecting circular dependencies...');
  }

  try {
    // Import and execute dep cycles functionality
    const { depCyclesCommand } = await import('../dep/cycles');
    const cyclesOptions = filterUndefined({
      minSize: options.minSize,
      maxLength: options.maxLength,
      includeExternal: options.includeExternal || false,
      format: options.format,
      sort: (options.sort as 'length' | 'complexity' | 'importance') || 'length',
      limit: options.limit,
      snapshot: options.snapshot,
      includeRecursive: options.includeRecursive || false,
      includeClear: options.includeClear || false,
      includeAll: options.includeAll || false,
      excludeRecursive: options.excludeRecursive || false,
      excludeClear: options.excludeClear || false,
      minComplexity: options.minComplexity,
      crossModuleOnly: options.crossModuleOnly || false,
      crossLayerOnly: options.crossLayerOnly || false,
      recursiveOnly: options.recursiveOnly || false,
      sortByImportance: options.sortByImportance || false,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    }) as import('../dep/types').DepCyclesOptions;
    await depCyclesCommand(cyclesOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Cycle detection completed');
    }
  } catch (error) {
    throw new Error(`Cycle detection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute dependency overview (default action)
 */
async function executeOverview(env: CommandEnvironment, options: DependenciesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📊 Analyzing dependency overview...');
  }

  const overview = {
    title: 'Dependency Analysis Overview',
    availableActions: [
      'list      - List function dependencies with filtering',
      'show      - Show detailed dependency information for functions',  
      'stats     - Show dependency statistics and hub analysis',
      'lint      - Lint architecture dependencies against rules',
      'dead      - Detect unreachable (dead) code functions',
      'cycles    - Detect circular dependencies in call graph'
    ],
    examples: [
      'funcqc dependencies --action list --caller "MyClass"',
      'funcqc dependencies --action show --direction both --depth 3',
      'funcqc dependencies --action stats --show-hubs',
      'funcqc dependencies --action lint --severity error',
      'funcqc dependencies --action dead --exclude-tests',
      'funcqc dependencies --action cycles --min-size 2'
    ]
  };

  if (options.json) {
    console.log(JSON.stringify(overview, null, 2));
  } else {
    console.log(`\n🔗 ${overview.title}\n`);
    console.log('📋 Available Actions:');
    overview.availableActions.forEach(action => {
      console.log(`   • ${action}`);
    });
    
    console.log('\n💡 Usage Examples:');
    overview.examples.forEach(example => {
      console.log(`   ${example}`);
    });
    
    console.log('\n🎯 Quick Start:');
    console.log('   • --action stats          # Get dependency overview');
    console.log('   • --action lint           # Check architectural rules');
    console.log('   • --action cycles         # Find circular dependencies');
    console.log('   • --action dead           # Find unused functions');
  }
  
  if (!options.quiet) {
    env.commandLogger.info('✅ Dependency overview completed');
  }
}