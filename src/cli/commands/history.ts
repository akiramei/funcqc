import chalk from 'chalk';
import { 
  HistoryCommandOptions, 
  FunctionInfo, 
  SnapshotInfo, 
  SnapshotMetadata 
} from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { formatDuration } from '../../utils/file-utils';

/**
 * History command as a Reader function
 * Uses shared storage and config from environment
 */
export const historyCommand: VoidCommand<HistoryCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (options.id) {
        // Function tracking mode
        await displayFunctionHistory(options.id, options, env);
      } else {
        // Standard snapshot history mode
        await displaySnapshotHistory(options, env);
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
          `Failed to retrieve history: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

interface ParsedHistoryOptions {
  limit: number;
  since: Date | undefined;
  until: Date | undefined;
}

function parseHistoryOptions(options: HistoryCommandOptions): ParsedHistoryOptions {
  return {
    limit: options.limit ? parseInt(options.limit) : 20,
    since: options.since ? new Date(options.since) : undefined,
    until: options.until ? new Date(options.until) : undefined
  };
}

function applySnapshotFilters(
  snapshots: SnapshotInfo[],
  options: HistoryCommandOptions,
  parsed: ParsedHistoryOptions
): SnapshotInfo[] {
  let filtered = snapshots;

  if (parsed.since) {
    filtered = filtered.filter(s => s.createdAt >= parsed.since!.getTime());
  }

  if (parsed.until) {
    filtered = filtered.filter(s => s.createdAt <= parsed.until!.getTime());
  }

  if (options.branch) {
    filtered = filtered.filter(s => s.gitBranch === options.branch);
  }

  if (options.label) {
    filtered = filtered.filter(s => s.label?.includes(options.label!));
  }

  return filtered;
}

async function displaySnapshotHistory(
  options: HistoryCommandOptions,
  env: CommandEnvironment
): Promise<void> {
  const parsed = parseHistoryOptions(options);
  
  const snapshots = await env.storage.getSnapshots({ limit: parsed.limit });
  
  if (snapshots.length === 0) {
    env.commandLogger.info('No snapshots found. Run `funcqc scan` to create your first snapshot.');
    return;
  }

  const filteredSnapshots = applySnapshotFilters(snapshots, options, parsed);
  const isJsonMode = options.json || process.argv.includes('--json');
  
  if (isJsonMode) {
    displaySnapshotHistoryJSON(filteredSnapshots);
    return;
  }

  console.log(chalk.cyan.bold(`\n📈 Snapshot History (${filteredSnapshots.length} snapshots)\n`));

  const isVerboseMode = options.verbose || process.argv.includes('--verbose');
  
  if (isVerboseMode) {
    await displayDetailedHistory(filteredSnapshots, env);
  } else {
    displayCompactHistory(filteredSnapshots);
  }

  // Summary removed - not particularly useful
}

function displaySnapshotHistoryJSON(snapshots: SnapshotInfo[]): void {
  const output = {
    snapshots: snapshots.map(snapshot => ({
      id: snapshot.id,
      label: snapshot.label || null,
      comment: snapshot.comment || null,
      createdAt: new Date(snapshot.createdAt).toISOString(),
      gitBranch: snapshot.gitBranch || null,
      gitCommit: snapshot.gitCommit || null,
      metadata: {
        totalFunctions: snapshot.metadata.totalFunctions,
        totalFiles: snapshot.metadata.totalFiles,
        avgComplexity: snapshot.metadata.avgComplexity,
        maxComplexity: snapshot.metadata.maxComplexity,
        exportedFunctions: snapshot.metadata.exportedFunctions,
        asyncFunctions: snapshot.metadata.asyncFunctions,
        complexityDistribution: snapshot.metadata.complexityDistribution,
        fileExtensions: snapshot.metadata.fileExtensions
      }
    })),
    summary: {
      totalSnapshots: snapshots.length,
      period: snapshots.length > 1 
        ? formatDuration(snapshots[0].createdAt - snapshots[snapshots.length - 1].createdAt)
        : 'single snapshot',
      averageFunctionsPerSnapshot: snapshots.length > 0 
        ? Math.round(snapshots.reduce((sum, s) => sum + s.metadata.totalFunctions, 0) / snapshots.length)
        : 0,
      overallAvgComplexity: snapshots.length > 0
        ? (snapshots.reduce((sum, s) => sum + s.metadata.avgComplexity * s.metadata.totalFunctions, 0) / 
           snapshots.reduce((sum, s) => sum + s.metadata.totalFunctions, 0))
        : 0,
      gitBranches: Array.from(new Set(snapshots.filter(s => s.gitBranch).map(s => s.gitBranch)))
    }
  };

  console.log(JSON.stringify(output, null, 2));
}

function truncateWithEllipsis(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) {
    return str;
  }
  // Reserve 3 characters for ellipsis
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Display a shortened version of snapshot ID for table display
 * Uses 8 characters for consistency with function IDs
 */
function formatSnapshotIdForDisplay(id: string): string {
  return id.substring(0, 8);
}

function displayCompactHistory(snapshots: SnapshotInfo[]): void {
  // Display header with fixed-width columns
  console.log(
    'ID       Created       Functions +/-      Files +/-    Size'
  );
  console.log(
    '-------- ------------- --------- -------- ----- ------ ----------'
  );

  // Display each snapshot
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const prevSnapshot = i < snapshots.length - 1 ? snapshots[i + 1] : null;

    const id = formatSnapshotIdForDisplay(snapshot.id);
    const created = formatRelativeDate(snapshot.createdAt).padEnd(13);

    // Functions with diff
    const currentFunctions = snapshot.metadata.totalFunctions;
    const prevFunctions = prevSnapshot?.metadata.totalFunctions || 0;
    const functionDiff = prevSnapshot ? currentFunctions - prevFunctions : 0;
    const functionsDisplay = currentFunctions.toString().padStart(9);
    const functionsDiffDisplay = formatDiffValue(functionDiff, 8);

    // Files count
    const currentFiles = snapshot.metadata.totalFiles;
    const prevFiles = prevSnapshot?.metadata.totalFiles || 0;
    const filesDiff = prevSnapshot ? currentFiles - prevFiles : 0;
    const filesDisplay = currentFiles.toString().padStart(5);
    const filesDiffDisplay = formatDiffValue(filesDiff, 6);

    // Size estimation (rough LOC calculation)
    const sizeDisplay = formatSizeDisplay(snapshot.metadata);

    console.log(
      `${id} ${created} ${functionsDisplay} ${functionsDiffDisplay} ${filesDisplay} ${filesDiffDisplay} ${sizeDisplay}`
    );
  }
}

async function displayDetailedHistory(
  snapshots: SnapshotInfo[],
  env: CommandEnvironment
): Promise<void> {
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const prevSnapshot = snapshots[i + 1];

    // Display basic snapshot info
    displaySnapshotInfo(snapshot);

    // Display metadata
    displaySnapshotMetadata(snapshot.metadata);

    // Display distributions if available
    displayComplexityDistribution(snapshot.metadata.complexityDistribution);
    displayFileExtensions(snapshot.metadata.fileExtensions);

    // Display changes since previous
    if (prevSnapshot) {
      await displaySnapshotChanges(prevSnapshot.id, snapshot.id, env);
    }

    console.log(''); // Empty line
  }
}

function displaySnapshotInfo(snapshot: SnapshotInfo): void {
  console.log(chalk.yellow(`📸 Snapshot ${snapshot.id}`));
  console.log(`   Label: ${snapshot.label || chalk.gray('(none)')}`);
  console.log(
    `   Comment: ${snapshot.comment ? chalk.green(snapshot.comment) : chalk.gray('(none)')}`
  );
  console.log(`   Created: ${formatDate(snapshot.createdAt)}`);

  if (snapshot.gitBranch) {
    console.log(
      `   Git: ${snapshot.gitBranch}@${snapshot.gitCommit?.substring(0, 7) || 'unknown'}`
    );
  }
}

function displaySnapshotMetadata(metadata: SnapshotMetadata): void {
  console.log(`   Functions: ${metadata.totalFunctions}`);
  console.log(`   Files: ${metadata.totalFiles}`);
  console.log(`   Avg Complexity: ${metadata.avgComplexity.toFixed(1)}`);
  console.log(`   Max Complexity: ${metadata.maxComplexity}`);
  console.log(`   Exported: ${metadata.exportedFunctions}`);
  console.log(`   Async: ${metadata.asyncFunctions}`);
}

function displayComplexityDistribution(distribution: Record<string, number> | undefined): void {
  if (!distribution) return;

  const formattedDist = Object.entries(distribution)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([complexity, count]) => `${complexity}:${count}`)
    .slice(0, 5) // Show top 5
    .join(', ');

  console.log(`   Complexity dist: ${formattedDist}`);
}

function displayFileExtensions(extensions: Record<string, number> | undefined): void {
  if (!extensions) return;

  const formattedExts = Object.entries(extensions)
    .map(([ext, count]) => `${ext}:${count}`)
    .join(', ');

  console.log(`   Extensions: ${formattedExts}`);
}

async function displaySnapshotChanges(
  _prevSnapshotId: string,
  _currentSnapshotId: string,
  env: CommandEnvironment
): Promise<void> {
  try {
    const diff = await env.storage.diffSnapshots(_prevSnapshotId, _currentSnapshotId);
    const changes = diff.statistics.totalChanges;

    if (changes > 0) {
      console.log(
        chalk.blue(
          `   Changes: +${diff.statistics.addedCount} -${diff.statistics.removedCount} ~${diff.statistics.modifiedCount}`
        )
      );

      if (diff.statistics.complexityChange !== 0) {
        const complexityIcon = diff.statistics.complexityChange > 0 ? '📈' : '📉';
        const complexityColor = diff.statistics.complexityChange > 0 ? chalk.red : chalk.green;
        console.log(
          `   Complexity: ${complexityIcon} ${complexityColor(diff.statistics.complexityChange > 0 ? '+' : '')}${diff.statistics.complexityChange}`
        );
      }
    }
  } catch (error) {
    env.commandLogger.debug('Failed to calculate diff', error);
  }
}

// Summary function removed - was not providing useful insights


export function formatFunctionCountWithDiff(currentCount: number, diff: number): string {
  if (diff === 0) {
    return currentCount.toString().padStart(12);
  }

  const sign = diff > 0 ? '+' : '';
  const diffStr = `(${sign}${diff})`;
  const combined = `${currentCount}${diffStr}`;
  return combined.padStart(12);
}

export function formatFileCountWithDiff(currentCount: number, diff: number): string {
  if (diff === 0) {
    return currentCount.toString().padStart(9);
  }

  const sign = diff > 0 ? '+' : '';
  const diffStr = `(${sign}${diff})`;
  const combined = `${currentCount}${diffStr}`;
  return combined.padStart(9);
}

export function formatSizeDisplay(metadata: SnapshotMetadata): string {
  // Rough estimation: average 50 LOC per function
  const estimatedLOC = metadata.totalFunctions * 50;
  
  if (estimatedLOC === 0) {
    return '0'.padStart(10);
  }
  
  if (estimatedLOC >= 1000000) {
    return `~${Math.round(estimatedLOC / 100000) / 10}M LOC`.padStart(10);
  } else if (estimatedLOC >= 1000) {
    return `~${Math.round(estimatedLOC / 100) / 10}k LOC`.padStart(10);
  } else {
    return `${estimatedLOC} LOC`.padStart(10);
  }
}

export function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days === 1) {
    return 'yesterday';
  } else if (days < 7) {
    return `${days}d ago`;
  } else if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  } else if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  } else {
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }
}

export function formatDiffValue(diff: number, width: number = 7): string {
  if (diff === 0) {
    return '-'.padStart(width);
  }
  
  const sign = diff > 0 ? '+' : '';
  const diffStr = `${sign}${diff}`;
  return diffStr.padStart(width);
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

async function displayFunctionHistory(
  functionId: string,
  options: HistoryCommandOptions,
  env: CommandEnvironment
): Promise<void> {
  const limit = options.limit ? parseInt(options.limit) : 20;
  const includeAbsent = options.all || false;

  // Use the function history method
  const history = await env.storage.getFunctionHistory(functionId, {
    limit: limit * 2,
    includeAbsent
  });

  if (history.length === 0) {
    console.log(chalk.yellow(`No history found for function ID '${functionId}'.`));
    return;
  }

  // Apply additional filters
  const filteredHistory = applyFiltersToHistory(history, options);

  if (filteredHistory.length === 0) {
    console.log(
      chalk.yellow(`No history found for function ID '${functionId}' with the specified filters.`)
    );
    return;
  }

  // Limit results
  const limitedHistory = filteredHistory.slice(0, limit);

  if (options.json) {
    displayFunctionHistoryJSON(limitedHistory, functionId);
  } else {
    displayFunctionHistoryResults(limitedHistory, functionId, options);
  }
}

// Helper function to display JSON output for function history
function displayFunctionHistoryJSON(
  history: Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }>,
  functionId: string
): void {
  const firstFunction = history.find(h => h.function)?.function;
  const functionName = firstFunction ? firstFunction.displayName : 'Unknown Function';

  const output = {
    functionId,
    functionName,
    snapshots: history.map(h => ({
      commitId: h.snapshot.gitCommit || 'unknown',
      timestamp: new Date(h.snapshot.createdAt).toISOString(),
      branch: h.snapshot.gitBranch || 'unknown',
      complexity: h.function?.metrics?.cyclomaticComplexity || null,
      linesOfCode: h.function?.metrics?.linesOfCode || null,
      exists: h.isPresent,
    })),
    summary: {
      totalSnapshots: history.length,
      appearances: history.filter(h => h.isPresent).length,
      firstSeen: history.find(h => h.isPresent)?.snapshot.createdAt
        ? new Date(history.find(h => h.isPresent)!.snapshot.createdAt).toISOString()
        : null,
      lastSeen:
        history.filter(h => h.isPresent).length > 0
          ? new Date(history.filter(h => h.isPresent)[0].snapshot.createdAt).toISOString()
          : null,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

// Updated filter function to work with new data structure
function applyFiltersToHistory(
  history: Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }>,
  options: HistoryCommandOptions
): Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }> {
  const since = options.since ? new Date(options.since) : undefined;
  const until = options.until ? new Date(options.until) : undefined;

  let filtered = history;

  if (since) {
    filtered = filtered.filter(h => h.snapshot.createdAt >= since.getTime());
  }
  if (until) {
    filtered = filtered.filter(h => h.snapshot.createdAt <= until.getTime());
  }
  if (options.branch) {
    filtered = filtered.filter(h => h.snapshot.gitBranch === options.branch);
  }
  if (options.label) {
    filtered = filtered.filter(h => h.snapshot.label && h.snapshot.label.includes(options.label!));
  }

  return filtered;
}

function displayFunctionHistoryResults(
  history: Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }>,
  functionId: string,
  options: HistoryCommandOptions
): void {
  const firstFunction = history.find(h => h.function)?.function;
  const functionName = firstFunction ? firstFunction.displayName : 'Unknown Function';
  const shortId = functionId.length > 8 ? functionId.substring(0, 8) : functionId;

  console.log(chalk.cyan.bold(`\n🔍 Function History: ${functionName} [${shortId}]\n`));

  const isVerboseMode = options.verbose || process.argv.includes('--verbose');
  
  if (isVerboseMode) {
    displayDetailedFunctionHistory(history, functionName);
  } else {
    displayCompactFunctionHistory(history, functionName, options);
  }

  displayFunctionHistorySummary(history, functionName);
}

function displayCompactFunctionHistory(
  history: Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }>,
  _functionName: string,
  options: HistoryCommandOptions
): void {
  // Display header - cleaner format without snapshot ID
  console.log('Commit   Date        Branch              CC   LOC');
  console.log('-------- ----------- ----------------- ---- -----');

  // Display each history entry
  for (const entry of history) {
    const snapshot = entry.snapshot;
    const func = entry.function;

    // Only show entries where function exists (unless --all is used)
    if (!entry.isPresent && !options.all) {
      continue;
    }

    const commit = (snapshot.gitCommit ? snapshot.gitCommit.substring(0, 7) : 'unknown').padEnd(8);
    const date = formatDate(snapshot.createdAt).padEnd(11);
    const branch = truncateWithEllipsis(snapshot.gitBranch || 'unknown', 17).padEnd(17);
    const cc = (func?.metrics?.cyclomaticComplexity?.toString() || '-').padStart(4);
    const loc = (func?.metrics?.linesOfCode?.toString() || '-').padStart(5);

    console.log(`${commit} ${date} ${branch} ${cc} ${loc}`);
  }
}

/**
 * Displays function presence status and location
 */
function displayFunctionPresence(func: FunctionInfo): void {
  console.log(chalk.green(`   ✓ Present in ${func.filePath}:${func.startLine}`));
}

/**
 * Displays function metrics if available
 */
function displayFunctionMetrics(metrics: FunctionInfo['metrics']): void {
  if (!metrics) return;
  
  console.log(
    `   📈 Metrics: CC=${metrics.cyclomaticComplexity}, LOC=${metrics.linesOfCode}, Params=${metrics.parameterCount}`
  );
  
  if (metrics.maintainabilityIndex) {
    console.log(`   🔧 Maintainability: ${metrics.maintainabilityIndex.toFixed(1)}`);
  }
}

/**
 * Displays signature changes between versions
 */
function displaySignatureChange(
  currentFunc: FunctionInfo,
  prevFunc: FunctionInfo | null
): void {
  if (!prevFunc || prevFunc.signature === currentFunc.signature) return;
  
  console.log(chalk.blue(`   🔄 Signature changed from: ${prevFunc.signature}`));
  console.log(chalk.blue(`   🔄                     to: ${currentFunc.signature}`));
}

/**
 * Displays git and snapshot information for history entries
 */
function displayHistorySnapshotInfo(snapshot: SnapshotInfo): void {
  if (snapshot.gitBranch) {
    console.log(
      chalk.gray(
        `   Git: ${snapshot.gitBranch}@${snapshot.gitCommit?.substring(0, 7) || 'unknown'}`
      )
    );
  }
  if (snapshot.label) {
    console.log(chalk.gray(`   Label: ${snapshot.label}`));
  }
}

/**
 * Displays detailed information for a single history entry
 */
function displayHistoryEntry(
  entry: { snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean },
  index: number,
  history: Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }>
): void {
  const { snapshot, function: func, isPresent } = entry;
  const number = (index + 1).toString().padStart(2, '0');

  console.log(
    chalk.yellow(`[${number}] ${formatDate(snapshot.createdAt)} - ${snapshot.id.substring(0, 8)}`)
  );

  if (isPresent && func) {
    displayFunctionPresence(func);
    
    if (func.metrics) {
      displayFunctionMetrics(func.metrics);
    }

    // Show signature changes
    const prevEntry = history[index + 1];
    displaySignatureChange(func, prevEntry?.function || null);
  } else {
    console.log(chalk.red(`   ✗ Not present (deleted or not analyzed)`));
  }

  displayHistorySnapshotInfo(snapshot);
  console.log(); // Empty line
}

function displayDetailedFunctionHistory(
  history: Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }>,
  _functionName: string
): void {
  history.forEach((entry, index) => {
    displayHistoryEntry(entry, index, history);
  });
}

function displayFunctionHistorySummary(
  history: Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }>,
  functionName: string
): void {
  const presentCount = history.filter(h => h.isPresent).length;
  const totalSnapshots = history.length;
  const presenceRate = ((presentCount / totalSnapshots) * 100).toFixed(1);

  const metricsHistory = history.filter(h => h.function?.metrics).map(h => h.function!.metrics!);

  console.log(chalk.cyan('📈 Function Summary:'));
  console.log(`   Function: ${functionName}`);
  console.log(`   Presence: ${presentCount}/${totalSnapshots} snapshots (${presenceRate}%)`);

  if (metricsHistory.length > 0) {
    const firstMetrics = metricsHistory[metricsHistory.length - 1]; // Oldest
    const lastMetrics = metricsHistory[0]; // Newest

    const complexityChange = lastMetrics.cyclomaticComplexity - firstMetrics.cyclomaticComplexity;
    const locChange = lastMetrics.linesOfCode - firstMetrics.linesOfCode;

    console.log(
      `   Complexity trend: ${formatChange(complexityChange)} (${firstMetrics.cyclomaticComplexity} → ${lastMetrics.cyclomaticComplexity})`
    );
    console.log(
      `   LOC trend: ${formatChange(locChange)} (${firstMetrics.linesOfCode} → ${lastMetrics.linesOfCode})`
    );

    // Quality assessment
    const qualityTrend = calculateOverallQualityTrend(
      { avgComplexity: firstMetrics.cyclomaticComplexity, totalLines: firstMetrics.linesOfCode },
      { avgComplexity: lastMetrics.cyclomaticComplexity, totalLines: lastMetrics.linesOfCode }
    );
    console.log(`   Overall quality: ${qualityTrend}`);
  }

  // Time span
  if (history.length > 1) {
    const timespan = formatDuration(
      history[0].snapshot.createdAt - history[history.length - 1].snapshot.createdAt
    );
    console.log(`   Time span: ${timespan}`);
  }
}

function formatChange(change: number): string {
  if (change > 0) return chalk.red(`+${change}`);
  if (change < 0) return chalk.green(`${change}`);
  return chalk.gray('no change');
}

function calculateOverallQualityTrend(
  oldMetrics: { avgComplexity: number; totalLines?: number },
  newMetrics: { avgComplexity: number; totalLines?: number }
): string {
  const complexityChange = newMetrics.avgComplexity - oldMetrics.avgComplexity;
  const locChange = 0; // SnapshotMetadata doesn't have linesOfCode
  const paramChange = 0; // SnapshotMetadata doesn't have parameterCount;

  let score = 0;

  // Complexity change (negative is better)
  if (complexityChange < 0) score += 2;
  else if (complexityChange === 0) score += 1;
  else score -= 1;

  // LOC change (moderate decrease is good, large increase is bad)
  if (locChange < -10)
    score -= 1; // Too much reduction might indicate lost functionality
  else if (locChange <= 0)
    score += 1; // Slight reduction is good
  else if (locChange <= 10)
    score += 0; // Slight increase is neutral
  else score -= 1; // Large increase is bad

  // Parameter change (decrease is generally better)
  if (paramChange < 0) score += 1;
  else if (paramChange === 0) score += 0;
  else score -= 1;

  if (score >= 3) return chalk.green('📈 Improving');
  if (score >= 1) return chalk.yellow('📊 Stable');
  if (score >= -1) return chalk.yellow('📉 Slightly degrading');
  return chalk.red('📉 Degrading');
}