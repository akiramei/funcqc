import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { ConfigManager } from '../../core/config.js';
import { PGLiteStorageAdapter } from '../../storage/pglite-adapter.js';
import { Logger } from '../../utils/cli-utils.js';
import { RefactoringSession, SessionFunction } from '../../types/index.js';
import { SessionManager, SessionSummary } from '../../refactoring/session-manager-simple.js';
import { formatPatternName } from '../../utils/refactoring-utils.js';
import * as prompts from '@inquirer/prompts';

/**
 * Phase 3 Week 2: funcqc refactor track - Session management and progress tracking
 */
export const refactorTrackCommand = new Command('track')
  .description('Track refactoring sessions and progress')
  .addCommand(createTrackListCommand())
  .addCommand(createTrackShowCommand())
  .addCommand(createTrackCreateCommand())
  .addCommand(createTrackUpdateCommand())
  .addCommand(createTrackCompleteCommand())
  .addCommand(createTrackCancelCommand());

/**
 * List active refactoring sessions
 */
function createTrackListCommand(): Command {
  return new Command('list')
    .description('List active refactoring sessions')
    .option('--all', 'Show all sessions including completed and cancelled')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const logger = new Logger();
      const spinner = ora({ color: 'cyan', text: 'Loading sessions...' });
      
      try {
        spinner.start();
        
        const configManager = new ConfigManager();
        const config = await configManager.load();
        
        if (!config.storage.path) {
          throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
        }
        
        const storage = new PGLiteStorageAdapter(config.storage.path);
        await storage.init();
        
        const sessionManager = new SessionManager(storage);
        
        let sessions: RefactoringSession[];
        if (options.all) {
          const db = storage.getDb();
          sessions = await db
            .selectFrom('refactoring_sessions')
            .selectAll()
            .orderBy('created_at', 'desc')
            .execute() as RefactoringSession[];
        } else {
          sessions = await sessionManager.getActiveSessions();
        }
        
        spinner.succeed();
        
        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else {
          displaySessionList(sessions, options.all);
        }
        
        await storage.close();
        
      } catch (error) {
        spinner.fail();
        logger.error('Failed to list sessions', error);
        process.exit(1);
      }
    });
}

/**
 * Show details of a specific session
 */
function createTrackShowCommand(): Command {
  return new Command('show')
    .description('Show details of a refactoring session')
    .argument('<sessionId>', 'Session ID to show')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, options) => {
      const logger = new Logger();
      const spinner = ora({ color: 'cyan', text: 'Loading session details...' });
      
      try {
        spinner.start();
        
        const configManager = new ConfigManager();
        const config = await configManager.load();
        
        if (!config.storage.path) {
          throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
        }
        
        const storage = new PGLiteStorageAdapter(config.storage.path);
        await storage.init();
        
        const sessionManager = new SessionManager(storage);
        
        const session = await sessionManager.getSession(sessionId);
        if (!session) {
          spinner.fail();
          console.error(chalk.red(`Session ${sessionId} not found`));
          process.exit(1);
        }
        
        const summary = await sessionManager.getSessionSummary(sessionId);
        const functions = await sessionManager.getSessionFunctions(sessionId);
        
        spinner.succeed();
        
        if (options.json) {
          console.log(JSON.stringify({
            session,
            summary,
            functions
          }, null, 2));
        } else {
          displaySessionDetails(session, summary, functions);
        }
        
        await storage.close();
        
      } catch (error) {
        spinner.fail();
        logger.error('Failed to show session', error);
        process.exit(1);
      }
    });
}

/**
 * Create a new refactoring session
 */
function createTrackCreateCommand(): Command {
  return new Command('create')
    .description('Create a new refactoring session')
    .option('-n, --name <name>', 'Session name')
    .option('-d, --description <desc>', 'Session description')
    .option('-b, --branch <branch>', 'Target Git branch')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const logger = new Logger();
      const spinner = ora({ color: 'cyan', text: 'Creating session...' });
      
      try {
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
        
        spinner.start();
        
        const configManager = new ConfigManager();
        const config = await configManager.load();
        
        if (!config.storage.path) {
          throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
        }
        
        const storage = new PGLiteStorageAdapter(config.storage.path);
        await storage.init();
        
        const sessionManager = new SessionManager(storage);
        const session = await sessionManager.createSession(name, description, targetBranch);
        
        spinner.succeed('Session created successfully');
        
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
        
        await storage.close();
        
      } catch (error) {
        spinner.fail();
        logger.error('Failed to create session', error);
        process.exit(1);
      }
    });
}

/**
 * Update function status in a session
 */
function createTrackUpdateCommand(): Command {
  return new Command('update')
    .description('Update function status in a refactoring session')
    .argument('<sessionId>', 'Session ID')
    .argument('<functionId>', 'Function ID')
    .option('-s, --status <status>', 'New status (pending, in_progress, completed, skipped)')
    .option('-n, --notes <notes>', 'Add notes about the update')
    .option('--interactive', 'Interactive mode to update multiple functions')
    .action(async (sessionId: string, functionId: string, options) => {
      const logger = new Logger();
      const spinner = ora({ color: 'cyan', text: 'Updating function status...' });
      
      try {
        const configManager = new ConfigManager();
        const config = await configManager.load();
        
        if (!config.storage.path) {
          throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
        }
        
        const storage = new PGLiteStorageAdapter(config.storage.path);
        await storage.init();
        
        const sessionManager = new SessionManager(storage);
        
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
          
          spinner.start();
          await sessionManager.updateFunctionStatus(sessionId, functionId, status, options.notes);
          spinner.succeed(`Updated function ${functionId} to ${status}`);
        }
        
        await storage.close();
        
      } catch (error) {
        spinner.fail();
        logger.error('Failed to update function status', error);
        process.exit(1);
      }
    });
}

/**
 * Complete a refactoring session
 */
function createTrackCompleteCommand(): Command {
  return new Command('complete')
    .description('Complete a refactoring session')
    .argument('<sessionId>', 'Session ID to complete')
    .option('-s, --summary <summary>', 'Completion summary')
    .action(async (sessionId: string, options) => {
      const logger = new Logger();
      const spinner = ora({ color: 'cyan', text: 'Completing session...' });
      
      try {
        const configManager = new ConfigManager();
        const config = await configManager.load();
        
        if (!config.storage.path) {
          throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
        }
        
        const storage = new PGLiteStorageAdapter(config.storage.path);
        await storage.init();
        
        const sessionManager = new SessionManager(storage);
        
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
        
        spinner.start();
        await sessionManager.completeSession(sessionId, completionSummary);
        spinner.succeed('Session completed successfully');
        
        console.log(chalk.green.bold('\n✅ Refactoring Session Completed!'));
        
        await storage.close();
        
      } catch (error) {
        spinner.fail();
        logger.error('Failed to complete session', error);
        process.exit(1);
      }
    });
}

/**
 * Cancel a refactoring session
 */
function createTrackCancelCommand(): Command {
  return new Command('cancel')
    .description('Cancel a refactoring session')
    .argument('<sessionId>', 'Session ID to cancel')
    .option('-r, --reason <reason>', 'Cancellation reason')
    .action(async (sessionId: string, options) => {
      const logger = new Logger();
      const spinner = ora({ color: 'cyan', text: 'Cancelling session...' });
      
      try {
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
        
        spinner.start();
        
        const configManager = new ConfigManager();
        const config = await configManager.load();
        
        if (!config.storage.path) {
          throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
        }
        
        const storage = new PGLiteStorageAdapter(config.storage.path);
        await storage.init();
        
        const sessionManager = new SessionManager(storage);
        await sessionManager.cancelSession(sessionId, reason);
        
        spinner.succeed('Session cancelled');
        
        await storage.close();
        
      } catch (error) {
        spinner.fail();
        logger.error('Failed to cancel session', error);
        process.exit(1);
      }
    });
}

/**
 * Interactive update mode
 */
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

/**
 * Display session list
 */
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

/**
 * Display session details
 */
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