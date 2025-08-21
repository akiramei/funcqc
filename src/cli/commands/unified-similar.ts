/**
 * Unified Similar Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { similarCommand } from './similar';

export class UnifiedSimilarCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const similarFn = similarCommand(options);
    await similarFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    
    const thresholdIndex = subCommand.indexOf('--threshold');
    if (thresholdIndex >= 0 && thresholdIndex < subCommand.length - 1) {
      const threshold = parseFloat(subCommand[thresholdIndex + 1]);
      if (!isNaN(threshold)) options.threshold = threshold;
    }
    
    const minLinesIndex = subCommand.indexOf('--min-lines');
    if (minLinesIndex >= 0 && minLinesIndex < subCommand.length - 1) {
      const minLines = parseInt(subCommand[minLinesIndex + 1], 10);
      if (!isNaN(minLines)) options.minLines = minLines;
    }
    
    return options;
  }
}