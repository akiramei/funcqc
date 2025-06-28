import chalk from 'chalk';
import { table } from 'table';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import { formatDuration } from '../utils/file-utils';
import { CommandOptions } from '../types';

export interface HistoryCommandOptions extends CommandOptions {
  verbose?: boolean;
  since?: string;
  until?: string;
  limit?: string;
  author?: string;
  branch?: string;
  label?: string;
}

export async function historyCommand(options: HistoryCommandOptions): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();

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
      filteredSnapshots = filteredSnapshots.filter(s => 
        s.label && s.label.includes(options.label!)
      );
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

    await storage.close();
  } catch (error) {
    logger.error('Failed to retrieve history', error);
    process.exit(1);
  }
}

function displayCompactHistory(snapshots: any[]): void {
  const tableData = snapshots.map(snapshot => [
    snapshot.id.substring(0, 8),
    snapshot.label || '-',
    formatDate(snapshot.createdAt),
    snapshot.gitBranch || '-',
    snapshot.gitCommit ? snapshot.gitCommit.substring(0, 7) : '-',
    snapshot.metadata.totalFunctions.toString(),
    snapshot.metadata.avgComplexity.toFixed(1)
  ]);

  const headers = [
    'ID',
    'Label',
    'Created',
    'Branch',
    'Commit',
    'Functions',
    'Avg Complexity'
  ];

  const config = {
    header: {
      alignment: 'center' as const,
      content: headers.map(h => chalk.bold(h))
    },
    columnDefault: {
      paddingLeft: 1,
      paddingRight: 1,
    },
    columns: {
      0: { alignment: 'left' as const },
      1: { alignment: 'left' as const },
      2: { alignment: 'left' as const },
      3: { alignment: 'left' as const },
      4: { alignment: 'left' as const },
      5: { alignment: 'right' as const },
      6: { alignment: 'right' as const }
    }
  };

  console.log(table([headers, ...tableData], config));
}

async function displayDetailedHistory(
  snapshots: any[], 
  storage: PGLiteStorageAdapter, 
  logger: Logger
): Promise<void> {
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const prevSnapshot = snapshots[i + 1];
    
    console.log(chalk.yellow(`📸 Snapshot ${snapshot.id}`));
    console.log(`   Label: ${snapshot.label || chalk.gray('(none)')}`);
    console.log(`   Created: ${formatDate(snapshot.createdAt)}`);
    
    if (snapshot.gitBranch) {
      console.log(`   Git: ${snapshot.gitBranch}@${snapshot.gitCommit?.substring(0, 7) || 'unknown'}`);
    }
    
    console.log(`   Functions: ${snapshot.metadata.totalFunctions}`);
    console.log(`   Files: ${snapshot.metadata.totalFiles}`);
    console.log(`   Avg Complexity: ${snapshot.metadata.avgComplexity.toFixed(1)}`);
    console.log(`   Max Complexity: ${snapshot.metadata.maxComplexity}`);
    console.log(`   Exported: ${snapshot.metadata.exportedFunctions}`);
    console.log(`   Async: ${snapshot.metadata.asyncFunctions}`);

    // Show complexity distribution
    if (snapshot.metadata.complexityDistribution) {
      const distribution = Object.entries(snapshot.metadata.complexityDistribution)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([complexity, count]) => `${complexity}:${count}`)
        .slice(0, 5) // Show top 5
        .join(', ');
      console.log(`   Complexity dist: ${distribution}`);
    }

    // Show file extensions
    if (snapshot.metadata.fileExtensions) {
      const extensions = Object.entries(snapshot.metadata.fileExtensions)
        .map(([ext, count]) => `${ext}:${count}`)
        .join(', ');
      console.log(`   Extensions: ${extensions}`);
    }

    // Show changes since previous snapshot
    if (prevSnapshot) {
      try {
        const diff = await storage.diffSnapshots(prevSnapshot.id, snapshot.id);
        const changes = diff.statistics.totalChanges;
        if (changes > 0) {
          console.log(chalk.blue(`   Changes: +${diff.statistics.addedCount} -${diff.statistics.removedCount} ~${diff.statistics.modifiedCount}`));
          
          if (diff.statistics.complexityChange !== 0) {
            const complexityIcon = diff.statistics.complexityChange > 0 ? '📈' : '📉';
            const complexityColor = diff.statistics.complexityChange > 0 ? chalk.red : chalk.green;
            console.log(`   Complexity: ${complexityIcon} ${complexityColor(diff.statistics.complexityChange > 0 ? '+' : '')}${diff.statistics.complexityChange}`);
          }
        }
      } catch (error) {
        logger.debug('Failed to calculate diff', error);
      }
    }

    console.log(''); // Empty line
  }
}

function displayHistorySummary(snapshots: any[]): void {
  if (snapshots.length === 0) return;

  const totalFunctions = snapshots.reduce((sum, s) => sum + s.metadata.totalFunctions, 0);
  const avgFunctions = Math.round(totalFunctions / snapshots.length);
  
  const totalComplexity = snapshots.reduce((sum, s) => sum + s.metadata.avgComplexity * s.metadata.totalFunctions, 0);
  const overallAvgComplexity = totalComplexity / totalFunctions;
  
  const timespan = snapshots.length > 1 
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