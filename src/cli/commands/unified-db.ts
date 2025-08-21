/**
 * Unified DB Command - Command Protocol準拠版
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { dbCommand } from './db';

export class UnifiedDbCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // DB operations are typically independent of analysis data
    return [];
  }

  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const dbFn = dbCommand(options);
    await dbFn(env);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    
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
    
    const columnsIndex = subCommand.indexOf('--columns');
    if (columnsIndex >= 0 && columnsIndex < subCommand.length - 1) {
      options.columns = subCommand[columnsIndex + 1];
    }
    
    if (subCommand.includes('--count')) options.count = true;
    if (subCommand.includes('--list')) options.list = true;
    
    return options;
  }
}