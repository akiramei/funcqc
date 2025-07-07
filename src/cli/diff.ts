import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import { CommandOptions, SnapshotDiff, FunctionChange, ChangeDetail, FunctionInfo, Lineage, LineageCandidate, LineageKind } from '../types';
import { SimilarityManager } from '../similarity/similarity-manager';
import { v4 as uuidv4 } from 'uuid';
import simpleGit from 'simple-git';

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
}

export async function diffCommand(
  fromSnapshot: string, 
  toSnapshot: string, 
  options: DiffCommandOptions
): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();

    // Resolve snapshot IDs (support partial IDs and labels)
    const fromId = await resolveSnapshotId(storage, fromSnapshot);
    const toId = await resolveSnapshotId(storage, toSnapshot);

    if (!fromId || !toId) {
      logger.error(`Snapshot not found: ${!fromId ? fromSnapshot : toSnapshot}`);
      process.exit(1);
    }

    // Calculate diff
    logger.info('Calculating differences...');
    const diff = await storage.diffSnapshots(fromId, toId);

    // Handle lineage detection if requested
    if (options.lineage && diff.removed.length > 0) {
      const lineageCandidates = await detectLineageCandidates(
        diff,
        storage,
        options,
        logger
      );

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
    } else {
      // Output regular diff results
      if (options.json) {
        console.log(JSON.stringify(diff, null, 2));
      } else if (options.summary) {
        displaySummary(diff);
      } else {
        displayFullDiff(diff, options);
      }
    }

    await storage.close();
  } catch (error) {
    logger.error('Failed to calculate diff', error);
    process.exit(1);
  }
}

async function resolveSnapshotId(storage: PGLiteStorageAdapter, identifier: string): Promise<string | null> {
  // Try exact match first
  const exact = await storage.getSnapshot(identifier);
  if (exact) return identifier;

  // Try partial ID match
  const snapshots = await storage.getSnapshots();
  const partial = snapshots.find(s => s.id.startsWith(identifier));
  if (partial) return partial.id;

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

  return null;
}

function displaySummary(diff: SnapshotDiff): void {
  const stats = diff.statistics;
  
  console.log(chalk.cyan.bold('\n📊 Diff Summary\n'));
  
  // Basic stats
  console.log(`${chalk.bold('From:')} ${diff.from.label || diff.from.id.substring(0, 8)} (${formatDate(diff.from.createdAt)})`);
  console.log(`${chalk.bold('To:')} ${diff.to.label || diff.to.id.substring(0, 8)} (${formatDate(diff.to.createdAt)})`);
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
    console.log(`${chalk.bold('Complexity:')} ${complexityIcon} ${complexityColor(stats.complexityChange > 0 ? '+' : '')}${stats.complexityChange}`);
  }

  if (stats.linesChange !== 0) {
    const linesIcon = stats.linesChange > 0 ? '📝' : '✂️';
    const linesColor = stats.linesChange > 0 ? chalk.blue : chalk.gray;
    console.log(`${chalk.bold('Lines:')} ${linesIcon} ${linesColor(stats.linesChange > 0 ? '+' : '')}${stats.linesChange}`);
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
  console.log(`${chalk.bold('From:')} ${diff.from.label || diff.from.id.substring(0, 8)} (${formatDate(diff.from.createdAt)})`);
  console.log(`${chalk.bold('To:')} ${diff.to.label || diff.to.id.substring(0, 8)} (${formatDate(diff.to.createdAt)})`);
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
    modified = modified.filter(f => 
      f.before.name.toLowerCase().includes(pattern) || 
      f.after.name.toLowerCase().includes(pattern)
    );
  }
  
  // Apply file path filter
  if (options.file) {
    const pattern = options.file.toLowerCase();
    added = filterByFilePath(added, pattern);
    removed = filterByFilePath(removed, pattern);
    modified = modified.filter(f => 
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
      console.log(`     Complexity: ${func.metrics.cyclomaticComplexity}, Lines: ${func.metrics.linesOfCode}`);
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
      console.log(`     Complexity: ${func.metrics.cyclomaticComplexity}, Lines: ${func.metrics.linesOfCode}`);
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
  
  const impactIcon = {
    low: '🟢',
    medium: '🟡', 
    high: '🔴'
  }[impact];
  
  const impactColor = {
    low: chalk.green,
    medium: chalk.yellow,
    high: chalk.red
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
  
  if (diff.removed.length === 0) {
    return candidates;
  }

  logger.info('Detecting lineage candidates for removed functions...');
  
  // Get similarity threshold
  const threshold = options.lineageThreshold ? parseFloat(options.lineageThreshold) : 0.7;
  
  // Initialize similarity manager
  const similarityManager = new SimilarityManager(undefined, storage);
  
  // Prepare all functions for similarity comparison
  const allFunctions = [...diff.added, ...diff.modified.map(m => m.after), ...diff.unchanged];
  
  // Process each removed function
  for (const removedFunc of diff.removed) {
    if (options.verbose) {
      logger.info(`Analyzing lineage for: ${removedFunc.name}`);
    }
    
    // Find similar functions
    const similarResults = await similarityManager.detectSimilarities(
      [removedFunc, ...allFunctions],
      { 
        threshold,
        minLines: 1,
        crossFile: true
      },
      options.lineageDetectors ? options.lineageDetectors.split(',') : []
    );
    
    // Extract candidates from similarity results
    for (const result of similarResults) {
      const involvedFunctions = result.functions.filter(f => 
        f.functionId !== removedFunc.id
      );
      
      if (involvedFunctions.length > 0) {
        const candidateKind = determineLineageKind(removedFunc, involvedFunctions);
        
        candidates.push({
          fromFunction: removedFunc,
          toFunctions: involvedFunctions.map(f => f.originalFunction!).filter(f => f !== undefined),
          kind: candidateKind,
          confidence: result.similarity,
          reason: `${result.detector} detected ${(result.similarity * 100).toFixed(1)}% similarity`
        });
      }
    }
  }
  
  // Deduplicate and sort by confidence
  const deduplicatedCandidates = deduplicateCandidates(candidates);
  return deduplicatedCandidates.sort((a, b) => b.confidence - a.confidence);
}

function determineLineageKind(
  fromFunction: FunctionInfo,
  toFunctions: { functionName: string; originalFunction?: FunctionInfo }[]
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
    const key = `${candidate.fromFunction.id}-${candidate.toFunctions.map(f => f.id).sort().join('-')}`;
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
    console.log(`  ${chalk.red('From:')} ${candidate.fromFunction.name} (${candidate.fromFunction.filePath}:${candidate.fromFunction.startLine})`);
    
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
    console.log(chalk.gray('Use --lineage-auto-save to automatically save these candidates as draft lineages.'));
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
      createdAt: new Date()
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