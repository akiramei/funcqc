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
  .option('--sort <field>', 'sort by field (cc, loc, name, file)')
  .option('--desc', 'sort in descending order')
  .option('--cc-ge <num>', 'filter functions with complexity >= N')
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
  .action(async (namePattern: string | undefined, options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { showCommand } = await import('./cli/commands/show');
    return withEnvironment(showCommand(namePattern || ''))(options, command);
  })
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
  .description('Show project health and risk assessment')
  .option('--trend', 'show trend analysis')
  .option('--risks', 'show detailed risk assessment')
  .option('--show-config', 'show configuration details')
  .option('--verbose', 'show detailed information')
  .option('--json', 'output as JSON for jq/script processing')
  .option('--period <days>', 'period for trend analysis (default: 7)')
  .option('--snapshot <id>', 'analyze specific snapshot (ID, label, HEAD~N, git ref)')
  .option('--diff [snapshots]', 'compare snapshots: --diff (latest vs prev), --diff <id> (latest vs id), --diff "<id1> <id2>" (id1 vs id2)')
  .option('--scope <name>', 'analyze specific scope (src, test, all, or custom scope)')
  .option('--mode <mode>', 'evaluation mode: static or dynamic (default: static)')
  .option('--explain-weight <function>', 'explain weight calculation for specific function (ID or name)')
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

program
  .command('vectorize')
  .description('Generate and manage embeddings for function descriptions')
  .option('--all', 'vectorize all functions with descriptions')
  .option('--recent', 'vectorize only functions without embeddings (default)')
  .option('--status', 'show vectorization status')
  .option('--rebuild-index', 'rebuild ANN index for faster search')
  .option(
    '--index-algorithm <algorithm>',
    'ANN algorithm (hierarchical, lsh, hybrid)',
    'hierarchical'
  )
  .option('--index-config <config>', 'JSON config for ANN index (clusters, hash bits, etc.)')
  .option('--benchmark', 'benchmark ANN index performance')
  .option('--index-stats', 'show ANN index statistics')
  .option('--api-key <key>', 'OpenAI API key (or use OPENAI_API_KEY env var)')
  .option('--model <model>', 'embedding model to use', 'text-embedding-3-small')
  .option('--batch-size <size>', 'batch size for processing', '100')
  .option('--limit <n>', 'limit number of functions to process')
  .option('--output <format>', 'output format (console, json)', 'console')
  .option('--force', 'skip confirmation prompts')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { vectorizeCommand } = await import('./cli/commands/vectorize');
    return withEnvironment(vectorizeCommand)(options, command);
  });

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
  .description('Inspect database contents for debugging and testing')
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
Examples:
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

Safety Features:
  - Read-only access (SELECT statements only)
  - Input validation and sanitization
  - Row limits to prevent overwhelming output
  - Designed for debugging and testing purposes
`);


// Migrate command - Database migration management
program
  .command('migrate')
  .description('Database migration management')
  .action(() => {
    console.log(chalk.yellow('Please specify a migrate subcommand:'));
    console.log('  up       - Apply all pending migrations');
    console.log('  down     - Rollback one migration');
    console.log('  status   - Show migration status');
    console.log('  create   - Create new migration file');
    console.log('  cleanup  - Clean up old backup tables');
    console.log('  reset    - Reset migration history (development only)');
    console.log('  info     - Show migration system information');
    console.log('\nExample: funcqc migrate up');
  });

// Add migrate subcommands
const migrateCommand = program.commands.find(cmd => cmd.name() === 'migrate')!;

migrateCommand.command('up')
  .description('Apply all pending migrations')
  .action(async (options: OptionValues) => {
    const { upCommand } = await import('./cli/migrate');
    return upCommand(options);
  });

migrateCommand.command('down')
  .description('Rollback one migration')
  .action(async (options: OptionValues) => {
    const { downCommand } = await import('./cli/migrate');
    return downCommand(options);
  });

migrateCommand.command('status')
  .description('Show migration status and applied migrations')
  .action(async (options: OptionValues) => {
    const { statusCommand } = await import('./cli/migrate');
    return statusCommand(options);
  });

migrateCommand.command('cleanup')
  .description('Clean up old backup tables')
  .option('--days <num>', 'delete backups older than specified days (default: 30)')
  .action(async (options: OptionValues) => {
    const { cleanupCommand } = await import('./cli/migrate');
    return cleanupCommand(options);
  });

migrateCommand.command('reset')
  .description('Reset migration history (development only)')
  .option('--force', 'force reset without confirmation')
  .action(async (options: OptionValues) => {
    const { resetCommand } = await import('./cli/migrate');
    return resetCommand(options);
  });

migrateCommand.command('create')
  .description('Create new migration file')
  .option('--name <name>', 'migration name (required)')
  .action(async (options: OptionValues) => {
    const { createCommand } = await import('./cli/migrate');
    return createCommand(options);
  });

migrateCommand.command('doctor')
  .description('Run migration health check and diagnosis')
  .action(async (options: OptionValues) => {
    const { doctorCommand } = await import('./cli/migrate');
    return doctorCommand(options);
  });

migrateCommand.command('restore')
  .description('Restore missing migration files from database archive')
  .action(async (options: OptionValues) => {
    const { restoreCommand } = await import('./cli/migrate');
    return restoreCommand(options);
  });

migrateCommand.command('info')
  .description('Show migration system information')
  .action(async (options: OptionValues) => {
    const { infoCommand } = await import('./cli/migrate');
    return infoCommand(options);
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
  .option('--direction <dir>', 'dependency direction (in, out, both)', 'both')
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


// PageRank command - Function importance analysis using PageRank algorithm
program
  .command('pagerank')
  .description('🎯 Analyze function importance using PageRank algorithm')
  .option('--damping <factor>', 'damping factor for PageRank (0-1)', '0.85')
  .option('--max-iterations <num>', 'maximum iterations for convergence', '100')
  .option('--tolerance <value>', 'convergence tolerance', '1e-6')
  .option('--limit <num>', 'limit number of results to display', '20')
  .option('--importance <level>', 'filter by importance level (critical, high, medium, low)')
  .option('--sort <field>', 'sort by field (score, name, centrality)', 'score')
  .option('--desc', 'sort in descending order (default for score)')
  .option('--include-metrics', 'include centrality variance and Gini coefficient')
  .option('--json', 'output as JSON')
  .option('--snapshot <id>', 'use specific snapshot (default: latest)')
  .action(async (options: OptionValues, command) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { pageRankCommand } = await import('./cli/commands/pagerank');
    return withEnvironment(pageRankCommand)(options, command);
  })
  .addHelpText('after', `
Examples:
  # Show top 20 most important functions
  $ funcqc pagerank

  # Show only critical importance functions
  $ funcqc pagerank --importance critical

  # Customize PageRank parameters
  $ funcqc pagerank --damping 0.9 --max-iterations 200

  # Show more results with detailed metrics
  $ funcqc pagerank --limit 50 --include-metrics

  # Sort by function name instead of score
  $ funcqc pagerank --sort name

  # JSON output for analysis
  $ funcqc pagerank --json

  # Use specific snapshot
  $ funcqc pagerank --snapshot abc123

Understanding PageRank Scores:
  PageRank measures function importance based on call graph structure.
  Functions that are called by many other important functions get higher scores.
  This helps identify:
  - Core utility functions
  - Central architectural components  
  - Functions critical to the codebase

Importance Levels:
  - Critical (≥90%): Core functions essential to the system
  - High (70-89%): Important architectural components
  - Medium (30-69%): Supporting functions with moderate importance
  - Low (<30%): Peripheral or specialized functions

Centrality Metrics:
  - Gini Coefficient: Measures inequality in importance distribution
  - Centrality Variance: Measures variation in function centrality
  Both help assess architectural balance and identify potential issues.
`);


// Circular dependency detection command
program
  .command('cycles')
  .description('Detect circular dependencies in the call graph')
  .option('--min-size <num>', 'minimum cycle size to report', '2')
  .option('--format <format>', 'output format (table, json, dot)', 'table')
  .option('--verbose', 'show verbose output')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { cyclesCommand } = await import('./cli/cycles');
    return withEnvironment(cyclesCommand)(options);
  });

// Risk analysis command group
program
  .command('risk')
  .description('Enhanced risk detection and analysis')
  .action(() => {
    console.log(chalk.yellow('Please specify a risk subcommand:'));
    console.log('  analyze  - Analyze risk patterns in the codebase');
    console.log('  scc      - Analyze strongly connected components');
    console.log('  score    - Score individual functions');
    console.log('\nExample: funcqc risk analyze');
  });

// Add risk subcommands
const riskCommand = program.commands.find(cmd => cmd.name() === 'risk')!;

riskCommand.command('analyze')
  .description('Analyze risk patterns in the codebase')
  .option('--config <path>', 'path to risk configuration file')
  .option('--format <format>', 'output format (table, json, dot)', 'table')
  .option('--severity <level>', 'filter by severity (critical, high, medium, low)')
  .option('--pattern <type>', 'filter by pattern type (wrapper, fake-split, complexity-hotspot, isolated, circular)')
  .option('--limit <num>', 'maximum number of results to show')
  .option('--min-score <num>', 'minimum risk score to include (0-100)')
  .option('--include-recommendations', 'include recommendations in output')
  .option('--group-by <field>', 'group results by field (severity, file, pattern, score)', 'severity')
  .option('--snapshot <id>', 'analyze specific snapshot')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { riskAnalyzeCommand } = await import('./cli/risk');
    return withEnvironment(riskAnalyzeCommand)(options);
  });

riskCommand.command('scc')
  .description('Analyze strongly connected components (SCCs)')
  .option('--format <format>', 'output format (table, json)', 'table')
  .option('--min-size <num>', 'minimum component size to include', '2')
  .option('--include-recursive', 'include recursive functions (self-loops)')
  .option('--show-metrics', 'show complexity metrics for components')
  .option('--snapshot <id>', 'analyze specific snapshot')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { riskSCCCommand } = await import('./cli/risk');
    return withEnvironment(riskSCCCommand)(options);
  });

riskCommand.command('score')
  .description('Calculate risk score for individual functions')
  .option('--function-name <name>', 'function name to analyze')
  .option('--function-id <id>', 'function ID to analyze')
  .option('--config <path>', 'path to risk configuration file')
  .option('--format <format>', 'output format (table, json)', 'table')
  .option('--include-factors', 'include detailed risk factors in output')
  .option('--snapshot <id>', 'analyze specific snapshot')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { riskScoreCommand } = await import('./cli/risk');
    return withEnvironment(riskScoreCommand)(options);
  });

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

const READ_ONLY_COMMANDS = ['list', 'health', 'show', 'history', 'diff', 'search', 'similar', 'explain', 'risk', 'cycles', 'help'] as const;

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
