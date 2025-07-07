#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './cli/init';
import { scanCommand } from './cli/scan';
import { listCommand } from './cli/list';
import { showCommand } from './cli/show';
import { healthCommand } from './cli/health';
import { explainCommand } from './cli/explain';
import { historyCommand } from './cli/history';
import { diffCommand } from './cli/diff';
import { similarCommand } from './cli/similar';
import { describeCommand } from './cli/describe';
import { searchCommand } from './cli/search';
import { lineageListCommand, lineageShowCommand, lineageReviewCommand } from './cli/lineage';
import { createVectorizeCommand } from './cli/vectorize';
import { createEvaluateCommand } from './cli/evaluate';
import { Logger } from './utils/cli-utils';
import { SystemChecker } from './utils/system-checker';
import { createErrorHandler, setupGlobalErrorHandlers, ErrorCode } from './utils/error-handler';

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
  .option('--details', 'show parameter and return type details')
  .option('--quality', 'show quality metrics')
  .option('--technical', 'show technical information (hashes, etc.)')
  .option('--full', 'show all information sections')
  .option('--for-users', 'user-focused display: description, parameters, usage (no metrics)')
  .option('--for-maintainers', 'maintainer-focused display: metrics, warnings, technical info')
  .option('--usage', 'show usage patterns and examples')
  .option('--examples', 'emphasize usage examples')
  .option('--source', 'show function source code')
  .option('--syntax', 'enable syntax highlighting for source code (requires --source)')
  .argument('[name-pattern]', 'function name pattern (if ID not provided)')
  .action(showCommand)
  .addHelpText('after', `
Examples:
  # Show basic function information
  $ funcqc show --id 2f1cfe1d
  $ funcqc show "functionName"
  
  # Display modes for different audiences
  $ funcqc show --id 2f1cfe1d --for-users        # User-friendly format
  $ funcqc show --id 2f1cfe1d --for-maintainers  # Technical details
  
  # Show source code
  $ funcqc show --id 2f1cfe1d --source           # Plain source code
  $ funcqc show --id 2f1cfe1d --source --syntax  # With syntax highlighting
  
  # Specific information sections
  $ funcqc show --id 2f1cfe1d --usage            # Usage patterns
  $ funcqc show --id 2f1cfe1d --examples         # Usage examples
  $ funcqc show --id 2f1cfe1d --quality          # Quality metrics
  
  # Complete information
  $ funcqc show --id 2f1cfe1d --full             # All sections
  
  # JSON output for programmatic use
  $ funcqc show --id 2f1cfe1d --json

How to find function IDs:
  $ funcqc list --cc-ge 10                       # List complex functions
  $ funcqc search "functionName"                 # Search by name
`);

program
  .command('health')
  .description('Show project health and risk assessment')
  .option('--trend', 'show trend analysis')
  .option('--risks', 'show detailed risk assessment')
  .option('--show-config', 'show configuration details')
  .option('--verbose', 'show detailed information')
  .option('--json', 'output as JSON')
  .option('--period <days>', 'period for trend analysis (default: 7)')
  .action(async (options, cmd) => {
    // グローバルオプションをマージ
    const globalOpts = cmd.parent.opts();
    const mergedOptions = { ...globalOpts, ...options };
    await healthCommand(mergedOptions);
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
  .option('--all', 'show all snapshots including where function is absent (with --id)')
  .option('--json', 'output as JSON')
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
  .option('--lineage', 'detect lineage for removed functions')
  .option('--lineage-threshold <value>', 'similarity threshold for lineage detection (0-1)', '0.7')
  .option('--lineage-detectors <list>', 'comma-separated list of similarity detectors')
  .option('--lineage-auto-save', 'automatically save detected lineage as draft')
  .action(diffCommand)
  .addHelpText('after', `
Examples:
  # Basic diff
  $ funcqc diff HEAD~1 HEAD
  
  # Show summary only
  $ funcqc diff abc123 def456 --summary
  
  # Filter by function name
  $ funcqc diff v1.0 v2.0 --function "handle*"
  
  # Detect lineage for removed functions
  $ funcqc diff HEAD~1 HEAD --lineage
  
  # Lineage with custom threshold and auto-save
  $ funcqc diff main feature --lineage --lineage-threshold 0.8 --lineage-auto-save
  
  # Use specific detectors for lineage
  $ funcqc diff v1 v2 --lineage --lineage-detectors "advanced-structural,hash-duplicate"
`);


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
  .option('--source <type>', 'description source (human|ai|jsdoc), must match existing source unless --force is used', 'human')
  .option('--model <name>', 'AI model name (for AI-generated descriptions)')
  .option('--confidence <score>', 'confidence score (0-1, for AI-generated descriptions)')
  .option('--input <file>', 'input JSON file for batch mode')
  .option('--by <author>', 'author/creator name')
  .option('--list-undocumented', 'list functions without descriptions')
  .option('--needs-description', 'list functions needing description updates')
  .option('--show-id', 'show complete function IDs')
  .option('--force', 'bypass source guard protection')
  .option('--json', 'output as JSON')
  .option('--usage-example <example>', 'add usage example (can include line breaks)')
  .option('--side-effects <effects>', 'document side effects and outputs')
  .option('--error-conditions <conditions>', 'document error conditions and handling')
  .option('--generate-template', 'generate JSON template for the specified function')
  .option('--ai-mode', 'enable AI-optimized batch processing')
  .action(describeCommand)
  .addHelpText('after', `
Examples:
  # Basic description
  $ funcqc describe myFunction --text "Basic description of the function"
  
  # Comprehensive documentation
  $ funcqc describe func123 \\
    --text "Main description" \\
    --usage-example "myFunction(param1, param2)" \\
    --side-effects "Modifies global state" \\
    --error-conditions "Throws on invalid input"
    
  # AI-generated description
  $ funcqc describe myFunction \\
    --text "AI-generated description" \\
    --source ai --model "gpt-4" --confidence 0.9
    
  # Batch processing with JSON file
  $ funcqc describe --input descriptions.json --ai-mode
  
  # Generate template for AI workflow
  $ funcqc describe --id 2f1cfe1d --generate-template > template.json
  
  # List functions needing documentation
  $ funcqc describe --list-undocumented
  $ funcqc describe --needs-description

JSON Format for --input (batch mode):
  [
    {
      "semanticId": "function-semantic-id",
      "description": "Function description",
      "source": "human|ai|jsdoc",
      "usageExample": "example(param1, param2)",
      "sideEffects": "Side effects description",
      "errorConditions": "Error conditions",
      "aiModel": "model-name",
      "confidenceScore": 0.95,
      "createdBy": "author-name"
    }
  ]

AI Workflow:
  1. Generate descriptions.json with structured data
  2. Use 'funcqc describe --input descriptions.json' for batch processing
  3. Verify results with 'funcqc show --id <function-id> --for-users'
`);

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

// Add lineage commands
program
  .command('lineage')
  .description('Manage function lineage tracking')
  .addCommand(
    new Command('list')
      .description('List function lineages')
      .option('--status <status>', 'filter by status (draft|approved|rejected)')
      .option('--kind <kind>', 'filter by lineage kind (rename|signature-change|inline|split)')
      .option('--limit <num>', 'limit number of results', '50')
      .option('--sort <field>', 'sort by field (confidence|kind|status|created)', 'created')
      .option('--desc', 'sort in descending order')
      .option('--json', 'output as JSON')
      .option('--from-function <pattern>', 'filter by source function name pattern')
      .option('--to-function <pattern>', 'filter by target function name pattern')
      .option('--confidence <threshold>', 'filter by minimum confidence (0-1)')
      .action(lineageListCommand)
      .addHelpText('after', `
Examples:
  $ funcqc lineage list                           # List all lineages
  $ funcqc lineage list --status draft           # List only draft lineages
  $ funcqc lineage list --kind rename            # List only rename lineages
  $ funcqc lineage list --confidence 0.8         # High confidence lineages only
  $ funcqc lineage list --sort confidence --desc # Sort by confidence descending
`)
  )
  .addCommand(
    new Command('show')
      .description('Show detailed lineage information')
      .argument('<lineage-id>', 'lineage ID to display')
      .action(lineageShowCommand)
      .addHelpText('after', `
Examples:
  $ funcqc lineage show abc12345                 # Show lineage details
`)
  )
  .addCommand(
    new Command('review')
      .description('Review and approve/reject draft lineages')
      .argument('[lineage-id]', 'lineage ID to review (required unless --all)')
      .option('--approve', 'approve the lineage')
      .option('--reject', 'reject the lineage')
      .option('--note <text>', 'add review note')
      .option('--all', 'review all draft lineages')
      .action(lineageReviewCommand)
      .addHelpText('after', `
Examples:
  $ funcqc lineage review abc12345 --approve     # Approve specific lineage
  $ funcqc lineage review abc12345 --reject --note "Incorrect mapping"
  $ funcqc lineage review --all --approve        # Approve all draft lineages
`)
  );

// Add explain command
program
  .command('explain')
  .description('Explain quality metrics and concepts')
  .argument('[metric-or-concept]', 'specific metric or concept to explain')
  .option('--metric <name>', 'explain specific metric')
  .option('--concept <name>', 'explain concept (complexity, maintainability, quality, testing, refactoring)')
  .option('--threshold', 'explain threshold system')
  .option('--all', 'list all available metrics and concepts')
  .option('--examples', 'include code examples in explanations')
  .option('--format <type>', 'output format (table|detailed)', 'detailed')
  .action(explainCommand)
  .addHelpText('after', `
Examples:
  $ funcqc explain cyclomaticComplexity              # Explain specific metric
  $ funcqc explain --concept complexity              # Explain concept
  $ funcqc explain --threshold                       # Explain threshold system
  $ funcqc explain --all                             # List all metrics
  $ funcqc explain maintainability --examples        # Include examples

Available Metrics:
  Complexity: cyclomaticComplexity, cognitiveComplexity, maxNestingLevel
  Size: linesOfCode, totalLines, parameterCount
  Structure: branchCount, loopCount, returnStatementCount, tryCatchCount
  Advanced: halsteadVolume, halsteadDifficulty, maintainabilityIndex
  Documentation: commentLines, codeToCommentRatio
  Patterns: asyncAwaitCount, callbackCount

Available Concepts:
  complexity, maintainability, quality, testing, refactoring
`);

// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red('Invalid command: %s'), program.args.join(' '));
  console.log(chalk.yellow('See --help for a list of available commands.'));
  process.exit(1);
});

// Setup error handling and system checks
function setupErrorHandling() {
  // Get options from Commander.js after parsing
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

const READ_ONLY_COMMANDS = ['list', 'health', 'show', 'history', 'diff', 'search', 'similar', 'explain'] as const;

function isReadOnlyCommand(): boolean {
  const command = process.argv[2];
  return READ_ONLY_COMMANDS.includes(command as typeof READ_ONLY_COMMANDS[number]);
}

// Pre-action hook for all commands
program.hook('preAction', () => {
  const { logger, errorHandler } = setupErrorHandling();
  
  const options = program.opts();
  
  // Handle --check-system flag
  if (options['checkSystem']) {
    performSystemCheck(logger, false);
    process.exit(0);
  }
  
  // Handle --cwd flag
  if (options['cwd']) {
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
  
  // Handle system check before commands
  if (!options['noCheck']) {
    // Skip system checks for read-only commands unless explicitly requested
    if (!isReadOnlyCommand() || options['checkSystem']) {
      const systemOk = performSystemCheck(logger, false);
      if (!systemOk) {
        logger.error('System requirements not met. Use --no-check to bypass.');
        process.exit(1);
      }
    }
  }
});

// Handle help display for no arguments
function handleHelpDisplay(): void {
  if (process.argv.slice(2).length) return;
  
  program.outputHelp();
  process.exit(0);
}

// Main execution
async function main() {
  try {
    // Handle help display for no arguments
    handleHelpDisplay();
    
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
