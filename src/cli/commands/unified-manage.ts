/**
 * Unified Manage Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { manageCommand } from './manage';

export class UnifiedManageCommand implements Command {
  async getRequires(subCommand: string[]): Promise<DependencyType[]> {
    // Most manage operations need basic analysis data for db queries
    const action = subCommand.find(arg => ['--action', '-a'].some(flag => 
      subCommand.indexOf(flag) >= 0 && subCommand[subCommand.indexOf(flag) + 1] === arg
    ));
    
    // Pure DB operations don't need analysis dependencies
    if (['export', 'import', 'backup', 'restore', 'cleanup'].includes(action || '')) {
      return [];
    }
    
    // Most other operations need basic function data
    return ['BASIC'];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const manageFn = manageCommand(options);
    await manageFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    
    const actionIndex = subCommand.indexOf('--action');
    if (actionIndex >= 0 && actionIndex < subCommand.length - 1) {
      options.action = subCommand[actionIndex + 1];
    }
    
    const tableIndex = subCommand.indexOf('--table');
    if (tableIndex >= 0 && tableIndex < subCommand.length - 1) {
      options.table = subCommand[tableIndex + 1];
    }
    
    const whereIndex = subCommand.indexOf('--where');
    if (whereIndex >= 0 && whereIndex < subCommand.length - 1) {
      options.where = subCommand[whereIndex + 1];
    }
    
    const limitIndex = subCommand.indexOf('--limit');
    if (limitIndex >= 0 && limitIndex < subCommand.length - 1) {
      const limit = parseInt(subCommand[limitIndex + 1], 10);
      if (!isNaN(limit)) options.limit = limit;
    }
    
    return options;
  }
}