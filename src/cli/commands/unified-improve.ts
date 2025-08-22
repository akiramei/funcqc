/**
 * Unified Improve Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { improveCommand } from './improve';

export class UnifiedImproveCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const improveFn = improveCommand(options);
    await improveFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--auto-apply')) options.autoApply = true;
    if (subCommand.includes('--risky')) options.risky = true;
    if (subCommand.includes('--preview')) options.preview = true;
    
    const typeIndex = subCommand.indexOf('--type');
    if (typeIndex >= 0 && typeIndex < subCommand.length - 1) {
      options.type = subCommand[typeIndex + 1];
    }
    
    const thresholdIndex = subCommand.indexOf('--threshold');
    if (thresholdIndex >= 0 && thresholdIndex < subCommand.length - 1) {
      const threshold = parseFloat(subCommand[thresholdIndex + 1]);
      if (!isNaN(threshold)) options.threshold = threshold;
    }
    
    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1];
    }
    
    return options;
  }
}