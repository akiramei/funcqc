/**
 * Unified Refactor Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { refactorCommand } from './refactor';

export class UnifiedRefactorCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const refactorFn = refactorCommand(options);
    await refactorFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--auto-apply')) options.autoApply = true;
    if (subCommand.includes('--dry-run')) options.dryRun = true;
    
    const typeIndex = subCommand.indexOf('--type');
    if (typeIndex >= 0 && typeIndex < subCommand.length - 1) {
      options.type = subCommand[typeIndex + 1];
    }
    
    return options;
  }
}