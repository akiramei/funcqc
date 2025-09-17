import { OptionValues } from 'commander';
import chalk from 'chalk';
import { Ora } from 'ora';
import ora from 'ora';
import * as readline from 'readline';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler } from '../../utils/error-handler';
import { SafeDeletionSystem, SafeDeletionOptions } from '../../analyzers/safe-deletion-system';
import { loadCallGraphWithLazyAnalysis, validateCallGraphRequirements } from '../../utils/lazy-analysis';

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
  includeStaticMethods?: boolean;
  excludeTests?: boolean;
  exclude?: string[];
  format?: 'table' | 'json';
  verbose?: boolean;
  restore?: string;
  // Candidate-level confidence filter (separate from edge-level --confidence-threshold)
  minConfidence?: string;
  // High recall preset
  highRecall?: boolean;
}

/**
 * Safe deletion command using high-confidence call graph analysis
 */
export const depSafeDeleteCommand: VoidCommand<SafeDeleteOptions> = (options) =>
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
  // Use lazy analysis to ensure call graph data is available
  spinner.start('Loading analysis data...');
  
  let lazyResult;
  try {
    lazyResult = await loadCallGraphWithLazyAnalysis(env, {
      showProgress: false // We manage progress with our own spinner
    });
  } catch (error) {
    spinner.fail('Failed to load call graph data');
    throw error;
  }

  const { snapshot, callEdges, functions } = lazyResult;

  // Validate that we have sufficient call graph data
  validateCallGraphRequirements(callEdges, 'dep delete');

  if (!snapshot) {
    throw new Error('Snapshot is required for safe deletion');
  }

  const safeDeletionOptions = createSafeDeletionOptions(options);
  
  // Ensure type system data (type members, method overrides) is available for this snapshot
  // Required for strict type-based protection (interface implementations / overrides)
  if (snapshot) {
    try {
      const exists = await hasTypeSystemData(env, snapshot.id);
      if (!exists) {
        spinner.text = 'Performing type system analysis (for deletion safety)...';
        const { performDeferredTypeSystemAnalysis } = await import('../commands/scan');
        await performDeferredTypeSystemAnalysis(snapshot.id, env, false);
        spinner.text = 'Type system analysis completed. Continuing...';
      }
    } catch (e) {
      // Type systemは削除安全性の強化に使うため、失敗しても致命的ではない
      // ただしログは残す
      env.commandLogger.warn(`Type system analysis check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  
  // Step 1: Always perform analysis first
  const analysisResult = await performAnalysis(functions, callEdges, safeDeletionOptions, spinner, env, snapshot.id);
  
  // Step 2: Show preview results
  outputResults(analysisResult, options);
  
  // Step 3: If --execute flag is provided and candidates exist, ask for confirmation
  if (options.execute && analysisResult.candidateFunctions.length > 0) {
    if (options.force) {
      console.log(chalk.yellow('\n⚠️  --force flag detected. Proceeding with deletion without confirmation.'));
      await executeActualDeletion(functions, callEdges, safeDeletionOptions, spinner, env, snapshot.id);
    } else {
      const confirmed = await promptForConfirmation(analysisResult);
      if (confirmed) {
        await executeActualDeletion(functions, callEdges, safeDeletionOptions, spinner, env, snapshot.id);
      } else {
        console.log(chalk.cyan('\n✅ Deletion cancelled. No files were modified.'));
      }
    }
  } else if (!options.execute && analysisResult.candidateFunctions.length > 0) {
    console.log(chalk.dim('\n💡 This was a preview. Use --execute flag to perform actual deletion.'));
  }
}



/**
 * Create safe deletion options from CLI options
 */
function createSafeDeletionOptions(options: SafeDeleteOptions): Partial<SafeDeletionOptions> {
  // Determine execution mode: preview-only by default, execute only with --execute flag
  const shouldExecute = options.execute || false;
  const dryRun = options.dryRun || !shouldExecute; // Default to dry-run unless --execute is specified
  
  const safeDeletionOptions: Partial<SafeDeletionOptions> = {
    confidenceThreshold: parseFloat(options.confidenceThreshold || '0.90'),
    maxFunctionsPerBatch: parseInt(options.maxBatch || '5'),
    createBackup: !options.noBackup,
    dryRun,
    includeExports: !!options.includeExports,
    includeStaticMethods: Boolean(options.includeStaticMethods),
    // if --exclude-tests present, respect it; default false keeps tests as entry points
    excludeTests: Boolean(options.excludeTests),
    excludePatterns: options.exclude || ['**/node_modules/**', '**/dist/**', '**/build/**'],
    // pass through verbosity
    verbose: Boolean(options.verbose)
  };

  // Optional: candidate-level confidence filter (independent from edge filter)
  if (options.minConfidence) {
    const parsed = parseFloat(options.minConfidence);
    if (!Number.isNaN(parsed)) {
      safeDeletionOptions.candidateMinConfidence = parsed;
    }
  }
  
  const mode = dryRun ? 'preview-only' : 'execute';
  if (options.verbose) {
    const minCand = safeDeletionOptions.candidateMinConfidence;
    console.log(`🔧 Configuration: mode=${mode}, backup=${safeDeletionOptions.createBackup}, execute=${shouldExecute}, includeExports=${safeDeletionOptions.includeExports}, minCandidateConfidence=${minCand ?? 'n/a'}`);
  }

  // High recall preset: include exports and static methods; do not exclude tests
  if (options.highRecall) {
    safeDeletionOptions.includeExports = true;
    safeDeletionOptions.includeStaticMethods = true;
    safeDeletionOptions.excludeTests = false;
    // Use stricter edge threshold to avoid spurious reachability; keep candidate filter moderate
    const current = safeDeletionOptions.confidenceThreshold ?? 0.95;
    safeDeletionOptions.confidenceThreshold = Math.max(0.99, current);
    if (safeDeletionOptions.candidateMinConfidence == null) {
      safeDeletionOptions.candidateMinConfidence = 0.9;
    }
  }
  return safeDeletionOptions;
}

/**
 * Perform the actual safe deletion analysis (preview mode)
 */
async function performAnalysis(
  functions: import('../../types').FunctionInfo[],
  callEdges: import('../../types').CallEdge[],
  safeDeletionOptions: Partial<SafeDeletionOptions>,
  spinner: Ora,
  env?: CommandEnvironment,
  snapshotId?: string
): Promise<import('../../analyzers/safe-deletion-system').SafeDeletionResult> {
  spinner.text = 'Analyzing functions for safe deletion...';
  
  const safeDeletionSystem = new SafeDeletionSystem(env?.commandLogger);
  
  // Use the original dry-run setting from options
  const analysisOptions = { 
    ...safeDeletionOptions,
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
  functions: import('../../types').FunctionInfo[],
  callEdges: import('../../types').CallEdge[],
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
    console.log(chalk.dim(`\n🔄 To restore deleted functions: funcqc dep delete --restore "${result.backupPath}"`));
  }
}

/**
 * Check whether type system data exists for the snapshot
 */
async function hasTypeSystemData(env: CommandEnvironment, snapshotId: string): Promise<boolean> {
  try {
    const res = await env.storage.query(
      'SELECT (SELECT COUNT(1) FROM type_members WHERE snapshot_id = $1) AS members, (SELECT COUNT(1) FROM method_overrides WHERE snapshot_id = $1) AS overrides',
      [snapshotId]
    );
    const row = res.rows[0] as { members?: unknown; overrides?: unknown };
    const members = typeof row?.members === 'number' ? row.members : Number(row?.members ?? 0);
    const overrides = typeof row?.overrides === 'number' ? row.overrides : Number(row?.overrides ?? 0);
    // 型保護のためには method_overrides が必要。0 の場合は未生成とみなす
    return (members > 0) && (overrides > 0);
  } catch {
    return false;
  }
}

/**
 * Prompt user for confirmation before actual deletion
 */
async function promptForConfirmation(result: import('../../analyzers/safe-deletion-system').SafeDeletionResult): Promise<boolean> {
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
  result: import('../../analyzers/safe-deletion-system').SafeDeletionResult,
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
function outputSafeDeletionJSON(result: import('../../analyzers/safe-deletion-system').SafeDeletionResult): void {
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
  result: import('../../analyzers/safe-deletion-system').SafeDeletionResult,
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
function outputSummarySection(result: import('../../analyzers/safe-deletion-system').SafeDeletionResult): void {
  const { candidateFunctions, deletedFunctions, skippedFunctions, errors, warnings } = result;
  
  const greenOrDim = (n: number) => (n > 0 ? chalk.green(n) : chalk.dim(n.toString()));
  const yellowOrDim = (n: number) => (n > 0 ? chalk.yellow(n) : chalk.dim(n.toString()));
  const redOrDim = (n: number) => (n > 0 ? chalk.red(n) : chalk.dim(n.toString()));

  console.log(`Candidates found:     ${chalk.cyan(candidateFunctions.length)}`);
  console.log(`Functions deleted:    ${greenOrDim(deletedFunctions.length)}`);
  console.log(`Functions skipped:    ${yellowOrDim(skippedFunctions.length)}`);
  console.log(`Errors encountered:   ${redOrDim(errors.length)}`);
  console.log(`Warnings:            ${yellowOrDim(warnings.length)}`);

  if (result.backupPath) {
    console.log(`Backup created:      ${chalk.blue(result.backupPath)}`);
  }
}

/**
 * Output validation results section
 */
function outputValidationResults(result: import('../../analyzers/safe-deletion-system').SafeDeletionResult): void {
  console.log('\n🔍 Validation Results:');
  const fmt = (passed: boolean | undefined, performed?: boolean) =>
    performed === false ? chalk.dim('N/A') : (passed ? '✅ PASS' : '❌ FAIL');
  const prePerformed = result.preDeleteValidation.performed;
  const preType = fmt(result.preDeleteValidation.typeCheckPassed, prePerformed);
  const preTest = fmt(result.preDeleteValidation.testsPassed, prePerformed);
  console.log(`Pre-deletion:  TypeCheck: ${preType}, Tests: ${preTest}`);
  
  if (result.deletedFunctions.length > 0) {
    const postPerformed = result.postDeleteValidation.performed;
    const postType = fmt(result.postDeleteValidation.typeCheckPassed, postPerformed);
    const postTest = fmt(result.postDeleteValidation.testsPassed, postPerformed);
    console.log(`Post-deletion: TypeCheck: ${postType}, Tests: ${postTest}`);
  }
}

/**
 * Output errors and warnings sections
 */
function outputErrorsAndWarnings(result: import('../../analyzers/safe-deletion-system').SafeDeletionResult): void {
  if (result.errors.length > 0) {
    console.log(chalk.red('\n❌ Errors:'));
    result.errors.forEach(error => console.log(`  • ${error}`));
  }

  if (result.warnings.length > 0) {
    console.log(chalk.yellow('\n⚠️  Warnings:'));
    result.warnings.forEach(warning => console.log(`  • ${warning}`));
    // Actionable next steps for warnings (color-agnostic guidance)
    console.log(chalk.yellow('   Next actions:'));
    console.log(chalk.yellow('    - 実行前に型チェック/テストを再確認 (npm run typecheck; npm test)'));
    console.log(chalk.yellow('    - 詳細診断: --verbose でスキップ理由や型保護の根拠を表示'));
    console.log(chalk.yellow('    - 関係が疑われる関数は手動でソース確認（候補の該当範囲行）'));
  }
}

/**
 * Output candidates section grouped by file
 */
function outputCandidatesSection(
  result: import('../../analyzers/safe-deletion-system').SafeDeletionResult,
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
function groupCandidatesByFile(candidates: import('../../analyzers/safe-deletion-system').DeletionCandidate[]): Map<string, typeof candidates> {
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
  candidate: import('../../analyzers/safe-deletion-system').DeletionCandidate,
  result: import('../../analyzers/safe-deletion-system').SafeDeletionResult,
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
  if (confidenceScore >= 0.90 && estimatedImpact === 'low') {
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
  candidate: import('../../analyzers/safe-deletion-system').DeletionCandidate,
  result: import('../../analyzers/safe-deletion-system').SafeDeletionResult
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
function outputVerboseInfo(candidate: import('../../analyzers/safe-deletion-system').DeletionCandidate): void {
  console.log(chalk.gray(`     Reason: ${candidate.reason}`));
  console.log(chalk.gray(`     Confidence: ${(candidate.confidenceScore * 100).toFixed(1)}%`));
  console.log(chalk.gray(`     Callers: ${candidate.callersCount}`));
  console.log(chalk.gray(`     Impact: ${candidate.estimatedImpact}`));
}

/**
 * Output summary statistics section
 */
function outputSummaryStatistics(result: import('../../analyzers/safe-deletion-system').SafeDeletionResult): void {
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
function outputNoDeletionsInfo(result: import('../../analyzers/safe-deletion-system').SafeDeletionResult): void {
  const skippedCount = result.skippedFunctions.length;
  console.log(chalk.yellow(`No functions deleted (${skippedCount} candidates skipped due to safety constraints)`));
  
  const confidenceDistribution = result.candidateFunctions.reduce((acc, candidate) => {
    const confidence = candidate.confidenceScore;
    if (confidence >= 0.90) acc.high++;
    else if (confidence >= 0.70) acc.medium++;
    else acc.low++;
    return acc;
  }, { high: 0, medium: 0, low: 0 });
  
  console.log(chalk.dim(`   Confidence distribution: ${confidenceDistribution.high} high (≥95%), ${confidenceDistribution.medium} medium (≥85%), ${confidenceDistribution.low} low (<85%)`));
}

/**
 * Output actionable tips based on the deletion results
 */
function outputActionableTips(
  result: import('../../analyzers/safe-deletion-system').SafeDeletionResult,
  options: SafeDeleteOptions
): void {
  const { candidateFunctions, deletedFunctions } = result;
  
  if (options.dryRun || !options.execute) {
    console.log(chalk.dim('\n💡 This was a preview. Use `funcqc dep delete --execute` to perform actual deletions.'));
  } else if (candidateFunctions.length > 0 && deletedFunctions.length === 0) {
    outputImprovementTips(candidateFunctions);
  }

  if (result.backupPath) {
    console.log(chalk.dim(`\n🔄 To restore deleted functions: funcqc dep delete --restore "${result.backupPath}"`));
  }
}

/**
 * Output tips for improving deletion success
 */
function outputImprovementTips(candidateFunctions: import('../../analyzers/safe-deletion-system').DeletionCandidate[]): void {
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
