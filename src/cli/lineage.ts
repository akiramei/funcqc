import chalk from 'chalk';
import { table } from 'table';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import { CommandOptions, Lineage, LineageKind, LineageStatus, FunctionInfo } from '../types';

export interface LineageCommandOptions extends CommandOptions {
  status?: string;
  kind?: string;
  limit?: number;
  sort?: string;
  desc?: boolean;
  json?: boolean;
  fromFunction?: string;
  toFunction?: string;
  confidence?: string;
}

export async function lineageListCommand(options: LineageCommandOptions): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();

    // Get lineages with filters
    const lineages = await storage.getLineages();
    const filtered = applyFilters(lineages, options);
    const sorted = applySorting(filtered, options);
    const limited = applyLimit(sorted, options);

    if (options.json) {
      console.log(JSON.stringify(limited, null, 2));
    } else {
      displayLineageList(limited, options, logger);
    }

    await storage.close();
  } catch (error) {
    logger.error('Failed to list lineages', error);
    process.exit(1);
  }
}

export async function lineageShowCommand(lineageId: string, options: CommandOptions): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();

    const lineage = await storage.getLineage(lineageId);
    
    if (!lineage) {
      logger.error(`Lineage not found: ${lineageId}`);
      process.exit(1);
    }

    // Get related function information
    const fromFunctions = await Promise.all(
      lineage.fromIds.map(id => storage.getFunction(id))
    );
    const toFunctions = await Promise.all(
      lineage.toIds.map(id => storage.getFunction(id))
    );

    displayLineageDetails(lineage, fromFunctions, toFunctions, logger);

    await storage.close();
  } catch (error) {
    logger.error('Failed to show lineage', error);
    process.exit(1);
  }
}

export interface LineageReviewOptions extends CommandOptions {
  approve?: boolean;
  reject?: boolean;
  note?: string;
  all?: boolean;
}

export async function lineageReviewCommand(
  lineageId: string, 
  options: LineageReviewOptions
): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();

    if (options.all) {
      await reviewAllDraftLineages(storage, options, logger);
    } else {
      await reviewSingleLineage(storage, lineageId, options, logger);
    }

    await storage.close();
  } catch (error) {
    logger.error('Failed to review lineage', error);
    process.exit(1);
  }
}

// ========================================
// FILTERING AND SORTING FUNCTIONS
// ========================================

function applyFilters(lineages: Lineage[], options: LineageCommandOptions): Lineage[] {
  let filtered = lineages;

  // Filter by status
  if (options.status) {
    filtered = filtered.filter(l => l.status === options.status);
  }

  // Filter by kind
  if (options.kind) {
    filtered = filtered.filter(l => l.kind === options.kind);
  }

  // Filter by confidence threshold
  if (options.confidence) {
    const threshold = parseFloat(options.confidence);
    if (!isNaN(threshold)) {
      filtered = filtered.filter(l => (l.confidence ?? 0) >= threshold);
    }
  }

  // Filter by function names (requires function lookup - simplified for now)
  if (options.fromFunction) {
    // This would require joining with functions table in a real implementation
    // For now, we'll implement this as a future enhancement
    // logger.warn('Function name filtering not yet implemented - showing all results');
  }

  if (options.toFunction) {
    // This would require joining with functions table in a real implementation
    // For now, we'll implement this as a future enhancement
    // logger.warn('Function name filtering not yet implemented - showing all results');
  }

  return filtered;
}

function applySorting(lineages: Lineage[], options: LineageCommandOptions): Lineage[] {
  if (!options.sort) {
    return lineages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  const desc = options.desc || false;
  
  return lineages.sort((a, b) => {
    let comparison = 0;
    
    switch (options.sort) {
      case 'confidence':
        comparison = (a.confidence ?? 0) - (b.confidence ?? 0);
        break;
      case 'kind':
        comparison = a.kind.localeCompare(b.kind);
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
      case 'created':
      default:
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }
    
    return desc ? -comparison : comparison;
  });
}

function applyLimit(lineages: Lineage[], _options: LineageCommandOptions): Lineage[] {
  if (_options.limit && _options.limit > 0) {
    return lineages.slice(0, _options.limit);
  }
  return lineages;
}

// ========================================
// DISPLAY FUNCTIONS
// ========================================

function displayLineageList(lineages: Lineage[], _options: LineageCommandOptions, logger: Logger): void {
  if (lineages.length === 0) {
    logger.info('No lineages found.');
    return;
  }

  console.log(chalk.cyan.bold(`\n🔗 Function Lineages (${lineages.length})\n`));

  // Prepare table data
  const headers = ['ID', 'Kind', 'Status', 'Confidence', 'From → To', 'Created', 'Note'];
  const rows = lineages.map(lineage => [
    lineage.id.substring(0, 8),
    getLineageKindIcon(lineage.kind) + ' ' + lineage.kind,
    getStatusIcon(lineage.status) + ' ' + lineage.status,
    `${((lineage.confidence ?? 0) * 100).toFixed(1)}%`,
    `${lineage.fromIds.length} → ${lineage.toIds.length}`,
    formatDate(lineage.createdAt),
    truncateText(lineage.note || '', 30)
  ]);

  const tableData = [headers, ...rows];
  
  const tableConfig = {
    border: {
      topBody: '─',
      topJoin: '┬',
      topLeft: '┌',
      topRight: '┐',
      bottomBody: '─',
      bottomJoin: '┴',
      bottomLeft: '└',
      bottomRight: '┘',
      bodyLeft: '│',
      bodyRight: '│',
      bodyJoin: '│',
      joinBody: '─',
      joinLeft: '├',
      joinRight: '┤',
      joinJoin: '┼'
    },
    columns: {
      0: { width: 10 },
      1: { width: 18 },
      2: { width: 12 },
      3: { width: 12 },
      4: { width: 10 },
      5: { width: 12 },
      6: { width: 32 }
    }
  };

  console.log(table(tableData, tableConfig));
  
  // Show summary statistics
  const statusCounts = lineages.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(chalk.gray('Status summary:'));
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(chalk.gray(`  ${getStatusIcon(status)} ${status}: ${count}`));
  });
}

function displayLineageDetails(
  lineage: Lineage, 
  fromFunctions: (FunctionInfo | null)[], 
  toFunctions: (FunctionInfo | null)[], 
  _logger: Logger
): void {
  console.log(chalk.cyan.bold('\n🔗 Lineage Details\n'));
  
  console.log(`${chalk.bold('ID:')} ${lineage.id}`);
  console.log(`${chalk.bold('Kind:')} ${getLineageKindIcon(lineage.kind)} ${lineage.kind}`);
  console.log(`${chalk.bold('Status:')} ${getStatusIcon(lineage.status)} ${lineage.status}`);
  console.log(`${chalk.bold('Confidence:')} ${((lineage.confidence ?? 0) * 100).toFixed(1)}%`);
  console.log(`${chalk.bold('Created:')} ${formatDate(lineage.createdAt)}`);
  
  if (lineage.gitCommit && lineage.gitCommit !== 'unknown') {
    console.log(`${chalk.bold('Git Commit:')} ${lineage.gitCommit.substring(0, 8)}`);
  }
  
  if (lineage.note) {
    console.log(`${chalk.bold('Note:')} ${lineage.note}`);
  }

  console.log(chalk.red.bold('\nFrom Functions:'));
  fromFunctions.forEach((func, index) => {
    if (func) {
      console.log(`  ${index + 1}. ${func.name} (${func.filePath}:${func.startLine})`);
    } else {
      console.log(`  ${index + 1}. [Function not found: ${lineage.fromIds[index]}]`);
    }
  });

  console.log(chalk.green.bold('\nTo Functions:'));
  toFunctions.forEach((func, index) => {
    if (func) {
      console.log(`  ${index + 1}. ${func.name} (${func.filePath}:${func.startLine})`);
    } else {
      console.log(`  ${index + 1}. [Function not found: ${lineage.toIds[index]}]`);
    }
  });
}

// ========================================
// REVIEW FUNCTIONS
// ========================================

async function reviewSingleLineage(
  storage: PGLiteStorageAdapter,
  lineageId: string,
  options: LineageReviewOptions,
  logger: Logger
): Promise<void> {
  const lineage = await storage.getLineage(lineageId);
  
  if (!lineage) {
    logger.error(`Lineage not found: ${lineageId}`);
    return;
  }

  if (lineage.status !== 'draft') {
    logger.warn(`Lineage ${lineageId} is not in draft status (current: ${lineage.status})`);
    return;
  }

  let newStatus: LineageStatus;
  if (options.approve && options.reject) {
    logger.error('Cannot both approve and reject a lineage');
    return;
  } else if (options.approve) {
    newStatus = 'approved';
  } else if (options.reject) {
    newStatus = 'rejected';
  } else {
    logger.error('Must specify either --approve or --reject');
    return;
  }

  const updatedLineage: Lineage = {
    ...lineage,
    status: newStatus,
    ...(options.note ? { note: `${lineage.note || ''}\n\nReview: ${options.note}` } : {})
  };

  await storage.updateLineage(updatedLineage);
  
  const statusColor = newStatus === 'approved' ? chalk.green : chalk.red;
  logger.success(`Lineage ${lineageId} has been ${statusColor(newStatus)}`);
}

async function reviewAllDraftLineages(
  storage: PGLiteStorageAdapter,
  options: LineageReviewOptions,
  logger: Logger
): Promise<void> {
  const draftLineages = await storage.getLineages();
  const drafts = draftLineages.filter(l => l.status === 'draft');

  if (drafts.length === 0) {
    logger.info('No draft lineages found to review.');
    return;
  }

  let newStatus: LineageStatus;
  if (options.approve && options.reject) {
    logger.error('Cannot both approve and reject lineages');
    return;
  } else if (options.approve) {
    newStatus = 'approved';
  } else if (options.reject) {
    newStatus = 'rejected';
  } else {
    logger.error('Must specify either --approve or --reject when using --all');
    return;
  }

  let processedCount = 0;
  for (const lineage of drafts) {
    const updatedLineage: Lineage = {
      ...lineage,
      status: newStatus,
      ...(options.note ? { note: `${lineage.note || ''}\n\nBulk review: ${options.note}` } : {})
    };

    await storage.updateLineage(updatedLineage);
    processedCount++;
  }

  const statusColor = newStatus === 'approved' ? chalk.green : chalk.red;
  logger.success(`${processedCount} lineages have been ${statusColor(newStatus)}`);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

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

function getStatusIcon(status: string): string {
  switch (status) {
    case 'draft':
      return '📝';
    case 'approved':
      return '✅';
    case 'rejected':
      return '❌';
    default:
      return '❓';
  }
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  
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
  return d.toLocaleDateString();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}