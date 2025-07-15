#!/usr/bin/env node

import { Command, OptionValues } from 'commander';
import chalk from 'chalk';
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
  .action(async (options: OptionValues) => {
    const { initCommand } = await import('./cli/init');
    return initCommand(options);
  });

program
  .command('config')
  .description('Manage configuration presets and settings')
  .argument('<action>', 'action to perform (list, show, apply, compare, suggest, backup, validate)')
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
`);

program
  .command('scan')
  .description('Scan and analyze functions')
  .option('--label <text>', 'label for this snapshot')
  .option('--comment <text>', 'mandatory comment when scan configuration changes')
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
  .option('--id <function-id>', 'track history of specific function by ID')
  .option('--all', 'show all snapshots including where function is absent (with --id)')
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
  .option('--lineage', 'detect lineage for removed functions')
  .option('--lineage-threshold <value>', 'similarity threshold for lineage detection (0-1)', '0.7')
  .option('--lineage-detectors <list>', 'comma-separated list of similarity detectors')
  .option('--lineage-auto-save', 'automatically save detected lineage as draft')
  .option('--no-change-detection', 'disable smart change detection for modified functions')
  .option('--change-detection-min-score <num>', 'minimum score for lineage suggestion (0-100)', '50')
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
  
  # Detect lineage for removed functions
  $ funcqc diff HEAD~1 HEAD --lineage
  
  # Lineage with custom threshold and auto-save
  $ funcqc diff main feature --lineage --lineage-threshold 0.8 --lineage-auto-save
  
  # Use specific detectors for lineage
  $ funcqc diff v1 v2 --lineage --lineage-detectors "advanced-structural,hash-duplicate"
  
  # Smart change detection (enabled by default)
  $ funcqc diff HEAD~1 HEAD --lineage
  
  # Adjust change detection sensitivity
  $ funcqc diff main feature --lineage --change-detection-min-score 70
  
  # Disable smart change detection
  $ funcqc diff v1 v2 --lineage --no-change-detection
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
  
  # JSON output for integration
  $ funcqc eval code.ts --json
  
  # Strict mode (exit 1 on any critical violation)
  $ funcqc eval code.ts --strict
  
AI Integration:
  - Use --ai-generated for proper exit codes (0=acceptable, 1=needs improvement)
  - Use --json for structured output with improvement suggestions
  - Sub-20ms response time for real-time feedback
  - Adaptive thresholds based on project baseline
`);

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
      .action(async (options: OptionValues, command) => {
        const { withEnvironment } = await import('./cli/cli-wrapper');
        const { lineageCommand } = await import('./cli/commands/lineage');
        return withEnvironment(lineageCommand('list'))(options, command);
      })
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
      .action(async (lineageId: string, options: OptionValues, command) => {
        const { withEnvironment } = await import('./cli/cli-wrapper');
        const { lineageCommand } = await import('./cli/commands/lineage');
        return withEnvironment(lineageCommand('show', [lineageId]))(options, command);
      })
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
      .action(async (lineageId: string | undefined, options: OptionValues, command) => {
        const { withEnvironment } = await import('./cli/cli-wrapper');
        const { lineageCommand } = await import('./cli/commands/lineage');
        return withEnvironment(lineageCommand('review', lineageId ? [lineageId] : []))(options, command);
      })
      .addHelpText('after', `
Examples:
  $ funcqc lineage review abc12345 --approve     # Approve specific lineage
  $ funcqc lineage review abc12345 --reject --note "Incorrect mapping"
  $ funcqc lineage review --all --approve        # Approve all draft lineages
`)
  )
  .addCommand(
    new Command('delete')
      .description('Delete a specific lineage')
      .argument('<lineage-id>', 'lineage ID to delete')
      .action(async (lineageId: string, options: OptionValues, command) => {
        const { withEnvironment } = await import('./cli/cli-wrapper');
        const { lineageCommand } = await import('./cli/commands/lineage');
        return withEnvironment(lineageCommand('delete', [lineageId]))(options, command);
      })
      .addHelpText('after', `
Examples:
  $ funcqc lineage delete abc12345               # Delete specific lineage
  $ funcqc lineage delete abc12345 -v            # Delete with verbose output
`)
  )
  .addCommand(
    new Command('clean')
      .description('Delete lineages matching criteria')
      .option('--status <status>', 'filter by status (default: draft)')
      .option('--older-than <days>', 'delete lineages older than N days')
      .option('--dry-run', 'preview what would be deleted without making changes')
      .option('-y, --yes', 'skip confirmation prompt')
      .option('--include-approved', 'include approved lineages (requires --force)')
      .option('--force', 'required flag when deleting approved lineages')
      .action(async (options: OptionValues, command) => {
        const { withEnvironment } = await import('./cli/cli-wrapper');
        const { lineageCommand } = await import('./cli/commands/lineage');
        return withEnvironment(lineageCommand('clean'))(options, command);
      })
      .addHelpText('after', `
Examples:
  $ funcqc lineage clean                         # Delete all draft lineages
  $ funcqc lineage clean --dry-run               # Preview what would be deleted
  $ funcqc lineage clean --older-than 30         # Delete drafts older than 30 days
  $ funcqc lineage clean -y                      # Skip confirmation
  $ funcqc lineage clean --include-approved --force  # Delete including approved (dangerous!)
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
  .action(async (metricOrConcept: string | undefined, options: OptionValues) => {
    const { explainCommand } = await import('./cli/explain');
    return explainCommand(metricOrConcept, options);
  })
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

// Add refactor command
const refactorCommand = program
  .command('refactor')
  .description('Refactoring workflow and analysis tools');

// Add analyze subcommand
refactorCommand.addCommand(
  new Command('analyze')
    .description('Analyze project for refactoring opportunities')
    .option('--complexity-threshold <num>', 'complexity threshold for analysis', '15')
    .option('--size-threshold <num>', 'size threshold for analysis', '50')
    .option('--since <ref>', 'analyze changes since git reference')
    .option('--compare-with <ref>', 'compare with specific git reference')
    .option('--output <file>', 'save report to file')
    .option('--format <type>', 'output format (summary|detailed|json)', 'summary')
    .option('--patterns <list>', 'comma-separated list of patterns to detect')
    .action(async (options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('analyze'))(options, command);
    })
    .addHelpText('after', `
Examples:
  $ funcqc refactor analyze                           # Basic project analysis
  $ funcqc refactor analyze --complexity-threshold 10 # Focus on complex functions
  $ funcqc refactor analyze --since HEAD~10          # Analyze recent changes
  $ funcqc refactor analyze --output refactor.md     # Save detailed report
  $ funcqc refactor analyze --format json            # JSON output
  $ funcqc refactor analyze --patterns extract-method,split-function
  
Supported Patterns:
  extract-method     - Functions with extractable logic blocks
  split-function     - Functions handling multiple responsibilities  
  reduce-parameters  - Functions with too many parameters
  extract-class      - Related functions that should be grouped
  inline-function    - Trivial functions adding complexity
  rename-function    - Functions with unclear names
`)
);

// Add detect subcommand
refactorCommand.addCommand(
  new Command('detect')
    .description('Detect specific refactoring patterns in the codebase')
    .option('-p, --pattern <pattern>', 'Specific pattern to detect (extract-method, split-function, etc.)')
    .option('-f, --file <file>', 'Target file pattern to analyze')
    .option('--complexity-threshold <number>', 'Minimum complexity threshold', '5')
    .option('--size-threshold <number>', 'Minimum size threshold (lines)', '20')
    .option('-s, --session <id>', 'Link results to an existing session')
    .option('--create-session', 'Create a new session for detected opportunities')
    .option('-i, --interactive', 'Interactive mode for reviewing opportunities')
    .option('--limit <number>', 'Maximum number of opportunities to detect', '20')
    .option('--json', 'Output results as JSON')
    .action(async (options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('detect'))(options, command);
    })
);

// Add track subcommand
refactorCommand.addCommand(
  new Command('track')
    .description('Track refactoring sessions and progress')
    .addCommand(
      new Command('list')
        .description('List active refactoring sessions')
        .option('--all', 'Show all sessions including completed and cancelled')
        .option('--json', 'Output as JSON')
        .action(async (options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('track', ['list']))(options, command);
        })
    )
    .addCommand(
      new Command('show')
        .description('Show details of a refactoring session')
        .argument('<sessionId>', 'Session ID to show')
        .option('--json', 'Output as JSON')
        .action(async (sessionId: string, options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('track', ['show', sessionId]))(options, command);
        })
    )
    .addCommand(
      new Command('create')
        .description('Create a new refactoring session')
        .option('-n, --name <name>', 'Session name')
        .option('-d, --description <desc>', 'Session description')
        .option('-b, --branch <branch>', 'Target Git branch')
        .option('--json', 'Output as JSON')
        .action(async (options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('track', ['create']))(options, command);
        })
    )
    .addCommand(
      new Command('update')
        .description('Update function status in a refactoring session')
        .argument('<sessionId>', 'Session ID')
        .argument('<functionId>', 'Function ID')
        .option('-s, --status <status>', 'New status (pending, in_progress, completed, skipped)')
        .option('-n, --notes <notes>', 'Add notes about the update')
        .option('--interactive', 'Interactive mode to update multiple functions')
        .action(async (sessionId: string, functionId: string, options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('track', ['update', sessionId, functionId]))(options, command);
        })
    )
    .addCommand(
      new Command('complete')
        .description('Complete a refactoring session')
        .argument('<sessionId>', 'Session ID to complete')
        .option('-s, --summary <summary>', 'Completion summary')
        .action(async (sessionId: string, options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('track', ['complete', sessionId]))(options, command);
        })
    )
    .addCommand(
      new Command('cancel')
        .description('Cancel a refactoring session')
        .argument('<sessionId>', 'Session ID to cancel')
        .option('-r, --reason <reason>', 'Cancellation reason')
        .action(async (sessionId: string, options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('track', ['cancel', sessionId]))(options, command);
        })
    )
);

// Add lineage tracking commands for Phase 2: Lineage Integration
refactorCommand.addCommand(
  new Command('split')
    .description('Track function split operation (short form)')
    .argument('<parent-id>', 'Parent function ID')
    .argument('<child-ids...>', 'Child function IDs (space-separated)')
    .option('-s, --session <id>', 'Session ID to track in')
    .option('-d, --description <desc>', 'Description of the split operation')
    .action(async (parentId: string, childIds: string[], options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('track', ['split', parentId, ...childIds]))(options, command);
    })
);

refactorCommand.addCommand(
  new Command('extract')
    .description('Track function extract operation (short form)')
    .argument('<parent-id>', 'Parent function ID')
    .argument('<extracted-id>', 'Extracted function ID')
    .option('-s, --session <id>', 'Session ID to track in')
    .option('-d, --description <desc>', 'Description of the extract operation')
    .action(async (parentId: string, extractedId: string, options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('track', ['extract', parentId, extractedId]))(options, command);
    })
);

// Add assessment command for health integration
refactorCommand.addCommand(
  new Command('assess')
    .description('Assess refactoring session with health engine integration')
    .argument('[session-id]', 'Session ID to assess (optional, uses active session if not provided)')
    .option('--comprehensive', 'Perform comprehensive assessment including explosion detection')
    .option('--json', 'Output as JSON')
    .option('--before-snapshot <id>', 'Before snapshot ID for comparison')
    .option('--after-snapshot <id>', 'After snapshot ID for comparison')
    .action(async (sessionId: string | undefined, options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('assess', sessionId ? [sessionId] : []))(options, command);
    })
);

// Add verify subcommand
refactorCommand.addCommand(
  new Command('verify')
    .description('Verify refactoring improvements using comprehensive evaluation')
    .argument('[session-id]', 'Session ID to verify (or use active session)')
    .option('--json', 'Output detailed results as JSON')
    .action(async (sessionId: string, options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('verify', sessionId ? [sessionId] : []))(options, command);
    })
);

// Add snapshot subcommand for Phase 4
refactorCommand.addCommand(
  new Command('snapshot')
    .description('Snapshot management for refactoring operations')
    .addCommand(
      new Command('create')
        .description('Create a new snapshot of the current codebase')
        .argument('[label]', 'Optional label for the snapshot')
        .option('-c, --comment <comment>', 'Comment describing the snapshot')
        .option('-f, --force', 'Force creation even if no changes detected')
        .option('--json', 'Output as JSON')
        .action(async (label: string | undefined, options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('snapshot', label ? ['create', label] : ['create']))(options, command);
        })
    )
    .addCommand(
      new Command('list')
        .description('List all snapshots')
        .option('--json', 'Output as JSON')
        .action(async (options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('snapshot', ['list']))(options, command);
        })
    )
    .addCommand(
      new Command('cleanup')
        .description('Clean up old automatic snapshots')
        .option('--dry-run', 'Preview what would be deleted without making changes')
        .option('--force', 'Force cleanup without confirmation')
        .option('--json', 'Output as JSON')
        .action(async (options: OptionValues, command) => {
          const { withEnvironment } = await import('./cli/cli-wrapper');
          const { refactorCommand } = await import('./cli/commands/refactor');
          return withEnvironment(refactorCommand('snapshot', ['cleanup']))(options, command);
        })
    )
);

// Add interactive subcommand
refactorCommand.addCommand(
  new Command('interactive')
    .description('Interactive refactoring wizard for guided code improvements')
    .option('-s, --session <id>', 'Continue from existing session')
    .option('-p, --pattern <pattern>', 'Focus on specific pattern')
    .option('--complexity-threshold <number>', 'Minimum complexity threshold', '5')
    .option('--size-threshold <number>', 'Minimum size threshold (lines)', '20')
    .option('--limit <number>', 'Maximum opportunities to process', '10')
    .action(async (options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('interactive'))(options, command);
    })
);

// Add status subcommand
refactorCommand.addCommand(
  new Command('status')
    .description('Display project refactoring status and health dashboard')
    .option('-s, --session <id>', 'Show status for specific session')
    .option('--all-sessions', 'Show status for all sessions')
    .option('--complexity-threshold <number>', 'Complexity threshold for analysis', '5')
    .option('--size-threshold <number>', 'Size threshold for analysis', '20')
    .option('--json', 'Output as JSON')
    .option('--detailed', 'Show detailed information')
    .action(async (options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('status'))(options, command);
    })
);

// Add plan subcommand
refactorCommand.addCommand(
  new Command('plan')
    .description('Generate comprehensive refactoring plan for project improvement')
    .option('-s, --session <id>', 'Generate plan for specific session')
    .option('-p, --pattern <pattern>', 'Focus plan on specific pattern')
    .option('--complexity-threshold <number>', 'Complexity threshold for analysis', '5')
    .option('--size-threshold <number>', 'Size threshold for analysis', '20')
    .option('--output <file>', 'Save plan to file')
    .option('--format <format>', 'Output format (markdown, json)', 'markdown')
    .option('--timeline <weeks>', 'Target timeline in weeks', '4')
    .option('--effort <hours>', 'Available effort per week in hours', '8')
    .action(async (options: OptionValues, command) => {
      const { withEnvironment } = await import('./cli/cli-wrapper');
      const { refactorCommand } = await import('./cli/commands/refactor');
      return withEnvironment(refactorCommand('plan'))(options, command);
    })
);

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
