import { Command } from 'commander';
import { Project } from 'ts-morph';
import path from 'path';
import chalk from 'chalk';
import { TypeAnalyzer, TypeDefinition } from '../../analyzers/type-analyzer';
import { FunctionRegistry } from '../../analyzers/function-registry';
import { FunctionMetadata } from '../../analyzers/ideal-call-graph-analyzer';
import { TypeFunctionLinker, EnrichedTypeInfo, EnrichedFunctionInfo, CrossReference, ValidationResult, TypeUsageAnalysis, CouplingAnalysis } from '../../analyzers/type-function-linker';
import { IntegratedDisplayUtils } from './utils/integrated-display';
import { UsageAnalysisDisplay } from './utils/usage-analysis-display';
import { ConfigManager } from '../../core/config';
import { Logger } from '../../utils/cli-utils';
import { OverviewOptions } from './overview.types';

/**
 * Overview command - integrated analysis of types and functions
 */
export function createOverviewCommand(): Command {
  const overviewCmd = new Command('overview')
    .description('🎯 Integrated overview of types and functions')
    .option('--show-types', 'Include type analysis in overview', true)
    .option('--show-functions', 'Include function analysis in overview', true)
    .option('--show-integration', 'Show type-function integration details', true)
    .option('--show-validation', 'Show validation results for type-function links')
    .option('--analyze-usage', 'Analyze type usage patterns and property correlations')
    .option('--analyze-coupling', 'Analyze coupling issues and over-coupled parameters')
    .option('--analyze-cohesion', 'Analyze type cohesion and potential splits')
    .option('--file <path>', 'Filter by specific file path')
    .option('--limit <number>', 'Limit number of results shown', parseInt, 20)
    .option('--risk-threshold <number>', 'Complexity threshold for high-risk identification', parseInt, 10)
    .option('--json', 'Output in JSON format')
    .option('--verbose', 'Show detailed information')
    .action(async (options: OverviewOptions, command) => {
      // Merge global options
      const globalOpts = command.parent?.opts() || {};
      const mergedOptions = { ...globalOpts, ...options };
      await executeOverview(mergedOptions);
    })
    .addHelpText('after', `
Examples:
  # Basic integrated overview
  $ funcqc overview

  # Focus on integration analysis
  $ funcqc overview --show-integration --show-validation

  # Analyze specific file
  $ funcqc overview --file src/services/user-service.ts

  # JSON output for further processing
  $ funcqc overview --json

  # Detailed verbose output
  $ funcqc overview --verbose
`);

  return overviewCmd;
}

/**
 * Check if a file path matches the file filter with precise matching
 */
function matchesFileFilter(filePath: string, fileFilter: string): boolean {
  // Normalize paths for consistent comparison
  const normalizedFilePath = path.normalize(filePath);
  const normalizedFilter = path.normalize(fileFilter);
  
  // Try exact match first
  if (normalizedFilePath === normalizedFilter) {
    return true;
  }
  
  // Try endsWith match for relative paths (e.g., "service.ts" matches "user-service.ts")
  if (normalizedFilePath.endsWith(normalizedFilter)) {
    return true;
  }
  
  // Try exact filename match (handle cases where filter is just filename)
  const fileName = path.basename(normalizedFilePath);
  if (fileName === normalizedFilter) {
    return true;
  }
  
  return false;
}

/**
 * Execute the overview command
 */
export async function executeOverview(options: OverviewOptions): Promise<void> {
  const logger = new Logger();

  try {
    logger.info('🎯 Starting integrated type-function analysis...');

    // Initialize analysis components
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: {
        allowJs: true,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        skipLibCheck: true,
        target: 99, // Latest
        moduleResolution: 100, // Bundler
      }
    });

    // Add source files
    const patterns = config.include || ['src/**/*.ts', 'src/**/*.tsx'];
    project.addSourceFilesAtPaths(patterns);

    // Analyze types
    const types: TypeDefinition[] = [];
    if (options.showTypes !== false) {
      logger.info('🧩 Analyzing TypeScript types...');
      const typeAnalyzer = new TypeAnalyzer(project);
      const sourceFiles = project.getSourceFiles();
      // Generate unique snapshot ID or use provided snapshot ID to avoid conflicts
      const snapshotId = options.snapshotId || `overview-${Date.now()}`;
      
      for (const sourceFile of sourceFiles) {
        const filePath = sourceFile.getFilePath();
        if (!options.file || matchesFileFilter(filePath, options.file)) {
          const fileTypes = typeAnalyzer.analyzeFile(filePath, snapshotId);
          types.push(...fileTypes);
        }
      }
    }

    // Analyze functions
    let functions: FunctionMetadata[] = [];
    if (options.showFunctions !== false) {
      logger.info('📋 Analyzing functions...');
      const functionRegistry = new FunctionRegistry(project);
      const allFunctions = await functionRegistry.collectAllFunctions();
      
      functions = Array.from(allFunctions.values()).filter(func => {
        return !options.file || matchesFileFilter(func.filePath, options.file);
      });
    }

    // Perform integration analysis
    let enrichedTypes: EnrichedTypeInfo[] = [];
    let enrichedFunctions: EnrichedFunctionInfo[] = [];
    let crossReferences: CrossReference[] = [];
    let validationResults: ValidationResult[] = [];
    const usageAnalyses: TypeUsageAnalysis[] = [];
    const couplingAnalyses: CouplingAnalysis[] = [];

    if (options.showIntegration !== false || options.showValidation) {
      logger.info('🔗 Analyzing type-function integration...');
      const linker = new TypeFunctionLinker(project);

      // Create cross-references
      crossReferences = linker.linkTypesAndFunctions(types, functions);

      // Enrich data with cross-references
      enrichedTypes = await Promise.all(types.map(type => linker.enrichTypeWithFunctionInfo(type, functions)));
      enrichedFunctions = functions.map(func => linker.enrichFunctionWithTypeInfo(func, types));

      // Validate type-function links
      if (options.showValidation) {
        validationResults = linker.validateTypeMethodLinks(types, functions);
      }

      // Perform usage pattern analysis
      if (options.analyzeUsage) {
        logger.info('📊 Analyzing type usage patterns...');
        for (const type of types.slice(0, options.limit || 10)) {
          if (type.kind === 'class' || type.kind === 'interface') {
            const analysis = linker.analyzeTypeUsagePatterns(type, functions);
            usageAnalyses.push(analysis);
          }
        }
      }

      // Perform coupling analysis
      if (options.analyzeCoupling) {
        logger.info('🔗 Analyzing coupling patterns...');
        for (const func of functions.slice(0, options.limit || 20)) {
          const analysis = linker.analyzeCouplingIssues(func);
          if (analysis.overCoupledParameters.length > 0 || analysis.bucketBrigadeIndicators.length > 0) {
            couplingAnalyses.push(analysis);
          }
        }
      }
    } else {
      // Create basic enriched objects without integration analysis
      enrichedTypes = types.map(type => ({ ...type } as EnrichedTypeInfo));
      enrichedFunctions = functions.map(func => ({ ...func } as EnrichedFunctionInfo));
    }

    // Output results
    if (options.json) {
      const result = {
        summary: {
          totalTypes: types.length,
          totalFunctions: functions.length,
          crossReferences: crossReferences.length,
          analyzedAt: new Date().toISOString()
        },
        types: enrichedTypes.slice(0, options.limit),
        functions: enrichedFunctions.slice(0, options.limit),
        crossReferences: crossReferences.slice(0, options.limit),
        validation: validationResults,
        usageAnalyses,
        couplingAnalyses
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      displayOverviewResults({
        enrichedTypes,
        enrichedFunctions,
        crossReferences,
        validationResults,
        usageAnalyses,
        couplingAnalyses,
        options
      });
    }

    logger.info('✅ Integrated analysis completed successfully!');

  } catch (error) {
    logger.error('❌ Failed to analyze types and functions:', error);
    throw error; // 呼び出し元にエラーを伝播させ、終了処理を委譲
  }
}

/**
 * Display overview results in human-readable format
 */
function displayOverviewResults({
  enrichedTypes,
  enrichedFunctions,
  crossReferences,
  validationResults,
  usageAnalyses,
  couplingAnalyses,
  options
}: {
  enrichedTypes: EnrichedTypeInfo[];
  enrichedFunctions: EnrichedFunctionInfo[];
  crossReferences: CrossReference[];
  validationResults: ValidationResult[];
  usageAnalyses: TypeUsageAnalysis[];
  couplingAnalyses: CouplingAnalysis[];
  options: OverviewOptions;
}): void {

  // Display new usage analysis if requested
  if (options.analyzeUsage && usageAnalyses.length > 0) {
    for (const analysis of usageAnalyses) {
      UsageAnalysisDisplay.displayTypeUsageAnalysis(analysis);
    }
    return; // Show only usage analysis when requested
  }

  // Display coupling analysis if requested
  if (options.analyzeCoupling && couplingAnalyses.length > 0) {
    UsageAnalysisDisplay.displayCouplingAnalysis(couplingAnalyses);
    return; // Show only coupling analysis when requested
  }

  // Display improved integrated overview (without misleading metrics)
  displayImprovedIntegratedOverview(
    enrichedTypes, 
    enrichedFunctions, 
    crossReferences
  );

  // Show detailed type information
  if (options.verbose && options.showTypes !== false) {
    console.log('\n' + '='.repeat(50));
    console.log('📋 Detailed Type Analysis:');
    
    const typesToShow = enrichedTypes
      .filter(type => {
        if (!options.riskThreshold) return true;
        return type.methodQuality && 
               type.methodQuality.highRiskMethods.length > 0;
      })
      .slice(0, options.limit);

    for (const type of typesToShow) {
      IntegratedDisplayUtils.displayTypeWithFunctionHealth(type);
    }
  }

  // Show detailed function information
  if (options.verbose && options.showFunctions !== false) {
    console.log('\n' + '='.repeat(50));
    console.log('🔧 Detailed Function Analysis:');
    
    const functionsToShow = enrichedFunctions
      .filter(func => {
        if (!options.riskThreshold) return true;
        // Simple heuristic based on available metadata
        return func.signature.length > 100 || (func.endLine - func.startLine) > options.riskThreshold;
      })
      .slice(0, options.limit);

    for (const func of functionsToShow) {
      IntegratedDisplayUtils.displayFunctionWithTypeContext(func);
    }
  }

  // Show cross-reference details
  if (options.showIntegration && crossReferences.length > 0) {
    console.log('\n' + '='.repeat(50));
    IntegratedDisplayUtils.generateCrossReferenceTable(
      crossReferences.slice(0, options.limit)
    );
  }

  // Show validation results
  if (options.showValidation && validationResults.length > 0) {
    console.log('\n' + '='.repeat(50));
    IntegratedDisplayUtils.displayValidationResults(validationResults);
  }

  // Show information-oriented insights (non-prescriptive)
  console.log('\n' + '='.repeat(50));
  console.log('💡 Analysis Options:');
  
  const highRiskTypeCount = enrichedTypes.filter(t => 
    t.methodQuality && t.methodQuality.highRiskMethods.length > 0
  ).length;
  
  const standaloneeFunctionCount = enrichedFunctions.filter(f => !f.typeContext).length;
  
  console.log('   • Use --analyze-usage to explore type usage patterns');
  console.log('   • Use --analyze-coupling to examine parameter coupling');
  console.log('   • Use --analyze-cohesion to investigate type cohesion');
  console.log('   • Use --verbose for detailed integration analysis');
  console.log('   • Use --json for programmatic data export');
  
  if (highRiskTypeCount > 0) {
    console.log(`   • ${highRiskTypeCount} types contain complex methods`);
  }
  
  if (standaloneeFunctionCount > 0) {
    console.log(`   • ${standaloneeFunctionCount} functions exist independently of types`);
  }
}

/**
 * Display improved integrated overview without misleading metrics
 */
function displayImprovedIntegratedOverview(
  types: EnrichedTypeInfo[], 
  functions: EnrichedFunctionInfo[],
  _crossRefs: CrossReference[]
): void {
  console.log(chalk.cyan.bold('\n🎯 Type-Function Overview'));
  console.log('='.repeat(50));

  // Basic statistics (factual, non-judgmental)
  const totalTypes = types.length;
  const totalFunctions = functions.length;
  const classesWithMethods = types.filter(t => t.kind === 'class' && t.methodQuality && t.methodQuality.totalMethods > 0).length;
  const interfacesWithMethods = types.filter(t => t.kind === 'interface' && t.methodQuality && t.methodQuality.totalMethods > 0).length;
  const standaloneeFunctions = functions.filter(f => !f.typeContext).length;
  
  console.log(chalk.blue('\n📊 Overview Statistics:'));
  console.log(`   Types: ${totalTypes} total`);
  console.log(`     • Classes: ${types.filter(t => t.kind === 'class').length} (${classesWithMethods} with methods)`);
  console.log(`     • Interfaces: ${types.filter(t => t.kind === 'interface').length} (${interfacesWithMethods} with methods)`);
  console.log(`     • Type aliases: ${types.filter(t => t.kind === 'type_alias').length}`);
  console.log(`   Functions: ${totalFunctions} total`);
  console.log(`     • Associated with types: ${totalFunctions - standaloneeFunctions}`);
  console.log(`     • Standalone: ${standaloneeFunctions}`);

  // Programming paradigm analysis (neutral)
  const paradigmAnalysis = analyzeParadigmUsage(types, functions);
  console.log(chalk.blue('\n🎨 Programming Style Distribution:'));
  console.log(`   Object-oriented patterns: ${paradigmAnalysis.oopPercentage.toFixed(1)}% (${paradigmAnalysis.classBasedFunctions} functions)`);
  console.log(`   Functional patterns: ${paradigmAnalysis.functionalPercentage.toFixed(1)}% (${paradigmAnalysis.standaloneeFunctions} functions)`);
  console.log(`   Mixed patterns: ${paradigmAnalysis.mixedPercentage.toFixed(1)}% (${paradigmAnalysis.mixedPatterns} cases)`);

  // Type complexity distribution (informational)
  if (types.some(t => t.methodQuality)) {
    console.log(chalk.blue('\n📈 Method Complexity Distribution:'));
    
    const methodCounts = types
      .filter(t => t.methodQuality && t.methodQuality.totalMethods > 0)
      .map(t => t.methodQuality!.totalMethods);
    
    if (methodCounts.length > 0) {
      const avgMethods = methodCounts.reduce((a, b) => a + b, 0) / methodCounts.length;
      const maxMethods = Math.max(...methodCounts);
      
      console.log(`   Average methods per type: ${avgMethods.toFixed(1)}`);
      console.log(`   Maximum methods in single type: ${maxMethods}`);
      
      const highRiskTypes = types.filter(t => 
        t.methodQuality && t.methodQuality.highRiskMethods.length > 0
      ).length;
      
      if (highRiskTypes > 0) {
        console.log(`   Types with complex methods: ${highRiskTypes}`);
      }
    }
  }
}

/**
 * Analyze programming paradigm usage patterns
 */
function analyzeParadigmUsage(
  _types: EnrichedTypeInfo[], 
  functions: EnrichedFunctionInfo[]
): {
  oopPercentage: number;
  functionalPercentage: number;
  mixedPercentage: number;
  classBasedFunctions: number;
  standaloneeFunctions: number;
  mixedPatterns: number;
} {
  const totalFunctions = functions.length;
  const classBasedFunctions = functions.filter(f => f.typeContext && f.typeContext.isClassMethod).length;
  const standaloneeFunctions = functions.filter(f => !f.typeContext).length;
  const interfaceBasedFunctions = functions.filter(f => f.typeContext && f.typeContext.isInterfaceMethod).length;
  
  const mixedPatterns = interfaceBasedFunctions; // Interface methods are mixed paradigm
  
  return {
    oopPercentage: totalFunctions > 0 ? (classBasedFunctions / totalFunctions) * 100 : 0,
    functionalPercentage: totalFunctions > 0 ? (standaloneeFunctions / totalFunctions) * 100 : 0,
    mixedPercentage: totalFunctions > 0 ? (mixedPatterns / totalFunctions) * 100 : 0,
    classBasedFunctions,
    standaloneeFunctions,
    mixedPatterns
  };
}