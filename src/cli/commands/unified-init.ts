/**
 * Unified Init Command - Command Protocol準拠版
 * 
 * 初期化コマンドは依存関係なし
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { initCommand } from '../init';

export class UnifiedInitCommand implements Command {
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // Init command has no dependencies - it initializes configuration only
    return [];
  }

  async perform(_env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    await initCommand(options);
  }

   
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};
    
    const rootIndex = subCommand.indexOf('--root');
    if (rootIndex >= 0 && rootIndex < subCommand.length - 1) {
      options.root = subCommand[rootIndex + 1];
    }
    
    const excludeIndex = subCommand.indexOf('--exclude');
    if (excludeIndex >= 0 && excludeIndex < subCommand.length - 1) {
      options.exclude = subCommand[excludeIndex + 1];
    }
    
    const dbIndex = subCommand.indexOf('--db');
    if (dbIndex >= 0 && dbIndex < subCommand.length - 1) {
      options.db = subCommand[dbIndex + 1];
    }
    
    if (subCommand.includes('--show')) options.show = true;
    if (subCommand.includes('--reset')) options.reset = true;
    
    return options;
  }
}