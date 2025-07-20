import { OptionValues } from 'commander';
import chalk from 'chalk';
import { Ora } from 'ora';
import ora from 'ora';
import * as readline from 'readline';
import { VoidCommand } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { SafeDeletionSystem, SafeDeletionOptions } from '../analyzers/safe-deletion-system';

interface SafeDeleteOptions extends OptionValues {
  confidenceThreshold?: string;
  maxBatch?: string;
  noTests?: boolean;
  noTypeCheck?: boolean;
  noBackup?: boolean;
  execute?: boolean;
  force?: boolean;
  dryRun?: boolean;
  includeExports?: boolean;
  exclude?: string[];
  format?: 'table' | 'json';
  verbose?: boolean;
  restore?: string;
}

/**
 * Safe deletion command using high-confidence call graph analysis
 */
export const safeDeleteCommand: VoidCommand<SafeDeleteOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora();

    try {
      // Handle restore operation
      if (options.restore) {
        await handleRestoreOperation(options.restore, spinner, env);
        return;
      }

      // Normal safe deletion analysis
      await performSafeDeletion(options, env, spinner);

    } catch (error) {
      spinner.fail('Safe deletion failed');
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  };

/**
 * Perform safe deletion analysis and execution
 */
async function performSafeDeletion(
  options: SafeDeleteOptions,
  env: CommandEnvironment,
  spinner: Ora
): Promise<void> {
  const snapshot = await loadLatestSnapshot(env, spinner);
  if (!snapshot) return;

  const functions = await loadFunctionsFromSnapshot(env, spinner, snapshot.id);
  if (!functions) return;

  const callEdges = await loadCallEdges(env, spinner, snapshot.id, options);
  const safeDeletionOptions = createSafeDeletionOptions(options);
  
  // Step 1: Always perform analysis first
  const result = await performAnalysis(functions, callEdges, safeDeletionOptions, spinner, env, snapshot.id);
  
  // Step 2: Show preview results
  outputResults(result, options);
  
  // Step 3: If --execute flag is provided and candidates exist, ask for confirmation
  if (options.execute && result.candidateFunctions.length > 0) {
    if (options.force) {
      console.log(chalk.yellow('\n⚠️  --force flag detected. Proceeding with deletion without confirmation.'));
      await executeActualDeletion(functions, callEdges, safeDeletionOptions, spinner, env, snapshot.id);
    } else {
      const confirmed = await promptForConfirmation(result);
      if (confirmed) {
        await executeActualDeletion(functions, callEdges, safeDeletionOptions, spinner, env, snapshot.id);
      } else {
        console.log(chalk.cyan('\n✅ Deletion cancelled. No files were modified.'));
      }
    }
  } else if (!options.execute && result.candidateFunctions.length > 0) {
    console.log(chalk.dim('\n💡 This was a preview. Use --execute flag to perform actual deletion.'));
  }
}

/**
 * Load the latest snapshot with validation
 */
async function loadLatestSnapshot(
  env: CommandEnvironment,
  spinner: Ora
): Promise<import('../types').SnapshotInfo | null> {
  spinner.start('Loading latest analysis results...');
  
  const snapshot = await env.storage.getLatestSnapshot();
  if (!snapshot) {
    spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return null;
  }
  
  return snapshot;
}

/**
 * Load functions from snapshot with validation
 */
async function loadFunctionsFromSnapshot(
  env: CommandEnvironment,
  spinner: Ora,
  snapshotId: string
): Promise<import('../types').FunctionInfo[] | null> {
  spinner.text = 'Loading functions...';
  
  const functions = await env.storage.getFunctionsBySnapshot(snapshotId);
  if (functions.length === 0) {
    spinner.fail(chalk.yellow('No functions found in the latest snapshot.'));
    return null;
  }
  
  console.log(`\n📊 Found ${functions.length} functions in snapshot ${snapshotId}`);
  return functions;
}

/**
 * Load call edges with timeout and filtering
 */
async function loadCallEdges(
  env: CommandEnvironment,
  spinner: Ora,
  snapshotId: string,
  options: SafeDeleteOptions
): Promise<import('../types').CallEdge[]> {
  spinner.text = 'Loading call edges...';
  
  try {
    const callEdges = await Promise.race([
      env.storage.getCallEdgesBySnapshot(snapshotId),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Call edge query timeout after 30 seconds')), 30000)
      )
    ]);
    
    console.log(`📊 Found ${callEdges.length} call edges`);
    return filterHighConfidenceEdges(callEdges, options);
    
  } catch (error) {
    console.warn(`⚠️  Failed to load call edges: ${error}. Proceeding with basic analysis...`);
    return [];
  }
}

/**
 * Filter call edges for high confidence only
 */
function filterHighConfidenceEdges(
  callEdges: import('../types').CallEdge[],
  options: SafeDeleteOptions
): import('../types').CallEdge[] {
  const threshold = parseFloat(options.confidenceThreshold || '0.95');
  const highConfidenceEdges = callEdges.filter(edge => {
    return edge.confidenceScore && edge.confidenceScore >= threshold;
  });
  
  console.log(`📊 Found ${highConfidenceEdges.length} high-confidence call edges`);
  return highConfidenceEdges;
}

/**
 * Create safe deletion options from CLI options
 */
function createSafeDeletionOptions(options: SafeDeleteOptions): Partial<SafeDeletionOptions> {
  // Determine execution mode: preview-only by default, execute only with --execute flag
  const shouldExecute = options.execute || false;
  const dryRun = options.dryRun || !shouldExecute; // Default to dry-run unless --execute is specified
  
  const safeDeletionOptions: Partial<SafeDeletionOptions> = {
    confidenceThreshold: parseFloat(options.confidenceThreshold || '0.95'),
    maxFunctionsPerBatch: parseInt(options.maxBatch || '10'),
    createBackup: !options.noBackup,
    dryRun,
    excludeExports: !options.includeExports,
    excludePatterns: options.exclude || ['**/node_modules/**', '**/dist/**', '**/build/**']
  };
  
  const mode = dryRun ? 'preview-only' : 'execute';
  console.log(`🔧 Configuration: mode=${mode}, backup=${safeDeletionOptions.createBackup}, execute=${shouldExecute}`);
  return safeDeletionOptions;
}

/**
 * Perform the actual safe deletion analysis (preview mode)
 */
async function performAnalysis(
  functions: import('../types').FunctionInfo[],
  callEdges: import('../types').CallEdge[],
  safeDeletionOptions: Partial<SafeDeletionOptions>,
  spinner: Ora,
  env?: CommandEnvironment,
  snapshotId?: string
): Promise<import('../analyzers/safe-deletion-system').SafeDeletionResult> {
  spinner.text = 'Analyzing functions for safe deletion...';
  
  const safeDeletionSystem = new SafeDeletionSystem(env?.commandLogger);
  
  // Force dry-run for analysis phase
  const analysisOptions = { 
    ...safeDeletionOptions, 
    dryRun: true,
    ...(env?.storage && { storage: env.storage }),
    ...(snapshotId && { snapshotId })
  };
  const result = await safeDeletionSystem.performSafeDeletion(
    functions,
    callEdges,
    analysisOptions
  );
  
  spinner.succeed('Safe deletion analysis completed');
  return result;
}

/**
 * Execute actual deletion after confirmation
 */
async function executeActualDeletion(
  functions: import('../types').FunctionInfo[],
  callEdges: import('../types').CallEdge[],
  safeDeletionOptions: Partial<SafeDeletionOptions>,
  spinner: Ora,
  env?: CommandEnvironment,
  snapshotId?: string
): Promise<void> {
  spinner.start('Executing safe deletion...');
  
  const safeDeletionSystem = new SafeDeletionSystem(env?.commandLogger);
  
  // Execute with actual deletion (dryRun: false)
  const executionOptions = { 
    ...safeDeletionOptions, 
    dryRun: false,
    ...(env?.storage && { storage: env.storage }),
    ...(snapshotId && { snapshotId })
  };
  const result = await safeDeletionSystem.performSafeDeletion(
    functions,
    callEdges,
    executionOptions
  );
  
  spinner.succeed('Safe deletion execution completed');
  
  // Show execution results
  console.log(chalk.bold('\n🎯 Execution Results\n'));
  outputSummarySection(result);
  outputValidationResults(result);
  outputErrorsAndWarnings(result);
  
  if (result.backupPath) {
    console.log(chalk.dim(`\n🔄 To restore deleted functions: funcqc safe-delete --restore "${result.backupPath}"`));
  }
}

/**
 * Prompt user for confirmation before actual deletion
 */
async function promptForConfirmation(result: import('../analyzers/safe-deletion-system').SafeDeletionResult): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const candidateCount = result.candidateFunctions.length;
    const totalLines = result.candidateFunctions.reduce((sum, c) => 
      sum + (c.functionInfo.endLine - c.functionInfo.startLine + 1), 0
    );
    
    console.log(chalk.yellow('\n⚠️  Confirmation Required'));
    console.log(`You are about to delete ${chalk.bold(candidateCount)} functions (${chalk.bold(totalLines)} lines of code).`);
    console.log(chalk.dim('This action cannot be undone without using the backup.'));
    
    rl.question('\nDo you want to proceed with the deletion? (y/N): ', (answer) => {
      rl.close();
      const confirmed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
      resolve(confirmed);
    });
  });
}

/**
 * Output results in the requested format
 */
function outputResults(
  result: import('../analyzers/safe-deletion-system').SafeDeletionResult,
  options: SafeDeleteOptions
): void {
  if (options.format === 'json') {
    outputSafeDeletionJSON(result);
  } else {
    outputSafeDeletionTable(result, options);
  }
}

/**
 * Handle backup restoration
 */
async function handleRestoreOperation(backupPath: string, spinner: Ora, env?: CommandEnvironment): Promise<void> {
  spinner.start('Restoring from backup...');

  try {
    const safeDeletionSystem = new SafeDeletionSystem(env?.commandLogger);
    await safeDeletionSystem.restoreFromBackup(backupPath);
    spinner.succeed('Backup restoration completed');
  } catch (error) {
    spinner.fail('Backup restoration failed');
    throw error;
  }
}

/**
 * Output results as JSON
 */
function outputSafeDeletionJSON(result: import('../analyzers/safe-deletion-system').SafeDeletionResult): void {
  const output = {
    summary: {
      candidates: result.candidateFunctions.length,
      deleted: result.deletedFunctions.length,
      skipped: result.skippedFunctions.length,
      errors: result.errors.length,
      warnings: result.warnings.length,
      backupPath: result.backupPath
    },
    preDeleteValidation: result.preDeleteValidation,
    postDeleteValidation: result.postDeleteValidation,
    candidates: result.candidateFunctions,
    deleted: result.deletedFunctions,
    skipped: result.skippedFunctions,
    errors: result.errors,
    warnings: result.warnings
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output results as formatted table
 */
function outputSafeDeletionTable(
  result: import('../analyzers/safe-deletion-system').SafeDeletionResult,
  options: SafeDeleteOptions
): void {
  console.log(chalk.bold('\n🛡️  Safe Deletion Analysis Results\n'));

  outputSummarySection(result);
  outputValidationResults(result);
  outputErrorsAndWarnings(result);
  
  if (result.candidateFunctions.length === 0) {
    console.log(chalk.green('\n✅ No functions identified for safe deletion'));
    return;
  }

  outputCandidatesSection(result, options);
  outputSummaryStatistics(result);
  outputActionableTips(result, options);
}

/**
 * Output summary section with counts and backup info
 */
function outputSummarySection(result: import('../analyzers/safe-deletion-system').SafeDeletionResult): void {
  const { candidateFunctions, deletedFunctions, skippedFunctions, errors, warnings } = result;
  
  console.log(`Candidates found:     ${chalk.cyan(candidateFunctions.length)}`);
  console.log(`Functions deleted:    ${chalk.green(deletedFunctions.length)}`);
  console.log(`Functions skipped:    ${chalk.yellow(skippedFunctions.length)}`);
  console.log(`Errors encountered:   ${chalk.red(errors.length)}`);
  console.log(`Warnings:            ${chalk.yellow(warnings.length)}`);

  if (result.backupPath) {
    console.log(`Backup created:      ${chalk.blue(result.backupPath)}`);
  }
}

/**
 * Output validation results section
 */
function outputValidationResults(result: import('../analyzers/safe-deletion-system').SafeDeletionResult): void {
  console.log('\n🔍 Validation Results:');
  console.log(`Pre-deletion:  TypeCheck: ${result.preDeleteValidation.typeCheckPassed ? '✅' : '❌'}, Tests: ${result.preDeleteValidation.testsPassed ? '✅' : '❌'}`);
  
  if (result.deletedFunctions.length > 0) {
    console.log(`Post-deletion: TypeCheck: ${result.postDeleteValidation.typeCheckPassed ? '✅' : '❌'}, Tests: ${result.postDeleteValidation.testsPassed ? '✅' : '❌'}`);
  }
}

/**
 * Output errors and warnings sections
 */
function outputErrorsAndWarnings(result: import('../analyzers/safe-deletion-system').SafeDeletionResult): void {
  if (result.errors.length > 0) {
    console.log(chalk.red('\n❌ Errors:'));
    result.errors.forEach(error => console.log(`  • ${error}`));
  }

  if (result.warnings.length > 0) {
    console.log(chalk.yellow('\n⚠️  Warnings:'));
    result.warnings.forEach(warning => console.log(`  • ${warning}`));
  }
}

/**
 * Output candidates section grouped by file
 */
function outputCandidatesSection(
  result: import('../analyzers/safe-deletion-system').SafeDeletionResult,
  options: SafeDeleteOptions
): void {
  console.log(chalk.bold('\n🎯 Deletion Candidates\n'));

  const candidatesByFile = groupCandidatesByFile(result.candidateFunctions);
  
  for (const [filePath, candidates] of candidatesByFile) {
    console.log(chalk.underline(filePath));
    
    for (const candidate of candidates) {
      outputCandidateInfo(candidate, result, options);
    }
    
    console.log(); // Empty line between files
  }
}

/**
 * Group candidates by file path
 */
function groupCandidatesByFile(candidates: import('../analyzers/safe-deletion-system').DeletionCandidate[]): Map<string, typeof candidates> {
  const candidatesByFile = new Map<string, typeof candidates>();
  
  for (const candidate of candidates) {
    const filePath = candidate.functionInfo.filePath;
    if (!candidatesByFile.has(filePath)) {
      candidatesByFile.set(filePath, []);
    }
    candidatesByFile.get(filePath)!.push(candidate);
  }
  
  return candidatesByFile;
}

/**
 * Output individual candidate function information
 */
function outputCandidateInfo(
  candidate: import('../analyzers/safe-deletion-system').DeletionCandidate,
  result: import('../analyzers/safe-deletion-system').SafeDeletionResult,
  options: SafeDeleteOptions
): void {
  const { functionInfo, reason, confidenceScore, estimatedImpact } = candidate;
  const location = `${functionInfo.startLine}-${functionInfo.endLine}`;
  const size = `${functionInfo.endLine - functionInfo.startLine + 1} lines`;

  const icon = getReasonIcon(reason);
  const nameColor = getConfidenceColor(confidenceScore, estimatedImpact);
  const status = getFunctionStatus(candidate, result);

  console.log(`  ${icon} ${nameColor(functionInfo.name)} ${chalk.gray(`(${location}, ${size})`)}${status}`);
  
  if (options.verbose) {
    outputVerboseInfo(candidate);
  }
}

/**
 * Get icon based on deletion reason
 */
function getReasonIcon(reason: string): string {
  switch (reason) {
    case 'unreachable': return '🚫';
    case 'no-high-confidence-callers': return '🔗';
    case 'isolated': return '🏝️';
    default: return '❓';
  }
}

/**
 * Get color based on confidence score and impact
 */
function getConfidenceColor(confidenceScore: number, estimatedImpact: string) {
  if (confidenceScore >= 0.95 && estimatedImpact === 'low') {
    return chalk.green;
  } else if (confidenceScore < 0.85 || estimatedImpact === 'high') {
    return chalk.red;
  }
  return chalk.yellow;
}

/**
 * Get function status (deleted/skipped)
 */
function getFunctionStatus(
  candidate: import('../analyzers/safe-deletion-system').DeletionCandidate,
  result: import('../analyzers/safe-deletion-system').SafeDeletionResult
): string {
  if (result.deletedFunctions.some(d => d.functionInfo.id === candidate.functionInfo.id)) {
    return chalk.green(' [DELETED]');
  }
  if (result.skippedFunctions.some(s => s.functionInfo.id === candidate.functionInfo.id)) {
    return chalk.yellow(' [SKIPPED]');
  }
  return '';
}

/**
 * Output verbose information for a candidate
 */
function outputVerboseInfo(candidate: import('../analyzers/safe-deletion-system').DeletionCandidate): void {
  console.log(chalk.gray(`     Reason: ${candidate.reason}`));
  console.log(chalk.gray(`     Confidence: ${(candidate.confidenceScore * 100).toFixed(1)}%`));
  console.log(chalk.gray(`     Callers: ${candidate.callersCount}`));
  console.log(chalk.gray(`     Impact: ${candidate.estimatedImpact}`));
}

/**
 * Output summary statistics section
 */
function outputSummaryStatistics(result: import('../analyzers/safe-deletion-system').SafeDeletionResult): void {
  const { candidateFunctions, deletedFunctions } = result;
  
  const totalLines = candidateFunctions.reduce((sum, c) => 
    sum + (c.functionInfo.endLine - c.functionInfo.startLine + 1), 0
  );
  const deletedLines = deletedFunctions.reduce((sum, c) => 
    sum + (c.functionInfo.endLine - c.functionInfo.startLine + 1), 0
  );

  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.bold(`Total candidates: ${candidateFunctions.length} functions, ${totalLines} lines`));
  
  if (deletedFunctions.length > 0) {
    console.log(chalk.bold(`Successfully deleted: ${deletedFunctions.length} functions, ${deletedLines} lines`));
  } else if (candidateFunctions.length > 0) {
    outputNoDeletionsInfo(result);
  }
}

/**
 * Output information when no functions were deleted despite having candidates
 */
function outputNoDeletionsInfo(result: import('../analyzers/safe-deletion-system').SafeDeletionResult): void {
  const skippedCount = result.skippedFunctions.length;
  console.log(chalk.yellow(`No functions deleted (${skippedCount} candidates skipped due to safety constraints)`));
  
  const confidenceDistribution = result.candidateFunctions.reduce((acc, candidate) => {
    const confidence = candidate.confidenceScore;
    if (confidence >= 0.95) acc.high++;
    else if (confidence >= 0.85) acc.medium++;
    else acc.low++;
    return acc;
  }, { high: 0, medium: 0, low: 0 });
  
  console.log(chalk.dim(`   Confidence distribution: ${confidenceDistribution.high} high (≥95%), ${confidenceDistribution.medium} medium (≥85%), ${confidenceDistribution.low} low (<85%)`));
}

/**
 * Output actionable tips based on the deletion results
 */
function outputActionableTips(
  result: import('../analyzers/safe-deletion-system').SafeDeletionResult,
  options: SafeDeleteOptions
): void {
  const { candidateFunctions, deletedFunctions } = result;
  
  if (options.dryRun || !options.execute) {
    console.log(chalk.dim('\n💡 This was a preview. Use `funcqc safe-delete --execute` to perform actual deletions.'));
  } else if (candidateFunctions.length > 0 && deletedFunctions.length === 0) {
    outputImprovementTips(candidateFunctions);
  }

  if (result.backupPath) {
    console.log(chalk.dim(`\n🔄 To restore deleted functions: funcqc safe-delete --restore "${result.backupPath}"`));
  }
}

/**
 * Output tips for improving deletion success
 */
function outputImprovementTips(candidateFunctions: import('../analyzers/safe-deletion-system').DeletionCandidate[]): void {
  console.log(chalk.dim('\n💡 Tips for improving deletion success:'));
  
  if (candidateFunctions.length >= 100) {
    console.log(chalk.dim('  • Large candidate set detected - consider gradual approach:'));
    console.log(chalk.dim('    - Start with --confidence-threshold 0.99 for safest deletions'));
    console.log(chalk.dim('    - Use --max-batch 5 to process in smaller batches'));
    console.log(chalk.dim('    - Use --verbose to understand why functions are skipped'));
  } else {
    console.log(chalk.dim('  • Lower --confidence-threshold (currently requires high confidence)'));
    console.log(chalk.dim('  • Use --verbose to see detailed reasons for skipping'));
  }
  
  console.log(chalk.dim('  • Use --execute to perform actual deletion with confirmation'));
  console.log(chalk.dim('  • Use --exclude to exclude specific file patterns'));
  console.log(chalk.dim('  • Consider manual review of high-confidence candidates'));
}