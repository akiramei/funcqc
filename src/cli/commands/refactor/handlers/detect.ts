/**
 * Detect Command Handler
 * 
 * Handles the refactor detect command which finds specific refactoring
 * opportunities and optionally creates tracking sessions.
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import * as prompts from '@inquirer/prompts';
import { 
  RefactorDetectOptions, 
  RefactoringPattern,
  RefactoringOpportunity 
} from '../../../../types/index.js';
import { CommandEnvironment } from '../../../../types/environment.js';
import { RefactoringAnalyzer } from '../../../../refactoring/refactoring-analyzer.js';
import { SessionManager } from '../../../../refactoring/session-manager-simple.js';
import { 
  getSeverityDisplay,
  formatPatternName,
  parsePattern 
} from '../../../../utils/refactoring-utils.js';

// ============================================
// TYPES
// ============================================

interface ParsedAnalysisOptions {
  complexityThreshold?: number;
  sizeThreshold?: number;
  patterns?: RefactoringPattern[];
}

// ============================================
// MAIN COMMAND HANDLER
// ============================================

/**
 * Main detect command implementation
 */
export async function refactorDetectCommandImpl(
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
    
    const opportunities = filterOpportunities(report.opportunities, selectedPattern, options.limit ? Number(options.limit) : undefined);
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

// ============================================
// OPTION PARSING
// ============================================

/**
 * Parse detection options and prepare analysis parameters
 */
function parseDetectionOptions(options: RefactorDetectOptions, spinner: Ora): {
  analysisOptions: ParsedAnalysisOptions;
  selectedPattern: RefactoringPattern | undefined;
} {
  const analysisOptions: ParsedAnalysisOptions = {};
  let selectedPattern: RefactoringPattern | undefined = undefined;
  
  // Set thresholds
  if (options.complexityThreshold !== undefined) {
    analysisOptions.complexityThreshold = Number(options.complexityThreshold);
    spinner.text = `Using complexity threshold: ${options.complexityThreshold}`;
  }
  
  if (options.sizeThreshold !== undefined) {
    analysisOptions.sizeThreshold = Number(options.sizeThreshold);
  }
  
  // Parse and set pattern
  if (options.pattern) {
    selectedPattern = parsePattern(options.pattern);
    if (selectedPattern) {
      analysisOptions.patterns = [selectedPattern];
      spinner.text = `Detecting ${formatPatternName(selectedPattern)} opportunities...`;
    }
  }
  
  return { analysisOptions, selectedPattern };
}

// ============================================
// OPPORTUNITY FILTERING
// ============================================

/**
 * Filter and limit opportunities based on criteria
 */
function filterOpportunities(
  opportunities: RefactoringOpportunity[],
  pattern?: RefactoringPattern,
  limit?: number
): RefactoringOpportunity[] {
  let filtered = opportunities;
  
  if (pattern) {
    filtered = filtered.filter(opp => opp.pattern === pattern);
  }
  
  // Sort by impact score (highest first)
  filtered.sort((a, b) => b.impact_score - a.impact_score);
  
  if (limit && limit > 0) {
    filtered = filtered.slice(0, limit);
  }
  
  return filtered;
}

// ============================================
// SESSION CREATION
// ============================================

/**
 * Handle session creation if requested
 */
async function handleSessionCreation(
  options: RefactorDetectOptions,
  opportunities: RefactoringOpportunity[],
  sessionManager: SessionManager,
  pattern?: RefactoringPattern,
  spinner?: Ora
): Promise<string | null> {
  if (!options.session) return null;
  
  const sessionName = typeof options.session === 'string' 
    ? options.session 
    : `Detection Session - ${pattern ? formatPatternName(pattern) : 'All Patterns'} - ${new Date().toLocaleDateString()}`;
  
  try {
    if (spinner) {
      spinner.text = 'Creating session...';
    }
    
    const session = await sessionManager.createSession(
      sessionName,
      `Detection session for ${opportunities.length} opportunities`
    );
    
    // Link opportunities to session
    const opportunityIds = opportunities.map(opp => opp.id);
    await sessionManager.linkOpportunitiesToSession(session.id, opportunityIds);
    
    const uniqueFunctionIds = new Set(opportunities.map(opp => opp.function_id));
    const functionIds = Array.from(uniqueFunctionIds);
    await sessionManager.addFunctionsToSession(session.id, functionIds);
    
    if (spinner) {
      spinner.succeed(`Session created: ${session.id}`);
    }
    
    return session.id;
  } catch (error) {
    if (spinner) {
      spinner.warn('Failed to create session');
    }
    console.error(`Session creation failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ============================================
// INTERACTIVE DETECTION
// ============================================

/**
 * Run interactive opportunity review
 */
async function runInteractiveDetection(
  opportunities: RefactoringOpportunity[],
  sessionManager: SessionManager,
  sessionId?: string | null
): Promise<void> {
  const selectedOpportunities: RefactoringOpportunity[] = [];
  
  console.log(chalk.blue.bold(`\n🔍 Interactive Detection - ${opportunities.length} opportunities found\n`));
  
  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    
    displayOpportunityDetails(opp, i, opportunities.length);
    const action = await promptUserAction();
    const shouldStop = handleUserAction(action, opp, selectedOpportunities, opportunities, i);
    
    if (shouldStop) break;
  }
  
  if (selectedOpportunities.length > 0) {
    await createRefactoringSession(selectedOpportunities, sessionManager, sessionId);
  } else {
    console.log(chalk.yellow('\nNo opportunities selected.'));
  }
}

/**
 * Display opportunity details to the user
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
 * Prompt user for action on an opportunity
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
 * Handle user action for an opportunity
 */
function handleUserAction(
  action: string,
  opp: RefactoringOpportunity,
  selectedOpportunities: RefactoringOpportunity[],
  _opportunities: RefactoringOpportunity[],
  _index: number
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
    // Note: Code viewing functionality to be implemented
    return false;
  } else if (action === 'stop') {
    return true;
  }
  return false;
}

/**
 * Create a refactoring session if requested
 */
async function createRefactoringSession(
  selectedOpportunities: RefactoringOpportunity[],
  sessionManager: SessionManager,
  sessionId?: string | null
): Promise<void> {
  console.log(chalk.blue.bold(`\n📋 Creating refactoring plan...`));
  
  try {
    if (sessionId) {
      // Update existing session
      const opportunityIds = selectedOpportunities.map(opp => opp.id);
      await sessionManager.linkOpportunitiesToSession(sessionId, opportunityIds);
      console.log(chalk.green(`✅ Added ${selectedOpportunities.length} opportunities to session ${sessionId}`));
    } else {
      // Create new session
      const sessionName = `Interactive Detection - ${new Date().toLocaleDateString()}`;
      const session = await sessionManager.createSession(
        sessionName,
        `Interactive session with ${selectedOpportunities.length} selected opportunities`
      );
      
      const opportunityIds = selectedOpportunities.map(opp => opp.id);
      await sessionManager.linkOpportunitiesToSession(session.id, opportunityIds);
      
      const uniqueFunctionIds = new Set(selectedOpportunities.map(opp => opp.function_id));
      const functionIds = Array.from(uniqueFunctionIds);
      await sessionManager.addFunctionsToSession(session.id, functionIds);
      
      console.log(chalk.green(`✅ Session created: ${session.id}`));
    }
  } catch (error) {
    console.error(chalk.red(`❌ Failed to create/update session: ${error instanceof Error ? error.message : String(error)}`));
  }
}

// ============================================
// RESULT DISPLAY
// ============================================

/**
 * Display detection results
 */
function displayResults(
  opportunities: RefactoringOpportunity[],
  pattern?: RefactoringPattern,
  sessionId?: string | null,
  options?: RefactorDetectOptions
): void {
  if (opportunities.length === 0) {
    const patternText = pattern ? `for ${formatPatternName(pattern)}` : '';
    console.log(chalk.green(`✅ No refactoring opportunities found ${patternText}`));
    return;
  }
  
  console.log(chalk.blue.bold(`\n🎯 Detection Results${pattern ? ` - ${formatPatternName(pattern)}` : ''}`));
  console.log(chalk.gray(`Found ${opportunities.length} opportunities\n`));
  
  if (options?.json) {
    console.log(JSON.stringify({
      pattern: pattern ? formatPatternName(pattern) : null,
      count: opportunities.length,
      sessionId,
      opportunities
    }, null, 2));
    return;
  }
  
  opportunities.slice(0, 10).forEach((opp, index) => {
    console.log(`${index + 1}. ${getSeverityDisplay(opp.severity)} ${chalk.yellow(opp.function_id)}`);
    console.log(`   Score: ${chalk.yellow(opp.impact_score)} | ${chalk.gray(opp.description)}`);
    console.log();
  });
  
  if (opportunities.length > 10) {
    console.log(chalk.gray(`... and ${opportunities.length - 10} more`));
  }
  
  if (sessionId) {
    console.log(chalk.blue(`📋 Session created: ${sessionId}`));
  }
  
  console.log(chalk.blue('\n💡 Next steps:'));
  console.log(`   • Run ${chalk.cyan('funcqc refactor interactive')} for guided refactoring`);
  if (sessionId) {
    console.log(`   • Use ${chalk.cyan(`funcqc refactor track list`)} to view session details`);
  }
}