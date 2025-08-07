import { Command } from 'commander';
import { Project } from 'ts-morph';
import path from 'path';
import { TypeAnalyzer, TypeDefinition } from '../../analyzers/type-analyzer';
import { FunctionRegistry } from '../../analyzers/function-registry';
import { FunctionMetadata } from '../../analyzers/ideal-call-graph-analyzer';
import { TypeFunctionLinker, EnrichedTypeInfo, EnrichedFunctionInfo, CrossReference, ValidationResult } from '../../analyzers/type-function-linker';
import { IntegratedDisplayUtils } from './utils/integrated-display';
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
        validation: validationResults
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      displayOverviewResults({
        enrichedTypes,
        enrichedFunctions,
        crossReferences,
        validationResults,
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
  options
}: {
  enrichedTypes: EnrichedTypeInfo[];
  enrichedFunctions: EnrichedFunctionInfo[];
  crossReferences: CrossReference[];
  validationResults: ValidationResult[];
  options: OverviewOptions;
}): void {

  // Display integrated overview
  IntegratedDisplayUtils.displayIntegratedOverview(
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

  // Show next steps suggestions
  console.log('\n' + '='.repeat(50));
  console.log('💡 Suggested Next Steps:');
  
  const highRiskTypeCount = enrichedTypes.filter(t => 
    t.methodQuality && t.methodQuality.highRiskMethods.length > 0
  ).length;
  
  const unlinkedFunctionCount = enrichedFunctions.filter(f => !f.typeContext).length;
  
  if (highRiskTypeCount > 0) {
    console.log(`   • Review ${highRiskTypeCount} types with high-risk methods`);
    console.log('   • Consider refactoring complex methods for better maintainability');
  }
  
  if (unlinkedFunctionCount > 0) {
    console.log(`   • Investigate ${unlinkedFunctionCount} standalone functions`);
    console.log('   • Consider organizing functions into appropriate classes/modules');
  }
  
  if (validationResults.length > 0) {
    const issueCount = validationResults.reduce((sum, result) => sum + result.issues.length, 0);
    if (issueCount > 0) {
      console.log(`   • Address ${issueCount} type-function linkage issues`);
    }
  }
  
  console.log('   • Run with --verbose for detailed analysis');
  console.log('   • Use --json for programmatic processing');
}