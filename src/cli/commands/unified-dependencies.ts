/**
 * Unified Dependencies Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { dependenciesCommand } from './dependencies';

export class UnifiedDependenciesCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // Dependencies command requires call graph analysis for dependency mapping
    return ['BASIC', 'CALL_GRAPH'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const depsFn = dependenciesCommand(options);
    await depsFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    
    // Action parsing
    const actionIndex = subCommand.indexOf('--action');
    if (actionIndex >= 0 && actionIndex < subCommand.length - 1) {
      options.action = subCommand[actionIndex + 1];
    }
    
    // Other options
    if (subCommand.includes('--show-hubs')) options.showHubs = true;
    if (subCommand.includes('--include-external')) options.includeExternal = true;
    
    const limitIndex = subCommand.indexOf('--limit');
    if (limitIndex >= 0 && limitIndex < subCommand.length - 1) {
      const limit = parseInt(subCommand[limitIndex + 1], 10);
      if (!isNaN(limit)) options.limit = limit;
    }
    
    return options;
  }
}