#!/usr/bin/env node

import { Command, OptionValues } from 'commander';
import chalk from 'chalk';
import { initCommand } from './cli/init';
import { scanCommand } from './cli/scan';
import { listCommand } from './cli/list';
import { showCommand } from './cli/show';
import { statusCommand } from './cli/status';
import { historyCommand } from './cli/history';
import { diffCommand } from './cli/diff';
import { trendCommand } from './cli/trend';
import { similarCommand } from './cli/similar';
import { describeCommand } from './cli/describe';
import { searchCommand } from './cli/search';
import { createVectorizeCommand } from './cli/vectorize';
import { createEvaluateCommand } from './cli/evaluate';
import { Logger } from './utils/cli-utils';
import { SystemChecker } from './utils/system-checker';
import { createErrorHandler, setupGlobalErrorHandlers, ErrorCode, ErrorHandler } from './utils/error-handler';

const program = new Command();

program
  .name('funcqc')
  .description('Function Quality Control for TypeScript projects')
  .version('0.1.0');

// Global options
program
  .option('--config <path>', 'specify config file path')
  .option('--no-config', 'ignore config file')
  .option('--cwd <path>', 'change working directory')
  .option('--verbose', 'enable verbose output')
  .option('--quiet', 'suppress output')
  .option('--no-color', 'disable colored output')
  .option('--check-system', 'run system requirements check')
  .option('--no-check', 'skip system requirements check');

// Commands
program
  .command('init')
  .description('Initialize funcqc configuration')
  .option('--root <paths>', 'root directories to scan (comma-separated)', 'src')
  .option('--exclude <patterns>', 'exclude patterns (comma-separated)')
  .option('--db <path>', 'database path', '.funcqc/funcqc.db')
  .option('--show', 'show current configuration')
  .option('--reset', 'reset configuration to defaults')
  .action(initCommand);

program
  .command('scan')
  .description('Scan and analyze functions')
  .option('--label <text>', 'label for this snapshot')
  .option('--comment <text>', 'mandatory comment when scan configuration changes')
  .action(scanCommand);

program
  .command('list')
  .description('List all functions')
  .option('--json', 'output as JSON')
  .option('--limit <num>', 'limit number of results')
  .option('--sort <field>', 'sort by field (cc, loc, name, file)')
  .option('--desc', 'sort in descending order')
  .option('--cc-ge <num>', 'filter functions with complexity >= N')
  .option('--file <pattern>', 'filter by file path pattern')
  .option('--name <pattern>', 'filter by function name pattern')
  .action(listCommand);

program
  .command('show')
  .description('Show detailed information about a specific function')
  .option('--id <function-id>', 'function ID to show details for')
  .option('--json', 'output as JSON')
  .argument('[name-pattern]', 'function name pattern (if ID not provided)')
  .action(showCommand);

program
  .command('status')
  .description('Show current project status')
  .option('--verbose', 'show detailed information')
  .action(async (options, cmd) => {
    // グローバルオプションをマージ
    const globalOpts = cmd.parent.opts();
    const mergedOptions = { ...globalOpts, ...options };
    await statusCommand(mergedOptions);
  });

program
  .command('history')
  .description('Show snapshot history')
  .option('--verbose', 'show detailed information')
  .option('--since <date>', 'show snapshots since date')
  .option('--until <date>', 'show snapshots until date')
  .option('--limit <num>', 'limit number of snapshots', '20')
  .option('--author <name>', 'filter by commit author')
  .option('--branch <name>', 'filter by git branch')
  .option('--label <text>', 'filter by snapshot label')
  .option('--id <function-id>', 'track history of specific function by ID')
  .action(async (options, cmd) => {
    // グローバルオプションをマージ
    const globalOpts = cmd.parent.opts();
    const mergedOptions = { ...globalOpts, ...options };
    await historyCommand(mergedOptions);
  });

program
  .command('diff')
  .description('Compare two snapshots')
  .argument('<from>', 'source snapshot (ID, label, or "latest")')
  .argument('<to>', 'target snapshot (ID, label, or "latest")')
  .option('--summary', 'show summary only')
  .option('--function <pattern>', 'filter by function name pattern')
  .option('--file <pattern>', 'filter by file path pattern')
  .option('--metric <name>', 'filter by specific metric changes')
  .option('--threshold <num>', 'minimum change threshold for numeric values')
  .option('--json', 'output as JSON')
  .action(diffCommand);

program
  .command('trend')
  .description('Show quality trends over time')
  .option('--weekly', 'show weekly trends (default)')
  .option('--monthly', 'show monthly trends')
  .option('--daily', 'show daily trends')
  .option('--period <days>', 'custom period in days', '30')
  .option('--metric <name>', 'focus on specific metric')
  .option('--summary', 'show summary only')
  .option('--json', 'output as JSON')
  .action(trendCommand);

program
  .command('similar')
  .description('Detect similar functions using AST analysis')
  .option('--threshold <value>', 'similarity threshold (0-1)', '0.65')
  .option('--json', 'output as JSON')
  .option('--jsonl', 'output as JSON Lines (for large datasets)')
  .option('--snapshot <id>', 'analyze specific snapshot (default: latest)')
  .option('--min-lines <num>', 'minimum lines of code to consider', '3')
  .option('--no-cross-file', 'only detect similarities within same file')
  .option('--detectors <list>', 'comma-separated list of detectors to use')
  .option('--consensus <strategy>', 'consensus strategy (majority[:threshold], intersection, union, weighted)')
  .option('--output <file>', 'save JSON output to file')
  .option('--limit <num>', 'limit number of results')
  .action(similarCommand);

program
  .command('describe')
  .description('Add or manage function descriptions')
  .argument('[function-id]', 'function ID or name pattern')
  .option('--text <description>', 'description text')
  .option('--source <type>', 'description source (human|ai|jsdoc)', 'human')
  .option('--model <name>', 'AI model name (for AI-generated descriptions)')
  .option('--confidence <score>', 'confidence score (0-1, for AI-generated descriptions)')
  .option('--input <file>', 'input JSON file for batch mode')
  .option('--by <author>', 'author/creator name')
  .option('--list-undocumented', 'list functions without descriptions')
  .option('--needs-description', 'list functions needing description updates')
  .option('--show-id', 'show complete function IDs')
  .option('--force', 'bypass source guard protection')
  .option('--json', 'output as JSON')
  .action(describeCommand);

program
  .command('search')
  .description('Search functions by description keywords')
  .argument('<keyword>', 'search keyword')
  .option('--format <type>', 'output format (table|json|friendly)', 'table')
  .option('--limit <num>', 'limit number of results', '50')
  .option('--json', 'output as JSON')
  .option('--semantic', 'use semantic search with local TF-IDF embeddings')
  .option('--threshold <value>', 'similarity threshold for semantic search (0-1)', '0.3')
  .option('--hybrid', 'use hybrid search (keyword + semantic + AST)')
  .option('--hybrid-weight <value>', 'weight for semantic vs keyword (0-1)', '0.5')
  .option('--show-similarity', 'show similarity scores in results')
  .option('--min-similarity <value>', 'minimum similarity score to include results', '0.1')
  .option('--ai-hints <json>', 'AI hints as JSON: {"relatedTerms":["term1"],"context":"..."}')
  .option('--similarity-weights <json>', 'similarity algorithm weights as JSON: {"tfidf":0.5,"ngram":0.3,"jaccard":0.2}')
  .option('--context-functions <ids>', 'comma-separated function IDs for AST context in hybrid search')
  .option('--intermediate', 'output intermediate results for AI analysis')
  .action(searchCommand)
  .addHelpText('after', `
Examples:
  $ funcqc search "authentication"                        # Basic keyword search
  $ funcqc search "user login" --semantic                 # Local semantic search
  $ funcqc search "error handling" --hybrid               # Hybrid search (keyword + semantic + AST)
  $ funcqc search "validation" --semantic --threshold 0.5 # Higher precision semantic search
  $ funcqc search "database" --hybrid --show-similarity   # Show similarity scores
  $ funcqc search "auth" --semantic --ai-hints '{"relatedTerms":["login","verify"]}' # AI-enhanced search

Local Semantic Search:
  Uses TF-IDF vectorization and cosine similarity
  No external API required - purely local computation
  Supports AI hints for enhanced relevance
  Better for finding functions by purpose/behavior

Hybrid Search:
  Combines keyword, semantic, and AST structural similarity
  Weighted scoring across multiple algorithms
  Context-aware with reference function IDs
  Optimal for comprehensive code exploration
`);

// Add vectorize command
program.addCommand(createVectorizeCommand());

// Add evaluate command (v1.6 enhancement)
program.addCommand(createEvaluateCommand());


// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red('Invalid command: %s'), program.args.join(' '));
  console.log(chalk.yellow('See --help for a list of available commands.'));
  process.exit(1);
});

// Setup error handling and system checks
function setupErrorHandling() {
  const options = program.opts();
  const logger = new Logger(options['verbose'], options['quiet']);
  const errorHandler = createErrorHandler(logger);
  
  // Setup global error handlers
  setupGlobalErrorHandlers(errorHandler);
  
  return { logger, errorHandler };
}

function performSystemCheck(logger: Logger, skipCheck: boolean = false): boolean {
  if (skipCheck) return true;
  
  const systemChecker = new SystemChecker(logger);
  return systemChecker.reportSystemCheck();
}

function handleSystemCheckFlag(options: OptionValues, logger: Logger): void {
  if (!options['checkSystem']) return;
  
  performSystemCheck(logger, false);
  process.exit(0);
}

function handleWorkingDirectoryChange(options: OptionValues, errorHandler: ErrorHandler): void {
  if (!options['cwd']) return;
  
  try {
    process.chdir(options['cwd']);
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.FILE_NOT_ACCESSIBLE,
      `Cannot change to directory: ${options['cwd']}`,
      { directory: options['cwd'] },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

function handleHelpDisplay(): void {
  if (process.argv.slice(2).length) return;
  
  program.outputHelp();
  process.exit(0);
}

const READ_ONLY_COMMANDS = ['list', 'status', 'show', 'history', 'diff', 'trend', 'search', 'similar'] as const;

function isReadOnlyCommand(): boolean {
  const command = process.argv[2];
  return READ_ONLY_COMMANDS.includes(command as typeof READ_ONLY_COMMANDS[number]);
}

function handleSystemCheckBeforeCommands(options: OptionValues, logger: Logger): void {
  if (options['noCheck']) return;
  
  // Skip system checks for read-only commands unless explicitly requested
  if (isReadOnlyCommand() && !options['checkSystem']) {
    return;
  }
  
  const systemOk = performSystemCheck(logger, false);
  if (!systemOk) {
    logger.error('System requirements not met. Use --no-check to bypass.');
    process.exit(1);
  }
}

// Main execution
async function main() {
  try {
    const { logger, errorHandler } = setupErrorHandling();
    const options = program.opts();
    
    handleSystemCheckFlag(options, logger);
    handleWorkingDirectoryChange(options, errorHandler);
    handleHelpDisplay();
    handleSystemCheckBeforeCommands(options, logger);
    
    await program.parseAsync(process.argv);
    
  } catch (error) {
    console.error(chalk.red('Fatal error during startup:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error(chalk.red('Unhandled error:'), error);
  process.exit(1);
});
