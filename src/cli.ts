#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './cli/init';
import { scanCommand } from './cli/scan';
import { listCommand } from './cli/list';
import { statusCommand } from './cli/status';
import { historyCommand } from './cli/history';
import { diffCommand } from './cli/diff';

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
  .option('--no-color', 'disable colored output');

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
  .argument('[paths...]', 'paths to scan (optional)')
  .option('--label <text>', 'label for this snapshot')
  .option('--dry-run', 'analyze only, don\'t save to database')
  .option('--incremental', 'process changed files only')
  .option('--force', 'force full rescan of all files')
  .option('--batch-size <num>', 'batch size for processing', '100')
  .action(scanCommand);

program
  .command('list')
  .description('List and search functions')
  .argument('[patterns...]', 'function name patterns (glob)')
  .option('--name <pattern>', 'filter by function name pattern')
  .option('--file <pattern>', 'filter by file path pattern')
  .option('--exported', 'show exported functions only')
  .option('--async', 'show async functions only')
  .option('--complexity <condition>', 'filter by complexity (e.g., ">5", "3..10")')
  .option('--lines <condition>', 'filter by lines of code')
  .option('--params <condition>', 'filter by parameter count')
  .option('--format <type>', 'output format', 'table')
  .option('--fields <list>', 'fields to display (comma-separated)')
  .option('--sort <field>', 'sort by field[:order]', 'name')
  .option('--limit <num>', 'limit number of results', '50')
  .option('--json', 'output as JSON')
  .option('--csv', 'output as CSV')
  .action(listCommand);

program
  .command('status')
  .description('Show current project status')
  .option('--verbose', 'show detailed information')
  .action(statusCommand);

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
  .action(historyCommand);

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

// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red('Invalid command: %s'), program.args.join(' '));
  console.log(chalk.yellow('See --help for a list of available commands.'));
  process.exit(1);
});

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

// Parse command line arguments
program.parse();
