import { TypesCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode, DatabaseErrorLike } from '../../utils/error-handler';
import { TypeListOptions } from './types.types';



/**
 * Filter undefined values from object
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
 * Types command - unified TypeScript type analysis interface
 * Consolidates functionality from 14 type analysis subcommands
 */
export const typesCommand: VoidCommand<TypesCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (!options.quiet) {
        env.commandLogger.info('🧩 Starting TypeScript type analysis...');
      }

      switch (options.action) {
        case 'list':
          await executeList(env, options);
          break;
        case 'health':
          await executeHealth(env, options);
          break;
        case 'deps':
          await executeDeps(env, options);
          break;
        case 'api':
          await executeApi(env, options);
          break;
        case 'members':
          await executeMembers(env, options);
          break;
        case 'coverage':
          await executeCoverage(env, options);
          break;
        case 'cluster':
          await executeCluster(env, options);
          break;
        case 'risk':
          await executeRisk(env, options);
          break;
        case 'insights':
          await executeInsights(env, options);
          break;
        case 'slices':
          await executeSlices(env, options);
          break;
        case 'subsume':
          await executeSubsume(env, options);
          break;
        case 'fingerprint':
          await executeFingerprint(env, options);
          break;
        case 'converters':
          await executeConverters(env, options);
          break;
        case 'cochange':
          await executeCochange(env, options);
          break;
        default:
          await executeOverview(env, options);
          break;
      }

      if (!options.quiet) {
        env.commandLogger.info('✅ TypeScript type analysis completed!');
      }

    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as DatabaseErrorLike);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `TypeScript type analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute types list analysis
 */
async function executeList(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📋 Listing TypeScript types from database...');
  }

  try {
    const { executeTypesListDB } = await import('./types/subcommands/list');
    const listOptions = filterUndefined({
      kind: options.kind,
      exported: options.exported,
      generic: options.generic,
      file: options.file,
      name: options.name,
      propEq: options.propEq !== undefined ? String(options.propEq) : undefined,
      propGe: options.propGe !== undefined ? String(options.propGe) : undefined,
      propLe: options.propLe !== undefined ? String(options.propLe) : undefined,
      propGt: options.propGt !== undefined ? String(options.propGt) : undefined,
      propLt: options.propLt !== undefined ? String(options.propLt) : undefined,
      methEq: options.methEq !== undefined ? String(options.methEq) : undefined,
      methGe: options.methGe !== undefined ? String(options.methGe) : undefined,
      methLe: options.methLe !== undefined ? String(options.methLe) : undefined,
      methGt: options.methGt !== undefined ? String(options.methGt) : undefined,
      methLt: options.methLt !== undefined ? String(options.methLt) : undefined,
      fnEq: options.fnEq !== undefined ? String(options.fnEq) : undefined,
      fnGe: options.fnGe !== undefined ? String(options.fnGe) : undefined,
      fnLe: options.fnLe !== undefined ? String(options.fnLe) : undefined,
      fnGt: options.fnGt !== undefined ? String(options.fnGt) : undefined,
      fnLt: options.fnLt !== undefined ? String(options.fnLt) : undefined,
      totalEq: options.totalEq !== undefined ? String(options.totalEq) : undefined,
      totalGe: options.totalGe !== undefined ? String(options.totalGe) : undefined,
      totalLe: options.totalLe !== undefined ? String(options.totalLe) : undefined,
      totalGt: options.totalGt !== undefined ? String(options.totalGt) : undefined,
      totalLt: options.totalLt !== undefined ? String(options.totalLt) : undefined,
      hasIndex: options.hasIndex,
      hasCall: options.hasCall,
      limit: options.limit,
      sort: options.sort,
      desc: options.desc,
      json: options.json,
      detail: options.detail,
      showLocation: options.showLocation,
      showId: options.showId,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await executeTypesListDB(listOptions as TypeListOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type listing completed');
    }
  } catch (error) {
    throw new Error(`Type listing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute types health analysis
 */
async function executeHealth(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🏥 Analyzing type system health...');
  }

  try {
    const { executeTypesHealthDB } = await import('./types/subcommands/health');
    const healthOptions = filterUndefined({
      verbose: options.verbose,
      json: options.json,
      thresholds: options.thresholds,
      legend: options.legend,
      quiet: options.quiet
    });
    await executeTypesHealthDB(healthOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type health analysis completed');
    }
  } catch (error) {
    throw new Error(`Type health analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type dependencies analysis
 */
async function executeDeps(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔗 Analyzing type dependencies...');
  }

  try {
    const { executeTypesDepsDB } = await import('./types/subcommands/deps');
    const depsOptions = filterUndefined({
      typeName: options.typeName,
      depth: options.depth,
      circular: options.circular,
      json: options.json,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await executeTypesDepsDB(depsOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type dependencies analysis completed');
    }
  } catch (error) {
    throw new Error(`Type dependencies analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type API analysis
 */
async function executeApi(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📊 Analyzing type API design and surface area...');
  }

  try {
    const { executeTypesApiDB } = await import('./types/subcommands/api');
    const apiOptions = filterUndefined({
      typeName: options.typeName,
      json: options.json,
      detail: options.detail,
      optimize: options.optimize,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await executeTypesApiDB(apiOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type API analysis completed');
    }
  } catch (error) {
    throw new Error(`Type API analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type members analysis
 */
async function executeMembers(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('👥 Showing detailed type member information...');
  }

  try {
    const { executeTypesMembersDB } = await import('./types/subcommands/members');
    const membersOptionsRaw = {
      typeName: options.typeName,
      json: options.json,
      detail: options.detail,
      kind: options.memberKind as "method" | "property" | "getter" | "setter" | "constructor" | "index_signature" | "call_signature" | undefined,
      accessModifier: options.accessModifier,
      verbose: options.verbose,
      quiet: options.quiet
    };
    const membersOptions = filterUndefined(membersOptionsRaw) as import('./types.types').TypeMembersOptions;
    await executeTypesMembersDB(membersOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type members analysis completed');
    }
  } catch (error) {
    throw new Error(`Type members analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type coverage analysis
 */
async function executeCoverage(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📊 Analyzing property usage coverage and patterns...');
  }

  try {
    const { executeTypesCoverageDB } = await import('./types/subcommands/coverage');
    const coverageOptions = filterUndefined({
      typeName: options.typeName,
      json: options.json,
      hotThreshold: options.hotThreshold,
      writeHubThreshold: options.writeHubThreshold,
      includePrivate: options.includePrivate,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await executeTypesCoverageDB(coverageOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type coverage analysis completed');
    }
  } catch (error) {
    throw new Error(`Type coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type clustering analysis
 */
async function executeCluster(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🎪 Analyzing property clustering and co-occurrence patterns...');
  }

  try {
    const { executeTypesClusterDB } = await import('./types/subcommands/cluster');
    const clusterOptions = filterUndefined({
      typeName: options.typeName,
      json: options.json,
      similarityThreshold: options.similarityThreshold,
      minClusterSize: options.minClusterSize,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await executeTypesClusterDB(clusterOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type clustering analysis completed');
    }
  } catch (error) {
    throw new Error(`Type clustering analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type risk analysis
 */
async function executeRisk(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('⚠️ Analyzing dependency risk and change impact...');
  }

  try {
    const { executeTypesRiskDB } = await import('./types/subcommands/risk');
    const riskOptions = filterUndefined({
      typeName: options.typeName,
      json: options.json,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await executeTypesRiskDB(riskOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type risk analysis completed');
    }
  } catch (error) {
    throw new Error(`Type risk analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute comprehensive type insights
 */
async function executeInsights(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔍 Performing comprehensive type analysis...');
  }

  try {
    const { executeTypesInsightsDB } = await import('./types/subcommands/insights');
    const insightsOptions = filterUndefined({
      typeName: options.typeName,
      json: options.json,
      includeCoverage: !options.noCoverage,
      includeApi: !options.noApi,
      includeCluster: !options.noCluster,
      includeRisk: !options.noRisk,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await executeTypesInsightsDB(insightsOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type insights analysis completed');
    }
  } catch (error) {
    throw new Error(`Type insights analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute property slices analysis
 */
async function executeSlices(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🍰 Discovering reusable property patterns across types...');
  }

  try {
    const { executeTypesSlicesDB } = await import('./types/subcommands/slices');
    const slicesOptionsRaw = {
      json: options.json,
      minSupport: options.minSupport,
      minSliceSize: options.minSliceSize,
      maxSliceSize: options.maxSliceSize,
      considerMethods: options.considerMethods,
      excludeCommon: !options.noExcludeCommon,
      benefit: options.benefit as "low" | "medium" | "high" | undefined,
      limit: options.limit,
      sort: options.sort as "types" | "impact" | "overlap" | undefined,
      desc: options.desc,
      verbose: options.verbose,
      quiet: options.quiet
    };
    const slicesOptions = filterUndefined(slicesOptionsRaw) as import('./types.types').TypeSlicesOptions;
    await executeTypesSlicesDB(slicesOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Property slices analysis completed');
    }
  } catch (error) {
    throw new Error(`Property slices analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute subsumption analysis
 */
async function executeSubsume(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🎯 Analyzing structural subsumption and containment relationships...');
  }

  try {
    const { executeTypesSubsumeDB } = await import('./types/subcommands/subsume');
    const subsumeOptionsRaw = {
      json: options.json,
      minOverlap: options.minOverlap,
      includePartial: !options.noIncludePartial,
      showRedundant: options.showRedundant,
      considerMethods: options.considerMethods,
      limit: options.limit,
      sort: options.sort as "types" | "impact" | "overlap" | undefined,
      desc: options.desc,
      verbose: options.verbose,
      quiet: options.quiet
    };
    const subsumeOptions = filterUndefined(subsumeOptionsRaw) as import('./types.types').TypeSubsumeOptions;
    await executeTypesSubsumeDB(subsumeOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Subsumption analysis completed');
    }
  } catch (error) {
    throw new Error(`Subsumption analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute behavioral fingerprint analysis
 */
async function executeFingerprint(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔍 Analyzing behavioral fingerprints and function clustering...');
  }

  try {
    const { executeTypesFingerprintDB } = await import('./types/subcommands/fingerprint');
    const fingerprintOptionsRaw = {
      json: options.json,
      includeCallsOut: !options.noIncludeCallsOut,
      includeCallsIn: !options.noIncludeCallsIn,
      minCallFrequency: options.minCallFrequency,
      similarityThreshold: options.similarityThreshold,
      maxFingerprintSize: options.maxFingerprintSize,
      includeInternalCalls: options.includeInternalCalls,
      limit: options.limit,
      sort: options.sort as "size" | "impact" | "similarity" | undefined,
      desc: options.desc,
      verbose: options.verbose,
      quiet: options.quiet
    };
    const fingerprintOptions = filterUndefined(fingerprintOptionsRaw) as import('./types.types').TypeFingerprintOptions;
    await executeTypesFingerprintDB(fingerprintOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Behavioral fingerprint analysis completed');
    }
  } catch (error) {
    throw new Error(`Behavioral fingerprint analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type conversion network analysis
 */
async function executeConverters(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔄 Analyzing type conversion networks and canonical types...');
  }

  try {
    const { executeTypesConvertersDB } = await import('./types/subcommands/converters');
    const convertersOptionsRaw = {
      json: options.json,
      minConverters: options.minConverters,
      includeInternalCalls: !options.noIncludeInternalCalls,
      includeParsers: !options.noIncludeParsers,
      showChains: options.showChains,
      canonicalOnly: options.canonicalOnly,
      maxChainLength: options.maxChainLength,
      limit: options.limit,
      sort: options.sort as "usage" | "converters" | "centrality" | undefined,
      desc: options.desc,
      verbose: options.verbose,
      quiet: options.quiet
    };
    const convertersOptions = filterUndefined(convertersOptionsRaw) as import('./types.types').TypeConvertersOptions;
    await executeTypesConvertersDB(convertersOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type conversion network analysis completed');
    }
  } catch (error) {
    throw new Error(`Type conversion network analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type co-change analysis
 */
async function executeCochange(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📈 Analyzing type co-evolution patterns from Git history...');
  }

  try {
    const { executeTypesCochangeDB } = await import('./types/subcommands/cochange');
    const cochangeOptionsRaw = {
      json: options.json,
      monthsBack: options.monthsBack,
      minChanges: options.minChanges,
      cochangeThreshold: options.cochangeThreshold,
      showMatrix: options.showMatrix,
      suggestModules: !options.noSuggestModules,
      maxCommits: options.maxCommits,
      excludePaths: options.excludePaths ? options.excludePaths.split(',') : undefined,
      limit: options.limit,
      sort: options.sort as string | undefined,
      desc: options.desc,
      verbose: options.verbose,
      quiet: options.quiet
    };
    const cochangeOptions = filterUndefined(cochangeOptionsRaw) as import('./types.types').TypeCochangeOptions;
    await executeTypesCochangeDB(cochangeOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type co-change analysis completed');
    }
  } catch (error) {
    throw new Error(`Type co-change analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute types overview (default action)
 */
async function executeOverview(env: CommandEnvironment, options: TypesCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📊 Displaying TypeScript type analysis capabilities overview...');
  }

  const overview = {
    title: 'TypeScript Type Analysis & Design Intelligence',
    availableActions: [
      'list         - List and filter TypeScript types with advanced criteria',
      'health       - Analyze type system health and quality metrics',  
      'deps         - Analyze type dependencies and circular references',
      'api          - Evaluate type API design and surface area optimization',
      'members      - Show detailed type member information and modifiers',
      'coverage     - Analyze property usage coverage and access patterns',
      'cluster      - Discover property clustering and co-occurrence patterns',
      'risk         - Assess dependency risk and change impact analysis',
      'insights     - Comprehensive type analysis combining all insights',
      'slices       - Discover reusable property patterns across types',
      'subsume      - Analyze structural subsumption and containment relationships',
      'fingerprint  - Analyze behavioral fingerprints and function clustering',
      'converters   - Analyze type conversion networks and canonical types',
      'cochange     - Analyze type co-evolution patterns from Git history'
    ],
    examples: [
      'funcqc types --action=list --kind=interface --prop-ge=5',
      'funcqc types --action=health --verbose',
      'funcqc types --action=deps --type-name="UserProfile" --depth=3',
      'funcqc types --action=api --type-name="ApiResponse" --optimize',
      'funcqc types --action=members --type-name="BaseEntity" --detail',
      'funcqc types --action=coverage --type-name="OrderDTO" --hot-threshold=10',
      'funcqc types --action=cluster --type-name="Product" --similarity-threshold=0.8',
      'funcqc types --action=slices --min-support=3 --benefit=high',
      'funcqc types --action=subsume --min-overlap=0.7 --show-redundant',
      'funcqc types --action=cochange --months-back=12 --show-matrix'
    ],
    capabilities: {
      'Type Discovery & Filtering': [
        'Advanced type listing with property/method count filters',
        'Kind-based filtering (interface, class, type alias, enum)',
        'Export status and generic type detection',
        'Complex member count queries and sorting',
        'File path and name pattern matching'
      ],
      'Type System Health': [
        'Type complexity and maintainability scoring',
        'Violation detection and threshold analysis',
        'Type usage pattern assessment',
        'Design quality metrics and recommendations'
      ],
      'Dependency Analysis': [
        'Type dependency graph construction',
        'Circular dependency detection and resolution',
        'Dependency depth analysis with configurable limits',
        'Change impact assessment for type modifications'
      ],
      'API Design Intelligence': [
        'Type surface area analysis and optimization',
        'Method and property design pattern detection',
        'API usability scoring and recommendations',
        'Breaking change risk assessment'
      ],
      'Usage Pattern Mining': [
        'Property access frequency analysis',
        'Hot property identification and write hubs',
        'Usage clustering and co-occurrence patterns',
        'Behavioral fingerprint analysis'
      ],
      'Structural Intelligence': [
        'Property pattern discovery across types',
        'Subsumption relationship analysis',
        'Type conversion network mapping',
        'Canonical type identification'
      ],
      'Evolution Analysis': [
        'Type co-change pattern mining from Git history',
        'Volatility assessment and change frequency',
        'Module reorganization suggestions',
        'Historical coupling analysis'
      ]
    }
  };

  if (options.json) {
    console.log(JSON.stringify(overview, null, 2));
  } else {
    console.log(`\n🧩 ${overview.title}\n`);
    console.log('📋 Available Actions:');
    overview.availableActions.forEach(action => {
      console.log(`   • ${action}`);
    });
    
    console.log('\n💡 Usage Examples:');
    overview.examples.forEach(example => {
      console.log(`   ${example}`);
    });
    
    console.log('\n🚀 Capabilities:');
    Object.entries(overview.capabilities).forEach(([category, items]) => {
      console.log(`\n   ${category}:`);
      items.forEach(item => {
        console.log(`     • ${item}`);
      });
    });
    
    console.log('\n🎯 Quick Start:');
    console.log('   • --action=list --prop-ge=5              # Find complex types with many properties');
    console.log('   • --action=health --verbose              # Comprehensive type system health check');
    console.log('   • --action=deps --type-name=<Type>       # Analyze specific type dependencies');
    console.log('   • --action=slices --benefit=high         # Find valuable property extraction opportunities');
    console.log('   • --action=subsume --show-redundant      # Identify duplicate or redundant types');
  }
  
  if (!options.quiet) {
    env.commandLogger.info('✅ Types overview completed');
  }
}