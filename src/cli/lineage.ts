import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import {
  CommandOptions,
  Lineage,
  LineageKind,
  LineageStatus,
  LineageQuery,
  FunctionInfo,
} from '../types';

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

    // Optimize by using database-level filtering when possible
    let lineages: Lineage[];

    if (options.fromFunction || options.toFunction) {
      // Use optimized database query for function name filtering
      const query = buildLineageQuery(options);
      lineages = await storage.getLineagesWithFunctionFilter(
        options.fromFunction,
        options.toFunction,
        query
      );
    } else {
      // Use standard query for non-function filters
      const query = buildLineageQuery(options);
      lineages = await storage.getLineages(query);
    }

    // Apply remaining filters that couldn't be handled at database level
    const filtered = applyRemainingFilters(lineages, options);
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

export async function lineageShowCommand(
  lineageId: string,
  options: CommandOptions
): Promise<void> {
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
    const fromFunctions = await Promise.all(lineage.fromIds.map(id => storage.getFunction(id)));
    const toFunctions = await Promise.all(lineage.toIds.map(id => storage.getFunction(id)));

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

function buildLineageQuery(options: LineageCommandOptions): LineageQuery {
  const query: LineageQuery = {};

  if (options.status) {
    query.status = options.status as LineageStatus;
  }

  if (options.kind) {
    query.kind = options.kind as LineageKind;
  }

  if (options.confidence) {
    const threshold = parseFloat(options.confidence);
    if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
      query.minConfidence = threshold;
    }
  }

  if (options.limit) {
    const limitValue = parseInt(options.limit.toString(), 10);
    if (isNaN(limitValue) || limitValue < 1) {
      throw new Error('Limit must be a positive integer');
    }
    query.limit = limitValue;
  }

  return query;
}

function applyRemainingFilters(lineages: Lineage[], _options: LineageCommandOptions): Lineage[] {
  // Only apply filters that couldn't be handled at database level
  // Most filters are now handled in buildLineageQuery
  return lineages;
}

// Legacy function - now replaced by database-level filtering
// Kept for backward compatibility if needed
export async function applyAdvancedFiltersBatch(
  lineages: Lineage[],
  options: LineageCommandOptions,
  storage: PGLiteStorageAdapter,
  logger: Logger
): Promise<Lineage[]> {
  // If no function filtering needed, return as-is
  if (!options.fromFunction && !options.toFunction) {
    return lineages;
  }

  // Collect all unique function IDs that need to be checked
  const allFunctionIds = new Set<string>();
  lineages.forEach(lineage => {
    if (options.fromFunction) {
      lineage.fromIds.forEach(id => allFunctionIds.add(id));
    }
    if (options.toFunction) {
      lineage.toIds.forEach(id => allFunctionIds.add(id));
    }
  });

  // Batch fetch all functions at once
  const functionMap = await storage.getFunctionsBatch(Array.from(allFunctionIds));

  // Apply filtering using cached function data
  let filtered = lineages;

  if (options.fromFunction) {
    logger.info(`Filtering by source function pattern: ${options.fromFunction}`);
    const pattern = options.fromFunction.toLowerCase();

    filtered = filtered.filter(lineage => {
      return lineage.fromIds.some(fromId => {
        const func = functionMap.get(fromId);
        return func?.name.toLowerCase().includes(pattern);
      });
    });
  }

  if (options.toFunction) {
    logger.info(`Filtering by target function pattern: ${options.toFunction}`);
    const pattern = options.toFunction.toLowerCase();

    filtered = filtered.filter(lineage => {
      return lineage.toIds.some(toId => {
        const func = functionMap.get(toId);
        return func?.name.toLowerCase().includes(pattern);
      });
    });
  }

  return filtered;
}

// Legacy function - most filtering now handled at database level
// Removed as all filtering is now handled at database level via buildLineageQuery

function applySorting(lineages: Lineage[], options: LineageCommandOptions): Lineage[] {
  if (!options.sort) {
    return lineages.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
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
      default:
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }

    return desc ? -comparison : comparison;
  });
}

function applyLimit(lineages: Lineage[], options: LineageCommandOptions): Lineage[] {
  if (options.limit && options.limit > 0) {
    return lineages.slice(0, options.limit);
  }
  return lineages;
}

// ========================================
// DISPLAY FUNCTIONS
// ========================================

function displayLineageList(
  lineages: Lineage[],
  _options: LineageCommandOptions,
  logger: Logger
): void {
  if (lineages.length === 0) {
    logger.info('No lineages found.');
    return;
  }

  console.log(chalk.cyan.bold(`\n🔗 Function Lineages (${lineages.length})\n`));

  // Simple list display (similar to funcqc list command)
  lineages.forEach((lineage, index) => {
    const prefix = chalk.gray(`${index + 1}.`);
    const id = chalk.yellow(lineage.id.substring(0, 8));
    const kind = `${getLineageKindIcon(lineage.kind)} ${lineage.kind}`;
    const status = `${getStatusIcon(lineage.status)} ${lineage.status}`;
    const confidence = chalk.blue(`${((lineage.confidence ?? 0) * 100).toFixed(1)}%`);
    const mapping = chalk.gray(`${lineage.fromIds.length} → ${lineage.toIds.length}`);
    const created = chalk.gray(formatDate(lineage.createdAt));
    
    console.log(`${prefix} ${id} ${kind} ${status} ${confidence} ${mapping} ${created}`);
    
    if (lineage.note) {
      const truncatedNote = truncateText(lineage.note, 80);
      console.log(`   ${chalk.gray('Note:')} ${chalk.dim(truncatedNote)}`);
    }
    console.log(); // Empty line between entries
  });

  // Show summary statistics
  const statusCounts = lineages.reduce(
    (acc, l) => {
      acc[l.status] = (acc[l.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

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

function validateReviewOptions(options: LineageReviewOptions): LineageStatus {
  if (options.approve && options.reject) {
    throw new Error('Cannot both approve and reject lineage(s)');
  }

  if (!options.approve && !options.reject) {
    throw new Error('Must specify either --approve or --reject');
  }

  return options.approve ? 'approved' : 'rejected';
}

function buildReviewNote(
  existingNote: string | undefined,
  reviewNote: string | undefined,
  prefix: string
): string | undefined {
  if (!reviewNote) return existingNote;

  const formattedReviewNote = `${prefix}: ${reviewNote}`;
  return existingNote ? `${existingNote}\n\n${formattedReviewNote}` : formattedReviewNote;
}

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

  try {
    const newStatus = validateReviewOptions(options);
    const updatedNote = buildReviewNote(lineage.note, options.note, 'Review');

    const updatedLineage: Lineage = {
      ...lineage,
      status: newStatus,
      ...(updatedNote ? { note: updatedNote } : {}),
    };

    await storage.updateLineage(updatedLineage);

    const statusColor = newStatus === 'approved' ? chalk.green : chalk.red;
    logger.success(`Lineage ${lineageId} has been ${statusColor(newStatus)}`);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
  }
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

  try {
    const newStatus = validateReviewOptions(options);

    let processedCount = 0;
    for (const lineage of drafts) {
      const updatedNote = buildReviewNote(lineage.note, options.note, 'Bulk review');

      const updatedLineage: Lineage = {
        ...lineage,
        status: newStatus,
        ...(updatedNote ? { note: updatedNote } : {}),
      };

      await storage.updateLineage(updatedLineage);
      processedCount++;
    }

    const statusColor = newStatus === 'approved' ? chalk.green : chalk.red;
    logger.success(`${processedCount} lineages have been ${statusColor(newStatus)}`);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
  }
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
