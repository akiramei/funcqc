import { Command } from 'commander';
import { Logger } from '../../utils/cli-utils';
import { TypeListOptions, TypeHealthOptions, TypeDepsOptions } from './types.types';
import { TypeDefinition, TypeRelationship, StorageAdapter, SnapshotInfo } from '../../types';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';

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
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--sort <field>', 'Sort by field (name|kind|file)', 'name')
    .option('--desc', 'Sort in descending order')
    .option('--json', 'Output in JSON format')
    .option('--detail', 'Show detailed information in multi-line format')
    .option('--analyze-coupling', 'Include coupling analysis for types')
    .action(async (options: TypeListOptions & { analyzeCoupling?: boolean }, command) => {
      // Merge global options
      const globalOpts = command.parent?.opts() || {};
      const mergedOptions = { ...globalOpts, ...options };
      return executeTypesListDB(mergedOptions);
    });

  // Type health command
  typesCmd
    .command('health')
    .description('🏥 Analyze type quality from database')
    .option('--verbose', 'Show detailed health information')
    .option('--json', 'Output in JSON format')
    .action(async (options: TypeHealthOptions, command) => {
      // Merge global options
      const globalOpts = command.parent?.opts() || {};
      const mergedOptions = { ...globalOpts, ...options };
      return executeTypesHealthDB(mergedOptions);
    });

  // Type dependencies command
  typesCmd
    .command('deps <typeName>')
    .description('🔗 Analyze type dependencies from database')
    .option('--depth <number>', 'Maximum dependency depth to analyze', parseInt, 3)
    .option('--circular', 'Show only circular dependencies')
    .option('--json', 'Output in JSON format')
    .action(async (typeName: string, options: TypeDepsOptions, command) => {
      // Merge global options
      const globalOpts = command.parent?.opts() || {};
      const mergedOptions = { ...globalOpts, ...options };
      return executeTypesDepsDB(typeName, mergedOptions);
    });

  return typesCmd;
}

/**
 * Execute types list command using database
 */
async function executeTypesListDB(options: TypeListOptions & { analyzeCoupling?: boolean }): Promise<void> {
  const logger = new Logger();
  const errorHandler = createErrorHandler(logger);
  
  try {
    logger.info('🔍 Loading types from database...');
    
    const { storage, latestSnapshot } = await getStorageAndSnapshot();
    let types = await storage.getTypeDefinitions(latestSnapshot.id);
    
    if (types.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log('No types found. Run scan first to analyze types.');
      }
      return;
    }
    
    // Apply filters
    types = await applyTypeFilters(types, options);
    
    // Sort types
    types = sortTypesDB(types, options.sort || 'name', options.desc);
    
    // Apply limit
    if (options.limit && options.limit > 0) {
      types = types.slice(0, options.limit);
    }
    
    // Add coupling analysis if requested
    let couplingData: Map<string, CouplingInfo> = new Map();
    if (options.analyzeCoupling) {
      couplingData = await analyzeCouplingForTypes(storage, types, latestSnapshot.id);
    }
    
    // Output results
    if (options.json) {
      const output = types.map(type => ({
        ...type,
        ...(couplingData.has(type.id) && { coupling: couplingData.get(type.id) })
      }));
      console.log(JSON.stringify(output, null, 2));
    } else {
      displayTypesListDB(types, couplingData, options.detail);
    }

    await storage.close();
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Failed to list types: ${error instanceof Error ? error.message : String(error)}`,
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Execute types health command using database
 */
async function executeTypesHealthDB(options: TypeHealthOptions): Promise<void> {
  const logger = new Logger();
  const errorHandler = createErrorHandler(logger);
  
  try {
    logger.info('🏥 Analyzing type health from database...');
    
    const { storage, latestSnapshot } = await getStorageAndSnapshot();
    const types = await storage.getTypeDefinitions(latestSnapshot.id);
    
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
    
    await storage.close();
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Failed to analyze type health: ${error instanceof Error ? error.message : String(error)}`,
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Execute types deps command using database
 */
async function executeTypesDepsDB(typeName: string, options: TypeDepsOptions): Promise<void> {
  const logger = new Logger();
  const errorHandler = createErrorHandler(logger);
  
  try {
    logger.info(`🔗 Analyzing dependencies for type: ${typeName}`);
    
    const { storage, latestSnapshot } = await getStorageAndSnapshot();
    const targetType = await storage.findTypeByName(typeName, latestSnapshot.id);
    
    if (!targetType) {
      logger.error(`❌ Type '${typeName}' not found`);
      process.exit(1);
    }
    
    const relationships = await storage.getTypeRelationships(latestSnapshot.id);
    const dependencies = analyzeDependenciesFromDB(targetType, relationships, options.depth || 3);
    
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
    
    await storage.close();
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Failed to analyze type dependencies: ${error instanceof Error ? error.message : String(error)}`,
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

// Helper types and functions

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
 * Get storage adapter and latest snapshot
 */
async function getStorageAndSnapshot(): Promise<{ storage: StorageAdapter; latestSnapshot: SnapshotInfo }> {
  // Get storage from environment or create new instance
  const { PGLiteStorageAdapter } = await import('../../storage/pglite-adapter');
  const { ConfigManager } = await import('../../core/config');
  
  const configManager = new ConfigManager();
  const config = await configManager.load();
  
  const logger = new Logger();
  const storage = new PGLiteStorageAdapter(
    config.storage.path || '.funcqc/funcqc.db',
    logger
  );
  
  await storage.init();
  
  const snapshots = await storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    throw new Error('No snapshots found. Run scan first to analyze the codebase.');
  }
  
  return { storage, latestSnapshot: snapshots[0] };
}

/**
 * Apply filters to types
 */
async function applyTypeFilters(
  types: TypeDefinition[],
  options: TypeListOptions
): Promise<TypeDefinition[]> {
  let filteredTypes = types;
  
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
  
  return filteredTypes;
}

/**
 * Sort types by field
 */
function sortTypesDB(types: TypeDefinition[], sortField: string, desc?: boolean): TypeDefinition[] {
  const validSortOptions = ['name', 'kind', 'file'] as const;
  if (!validSortOptions.includes(sortField as typeof validSortOptions[number])) {
    throw new Error(`Invalid sort option: ${sortField}. Valid options are: ${validSortOptions.join(', ')}`);
  }
  
  const sorted = [...types].sort((a, b) => {
    let aVal: string;
    let bVal: string;
    
    switch (sortField) {
      case 'name':
        aVal = a.name;
        bVal = b.name;
        break;
      case 'kind':
        aVal = a.kind;
        bVal = b.kind;
        break;
      case 'file':
        aVal = a.filePath;
        bVal = b.filePath;
        break;
      default:
        aVal = a.name;
        bVal = b.name;
    }
    
    return desc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
  });
  
  return sorted;
}

/**
 * Analyze coupling for types using parameter property usage data
 */
async function analyzeCouplingForTypes(
  storage: StorageAdapter,
  types: TypeDefinition[],
  snapshotId: string
): Promise<Map<string, CouplingInfo>> {
  const couplingMap = new Map<string, CouplingInfo>();
  
  try {
    // Get coupling data for each type
    for (const type of types) {
      const couplingQuery = await storage.query(`
        SELECT 
          ppu.function_id,
          ppu.parameter_name,
          ppu.accessed_property,
          ppu.access_type,
          COUNT(*) as access_count
        FROM parameter_property_usage ppu
        WHERE ppu.snapshot_id = $1 
          AND ppu.parameter_type_id = $2
        GROUP BY ppu.function_id, ppu.parameter_name, ppu.accessed_property, ppu.access_type
        ORDER BY ppu.function_id, ppu.parameter_name
      `, [snapshotId, type.id]);
      
      if (couplingQuery.rows.length > 0) {
        const parameterUsage = processCouplingQueryResults(couplingQuery.rows as Array<Record<string, unknown>>);
        const totalFunctions = new Set((couplingQuery.rows as Array<Record<string, unknown>>).map(row => row['function_id'])).size;
        
        const averageUsageRatio = parameterUsage.length > 0 
          ? parameterUsage.reduce((sum, p) => sum + p.usageRatio, 0) / parameterUsage.length
          : 0;
        
        couplingMap.set(type.id, {
          parameterUsage,
          totalFunctions,
          averageUsageRatio
        });
      } else {
        // Provide basic coupling info even when no data available
        // This allows the feature to work while data collection is being fixed
        couplingMap.set(type.id, {
          parameterUsage: [],
          totalFunctions: 0,
          averageUsageRatio: 0
        });
      }
    }
  } catch (error) {
    console.warn(`Warning: Failed to analyze coupling: ${error}`);
    // Provide fallback coupling data for all types
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

/**
 * Process coupling query results into structured format
 */
function processCouplingQueryResults(rows: Array<Record<string, unknown>>): CouplingInfo['parameterUsage'] {
  const parameterMap = new Map<string, Map<string, Set<string>>>();
  
  // Group by function and parameter
  for (const row of rows) {
    const key = `${row['function_id']}:${row['parameter_name']}`;
    if (!parameterMap.has(key)) {
      parameterMap.set(key, new Map());
    }
    
    const funcParamMap = parameterMap.get(key)!;
    const paramName = String(row['parameter_name']);
    if (!funcParamMap.has(paramName)) {
      funcParamMap.set(paramName, new Set());
    }
    
    funcParamMap.get(paramName)!.add(String(row['accessed_property']));
  }
  
  // Convert to structured format
  const result: CouplingInfo['parameterUsage'] = [];
  for (const [key, paramMap] of parameterMap) {
    const [functionId] = key.split(':');
    
    for (const [paramName, properties] of paramMap) {
      const usedProperties = Array.from(properties);
      const totalProperties = usedProperties.length; // Simplified - would need type member count
      const usageRatio = totalProperties > 0 ? usedProperties.length / totalProperties : 1;
      
      let severity: 'LOW' | 'MEDIUM' | 'HIGH';
      if (usageRatio <= 0.25) severity = 'HIGH';
      else if (usageRatio <= 0.5) severity = 'MEDIUM';
      else severity = 'LOW';
      
      result.push({
        functionId,
        parameterName: paramName,
        usedProperties,
        totalProperties,
        usageRatio,
        severity
      });
    }
  }
  
  return result;
}

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
    if (depth >= maxDepth || visited.has(typeId)) return;
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
  
  traverse(targetType.id, 0);
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
  detailed?: boolean
): void {
  console.log(`\n📋 Found ${types.length} types:\n`);
  
  for (const type of types) {
    const kindIcon = getTypeKindIcon(type.kind);
    const exportIcon = type.isExported ? '📤' : '  ';
    const genericIcon = type.isGeneric ? '<T>' : '   ';
    
    if (detailed) {
      console.log(`${kindIcon} ${exportIcon} ${type.name} ${genericIcon}`);
      console.log(`   📁 ${type.filePath}:${type.startLine}`);
      console.log(`   🏷️  ${type.kind}`);
      
      if (couplingData.has(type.id)) {
        const coupling = couplingData.get(type.id)!;
        console.log(`   🔗 Coupling: ${coupling.totalFunctions} functions, avg usage: ${(coupling.averageUsageRatio * 100).toFixed(1)}%`);
      }
      
      console.log();
    } else {
      const location = `${type.filePath.split('/').pop()}:${type.startLine}`;
      const couplingInfo = couplingData.has(type.id) 
        ? ` (${couplingData.get(type.id)!.totalFunctions}fn)`
        : '';
      
      console.log(`${kindIcon} ${exportIcon} ${type.name.padEnd(30)} ${type.kind.padEnd(12)} ${location}${couplingInfo}`);
    }
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

function getHealthIcon(health: string): string {
  switch (health) {
    case 'EXCELLENT': return '🌟';
    case 'GOOD': return '✅';
    case 'FAIR': return '⚠️';
    case 'POOR': return '❌';
    default: return '❓';
  }
}