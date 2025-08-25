/**
 * DepList Command - Command Protocol Implementation
 * 
 * Function dependency listing command with Command Protocol support
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { depListCommand } from '../dep/list';
import { DepListOptions } from '../dep/types';

export class DepListCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * dep listコマンドはCALL_GRAPH分析が必要：
   * - 関数間の依存関係表示には呼び出し関係が必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC', 'CALL_GRAPH'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のdepListCommand実装を呼び出し
    const listCommandFn = depListCommand(options);
    await listCommandFn(env);
  }
  
  /**
   * コマンドライン引数からDepListOptionsを解析
   */
  private parseOptions(subCommand: string[]): DepListOptions {
    const options: DepListOptions = {};

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--desc')) options.desc = true;

    // String options with values
    const callerIndex = subCommand.indexOf('--caller');
    if (callerIndex >= 0 && callerIndex < subCommand.length - 1) {
      options.caller = subCommand[callerIndex + 1];
    }

    const calleeIndex = subCommand.indexOf('--callee');
    if (calleeIndex >= 0 && calleeIndex < subCommand.length - 1) {
      options.callee = subCommand[calleeIndex + 1];
    }

    const callerClassIndex = subCommand.indexOf('--caller-class');
    if (callerClassIndex >= 0 && callerClassIndex < subCommand.length - 1) {
      options.callerClass = subCommand[callerClassIndex + 1];
    }

    const calleeClassIndex = subCommand.indexOf('--callee-class');
    if (calleeClassIndex >= 0 && calleeClassIndex < subCommand.length - 1) {
      options.calleeClass = subCommand[calleeClassIndex + 1];
    }

    const fileIndex = subCommand.indexOf('--file');
    if (fileIndex >= 0 && fileIndex < subCommand.length - 1) {
      options.file = subCommand[fileIndex + 1];
    }

    const sortIndex = subCommand.indexOf('--sort');
    if (sortIndex >= 0 && sortIndex < subCommand.length - 1) {
      const sortValue = subCommand[sortIndex + 1];
      if (sortValue === 'caller' || sortValue === 'callee' || sortValue === 'file' || sortValue === 'line') {
        options.sort = sortValue;
      }
    }

    const limitIndex = subCommand.indexOf('--limit');
    if (limitIndex >= 0 && limitIndex < subCommand.length - 1) {
      options.limit = subCommand[limitIndex + 1];
    }

    const typeIndex = subCommand.indexOf('--type');
    if (typeIndex >= 0 && typeIndex < subCommand.length - 1) {
      const typeValue = subCommand[typeIndex + 1];
      if (typeValue === 'direct' || typeValue === 'async' || typeValue === 'conditional' || typeValue === 'external') {
        options.type = typeValue;
      }
    }

    const snapshotIndex = subCommand.indexOf('--snapshot');
    if (snapshotIndex >= 0 && snapshotIndex < subCommand.length - 1) {
      options.snapshot = subCommand[snapshotIndex + 1];
    }

    return options;
  }
}