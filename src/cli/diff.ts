import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter, DatabaseError } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
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
} from '../types';
import { SimilarityManager } from '../similarity/similarity-manager';
import { v4 as uuidv4 } from 'uuid';
import simpleGit, { SimpleGit } from 'simple-git';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { QualityCalculator } from '../metrics/quality-calculator';
import * as fs from 'fs';
import * as path from 'path';
import {
  ChangeSignificanceDetector,
  ChangeDetectorConfig,
  DEFAULT_CHANGE_DETECTOR_CONFIG,
} from './diff/changeDetector';
import { ErrorCode, createErrorHandler } from '../utils/error-handler';

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

export async function diffCommand(
  fromSnapshot: string,
  toSnapshot: string,
  options: DiffCommandOptions
): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  const errorHandler = createErrorHandler(logger);

  try {
    const { storage, fromId, toId } = await setupDiffCommand(fromSnapshot, toSnapshot, options, logger);

    if (fromId === toId) {
      displayIdenticalSnapshots(fromId, toId);
      return;
    }

    const diff = await calculateDiff(storage, fromId, toId, logger);
    await processDiffResults(diff, storage, options, logger);
    await storage.close();
  } catch (error) {
    handleDiffError(error, errorHandler);
  }
}

async function setupDiffCommand(
  fromSnapshot: string,
  toSnapshot: string,
  _options: DiffCommandOptions,
  logger: Logger
) {
  const configManager = new ConfigManager();
  const config = await configManager.load();

  const storage = new PGLiteStorageAdapter(config.storage.path!);
  await storage.init();

  const fromId = await resolveSnapshotId(storage, fromSnapshot);
  const toId = await resolveSnapshotId(storage, toSnapshot);

  if (!fromId || !toId) {
    logger.error(`Snapshot not found: ${!fromId ? fromSnapshot : toSnapshot}`);
    process.exit(1);
  }

  return { storage, fromId, toId };
}

function displayIdenticalSnapshots(fromId: string, toId: string): void {
  console.log('\n📊 Diff Summary\n');
  console.log(`From: ${fromId.substring(0, 8)} (same snapshot)`);
  console.log(`To: ${toId.substring(0, 8)} (same snapshot)`);
  console.log('\nChanges:');
  console.log('  + 0 functions added');
  console.log('  - 0 functions removed');
  console.log('  ~ 0 functions modified');
  console.log('  = No changes (identical snapshots)');
}

async function calculateDiff(storage: any, fromId: string, toId: string, logger: Logger) {
  logger.info('Calculating differences...');
  return await storage.diffSnapshots(fromId, toId);
}

async function processDiffResults(diff: any, storage: any, options: DiffCommandOptions, logger: Logger) {
  if (options.lineage && diff.removed.length > 0) {
    await handleLineageDetection(diff, storage, options, logger);
  } else {
    displayDiffResults(diff, options);
  }
}

async function handleLineageDetection(diff: any, storage: any, options: DiffCommandOptions, logger: Logger) {
  const lineageCandidates = await detectLineageCandidates(diff, storage, options, logger);

  if (lineageCandidates.length > 0) {
    if (options.json) {
      console.log(JSON.stringify({ diff, lineageCandidates }, null, 2));
    } else {
      displayLineageCandidates(lineageCandidates, options, logger);
      if (options.lineageAutoSave) {
        await saveLineageCandidates(lineageCandidates, storage, logger);
      }
    }
  } else {
    logger.info('No lineage candidates found for removed functions.');
  }
}

function displayDiffResults(diff: any, options: DiffCommandOptions): void {
  if (options.json) {
    console.log(JSON.stringify(diff, null, 2));
  } else if (options.summary) {
    displaySummary(diff);
  } else {
    displayFullDiff(diff, options);
  }
}

function handleDiffError(error: unknown, errorHandler: any): void {
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

async function resolveSnapshotId(
  storage: PGLiteStorageAdapter,
  identifier: string
): Promise<string | null> {
  // Try exact match first
  const exact = await storage.getSnapshot(identifier);
  if (exact) return identifier;

  // Try partial ID match with collision detection
  const snapshots = await storage.getSnapshots();
  const partialMatches = snapshots.filter(s => s.id.startsWith(identifier));

  if (partialMatches.length === 1) {
    return partialMatches[0].id;
  } else if (partialMatches.length > 1) {
    const matchList = partialMatches.map(s => s.id.substring(0, 8)).join(', ');
    throw new Error(
      `Ambiguous snapshot ID '${identifier}' matches ${partialMatches.length} snapshots: ${matchList}. Please provide more characters.`
    );
  }

  // Try label match
  const labeled = snapshots.find(s => s.label === identifier);
  if (labeled) return labeled.id;

  // Try special keywords
  if (identifier === 'latest' || identifier === 'HEAD') {
    const latest = snapshots[0]; // snapshots are ordered by created_at DESC
    return latest ? latest.id : null;
  }

  if (identifier.startsWith('HEAD~')) {
    const offset = parseInt(identifier.slice(5)) || 1;
    const target = snapshots[offset];
    return target ? target.id : null;
  }

  // Try git commit reference - NEW FUNCTIONALITY
  const gitCommitId = await resolveGitCommitReference(storage, identifier);
  if (gitCommitId) return gitCommitId;

  return null;
}

async function resolveGitCommitReference(
  storage: PGLiteStorageAdapter,
  identifier: string
): Promise<string | null> {
  try {
    const git = simpleGit();

    // Check if identifier looks like a git reference
    const isGitReference = await isValidGitReference(git, identifier);
    if (!isGitReference) return null;

    // Get actual commit hash
    const commitHash = await git.revparse([identifier]);

    // Check if we already have a snapshot for this commit
    const existingSnapshot = await findSnapshotByGitCommit(storage, commitHash);
    if (existingSnapshot) {
      return existingSnapshot.id;
    }

    // Create snapshot for this commit
    const snapshotId = await createSnapshotForGitCommit(storage, git, identifier, commitHash);
    return snapshotId;
  } catch {
    // Not a valid git reference, return null to continue with other resolution methods
    return null;
  }
}

async function isValidGitReference(git: SimpleGit, identifier: string): Promise<boolean> {
  try {
    // Check for commit hash pattern (7-40 hex chars)
    if (/^[0-9a-f]{7,40}$/i.test(identifier)) {
      return true;
    }

    // Check for git references (HEAD~N, branch names, tag names)
    if (identifier.startsWith('HEAD~') || identifier.startsWith('HEAD^')) {
      return true;
    }

    // Check if it's a valid branch/tag name
    const branches = await git.branchLocal();
    if (branches.all.includes(identifier)) {
      return true;
    }

    const tags = await git.tags();
    if (tags.all.includes(identifier)) {
      return true;
    }

    // Try to resolve as git reference
    await git.revparse([identifier]);
    return true;
  } catch {
    return false;
  }
}

async function findSnapshotByGitCommit(
  storage: PGLiteStorageAdapter,
  commitHash: string
): Promise<{ id: string } | null> {
  const snapshots = await storage.getSnapshots();
  return snapshots.find(s => s.gitCommit === commitHash) || null;
}

async function createSnapshotForGitCommit(
  storage: PGLiteStorageAdapter,
  git: SimpleGit,
  identifier: string,
  commitHash: string
): Promise<string> {
  const tempDir = path.join(process.cwd(), '.funcqc-temp', `snapshot-${uuidv4()}`);

  try {
    // Create worktree for the specific commit
    await fs.promises.mkdir(tempDir, { recursive: true });
    await git.raw(['worktree', 'add', tempDir, commitHash]);

    // Get commit info for labeling
    const commitInfo = await git.show([commitHash, '--no-patch', '--format=%s']);
    const commitMessage = commitInfo.split('\n')[0] || 'Unknown commit';

    // Create label for the snapshot
    const label = `${identifier}@${commitHash.substring(0, 8)}`;
    const description = `Auto-created snapshot for ${identifier}: ${commitMessage}`;

    // Analyze functions in the worktree
    const analyzer = new TypeScriptAnalyzer();
    const calculator = new QualityCalculator();

    // Find TypeScript files in the worktree
    const tsFiles = await findTypeScriptFiles(tempDir);

    // Analyze all files and collect functions
    const allFunctions: FunctionInfo[] = [];
    for (const filePath of tsFiles) {
      const functions = await analyzer.analyzeFile(filePath);
      allFunctions.push(...functions);
    }

    // Add metrics to functions
    const functionsWithMetrics = await Promise.all(
      allFunctions.map(async (func: FunctionInfo) => ({
        ...func,
        metrics: await calculator.calculate(func),
      }))
    );

    // Create snapshot using existing saveSnapshot method
    const snapshotId = await storage.saveSnapshot(functionsWithMetrics, label, description);

    return snapshotId;
  } finally {
    // Clean up worktree
    try {
      await git.raw(['worktree', 'remove', tempDir, '--force']);
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function findTypeScriptFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip common non-source directories
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile()) {
        // Include TypeScript files
        if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return files;
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

  // Filter and display functions
  const filtered = filterFunctions(diff, options);

  // Display each category
  displayAddedFunctions(filtered.added, options);
  displayRemovedFunctions(filtered.removed, options);
  displayModifiedFunctions(filtered.modified, options);

  // Display statistics
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

function displayAddedFunctions(functions: FunctionInfo[], options: DiffCommandOptions): void {
  if (functions.length === 0) return;

  console.log(chalk.green.bold(`➕ Added Functions (${functions.length})`));
  functions.forEach(func => {
    console.log(`  ${chalk.green('+')} ${func.name} in ${func.filePath}:${func.startLine}`);
    if (options.verbose && func.metrics) {
      console.log(
        `     Complexity: ${func.metrics.cyclomaticComplexity}, Lines: ${func.metrics.linesOfCode}`
      );
    }
  });
  console.log();
}

function displayRemovedFunctions(functions: FunctionInfo[], options: DiffCommandOptions): void {
  if (functions.length === 0) return;

  console.log(chalk.red.bold(`➖ Removed Functions (${functions.length})`));
  functions.forEach(func => {
    console.log(`  ${chalk.red('-')} ${func.name} in ${func.filePath}:${func.startLine}`);
    if (options.verbose && func.metrics) {
      console.log(
        `     Complexity: ${func.metrics.cyclomaticComplexity}, Lines: ${func.metrics.linesOfCode}`
      );
    }
  });
  console.log();
}

function displayModifiedFunctions(functions: FunctionChange[], options: DiffCommandOptions): void {
  functions.forEach(func => {
    const name = func.after.name || func.before.name;
    const file = func.after.filePath || func.before.filePath;
    const line = func.after.startLine || func.before.startLine;

    console.log(`  ${chalk.yellow('~')} ${name} in ${file}:${line}`);

    // Show changes
    func.changes.forEach(change => {
      if (options.threshold && isNumericChange(change)) {
        const oldVal = Number(change.oldValue);
        const newVal = Number(change.newValue);
        const diff = Math.abs(newVal - oldVal);

        if (diff < options.threshold) {
          return; // Skip small changes
        }
      }

      displayChange(change, options.verbose);
    });

    if (options.verbose) {
      console.log(); // Extra line for verbose mode
    }
  });
}

function displayChange(change: ChangeDetail, verbose: boolean = false): void {
  const { field, oldValue, newValue, impact } = change;

  // Skip location fields as they are not quality metrics
  if (field === 'startLine' || field === 'endLine') {
    return;
  }

  const impactIcon = {
    low: '🟢',
    medium: '🟡',
    high: '🔴',
  }[impact];

  const impactColor = {
    low: chalk.green,
    medium: chalk.yellow,
    high: chalk.red,
  }[impact];

  if (isNumericChange(change)) {
    const oldVal = Number(oldValue);
    const newVal = Number(newValue);
    const diff = newVal - oldVal;
    const diffStr = diff > 0 ? `+${diff}` : diff.toString();

    console.log(`     ${impactIcon} ${field}: ${oldVal} → ${newVal} (${impactColor(diffStr)})`);
  } else {
    if (verbose) {
      console.log(`     ${impactIcon} ${field}:`);
      console.log(`       Before: ${oldValue}`);
      console.log(`       After:  ${newValue}`);
    } else {
      console.log(`     ${impactIcon} ${field}: ${String(oldValue)} → ${String(newValue)}`);
    }
  }
}

function isNumericChange(change: ChangeDetail): boolean {
  return !isNaN(Number(change.oldValue)) && !isNaN(Number(change.newValue));
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
  storage: PGLiteStorageAdapter,
  options: DiffCommandOptions,
  logger: Logger
): Promise<LineageCandidate[]> {
  const candidates: LineageCandidate[] = [];
  const validationResult = validateLineageOptions(options, logger);

  if (!validationResult.isValid) {
    return [];
  }

  const similarityManager = new SimilarityManager(undefined, storage);
  const allFunctions = [...diff.added, ...diff.modified.map(m => m.after), ...diff.unchanged];

  // 1. Process removed functions (existing logic)
  const removedCandidates = await processRemovedFunctions(
    diff.removed,
    allFunctions,
    similarityManager,
    validationResult,
    options,
    logger
  );
  candidates.push(...removedCandidates);

  // 2. Process significantly modified functions (new Phase 2 logic)
  const modifiedCandidates = await processModifiedFunctions(diff, options, logger);
  candidates.push(...modifiedCandidates);

  const deduplicatedCandidates = deduplicateCandidates(candidates);
  return deduplicatedCandidates.sort((a, b) => b.confidence - a.confidence);
}

async function processRemovedFunctions(
  removedFunctions: FunctionInfo[],
  allFunctions: FunctionInfo[],
  similarityManager: SimilarityManager,
  validationResult: ValidationResult,
  options: DiffCommandOptions,
  logger: Logger
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
      allFunctions,
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
  options: DiffCommandOptions,
  logger: Logger
): Promise<LineageCandidate[]> {
  if (diff.modified.length === 0 || options.disableChangeDetection) {
    return [];
  }

  logger.info('Analyzing significantly modified functions...');

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
    logger
  );
  candidates.push(...modificationCandidates);

  // Process function splits
  const splitCandidates = await processFunctionSplits(
    diff.removed,
    diff.added,
    changeDetector,
    changeDetectorConfig,
    options,
    logger
  );
  candidates.push(...splitCandidates);

  return candidates;
}

async function processSignificantModifications(
  modifiedFunctions: FunctionChange[],
  changeDetector: ChangeSignificanceDetector,
  config: ChangeDetectorConfig,
  options: DiffCommandOptions,
  logger: Logger
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
  logger: Logger
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

function validateLineageOptions(options: DiffCommandOptions, logger: Logger): ValidationResult {
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
  allFunctions: FunctionInfo[],
  similarityManager: SimilarityManager,
  threshold: number,
  detectors: string[]
): Promise<LineageCandidate[]> {
  const similarResults = await similarityManager.detectSimilarities(
    [removedFunc, ...allFunctions],
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
  logger: Logger
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
  storage: PGLiteStorageAdapter,
  logger: Logger
): Promise<void> {
  const git = simpleGit();
  let gitCommit = 'unknown';

  try {
    const log = await git.log({ n: 1 });
    gitCommit = log.latest?.hash || 'unknown';
  } catch {
    logger.warn('Could not get git commit hash');
  }

  logger.info('Saving lineage candidates as draft...');

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
      await storage.saveLineage(lineage);
      savedCount++;
    } catch (error) {
      logger.error(`Failed to save lineage for ${candidate.fromFunction.name}:`, error);
    }
  }

  logger.success(`Saved ${savedCount} lineage candidates as draft.`);
}
