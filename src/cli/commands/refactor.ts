/**
 * Refactor Command Router
 * 
 * Simplified main router that delegates to modular command handlers.
 * This file has been refactored from a 3500+ line monolith into a clean,
 * maintainable structure using extracted modules.
 */

import chalk from 'chalk';
import { 
  RefactorAnalyzeOptions, 
  RefactorDetectOptions,
  RefactorInteractiveOptions,
  RefactorPlanOptions,
  RefactorStatusOptions,
  RefactoringSession,
  CommandOptions
} from '../../types/index.js';
import { RefactoringAnalyzer } from '../../refactoring/refactoring-analyzer.js';
import { SessionManager } from '../../refactoring/session-manager-simple.js';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler.js';
import { VoidCommand } from '../../types/command.js';
import { CommandEnvironment } from '../../types/environment.js';
import { DatabaseError } from '../../storage/pglite-adapter.js';

// Import extracted handlers
import { 
  refactorAnalyzeCommandImpl,
  refactorDetectCommandImpl,
  refactorSnapshotCommandImpl
} from './refactor/handlers/index.js';

// Import utilities
import { 
  handleSessionCreation,
  handleSessionUpdate,
  handleSessionListing,
  handleSessionDeletion,
  linkOpportunitiesToSession
} from './refactor/utils/session-utils.js';

import {
  selectExistingSession,
  configureAnalysis,
  selectOpportunities,
  confirmSessionCreation,
  confirmContinueSession
} from './refactor/interactive/session-prompts.js';

import {
  displayAnalysisReport
} from './refactor/utils/report-generator.js';

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
          case 'verify':
            await refactorVerifyCommandImpl(args[0] || '', options as RefactorTrackOptions, env);
            break;
          case 'snapshot':
            await refactorSnapshotCommandImpl(args[0] || 'create', args.slice(1), options, env);
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
// REMAINING COMMAND IMPLEMENTATIONS
// ========================================
// Note: These will be extracted to separate handler files as well

async function refactorInteractiveCommandImpl(
  options: RefactorInteractiveOptions,
  env: CommandEnvironment
): Promise<void> {
  env.commandLogger.info('Starting interactive refactoring session...');
  
  try {
    const sessionManager = new SessionManager(env.storage);
    const analyzer = new RefactoringAnalyzer(env.storage);
    
    console.log(chalk.blue.bold('🎯 Interactive Refactoring Session\n'));
    
    // Session selection/creation
    let currentSession: RefactoringSession | null = null;
    
    if (options.session) {
      currentSession = await sessionManager.getSession(options.session);
      if (!currentSession) {
        console.log(chalk.red(`Session not found: ${options.session}`));
        return;
      }
      
      const shouldContinue = await confirmContinueSession(currentSession);
      if (!shouldContinue) {
        console.log(chalk.yellow('Session cancelled.'));
        return;
      }
    } else {
      currentSession = await selectExistingSession(sessionManager);
      if (!currentSession) {
        console.log(chalk.red('No session selected. Exiting.'));
        return;
      }
    }
    
    // Configuration
    const config = await configureAnalysis(options);
    
    // Analysis
    console.log(chalk.blue('🔍 Analyzing opportunities...'));
    const report = await analyzer.analyzeProject(config);
    
    // Opportunity selection
    const selectedOpportunities = await selectOpportunities(report.opportunities);
    
    if (selectedOpportunities.length === 0) {
      console.log(chalk.yellow('No opportunities selected. Session unchanged.'));
      return;
    }
    
    // Confirmation and session update
    const shouldCreate = await confirmSessionCreation(selectedOpportunities, currentSession.name);
    if (shouldCreate) {
      await linkOpportunitiesToSession(sessionManager, currentSession, selectedOpportunities);
      console.log(chalk.green(`✅ Updated session with ${selectedOpportunities.length} opportunities`));
    } else {
      console.log(chalk.yellow('Session update cancelled.'));
    }
    
  } catch (error) {
    env.commandLogger.error('Interactive session failed', error);
    process.exit(1);
  }
}

async function refactorPlanCommandImpl(
  options: RefactorPlanOptions,
  env: CommandEnvironment
): Promise<void> {
  env.commandLogger.info('Generating refactoring plan...');
  
  try {
    const sessionManager = new SessionManager(env.storage);
    
    if (options.session) {
      // Generate plan for specific session
      const session = await sessionManager.getSession(options.session);
      if (!session) {
        console.log(chalk.red(`Session not found: ${options.session}`));
        return;
      }
      
      console.log(chalk.blue.bold(`📋 Refactoring Plan: ${session.name}\n`));
      // TODO: Implement session-specific plan generation
      console.log('Session-specific planning not yet implemented');
    } else {
      // Generate general project plan
      const analyzer = new RefactoringAnalyzer(env.storage);
      const report = await analyzer.analyzeProject({});
      
      console.log(chalk.blue.bold('📋 Project Refactoring Plan\n'));
      displayAnalysisReport(report, 'detailed');
    }
    
  } catch (error) {
    env.commandLogger.error('Plan generation failed', error);
    process.exit(1);
  }
}

async function refactorStatusCommandImpl(
  options: RefactorStatusOptions,
  env: CommandEnvironment
): Promise<void> {
  try {
    const sessionManager = new SessionManager(env.storage);
    
    if (options.session) {
      // Show specific session status
      const session = await sessionManager.getSession(options.session);
      if (!session) {
        console.log(chalk.red(`Session not found: ${options.session}`));
        return;
      }
      
      // TODO: Show detailed session status
      console.log(`Session status for ${session.id} not yet implemented`);
    } else {
      // Show general status
      await handleSessionListing(sessionManager, { json: options.json } as RefactorTrackOptions);
    }
    
  } catch (error) {
    env.commandLogger.error('Status check failed', error);
    process.exit(1);
  }
}

async function refactorTrackCommandImpl(
  action: string,
  args: string[],
  options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  const sessionManager = new SessionManager(env.storage);
  
  try {
    switch (action) {
      case 'create':
        await handleSessionCreation(sessionManager, options, args);
        break;
      case 'list':
        await handleSessionListing(sessionManager, options);
        break;
      case 'update':
        if (!args[0]) {
          console.log(chalk.red('Session ID required for update'));
          return;
        }
        await handleSessionUpdate(sessionManager, args[0], options);
        break;
      case 'delete':
        if (!args[0]) {
          console.log(chalk.red('Session ID required for delete'));
          return;
        }
        await handleSessionDeletion(sessionManager, args[0], options);
        break;
      default:
        console.log(chalk.red(`Unknown track action: ${action}`));
        console.log('Available actions: create, list, update, delete');
    }
  } catch (error) {
    env.commandLogger.error(`Track ${action} failed`, error);
    throw error;
  }
}

async function refactorAssessCommandImpl(
  sessionId: string,
  _options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  try {
    env.commandLogger.info(`Assessing refactoring session: ${sessionId}`);
    
    // TODO: Import and use ChangesetEvaluator
    console.log('Assessment functionality is being implemented in separate modules');
    console.log(`Session ${sessionId} assessment will be available after Phase 3 integration`);
    
  } catch (error) {
    env.commandLogger.error('Assessment failed', error);
    throw error;
  }
}

async function refactorVerifyCommandImpl(
  sessionId: string,
  _options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  try {
    env.commandLogger.info(`Verifying refactoring session: ${sessionId}`);
    
    // TODO: Import and use verification utilities
    console.log('Verification functionality is being implemented in separate modules');
    console.log(`Session ${sessionId} verification will be available after Phase 3 integration`);
    
  } catch (error) {
    env.commandLogger.error('Verification failed', error);
    throw error;
  }
}