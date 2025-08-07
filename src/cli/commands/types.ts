import { Command } from 'commander';
import { Project } from 'ts-morph';
import { TypeAnalyzer, TypeDefinition } from '../../analyzers/type-analyzer';
import { TypeDependencyAnalyzer, TypeDependency } from '../../analyzers/type-dependency-analyzer';
import { TypeMetricsCalculator, TypeQualityScore, TypeHealthReport } from '../../analyzers/type-metrics-calculator';
import { ConfigManager } from '../../core/config';
import { Logger } from '../../utils/cli-utils';
import { TypeListOptions, TypeHealthOptions, TypeDepsOptions } from './types.types';
import { 
  sortTypes, 
  displayTypesList, 
  displayHealthReport, 
  displayCircularDependencies, 
  displayTypeDependencies 
} from './utils/type-display';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';


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
    .option('--risk <level>', 'Filter by risk level (low|medium|high|critical)')
    .option('--json', 'Output in JSON format')
    .option('--detail', 'Show detailed information in multi-line format')
    .action(async (options: TypeListOptions, command) => {
      // Merge global options
      const globalOpts = command.parent?.opts() || {};
      const mergedOptions = { ...globalOpts, ...options };
      await executeTypesList(mergedOptions);
    });

  // Type health command
  typesCmd
    .command('health')
    .description('🏥 Analyze type quality and health metrics')
    .option('--verbose', 'Show detailed health information')
    .option('--json', 'Output in JSON format')
    .option('--thresholds <path>', 'Path to custom thresholds file')
    .action(async (options: TypeHealthOptions, command) => {
      // Merge global options
      const globalOpts = command.parent?.opts() || {};
      const mergedOptions = { ...globalOpts, ...options };
      await executeTypesHealth(mergedOptions);
    });

  // Type dependencies command
  typesCmd
    .command('deps <typeName>')
    .description('🔗 Analyze type dependencies and usage')
    .option('--depth <number>', 'Maximum dependency depth to analyze', parseInt, 3)
    .option('--circular', 'Show only circular dependencies')
    .option('--json', 'Output in JSON format')
    .action(async (typeName: string, options: TypeDepsOptions, command) => {
      // Merge global options
      const globalOpts = command.parent?.opts() || {};
      const mergedOptions = { ...globalOpts, ...options };
      await executeTypesDeps(typeName, mergedOptions);
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
      const validKinds = ['interface', 'class', 'type_alias', 'enum', 'namespace'] as const;
      if (!validKinds.includes(options.kind as typeof validKinds[number])) {
        logger.error(`❌ Invalid kind: ${options.kind}. Valid options are: ${validKinds.join(', ')}`);
        process.exit(1);
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

    // Sort types
    const validSortOptions = ['name', 'fields', 'complexity', 'usage'] as const;
    const sortField = options.sort || 'name';
    if (!validSortOptions.includes(sortField as typeof validSortOptions[number])) {
      logger.error(`❌ Invalid sort option: ${sortField}. Valid options are: ${validSortOptions.join(', ')}`);
      process.exit(1);
    }
    filteredTypes = sortTypes(filteredTypes, sortField, options.desc);

    // Apply limit
    if (options.limit && options.limit > 0) {
      filteredTypes = filteredTypes.slice(0, options.limit);
    }

    if (options.json) {
      console.log(JSON.stringify(filteredTypes, null, 2));
    } else {
      displayTypesList(filteredTypes, options.detail);
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
    
    const { types, dependencies, project } = await analyzeProjectTypes();
    
    // Load custom thresholds if provided
    let thresholds: Record<string, unknown> = { name: 'default-v2' };
    if (options.thresholds && fs.existsSync(options.thresholds)) {
      thresholds = { 
        ...JSON.parse(fs.readFileSync(options.thresholds, 'utf-8')),
        name: path.basename(options.thresholds, '.json')
      };
    }

    const calculator = new TypeMetricsCalculator(thresholds);
    const dependencyAnalyzer = new TypeDependencyAnalyzer(project);
    
    // Calculate type quality scores
    const typeScores: TypeQualityScore[] = [];
    const typeAnalyzer = new TypeAnalyzer(project);
    for (const type of types) {
      const metrics = typeAnalyzer.calculateTypeMetrics(type);
      const typeDependencies = dependencies.filter(d => d.sourceTypeId === type.id);
      const score = calculator.calculateTypeQuality(type, metrics, undefined, typeDependencies);
      typeScores.push(score);
    }

    // Detect circular dependencies
    const circularDeps = dependencyAnalyzer.detectCircularDependencies(dependencies);
    
    // Generate health report
    const healthReport = calculator.generateHealthReport(typeScores, circularDeps);

    // Load previous health data for comparison
    const previousHealth = loadPreviousHealthData();
    
    // Save current health data for future comparisons
    saveHealthData(healthReport);

    if (options.json) {
      console.log(JSON.stringify({
        healthReport,
        typeScores: options.verbose ? typeScores : undefined
      }, null, 2));
    } else {
      displayHealthReport(healthReport, typeScores, options.verbose, types, previousHealth || null);
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
    
    const { types, dependencies, project } = await analyzeProjectTypes();
    const targetType = types.find(t => t.name === typeName);
    
    if (!targetType) {
      logger.error(`❌ Type '${typeName}' not found`);
      process.exit(1);
    }

    const dependencyAnalyzer = new TypeDependencyAnalyzer(project);
    dependencyAnalyzer.setTypeDefinitions(types);

    if (options.circular) {
      const circularDeps = dependencyAnalyzer.detectCircularDependencies(dependencies);
      const typeCircularDeps = circularDeps.filter(cd => 
        cd.typeNames.includes(typeName)
      );

      if (options.json) {
        console.log(JSON.stringify(typeCircularDeps, null, 2));
      } else {
        displayCircularDependencies(typeCircularDeps);
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
      // Continue processing other files even if one fails
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
 * Get cache directory path
 */
function getCacheDir(): string {
  const homeDir = os.homedir();
  const cacheDir = path.join(homeDir, '.funcqc-cache');
  
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  return cacheDir;
}

/**
 * Load previous health data for comparison
 */
function loadPreviousHealthData(): Partial<TypeHealthReport & { date?: string; timestamp?: string }> | null {
  try {
    const cacheFile = path.join(getCacheDir(), 'type-health.json');
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors when loading cache
  }
  return null;
}

/**
 * Save current health data for future comparisons
 */
function saveHealthData(healthReport: TypeHealthReport): void {
  try {
    const cacheFile = path.join(getCacheDir(), 'type-health.json');
    const dataToSave = {
      overallHealth: healthReport.overallHealth,
      totalTypes: healthReport.totalTypes,
      riskDistribution: healthReport.riskDistribution,
      circularDependencies: healthReport.circularDependencies.length,
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString('ja-JP')
    };
    
    fs.writeFileSync(cacheFile, JSON.stringify(dataToSave, null, 2));
  } catch {
    // Ignore errors when saving cache
  }
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

