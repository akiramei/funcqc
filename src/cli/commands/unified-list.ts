/**
 * Unified List Command - Command Protocol準拠版
 * 
 * 関数一覧コマンドのCommand Protocol対応実装
 * 既存のlist.tsの機能をCommand Protocolインターフェースでラップ
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { listCommand } from './list';

export class UnifiedListCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * listコマンドは常に既存スナップショットの関数情報が必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // 全てのlistコマンド操作で基本的な関数情報が必要
    return ['BASIC'];
  }

  /**
   * 実際のlist処理を実行
   * 
   * 前提条件: BASIC分析が完了済み（関数情報が利用可能）
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
     
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--desc')) options.desc = true;

    // String options
    const fileIndex = subCommand.indexOf('--file');
    if (fileIndex >= 0 && fileIndex < subCommand.length - 1) {
      options.file = subCommand[fileIndex + 1];
    }

    const sortIndex = subCommand.indexOf('--sort');
    if (sortIndex >= 0 && sortIndex < subCommand.length - 1) {
      options.sort = subCommand[sortIndex + 1];
    }

    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1];
    }

    // Numeric filters
    const ccGeIndex = subCommand.indexOf('--cc-ge');
    if (ccGeIndex >= 0 && ccGeIndex < subCommand.length - 1) {
      const value = parseInt(subCommand[ccGeIndex + 1], 10);
      if (!isNaN(value)) options.ccGe = value;
    }

    const ccLeIndex = subCommand.indexOf('--cc-le');
    if (ccLeIndex >= 0 && ccLeIndex < subCommand.length - 1) {
      const value = parseInt(subCommand[ccLeIndex + 1], 10);
      if (!isNaN(value)) options.ccLe = value;
    }

    const locGeIndex = subCommand.indexOf('--loc-ge');
    if (locGeIndex >= 0 && locGeIndex < subCommand.length - 1) {
      const value = parseInt(subCommand[locGeIndex + 1], 10);
      if (!isNaN(value)) options.locGe = value;
    }

    const locLeIndex = subCommand.indexOf('--loc-le');
    if (locLeIndex >= 0 && locLeIndex < subCommand.length - 1) {
      const value = parseInt(subCommand[locLeIndex + 1], 10);
      if (!isNaN(value)) options.locLe = value;
    }

    const limitIndex = subCommand.indexOf('--limit');
    if (limitIndex >= 0 && limitIndex < subCommand.length - 1) {
      const value = parseInt(subCommand[limitIndex + 1], 10);
      if (!isNaN(value)) options.limit = value;
    }

    const offsetIndex = subCommand.indexOf('--offset');
    if (offsetIndex >= 0 && offsetIndex < subCommand.length - 1) {
      const value = parseInt(subCommand[offsetIndex + 1], 10);
      if (!isNaN(value)) options.offset = value;
    }

    return options;
  }
}