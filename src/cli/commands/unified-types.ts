/**
 * Unified Types Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { typesCommand } from './types-unified';

export class UnifiedTypesCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // Types command uses stored type information from TYPE_SYSTEM analysis
    return ['BASIC', 'TYPE_SYSTEM'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const typesFn = typesCommand(options);
    await typesFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    
    // Action parsing (list, health, deps, api, etc.)
    const actionIndex = subCommand.indexOf('--action');
    if (actionIndex >= 0 && actionIndex < subCommand.length - 1) {
      options.action = subCommand[actionIndex + 1];
    }
    
    // Type-specific options
    const kindIndex = subCommand.indexOf('--kind');
    if (kindIndex >= 0 && kindIndex < subCommand.length - 1) {
      options.kind = subCommand[kindIndex + 1];
    }
    
    const typeNameIndex = subCommand.indexOf('--type-name');
    if (typeNameIndex >= 0 && typeNameIndex < subCommand.length - 1) {
      options.typeName = subCommand[typeNameIndex + 1];
    }
    
    if (subCommand.includes('--optimize')) options.optimize = true;
    if (subCommand.includes('--show-redundant')) options.showRedundant = true;
    
    const limitIndex = subCommand.indexOf('--limit');
    if (limitIndex >= 0 && limitIndex < subCommand.length - 1) {
      const limit = parseInt(subCommand[limitIndex + 1], 10);
      if (!isNaN(limit)) options.limit = limit;
    }
    
    return options;
  }
}