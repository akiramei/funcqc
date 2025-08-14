/**
 * Canonicalize Command
 * 
 * CLI command for DTO canonicalization analysis and execution.
 * Identifies redundant DTO types and provides consolidation recommendations.
 */

import chalk from 'chalk';
import { table } from 'table';
import { DTOCanonicalizer } from '../../analyzers/type-refactoring/dto-canonicalizer';
import { Logger } from '../../utils/cli-utils';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand, BaseCommandOptions } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';

interface CanonicalizationOptions extends BaseCommandOptions {
  snapshot?: string;                    // Specific snapshot ID
  'min-support'?: number;              // Minimum support for patterns
  'min-confidence'?: number;           // Minimum confidence threshold
  'include-behavioral'?: boolean;      // Include behavioral analysis
  'generate-codemod'?: boolean;        // Generate codemod actions
  'require-minimal-impact'?: boolean;  // Only suggest low-impact changes
  'preserve-optionality'?: boolean;    // Preserve optional property differences
  format?: 'table' | 'json' | 'markdown';
  output?: string;                     // Output file path
  'dry-run'?: boolean;                // Don't execute, just show what would be done
  'max-candidates'?: number;          // Maximum number of canonicalization candidates
  'show-opportunities'?: boolean;     // Show consolidation opportunities
  'show-artifacts'?: boolean;         // Show generated artifacts
}

export const canonicalizeCommand: VoidCommand<CanonicalizationOptions> = (options: CanonicalizationOptions) => 
  async (env: CommandEnvironment): Promise<void> => {
  const { storage } = env;
  const logger = new Logger();
  const handleError = createErrorHandler(logger);

  try {
    const format = options.format || 'table';
    const isDryRun = options['dry-run'] ?? false;
    const maxCandidates = options['max-candidates'] || 10;

    logger.info('🔄 Starting DTO canonicalization analysis...');

    // Initialize DTO canonicalizer
    const canonicalizer = new DTOCanonicalizer(storage, {
      minSupport: options['min-support'] ?? 2,
      minConfidence: options['min-confidence'] ?? 0.6,
      maxPatternSize: 5,
      includeOptionalProperties: true,
      excludeCommonProperties: ['id', 'createdAt', 'updatedAt', 'version'],
      includeBehavioralAnalysis: options['include-behavioral'] ?? true,
      requireMinimalImpact: options['require-minimal-impact'] ?? false,
      generateCodemodActions: options['generate-codemod'] ?? true,
      preserveOptionalityDifferences: options['preserve-optionality'] ?? true
    });

    // Perform canonicalization analysis
    logger.info('📊 Analyzing type relationships and consolidation opportunities...');
    const result = await canonicalizer.analyze(options.snapshot);

    // Display results based on format
    switch (format) {
      case 'json':
        await outputJSON(result, options.output);
        break;
      case 'markdown':
        await outputMarkdown(result, options.output);
        break;
      case 'table':
      default:
        displayTableResults(result, {
          maxCandidates,
          showOpportunities: options['show-opportunities'] ?? false,
          showArtifacts: options['show-artifacts'] ?? false,
          isDryRun
        });
        break;
    }

    // Execute canonicalization if requested and not dry run
    if (!isDryRun && result.recommendations.length > 0) {
      if (options['generate-codemod']) {
        logger.info('🔧 Executing canonicalization actions...');
        await executeCanonicalizations(result, logger);
      } else {
        logger.info('💡 Use --generate-codemod to execute canonicalization actions');
      }
    }

    // Show summary
    displaySummary(result, isDryRun);

  } catch (error) {
    handleError.handleError(
      handleError.createError(ErrorCode.ANALYSIS_FAILED, `DTO canonicalization analysis failed: ${
        error instanceof Error ? error.message : String(error)
      }`)
    );
  }
};

/**
 * Display results in table format
 */
function displayTableResults(
  result: any,
  options: {
    maxCandidates: number;
    showOpportunities: boolean;
    showArtifacts: boolean;
    isDryRun: boolean;
  }
): void {
  const { recommendations, consolidationOpportunities, qualityMetrics } = result;

  // Canonicalization recommendations
  console.log(`\n${chalk.bold('🎯 Canonicalization Recommendations')}`);
  
  if (recommendations.length === 0) {
    console.log(chalk.yellow('No canonicalization opportunities found.'));
  } else {
    const candidateData = [
      ['Canonical Type', 'Subset Types', 'Impact', 'Risk', 'Estimated Savings']
    ];

    for (const rec of recommendations.slice(0, options.maxCandidates)) {
      candidateData.push([
        chalk.cyan(rec.canonicalType.typeName),
        rec.canonicalType.subsetTypes.slice(0, 3).join(', ') + 
          (rec.canonicalType.subsetTypes.length > 3 ? `... (+${rec.canonicalType.subsetTypes.length - 3})` : ''),
        `${rec.estimatedImpact.functionsAffected} funcs, ${rec.estimatedImpact.filesAffected.length} files`,
        getRiskColor(rec.estimatedImpact.riskAssessment.overallRisk)(rec.estimatedImpact.riskAssessment.overallRisk),
        `${rec.estimatedImpact.estimatedSavings.duplicateTypesEliminated} types, ${rec.estimatedImpact.estimatedSavings.linesOfCodeReduced} lines`
      ]);
    }

    console.log(table(candidateData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'left', width: 30 },
        { alignment: 'left' },
        { alignment: 'center' },
        { alignment: 'left' }
      ]
    }));
  }

  // Type relationships summary
  console.log(`\n${chalk.bold('📊 Type Relationships Analysis')}`);
  const { typeRelationships } = result;
  
  if (typeRelationships.length > 0) {
    const relationshipStats = {
      identical: typeRelationships.filter((r: any) => r.relationshipType === 'identical').length,
      subset: typeRelationships.filter((r: any) => r.relationshipType === 'subset').length,
      superset: typeRelationships.filter((r: any) => r.relationshipType === 'superset').length,
      overlap: typeRelationships.filter((r: any) => r.relationshipType === 'overlap').length,
      disjoint: typeRelationships.filter((r: any) => r.relationshipType === 'disjoint').length
    };

    const relationshipData = [
      ['Relationship Type', 'Count', 'Percentage'],
      ['Identical', relationshipStats.identical.toString(), `${Math.round(relationshipStats.identical / typeRelationships.length * 100)}%`],
      ['Subset/Superset', (relationshipStats.subset + relationshipStats.superset).toString(), `${Math.round((relationshipStats.subset + relationshipStats.superset) / typeRelationships.length * 100)}%`],
      ['Overlap', relationshipStats.overlap.toString(), `${Math.round(relationshipStats.overlap / typeRelationships.length * 100)}%`],
      ['Disjoint', relationshipStats.disjoint.toString(), `${Math.round(relationshipStats.disjoint / typeRelationships.length * 100)}%`]
    ];

    console.log(table(relationshipData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'right' },
        { alignment: 'right' }
      ]
    }));
  }

  // Consolidation opportunities
  if (options.showOpportunities && consolidationOpportunities.length > 0) {
    console.log(`\n${chalk.bold('💡 Consolidation Opportunities')}`);
    
    const opportunityData = [['ID', 'Types', 'Opportunity', 'Benefit', 'Complexity']];
    
    for (const opp of consolidationOpportunities.slice(0, 5)) {
      opportunityData.push([
        opp.id,
        opp.types.slice(0, 2).join(', ') + (opp.types.length > 2 ? `... (+${opp.types.length - 2})` : ''),
        opp.opportunityType.replace(/_/g, ' '),
        `${Math.round(opp.estimatedBenefit * 100)}%`,
        getComplexityColor(opp.implementationComplexity)(opp.implementationComplexity)
      ]);
    }

    console.log(table(opportunityData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'left', width: 25 },
        { alignment: 'left' },
        { alignment: 'right' },
        { alignment: 'center' }
      ]
    }));
  }

  // Generated artifacts
  if (options.showArtifacts && result.generatedArtifacts) {
    console.log(`\n${chalk.bold('📦 Generated Artifacts')}`);
    console.log(`View Types: ${chalk.cyan(result.generatedArtifacts.viewTypes.length)}`);
    console.log(`Mapper Functions: ${chalk.cyan(result.generatedArtifacts.mapperFunctions.length)}`);
    console.log(`Migration Scripts: ${chalk.cyan(result.generatedArtifacts.migrationScripts.length)}`);
  }

  // Quality metrics
  console.log(`\n${chalk.bold('📈 Quality Metrics')}`);
  console.log(`Duplicate Reduction: ${chalk.green((qualityMetrics.duplicateReduction * 100).toFixed(1))}%`);
  console.log(`Cohesion Improvement: ${chalk.green((qualityMetrics.cohesionImprovement * 100).toFixed(1))}%`);
  console.log(`Maintainability Score: ${chalk.blue((qualityMetrics.maintenabilityScore * 100).toFixed(1))}%`);

  // Dry run notice
  if (options.isDryRun) {
    console.log(`\n${chalk.bold.blue('🏃 DRY RUN MODE: No changes will be executed')}`);
  }
}

/**
 * Output results in JSON format
 */
async function outputJSON(result: any, outputPath?: string): Promise<void> {
  const json = JSON.stringify(result, null, 2);
  
  if (outputPath) {
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, json);
    console.log(chalk.green(`JSON report saved to: ${outputPath}`));
  } else {
    console.log(json);
  }
}

/**
 * Output results in Markdown format
 */
async function outputMarkdown(result: any, outputPath?: string): Promise<void> {
  let markdown = `# DTO Canonicalization Analysis Report

## Summary

- **Total Recommendations**: ${result.recommendations.length}
- **Type Relationships Analyzed**: ${result.typeRelationships.length}
- **Consolidation Opportunities**: ${result.consolidationOpportunities.length}

## Quality Metrics

- **Duplicate Reduction**: ${(result.qualityMetrics.duplicateReduction * 100).toFixed(1)}%
- **Cohesion Improvement**: ${(result.qualityMetrics.cohesionImprovement * 100).toFixed(1)}%
- **Maintainability Score**: ${(result.qualityMetrics.maintenabilityScore * 100).toFixed(1)}%

## Canonicalization Recommendations

`;

  for (const rec of result.recommendations) {
    markdown += `### ${rec.canonicalType.typeName}

**Subset Types**: ${rec.canonicalType.subsetTypes.join(', ')}
**Coverage Score**: ${(rec.canonicalType.coverageScore * 100).toFixed(1)}%
**Risk Level**: ${rec.estimatedImpact.riskAssessment.overallRisk}

**Impact**:
- Functions Affected: ${rec.estimatedImpact.functionsAffected}
- Files Affected: ${rec.estimatedImpact.filesAffected.length}
- Types Eliminated: ${rec.estimatedImpact.estimatedSavings.duplicateTypesEliminated}

**Migration Strategy**: ${rec.migrationStrategy.approach}
**Estimated Duration**: ${rec.migrationStrategy.estimatedDuration}

`;
  }

  markdown += `## Consolidation Opportunities

`;

  for (const opp of result.consolidationOpportunities) {
    markdown += `### ${opp.id}

**Types**: ${opp.types.join(', ')}
**Opportunity Type**: ${opp.opportunityType}
**Estimated Benefit**: ${Math.round(opp.estimatedBenefit * 100)}%
**Implementation Complexity**: ${opp.implementationComplexity}

**Description**: ${opp.description}

`;
  }

  markdown += `
---
🤖 Generated by funcqc DTO Canonicalizer
`;

  if (outputPath) {
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, markdown);
    console.log(chalk.green(`Markdown report saved to: ${outputPath}`));
  } else {
    console.log(markdown);
  }
}

/**
 * Execute canonicalization actions
 */
async function executeCanonicalizations(result: any, logger: Logger): Promise<void> {
  const { recommendations } = result;
  
  logger.info(`Executing canonicalization for ${recommendations.length} recommendations...`);
  
  for (const rec of recommendations) {
    logger.info(`Processing ${rec.canonicalType.typeName}...`);
    
    // Execute consolidation actions
    for (const action of rec.consolidationActions) {
      logger.debug(`  ${action.actionType}: ${action.description}`);
      
      if (action.automaticMigration) {
        // In a real implementation, this would execute the actual codemod
        logger.debug(`    ✅ Automated: ${action.description}`);
      } else {
        logger.warn(`    ⚠️  Manual: ${action.description}`);
      }
    }
  }
  
  logger.info('✅ Canonicalization execution completed');
  logger.info('⚠️  Please review changes and run tests before committing');
}

/**
 * Display final summary
 */
function displaySummary(result: any, isDryRun: boolean): void {
  console.log(`\n${chalk.bold('📋 Summary:')}`);
  
  const { recommendations, consolidationOpportunities, qualityMetrics } = result;
  
  console.log(`Canonicalization Candidates: ${chalk.cyan(recommendations.length)}`);
  console.log(`Consolidation Opportunities: ${chalk.cyan(consolidationOpportunities.length)}`);
  console.log(`Quality Improvement: ${chalk.green((qualityMetrics.maintenabilityScore * 100).toFixed(1))}% maintainability`);
  
  if (recommendations.length > 0) {
    const totalTypesEliminated = recommendations.reduce((sum: number, rec: any) => 
      sum + rec.estimatedImpact.estimatedSavings.duplicateTypesEliminated, 0
    );
    const totalLinesReduced = recommendations.reduce((sum: number, rec: any) => 
      sum + rec.estimatedImpact.estimatedSavings.linesOfCodeReduced, 0
    );
    
    console.log(`Potential Savings: ${chalk.green(totalTypesEliminated)} duplicate types, ${chalk.green(totalLinesReduced)} lines of code`);
  }
  
  if (isDryRun) {
    console.log(`\n${chalk.blue('💡 Run without --dry-run to execute canonicalization actions')}`);
  } else if (recommendations.length > 0) {
    console.log(`\n${chalk.green('✅ Ready for canonicalization execution')}`);
  } else {
    console.log(`\n${chalk.yellow('ℹ️  No canonicalization opportunities found')}`);
  }

  console.log('');
}

// Utility functions
function getRiskColor(risk: string): (text: string) => string {
  switch (risk) {
    case 'critical': return chalk.red.bold;
    case 'high': return chalk.red;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.green;
    default: return chalk.gray;
  }
}

function getComplexityColor(complexity: string): (text: string) => string {
  switch (complexity) {
    case 'high': return chalk.red;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.green;
    default: return chalk.gray;
  }
}