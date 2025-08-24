/**
 * List Command - Command Protocol Implementation
 * 
 * 関数一覧表示コマンドのCommand Protocol対応実装
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { ListCommandOptions } from '../../types';
import { listCommand } from './list';

export class ListCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * listコマンドでBASIC分析が必要な場合：
   * - --changes-ge オプションがある場合（変更数フィルタ）
   * - --sort changes が指定されている場合（変更数でソート）
   */
  async getRequires(subCommand: string[]): Promise<DependencyType[]> {
    // 変更数フィルタがある場合
    const hasChangesFilter = subCommand.some(arg => 
      arg.startsWith('--changes-ge')
    );
    
    // ソートが変更数指定の場合
    const sortIndex = subCommand.indexOf('--sort');
    const hasSortByChanges = sortIndex >= 0 && 
      sortIndex < subCommand.length - 1 && 
      subCommand[sortIndex + 1] === 'changes';
    
    return (hasChangesFilter || hasSortByChanges) ? ['BASIC'] : [];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のlistCommand実装を呼び出し
    const listFn = listCommand(options);
    await listFn(env);
  }
  
  /**
   * コマンドライン引数からListCommandOptionsを解析
   */
  private parseOptions(subCommand: string[]): ListCommandOptions {
    const options: ListCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--desc')) options.desc = true;
    if (subCommand.includes('--full-id')) options.fullId = true;
    if (subCommand.includes('--include-types')) options.includeTypes = true;

    // String options with values
    const limitIndex = subCommand.indexOf('--limit');
    if (limitIndex >= 0 && limitIndex < subCommand.length - 1) {
      options.limit = subCommand[limitIndex + 1] ?? '';
    }

    const sortIndex = subCommand.indexOf('--sort');
    if (sortIndex >= 0 && sortIndex < subCommand.length - 1) {
      options.sort = subCommand[sortIndex + 1] ?? '';
    }

    const ccGeIndex = subCommand.indexOf('--cc-ge');
    if (ccGeIndex >= 0 && ccGeIndex < subCommand.length - 1) {
      options.ccGe = subCommand[ccGeIndex + 1] ?? '';
    }

    const changesGeIndex = subCommand.indexOf('--changes-ge');
    if (changesGeIndex >= 0 && changesGeIndex < subCommand.length - 1) {
      options.changesGe = subCommand[changesGeIndex + 1] ?? '';
    }

    const fileIndex = subCommand.indexOf('--file');
    if (fileIndex >= 0 && fileIndex < subCommand.length - 1) {
      options.file = subCommand[fileIndex + 1] ?? '';
    }

    const nameIndex = subCommand.indexOf('--name');
    if (nameIndex >= 0 && nameIndex < subCommand.length - 1) {
      options.name = subCommand[nameIndex + 1] ?? '';
    }

    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1] ?? '';
    }

    return options;
  }
}