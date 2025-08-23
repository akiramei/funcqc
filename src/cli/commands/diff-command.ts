/**
 * Diff Command - Command Protocol Implementation
 * 
 * スナップショット比較コマンドのCommand Protocol対応実装
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { diffCommand } from './diff';

// Diff command specific options type
interface DiffCommandOptions {
  summary?: boolean;
  function?: string;
  file?: string;
  metric?: string;
  threshold?: string;
  json?: boolean;
  noChangeDetection?: boolean;
  insights?: boolean;
  similarityThreshold?: string;
}

export class DiffCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * diffコマンドは常にBASIC分析が必要：
   * - スナップショット間の関数メトリクス比較のため
   * - 関数の追加・削除・変更の検出のため
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // diffコマンドは常にBASIC分析が必要
    return ['BASIC'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const { from, to, options } = this.parseArguments(subCommand);
    
    // 既存のdiffCommand実装を呼び出し
    const diffFn = diffCommand(from, to)(options);
    await diffFn(env);
  }
  
  /**
   * コマンドライン引数から引数とオプションを解析
   */
  private parseArguments(subCommand: string[]): { from: string; to: string; options: DiffCommandOptions } {
    const options: DiffCommandOptions = {};
    
    // 位置引数 (from, to)
    const positionalArgs = subCommand.filter(arg => !arg.startsWith('--'));
    const from = positionalArgs[0] ?? '';
    const to = positionalArgs[1] ?? '';

    // Boolean flags
    if (subCommand.includes('--summary')) options.summary = true;
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--no-change-detection')) options.noChangeDetection = true;
    if (subCommand.includes('--insights')) options.insights = true;

    // String options with values
    const functionIndex = subCommand.indexOf('--function');
    if (functionIndex >= 0 && functionIndex < subCommand.length - 1) {
      options.function = subCommand[functionIndex + 1] ?? '';
    }

    const fileIndex = subCommand.indexOf('--file');
    if (fileIndex >= 0 && fileIndex < subCommand.length - 1) {
      options.file = subCommand[fileIndex + 1] ?? '';
    }

    const metricIndex = subCommand.indexOf('--metric');
    if (metricIndex >= 0 && metricIndex < subCommand.length - 1) {
      options.metric = subCommand[metricIndex + 1] ?? '';
    }

    const thresholdIndex = subCommand.indexOf('--threshold');
    if (thresholdIndex >= 0 && thresholdIndex < subCommand.length - 1) {
      options.threshold = subCommand[thresholdIndex + 1] ?? '';
    }

    const similarityThresholdIndex = subCommand.indexOf('--similarity-threshold');
    if (similarityThresholdIndex >= 0 && similarityThresholdIndex < subCommand.length - 1) {
      options.similarityThreshold = subCommand[similarityThresholdIndex + 1] ?? '';
    }

    return { from, to, options };
  }
}