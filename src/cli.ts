#!/usr/bin/env node

import { Command, OptionValues } from 'commander';
import chalk from 'chalk';
import { Logger } from './utils/cli-utils';
import { SystemChecker } from './utils/system-checker';
import { createErrorHandler, setupGlobalErrorHandlers, ErrorCode } from './utils/error-handler';
import { GracefulShutdown } from './utils/graceful-shutdown';


// Dynamic imports for all commands to improve startup performance

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
  .action(async (options: OptionValues) => {
    const { initCommand } = await import('./cli/init');
    return initCommand(options);
  });

program
  .command('config')
  .description('Manage configuration presets and settings')
  .argument('<action>', 'action to perform (list, show, apply, compare, suggest, backup, validate, edit)')
  .option('--preset <id>', 'preset ID to work with')
  .option('--replace', 'replace current configuration instead of merging')
  .option('--no-validate', 'skip validation when applying presets')
  .option('--no-backup', 'skip backup creation when applying presets')
  .option('--dry-run', 'show what would change without applying')
  .option('--interactive', 'use interactive mode for confirmations')
  .option('--output <path>', 'output file path for backup')
  .option('--json', 'output as JSON')
  .action(async (action: string, options: OptionValues, cmd) => {
    // グローバルオプションをマージ
    const globalOpts = cmd.parent.opts();
    const mergedOptions = { ...globalOpts, ...options };
    const { configCommand } = await import('./cli/config');
    await configCommand(action, mergedOptions);
  })
  .addHelpText('after', `
Examples:
  # Show current configuration
  $ funcqc config show
  
  # List available presets
  $ funcqc config list
  
  # Show details of a specific preset
  $ funcqc config show --preset web-frontend
  
  # Apply a preset to current configuration
  $ funcqc config apply --preset web-frontend
  
  # Preview changes without applying
  $ funcqc config apply --preset api-backend --dry-run
  
  # Compare current config with preset
  $ funcqc config compare --preset library
  
  # Get preset suggestions for current project
  $ funcqc config suggest
  
  # Backup current configuration
  $ funcqc config backup
  
  # Validate current configuration
  $ funcqc config validate
  
  # Show configuration file location for editing
  $ funcqc config edit
`);

program
  .command('scan')
  .description('Scan and analyze functions')
  .option('--label <text>', 'label for this snapshot')
  .option('--comment <text>', 'mandatory comment when scan configuration changes')
  .option('--scope <name>', 'scan specific scope (src, test, all, or custom scope)')
  .option('--realtime-gate', 'enable real-time quality gate with adaptive thresholds')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { scanCommand } = await import('./cli/commands/scan');
    return withEnvironment(scanCommand)(options, command);
  });

program
  .command('list')
  .description('List all functions')
  .option('-j, --json', 'output as JSON for jq/script processing')
  .option('--limit <num>', 'limit number of results')
  .option('--sort <field>', 'sort by field (cc, loc, changes, name, file)')
  .option('--desc', 'sort in descending order')
  .option('--cc-ge <num>', 'filter functions with complexity >= N')
  .option('--changes-ge <num>', 'filter functions with change count >= N')
  .option('--file <pattern>', 'filter by file path pattern')
  .option('--name <pattern>', 'filter by function name pattern')
  .option('--scope <name>', 'filter by scope (src, test, all, or custom scope)')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { listCommand } = await import('./cli/commands/list');
    return withEnvironment(listCommand)(options, command);
  });

program
  .command('show')
  .description('Show detailed information about a specific function')
  .option('--id <function-id>', 'function ID to show details for')
  .option('-j, --json', 'output as JSON for jq/script processing')
  .option('--usage', 'show usage information, examples, error handling, side effects')
  .option('--current', 'show current quality metrics and analysis (default)')
  .option('--history', 'show historical metrics and changes for this function')
  .option('--source', 'show source code (combinable with other options)')
  .argument('[name-pattern]', 'function name pattern (if ID not provided)')
  .action(async (namePattern: string | undefined, options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { showCommand } = await import('./cli/commands/show');
    return withEnvironment(showCommand(namePattern || ''))(options, command);
  })
  .addHelpText('after', `
Examples:
  # Show current metrics (default behavior)
  $ funcqc show --id 2f1cfe1d
  $ funcqc show "functionName"
  
  # Show usage information
  $ funcqc show --id 2f1cfe1d --usage
  
  # Show historical changes
  $ funcqc show --id 2f1cfe1d --history
  
  # Show source code with metrics
  $ funcqc show --id 2f1cfe1d --current --source
  $ funcqc show --id 2f1cfe1d --history --source
  
  # JSON output for programmatic use
  $ funcqc show --id 2f1cfe1d --json

How to find function IDs:
  $ funcqc list --cc-ge 10                       # List complex functions
  $ funcqc search "functionName"                 # Search by name
`);

program
  .command('files')
  .description('List and display source files stored in snapshots')
  .option('--snapshot <id>', 'snapshot ID to display files from (default: latest)')
  .option('--language <lang>', 'filter by programming language')
  .option('--path <pattern>', 'filter by file path pattern')
  .option('--sort <field>', 'sort by field (path, size, lines, functions, language, modified)', 'path')
  .option('--desc', 'sort in descending order')
  .option('--limit <num>', 'limit number of results')
  .option('--stats', 'show file statistics')
  .option('--json', 'output as JSON')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { filesCommand } = await import('./cli/commands/files');
    return withEnvironment(filesCommand())(options, command);
  })
  .addHelpText('after', `
Examples:
  # List all source files from latest snapshot
  $ funcqc files

  # Show files with statistics
  $ funcqc files --stats

  # Filter by language
  $ funcqc files --language typescript

  # Filter by path pattern
  $ funcqc files --path "src/cli/*"

  # Sort by file size (largest first)
  $ funcqc files --sort size --desc

  # Show files from specific snapshot
  $ funcqc files --snapshot abc123

  # JSON output for processing
  $ funcqc files --json

Features:
  - Lists source files stored during scan operations
  - Shows file metadata: size, lines, function count, language
  - Provides filtering and sorting capabilities
  - Displays file statistics with --stats option
  - Supports both table and JSON output formats
`);

program
  .command('health')
  .description('Show project health assessment')
  .option('--trend', 'show trend analysis')
  .option('--show-config', 'show configuration details')
  .option('--verbose', 'show detailed information')
  .option('--json', 'output as JSON for jq/script processing')
  .option('--period <days>', 'period for trend analysis (default: 7)')
  .option('--snapshot <id>', 'analyze specific snapshot (ID, label, HEAD~N, git ref)')
  .option('--diff [snapshots]', 'compare snapshots: --diff (latest vs prev), --diff <id> (latest vs id), --diff "<id1> <id2>" (id1 vs id2)')
  .option('--scope <name>', 'analyze specific scope (src, test, all, or custom scope)')
  .option('--mode <mode>', 'evaluation mode: static or dynamic (default: static)')
  .option('--explain-weight <function>', 'explain weight calculation for specific function (ID or name)')
  .option('--top-n <number>', 'number of top recommendations to show (default: 3, verbose: 10)', '3')
  .option('--ai-optimized', 'deprecated: use --json instead')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { healthCommand } = await import('./cli/commands/health');
    return withEnvironment(healthCommand)(options, command);
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
  .option('--scope <name>', 'filter by analysis scope (src, test, etc.)')
  .option('--json', 'output as JSON')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { historyCommand } = await import('./cli/commands/history');
    return withEnvironment(historyCommand)(options, command);
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
  .option('--no-change-detection', 'disable smart change detection for modified functions')
  .option('--insights', 'show suggested actions and insights for similarity analysis')
  .option('--similarity-threshold <num>', 'similarity threshold for function matching (0-1, default: 0.95)', '0.95')
  .action(async (from: string, to: string, options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { diffCommand } = await import('./cli/commands/diff');
    return withEnvironment(diffCommand(from, to))(options, command);
  })
  .addHelpText('after', `
Examples:
  # Basic diff
  $ funcqc diff HEAD~1 HEAD
  
  # Show summary only
  $ funcqc diff abc123 def456 --summary
  
  # Filter by function name
  $ funcqc diff v1.0 v2.0 --function "handle*"
  
  # Smart change detection (enabled by default)
  $ funcqc diff HEAD~1 HEAD
  
  # Disable smart change detection
  $ funcqc diff v1 v2 --no-change-detection
`);


program
  .command('similar')
  .description('Detect similar functions using AST analysis')
  .option('--threshold <value>', 'similarity threshold (0-1)', '0.95')
  .option('--json', 'output as JSON')
  .option('--jsonl', 'output as JSON Lines (for large datasets)')
  .option('--snapshot <id>', 'analyze specific snapshot (default: latest)')
  .option('--min-lines <num>', 'minimum lines of code to consider', '3')
  .option('--no-cross-file', 'only detect similarities within same file')
  .option('--recall <strategy>', 'completeness vs performance: guaranteed|fast', 'guaranteed')
  .option('--detectors <list>', 'comma-separated list of detectors to use')
  .option('--consensus <strategy>', 'consensus strategy (majority[:threshold], intersection, union, weighted)')
  .option('--output <file>', 'save JSON output to file')
  .option('--limit <num>', 'limit number of results')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { similarCommand } = await import('./cli/commands/similar');
    return withEnvironment(similarCommand)(options, command);
  });

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
  .action(async (functionId: string | undefined, options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { describeCommand } = await import('./cli/commands/describe');
    return withEnvironment(describeCommand(functionId || ''))(options, command);
  })
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
  .action(async (keyword: string, options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { searchCommand } = await import('./cli/commands/search');
    return withEnvironment(searchCommand(keyword))(options, command);
  })
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


// Add detect command for code quality issues
program
  .command('detect')
  .description('Detect code quality issues and anti-patterns')
  .argument('<subcommand>', 'detection type (ineffective-splits)')
  .option('--json', 'output as JSON')
  .option('--format <format>', 'output format (table, json)', 'table')
  .option('--min-severity <level>', 'minimum severity level (High, Medium, Low)')
  .option('--include-test', 'include test files in analysis')
  .option('--include-boundaries', 'include boundary functions in analysis')
  .option('--limit <num>', 'maximum findings to display')
  .option('--threshold <value>', 'minimum score threshold (0-10)')
  .option('--min-lines <num>', 'minimum lines of code to analyze (excludes tiny functions)')
  .option('--score-mode <mode>', 'scoring strategy: sum (legacy) or prob (default)', 'prob')
  .option('--r2-ast', 'enable AST-based R2 analysis (more precise but slower)')
  .option('--snapshot <id>', 'analyze specific snapshot')
  .action(async (subcommand: string, options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { detectCommand } = await import('./cli/commands/detect');
    return withEnvironment(detectCommand(subcommand))(options, command);
  })
  .addHelpText('after', `
Examples:
  # Detect ineffective function splits
  $ funcqc detect ineffective-splits
  
  # High severity only
  $ funcqc detect ineffective-splits --min-severity High
  
  # Include test files
  $ funcqc detect ineffective-splits --include-test
  
  # JSON output for processing
  $ funcqc detect ineffective-splits --json
  
  # Limit results
  $ funcqc detect ineffective-splits --limit 10

Detection Types:
  ineffective-splits    Functions that were split but add no value
                       (thin wrappers, passthrough functions, etc.)

The detect command helps identify code quality issues that automated
refactoring tools (including AI) might introduce, such as unnecessary
function splits that don't improve maintainability or reusability.
`);

// Add evaluate command (v1.6 enhancement) - loaded dynamically
program.addCommand(
  new Command('evaluate')
    .description('Evaluate function naming quality')
    .action(async () => {
      const { createEvaluateCommand } = await import('./cli/evaluate-naming');
      const evaluateCommand = createEvaluateCommand();
      await evaluateCommand.parseAsync(process.argv.slice(2));
    })
);

// Add real-time code quality evaluation command (Phase 5)
program
  .command('eval')
  .description('Real-time code quality evaluation for AI-generated code')
  .argument('[input]', 'TypeScript code file to evaluate (or use --stdin)')
  .option('--stdin', 'read code from stdin')
  .option('--ai-generated', 'code is AI-generated (affects exit codes)')
  .option('--strict', 'strict mode for critical violations')
  .option('-j, --json', 'output as JSON for integration')
  .option('--evaluate-all', 'evaluate all functions in the file/code')
  .action(async (input: string | undefined, options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { evaluateCommand } = await import('./cli/commands/evaluate');
    return withEnvironment(evaluateCommand(input || ''))(options, command);
  })
  .addHelpText('after', `
Examples:
  # Evaluate a file
  $ funcqc eval myFunction.ts
  
  # Evaluate from stdin (AI workflow)
  $ echo "function test() { return 42; }" | funcqc eval --stdin --ai-generated
  
  # Evaluate all functions in a file
  $ funcqc eval myModule.ts --evaluate-all
  
  # JSON output for integration
  $ funcqc eval code.ts --json
  
  # Evaluate all functions with JSON output
  $ funcqc eval code.ts --evaluate-all --json
  
  # Strict mode (exit 1 on any critical violation)
  $ funcqc eval code.ts --strict
  
AI Integration:
  - Use --ai-generated for proper exit codes (0=acceptable, 1=needs improvement)
  - Use --json for structured output with improvement suggestions
  - Use --evaluate-all to assess all functions in the code
  - Sub-20ms response time for real-time feedback
  - Adaptive thresholds based on project baseline
`);



program
  .command('db')
  .description('Database management and backup operations')
  .option('--list', 'list all available tables')
  .option('--table <name>', 'table name to query')
  .option('--limit <num>', 'limit number of rows (default: 10, max: 10000)')
  .option('--limit-all', 'get all rows (no limit)')
  .option('--where <condition>', 'simple WHERE condition (e.g., "id = \'abc123\'")')
  .option('--columns <list>', 'comma-separated list of columns to select')
  .option('--json', 'output as JSON')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { dbCommand } = await import('./cli/commands/db');
    return withEnvironment(dbCommand)(options, command);
  })
  .addHelpText('after', `
Database Query Examples:
  # List all available tables
  $ funcqc db --list
  
  # Show recent snapshots
  $ funcqc db --table snapshots --limit 5
  
  # Show all source contents (no limit)
  $ funcqc db --table source_contents --limit-all
  
  # Query specific columns
  $ funcqc db --table functions --columns "id,name,file_path" --limit 10
  
  # Filter with WHERE clause
  $ funcqc db --table functions --where "cyclomatic_complexity > 10" --limit 5
  
  # JSON output for processing
  $ funcqc db --table snapshots --json | jq '.rows[0]'

Database Backup Examples:
  # Create a backup with label
  $ funcqc db export --label "before-refactor"
  
  # List all available backups
  $ funcqc db list-backups
  
  # Restore from backup
  $ funcqc db import --backup .funcqc/backups/20241201-143022-before-refactor
  
  # Convert backup format
  $ funcqc db convert --input backup1 --output backup2 --format json

Safety Features:
  - Read-only access (SELECT statements only)
  - Input validation and sanitization
  - Row limits to prevent overwhelming output
  - Comprehensive backup and restore capabilities
`);

// Add db subcommands for backup operations
const dbCommand = program.commands.find(cmd => cmd.name() === 'db')!;

dbCommand.command('export')
  .description('Create comprehensive database backup')
  .option('--label <text>', 'label for this backup')
  .option('--output-dir <path>', 'output directory for backup (overrides config)')
  .option('--include-source-code', 'include source code in backup')
  .option('--compress', 'compress backup files')
  .option('--format <format>', 'backup format (json, sql)', 'json')
  .option('--dry-run', 'preview backup without creating files')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { dbExportCommand } = await import('./cli/commands/db/export');
    return withEnvironment(dbExportCommand)(options);
  });

dbCommand.command('import')
  .description('Restore database from backup')
  .option('--backup <path>', 'path to backup directory')
  .option('--no-verify-schema', 'skip schema version verification')
  .option('--overwrite', 'overwrite existing data (dangerous!)')
  .option('--dry-run', 'preview import without modifying data')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { dbImportCommand } = await import('./cli/commands/db/import');
    return withEnvironment(dbImportCommand)(options);
  });

dbCommand.command('list-backups')
  .description('List available database backups')
  .option('--json', 'output as JSON')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { dbListBackupsCommand } = await import('./cli/commands/db/list-backups');
    return withEnvironment(dbListBackupsCommand)(options);
  });

dbCommand.command('convert')
  .description('Convert backup between formats and handle schema migrations')
  .option('--input <path>', 'input backup directory')
  .option('--output <path>', 'output backup directory')
  .option('--format <format>', 'target format (json, sql)', 'json')
  .option('--allow-schema-mismatch', 'proceed even if schema versions differ')
  .option('--update-schema', 'update backup to current schema version')
  .option('--force', 'force conversion even if formats are the same')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { dbConvertCommand } = await import('./cli/commands/db/convert');
    return withEnvironment(dbConvertCommand)(options);
  });

// Dep command - Function dependency analysis
program
  .command('dep')
  .description('Function dependency analysis')
  .action(() => {
    console.log(chalk.yellow('Please specify a dep subcommand:'));
    console.log('  list     - List function dependencies');
    console.log('  show     - Show detailed dependency information');
    console.log('  stats    - Show dependency statistics and metrics');
    console.log('  lint     - Lint architecture dependencies against rules');
    console.log('  dead     - Detect dead code (unreachable functions)');
    console.log('  cycles   - Detect circular dependencies in the call graph');
    console.log('\nExample: funcqc dep list');
  });

// Add dep subcommands
const depCommand = program.commands.find(cmd => cmd.name() === 'dep')!;

depCommand.command('list')
  .description('List function dependencies')
  .option('--caller <pattern>', 'filter by caller function pattern')
  .option('--callee <pattern>', 'filter by callee function pattern')
  .option('--caller-class <pattern>', 'filter by caller class name pattern')
  .option('--callee-class <pattern>', 'filter by callee class name pattern')
  .option('--file <pattern>', 'filter by file path pattern')
  .option('--type <type>', 'filter by call type (direct, async, conditional, external)')
  .option('--limit <num>', 'limit number of results', '20')
  .option('--sort <field>', 'sort by field (caller, callee, file, line)', 'caller')
  .option('--desc', 'sort in descending order')
  .option('--json', 'output as JSON')
  .option('--snapshot <id>', 'use specific snapshot (default: latest)')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { depListCommand } = await import('./cli/dep');
    return withEnvironment(depListCommand)(options);
  });

depCommand.command('show')
  .description('Show detailed dependency information for a function or analyze top routes globally')
  .argument('[function]', 'function name or ID (optional - if not provided, shows global analysis)')
  .option('--direction <dir>', 'dependency direction (in, out, both)', 'out')
  .option('--depth <num>', 'maximum depth for dependency traversal', '2')
  .option('--include-external', 'include external dependencies')
  .option('--external-filter <mode>', 'filter external dependencies (all, transit, none)', 'transit')
  .option('--show-complexity', 'show complexity metrics for each function in routes')
  .option('--rank-by-length', 'sort routes by depth (longest first)')
  .option('--max-routes <num>', 'limit number of displayed routes', '5')
  .option('--json', 'output as JSON')
  .option('--snapshot <id>', 'use specific snapshot (default: latest)')
  .action(async (functionRef: string, options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { depShowCommand } = await import('./cli/dep');
    return withEnvironment(depShowCommand(functionRef))(options);
  });

depCommand.command('stats')
  .description('Show dependency statistics and metrics')
  .option('--sort <field>', 'sort by field (fanin, fanout, depth, name)', 'fanin')
  .option('--limit <num>', 'limit number of results', '20')
  .option('--show-hubs', 'show hub functions (high fan-in)')
  .option('--show-utility', 'show utility functions (high fan-out)')
  .option('--show-isolated', 'show isolated functions')
  .option('--hub-threshold <num>', 'minimum fan-in for hub functions', '5')
  .option('--utility-threshold <num>', 'minimum fan-out for utility functions', '5')
  .option('--max-hub-functions <num>', 'maximum number of hub functions to show', '10')
  .option('--max-utility-functions <num>', 'maximum number of utility functions to show', '10')
  .option('--format <format>', 'output format (table, json, dot)', 'table')
  .option('--json', 'output as JSON')
  .option('--snapshot <id>', 'use specific snapshot (default: latest)')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { depStatsCommand } = await import('./cli/dep');
    return withEnvironment(depStatsCommand)(options);
  });

depCommand.command('lint')
  .description('Lint architecture dependencies against defined rules')
  .option('--config <path>', 'path to architecture configuration file')
  .option('--format <format>', 'output format (table, json)', 'table')
  .option('--severity <level>', 'minimum severity level to report (error, warning, info)')
  .option('--max-violations <num>', 'maximum number of violations to report')
  .option('--include-metrics', 'include architecture metrics in output')
  .option('--fix', 'attempt to fix violations automatically (future feature)')
  .option('--snapshot <id>', 'analyze specific snapshot')
  .option('--show-layers', 'display layer definitions and function distribution')
  .option('--show-rules', 'display configured architecture rules')
  .option('--show-config', 'display complete architecture configuration')
  .option('--show-consolidation', 'display consolidation strategies for refactoring')
  .option('--dry-run', 'show configuration information without running violations check')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { depLintCommand } = await import('./cli/dep');
    return withEnvironment(depLintCommand)(options);
  });

depCommand.command('dead')
  .description('Detect dead code (unreachable functions) using dependency analysis')
  .option('--exclude-tests', 'exclude test functions from analysis')
  .option('--exclude-exports', 'exclude exported functions from entry points')
  .option('--exclude-small', 'exclude small functions from results')
  .option('--threshold <num>', 'minimum function size to report', '3')
  .option('--format <format>', 'output format (table, json, dot)', 'table')
  .option('--show-reasons', 'show detailed reasons for dead code')
  .option('--layer-entry-points <layers>', 'treat functions in specified layers as entry points (comma-separated)')
  .option('--verbose', 'show verbose output')
  .option('--snapshot <id>', 'analyze specific snapshot')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { depDeadCommand } = await import('./cli/dep');
    return withEnvironment(depDeadCommand)(options);
  })
  .addHelpText('after', `
Examples:
  # Basic dead code detection
  $ funcqc dep dead

  # Exclude test functions and small functions
  $ funcqc dep dead --exclude-tests --exclude-small --threshold 5

  # JSON output for automation
  $ funcqc dep dead --format json

  # Analyze specific snapshot
  $ funcqc dep dead --snapshot abc123

  # Generate DOT graph for visualization
  $ funcqc dep dead --format dot > deadcode.dot

  # Use services layer as entry points
  $ funcqc dep dead --layer-entry-points services

  # Use multiple layers as entry points
  $ funcqc dep dead --layer-entry-points services,api,orchestration

Note: This command uses the same call graph analysis as other 'dep' commands,
providing consistent and comprehensive dead code detection.

Layer Entry Points:
  When --layer-entry-points is specified, functions in those layers (as defined
  in .funcqc-arch.yaml) are treated as entry points. This is useful for analyzing
  dead code in modular architectures where certain layers serve as public APIs.`);

depCommand.command('cycles')
  .description('Detect and analyze circular dependencies with importance classification')
  .option('--min-size <num>', 'minimum cycle size to report (legacy)', '2')
  .option('--min-complexity <num>', 'minimum cycle complexity (nodes)', '4')
  .option('--format <format>', 'output format (table, json, dot)', 'table')
  .option('--sort <sort>', 'sort by (importance, length, complexity)', 'importance')
  .option('--limit <num>', 'maximum cycles to display', '20')
  .option('--include-all', 'include all cycles (legacy mode)')
  .option('--include-recursive', 'include recursive functions')
  .option('--include-clear', 'include clear function chains')
  .option('--exclude-recursive', 'exclude recursive functions (default: true)')
  .option('--exclude-clear', 'exclude clear function chains (default: true)')
  .option('--cross-module-only', 'show only cross-module cycles')
  .option('--cross-layer-only', 'show only cross-layer cycles')
  .option('--recursive-only', 'show only recursive functions')
  .option('--verbose', 'show detailed information')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { depCyclesCommand } = await import('./cli/dep');
    return withEnvironment(depCyclesCommand)(options);
  })
  .addHelpText('after', `
Examples:
  # Detect critical circular dependencies (default enhanced mode)
  $ funcqc dep cycles

  # Show cross-layer cycles only (most critical)
  $ funcqc dep cycles --cross-layer-only

  # Include recursive functions and clear chains
  $ funcqc dep cycles --include-recursive --include-clear

  # Legacy mode (all cycles, including recursive)
  $ funcqc dep cycles --include-all

  # JSON output for automation
  $ funcqc dep cycles --format json

  # Show only complex cycles
  $ funcqc dep cycles --min-complexity 6

  # Generate DOT graph for visualization
  $ funcqc dep cycles --format dot > cycles.dot

Default behavior (Enhanced Mode):
  • Excludes recursive functions (--exclude-recursive)
  • Excludes clear function chains (--exclude-clear)
  • Minimum complexity: 4 functions (--min-complexity 4)
  • Sorted by importance (--sort importance)
  • Limited to top 20 cycles (--limit 20)

Note: Enhanced mode focuses on architectural problems. Use --include-all
for backward compatibility with the legacy analyzer.
`);


// Safe deletion command using high-confidence call graph analysis
program
  .command('safe-delete')
  .description('🛡️  Safely analyze and delete dead code using high-confidence call graph analysis')
  .option('--confidence-threshold <value>', 'minimum confidence score for deletion (0-1)', '0.95')
  .option('--max-batch <num>', 'maximum functions to delete in one batch', '10')
  .option('--no-tests', 'skip test execution before deletion')
  .option('--no-type-check', 'skip TypeScript type checking')
  .option('--no-backup', 'skip backup creation')
  .option('--execute', 'execute actual deletion (default is analysis/preview only)')
  .option('--force', 'force deletion without interactive confirmation')
  .option('--dry-run', 'preview what would be deleted (same as default behavior)')
  .option('--include-exports', 'include exported functions in deletion candidates')
  .option('--exclude <patterns>', 'exclude file patterns (comma-separated)')
  .option('--format <format>', 'output format (table, json)', 'table')
  .option('--verbose', 'show detailed analysis information')
  .option('--restore <path>', 'restore functions from backup directory')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { safeDeleteCommand } = await import('./cli/safe-delete');
    return withEnvironment(safeDeleteCommand)(options, command);
  })
  .addHelpText('after', `
Examples:
  # Analyze candidates for safe deletion (default - preview only)
  $ funcqc safe-delete

  # Execute actual deletion with interactive confirmation
  $ funcqc safe-delete --execute

  # Force deletion without confirmation (dangerous!)
  $ funcqc safe-delete --execute --force

  # Analysis with high confidence threshold
  $ funcqc safe-delete --confidence-threshold 0.98

  # Execute deletion without backup (faster but less safe)
  $ funcqc safe-delete --execute --no-backup

  # Execute deletion in smaller batches for safety
  $ funcqc safe-delete --execute --max-batch 5

  # Include exported functions in analysis
  $ funcqc safe-delete --include-exports

  # Exclude specific patterns
  $ funcqc safe-delete --exclude "**/*.test.ts,**/fixtures/**"

  # Restore from backup
  $ funcqc safe-delete --restore ".funcqc/backups/safe-deletion-2024-01-15T10-30-00-000Z"

Note: By default, safe-delete only analyzes and previews candidates.
Use --execute to perform actual deletion with confirmation prompts.
Use --force to skip confirmation (not recommended).
`);

// Debug residue detection command
program
  .command('residue-check')
  .description('Detect debug code residue in TypeScript projects')
  .option('-j, --json', 'output as JSON')
  .option('--verbose', 'show detailed context information')
  .option('--details', 'show full analysis details')
  .option('--ai-mode', 'output AI-optimized format')
  .option('--config <path>', 'path to configuration file')
  .option('--path <path>', 'specific path to analyze')
  .option('--fix-mode <mode>', 'fix mode: none, preview, auto, interactive, script', 'none')
  .option('--quiet', 'suppress non-essential output')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { residueCheckCommand } = await import('./cli/commands/residue-check');
    return withEnvironment(residueCheckCommand)(options, command);
  })
  .addHelpText('after', `
Examples:
  # Basic residue detection
  $ funcqc residue-check
  
  # Verbose mode with context
  $ funcqc residue-check --verbose
  
  # AI-optimized JSON output
  $ funcqc residue-check --ai-mode --json
  
  # Analyze specific directory
  $ funcqc residue-check --path src/services
  
  # Use custom configuration
  $ funcqc residue-check --config .funcqc-residue.yaml
  
  # Fix modes
  $ funcqc residue-check --fix-mode preview    # Preview fixes
  $ funcqc residue-check --fix-mode auto       # Auto-fix AutoRemove items
  $ funcqc residue-check --fix-mode interactive # Interactive fixing
  $ funcqc residue-check --fix-mode script     # Generate fix script

Classification:
  - AutoRemove: Definitely debug code (debugger, console.debug, // DEBUG:)
  - NeedsReview: Ambiguous output (console.log, console.error)
  - Exempt: Valid user-facing output (notifyUser, printUsage)

Fix Modes:
  - none: Detection only (default)
  - preview: Show what would be fixed
  - auto: Automatically fix AutoRemove items
  - interactive: Interactive fixing with user confirmation
  - script: Generate executable fix script

Configuration (.funcqc-residue.yaml):
  exemptFunctions: [notifyUser, printUsage]
  autoRemovePatterns: [debugger, console.debug]
  customMarkers: [// DEBUG:, // TEMP:]
  exclude: ["**/*.test.ts"]

Exit codes:
  0: No AutoRemove items found
  1: AutoRemove items detected (action required)
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

function performLightweightSystemCheck(logger: Logger, skipCheck: boolean = false): boolean {
  if (skipCheck) return true;
  
  // Lightweight check for read-only commands
  // Only check basic Node.js version and file system access
  const systemChecker = new SystemChecker(logger);
  return systemChecker.basicSystemCheck();
}

const READ_ONLY_COMMANDS = ['list', 'health', 'show', 'history', 'diff', 'search', 'similar', 'help'] as const;

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
    // Use lightweight system check for read-only commands
    const isReadOnly = isReadOnlyCommand();
    const systemOk = isReadOnly && !options['checkSystem'] 
      ? performLightweightSystemCheck(logger, false)
      : performSystemCheck(logger, false);
      
    if (!systemOk) {
      logger.error('System requirements not met. Use --no-check to bypass.');
      process.exit(1);
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
    // Initialize graceful shutdown handler
    const gracefulShutdown = GracefulShutdown.getInstance();
    
    // Add general cleanup handler
    gracefulShutdown.addCleanupHandler('general', async () => {
      // General cleanup tasks can be added here if needed
    });
    
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
