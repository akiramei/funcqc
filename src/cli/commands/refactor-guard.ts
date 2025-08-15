/**
 * Refactor Guard Command
 * 
 * CLI command for refactoring safety analysis and guardrails.
 */

import chalk from 'chalk';
import { table } from 'table';
import { RefactoringGuardRail, type RefactoringGuardRailReport } from '../../analyzers/type-refactoring/refactoring-guardrail';
import { GitCochangeProvider } from '../../analyzers/type-insights/git-cochange-provider';
import { Logger } from '../../utils/cli-utils';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand, BaseCommandOptions } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';

interface RefactorGuardOptions extends BaseCommandOptions {
  type?: string;                    // Target type name
  operation?: 'replace' | 'merge' | 'split' | 'extract' | 'inline';
  snapshot?: string;                // Specific snapshot ID
  'include-tests'?: boolean;        // Include test templates
  'include-behavioral'?: boolean;   // Include behavioral checks
  'include-cochange'?: boolean;     // Include co-change analysis
  'risk-threshold'?: 'low' | 'medium' | 'high';
  format?: 'table' | 'json' | 'markdown';
  output?: string;                  // Output file path
  'pr-template'?: boolean;          // Generate PR template
}

export const refactorGuardCommand: VoidCommand<RefactorGuardOptions> = (options: RefactorGuardOptions) => 
  async (env: CommandEnvironment): Promise<void> => {
  const { storage } = env;
  const logger = env.commandLogger ?? new Logger(!!options.verbose, !!options.quiet);
  const handleError = createErrorHandler(logger);

  try {
    // Validate required options
    if (!options.type) {
      throw new Error('Type name is required. Use --type <TypeName>');
    }

    const operation = options.operation || 'replace';
    const format = options.format || 'table';

    logger.info('🛡️  Starting refactoring safety analysis...');

    // Initialize guardrail
    const guardrail = new RefactoringGuardRail(storage, {
      includeTestTemplates: options['include-tests'] ?? true,
      includeTypeChecks: true,
      includeBehavioralChecks: options['include-behavioral'] ?? true,
      includeImpactAnalysis: true, // 影響分析は常に有効（別フラグを導入する場合はそれに連動）
      generatePRSummary: options['pr-template'] ?? true,
      riskThreshold: options['risk-threshold'] || 'medium'
    });

    // Set up Git provider for co-change analysis if requested
    if (options['include-cochange']) {
      try {
        const gitProvider = new GitCochangeProvider();
        guardrail.setGitProvider(gitProvider);
        logger.debug('Git provider enabled for co-change analysis');
      } catch {
        logger.warn('Git provider not available, skipping co-change analysis');
      }
    }

    // Perform analysis
    logger.info(`Analyzing type: ${chalk.cyan(options.type)}`);
    logger.info(`Operation: ${chalk.yellow(operation)}`);

    const report = await guardrail.analyzeTypeRefactoring(
      options.type, 
      operation,
      options.snapshot
    );

    // Display results based on format
    switch (format) {
      case 'json':
        await outputJSON(report, options.output);
        break;
      case 'markdown':
        await outputMarkdown(report, options.output);
        break;
      case 'table':
      default:
        displayTable(report);
        break;
    }

  } catch (error) {
    handleError.handleError(
      handleError.createError(ErrorCode.ANALYSIS_FAILED, `Refactor guard analysis failed: ${
        error instanceof Error ? error.message : String(error)
      }`)
    );
  }
};

/**
 * Display results in table format
 */
function displayTable(report: RefactoringGuardRailReport): void {
  // Overall risk assessment
  const riskColor = getRiskColor(report.overallRisk);
  console.log(`\n${chalk.bold('🎯 Refactoring Safety Analysis')}`);
  console.log(`Type: ${chalk.cyan(report.targetType)}`);
  console.log(`Operation: ${chalk.yellow(report.operationType)}`);
  console.log(`Risk Level: ${riskColor(report.overallRisk.toUpperCase())}\n`);

  // Impact Analysis
  if (report.impactAnalysis.length > 0) {
    console.log(chalk.bold('📊 Impact Analysis:'));
    
    const impactData = [
      ['Type', 'Impact Level', 'Affected Functions', 'Risk Factors']
    ];

    for (const impact of report.impactAnalysis) {
      impactData.push([
        impact.typeName,
        getRiskColor(impact.impactLevel)(impact.impactLevel),
        impact.affectedFunctions.length.toString(),
        impact.riskFactors.slice(0, 2).join('; ')
      ]);
    }

    console.log(table(impactData, {
      columns: [
        { alignment: 'left' },
        { alignment: 'center' },
        { alignment: 'right' },
        { alignment: 'left', width: 40 }
      ]
    }));
  }

  // Checklist
  if (report.checklist.length > 0) {
    console.log(chalk.bold('✅ Safety Checklist:'));
    
    const checklistData = [
      ['Priority', 'Category', 'Check Item', 'Automation']
    ];

    for (const item of report.checklist.slice(0, 10)) { // Show top 10
      checklistData.push([
        getPriorityColor(item.priority)(item.priority),
        item.category,
        item.description.length > 50 
          ? item.description.substring(0, 47) + '...'
          : item.description,
        item.automationPossible ? '✅' : '❌'
      ]);
    }

    console.log(table(checklistData, {
      columns: [
        { alignment: 'center' },
        { alignment: 'left' },
        { alignment: 'left', width: 45 },
        { alignment: 'center' }
      ]
    }));
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.bold('💡 Recommendations:'));
    report.recommendations.forEach((rec: string, i: number) => {
      console.log(`  ${i + 1}. ${rec}`);
    });
    console.log('');
  }

  // Warnings
  if (report.warnings.length > 0) {
    console.log(chalk.bold.yellow('⚠️  Warnings:'));
    report.warnings.forEach((warning: string) => {
      console.log(`  • ${chalk.yellow(warning)}`);
    });
    console.log('');
  }

  // Blocking Issues
  if (report.blockingIssues.length > 0) {
    console.log(chalk.bold.red('🚫 Blocking Issues:'));
    report.blockingIssues.forEach((issue: string) => {
      console.log(`  • ${chalk.red(issue)}`);
    });
    console.log('');
  }

  // Test Templates Info
  if (report.testTemplates.length > 0) {
    console.log(chalk.bold('🧪 Test Templates Generated:'));
    report.testTemplates.forEach((template) => {
      console.log(`  • ${template.testType}: ${template.description}`);
    });
    console.log('');
  }

  // PR Summary
  if (report.prSummary) {
    console.log(chalk.bold('📝 PR Template:'));
    console.log(chalk.gray('Use --format markdown to see full PR template'));
    console.log('');
  }
}

/**
 * Output results in JSON format
 */
async function outputJSON(report: RefactoringGuardRailReport, outputPath?: string): Promise<void> {
  const json = JSON.stringify(report, null, 2);
  
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
async function outputMarkdown(report: RefactoringGuardRailReport, outputPath?: string): Promise<void> {
  let markdown = `# Refactoring Safety Analysis: ${report.targetType}

## Overview
- **Type:** \`${report.targetType}\`
- **Operation:** ${report.operationType}
- **Risk Level:** ${report.overallRisk}

`;

  // Impact Analysis
  if (report.impactAnalysis.length > 0) {
    markdown += `## Impact Analysis

| Type | Impact Level | Affected Functions | Co-change Partners |
|------|-------------|-------------------|------------------|
`;
    
    for (const impact of report.impactAnalysis) {
      markdown += `| ${impact.typeName} | ${impact.impactLevel} | ${impact.affectedFunctions.length} | ${impact.cochangePartners.join(', ')} |
`;
    }
    markdown += '\n';
  }

  // Checklist
  if (report.checklist.length > 0) {
    markdown += `## Safety Checklist

`;
    report.checklist.forEach((item, i: number) => {
      markdown += `### ${i + 1}. ${item.description}\n- **Category:** ${item.category}\n- **Priority:** ${item.priority}\n- **Check Method:** ${item.checkMethod}\n- **Automation Possible:** ${item.automationPossible ? 'Yes' : 'No'}\n\n`;
    });
  }

  // Test Templates
  if (report.testTemplates.length > 0) {
    markdown += `## Test Templates

`;
    report.testTemplates.forEach((template) => {
      markdown += `### ${template.testType} Test: ${template.description}\n\n\`\`\`typescript\n${template.template}\n\`\`\`\n\n**Required Inputs:** ${template.requiredInputs.join(', ')}\n**Expected Outputs:** ${template.expectedOutputs.join(', ')}\n\n`;
    });
  }

  // PR Summary
  if (report.prSummary) {
    markdown += `## PR Template

${report.prSummary}
`;
  }

  if (outputPath) {
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, markdown);
    console.log(chalk.green(`Markdown report saved to: ${outputPath}`));
  } else {
    console.log(markdown);
  }
}

/**
 * Get color function for risk level
 */
function getRiskColor(risk: string): (text: string) => string {
  switch (risk) {
    case 'critical': return chalk.red.bold;
    case 'high': return chalk.red;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.green;
    default: return chalk.gray;
  }
}

/**
 * Get color function for priority level
 */
function getPriorityColor(priority: string): (text: string) => string {
  switch (priority) {
    case 'critical': return chalk.red.bold;
    case 'high': return chalk.red;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.blue;
    default: return chalk.gray;
  }
}