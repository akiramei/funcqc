/**
 * Unified Safe-Delete Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { safeDeleteCommand } from '../safe-delete';

export class UnifiedSafeDeleteCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // Safe delete requires call graph to detect function usage
    return ['BASIC', 'CALL_GRAPH'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const safeDeleteFn = safeDeleteCommand(options);
    await safeDeleteFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--dry-run')) options.dryRun = true;
    
    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1];
    }
    
    return options;
  }
}