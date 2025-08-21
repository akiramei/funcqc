/**
 * Unified Config Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { configCommand } from '../config';

export class UnifiedConfigCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // Config command has no dependencies
    return [];
  }

  async perform(_env: CommandEnvironment, subCommand: string[]): Promise<void> {
    // 先頭に -- があっても、最初の非オプショントークンを action として扱う
    const action = subCommand.find((t) => !t.startsWith('--')) ?? '';
    const options = this.parseOptions(subCommand);
    
    await configCommand(action, options);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    
    const presetIndex = subCommand.indexOf('--preset');
    if (presetIndex >= 0 && presetIndex < subCommand.length - 1) {
      options.preset = subCommand[presetIndex + 1];
    }
    
    if (subCommand.includes('--replace')) options.replace = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    
    return options;
  }
}