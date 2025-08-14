import { Command } from 'commander';
import { TypeListOptions, TypeHealthOptions, TypeDepsOptions, TypeApiOptions, TypeMembersOptions, TypeCoverageOptions, TypeClusterOptions, TypeRiskOptions, TypeInsightsOptions, TypeSlicesOptions, TypeSubsumeOptions, TypeFingerprintOptions, TypeConvertersOptions, TypeCochangeOptions, isUuidOrPrefix, escapeLike } from './types.types';
import type { CochangeAnalysisReport } from '../../types';

// Types for insights command
interface AnalysisResults {
  coverage?: unknown;
  api?: unknown;
  clustering?: unknown;
  risk?: unknown;
}

interface InsightsReport {
  typeName: string;
  typeId: string;
  timestamp: string;
  analyses: AnalysisResults;
}
import { TypeDefinition, TypeRelationship } from '../../types';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import type { PropertySliceReport, PropertySlice } from '../../analyzers/type-insights/property-slice-miner';

/**
 * Database-driven types command
 * Uses stored type information from scan phase instead of real-time analysis
 */
export function createTypesCommand(): Command {
  const typesCmd = new Command('types')
    .description('🧩 TypeScript type analysis (database-driven)')
    .addHelpText('before', '💾 Uses pre-analyzed type data from database');

  // List types command
  typesCmd
    .command('list')
    .description('📋 List TypeScript types from database')
    .option('--kind <kind>', 'Filter by type kind (interface|class|type_alias|enum|namespace)')
    .option('--exported', 'Show only exported types')
    .option('--generic', 'Show only generic types')
    .option('--file <path>', 'Filter by file path')
    .option('--name <pattern>', 'Filter by type name (contains)')
    // Property filters
    .option('--prop-eq <n>', 'Filter types with exactly N properties', parseInt)
    .option('--prop-ge <n>', 'Filter types with >= N properties', parseInt)
    .option('--prop-le <n>', 'Filter types with <= N properties', parseInt)
    .option('--prop-gt <n>', 'Filter types with > N properties', parseInt)
    .option('--prop-lt <n>', 'Filter types with < N properties', parseInt)
    // Method filters
    .option('--meth-eq <n>', 'Filter types with exactly N methods', parseInt)
    .option('--meth-ge <n>', 'Filter types with >= N methods', parseInt)
    .option('--meth-le <n>', 'Filter types with <= N methods', parseInt)
    .option('--meth-gt <n>', 'Filter types with > N methods', parseInt)
    .option('--meth-lt <n>', 'Filter types with < N methods', parseInt)
    // Legacy function filters (methods + constructors for backward compatibility)
    .option('--fn-eq <n>', 'Filter types with exactly N functions (methods+constructors)', parseInt)
    .option('--fn-ge <n>', 'Filter types with >= N functions (methods+constructors)', parseInt)
    .option('--fn-le <n>', 'Filter types with <= N functions (methods+constructors)', parseInt)
    .option('--fn-gt <n>', 'Filter types with > N functions (methods+constructors)', parseInt)
    .option('--fn-lt <n>', 'Filter types with < N functions (methods+constructors)', parseInt)
    // Total member filters
    .option('--total-eq <n>', 'Filter types with exactly N total members', parseInt)
    .option('--total-ge <n>', 'Filter types with >= N total members', parseInt)
    .option('--total-le <n>', 'Filter types with <= N total members', parseInt)
    .option('--total-gt <n>', 'Filter types with > N total members', parseInt)
    .option('--total-lt <n>', 'Filter types with < N total members', parseInt)
    // Special filters
    .option('--has-index', 'Show only types with index signatures')
    .option('--has-call', 'Show only types with call signatures')
    // Output options
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--sort <field>', 'Sort by field (name|kind|file|functions|props|methods|ctors|total)', 'name')
    .option('--desc', 'Sort in descending order')
    .option('--json', 'Output in JSON format')
    .option('--detail', 'Show detailed information in multi-line format')
    .option('--show-location', 'Show FILE and LINE columns')
    .option('--show-id', 'Show ID column for unique identification')
    .action(async (options: TypeListOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      return withEnvironment(executeTypesListDB)(options, command);
    });

  // Type health command
  typesCmd
    .command('health')
    .description('🏥 Analyze type quality from database')
    .option('--verbose', 'Show detailed health information')
    .option('--json', 'Output in JSON format')
    .action(async (options: TypeHealthOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      return withEnvironment(executeTypesHealthDB)(options, command);
    });

  // Type dependencies command
  typesCmd
    .command('deps <typeName>')
    .description('🔗 Analyze type dependencies from database')
    .option('--depth <number>', 'Maximum dependency depth to analyze', parseInt, 3)
    .option('--circular', 'Show only circular dependencies')
    .option('--json', 'Output in JSON format')
    .action(async (typeName: string, options: TypeDepsOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      // Pass typeName via options for VoidCommand compatibility
      const optionsWithTypeName = { ...options, typeName };
      return withEnvironment(executeTypesDepsDB)(optionsWithTypeName, command);
    });

  // Type API analysis command
  typesCmd
    .command('api <typeName>')
    .description('📊 Analyze type API design and surface area')
    .option('--json', 'Output in JSON format')
    .option('--detail', 'Show detailed analysis')
    .option('--optimize', 'Include optimization recommendations')
    .action(async (typeName: string, options: TypeApiOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      const optionsWithTypeName = { ...options, typeName };
      return withEnvironment(executeTypesApiDB)(optionsWithTypeName, command);
    });

  // Type members command
  typesCmd
    .command('members <typeName>')
    .description('👥 Show detailed type member information')
    .option('--json', 'Output in JSON format')
    .option('--detail', 'Show detailed member information')
    .option('--kind <kind>', 'Filter by member kind (property|method|getter|setter|constructor|index_signature|call_signature)')
    .option('--access-modifier <modifier>', 'Filter by access modifier (public|protected|private)')
    .action(async (typeName: string, options: TypeMembersOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      const optionsWithTypeName = { ...options, typeName };
      return withEnvironment(executeTypesMembersDB)(optionsWithTypeName, command);
    });

  // Type coverage analysis command
  typesCmd
    .command('coverage <typeName>')
    .description('📊 Analyze property usage coverage and patterns')
    .option('--json', 'Output in JSON format')
    .option('--hot-threshold <number>', 'Minimum calls for hot properties', parseInt, 5)
    .option('--write-hub-threshold <number>', 'Minimum writers for write hubs', parseInt, 3)
    .option('--include-private', 'Include private properties in analysis')
    .action(async (typeName: string, options: TypeCoverageOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      const optionsWithTypeName = { ...options, typeName };
      return withEnvironment(executeTypesCoverageDB)(optionsWithTypeName, command);
    });

  // Type clustering analysis command
  typesCmd
    .command('cluster <typeName>')
    .description('🎪 Analyze property clustering and co-occurrence patterns')
    .option('--json', 'Output in JSON format')
    .option('--similarity-threshold <number>', 'Minimum similarity for clustering', parseFloat, 0.7)
    .option('--min-cluster-size <number>', 'Minimum properties per cluster', parseInt, 2)
    .action(async (typeName: string, options: TypeClusterOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      const optionsWithTypeName = { ...options, typeName };
      return withEnvironment(executeTypesClusterDB)(optionsWithTypeName, command);
    });

  // Type dependency risk analysis command
  typesCmd
    .command('risk <typeName>')
    .description('⚠️ Analyze dependency risk and change impact')
    .option('--json', 'Output in JSON format')
    .action(async (typeName: string, options: TypeRiskOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      const optionsWithTypeName = { ...options, typeName };
      return withEnvironment(executeTypesRiskDB)(optionsWithTypeName, command);
    });

  // Comprehensive type insights command
  typesCmd
    .command('insights <typeName>')
    .description('🔍 Comprehensive type analysis combining all insights')
    .option('--json', 'Output in JSON format')
    .option('--no-coverage', 'Skip coverage analysis')
    .option('--no-api', 'Skip API optimization analysis')
    .option('--no-cluster', 'Skip property clustering analysis')
    .option('--no-risk', 'Skip dependency risk analysis')
    .action(async (typeName: string, options: TypeInsightsOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      const optionsWithTypeName = { 
        ...options, 
        typeName,
        includeCoverage: true,
        includeApi: true,
        includeCluster: true,
        includeRisk: true
      };
      return withEnvironment(executeTypesInsightsDB)(optionsWithTypeName, command);
    });

  // Property slices analysis command
  typesCmd
    .command('slices')
    .description('🍰 Discover reusable property patterns across types')
    .option('--json', 'Output in JSON format')
    .option('--min-support <number>', 'Minimum types containing slice', parseInt, 3)
    .option('--min-slice-size <number>', 'Minimum properties per slice', parseInt, 2)
    .option('--max-slice-size <number>', 'Maximum properties per slice', parseInt, 5)
    .option('--consider-methods', 'Include methods in pattern analysis')
    .option('--no-exclude-common', 'Include common properties (id, name, etc.)')
    .option('--benefit <level>', 'Filter by extraction benefit (high|medium|low)')
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--sort <field>', 'Sort by field (support|size|impact|benefit)', 'impact')
    .option('--desc', 'Sort in descending order')
    .action(async (options: TypeSlicesOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      return withEnvironment(executeTypesSlicesDB)(options, command);
    });

  // Subsumption analysis command
  typesCmd
    .command('subsume')
    .description('🎯 Analyze structural subsumption and containment relationships')
    .option('--json', 'Output in JSON format')
    .option('--min-overlap <number>', 'Minimum overlap ratio (0-1)', parseFloat, 0.7)
    .option('--no-include-partial', 'Exclude partial overlap relationships')
    .option('--show-redundant', 'Show only redundant (equivalent) types')
    .option('--consider-methods', 'Include method names in analysis')
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--sort <field>', 'Sort by field (overlap|impact|types)', 'impact')
    .option('--desc', 'Sort in descending order')
    .action(async (options: TypeSubsumeOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      return withEnvironment(executeTypesSubsumeDB)(options, command);
    });

  // Behavioral fingerprint analysis command
  typesCmd
    .command('fingerprint')
    .description('🔍 Analyze behavioral fingerprints and function clustering')
    .option('--json', 'Output in JSON format')
    .option('--no-include-calls-out', 'Exclude outgoing function calls')
    .option('--no-include-calls-in', 'Exclude incoming function calls')
    .option('--min-call-frequency <number>', 'Minimum call frequency', parseInt, 2)
    .option('--similarity-threshold <number>', 'Clustering similarity threshold (0-1)', parseFloat, 0.7)
    .option('--max-fingerprint-size <number>', 'Maximum behavioral vector size', parseInt, 50)
    .option('--include-internal-calls', 'Include internal method calls')
    .option('--limit <number>', 'Limit number of clusters', parseInt)
    .option('--sort <field>', 'Sort by field (similarity|impact|size)', 'impact')
    .option('--desc', 'Sort in descending order')
    .action(async (options: TypeFingerprintOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      return withEnvironment(executeTypesFingerprintDB)(options, command);
    });

  // Type conversion network analysis command
  typesCmd
    .command('converters')
    .description('🔄 Analyze type conversion networks and canonical types')
    .option('--json', 'Output in JSON format')
    .option('--min-converters <number>', 'Minimum converters to form a network', parseInt, 2)
    .option('--no-include-internal-calls', 'Exclude internal function calls')
    .option('--no-include-parsers', 'Exclude parse functions as converters')
    .option('--show-chains', 'Show conversion chains')
    .option('--canonical-only', 'Show only canonical types')
    .option('--max-chain-length <number>', 'Maximum conversion chain length', parseInt, 4)
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--sort <field>', 'Sort by field (centrality|converters|usage)', 'centrality')
    .option('--desc', 'Sort in descending order')
    .action(async (options: TypeConvertersOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      return withEnvironment(executeTypesConvertersDB)(options, command);
    });

  // Type co-change analysis command
  typesCmd
    .command('cochange')
    .description('📈 Analyze type co-evolution patterns from Git history')
    .option('--json', 'Output in JSON format')
    .option('--months-back <number>', 'How far back to analyze in months', parseInt, 6)
    .option('--min-changes <number>', 'Minimum changes to consider a type', parseInt, 2)
    .option('--cochange-threshold <number>', 'Threshold for co-change significance (0-1)', parseFloat, 0.3)
    .option('--show-matrix', 'Show co-change matrix')
    .option('--no-suggest-modules', 'Disable module reorganization suggestions')
    .option('--max-commits <number>', 'Maximum commits to analyze', parseInt, 1000)
    .option('--exclude-paths <paths>', 'Comma-separated paths to exclude from analysis', '')
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--sort <field>', 'Sort by field (coupling|changes|volatility)', 'coupling')
    .option('--desc', 'Sort in descending order')
    .action(async (options: TypeCochangeOptions, command) => {
      const { withEnvironment } = await import('../cli-wrapper');
      return withEnvironment(executeTypesCochangeDB)(options, command);
    });

  return typesCmd;
}

/**
 * Execute types list command using database
 */
const executeTypesListDB: VoidCommand<TypeListOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      // Silently load types first - only show messages if initialization needed
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      let types = await env.storage.getTypeDefinitions(latestSnapshot.id);
    
    // If no types found, trigger lazy type system analysis
    if (types.length === 0) {
      const isJsonMode = options.json;
      
      if (!isJsonMode) {
        console.log(`🔍 Type system analysis needed for ${latestSnapshot.id.substring(0, 8)}...`);
      }
      
      // Create a minimal command environment for type analysis
      const { createAppEnvironment, destroyAppEnvironment } = await import('../../core/environment');
      const appEnv = await createAppEnvironment({
        quiet: Boolean(isJsonMode),
        verbose: false,
      });
      
      try {
        const commandEnv = env;
        
        // Ensure basic analysis is done first
        const metadata = latestSnapshot.metadata as Record<string, unknown>;
        const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
        
        if (analysisLevel === 'NONE') {
          const { performDeferredBasicAnalysis } = await import('./scan');
          await performDeferredBasicAnalysis(latestSnapshot.id, commandEnv, !isJsonMode);
        }
        
        // Perform type system analysis
        const { performDeferredTypeSystemAnalysis } = await import('./scan');
        const result = await performDeferredTypeSystemAnalysis(latestSnapshot.id, commandEnv, !isJsonMode);
        
        if (!isJsonMode) {
          console.log(`✓ Type system analysis completed (${result.typesAnalyzed} types)`);
        }
        
        // Reload types after analysis (wait for transaction commit)
        if (process.env['DEBUG'] === 'true') {
          env.commandLogger.debug('Waiting for transaction commit...');
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms for commit
        
        // Debug: Check if tables exist at all
        if (process.env['DEBUG'] === 'true') {
          env.commandLogger.debug('Debugging database state...');
          try {
            const tableCheck = await env.storage.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'type_definitions'");
            env.commandLogger.debug(`type_definitions table exists: ${tableCheck.rows.length > 0}`);
            
            if (tableCheck.rows.length > 0) {
              const countCheck = await env.storage.query("SELECT COUNT(*) as count FROM type_definitions");
              env.commandLogger.debug(`Total rows in type_definitions: ${JSON.stringify(countCheck.rows[0])}`);
              
              const snapshotCheck = await env.storage.query("SELECT COUNT(*) as count FROM type_definitions WHERE snapshot_id = $1", [latestSnapshot.id]);
              env.commandLogger.debug(`Rows for snapshot ${latestSnapshot.id}: ${JSON.stringify(snapshotCheck.rows[0])}`);
            } else {
              env.commandLogger.debug('type_definitions table does not exist in database!');
            }
          } catch (error) {
            env.commandLogger.debug(`Debug query failed: ${error}`);
          }
        }
        
        if (process.env['DEBUG'] === 'true') {
          env.commandLogger.debug(`Reloading types from snapshot ${latestSnapshot.id}`);
        }
        types = await env.storage.getTypeDefinitions(latestSnapshot.id);
        if (process.env['DEBUG'] === 'true') {
          env.commandLogger.debug(`Found ${types.length} types after analysis`);
        }
      } finally {
        await destroyAppEnvironment(appEnv);
      }
    }
    
    if (types.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log('No types found in the codebase.');
      }
      return;
    }
    
    // Get comprehensive member counts for types
    const memberCounts = await getMemberCountsForTypes(env.storage, types, latestSnapshot.id);
    
    // Apply filters (pass member counts for filtering)
    types = await applyTypeFilters(types, options, memberCounts);
    
    // Sort types (pass member counts for sorting)
    types = sortTypesDB(types, options.sort || 'name', options.desc, memberCounts);
    
    // Apply limit
    if (options.limit && options.limit > 0) {
      types = types.slice(0, options.limit);
    }
    
    // Coupling analysis (temporarily disabled due to performance issues)
    const couplingData: Map<string, CouplingInfo> = new Map();
    // TODO: Optimize analyzeCouplingForTypes query performance
    // if (types.length > 0) {
    //   couplingData = await analyzeCouplingForTypes(env.storage, types, latestSnapshot.id);
    // }
    
    // Output results
    if (options.json) {
      const output = types.map(type => {
        const memberCount = memberCounts.get(type.id);
        const functionCount = memberCount ? memberCount.methods + memberCount.constructors : 0;
        return {
          ...type,
          functionCount, // Legacy field for backward compatibility
          memberCounts: memberCount,
          ...(couplingData.has(type.id) && { coupling: couplingData.get(type.id) })
        };
      });
      console.log(JSON.stringify(output, null, 2));
    } else {
      displayTypesListDB(types, couplingData, memberCounts, options.detail, options.showLocation, options.showId);
    }

  } catch (error) {
    // Check if it's already a FuncqcError
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      errorHandler.handleError(error as FuncqcError);
    } else {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to list types: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  }
};

/**
 * Execute types health command using database
 */
const executeTypesHealthDB: VoidCommand<TypeHealthOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      env.commandLogger.info('🏥 Analyzing type health from database...');
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      const types = await env.storage.getTypeDefinitions(latestSnapshot.id);
    
    if (types.length === 0) {
      console.log('No types found. Run scan first to analyze types.');
      return;
    }
    
    // Calculate health metrics
    const healthReport = calculateTypeHealthFromDB(types);
    
    if (options.json) {
      console.log(JSON.stringify(healthReport, null, 2));
    } else {
      displayTypeHealthDB(healthReport, options.verbose);
    }
  } catch (error) {
    // Check if it's already a FuncqcError
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      errorHandler.handleError(error as FuncqcError);
    } else {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to analyze type health: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  }
};

/**
 * Execute types deps command using database
 */
const executeTypesDepsDB: VoidCommand<TypeDepsOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      // Get typeName from options (passed from action)
      const typeName = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`🔗 Analyzing dependencies for type: ${typeName}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      const targetType = await env.storage.findTypeByName(typeName, latestSnapshot.id);
    
    if (!targetType) {
      const funcqcError = errorHandler.createError(
        ErrorCode.NOT_FOUND,
        `Type '${typeName}' not found`,
        { typeName }
      );
      throw funcqcError;
    }
    
    const relationships = await env.storage.getTypeRelationships(latestSnapshot.id);
    const depth = 
      typeof options.depth === 'number' && Number.isFinite(options.depth) 
        ? options.depth 
        : 3;
    const dependencies = analyzeDependenciesFromDB(
      targetType,
      relationships,
      depth
    );
    
    if (options.circular) {
      const circularDeps = findCircularDependencies(dependencies);
      if (options.json) {
        console.log(JSON.stringify(circularDeps, null, 2));
      } else {
        displayCircularDependenciesDB(circularDeps);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify(dependencies, null, 2));
      } else {
        displayDependenciesDB(typeName, dependencies);
      }
    }
  } catch (error) {
    // Check if it's already a FuncqcError
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      errorHandler.handleError(error as FuncqcError);
    } else {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to analyze type dependencies: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  }
};

/**
 * Execute types api command using database
 */
const executeTypesApiDB: VoidCommand<TypeApiOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`📊 Analyzing API design for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Get type member counts for analysis
      const memberCounts = await getMemberCountsForTypes(env.storage, [targetType], latestSnapshot.id);
      const memberCount = memberCounts.get(targetType.id);
      
      if (!memberCount) {
        console.log(`⚠️  No member information available for type ${targetType.name}`);
        return;
      }
      
      // Analyze API surface area
      const apiAnalysis = analyzeTypeApiSurface(targetType, memberCount);
      
      // Optional optimization analysis
      let optimizationAnalysis = null;
      if (options.optimize) {
        const { ApiOptimizer } = await import('../../analyzers/type-insights/api-optimizer');
        const optimizer = new ApiOptimizer(env.storage);
        optimizationAnalysis = await optimizer.analyzeApiOptimization(targetType.id, latestSnapshot.id);
      }
      
      if (options.json) {
        const result = {
          apiAnalysis,
          optimizationAnalysis: optimizationAnalysis ?? null
        };
        console.log(JSON.stringify(result, null, 2));
      } else {
        displayTypeApiAnalysis(targetType.name, apiAnalysis, options.detail);
        
        if (optimizationAnalysis) {
          const { ApiOptimizer } = await import('../../analyzers/type-insights/api-optimizer');
          const optimizer = new ApiOptimizer(env.storage);
          console.log(optimizer.formatOptimizationAnalysis(optimizationAnalysis));
        }
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze type API: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute types members command using database
 */
const executeTypesMembersDB: VoidCommand<TypeMembersOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`👥 Analyzing members for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Get detailed member information
      const members = await getTypeMembersDetailed(env.storage, targetType.id, latestSnapshot.id, options);
      
      if (members.length === 0) {
        console.log(`⚠️  No members found for type ${targetType.name}`);
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(members, null, 2));
      } else {
        displayTypeMembersAnalysis(targetType.name, members, options.detail);
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze type members: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute types coverage command using database
 */
const executeTypesCoverageDB: VoidCommand<TypeCoverageOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`📊 Analyzing property coverage for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Import and use the coverage analyzer
      const { CoverageAnalyzer } = await import('../../analyzers/type-insights/coverage-analyzer');
      const analyzer = new CoverageAnalyzer(env.storage);
      
      const analysis = await analyzer.analyzeTypeCoverage(
        targetType.id,
        latestSnapshot.id,
        {
          hotThreshold: options.hotThreshold ?? 5,
          writeHubThreshold: options.writeHubThreshold ?? 3,
          includePrivateProperties: options.includePrivate ?? false
        }
      );
      
      if (!analysis) {
        console.log(`⚠️  No coverage analysis available for type ${targetType.name}`);
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(analysis, null, 2));
      } else {
        console.log(analyzer.formatCoverageAnalysis(analysis));
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze type coverage: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute types cluster command using database
 */
const executeTypesClusterDB: VoidCommand<TypeClusterOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`🎪 Analyzing property clustering for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Import and use the clustering analyzer
      const { PropertyClusteringAnalyzer } = await import('../../analyzers/type-insights/property-clustering');
      const analyzer = new PropertyClusteringAnalyzer(env.storage);
      
      // Set options if provided
      if (options.similarityThreshold !== undefined) {
        analyzer.setSimilarityThreshold(options.similarityThreshold);
      }
      if (options.minClusterSize !== undefined) {
        analyzer.setMinClusterSize(options.minClusterSize);
      }
      
      const analysis = await analyzer.analyzePropertyClustering(
        targetType.id,
        latestSnapshot.id
      );
      
      if (!analysis) {
        console.log(`⚠️  No clustering analysis available for type ${targetType.name}`);
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(analysis, (_key, value) => {
          // Convert Set objects to arrays for JSON serialization
          if (value instanceof Set) {
            return Array.from(value);
          }
          return value;
        }, 2));
      } else {
        console.log(analyzer.formatClusteringAnalysis(analysis));
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze property clustering: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute types risk command using database
 */
const executeTypesRiskDB: VoidCommand<TypeRiskOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`⚠️ Analyzing dependency risk for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Import and use the risk analyzer
      const { DependencyRiskAnalyzer } = await import('../../analyzers/type-insights/dependency-risk');
      const analyzer = new DependencyRiskAnalyzer(env.storage);
      
      const analysis = await analyzer.analyzeDependencyRisk(
        targetType.id,
        latestSnapshot.id
      );
      
      if (!analysis) {
        console.log(`⚠️  No risk analysis available for type ${targetType.name}`);
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(analysis, null, 2));
      } else {
        console.log(analyzer.formatDependencyRiskAnalysis(analysis));
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze dependency risk: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute types insights command - comprehensive analysis combining all insights
 */
const executeTypesInsightsDB: VoidCommand<TypeInsightsOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`🔍 Running comprehensive analysis for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Prepare results container
      const insights: InsightsReport = {
        typeName: targetType.name,
        typeId: targetType.id,
        timestamp: new Date().toISOString(),
        analyses: {}
      };
      
      // Run coverage analysis
      if (options.includeCoverage !== false) {
        try {
          const { CoverageAnalyzer } = await import('../../analyzers/type-insights/coverage-analyzer');
          const coverageAnalyzer = new CoverageAnalyzer(env.storage);
          const coverageAnalysis = await coverageAnalyzer.analyzeTypeCoverage(
            targetType.id,
            latestSnapshot.id
          );
          insights.analyses.coverage = coverageAnalysis;
        } catch (error) {
          env.commandLogger.warn(`Coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          insights.analyses.coverage = { error: 'Analysis failed' };
        }
      }
      
      // Run API optimization analysis
      if (options.includeApi !== false) {
        try {
          const { ApiOptimizer } = await import('../../analyzers/type-insights/api-optimizer');
          const apiOptimizer = new ApiOptimizer(env.storage);
          const apiAnalysis = await apiOptimizer.analyzeApiOptimization(
            targetType.id,
            latestSnapshot.id
          );
          insights.analyses.api = apiAnalysis;
        } catch (error) {
          env.commandLogger.warn(`API analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          insights.analyses.api = { error: 'Analysis failed' };
        }
      }
      
      // Run clustering analysis
      if (options.includeCluster !== false) {
        try {
          const { PropertyClusteringAnalyzer } = await import('../../analyzers/type-insights/property-clustering');
          const clusterAnalyzer = new PropertyClusteringAnalyzer(env.storage);
          const clusterAnalysis = await clusterAnalyzer.analyzePropertyClustering(
            targetType.id,
            latestSnapshot.id
          );
          insights.analyses.clustering = clusterAnalysis;
        } catch (error) {
          env.commandLogger.warn(`Clustering analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          insights.analyses.clustering = { error: 'Analysis failed' };
        }
      }
      
      // Run dependency risk analysis
      if (options.includeRisk !== false) {
        try {
          const { DependencyRiskAnalyzer } = await import('../../analyzers/type-insights/dependency-risk');
          const riskAnalyzer = new DependencyRiskAnalyzer(env.storage);
          const riskAnalysis = await riskAnalyzer.analyzeDependencyRisk(
            targetType.id,
            latestSnapshot.id
          );
          insights.analyses.risk = riskAnalysis;
        } catch (error) {
          env.commandLogger.warn(`Risk analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          insights.analyses.risk = { error: 'Analysis failed' };
        }
      }
      
      if (options.json) {
        // Custom JSON serialization to handle Set objects
        console.log(JSON.stringify(insights, (_key, value) => {
          if (value instanceof Set) {
            return Array.from(value);
          }
          return value;
        }, 2));
      } else {
        // Format comprehensive report
        console.log(formatIntegratedInsightsReport(insights));
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to run comprehensive analysis: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

// Helper types and functions

/**
 * Find type by ID or ID prefix
 */
async function findTypeById(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  idOrPrefix: string,
  snapshotId: string
): Promise<TypeDefinition | null> {
  // Support partial ID matching (e.g., first 8 characters)
  // Escape wildcards to prevent unintended pattern matching
  const escapedPrefix = escapeLike(idOrPrefix);
  const result = await storage.query(
    `SELECT * FROM type_definitions 
     WHERE snapshot_id = $1 AND id LIKE $2 || '%' ESCAPE '\\'
     ORDER BY id ASC
     LIMIT 1`,
    [snapshotId, escapedPrefix]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0] as {
    id: string;
    snapshot_id: string;
    name: string;
    kind: string;
    file_path: string;
    start_line: number;
    end_line: number;
    start_column: number;
    end_column: number;
    is_abstract: boolean;
    is_exported: boolean;
    is_default_export: boolean;
    is_generic: boolean;
    generic_parameters: unknown;
    type_text: string | null;
    resolved_type: string | null;
    modifiers: string[];
    jsdoc: string | null;
    metadata: unknown;
  };
  
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    name: row.name,
    kind: row.kind as 'class' | 'interface' | 'type_alias' | 'enum' | 'namespace',
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    startColumn: row.start_column,
    endColumn: row.end_column,
    isAbstract: row.is_abstract,
    isExported: row.is_exported,
    isDefaultExport: row.is_default_export,
    isGeneric: row.is_generic,
    genericParameters: row.generic_parameters as Array<{ name: string; constraint: string | null; default: string | null }>,
    typeText: row.type_text,
    resolvedType: row.resolved_type as Record<string, unknown> | null,
    modifiers: row.modifiers,
    jsdoc: row.jsdoc,
    metadata: row.metadata as Record<string, unknown>
  };
}

interface CouplingInfo {
  parameterUsage: {
    functionId: string;
    parameterName: string;
    usedProperties: string[];
    totalProperties: number;
    usageRatio: number;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
  }[];
  totalFunctions: number;
  averageUsageRatio: number;
}

interface TypeHealthReport {
  totalTypes: number;
  typeDistribution: Record<string, number>;
  complexityStats: {
    averageMembers: number;
    maxMembers: number;
    typesWithManyMembers: number;
  };
  couplingStats: {
    highCouplingTypes: number;
    averageUsageRatio: number;
  };
  overallHealth: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
}


/**
 * Member count data for each type
 */
interface MemberCounts {
  properties: number;
  methods: number;
  constructors: number;
  indexSignatures: number;
  callSignatures: number;
  total: number;
}

/**
 * Get comprehensive member counts for types using type_members table
 */
async function getMemberCountsForTypes(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  _types: TypeDefinition[],
  snapshotId: string
): Promise<Map<string, MemberCounts>> {
  const memberCounts = new Map<string, MemberCounts>();
  
  try {
    // Query type_members table to count all member types
    // Note: getter/setter are aggregated with properties (same name = 1 property)
    const result = await storage.query(`
      SELECT 
        tm.type_id,
        -- Properties: count distinct names to aggregate getter/setter
        COUNT(DISTINCT tm.name) FILTER (WHERE tm.member_kind IN ('property', 'getter', 'setter')) as props,
        -- Methods: count actual methods
        COUNT(*) FILTER (WHERE tm.member_kind = 'method') as methods,
        -- Constructors
        COUNT(*) FILTER (WHERE tm.member_kind = 'constructor') as ctors,
        -- Index signatures
        COUNT(*) FILTER (WHERE tm.member_kind = 'index_signature') as index_sigs,
        -- Call signatures  
        COUNT(*) FILTER (WHERE tm.member_kind = 'call_signature') as call_sigs
      FROM type_members tm
      WHERE tm.snapshot_id = $1
      GROUP BY tm.type_id
    `, [snapshotId]);
    
    if (result.rows.length === 0) {
      // No type member data available - this is normal for snapshots without type system analysis
      // The enhanced display will show '-' for zero values which is the expected behavior
    }
    
    result.rows.forEach((row: unknown) => {
      const typedRow = row as { 
        type_id: string; 
        props: string;
        methods: string;
        ctors: string;
        index_sigs: string;
        call_sigs: string;
      };
      
      const props = parseInt(typedRow.props, 10) || 0;
      const methods = parseInt(typedRow.methods, 10) || 0;
      const ctors = parseInt(typedRow.ctors, 10) || 0;
      const indexSigs = parseInt(typedRow.index_sigs, 10) || 0;
      const callSigs = parseInt(typedRow.call_sigs, 10) || 0;
      
      memberCounts.set(typedRow.type_id, {
        properties: props,
        methods,
        constructors: ctors,
        indexSignatures: indexSigs,
        callSignatures: callSigs,
        total: props + methods + ctors + indexSigs + callSigs
      });
    });
  } catch (error) {
    console.warn(`Warning: Failed to get member counts: ${error}`);
  }
  
  return memberCounts;
}

/**
 * Apply filters to types
 */
async function applyTypeFilters(
  types: TypeDefinition[],
  options: TypeListOptions,
  memberCounts: Map<string, MemberCounts>
): Promise<TypeDefinition[]> {
  let filteredTypes = types;
  
  // Basic filters
  if (options.kind) {
    const validKinds = ['interface', 'class', 'type_alias', 'enum', 'namespace'] as const;
    if (!validKinds.includes(options.kind as typeof validKinds[number])) {
      throw new Error(`Invalid kind: ${options.kind}. Valid options are: ${validKinds.join(', ')}`);
    }
    filteredTypes = filteredTypes.filter(t => t.kind === options.kind);
  }
  
  if (options.exported) {
    filteredTypes = filteredTypes.filter(t => t.isExported);
  }
  
  if (options.generic) {
    filteredTypes = filteredTypes.filter(t => t.isGeneric);
  }
  
  if (options.file) {
    const filePath = options.file;
    filteredTypes = filteredTypes.filter(t => t.filePath.includes(filePath));
  }
  
  if (options.name) {
    const pattern = options.name.toLowerCase();
    filteredTypes = filteredTypes.filter(t => t.name.toLowerCase().includes(pattern));
  }
  
  // Helper function to parse and validate count value
  const parseCountValue = (value: string | undefined, fieldName: string): number => {
    if (value === undefined) return NaN;
    const target = Number(value);
    if (!Number.isFinite(target) || !Number.isInteger(target) || target < 0) {
      throw new Error(`Invalid count value for ${fieldName}: ${value}. Must be a non-negative integer.`);
    }
    return target;
  };

  // Properties filters
  const propEq = parseCountValue(options.propEq, '--prop-eq');
  if (!isNaN(propEq)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) === propEq);
  }
  const propGe = parseCountValue(options.propGe, '--prop-ge');
  if (!isNaN(propGe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) >= propGe);
  }
  const propLe = parseCountValue(options.propLe, '--prop-le');
  if (!isNaN(propLe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) <= propLe);
  }
  const propGt = parseCountValue(options.propGt, '--prop-gt');
  if (!isNaN(propGt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) > propGt);
  }
  const propLt = parseCountValue(options.propLt, '--prop-lt');
  if (!isNaN(propLt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) < propLt);
  }

  // Methods filters
  const methEq = parseCountValue(options.methEq, '--meth-eq');
  if (!isNaN(methEq)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) === methEq);
  }
  const methGe = parseCountValue(options.methGe, '--meth-ge');
  if (!isNaN(methGe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) >= methGe);
  }
  const methLe = parseCountValue(options.methLe, '--meth-le');
  if (!isNaN(methLe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) <= methLe);
  }
  const methGt = parseCountValue(options.methGt, '--meth-gt');
  if (!isNaN(methGt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) > methGt);
  }
  const methLt = parseCountValue(options.methLt, '--meth-lt');
  if (!isNaN(methLt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) < methLt);
  }

  // Total member filters
  const totalEq = parseCountValue(options.totalEq, '--total-eq');
  if (!isNaN(totalEq)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) === totalEq);
  }
  const totalGe = parseCountValue(options.totalGe, '--total-ge');
  if (!isNaN(totalGe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) >= totalGe);
  }
  const totalLe = parseCountValue(options.totalLe, '--total-le');
  if (!isNaN(totalLe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) <= totalLe);
  }
  const totalGt = parseCountValue(options.totalGt, '--total-gt');
  if (!isNaN(totalGt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) > totalGt);
  }
  const totalLt = parseCountValue(options.totalLt, '--total-lt');
  if (!isNaN(totalLt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) < totalLt);
  }

  // Legacy function count filters (methods + constructors for backward compatibility)
  const fnEq = parseCountValue(options.fnEq, '--fn-eq');
  if (!isNaN(fnEq)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount === fnEq;
    });
  }
  const fnGe = parseCountValue(options.fnGe, '--fn-ge');
  if (!isNaN(fnGe)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount >= fnGe;
    });
  }
  const fnLe = parseCountValue(options.fnLe, '--fn-le');
  if (!isNaN(fnLe)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount <= fnLe;
    });
  }
  const fnGt = parseCountValue(options.fnGt, '--fn-gt');
  if (!isNaN(fnGt)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount > fnGt;
    });
  }
  const fnLt = parseCountValue(options.fnLt, '--fn-lt');
  if (!isNaN(fnLt)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount < fnLt;
    });
  }

  // Special filters
  if (options.hasIndex) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.indexSignatures || 0) > 0);
  }
  if (options.hasCall) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.callSignatures || 0) > 0);
  }
  
  return filteredTypes;
}

/**
 * Sort types by field
 */
function sortTypesDB(
  types: TypeDefinition[], 
  sortField: string, 
  desc?: boolean, 
  memberCounts?: Map<string, MemberCounts>
): TypeDefinition[] {
  const validSortOptions = ['name', 'kind', 'file', 'functions', 'props', 'methods', 'ctors', 'total', 'members'] as const;
  if (!validSortOptions.includes(sortField as typeof validSortOptions[number])) {
    throw new Error(`Invalid sort option: ${sortField}. Valid options are: ${validSortOptions.join(', ')}`);
  }
  
  const sorted = [...types].sort((a, b) => {
    let result: number;
    
    switch (sortField) {
      case 'name':
        result = a.name.localeCompare(b.name);
        break;
      case 'kind': {
        // Sort by kind priority: class > interface > type_alias > enum > namespace
        const kindPriority = { class: 5, interface: 4, type_alias: 3, enum: 2, namespace: 1 };
        const aPriority = kindPriority[a.kind as keyof typeof kindPriority] || 0;
        const bPriority = kindPriority[b.kind as keyof typeof kindPriority] || 0;
        result = aPriority - bPriority;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'file': {
        result = a.filePath.localeCompare(b.filePath);
        if (result === 0) {
          result = a.startLine - b.startLine; // Secondary sort by line
        }
        break;
      }
      case 'props': {
        const aCount = memberCounts?.get(a.id)?.properties || 0;
        const bCount = memberCounts?.get(b.id)?.properties || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'methods': {
        const aCount = memberCounts?.get(a.id)?.methods || 0;
        const bCount = memberCounts?.get(b.id)?.methods || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'ctors': {
        const aCount = memberCounts?.get(a.id)?.constructors || 0;
        const bCount = memberCounts?.get(b.id)?.constructors || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'total': {
        const aCount = memberCounts?.get(a.id)?.total || 0;
        const bCount = memberCounts?.get(b.id)?.total || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'functions': {
        // Legacy: methods + constructors for backward compatibility
        const aMethodsCount = memberCounts?.get(a.id)?.methods || 0;
        const aCtorsCount = memberCounts?.get(a.id)?.constructors || 0;
        const aCount = aMethodsCount + aCtorsCount;
        
        const bMethodsCount = memberCounts?.get(b.id)?.methods || 0;
        const bCtorsCount = memberCounts?.get(b.id)?.constructors || 0;
        const bCount = bMethodsCount + bCtorsCount;
        
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'members': {
        // Alias for total
        const aCount = memberCounts?.get(a.id)?.total || 0;
        const bCount = memberCounts?.get(b.id)?.total || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      default:
        result = a.name.localeCompare(b.name);
    }
    
    return desc ? -result : result;
  });
  
  return sorted;
}

/*
 * Analyze coupling for types using parameter property usage data
 * (Temporarily disabled due to performance issues)
 */
/*
async function analyzeCouplingForTypes(
  storage: any,
  types: TypeDefinition[],
  snapshotId: string
): Promise<Map<string, CouplingInfo>> {
  const couplingMap = new Map<string, CouplingInfo>();
  
  // Early return if no types provided
  if (types.length === 0) {
    return couplingMap;
  }
  
  try {
    // Build dynamic placeholders: $2..$N
    const typeIds = types.map(t => t.id);
    const placeholders = typeIds.map((_, i) => `$${i + 2}`).join(', ');

    const sql = `
      WITH member_counts AS (
        SELECT
          tm.type_id            AS parameter_type_id,
          COUNT(*)              AS total_properties
        FROM type_members tm
        WHERE tm.snapshot_id = $1
          AND tm.member_kind IN ('property','field')
        GROUP BY tm.type_id
      )
      SELECT
        ppu.parameter_type_id,
        ppu.function_id,
        ppu.parameter_name,
        ppu.accessed_property,
        ppu.access_type,
        COUNT(*)              AS access_count,
        COALESCE(mc.total_properties, 0) AS total_properties
      FROM parameter_property_usage ppu
      LEFT JOIN member_counts mc
        ON mc.parameter_type_id = ppu.parameter_type_id
      WHERE ppu.snapshot_id = $1
        AND ppu.parameter_type_id IN (${placeholders})
      GROUP BY
        ppu.parameter_type_id,
        ppu.function_id,
        ppu.parameter_name,
        ppu.accessed_property,
        ppu.access_type,
        mc.total_properties
      ORDER BY
        ppu.function_id,
        ppu.parameter_name
    `;

    const res = await storage.query(sql, [snapshotId, ...typeIds]);
    const byType = new Map<string, Array<Record<string, unknown>>>();

    for (const row of res.rows as Array<Record<string, unknown>>) {
      const key = String(row['parameter_type_id']);
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(row);
    }

    for (const type of types) {
      const rows = byType.get(type.id) ?? [];
      const parameterUsage = processCouplingQueryResults(rows);
      const totalFunctions = new Set(rows.map(r => r['function_id'])).size;
      const averageUsageRatio = parameterUsage.length > 0
        ? parameterUsage.reduce((sum, p) => sum + p.usageRatio, 0) / parameterUsage.length
        : 0;

      couplingMap.set(type.id, {
        parameterUsage,
        totalFunctions,
        averageUsageRatio
      });
    }

  } catch (error) {
    console.warn(`Warning: Failed to analyze coupling: ${error}`);
    // Fallback for all types on error
    for (const type of types) {
      couplingMap.set(type.id, {
        parameterUsage: [],
        totalFunctions: 0,
        averageUsageRatio: 0
      });
    }
  }
  
  return couplingMap;
}
*/


/*
 * Process coupling query results into structured format
 */
/*
function processCouplingQueryResults(
  rows: Array<Record<string, unknown>>
): CouplingInfo['parameterUsage'] {
  // key: `${function_id}:${parameter_name}` -> set of properties
  const paramProps = new Map<string, Set<string>>();
  // key: `${function_id}:${parameter_name}` -> totalProperties (from SQL row)
  const paramTotals = new Map<string, number>();

  // Group by function and parameter
  for (const row of rows) {
    const key = `${row['function_id']}:${row['parameter_name']}`;
    if (!paramProps.has(key)) paramProps.set(key, new Set());
    paramProps.get(key)!.add(String(row['accessed_property']));
    // keep max total per (func,param) if present
    const total = Number(row['total_properties'] ?? 0);
    if (!Number.isNaN(total)) {
      const prev = paramTotals.get(key) ?? 0;
      paramTotals.set(key, Math.max(prev, total));
    }
  }

  const result: CouplingInfo['parameterUsage'] = [];
  for (const [key, properties] of paramProps) {
    const [functionId, parameterName] = key.split(':');
    const usedProperties = Array.from(properties);
    const totalProperties = Math.max(1, paramTotals.get(key) ?? 1); // avoid div/0
    const usageRatio = usedProperties.length / totalProperties;
      
      let severity: 'LOW' | 'MEDIUM' | 'HIGH';
      if (usageRatio <= 0.25) severity = 'HIGH';
      else if (usageRatio <= 0.5) severity = 'MEDIUM';
      else severity = 'LOW';
      
    result.push({
      functionId,
      parameterName,
      usedProperties,
      totalProperties,
      usageRatio,
      severity
    });
  }
  
  return result;
}
*/

/**
 * Calculate type health from database
 */
function calculateTypeHealthFromDB(
  types: TypeDefinition[]
): TypeHealthReport {
  const totalTypes = types.length;
  
  // Type distribution
  const typeDistribution: Record<string, number> = {};
  for (const type of types) {
    typeDistribution[type.kind] = (typeDistribution[type.kind] || 0) + 1;
  }
  
  // Complexity stats (simplified)
  const complexityStats = {
    averageMembers: 0, // Would need to query type_members
    maxMembers: 0,
    typesWithManyMembers: 0
  };
  
  // Coupling stats (simplified)
  const couplingStats = {
    highCouplingTypes: 0,
    averageUsageRatio: 0
  };
  
  // Overall health assessment
  let overallHealth: TypeHealthReport['overallHealth'] = 'GOOD';
  if (totalTypes < 10) overallHealth = 'POOR';
  else if (totalTypes < 50) overallHealth = 'FAIR';
  else if (totalTypes > 200) overallHealth = 'EXCELLENT';
  
  return {
    totalTypes,
    typeDistribution,
    complexityStats,
    couplingStats,
    overallHealth
  };
}

/**
 * Analyze dependencies from database relationships
 */
function analyzeDependenciesFromDB(
  targetType: TypeDefinition,
  relationships: TypeRelationship[],
  maxDepth: number
): Array<{ source: string; target: string | undefined; relationship: string; depth: number }> {
  const dependencies: Array<{ source: string; target: string | undefined; relationship: string; depth: number }> = [];
  const visited = new Set<string>();
  
  function traverse(typeId: string, depth: number) {
    if (depth > maxDepth || visited.has(typeId)) return;
    visited.add(typeId);
    
    const relatedRelationships = relationships.filter(r => r.sourceTypeId === typeId);
    for (const rel of relatedRelationships) {
      dependencies.push({
        source: typeId,
        target: rel.targetTypeId || undefined,
        relationship: rel.relationshipKind,
        depth
      });
      
      if (rel.targetTypeId) {
        traverse(rel.targetTypeId, depth + 1);
      }
    }
  }
  
  traverse(targetType.id, 1);
  return dependencies;
}

/**
 * Find circular dependencies
 */
function findCircularDependencies(dependencies: Array<{ source: string; target: string | undefined; relationship: string; depth: number }>): Array<{ cycle: string[]; length: number }> {
  // Simplified circular dependency detection
  const graph = new Map<string, Set<string>>();
  
  // Build graph
  for (const dep of dependencies) {
    if (!graph.has(dep.source)) {
      graph.set(dep.source, new Set());
    }
    if (dep.target) {
      graph.get(dep.source)!.add(dep.target);
    }
  }
  
  // Find cycles (simplified DFS)
  const cycles: Array<{ cycle: string[]; length: number }> = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  
  function hasCycle(node: string, path: string[]): boolean {
    if (recursionStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push({
        cycle: path.slice(cycleStart).concat(node),
        length: path.length - cycleStart + 1
      });
      return true;
    }
    
    if (visited.has(node)) return false;
    
    visited.add(node);
    recursionStack.add(node);
    path.push(node);
    
    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (hasCycle(neighbor, [...path])) {
        return true;
      }
    }
    
    recursionStack.delete(node);
    return false;
  }
  
  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      hasCycle(node, []);
    }
  }
  
  return cycles;
}

/**
 * Display functions
 */
function displayTypesListDB(
  types: TypeDefinition[],
  couplingData: Map<string, CouplingInfo>,
  memberCounts: Map<string, MemberCounts>,
  detailed?: boolean,
  showLocation?: boolean,
  showId?: boolean
): void {
  console.log(`\n📋 Found ${types.length} types:\n`);
  
  if (!detailed && types.length > 0) {
    // Table header for non-detailed output - emoji-free layout
    if (showId && showLocation) {
      console.log(`ID       KIND EXP NAME                         PROPS METHS CTORS IDX CALL TOTAL FILE                     LINE`);
      console.log(`-------- ---- --- ----------------------------- ----- ----- ----- --- ---- ----- ----------------------- ----`);
    } else if (showId) {
      console.log(`ID       KIND EXP NAME                         PROPS METHS CTORS IDX CALL TOTAL`);
      console.log(`-------- ---- --- ----------------------------- ----- ----- ----- --- ---- -----`);
    } else if (showLocation) {
      console.log(`KIND EXP NAME                         PROPS METHS CTORS IDX CALL TOTAL FILE                     LINE`);
      console.log(`---- --- ----------------------------- ----- ----- ----- --- ---- ----- ----------------------- ----`);
    } else {
      console.log(`KIND EXP NAME                         PROPS METHS CTORS IDX CALL TOTAL`);
      console.log(`---- --- ----------------------------- ----- ----- ----- --- ---- -----`);
    }
  }
  
  for (const type of types) {
    if (detailed) {
      // Detailed view with emojis (single-type display)
      const kindIcon = getTypeKindIcon(type.kind);
      const exportIcon = type.isExported ? 'EXP' : '   ';
      const genericIcon = type.isGeneric ? '<T>' : '   ';
      
      console.log(`${kindIcon} ${exportIcon} ${type.name} ${genericIcon}`);
      console.log(`   📁 ${type.filePath}:${type.startLine}`);
      console.log(`   🏷️  ${type.kind}`);
      
      const memberCount = memberCounts.get(type.id) || {
        properties: 0,
        methods: 0,
        constructors: 0,
        indexSignatures: 0,
        callSignatures: 0,
        total: 0
      };
      const functionCount = memberCount.methods + memberCount.constructors;
      console.log(`   🔢 Functions: ${functionCount} (${memberCount.methods} methods, ${memberCount.constructors} ctors)`);
      console.log(`   🔢 Members: ${memberCount.properties} props, ${memberCount.total} total`);
      
      if (couplingData.has(type.id)) {
        const coupling = couplingData.get(type.id)!;
        console.log(`   🔗 Coupling: ${coupling.totalFunctions} functions, avg usage: ${(coupling.averageUsageRatio * 100).toFixed(1)}%`);
      }
      
      console.log();
    } else {
      // Tabular view without emojis - consistent character width
      const memberCount = memberCounts.get(type.id) || {
        properties: 0,
        methods: 0,
        constructors: 0,
        indexSignatures: 0,
        callSignatures: 0,
        total: 0
      };
      
      // Use text abbreviations instead of emojis for consistent alignment
      const kindText = getTypeKindText(type.kind);
      const exportText = type.isExported ? 'EXP' : '   ';
      const nameDisplay = type.name.length > 29 ? type.name.substring(0, 26) + '...' : type.name;
      const idDisplay = type.id.substring(0, 8); // Show first 8 chars of ID
      
      // Display counts, using '-' for zero values
      const propsDisplay = memberCount.properties > 0 ? memberCount.properties.toString() : '-';
      const methsDisplay = memberCount.methods > 0 ? memberCount.methods.toString() : '-';
      const ctorsDisplay = memberCount.constructors > 0 ? memberCount.constructors.toString() : '-';
      const idxDisplay = memberCount.indexSignatures > 0 ? memberCount.indexSignatures.toString() : '-';
      const callDisplay = memberCount.callSignatures > 0 ? memberCount.callSignatures.toString() : '-';
      const totalDisplay = memberCount.total > 0 ? memberCount.total.toString() : '-';
      
      if (showId && showLocation) {
        const fileName = type.filePath.split('/').pop() || type.filePath;
        const fileDisplay = fileName.length > 23 ? fileName.substring(0, 20) + '...' : fileName;
        const lineDisplay = type.startLine.toString();
        
        console.log(
          `${idDisplay} ` +
          `${kindText.padEnd(4)} ` +
          `${exportText} ` +
          `${nameDisplay.padEnd(29)} ` +
          `${propsDisplay.padStart(5)} ` +
          `${methsDisplay.padStart(5)} ` +
          `${ctorsDisplay.padStart(5)} ` +
          `${idxDisplay.padStart(3)} ` +
          `${callDisplay.padStart(4)} ` +
          `${totalDisplay.padStart(5)} ` +
          `${fileDisplay.padEnd(23)} ` +
          `${lineDisplay.padStart(4)}`
        );
      } else if (showId) {
        console.log(
          `${idDisplay} ` +
          `${kindText.padEnd(4)} ` +
          `${exportText} ` +
          `${nameDisplay.padEnd(29)} ` +
          `${propsDisplay.padStart(5)} ` +
          `${methsDisplay.padStart(5)} ` +
          `${ctorsDisplay.padStart(5)} ` +
          `${idxDisplay.padStart(3)} ` +
          `${callDisplay.padStart(4)} ` +
          `${totalDisplay.padStart(5)}`
        );
      } else if (showLocation) {
        const fileName = type.filePath.split('/').pop() || type.filePath;
        const fileDisplay = fileName.length > 23 ? fileName.substring(0, 20) + '...' : fileName;
        const lineDisplay = type.startLine.toString();
        
        console.log(
          `${kindText.padEnd(4)} ` +
          `${exportText} ` +
          `${nameDisplay.padEnd(29)} ` +
          `${propsDisplay.padStart(5)} ` +
          `${methsDisplay.padStart(5)} ` +
          `${ctorsDisplay.padStart(5)} ` +
          `${idxDisplay.padStart(3)} ` +
          `${callDisplay.padStart(4)} ` +
          `${totalDisplay.padStart(5)} ` +
          `${fileDisplay.padEnd(23)} ` +
          `${lineDisplay.padStart(4)}`
        );
      } else {
        console.log(
          `${kindText.padEnd(4)} ` +
          `${exportText} ` +
          `${nameDisplay.padEnd(29)} ` +
          `${propsDisplay.padStart(5)} ` +
          `${methsDisplay.padStart(5)} ` +
          `${ctorsDisplay.padStart(5)} ` +
          `${idxDisplay.padStart(3)} ` +
          `${callDisplay.padStart(4)} ` +
          `${totalDisplay.padStart(5)}`
        );
      }
    }
  }
  
  if (!detailed && types.length === 0) {
    console.log('No types found matching the criteria.');
  }
}

function displayTypeHealthDB(report: TypeHealthReport, verbose?: boolean): void {
  console.log(`\n🏥 Type Health Report:\n`);
  console.log(`Overall Health: ${getHealthIcon(report.overallHealth)} ${report.overallHealth}`);
  console.log(`Total Types: ${report.totalTypes}`);
  
  console.log(`\nType Distribution:`);
  for (const [kind, count] of Object.entries(report.typeDistribution)) {
    const percentage = ((count / report.totalTypes) * 100).toFixed(1);
    console.log(`  ${getTypeKindIcon(kind)} ${kind}: ${count} (${percentage}%)`);
  }
  
  if (verbose) {
    console.log(`\nComplexity Statistics:`);
    console.log(`  Average Members: ${report.complexityStats.averageMembers}`);
    console.log(`  Max Members: ${report.complexityStats.maxMembers}`);
    console.log(`  Complex Types: ${report.complexityStats.typesWithManyMembers}`);
    
    console.log(`\nCoupling Statistics:`);
    console.log(`  High Coupling Types: ${report.couplingStats.highCouplingTypes}`);
    console.log(`  Average Usage Ratio: ${(report.couplingStats.averageUsageRatio * 100).toFixed(1)}%`);
  }
}

function displayCircularDependenciesDB(cycles: Array<{ cycle: string[]; length: number }>): void {
  console.log(`\n🔄 Found ${cycles.length} circular dependencies:\n`);
  
  for (const cycle of cycles) {
    console.log(`Cycle (length ${cycle.length}): ${cycle.cycle.join(' → ')}`);
  }
}

function displayDependenciesDB(typeName: string, dependencies: Array<{ source: string; target: string | undefined; relationship: string; depth: number }>): void {
  console.log(`\n🔗 Dependencies for type '${typeName}':\n`);
  
  const depsByDepth = dependencies.reduce((acc, dep) => {
    if (!acc[dep.depth]) acc[dep.depth] = [];
    acc[dep.depth].push(dep);
    return acc;
  }, {} as Record<number, Array<{ source: string; target: string | undefined; relationship: string; depth: number }>>);
  
  for (const [depth, deps] of Object.entries(depsByDepth)) {
    console.log(`Depth ${depth}:`);
    for (const dep of deps) {
      const indent = '  '.repeat(parseInt(depth) + 1);
      console.log(`${indent}${dep.relationship} → ${dep.target}`);
    }
  }
}

function getTypeKindIcon(kind: string): string {
  switch (kind) {
    case 'interface': return '🔗';
    case 'class': return '🏗️';
    case 'type_alias': return '🏷️';
    case 'enum': return '🔢';
    case 'namespace': return '📦';
    default: return '❓';
  }
}

function getTypeKindText(kind: string): string {
  switch (kind) {
    case 'interface': return 'INTF';
    case 'class': return 'CLSS';
    case 'type_alias': return 'TYPE';
    case 'enum': return 'ENUM';
    case 'namespace': return 'NSPC';
    default: return 'UNKN';
  }
}

function getHealthIcon(health: string): string {
  switch (health) {
    case 'EXCELLENT': return '🌟';
    case 'GOOD': return '✅';
    case 'FAIR': return '⚠️';
    case 'POOR': return '❌';
    default: return '❓';
  }
}

// New analysis functions for enhanced type commands

interface TypeApiAnalysis {
  surfaceArea: {
    methods: number;
    properties: number;
    constructors: number;
    indexSignatures: number;
    callSignatures: number;
    total: number;
  };
  complexity: {
    overloadDensity: number;
    apiComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  };
  recommendations: string[];
}

interface TypeMemberDetail {
  id: string;
  name: string;
  memberKind: string;
  typeText: string | null;
  isOptional: boolean;
  isReadonly: boolean;
  isStatic: boolean;
  isAbstract: boolean;
  accessModifier: string | null;
  startLine: number;
  endLine: number;
  functionId: string | null;
  jsdoc: string | null;
}

/**
 * Analyze type API surface area and complexity
 */
function analyzeTypeApiSurface(_type: TypeDefinition, memberCount: MemberCounts): TypeApiAnalysis {
  const surfaceArea = {
    methods: memberCount.methods,
    properties: memberCount.properties,
    constructors: memberCount.constructors,
    indexSignatures: memberCount.indexSignatures,
    callSignatures: memberCount.callSignatures,
    total: memberCount.total
  };
  
  // 将来の実装用にプレースホルダーを残す
  const overloadDensity = 0.0; // TODO: 実際のオーバーロード分析を実装
  
  // Determine API complexity based on surface area
  let apiComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' = 'LOW';
  // 業界標準のインターフェース分離原則に基づく閾値
  if (memberCount.total > 40) {  // 非常に大規模なインターフェース
    apiComplexity = 'VERY_HIGH';
  } else if (memberCount.total > 20) {  // 大規模なインターフェース
    apiComplexity = 'HIGH';
  } else if (memberCount.total > 10) {  // 中規模なインターフェース
    apiComplexity = 'MEDIUM';
  }
  
  // Generate recommendations based on analysis
  const recommendations: string[] = [];
  
  if (memberCount.total > 30) {
    recommendations.push('Consider splitting large interface into smaller, focused interfaces');
  }
  
  if (memberCount.methods > 20) {
    recommendations.push('High method count - consider grouping related methods');
  }
  
  if (memberCount.properties > 15) {
    recommendations.push('Many properties - consider using composition or value objects');
  }
  
  if (memberCount.constructors > 3) {
    recommendations.push('Multiple constructors - consider factory methods or builder pattern');
  }
  
  if (memberCount.indexSignatures > 0 && memberCount.callSignatures > 0) {
    recommendations.push('Mixed signatures - consider separate interfaces for different uses');
  }
  
  return {
    surfaceArea,
    complexity: {
      overloadDensity,
      apiComplexity
    },
    recommendations
  };
}

/**
 * Get detailed type member information with filtering
 */
async function getTypeMembersDetailed(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  typeId: string,
  snapshotId: string,
  options: TypeMembersOptions
): Promise<TypeMemberDetail[]> {
  let whereClause = 'WHERE tm.type_id = $1 AND tm.snapshot_id = $2';
  const params: unknown[] = [typeId, snapshotId];
  
  if (options.kind) {
    whereClause += ` AND tm.member_kind = $${params.length + 1}`;
    params.push(options.kind);
  }
  
  if (options.accessModifier) {
    whereClause += ` AND tm.access_modifier = $${params.length + 1}`;
    params.push(options.accessModifier);
  }
  
  const result = await storage.query(`
    SELECT 
      tm.id,
      tm.name,
      tm.member_kind,
      tm.type_text,
      tm.is_optional,
      tm.is_readonly,
      tm.is_static,
      tm.is_abstract,
      tm.access_modifier,
      tm.start_line,
      tm.end_line,
      tm.function_id,
      tm.jsdoc
    FROM type_members tm
    ${whereClause}
    ORDER BY tm.member_kind, tm.name
  `, params);
  
  return result.rows.map((row: unknown) => {
    const typedRow = row as {
      id: string;
      name: string;
      member_kind: string;
      type_text: string | null;
      is_optional: boolean;
      is_readonly: boolean;
      is_static: boolean;
      is_abstract: boolean;
      access_modifier: string | null;
      start_line: number;
      end_line: number;
      function_id: string | null;
      jsdoc: string | null;
    };
    
    return {
      id: typedRow.id,
      name: typedRow.name,
      memberKind: typedRow.member_kind,
      typeText: typedRow.type_text,
      isOptional: typedRow.is_optional,
      isReadonly: typedRow.is_readonly,
      isStatic: typedRow.is_static,
      isAbstract: typedRow.is_abstract,
      accessModifier: typedRow.access_modifier,
      startLine: typedRow.start_line,
      endLine: typedRow.end_line,
      functionId: typedRow.function_id,
      jsdoc: typedRow.jsdoc
    };
  });
}

/**
 * Display type API analysis results
 */
function displayTypeApiAnalysis(typeName: string, analysis: TypeApiAnalysis, detailed?: boolean): void {
  console.log(`\n📊 API Analysis for type '${typeName}'\n`);
  
  // Surface area summary
  console.log('🎯 API Surface Area:');
  console.log(`  Methods:      ${analysis.surfaceArea.methods}`);
  console.log(`  Properties:   ${analysis.surfaceArea.properties}`);
  console.log(`  Constructors: ${analysis.surfaceArea.constructors}`);
  console.log(`  Index Sigs:   ${analysis.surfaceArea.indexSignatures}`);
  console.log(`  Call Sigs:    ${analysis.surfaceArea.callSignatures}`);
  console.log(`  Total:        ${analysis.surfaceArea.total}`);
  
  // Complexity assessment
  console.log(`\n📈 Complexity: ${analysis.complexity.apiComplexity}`);
  if (detailed) {
    console.log(`  Overload Density: ${analysis.complexity.overloadDensity.toFixed(2)}`);
  }
  
  // Recommendations
  if (analysis.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    analysis.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });
  }
}

/**
 * Display type members analysis results
 */
function displayTypeMembersAnalysis(typeName: string, members: TypeMemberDetail[], detailed?: boolean): void {
  console.log(`\n👥 Members for type '${typeName}' (${members.length} members)\n`);
  
  // Group by member kind for better organization
  const membersByKind = members.reduce((acc, member) => {
    if (!acc[member.memberKind]) acc[member.memberKind] = [];
    acc[member.memberKind].push(member);
    return acc;
  }, {} as Record<string, TypeMemberDetail[]>);
  
  // Display by kind
  const kindOrder = ['constructor', 'property', 'getter', 'setter', 'method', 'index_signature', 'call_signature'];
  
  for (const kind of kindOrder) {
    const kindMembers = membersByKind[kind];
    if (!kindMembers || kindMembers.length === 0) continue;
    
    const kindIcon = getMemberKindIcon(kind);
    console.log(`${kindIcon} ${kind.toUpperCase()}S (${kindMembers.length}):`);
    
    // Ensure kindMembers is an array
    const membersArray = Array.isArray(kindMembers) ? kindMembers : [kindMembers];
    
    for (const member of membersArray) {
      const accessIcon = getAccessModifierIcon(member.accessModifier);
      const flags = [];
      if (member.isStatic) flags.push('static');
      if (member.isReadonly) flags.push('readonly');
      if (member.isOptional) flags.push('optional');
      if (member.isAbstract) flags.push('abstract');
      
      const flagsStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
      const typeStr = member.typeText ? `: ${member.typeText}` : '';
      
      console.log(`  ${accessIcon} ${member.name}${typeStr}${flagsStr}`);
      
      if (detailed && member.jsdoc) {
        const jsdocLines = member.jsdoc.split('\n').map(line => `    ${line.trim()}`).join('\n');
        console.log(`    📝 ${jsdocLines}`);
      }
    }
    console.log();
  }
}

function getMemberKindIcon(kind: string): string {
  switch (kind) {
    case 'property': return '🏷️';
    case 'method': return '⚡';
    case 'constructor': return '🏗️';
    case 'getter': return '📤';
    case 'setter': return '📥';
    case 'index_signature': return '🔍';
    case 'call_signature': return '📞';
    default: return '❓';
  }
}

function getAccessModifierIcon(modifier: string | null): string {
  switch (modifier) {
    case 'public': return '🌐';
    case 'protected': return '🛡️';
    case 'private': return '🔒';
    default: return '📋';
  }
}

/**
 * Format integrated insights report combining all analyses
 */
function formatIntegratedInsightsReport(insights: InsightsReport): string {
  const lines: string[] = [];
  const { typeName, analyses } = insights;
  
  lines.push(`\n🔍 Comprehensive Type Analysis for '${typeName}'\n`);
  lines.push('=' .repeat(60));
  lines.push('');
  
  // Coverage Summary
  if (analyses['coverage'] && !(analyses['coverage'] as { error?: unknown }).error) {
    const coverage = analyses['coverage'] as { 
      hotProperties?: Array<{ property: string; totalCalls: number }>; 
      coldProperties?: Array<{ property: string; totalCalls?: number }>; 
      writeHubs?: Array<{ property: string; writerCount: number }>;
    };
    lines.push('📊 Usage Coverage:');
    if (coverage.hotProperties?.length) {
      const hot = coverage.hotProperties.slice(0, 3).map(p => `${p.property}(${p.totalCalls}c)`).join(', ');
      lines.push(`  Hot: ${hot}`);
    }
    if (coverage.coldProperties?.length) {
      const cold = coverage.coldProperties.slice(0, 3).map(p => `${p.property}(${p.totalCalls || 0})`).join(', ');
      lines.push(`  Cold: ${cold}`);
    }
    if (coverage.writeHubs?.length) {
      const hubs = coverage.writeHubs.slice(0, 2).map(h => `${h.property}(${h.writerCount}w)`).join(', ');
      lines.push(`  Write Hubs: ${hubs}`);
    }
    lines.push('');
  }
  
  // Clustering Summary
  const clustering = analyses['clustering'] as { 
    error?: unknown; 
    clusters?: Array<{ suggestedName: string; properties: string[]; similarity: number }>;
  };
  if (clustering && !clustering.error && clustering.clusters?.length) {
    lines.push('🎪 Property Clusters:');
    for (const cluster of clustering.clusters.slice(0, 3)) {
      const similarity = Math.round(cluster.similarity * 100);
      lines.push(`  ${cluster.suggestedName}: (${cluster.properties.join(',')}) ${similarity}% similarity`);
    }
    lines.push('');
  }
  
  // API Optimization Summary
  const api = analyses['api'] as {
    error?: unknown;
    unusedOverloads?: Array<{ methodName: string }>;
    readonlyCandidates?: Array<{ propertyName: string }>;
    unusedSetters?: Array<{ propertyName: string }>;
  };
  if (api && !api.error) {
    lines.push('🎯 API Optimization:');
    if (api.unusedOverloads?.length) {
      const unused = api.unusedOverloads.slice(0, 2).map(o => `${o.methodName}()`).join(', ');
      lines.push(`  Unused overloads: ${unused}`);
    }
    if (api.readonlyCandidates?.length) {
      const readonly = api.readonlyCandidates.slice(0, 2).map(r => r.propertyName).join(', ');
      lines.push(`  Readonly candidates: ${readonly}`);
    }
    if (api.unusedSetters?.length) {
      const setters = api.unusedSetters.slice(0, 2).map(s => s.propertyName).join(', ');
      lines.push(`  Unused setters: ${setters}`);
    }
    lines.push('');
  }
  
  // Risk Summary
  const risk = analyses['risk'] as {
    error?: unknown;
    riskFactors?: { overallRisk?: string };
    dependencyInfo?: { fanIn: number; fanOut: number };
    churn?: { changeVelocity: string; changes30d: number };
    impactRadius?: number;
  };
  if (risk && !risk.error) {
    const riskIcon = getRiskIcon(risk.riskFactors?.overallRisk || 'UNKNOWN');
    lines.push(`⚠️  Dependency Risk: ${riskIcon} ${risk.riskFactors?.overallRisk || 'UNKNOWN'}`);
    if (risk.dependencyInfo) {
      lines.push(`  Fan-in: ${risk.dependencyInfo.fanIn}, Fan-out: ${risk.dependencyInfo.fanOut}`);
    }
    if (risk.churn) {
      lines.push(`  Change velocity: ${risk.churn.changeVelocity}, ${risk.churn.changes30d}/30d`);
    }
    if (risk.impactRadius) {
      lines.push(`  Impact radius: ~${risk.impactRadius} components`);
    }
    lines.push('');
  }
  
  // Combined Recommendations
  const allRecommendations: string[] = [];
  
  const clusteringRecs = (clustering as { recommendations?: string[] })?.recommendations;
  if (clusteringRecs) {
    allRecommendations.push(...clusteringRecs);
  }
  
  const apiRecs = (api as { recommendations?: string[] })?.recommendations;
  if (apiRecs) {
    allRecommendations.push(...apiRecs);
  }
  
  const coverageRecs = (analyses['coverage'] as { recommendations?: string[] })?.recommendations;
  if (coverageRecs) {
    allRecommendations.push(...coverageRecs);
  }
  
  const riskRecs = (risk as { recommendations?: string[] })?.recommendations;
  if (riskRecs) {
    allRecommendations.push(...riskRecs);
  }
  
  if (allRecommendations.length > 0) {
    lines.push('💡 Combined Action Items:');
    // Deduplicate and prioritize recommendations
    const uniqueRecs = Array.from(new Set(allRecommendations));
    uniqueRecs.slice(0, 5).forEach((rec, index) => {
      lines.push(`  ${index + 1}. ${rec}`);
    });
    lines.push('');
  }
  
  // Analysis completeness
  const completed = Object.values(analyses).filter(a => a && !(a as { error?: unknown }).error).length;
  const total = Object.keys(analyses).length;
  if (completed < total) {
    lines.push(`⚠️  Note: ${total - completed} analyses failed - results may be incomplete`);
    lines.push('');
  }
  
  return lines.join('\n');
}

function getRiskIcon(risk: string): string {
  switch (risk) {
    case 'CRITICAL': return '🚨';
    case 'HIGH': return '⚠️';
    case 'MEDIUM': return '⚡';
    case 'LOW': return '✅';
    default: return '❓';
  }
}

/**
 * Execute types slices command using database
 */
const executeTypesSlicesDB: VoidCommand<TypeSlicesOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🍰 Analyzing property slice patterns across types...');

      // Get latest snapshot (他コマンドと同様の取得方法に統一)
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          'No snapshots found. Run `funcqc scan` first.',
          { command: 'types slices' }
        );
        throw funcqcError;
      }
      const latestSnapshot = snapshots[0];

      // Normalize and validate options
      const allowedBenefits = new Set(['high', 'medium', 'low'] as const);
      const allowedSorts = new Set(['support', 'size', 'impact', 'benefit'] as const);
      const minSupport =
        typeof options.minSupport === 'number' &&
        Number.isFinite(options.minSupport) &&
        Number.isInteger(options.minSupport) &&
        options.minSupport > 0
          ? options.minSupport
          : 3;
      let minSliceSize =
        typeof options.minSliceSize === 'number' &&
        Number.isFinite(options.minSliceSize) &&
        Number.isInteger(options.minSliceSize) &&
        options.minSliceSize > 0
          ? options.minSliceSize
          : 2;
      let maxSliceSize =
        typeof options.maxSliceSize === 'number' &&
        Number.isFinite(options.maxSliceSize) &&
        Number.isInteger(options.maxSliceSize) &&
        options.maxSliceSize > 0
          ? options.maxSliceSize
          : 5;
      if (minSliceSize > maxSliceSize) {
        env.commandLogger.warn(
          `--min-slice-size (${minSliceSize}) > --max-slice-size (${maxSliceSize}). Swapping values.`
        );
        [minSliceSize, maxSliceSize] = [maxSliceSize, minSliceSize];
      }
      const sortField = allowedSorts.has(options.sort ?? 'impact')
        ? (options.sort ?? 'impact')
        : 'impact';
      if (options.sort && sortField !== options.sort) {
        env.commandLogger.warn(`Invalid --sort '${options.sort}'. Falling back to 'impact'.`);
      }
      if (options.benefit && !allowedBenefits.has(options.benefit)) {
        env.commandLogger.warn(`Invalid --benefit '${options.benefit}'. Ignoring filter.`);
      }
      const excludeCommon = options.excludeCommon ?? true;

      // Import and create property slice miner
      const { PropertySliceMiner } = await import(
        '../../analyzers/type-insights/property-slice-miner'
      );
      const sliceMiner = new PropertySliceMiner(env.storage, {
        minSupport,
        minSliceSize,
        maxSliceSize,
        considerMethods: options.considerMethods ?? false,
        excludeCommonProperties: excludeCommon
      });

      // Generate analysis report
      const report = await sliceMiner.generateReport(latestSnapshot.id);

      // Filter by benefit level if specified
      let slices = [
        ...report.highValueSlices,
        ...report.mediumValueSlices,
        ...report.lowValueSlices
      ];
      if (options.benefit && allowedBenefits.has(options.benefit)) {
        slices = slices.filter(slice => slice.extractionBenefit === options.benefit);
      }

      // Sort results
      slices.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'support':
            comparison = a.support - b.support;
            break;
          case 'size':
            comparison = a.properties.length - b.properties.length;
            break;
          case 'impact':
            comparison = a.impactScore - b.impactScore;
            break;
          case 'benefit': {
            const benefitOrder = { high: 3, medium: 2, low: 1 };
            comparison =
              benefitOrder[a.extractionBenefit] - benefitOrder[b.extractionBenefit];
            break;
          }
          default:
            comparison = a.impactScore - b.impactScore;
        }
        return options.desc ? -comparison : comparison;
      });

      // Apply limit
      if (options.limit && options.limit > 0) {
        slices = slices.slice(0, options.limit);
      }

      if (options.json) {
        // JSON output（例外発生時にもJSON形式で返却）
        const jsonReport = {
          summary: {
            totalSlices: report.totalSlices,
            estimatedCodeReduction: report.estimatedCodeReduction,
            slicesShown: slices.length
          },
          slices: slices.map(slice => ({
            id: slice.id,
            properties: slice.properties,
            suggestedVOName: slice.suggestedVOName,
            support: slice.support,
            extractionBenefit: slice.extractionBenefit,
            impactScore: slice.impactScore,
            duplicateCode: slice.duplicateCode,
            relatedMethods: slice.relatedMethods,
            types: slice.types
          })),
          recommendations: report.recommendations
        };
        try {
          console.log(JSON.stringify(jsonReport, null, 2));
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const funcqcError = errorHandler.createError(
            ErrorCode.UNKNOWN_ERROR,
            `Failed to serialize JSON output: ${errMsg}`,
            { command: 'types slices' },
            error instanceof Error ? error : undefined
          );
          throw funcqcError;
        }
      } else {
        // Formatted output
        console.log(formatSlicesReport(report, slices, { minSupport, minSliceSize }));
      }

    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze property slices: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Format property slices analysis report
 */
function formatSlicesReport(report: PropertySliceReport, slices: PropertySlice[], options?: { minSupport?: number; minSliceSize?: number }): string {
  const lines: string[] = [];
  
  lines.push('🍰 Property Slice Analysis');
  lines.push('━'.repeat(50));
  lines.push('');
  
  // Summary
  lines.push(`📊 Summary:`);
  lines.push(`   Total Slices Found: ${report.totalSlices}`);
  lines.push(`   High Value: ${report.highValueSlices.length}`);
  lines.push(`   Medium Value: ${report.mediumValueSlices.length}`);
  lines.push(`   Low Value: ${report.lowValueSlices.length}`);
  lines.push(`   Estimated Code Reduction: ~${report.estimatedCodeReduction} lines`);
  lines.push('');

  if (slices.length === 0) {
    lines.push('❌ No property slices found matching the criteria');
    lines.push('');
    lines.push('💡 Try adjusting parameters:');
    lines.push(`   • Lower --min-support${options ? ` (currently requires ${options.minSupport}+ types)` : ''}`);
    lines.push(`   • Lower --min-slice-size${options ? ` (currently requires ${options.minSliceSize}+ properties)` : ''}`);
    lines.push('   • Include --consider-methods for broader patterns');
    return lines.join('\n');
  }

  // Individual slices
  lines.push(`🎯 Property Slices (showing ${slices.length}):`);
  lines.push('━'.repeat(50));
  
  slices.forEach((slice, index) => {
    const benefit = slice.extractionBenefit;
    const benefitIcon = benefit === 'high' ? '🟢' : benefit === 'medium' ? '🟡' : '🔴';
    
    lines.push(`${index + 1}. ${benefitIcon} ${slice.suggestedVOName}`);
    lines.push(`   Properties: {${slice.properties.join(', ')}}`);
    lines.push(`   Found in: ${slice.support} types`);
    lines.push(`   Benefit: ${benefit.toUpperCase()}`);
    lines.push(`   Impact Score: ${slice.impactScore}`);
    lines.push(`   Est. Duplicate Code: ${slice.duplicateCode} lines`);
    
    if (slice.relatedMethods.length > 0) {
      lines.push(`   Related Methods: {${slice.relatedMethods.join(', ')}}`);
    }
    
    lines.push('');
  });

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('📋 Recommendations:');
    lines.push('━'.repeat(30));
    report.recommendations.forEach((rec: string) => {
      lines.push(`   ${rec}`);
    });
    lines.push('');
  }

  // Next steps
  lines.push('🚀 Next Steps:');
  lines.push('━'.repeat(20));
  lines.push('   1. Review high-value slices for immediate extraction');
  lines.push('   2. Create Value Object interfaces for common patterns');
  lines.push('   3. Refactor types to use extracted Value Objects');
  lines.push('   4. Update type definitions to reduce duplication');

  return lines.join('\n');
}

/**
 * Execute types subsume command using database
 */
const executeTypesSubsumeDB: VoidCommand<TypeSubsumeOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🎯 Analyzing structural subsumption relationships...');

      // Get latest snapshot
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          'No analysis snapshots available. Use `funcqc scan` to analyze your codebase first',
          { command: 'types subsume' } as Record<string, unknown>
        );
        
        env.commandLogger.error(funcqcError.message);
        throw funcqcError;
      }

      const latestSnapshot = snapshots[0];

      // Initialize the structural subsumption analyzer
      const { StructuralSubsumptionAnalyzer } = await import('../../analyzers/type-insights/structural-subsumption-analyzer');
      
      // Configure analyzer options
      const analyzerOptions = {
        minOverlapRatio: typeof options.minOverlap === 'number' && 
                        Number.isFinite(options.minOverlap) && 
                        options.minOverlap >= 0 && 
                        options.minOverlap <= 1 
          ? options.minOverlap 
          : 0.7,
        includePartialMatches: options.includePartial !== false, // Default true
        showRedundantOnly: options.showRedundant === true,       // Default false
        considerMethodNames: options.considerMethods === true,   // Default false
        minSupport: 2,        // Always 2 for pairwise relationships
        minConfidence: 0.5,   // Lower threshold for subsumption
        maxPatternSize: 100,  // Allow large patterns
        includeRarePatterns: true
      };

      const analyzer = new StructuralSubsumptionAnalyzer(env.storage, analyzerOptions);

      // Get detailed subsumption results
      const relationships = await analyzer.getDetailedResults(latestSnapshot.id);

      // Apply sorting and limiting
      const sortedResults = applySortingAndLimiting(relationships, options);

      // Output results
      if (options.json) {
        const jsonOutput = {
          metadata: {
            timestamp: new Date().toISOString(),
            snapshotId: latestSnapshot.id,
            totalRelationships: relationships.length,
            displayedRelationships: sortedResults.length,
            options: analyzerOptions
          },
          relationships: sortedResults.map(rel => ({
            sourceType: {
              id: rel.sourceTypeId,
              name: rel.sourceTypeName
            },
            targetType: {
              id: rel.targetTypeId,
              name: rel.targetTypeName
            },
            relationshipType: rel.relationshipType,
            overlapRatio: rel.overlapRatio,
            commonMembers: rel.commonMembers,
            uniqueToSource: rel.uniqueToSource,
            uniqueToTarget: rel.uniqueToTarget,
            suggestedAction: rel.suggestedAction,
            impactScore: rel.impactScore,
            confidence: rel.confidence
          }))
        };
        console.log(JSON.stringify(jsonOutput, null, 2));
      } else {
        const report = formatSubsumptionReport(sortedResults, analyzerOptions);
        console.log(report);
      }

    } catch (error) {
      // Check if error has FuncqcError properties (interface check)
      if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      }
      
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to analyze structural subsumption: ${error instanceof Error ? error.message : String(error)}`,
        { command: 'types subsume' } as Record<string, unknown>
      );
      
      env.commandLogger.error(funcqcError.message);
      throw funcqcError;
    }
  };

/**
 * Apply sorting and limiting to subsumption results
 */
function applySortingAndLimiting(
  relationships: Array<{
    relationshipType: string;
    sourceTypeId: string;
    sourceTypeName: string;
    targetTypeId: string;
    targetTypeName: string;
    overlapRatio: number;
    commonMembers: string[];
    uniqueToSource: string[];
    uniqueToTarget: string[];
    suggestedAction: string;
    impactScore: number;
    confidence: number;
  }>,
  options: TypeSubsumeOptions
) {
  // Sort results
  const sortField = options.sort || 'impact';
  const descending = options.desc === true;

  const sorted = [...relationships].sort((a, b) => {
    let comparison = 0;
    
    switch (sortField) {
      case 'overlap':
        comparison = a.overlapRatio - b.overlapRatio;
        break;
      case 'impact':
        comparison = a.impactScore - b.impactScore;
        break;
      case 'types':
        comparison = a.sourceTypeName.localeCompare(b.sourceTypeName) ||
                    a.targetTypeName.localeCompare(b.targetTypeName);
        break;
      default:
        comparison = a.impactScore - b.impactScore;
    }
    
    return descending ? -comparison : comparison;
  });

  // Apply limit
  if (typeof options.limit === 'number' && options.limit > 0) {
    return sorted.slice(0, options.limit);
  }
  
  return sorted;
}

/**
 * Format subsumption analysis results as a human-readable report
 */
function formatSubsumptionReport(
  relationships: Array<{
    relationshipType: string;
    sourceTypeName: string;
    targetTypeName: string;
    overlapRatio: number;
    commonMembers: string[];
    uniqueToSource: string[];
    uniqueToTarget: string[];
    suggestedAction: string;
    impactScore: number;
    confidence: number;
  }>,
  options: {
    minOverlapRatio: number;
    showRedundantOnly: boolean;
    considerMethodNames: boolean;
    includePartialMatches: boolean;
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push('🎯 Structural Subsumption Analysis');
  lines.push('═'.repeat(50));
  lines.push('');

  // Configuration summary
  lines.push('⚙️  Analysis Configuration:');
  lines.push(`   • Minimum Overlap Ratio: ${(options.minOverlapRatio * 100).toFixed(1)}%`);
  lines.push(`   • Include Method Names: ${options.considerMethodNames ? 'Yes' : 'No'}`);
  lines.push(`   • Show Partial Matches: ${options.includePartialMatches ? 'Yes' : 'No'}`);
  lines.push(`   • Redundant Only: ${options.showRedundantOnly ? 'Yes' : 'No'}`);
  lines.push('');

  if (relationships.length === 0) {
    lines.push('ℹ️  No subsumption relationships found with current criteria.');
    lines.push('');
    lines.push('💡 Try adjusting parameters:');
    lines.push('   • Lower --min-overlap threshold');
    lines.push('   • Enable --include-partial for more results');
    lines.push('   • Include --consider-methods for broader analysis');
    return lines.join('\n');
  }

  // Statistics summary
  const stats = {
    equivalent: relationships.filter(r => r.relationshipType === 'equivalent').length,
    subset: relationships.filter(r => r.relationshipType === 'subset').length,
    superset: relationships.filter(r => r.relationshipType === 'superset').length,
    partial: relationships.filter(r => r.relationshipType === 'partial_overlap').length
  };

  lines.push('📊 Relationship Summary:');
  lines.push(`   • Equivalent Types: ${stats.equivalent} (🟢 high consolidation potential)`);
  lines.push(`   • Subset Relations: ${stats.subset} (🟡 inheritance opportunities)`);
  lines.push(`   • Superset Relations: ${stats.superset} (🟡 inheritance opportunities)`);
  lines.push(`   • Partial Overlaps: ${stats.partial} (🔵 interface extraction potential)`);
  lines.push('');

  // Individual relationships
  lines.push(`🔗 Relationships (showing ${relationships.length}):`);
  lines.push('━'.repeat(50));
  
  relationships.forEach((rel, index) => {
    const typeIcon = {
      'equivalent': '🟢',
      'subset': '⬇️',
      'superset': '⬆️',
      'partial_overlap': '🔄'
    }[rel.relationshipType] || '❓';
    
    const overlapPercent = (rel.overlapRatio * 100).toFixed(1);
    const confidencePercent = (rel.confidence * 100).toFixed(0);
    
    lines.push(`${index + 1}. ${typeIcon} ${rel.relationshipType.replace('_', ' ').toUpperCase()}`);
    lines.push(`   Types: ${rel.sourceTypeName} ↔ ${rel.targetTypeName}`);
    lines.push(`   Overlap: ${overlapPercent}% (confidence: ${confidencePercent}%)`);
    lines.push(`   Impact Score: ${rel.impactScore}`);
    lines.push('');
    
    // Common members
    if (rel.commonMembers.length > 0) {
      const memberDisplay = rel.commonMembers.length > 5 
        ? rel.commonMembers.slice(0, 5).join(', ') + ` ... (${rel.commonMembers.length - 5} more)`
        : rel.commonMembers.join(', ');
      lines.push(`   🤝 Shared: {${memberDisplay}}`);
    }
    
    // Unique members (only show if not equivalent)
    if (rel.relationshipType !== 'equivalent') {
      if (rel.uniqueToSource.length > 0) {
        const uniqueDisplay = rel.uniqueToSource.length > 3
          ? rel.uniqueToSource.slice(0, 3).join(', ') + ` ... (${rel.uniqueToSource.length - 3} more)`
          : rel.uniqueToSource.join(', ');
        lines.push(`   📍 Only in ${rel.sourceTypeName}: {${uniqueDisplay}}`);
      }
      if (rel.uniqueToTarget.length > 0) {
        const uniqueDisplay = rel.uniqueToTarget.length > 3
          ? rel.uniqueToTarget.slice(0, 3).join(', ') + ` ... (${rel.uniqueToTarget.length - 3} more)`
          : rel.uniqueToTarget.join(', ');
        lines.push(`   📍 Only in ${rel.targetTypeName}: {${uniqueDisplay}}`);
      }
    }
    
    lines.push(`   💡 ${rel.suggestedAction}`);
    lines.push('');
  });

  // Recommendations
  lines.push('📋 General Recommendations:');
  lines.push('━'.repeat(30));
  
  if (stats.equivalent > 0) {
    lines.push(`   🟢 ${stats.equivalent} equivalent type(s) can be merged immediately`);
  }
  
  if (stats.subset + stats.superset > 0) {
    lines.push(`   🟡 ${stats.subset + stats.superset} inheritance relationship(s) can be formalized`);
  }
  
  if (stats.partial > 0) {
    lines.push(`   🔵 ${stats.partial} partial overlap(s) suggest common interface extraction`);
  }
  
  lines.push('');

  // Next steps
  lines.push('🚀 Next Steps:');
  lines.push('━'.repeat(20));
  lines.push('   1. Start with equivalent types (highest impact)');
  lines.push('   2. Establish inheritance hierarchies for subset/superset relations');
  lines.push('   3. Extract common interfaces for partial overlaps');
  lines.push('   4. Update import statements and references after consolidation');

  return lines.join('\n');
}

/**
 * Execute types fingerprint command using database
 */
const executeTypesFingerprintDB: VoidCommand<TypeFingerprintOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🔍 Analyzing behavioral fingerprints and function clustering...');

      // Get latest snapshot
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run `funcqc scan` first.');
      }
      const latestSnapshot = snapshots[0];

      // Import and configure the analyzer
      const { BehavioralFingerprintAnalyzer } = await import('../../analyzers/type-insights/behavioral-fingerprint-analyzer');
      
      // Normalize and validate options
      const normalizeInt = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN;
      const normalizeNum = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? v : NaN;

      let minCallFrequency = normalizeInt(options.minCallFrequency);
      if (!(minCallFrequency >= 1)) {
        if (options.minCallFrequency !== undefined) {
          env.commandLogger.warn(
            `Invalid --min-call-frequency '${options.minCallFrequency}', falling back to 2.`
          );
        }
        minCallFrequency = 2;
      }

      let similarityThreshold = normalizeNum(options.similarityThreshold);
      if (!(similarityThreshold >= 0 && similarityThreshold <= 1)) {
        if (options.similarityThreshold !== undefined) {
          env.commandLogger.warn(
            `Invalid --similarity-threshold '${options.similarityThreshold}', falling back to 0.7.`
          );
        }
        similarityThreshold = 0.7;
      }

      let maxFingerprintSize = normalizeInt(options.maxFingerprintSize);
      if (!(maxFingerprintSize > 0)) {
        if (options.maxFingerprintSize !== undefined) {
          env.commandLogger.warn(
            `Invalid --max-fingerprint-size '${options.maxFingerprintSize}', falling back to 50.`
          );
        }
        maxFingerprintSize = 50;
      }

      const analyzerOptions = {
        includeCallsOut: options.includeCallsOut ?? true,
        includeCallsIn: options.includeCallsIn ?? true,
        minCallFrequency,
        clusterSimilarityThreshold: similarityThreshold,
        maxFingerprintSize,
        includeInternalCalls: options.includeInternalCalls ?? false
      };

      const analyzer = new BehavioralFingerprintAnalyzer(env.storage, analyzerOptions);

      // Perform analysis
      const clusters = await analyzer.getDetailedResults(latestSnapshot.id);

      // Apply sorting
      let sortedResults = [...clusters];
      const allowedSorts = new Set(['similarity', 'impact', 'size'] as const);
      type AllowedSort = 'similarity' | 'impact' | 'size';
      const sortField = allowedSorts.has((options.sort ?? 'impact') as AllowedSort)
        ? (options.sort ?? 'impact')
        : 'impact';
      if (options.sort && !allowedSorts.has(options.sort as AllowedSort)) {
        env.commandLogger.warn(`Invalid --sort '${options.sort}'. Falling back to 'impact'.`);
      }
      const descending = options.desc === true;

      sortedResults.sort((a, b) => {
        let comparison = 0;
        
        switch (sortField) {
          case 'similarity':
            comparison = a.similarity - b.similarity;
            break;
          case 'impact':
            comparison = a.impactScore - b.impactScore;
            break;
          case 'size':
            comparison = a.functions.length - b.functions.length;
            break;
          default:
            comparison = a.impactScore - b.impactScore;
        }

        return descending ? -comparison : comparison;
      });

      // Apply limit
      if (options.limit && options.limit > 0) {
        sortedResults = sortedResults.slice(0, options.limit);
      }

      if (options.json) {
        const jsonOutput = {
          metadata: {
            timestamp: new Date().toISOString(),
            snapshotId: latestSnapshot.id,
            totalClusters: clusters.length,
            displayedClusters: sortedResults.length,
            options: analyzerOptions
          },
          clusters: sortedResults
        };
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
      }

      // Generate report
      const report = formatFingerprintReport(sortedResults, {
        includeCallsOut: analyzerOptions.includeCallsOut,
        includeCallsIn: analyzerOptions.includeCallsIn,
        minCallFrequency: analyzerOptions.minCallFrequency,
        similarityThreshold: analyzerOptions.clusterSimilarityThreshold,
        includeInternalCalls: analyzerOptions.includeInternalCalls,
        maxFingerprintSize: analyzerOptions.maxFingerprintSize
      });

      console.log(report);

    } catch (error) {
      // Check if it's already a FuncqcError
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze behavioral fingerprints: ${error instanceof Error ? error.message : String(error)}`,
          { command: 'types fingerprint' },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Format behavioral fingerprint analysis report
 */
function formatFingerprintReport(
  clusters: Array<{
    clusterId: string;
    functions: string[];
    functionNames: string[];
    commonBehaviors: string[];
    clusterSignature: string[];
    roleDescription: string;
    similarity: number;
    suggestedAction: string;
    impactScore: number;
    confidence: number;
  }>,
  options: {
    includeCallsOut: boolean;
    includeCallsIn: boolean;
    minCallFrequency: number;
    similarityThreshold: number;
    includeInternalCalls: boolean;
    maxFingerprintSize: number;
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push('🔍 Behavioral Fingerprint Analysis');
  lines.push('═'.repeat(50));
  lines.push('');

  // Configuration summary
  lines.push('⚙️  Analysis Configuration:');
  lines.push(`   • Include Outgoing Calls: ${options.includeCallsOut ? 'Yes' : 'No'}`);
  lines.push(`   • Include Incoming Calls: ${options.includeCallsIn ? 'Yes' : 'No'}`);
  lines.push(`   • Min Call Frequency: ${options.minCallFrequency}`);
  lines.push(`   • Similarity Threshold: ${(options.similarityThreshold * 100).toFixed(1)}%`);
  lines.push(`   • Include Internal Calls: ${options.includeInternalCalls ? 'Yes' : 'No'}`);
  lines.push('');

  if (clusters.length === 0) {
    lines.push('ℹ️  No behavioral clusters found with current criteria.');
    lines.push('');
    lines.push('💡 Try adjusting parameters:');
    lines.push('   • Lower --similarity-threshold for broader clustering');
    lines.push('   • Lower --min-call-frequency for more functions');
    lines.push('   • Enable --include-internal-calls for richer patterns');
    return lines.join('\n');
  }

  // Statistics summary
  const totalFunctions = clusters.reduce((sum, cluster) => sum + cluster.functions.length, 0);
  const avgSimilarity = clusters.reduce((sum, cluster) => sum + cluster.similarity, 0) / clusters.length;

  lines.push('📊 Clustering Summary:');
  lines.push(`   • ${clusters.length} behavioral cluster(s) identified`);
  lines.push(`   • ${totalFunctions} functions clustered`);
  lines.push(`   • Average internal similarity: ${(avgSimilarity * 100).toFixed(1)}%`);
  lines.push('');

  // Detailed cluster analysis
  lines.push('🎯 Cluster Analysis:');
  lines.push('─'.repeat(40));

  clusters.forEach((cluster, index) => {
    lines.push('');
    lines.push(`📦 Cluster ${index + 1}: ${cluster.roleDescription}`);
    lines.push(`   ID: ${cluster.clusterId}`);
    lines.push(`   Functions: ${cluster.functions.length} (similarity: ${(cluster.similarity * 100).toFixed(1)}%)`);
    lines.push(`   Impact Score: ${cluster.impactScore} | Confidence: ${(cluster.confidence * 100).toFixed(1)}%`);
    lines.push('');
    
    // Function list
    lines.push('   🔧 Functions in cluster:');
    cluster.functionNames.slice(0, 8).forEach(name => {
      lines.push(`      • ${name}`);
    });
    if (cluster.functionNames.length > 8) {
      lines.push(`      ... and ${cluster.functionNames.length - 8} more`);
    }
    lines.push('');
    
    // Common behaviors
    if (cluster.commonBehaviors.length > 0) {
      lines.push('   🤝 Shared Behaviors:');
      cluster.commonBehaviors.slice(0, 6).forEach(behavior => {
        lines.push(`      • ${behavior}`);
      });
      if (cluster.commonBehaviors.length > 6) {
        lines.push(`      ... and ${cluster.commonBehaviors.length - 6} more`);
      }
      lines.push('');
    }

    // Suggested action
    lines.push(`   💡 ${cluster.suggestedAction}`);
  });

  lines.push('');

  // Impact analysis
  const highImpactClusters = clusters.filter(c => c.impactScore >= 50).length;
  const mediumImpactClusters = clusters.filter(c => c.impactScore >= 25 && c.impactScore < 50).length;

  lines.push('📈 Impact Analysis:');
  if (highImpactClusters > 0) {
    lines.push(`   🔴 ${highImpactClusters} high-impact cluster(s) - immediate refactoring opportunity`);
  }
  if (mediumImpactClusters > 0) {
    lines.push(`   🟡 ${mediumImpactClusters} medium-impact cluster(s) - consider consolidation`);
  }
  
  lines.push('');

  // Next steps
  lines.push('🚀 Next Steps:');
  lines.push('━'.repeat(20));
  lines.push('   1. Start with highest impact clusters');
  lines.push('   2. Extract common interfaces for behavioral patterns');
  lines.push('   3. Consider module consolidation for same-file clusters');
  lines.push('   4. Validate behavioral assumptions through code review');

  return lines.join('\n');
}

/**
 * Execute types converters command using database
 */
const executeTypesConvertersDB: VoidCommand<TypeConvertersOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🔄 Analyzing type conversion networks and canonical types...');

      // Get latest snapshot
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run `funcqc scan` first.');
      }
      const latestSnapshot = snapshots[0];

      // Import and configure the analyzer
      const { ConverterNetworkAnalyzer } = await import('../../analyzers/type-insights/converter-network-analyzer');
      
      // Normalize and validate options
      const normalizeInt = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN;

      let minConverters = normalizeInt(options.minConverters);
      if (!(minConverters >= 1)) {
        if (options.minConverters !== undefined) {
          env.commandLogger.warn(
            `Invalid --min-converters '${options.minConverters}', falling back to 2.`
          );
        }
        minConverters = 2;
      }

      let maxChainLength = normalizeInt(options.maxChainLength);
      if (!(maxChainLength >= 1)) {
        if (options.maxChainLength !== undefined) {
          env.commandLogger.warn(
            `Invalid --max-chain-length '${options.maxChainLength}', falling back to 4.`
          );
        }
        maxChainLength = 4;
      }

      let limit: number | undefined = normalizeInt(options.limit);
      if (!(limit >= 1)) {
        limit = undefined;
      }

      // Validate sort field
      type AllowedSort = 'centrality' | 'converters' | 'usage';
      const allowedSorts: AllowedSort[] = ['centrality', 'converters', 'usage'];
      let sort: AllowedSort = 'centrality';
      if (options.sort && allowedSorts.includes(options.sort as AllowedSort)) {
        sort = options.sort as AllowedSort;
      } else if (options.sort) {
        env.commandLogger.warn(
          `Invalid --sort '${options.sort}', falling back to 'centrality'.`
        );
      }

      const analyzerOptions = {
        minConverters,
        includeInternalCalls: options.includeInternalCalls ?? true,
        includeParsers: options.includeParsers ?? true,
        showChains: options.showChains ?? false,
        canonicalOnly: options.canonicalOnly ?? false,
        maxChainLength
      };

      const analyzer = new ConverterNetworkAnalyzer(env.storage, analyzerOptions);

      // Perform analysis
      const reports = await analyzer.analyze(latestSnapshot.id);

      if (reports.length === 0 || !reports[0]) {
        env.commandLogger.info('ℹ️  No converter networks found. Consider adjusting parameters.');
        return;
      }

      const report = reports[0];

      // Apply sorting and limiting to nodes
      let nodes = [...report.nodes];
      
      if (sort === 'centrality') {
        nodes = nodes.sort((a, b) => b.centralityScore - a.centralityScore);
      } else if (sort === 'converters') {
        nodes = nodes.sort((a, b) => b.totalConverters - a.totalConverters);
      } else if (sort === 'usage') {
        const getUsage = (node: typeof nodes[0]) =>
          [...node.convertersIn, ...node.convertersOut]
            .reduce((sum, conv) => sum + (conv.usageCount || 0), 0);
        nodes = nodes.sort((a, b) => getUsage(b) - getUsage(a));
      }

      if (!options.desc) {
        nodes = nodes.reverse();
      }

      if (limit) {
        nodes = nodes.slice(0, limit);
      }

      // Output results
      if (options.json) {
        const jsonReport = {
          ...report,
          nodes,
          metadata: {
            generatedAt: new Date().toISOString(),
            snapshotId: latestSnapshot.id,
            options: analyzerOptions,
            command: 'types converters'
          }
        };
        console.log(JSON.stringify(jsonReport, null, 2));
      } else {
        const formattedReport = formatConvertersReport({
          ...report,
          nodes
        }, analyzerOptions);
        console.log(formattedReport);
      }

    } catch (error) {
      if (error instanceof Error) {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze converter networks: ${error.message}`,
          { command: 'types converters' },
          error
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze converter networks: ${String(error)}`,
          { command: 'types converters' }
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Format converter network analysis report
 */
function formatConvertersReport(
  report: {
    nodes: Array<{
      typeName: string;
      typeId: string | null;
      isCanonical: boolean;
      centralityScore: number;
      convertersIn: Array<{
        name: string;
        sourceType: string | null;
        targetType: string | null;
        converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
        usageCount: number;
        file: string;
      }>;
      convertersOut: Array<{
        name: string;
        sourceType: string | null;
        targetType: string | null;
        converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
        usageCount: number;
        file: string;
      }>;
      totalConverters: number;
    }>;
    converters: Array<{
      functionId: string;
      name: string;
      sourceType: string | null;
      targetType: string | null;
      converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
      usageCount: number;
      file: string;
    }>;
    chains: Array<{
      chainId: string;
      sourceType: string;
      targetType: string;
      steps: Array<{
        name: string;
        converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
        usageCount: number;
      }>;
      totalUsage: number;
      efficiency: number;
      canOptimize: boolean;
    }>;
    statistics: {
      totalTypes: number;
      totalConverters: number;
      averageConvertersPerType: number;
      canonicalTypes: number;
      redundantTypes: number;
      longestChain: number;
      optimizableChains: number;
    };
    suggestedAction: string;
    impactScore: number;
  },
  options: {
    minConverters: number;
    includeInternalCalls: boolean;
    includeParsers: boolean;
    showChains: boolean;
    canonicalOnly: boolean;
    maxChainLength: number;
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push('🔄 Type Conversion Network Analysis');
  lines.push('═'.repeat(50));
  lines.push('');

  // Configuration summary
  lines.push('⚙️  Analysis Configuration:');
  lines.push(`   • Minimum Converters: ${options.minConverters}`);
  lines.push(`   • Include Internal Calls: ${options.includeInternalCalls ? 'Yes' : 'No'}`);
  lines.push(`   • Include Parsers: ${options.includeParsers ? 'Yes' : 'No'}`);
  lines.push(`   • Show Chains: ${options.showChains ? 'Yes' : 'No'}`);
  lines.push(`   • Canonical Only: ${options.canonicalOnly ? 'Yes' : 'No'}`);
  lines.push('');

  if (report.nodes.length === 0) {
    lines.push('ℹ️  No converter networks found with current criteria.');
    lines.push('');
    lines.push('💡 Try adjusting parameters:');
    lines.push('   • Lower --min-converters for smaller networks');
    lines.push('   • Enable --include-parsers for parse function analysis');
    lines.push('   • Remove --canonical-only to see all types');
    return lines.join('\n');
  }

  // Statistics summary
  lines.push('📊 Network Statistics:');
  lines.push(`   • ${report.statistics.totalTypes} types in conversion networks`);
  lines.push(`   • ${report.statistics.totalConverters} converter functions found`);
  lines.push(`   • ${report.statistics.canonicalTypes} canonical types identified`);
  lines.push(`   • ${report.statistics.redundantTypes} redundant types detected`);
  lines.push(`   • ${report.statistics.averageConvertersPerType.toFixed(1)} avg converters per type`);
  
  if (options.showChains && report.chains.length > 0) {
    lines.push(`   • ${report.chains.length} conversion chains analyzed`);
    lines.push(`   • ${report.statistics.longestChain} steps in longest chain`);
    lines.push(`   • ${report.statistics.optimizableChains} chains can be optimized`);
  }
  lines.push('');

  // Type nodes
  lines.push('🏗️  Type Conversion Nodes:');
  lines.push('━'.repeat(70));
  
  for (const node of report.nodes) {
    const status = node.isCanonical ? '🌟 CANONICAL' : '🔄 REDUNDANT';
    const centralityPercent = (node.centralityScore * 100).toFixed(1);
    
    lines.push(`${status} ${node.typeName} (Centrality: ${centralityPercent}%)`);
    lines.push(`   Converters: ${node.totalConverters} (In: ${node.convertersIn.length}, Out: ${node.convertersOut.length})`);
    
    if (node.convertersIn.length > 0) {
      lines.push('   Incoming Conversions:');
      for (const conv of node.convertersIn.slice(0, 3)) {
        const usage = conv.usageCount > 0 ? ` (${conv.usageCount}x)` : '';
        lines.push(`     • ${conv.name}() [${conv.converterType}]${usage}`);
      }
      if (node.convertersIn.length > 3) {
        lines.push(`     • ... and ${node.convertersIn.length - 3} more`);
      }
    }
    
    if (node.convertersOut.length > 0) {
      lines.push('   Outgoing Conversions:');
      for (const conv of node.convertersOut.slice(0, 3)) {
        const usage = conv.usageCount > 0 ? ` (${conv.usageCount}x)` : '';
        lines.push(`     • ${conv.name}() [${conv.converterType}]${usage}`);
      }
      if (node.convertersOut.length > 3) {
        lines.push(`     • ... and ${node.convertersOut.length - 3} more`);
      }
    }
    
    lines.push('');
  }

  // Conversion chains if requested
  if (options.showChains && report.chains.length > 0) {
    lines.push('🔗 Conversion Chains:');
    lines.push('━'.repeat(50));
    
    for (const chain of report.chains.slice(0, 5)) {
      const efficiency = (chain.efficiency * 100).toFixed(1);
      const optimizable = chain.canOptimize ? ' ⚠️  OPTIMIZABLE' : '';
      
      lines.push(`${chain.sourceType} → ${chain.targetType} (${chain.steps.length} steps, ${efficiency}% efficient)${optimizable}`);
      
      const chainSteps = chain.steps.map(step => 
        `${step.name}()[${step.converterType}]`
      ).join(' → ');
      lines.push(`   ${chainSteps}`);
      
      if (chain.totalUsage > 0) {
        lines.push(`   Total Usage: ${chain.totalUsage}`);
      }
      lines.push('');
    }
    
    if (report.chains.length > 5) {
      lines.push(`   ... and ${report.chains.length - 5} more chains`);
      lines.push('');
    }
  }

  // Recommendations
  lines.push('💡 Recommendations:');
  lines.push('━'.repeat(20));
  lines.push(report.suggestedAction);
  lines.push('');

  lines.push('📋 Action Items:');
  lines.push('━'.repeat(20));
  lines.push('   1. Focus on canonical types for API standardization');
  lines.push('   2. Consider consolidating redundant types');
  
  if (report.statistics.optimizableChains > 0) {
    lines.push('   3. Optimize conversion chains with direct converters');
  }
  
  lines.push('   4. Review high-usage converters for performance optimization');

  return lines.join('\n');
}

/**
 * Co-change analysis command implementation
 */
const executeTypesCochangeDB: VoidCommand<TypeCochangeOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    const { GitCochangeProvider } = await import('../../analyzers/type-insights/git-cochange-provider');
    const { CochangeAnalyzer } = await import('../../analyzers/type-insights/cochange-analyzer');

    try {
      env.commandLogger.info('📈 Analyzing type co-evolution patterns from Git history...');
      
      // Initialize Git provider
      const gitProvider = new GitCochangeProvider();
      
      // Check Git availability
      const isGitAvailable = await gitProvider.isGitAvailable();
      if (!isGitAvailable) {
        const funcqcError = errorHandler.createError(
          ErrorCode.SYSTEM_REQUIREMENTS_NOT_MET,
          'Git is not available. Co-change analysis requires Git.',
          { command: 'types cochange' }
        );
        errorHandler.handleError(funcqcError);
        return;
      }

      const isGitRepo = await gitProvider.isGitRepository();
      if (!isGitRepo) {
        const funcqcError = errorHandler.createError(
          ErrorCode.SYSTEM_REQUIREMENTS_NOT_MET,
          'Current directory is not a Git repository. Co-change analysis requires Git history.',
          { command: 'types cochange' }
        );
        errorHandler.handleError(funcqcError);
        return;
      }

      // Process exclude-paths option
      let excludePaths: string[];
      if (typeof options.excludePaths === 'string') {
        excludePaths = options.excludePaths
          .split(',')
          .map(p => p.trim())
          .filter(p => p.length > 0);
      } else if (Array.isArray(options.excludePaths)) {
        excludePaths = options.excludePaths;
      } else {
        excludePaths = [];
      }

      // Create analyzer (normalize/validate numeric options)
      const normalizeInt = (v: unknown, min: number, fallback: number) =>
        typeof v === 'number' && Number.isFinite(v) && Math.trunc(v) >= min
          ? Math.trunc(v)
          : fallback;
      const normalizeFloatRange = (v: unknown, min: number, max: number, fallback: number) =>
        typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
          ? v
          : fallback;

      const monthsBack = normalizeInt(options.monthsBack, 1, 6);
      const minChanges = normalizeInt(options.minChanges, 1, 2);
      const cochangeThreshold = normalizeFloatRange(options.cochangeThreshold, 0, 1, 0.3);
      const maxCommits = normalizeInt(options.maxCommits, 1, 1000);
      const showMatrix = options.showMatrix === true;
      const suggestModules = options.suggestModules !== false;

      const analyzer = new CochangeAnalyzer(env.storage, gitProvider, {
        monthsBack,
        minChanges,
        cochangeThreshold,
        showMatrix,
        suggestModules,
        maxCommits,
        excludePaths
      });

      // Run analysis
      const reports = await analyzer.analyze();
      
      if (reports.length === 0) {
        env.commandLogger.info('No co-change patterns found.');
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(reports, null, 2));
        return;
      }

      // Display results
      for (const report of reports) {
        console.log(formatCochangeReport(report, options));
      }

    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze co-change patterns: ${error instanceof Error ? error.message : String(error)}`,
          { command: 'types cochange' },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

function formatCochangeReport(report: CochangeAnalysisReport, options: TypeCochangeOptions): string {
  const lines: string[] = [];
  
  lines.push('');
  lines.push('📈 Co-change Analysis Report');
  lines.push('=' .repeat(50));
  
  // Statistics
  lines.push('');
  lines.push('📊 Analysis Statistics:');
  lines.push(`   Types analyzed: ${report.statistics.totalTypes}`);
  lines.push(`   Commits analyzed: ${report.statistics.analyzedCommits}`);
  lines.push(`   Time span: ${report.statistics.timeSpan}`);
  lines.push(`   Average changes per type: ${report.statistics.averageChangesPerType.toFixed(1)}`);
  lines.push(`   Most volatile type: ${report.statistics.mostVolatileType}`);
  lines.push(`   Strongest coupling: ${report.statistics.strongestCoupling}`);
  
  // Type changes (sorted by criteria)
  let sortedTypeChanges = [...report.typeChanges];
  if (options.sort === 'changes') {
    sortedTypeChanges.sort((a, b) => b.changeCount - a.changeCount);
  } else if (options.sort === 'volatility') {
    sortedTypeChanges.sort((a, b) => b.volatility - a.volatility);
  }
  
  if (options.desc === false) {
    sortedTypeChanges.reverse();
  }
  
  if (options.limit) {
    sortedTypeChanges = sortedTypeChanges.slice(0, options.limit);
  }

  if (sortedTypeChanges.length > 0) {
    lines.push('');
    lines.push('🔄 Type Change Patterns:');
    lines.push('');
    
    const maxNameLength = Math.max(...sortedTypeChanges.map(tc => tc.typeName.length), 15);
    lines.push(`${'Type'.padEnd(maxNameLength)} | Changes | Frequency | Volatility | File`);
    lines.push('-'.repeat(maxNameLength + 60));
    
    for (const typeChange of sortedTypeChanges) {
      const volatilityBar = '█'.repeat(Math.floor(typeChange.volatility * 10)) + 
                           '░'.repeat(10 - Math.floor(typeChange.volatility * 10));
      lines.push(
        `${typeChange.typeName.padEnd(maxNameLength)} | ` +
        `${typeChange.changeCount.toString().padStart(7)} | ` +
        `${typeChange.changeFrequency.toFixed(1).padStart(9)} | ` +
        `${volatilityBar} | ` +
        `${typeChange.filePath}`
      );
    }
  }

  // Co-change relationships  
  let sortedRelations = [...report.cochangeMatrix];
  if (options.sort === 'coupling') {
    sortedRelations.sort((a, b) => b.temporalCoupling - a.temporalCoupling);
  }
  
  if (options.desc === false) {
    sortedRelations.reverse();
  }
  
  if (options.limit) {
    sortedRelations = sortedRelations.slice(0, options.limit);
  }

  if (sortedRelations.length > 0) {
    lines.push('');
    lines.push('🔗 Co-change Relationships:');
    lines.push('');
    
    const maxTypeLength = Math.max(
      ...sortedRelations.flatMap(r => [r.typeA.length, r.typeB.length]), 
      15
    );
    
    lines.push(`${'Type A'.padEnd(maxTypeLength)} | ${'Type B'.padEnd(maxTypeLength)} | Coupling | Symmetry | Confidence`);
    lines.push('-'.repeat(maxTypeLength * 2 + 40));
    
    for (const relation of sortedRelations) {
      const couplingBar = '█'.repeat(Math.floor(relation.temporalCoupling * 10)) + 
                         '░'.repeat(10 - Math.floor(relation.temporalCoupling * 10));
      lines.push(
        `${relation.typeA.padEnd(maxTypeLength)} | ` +
        `${relation.typeB.padEnd(maxTypeLength)} | ` +
        `${couplingBar} | ` +
        `${(relation.symmetry * 100).toFixed(0).padStart(6)}% | ` +
        `${(relation.confidence * 100).toFixed(0).padStart(8)}%`
      );
    }
  }

  // Module suggestions
  if (report.moduleSuggestions.length > 0) {
    lines.push('');
    lines.push('🏗️  Module Suggestions:');
    lines.push('');
    
    for (let i = 0; i < report.moduleSuggestions.length; i++) {
      const suggestion = report.moduleSuggestions[i];
      if (!suggestion) continue;
      
      lines.push(`${i + 1}. ${suggestion.suggestedName}`);
      lines.push(`   Types: ${suggestion.types.join(', ')}`);
      lines.push(`   Cohesion: ${(suggestion.cohesion * 100).toFixed(1)}% | Coupling: ${(suggestion.coupling * 100).toFixed(1)}%`);
      lines.push(`   Migration effort: ${suggestion.migrationEffort}`);
      lines.push(`   Rationale: ${suggestion.rationale}`);
      lines.push(`   Benefits: ${suggestion.benefits.join(', ')}`);
      lines.push('');
    }
  }

  // Suggested actions
  if (report.suggestedAction && report.suggestedAction !== 'No significant co-change patterns detected') {
    lines.push('');
    lines.push('💡 Recommended Actions:');
    lines.push(`   ${report.suggestedAction}`);
  }

  lines.push('');
  return lines.join('\n');
}