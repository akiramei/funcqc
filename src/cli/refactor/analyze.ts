import chalk from 'chalk';
import { ConfigManager } from '../../core/config.js';
import { PGLiteStorageAdapter } from '../../storage/pglite-adapter.js';
import { Logger } from '../../utils/cli-utils.js';
import { RefactorAnalyzeOptions, RefactoringReport, RefactoringPattern, RefactoringOpportunity, QualityHotSpot, RefactoringRecommendation, ProjectRefactoringSummary } from '../../types/index.js';
import { RefactoringAnalyzer } from '../../refactoring/refactoring-analyzer.js';
import * as fs from 'fs';
import * as path from 'path';

// Constants for refactoring effort estimation
const REFACTORING_EFFORT_MAP = {
  [RefactoringPattern.ExtractMethod]: 2,
  [RefactoringPattern.SplitFunction]: 4,
  [RefactoringPattern.ReduceParameters]: 3,
  [RefactoringPattern.ExtractClass]: 8,
  [RefactoringPattern.InlineFunction]: 1,
  [RefactoringPattern.RenameFunction]: 1
} as const;

// Use existing RefactoringOpportunity type from the types module
type OpportunityInfo = RefactoringOpportunity[];

/**
 * Phase 3: funcqc refactor analyze - Comprehensive project analysis for refactoring opportunities
 */
export async function refactorAnalyzeCommand(options: RefactorAnalyzeOptions): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  logger.info('Starting refactoring analysis...');
  
  try {
    logger.info('🔍 Analyzing project for refactoring opportunities...');
    
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    if (!config.storage.path) {
        throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
    }
    
    const storage = new PGLiteStorageAdapter(config.storage.path);
    await storage.init();

    const analyzer = new RefactoringAnalyzer(storage);
    
    // Prepare analysis options
    const analysisOptions: {
      complexityThreshold?: number;
      sizeThreshold?: number;
      since?: string;
      patterns?: RefactoringPattern[];
    } = {};
    
    if (options.complexityThreshold !== undefined) {
      analysisOptions.complexityThreshold = options.complexityThreshold;
    }
    if (options.sizeThreshold !== undefined) {
      analysisOptions.sizeThreshold = options.sizeThreshold;
    }
    if (options.since !== undefined) {
      analysisOptions.since = options.since;
    }
    const patterns = parsePatterns(options.patterns);
    if (patterns !== undefined) {
      analysisOptions.patterns = patterns;
    }

    // Perform comprehensive analysis
    const report = await analyzer.analyzeProject(analysisOptions);
    
    // Update project summary with actual opportunity count
    report.projectSummary.opportunitiesFound = report.opportunities.length;
    report.projectSummary.estimatedEffort = calculateTotalEffort(report.opportunities);

    // Output results
    if (options.output) {
      await saveReportToFile(report, options.output, options.format || 'detailed');
      logger.success(`📄 Report saved to: ${options.output}`);
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      displayAnalysisReport(report, options.format || 'summary', options.output);
    }

    await storage.close();
  } catch (error) {
    logger.error('Failed to analyze project for refactoring', error);
    process.exit(1);
  }
}

function parsePatterns(patternsString?: string): RefactoringPattern[] | undefined {
  if (!patternsString) return undefined;
  
  const patternMap: Record<string, RefactoringPattern> = {
    'extract-method': RefactoringPattern.ExtractMethod,
    'split-function': RefactoringPattern.SplitFunction,
    'reduce-parameters': RefactoringPattern.ReduceParameters,
    'extract-class': RefactoringPattern.ExtractClass,
    'inline-function': RefactoringPattern.InlineFunction,
    'rename-function': RefactoringPattern.RenameFunction
  };
  
  return patternsString
    .split(',')
    .map(p => p.trim())
    .map(p => patternMap[p])
    .filter(Boolean);
}

function calculateTotalEffort(opportunities: OpportunityInfo): number {
  return opportunities.reduce((total, opp) => total + (REFACTORING_EFFORT_MAP[opp.pattern] || 2), 0);
}

async function saveReportToFile(
  report: RefactoringReport, 
  outputPath: string, 
  format: string
): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.promises.mkdir(dir, { recursive: true });
  
  let content: string;
  
  if (format === 'json') {
    content = JSON.stringify(report, null, 2);
  } else {
    content = generateMarkdownReport(report, format);
  }
  
  await fs.promises.writeFile(outputPath, content, 'utf8');
}

function generateMarkdownReport(report: RefactoringReport, format: string): string {
  const lines: string[] = [];
  
  generateReportHeader(lines);
  generateProjectSummarySection(lines, report.projectSummary);
  generateOpportunitiesSection(lines, report.opportunities, format);
  generateHotSpotsSection(lines, report.hotSpots, format);
  generateRecommendationsSection(lines, report.recommendations);
  
  return lines.join('\n');
}

function generateReportHeader(lines: string[]): void {
  lines.push('# Refactoring Analysis Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
}

function generateProjectSummarySection(lines: string[], summary: ProjectRefactoringSummary): void {
  lines.push('## 📊 Project Summary');
  lines.push('');
  lines.push(`- **Total Functions**: ${summary.totalFunctions}`);
  lines.push(`- **Analyzed Functions**: ${summary.analyzedFunctions}`);
  lines.push(`- **Opportunities Found**: ${summary.opportunitiesFound}`);
  lines.push(`- **Estimated Effort**: ${summary.estimatedEffort} hours`);
  lines.push(`- **Risk Level**: ${summary.riskLevel}`);
  lines.push('');
  
  if (summary.priorityAreas.length > 0) {
    lines.push('**Priority Areas**:');
    summary.priorityAreas.forEach(area => lines.push(`- ${area}`));
    lines.push('');
  }
}

function generateOpportunitiesSection(lines: string[], opportunities: RefactoringOpportunity[], format: string): void {
  if (opportunities.length === 0) return;
  
  lines.push('## 🎯 Refactoring Opportunities');
  lines.push('');
  
  const opportunitiesByPattern = groupOpportunitiesByPattern(opportunities);
  
  for (const [pattern, patternOpportunities] of Object.entries(opportunitiesByPattern)) {
    lines.push(`### ${formatPatternName(pattern)}`);
    lines.push('');
    
    patternOpportunities.forEach(opp => {
      lines.push(`- **${getSeverityIcon(opp.severity)} [${opp.severity.toUpperCase()}]** (Score: ${opp.impactScore})`);
      lines.push(`  - Function: \`${opp.functionId}\``);
      if (format === 'detailed' && opp.metadata) {
        Object.entries(opp.metadata).forEach(([key, value]) => {
          lines.push(`  - ${key}: ${value}`);
        });
      }
      lines.push('');
    });
  }
}

function generateHotSpotsSection(lines: string[], hotSpots: QualityHotSpot[], format: string): void {
  if (hotSpots.length === 0) return;
  
  lines.push('## 🔥 Quality Hot Spots');
  lines.push('');
  
  hotSpots.slice(0, 10).forEach((hotSpot, index) => {
    lines.push(`### ${index + 1}. ${hotSpot.functionName}`);
    lines.push('');
    lines.push(`- **File**: ${hotSpot.filePath}`);
    lines.push(`- **Complexity**: ${hotSpot.complexity}`);
    lines.push(`- **Risk Score**: ${hotSpot.riskScore}`);
    lines.push('');
    
    if (hotSpot.issues.length > 0) {
      lines.push('**Issues**:');
      hotSpot.issues.forEach(issue => {
        lines.push(`- ${getSeverityIcon(issue.severity)} ${issue.description}`);
        if (format === 'detailed') {
          issue.suggestedActions.forEach(action => {
            lines.push(`  - 💡 ${action}`);
          });
        }
      });
      lines.push('');
    }
  });
}

function generateRecommendationsSection(lines: string[], recommendations: RefactoringRecommendation[]): void {
  if (recommendations.length === 0) return;
  
  lines.push('## 💡 Recommendations');
  lines.push('');
  
  recommendations.forEach((rec, index) => {
    lines.push(`### ${index + 1}. ${formatPatternName(rec.pattern)} (${rec.priority.toUpperCase()} Priority)`);
    lines.push('');
    lines.push(`**Reasoning**: ${rec.reasoning}`);
    lines.push(`**Estimated Effort**: ${rec.estimatedEffort} hours`);
    lines.push(`**Expected Benefit**: ${rec.expectedBenefit}`);
    lines.push('');
  });
}

function displayAnalysisReport(
  report: RefactoringReport, 
  format: string, 
  outputPath?: string
): void {
  displayReportHeader();
  displayProjectSummary(report.projectSummary);
  displayTopOpportunities(report.opportunities, format);
  displayQualityHotSpots(report.hotSpots, format);
  displayRecommendations(report.recommendations);
  displayNextSteps(report.projectSummary, outputPath);
  console.log(); // Extra line for spacing
}

function displayReportHeader(): void {
  console.log(chalk.cyan.bold('\n🔍 Refactoring Analysis Report\n'));
}

function displayProjectSummary(summary: ProjectRefactoringSummary): void {
  console.log(chalk.blue.bold('📊 Project Summary'));
  console.log(`   Total Functions: ${chalk.yellow(summary.totalFunctions)}`);
  console.log(`   Analyzed: ${chalk.yellow(summary.analyzedFunctions)}`);
  console.log(`   Opportunities: ${chalk.yellow(summary.opportunitiesFound)}`);
  console.log(`   Estimated Effort: ${chalk.yellow(summary.estimatedEffort)} hours`);
  console.log(`   Risk Level: ${getRiskLevelDisplay(summary.riskLevel)}`);
  
  if (summary.priorityAreas.length > 0) {
    console.log(`\n${chalk.blue.bold('🎯 Priority Areas:')}`);
    summary.priorityAreas.slice(0, 3).forEach(area => {
      console.log(`   • ${chalk.gray(area)}`);
    });
  }
}

function displayTopOpportunities(opportunities: RefactoringOpportunity[], format: string): void {
  if (opportunities.length === 0) return;
  
  console.log(`\n${chalk.blue.bold('🚨 Top Opportunities:')}`);
  
  const topOpportunities = opportunities
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, format === 'summary' ? 5 : 10);
  
  topOpportunities.forEach((opp, index) => {
    const severityDisplay = getSeverityDisplay(opp.severity);
    const patternDisplay = formatPatternName(opp.pattern);
    console.log(`   ${index + 1}. ${severityDisplay} ${patternDisplay} (Score: ${chalk.yellow(opp.impactScore)})`);
    
    if (format !== 'summary') {
      console.log(`      Function: ${chalk.gray(opp.functionId)}`);
      if (opp.metadata && Object.keys(opp.metadata).length > 0) {
        const firstKey = Object.keys(opp.metadata)[0];
        console.log(`      ${firstKey}: ${chalk.gray(String(opp.metadata[firstKey]))}`);
      }
    }
  });
}

function displayQualityHotSpots(hotSpots: QualityHotSpot[], format: string): void {
  if (hotSpots.length === 0) return;
  
  console.log(`\n${chalk.blue.bold('🔥 Quality Hot Spots:')}`);
  
  const topHotSpots = hotSpots.slice(0, format === 'summary' ? 3 : 5);
  topHotSpots.forEach((hotSpot, index) => {
    console.log(`   ${index + 1}. ${chalk.yellow(hotSpot.functionName)} (Risk: ${chalk.red(hotSpot.riskScore)})`);
    console.log(`      ${chalk.gray(hotSpot.filePath)}`);
    console.log(`      Complexity: ${chalk.yellow(hotSpot.complexity)}, Issues: ${chalk.red(hotSpot.issues.length)}`);
  });
}

function displayRecommendations(recommendations: RefactoringRecommendation[]): void {
  if (recommendations.length === 0) return;
  
  console.log(`\n${chalk.blue.bold('💡 Top Recommendations:')}`);
  
  const topRecommendations = recommendations.slice(0, 3);
  topRecommendations.forEach((rec, index) => {
    const priorityDisplay = getPriorityDisplay(rec.priority);
    console.log(`   ${index + 1}. ${priorityDisplay} ${formatPatternName(rec.pattern)}`);
    console.log(`      ${chalk.gray(rec.reasoning)}`);
    console.log(`      Effort: ${chalk.yellow(rec.estimatedEffort)}h, Benefit: ${chalk.green(rec.expectedBenefit)}`);
  });
}

function displayNextSteps(summary: ProjectRefactoringSummary, outputPath?: string): void {
  if (summary.opportunitiesFound === 0) {
    console.log(`\n${chalk.green('✅ No major refactoring opportunities found. Code quality looks good!')}`);
  } else {
    console.log(`\n${chalk.blue('💡 Next Steps:')}`);
    console.log(`   • Review high-priority opportunities above`);
    console.log(`   • Run ${chalk.cyan('funcqc refactor detect')} for specific patterns`);
    console.log(`   • Use ${chalk.cyan('funcqc refactor interactive')} for guided refactoring`);
    
    if (outputPath) {
      console.log(`   • Full report saved to: ${chalk.yellow(outputPath)}`);
    }
  }
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function groupOpportunitiesByPattern(opportunities: OpportunityInfo): Record<string, OpportunityInfo> {
  const groups: Record<string, OpportunityInfo> = {};
  
  for (const opp of opportunities) {
    const pattern = opp.pattern;
    if (!groups[pattern]) {
      groups[pattern] = [];
    }
    groups[pattern].push(opp);
  }
  
  return groups;
}

function formatPatternName(pattern: string): string {
  const nameMap: Record<string, string> = {
    [RefactoringPattern.ExtractMethod]: 'Extract Method',
    [RefactoringPattern.SplitFunction]: 'Split Function',
    [RefactoringPattern.ReduceParameters]: 'Reduce Parameters',
    [RefactoringPattern.ExtractClass]: 'Extract Class',
    [RefactoringPattern.InlineFunction]: 'Inline Function',
    [RefactoringPattern.RenameFunction]: 'Rename Function'
  };
  
  return nameMap[pattern] || pattern;
}

function getSeverityIcon(severity: string): string {
  const iconMap: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢'
  };
  
  return iconMap[severity] || '⚪';
}

function getSeverityDisplay(severity: string): string {
  const colorMap: Record<string, (text: string) => string> = {
    critical: chalk.red.bold,
    high: chalk.red,
    medium: chalk.yellow,
    low: chalk.green
  };
  
  const colorFn = colorMap[severity] || chalk.gray;
  return colorFn(severity.toUpperCase());
}

function getRiskLevelDisplay(riskLevel: string): string {
  const colorMap: Record<string, (text: string) => string> = {
    high: chalk.red.bold,
    medium: chalk.yellow,
    low: chalk.green
  };
  
  const colorFn = colorMap[riskLevel] || chalk.gray;
  return colorFn(riskLevel.toUpperCase());
}

function getPriorityDisplay(priority: string): string {
  const iconMap: Record<string, string> = {
    high: '🔥',
    medium: '⚠️',
    low: '💡'
  };
  
  return iconMap[priority] || '📌';
}