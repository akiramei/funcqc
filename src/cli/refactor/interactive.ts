import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import * as prompts from '@inquirer/prompts';
import { ConfigManager } from '../../core/config.js';
import { PGLiteStorageAdapter } from '../../storage/pglite-adapter.js';
import { Logger } from '../../utils/cli-utils.js';
import { RefactoringAnalyzer } from '../../refactoring/refactoring-analyzer.js';
import { SessionManager } from '../../refactoring/session-manager-simple.js';
import { 
  RefactoringPattern, 
  RefactoringOpportunity, 
  RefactoringSession,
  RefactorInteractiveOptions
} from '../../types/index.js';
import { 
  parsePattern, 
  formatPatternName, 
  getSeverityDisplay, 
  getSeverityIcon,
  groupOpportunitiesByPattern 
} from '../../utils/refactoring-utils.js';

/**
 * Phase 3 Week 3: funcqc refactor interactive - Interactive refactoring wizard
 */
export const refactorInteractiveCommand = new Command('interactive')
  .description('Interactive refactoring wizard for guided code improvements')
  .option('-s, --session <id>', 'Continue from existing session')
  .option('-p, --pattern <pattern>', 'Focus on specific pattern')
  .option('--complexity-threshold <number>', 'Minimum complexity threshold', '5')
  .option('--size-threshold <number>', 'Minimum size threshold (lines)', '20')
  .option('--limit <number>', 'Maximum opportunities to process', '10')
  .action(async (options: RefactorInteractiveOptions) => {
    const logger = new Logger();
    const spinner = ora({ color: 'cyan', text: 'Starting interactive refactoring...' });
    
    try {
      spinner.start();
      
      const configManager = new ConfigManager();
      const config = await configManager.load();
      
      if (!config.storage.path) {
        throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
      }
      
      const storage = new PGLiteStorageAdapter(config.storage.path);
      await storage.init();
      
      const analyzer = new RefactoringAnalyzer(storage);
      const sessionManager = new SessionManager(storage);
      
      spinner.stop();
      
      // Interactive workflow
      await runInteractiveRefactoringWizard(analyzer, sessionManager, options);
      
      await storage.close();
      
    } catch (error) {
      spinner.fail();
      logger.error('Interactive refactoring failed', error);
      process.exit(1);
    }
  });

/**
 * Main interactive refactoring wizard
 */
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

/**
 * Setup session and load existing opportunities
 */
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

/**
 * Load existing session by ID
 */
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

/**
 * Handle interactive session setup
 */
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

/**
 * Perform analysis if needed and link to session
 */
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

/**
 * Link opportunities to session
 */
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

/**
 * Select existing session
 */
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

/**
 * Create new session
 */
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

/**
 * Configure analysis parameters
 */
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

/**
 * Configure refactoring patterns
 */
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

/**
 * Get pattern selection choices
 */
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

/**
 * Configure analysis thresholds
 */
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

/**
 * Get custom thresholds from user input
 */
async function getCustomThresholds(options: RefactorInteractiveOptions): Promise<{
  complexityThreshold: number;
  sizeThreshold: number;
}> {
  const complexityInput = await prompts.number({
    message: 'Complexity threshold:',
    default: parseInt(options.complexityThreshold || '5')
  });
  
  const sizeInput = await prompts.number({
    message: 'Size threshold (lines):',
    default: parseInt(options.sizeThreshold || '20')
  });
  
  return {
    complexityThreshold: complexityInput ?? parseInt(options.complexityThreshold || '5'),
    sizeThreshold: sizeInput ?? parseInt(options.sizeThreshold || '20')
  };
}

/**
 * Get default thresholds
 */
function getDefaultThresholds(options: RefactorInteractiveOptions): {
  complexityThreshold: number;
  sizeThreshold: number;
} {
  return {
    complexityThreshold: parseInt(options.complexityThreshold || '5'),
    sizeThreshold: parseInt(options.sizeThreshold || '20')
  };
}

/**
 * Review opportunities interactively
 */
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

/**
 * Show detailed information about an opportunity
 */
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

/**
 * Get refactoring suggestions based on pattern
 */
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

/**
 * Show final summary and next steps
 */
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