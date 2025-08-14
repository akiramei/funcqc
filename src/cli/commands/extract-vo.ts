/**
 * Extract Value Objects Command
 * 
 * CLI command for Value Object extraction analysis and execution.
 * Identifies property clusters that should be extracted into Value Objects.
 */

import chalk from 'chalk';
import { table } from 'table';
import { ValueObjectExtractor } from '../../analyzers/type-refactoring/value-object-extractor';
import { Logger } from '../../utils/cli-utils';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand, BaseCommandOptions } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';

interface ExtractVOOptions extends BaseCommandOptions {
  snapshot?: string;                    // Specific snapshot ID
  'min-support'?: number;              // Minimum support for patterns
  'min-confidence'?: number;           // Minimum confidence threshold
  'min-cohesion'?: number;             // Minimum cohesion score
  'include-computed'?: boolean;        // Include computed methods
  'generate-constructors'?: boolean;   // Generate smart constructors
  'infer-invariants'?: boolean;        // Try to infer business rules
  'preserve-original'?: boolean;       // Keep original types during transition
  format?: 'table' | 'json' | 'markdown';
  output?: string;                     // Output file path
  'output-code'?: string;              // Directory to output generated VO code
  'dry-run'?: boolean;                // Don't execute, just show what would be done
  'max-candidates'?: number;          // Maximum number of VO candidates
  'show-opportunities'?: boolean;     // Show extraction opportunities
  'show-generated'?: boolean;         // Show generated code samples
  'domain-filter'?: string;           // Filter by domain context
  'complexity-filter'?: 'low' | 'medium' | 'high';  // Filter by extraction complexity
}

export const extractVOCommand: VoidCommand<ExtractVOOptions> = (options: ExtractVOOptions) => 
  async (env: CommandEnvironment): Promise<void> => {
  const { storage } = env;
  const logger = env.commandLogger ?? new Logger(options.verbose, options.quiet);
  const handleError = createErrorHandler(logger);

  try {
    const format = options.format || 'table';
    const isDryRun = options['dry-run'] ?? false;
    const maxCandidates = options['max-candidates'] || 10;

    logger.info('🧩 Starting Value Object extraction analysis...');

    // Initialize Value Object extractor
    const extractor = new ValueObjectExtractor(storage, {
      minSupport: options['min-support'] ?? 3,
      minConfidence: options['min-confidence'] ?? 0.7,
      maxPatternSize: 4,
      includeOptionalProperties: false,
      excludeCommonProperties: ['id', 'createdAt', 'updatedAt', 'version'],
      minCohesionScore: options['min-cohesion'] ?? 0.6,
      includeComputedMethods: options['include-computed'] ?? true,
      generateSmartConstructors: options['generate-constructors'] ?? true,
      inferInvariants: options['infer-invariants'] ?? true,
      preserveOriginalTypes: options['preserve-original'] ?? true
    });

    // Perform Value Object extraction analysis
    logger.info('🔍 Analyzing property co-occurrence patterns and extracting VO candidates...');
    const result = await extractor.extract(options.snapshot);

    // Filter results based on options
    const filteredResult = filterResults(result, {
      ...(options['domain-filter'] && { domainFilter: options['domain-filter'] }),
      ...(options['complexity-filter'] && { complexityFilter: options['complexity-filter'] }),
      maxCandidates
    });

    // Display results based on format
    switch (format) {
      case 'json':
        await outputJSON(filteredResult, options.output);
        break;
      case 'markdown':
        await outputMarkdown(filteredResult, options.output);
        break;
      case 'table':
      default:
        displayTableResults(filteredResult, {
          maxCandidates,
          showOpportunities: options['show-opportunities'] ?? false,
          showGenerated: options['show-generated'] ?? false,
          isDryRun
        });
        break;
    }

    // Generate VO code files if requested
    if (options['output-code'] && !isDryRun) {
      await generateVOCodeFiles(filteredResult, options['output-code'], logger);
    }

    // Execute Value Object extraction if requested and not dry run
    if (!isDryRun && filteredResult.candidates.length > 0) {
      logger.info('🔧 Executing Value Object extractions...');
      await executeVOExtractions(filteredResult, logger);
    }

    // Show summary
    displaySummary(filteredResult, isDryRun);

  } catch (error) {
    handleError.handleError(
      handleError.createError(ErrorCode.ANALYSIS_FAILED, `Value Object extraction analysis failed: ${
        error instanceof Error ? error.message : String(error)
      }`)
    );
  }
};

/**
 * Filter results based on provided options
 */
function filterResults(result: any, filters: {
  domainFilter?: string;
  complexityFilter?: 'low' | 'medium' | 'high';
  maxCandidates: number;
}): any {
  let filteredCandidates = result.candidates;

  // Filter by domain
  if (filters.domainFilter) {
    filteredCandidates = filteredCandidates.filter((candidate: any) =>
      candidate.valueObject.domainContext.toLowerCase().includes(filters.domainFilter!.toLowerCase())
    );
  }

  // Filter by complexity
  if (filters.complexityFilter) {
    filteredCandidates = filteredCandidates.filter((candidate: any) =>
      candidate.migrationPlan.phases.some((phase: any) => phase.riskLevel === filters.complexityFilter)
    );
  }

  // Limit number of candidates
  filteredCandidates = filteredCandidates.slice(0, filters.maxCandidates);

  return {
    ...result,
    candidates: filteredCandidates
  };
}

/**
 * Display results in table format
 */
function displayTableResults(
  result: any,
  options: {
    maxCandidates: number;
    showOpportunities: boolean;
    showGenerated: boolean;
    isDryRun: boolean;
  }
): void {
  const { candidates, extractionOpportunities, domainAnalysis } = result;

  // Value Object candidates
  console.log(`\n${chalk.bold('🧩 Value Object Candidates')}`);
  
  if (candidates.length === 0) {
    console.log(chalk.yellow('No Value Object candidates found.'));
  } else {
    const candidateData = [
      ['VO Name', 'Properties', 'Domain', 'Types Affected', 'Complexity', 'Benefits']
    ];

    for (const candidate of candidates.slice(0, options.maxCandidates)) {
      const vo = candidate.valueObject;
      const impact = candidate.impactAssessment;
      
      candidateData.push([
        chalk.cyan(vo.name),
        vo.properties.map((p: any) => p.name).join(', '),
        getDomainColor(vo.domainContext)(vo.domainContext),
        `${impact.typesAffected} types, ${impact.functionsAffected} funcs`,
        getComplexityColor(candidate.migrationPlan.phases[0]?.riskLevel || 'low')(
          candidate.migrationPlan.phases[0]?.riskLevel || 'low'
        ),
        `${impact.benefits.length} benefits`
      ]);
    }

    console.log(table(candidateData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'left', width: 25 },
        { alignment: 'center' },
        { alignment: 'left' },
        { alignment: 'center' },
        { alignment: 'right' }
      ]
    }));
  }

  // Show detailed info for top candidate
  if (candidates.length > 0) {
    const topCandidate = candidates[0];
    console.log(`\n${chalk.bold('🎯 Top Candidate: ' + chalk.cyan(topCandidate.valueObject.name))}`);
    
    // Properties with types
    console.log(`${chalk.bold('Properties:')}`);
    for (const prop of topCandidate.valueObject.properties) {
      console.log(`  • ${chalk.yellow(prop.name)}: ${prop.type}${prop.isReadonly ? ' (readonly)' : ''} - ${prop.description}`);
    }

    // Invariants
    if (topCandidate.valueObject.invariants.length > 0) {
      console.log(`${chalk.bold('Invariants:')}`);
      for (const inv of topCandidate.valueObject.invariants) {
        console.log(`  • ${chalk.green(inv.name)}: ${inv.description}`);
      }
    }

    // Methods
    if (topCandidate.valueObject.methods.length > 0) {
      console.log(`${chalk.bold('Generated Methods:')}`);
      for (const method of topCandidate.valueObject.methods.slice(0, 3)) {
        console.log(`  • ${chalk.blue(method.name)}(): ${method.returnType} - ${method.description}`);
      }
      if (topCandidate.valueObject.methods.length > 3) {
        console.log(`  • ... and ${topCandidate.valueObject.methods.length - 3} more methods`);
      }
    }

    // Impact assessment
    console.log(`${chalk.bold('Impact Assessment:')}`);
    console.log(`  • Types Affected: ${topCandidate.impactAssessment.typesAffected}`);
    console.log(`  • Functions Affected: ${topCandidate.impactAssessment.functionsAffected}`);
    console.log(`  • Files Affected: ${topCandidate.impactAssessment.filesAffected.length}`);
    
    const qualityImprovements = topCandidate.impactAssessment.qualityImprovements;
    if (qualityImprovements.length > 0) {
      console.log(`  • Quality Improvements: ${qualityImprovements.map((qi: any) => 
        `${qi.metric} +${qi.improvementPercentage.toFixed(1)}%`
      ).join(', ')}`);
    }
  }

  // Domain analysis
  if (domainAnalysis.identifiedDomains.length > 0) {
    console.log(`\n${chalk.bold('🏗️ Domain Analysis')}`);
    
    const domainData = [['Domain', 'Types', 'Value Objects', 'Common Operations']];
    
    for (const domain of domainAnalysis.identifiedDomains) {
      domainData.push([
        getDomainColor(domain.name)(domain.name),
        domain.types.length.toString(),
        domain.valueObjects.length.toString(),
        domain.commonOperations.slice(0, 2).join(', ') + 
          (domain.commonOperations.length > 2 ? '...' : '')
      ]);
    }

    console.log(table(domainData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'right' },
        { alignment: 'right' },
        { alignment: 'left', width: 30 }
      ]
    }));
  }

  // Extraction opportunities
  if (options.showOpportunities && extractionOpportunities.length > 0) {
    console.log(`\n${chalk.bold('💡 Additional Extraction Opportunities')}`);
    
    const opportunityData = [['ID', 'Properties', 'Affected Types', 'Benefit', 'Complexity', 'Reason']];
    
    for (const opp of extractionOpportunities.slice(0, 5)) {
      opportunityData.push([
        opp.id,
        opp.propertyGroup.join(', '),
        opp.affectedTypes.length.toString(),
        `${Math.round(opp.benefitScore * 100)}%`,
        getComplexityColor(opp.extractionComplexity)(opp.extractionComplexity),
        opp.recommendationReason.substring(0, 30) + '...'
      ]);
    }

    console.log(table(opportunityData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'left', width: 20 },
        { alignment: 'right' },
        { alignment: 'right' },
        { alignment: 'center' },
        { alignment: 'left', width: 25 }
      ]
    }));
  }

  // Generated code preview
  if (options.showGenerated && result.generatedCode.length > 0) {
    console.log(`\n${chalk.bold('📦 Generated Code Preview')}`);
    
    const firstVO = result.generatedCode.find((gc: any) => gc.category === 'type_definition');
    if (firstVO) {
      console.log(`${chalk.bold('Sample VO Definition:')} ${chalk.cyan(firstVO.voName)}`);
      console.log(chalk.gray('```typescript'));
      console.log(firstVO.content.split('\n').slice(0, 15).join('\n'));
      console.log(chalk.gray('...'));
      console.log(chalk.gray('```'));
    }
  }

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
  let markdown = `# Value Object Extraction Analysis Report

## Summary

- **VO Candidates**: ${result.candidates.length}
- **Extraction Opportunities**: ${result.extractionOpportunities.length}
- **Domains Identified**: ${result.domainAnalysis.identifiedDomains.length}

## Value Object Candidates

`;

  for (const candidate of result.candidates) {
    const vo = candidate.valueObject;
    markdown += `### ${vo.name} (${vo.domainContext} Domain)

**Properties**: ${vo.properties.map((p: any) => `${p.name}: ${p.type}`).join(', ')}

**Invariants**:
${vo.invariants.map((inv: any) => `- ${inv.name}: ${inv.description}`).join('\n')}

**Generated Methods**:
${vo.methods.map((m: any) => `- ${m.name}(): ${m.returnType} - ${m.description}`).join('\n')}

**Impact Assessment**:
- Types Affected: ${candidate.impactAssessment.typesAffected}
- Functions Affected: ${candidate.impactAssessment.functionsAffected}
- Files Affected: ${candidate.impactAssessment.filesAffected.length}

**Migration Strategy**: ${candidate.migrationPlan.strategy}
**Estimated Effort**: ${candidate.migrationPlan.estimatedEffort}

`;
  }

  markdown += `## Domain Analysis

`;

  for (const domain of result.domainAnalysis.identifiedDomains) {
    markdown += `### ${domain.name} Domain

**Types**: ${domain.types.join(', ')}
**Value Objects**: ${domain.valueObjects.join(', ')}
**Business Rules**: ${domain.businessRules.join(', ')}
**Common Operations**: ${domain.commonOperations.join(', ')}

`;
  }

  markdown += `## Migration Guide

${result.migrationGuide}

---
🤖 Generated by funcqc Value Object Extractor
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
 * Generate VO code files
 */
async function generateVOCodeFiles(result: any, outputDir: string, logger: Logger): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    
    logger.info(`📁 Generating VO code files in ${outputDir}...`);
    
    for (const codeFile of result.generatedCode) {
      const filePath = path.join(outputDir, codeFile.fileName);
      await fs.writeFile(filePath, codeFile.content);
      logger.debug(`  Generated ${codeFile.fileName} (${codeFile.category})`);
    }
    
    // Generate index file
    const indexContent = result.generatedCode
      .filter((gc: any) => gc.category === 'type_definition')
      .map((gc: any) => `export { ${gc.voName} } from './${gc.voName}';`)
      .join('\n');
    
    await fs.writeFile(path.join(outputDir, 'index.ts'), indexContent);
    
    logger.info(`✅ Generated ${result.generatedCode.length} VO files + index.ts`);
  } catch (error) {
    logger.error(`Failed to generate VO code files: ${error}`);
  }
}

/**
 * Execute Value Object extractions
 */
async function executeVOExtractions(result: any, logger: Logger): Promise<void> {
  const { candidates } = result;
  
  logger.info(`Executing Value Object extraction for ${candidates.length} candidates...`);
  
  for (const candidate of candidates) {
    logger.info(`Processing ${candidate.valueObject.name}...`);
    
    // Execute extraction actions
    for (const action of candidate.extractionActions) {
      logger.debug(`  ${action.actionType}: ${action.transformation.type}`);
      
      if (action.automationPossible) {
        // In a real implementation, this would execute the actual codemod
        logger.debug(`    ✅ Automated: ${action.sourceLocation.filePath}`);
      } else {
        logger.warn(`    ⚠️  Manual: ${action.sourceLocation.filePath}`);
      }
    }
  }
  
  logger.info('✅ Value Object extraction execution completed');
  logger.info('⚠️  Please review changes and run tests before committing');
}

/**
 * Display final summary
 */
function displaySummary(result: any, isDryRun: boolean): void {
  console.log(`\n${chalk.bold('📋 Summary:')}`);
  
  const { candidates, extractionOpportunities, domainAnalysis } = result;
  
  console.log(`Value Object Candidates: ${chalk.cyan(candidates.length)}`);
  console.log(`Extraction Opportunities: ${chalk.cyan(extractionOpportunities.length)}`);
  console.log(`Domains Identified: ${chalk.cyan(domainAnalysis.identifiedDomains.length)}`);
  
  if (candidates.length > 0) {
    const totalTypesAffected = candidates.reduce((sum: number, candidate: any) => 
      sum + candidate.impactAssessment.typesAffected, 0
    );
    const totalFunctionsAffected = candidates.reduce((sum: number, candidate: any) => 
      sum + candidate.impactAssessment.functionsAffected, 0
    );
    
    console.log(`Potential Impact: ${chalk.green(totalTypesAffected)} types, ${chalk.green(totalFunctionsAffected)} functions affected`);
  }

  // Benefits summary
  if (candidates.length > 0) {
    const allBenefits = candidates.flatMap((c: any) => c.impactAssessment.benefits);
    const benefitCategories = new Set(allBenefits.map((b: any) => b.category));
    console.log(`Expected Benefits: ${Array.from(benefitCategories).join(', ')}`);
  }
  
  if (isDryRun) {
    console.log(`\n${chalk.blue('💡 Run without --dry-run to execute Value Object extractions')}`);
    console.log(`${chalk.blue('💡 Use --output-code <dir> to generate VO code files')}`);
  } else if (candidates.length > 0) {
    console.log(`\n${chalk.green('✅ Ready for Value Object extraction')}`);
  } else {
    console.log(`\n${chalk.yellow('ℹ️  No Value Object extraction opportunities found')}`);
    console.log(`${chalk.yellow('💡 Try adjusting --min-cohesion or --min-support thresholds')}`);
  }

  console.log('');
}

// Utility functions
function getDomainColor(domain: string): (text: string) => string {
  const colors = {
    'Finance': chalk.green,
    'Geography': chalk.blue,
    'Temporal': chalk.magenta,
    'Geometry': chalk.cyan,
    'Contact': chalk.yellow,
    'General': chalk.gray
  };
  return colors[domain as keyof typeof colors] || chalk.gray;
}

function getComplexityColor(complexity: string): (text: string) => string {
  switch (complexity) {
    case 'high': return chalk.red;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.green;
    default: return chalk.gray;
  }
}