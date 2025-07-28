import chalk from 'chalk';
import {
  CommandOptions,
  SnapshotDiff,
  FunctionChange,
  FunctionInfo,
  SimilarFunction,
} from '../../types';
import { SimilarityManager } from '../../similarity/similarity-manager';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { resolveSnapshotId } from '../../utils/snapshot-resolver';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';

export interface DiffCommandOptions extends CommandOptions {
  summary?: boolean;
  function?: string;
  file?: string;
  metric?: string;
  threshold?: number;
  json?: boolean;
  disableChangeDetection?: boolean; // Disable smart change detection
  similarityThreshold?: number; // Threshold for similarity analysis (default 0.85)
  detailed?: boolean; // Enable detailed mode with similarity analysis
  insights?: boolean; // Show suggested actions and insights (default: false)
}

/**
 * Parse similarity threshold from options, handling both string and number types
 */
function parseSimilarityThreshold(options: DiffCommandOptions): number {
  return typeof options.similarityThreshold === 'string' 
    ? parseFloat(options.similarityThreshold) 
    : options.similarityThreshold || 0.95;
}

/**
 * Diff command for comparing two snapshots
 * Note: This command has a unique signature with (from, to) arguments
 */
export function diffCommand(fromSnapshot: string, toSnapshot: string): VoidCommand<DiffCommandOptions> {
  return (options) => async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const { fromId, toId } = await setupDiffCommand(fromSnapshot, toSnapshot, options, env);

      if (fromId === toId) {
        displayIdenticalSnapshots(fromId, toId, options);
        return;
      }

      const diff = await calculateDiff(env, fromId, toId);
      await processDiffResults(diff, env, options);
    } catch (error) {
      handleDiffError(error, errorHandler);
    }
  };
}

async function setupDiffCommand(
  fromSnapshot: string,
  toSnapshot: string,
  _options: DiffCommandOptions,
  env: CommandEnvironment
) {
  const fromId = await resolveSnapshotId(env, fromSnapshot);
  const toId = await resolveSnapshotId(env, toSnapshot);

  if (!fromId || !toId) {
    env.commandLogger.error(`Snapshot not found: ${!fromId ? fromSnapshot : toSnapshot}`);
    process.exit(1);
  }

  return { fromId, toId };
}

function displayIdenticalSnapshots(fromId: string, toId: string, options: DiffCommandOptions): void {
  if (options.json) {
    const identicalDiff = {
      from: { id: fromId, label: null, createdAt: Date.now() },
      to: { id: toId, label: null, createdAt: Date.now() },
      added: [],
      removed: [],
      modified: [],
      unchanged: [],
      statistics: {
        addedCount: 0,
        removedCount: 0,
        modifiedCount: 0,
        complexityChange: 0,
        linesChange: 0,
      },
    };
    console.log(JSON.stringify(identicalDiff, null, 2));
  } else {
    console.log('\n📊 Diff Summary\n');
    console.log(`From: ${fromId.substring(0, 8)} (same snapshot)`);
    console.log(`To: ${toId.substring(0, 8)} (same snapshot)`);
    console.log('\nChanges:');
    console.log('  + 0 functions added');
    console.log('  - 0 functions removed');
    console.log('  ~ 0 functions modified');
    console.log('  = No changes (identical snapshots)');
  }
}

async function calculateDiff(env: CommandEnvironment, fromId: string, toId: string) {
  env.commandLogger.info('Calculating differences...');
  return await env.storage.diffSnapshots(fromId, toId);
}

async function processDiffResults(diff: SnapshotDiff, env: CommandEnvironment, options: DiffCommandOptions) {
  await displayDiffResults(diff, options, env);
}


async function displayDiffResults(diff: SnapshotDiff, options: DiffCommandOptions, env: CommandEnvironment): Promise<void> {
  if (options.json) {
    console.log(JSON.stringify(diff, null, 2));
  } else if (options.summary) {
    displaySummary(diff);
  } else {
    await displayFullDiff(diff, options, env);
  }
}

function handleDiffError(error: unknown, errorHandler: import('../../utils/error-handler').ErrorHandler): void {
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
      `Failed to calculate diff: ${error instanceof Error ? error.message : String(error)}`,
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}


function displaySummary(diff: SnapshotDiff): void {
  const stats = diff.statistics;

  console.log(chalk.cyan.bold('\n📊 Diff Summary\n'));

  // Basic stats
  console.log(
    `${chalk.bold('From:')} ${diff.from.label || diff.from.id.substring(0, 8)} (${formatDate(diff.from.createdAt)})`
  );
  console.log(
    `${chalk.bold('To:')} ${diff.to.label || diff.to.id.substring(0, 8)} (${formatDate(diff.to.createdAt)})`
  );
  console.log();

  // Changes overview
  console.log(chalk.bold('Changes:'));
  console.log(`  ${chalk.green('+')} ${stats.addedCount} functions added`);
  console.log(`  ${chalk.red('-')} ${stats.removedCount} functions removed`);
  console.log(`  ${chalk.yellow('~')} ${stats.modifiedCount} functions modified`);
  console.log(`  ${chalk.blue('=')} ${diff.unchanged.length} functions unchanged`);
  console.log();

  // Quality impact
  if (stats.complexityChange !== 0) {
    const complexityIcon = stats.complexityChange > 0 ? '📈' : '📉';
    const complexityColor = stats.complexityChange > 0 ? chalk.red : chalk.green;
    console.log(
      `${chalk.bold('Complexity:')} ${complexityIcon} ${complexityColor(stats.complexityChange > 0 ? '+' : '')}${stats.complexityChange}`
    );
  }

  if (stats.linesChange !== 0) {
    const linesIcon = stats.linesChange > 0 ? '📝' : '✂️';
    const linesColor = stats.linesChange > 0 ? chalk.blue : chalk.gray;
    console.log(
      `${chalk.bold('Lines:')} ${linesIcon} ${linesColor(stats.linesChange > 0 ? '+' : '')}${stats.linesChange}`
    );
  }
}

function displaySummaryWithClassification(diff: SnapshotDiff, classification: FunctionClassification): void {
  console.log(chalk.cyan.bold('\n📊 Diff Summary\n'));
  
  // Basic stats
  console.log(
    `${chalk.bold('From:')} ${diff.from.label || diff.from.id.substring(0, 8)} (${formatDate(diff.from.createdAt)})`
  );
  console.log(
    `${chalk.bold('To:')} ${diff.to.label || diff.to.id.substring(0, 8)} (${formatDate(diff.to.createdAt)})`
  );
  console.log();
  
  // Changes overview with classification
  console.log(chalk.bold('Changes:'));
  
  // Break down the changes by type
  if (classification.signatureChanges.length > 0) {
    console.log(`  ${chalk.blue('🔄')} ${classification.signatureChanges.length} signature change${classification.signatureChanges.length !== 1 ? 's' : ''}`);
  }
  if (classification.renames.length > 0) {
    console.log(`  ${chalk.magenta('🏷️')} ${classification.renames.length} rename${classification.renames.length !== 1 ? 's' : ''}`);
  }
  if (classification.moves.length > 0) {
    console.log(`  ${chalk.cyan('📁')} ${classification.moves.length} move${classification.moves.length !== 1 ? 's' : ''}`);
  }
  console.log(`  ${chalk.green('+')} ${classification.trueAdditions.length} functions added`);
  console.log(`  ${chalk.red('-')} ${classification.trueRemovals.length} functions removed`);
  console.log(`  ${chalk.yellow('~')} ${diff.modified.length} functions modified`);
  console.log(`  ${chalk.blue('=')} ${diff.unchanged.length} functions unchanged`);
}

async function displayFullDiff(diff: SnapshotDiff, options: DiffCommandOptions, env: CommandEnvironment): Promise<void> {
  const title = options.insights 
    ? '\n📊 Code Changes with Design Insights\n'
    : '\n📊 Code Changes\n';
  console.log(chalk.cyan.bold(title));

  // Display header
  displayDiffHeader(diff);

  // Filter functions
  const filtered = filterFunctions(diff, options);

  // Initialize similarity manager for analysis
  const threshold = parseSimilarityThreshold(options);
  const similarityManager = new SimilarityManager(undefined, env.storage, {
    threshold,
    minLines: 1,
    crossFile: true,
  });

  // Classify function changes
  const classification = await classifyFunctionChanges(filtered, options, similarityManager);
  
  // Display classified changes
  displayClassifiedChanges(classification);

  // Update filtered diff to use true additions/removals
  const classifiedDiff: SnapshotDiff = {
    ...diff,
    added: classification.trueAdditions,
    removed: classification.trueRemovals,
    modified: filtered.modified
  };

  // Display remaining changes with similarity analysis
  await displaySemanticDiff(classifiedDiff, similarityManager, options);

  // Display summary with classified changes
  displaySummaryWithClassification(diff, classification);
}

function displayDiffHeader(diff: SnapshotDiff): void {
  console.log(
    `${chalk.bold('From:')} ${diff.from.label || diff.from.id.substring(0, 8)} (${formatDate(diff.from.createdAt)})`
  );
  console.log(
    `${chalk.bold('To:')} ${diff.to.label || diff.to.id.substring(0, 8)} (${formatDate(diff.to.createdAt)})`
  );
  console.log();
}

interface FilteredFunctions {
  added: FunctionInfo[];
  removed: FunctionInfo[];
  modified: FunctionChange[];
}

function filterFunctions(diff: SnapshotDiff, options: DiffCommandOptions): FilteredFunctions {
  let { added, removed, modified } = diff;

  // Apply function name filter
  if (options.function) {
    const pattern = options.function.toLowerCase();
    added = filterByFunctionName(added, pattern);
    removed = filterByFunctionName(removed, pattern);
    modified = modified.filter(
      f =>
        f.before.name.toLowerCase().includes(pattern) ||
        f.after.name.toLowerCase().includes(pattern)
    );
  }

  // Apply file path filter
  if (options.file) {
    const pattern = options.file.toLowerCase();
    added = filterByFilePath(added, pattern);
    removed = filterByFilePath(removed, pattern);
    modified = modified.filter(
      f =>
        f.before.filePath.toLowerCase().includes(pattern) ||
        f.after.filePath.toLowerCase().includes(pattern)
    );
  }

  // Apply metric filter for modified functions
  if (options.metric && modified.length > 0) {
    modified = modified.filter(func =>
      func.changes.some(change => change.field === options.metric)
    );
  }

  return { added, removed, modified };
}

function filterByFunctionName(functions: FunctionInfo[], pattern: string): FunctionInfo[] {
  return functions.filter(f => f.name.toLowerCase().includes(pattern));
}

function filterByFilePath(functions: FunctionInfo[], pattern: string): FunctionInfo[] {
  return functions.filter(f => f.filePath.toLowerCase().includes(pattern));
}

// Legacy display functions removed - replaced with semantic diff functions

// Legacy displayChange function removed - replaced with semantic diff functions

// isNumericChange function removed - no longer needed in semantic diff

// ========================================
// SEMANTIC DIFF DISPLAY FUNCTIONS
// ========================================

async function displaySemanticDiff(
  filtered: FilteredFunctions,
  similarityManager: SimilarityManager,
  options: DiffCommandOptions
): Promise<void> {
  // Display each category with similarity analysis
  if (filtered.added.length > 0) {
    await displayAddedFunctionsWithSimilarity(filtered.added, similarityManager, options);
  }

  if (filtered.removed.length > 0) {
    await displayRemovedFunctionsWithSimilarity(filtered.removed, similarityManager, options);
  }

  if (filtered.modified.length > 0) {
    await displayModifiedFunctionsWithSimilarity(filtered.modified, similarityManager, options);
  }
}

async function displayAddedFunctionsWithSimilarity(
  functions: FunctionInfo[],
  similarityManager: SimilarityManager,
  options: DiffCommandOptions
): Promise<void> {
  console.log(chalk.green.bold(`🟢 TRULY ADDED FUNCTIONS (${functions.length})`));
  console.log();

  // Group by file
  const functionsByFile = groupFunctionsByFile(functions);
  let globalFunctionIndex = 1;

  for (const [filePath, fileFunctions] of functionsByFile) {
    console.log(chalk.bold(`📁 ${filePath} (${fileFunctions.length} functions added)`));
    
    // Display function table header
    if (options.insights) {
      console.log('No.  Function Signature                                           CC   LOC');
      console.log('---- ────────────────────────────────────────────────────────────── ──── ─────');
    } else {
      console.log('Function Signature                                                CC   LOC');
      console.log('────────────────────────────────────────────────────────────────── ──── ─────');
    }
    
    // Display each function with numbering for insights mode
    const functionWithNumbers: Array<{func: FunctionInfo, number: number}> = [];
    for (const func of fileFunctions) {
      const signature = formatFunctionSignature(func);
      const cc = func.metrics?.cyclomaticComplexity || 0;
      const loc = func.metrics?.linesOfCode || 0;
      
      if (options.insights) {
        const number = globalFunctionIndex++;
        functionWithNumbers.push({func, number});
        console.log(`#${number.toString().padStart(2)}  ${signature.padEnd(62)} ${cc.toString().padStart(4)} ${loc.toString().padStart(5)}`);
      } else {
        console.log(`${signature.padEnd(66)} ${cc.toString().padStart(4)} ${loc.toString().padStart(5)}`);
      }
    }

    console.log();

    // Perform similarity analysis for added functions only if insights are requested
    if (options.insights) {
      await displaySimilarityAnalysisForAdded(functionWithNumbers, similarityManager, options);
    }
  }
}

async function displayRemovedFunctionsWithSimilarity(
  functions: FunctionInfo[],
  similarityManager: SimilarityManager,
  options: DiffCommandOptions
): Promise<void> {
  console.log(chalk.red.bold(`🔴 TRULY REMOVED FUNCTIONS (${functions.length})`));
  console.log();

  // Group by file
  const functionsByFile = groupFunctionsByFile(functions);
  let globalFunctionIndex = 1;

  for (const [filePath, fileFunctions] of functionsByFile) {
    console.log(chalk.bold(`📁 ${filePath} (${fileFunctions.length} functions removed)`));
    
    // Display function table header
    if (options.insights) {
      console.log('No.  Function Signature                                           CC   LOC');
      console.log('---- ────────────────────────────────────────────────────────────── ──── ─────');
    } else {
      console.log('Function Signature                                                CC   LOC');
      console.log('────────────────────────────────────────────────────────────────── ──── ─────');
    }
    
    // Display each function with numbering for insights mode
    const functionWithNumbers: Array<{func: FunctionInfo, number: number}> = [];
    for (const func of fileFunctions) {
      const signature = formatFunctionSignature(func);
      const cc = func.metrics?.cyclomaticComplexity || 0;
      const loc = func.metrics?.linesOfCode || 0;
      
      if (options.insights) {
        const number = globalFunctionIndex++;
        functionWithNumbers.push({func, number});
        console.log(`#${number.toString().padStart(2)}  ${signature.padEnd(62)} ${cc.toString().padStart(4)} ${loc.toString().padStart(5)}`);
      } else {
        console.log(`${signature.padEnd(66)} ${cc.toString().padStart(4)} ${loc.toString().padStart(5)}`);
      }
    }

    console.log();

    // Perform similarity analysis for removed functions only if insights are requested
    if (options.insights) {
      await displaySimilarityAnalysisForRemoved(functionWithNumbers, similarityManager, options);
    }
  }
}

async function displayModifiedFunctionsWithSimilarity(
  functions: FunctionChange[],
  similarityManager: SimilarityManager,
  options: DiffCommandOptions
): Promise<void> {
  console.log(chalk.yellow.bold(`🟡 MODIFIED FUNCTIONS (${functions.length})`));
  console.log();

  // Group by file
  const functionsByFile = groupFunctionChangesByFile(functions);
  let globalFunctionIndex = 1;

  for (const [filePath, fileFunctions] of functionsByFile) {
    console.log(chalk.bold(`📁 ${filePath} (${fileFunctions.length} functions modified)`));
    
    // Display function table header
    if (options.insights) {
      console.log('No.  Function Signature                                           CC     LOC');
      console.log('---- ────────────────────────────────────────────────────────────── ────── ─────');
    } else {
      console.log('Function Signature                                                CC     LOC');
      console.log('────────────────────────────────────────────────────────────────── ────── ─────');
    }
    
    // Display each function with numbering for insights mode
    const functionWithNumbers: Array<{func: FunctionChange, number: number}> = [];
    for (const func of fileFunctions) {
      const signature = formatFunctionSignature(func.after);
      const ccBefore = func.before.metrics?.cyclomaticComplexity || 0;
      const ccAfter = func.after.metrics?.cyclomaticComplexity || 0;
      const locBefore = func.before.metrics?.linesOfCode || 0;
      const locAfter = func.after.metrics?.linesOfCode || 0;
      
      const ccChange = `${ccBefore}→${ccAfter}`;
      const locChange = `${locBefore}→${locAfter}`;
      
      if (options.insights) {
        const number = globalFunctionIndex++;
        functionWithNumbers.push({func, number});
        console.log(`#${number.toString().padStart(2)}  ${signature.padEnd(62)} ${ccChange.padStart(6)} ${locChange.padStart(5)}`);
      } else {
        console.log(`${signature.padEnd(66)} ${ccChange.padStart(6)} ${locChange.padStart(5)}`);
      }
    }

    console.log();

    // Perform similarity analysis for modified functions only if insights are requested
    if (options.insights) {
      await displaySimilarityAnalysisForModified(functionWithNumbers, similarityManager, options);
    }
  }
}

// ========================================
// FUNCTION CHANGE CLASSIFICATION
// ========================================

interface FunctionClassification {
  signatureChanges: Array<{
    functionName: string;
    filePath: string;
    oldSignature: string;
    newSignature: string;
    similarity: number;
  }>;
  renames: Array<{
    oldName: string;
    newName: string;
    filePath: string;
    similarity: number;
  }>;
  moves: Array<{
    functionName: string;
    fromFile: string;
    toFile: string;
    similarity: number;
  }>;
  trueAdditions: FunctionInfo[];
  trueRemovals: FunctionInfo[];
}

async function classifyFunctionChanges(
  filtered: FilteredFunctions,
  options: DiffCommandOptions,
  similarityManager: SimilarityManager
): Promise<FunctionClassification> {
  const threshold = parseSimilarityThreshold(options);
  const classification: FunctionClassification = {
    signatureChanges: [],
    renames: [],
    moves: [],
    trueAdditions: [...filtered.added],
    trueRemovals: [...filtered.removed]
  };

  // Classify changes in order of specificity
  await classifySignatureChanges(classification, threshold, similarityManager);
  await classifyFunctionRenames(classification, threshold, similarityManager);
  await classifyFunctionMoves(classification, threshold, similarityManager);

  return classification;
}

async function classifySignatureChanges(
  classification: FunctionClassification,
  threshold: number,
  similarityManager: SimilarityManager
): Promise<void> {
  for (let i = classification.trueAdditions.length - 1; i >= 0; i--) {
    const added = classification.trueAdditions[i];
    
    for (let j = classification.trueRemovals.length - 1; j >= 0; j--) {
      const removed = classification.trueRemovals[j];
      
      if (!isSameNameAndFile(added, removed)) continue;
      
      const similarity = await calculateFunctionSimilarity(added, removed, similarityManager);
      if (similarity < threshold) continue;
      
      classification.signatureChanges.push({
        functionName: added.name,
        filePath: added.filePath,
        oldSignature: formatFunctionSignature(removed),
        newSignature: formatFunctionSignature(added),
        similarity
      });
      
      classification.trueAdditions.splice(i, 1);
      classification.trueRemovals.splice(j, 1);
      break;
    }
  }
}

async function classifyFunctionRenames(
  classification: FunctionClassification,
  threshold: number,
  similarityManager: SimilarityManager
): Promise<void> {
  for (let i = classification.trueAdditions.length - 1; i >= 0; i--) {
    const added = classification.trueAdditions[i];
    
    for (let j = classification.trueRemovals.length - 1; j >= 0; j--) {
      const removed = classification.trueRemovals[j];
      
      if (!isDifferentNameSameFile(added, removed)) continue;
      
      const similarity = await calculateFunctionSimilarity(added, removed, similarityManager);
      if (similarity < threshold) continue;
      
      classification.renames.push({
        oldName: removed.name,
        newName: added.name,
        filePath: added.filePath,
        similarity
      });
      
      classification.trueAdditions.splice(i, 1);
      classification.trueRemovals.splice(j, 1);
      break;
    }
  }
}

async function classifyFunctionMoves(
  classification: FunctionClassification,
  threshold: number,
  similarityManager: SimilarityManager
): Promise<void> {
  for (let i = classification.trueAdditions.length - 1; i >= 0; i--) {
    const added = classification.trueAdditions[i];
    
    for (let j = classification.trueRemovals.length - 1; j >= 0; j--) {
      const removed = classification.trueRemovals[j];
      
      if (!isDifferentFile(added, removed)) continue;
      
      const similarity = await calculateFunctionSimilarity(added, removed, similarityManager);
      if (similarity < threshold) continue;
      
      classification.moves.push({
        functionName: added.name === removed.name ? added.name : `${removed.name} → ${added.name}`,
        fromFile: removed.filePath,
        toFile: added.filePath,
        similarity
      });
      
      classification.trueAdditions.splice(i, 1);
      classification.trueRemovals.splice(j, 1);
      break;
    }
  }
}

function isSameNameAndFile(func1: FunctionInfo, func2: FunctionInfo): boolean {
  return func1.name === func2.name && func1.filePath === func2.filePath;
}

function isDifferentNameSameFile(func1: FunctionInfo, func2: FunctionInfo): boolean {
  return func1.name !== func2.name && func1.filePath === func2.filePath;
}

function isDifferentFile(func1: FunctionInfo, func2: FunctionInfo): boolean {
  return func1.filePath !== func2.filePath;
}

async function calculateFunctionSimilarity(
  func1: FunctionInfo,
  func2: FunctionInfo,
  similarityManager: SimilarityManager
): Promise<number> {
  try {
    const results = await similarityManager.detectSimilarities([func1, func2]);
    const relevantResult = results.find(result => 
      result.functions.some(f => f.functionId === func1.id) &&
      result.functions.some(f => f.functionId === func2.id)
    );
    return relevantResult?.similarity || 0;
  } catch {
    return 0;
  }
}

function displayClassifiedChanges(classification: FunctionClassification): void {
  // Display signature changes
  if (classification.signatureChanges.length > 0) {
    console.log(chalk.blue('🔄 SIGNATURE CHANGES') + chalk.gray(` (${classification.signatureChanges.length})`));
    console.log();
    
    for (const change of classification.signatureChanges) {
      console.log(chalk.bold(`📁 ${change.filePath}`));
      console.log(`Function: ${change.functionName}`);
      console.log(`Old: ${change.oldSignature}`);
      console.log(`New: ${change.newSignature}`);
      console.log(`Similarity: ${Math.round(change.similarity * 100)}%`);
      console.log();
    }
  }

  // Display renames
  if (classification.renames.length > 0) {
    console.log(chalk.magenta('🔀 RENAMED FUNCTIONS') + chalk.gray(` (${classification.renames.length})`));
    console.log();
    
    for (const rename of classification.renames) {
      console.log(chalk.bold(`📁 ${rename.filePath}`));
      console.log(`${rename.oldName} → ${rename.newName}`);
      console.log(`Similarity: ${Math.round(rename.similarity * 100)}%`);
      console.log();
    }
  }

  // Display moves
  if (classification.moves.length > 0) {
    console.log(chalk.cyan('📦 MOVED FUNCTIONS') + chalk.gray(` (${classification.moves.length})`));
    console.log();
    
    for (const move of classification.moves) {
      console.log(`Function: ${move.functionName}`);
      console.log(`From: ${move.fromFile}`);
      console.log(`To: ${move.toFile}`);
      console.log(`Similarity: ${Math.round(move.similarity * 100)}%`);
      console.log();
    }
  }
}

// ========================================
// SIMILARITY ANALYSIS FUNCTIONS
// ========================================

async function displaySimilarityAnalysisForAdded(
  functionsWithNumbers: Array<{func: FunctionInfo, number: number}>,
  similarityManager: SimilarityManager,
  options: DiffCommandOptions
): Promise<void> {
  console.log('Similar functions analysis:');
  console.log('No.  Function                         Sim%   Similar To                   File:Line                      Insight');
  console.log('---- ────────────────────────────────── ────── ──────────────────────────── ────────────────────────────── ──────────────────────');

  const threshold = parseSimilarityThreshold(options);
  
  for (const {func, number} of functionsWithNumbers) {
    try {
      // Get all functions and find similarity
      // Note: This is a simplified approach. For production, consider caching all functions
      const results = await similarityManager.detectSimilarities(
        [func], // Target function
        { threshold } // Use configurable threshold
      );

      // Find results with high similarity functions
      const highSimilarityResults = results.filter(result => 
        result.similarity >= threshold && result.functions.length > 1
      );

      if (highSimilarityResults.length > 0) {
        // Show the most similar function from the best result
        const bestResult = highSimilarityResults[0];
        const similarFunctions = bestResult.functions.filter(f => f.functionId !== func.id);
        
        if (similarFunctions.length > 0) {
          const mostSimilar = similarFunctions[0];
          const similarity = Math.round(bestResult.similarity * 100);
          const functionName = func.name.substring(0, 32).padEnd(33);
          const similarTo = mostSimilar.functionName.padEnd(28);
          const location = `${mostSimilar.filePath}:${mostSimilar.startLine}`.padEnd(30);
          const insight = getInsightForAddedFunction(similarity);
          
          console.log(`#${number.toString().padStart(2)}  ${functionName} ${similarity.toString().padStart(4)}%   ${similarTo} ${location} ${insight.padEnd(21)}`);
        } else {
          // No similar functions found (shouldn't happen but handle gracefully)
          const functionName = func.name.substring(0, 32).padEnd(33);
          console.log(`#${number.toString().padStart(2)}  ${functionName} ${'-'.padStart(4)}    ${'No similar functions found'.padEnd(28)} ${'-'.padEnd(30)} ${'✅ Unique implementation'.padEnd(21)}`);
        }
      } else {
        // No highly similar functions found
        const functionName = func.name.substring(0, 32).padEnd(33);
        console.log(`#${number.toString().padStart(2)}  ${functionName} ${'-'.padStart(4)}    ${'No similar functions found'.padEnd(28)} ${'-'.padEnd(30)} ${'✅ Unique implementation'.padEnd(21)}`);
      }
    } catch {
      // Silently continue if similarity analysis fails for a function
      const functionName = func.name.substring(0, 32).padEnd(33);
      console.log(`#${number.toString().padStart(2)}  ${functionName} ${'-'.padStart(4)}    ${'Analysis failed'.padEnd(28)} ${'-'.padEnd(30)} ${'⚠️ Check manually'.padEnd(21)}`);
    }
  }

  console.log();
}

function getInsightForAddedFunction(similarity: number): string {
  if (similarity >= 98) {
    return '🚨 Likely duplicate';
  } else if (similarity >= 96) {
    return '⚠️ Possible reinvention';
  } else {
    return '💡 Review similarity';
  }
}

async function displaySimilarityAnalysisForRemoved(
  functionsWithNumbers: Array<{func: FunctionInfo, number: number}>,
  similarityManager: SimilarityManager,
  options: DiffCommandOptions
): Promise<void> {
  console.log('Remaining similar functions:');
  console.log('No.  Sim%   Function                          File:Line                      Suggested Action');
  console.log('---- ────── ────────────────────────────────────────── ────────────────────────────── ──────────────────────');

  let hasSimilarFunctions = false;
  const threshold = parseSimilarityThreshold(options);

  for (const {func, number} of functionsWithNumbers) {
    try {
      // Get similarity results for the removed function
      const results = await similarityManager.detectSimilarities(
        [func], // Target function
        { threshold } // Use configurable threshold
      );

      // Find results with high similarity functions
      const highSimilarityResults = results.filter(result => 
        result.similarity >= threshold && result.functions.length > 1
      );

      if (highSimilarityResults.length > 0) {
        hasSimilarFunctions = true;
        
        // Show all similar functions from all results
        for (const result of highSimilarityResults) {
          const similarFunctions = result.functions.filter(f => f.functionId !== func.id);
          
          for (const similar of similarFunctions) {
            const similarity = Math.round(result.similarity * 100);
            const functionName = similar.functionName.padEnd(32);
            const location = `${similar.filePath}:${similar.startLine}`.padEnd(30);
            const action = getActionForSimilarity(similarity);
            
            console.log(`#${number.toString().padStart(2)}  ${similarity.toString().padStart(4)}%   ${functionName} ${location} ${action.padEnd(20)}`);
          }
        }
      }
    } catch {
      // Silently continue if similarity analysis fails for a function
      continue;
    }
  }

  if (!hasSimilarFunctions) {
    console.log('No highly similar functions found (threshold: 95%)');
  }

  console.log();
}

function getActionForSimilarity(similarity: number): string {
  if (similarity >= 98) {
    return 'Likely duplicate';
  } else if (similarity >= 96) {
    return 'Review for merge';
  } else {
    return 'Consider cleanup';
  }
}

async function displaySimilarityAnalysisForModified(
  functionsWithNumbers: Array<{func: FunctionChange, number: number}>,
  similarityManager: SimilarityManager,
  options: DiffCommandOptions
): Promise<void> {
  const threshold = parseSimilarityThreshold(options);
  
  for (const {func, number} of functionsWithNumbers) {
    console.log(`Similarity changes for #${number} ${func.after.name}:`);
    console.log('Timing   Sim%   Function                          File:Line                      Insight');
    console.log('──────── ────── ──────────────────────────────── ────────────────────────────── ──────────────────────');

    const hasBeforeSimilarity = await displayVersionSimilarity(func.before, 'Before', threshold, similarityManager);
    const hasAfterSimilarity = await displayVersionSimilarity(func.after, 'After', threshold, similarityManager);

    if (!hasBeforeSimilarity && !hasAfterSimilarity) {
      console.log('No similar functions found (below threshold or unique implementation)');
    }

    console.log();
  }
}

async function displayVersionSimilarity(
  version: FunctionInfo,
  timing: 'Before' | 'After',
  threshold: number,
  similarityManager: SimilarityManager
): Promise<boolean> {
  try {
    const results = await similarityManager.detectSimilarities([version], { threshold });
    const highSimilarityResults = results.filter(result => 
      result.similarity >= threshold && result.functions.length > 1
    );

    let hasSimilarity = false;
    for (const result of highSimilarityResults) {
      const similarFunctions = result.functions.filter(f => f.functionId !== version.id);
      
      for (const similar of similarFunctions.slice(0, 2)) {
        hasSimilarity = true;
        displaySimilarityResult(result.similarity, similar, timing);
      }
    }
    
    return hasSimilarity;
  } catch {
    return false;
  }
}

function displaySimilarityResult(
  similarity: number, 
  similar: SimilarFunction, 
  timing: 'Before' | 'After'
): void {
  const similarityPercent = Math.round(similarity * 100);
  const functionName = similar.functionName.substring(0, 32).padEnd(33);
  const location = `${similar.filePath}:${similar.startLine}`.padEnd(30);
  const insight = getInsightForModifiedFunction(similarityPercent, timing.toLowerCase() as 'before' | 'after');
  
  console.log(`${timing.padEnd(8)} ${similarityPercent.toString().padStart(4)}%   ${functionName} ${location} ${insight}`);
}

function getInsightForModifiedFunction(similarity: number, timing: 'before' | 'after'): string {
  const prefix = timing === 'before' ? '🔄' : '🔍';
  
  if (similarity >= 98) {
    return `${prefix} Likely duplicate`;
  } else if (similarity >= 96) {
    return `${prefix} Review for merge`;
  } else {
    return `${prefix} Monitor changes`;
  }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function groupFunctionsByFile(functions: FunctionInfo[]): Map<string, FunctionInfo[]> {
  const grouped = new Map<string, FunctionInfo[]>();
  
  for (const func of functions) {
    const filePath = func.filePath;
    if (!grouped.has(filePath)) {
      grouped.set(filePath, []);
    }
    const fileGroup = grouped.get(filePath);
    if (fileGroup) {
      fileGroup.push(func);
    }
  }
  
  return grouped;
}

function groupFunctionChangesByFile(functions: FunctionChange[]): Map<string, FunctionChange[]> {
  const grouped = new Map<string, FunctionChange[]>();
  
  for (const func of functions) {
    const filePath = func.after.filePath || func.before.filePath;
    if (!grouped.has(filePath)) {
      grouped.set(filePath, []);
    }
    const fileGroup = grouped.get(filePath);
    if (fileGroup) {
      fileGroup.push(func);
    }
  }
  
  return grouped;
}

function formatFunctionSignature(func: FunctionInfo): string {
  // Format signature like: functionName(param1: Type1, param2: Type2): ReturnType
  // Simplify long types for better readability
  const params = func.parameters
    .map(p => {
      const simpleType = simplifyType(p.type);
      return `${p.name}${p.isOptional ? '?' : ''}: ${simpleType}`;
    })
    .join(', ');
  
  const returnType = simplifyType(func.returnType?.type || 'void');
  const signature = `${func.name}(${params}): ${returnType}`;
  
  // Truncate if too long
  return signature.length > 60 ? signature.substring(0, 57) + '...' : signature;
}

function simplifyType(type: string): string {
  // Simplify complex import types
  return type
    .replace(/import\(['"].*?['"]\)\./g, '')
    .replace(/^.*\.([A-Z][a-zA-Z0-9_]*)$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Less than 1 hour ago
  if (diffMs < 60 * 60 * 1000) {
    const minutes = Math.floor(diffMs / (60 * 1000));
    return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  }

  // Less than 24 hours ago
  if (diffMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    return `${hours}h ago`;
  }

  // Less than 7 days ago
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }

  // More than 7 days ago - show date
  return date.toLocaleDateString();
}














