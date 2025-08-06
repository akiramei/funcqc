import { Command } from 'commander';
import { Project } from 'ts-morph';
import { TypeAnalyzer, TypeDefinition } from '../../analyzers/type-analyzer';
import { TypeDependencyAnalyzer, TypeDependency } from '../../analyzers/type-dependency-analyzer';
import { TypeMetricsCalculator, TypeQualityScore, TypeHealthReport } from '../../analyzers/type-metrics-calculator';
import { ConfigManager } from '../../core/config';
import { Logger } from '../../utils/cli-utils';
import * as fs from 'fs';
import * as path from 'path';

interface TypeListOptions {
  kind?: string;
  exported?: boolean;
  generic?: boolean;
  file?: string;
  limit?: number;
  sort?: 'name' | 'fields' | 'complexity' | 'usage';
  desc?: boolean;
  json?: boolean;
}

interface TypeHealthOptions {
  verbose?: boolean;
  json?: boolean;
  thresholds?: string;
}

interface TypeDepsOptions {
  depth?: number;
  circular?: boolean;
  json?: boolean;
}

/**
 * Types command - independent type analysis functionality
 * Completely separate from function analysis to maintain system integrity
 */
export function createTypesCommand(): Command {
  const typesCmd = new Command('types')
    .description('🧩 TypeScript type analysis (experimental)')
    .addHelpText('before', '⚠️  This is an experimental feature for TypeScript type analysis');

  // List types command
  typesCmd
    .command('list')
    .description('📋 List TypeScript types with filtering options')
    .option('--kind <kind>', 'Filter by type kind (interface|class|type_alias|enum|namespace)')
    .option('--exported', 'Show only exported types')
    .option('--generic', 'Show only generic types')
    .option('--file <path>', 'Filter by file path')
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--sort <field>', 'Sort by field (name|fields|complexity|usage)', 'name')
    .option('--desc', 'Sort in descending order')
    .option('--json', 'Output in JSON format')
    .action(async (options: TypeListOptions) => {
      await executeTypesList(options);
    });

  // Type health command
  typesCmd
    .command('health')
    .description('🏥 Analyze type quality and health metrics')
    .option('--verbose', 'Show detailed health information')
    .option('--json', 'Output in JSON format')
    .option('--thresholds <path>', 'Path to custom thresholds file')
    .action(async (options: TypeHealthOptions) => {
      await executeTypesHealth(options);
    });

  // Type dependencies command
  typesCmd
    .command('deps <typeName>')
    .description('🔗 Analyze type dependencies and usage')
    .option('--depth <number>', 'Maximum dependency depth to analyze', parseInt, 3)
    .option('--circular', 'Show only circular dependencies')
    .option('--json', 'Output in JSON format')
    .action(async (typeName: string, options: TypeDepsOptions) => {
      await executeTypesDeps(typeName, options);
    });

  return typesCmd;
}

/**
 * Execute types list command
 */
export async function executeTypesList(options: TypeListOptions): Promise<void> {
  const logger = new Logger();
  
  try {
    logger.info('🔍 Analyzing TypeScript types...');
    
    const { types } = await analyzeProjectTypes();
    let filteredTypes = types;

    // Apply filters
    if (options.kind) {
      filteredTypes = filteredTypes.filter(t => t.kind === options.kind);
    }
    
    if (options.exported) {
      filteredTypes = filteredTypes.filter(t => t.isExported);
    }
    
    if (options.generic) {
      filteredTypes = filteredTypes.filter(t => t.isGeneric);
    }
    
    if (options.file) {
      filteredTypes = filteredTypes.filter(t => t.filePath.includes(options.file!));
    }

    // Sort types
    filteredTypes = sortTypes(filteredTypes, options.sort || 'name', options.desc);

    // Apply limit
    if (options.limit && options.limit > 0) {
      filteredTypes = filteredTypes.slice(0, options.limit);
    }

    if (options.json) {
      console.log(JSON.stringify(filteredTypes, null, 2));
    } else {
      displayTypesList(filteredTypes);
    }

  } catch (error) {
    logger.error('❌ Failed to analyze types:', error);
    process.exit(1);
  }
}

/**
 * Execute types health command
 */
export async function executeTypesHealth(options: TypeHealthOptions): Promise<void> {
  const logger = new Logger();
  
  try {
    logger.info('🏥 Analyzing type health...');
    
    const { types, dependencies } = await analyzeProjectTypes();
    
    // Load custom thresholds if provided
    let thresholds = {};
    if (options.thresholds && fs.existsSync(options.thresholds)) {
      thresholds = JSON.parse(fs.readFileSync(options.thresholds, 'utf-8'));
    }

    const calculator = new TypeMetricsCalculator(thresholds);
    const dependencyAnalyzer = new TypeDependencyAnalyzer(new Project());
    
    // Calculate type quality scores
    const typeScores: TypeQualityScore[] = [];
    for (const type of types) {
      const metrics = new TypeAnalyzer(new Project()).calculateTypeMetrics(type);
      const typeDependencies = dependencies.filter(d => d.sourceTypeId === type.id);
      const score = calculator.calculateTypeQuality(type, metrics, undefined, typeDependencies);
      typeScores.push(score);
    }

    // Detect circular dependencies
    const circularDeps = dependencyAnalyzer.detectCircularDependencies(dependencies);
    
    // Generate health report
    const healthReport = calculator.generateHealthReport(typeScores, circularDeps);

    if (options.json) {
      console.log(JSON.stringify({
        healthReport,
        typeScores: options.verbose ? typeScores : undefined
      }, null, 2));
    } else {
      displayHealthReport(healthReport, typeScores, options.verbose);
    }

  } catch (error) {
    logger.error('❌ Failed to analyze type health:', error);
    process.exit(1);
  }
}

/**
 * Execute types deps command
 */
export async function executeTypesDeps(typeName: string, options: TypeDepsOptions): Promise<void> {
  const logger = new Logger();
  
  try {
    logger.info(`🔗 Analyzing dependencies for type: ${typeName}`);
    
    const { types, dependencies } = await analyzeProjectTypes();
    const targetType = types.find(t => t.name === typeName);
    
    if (!targetType) {
      logger.error(`❌ Type '${typeName}' not found`);
      process.exit(1);
    }

    const dependencyAnalyzer = new TypeDependencyAnalyzer(new Project());
    dependencyAnalyzer.setTypeDefinitions(types);

    if (options.circular) {
      const circularDeps = dependencyAnalyzer.detectCircularDependencies(dependencies);
      const typeCircularDeps = circularDeps.filter(cd => 
        cd.typeNames.includes(typeName)
      );

      if (options.json) {
        console.log(JSON.stringify(typeCircularDeps, null, 2));
      } else {
        displayCircularDependencies(typeCircularDeps as unknown as Array<Record<string, unknown>>);
      }
    } else {
      const typeDependencies = dependencies.filter(d => 
        d.sourceTypeId === targetType.id || 
        types.find(t => t.name === d.targetTypeName)?.id === targetType.id
      );

      if (options.json) {
        console.log(JSON.stringify(typeDependencies, null, 2));
      } else {
        displayTypeDependencies(typeName, typeDependencies, types);
      }
    }

  } catch (error) {
    logger.error('❌ Failed to analyze type dependencies:', error);
    process.exit(1);
  }
}

/**
 * Analyze project types and dependencies
 */
async function analyzeProjectTypes(): Promise<{
  types: TypeDefinition[];
  dependencies: TypeDependency[];
  project: Project;
}> {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  
  // Create ts-morph project
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });

  // Find TypeScript files
  const typeScriptFiles: string[] = [];
  for (const root of config.roots || ['src']) {
    if (fs.existsSync(root)) {
      findTypeScriptFiles(root, typeScriptFiles);
    }
  }

  // Add files to project
  for (const filePath of typeScriptFiles) {
    try {
      project.addSourceFileAtPath(filePath);
    } catch {
      console.warn(`⚠️  Could not add file: ${filePath}`);
    }
  }

  const typeAnalyzer = new TypeAnalyzer(project);
  const dependencyAnalyzer = new TypeDependencyAnalyzer(project);
  
  // Analyze types
  const allTypes: TypeDefinition[] = [];
  const allDependencies: TypeDependency[] = [];
  
  const snapshotId = 'type-analysis-' + Date.now();
  
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const types = typeAnalyzer.analyzeFile(filePath, snapshotId);
    allTypes.push(...types);
  }

  // Set type definitions context for dependency analysis
  dependencyAnalyzer.setTypeDefinitions(allTypes);
  
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const dependencies = dependencyAnalyzer.analyzeDependencies(filePath, snapshotId);
    allDependencies.push(...dependencies);
  }

  return {
    types: allTypes,
    dependencies: allDependencies,
    project
  };
}

/**
 * Find TypeScript files recursively
 */
function findTypeScriptFiles(dir: string, files: string[]): void {
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
      findTypeScriptFiles(itemPath, files);
    } else if (item.endsWith('.ts') || item.endsWith('.tsx')) {
      files.push(itemPath);
    }
  }
}

/**
 * Sort types based on specified criteria
 */
function sortTypes(types: TypeDefinition[], sortBy: string, desc?: boolean): TypeDefinition[] {
  const sorted = [...types].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'fields': {
        const aFields = (a.metadata['propertyCount'] as number || 0) + (a.metadata['methodCount'] as number || 0);
        const bFields = (b.metadata['propertyCount'] as number || 0) + (b.metadata['methodCount'] as number || 0);
        comparison = aFields - bFields;
        break;
      }
      case 'complexity': {
        // Basic complexity heuristic
        const aComplexity = a.genericParameters.length + (a.typeText?.length || 0) / 100;
        const bComplexity = b.genericParameters.length + (b.typeText?.length || 0) / 100;
        comparison = aComplexity - bComplexity;
        break;
      }
      default:
        comparison = a.name.localeCompare(b.name);
    }
    
    return desc ? -comparison : comparison;
  });
  
  return sorted;
}

/**
 * Display types list in formatted output
 */
function displayTypesList(types: TypeDefinition[]): void {
  if (types.length === 0) {
    console.log('📭 No types found matching the criteria');
    return;
  }

  console.log(`\n📋 Found ${types.length} types:\n`);
  
  for (const type of types) {
    const kindIcon = getKindIcon(type.kind);
    const exportStatus = type.isExported ? '🌐' : '🔒';
    const genericStatus = type.isGeneric ? `<${type.genericParameters.join(', ')}>` : '';
    
    console.log(`${kindIcon} ${exportStatus} ${type.name}${genericStatus}`);
    console.log(`   📁 ${type.filePath}:${type.startLine}`);
    
    if (type.metadata['propertyCount'] || type.metadata['methodCount']) {
      const props = type.metadata['propertyCount'] as number || 0;
      const methods = type.metadata['methodCount'] as number || 0;
      console.log(`   📊 ${props} properties, ${methods} methods`);
    }
    
    console.log('');
  }
}

/**
 * Display health report
 */
function displayHealthReport(
  healthReport: TypeHealthReport,
  typeScores: TypeQualityScore[],
  verbose?: boolean
): void {
  console.log(`\n🏥 Type Health Report\n`);
  console.log(`📊 Overall Health: ${healthReport.overallHealth}/100`);
  console.log(`📦 Total Types: ${healthReport.totalTypes}`);
  
  console.log(`\n🚨 Risk Distribution:`);
  console.log(`   🟢 Low Risk: ${healthReport.riskDistribution.low}`);
  console.log(`   🟡 Medium Risk: ${healthReport.riskDistribution.medium}`);
  console.log(`   🟠 High Risk: ${healthReport.riskDistribution.high}`);
  console.log(`   🔴 Critical Risk: ${healthReport.riskDistribution.critical}`);

  if (healthReport.circularDependencies.length > 0) {
    console.log(`\n🔄 Circular Dependencies: ${healthReport.circularDependencies.length}`);
  }

  const topIssues = healthReport.topIssues;
  if (topIssues.length > 0) {
    console.log(`\n⚠️  Top Issues:`);
    topIssues.slice(0, 5).forEach((issue, index: number) => {
      const severityIcon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '💡';
      console.log(`   ${index + 1}. ${severityIcon} ${issue.message}`);
      if (issue.suggestion) {
        console.log(`      💡 ${issue.suggestion}`);
      }
    });
  }

  const recommendations = healthReport.recommendations;
  if (recommendations.length > 0) {
    console.log(`\n💡 Recommendations:`);
    recommendations.forEach((rec: string, index: number) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
  }

  if (verbose && typeScores.length > 0) {
    console.log(`\n📋 Individual Type Scores:`);
    typeScores
      .sort((a, b) => a.overallScore - b.overallScore)
      .slice(0, 10)
      .forEach(score => {
        const riskIcon = getRiskIcon(score.riskLevel);
        console.log(`   ${riskIcon} ${score.typeName}: ${score.overallScore}/100`);
      });
  }
}

/**
 * Display circular dependencies
 */
function displayCircularDependencies(circularDeps: Array<Record<string, unknown>>): void {
  if (circularDeps.length === 0) {
    console.log('✅ No circular dependencies found');
    return;
  }

  console.log(`\n🔄 Found ${circularDeps.length} circular dependencies:\n`);
  
  circularDeps.forEach((cycle, index) => {
    const severityIcon = cycle['severity'] === 'error' ? '🔴' : '🟡';
    const typeNames = cycle['typeNames'] as string[];
    console.log(`${index + 1}. ${severityIcon} ${typeNames.join(' → ')}`);
  });
}

/**
 * Display type dependencies
 */
function displayTypeDependencies(
  typeName: string,
  dependencies: TypeDependency[],
  _allTypes: TypeDefinition[]
): void {
  console.log(`\n🔗 Dependencies for type: ${typeName}\n`);
  
  if (dependencies.length === 0) {
    console.log('📭 No dependencies found');
    return;
  }

  dependencies.forEach((dep, index) => {
    const kindIcon = getDepKindIcon(dep.dependencyKind);
    console.log(`${index + 1}. ${kindIcon} ${dep.dependencyKind}: ${dep.targetTypeName}`);
    console.log(`   📁 ${dep.filePath}${dep.lineNumber ? `:${dep.lineNumber}` : ''}`);
  });
}

/**
 * Get icon for type kind
 */
function getKindIcon(kind: string): string {
  switch (kind) {
    case 'interface': return '📐';
    case 'class': return '🏗️';
    case 'type_alias': return '🔗';
    case 'enum': return '📋';
    case 'namespace': return '📦';
    default: return '❓';
  }
}

/**
 * Get icon for risk level
 */
function getRiskIcon(riskLevel: string): string {
  switch (riskLevel) {
    case 'low': return '🟢';
    case 'medium': return '🟡';
    case 'high': return '🟠';
    case 'critical': return '🔴';
    default: return '❓';
  }
}

/**
 * Get icon for dependency kind
 */
function getDepKindIcon(kind: string): string {
  switch (kind) {
    case 'extends': return '⬆️';
    case 'implements': return '🔌';
    case 'property': return '📝';
    case 'parameter': return '📥';
    case 'return': return '📤';
    case 'union_member': return '🔀';
    case 'intersection_member': return '🔗';
    default: return '🔗';
  }
}