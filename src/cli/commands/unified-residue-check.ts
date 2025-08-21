/**
 * Unified Residue-Check Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { residueCheckCommand } from './residue-check';

export class UnifiedResidueCheckCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const residueCheckFn = residueCheckCommand(options);
    await residueCheckFn(env);
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