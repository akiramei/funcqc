/**
 * Health Command - Command Protocol Implementation
 * 
 * プロジェクト健全性評価コマンドのCommand Protocol対応実装
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { HealthCommandOptions } from '../../types';
import { healthCommand } from './health';

export class HealthCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * healthコマンドは包括的な健全性評価のため全ての分析結果が必要：
   * - BASIC: 関数の品質メトリクス（複雑度、行数など）
   * - CALL_GRAPH: 構造的依存関係、Hub/Cyclic function分析
   * - COUPLING: 結合度分析、構造リスク評価
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // healthコマンドは包括的な品質評価のため全分析が必要
    return ['BASIC', 'CALL_GRAPH', 'COUPLING'];
  }
  
  /**
   * 実際の処理を実行
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
  private parseOptions(subCommand: string[]): HealthCommandOptions {
    const options: HealthCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--trend')) options.trend = true;
    if (subCommand.includes('--risks')) options.risks = true;
    if (subCommand.includes('--show-config')) options.showConfig = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--ai-optimized')) options.aiOptimized = true;
    
    // Handle --diff option (can be boolean or string)
    if (subCommand.includes('--diff')) {
      const diffIndex = subCommand.indexOf('--diff');
      // If next argument exists and doesn't start with --, it's a value
      if (diffIndex < subCommand.length - 1 && !subCommand[diffIndex + 1]?.startsWith('--')) {
        options.diff = subCommand[diffIndex + 1] ?? '';
      } else {
        options.diff = true;
      }
    }

    // String options with values
    const periodIndex = subCommand.indexOf('--period');
    if (periodIndex >= 0 && periodIndex < subCommand.length - 1) {
      options.period = subCommand[periodIndex + 1] ?? '';
    }

    const snapshotIndex = subCommand.indexOf('--snapshot');
    if (snapshotIndex >= 0 && snapshotIndex < subCommand.length - 1) {
      options.snapshot = subCommand[snapshotIndex + 1] ?? '';
    }

    return options;
  }
}