import chalk from 'chalk';
import * as readline from 'readline';
import { 
  CommandOptions, 
  Lineage, 
  LineageKind, 
  LineageStatus, 
  LineageQuery,
  FunctionInfo 
} from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';

// ========================================
// LINEAGE COMMAND OPTIONS TYPES
// ========================================

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

export interface LineageReviewOptions extends CommandOptions {
  approve?: boolean;
  reject?: boolean;
  note?: string;
  all?: boolean;
}

export interface LineageCleanOptions extends CommandOptions {
  status?: string;
  olderThan?: string;
  dryRun?: boolean;
  yes?: boolean;
  includeApproved?: boolean;
  force?: boolean;
}

// ========================================
// MAIN COMMAND ROUTER
// ========================================

/**
 * Main lineage command router that handles subcommands
 */
function validateRequiredArgs(subcommand: string, args: string[]): void {
  if ((subcommand === 'show' || subcommand === 'delete') && args.length === 0) {
    throw new Error(`Lineage ID is required for ${subcommand} command`);
  }
}

async function executeLineageSubcommand(
  subcommand: string,
  args: string[],
  options: LineageCommandOptions,
  env: CommandEnvironment
): Promise<void> {
  validateRequiredArgs(subcommand, args);

  switch (subcommand) {
    case 'list':
      await lineageListCommandImpl(options, env);
      break;
    case 'show':
      await lineageShowCommandImpl(args[0], options, env);
      break;
    case 'review':
      await lineageReviewCommandImpl(args[0] || '', options as LineageReviewOptions, env);
      break;
    case 'delete':
      await lineageDeleteCommand(args[0], options, env);
      break;
    case 'clean':
      await lineageCleanCommand(options as LineageCleanOptions, env);
      break;
    default:
      throw new Error(`Unknown lineage subcommand: ${subcommand}`);
  }
}

function handleLineageError(
  error: unknown,
  subcommand: string,
  args: string[],
  errorHandler: ReturnType<typeof createErrorHandler>
): void {
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
      `Lineage ${subcommand} command failed: ${error instanceof Error ? error.message : String(error)}`,
      { subcommand, args },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

export const lineageCommand = (subcommand: string, args: string[] = []): VoidCommand<LineageCommandOptions> =>
  (options: LineageCommandOptions) =>
    async (env: CommandEnvironment): Promise<void> => {
      const errorHandler = createErrorHandler(env.commandLogger);

      try {
        await executeLineageSubcommand(subcommand, args, options, env);
      } catch (error) {
        handleLineageError(error, subcommand, args, errorHandler);
      }
    };

// ========================================
// LINEAGE LIST COMMAND
// ========================================

async function lineageListCommandImpl(
  options: LineageCommandOptions,
  env: CommandEnvironment
): Promise<void> {
  // Optimize by using database-level filtering when possible
  let lineages: Lineage[];

  if (options.fromFunction || options.toFunction) {
    // Use optimized database query for function name filtering
    const query = buildLineageQuery(options);
    lineages = await env.storage.getLineagesWithFunctionFilter(
      options.fromFunction,
      options.toFunction,
      query
    );
  } else {
    // Use standard query for non-function filters
    const query = buildLineageQuery(options);
    lineages = await env.storage.getLineages(query);
  }

  // Apply remaining filters that couldn't be handled at database level
  const filtered = applyRemainingFilters(lineages, options);
  const sorted = applySorting(filtered, options);
  const limited = applyLimit(sorted, options);

  if (options.json) {
    console.log(JSON.stringify(limited, null, 2));
  } else {
    displayLineageList(limited, options, env.commandLogger);
  }
}

// ========================================
// LINEAGE SHOW COMMAND
// ========================================

async function lineageShowCommandImpl(
  lineageId: string,
  _options: CommandOptions,
  env: CommandEnvironment
): Promise<void> {
  const lineage = await env.storage.getLineage(lineageId);

  if (!lineage) {
    env.commandLogger.error(`Lineage not found: ${lineageId}`);
    process.exit(1);
  }

  // Get related function information
  const fromFunctions = await Promise.all(lineage.fromIds.map(id => env.storage.getFunction(id)));
  const toFunctions = await Promise.all(lineage.toIds.map(id => env.storage.getFunction(id)));

  displayLineageDetails(lineage, fromFunctions, toFunctions, env.commandLogger);
}

// ========================================
// LINEAGE REVIEW COMMAND
// ========================================

async function lineageReviewCommandImpl(
  lineageId: string,
  options: LineageReviewOptions,
  env: CommandEnvironment
): Promise<void> {
  if (options.all) {
    await reviewAllDraftLineages(env.storage, options, env.commandLogger);
  } else {
    await reviewSingleLineage(env.storage, lineageId, options, env.commandLogger);
  }
}

// ========================================
// LINEAGE DELETE COMMAND
// ========================================

export async function lineageDeleteCommand(
  lineageId: string,
  _options: CommandOptions,
  env?: CommandEnvironment
): Promise<void> {
  // For backward compatibility, create a mock environment if not provided
  if (!env) {
    throw new Error('Environment is required');
  }
  // Get lineage details first
  const lineage = await env.storage.getLineage(lineageId);
  
  if (!lineage) {
    env.commandLogger.error(`Lineage not found: ${lineageId}`);
    process.exit(1);
  }

  // Display lineage details
  console.log(chalk.yellow.bold('\n⚠️  About to delete lineage:\n'));
  console.log(`${chalk.bold('ID:')} ${lineage.id}`);
  console.log(`${chalk.bold('Kind:')} ${getLineageKindIcon(lineage.kind)} ${lineage.kind}`);
  console.log(`${chalk.bold('Status:')} ${getStatusIcon(lineage.status)} ${lineage.status}`);
  console.log(`${chalk.bold('From/To:')} ${lineage.fromIds.length} → ${lineage.toIds.length} functions`);
  
  if (lineage.note) {
    console.log(`${chalk.bold('Note:')} ${lineage.note}`);
  }

  // Extra warning for approved lineages
  if (lineage.status === 'approved') {
    console.log(chalk.red.bold('\n⚠️  WARNING: This lineage is APPROVED!'));
    console.log(chalk.red('Deleting approved lineages removes important project history.'));
  }

  // Confirmation prompt
  const confirmed = await confirmDeletion(lineage.status === 'approved');
  
  if (!confirmed) {
    env.commandLogger.info('Deletion cancelled.');
    return;
  }

  // Perform deletion
  const deleted = await env.storage.deleteLineage(lineageId);
  
  if (deleted) {
    env.commandLogger.success(`Lineage ${lineageId} has been deleted.`);
  } else {
    env.commandLogger.error('Failed to delete lineage.');
  }
}

// ========================================
// LINEAGE CLEAN COMMAND
// ========================================

export async function lineageCleanCommand(
  options: LineageCleanOptions,
  env?: CommandEnvironment
): Promise<void> {
  // For backward compatibility, create a mock environment if not provided
  if (!env) {
    throw new Error('Environment is required');
  }
  const query = await buildCleanQuery(options, env.commandLogger);
  let lineages = await env.storage.getLineages(query);
  lineages = applyTimeFilter(lineages, options, env.commandLogger);

  if (lineages.length === 0) {
    env.commandLogger.info('No lineages found matching the criteria.');
    return;
  }

  const statusCounts = displayLineageSummary(lineages, options);

  if (options.dryRun) {
    console.log(chalk.gray('\n(Dry run - no changes made)'));
    return;
  }

  const confirmed = await confirmCleanDeletion(options, statusCounts);
  if (!confirmed) {
    env.commandLogger.info('Deletion cancelled.');
    return;
  }

  const deletedCount = await performDeletion(lineages, env.storage, env.commandLogger);
  env.commandLogger.success(`Deleted ${deletedCount} lineages.`);
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
  logger: import('../../utils/cli-utils').Logger
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
  _logger: import('../../utils/cli-utils').Logger
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
  storage: import('../../types').StorageAdapter,
  lineageId: string,
  options: LineageReviewOptions,
  logger: import('../../utils/cli-utils').Logger
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

    await storage.updateLineageStatus(lineage.id, newStatus, updatedNote || undefined);

    const statusColor = newStatus === 'approved' ? chalk.green : chalk.red;
    logger.success(`Lineage ${lineageId} has been ${statusColor(newStatus)}`);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
  }
}

async function reviewAllDraftLineages(
  storage: import('../../types').StorageAdapter,
  options: LineageReviewOptions,
  logger: import('../../utils/cli-utils').Logger
): Promise<void> {
  const draftLineages = await storage.getLineages();
  const drafts = draftLineages.filter((l: Lineage) => l.status === 'draft');

  if (drafts.length === 0) {
    logger.info('No draft lineages found to review.');
    return;
  }

  try {
    const newStatus = validateReviewOptions(options);

    let processedCount = 0;
    for (const lineage of drafts) {
      const updatedNote = buildReviewNote(lineage.note, options.note, 'Bulk review');

      await storage.updateLineageStatus(lineage.id, newStatus, updatedNote || undefined);
      processedCount++;
    }

    const statusColor = newStatus === 'approved' ? chalk.green : chalk.red;
    logger.success(`${processedCount} lineages have been ${statusColor(newStatus)}`);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
  }
}

// ========================================
// CLEAN COMMAND FUNCTIONS
// ========================================

async function buildCleanQuery(options: LineageCleanOptions, logger: import('../../utils/cli-utils').Logger): Promise<LineageQuery> {
  const query: LineageQuery = {};
  
  if (!options.includeApproved) {
    query.status = 'draft';
  } else if (!options.force) {
    logger.error('--include-approved requires --force flag for safety');
    process.exit(1);
  }

  if (options.status) {
    query.status = options.status as LineageStatus;
  }

  return query;
}

function applyTimeFilter(lineages: Lineage[], options: LineageCleanOptions, logger: import('../../utils/cli-utils').Logger): Lineage[] {
  if (!options.olderThan) {
    return lineages;
  }

  const days = parseInt(options.olderThan);
  if (isNaN(days) || days < 0) {
    logger.error('--older-than must be a positive number of days');
    process.exit(1);
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return lineages.filter((l: Lineage) => new Date(l.createdAt) < cutoffDate);
}

function displayLineageSummary(lineages: Lineage[], options: LineageCleanOptions): Record<string, number> {
  console.log(chalk.yellow.bold(`\n🧹 Lineages to be deleted (${lineages.length}):\n`));
  
  const statusCounts = lineages.reduce((acc: Record<string, number>, l: Lineage) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${getStatusIcon(status)} ${status}: ${count}`);
  });

  if (options.verbose) {
    console.log('\nDetails:');
    lineages.forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.id.substring(0, 8)} - ${l.kind} (${l.status})`);
    });
  }

  return statusCounts;
}

async function confirmCleanDeletion(options: LineageCleanOptions, statusCounts: Record<string, number>): Promise<boolean> {
  if (options.yes) {
    return true;
  }

  if (options.includeApproved && statusCounts['approved'] > 0) {
    console.log(chalk.red.bold(`\n⚠️  WARNING: This will delete ${statusCounts['approved']} APPROVED lineages!`));
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const prompt = options.includeApproved && statusCounts['approved'] > 0
      ? chalk.red('\nType "yes" to confirm deletion of approved lineages: ')
      : chalk.yellow('\nProceed with deletion? (y/N): ');

    rl.question(prompt, (answer) => {
      rl.close();
      
      if (options.includeApproved && statusCounts['approved'] > 0) {
        resolve(answer.toLowerCase() === 'yes');
      } else {
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      }
    });
  });
}

async function performDeletion(lineages: Lineage[], storage: import('../../types').StorageAdapter, logger: import('../../utils/cli-utils').Logger): Promise<number> {
  let deletedCount = 0;
  for (const lineage of lineages) {
    try {
      const deleted = await storage.deleteLineage(lineage.id);
      if (deleted) {
        deletedCount++;
      }
    } catch (error) {
      logger.error(`Failed to delete lineage ${lineage.id}:`, error);
    }
  }
  return deletedCount;
}

// ========================================
// DELETE CONFIRMATION
// ========================================

async function confirmDeletion(isApproved: boolean): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const prompt = isApproved
      ? chalk.red('\nAre you sure you want to delete this APPROVED lineage? Type "yes" to confirm: ')
      : chalk.yellow('\nAre you sure you want to delete this lineage? (y/N): ');

    rl.question(prompt, (answer) => {
      rl.close();
      
      if (isApproved) {
        resolve(answer.toLowerCase() === 'yes');
      } else {
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      }
    });
  });
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