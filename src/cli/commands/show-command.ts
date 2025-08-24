/**
 * Show Command - Command Protocol Implementation
 * 
 * 関数詳細表示コマンドのCommand Protocol対応実装
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { ShowCommandOptions } from '../../types';
import { showCommand } from './show';

export class ShowCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * showコマンドは常にBASIC分析が必要：
   * - 関数の詳細情報（メトリクス、署名、説明など）を表示するため
   * - --historyオプションがあってもスナップショット作成は不要
   *   （データがなければ適切にメッセージを表示）
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // showコマンドは常にBASIC分析が必要
    return ['BASIC'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const { namePattern, options } = this.parseArguments(subCommand);
    
    // --historyオプションの場合、データがなければ適切に処理
    if (options.history) {
      const hasHistoricalData = await this.checkHistoricalData(env);
      if (!hasHistoricalData) {
        console.log('📊 No historical data available.');
        console.log('💡 Run `funcqc scan` multiple times to build history data.');
        console.log('');
        // 履歴なしでも基本情報は表示する
        options.history = false;
        options.current = true;
      }
    }
    
    // 既存のshowCommand実装を呼び出し
    const showFn = showCommand(namePattern)(options);
    await showFn(env);
  }
  
  /**
   * 履歴データの存在確認
   */
  private async checkHistoricalData(env: CommandEnvironment): Promise<boolean> {
    try {
      // スナップショット数を確認
      const snapshots = await env.storage.getSnapshots({ sort: 'created_at', limit: 2 });
      return snapshots.length > 1;
    } catch {
      return false;
    }
  }
  
  /**
   * コマンドライン引数からnamePatternとShowCommandOptionsを解析
   */
  private parseArguments(subCommand: string[]): { namePattern: string; options: ShowCommandOptions } {
    const options: ShowCommandOptions = {};
    let namePattern = '';

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--usage')) options.usage = true;
    if (subCommand.includes('--current')) options.current = true;
    if (subCommand.includes('--history')) options.history = true;
    if (subCommand.includes('--source')) options.source = true;

    // String options with values
    const idIndex = subCommand.indexOf('--id');
    if (idIndex >= 0 && idIndex < subCommand.length - 1) {
      options.id = subCommand[idIndex + 1] ?? '';
    }

    // namePattern (positional argument)
    // --で始まらない最初の引数をnamePatternとする
    const positionalArgs = subCommand.filter(arg => !arg.startsWith('--'));
    if (positionalArgs.length > 0) {
      namePattern = positionalArgs[0] ?? '';
    }

    return { namePattern, options };
  }
}