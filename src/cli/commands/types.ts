import { Command } from 'commander';
import { TypeListOptions, TypeHealthOptions, TypeDepsOptions, TypeApiOptions, TypeMembersOptions, TypeCoverageOptions, TypeClusterOptions, TypeRiskOptions, TypeInsightsOptions, TypeSlicesOptions, TypeSubsumeOptions, TypeFingerprintOptions, TypeConvertersOptions, TypeCochangeOptions } from './types.types';
import { executeTypesListDB } from './types/subcommands/list';
import { executeTypesHealthDB } from './types/subcommands/health';
import { executeTypesDepsDB } from './types/subcommands/deps';
import { executeTypesApiDB } from './types/subcommands/api';
import { executeTypesMembersDB } from './types/subcommands/members';
import { executeTypesCoverageDB } from './types/subcommands/coverage';
import { executeTypesRiskDB } from './types/subcommands/risk';
import { executeTypesClusterDB } from './types/subcommands/cluster';
import { executeTypesInsightsDB } from './types/subcommands/insights';
import { executeTypesSlicesDB } from './types/subcommands/slices';
import { executeTypesSubsumeDB } from './types/subcommands/subsume';
import { executeTypesFingerprintDB } from './types/subcommands/fingerprint';
import { executeTypesConvertersDB } from './types/subcommands/converters';
import { executeTypesCochangeDB } from './types/subcommands/cochange';

/**
 * Database-driven types command
 * Uses stored type information from scan phase instead of real-time analysis
 */
export function createTypesCommand(): Command {
  const typesCmd = new Command('types [command]')
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
// executeTypesListDB function is now imported from subcommands/list

// executeTypesHealthDB function is now imported from subcommands/health

// executeTypesDepsDB function is now imported from subcommands/deps

// executeTypesApiDB function is now imported from subcommands/api

// executeTypesMembersDB function is now imported from subcommands/members

// executeTypesCoverageDB function is now imported from subcommands/coverage

// executeTypesClusterDB function is now imported from subcommands/cluster

// executeTypesRiskDB function is now imported from subcommands/risk

// executeTypesInsightsDB function is now imported from subcommands/insights

// Helper types and functions


// CouplingInfo interface is now imported from shared/list-operations

// TypeHealthReport interface is now imported from shared/health-operations


// MemberCounts interface is now imported from shared/filters

// getMemberCountsForTypes function is now imported from shared/list-operations

// applyTypeFilters function is now imported from shared/filters

// sortTypesDB function is now imported from shared/list-operations

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
    const idx = key.lastIndexOf(':');
    let functionId: string;
    let parameterName: string;
    if (idx === -1) {
      // 異常系: 区切りが無い場合は安全側に倒す
      functionId = key;
      parameterName = '';
    } else {
      functionId = key.slice(0, idx);
      parameterName = key.slice(idx + 1);
    }
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

// calculateTypeHealthFromDB function is now imported from shared/health-operations

// analyzeDependenciesFromDB function is now imported from shared/dependency-operations

// findCircularDependencies function is now imported from shared/dependency-operations

// displayTypesListDB function is now imported from shared/list-operations

// displayTypeHealthDB function is now imported from shared/health-operations

// displayCircularDependenciesDB and displayDependenciesDB functions are now imported from shared/dependency-operations

// Formatter functions are now imported from shared/formatters

// Type API analysis and member detail interfaces are now defined in subcommands

// analyzeTypeApiSurface function is now in subcommands/api

// getTypeMembersDetailed function is now in subcommands/members

// displayTypeApiAnalysis function is now in subcommands/api

// displayTypeMembersAnalysis function is now in subcommands/members

// getMemberKindIcon and getAccessModifierIcon functions are now imported from shared/formatters

// formatIntegratedInsightsReport function is now in subcommands/insights

// getRiskIcon function is now imported from shared/formatters

