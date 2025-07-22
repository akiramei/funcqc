import chalk from 'chalk';
import {
  CommandOptions,
  SnapshotDiff,
  FunctionChange,
  ChangeDetail,
  FunctionInfo,
  Lineage,
  LineageCandidate,
  LineageKind,
  SimilarityResult,
  SimilarFunction,
} from '../../types';
import { createTable } from '../../utils/table-formatter';
import { SimilarityManager } from '../../similarity/similarity-manager';
import { v4 as uuidv4 } from 'uuid';
import simpleGit from 'simple-git';
import {
  ChangeSignificanceDetector,
  ChangeDetectorConfig,
  DEFAULT_CHANGE_DETECTOR_CONFIG,
} from '../diff/changeDetector';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { resolveSnapshotId } from '../../utils/snapshot-resolver';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { ConfigManager } from '../../core/config';

export interface DiffCommandOptions extends CommandOptions {
  summary?: boolean;
  function?: string;
  file?: string;
  metric?: string;
  threshold?: number;
  json?: boolean;
  lineage?: boolean;
  lineageThreshold?: string;
  lineageDetectors?: string;
  lineageAutoSave?: boolean;
  disableChangeDetection?: boolean; // Disable smart change detection
  changeDetectionMinScore?: number; // Override minimum score for lineage suggestion
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
  if (options.lineage && diff.removed.length > 0) {
    await handleLineageDetection(diff, env, options);
  } else {
    displayDiffResults(diff, options);
  }
}

async function handleLineageDetection(diff: SnapshotDiff, env: CommandEnvironment, options: DiffCommandOptions) {
  const lineageCandidates = await detectLineageCandidates(diff, env, options);

  if (lineageCandidates.length > 0) {
    if (options.json) {
      console.log(JSON.stringify({ diff, lineageCandidates }, null, 2));
    } else {
      displayLineageCandidates(lineageCandidates, options, env.commandLogger);
      if (options.lineageAutoSave) {
        await saveLineageCandidates(lineageCandidates, env);
      }
    }
  } else {
    env.commandLogger.info('No lineage candidates found for removed functions.');
  }
}

function displayDiffResults(diff: SnapshotDiff, options: DiffCommandOptions): void {
  if (options.json) {
    console.log(JSON.stringify(diff, null, 2));
  } else if (options.summary) {
    displaySummary(diff);
  } else {
    displayFullDiff(diff, options);
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

function displayFullDiff(diff: SnapshotDiff, options: DiffCommandOptions): void {
  console.log(chalk.cyan.bold('\n🔍 Function Differences\n'));

  // Display header
  displayDiffHeader(diff);

  // Filter functions
  const filtered = filterFunctions(diff, options);

  // Display structured overview
  displayStructuredOverview(filtered, diff.statistics);

  // Display detailed changes organized by impact
  displayDetailedChanges(filtered, options);

  // Display summary footer
  displaySummary(diff);
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

// Legacy display functions removed - replaced with structured table format

// displayChange function removed - integrated into table format

function isNumericChange(change: ChangeDetail): boolean {
  return !isNaN(Number(change.oldValue)) && !isNaN(Number(change.newValue));
}

function displayStructuredOverview(filtered: FilteredFunctions, _stats: import('../../types').DiffStatistics): void {
  if (filtered.added.length === 0 && filtered.removed.length === 0 && filtered.modified.length === 0) {
    return;
  }

  console.log(chalk.bold('\n📋 Change Overview\n'));

  // Create overview table
  const overviewTable = createTable([
    { header: 'Type', width: 12, align: 'left' },
    { header: 'Count', width: 8, align: 'right' },
    { header: 'Top Functions', width: 45, align: 'left' },
  ]);

  // Add rows for each change type
  if (filtered.added.length > 0) {
    overviewTable.addRow({
      'Type': chalk.green('➕ Added'),
      'Count': chalk.green(filtered.added.length.toString()),
      'Top Functions': getTopComplexFunctions(filtered.added, 3).join(', '),
    });
  }

  if (filtered.removed.length > 0) {
    overviewTable.addRow({
      'Type': chalk.red('➖ Removed'),
      'Count': chalk.red(filtered.removed.length.toString()),
      'Top Functions': getTopComplexFunctions(filtered.removed, 3).join(', '),
    });
  }

  if (filtered.modified.length > 0) {
    overviewTable.addRow({
      'Type': chalk.yellow('🔄 Modified'),
      'Count': chalk.yellow(filtered.modified.length.toString()),
      'Top Functions': getHighImpactModifications(filtered.modified, 3).join(', '),
    });
  }

  console.log(overviewTable.render());
}

function displayDetailedChanges(filtered: FilteredFunctions, options: DiffCommandOptions): void {
  // High impact changes first
  const highImpactModified = filtered.modified.filter(hasHighImpactChanges);
  if (highImpactModified.length > 0) {
    displayModifiedFunctionsTable(highImpactModified, '🔴 High Impact Changes', options);
  }

  // Medium impact changes
  const mediumImpactModified = filtered.modified.filter(func => 
    !hasHighImpactChanges(func) && hasMediumImpactChanges(func));
  if (mediumImpactModified.length > 0) {
    displayModifiedFunctionsTable(mediumImpactModified, '🟡 Medium Impact Changes', options);
  }

  // Low impact changes
  const lowImpactModified = filtered.modified.filter(func => 
    !hasHighImpactChanges(func) && !hasMediumImpactChanges(func));
  if (lowImpactModified.length > 0) {
    displayModifiedFunctionsTable(lowImpactModified, '🟢 Low Impact Changes', options);
  }

  // Added and removed functions in table format
  if (filtered.added.length > 0) {
    displayFunctionsTable(filtered.added, 'Added Functions', 'green', options);
  }

  if (filtered.removed.length > 0) {
    displayFunctionsTable(filtered.removed, 'Removed Functions', 'red', options);
  }
}

function displayModifiedFunctionsTable(functions: FunctionChange[], title: string, _options: DiffCommandOptions): void {
  if (functions.length === 0) return;

  console.log(chalk.bold(`\n${title} (${functions.length})`));
  console.log('─'.repeat(title.length + ` (${functions.length})`.length));

  const table = createTable([
    { header: 'Function', width: 25, align: 'left' },
    { header: 'File', width: 30, align: 'left' },
    { header: 'Changes', width: 35, align: 'left' },
  ]);

  functions.forEach(func => {
    const name = func.after.name || func.before.name;
    const file = (func.after.filePath || func.before.filePath).replace(/^.*\//, '');
    const changes = func.changes
      .filter(change => change.field !== 'startLine' && change.field !== 'endLine')
      .slice(0, 2)
      .map(change => formatChangeForTable(change))
      .join(', ');

    table.addRow({
      'Function': name.length > 23 ? name.substring(0, 20) + '...' : name,
      'File': file.length > 28 ? '...' + file.substring(file.length - 25) : file,
      'Changes': changes,
    });
  });

  console.log(table.render());
}

function displayFunctionsTable(functions: FunctionInfo[], title: string, colorType: string, _options: DiffCommandOptions): void {
  if (functions.length === 0) return;

  const icon = colorType === 'green' ? '➕' : '➖';

  console.log(chalk.bold(`\n${icon} ${title} (${functions.length})`));
  console.log('─'.repeat(title.length + ` (${functions.length})`.length + 2));

  const table = createTable([
    { header: 'Function', width: 25, align: 'left' },
    { header: 'File', width: 30, align: 'left' },
    { header: 'CC', width: 4, align: 'right' },
    { header: 'LOC', width: 5, align: 'right' },
  ]);

  functions
    .sort((a, b) => (b.metrics?.cyclomaticComplexity || 0) - (a.metrics?.cyclomaticComplexity || 0))
    .slice(0, 10) // Show top 10 to avoid overwhelming output
    .forEach(func => {
      const fileName = func.filePath.replace(/^.*\//, '');
      
      table.addRow({
        'Function': func.name.length > 23 ? func.name.substring(0, 20) + '...' : func.name,
        'File': fileName.length > 28 ? '...' + fileName.substring(fileName.length - 25) : fileName,
        'CC': (func.metrics?.cyclomaticComplexity || 0).toString(),
        'LOC': (func.metrics?.linesOfCode || 0).toString(),
      });
    });

  console.log(table.render());

  // Show count if more functions exist
  if (functions.length > 10) {
    console.log(chalk.gray(`... and ${functions.length - 10} more functions`));
  }
}

// Helper functions
function getTopComplexFunctions(functions: FunctionInfo[], limit: number): string[] {
  return functions
    .sort((a, b) => (b.metrics?.cyclomaticComplexity || 0) - (a.metrics?.cyclomaticComplexity || 0))
    .slice(0, limit)
    .map(f => f.name);
}

function getHighImpactModifications(functions: FunctionChange[], limit: number): string[] {
  return functions
    .filter(hasHighImpactChanges)
    .slice(0, limit)
    .map(f => f.after.name || f.before.name);
}

function hasHighImpactChanges(func: FunctionChange): boolean {
  return func.changes.some(change => change.impact === 'high');
}

function hasMediumImpactChanges(func: FunctionChange): boolean {
  return func.changes.some(change => change.impact === 'medium');
}

function formatChangeForTable(change: ChangeDetail): string {
  const { field, oldValue, newValue, impact } = change;
  
  const impactIcon = {
    low: '🟢',
    medium: '🟡',
    high: '🔴',
  }[impact];

  if (isNumericChange(change)) {
    const oldVal = Number(oldValue);
    const newVal = Number(newValue);
    const diff = newVal - oldVal;
    const diffStr = diff > 0 ? `+${diff}` : diff.toString();
    return `${impactIcon} ${field}: ${diffStr}`;
  } else {
    return `${impactIcon} ${field}`;
  }
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

// ========================================
// LINEAGE DETECTION FUNCTIONS
// ========================================

async function detectLineageCandidates(
  diff: SnapshotDiff,
  env: CommandEnvironment,
  options: DiffCommandOptions
): Promise<LineageCandidate[]> {
  const candidates: LineageCandidate[] = [];
  const validationResult = validateLineageOptions(options, env.commandLogger);

  if (!validationResult.isValid) {
    return [];
  }

  const similarityOptions = { threshold: 0.7 };
  const similarityManager = new SimilarityManager(undefined, env.storage, similarityOptions);
  // Only consider functions that actually changed between snapshots
  // This prevents false lineage matches with unrelated similar functions that existed in both snapshots
  const changedFunctions = [...diff.added, ...diff.modified.map(m => m.after)];

  // 1. Process removed functions (existing logic)
  const removedCandidates = await processRemovedFunctions(
    diff.removed,
    changedFunctions,
    similarityManager,
    validationResult,
    options,
    env.commandLogger
  );
  candidates.push(...removedCandidates);

  // 2. Process significantly modified functions (new Phase 2 logic)
  const modifiedCandidates = await processModifiedFunctions(diff, env, options);
  candidates.push(...modifiedCandidates);

  const deduplicatedCandidates = deduplicateCandidates(candidates);
  return deduplicatedCandidates.sort((a, b) => b.confidence - a.confidence);
}

async function processRemovedFunctions(
  removedFunctions: FunctionInfo[],
  changedFunctions: FunctionInfo[],
  similarityManager: SimilarityManager,
  validationResult: ValidationResult,
  options: DiffCommandOptions,
  logger: import('../../utils/cli-utils').Logger
): Promise<LineageCandidate[]> {
  if (removedFunctions.length === 0) {
    return [];
  }

  logger.info('Detecting lineage candidates for removed functions...');
  const candidates: LineageCandidate[] = [];

  for (const removedFunc of removedFunctions) {
    if (options.verbose) {
      logger.info(`Analyzing lineage for removed: ${removedFunc.name}`);
    }

    const functionCandidates = await processSingleFunction(
      removedFunc,
      changedFunctions,
      similarityManager,
      validationResult.threshold,
      validationResult.detectors
    );

    candidates.push(...functionCandidates);
  }

  return candidates;
}

async function processModifiedFunctions(
  diff: SnapshotDiff,
  env: CommandEnvironment,
  options: DiffCommandOptions
): Promise<LineageCandidate[]> {
  if (diff.modified.length === 0 || options.disableChangeDetection) {
    return [];
  }

  env.commandLogger.info('Analyzing significantly modified functions...');

  // Load change detection config
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const changeDetectorConfig: ChangeDetectorConfig = {
    ...DEFAULT_CHANGE_DETECTOR_CONFIG,
    ...config.changeDetection,
  };

  // Override min score if provided
  if (options.changeDetectionMinScore !== undefined) {
    changeDetectorConfig.minScoreForLineage = options.changeDetectionMinScore;
  }

  const changeDetector = new ChangeSignificanceDetector(changeDetectorConfig);
  const candidates: LineageCandidate[] = [];

  // Process significant modifications
  const modificationCandidates = await processSignificantModifications(
    diff.modified,
    changeDetector,
    changeDetectorConfig,
    options,
    env.commandLogger
  );
  candidates.push(...modificationCandidates);

  // Process function splits
  const splitCandidates = await processFunctionSplits(
    diff.removed,
    diff.added,
    changeDetector,
    changeDetectorConfig,
    options,
    env.commandLogger
  );
  candidates.push(...splitCandidates);

  return candidates;
}

async function processSignificantModifications(
  modifiedFunctions: FunctionChange[],
  changeDetector: ChangeSignificanceDetector,
  config: ChangeDetectorConfig,
  options: DiffCommandOptions,
  logger: import('../../utils/cli-utils').Logger
): Promise<LineageCandidate[]> {
  const minScore = config.minScoreForLineage ?? 50;
  const significantChanges = changeDetector.filterSignificantChanges(modifiedFunctions, minScore);

  if (significantChanges.length === 0) {
    return [];
  }

  logger.info(`Found ${significantChanges.length} significantly modified functions`);
  const candidates: LineageCandidate[] = [];

  for (const { change, significance } of significantChanges) {
    if (options.verbose) {
      logger.info(
        `Analyzing lineage for modified: ${change.before.name} (score: ${significance.score})`
      );
      logger.info(`  Reasons: ${significance.reasons.join('; ')}`);
    }

    const candidate: LineageCandidate = {
      fromFunction: change.before,
      toFunctions: [change.after],
      kind: 'signature-change',
      confidence: significance.score / 100,
      reason: `Significant modification detected: ${significance.reasons.join('; ')}`,
    };

    candidates.push(candidate);
  }

  return candidates;
}

async function processFunctionSplits(
  removedFunctions: FunctionInfo[],
  addedFunctions: FunctionInfo[],
  changeDetector: ChangeSignificanceDetector,
  config: ChangeDetectorConfig,
  options: DiffCommandOptions,
  logger: import('../../utils/cli-utils').Logger
): Promise<LineageCandidate[]> {
  if (
    config.enableFunctionSplitDetection === false ||
    removedFunctions.length === 0 ||
    addedFunctions.length < 2
  ) {
    return [];
  }

  const splits = changeDetector.detectFunctionSplits(removedFunctions, addedFunctions);
  const candidates: LineageCandidate[] = [];

  for (const split of splits) {
    if (options.verbose) {
      logger.info(
        `Detected potential function split: ${split.original.name} → ${split.candidates.map(c => c.name).join(', ')}`
      );
    }

    const candidate: LineageCandidate = {
      fromFunction: split.original,
      toFunctions: split.candidates,
      kind: 'split',
      confidence: split.confidence,
      reason: `Function likely split into ${split.candidates.length} functions`,
    };

    candidates.push(candidate);
  }

  return candidates;
}

interface ValidationResult {
  isValid: boolean;
  threshold: number;
  detectors: string[];
}

function validateLineageOptions(options: DiffCommandOptions, logger: import('../../utils/cli-utils').Logger): ValidationResult {
  // Validate threshold
  const threshold = options.lineageThreshold ? parseFloat(options.lineageThreshold) : 0.7;

  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    logger.error('Lineage threshold must be a number between 0 and 1');
    return { isValid: false, threshold: 0, detectors: [] };
  }

  // Validate detectors using SimilarityManager
  const lineageDetectors = options.lineageDetectors ? options.lineageDetectors.split(',') : [];

  if (lineageDetectors.length > 0) {
    // Create temporary SimilarityManager to get available detectors
    const tempSimilarityManager = new SimilarityManager();
    const validDetectors = tempSimilarityManager.getAvailableDetectors();

    const invalidDetectors = lineageDetectors.filter(d => !validDetectors.includes(d));
    if (invalidDetectors.length > 0) {
      logger.error(`Invalid detectors specified: ${invalidDetectors.join(', ')}`);
      logger.error(`Available detectors: ${validDetectors.join(', ')}`);
      return { isValid: false, threshold: 0, detectors: [] };
    }
  }

  return { isValid: true, threshold, detectors: lineageDetectors };
}

async function processSingleFunction(
  removedFunc: FunctionInfo,
  candidateFunctions: FunctionInfo[],
  similarityManager: SimilarityManager,
  threshold: number,
  detectors: string[]
): Promise<LineageCandidate[]> {
  const similarResults = await similarityManager.detectSimilarities(
    [removedFunc, ...candidateFunctions],
    {
      threshold,
      minLines: 1,
      crossFile: true,
    },
    detectors
  );

  return extractCandidatesFromResults(removedFunc, similarResults);
}

function extractCandidatesFromResults(
  removedFunc: FunctionInfo,
  similarResults: SimilarityResult[]
): LineageCandidate[] {
  const candidates: LineageCandidate[] = [];

  for (const result of similarResults) {
    const involvedFunctions = result.functions.filter(
      (f: SimilarFunction) => f.functionId !== removedFunc.id
    );

    if (involvedFunctions.length > 0) {
      const candidateKind = determineLineageKind(removedFunc, involvedFunctions);

      candidates.push({
        fromFunction: removedFunc,
        toFunctions: involvedFunctions.map((f: SimilarFunction) => f.originalFunction!),
        kind: candidateKind,
        confidence: result.similarity,
        reason: `${result.detector} detected ${(result.similarity * 100).toFixed(1)}% similarity`,
      });
    }
  }

  return candidates;
}

function determineLineageKind(
  fromFunction: FunctionInfo,
  toFunctions: SimilarFunction[]
): LineageKind {
  if (toFunctions.length === 1) {
    const toFunc = toFunctions[0];

    // Check for rename
    if (fromFunction.signature !== toFunc.originalFunction?.signature) {
      return 'signature-change';
    }

    if (fromFunction.name !== toFunc.functionName) {
      return 'rename';
    }

    // Default to rename for single function mapping
    return 'rename';
  } else {
    // Multiple functions indicate a split
    return 'split';
  }
}

function deduplicateCandidates(candidates: LineageCandidate[]): LineageCandidate[] {
  const seen = new Map<string, LineageCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.fromFunction.id}-${candidate.toFunctions
      .map(f => f.id)
      .sort()
      .join('-')}`;
    const existing = seen.get(key);

    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(key, candidate);
    }
  }

  return Array.from(seen.values());
}

function displayLineageCandidates(
  candidates: LineageCandidate[],
  options: DiffCommandOptions,
  logger: import('../../utils/cli-utils').Logger
): void {
  console.log(chalk.cyan.bold('\n🔗 Function Lineage Candidates\n'));

  if (candidates.length === 0) {
    logger.info('No lineage candidates found.');
    return;
  }

  candidates.forEach((candidate, index) => {
    console.log(chalk.yellow(`Candidate ${index + 1}:`));
    console.log(
      `  ${chalk.red('From:')} ${candidate.fromFunction.name} (${candidate.fromFunction.filePath}:${candidate.fromFunction.startLine})`
    );

    const kindIcon = getLineageKindIcon(candidate.kind);
    console.log(`  ${chalk.blue('Type:')} ${kindIcon} ${candidate.kind}`);
    console.log(`  ${chalk.green('Confidence:')} ${(candidate.confidence * 100).toFixed(1)}%`);
    console.log(`  ${chalk.gray('Reason:')} ${candidate.reason}`);

    console.log(`  ${chalk.cyan('To:')}`);
    candidate.toFunctions.forEach((toFunc, i) => {
      console.log(`    ${i + 1}. ${toFunc.name} (${toFunc.filePath}:${toFunc.startLine})`);
    });

    console.log();
  });

  if (!options.lineageAutoSave) {
    console.log(
      chalk.gray(
        'Use --lineage-auto-save to automatically save these candidates as draft lineages.'
      )
    );
  }
}

function getLineageKindIcon(kind: LineageKind): string {
  switch (kind) {
    case 'rename':
      return '✏️';
    case 'signature-change':
      return '🔄';
    case 'inline':
      return '📥';
    case 'split':
      return '✂️';
    default:
      return '❓';
  }
}

async function saveLineageCandidates(
  candidates: LineageCandidate[],
  env: CommandEnvironment
): Promise<void> {
  const git = simpleGit();
  let gitCommit = 'unknown';

  try {
    const log = await git.log({ n: 1 });
    gitCommit = log.latest?.hash || 'unknown';
  } catch {
    env.commandLogger.warn('Could not get git commit hash');
  }

  env.commandLogger.info('Saving lineage candidates as draft...');

  let savedCount = 0;
  for (const candidate of candidates) {
    const lineage: Lineage = {
      id: uuidv4(),
      fromIds: [candidate.fromFunction.id],
      toIds: candidate.toFunctions.map(f => f.id),
      kind: candidate.kind,
      status: 'draft',
      confidence: candidate.confidence,
      note: `Auto-detected: ${candidate.reason}`,
      gitCommit,
      createdAt: new Date(),
    };

    try {
      await env.storage.saveLineage(lineage);
      savedCount++;
    } catch (error) {
      env.commandLogger.error(`Failed to save lineage for ${candidate.fromFunction.name}:`, error);
    }
  }

  env.commandLogger.success(`Saved ${savedCount} lineage candidates as draft.`);
}