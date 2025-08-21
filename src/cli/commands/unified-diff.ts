/**
 * Unified Diff Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { diffCommand } from './diff';

export class UnifiedDiffCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const from = subCommand.length > 0 && !subCommand[0].startsWith('--') ? subCommand[0] : '';
    const to = subCommand.length > 1 && !subCommand[1].startsWith('--') ? subCommand[1] : '';
    const options = this.parseOptions(subCommand);
    
    const diffFn = diffCommand(from, to);
    await diffFn(options)(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--insights')) options.insights = true;
    
    const similarityThresholdIndex = subCommand.indexOf('--similarity-threshold');
    if (similarityThresholdIndex >= 0 && similarityThresholdIndex < subCommand.length - 1) {
      const threshold = parseFloat(subCommand[similarityThresholdIndex + 1]);
      if (!isNaN(threshold)) options.similarityThreshold = threshold;
    }
    
    return options;
  }
}