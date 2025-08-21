/**
 * Unified Search Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { searchCommand } from './search';

export class UnifiedSearchCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const keyword = subCommand.length > 0 && !subCommand[0].startsWith('--') ? subCommand[0] : '';
    const options = this.parseOptions(subCommand);
    
    const searchFn = searchCommand(keyword);
    await searchFn(options)(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--exact')) options.exact = true;
    return options;
  }
}