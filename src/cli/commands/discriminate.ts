/**
 * CLI Command: discriminate
 * 
 * Analyzes types for discriminated union opportunities and optionally transforms them.
 * Provides comprehensive reporting and safe transformation capabilities.
 */

import { Command } from 'commander';
import { PGLiteStorageAdapter } from '../../storage/pglite-adapter';
import { DiscriminatedUnionAnalyzer, type DiscriminatedUnionOptions } from '../../analyzers/type-refactoring/discriminated-union-analyzer';
import { DiscriminatedUnionTransformer, type TransformationOptions } from '../../analyzers/type-refactoring/discriminated-union-transformer';
// Using console logging like other CLI commands
import { performance } from 'perf_hooks';

interface CommandOptions {
  'snapshot-id'?: string;
  'target-types'?: string;
  'min-coverage'?: string;
  'min-confidence'?: string;
  'max-cases'?: string;
  'include-booleans'?: boolean;
  'include-enums'?: boolean;
  'allow-breaking'?: boolean;
  'dry-run'?: boolean;
  'transform'?: boolean;
  'output'?: string;
  'verbose'?: boolean;
  'json'?: boolean;
}

interface DiscriminateResult {
  analysis: {
    totalTypes: number;
    candidatesFound: number;
    flagProperties: number;
    mutualExclusionPatterns: number;
    potentialBenefit: number;
    estimatedTime: string;
  };
  candidates: Array<{
    typeName: string;
    filePath: string;
    discriminant: string;
    discriminantType: string;
    unionCases: number;
    confidence: number;
    benefits: {
      eliminatedBranches: number;
      typeSafetyImprovement: number;
      complexityReduction: number;
    };
    riskLevel: string;
    estimatedEffort: string;
  }>;
  recommendations: {
    strategy: string;
    implementationOrder: string[];
    nextSteps: string[];
  };
  transformations?: {
    attempted: number;
    successful: number;
    failed: number;
    warnings: number;
  };
}

export function createDiscriminateCommand(): Command {
  const cmd = new Command('discriminate');
  
  cmd
    .description('Analyze and transform types into discriminated unions')
    .option('--snapshot-id <id>', 'Use specific snapshot for analysis')
    .option('--target-types <types>', 'Comma-separated list of specific types to analyze')
    .option('--min-coverage <number>', 'Minimum coverage threshold (0-1)', '0.8')
    .option('--min-confidence <number>', 'Minimum confidence threshold (0-1)', '0.6')
    .option('--max-cases <number>', 'Maximum union cases per type', '8')
    .option('--include-booleans', 'Include boolean discriminants', true)
    .option('--include-enums', 'Include enum discriminants', true)
    .option('--allow-breaking', 'Allow breaking changes during transformation', false)
    .option('--dry-run', 'Preview changes without applying them', false)
    .option('--transform', 'Apply transformations automatically', false)
    .option('--output <format>', 'Output format: table|json|detailed', 'table')
    .option('--verbose', 'Enable verbose logging', false)
    .option('--json', 'Output results as JSON', false)
    .action(async (options: CommandOptions) => {
      await executeDiscriminate(options);
    });

  return cmd;
}

async function executeDiscriminate(options: CommandOptions): Promise<void> {
  const startTime = performance.now();
  
  try {
    // Initialize storage
    const storage = new PGLiteStorageAdapter('.funcqc/funcqc.db');

    if (options.verbose) {
      console.log('🔍 Starting discriminated union analysis...');
    }

    // Configure analysis options
    const analysisOptions: Partial<DiscriminatedUnionOptions> = {
      minDiscriminantUsage: 0.3,
      minCaseCount: 2,
      maxCaseCount: parseInt(options['max-cases'] || '8'),
      minMutualExclusivity: parseFloat(options['min-coverage'] || '0.8'),
      includeEnumDiscriminants: options['include-enums'] !== false,
      includeBooleanFlags: options['include-booleans'] !== false,
      minimumBenefitThreshold: parseFloat(options['min-confidence'] || '0.6'),
      allowBreakingChanges: options['allow-breaking'] === true
    };

    // Run analysis
    const analyzer = new DiscriminatedUnionAnalyzer(storage, analysisOptions);
    const analysisResult = await analyzer.analyze(options['snapshot-id']);

    if (options.verbose) {
      console.log(`📊 Analysis complete: ${analysisResult.candidates.length} candidates found`);
    }

    // Filter by target types if specified
    let filteredCandidates = analysisResult.candidates;
    if (options['target-types']) {
      const targetTypes = options['target-types'].split(',').map(t => t.trim());
      filteredCandidates = analysisResult.candidates.filter(c =>
        targetTypes.includes(c.typeName)
      );
      
      if (options.verbose) {
        console.log(`🎯 Filtered to ${filteredCandidates.length} target types`);
      }
    }

    // Prepare result object
    const result: DiscriminateResult = {
      analysis: {
        totalTypes: analysisResult.statistics.totalTypesAnalyzed,
        candidatesFound: analysisResult.candidates.length,
        flagProperties: analysisResult.statistics.flagPropertiesFound,
        mutualExclusionPatterns: analysisResult.statistics.mutualExclusionPatternsFound,
        potentialBenefit: Math.round(analysisResult.statistics.potentialBenefitScore * 100) / 100,
        estimatedTime: analysisResult.recommendedApproach.estimatedTimeToComplete
      },
      candidates: filteredCandidates.map(candidate => ({
        typeName: candidate.typeName,
        filePath: candidate.filePath,
        discriminant: candidate.discriminantProperty.name,
        discriminantType: candidate.discriminantProperty.type,
        unionCases: candidate.unionCases.length,
        confidence: Math.round(candidate.confidence * 100) / 100,
        benefits: {
          eliminatedBranches: candidate.refactoringBenefit.eliminatedBranches,
          typeSafetyImprovement: Math.round(candidate.refactoringBenefit.improvedTypesafety * 100),
          complexityReduction: candidate.refactoringBenefit.reducedComplexity
        },
        riskLevel: candidate.transformationPlan.riskAssessment.overallRisk,
        estimatedEffort: candidate.transformationPlan.estimatedEffort
      })),
      recommendations: {
        strategy: analysisResult.recommendedApproach.overallStrategy,
        implementationOrder: analysisResult.recommendedApproach.implementationOrder,
        nextSteps: generateNextSteps(analysisResult.recommendedApproach, options)
      }
    };

    // Apply transformations if requested
    if (options.transform && filteredCandidates.length > 0) {
      await applyTransformations(filteredCandidates, options, result);
    }

    // Output results
    await outputResults(result, options);

    const endTime = performance.now();
    if (options.verbose) {
      console.log(`✅ Analysis completed in ${Math.round(endTime - startTime)}ms`);
    }

  } catch (error) {
    console.error(`❌ Discriminated union analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function applyTransformations(
  candidates: Array<Record<string, unknown>>,
  options: CommandOptions,
  result: DiscriminateResult
): Promise<void> {
  
  const transformOptions: Partial<TransformationOptions> = {
    dryRun: options['dry-run'] === true,
    createBackups: true,
    validateAfterTransform: true,
    addTransformationComments: true,
    maxFilesToTransform: candidates.length
  };

  const transformer = new DiscriminatedUnionTransformer(transformOptions);
  
  let attempted = 0;
  let successful = 0;
  let failed = 0;
  let totalWarnings = 0;

  if (options.verbose) {
    console.log(`🔄 Starting transformations (${options['dry-run'] ? 'DRY RUN' : 'LIVE'})...`);
  }

  for (const candidate of candidates) {
    attempted++;
    
    try {
      const transformResult = await transformer.transform(candidate);
      
      if (transformResult.success) {
        successful++;
        if (options.verbose) {
          console.log(`✅ Transformed ${candidate.typeName}`);
        }
      } else {
        failed++;
        if (options.verbose) {
          console.warn(`⚠️  Failed to transform ${candidate.typeName}: ${transformResult.errors[0]?.message}`);
        }
      }
      
      totalWarnings += transformResult.warnings.length;
      
      if (options.verbose && transformResult.warnings.length > 0) {
        transformResult.warnings.forEach(warning => {
          console.warn(`   Warning: ${warning.message}`);
        });
      }
      
    } catch (error) {
      failed++;
      if (options.verbose) {
        console.error(`❌ Transformation error for ${candidate.typeName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  result.transformations = {
    attempted,
    successful,
    failed,
    warnings: totalWarnings
  };

  if (options.verbose) {
    console.log(`🏁 Transformations complete: ${successful}/${attempted} successful`);
  }
}

function generateNextSteps(
  recommendedApproach: Record<string, unknown>,
  options: CommandOptions
): string[] {
  const steps: string[] = [];

  if (recommendedApproach.prioritizedCandidates.length === 0) {
    steps.push('No discriminated union opportunities found');
    steps.push('Consider analyzing more types or adjusting thresholds');
    return steps;
  }

  steps.push(`Strategy: ${recommendedApproach.overallStrategy} approach recommended`);
  
  if (options.transform) {
    if (options['dry-run']) {
      steps.push('Remove --dry-run flag to apply transformations');
    } else {
      steps.push('Review transformed code and run tests');
      steps.push('Commit changes if tests pass');
    }
  } else {
    steps.push('Use --transform flag to apply automatic transformations');
    steps.push('Or use --dry-run --transform to preview changes');
  }

  if (recommendedApproach.implementationOrder.length > 1) {
    steps.push(`Implement in order: ${recommendedApproach.implementationOrder.slice(0, 3).join(', ')}`);
  }

  steps.push('Run type checks and tests after each transformation');

  return steps;
}

async function outputResults(
  result: DiscriminateResult,
  options: CommandOptions
): Promise<void> {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const outputFormat = options.output || 'table';

  switch (outputFormat) {
    case 'json':
      console.log(JSON.stringify(result, null, 2));
      break;

    case 'detailed':
      outputDetailed(result);
      break;

    case 'table':
    default:
      outputTable(result);
      break;
  }
}

function outputTable(result: DiscriminateResult): void {
  console.log('\n🎯 Discriminated Union Analysis Results\n');
  
  // Summary table
  console.log('📊 Analysis Summary:');
  console.log(`   Types analyzed: ${result.analysis.totalTypes}`);
  console.log(`   Candidates found: ${result.analysis.candidatesFound}`);
  console.log(`   Flag properties: ${result.analysis.flagProperties}`);
  console.log(`   Mutual exclusion patterns: ${result.analysis.mutualExclusionPatterns}`);
  console.log(`   Potential benefit score: ${result.analysis.potentialBenefit}`);
  console.log(`   Estimated completion time: ${result.analysis.estimatedTime}`);

  if (result.candidates.length > 0) {
    console.log('\n🏆 Top Candidates:');
    console.log('┌─────────────────────┬──────────────┬────────────┬────────────┬────────────┬──────────────┐');
    console.log('│ Type Name           │ Discriminant │ Cases      │ Confidence │ Risk       │ Effort       │');
    console.log('├─────────────────────┼──────────────┼────────────┼────────────┼────────────┼──────────────┤');
    
    result.candidates.slice(0, 10).forEach(candidate => {
      const typeName = candidate.typeName.substring(0, 19);
      const discriminant = candidate.discriminant.substring(0, 12);
      const cases = candidate.unionCases.toString();
      const confidence = (candidate.confidence * 100).toFixed(0) + '%';
      const risk = candidate.riskLevel;
      const effort = candidate.estimatedEffort;
      
      console.log(`│ ${typeName.padEnd(19)} │ ${discriminant.padEnd(12)} │ ${cases.padEnd(10)} │ ${confidence.padEnd(10)} │ ${risk.padEnd(10)} │ ${effort.padEnd(12)} │`);
    });
    
    console.log('└─────────────────────┴──────────────┴────────────┴────────────┴────────────┴──────────────┘');
  }

  // Recommendations
  console.log('\n💡 Recommendations:');
  console.log(`   Strategy: ${result.recommendations.strategy}`);
  if (result.recommendations.implementationOrder.length > 0) {
    console.log(`   Implementation order: ${result.recommendations.implementationOrder.slice(0, 5).join(', ')}`);
  }
  
  console.log('\n📝 Next Steps:');
  result.recommendations.nextSteps.forEach((step, index) => {
    console.log(`   ${index + 1}. ${step}`);
  });

  // Transformation results if present
  if (result.transformations) {
    console.log('\n🔄 Transformation Results:');
    console.log(`   Attempted: ${result.transformations.attempted}`);
    console.log(`   Successful: ${result.transformations.successful}`);
    console.log(`   Failed: ${result.transformations.failed}`);
    console.log(`   Warnings: ${result.transformations.warnings}`);
  }
}

function outputDetailed(result: DiscriminateResult): void {
  console.log('\n🎯 Detailed Discriminated Union Analysis\n');

  // Analysis overview
  console.log('📊 ANALYSIS OVERVIEW');
  console.log('═'.repeat(50));
  console.log(`Total types analyzed: ${result.analysis.totalTypes}`);
  console.log(`Candidates found: ${result.analysis.candidatesFound}`);
  console.log(`Flag properties detected: ${result.analysis.flagProperties}`);
  console.log(`Mutual exclusion patterns: ${result.analysis.mutualExclusionPatterns}`);
  console.log(`Potential benefit score: ${result.analysis.potentialBenefit}/1.0`);
  console.log(`Estimated completion time: ${result.analysis.estimatedTime}`);

  // Detailed candidate information
  if (result.candidates.length > 0) {
    console.log('\n🏆 CANDIDATE DETAILS');
    console.log('═'.repeat(50));

    result.candidates.forEach((candidate, index) => {
      console.log(`\n${index + 1}. ${candidate.typeName}`);
      console.log(`   File: ${candidate.filePath}`);
      console.log(`   Discriminant: ${candidate.discriminant} (${candidate.discriminantType})`);
      console.log(`   Union cases: ${candidate.unionCases}`);
      console.log(`   Confidence: ${candidate.confidence}/1.0 (${(candidate.confidence * 100).toFixed(0)}%)`);
      console.log(`   Risk level: ${candidate.riskLevel}`);
      console.log(`   Estimated effort: ${candidate.estimatedEffort}`);
      
      console.log('   Benefits:');
      console.log(`     • Eliminated branches: ${candidate.benefits.eliminatedBranches}`);
      console.log(`     • Type safety improvement: ${candidate.benefits.typeSafetyImprovement}%`);
      console.log(`     • Complexity reduction: ~${candidate.benefits.complexityReduction} lines`);
    });
  }

  // Strategy and recommendations
  console.log('\n💡 RECOMMENDATIONS');
  console.log('═'.repeat(50));
  console.log(`Recommended strategy: ${result.recommendations.strategy}`);
  
  if (result.recommendations.implementationOrder.length > 0) {
    console.log('\nImplementation order:');
    result.recommendations.implementationOrder.forEach((typeName, index) => {
      console.log(`   ${index + 1}. ${typeName}`);
    });
  }

  console.log('\nNext steps:');
  result.recommendations.nextSteps.forEach((step, index) => {
    console.log(`   ${index + 1}. ${step}`);
  });

  // Transformation results
  if (result.transformations) {
    console.log('\n🔄 TRANSFORMATION RESULTS');
    console.log('═'.repeat(50));
    console.log(`Attempted: ${result.transformations.attempted}`);
    console.log(`Successful: ${result.transformations.successful}`);
    console.log(`Failed: ${result.transformations.failed}`);
    console.log(`Warnings: ${result.transformations.warnings}`);
    
    const successRate = result.transformations.attempted > 0
      ? (result.transformations.successful / result.transformations.attempted * 100).toFixed(1)
      : '0';
    console.log(`Success rate: ${successRate}%`);
  }
}

// Export for CLI integration
export { executeDiscriminate };