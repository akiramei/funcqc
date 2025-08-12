import { Command } from 'commander';
import { TypeListOptions, TypeHealthOptions, TypeDepsOptions, TypeApiOptions, TypeMembersOptions, TypeCoverageOptions, TypeClusterOptions, TypeRiskOptions, TypeInsightsOptions, isUuidOrPrefix, escapeLike } from './types.types';

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