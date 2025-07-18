import { OptionValues } from 'commander';
import chalk from 'chalk';
import { Ora } from 'ora';
import ora from 'ora';
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
        await handleRestoreOperation(options.restore, spinner);
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
  spinner.start('Loading latest analysis results...');

  // Get the latest snapshot
  const snapshot = await env.storage.getLatestSnapshot();
  if (!snapshot) {
    spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return;
  }

  spinner.text = 'Loading functions...';

  // Get functions first
  const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);
  if (functions.length === 0) {
    spinner.fail(chalk.yellow('No functions found in the latest snapshot.'));
    return;
  }

  spinner.text = `Loading call edges for ${functions.length} functions...`;

  // For testing, let's use a small subset to avoid timeout
  console.log(`\n📊 Found ${functions.length} functions in snapshot ${snapshot.id}`);
  
  // Get call edges separately with timeout
  let callEdges: import('../types').CallEdge[] = [];
  
  try {
    callEdges = await Promise.race([
      env.storage.getCallEdgesBySnapshot(snapshot.id),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Call edge query timeout after 30 seconds')), 30000)
      )
    ]) as import('../types').CallEdge[];
    
    console.log(`📊 Found ${callEdges.length} call edges`);
    
    // Filter for high-confidence edges only
    const highConfidenceEdges = callEdges.filter(edge => {
      if (!edge.confidenceScore) return false;
      const threshold = parseFloat(options.confidenceThreshold || '0.95');
      return edge.confidenceScore >= threshold;
    });
    
    console.log(`📊 Found ${highConfidenceEdges.length} high-confidence call edges`);
    callEdges = highConfidenceEdges;
    
  } catch (error) {
    console.warn(`⚠️  Failed to load call edges: ${error}. Proceeding with basic analysis...`);
    // Use empty call edges array for basic analysis
    callEdges = [];
  }

  spinner.text = `Analyzing ${functions.length} functions...`;

  // Configure safe deletion options
  const safeDeletionOptions: Partial<SafeDeletionOptions> = {
    confidenceThreshold: parseFloat(options.confidenceThreshold || '0.95'),
    maxFunctionsPerBatch: parseInt(options.maxBatch || '10'),
    createBackup: options['backup'] !== false,  // --no-backup sets backup: false
    dryRun: options.dryRun || false,
    excludeExports: !options.includeExports,
    excludePatterns: options.exclude || ['**/node_modules/**', '**/dist/**', '**/build/**']
  };

  console.log(`🔧 Configuration: backup=${safeDeletionOptions.createBackup}, dryRun=${safeDeletionOptions.dryRun}`);

  spinner.text = 'Analyzing functions for safe deletion...';

  // Perform safe deletion analysis
  const safeDeletionSystem = new SafeDeletionSystem();
  const result = await safeDeletionSystem.performSafeDeletion(
    functions,
    callEdges,
    safeDeletionOptions
  );

  spinner.succeed('Safe deletion analysis completed');

  // Display results
  if (options.format === 'json') {
    outputSafeDeletionJSON(result);
  } else {
    outputSafeDeletionTable(result, options);
  }
}

/**
 * Handle backup restoration
 */
async function handleRestoreOperation(backupPath: string, spinner: Ora): Promise<void> {
  spinner.start('Restoring from backup...');

  try {
    const safeDeletionSystem = new SafeDeletionSystem();
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

  // Summary
  const { candidateFunctions, deletedFunctions, skippedFunctions, errors, warnings } = result;
  
  console.log(`Candidates found:     ${chalk.cyan(candidateFunctions.length)}`);
  console.log(`Functions deleted:    ${chalk.green(deletedFunctions.length)}`);
  console.log(`Functions skipped:    ${chalk.yellow(skippedFunctions.length)}`);
  console.log(`Errors encountered:   ${chalk.red(errors.length)}`);
  console.log(`Warnings:            ${chalk.yellow(warnings.length)}`);

  if (result.backupPath) {
    console.log(`Backup created:      ${chalk.blue(result.backupPath)}`);
  }

  // Validation results
  console.log('\n🔍 Validation Results:');
  console.log(`Pre-deletion:  TypeCheck: ${result.preDeleteValidation.typeCheckPassed ? '✅' : '❌'}, Tests: ${result.preDeleteValidation.testsPassed ? '✅' : '❌'}`);
  
  if (deletedFunctions.length > 0) {
    console.log(`Post-deletion: TypeCheck: ${result.postDeleteValidation.typeCheckPassed ? '✅' : '❌'}, Tests: ${result.postDeleteValidation.testsPassed ? '✅' : '❌'}`);
  }

  // Show errors if any
  if (errors.length > 0) {
    console.log(chalk.red('\n❌ Errors:'));
    errors.forEach(error => console.log(`  • ${error}`));
  }

  // Show warnings if any
  if (warnings.length > 0) {
    console.log(chalk.yellow('\n⚠️  Warnings:'));
    warnings.forEach(warning => console.log(`  • ${warning}`));
  }

  // Show candidate functions
  if (candidateFunctions.length === 0) {
    console.log(chalk.green('\n✅ No functions identified for safe deletion'));
    return;
  }

  console.log(chalk.bold('\n🎯 Deletion Candidates\n'));

  // Group by file
  const candidatesByFile = new Map<string, typeof candidateFunctions>();
  for (const candidate of candidateFunctions) {
    const filePath = candidate.functionInfo.filePath;
    if (!candidatesByFile.has(filePath)) {
      candidatesByFile.set(filePath, []);
    }
    candidatesByFile.get(filePath)!.push(candidate);
  }

  // Display candidates by file
  for (const [filePath, candidates] of candidatesByFile) {
    console.log(chalk.underline(filePath));

    for (const candidate of candidates) {
      const { functionInfo, reason, confidenceScore, callersCount, estimatedImpact } = candidate;
      const location = `${functionInfo.startLine}-${functionInfo.endLine}`;
      const size = `${functionInfo.endLine - functionInfo.startLine + 1} lines`;

      // Choose icon based on reason
      let icon = '❓';
      switch (reason) {
        case 'unreachable':
          icon = '🚫';
          break;
        case 'no-high-confidence-callers':
          icon = '🔗';
          break;
        case 'isolated':
          icon = '🏝️';
          break;
      }

      // Choose color based on confidence and impact
      let nameColor = chalk.yellow;
      if (confidenceScore >= 0.95 && estimatedImpact === 'low') {
        nameColor = chalk.green;
      } else if (confidenceScore < 0.85 || estimatedImpact === 'high') {
        nameColor = chalk.red;
      }

      const status = deletedFunctions.some(d => d.functionInfo.id === functionInfo.id) ? 
        chalk.green(' [DELETED]') : 
        skippedFunctions.some(s => s.functionInfo.id === functionInfo.id) ? 
          chalk.yellow(' [SKIPPED]') : '';

      console.log(`  ${icon} ${nameColor(functionInfo.name)} ${chalk.gray(`(${location}, ${size})`)}${status}`);
      
      if (options.verbose) {
        console.log(chalk.gray(`     Reason: ${reason}`));
        console.log(chalk.gray(`     Confidence: ${(confidenceScore * 100).toFixed(1)}%`));
        console.log(chalk.gray(`     Callers: ${callersCount}`));
        console.log(chalk.gray(`     Impact: ${estimatedImpact}`));
      }
    }

    console.log(); // Empty line between files
  }

  // Show summary statistics
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
    // Provide specific insight when candidates exist but nothing was deleted
    const skippedCount = skippedFunctions.length;
    console.log(chalk.yellow(`No functions deleted (${skippedCount} candidates skipped due to safety constraints)`));
    
    // Show confidence distribution for better understanding
    const confidenceDistribution = candidateFunctions.reduce((acc, candidate) => {
      const confidence = candidate.confidenceScore;
      if (confidence >= 0.95) acc.high++;
      else if (confidence >= 0.85) acc.medium++;
      else acc.low++;
      return acc;
    }, { high: 0, medium: 0, low: 0 });
    
    console.log(chalk.dim(`   Confidence distribution: ${confidenceDistribution.high} high (≥95%), ${confidenceDistribution.medium} medium (≥85%), ${confidenceDistribution.low} low (<85%)`));
  }

  // Show tips only when no functions were deleted despite having candidates
  if (options.dryRun) {
    console.log(chalk.dim('\n💡 This was a dry run. Use `funcqc safe-delete` without --dry-run to perform actual deletions.'));
  } else if (candidateFunctions.length > 0 && deletedFunctions.length === 0) {
    // Only show tips when there are candidates but nothing was deleted (not in dry-run mode)
    console.log(chalk.dim('\n💡 Tips for improving deletion success:'));
    
    // Provide specific guidance based on the number of candidates
    if (candidateFunctions.length >= 100) {
      console.log(chalk.dim('  • Large candidate set detected - consider gradual approach:'));
      console.log(chalk.dim('    - Start with --confidence-threshold 0.99 for safest deletions'));
      console.log(chalk.dim('    - Use --max-batch 5 to process in smaller batches'));
      console.log(chalk.dim('    - Use --verbose to understand why functions are skipped'));
    } else {
      console.log(chalk.dim('  • Lower --confidence-threshold (currently requires high confidence)'));
      console.log(chalk.dim('  • Use --verbose to see detailed reasons for skipping'));
    }
    
    console.log(chalk.dim('  • Use --dry-run to preview what would be deleted'));
    console.log(chalk.dim('  • Use --exclude to exclude specific file patterns'));
    console.log(chalk.dim('  • Consider manual review of high-confidence candidates'));
  }

  if (result.backupPath) {
    console.log(chalk.dim(`\n🔄 To restore deleted functions: funcqc safe-delete --restore "${result.backupPath}"`));
  }
}