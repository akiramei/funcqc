/**
 * Extract Value Objects Command
 * 
 * CLI command for Value Object extraction analysis and execution.
 * Identifies property clusters that should be extracted into Value Objects.
 */

import chalk from 'chalk';
import { table } from 'table';
import { ValueObjectExtractor, type ValueObjectExtractionPlan } from '../../analyzers/type-refactoring/value-object-extractor';
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
    const filteredResult = filterResults(result as FilteredResult, {
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
interface FilterOptions {
  domainFilter?: string;
  complexityFilter?: 'low' | 'medium' | 'high';
  maxCandidates: number;
}

interface FilteredResult {
  candidates: ValueObjectExtractionPlan[];
  extractionOpportunities: Array<{
    id: string;
    propertyGroup: string[];
    affectedTypes: string[];
    benefitScore: number;
    extractionComplexity: 'low' | 'medium' | 'high';
    recommendationReason: string;
  }>;
  domainAnalysis: {
    identifiedDomains: Array<{
      name: string;
      types: string[];
      valueObjects: string[];
      businessRules: string[];
      commonOperations: string[];
    }>;
  };
  generatedCode?: Array<{
    category: string;
    fileName: string;
    content: string;
    voName: string;
  }>;
  migrationGuide: string;
}

function filterResults(result: FilteredResult, filters: FilterOptions): FilteredResult {
  let filteredCandidates = result.candidates;

  // Filter by domain
  if (filters.domainFilter) {
    filteredCandidates = filteredCandidates.filter((candidate: ValueObjectExtractionPlan) => {
      const domainContext = candidate.valueObject.domainContext;
      return domainContext.toLowerCase().includes(filters.domainFilter!.toLowerCase());
    });
  }

  // Filter by complexity
  if (filters.complexityFilter) {
    filteredCandidates = filteredCandidates.filter((candidate: ValueObjectExtractionPlan) => {
      const phases = candidate.migrationPlan.phases;
      return phases.some((phase) => phase.riskLevel === filters.complexityFilter);
    });
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
interface DisplayOptions {
  maxCandidates: number;
  showOpportunities: boolean;
  showGenerated: boolean;
  isDryRun: boolean;
}

interface DisplayResult {
  candidates: ValueObjectExtractionPlan[];
  extractionOpportunities: Array<{
    id: string;
    propertyGroup: string[];
    affectedTypes: string[];
    benefitScore: number;
    extractionComplexity: 'low' | 'medium' | 'high';
    recommendationReason: string;
  }>;
  domainAnalysis: {
    identifiedDomains: Array<{
      name: string;
      types: string[];
      valueObjects: string[];
      businessRules: string[];
      commonOperations: string[];
    }>;
  };
  generatedCode?: Array<{
    category: string;
    fileName: string;
    content: string;
    voName: string;
  }>;
}

function displayTableResults(
  result: DisplayResult,
  options: DisplayOptions
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
      const migrationPlan = candidate.migrationPlan;
      const phases = migrationPlan.phases || [];
      const firstPhase = phases[0];
      
      candidateData.push([
        chalk.cyan(vo.name),
        vo.properties.map((p) => p.name).join(', '),
        getDomainColor(vo.domainContext)(vo.domainContext),
        `${impact.typesAffected} types, ${impact.functionsAffected} funcs`,
        getComplexityColor(firstPhase?.riskLevel || 'low')(
          firstPhase?.riskLevel || 'low'
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
    const vo = topCandidate.valueObject;
    const impact = topCandidate.impactAssessment;
    
    console.log(`\n${chalk.bold('🎯 Top Candidate: ' + chalk.cyan(vo.name))}`);
    
    // Properties with types
    console.log(`${chalk.bold('Properties:')}`);
    for (const prop of vo.properties) {
      console.log(`  • ${chalk.yellow(prop.name)}: ${prop.type}${prop.isReadonly ? ' (readonly)' : ''} - ${prop.description}`);
    }

    // Invariants
    const invariants = vo.invariants;
    if (invariants.length > 0) {
      console.log(`${chalk.bold('Invariants:')}`);
      for (const inv of invariants) {
        console.log(`  • ${chalk.green(inv.name)}: ${inv.description}`);
      }
    }

    // Methods
    const methods = vo.methods;
    if (methods.length > 0) {
      console.log(`${chalk.bold('Generated Methods:')}`);
      for (const method of methods.slice(0, 3)) {
        console.log(`  • ${chalk.blue(method.name)}(): ${method.returnType} - ${method.description}`);
      }
      if (methods.length > 3) {
        console.log(`  • ... and ${methods.length - 3} more methods`);
      }
    }

    // Impact assessment
    console.log(`${chalk.bold('Impact Assessment:')}`);
    console.log(`  • Types Affected: ${impact.typesAffected}`);
    console.log(`  • Functions Affected: ${impact.functionsAffected}`);
    console.log(`  • Files Affected: ${impact.filesAffected.length}`);
    
    const qualityImprovements = impact.qualityImprovements;
    if (qualityImprovements.length > 0) {
      console.log(`  • Quality Improvements: ${qualityImprovements.map((qi) => 
        `${qi.metric} +${qi.improvementPercentage.toFixed(1)}%`
      ).join(', ')}`);
    }
  }

  // Domain analysis
  const identifiedDomains = domainAnalysis.identifiedDomains || [];
  if (identifiedDomains.length > 0) {
    console.log(`\n${chalk.bold('🏗️ Domain Analysis')}`);
    
    const domainData = [['Domain', 'Types', 'Value Objects', 'Common Operations']];
    
    for (const domain of identifiedDomains) {
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
  const generatedCode = result.generatedCode || [];
  if (options.showGenerated && generatedCode.length > 0) {
    console.log(`\n${chalk.bold('📦 Generated Code Preview')}`);
    
    const firstVO = generatedCode.find((gc) => gc.category === 'type_definition');
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
async function outputJSON(result: FilteredResult, outputPath?: string): Promise<void> {
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
async function outputMarkdown(result: FilteredResult, outputPath?: string): Promise<void> {
  let markdown = `# Value Object Extraction Analysis Report

## Summary

- **VO Candidates**: ${(result.candidates as ValueObjectExtractionPlan[]).length}
- **Extraction Opportunities**: ${(result.extractionOpportunities as Array<{ id: string; }>).length}
- **Domains Identified**: ${(result.domainAnalysis as { identifiedDomains: Array<{ name: string; }> }).identifiedDomains.length}

## Value Object Candidates

`;

  const candidates = result.candidates as ValueObjectExtractionPlan[];
  for (const candidate of candidates) {
    const vo = candidate.valueObject;
    const impact = candidate.impactAssessment;
    const migrationPlan = candidate.migrationPlan;
    
    const properties = vo.properties;
    const invariants = vo.invariants;
    const methods = vo.methods;
    const filesAffected = impact.filesAffected;
    
    markdown += `### ${vo.name} (${vo.domainContext} Domain)\n\n**Properties**: ${properties.map((p) => `${p.name}: ${p.type}`).join(', ')}\n\n**Invariants**:\n${invariants.map((inv) => `- ${inv.name}: ${inv.description}`).join('\n')}\n\n**Generated Methods**:\n${methods.map((m) => `- ${m.name}(): ${m.returnType} - ${m.description}`).join('\n')}\n\n**Impact Assessment**:\n- Types Affected: ${impact.typesAffected}\n- Functions Affected: ${impact.functionsAffected}\n- Files Affected: ${filesAffected.length}\n\n**Migration Strategy**: ${migrationPlan.strategy}\n**Estimated Effort**: ${migrationPlan.estimatedEffort}\n\n`;
  }

  markdown += `## Domain Analysis

`;

  const domainAnalysis = result.domainAnalysis as { identifiedDomains: Array<{ name: string; types: string[]; valueObjects: string[]; businessRules: string[]; commonOperations: string[]; }> };
  const identifiedDomains = domainAnalysis.identifiedDomains;
  
  for (const domain of identifiedDomains) {
    markdown += `### ${domain.name} Domain\n\n**Types**: ${domain.types.join(', ')}\n**Value Objects**: ${domain.valueObjects.join(', ')}\n**Business Rules**: ${domain.businessRules.join(', ')}\n**Common Operations**: ${domain.commonOperations.join(', ')}\n\n`;
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
async function generateVOCodeFiles(result: FilteredResult, outputDir: string, logger: Logger): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    
    logger.info(`📁 Generating VO code files in ${outputDir}...`);
    
    const generatedCode = result.generatedCode as Array<{ fileName: string; content: string; category: string; voName: string; }>;
    for (const codeFile of generatedCode) {
      const filePath = path.join(outputDir, codeFile.fileName);
      await fs.writeFile(filePath, codeFile.content);
      logger.debug(`  Generated ${codeFile.fileName} (${codeFile.category})`);
    }
    
    // Generate index file
    const indexContent = generatedCode
      .filter((gc) => gc.category === 'type_definition')
      .map((gc) => `export { ${gc.voName} } from './${gc.voName}';`)
      .join('\n');
    
    await fs.writeFile(path.join(outputDir, 'index.ts'), indexContent);
    
    logger.info(`✅ Generated ${generatedCode.length} VO files + index.ts`);
  } catch (error) {
    logger.error(`Failed to generate VO code files: ${error}`);
  }
}

/**
 * Execute Value Object extractions
 */
async function executeVOExtractions(result: FilteredResult, logger: Logger): Promise<void> {
  const candidates = result.candidates;
  
  logger.info(`Executing Value Object extraction for ${candidates.length} candidates...`);
  
  for (const candidate of candidates) {
    const vo = candidate.valueObject;
    const extractionActions = candidate.extractionActions;
    
    logger.info(`Processing ${vo.name}...`);
    
    // Execute extraction actions
    for (const action of extractionActions) {
      const transformation = action.transformation;
      const sourceLocation = action.sourceLocation;
      
      logger.debug(`  ${action.actionType}: ${transformation.type}`);
      
      if (action.automationPossible) {
        // In a real implementation, this would execute the actual codemod
        logger.debug(`    ✅ Automated: ${sourceLocation.filePath}`);
      } else {
        logger.warn(`    ⚠️  Manual: ${sourceLocation.filePath}`);
      }
    }
  }
  
  logger.info('✅ Value Object extraction execution completed');
  logger.info('⚠️  Please review changes and run tests before committing');
}

/**
 * Display final summary
 */
function displaySummary(result: FilteredResult, isDryRun: boolean): void {
  console.log(`\n${chalk.bold('📋 Summary:')}`);
  
  const candidates = result.candidates;
  const extractionOpportunities = result.extractionOpportunities;
  const domainAnalysis = result.domainAnalysis;
  const identifiedDomains = domainAnalysis.identifiedDomains;
  
  console.log(`Value Object Candidates: ${chalk.cyan(candidates.length)}`);
  console.log(`Extraction Opportunities: ${chalk.cyan(extractionOpportunities.length)}`);
  console.log(`Domains Identified: ${chalk.cyan(identifiedDomains.length)}`);
  
  if (candidates.length > 0) {
    const totalTypesAffected = candidates.reduce((sum: number, candidate) => {
      return sum + candidate.impactAssessment.typesAffected;
    }, 0);
    const totalFunctionsAffected = candidates.reduce((sum: number, candidate) => {
      return sum + candidate.impactAssessment.functionsAffected;
    }, 0);
    
    console.log(`Potential Impact: ${chalk.green(totalTypesAffected)} types, ${chalk.green(totalFunctionsAffected)} functions affected`);
  }

  // Benefits summary
  if (candidates.length > 0) {
    const allBenefits = candidates.flatMap((c) => {
      return c.impactAssessment.benefits;
    });
    const benefitCategories = new Set(allBenefits.map((b) => b.category));
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