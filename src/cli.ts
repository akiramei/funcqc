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
  .action(async (_action: string, options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedConfigCommand } = await import('./cli/commands/unified-config');
    return createUnifiedCommandHandler(UnifiedConfigCommand)(options, command);
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
  .description('🔄 [DEPRECATED] Scan and analyze functions - Use `funcqc measure` instead')
  .option('--label <text>', 'label for this snapshot')
  .option('--comment <text>', 'mandatory comment when scan configuration changes')
  .option('--scope <name>', 'scan specific scope (src, test, all, or custom scope)')
  .option('--realtime-gate', 'enable real-time quality gate with adaptive thresholds')
  .option('-j, --json', 'output as JSON for script processing')
  // Performance-focused scan levels  
  .option('--with-basic', 'basic scan (15-20s): includes function analysis only')
  .option('--with-coupling', 'coupling scan (40-50s): includes basic + coupling analysis')
  .option('--with-graph', 'standard scan (30-40s): includes call graph')
  .option('--with-types', 'extended scan: includes type system analysis')
  .option('--full', 'full scan (50-60s): all analyses')
  .option('--async', 'run heavy analyses in background')
  .hook('preAction', () => {
    console.log(chalk.yellow('\n⚠️  DEPRECATED: The "scan" command is deprecated and will be removed in a future version.'));
    console.log(chalk.blue('💡 Use "funcqc measure" instead for enhanced measurement capabilities.'));
    console.log(chalk.gray('   Example: funcqc measure --level standard (same options work)\n'));
  })
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { ScanCommand } = await import('./cli/commands/scan-command');
    return createUnifiedCommandHandler(ScanCommand)(options, command);
  });

program
  .command('analyze')
  .description('🔄 Perform deferred analyses on existing snapshots')
  .option('--call-graph', 'analyze function dependencies')
  .option('--types', 'analyze TypeScript type system')
  .option('--coupling', 'analyze parameter coupling patterns')
  .option('--all', 'run all analyses')
  .option('-j, --json', 'output as JSON')
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedAnalyzeCommand } = await import('./cli/commands/unified-analyze');
    return createUnifiedCommandHandler(UnifiedAnalyzeCommand)(options, command);
  });

program
  .command('list')
  .description('📋 List all functions')
  .option('-j, --json', 'output as JSON for jq/script processing')
  .option('--limit <num>', 'limit number of results')
  .option('--sort <field>', 'sort by field (cc, loc, changes, name, file)')
  .option('--desc', 'sort in descending order')
  .option('--cc-ge <num>', 'filter functions with complexity >= N')
  .option('--changes-ge <num>', 'filter functions with change count >= N')
  .option('--file <pattern>', 'filter by file path pattern')
  .option('--name <pattern>', 'filter by function name pattern')
  .option('--scope <name>', 'filter by scope (src, test, all, or custom scope)')
  .option('--full-id', 'display full UUIDs instead of 8-character short IDs')
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { ListCommand } = await import('./cli/commands/list-command');
    return createUnifiedCommandHandler(ListCommand)(options, command);
  });





program
  .command('setup')
  .description('🛠️ Unified setup and configuration (consolidates init + config)')
  .option('--action <action>', 'setup action: init, config, check (default: interactive)')
  .option('--force', 'force initialization even if already exists')
  .option('--config-path <path>', 'path to configuration file')
  .option('--show', 'show current configuration')
  .option('--set <key=value>', 'set configuration value')
  .option('--get <key>', 'get configuration value by key')
  .option('--reset', 'reset configuration to defaults')
  .option('-j, --json', 'output as JSON for script processing')
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedSetupCommand } = await import('./cli/commands/unified-setup');
    return createUnifiedCommandHandler(UnifiedSetupCommand)(options, command);
  })
  .addHelpText('after', `
Examples:
  $ funcqc setup                           # Interactive setup (default)
  $ funcqc setup --action init            # Initialize funcqc in project
  $ funcqc setup --action config --show   # Show current configuration
  $ funcqc setup --action check           # Verify setup status
  $ funcqc setup --action config --set "roots=src,lib"  # Set configuration

Actions:
  interactive  Interactive guided setup (default)
  init        Initialize funcqc configuration
  config      Manage configuration settings
  check       Check setup and configuration status
`);




program
  .command('show')
  .description('📄 Show detailed information about a specific function')
  .option('--id <function-id>', 'function ID to show details for')
  .option('-j, --json', 'output as JSON for jq/script processing')
  .option('--usage', 'show usage information, examples, error handling, side effects')
  .option('--current', 'show current quality metrics and analysis (default)')
  .option('--history', 'show historical metrics and changes for this function')
  .option('--source', 'show source code (combinable with other options)')
  .argument('[name-pattern]', 'function name pattern (if ID not provided)')
  .action(async (_namePattern: string | undefined, options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { ShowCommand } = await import('./cli/commands/show-command');
    return createUnifiedCommandHandler(ShowCommand)(options, command);
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
  .description('📁 List and display source files stored in snapshots')
  .option('--snapshot <id>', 'snapshot ID to display files from (default: latest)')
  .option('--language <lang>', 'filter by programming language')
  .option('--path <pattern>', 'filter by file path pattern')
  .option('--sort <field>', 'sort by field (path, size, lines, functions, language, modified)', 'path')
  .option('--desc', 'sort in descending order')
  .option('--limit <num>', 'limit number of results')
  .option('--stats', 'show file statistics')
  .option('--json', 'output as JSON')
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { FilesCommand } = await import('./cli/commands/files-command');
    return createUnifiedCommandHandler(FilesCommand)(options, command);
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
  .description('🏥 Show project health assessment')
  .option('--trend', 'show trend analysis')
  .option('--risks', 'show detailed risk assessment')
  .option('--show-config', 'show configuration details')
  .option('--verbose', 'show detailed information')
  .option('--json', 'output as JSON for jq/script processing')
  .option('--period <days>', 'period for trend analysis (default: 7)')
  .option('--snapshot <id>', 'analyze specific snapshot (ID, label, HEAD~N, git ref)')
  .option('--diff [snapshots]', 'compare snapshots: --diff (latest vs prev), --diff <id> (latest vs id), --diff "<id1> <id2>" (id1 vs id2)')
  .option('--ai-optimized', 'deprecated: use --json instead')
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { HealthCommand } = await import('./cli/commands/health-command');
    return createUnifiedCommandHandler(HealthCommand)(options, command);
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
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedHistoryCommand } = await import('./cli/commands/unified-history');
    return createUnifiedCommandHandler(UnifiedHistoryCommand)(options, command);
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
  .action(async (_from: string, _to: string, options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { DiffCommand } = await import('./cli/commands/diff-command');
    return createUnifiedCommandHandler(DiffCommand)(options, command);
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
  .description('🔍 [DEPRECATED] Detect similar functions using AST analysis - Use `funcqc improve --type duplicates` instead')
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
  .hook('preAction', () => {
    console.log(chalk.yellow('\n⚠️  DEPRECATED: The "similar" command is deprecated and will be removed in a future version.'));
    console.log(chalk.blue('💡 Use "funcqc improve --type duplicates" instead for enhanced duplicate detection.'));
    console.log(chalk.gray('   Example: funcqc improve --type duplicates --threshold 0.95\n'));
  })
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { SimilarCommand } = await import('./cli/commands/similar-command');
    return createUnifiedCommandHandler(SimilarCommand)(options, command);
  });

program
  .command('describe')
  .description('📝 [DEPRECATED] Add or manage function descriptions - Use `funcqc inspect --detailed` instead')
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
  .hook('preAction', () => {
    console.log(chalk.yellow('\n⚠️  DEPRECATED: The "describe" command is deprecated and will be removed in a future version.'));
    console.log(chalk.blue('💡 Use "funcqc inspect --detailed" instead for enhanced function inspection.'));
    console.log(chalk.gray('   Example: funcqc inspect --name myFunction --detailed\n'));
  })
  .action(async (_functionId: string | undefined, options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedDescribeCommand } = await import('./cli/commands/unified-describe');
    return createUnifiedCommandHandler(UnifiedDescribeCommand)(options, command);
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
  .description('🔍 [DEPRECATED] Search functions by description keywords - Use `funcqc inspect --name` instead')
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
  .hook('preAction', () => {
    console.log(chalk.yellow('\n⚠️  DEPRECATED: The "search" command is deprecated and will be removed in a future version.'));
    console.log(chalk.blue('💡 Use "funcqc inspect --name" instead for enhanced function search.'));
    console.log(chalk.gray('   Example: funcqc inspect --name "*auth*" (pattern matching)\n'));
  })
  .action(async (_keyword: string, options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedSearchCommand } = await import('./cli/commands/unified-search');
    return createUnifiedCommandHandler(UnifiedSearchCommand)(options, command);
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
  .action(async (_subcommand: string, options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedDetectCommand } = await import('./cli/commands/unified-detect');
    return createUnifiedCommandHandler(UnifiedDetectCommand)(options, command);
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
    .description('📊 [DEPRECATED] Evaluate function naming quality - Use `funcqc assess --type quality` instead')
    .hook('preAction', () => {
      console.log(chalk.yellow('\n⚠️  DEPRECATED: The "evaluate" command is deprecated and will be removed in a future version.'));
      console.log(chalk.blue('💡 Use "funcqc assess --type quality" instead for enhanced quality evaluation.'));
      console.log(chalk.gray('   Example: funcqc assess --type quality (same functionality)\n'));
    })
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
  .action(async (_input: string | undefined, options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedEvaluateCommand } = await import('./cli/commands/unified-evaluate');
    return createUnifiedCommandHandler(UnifiedEvaluateCommand)(options, command);
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
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedDbCommand } = await import('./cli/commands/unified-db');
    return createUnifiedCommandHandler(UnifiedDbCommand)(options, command);
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
  # Create a backup with label (JSON format - default)
  $ funcqc db export --label "before-refactor"
  
  # Create a backup in Avro format (more compact)
  $ funcqc db export --label "production-backup" --format avro --compress
  
  # List all available backups
  $ funcqc db list-backups
  
  # Restore from backup (auto-detects format)
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
  .option('--format <format>', 'backup format (json, sql, avro)', 'json')
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
  .description('Convert backup between formats and handle schema migrations (Note: SQL format conversion is currently not implemented)')
  .option('--input <path>', 'input backup directory')
  .option('--output <path>', 'output backup directory')
  .option('--format <format>', 'target format (json, avro)', 'json')
  .option('--allow-schema-mismatch', 'proceed even if schema versions differ')
  .option('--update-schema', 'update backup to current schema version')
  .option('--force', 'force conversion even if formats are the same')
  .action(async (options: OptionValues) => {
    const { withEnvironment } = await import('./cli/cli-wrapper');
    const { dbConvertCommand } = await import('./cli/commands/db/convert');
    return withEnvironment(dbConvertCommand)(options);
  });

// Dep command - Function dependency analysis (DEPRECATED)
program
  .command('dep')
  .description('Function dependency analysis')
  .action(() => {
    console.log(chalk.yellow('⚠️  DEPRECATION WARNING: The `dep` command will be removed in v2.0'));
    console.log(chalk.cyan('🔄 Please use the new `dependencies` command instead:'));
    console.log('');
    console.log('  funcqc dependencies --action list     # was: funcqc dep list');
    console.log('  funcqc dependencies --action show     # was: funcqc dep show');
    console.log('  funcqc dependencies --action stats    # was: funcqc dep stats');
    console.log('  funcqc dependencies --action lint     # was: funcqc dep lint');
    console.log('  funcqc dependencies --action dead     # was: funcqc dep dead');
    console.log('  funcqc dependencies --action cycles   # was: funcqc dep cycles');
    console.log('');
    console.log(chalk.yellow('Legacy dep subcommands (will be removed):'));
    console.log('  list     - List function dependencies');
    console.log('  show     - Show detailed dependency information');
    console.log('  stats    - Show dependency statistics and metrics');
    console.log('  lint     - Lint architecture dependencies against rules');
    console.log('  dead     - Detect dead code (unreachable functions)');
    console.log('  cycles   - Detect circular dependencies in the call graph');
    console.log('');
    console.log('Example (legacy): funcqc dep list');
    console.log(chalk.green('Example (new):    funcqc dependencies --action list'));
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
  .description('🛡️  [DEPRECATED] Safely analyze and delete dead code - Use `funcqc improve --type dead-code` instead')
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
  .hook('preAction', () => {
    console.log(chalk.yellow('\n⚠️  DEPRECATED: The "safe-delete" command is deprecated and will be removed in a future version.'));
    console.log(chalk.blue('💡 Use "funcqc improve --type dead-code" instead for enhanced dead code detection.'));
    console.log(chalk.gray('   Example: funcqc improve --type dead-code (same functionality)\n'));
  })
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { SafeDeleteCommand } = await import('./cli/commands/safe-delete-command');
    return createUnifiedCommandHandler(SafeDeleteCommand)(options, command);
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
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedResidueCheckCommand } = await import('./cli/commands/unified-residue-check');
    return createUnifiedCommandHandler(UnifiedResidueCheckCommand)(options, command);
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

// Unified types command (consolidates 14 type analysis subcommands)
program
  .command('types')
  .description('🧩 Unified TypeScript type analysis and design intelligence')
  .option('--action <action>', 'type analysis action: list, health, deps, api, members, coverage, cluster, risk, insights, slices, subsume, fingerprint, converters, cochange')
  .option('--snapshot <id>', 'snapshot ID for analysis')
  .option('-j, --json', 'output as JSON for script processing')
  .option('--verbose', 'detailed output')
  
  // Type name parameter (for actions that need it)
  .option('--type-name <name>', 'target type name for analysis')
  
  // List action options
  .option('--kind <kind>', 'filter by type kind (interface|class|type_alias|enum|namespace)')
  .option('--exported', 'show only exported types')
  .option('--generic', 'show only generic types')
  .option('--file <path>', 'filter by file path')
  .option('--name <pattern>', 'filter by type name (contains)')
  
  // Property filters
  .option('--prop-eq <n>', 'filter types with exactly N properties', parseInt)
  .option('--prop-ge <n>', 'filter types with >= N properties', parseInt)
  .option('--prop-le <n>', 'filter types with <= N properties', parseInt)
  .option('--prop-gt <n>', 'filter types with > N properties', parseInt)
  .option('--prop-lt <n>', 'filter types with < N properties', parseInt)
  
  // Method filters
  .option('--meth-eq <n>', 'filter types with exactly N methods', parseInt)
  .option('--meth-ge <n>', 'filter types with >= N methods', parseInt)
  .option('--meth-le <n>', 'filter types with <= N methods', parseInt)
  .option('--meth-gt <n>', 'filter types with > N methods', parseInt)
  .option('--meth-lt <n>', 'filter types with < N methods', parseInt)
  
  // Legacy function filters (methods + constructors for backward compatibility)
  .option('--fn-eq <n>', 'filter types with exactly N functions (methods+constructors)', parseInt)
  .option('--fn-ge <n>', 'filter types with >= N functions (methods+constructors)', parseInt)
  .option('--fn-le <n>', 'filter types with <= N functions (methods+constructors)', parseInt)
  .option('--fn-gt <n>', 'filter types with > N functions (methods+constructors)', parseInt)
  .option('--fn-lt <n>', 'filter types with < N functions (methods+constructors)', parseInt)
  
  // Total member filters
  .option('--total-eq <n>', 'filter types with exactly N total members', parseInt)
  .option('--total-ge <n>', 'filter types with >= N total members', parseInt)
  .option('--total-le <n>', 'filter types with <= N total members', parseInt)
  .option('--total-gt <n>', 'filter types with > N total members', parseInt)
  .option('--total-lt <n>', 'filter types with < N total members', parseInt)
  
  // Special filters
  .option('--has-index', 'show only types with index signatures')
  .option('--has-call', 'show only types with call signatures')
  
  // Output options
  .option('--limit <number>', 'limit number of results', parseInt)
  .option('--sort <field>', 'sort by field (name|kind|file|functions|props|methods|ctors|total)')
  .option('--desc', 'sort in descending order')
  .option('--detail', 'show detailed information in multi-line format')
  .option('--show-location', 'show FILE and LINE columns')
  .option('--show-id', 'show ID column for unique identification')
  
  // Health action options
  .option('--thresholds <value>', 'custom thresholds for health analysis')
  .option('--legend', 'show legend for health metrics')
  
  // Deps action options
  .option('--depth <number>', 'maximum dependency depth to analyze', parseInt)
  .option('--circular', 'show only circular dependencies')
  
  // API action options
  .option('--optimize', 'include optimization recommendations')
  
  // Members action options
  .option('--member-kind <kind>', 'filter by member kind (property|method|getter|setter|constructor|index_signature|call_signature)')
  .option('--access-modifier <modifier>', 'filter by access modifier (public|protected|private)')
  
  // Coverage action options
  .option('--hot-threshold <number>', 'minimum calls for hot properties', parseInt)
  .option('--write-hub-threshold <number>', 'minimum writers for write hubs', parseInt)
  .option('--include-private', 'include private properties in analysis')
  
  // Cluster action options
  .option('--similarity-threshold <number>', 'minimum similarity for clustering', parseFloat)
  .option('--min-cluster-size <number>', 'minimum properties per cluster', parseInt)
  
  // Insights action options
  .option('--no-coverage', 'skip coverage analysis')
  .option('--no-api', 'skip API optimization analysis')
  .option('--no-cluster', 'skip property clustering analysis')
  .option('--no-risk', 'skip dependency risk analysis')
  
  // Slices action options
  .option('--min-support <number>', 'minimum types containing slice', parseInt)
  .option('--min-slice-size <number>', 'minimum properties per slice', parseInt)
  .option('--max-slice-size <number>', 'maximum properties per slice', parseInt)
  .option('--consider-methods', 'include methods in pattern analysis')
  .option('--no-exclude-common', 'include common properties (id, name, etc.)')
  .option('--benefit <level>', 'filter by extraction benefit (high|medium|low)')
  
  // Subsume action options
  .option('--min-overlap <number>', 'minimum overlap ratio (0-1)', parseFloat)
  .option('--no-include-partial', 'exclude partial overlap relationships')
  .option('--show-redundant', 'show only redundant (equivalent) types')
  
  // Fingerprint action options
  .option('--no-include-calls-out', 'exclude outgoing function calls')
  .option('--no-include-calls-in', 'exclude incoming function calls')
  .option('--min-call-frequency <number>', 'minimum call frequency', parseInt)
  .option('--max-fingerprint-size <number>', 'maximum behavioral vector size', parseInt)
  .option('--include-internal-calls', 'include internal method calls')
  
  // Converters action options
  .option('--min-converters <number>', 'minimum converters to form a network', parseInt)
  .option('--no-include-internal-calls', 'exclude internal function calls')
  .option('--no-include-parsers', 'exclude parse functions as converters')
  .option('--show-chains', 'show conversion chains')
  .option('--canonical-only', 'show only canonical types')
  .option('--max-chain-length <number>', 'maximum conversion chain length', parseInt)
  
  // Cochange action options
  .option('--months-back <number>', 'how far back to analyze in months', parseInt)
  .option('--min-changes <number>', 'minimum changes to consider a type', parseInt)
  .option('--cochange-threshold <number>', 'threshold for co-change significance (0-1)', parseFloat)
  .option('--show-matrix', 'show co-change matrix')
  .option('--no-suggest-modules', 'disable module reorganization suggestions')
  .option('--max-commits <number>', 'maximum commits to analyze', parseInt)
  .option('--exclude-paths <paths>', 'comma-separated paths to exclude from analysis')
  
  .action(async (options: OptionValues, command) => {
    const { createUnifiedCommandHandler } = await import('./core/unified-command-executor');
    const { UnifiedTypesCommand } = await import('./cli/commands/unified-types');
    return createUnifiedCommandHandler(UnifiedTypesCommand)(options, command);
  })
  .addHelpText('after', `
Examples:
  # List complex interfaces with many properties
  $ funcqc types --action list --kind interface --prop-ge 5 --detail
  
  # Comprehensive type system health analysis
  $ funcqc types --action health --verbose --json
  
  # Analyze specific type dependencies
  $ funcqc types --action deps --type-name "UserProfile" --depth 3
  
  # Evaluate type API design and optimization
  $ funcqc types --action api --type-name "ApiResponse" --optimize
  
  # Show detailed member information
  $ funcqc types --action members --type-name "BaseEntity" --detail
  
  # Property usage coverage analysis  
  $ funcqc types --action coverage --type-name "OrderDTO" --hot-threshold 10
  
  # Property clustering patterns
  $ funcqc types --action cluster --type-name "Product" --similarity-threshold 0.8
  
  # Find reusable property patterns
  $ funcqc types --action slices --min-support 3 --benefit high
  
  # Identify redundant types
  $ funcqc types --action subsume --min-overlap 0.7 --show-redundant
  
  # Type co-evolution analysis
  $ funcqc types --action cochange --months-back 12 --show-matrix

Advanced Analysis:
  • --action insights      # Comprehensive analysis combining all insights
  • --action fingerprint   # Behavioral fingerprint analysis
  • --action converters    # Type conversion network analysis
  • --action risk          # Dependency risk assessment
`);

// Add deprecated types subcommand with migration guidance
import { createTypesCommand } from './cli/commands/types';
const legacyTypesCommand = createTypesCommand();
legacyTypesCommand
  .description('🧩 [DEPRECATED] TypeScript type analysis - Use `funcqc types` instead')
  .hook('preAction', () => {
    console.log(chalk.yellow('⚠️  DEPRECATION WARNING: The `types <subcommand>` syntax will be removed in v2.0'));
    console.log(chalk.cyan('🔄 Please use the new unified `types` command instead:'));
    console.log('');
    console.log('  funcqc types --action list --prop-ge 5                # was: funcqc types list --prop-ge 5');
    console.log('  funcqc types --action health --verbose               # was: funcqc types health --verbose');
    console.log('  funcqc types --action deps --type-name "MyType"      # was: funcqc types deps MyType');
    console.log('  funcqc types --action api --type-name "MyType"       # was: funcqc types api MyType');
    console.log('  funcqc types --action members --type-name "MyType"   # was: funcqc types members MyType');
    console.log('  funcqc types --action slices --min-support 3         # was: funcqc types slices --min-support 3');
    console.log('');
    console.log('See: funcqc types --help');
    console.log('');
  });
program.addCommand(legacyTypesCommand);

program
  .command('refactor-guard')
  .description('🛡️  Analyze refactoring safety and generate guardrails')
  .action(() => {
    console.log(chalk.yellow('⚠️  DEPRECATION WARNING: The `refactor-guard` command will be removed in v2.0'));
    console.log(chalk.cyan('🔄 Please use the new `refactor` command instead:'));
    console.log('');
    console.log('  funcqc refactor --action guard --type "TypeName"      # was: funcqc refactor-guard --type TypeName');
    console.log('  funcqc refactor --action guard --operation split      # was: funcqc refactor-guard --operation split');
    console.log('  funcqc refactor --action guard --include-cochange     # was: funcqc refactor-guard --include-cochange');
    console.log('');
    console.log('See: funcqc refactor --help');
    process.exit(0);
  });

program
  .command('type-replace')
  .description('🔄 Analyze and execute safe type replacements with compatibility checking')
  .action(() => {
    console.log(chalk.yellow('⚠️  DEPRECATION WARNING: The `type-replace` command will be removed in v2.0'));
    console.log(chalk.cyan('🔄 Please use the new `refactor` command instead:'));
    console.log('');
    console.log('  funcqc refactor --action type-replace --from "OldType" --to "NewType"  # was: funcqc type-replace --from OldType --to NewType');
    console.log('  funcqc refactor --action type-replace --check-only                     # was: funcqc type-replace --check-only');
    console.log('  funcqc refactor --action type-replace --migration-plan                 # was: funcqc type-replace --migration-plan');
    console.log('');
    console.log('See: funcqc refactor --help');
    process.exit(0);
  })
  .addHelpText('after', `
Examples:
  # Basic safety analysis for type replacement
  $ funcqc refactor-guard --type UserType
  
  # Analyze merge operation with high risk tolerance
  $ funcqc refactor-guard --type UserType --operation merge --risk-threshold high
  
  # Generate comprehensive analysis with all features
  $ funcqc refactor-guard --type PaymentRequest --include-cochange --format markdown
  
  # Export analysis to file for documentation
  $ funcqc refactor-guard --type ApiResponse --output safety-analysis.md --format markdown
  
  # Quick check without behavioral analysis
  $ funcqc refactor-guard --type ConfigType --no-include-behavioral --format json

Features:
  🔍 Impact Analysis        - Identifies affected functions and types
  ⚠️  Risk Assessment      - Calculates overall refactoring risk
  ✅ Safety Checklist      - Generates actionable safety items  
  🧪 Test Templates        - Auto-generates test code templates
  📈 Co-change Analysis    - Uses Git history for temporal coupling
  📝 PR Template          - Creates comprehensive PR documentation
  🎯 Smart Recommendations - Provides context-aware guidance

Risk Levels:
  🟢 low      - Safe refactoring with minimal impact
  🟡 medium   - Moderate risk, requires careful testing
  🟠 high     - High risk, extensive validation needed
  🔴 critical - Major breaking change, consider alternatives
`);

program
  .command('canonicalize')
  .description('🎯 Analyze and consolidate duplicate DTO types into canonical forms')
  .action(() => {
    console.log(chalk.yellow('⚠️  DEPRECATION WARNING: The `canonicalize` command will be removed in v2.0'));
    console.log(chalk.cyan('🔄 Please use the new `refactor` command instead:'));
    console.log('');
    console.log('  funcqc refactor --action canonicalize                     # was: funcqc canonicalize');
    console.log('  funcqc refactor --action canonicalize --generate-codemod  # was: funcqc canonicalize --generate-codemod');
    console.log('  funcqc refactor --action canonicalize --show-opportunities # was: funcqc canonicalize --show-opportunities');
    console.log('');
    console.log('See: funcqc refactor --help');
    process.exit(0);
  })
  .addHelpText('after', `
Examples:
  # Basic DTO canonicalization analysis
  $ funcqc canonicalize
  
  # Show consolidation opportunities and generated artifacts
  $ funcqc canonicalize --show-opportunities --show-artifacts
  
  # Generate codemod actions with custom thresholds
  $ funcqc canonicalize --generate-codemod --min-confidence 0.8
  
  # Export detailed analysis to markdown
  $ funcqc canonicalize --format markdown --output dto-canonicalization.md
  
  # Low-impact changes only
  $ funcqc canonicalize --require-minimal-impact --max-candidates 5
  
  # Dry run to preview changes
  $ funcqc canonicalize --dry-run --show-opportunities

Features:
  🔍 Pattern Recognition    - Identifies similar DTO structures
  📊 Relationship Analysis  - Maps structural relationships between types
  🎯 Canonical Selection   - Recommends optimal canonical types
  🔧 View Type Generation   - Creates Pick/Omit-based view types
  🗺️  Migration Planning    - Generates step-by-step migration strategies
  📦 Artifact Generation   - Creates mappers and conversion utilities
  📈 Quality Metrics       - Measures duplicate reduction and maintainability

Benefits:
  • Reduce type duplication by 30-50%
  • Improve maintainability through centralized types
  • Generate automatic migration tools
  • Preserve type safety during consolidation
`);

program
  .command('extract-vo')
  .description('🧩 Extract Value Objects from property clusters to improve encapsulation')
  .action(() => {
    console.log(chalk.yellow('⚠️  DEPRECATION WARNING: The `extract-vo` command will be removed in v2.0'));
    console.log(chalk.cyan('🔄 Please use the new `refactor` command instead:'));
    console.log('');
    console.log('  funcqc refactor --action extract-vo                          # was: funcqc extract-vo');
    console.log('  funcqc refactor --action extract-vo --show-opportunities     # was: funcqc extract-vo --show-opportunities');
    console.log('  funcqc refactor --action extract-vo --output-code ./vo       # was: funcqc extract-vo --output-code ./vo');
    console.log('');
    console.log('See: funcqc refactor --help');
    process.exit(0);
  })
  .addHelpText('after', `
Examples:
  # Basic Value Object extraction analysis
  $ funcqc extract-vo
  
  # Filter by domain and show generated code
  $ funcqc extract-vo --domain-filter Finance --show-generated
  
  # Generate VO code files with custom thresholds
  $ funcqc extract-vo --output-code ./value-objects --min-cohesion 0.8
  
  # Low complexity extractions only
  $ funcqc extract-vo --complexity-filter low --max-candidates 5
  
  # Export comprehensive analysis
  $ funcqc extract-vo --format markdown --output vo-extraction.md --show-opportunities
  
  # Generate VOs without smart constructors
  $ funcqc extract-vo --no-generate-constructors --no-infer-invariants

Features:
  🔍 Pattern Detection      - Identifies cohesive property clusters
  🏗️  Domain Analysis       - Groups VOs by business domain
  💎 Smart Generation      - Creates VOs with methods and invariants
  🧪 Constructor Creation   - Generates validation and factory functions
  📊 Impact Assessment     - Measures benefits and risks of extraction
  🎯 Migration Planning    - Creates step-by-step extraction plan
  📦 Code Generation       - Outputs ready-to-use VO implementations

Value Object Types:
  💰 Money          - amount, currency
  🌍 Coordinate     - lat, lng
  ⏰ TimeRange      - start, end
  📐 Dimensions     - width, height
  📧 ContactInfo    - email, phone
  🏷️  General        - custom property combinations

Benefits:
  • Improve type safety through encapsulation
  • Enforce business rules and invariants
  • Increase code reusability and testability
  • Provide domain-specific operations and validation
`);

program
  .command('discriminate')
  .description('🏷️  Analyze and transform types into discriminated unions')
  .action(() => {
    console.log(chalk.yellow('⚠️  DEPRECATION WARNING: The `discriminate` command will be removed in v2.0'));
    console.log(chalk.cyan('🔄 Please use the new `refactor` command instead:'));
    console.log('');
    console.log('  funcqc refactor --action discriminate                         # was: funcqc discriminate');
    console.log('  funcqc refactor --action discriminate --transform             # was: funcqc discriminate --transform');
    console.log('  funcqc refactor --action discriminate --target-types "User,Order"  # was: funcqc discriminate --target-types User,Order');
    console.log('');
    console.log('See: funcqc refactor --help');
    process.exit(0);
  })
  .addHelpText('after', `

Examples:
  funcqc discriminate --target-types UserState,OrderStatus
  funcqc discriminate --dry-run --transform --verbose
  funcqc discriminate --min-confidence 0.8 --output detailed
  funcqc discriminate --transform --allow-breaking

Pattern Detection:
  🏷️  Boolean flags      - status: boolean
  🔢 Enum discriminants  - type: 'A' | 'B' | 'C'  
  ⚡ Mutual exclusion   - (propA && !propB) patterns
  🔄 Correlated props   - properties that change together

Benefits:
  • Eliminate runtime type checking and branching logic
  • Provide exhaustive case analysis with TypeScript
  • Improve type safety and prevent invalid state combinations
  • Enable better IDE support and refactoring safety
`);

// DU (Discriminated Union) incremental command group
const duCommand = program.command('du');
duCommand
  .description('🏷️  Discriminated Union incremental transformation toolkit')
  .addHelpText('before', `
The 'du' command group provides step-by-step discriminated union transformation:
  • detect: Find DU opportunities (Step A: Detection)
  • plan: Generate transformation plans (Step B: Planning) 
  • gen: Generate types and helpers (Step C: Generation)
  • migrate: Create migration utilities (Step D: Migration)
  • rewrite: Transform call sites (Step E: Transformation)
`);

// Add detect subcommand
duCommand.command('detect')
  .description('🔍 Detect discriminated union opportunities (Step A: Detection)')
  .option('--snapshot-id <id>', 'use specific snapshot for analysis')
  .option('--target-types <types>', 'comma-separated list of specific types to analyze')
  .option('--min-coverage <number>', 'minimum coverage threshold (0-1)', '0.8')
  .option('--min-mutual-exclusivity <number>', 'minimum mutual exclusivity score (0-1)', '0.1')
  .option('--min-usage-frequency <number>', 'minimum discriminant usage frequency (0-1)', '0.005')
  .option('--max-variants <number>', 'maximum union variants per type', '8')
  .option('--min-variants <number>', 'minimum union variants per type', '2')
  .option('--exclude-props <props>', 'comma-separated properties to exclude', 'id,createdAt,updatedAt')
  .option('--output <format>', 'output format: table|json|detailed', 'table')
  .option('--format <format>', 'alias for --output', 'table')
  .option('--save-json [path]', 'save detailed results as JSON file', false)
  .option('--save-html [path]', 'save analysis report as HTML file', false)
  .option('--verbose', 'enable verbose logging', false)
  .action(async (options: OptionValues) => {
    const { executeDetect } = await import('./cli/commands/du/detect');
    await executeDetect(options);
  })
  .addHelpText('after', `
Examples:
  funcqc du detect                                    # Detect all DU opportunities
  funcqc du detect --target-types Payment,OrderStatus # Analyze specific types  
  funcqc du detect --min-coverage 0.9 --verbose       # High coverage threshold
  funcqc du detect --save-html report.html --save-json data.json # Save reports
  funcqc du detect --exclude-props id,timestamp       # Exclude common properties
  funcqc du detect --output detailed                  # Show detailed analysis

Detection Process:
  📊 Step A1: Flag correlation analysis (φ coefficient, Jaccard index)
  🎯 Step A2: Risk classification (coverage, exclusivity, complexity)
  📈 Step A3: Impact estimation (file references, call sites)

Output:
  • DU Plan JSON with coverage metrics and variant definitions
  • Risk assessment (low/medium/high) for each candidate
  • Implementation priority and effort estimation
  • HTML report for visualization and sharing
`);

// Overview command functionality has been integrated into the types command

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
