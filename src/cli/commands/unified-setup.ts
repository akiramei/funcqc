/**
 * Unified Setup Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { setupCommand } from './setup';

export class UnifiedSetupCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // Setup command has no dependencies
    return [];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const setupFn = setupCommand(options);
    await setupFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--force')) options.force = true;
    return options;
  }
}