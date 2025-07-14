import chalk from 'chalk';
import ora from 'ora';
import * as prompts from '@inquirer/prompts';
import * as fs from 'fs';
import * as path from 'path';
import { 
  RefactorAnalyzeOptions, 
  RefactorDetectOptions,
  RefactorInteractiveOptions,
  RefactorPlanOptions,
  RefactorStatusOptions,
  RefactoringReport, 
  RefactoringPattern, 
  RefactoringOpportunity, 
  QualityHotSpot, 
  RefactoringRecommendation, 
  ProjectRefactoringSummary,
  RefactoringSession,
  SessionFunction,
  CommandOptions
} from '../../types/index.js';
import { RefactoringAnalyzer } from '../../refactoring/refactoring-analyzer.js';
import { SessionManager, SessionSummary } from '../../refactoring/session-manager-simple.js';
import { 
  getSeverityDisplaySimple, 
  getRiskLevelDisplay, 
  getPriorityDisplay, 
  getSeverityIcon, 
  formatPatternName,
  parsePattern,
  getSeverityDisplay,
  groupOpportunitiesByPattern
} from '../../utils/refactoring-utils.js';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler.js';
import { VoidCommand } from '../../types/command.js';
import { CommandEnvironment } from '../../types/environment.js';
import { DatabaseError } from '../../storage/pglite-adapter.js';

// ========================================
// COMMAND OPTIONS TYPES
// ========================================

interface RefactorTrackOptions extends CommandOptions {
  all?: boolean;
  name?: string;
  description?: string;
  branch?: string;
  status?: string;
  notes?: string;
  interactive?: boolean;
  summary?: string;
  reason?: string;
  json?: boolean;
  session?: string; // For specifying session ID in lineage operations
}

// ========================================
// MAIN COMMAND ROUTER
// ========================================

/**
 * Main refactor command router that handles all subcommands
 */
export const refactorCommand = (subcommand: string, args: string[] = []): VoidCommand<any> =>
  (options: any) =>
    async (env: CommandEnvironment): Promise<void> => {
      const errorHandler = createErrorHandler(env.commandLogger);

      try {
        switch (subcommand) {
          case 'analyze':
            await refactorAnalyzeCommandImpl(options as RefactorAnalyzeOptions, env);
            break;
          case 'detect':
            await refactorDetectCommandImpl(options as RefactorDetectOptions, env);
            break;
          case 'interactive':
            await refactorInteractiveCommandImpl(options as RefactorInteractiveOptions, env);
            break;
          case 'plan':
            await refactorPlanCommandImpl(options as RefactorPlanOptions, env);
            break;
          case 'status':
            await refactorStatusCommandImpl(options as RefactorStatusOptions, env);
            break;
          case 'track':
            await refactorTrackCommandImpl(args[0] || '', args.slice(1), options as RefactorTrackOptions, env);
            break;
          case 'assess':
            await refactorAssessCommandImpl(args[0] || '', options as RefactorTrackOptions, env);
            break;
          default:
            throw new Error(`Unknown refactor subcommand: ${subcommand}`);
        }
      } catch (error) {
        if (error instanceof DatabaseError) {
          const funcqcError = errorHandler.createError(
            error.code,
            error.message,
            {},
            error.originalError
          );
          errorHandler.handleError(funcqcError);
        } else {
          const funcqcError = errorHandler.createError(
            ErrorCode.UNKNOWN_ERROR,
            `Refactor ${subcommand} command failed: ${error instanceof Error ? error.message : String(error)}`,
            { subcommand, args },
            error instanceof Error ? error : undefined
          );
          errorHandler.handleError(funcqcError);
        }
      }
    };

// ========================================
// ANALYZE COMMAND IMPLEMENTATION
// ========================================

// Constants for refactoring effort estimation
const REFACTORING_EFFORT_MAP = {
  [RefactoringPattern.ExtractMethod]: 2,
  [RefactoringPattern.SplitFunction]: 4,
  [RefactoringPattern.ReduceParameters]: 3,
  [RefactoringPattern.ExtractClass]: 8,
  [RefactoringPattern.InlineFunction]: 1,
  [RefactoringPattern.RenameFunction]: 1
} as const;

type OpportunityInfo = RefactoringOpportunity[];

async function refactorAnalyzeCommandImpl(
  options: RefactorAnalyzeOptions,
  env: CommandEnvironment
): Promise<void> {
  env.commandLogger.info('Starting refactoring analysis...');
  
  try {
    env.commandLogger.info('🔍 Analyzing project for refactoring opportunities...');
    
    const analyzer = new RefactoringAnalyzer(env.storage);
    
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
      env.commandLogger.success(`📄 Report saved to: ${options.output}`);
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      displayAnalysisReport(report, options.format || 'summary', options.output);
    }

  } catch (error) {
    env.commandLogger.error('Failed to analyze project for refactoring', error);
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
      lines.push(`- **${getSeverityIcon(opp.severity)} [${opp.severity.toUpperCase()}]** (Score: ${opp.impact_score})`);
      lines.push(`  - Function: \`${opp.function_id}\``);
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
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, format === 'summary' ? 5 : 10);
  
  topOpportunities.forEach((opp, index) => {
    const severityDisplay = getSeverityDisplaySimple(opp.severity);
    const patternDisplay = formatPatternName(opp.pattern);
    console.log(`   ${index + 1}. ${severityDisplay} ${patternDisplay} (Score: ${chalk.yellow(opp.impact_score)})`);
    
    if (format !== 'summary') {
      console.log(`      Function: ${chalk.gray(opp.function_id)}`);
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
// DETECT COMMAND IMPLEMENTATION
// ========================================

interface ParsedAnalysisOptions {
  analysisOptions: {
    patterns?: RefactoringPattern[];
    complexityThreshold?: number;
    sizeThreshold?: number;
    includePatterns?: string[];
  };
  selectedPattern: RefactoringPattern | undefined;
}

function parseDetectionOptions(options: RefactorDetectOptions, spinner: any): ParsedAnalysisOptions {
  const analysisOptions: {
    patterns?: RefactoringPattern[];
    complexityThreshold?: number;
    sizeThreshold?: number;
    includePatterns?: string[];
  } = {};
  
  let selectedPattern: RefactoringPattern | undefined;
  if (options.pattern) {
    selectedPattern = parsePattern(options.pattern);
    if (!selectedPattern) {
      spinner.fail();
      console.error(chalk.red(`Invalid pattern: ${options.pattern}`));
      console.log(chalk.yellow('Valid patterns: extract-method, split-function, reduce-parameters, extract-class, inline-function, rename-function'));
      process.exit(1);
    }
    analysisOptions.patterns = [selectedPattern];
  }
  
  analysisOptions.complexityThreshold = parseInt(options.complexityThreshold);
  analysisOptions.sizeThreshold = parseInt(options.sizeThreshold);
  
  if (options.file) {
    analysisOptions.includePatterns = [options.file];
  }
  
  return { analysisOptions, selectedPattern };
}

function filterOpportunities(
  opportunities: RefactoringOpportunity[],
  selectedPattern: RefactoringPattern | undefined,
  limit: string
): RefactoringOpportunity[] {
  let filtered = opportunities;
  
  if (selectedPattern) {
    filtered = filtered.filter(opp => opp.pattern === selectedPattern);
  }
  
  const limitNum = parseInt(limit);
  if (filtered.length > limitNum) {
    filtered = filtered.slice(0, limitNum);
  }
  
  return filtered;
}

async function handleSessionCreation(
  options: RefactorDetectOptions,
  opportunities: RefactoringOpportunity[],
  sessionManager: SessionManager,
  selectedPattern: RefactoringPattern | undefined,
  spinner: any
): Promise<string | undefined> {
  if (!options.createSession || opportunities.length === 0) {
    return options.session;
  }
  
  spinner.start('Creating refactoring session...');
  
  const sessionName = await prompts.input({
    message: 'Session name:',
    default: `Refactor ${selectedPattern || 'multiple patterns'} - ${new Date().toLocaleDateString()}`
  });
  
  const sessionDescription = await prompts.input({
    message: 'Session description:',
    default: `Detected ${opportunities.length} refactoring opportunities`
  });
  
  const session = await sessionManager.createSession(sessionName, sessionDescription);
  
  const opportunityIds = opportunities.map(opp => opp.id);
  await sessionManager.linkOpportunitiesToSession(session.id, opportunityIds);
  
  const functionIds = [...new Set(opportunities.map(opp => opp.function_id))];
  await sessionManager.addFunctionsToSession(session.id, functionIds);
  
  spinner.succeed(`Created session: ${session.name} (${session.id})`);
  return session.id;
}

function displayResults(
  opportunities: RefactoringOpportunity[],
  selectedPattern: RefactoringPattern | undefined,
  sessionId: string | undefined,
  options: RefactorDetectOptions
): void {
  if (options.json) {
    console.log(JSON.stringify({
      pattern: selectedPattern,
      opportunitiesFound: opportunities.length,
      sessionId,
      opportunities: opportunities.map(opp => ({
        id: opp.id,
        pattern: opp.pattern,
        severity: opp.severity,
        impact_score: opp.impact_score,
        function_id: opp.function_id,
        description: opp.description,
        metadata: opp.metadata
      }))
    }, null, 2));
  } else {
    displayDetectionResults(opportunities, selectedPattern, sessionId);
  }
}

async function refactorDetectCommandImpl(
  options: RefactorDetectOptions,
  env: CommandEnvironment
): Promise<void> {
  const spinner = ora({ color: 'cyan', text: 'Initializing detection...' });
  
  try {
    spinner.start();
    
    const analyzer = new RefactoringAnalyzer(env.storage);
    const sessionManager = new SessionManager(env.storage);
    
    spinner.text = 'Detecting refactoring opportunities...';
    
    const { analysisOptions, selectedPattern } = parseDetectionOptions(options, spinner);
    const report = await analyzer.analyzeProject(analysisOptions);
    
    spinner.succeed('Detection complete');
    
    const opportunities = filterOpportunities(report.opportunities, selectedPattern, options.limit);
    const sessionId = await handleSessionCreation(options, opportunities, sessionManager, selectedPattern, spinner);
    
    if (options.interactive && opportunities.length > 0) {
      await runInteractiveDetection(opportunities, sessionManager, sessionId);
    } else {
      displayResults(opportunities, selectedPattern, sessionId, options);
    }
    
  } catch (error) {
    spinner.fail();
    env.commandLogger.error('Detection failed', error);
    process.exit(1);
  }
}

/**
 * Displays opportunity details to the user
 */
function displayOpportunityDetails(opp: RefactoringOpportunity, index: number, total: number): void {
  console.log(chalk.blue.bold(`\n[${index + 1}/${total}] ${formatPatternName(opp.pattern)}`));
  console.log(chalk.yellow(`Function: ${opp.function_id}`));
  console.log(`Severity: ${getSeverityDisplay(opp.severity)}`);
  console.log(`Impact Score: ${chalk.yellow(opp.impact_score)}`);
  console.log(`Description: ${chalk.gray(opp.description)}`);
  
  if (opp.metadata) {
    console.log('\nDetails:');
    Object.entries(opp.metadata).forEach(([key, value]) => {
      console.log(`  ${key}: ${chalk.gray(String(value))}`);
    });
  }
}

/**
 * Prompts user for action on an opportunity
 */
async function promptUserAction(): Promise<string> {
  return await prompts.select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Select for refactoring', value: 'select' },
      { name: 'Skip this opportunity', value: 'skip' },
      { name: 'View code context', value: 'view' },
      { name: 'Stop reviewing', value: 'stop' }
    ]
  });
}

/**
 * Handles user action for an opportunity
 */
function handleUserAction(
  action: string,
  opp: RefactoringOpportunity,
  selectedOpportunities: RefactoringOpportunity[],
  opportunities: RefactoringOpportunity[],
  index: number
): boolean {
  if (action === 'select') {
    selectedOpportunities.push(opp);
    console.log(chalk.green('✓ Selected for refactoring'));
    return false;
  } else if (action === 'skip') {
    console.log(chalk.gray('→ Skipped'));
    return false;
  } else if (action === 'view') {
    console.log(chalk.yellow('Code viewing not yet implemented'));
    opportunities.splice(index + 1, 0, opp);
    return false;
  } else if (action === 'stop') {
    return true;
  }
  return false;
}

/**
 * Creates a refactoring session if requested
 */
async function createRefactoringSession(
  selectedOpportunities: RefactoringOpportunity[],
  sessionManager: SessionManager,
  sessionId?: string
): Promise<void> {
  if (selectedOpportunities.length === 0 || sessionId) return;
  
  const createSession = await prompts.confirm({
    message: 'Create a refactoring session for selected opportunities?',
    default: true
  });
  
  if (!createSession) return;
  
  const sessionName = await prompts.input({
    message: 'Session name:',
    default: `Interactive Refactoring - ${new Date().toLocaleDateString()}`
  });
  
  const session = await sessionManager.createSession(
    sessionName,
    `Selected ${selectedOpportunities.length} opportunities through interactive detection`
  );
  
  const opportunityIds = selectedOpportunities.map(opp => opp.id);
  await sessionManager.linkOpportunitiesToSession(session.id, opportunityIds);
  
  const functionIds = [...new Set(selectedOpportunities.map(opp => opp.function_id))];
  await sessionManager.addFunctionsToSession(session.id, functionIds);
  
  console.log(chalk.green(`\n✅ Created session: ${session.name} (${session.id})`));
}

/**
 * Displays selection summary
 */
function displaySelectionSummary(selectedOpportunities: RefactoringOpportunity[], totalOpportunities: number): void {
  console.log(chalk.cyan.bold('\n📊 Selection Summary\n'));
  console.log(`Selected: ${chalk.green(selectedOpportunities.length)} opportunities`);
  console.log(`Skipped: ${chalk.gray(totalOpportunities - selectedOpportunities.length)} opportunities`);
}

async function runInteractiveDetection(
  opportunities: RefactoringOpportunity[],
  sessionManager: SessionManager,
  sessionId?: string
): Promise<void> {
  console.log(chalk.cyan.bold('\n🔍 Interactive Refactoring Detection\n'));
  console.log(chalk.gray(`Found ${opportunities.length} opportunities to review\n`));
  
  const selectedOpportunities: RefactoringOpportunity[] = [];
  
  for (const [index, opp] of opportunities.entries()) {
    displayOpportunityDetails(opp, index, opportunities.length);
    
    const action = await promptUserAction();
    const shouldStop = handleUserAction(action, opp, selectedOpportunities, opportunities, index);
    
    if (shouldStop) break;
  }
  
  displaySelectionSummary(selectedOpportunities, opportunities.length);
  await createRefactoringSession(selectedOpportunities, sessionManager, sessionId);
}

function displayDetectionResults(
  opportunities: RefactoringOpportunity[],
  pattern?: RefactoringPattern,
  sessionId?: string
): void {
  console.log(chalk.cyan.bold('\n🔍 Refactoring Detection Results\n'));
  
  if (pattern) {
    console.log(chalk.blue.bold(`Pattern: ${formatPatternName(pattern)}`));
  }
  
  console.log(`Opportunities Found: ${chalk.yellow(opportunities.length)}`);
  
  if (sessionId) {
    console.log(`Session ID: ${chalk.green(sessionId)}`);
  }
  
  if (opportunities.length === 0) {
    console.log(chalk.gray('\nNo refactoring opportunities found matching the criteria.'));
    return;
  }
  
  // Group by pattern if not filtering by specific pattern
  if (!pattern) {
    const byPattern = groupOpportunitiesByPattern(opportunities);
    console.log('\nBy Pattern:');
    Object.entries(byPattern).forEach(([p, opps]) => {
      console.log(`  ${formatPatternName(p)}: ${chalk.yellow(opps.length)}`);
    });
  }
  
  // Top opportunities
  console.log(chalk.blue.bold('\n🎯 Top Opportunities:'));
  
  opportunities.slice(0, 10).forEach((opp, index) => {
    const severityDisplay = getSeverityDisplay(opp.severity);
    const patternDisplay = pattern ? '' : `[${formatPatternName(opp.pattern)}] `;
    
    console.log(`\n${index + 1}. ${severityDisplay} ${patternDisplay}(Score: ${chalk.yellow(opp.impact_score)})`);
    console.log(`   Function: ${chalk.gray(opp.function_id)}`);
    console.log(`   ${chalk.gray(opp.description)}`);
    
    if (opp.metadata && Object.keys(opp.metadata).length > 0) {
      const firstKey = Object.keys(opp.metadata)[0];
      console.log(`   ${firstKey}: ${chalk.gray(String(opp.metadata[firstKey]))}`);
    }
  });
  
  if (opportunities.length > 10) {
    console.log(chalk.gray(`\n... and ${opportunities.length - 10} more opportunities`));
  }
  
  // Next steps
  console.log(chalk.blue.bold('\n💡 Next Steps:'));
  console.log('  • Use --interactive flag to review opportunities one by one');
  console.log('  • Use --create-session to track refactoring progress');
  if (!sessionId) {
    console.log('  • Run ' + chalk.cyan('funcqc refactor track create') + ' to start a refactoring session');
  } else {
    console.log('  • Run ' + chalk.cyan(`funcqc refactor track show ${sessionId}`) + ' to view session details');
  }
}

// ========================================
// INTERACTIVE COMMAND IMPLEMENTATION
// ========================================

async function refactorInteractiveCommandImpl(
  options: RefactorInteractiveOptions,
  env: CommandEnvironment
): Promise<void> {
  const spinner = ora({ color: 'cyan', text: 'Starting interactive refactoring...' });
  
  try {
    spinner.start();
    
    const analyzer = new RefactoringAnalyzer(env.storage);
    const sessionManager = new SessionManager(env.storage);
    
    spinner.stop();
    
    // Interactive workflow
    await runInteractiveRefactoringWizard(analyzer, sessionManager, options);
    
  } catch (error) {
    spinner.fail();
    env.commandLogger.error('Interactive refactoring failed', error);
    process.exit(1);
  }
}

async function runInteractiveRefactoringWizard(
  analyzer: RefactoringAnalyzer,
  sessionManager: SessionManager,
  options: RefactorInteractiveOptions
): Promise<void> {
  console.log(chalk.cyan.bold('\n🪄 Interactive Refactoring Wizard\n'));
  
  // Step 1: Setup session and opportunities
  const { currentSession, opportunities } = await setupSessionAndOpportunities(
    sessionManager, 
    options
  );
  
  // Step 2: Analysis Configuration
  const analysisConfig = await configureAnalysis(options);
  
  // Step 3: Perform Analysis and link to session
  const finalOpportunities = await performAnalysisIfNeeded(
    analyzer, 
    sessionManager, 
    currentSession, 
    opportunities, 
    analysisConfig
  );
  
  if (finalOpportunities.length === 0) {
    console.log(chalk.green('✅ No refactoring opportunities found. Your code looks great!'));
    return;
  }
  
  // Step 4: Opportunity Review and Selection
  await reviewOpportunities(finalOpportunities, sessionManager, currentSession, analysisConfig);
}

async function setupSessionAndOpportunities(
  sessionManager: SessionManager,
  options: RefactorInteractiveOptions
): Promise<{
  currentSession: RefactoringSession | null;
  opportunities: RefactoringOpportunity[];
}> {
  if (options.session) {
    return await loadExistingSession(sessionManager, options.session);
  }
  
  return await handleInteractiveSessionSetup(sessionManager);
}

async function loadExistingSession(
  sessionManager: SessionManager,
  sessionId: string
): Promise<{
  currentSession: RefactoringSession | null;
  opportunities: RefactoringOpportunity[];
}> {
  try {
    const sessions = await sessionManager.listSessions();
    const currentSession = sessions.find((s: RefactoringSession) => s.id === sessionId) || null;
    
    if (!currentSession) {
      console.log(chalk.red(`Session ${sessionId} not found`));
      return { currentSession: null, opportunities: [] };
    }
    
    console.log(chalk.green(`📂 Continuing session: ${currentSession.name}`));
    const opportunities = await sessionManager.getSessionOpportunities(currentSession.id);
    
    return { currentSession, opportunities };
  } catch {
    console.log(chalk.red('Failed to load session'));
    return { currentSession: null, opportunities: [] };
  }
}

async function handleInteractiveSessionSetup(
  sessionManager: SessionManager
): Promise<{
  currentSession: RefactoringSession | null;
  opportunities: RefactoringOpportunity[];
}> {
  const action = await prompts.select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Start new refactoring session', value: 'new' },
      { name: 'Continue existing session', value: 'existing' },
      { name: 'Quick analysis (no session)', value: 'quick' }
    ]
  });
  
  if (action === 'existing') {
    const currentSession = await selectExistingSession(sessionManager);
    if (!currentSession) {
      return { currentSession: null, opportunities: [] };
    }
    const opportunities = await sessionManager.getSessionOpportunities(currentSession.id);
    return { currentSession, opportunities };
  }
  
  if (action === 'new') {
    const currentSession = await createNewSession(sessionManager);
    return { currentSession, opportunities: [] };
  }
  
  return { currentSession: null, opportunities: [] };
}

async function performAnalysisIfNeeded(
  analyzer: RefactoringAnalyzer,
  sessionManager: SessionManager,
  currentSession: RefactoringSession | null,
  existingOpportunities: RefactoringOpportunity[],
  analysisConfig: {
    patterns?: RefactoringPattern[];
    complexityThreshold?: number;
    sizeThreshold?: number;
  }
): Promise<RefactoringOpportunity[]> {
  if (existingOpportunities.length > 0) {
    return existingOpportunities;
  }
  
  console.log(chalk.yellow('\n🔍 Analyzing project for refactoring opportunities...\n'));
  const report = await analyzer.analyzeProject(analysisConfig);
  const opportunities = report.opportunities;
  
  // Link opportunities to session if we have one
  if (currentSession && opportunities.length > 0) {
    await linkOpportunitiesToSession(sessionManager, currentSession, opportunities);
  }
  
  return opportunities;
}

async function linkOpportunitiesToSession(
  sessionManager: SessionManager,
  currentSession: RefactoringSession,
  opportunities: RefactoringOpportunity[]
): Promise<void> {
  const opportunityIds = opportunities.map(opp => opp.id);
  await sessionManager.linkOpportunitiesToSession(currentSession.id, opportunityIds);
  
  const functionIds = [...new Set(opportunities.map(opp => opp.function_id))];
  await sessionManager.addFunctionsToSession(currentSession.id, functionIds);
}

async function selectExistingSession(sessionManager: SessionManager): Promise<RefactoringSession | null> {
  const sessions = await sessionManager.listSessions();
  
  if (sessions.length === 0) {
    console.log(chalk.yellow('No existing sessions found. Let\'s create a new one!'));
    return await createNewSession(sessionManager);
  }
  
  const sessionChoices = sessions.map((session: RefactoringSession) => ({
    name: `${session.name} (${session.status}) - ${new Date(session.created_at).toLocaleDateString()}`,
    value: session.id
  }));
  
  const selectedSessionId = await prompts.select({
    message: 'Select a session to continue:',
    choices: sessionChoices
  });
  
  return sessions.find((s: RefactoringSession) => s.id === selectedSessionId) || null;
}

async function createNewSession(sessionManager: SessionManager): Promise<RefactoringSession | null> {
  const sessionName = await prompts.input({
    message: 'Session name:',
    default: `Interactive Refactoring - ${new Date().toLocaleDateString()}`
  });
  
  const sessionDescription = await prompts.input({
    message: 'Session description:',
    default: 'Interactive refactoring session'
  });
  
  try {
    const session = await sessionManager.createSession(sessionName, sessionDescription);
    console.log(chalk.green(`✅ Created session: ${session.name}`));
    return session;
  } catch {
    console.log(chalk.red('Failed to create session'));
    return null;
  }
}

async function configureAnalysis(options: RefactorInteractiveOptions): Promise<{
  patterns?: RefactoringPattern[];
  complexityThreshold?: number;
  sizeThreshold?: number;
}> {
  const config: {
    patterns?: RefactoringPattern[];
    complexityThreshold?: number;
    sizeThreshold?: number;
  } = {};
  
  // Configure patterns
  const patterns = await configurePatterns(options);
  if (patterns) {
    config.patterns = patterns;
  }
  
  // Configure thresholds
  const thresholds = await configureThresholds(options);
  config.complexityThreshold = thresholds.complexityThreshold;
  config.sizeThreshold = thresholds.sizeThreshold;
  
  return config;
}

async function configurePatterns(options: RefactorInteractiveOptions): Promise<RefactoringPattern[] | undefined> {
  if (options.pattern) {
    const pattern = parsePattern(options.pattern);
    return pattern ? [pattern] : undefined;
  }
  
  const focusOnPattern = await prompts.confirm({
    message: 'Focus on specific refactoring pattern?',
    default: false
  });
  
  if (!focusOnPattern) {
    return undefined;
  }
  
  const selectedPattern = await prompts.select({
    message: 'Select refactoring pattern:',
    choices: getPatternChoices()
  });
  
  return [selectedPattern];
}

function getPatternChoices() {
  return [
    { name: 'Extract Method - Break down large functions', value: RefactoringPattern.ExtractMethod },
    { name: 'Split Function - Separate concerns', value: RefactoringPattern.SplitFunction },
    { name: 'Reduce Parameters - Simplify function signatures', value: RefactoringPattern.ReduceParameters },
    { name: 'Extract Class - Organize related functionality', value: RefactoringPattern.ExtractClass },
    { name: 'Inline Function - Remove unnecessary abstraction', value: RefactoringPattern.InlineFunction },
    { name: 'Rename Function - Improve clarity', value: RefactoringPattern.RenameFunction }
  ];
}

async function configureThresholds(options: RefactorInteractiveOptions): Promise<{
  complexityThreshold: number;
  sizeThreshold: number;
}> {
  const customizeThresholds = await prompts.confirm({
    message: 'Customize detection thresholds?',
    default: false
  });
  
  if (customizeThresholds) {
    return await getCustomThresholds(options);
  }
  
  return getDefaultThresholds(options);
}

async function getCustomThresholds(options: RefactorInteractiveOptions): Promise<{
  complexityThreshold: number;
  sizeThreshold: number;
}> {
  // Parse default values with NaN protection
  const defaultComplexity = parseInt(options.complexityThreshold || '5');
  const safeDefaultComplexity = Number.isNaN(defaultComplexity) ? 5 : defaultComplexity;
  
  const defaultSize = parseInt(options.sizeThreshold || '20');
  const safeDefaultSize = Number.isNaN(defaultSize) ? 20 : defaultSize;
  
  const complexityInput = await prompts.number({
    message: 'Complexity threshold:',
    default: safeDefaultComplexity
  });
  
  const sizeInput = await prompts.number({
    message: 'Size threshold (lines):',
    default: safeDefaultSize
  });
  
  return {
    complexityThreshold: (complexityInput != null && !Number.isNaN(complexityInput)) ? complexityInput : safeDefaultComplexity,
    sizeThreshold: (sizeInput != null && !Number.isNaN(sizeInput)) ? sizeInput : safeDefaultSize
  };
}

function getDefaultThresholds(options: RefactorInteractiveOptions): {
  complexityThreshold: number;
  sizeThreshold: number;
} {
  // Parse complexity threshold with NaN protection
  const complexityValue = parseInt(options.complexityThreshold || '5');
  const complexityThreshold = Number.isNaN(complexityValue) ? 5 : complexityValue;
  
  // Parse size threshold with NaN protection
  const sizeValue = parseInt(options.sizeThreshold || '20');
  const sizeThreshold = Number.isNaN(sizeValue) ? 20 : sizeValue;
  
  return {
    complexityThreshold,
    sizeThreshold
  };
}

async function reviewOpportunities(
  opportunities: RefactoringOpportunity[],
  sessionManager: SessionManager,
  currentSession: RefactoringSession | null,
  config: { patterns?: RefactoringPattern[] }
): Promise<void> {
  console.log(chalk.cyan.bold('\n📊 Refactoring Opportunities Review\n'));
  
  const limit = 10; // Fixed limit for interactive review
  const limitedOpportunities = opportunities.slice(0, limit);
  
  // Display summary
  console.log(`Found: ${chalk.yellow(opportunities.length)} opportunities`);
  console.log(`Reviewing: ${chalk.yellow(limitedOpportunities.length)} opportunities`);
  
  if (config.patterns && config.patterns.length > 0) {
    console.log(`Pattern focus: ${chalk.blue(config.patterns.map(p => formatPatternName(p)).join(', '))}`);
  }
  
  // Group by pattern for overview
  const byPattern = groupOpportunitiesByPattern(limitedOpportunities);
  console.log('\nBy Pattern:');
  Object.entries(byPattern).forEach(([pattern, patternOpps]) => {
    console.log(`  ${formatPatternName(pattern)}: ${chalk.yellow(patternOpps.length)}`);
  });
  
  const selectedOpportunities: RefactoringOpportunity[] = [];
  
  // Review each opportunity
  let currentIndex = 0;
  while (currentIndex < limitedOpportunities.length) {
    const opp = limitedOpportunities[currentIndex];
    console.log(chalk.blue.bold(`\n─────────────────────────────────────────────────────────────`));
    console.log(chalk.blue.bold(`[${currentIndex + 1}/${limitedOpportunities.length}] ${formatPatternName(opp.pattern)}`));
    console.log(chalk.blue.bold(`─────────────────────────────────────────────────────────────`));
    
    console.log(`${getSeverityIcon(opp.severity)} Severity: ${getSeverityDisplay(opp.severity)}`);
    console.log(`📊 Impact Score: ${chalk.yellow(opp.impact_score)}`);
    console.log(`📁 Function: ${chalk.cyan(opp.function_id)}`);
    console.log(`💬 Description: ${chalk.gray(opp.description)}`);
    
    if (opp.metadata) {
      console.log('\n📋 Details:');
      Object.entries(opp.metadata).forEach(([key, value]) => {
        console.log(`   ${key}: ${chalk.gray(String(value))}`);
      });
    }
    
    const action = await prompts.select({
      message: '🤔 What would you like to do with this opportunity?',
      choices: [
        { name: '✅ Select for refactoring', value: 'select' },
        { name: '⏭️  Skip this opportunity', value: 'skip' },
        { name: '👀 View more details', value: 'details' },
        { name: '🛑 Stop reviewing', value: 'stop' }
      ]
    });
    
    if (action === 'select') {
      selectedOpportunities.push(opp);
      console.log(chalk.green('✅ Selected for refactoring\n'));
      currentIndex++;
    } else if (action === 'skip') {
      console.log(chalk.gray('⏭️  Skipped\n'));
      currentIndex++;
    } else if (action === 'details') {
      await showOpportunityDetails(opp);
      // Stay on the same opportunity (don't increment index)
      console.log(chalk.gray('📍 Returning to opportunity selection...\n'));
    } else if (action === 'stop') {
      console.log(chalk.yellow('🛑 Stopping review\n'));
      break;
    }
  }
  
  // Final summary and next steps
  await showFinalSummary(selectedOpportunities, sessionManager, currentSession);
}

async function showOpportunityDetails(opp: RefactoringOpportunity): Promise<void> {
  console.log(chalk.cyan.bold('\n📋 Detailed Information\n'));
  
  console.log(`🔍 Opportunity ID: ${chalk.gray(opp.id)}`);
  console.log(`📊 Impact Score: ${chalk.yellow(opp.impact_score)}`);
  console.log(`🎯 Pattern: ${chalk.blue(formatPatternName(opp.pattern))}`);
  console.log(`⚠️  Severity: ${getSeverityDisplay(opp.severity)}`);
  console.log(`📁 Function: ${chalk.cyan(opp.function_id)}`);
  console.log(`💬 Description: ${chalk.gray(opp.description)}`);
  
  if (opp.metadata) {
    console.log('\n📋 Technical Details:');
    Object.entries(opp.metadata).forEach(([key, value]) => {
      console.log(`   ${key}: ${chalk.gray(String(value))}`);
    });
  }
  
  console.log(chalk.cyan.bold('\n💡 Refactoring Suggestions:'));
  console.log(getRefactoringSuggestions(opp.pattern));
  
  await prompts.input({
    message: 'Press Enter to continue...'
  });
}

function getRefactoringSuggestions(pattern: RefactoringPattern): string {
  const suggestions: Record<RefactoringPattern, string> = {
    [RefactoringPattern.ExtractMethod]: 
      '   • Identify cohesive code blocks that can be extracted\n' +
      '   • Create descriptive method names\n' +
      '   • Ensure extracted methods have single responsibility',
    
    [RefactoringPattern.SplitFunction]:
      '   • Separate different concerns into distinct functions\n' +
      '   • Reduce function complexity by breaking logic\n' +
      '   • Improve readability and testability',
    
    [RefactoringPattern.ReduceParameters]:
      '   • Group related parameters into objects\n' +
      '   • Use parameter objects or configuration objects\n' +
      '   • Consider builder pattern for complex parameter sets',
    
    [RefactoringPattern.ExtractClass]:
      '   • Group related methods and properties\n' +
      '   • Create cohesive class interfaces\n' +
      '   • Improve code organization and reusability',
    
    [RefactoringPattern.InlineFunction]:
      '   • Remove unnecessary abstraction layers\n' +
      '   • Simplify overly complex function hierarchies\n' +
      '   • Improve performance by reducing function calls',
    
    [RefactoringPattern.RenameFunction]:
      '   • Use clear, descriptive names\n' +
      '   • Follow naming conventions\n' +
      '   • Make function purpose obvious from name'
  };
  
  return suggestions[pattern] || '   • Apply appropriate refactoring techniques';
}

async function showFinalSummary(
  selectedOpportunities: RefactoringOpportunity[],
  _sessionManager: SessionManager,
  currentSession: RefactoringSession | null
): Promise<void> {
  console.log(chalk.cyan.bold('\n🎉 Refactoring Review Complete\n'));
  
  console.log(`✅ Selected: ${chalk.green(selectedOpportunities.length)} opportunities`);
  
  if (selectedOpportunities.length > 0) {
    // Group selected by pattern
    const byPattern = groupOpportunitiesByPattern(selectedOpportunities);
    console.log('\nSelected by Pattern:');
    Object.entries(byPattern).forEach(([pattern, patternOpps]) => {
      console.log(`  ${formatPatternName(pattern)}: ${chalk.yellow(patternOpps.length)}`);
    });
    
    // Session management
    if (currentSession) {
      console.log(`\n📂 Session: ${chalk.green(currentSession.name)}`);
      console.log(`   Session ID: ${chalk.gray(currentSession.id)}`);
    }
    
    // Next steps
    console.log(chalk.blue.bold('\n💡 Next Steps:'));
    console.log('   • Review selected opportunities manually in your IDE');
    console.log('   • Apply refactoring techniques step by step');
    console.log('   • Run tests after each refactoring');
    console.log('   • Use ' + chalk.cyan('funcqc refactor track') + ' to update session progress');
    
    if (currentSession) {
      console.log('   • Use ' + chalk.cyan(`funcqc refactor track show ${currentSession.id}`) + ' to view session details');
    }
    
    console.log(chalk.blue.bold('\n🛠️  Additional Tools:'));
    console.log('   • ' + chalk.cyan('funcqc refactor status') + ' - View project refactoring status');
    console.log('   • ' + chalk.cyan('funcqc refactor plan') + ' - Generate refactoring plan');
    
  } else {
    console.log(chalk.yellow('\nNo opportunities selected. Consider:'));
    console.log('   • Adjusting detection thresholds');
    console.log('   • Focusing on specific patterns');
    console.log('   • Running ' + chalk.cyan('funcqc refactor analyze') + ' for comprehensive analysis');
  }
  
  console.log(chalk.gray('\nHappy refactoring! 🚀\n'));
}

// ========================================
// PLAN COMMAND IMPLEMENTATION
// ========================================

interface RefactoringPlan {
  metadata: {
    generated: string;
    timeline: number;
    effortPerWeek: number;
    totalEffort: number;
    sessionId?: string;
    pattern?: string;
  };
  summary: {
    totalOpportunities: number;
    priorityDistribution: Record<string, number>;
    estimatedImpact: string;
    riskLevel: string;
  };
  phases: RefactoringPhase[];
  recommendations: string[];
  risks: string[];
  successMetrics: string[];
}

interface RefactoringPhase {
  phase: number;
  title: string;
  description: string;
  duration: string;
  effort: number;
  opportunities: RefactoringOpportunity[];
  deliverables: string[];
  dependencies: string[];
  risks: string[];
  successCriteria: string[];
}

async function refactorPlanCommandImpl(
  options: RefactorPlanOptions,
  env: CommandEnvironment
): Promise<void> {
  const spinner = ora({ color: 'cyan', text: 'Generating refactoring plan...' });
  
  try {
    spinner.start();
    
    const analyzer = new RefactoringAnalyzer(env.storage);
    const sessionManager = new SessionManager(env.storage);
    
    spinner.text = 'Analyzing project and generating plan...';
    
    const plan = await generateRefactoringPlan(analyzer, sessionManager, options);
    
    spinner.succeed('Refactoring plan generated');
    
    if (options.output) {
      await savePlanToFile(plan, options.output, options.format || 'markdown');
      console.log(chalk.green(`📄 Plan saved to: ${options.output}`));
    }
    
    if (options.format === 'json') {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      displayRefactoringPlan(plan);
    }
    
  } catch (error) {
    spinner.fail();
    env.commandLogger.error('Plan generation failed', error);
    process.exit(1);
  }
}

function parseIntegerOption(value: string | undefined, defaultValue: number): number {
  const parsed = parseInt(value || defaultValue.toString());
  return !isNaN(parsed) && parsed > 0 ? parsed : defaultValue;
}

function buildAnalysisOptions(options: RefactorPlanOptions): {
  complexityThreshold?: number;
  sizeThreshold?: number;
  patterns?: RefactoringPattern[];
} {
  const analysisOptions: {
    complexityThreshold?: number;
    sizeThreshold?: number;
    patterns?: RefactoringPattern[];
  } = {};
  
  analysisOptions.complexityThreshold = parseIntegerOption(options.complexityThreshold, 5);
  analysisOptions.sizeThreshold = parseIntegerOption(options.sizeThreshold, 20);
  
  if (options.pattern) {
    const pattern = parsePattern(options.pattern);
    if (pattern) {
      analysisOptions.patterns = [pattern];
    }
  }
  
  return analysisOptions;
}

async function getRefactoringOpportunities(
  analyzer: RefactoringAnalyzer,
  sessionManager: SessionManager,
  options: RefactorPlanOptions,
  analysisOptions: {
    complexityThreshold?: number;
    sizeThreshold?: number;
    patterns?: RefactoringPattern[];
  }
): Promise<{ opportunities: RefactoringOpportunity[]; sessionId?: string }> {
  let opportunities: RefactoringOpportunity[] = [];
  let sessionId: string | undefined;
  
  if (options.session) {
    const sessions = await sessionManager.listSessions();
    const session = sessions.find((s: { id: string }) => s.id === options.session);
    if (session) {
      opportunities = await sessionManager.getSessionOpportunities(session.id);
      sessionId = session.id;
    }
  }
  
  if (opportunities.length === 0) {
    const report = await analyzer.analyzeProject(analysisOptions);
    opportunities = report.opportunities;
  }
  
  const result: { opportunities: RefactoringOpportunity[]; sessionId?: string } = { opportunities };
  if (sessionId) {
    result.sessionId = sessionId;
  }
  return result;
}

function buildPlanMetadata(
  options: RefactorPlanOptions,
  sessionId?: string
): RefactoringPlan['metadata'] {
  const timeline = parseIntegerOption(options.timeline, 4);
  const effortPerWeek = parseIntegerOption(options.effort, 8);
  
  const metadata: RefactoringPlan['metadata'] = {
    generated: new Date().toISOString(),
    timeline,
    effortPerWeek,
    totalEffort: timeline * effortPerWeek
  };
  
  if (sessionId) {
    metadata.sessionId = sessionId;
  }
  
  if (options.pattern) {
    metadata.pattern = options.pattern;
  }
  
  return metadata;
}

async function generateRefactoringPlan(
  analyzer: RefactoringAnalyzer,
  sessionManager: SessionManager,
  options: RefactorPlanOptions
): Promise<RefactoringPlan> {
  const analysisOptions = buildAnalysisOptions(options);
  const { opportunities, sessionId } = await getRefactoringOpportunities(
    analyzer,
    sessionManager,
    options,
    analysisOptions
  );
  
  const metadata = buildPlanMetadata(options, sessionId);
  
  return {
    metadata,
    summary: generateSummary(opportunities),
    phases: generatePhases(opportunities, metadata.timeline, metadata.effortPerWeek),
    recommendations: generateRecommendations(opportunities),
    risks: generateRisks(opportunities),
    successMetrics: generateSuccessMetrics(opportunities)
  };
}

function generateSummary(opportunities: RefactoringOpportunity[]): RefactoringPlan['summary'] {
  const priorityDistribution = opportunities.reduce((acc, opp) => {
    const priority = determinePriority(opp);
    acc[priority] = (acc[priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const highSeverityCount = opportunities.filter(opp => 
    opp.severity === 'high' || opp.severity === 'critical'
  ).length;
  
  const estimatedImpact = highSeverityCount > 10 ? 'High' : 
                         highSeverityCount > 5 ? 'Medium' : 'Low';
  
  const riskLevel = opportunities.length > 20 ? 'High' : 
                   opportunities.length > 10 ? 'Medium' : 'Low';
  
  return {
    totalOpportunities: opportunities.length,
    priorityDistribution,
    estimatedImpact,
    riskLevel
  };
}

function generatePhases(
  opportunities: RefactoringOpportunity[],
  timeline: number,
  effortPerWeek: number
): RefactoringPhase[] {
  // Sort opportunities by priority and impact
  const sortedOpportunities = opportunities.sort((a, b) => {
    const priorityA = getPriorityScore(determinePriority(a));
    const priorityB = getPriorityScore(determinePriority(b));
    
    if (priorityA !== priorityB) {
      return priorityB - priorityA; // Higher priority first
    }
    
    return b.impact_score - a.impact_score; // Higher impact first
  });
  
  const phases: RefactoringPhase[] = [];
  const opportunitiesPerPhase = Math.ceil(sortedOpportunities.length / timeline);
  
  for (let i = 0; i < timeline; i++) {
    const phaseOpportunities = sortedOpportunities.slice(
      i * opportunitiesPerPhase,
      (i + 1) * opportunitiesPerPhase
    );
    
    if (phaseOpportunities.length === 0) break;
    
    phases.push(generatePhase(i + 1, phaseOpportunities, effortPerWeek));
  }
  
  return phases;
}

function generatePhase(
  phaseNumber: number,
  opportunities: RefactoringOpportunity[],
  effortPerWeek: number
): RefactoringPhase {
  const patterns = [...new Set(opportunities.map(opp => opp.pattern))];
  const mainPattern = patterns[0];
  
  const phaseConfig = {
    1: {
      title: 'Critical Issues & Foundation',
      description: 'Address critical refactoring opportunities and establish foundation for future improvements',
      focus: 'critical and high-severity issues'
    },
    2: {
      title: 'Core Refactoring',
      description: 'Implement major structural improvements and reduce technical debt',
      focus: 'medium-severity issues and structural improvements'
    },
    3: {
      title: 'Optimization & Enhancement',
      description: 'Fine-tune implementation and optimize for performance and maintainability',
      focus: 'optimization and enhancement opportunities'
    },
    4: {
      title: 'Polish & Consolidation',
      description: 'Final polish, consolidation, and preparation for next iteration',
      focus: 'remaining issues and consolidation'
    }
  };
  
  const config = phaseConfig[phaseNumber as keyof typeof phaseConfig] || phaseConfig[4];
  
  return {
    phase: phaseNumber,
    title: config.title,
    description: config.description,
    duration: '1 week',
    effort: effortPerWeek,
    opportunities,
    deliverables: generateDeliverables(opportunities, mainPattern),
    dependencies: generateDependencies(phaseNumber, patterns),
    risks: generatePhaseRisks(opportunities),
    successCriteria: generateSuccessCriteria(opportunities)
  };
}

function generateDeliverables(
  opportunities: RefactoringOpportunity[],
  mainPattern: RefactoringPattern
): string[] {
  const deliverables: string[] = [];
  
  const patternDeliverables: Record<RefactoringPattern, string[]> = {
    [RefactoringPattern.ExtractMethod]: [
      'Extracted methods with clear responsibilities',
      'Reduced function complexity metrics',
      'Improved test coverage for extracted methods'
    ],
    [RefactoringPattern.SplitFunction]: [
      'Split functions with single responsibilities',
      'Improved function readability and maintainability',
      'Updated function documentation'
    ],
    [RefactoringPattern.ReduceParameters]: [
      'Simplified function signatures',
      'Parameter objects or configuration structures',
      'Improved function usability'
    ],
    [RefactoringPattern.ExtractClass]: [
      'New classes with cohesive responsibilities',
      'Improved code organization',
      'Better encapsulation and reusability'
    ],
    [RefactoringPattern.InlineFunction]: [
      'Simplified function hierarchies',
      'Reduced unnecessary abstraction',
      'Improved performance metrics'
    ],
    [RefactoringPattern.RenameFunction]: [
      'Clear and descriptive function names',
      'Updated documentation and comments',
      'Improved code readability'
    ]
  };
  
  deliverables.push(...(patternDeliverables[mainPattern] || [
    'Refactored functions with improved quality',
    'Reduced technical debt metrics',
    'Enhanced code maintainability'
  ]));
  
  deliverables.push(
    `${opportunities.length} refactoring opportunities addressed`,
    'Updated unit tests for modified functions',
    'Code quality metrics improvement',
    'Documentation updates'
  );
  
  return deliverables;
}

function generateDependencies(phaseNumber: number, patterns: RefactoringPattern[]): string[] {
  const dependencies: string[] = [];
  
  if (phaseNumber === 1) {
    dependencies.push(
      'Project setup and tooling configuration',
      'Backup of current codebase',
      'Test suite validation'
    );
  } else {
    dependencies.push(
      `Completion of Phase ${phaseNumber - 1}`,
      'Previous phase quality validation',
      'Updated test coverage'
    );
  }
  
  if (patterns.includes(RefactoringPattern.ExtractClass)) {
    dependencies.push('Class design review and approval');
  }
  
  if (patterns.includes(RefactoringPattern.ExtractMethod)) {
    dependencies.push('Method naming conventions established');
  }
  
  return dependencies;
}

function generatePhaseRisks(opportunities: RefactoringOpportunity[]): string[] {
  const risks: string[] = [];
  
  if (opportunities.length > 10) {
    risks.push('High volume of changes may introduce bugs');
  }
  
  const hasHighSeverity = opportunities.some(opp => 
    opp.severity === 'high' || opp.severity === 'critical'
  );
  
  if (hasHighSeverity) {
    risks.push('Complex refactoring may require additional time');
  }
  
  risks.push(
    'Potential integration issues with existing code',
    'Time constraints may limit thorough testing',
    'Team coordination challenges'
  );
  
  return risks;
}

function generateSuccessCriteria(_opportunities: RefactoringOpportunity[]): string[] {
  return [
    'All phase opportunities successfully addressed',
    'No new high-severity issues introduced',
    'Test suite passes with improved coverage',
    'Code quality metrics show improvement',
    'Documentation updated and validated',
    'Team review and approval completed'
  ];
}

function generateRecommendations(opportunities: RefactoringOpportunity[]): string[] {
  const recommendations: string[] = [];
  
  // Pattern-specific recommendations
  const byPattern = groupOpportunitiesByPattern(opportunities);
  Object.entries(byPattern).forEach(([pattern, patternOpps]) => {
    if (patternOpps.length > 5) {
      recommendations.push(
        `Consider systematic approach to ${formatPatternName(pattern)} refactoring`
      );
    }
  });
  
  // General recommendations
  recommendations.push(
    'Implement refactoring in small, testable increments',
    'Maintain comprehensive test coverage throughout process',
    'Use automated tools where possible to reduce manual effort',
    'Regular code reviews to ensure quality standards',
    'Document refactoring decisions and rationale',
    'Monitor metrics to track improvement progress'
  );
  
  if (opportunities.length > 20) {
    recommendations.push(
      'Consider splitting refactoring into multiple iterations',
      'Prioritize high-impact, low-risk refactoring first'
    );
  }
  
  return recommendations;
}

function generateRisks(opportunities: RefactoringOpportunity[]): string[] {
  const risks: string[] = [
    'Refactoring may introduce new bugs if not carefully tested',
    'Large-scale changes may disrupt ongoing development',
    'Team productivity may decrease during refactoring period',
    'External dependencies may complicate refactoring efforts'
  ];
  
  if (opportunities.length > 30) {
    risks.push('High volume of changes increases project complexity');
  }
  
  const hasHighSeverity = opportunities.some(opp => 
    opp.severity === 'high' || opp.severity === 'critical'
  );
  
  if (hasHighSeverity) {
    risks.push('Complex refactoring may require specialized expertise');
  }
  
  return risks;
}

function generateSuccessMetrics(_opportunities: RefactoringOpportunity[]): string[] {
  return [
    'Reduction in cyclomatic complexity by 30%',
    'Decrease in function length by 25%',
    'Improvement in maintainability index',
    'Zero introduction of new high-severity issues',
    'Test coverage maintained or improved',
    'Code review approval rate above 95%',
    'Team satisfaction with refactored code',
    'Performance metrics remain stable or improve'
  ];
}

function determinePriority(opp: RefactoringOpportunity): string {
  if (opp.severity === 'critical') return 'critical';
  if (opp.severity === 'high') return 'high';
  if (opp.impact_score > 8) return 'high';
  if (opp.impact_score > 5) return 'medium';
  return 'low';
}

function getPriorityScore(priority: string): number {
  const scores = { critical: 4, high: 3, medium: 2, low: 1 };
  return scores[priority as keyof typeof scores] || 1;
}

async function savePlanToFile(
  plan: RefactoringPlan,
  outputPath: string,
  format: string
): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.promises.mkdir(dir, { recursive: true });
  
  let content: string;
  
  if (format === 'json') {
    content = JSON.stringify(plan, null, 2);
  } else {
    content = generateMarkdownPlan(plan);
  }
  
  await fs.promises.writeFile(outputPath, content, 'utf8');
}

function generatePlanHeader(plan: RefactoringPlan): string[] {
  return [
    '# Refactoring Plan',
    '',
    `Generated: ${new Date(plan.metadata.generated).toLocaleString()}`,
    `Timeline: ${plan.metadata.timeline} weeks`,
    `Effort: ${plan.metadata.effortPerWeek} hours/week`,
    ''
  ];
}

function generatePlanSummary(plan: RefactoringPlan): string[] {
  const lines = [
    '## 📊 Summary',
    '',
    `- **Total Opportunities**: ${plan.summary.totalOpportunities}`,
    `- **Estimated Impact**: ${plan.summary.estimatedImpact}`,
    `- **Risk Level**: ${plan.summary.riskLevel}`,
    ''
  ];
  
  if (Object.keys(plan.summary.priorityDistribution).length > 0) {
    lines.push('**Priority Distribution**:');
    Object.entries(plan.summary.priorityDistribution).forEach(([priority, count]) => {
      lines.push(`- ${priority}: ${count}`);
    });
    lines.push('');
  }
  
  return lines;
}

function generatePhaseDetails(phase: RefactoringPhase): string[] {
  const lines = [
    `### Phase ${phase.phase}: ${phase.title}`,
    '',
    `**Duration**: ${phase.duration} | **Effort**: ${phase.effort} hours`,
    '',
    `**Description**: ${phase.description}`,
    ''
  ];
  
  // Handle opportunities separately due to different type
  if (phase.opportunities.length > 0) {
    lines.push('**Opportunities**:');
    phase.opportunities.forEach(opp => {
      lines.push(`- ${getSeverityIcon(opp.severity)} ${formatPatternName(opp.pattern)} (${opp.function_id})`);
    });
    lines.push('');
  }
  
  // Handle string arrays
  const stringSections = [
    { items: phase.deliverables, title: '**Deliverables**:' },
    { items: phase.dependencies, title: '**Dependencies**:' },
    { items: phase.risks, title: '**Risks**:' },
    { items: phase.successCriteria, title: '**Success Criteria**:' }
  ];
  
  stringSections.forEach(section => {
    if (section.items.length > 0) {
      lines.push(section.title);
      section.items.forEach(item => lines.push(`- ${item}`));
      lines.push('');
    }
  });
  
  return lines;
}

function generatePlanPhases(plan: RefactoringPlan): string[] {
  const lines = ['## 🗓️ Refactoring Phases', ''];
  plan.phases.forEach(phase => {
    lines.push(...generatePhaseDetails(phase));
  });
  return lines;
}

function generatePlanSections(plan: RefactoringPlan): string[] {
  const lines: string[] = [];
  
  const sections = [
    { items: plan.recommendations, title: '## 💡 Recommendations', icon: '💡' },
    { items: plan.risks, title: '## ⚠️ Risks', icon: '⚠️' },
    { items: plan.successMetrics, title: '## 📈 Success Metrics', icon: '📈' }
  ];
  
  sections.forEach(section => {
    if (section.items.length > 0) {
      lines.push(section.title, '');
      section.items.forEach(item => lines.push(`- ${item}`));
      lines.push('');
    }
  });
  
  return lines;
}

function generateMarkdownPlan(plan: RefactoringPlan): string {
  const sections = [
    generatePlanHeader(plan),
    generatePlanSummary(plan),
    generatePlanPhases(plan),
    generatePlanSections(plan)
  ];
  
  return sections.flat().join('\n');
}

function displayRefactoringPlan(plan: RefactoringPlan): void {
  console.log(chalk.cyan.bold('\n📋 Refactoring Plan\n'));
  
  // Metadata
  console.log(chalk.blue.bold('📊 Plan Overview'));
  console.log(`Generated: ${chalk.gray(new Date(plan.metadata.generated).toLocaleString())}`);
  console.log(`Timeline: ${chalk.yellow(plan.metadata.timeline)} weeks`);
  console.log(`Effort: ${chalk.yellow(plan.metadata.effortPerWeek)} hours/week`);
  console.log(`Total Effort: ${chalk.yellow(plan.metadata.totalEffort)} hours`);
  
  if (plan.metadata.sessionId) {
    console.log(`Session: ${chalk.cyan(plan.metadata.sessionId)}`);
  }
  
  // Summary
  console.log(chalk.blue.bold('\n📊 Summary'));
  console.log(`Total Opportunities: ${chalk.yellow(plan.summary.totalOpportunities)}`);
  console.log(`Estimated Impact: ${chalk.yellow(plan.summary.estimatedImpact)}`);
  console.log(`Risk Level: ${chalk.yellow(plan.summary.riskLevel)}`);
  
  if (Object.keys(plan.summary.priorityDistribution).length > 0) {
    console.log('\nPriority Distribution:');
    Object.entries(plan.summary.priorityDistribution).forEach(([priority, count]) => {
      console.log(`  ${getPriorityDisplay(priority)} ${priority}: ${chalk.yellow(count)}`);
    });
  }
  
  // Phases
  console.log(chalk.blue.bold('\n🗓️ Refactoring Phases'));
  plan.phases.forEach(phase => {
    console.log(`\n${chalk.cyan.bold(`Phase ${phase.phase}: ${phase.title}`)}`);
    console.log(`Duration: ${chalk.yellow(phase.duration)} | Effort: ${chalk.yellow(phase.effort)} hours`);
    console.log(`Description: ${chalk.gray(phase.description)}`);
    
    if (phase.opportunities.length > 0) {
      console.log(`Opportunities: ${chalk.yellow(phase.opportunities.length)}`);
      phase.opportunities.slice(0, 3).forEach(opp => {
        console.log(`  ${getSeverityIcon(opp.severity)} ${formatPatternName(opp.pattern)} (${chalk.gray(opp.function_id)})`);
      });
      if (phase.opportunities.length > 3) {
        console.log(`  ${chalk.gray(`... and ${phase.opportunities.length - 3} more`)}`);
      }
    }
    
    if (phase.deliverables.length > 0) {
      console.log('Key Deliverables:');
      phase.deliverables.slice(0, 2).forEach(deliverable => {
        console.log(`  • ${chalk.gray(deliverable)}`);
      });
      if (phase.deliverables.length > 2) {
        console.log(`  ${chalk.gray(`... and ${phase.deliverables.length - 2} more`)}`);
      }
    }
  });
  
  // Recommendations
  if (plan.recommendations.length > 0) {
    console.log(chalk.blue.bold('\n💡 Key Recommendations'));
    plan.recommendations.slice(0, 5).forEach(rec => {
      console.log(`  • ${chalk.gray(rec)}`);
    });
  }
  
  // Risks
  if (plan.risks.length > 0) {
    console.log(chalk.blue.bold('\n⚠️ Key Risks'));
    plan.risks.slice(0, 3).forEach(risk => {
      console.log(`  • ${chalk.yellow(risk)}`);
    });
  }
  
  // Success metrics
  if (plan.successMetrics.length > 0) {
    console.log(chalk.blue.bold('\n📈 Success Metrics'));
    plan.successMetrics.slice(0, 4).forEach(metric => {
      console.log(`  • ${chalk.green(metric)}`);
    });
  }
  
  console.log(chalk.blue.bold('\n🚀 Next Steps'));
  console.log(`  • Review plan with team`);
  console.log(`  • Create refactoring session: ${chalk.cyan('funcqc refactor track create')}`);
  console.log(`  • Start with Phase 1 implementation`);
  console.log(`  • Monitor progress: ${chalk.cyan('funcqc refactor status')}`);
  
  if (plan.metadata.sessionId) {
    console.log(`  • Continue session: ${chalk.cyan(`funcqc refactor interactive -s ${plan.metadata.sessionId}`)}`);
  }
  
  console.log(chalk.gray('\nHappy refactoring! 🎯\n'));
}

// ========================================
// STATUS COMMAND IMPLEMENTATION
// ========================================

interface StatusData {
  projectHealth: {
    totalFunctions: number;
    analyzedFunctions: number;
    opportunitiesFound: number;
    riskLevel: string;
    priorityAreas: string[];
    qualityScore: number;
  };
  opportunities: RefactoringOpportunity[];
  sessions: RefactoringSession[];
  patterns: Record<string, {
    count: number;
    avgImpact: number;
    severity: Record<string, number>;
  }>;
  trends: {
    recentSessions: number;
    completedRefactorings: number;
    activeRefactorings: number;
  };
}

async function refactorStatusCommandImpl(
  options: RefactorStatusOptions,
  env: CommandEnvironment
): Promise<void> {
  const spinner = ora({ color: 'cyan', text: 'Loading project status...' });
  
  try {
    spinner.start();
    
    const analyzer = new RefactoringAnalyzer(env.storage);
    const sessionManager = new SessionManager(env.storage);
    
    spinner.text = 'Analyzing project health...';
    
    const statusData = await collectStatusData(analyzer, sessionManager, options);
    
    spinner.succeed('Status analysis complete');
    
    if (options.json) {
      console.log(JSON.stringify(statusData, null, 2));
    } else {
      await displayStatusDashboard(statusData, options);
    }
    
  } catch (error) {
    spinner.fail();
    env.commandLogger.error('Status analysis failed', error);
    process.exit(1);
  }
}

async function collectStatusData(
  analyzer: RefactoringAnalyzer,
  sessionManager: SessionManager,
  options: RefactorStatusOptions
): Promise<StatusData> {
  const analysisOptions = {
    complexityThreshold: parseInt(options.complexityThreshold || '5'),
    sizeThreshold: parseInt(options.sizeThreshold || '20')
  };
  
  // Analyze current project state
  const report = await analyzer.analyzeProject(analysisOptions);
  
  // Get session data
  const sessions = await sessionManager.listSessions();
  
  // Calculate quality score (0-100)
  const qualityScore = calculateQualityScore(report.projectSummary, report.opportunities);
  
  // Analyze patterns
  const patterns = analyzePatterns(report.opportunities);
  
  // Calculate trends
  const trends = calculateTrends(sessions);
  
  return {
    projectHealth: {
      totalFunctions: report.projectSummary.totalFunctions,
      analyzedFunctions: report.projectSummary.analyzedFunctions,
      opportunitiesFound: report.opportunities.length,
      riskLevel: report.projectSummary.riskLevel,
      priorityAreas: report.projectSummary.priorityAreas,
      qualityScore
    },
    opportunities: report.opportunities,
    sessions,
    patterns,
    trends
  };
}

function calculateQualityScore(
  projectSummary: { totalFunctions: number; analyzedFunctions: number },
  opportunities: RefactoringOpportunity[]
): number {
  if (projectSummary.totalFunctions === 0) return 100;
  
  const severityWeight = opportunities.reduce((sum, opp) => {
    const weights = { critical: 4, high: 3, medium: 2, low: 1 };
    return sum + (weights[opp.severity as keyof typeof weights] || 1);
  }, 0);
  
  const maxPossibleWeight = projectSummary.totalFunctions * 4;
  const qualityScore = Math.max(0, 100 - (severityWeight / maxPossibleWeight) * 100);
  
  return Math.round(qualityScore);
}

function analyzePatterns(opportunities: RefactoringOpportunity[]): Record<string, {
  count: number;
  avgImpact: number;
  severity: Record<string, number>;
}> {
  const patterns: Record<string, {
    count: number;
    avgImpact: number;
    severity: Record<string, number>;
  }> = {};
  
  const grouped = groupOpportunitiesByPattern(opportunities);
  
  Object.entries(grouped).forEach(([pattern, patternOpps]) => {
    const avgImpact = patternOpps.reduce((sum, opp) => sum + opp.impact_score, 0) / patternOpps.length;
    const severity: Record<string, number> = {};
    
    patternOpps.forEach(opp => {
      severity[opp.severity] = (severity[opp.severity] || 0) + 1;
    });
    
    patterns[pattern] = {
      count: patternOpps.length,
      avgImpact: Math.round(avgImpact * 10) / 10,
      severity
    };
  });
  
  return patterns;
}

function calculateTrends(sessions: RefactoringSession[]): {
  recentSessions: number;
  completedRefactorings: number;
  activeRefactorings: number;
} {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const recentSessions = sessions.filter(s => 
    new Date(s.created_at) > oneWeekAgo
  ).length;
  
  const completedRefactorings = sessions.filter(s => 
    s.status === 'completed'
  ).length;
  
  const activeRefactorings = sessions.filter(s => 
    s.status === 'active'
  ).length;
  
  return {
    recentSessions,
    completedRefactorings,
    activeRefactorings
  };
}

async function displayStatusDashboard(
  statusData: StatusData,
  options: RefactorStatusOptions
): Promise<void> {
  displayHeader();
  displayProjectHealth(statusData.projectHealth);
  displayOpportunitiesOverview(statusData.opportunities, statusData.patterns);
  displaySessionsOverview(statusData.sessions, statusData.trends);
  
  if (options.detailed) {
    displayDetailedBreakdown(statusData);
  }
  
  displayStatusRecommendations(statusData);
}

function displayHeader(): void {
  console.log(chalk.cyan.bold('\n📊 Project Refactoring Status Dashboard\n'));
  console.log(chalk.gray(`Generated: ${new Date().toLocaleString()}\n`));
}

function displayProjectHealth(health: StatusData['projectHealth']): void {
  console.log(chalk.blue.bold('🏥 Project Health'));
  console.log(chalk.blue('─'.repeat(50)));
  
  // Quality score with color coding
  const qualityColor = health.qualityScore >= 80 ? chalk.green : 
                      health.qualityScore >= 60 ? chalk.yellow : chalk.red;
  
  console.log(`Quality Score: ${qualityColor.bold(health.qualityScore + '/100')}`);
  console.log(`Risk Level: ${getRiskLevelDisplay(health.riskLevel)}`);
  console.log(`Total Functions: ${chalk.yellow(health.totalFunctions)}`);
  console.log(`Analyzed Functions: ${chalk.yellow(health.analyzedFunctions)}`);
  console.log(`Opportunities Found: ${chalk.yellow(health.opportunitiesFound)}`);
  
  if (health.priorityAreas.length > 0) {
    console.log(`\nPriority Areas:`);
    health.priorityAreas.slice(0, 3).forEach(area => {
      console.log(`  • ${chalk.gray(area)}`);
    });
  }
}

function displayOpportunitiesOverview(
  opportunities: RefactoringOpportunity[],
  patterns: StatusData['patterns']
): void {
  console.log(chalk.blue.bold('\n🎯 Refactoring Opportunities'));
  console.log(chalk.blue('─'.repeat(50)));
  
  if (opportunities.length === 0) {
    console.log(chalk.green('✅ No refactoring opportunities found. Great job!'));
    return;
  }
  
  // Severity distribution
  const severityCount = opportunities.reduce((acc, opp) => {
    acc[opp.severity] = (acc[opp.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('Severity Distribution:');
  ['critical', 'high', 'medium', 'low'].forEach(severity => {
    const count = severityCount[severity] || 0;
    if (count > 0) {
      console.log(`  ${getSeverityIcon(severity)} ${severity.toUpperCase()}: ${chalk.yellow(count)}`);
    }
  });
  
  // Pattern breakdown
  console.log('\nPattern Breakdown:');
  Object.entries(patterns).forEach(([pattern, data]) => {
    console.log(`  ${formatPatternName(pattern)}: ${chalk.yellow(data.count)} (avg impact: ${chalk.cyan(data.avgImpact)})`);
  });
  
  // Top opportunities
  console.log('\nTop Opportunities:');
  opportunities
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, 5)
    .forEach((opp, index) => {
      console.log(`  ${index + 1}. ${getSeverityDisplay(opp.severity)} ${formatPatternName(opp.pattern)} (${chalk.yellow(opp.impact_score)})`);
      console.log(`     ${chalk.gray(opp.function_id)}`);
    });
}

function displaySessionsOverview(
  sessions: RefactoringSession[],
  trends: StatusData['trends']
): void {
  console.log(chalk.blue.bold('\n📂 Refactoring Sessions'));
  console.log(chalk.blue('─'.repeat(50)));
  
  if (sessions.length === 0) {
    console.log(chalk.gray('No refactoring sessions found.'));
    return;
  }
  
  // Session statistics
  console.log(`Total Sessions: ${chalk.yellow(sessions.length)}`);
  console.log(`Active Sessions: ${chalk.yellow(trends.activeRefactorings)}`);
  console.log(`Completed Sessions: ${chalk.green(trends.completedRefactorings)}`);
  console.log(`Recent Sessions (7 days): ${chalk.cyan(trends.recentSessions)}`);
  
  // Session status distribution
  const statusCount = sessions.reduce((acc, session) => {
    acc[session.status] = (acc[session.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('\nSession Status:');
  Object.entries(statusCount).forEach(([status, count]) => {
    const statusColor = status === 'completed' ? chalk.green : 
                       status === 'active' ? chalk.yellow : chalk.gray;
    console.log(`  ${statusColor(status.toUpperCase())}: ${chalk.yellow(count)}`);
  });
  
  // Recent sessions
  const recentSessions = sessions
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);
  
  if (recentSessions.length > 0) {
    console.log('\nRecent Sessions:');
    recentSessions.forEach(session => {
      const statusColor = session.status === 'completed' ? chalk.green : 
                         session.status === 'active' ? chalk.yellow : chalk.gray;
      const dateStr = new Date(session.created_at).toLocaleDateString();
      console.log(`  • ${session.name} ${statusColor(`[${session.status}]`)} - ${chalk.gray(dateStr)}`);
    });
  }
}

function displayDetailedBreakdown(statusData: StatusData): void {
  console.log(chalk.blue.bold('\n🔍 Detailed Analysis'));
  console.log(chalk.blue('─'.repeat(50)));
  
  // Function quality distribution
  const { projectHealth, opportunities } = statusData;
  
  if (projectHealth.totalFunctions > 0) {
    const healthyFunctions = projectHealth.totalFunctions - opportunities.length;
    const healthyPercentage = Math.round((healthyFunctions / projectHealth.totalFunctions) * 100);
    
    console.log('Function Quality Distribution:');
    console.log(`  ${chalk.green('Healthy Functions')}: ${chalk.yellow(healthyFunctions)} (${healthyPercentage}%)`);
    console.log(`  ${chalk.red('Functions with Issues')}: ${chalk.yellow(opportunities.length)} (${100 - healthyPercentage}%)`);
  }
  
  // Pattern-specific analysis
  console.log('\nPattern-Specific Analysis:');
  Object.entries(statusData.patterns).forEach(([pattern, data]) => {
    console.log(`\n  ${formatPatternName(pattern)}:`);
    console.log(`    Count: ${chalk.yellow(data.count)}`);
    console.log(`    Average Impact: ${chalk.cyan(data.avgImpact)}`);
    console.log(`    Severity Breakdown:`);
    Object.entries(data.severity).forEach(([severity, count]) => {
      console.log(`      ${getSeverityIcon(severity)} ${severity}: ${chalk.yellow(count)}`);
    });
  });
}

function displayStatusRecommendations(statusData: StatusData): void {
  console.log(chalk.blue.bold('\n💡 Recommendations'));
  console.log(chalk.blue('─'.repeat(50)));
  
  const { projectHealth, opportunities, trends } = statusData;
  
  if (projectHealth.qualityScore >= 80) {
    console.log(chalk.green('✅ Your project has excellent code quality!'));
    console.log('   • Continue maintaining high standards');
    console.log('   • Consider peer code reviews');
    console.log('   • Document refactoring guidelines');
  } else if (projectHealth.qualityScore >= 60) {
    console.log(chalk.yellow('⚠️  Your project has moderate refactoring needs:'));
    console.log('   • Focus on high-severity opportunities first');
    console.log('   • Create refactoring sessions for systematic improvement');
    console.log('   • Consider automated refactoring tools');
  } else {
    console.log(chalk.red('🚨 Your project needs significant refactoring:'));
    console.log('   • Prioritize critical and high-severity issues');
    console.log('   • Break down refactoring into manageable sessions');
    console.log('   • Consider refactoring sprints or dedicated time');
  }
  
  // Actionable next steps
  console.log(chalk.blue.bold('\n🚀 Next Steps:'));
  
  if (opportunities.length > 0) {
    console.log(`   • Run ${chalk.cyan('funcqc refactor interactive')} to start guided refactoring`);
    console.log(`   • Use ${chalk.cyan('funcqc refactor detect')} to focus on specific patterns`);
    console.log(`   • Create sessions with ${chalk.cyan('funcqc refactor track create')}`);
  }
  
  if (trends.activeRefactorings > 0) {
    console.log(`   • Continue working on ${trends.activeRefactorings} active sessions`);
    console.log(`   • Use ${chalk.cyan('funcqc refactor track list')} to see session details`);
  }
  
  if (opportunities.length === 0) {
    console.log(`   • Monitor code quality with regular ${chalk.cyan('funcqc refactor status')} checks`);
    console.log(`   • Set up automated quality gates in CI/CD`);
    console.log(`   • Share refactoring best practices with team`);
  }
  
  console.log(chalk.gray('\nFor more detailed analysis, use --detailed flag\n'));
}

// ========================================
// TRACK COMMAND IMPLEMENTATION
// ========================================

async function refactorTrackCommandImpl(
  subcommand: string,
  args: string[],
  options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  const sessionManager = new SessionManager(env.storage);
  
  switch (subcommand) {
    case 'list':
      await trackListCommand(sessionManager, options);
      break;
    case 'show':
      if (args.length === 0) {
        throw new Error('Session ID is required for show command');
      }
      await trackShowCommand(sessionManager, args[0], options);
      break;
    case 'create':
      await trackCreateCommand(sessionManager, options);
      break;
    case 'update':
      if (args.length < 2) {
        throw new Error('Session ID and Function ID are required for update command');
      }
      await trackUpdateCommand(sessionManager, args[0], args[1], options);
      break;
    case 'complete':
      if (args.length === 0) {
        throw new Error('Session ID is required for complete command');
      }
      await trackCompleteCommand(sessionManager, args[0], options);
      break;
    case 'cancel':
      if (args.length === 0) {
        throw new Error('Session ID is required for cancel command');
      }
      await trackCancelCommand(sessionManager, args[0], options);
      break;
    case 'split':
      if (args.length < 2) {
        throw new Error('Parent function ID and at least one child function ID are required for split command');
      }
      await trackSplitCommand(sessionManager, args[0], args.slice(1), options, env);
      break;
    case 'extract':
      if (args.length < 2) {
        throw new Error('Parent function ID and extracted function ID are required for extract command');
      }
      await trackExtractCommand(sessionManager, args[0], args[1], options, env);
      break;
    default:
      throw new Error(`Unknown track subcommand: ${subcommand}`);
  }
}

async function trackListCommand(sessionManager: SessionManager, options: RefactorTrackOptions): Promise<void> {
  const sessions = options.all 
    ? await sessionManager.getAllSessions()
    : await sessionManager.getActiveSessions();
  
  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
  } else {
    displaySessionList(sessions, options.all || false);
  }
}

async function trackShowCommand(sessionManager: SessionManager, sessionId: string, options: RefactorTrackOptions): Promise<void> {
  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session ${sessionId} not found`));
    process.exit(1);
  }
  
  const summary = await sessionManager.getSessionSummary(sessionId);
  const functions = await sessionManager.getSessionFunctions(sessionId);
  
  if (options.json) {
    console.log(JSON.stringify({
      session,
      summary,
      functions
    }, null, 2));
  } else {
    displaySessionDetails(session, summary, functions);
  }
}

async function trackCreateCommand(sessionManager: SessionManager, options: RefactorTrackOptions): Promise<void> {
  // Interactive prompts if not provided
  const name = options.name || await prompts.input({
    message: 'Session name:',
    validate: (input) => input.length > 0 || 'Name is required'
  });
  
  const description = options.description || await prompts.input({
    message: 'Session description:',
    default: 'Refactoring session'
  });
  
  const targetBranch = options.branch || await prompts.input({
    message: 'Target branch (optional):',
    default: ''
  });
  
  const session = await sessionManager.createSession(name, description, targetBranch);
  
  if (options.json) {
    console.log(JSON.stringify(session, null, 2));
  } else {
    console.log(chalk.green.bold('\n✅ Refactoring Session Created\n'));
    console.log(`ID: ${chalk.cyan(session.id)}`);
    console.log(`Name: ${session.name}`);
    console.log(`Description: ${session.description}`);
    console.log(`Status: ${getStatusDisplay(session.status)}`);
    
    console.log(chalk.blue.bold('\n💡 Next Steps:'));
    console.log(`  • Run ${chalk.cyan(`funcqc refactor detect --session ${session.id}`)} to add opportunities`);
    console.log(`  • Run ${chalk.cyan(`funcqc refactor track show ${session.id}`)} to view details`);
  }
}

async function trackUpdateCommand(sessionManager: SessionManager, sessionId: string, functionId: string, options: RefactorTrackOptions): Promise<void> {
  if (options.interactive) {
    await runInteractiveUpdate(sessionManager, sessionId);
  } else {
    const status = options.status || await prompts.select({
      message: 'New status:',
      choices: [
        { name: 'In Progress', value: 'in_progress' },
        { name: 'Completed', value: 'completed' },
        { name: 'Skipped', value: 'skipped' },
        { name: 'Pending', value: 'pending' }
      ]
    });
    
    await sessionManager.updateFunctionStatus(sessionId, functionId, status as 'pending' | 'in_progress' | 'completed' | 'skipped', options.notes);
    console.log(chalk.green(`Updated function ${functionId} to ${status}`));
  }
}

async function trackCompleteCommand(sessionManager: SessionManager, sessionId: string, options: RefactorTrackOptions): Promise<void> {
  // Get session summary first
  const summary = await sessionManager.getSessionSummary(sessionId);
  
  console.log(chalk.blue.bold('\n📊 Session Summary\n'));
  console.log(`Progress: ${chalk.green(summary.progressPercentage + '%')} (${summary.completedFunctions}/${summary.totalFunctions} functions)`);
  console.log(`Estimated Effort: ${summary.estimatedEffort} hours`);
  console.log(`Actual Effort: ${summary.actualEffort} hours`);
  
  const confirm = await prompts.confirm({
    message: 'Are you sure you want to complete this session?',
    default: true
  });
  
  if (!confirm) {
    console.log(chalk.yellow('Cancelled'));
    process.exit(0);
  }
  
  const completionSummary = options.summary || await prompts.input({
    message: 'Completion summary (optional):',
    default: `Completed ${summary.completedFunctions} refactorings`
  });
  
  await sessionManager.completeSession(sessionId, completionSummary);
  console.log(chalk.green.bold('\n✅ Refactoring Session Completed!'));
}

async function trackCancelCommand(sessionManager: SessionManager, sessionId: string, options: RefactorTrackOptions): Promise<void> {
  const confirm = await prompts.confirm({
    message: 'Are you sure you want to cancel this session?',
    default: false
  });
  
  if (!confirm) {
    console.log(chalk.yellow('Cancelled'));
    process.exit(0);
  }
  
  const reason = options.reason || await prompts.input({
    message: 'Cancellation reason (optional):',
    default: ''
  });
  
  await sessionManager.cancelSession(sessionId, reason);
  console.log(chalk.green('Session cancelled'));
}

async function runInteractiveUpdate(sessionManager: SessionManager, sessionId: string): Promise<void> {
  const functions = await sessionManager.getSessionFunctions(sessionId);
  const pendingFunctions = functions.filter(f => f.status !== 'completed' && f.status !== 'skipped');
  
  if (pendingFunctions.length === 0) {
    console.log(chalk.yellow('No pending functions to update'));
    return;
  }
  
  console.log(chalk.cyan.bold('\n🔄 Interactive Status Update\n'));
  console.log(chalk.gray(`${pendingFunctions.length} functions to review\n`));
  
  for (const func of pendingFunctions) {
    console.log(chalk.blue.bold(`\nFunction: ${func.functionName || func.function_id}`));
    console.log(`Current Status: ${getStatusDisplay(func.status)}`);
    console.log(`Role: ${func.role}`);
    
    const action = await prompts.select({
      message: 'Update status to:',
      choices: [
        { name: 'In Progress', value: 'in_progress' },
        { name: 'Completed', value: 'completed' },
        { name: 'Skip', value: 'skipped' },
        { name: 'Keep as is', value: 'keep' },
        { name: 'Stop updating', value: 'stop' }
      ]
    });
    
    if (action === 'stop') {
      break;
    } else if (action !== 'keep') {
      const notes = await prompts.input({
        message: 'Notes (optional):',
        default: ''
      });
      
      await sessionManager.updateFunctionStatus(sessionId, func.function_id, action as 'pending' | 'in_progress' | 'completed' | 'skipped', notes || undefined);
      console.log(chalk.green('✓ Updated'));
    }
  }
  
  console.log(chalk.green.bold('\n✅ Update complete'));
}

function displaySessionList(sessions: RefactoringSession[], showAll: boolean): void {
  if (sessions.length === 0) {
    console.log(chalk.gray('No active refactoring sessions found.'));
    if (!showAll) {
      console.log(chalk.gray('Use --all flag to see completed and cancelled sessions.'));
    }
    return;
  }
  
  console.log(chalk.cyan.bold('\n📋 Refactoring Sessions\n'));
  
  sessions.forEach(session => {
    console.log(chalk.blue.bold(`${session.name}`));
    console.log(`  ID: ${chalk.cyan(session.id)}`);
    console.log(`  Status: ${getStatusDisplay(session.status)}`);
    console.log(`  Created: ${new Date(session.created_at).toLocaleDateString()}`);
    console.log(`  ${chalk.gray(session.description)}`);
    console.log();
  });
  
  console.log(chalk.blue.bold('💡 Commands:'));
  console.log(`  • ${chalk.cyan('funcqc refactor track show <id>')} - View session details`);
  console.log(`  • ${chalk.cyan('funcqc refactor track update <id> <function>')} - Update progress`);
  if (sessions.some(s => s.status === 'active')) {
    console.log(`  • ${chalk.cyan('funcqc refactor track complete <id>')} - Complete session`);
  }
}

function displaySessionDetails(
  session: RefactoringSession,
  summary: SessionSummary,
  functions: Array<SessionFunction & { functionName?: string }>
): void {
  console.log(chalk.cyan.bold('\n📊 Refactoring Session Details\n'));
  
  // Session info
  console.log(chalk.blue.bold('Session Information'));
  console.log(`Name: ${session.name}`);
  console.log(`ID: ${chalk.cyan(session.id)}`);
  console.log(`Status: ${getStatusDisplay(session.status)}`);
  console.log(`Description: ${session.description}`);
  console.log(`Created: ${new Date(session.created_at).toLocaleString()}`);
  
  if (session.target_branch) {
    console.log(`Target Branch: ${chalk.yellow(session.target_branch)}`);
  }
  
  // Progress
  console.log(chalk.blue.bold('\n📈 Progress'));
  const progressBar = generateProgressBar(summary.progressPercentage);
  console.log(`${progressBar} ${chalk.green(summary.progressPercentage + '%')}`);
  console.log(`Functions: ${summary.completedFunctions}/${summary.totalFunctions} completed`);
  console.log(`Estimated Effort: ${summary.estimatedEffort} hours`);
  console.log(`Actual Effort: ${summary.actualEffort} hours`);
  
  // Pattern breakdown
  if (Object.keys(summary.patterns).length > 0) {
    console.log(chalk.blue.bold('\n🎯 Patterns'));
    Object.entries(summary.patterns).forEach(([pattern, count]) => {
      console.log(`  ${formatPatternName(pattern)}: ${chalk.yellow(count)}`);
    });
  }
  
  // Functions
  console.log(chalk.blue.bold('\n📝 Functions'));
  const statusGroups = groupFunctionsByStatus(functions);
  
  Object.entries(statusGroups).forEach(([status, funcs]) => {
    if (funcs.length > 0) {
      console.log(`\n${getStatusDisplay(status)} (${funcs.length})`);
      funcs.slice(0, 5).forEach(f => {
        console.log(`  • ${f.functionName || f.function_id}`);
      });
      if (funcs.length > 5) {
        console.log(chalk.gray(`  ... and ${funcs.length - 5} more`));
      }
    }
  });
  
  // Next steps
  if (session.status === 'active') {
    console.log(chalk.blue.bold('\n💡 Next Steps:'));
    console.log(`  • ${chalk.cyan(`funcqc refactor track update ${session.id} --interactive`)} - Update function status`);
    console.log(`  • ${chalk.cyan(`funcqc refactor detect --session ${session.id}`)} - Add more opportunities`);
    console.log(`  • ${chalk.cyan(`funcqc refactor track complete ${session.id}`)} - Complete session`);
  }
}

// Helper functions
function getStatusDisplay(status: string): string {
  const statusMap: Record<string, string> = {
    active: chalk.green('● Active'),
    completed: chalk.blue('✓ Completed'),
    cancelled: chalk.red('✗ Cancelled'),
    pending: chalk.gray('○ Pending'),
    in_progress: chalk.yellow('◐ In Progress'),
    skipped: chalk.gray('→ Skipped')
  };
  
  return statusMap[status] || status;
}

function generateProgressBar(percentage: number): string {
  const width = 20;
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  
  return '[' + chalk.green('█').repeat(filled) + chalk.gray('░').repeat(empty) + ']';
}

function groupFunctionsByStatus(functions: Array<SessionFunction & { functionName?: string }>): Record<string, Array<SessionFunction & { functionName?: string }>> {
  const groups: Record<string, Array<SessionFunction & { functionName?: string }>> = {
    completed: [],
    in_progress: [],
    pending: [],
    skipped: []
  };
  
  functions.forEach(f => {
    if (groups[f.status]) {
      groups[f.status].push(f);
    }
  });
  
  return groups;
}

// ========================================
// PHASE 2: LINEAGE INTEGRATION COMMANDS
// ========================================

/**
 * Track a function split operation using LineageManager
 */
async function trackSplitCommand(
  sessionManager: SessionManager, 
  parentId: string, 
  childIds: string[], 
  options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  // Import LineageManager - using dynamic import to avoid circular dependencies
  const { LineageManagerImpl } = await import('../../utils/lineage-manager.js');
  const lineageManager = new LineageManagerImpl(env.storage);

  // Get or create active session
  let sessionId = options.session;
  if (!sessionId) {
    const activeSessions = await sessionManager.getActiveSessions();
    if (activeSessions.length === 0) {
      throw new Error('No active session found. Create a session first with: funcqc refactor track create');
    }
    sessionId = activeSessions[0].id;
  }

  // Validate that the session exists
  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  console.log(chalk.blue('🔄 Tracking function split operation...'));

  try {
    // Create refactoring operation
    const operation = {
      type: 'split' as const,
      parentFunction: parentId,
      childFunctions: childIds,
      context: {
        sessionId,
        description: options.description || `Split function ${parentId} into ${childIds.length} functions`,
        targetBranch: session.target_branch || 'main'
        // beforeSnapshot and afterSnapshot will be set when snapshots are created
      }
    };

    // Track the operation using LineageManager
    await lineageManager.trackRefactoringOperation(operation);

    // Display success message
    console.log(chalk.green('✅ Function split operation tracked successfully!'));
    console.log(`   Parent: ${chalk.cyan(parentId)}`);
    console.log(`   Children: ${chalk.cyan(childIds.join(', '))}`);
    console.log(`   Session: ${chalk.cyan(sessionId)}`);

    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        operation: 'split',
        parentId,
        childIds,
        sessionId,
        timestamp: new Date().toISOString()
      }, null, 2));
    }

  } catch (error) {
    console.error(chalk.red('❌ Failed to track split operation:'), error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Track a function extract operation using LineageManager
 */
async function trackExtractCommand(
  sessionManager: SessionManager,
  parentId: string,
  extractedId: string,
  options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  // Import LineageManager - using dynamic import to avoid circular dependencies
  const { LineageManagerImpl } = await import('../../utils/lineage-manager.js');
  const lineageManager = new LineageManagerImpl(env.storage);

  // Get or create active session
  let sessionId = options.session;
  if (!sessionId) {
    const activeSessions = await sessionManager.getActiveSessions();
    if (activeSessions.length === 0) {
      throw new Error('No active session found. Create a session first with: funcqc refactor track create');
    }
    sessionId = activeSessions[0].id;
  }

  // Validate that the session exists
  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  console.log(chalk.blue('🔄 Tracking function extract operation...'));

  try {
    // Create refactoring operation
    const operation = {
      type: 'extract' as const,
      parentFunction: parentId,
      childFunctions: [extractedId],
      context: {
        sessionId,
        description: options.description || `Extract function ${extractedId} from ${parentId}`,
        targetBranch: session.target_branch || 'main'
        // beforeSnapshot and afterSnapshot will be set when snapshots are created
      }
    };

    // Track the operation using LineageManager
    await lineageManager.trackRefactoringOperation(operation);

    // Display success message
    console.log(chalk.green('✅ Function extract operation tracked successfully!'));
    console.log(`   Parent: ${chalk.cyan(parentId)}`);
    console.log(`   Extracted: ${chalk.cyan(extractedId)}`);
    console.log(`   Session: ${chalk.cyan(sessionId)}`);

    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        operation: 'extract',
        parentId,
        extractedId,
        sessionId,
        timestamp: new Date().toISOString()
      }, null, 2));
    }

  } catch (error) {
    console.error(chalk.red('❌ Failed to track extract operation:'), error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Assess refactoring session using RefactoringHealthEngine
 */
async function refactorAssessCommandImpl(
  sessionId: string,
  options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  // Import required components
  const { RefactoringHealthEngine } = await import('../../utils/refactoring-health-engine.js');
  const { LineageManagerImpl } = await import('../../utils/lineage-manager.js');
  
  const lineageManager = new LineageManagerImpl(env.storage);
  const healthEngine = new RefactoringHealthEngine(env.storage, lineageManager);
  const sessionManager = new SessionManager(env.storage);

  // Get session ID if not provided
  if (!sessionId) {
    const activeSessions = await sessionManager.getActiveSessions();
    if (activeSessions.length === 0) {
      throw new Error('No active session found. Provide a session ID or create an active session.');
    }
    sessionId = activeSessions[0].id;
  }

  // Validate session exists
  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  console.log(chalk.blue('🔍 Assessing refactoring session with health engine...'));

  try {
    // Get changesets for this session
    const changesets = await env.storage.getRefactoringChangesetsBySession(sessionId);
    
    if (changesets.length === 0) {
      console.log(chalk.yellow('⚠️ No changesets found for this session.'));
      console.log('Use split/extract commands to track refactoring operations first.');
      return;
    }

    console.log(`Found ${changesets.length} changeset(s) to assess:`);

    // Assess each changeset
    for (const changeset of changesets) {
      if (!changeset.beforeSnapshotId || !changeset.afterSnapshotId) {
        console.log(chalk.yellow(`⚠️ Skipping changeset ${changeset.id} - missing snapshot IDs`));
        continue;
      }

      console.log(`\n${chalk.cyan('Assessing changeset:')} ${changeset.id}`);
      console.log(`Operation: ${changeset.operationType}`);
      console.log(`Parent: ${changeset.parentFunctionId || 'N/A'}`);
      console.log(`Children: ${changeset.childFunctionIds.join(', ')}`);

      try {
        const assessment = await healthEngine.evaluateChangeset(changeset);
        
        // Display assessment results
        console.log(`\n${chalk.green('Assessment Results:')}`);
        console.log(`Overall Grade: ${assessment.improvement.overallGrade}`);
        console.log(`Genuine Improvement: ${assessment.improvement.isGenuine ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`Complexity Reduction: ${assessment.improvement.complexityReduction.toFixed(1)}%`);
        console.log(`Function Explosion Score: ${assessment.improvement.functionExplosionScore.toFixed(3)}`);

        if (options.json) {
          console.log('\nDetailed Assessment (JSON):');
          console.log(JSON.stringify(assessment, null, 2));
        }

      } catch (error) {
        console.error(chalk.red(`❌ Failed to assess changeset ${changeset.id}:`), 
          error instanceof Error ? error.message : String(error));
      }
    }

    console.log(chalk.green('\n✅ Assessment completed!'));

  } catch (error) {
    console.error(chalk.red('❌ Failed to assess session:'), error instanceof Error ? error.message : String(error));
    throw error;
  }
}