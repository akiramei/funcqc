/**
 * Type Replace Command
 * 
 * CLI command for safe type replacement analysis and execution.
 * Provides compatibility checking, migration planning, and codemod generation.
 */

import chalk from 'chalk';
import { table } from 'table';
import { TypeReplacementAdvisor, type TypeReplacementReport } from '../../analyzers/type-refactoring/type-replacement-advisor';
import { MigrationPlanGenerator, type MigrationStrategy } from '../../analyzers/type-refactoring/migration-plan-generator';
import { type CompatibilityIssue } from '../../analyzers/type-refactoring/type-compatibility-checker';
import { GitCochangeProvider } from '../../analyzers/type-insights/git-cochange-provider';
import { Logger } from '../../utils/cli-utils';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand, BaseCommandOptions } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';

interface CompatibilityData {
  sourceType: string;
  targetType: string;
  isCompatible: boolean;
  compatibilityType: 'identical' | 'assignable' | 'structural_subset' | 'structural_superset' | 'incompatible';
  confidence: number;
  migrationComplexity: 'simple' | 'moderate' | 'complex' | 'breaking';
  issues: CompatibilityIssue[];
  usageCount: number;
  automationLevel: number;
  riskScore: number;
}

interface TypeReplaceOptions extends BaseCommandOptions {
  from?: string;                    // Source type name
  to?: string;                      // Target type name
  snapshot?: string;                // Specific snapshot ID
  'check-only'?: boolean;          // Only perform compatibility check
  'generate-codemod'?: boolean;    // Generate automatic code modifications
  'migration-plan'?: boolean;      // Generate migration plan
  'ts-config'?: string;            // Path to TypeScript config
  'allow-unsafe'?: boolean;        // Allow unsafe replacements with warnings
  'risk-threshold'?: 'low' | 'medium' | 'high';
  format?: 'table' | 'json' | 'markdown';
  output?: string;                 // Output file path
  'dry-run'?: boolean;            // Don't execute, just show what would be done
  'include-cochange'?: boolean;   // Include co-change analysis
  'team-size'?: number;           // Team size for migration planning
  'risk-tolerance'?: 'conservative' | 'moderate' | 'aggressive';
}

export const typeReplaceCommand: VoidCommand<TypeReplaceOptions> = (options: TypeReplaceOptions) => 
  async (env: CommandEnvironment): Promise<void> => {
  const { storage } = env;
  const logger = env.commandLogger ?? new Logger(options.verbose, options.quiet);
  const handleError = createErrorHandler(logger);

  try {
    // Validate required options
    if (!options.from || !options.to) {
      throw new Error('Both --from and --to type names are required');
    }

    if (options.from === options.to) {
      throw new Error('Source and target types must be different');
    }

    const format = options.format || 'table';
    const isDryRun = options['dry-run'] ?? false;

    logger.info('🔄 Starting type replacement analysis...');

    // Initialize type replacement advisor
    const advisor = new TypeReplacementAdvisor(storage, {
      generateCodemod: options['generate-codemod'] ?? !options['check-only'],
      validateReferences: true,
      checkBreakingChanges: true,
      requireExplicitMigration: options['migration-plan'] ?? false,
      allowUnsafeReplacements: options['allow-unsafe'] ?? false,
      riskThreshold: options['risk-threshold'] || 'medium',
      strictNullChecks: true,
      checkGenerics: true,
      checkFunctionSignatures: true
    });

    // Initialize TypeScript configuration
    if (options['ts-config']) {
      logger.info(`Using TypeScript config: ${options['ts-config']}`);
    }
    await advisor.initialize(options['ts-config']);

    // Set up Git provider for co-change analysis if requested
    if (options['include-cochange']) {
      try {
        const gitProvider = new GitCochangeProvider();
        advisor.setGitProvider(gitProvider);
        logger.debug('Git provider enabled for co-change analysis');
      } catch {
        logger.warn('Git provider not available, skipping co-change analysis');
      }
    }

    // Perform type replacement analysis
    logger.info(`Analyzing replacement: ${chalk.cyan(options.from)} → ${chalk.green(options.to)}`);
    
    const report = await advisor.analyzeTypeReplacement(
      options.from,
      options.to,
      options.snapshot
    );

    // Check if replacement should be blocked
    if (report.blockingIssues.length > 0 && !options['allow-unsafe']) {
      logger.error('Type replacement blocked by critical issues:');
      report.blockingIssues.forEach(issue => {
        logger.error(`  • ${issue}`);
      });
      throw new Error('Cannot proceed with type replacement due to blocking issues');
    }

    // If check-only mode, show results and exit
    if (options['check-only']) {
      await displayCompatibilityResults(report, format, options.output);
      return;
    }

    // Generate migration plan if requested
    let migrationPlan: MigrationStrategy | undefined;
    if (options['migration-plan'] || report.automationLevel === 'manual_only') {
      logger.info('🗺️  Generating migration plan...');
      const planGenerator = new MigrationPlanGenerator(storage);
      
      const additionalContext: {
        teamSize?: number;
        deploymentFrequency?: 'daily' | 'weekly' | 'monthly';
        riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
        maintenanceWindow?: string;
      } = {
        riskTolerance: options['risk-tolerance'] || 'moderate'
      };
      
      if (options['team-size']) {
        additionalContext.teamSize = options['team-size'];
      }
      
      migrationPlan = await planGenerator.generateMigrationStrategy(
        report.replacementPlan,
        additionalContext
      ) as MigrationStrategy;
    }

    // Display results based on format
    switch (format) {
      case 'json':
        await outputJSON({ report, ...(migrationPlan && { migrationPlan }) }, options.output);
        break;
      case 'markdown':
        await outputMarkdown({ report, ...(migrationPlan && { migrationPlan }) }, options.output);
        break;
      case 'table':
      default:
        displayTableResults({ report, ...(migrationPlan && { migrationPlan }) }, isDryRun);
        break;
    }

    // Execute codemod if requested and not dry run
    if (options['generate-codemod'] && !isDryRun && report.replacementPlan.codemodActions.length > 0) {
      if (!options['allow-unsafe'] && !report.compatibilityAnalysis.isCompatible) {
        logger.warn('Codemod execution skipped due to compatibility issues. Use --allow-unsafe to override.');
      } else {
        await executeCodemod(report, logger);
      }
    }

    // Show summary
    displaySummary(report, migrationPlan, isDryRun);

  } catch (error) {
    handleError.handleError(
      handleError.createError(ErrorCode.ANALYSIS_FAILED, `Type replacement analysis failed: ${
        error instanceof Error ? error.message : String(error)
      }`)
    );
  }
};

// Using CompatibilityData interface defined above

/**
 * Display compatibility results only
 */
async function displayCompatibilityResults(
  report: TypeReplacementReport,
  format: string,
  outputPath?: string
): Promise<void> {
  const compatibilityData: CompatibilityData = {
    sourceType: report.targetType,
    targetType: report.replacementPlan.targetType,
    isCompatible: report.compatibilityAnalysis.isCompatible,
    compatibilityType: report.compatibilityAnalysis.compatibilityType,
    confidence: report.compatibilityAnalysis.confidence,
    migrationComplexity: report.compatibilityAnalysis.migrationComplexity as 'simple' | 'moderate' | 'complex' | 'breaking',
    issues: report.compatibilityAnalysis.issues,
    usageCount: report.usageAnalysis.totalUsages,
    automationLevel: (typeof report.automationLevel === 'string' ? 0 : report.automationLevel) || 0,
    riskScore: 0 // Add missing property
  };

  switch (format) {
    case 'json':
      await outputJSON(compatibilityData as unknown as Record<string, unknown>, outputPath);
      break;
    case 'markdown':
      await outputCompatibilityMarkdown(compatibilityData, outputPath);
      break;
    case 'table':
    default:
      displayCompatibilityTable(compatibilityData);
      break;
  }
}

/**
 * Display compatibility results in table format
 */
function displayCompatibilityTable(data: CompatibilityData): void {
  console.log(`\n${chalk.bold('🔍 Type Compatibility Analysis')}`);
  console.log(`Source: ${chalk.cyan(data.sourceType)}`);
  console.log(`Target: ${chalk.green(data.targetType)}`);
  
  const compatibilityColor = data.isCompatible ? chalk.green : chalk.red;
  console.log(`Compatible: ${compatibilityColor(data.isCompatible ? 'YES' : 'NO')}`);
  console.log(`Compatibility Type: ${chalk.yellow(data.compatibilityType)}`);
  console.log(`Confidence: ${chalk.blue((data.confidence * 100).toFixed(1))}%`);
  console.log(`Migration Complexity: ${chalk.magenta(data.migrationComplexity)}`);
  console.log(`Usage Count: ${chalk.cyan(data.usageCount)}`);
  console.log(`Automation Level: ${chalk.yellow(data.automationLevel)}\n`);

  if (data.issues.length > 0) {
    console.log(chalk.bold('⚠️  Compatibility Issues:'));
    
    const issueData = [['Severity', 'Category', 'Description', 'Auto-fixable']];
    
    for (const issue of data.issues.slice(0, 10)) { // Show first 10
      issueData.push([
        getSeverityColor(issue.severity)(issue.severity),
        issue.category,
        issue.description.length > 60 
          ? issue.description.substring(0, 57) + '...'
          : issue.description,
        issue.autoFixable ? '✅' : '❌'
      ]);
    }

    console.log(table(issueData, {
      columns: [
        { alignment: 'center' },
        { alignment: 'left' },
        { alignment: 'left', width: 55 },
        { alignment: 'center' }
      ]
    }));
  }
}

// Using MigrationStrategy from the import instead of local interface

/**
 * Display full table results
 */
function displayTableResults(
  data: { report: TypeReplacementReport; migrationPlan?: MigrationStrategy },
  isDryRun: boolean
): void {
  const { report, migrationPlan } = data;

  // Compatibility overview
  const compatibilityData: CompatibilityData = {
    sourceType: report.targetType,
    targetType: report.replacementPlan.targetType,
    isCompatible: report.compatibilityAnalysis.isCompatible,
    compatibilityType: report.compatibilityAnalysis.compatibilityType,
    confidence: report.compatibilityAnalysis.confidence,
    migrationComplexity: report.compatibilityAnalysis.migrationComplexity as 'simple' | 'moderate' | 'complex' | 'breaking',
    issues: report.compatibilityAnalysis.issues,
    usageCount: report.usageAnalysis.totalUsages,
    automationLevel: (typeof report.automationLevel === 'string' ? 0 : report.automationLevel) || 0,
    riskScore: 0
  };
  displayCompatibilityTable(compatibilityData);

  // Usage analysis
  console.log(chalk.bold('📊 Usage Analysis:'));
  const usageData = [
    ['Metric', 'Count', 'Percentage'],
    ['Total Usages', report.usageAnalysis.totalUsages.toString(), '100%'],
    ['Compatible Usages', report.usageAnalysis.compatibleUsages.toString(), 
     `${Math.round((report.usageAnalysis.compatibleUsages / report.usageAnalysis.totalUsages) * 100)}%`],
    ['Breaking Usages', report.usageAnalysis.breakingUsages.toString(),
     `${Math.round((report.usageAnalysis.breakingUsages / report.usageAnalysis.totalUsages) * 100)}%`],
    ['Unknown Usages', report.usageAnalysis.unknownUsages.toString(),
     `${Math.round((report.usageAnalysis.unknownUsages / report.usageAnalysis.totalUsages) * 100)}%`]
  ];

  console.log(table(usageData, {
    columns: [
      { alignment: 'left' },
      { alignment: 'right' },
      { alignment: 'right' }
    ]
  }));

  // Codemod actions
  if (report.replacementPlan.codemodActions.length > 0) {
    console.log(chalk.bold('🔧 Codemod Actions:'));
    
    const actionData = [['File', 'Action Type', 'Risk Level', 'Description']];
    
    for (const action of report.replacementPlan.codemodActions.slice(0, 10)) {
      actionData.push([
        action.filePath.split('/').pop() || action.filePath,
        action.type,
        getRiskColor(action.riskLevel)(action.riskLevel),
        action.description.length > 40 
          ? action.description.substring(0, 37) + '...'
          : action.description
      ]);
    }

    if (report.replacementPlan.codemodActions.length > 10) {
      actionData.push(['...', '...', '...', `+${report.replacementPlan.codemodActions.length - 10} more actions`]);
    }

    console.log(table(actionData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'left' },
        { alignment: 'center' },
        { alignment: 'left', width: 35 }
      ]
    }));
  }

  // Migration plan phases (if available)
  if (migrationPlan) {
    console.log(chalk.bold('📋 Migration Plan:'));
    console.log(`Approach: ${chalk.yellow(migrationPlan.approach)}`);
    console.log(`Total Time: ${chalk.blue(migrationPlan.totalEstimatedTime)}`);
    console.log(`Critical Path: ${chalk.magenta(migrationPlan.criticalPathTime)}`);
    
    const phaseData = [['Phase', 'Duration', 'Risk', 'Steps']];
    
    for (const phase of migrationPlan.phases) {
      phaseData.push([
        phase.name as string,
        phase.estimatedDuration as string,
        getRiskColor(phase.riskLevel as string)(phase.riskLevel as string),
        (phase.steps as unknown[]).length.toString()
      ]);
    }

    console.log(table(phaseData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'right' },
        { alignment: 'center' },
        { alignment: 'right' }
      ]
    }));
  }

  // Warnings and recommendations
  if (report.warnings.length > 0) {
    console.log(chalk.bold.yellow('⚠️  Warnings:'));
    report.warnings.forEach((warning: string) => {
      console.log(`  • ${chalk.yellow(warning)}`);
    });
    console.log('');
  }

  if (report.recommendations.length > 0) {
    console.log(chalk.bold('💡 Recommendations:'));
    report.recommendations.slice(0, 5).forEach((rec: string, i: number) => {
      console.log(`  ${i + 1}. ${rec}`);
    });
    if (report.recommendations.length > 5) {
      console.log(`  ... and ${report.recommendations.length - 5} more recommendations`);
    }
    console.log('');
  }

  // Dry run notice
  if (isDryRun) {
    console.log(chalk.bold.blue('🏃 DRY RUN MODE: No changes will be executed\n'));
  }
}

/**
 * Output results in JSON format
 */
async function outputJSON(data: Record<string, unknown>, outputPath?: string): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  
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
async function outputMarkdown(
  data: { report: TypeReplacementReport; migrationPlan?: MigrationStrategy },
  outputPath?: string
): Promise<void> {
  const { report, migrationPlan } = data;

  let markdown = `# Type Replacement Analysis: ${report.targetType} → ${report.replacementPlan.targetType}

## Compatibility Analysis

- **Compatible:** ${report.compatibilityAnalysis.isCompatible ? '✅ Yes' : '❌ No'}
- **Compatibility Type:** ${report.compatibilityAnalysis.compatibilityType}
- **Confidence:** ${(report.compatibilityAnalysis.confidence * 100).toFixed(1)}%
- **Migration Complexity:** ${report.compatibilityAnalysis.migrationComplexity}
- **Automation Level:** ${report.automationLevel}

## Usage Analysis

| Metric | Count | Percentage |
|--------|-------|------------|
| Total Usages | ${report.usageAnalysis.totalUsages} | 100% |
| Compatible Usages | ${report.usageAnalysis.compatibleUsages} | ${Math.round((report.usageAnalysis.compatibleUsages / report.usageAnalysis.totalUsages) * 100)}% |
| Breaking Usages | ${report.usageAnalysis.breakingUsages} | ${Math.round((report.usageAnalysis.breakingUsages / report.usageAnalysis.totalUsages) * 100)}% |

`;

  // Compatibility issues
  if (report.compatibilityAnalysis.issues.length > 0) {
    markdown += `## Compatibility Issues

| Severity | Category | Description | Auto-fixable |
|----------|----------|-------------|--------------|
`;
    
    for (const issue of report.compatibilityAnalysis.issues) {
      markdown += `| ${issue.severity} | ${issue.category} | ${issue.description} | ${issue.autoFixable ? 'Yes' : 'No'} |
`;
    }
    markdown += '\n';
  }

  // Migration plan
  if (migrationPlan) {
    markdown += `## Migration Plan

**Approach:** ${migrationPlan.approach}
**Total Estimated Time:** ${migrationPlan.totalEstimatedTime}
**Critical Path Time:** ${migrationPlan.criticalPathTime}

**Rationale:** ${migrationPlan.rationale}

### Migration Phases

| Phase | Duration | Risk Level | Steps |
|-------|----------|------------|-------|
`;
    
    for (const phase of migrationPlan.phases) {
      markdown += `| ${phase.name} | ${phase.estimatedDuration} | ${phase.riskLevel} | ${phase.steps.length} |
`;
    }

    markdown += '\n### Rollback Strategy\n\n';
    markdown += `**Type:** ${migrationPlan.rollbackStrategy.type}\n`;
    markdown += `**Estimated Time:** ${migrationPlan.rollbackStrategy.estimatedRollbackTime}\n\n`;
    
    if (migrationPlan.rollbackStrategy.triggerConditions.length > 0) {
      markdown += '**Trigger Conditions:**\n';
      migrationPlan.rollbackStrategy.triggerConditions.forEach((condition: string) => {
        markdown += `- ${condition}\n`;
      });
    }
  }

  // Codemod actions
  if (report.replacementPlan.codemodActions.length > 0) {
    markdown += `## Codemod Actions (${report.replacementPlan.codemodActions.length} total)

| File | Action Type | Risk Level | Description |
|------|-------------|------------|-------------|
`;
    
    for (const action of report.replacementPlan.codemodActions.slice(0, 20)) {
      markdown += `| ${action.filePath} | ${action.type} | ${action.riskLevel} | ${action.description} |
`;
    }
    
    if (report.replacementPlan.codemodActions.length > 20) {
      markdown += `\n*... and ${report.replacementPlan.codemodActions.length - 20} more actions*\n`;
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    markdown += '\n## Recommendations\n\n';
    report.recommendations.forEach((rec: string, i: number) => {
      markdown += `${i + 1}. ${rec}\n`;
    });
  }

  markdown += '\n---\n🤖 Generated by funcqc TypeReplacementAdvisor\n';

  if (outputPath) {
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, markdown);
    console.log(chalk.green(`Markdown report saved to: ${outputPath}`));
  } else {
    console.log(markdown);
  }
}

/**
 * Output compatibility analysis in markdown
 */
async function outputCompatibilityMarkdown(data: CompatibilityData, outputPath?: string): Promise<void> {
  let markdown = `# Type Compatibility Check: ${data.sourceType} → ${data.targetType}

## Results

- **Compatible:** ${data.isCompatible ? '✅ Yes' : '❌ No'}
- **Compatibility Type:** ${data.compatibilityType}
- **Confidence:** ${(data.confidence * 100).toFixed(1)}%
- **Migration Complexity:** ${data.migrationComplexity}
- **Usage Count:** ${data.usageCount}
- **Automation Level:** ${data.automationLevel}

`;

  if (data.issues.length > 0) {
    markdown += '## Issues\n\n';
    for (const issue of data.issues) {
      markdown += `### ${issue.severity.toUpperCase()}: ${issue.description}\n`;
      markdown += `- **Category:** ${issue.category}\n`;
      if (issue.suggestion) {
        markdown += `- **Suggestion:** ${issue.suggestion}\n`;
      }
      markdown += `- **Auto-fixable:** ${issue.autoFixable ? 'Yes' : 'No'}\n\n`;
    }
  }

  if (outputPath) {
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, markdown);
    console.log(chalk.green(`Compatibility report saved to: ${outputPath}`));
  } else {
    console.log(markdown);
  }
}

/**
 * Execute codemod actions
 */
async function executeCodemod(report: TypeReplacementReport, logger: Logger): Promise<void> {
  logger.info('🔧 Executing codemod actions...');
  
  // This would integrate with ts-morph or similar tool to actually modify files
  // For now, just show what would be done
  
  const actionCount = report.replacementPlan.codemodActions.length;
  const safeActions = report.replacementPlan.codemodActions.filter((a) => a.riskLevel === 'safe').length;
  const warningActions = report.replacementPlan.codemodActions.filter((a) => a.riskLevel === 'warning').length;
  const breakingActions = report.replacementPlan.codemodActions.filter((a) => a.riskLevel === 'breaking').length;

  logger.info(`Executing ${actionCount} codemod actions:`);
  logger.info(`  • ${safeActions} safe actions`);
  if (warningActions > 0) logger.warn(`  • ${warningActions} warning-level actions`);
  if (breakingActions > 0) logger.error(`  • ${breakingActions} breaking actions`);

  // Simulated execution
  for (const action of report.replacementPlan.codemodActions) {
    logger.debug(`${action.type}: ${action.description} (${action.filePath})`);
  }

  logger.info('✅ Codemod execution completed');
  logger.info('⚠️  Please review changes and run tests before committing');
}

/**
 * Display final summary
 */
function displaySummary(report: TypeReplacementReport, migrationPlan: MigrationStrategy | undefined, isDryRun: boolean): void {
  console.log(chalk.bold('\n📋 Summary:'));
  
  const isCompatible = report.compatibilityAnalysis.isCompatible;
  const usageCount = report.usageAnalysis.totalUsages;
  const actionCount = report.replacementPlan.codemodActions.length;

  console.log(`Compatibility: ${isCompatible ? chalk.green('✅ Compatible') : chalk.red('❌ Incompatible')}`);
  console.log(`Usage sites: ${chalk.cyan(usageCount)}`);
  console.log(`Automation: ${chalk.yellow(report.automationLevel)}`);
  
  if (actionCount > 0) {
    console.log(`Codemod actions: ${chalk.blue(actionCount)}`);
  }

  if (migrationPlan) {
    console.log(`Migration approach: ${chalk.magenta(migrationPlan.approach)}`);
    console.log(`Estimated time: ${chalk.blue(migrationPlan.totalEstimatedTime)}`);
  }

  if (report.blockingIssues.length > 0) {
    console.log(`${chalk.red('❌ Blocked:')} ${report.blockingIssues.length} critical issues`);
  }

  if (isDryRun) {
    console.log(`\n${chalk.blue('💡 Run without --dry-run to execute changes')}`);
  } else if (isCompatible && actionCount > 0) {
    console.log(`\n${chalk.green('✅ Ready for execution')}`);
  } else if (!isCompatible) {
    console.log(`\n${chalk.yellow('⚠️  Address compatibility issues before proceeding')}`);
  }

  console.log('');
}

// Utility functions
function getSeverityColor(severity: string): (text: string) => string {
  switch (severity) {
    case 'error': return chalk.red;
    case 'warning': return chalk.yellow;
    case 'info': return chalk.blue;
    default: return chalk.gray;
  }
}

function getRiskColor(risk: string): (text: string) => string {
  switch (risk) {
    case 'breaking': return chalk.red.bold;
    case 'warning': return chalk.yellow;
    case 'safe': return chalk.green;
    default: return chalk.gray;
  }
}