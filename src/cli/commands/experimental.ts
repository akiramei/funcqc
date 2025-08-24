/**
 * Experimental Command - Command Protocol Implementation
 * 
 * 実験的・使用頻度の低いコマンドを統合したサブコマンド
 * 
 * Available subcommands:
 * - evaluate: Function naming quality evaluation
 * - residue-check: Debug code residue detection
 * - detect: Identify potential refactoring opportunities
 * - describe: Get descriptions of functions, types and architecture
 * - search: Search functions with semantic and hybrid search
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';

export class ExperimentalCommand implements Command {
  /**
   * Determine required dependencies based on subcommand
   */
  async getRequires(subCommand: string[]): Promise<DependencyType[]> {
    if (subCommand.length === 0) {
      return []; // Help display doesn't require analysis
    }
    
    const experimentalSubcommand = subCommand[0];
    
    switch (experimentalSubcommand) {
      case 'evaluate':
        return ['BASIC']; // Needs function analysis for naming evaluation
      case 'residue-check':
        return ['BASIC']; // Needs to check function content
      case 'detect':
        return ['BASIC']; // Basic analysis for ineffective splits detection
      case 'describe':
        return ['BASIC']; // Needs function information for descriptions
      case 'search': 
        return ['BASIC']; // Basic search needs function data
      default:
        return [];
    }
  }
  
  /**
   * Execute the experimental subcommand
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    if (subCommand.length === 0) {
      this.showHelp();
      return;
    }

    const experimentalSubcommand = subCommand[0];
    const subArgs = subCommand.slice(1);

    switch (experimentalSubcommand) {
      case 'evaluate':
        await this.executeEvaluate(env, subArgs);
        break;
      case 'residue-check':
        await this.executeResidueCheck(env, subArgs);
        break;
      case 'detect':
        await this.executeDetect(env, subArgs);
        break;
      case 'describe':
        await this.executeDescribe(env, subArgs);
        break;
      case 'search':
        await this.executeSearch(env, subArgs);
        break;
      default:
        console.log(`Unknown experimental subcommand: ${experimentalSubcommand}`);
        this.showHelp();
        break;
    }
  }

  /**
   * Show help for experimental commands
   */
  private showHelp(): void {
    console.log(`
Usage: funcqc experimental <subcommand> [options]

Available subcommands:
  evaluate         Function naming quality evaluation
  residue-check    Debug code residue detection (console.log, TODO, etc.)
  detect           Identify potential refactoring opportunities  
  describe         Get descriptions of functions, types and architecture
  search           Search functions with semantic and hybrid search

Examples:
  funcqc experimental evaluate --help
  funcqc experimental residue-check --help
  funcqc experimental detect --help
  funcqc experimental describe FunctionName
  funcqc experimental search "error handling"

Use 'funcqc experimental <subcommand> --help' for detailed help on each subcommand.
    `);
  }

  /**
   * Execute evaluate subcommand
   */
  private async executeEvaluate(env: CommandEnvironment, args: string[]): Promise<void> {
    const { evaluateCommand } = await import('./evaluate');
    
    const input = args.length > 0 && !args[0].startsWith('--') ? args[0] : '';
    const options = {
      quiet: false,
      verbose: false
    };
    
    await evaluateCommand(input)(options)(env);
  }

  /**
   * Execute residue-check subcommand
   */
  private async executeResidueCheck(_env: CommandEnvironment, args: string[]): Promise<void> {
    const options = this.parseResidueCheckOptions(args);
    const { withEnvironment } = await import('../cli-wrapper');
    const { residueCheckCommand } = await import('./residue-check');
    await withEnvironment(residueCheckCommand)(options);
  }

  /**
   * Execute detect subcommand
   */
  private async executeDetect(_env: CommandEnvironment, args: string[]): Promise<void> {
    const options = this.parseDetectOptions(args);
    const { withEnvironment } = await import('../cli-wrapper');
    const { detectCommand } = await import('./detect');
    const subcommand = args.length > 0 && !args[0].startsWith('--') ? args[0] : '';
    await withEnvironment(detectCommand(subcommand))(options);
  }

  /**
   * Execute describe subcommand - direct command invocation
   */
  private async executeDescribe(env: CommandEnvironment, args: string[]): Promise<void> {
    const { describeCommand } = await import('./describe');
    
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
Usage: funcqc experimental describe [pattern] [options]

Get descriptions of functions, types and architecture

Arguments:
  pattern                Pattern to match function/type names (optional)

Options:
  --detailed, -d         Show detailed descriptions
  --functions-only       Show only function descriptions
  --types-only          Show only type descriptions
  --help, -h            Show this help

Examples:
  funcqc experimental describe
  funcqc experimental describe UserService
  funcqc experimental describe --functions-only
      `);
      return;
    }

    const pattern = args.length > 0 && !args[0].startsWith('--') ? args[0] : undefined;
    const options = {
      pattern,
      detailed: args.includes('--detailed') || args.includes('-d'),
      functionsOnly: args.includes('--functions-only'),
      typesOnly: args.includes('--types-only'),
      quiet: false,
      verbose: false
    };
    
    await describeCommand(pattern || '')(options)(env);
  }

  /**
   * Execute search subcommand - direct command invocation
   */
  private async executeSearch(env: CommandEnvironment, args: string[]): Promise<void> {
    const { searchCommand } = await import('./search');
    
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
Usage: funcqc experimental search <query> [options]

Search functions with semantic and hybrid search

Arguments:
  query                 Search query (required)

Options:
  --semantic, -s        Use semantic search only
  --limit <n>          Maximum number of results (default: 10)
  --min-score <n>      Minimum similarity score (0-1, default: 0.1)
  --help, -h           Show this help

Examples:
  funcqc experimental search "error handling"
  funcqc experimental search "database" --semantic --limit 5
      `);
      return;
    }

    const query = args.find(arg => !arg.startsWith('--'));
    if (!query) {
      console.error('Error: Search query is required');
      return;
    }

    const limitIndex = args.indexOf('--limit');
    const minScoreIndex = args.indexOf('--min-score');
    
    const options = {
      semantic: args.includes('--semantic') || args.includes('-s'),
      limit: limitIndex >= 0 && limitIndex < args.length - 1 ? (args[limitIndex + 1] || '10') : '10',
      minScore: minScoreIndex >= 0 && minScoreIndex < args.length - 1 ? (args[minScoreIndex + 1] || '0.1') : '0.1',
      quiet: false,
      verbose: false
    };
    
    await searchCommand(query)(options)(env);
  }


  /**
   * Parse residue-check options from command line arguments
   */
  private parseResidueCheckOptions(args: string[]): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '--help':
          console.log('Usage: funcqc experimental residue-check\n\nDebug code residue detection (console.log, TODO, etc.)\n\nOptions:\n  --help    Show this help');
          process.exit(0);
      }
    }
    return options;
  }

  /**
   * Parse detect options from command line arguments
   */
  private parseDetectOptions(args: string[]): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '--help':
          console.log('Usage: funcqc experimental detect [subcommand]\n\nIdentify potential refactoring opportunities\n\nOptions:\n  --help    Show this help');
          process.exit(0);
      }
    }
    return options;
  }
}