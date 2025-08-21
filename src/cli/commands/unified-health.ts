/**
 * Unified Health Command - Command Protocol準拠版
 * 
 * ヘルスチェックコマンドのCommand Protocol対応実装
 * 既存のhealth/index.tsの機能をCommand Protocolインターフェースでラップ
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { healthCommand } from './health';

export class UnifiedHealthCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * healthコマンドは常に既存スナップショットの関数情報が必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // 全てのhealthコマンド操作で基本的な関数情報が必要
    return ['BASIC'];
  }

  /**
   * 実際のhealth処理を実行
   * 
   * 前提条件: BASIC分析が完了済み（関数情報が利用可能）
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のhealthCommand実装を呼び出し
    const healthFn = healthCommand(options);
    await healthFn(env);
  }

  /**
   * コマンドライン引数からHealthCommandOptionsを解析
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseOptions(subCommand: string[]): any {
     
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {};

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--risks')) options.risks = true;
    if (subCommand.includes('--trend')) options.trend = true;
    if (subCommand.includes('--ai-optimized')) options.aiOptimized = true;
    if (subCommand.includes('--advanced')) options.advanced = true;

    // String options
    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1];
    }

    const snapshotIndex = subCommand.indexOf('--snapshot');
    if (snapshotIndex >= 0 && snapshotIndex < subCommand.length - 1) {
      options.snapshot = subCommand[snapshotIndex + 1];
    }

    const modeIndex = subCommand.indexOf('--mode');
    if (modeIndex >= 0 && modeIndex < subCommand.length - 1) {
      const mode = subCommand[modeIndex + 1];
      if (['statistical', 'dynamic'].includes(mode)) {
        options.mode = (mode === 'statistical' ? 'static' : mode) as 'static' | 'dynamic';
      }
    }

    return options;
  }
}