/**
 * Unified Assess Command - Command Protocol準拠版
 * 
 * 品質評価コマンドのCommand Protocol対応実装
 * 既存のassess.tsの機能をCommand Protocolインターフェースでラップ
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { AssessCommandOptions } from '../../types';
import { assessCommand } from './assess';

export class UnifiedAssessCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * assessコマンドは常に既存スナップショットの関数情報が必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // 全てのassessコマンド操作で基本的な関数情報が必要
    return ['BASIC'];
  }

  /**
   * 実際のassess処理を実行
   * 
   * 前提条件: BASIC分析が完了済み（関数情報が利用可能）
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のassessCommand実装を呼び出し
    const assessFn = assessCommand(options);
    await assessFn(env);
  }

  /**
   * コマンドライン引数からAssessCommandOptionsを解析
   */
  private parseOptions(subCommand: string[]): AssessCommandOptions {
    const options: AssessCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--advanced')) options.advanced = true;
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--risks')) options.risks = true;
    if (subCommand.includes('--trend')) options.trend = true;
    // ai-optimized is handled through json output

    // String options with values
    const typeIndex = subCommand.indexOf('--type');
    if (typeIndex >= 0 && typeIndex < subCommand.length - 1) {
      const type = subCommand[typeIndex + 1];
      if (['health', 'quality', 'types'].includes(type)) {
        options.type = type as 'health' | 'quality' | 'types';
      }
    }

    const modeIndex = subCommand.indexOf('--mode');
    if (modeIndex >= 0 && modeIndex < subCommand.length - 1) {
      const mode = subCommand[modeIndex + 1];
      if (['statistical', 'dynamic'].includes(mode)) {
        options.mode = (mode === 'statistical' ? 'static' : mode) as 'static' | 'dynamic';
      }
    }

    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1];
    }

    // Snapshot handling is managed by dependency system
    // const snapshotIndex = subCommand.indexOf('--snapshot');
    // if (snapshotIndex >= 0 && snapshotIndex < subCommand.length - 1) {
    //   options.snapshot = subCommand[snapshotIndex + 1];
    // }

    return options;
  }
}