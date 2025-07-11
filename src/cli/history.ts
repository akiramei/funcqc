import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter, DatabaseError } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import { formatDuration } from '../utils/file-utils';
import { CommandOptions, FunctionInfo, SnapshotInfo, SnapshotMetadata } from '../types';
import { ErrorCode, createErrorHandler } from '../utils/error-handler';

export interface HistoryCommandOptions extends CommandOptions {
  verbose?: boolean;
  since?: string;
  until?: string;
  limit?: string;
  author?: string;
  branch?: string;
  label?: string;
  id?: string;
  all?: boolean;
  json?: boolean;
}

export async function historyCommand(options: HistoryCommandOptions): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  const errorHandler = createErrorHandler(logger);

  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();

    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();

    if (options.id) {
      // Function tracking mode
      await displayFunctionHistory(options.id, options, storage, logger);
    } else {
      // Standard snapshot history mode
      await displaySnapshotHistory(options, storage, logger);
    }

    await storage.close();
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
}

async function displaySnapshotHistory(
  options: HistoryCommandOptions,
  storage: PGLiteStorageAdapter,
  logger: Logger
): Promise<void> {
  // Parse options
  const limit = options.limit ? parseInt(options.limit) : 20;
  const since = options.since ? new Date(options.since) : undefined;
  const until = options.until ? new Date(options.until) : undefined;

  // Get snapshots with filters
  const snapshots = await storage.getSnapshots({
    limit,
    // Note: More advanced filtering would be implemented here
  });

  if (snapshots.length === 0) {
    logger.info('No snapshots found. Run `funcqc scan` to create your first snapshot.');
    return;
  }

  // Apply client-side filters (for now)
  let filteredSnapshots = snapshots;

  if (since) {
    filteredSnapshots = filteredSnapshots.filter(s => s.createdAt >= since.getTime());
  }

  if (until) {
    filteredSnapshots = filteredSnapshots.filter(s => s.createdAt <= until.getTime());
  }

  if (options.branch) {
    filteredSnapshots = filteredSnapshots.filter(s => s.gitBranch === options.branch);
  }

  if (options.label) {
    filteredSnapshots = filteredSnapshots.filter(s => s.label && s.label.includes(options.label!));
  }

  // Display results
  console.log(chalk.cyan.bold(`\n📈 Snapshot History (${filteredSnapshots.length} snapshots)\n`));

  if (options.verbose) {
    await displayDetailedHistory(filteredSnapshots, storage, logger);
  } else {
    displayCompactHistory(filteredSnapshots);
  }

  // Display summary statistics
  displayHistorySummary(filteredSnapshots);
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
    'ID       Label                Created              Functions  Avg CC  P95 CC  High Risk'
  );
  console.log(
    '-------- -------------------- -------------------- ---------- ------- ------- ----------'
  );

  // Display each snapshot
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const prevSnapshot = i < snapshots.length - 1 ? snapshots[i + 1] : null;

    const id = formatSnapshotIdForDisplay(snapshot.id);
    const label = truncateWithEllipsis(snapshot.label || '-', 20).padEnd(20);
    const created = truncateWithEllipsis(formatDate(snapshot.createdAt), 20).padEnd(20);

    // Functions with diff
    const currentFunctions = snapshot.metadata.totalFunctions;
    const prevFunctions = prevSnapshot?.metadata.totalFunctions || 0;
    const functionDiff = prevSnapshot ? currentFunctions - prevFunctions : 0;
    const functionsDisplay = formatFunctionCountWithDiff(currentFunctions, functionDiff);

    const avgComplexity = snapshot.metadata.avgComplexity.toFixed(1).padStart(7);
    const p95Complexity = calculateP95Complexity(snapshot.metadata.complexityDistribution)
      .toString()
      .padStart(7);
    const highRiskCount = calculateHighRiskCount(snapshot.metadata.complexityDistribution);
    const highRiskDisplay = formatHighRiskCount(highRiskCount);

    console.log(
      `${id} ${label} ${created} ${functionsDisplay} ${avgComplexity} ${p95Complexity} ${highRiskDisplay}`
    );
  }
}

async function displayDetailedHistory(
  snapshots: SnapshotInfo[],
  storage: PGLiteStorageAdapter,
  logger: Logger
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
      await displaySnapshotChanges(prevSnapshot.id, snapshot.id, storage, logger);
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
  storage: PGLiteStorageAdapter,
  logger: Logger
): Promise<void> {
  try {
    const diff = await storage.diffSnapshots(_prevSnapshotId, _currentSnapshotId);
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
    logger.debug('Failed to calculate diff', error);
  }
}

function displayHistorySummary(snapshots: SnapshotInfo[]): void {
  if (snapshots.length === 0) return;

  const totalFunctions = snapshots.reduce((sum, s) => sum + s.metadata.totalFunctions, 0);
  const avgFunctions = Math.round(totalFunctions / snapshots.length);

  const totalComplexity = snapshots.reduce(
    (sum, s) => sum + s.metadata.avgComplexity * s.metadata.totalFunctions,
    0
  );
  const overallAvgComplexity = totalComplexity / totalFunctions;

  const timespan =
    snapshots.length > 1
      ? formatDuration(snapshots[0].createdAt - snapshots[snapshots.length - 1].createdAt)
      : 'single snapshot';

  console.log(chalk.cyan('📊 Summary:'));
  console.log(`   Period: ${timespan}`);
  console.log(`   Average functions per snapshot: ${avgFunctions}`);
  console.log(`   Overall average complexity: ${overallAvgComplexity.toFixed(2)}`);

  // Git statistics
  const gitBranches = new Set(snapshots.filter(s => s.gitBranch).map(s => s.gitBranch));
  if (gitBranches.size > 0) {
    console.log(`   Git branches: ${Array.from(gitBranches).join(', ')}`);
  }
}

export function calculateP95Complexity(complexityDistribution: Record<number, number>): number {
  if (!complexityDistribution || Object.keys(complexityDistribution).length === 0) {
    return 0;
  }

  // Convert distribution to sorted array of [complexity, count] pairs
  const entries = Object.entries(complexityDistribution)
    .map(([complexity, count]) => [parseInt(complexity), count] as [number, number])
    .sort(([a], [b]) => a - b);

  // Calculate total count
  const totalCount = entries.reduce((sum, [, count]) => sum + count, 0);

  // Find the 95th percentile
  const p95Index = Math.ceil(totalCount * 0.95);

  let currentCount = 0;
  for (const [complexity, count] of entries) {
    currentCount += count;
    if (currentCount >= p95Index) {
      return complexity;
    }
  }

  // Fallback to max complexity
  return entries.length > 0 ? entries[entries.length - 1][0] : 0;
}

export function calculateHighRiskCount(complexityDistribution: Record<number, number>): number {
  if (!complexityDistribution || Object.keys(complexityDistribution).length === 0) {
    return 0;
  }

  return Object.entries(complexityDistribution)
    .filter(([complexity]) => parseInt(complexity) >= 10)
    .reduce((sum, [, count]) => sum + count, 0);
}

export function formatFunctionCountWithDiff(currentCount: number, diff: number): string {
  if (diff === 0) {
    return currentCount.toString().padStart(10);
  }

  const sign = diff > 0 ? '+' : '';
  const diffStr = `(${sign}${diff})`;
  const combined = `${currentCount}${diffStr}`;
  return combined.padStart(10);
}

export function formatHighRiskCount(count: number): string {
  if (count === 0) {
    return '0'.padStart(10);
  }

  const formatted = `${count}(CC≥10)`;
  return formatted.padStart(10);
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
  storage: PGLiteStorageAdapter,
  _logger: Logger
): Promise<void> {
  const limit = options.limit ? parseInt(options.limit) : 20;
  const includeAbsent = options.all || false;

  // Use the new efficient method
  const history = await storage.getFunctionHistory(functionId, {
    limit: limit * 2, // Get more to allow for filtering
    includeAbsent,
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

  if (options.verbose) {
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

function displayDetailedFunctionHistory(
  history: Array<{ snapshot: SnapshotInfo; function: FunctionInfo | null; isPresent: boolean }>,
  _functionName: string
): void {
  history.forEach((entry, index) => {
    const snapshot = entry.snapshot;
    const func = entry.function;
    const number = (index + 1).toString().padStart(2, '0');

    console.log(
      chalk.yellow(`[${number}] ${formatDate(snapshot.createdAt)} - ${snapshot.id.substring(0, 8)}`)
    );

    if (entry.isPresent && func) {
      console.log(chalk.green(`   ✓ Present in ${func.filePath}:${func.startLine}`));

      if (func.metrics) {
        const metrics = func.metrics;
        console.log(
          `   📈 Metrics: CC=${metrics.cyclomaticComplexity}, LOC=${metrics.linesOfCode}, Params=${metrics.parameterCount}`
        );

        if (metrics.maintainabilityIndex) {
          console.log(`   🔧 Maintainability: ${metrics.maintainabilityIndex.toFixed(1)}`);
        }
      }

      // Show signature if it's different from previous
      if (index < history.length - 1) {
        const prevEntry = history[index + 1];
        if (prevEntry.function && prevEntry.function.signature !== func.signature) {
          console.log(chalk.blue(`   🔄 Signature changed from: ${prevEntry.function.signature}`));
          console.log(chalk.blue(`   🔄                     to: ${func.signature}`));
        }
      }
    } else {
      console.log(chalk.red(`   ✗ Not present (deleted or not analyzed)`));
    }

    // Git info
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

    console.log(); // Empty line
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
