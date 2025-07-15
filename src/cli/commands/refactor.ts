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
  RefactorHealthGuidedOptions,
  RefactoringSession,
  CommandOptions
} from '../../types/index';
import { RefactoringAnalyzer } from '../../refactoring/refactoring-analyzer';
import { SessionManager } from '../../refactoring/session-manager-simple';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';

// Import extracted handlers
import { 
  refactorAnalyzeCommandImpl,
  refactorDetectCommandImpl,
  refactorSnapshotCommandImpl
} from './refactor/handlers/index';

// Import health-guided handlers
import { 
  healthGuidedAnalyze,
  healthGuidedPrompt,
  applyRefactoringPlan
} from './refactor/handlers/health-guided';

// Import RefactoringValidator for health engine integration
import { createRefactoringValidator } from '../../utils/refactoring-validation.js';

// Import utilities
import { 
  handleSessionCreation,
  handleSessionUpdate,
  handleSessionListing,
  handleSessionDeletion,
  linkOpportunitiesToSession
} from './refactor/utils/session-utils';

import {
  selectExistingSession,
  configureAnalysis,
  selectOpportunities,
  confirmSessionCreation,
  confirmContinueSession
} from './refactor/interactive/session-prompts';

import {
  displayAnalysisReport
} from './refactor/utils/report-generator';

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
  force?: boolean;
  session?: string; // For specifying session ID in lineage operations
}

// Union type for all possible refactor command options
type RefactorCommandOptions = 
  | RefactorAnalyzeOptions
  | RefactorDetectOptions
  | RefactorInteractiveOptions
  | RefactorPlanOptions
  | RefactorStatusOptions
  | RefactorTrackOptions
  | RefactorHealthGuidedOptions;

// ========================================
// MAIN COMMAND ROUTER
// ========================================

/**
 * Main refactor command router that handles all subcommands
 */
export const refactorCommand = (subcommand: string, args: string[] = []): VoidCommand<RefactorCommandOptions> =>
  (options: RefactorCommandOptions) =>
    async (env: CommandEnvironment): Promise<void> => {
      const errorHandler = createErrorHandler(env.commandLogger);

      try {
        await executeRefactorSubcommand(subcommand, args, options, env);
      } catch (error) {
        handleRefactorError(error, subcommand, args, errorHandler);
      }
    };

/**
 * Execute the appropriate refactor subcommand
 */
async function executeRefactorSubcommand(
  subcommand: string,
  args: string[],
  options: RefactorCommandOptions,
  env: CommandEnvironment
): Promise<void> {
  const commandHandler = getRefactorCommandHandler(subcommand);
  if (!commandHandler) {
    throw new Error(`Unknown refactor subcommand: ${subcommand}`);
  }
  
  await commandHandler(args, options, env);
}

/**
 * Get the appropriate command handler for a subcommand
 */
function getRefactorCommandHandler(
  subcommand: string
): ((args: string[], options: RefactorCommandOptions, env: CommandEnvironment) => Promise<void>) | null {
  const commandMap: Record<string, (args: string[], options: RefactorCommandOptions, env: CommandEnvironment) => Promise<void>> = {
    analyze: async (_args, options, env) => 
      await refactorAnalyzeCommandImpl(options as RefactorAnalyzeOptions, env),
    detect: async (_args, options, env) => 
      await refactorDetectCommandImpl(options as RefactorDetectOptions, env),
    interactive: async (_args, options, env) => 
      await refactorInteractiveCommandImpl(options as RefactorInteractiveOptions, env),
    plan: async (_args, options, env) => 
      await refactorPlanCommandImpl(options as RefactorPlanOptions, env),
    status: async (_args, options, env) => 
      await refactorStatusCommandImpl(options as RefactorStatusOptions, env),
    track: async (args, options, env) => 
      await refactorTrackCommandImpl(args[0] || '', args.slice(1), options as RefactorTrackOptions, env),
    assess: async (args, options, env) => 
      await refactorAssessCommandImpl(args[0] || '', options as RefactorTrackOptions, env),
    verify: async (args, options, env) => 
      await refactorVerifyCommandImpl(args[0] || '', options as RefactorTrackOptions, env),
    snapshot: async (args, options, env) => 
      await refactorSnapshotCommandImpl(args[0] || 'create', args.slice(1), options as Record<string, unknown>, env),
    'health-analyze': async (_args, options, env) => 
      await healthGuidedAnalyze(options as RefactorHealthGuidedOptions, env),
    'health-prompt': async (args, options, env) => 
      await healthGuidedPrompt(args[0] || '', options as RefactorHealthGuidedOptions, env),
    'health-apply': async (args, options, env) => 
      await applyRefactoringPlan(args[0] || '', options as RefactorHealthGuidedOptions, env)
  };
  
  return commandMap[subcommand] ?? null;
}

/**
 * Handle errors from refactor command execution
 */
function handleRefactorError(
  error: unknown,
  subcommand: string,
  args: string[],
  errorHandler: ReturnType<typeof createErrorHandler>
): void {
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
  options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  const errorHandler = createErrorHandler(env.commandLogger);
  
  try {
    env.commandLogger.info(`Assessing refactoring session: ${sessionId}`);
    
    const sessionManager = new SessionManager(env.storage);
    
    // Get session details
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      console.log(chalk.red(`❌ Session not found: ${sessionId}`));
      return;
    }
    
    console.log(chalk.cyan(`\n🔍 Assessing Refactoring Session: ${session.name}`));
    console.log(chalk.gray(`Session ID: ${sessionId}`));
    console.log(chalk.gray(`Description: ${session.description || 'No description'}`));
    
    // Get session changesets from storage
    const changesets = await env.storage.getRefactoringChangesetsBySession(sessionId);
    
    if (changesets.length === 0) {
      console.log(chalk.yellow('\n⚠️  No changesets found for this session.'));
      console.log(chalk.gray('This session may not have been through the health validation process yet.'));
      return;
    }
    
    console.log(chalk.blue(`\n📊 Found ${changesets.length} changeset(s) to assess:\n`));
    
    let genuineCount = 0;
    let fakeCount = 0;
    
    for (let i = 0; i < changesets.length; i++) {
      const changeset = changesets[i];
      console.log(chalk.cyan(`--- Changeset ${i + 1}/${changesets.length} ---`));
      console.log(`Operation: ${changeset.operationType} (${changeset.intent})`);
      console.log(`Parent Function: ${changeset.parentFunctionId}`);
      console.log(`Child Functions: ${changeset.childFunctionIds.length}`);
      
      if (changeset.improvementMetrics) {
        const metrics = changeset.improvementMetrics;
        console.log(`\n📈 Improvement Metrics:`);
        console.log(`  Complexity Reduction: ${metrics.complexityReduction}`);
        console.log(`  Risk Improvement: ${metrics.riskImprovement.toFixed(2)}`);
        console.log(`  Maintainability Gain: ${metrics.maintainabilityGain.toFixed(2)}`);
        console.log(`  Function Explosion Score: ${metrics.functionExplosionScore.toFixed(2)}`);
        console.log(`  Overall Grade: ${metrics.overallGrade}`);
        
        const genuineIcon = metrics.isGenuine ? '✅' : '❌';
        const genuineText = metrics.isGenuine ? 'GENUINE' : 'FAKE';
        const genuineColor = metrics.isGenuine ? chalk.green : chalk.red;
        console.log(`\n${genuineIcon} Assessment: ${genuineColor(genuineText)} improvement`);
        
        if (metrics.isGenuine) {
          genuineCount++;
        } else {
          fakeCount++;
        }
      } else {
        console.log(chalk.yellow('\n⚠️  No metrics available for this changeset'));
      }
      
      console.log(''); // Empty line between changesets
    }
    
    // Summary
    console.log(chalk.cyan('\n📋 Assessment Summary'));
    console.log(chalk.gray('='.repeat(40)));
    console.log(`Session: ${chalk.blue(session.name)}`);
    console.log(`Total Changesets: ${changesets.length}`);
    console.log(`Genuine Improvements: ${chalk.green(genuineCount)}`);
    console.log(`Fake Improvements: ${chalk.red(fakeCount)}`);
    
    const successRate = changesets.length > 0 ? ((genuineCount / changesets.length) * 100).toFixed(1) : '0';
    console.log(`Success Rate: ${successRate}%`);
    
    if (options.json) {
      console.log('\n' + JSON.stringify({
        sessionId,
        sessionName: session.name,
        totalChangesets: changesets.length,
        genuineImprovements: genuineCount,
        fakeImprovements: fakeCount,
        successRate: parseFloat(successRate),
        changesets: changesets.map(cs => ({
          id: cs.id,
          operationType: cs.operationType,
          intent: cs.intent,
          isGenuine: cs.improvementMetrics?.isGenuine || false,
          overallGrade: cs.improvementMetrics?.overallGrade || 'F'
        }))
      }, null, 2));
    }
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Session assessment failed: ${error instanceof Error ? error.message : String(error)}`,
      { sessionId },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

async function refactorVerifyCommandImpl(
  sessionId: string,
  options: RefactorTrackOptions,
  env: CommandEnvironment
): Promise<void> {
  const errorHandler = createErrorHandler(env.commandLogger);
  
  try {
    env.commandLogger.info(`Verifying refactoring session: ${sessionId}`);
    
    // Create validator for refactoring health verification
    const validator = createRefactoringValidator(env);
    const sessionManager = new SessionManager(env.storage);
    
    // Get session details
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      console.log(chalk.red(`❌ Session not found: ${sessionId}`));
      return;
    }
    
    console.log(chalk.cyan(`\n🔬 Verifying Refactoring Session: ${session.name}`));
    console.log(chalk.gray(`Session ID: ${sessionId}`));
    
    // Get session changesets
    const changesets = await env.storage.getRefactoringChangesetsBySession(sessionId);
    
    if (changesets.length === 0) {
      console.log(chalk.yellow('\n⚠️  No changesets found for verification.'));
      console.log(chalk.gray('Run the session through health validation first.'));
      return;
    }
    
    console.log(chalk.blue(`\n🔍 Verifying ${changesets.length} changeset(s)...\n`));
    
    let verificationsPassed = 0;
    let verificationsFailed = 0;
    const failedChangesets: string[] = [];
    
    for (let i = 0; i < changesets.length; i++) {
      const changeset = changesets[i];
      console.log(chalk.cyan(`🧪 Verification ${i + 1}/${changesets.length}: ${changeset.operationType} (${changeset.intent})`));
      
      try {
        // Skip verification if parent function ID is missing
        if (!changeset.parentFunctionId) {
          console.log(chalk.yellow(`   ⚠️  Skipped: Missing parent function ID`));
          continue;
        }
        
        // Re-evaluate the changeset to verify current assessment
        const operation = {
          type: changeset.operationType as 'split' | 'extract' | 'merge' | 'rename',
          intent: changeset.intent,
          parentFunction: changeset.parentFunctionId,
          childFunctions: changeset.childFunctionIds,
          context: {
            sessionId: changeset.sessionId,
            description: `Verification of changeset ${changeset.id}`,
            beforeSnapshot: changeset.beforeSnapshotId,
            afterSnapshot: changeset.afterSnapshotId,
            targetBranch: 'main',
          },
        };
        
        const validationResult = await validator.validateRefactoring(
          operation,
          changeset.beforeSnapshotId,
          changeset.afterSnapshotId
        );
        
        // Compare with stored assessment
        const storedIsGenuine = changeset.improvementMetrics?.isGenuine || false;
        const currentIsGenuine = validationResult.isGenuine;
        
        if (storedIsGenuine === currentIsGenuine) {
          console.log(chalk.green(`   ✅ Verified: Assessment consistent (${currentIsGenuine ? 'genuine' : 'fake'})`));
          verificationsPassed++;
        } else {
          console.log(chalk.red(`   ❌ Inconsistent: Stored=${storedIsGenuine}, Current=${currentIsGenuine}`));
          verificationsFailed++;
          failedChangesets.push(changeset.id);
        }
        
        if (options.json) {
          console.log(`   Current metrics: Explosion=${validationResult.functionExplosionScore.toFixed(2)}, Grade=${validationResult.overallGrade}`);
        }
        
      } catch (verifyError) {
        console.log(chalk.red(`   ❌ Verification error: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`));
        verificationsFailed++;
        failedChangesets.push(changeset.id);
      }
    }
    
    // Verification summary
    console.log(chalk.cyan('\n📋 Verification Summary'));
    console.log(chalk.gray('='.repeat(40)));
    console.log(`Session: ${chalk.blue(session.name)}`);
    console.log(`Verifications Passed: ${chalk.green(verificationsPassed)}`);
    console.log(`Verifications Failed: ${chalk.red(verificationsFailed)}`);
    
    if (failedChangesets.length > 0) {
      console.log(`\nFailed Changesets:`);
      failedChangesets.forEach(id => console.log(`  • ${id}`));
    }
    
    const verificationRate = changesets.length > 0 ? ((verificationsPassed / changesets.length) * 100).toFixed(1) : '0';
    console.log(`Verification Rate: ${verificationRate}%`);
    
    if (options.json) {
      console.log('\n' + JSON.stringify({
        sessionId,
        sessionName: session.name,
        totalChangesets: changesets.length,
        verificationsPassed,
        verificationsFailed,
        verificationRate: parseFloat(verificationRate),
        failedChangesets
      }, null, 2));
    }
    
    // Recommendations
    if (verificationsFailed > 0) {
      console.log(chalk.yellow('\n💡 Recommendations:'));
      console.log(chalk.gray('  • Review failed changesets for configuration changes'));
      console.log(chalk.gray('  • Check if thresholds.yaml has been modified'));
      console.log(chalk.gray('  • Consider re-running health validation for failed changesets'));
    }
    
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Session verification failed: ${error instanceof Error ? error.message : String(error)}`,
      { sessionId },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}