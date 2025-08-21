/**
 * Unified Inspect Command - Command Protocol準拠版
 * 
 * 関数検査コマンドのCommand Protocol対応実装
 * 既存のinspect.tsの機能をCommand Protocolインターフェースでラップ
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { inspectCommand } from './inspect';

export class UnifiedInspectCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * inspectコマンドは常に既存スナップショットの関数情報が必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // 全てのinspectコマンド操作で基本的な関数情報が必要
    return ['BASIC'];
  }

  /**
   * 実際のinspect処理を実行
   * 
   * 前提条件: BASIC分析が完了済み（関数情報が利用可能）
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のinspectCommand実装を呼び出し
    const inspectFn = inspectCommand(options);
    await inspectFn(env);
  }

  /**
   * コマンドライン引数からInspectCommandOptionsを解析
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
     
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--detailed')) options.detailed = true;
    if (subCommand.includes('--desc')) options.desc = true;

    // String options with values
    const typeIndex = subCommand.indexOf('--type');
    if (typeIndex >= 0 && typeIndex < subCommand.length - 1) {
      const type = subCommand[typeIndex + 1];
      if (['functions', 'files'].includes(type)) {
        options.type = type as 'functions' | 'files';
      }
    }

    const fileIndex = subCommand.indexOf('--file');
    if (fileIndex >= 0 && fileIndex < subCommand.length - 1) {
      options.file = subCommand[fileIndex + 1];
    }

    const nameIndex = subCommand.indexOf('--name');
    if (nameIndex >= 0 && nameIndex < subCommand.length - 1) {
      options.name = subCommand[nameIndex + 1];
    }

    const sortIndex = subCommand.indexOf('--sort');
    if (sortIndex >= 0 && sortIndex < subCommand.length - 1) {
      options.sort = subCommand[sortIndex + 1];
    }

    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1];
    }

    // Numeric options
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

    const paramsGeIndex = subCommand.indexOf('--params-ge');
    if (paramsGeIndex >= 0 && paramsGeIndex < subCommand.length - 1) {
      const value = parseInt(subCommand[paramsGeIndex + 1], 10);
      if (!isNaN(value)) options.paramsGe = value;
    }

    const paramsLeIndex = subCommand.indexOf('--params-le');
    if (paramsLeIndex >= 0 && paramsLeIndex < subCommand.length - 1) {
      const value = parseInt(subCommand[paramsLeIndex + 1], 10);
      if (!isNaN(value)) options.paramsLe = value;
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