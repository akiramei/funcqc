/**
 * Interactive Session Prompts
 * 
 * Provides interactive prompting functions for session management,
 * analysis configuration, and user input in refactor commands.
 */

import chalk from 'chalk';
import * as prompts from '@inquirer/prompts';
import { 
  RefactoringSession, 
  RefactoringPattern, 
  RefactorInteractiveOptions,
  RefactoringOpportunity 
} from '../../../../types/index.js';
import { SessionManager } from '../../../../refactoring/session-manager-simple.js';
import { parsePattern } from '../../../../utils/refactoring-utils.js';

// ============================================
// SESSION MANAGEMENT PROMPTS
// ============================================

/**
 * Select or create a refactoring session
 */
export async function selectExistingSession(sessionManager: SessionManager): Promise<RefactoringSession | null> {
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
 * Create a new refactoring session with user input
 */
export async function createNewSession(sessionManager: SessionManager): Promise<RefactoringSession | null> {
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

// ============================================
// ANALYSIS CONFIGURATION PROMPTS
// ============================================

/**
 * Configure analysis options interactively
 */
export async function configureAnalysis(options: RefactorInteractiveOptions): Promise<{
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
 * Get available pattern choices for selection
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
 * Configure detection thresholds
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
    message: 'Size threshold (lines of code):',
    default: safeDefaultSize
  });
  
  return {
    complexityThreshold: complexityInput ?? safeDefaultComplexity,
    sizeThreshold: sizeInput ?? safeDefaultSize
  };
}

/**
 * Get default thresholds based on options
 */
function getDefaultThresholds(options: RefactorInteractiveOptions): {
  complexityThreshold: number;
  sizeThreshold: number;
} {
  const defaultComplexity = parseInt(options.complexityThreshold || '5');
  const safeDefaultComplexity = Number.isNaN(defaultComplexity) ? 5 : defaultComplexity;
  
  const defaultSize = parseInt(options.sizeThreshold || '20');
  const safeDefaultSize = Number.isNaN(defaultSize) ? 20 : defaultSize;
  
  return {
    complexityThreshold: safeDefaultComplexity,
    sizeThreshold: safeDefaultSize
  };
}

// ============================================
// OPPORTUNITY SELECTION PROMPTS
// ============================================

/**
 * Interactive opportunity selection
 */
export async function selectOpportunities(opportunities: RefactoringOpportunity[]): Promise<RefactoringOpportunity[]> {
  if (opportunities.length === 0) {
    console.log(chalk.yellow('No refactoring opportunities found.'));
    return [];
  }
  
  console.log(`\n${chalk.blue.bold('🎯 Found Opportunities:')}`);
  opportunities.slice(0, 10).forEach((opp, index) => {
    console.log(`   ${index + 1}. ${opp.pattern} (Score: ${opp.impact_score}) - ${opp.function_id}`);
  });
  
  const selection = await prompts.select({
    message: 'How would you like to proceed?',
    choices: [
      { name: 'Review all opportunities', value: 'all' },
      { name: 'Select specific opportunities', value: 'select' },
      { name: 'Focus on highest impact', value: 'top' },
      { name: 'Skip for now', value: 'skip' }
    ]
  });
  
  switch (selection) {
    case 'all':
      return opportunities;
    case 'select':
      return await selectSpecificOpportunities(opportunities);
    case 'top':
      return opportunities.slice(0, 5);
    default:
      return [];
  }
}

/**
 * Select specific opportunities with checkboxes
 */
async function selectSpecificOpportunities(opportunities: RefactoringOpportunity[]): Promise<RefactoringOpportunity[]> {
  const choices = opportunities.slice(0, 15).map((opp, index) => ({
    name: `${opp.pattern} - ${opp.function_id} (Score: ${opp.impact_score})`,
    value: index,
    checked: opp.impact_score > 7 // Auto-select high impact
  }));
  
  const selectedIndices = await prompts.checkbox({
    message: 'Select opportunities to include:',
    choices
  });
  
  return selectedIndices.map(index => opportunities[index]);
}

// ============================================
// CONFIRMATION PROMPTS
// ============================================

/**
 * Confirm session creation with summary
 */
export async function confirmSessionCreation(
  selectedOpportunities: RefactoringOpportunity[],
  sessionName?: string
): Promise<boolean> {
  console.log(`\n${chalk.blue.bold('📋 Session Summary:')}`);
  console.log(`   Name: ${chalk.yellow(sessionName || 'New Session')}`);
  console.log(`   Opportunities: ${chalk.yellow(selectedOpportunities.length)}`);
  console.log(`   Estimated Effort: ${chalk.yellow(Math.ceil(selectedOpportunities.length * 1.5))} hours`);
  
  return await prompts.confirm({
    message: 'Create this refactoring session?',
    default: true
  });
}

/**
 * Confirm continue with existing session
 */
export async function confirmContinueSession(session: RefactoringSession): Promise<boolean> {
  console.log(`\n${chalk.blue.bold('📋 Continuing Session:')}`);
  console.log(`   Name: ${chalk.yellow(session.name)}`);
  console.log(`   Status: ${chalk.yellow(session.status)}`);
  console.log(`   Created: ${chalk.gray(new Date(session.created_at).toLocaleDateString())}`);
  
  return await prompts.confirm({
    message: 'Continue with this session?',
    default: true
  });
}