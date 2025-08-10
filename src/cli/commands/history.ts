import chalk from 'chalk';
import { 
  HistoryCommandOptions, 
  SnapshotInfo, 
  SnapshotMetadata 
} from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { formatDuration } from '../../utils/file-utils';
import { formatDate } from '../../utils/date-utils';

/**
 * History command as a Reader function
 * Uses shared storage and config from environment
 */
export const historyCommand: VoidCommand<HistoryCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      // Standard snapshot history mode
      await displaySnapshotHistory(options, env);
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

  if (options.scope) {
    filtered = filtered.filter(s => (s.scope || 'src') === options.scope);
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
      scope: snapshot.scope || 'src',
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
        ? Math.round(snapshots.reduce((sum, s) => sum + (s.metadata.totalFunctions ?? 0), 0) / snapshots.length)
        : 0,
      overallAvgComplexity: snapshots.length > 0
        ? (() => {
            const denom = snapshots.reduce(
              (sum, s) => sum + (s.metadata.totalFunctions ?? 0),
              0
            );
            if (denom === 0) return 0;
            const numer = snapshots.reduce(
              (sum, s) =>
                sum +
                (s.metadata.avgComplexity ?? 0) * (s.metadata.totalFunctions ?? 0),
              0
            );
            return numer / denom;
          })()
        : 0,
      gitBranches: Array.from(new Set(snapshots.filter(s => s.gitBranch).map(s => s.gitBranch)))
    }
  };

  console.log(JSON.stringify(output, null, 2));
}


/**
 * Display a shortened version of snapshot ID for table display
 * Uses 8 characters for consistency with function IDs
 */
function formatSnapshotIdForDisplay(id: string): string {
  return id.substring(0, 8);
}

/**
 * Truncate string with ellipsis if it exceeds max length
 */
function truncateWithEllipsis(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) {
    return str;
  }
  // Reserve 3 characters for ellipsis
  return str.substring(0, maxLength - 3) + '...';
}

function displayCompactHistory(snapshots: SnapshotInfo[]): void {
  // Display header with fixed-width columns
  console.log(
    'ID       Created       Scope Label               Functions +/-      Files +/-    Size'
  );
  console.log(
    '-------- ------------- ----- ------------------- --------- -------- ----- ------ ----------'
  );

  // Display each snapshot
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const prevSnapshot = findPreviousSnapshotWithSameScope(snapshots, i);

    const id = formatSnapshotIdForDisplay(snapshot.id);
    const created = formatRelativeDate(snapshot.createdAt).padEnd(13);
    const scope = (snapshot.scope || 'src').padEnd(5);
    const label = truncateWithEllipsis(snapshot.label || '', 19).padEnd(19);

    // Functions with diff (only compare with same scope)
    const currentFunctions = snapshot.metadata.totalFunctions ?? 0;
    const prevFunctions = prevSnapshot?.metadata.totalFunctions ?? 0;
    const functionDiff = prevSnapshot ? currentFunctions - prevFunctions : 0;
    const functionsDisplay = currentFunctions.toString().padStart(9);
    const functionsDiffDisplay = formatDiffValue(functionDiff, 8);

    // Files count (only compare with same scope)
    const currentFiles = snapshot.metadata.totalFiles ?? 0;
    const prevFiles = prevSnapshot?.metadata.totalFiles ?? 0;
    const filesDiff = prevSnapshot ? currentFiles - prevFiles : 0;
    const filesDisplay = currentFiles.toString().padStart(5);
    const filesDiffDisplay = formatDiffValue(filesDiff, 6);

    // Size estimation (rough LOC calculation)
    const sizeDisplay = formatSizeDisplay(snapshot.metadata);

    console.log(
      `${id} ${created} ${scope} ${label} ${functionsDisplay} ${functionsDiffDisplay} ${filesDisplay} ${filesDiffDisplay} ${sizeDisplay}`
    );
  }
}

async function displayDetailedHistory(
  snapshots: SnapshotInfo[],
  env: CommandEnvironment
): Promise<void> {
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const prevSnapshot = findPreviousSnapshotWithSameScope(snapshots, i);

    // Display basic snapshot info
    displaySnapshotInfo(snapshot);

    // Display file/function counts only
    console.log(`   Functions: ${snapshot.metadata.totalFunctions}`);
    console.log(`   Files: ${snapshot.metadata.totalFiles}`);

    // Display changes since previous (only if same scope)
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
  console.log(`   Scope: ${chalk.cyan(snapshot.scope || 'src')}`);

  if (snapshot.gitBranch) {
    console.log(
      `   Git: ${snapshot.gitBranch}@${snapshot.gitCommit?.substring(0, 7) || 'unknown'}`
    );
  }
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
  const estimatedLOC = (metadata.totalFunctions ?? 0) * 50;
  
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

// Removed: formatDate - now using shared implementation from utils/date-utils

/**
 * Find the previous snapshot with the same scope
 */
function findPreviousSnapshotWithSameScope(snapshots: SnapshotInfo[], currentIndex: number): SnapshotInfo | null {
  const currentSnapshot = snapshots[currentIndex];
  const currentScope = currentSnapshot.scope || 'src';
  
  // Look for the next snapshot (older) with the same scope
  for (let i = currentIndex + 1; i < snapshots.length; i++) {
    const candidateSnapshot = snapshots[i];
    const candidateScope = candidateSnapshot.scope || 'src';
    
    if (candidateScope === currentScope) {
      return candidateSnapshot;
    }
  }
  
  return null;
}


