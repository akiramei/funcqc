import chalk from 'chalk';
import { table } from 'table';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import { CommandOptions, SnapshotDiff, FunctionChange, ChangeDetail } from '../types';

export interface DiffCommandOptions extends CommandOptions {
  summary?: boolean;
  function?: string;
  file?: string;
  metric?: string;
  threshold?: number;
  json?: boolean;
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

    // Output results
    if (options.json) {
      console.log(JSON.stringify(diff, null, 2));
    } else if (options.summary) {
      displaySummary(diff);
    } else {
      displayFullDiff(diff, options);
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
  console.log(`${chalk.bold('From:')} ${diff.from.label || diff.from.id.substring(0, 8)} (${formatDate(diff.from.createdAt)})`);
  console.log(`${chalk.bold('To:')} ${diff.to.label || diff.to.id.substring(0, 8)} (${formatDate(diff.to.createdAt)})`);
  console.log();

  // Filter functions if specified
  let addedFunctions = diff.added;
  let removedFunctions = diff.removed;
  let modifiedFunctions = diff.modified;

  if (options.function) {
    const pattern = options.function.toLowerCase();
    addedFunctions = addedFunctions.filter(f => f.name.toLowerCase().includes(pattern));
    removedFunctions = removedFunctions.filter(f => f.name.toLowerCase().includes(pattern));
    modifiedFunctions = modifiedFunctions.filter(f => 
      f.before.name.toLowerCase().includes(pattern) || 
      f.after.name.toLowerCase().includes(pattern)
    );
  }

  if (options.file) {
    const pattern = options.file.toLowerCase();
    addedFunctions = addedFunctions.filter(f => f.filePath.toLowerCase().includes(pattern));
    removedFunctions = removedFunctions.filter(f => f.filePath.toLowerCase().includes(pattern));
    modifiedFunctions = modifiedFunctions.filter(f => 
      f.before.filePath.toLowerCase().includes(pattern) || 
      f.after.filePath.toLowerCase().includes(pattern)
    );
  }

  // Display added functions
  if (addedFunctions.length > 0) {
    console.log(chalk.green.bold(`➕ Added Functions (${addedFunctions.length})`));
    addedFunctions.forEach(func => {
      console.log(`  ${chalk.green('+')} ${func.name} in ${func.filePath}:${func.startLine}`);
      if (options.verbose && func.metrics) {
        console.log(`     Complexity: ${func.metrics.cyclomaticComplexity}, Lines: ${func.metrics.linesOfCode}`);
      }
    });
    console.log();
  }

  // Display removed functions
  if (removedFunctions.length > 0) {
    console.log(chalk.red.bold(`➖ Removed Functions (${removedFunctions.length})`));
    removedFunctions.forEach(func => {
      console.log(`  ${chalk.red('-')} ${func.name} in ${func.filePath}:${func.startLine}`);
      if (options.verbose && func.metrics) {
        console.log(`     Complexity: ${func.metrics.cyclomaticComplexity}, Lines: ${func.metrics.linesOfCode}`);
      }
    });
    console.log();
  }

  // Display modified functions
  if (modifiedFunctions.length > 0) {
    console.log(chalk.yellow.bold(`📝 Modified Functions (${modifiedFunctions.length})`));
    
    if (options.metric) {
      // Filter by specific metric changes
      const filteredModified = modifiedFunctions.filter(func => 
        func.changes.some(change => change.field === options.metric)
      );
      displayModifiedFunctions(filteredModified, options);
    } else {
      displayModifiedFunctions(modifiedFunctions, options);
    }
  }

  // Display statistics
  displaySummary(diff);
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