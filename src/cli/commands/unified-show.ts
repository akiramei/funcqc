/**
 * Unified Show Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { showCommand } from './show';

export class UnifiedShowCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const namePattern = subCommand.length > 0 && !subCommand[0].startsWith('--') ? subCommand[0] : '';
    const options = this.parseOptions(subCommand);
    
    const showFn = showCommand(namePattern);
    await showFn(options)(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    
    const directionIndex = subCommand.indexOf('--direction');
    if (directionIndex >= 0 && directionIndex < subCommand.length - 1) {
      options.direction = subCommand[directionIndex + 1];
    }
    
    const depthIndex = subCommand.indexOf('--depth');
    if (depthIndex >= 0 && depthIndex < subCommand.length - 1) {
      const depth = parseInt(subCommand[depthIndex + 1], 10);
      if (!isNaN(depth)) options.depth = depth;
    }
    
    return options;
  }
}