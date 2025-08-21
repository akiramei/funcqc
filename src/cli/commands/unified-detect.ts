/**
 * Unified Detect Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { detectCommand } from './detect';

export class UnifiedDetectCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const subcommand = subCommand.length > 0 && !subCommand[0].startsWith('--') ? subCommand[0] : '';
    const options = this.parseOptions(subCommand);
    
    const detectFn = detectCommand(subcommand);
    await detectFn(options)(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    return options;
  }
}