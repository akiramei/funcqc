/**
 * Similar Command - Command Protocol Implementation
 * 
 * 類似関数検出コマンドのCommand Protocol対応実装
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { similarCommand } from './similar';

// Similar command specific options type
interface SimilarCommandOptions {
  threshold?: string;
  json?: boolean;
  jsonl?: boolean;
  snapshot?: string;
  minLines?: string;
  noCrossFile?: boolean;
  recall?: string;
  detectors?: string;
  consensus?: string;
  output?: string;
  limit?: string;
}

export class SimilarCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * similarコマンドは常にBASIC分析が必要：
   * - 関数のAST構造や行数を比較するため
   * - 類似度計算にメトリクスデータが必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // similarコマンドは常にBASIC分析が必要
    return ['BASIC'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のsimilarCommand実装を呼び出し
    const similarFn = similarCommand(options);
    await similarFn(env);
  }
  
  /**
   * コマンドライン引数からSimilarCommandOptionsを解析
   */
  private parseOptions(subCommand: string[]): SimilarCommandOptions {
    const options: SimilarCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--jsonl')) options.jsonl = true;
    if (subCommand.includes('--no-cross-file')) options.noCrossFile = true;

    // String options with values
    const thresholdIndex = subCommand.indexOf('--threshold');
    if (thresholdIndex >= 0 && thresholdIndex < subCommand.length - 1) {
      options.threshold = subCommand[thresholdIndex + 1] ?? '';
    }

    const snapshotIndex = subCommand.indexOf('--snapshot');
    if (snapshotIndex >= 0 && snapshotIndex < subCommand.length - 1) {
      options.snapshot = subCommand[snapshotIndex + 1] ?? '';
    }

    const minLinesIndex = subCommand.indexOf('--min-lines');
    if (minLinesIndex >= 0 && minLinesIndex < subCommand.length - 1) {
      options.minLines = subCommand[minLinesIndex + 1] ?? '';
    }

    const recallIndex = subCommand.indexOf('--recall');
    if (recallIndex >= 0 && recallIndex < subCommand.length - 1) {
      options.recall = subCommand[recallIndex + 1] ?? '';
    }

    const detectorsIndex = subCommand.indexOf('--detectors');
    if (detectorsIndex >= 0 && detectorsIndex < subCommand.length - 1) {
      options.detectors = subCommand[detectorsIndex + 1] ?? '';
    }

    const consensusIndex = subCommand.indexOf('--consensus');
    if (consensusIndex >= 0 && consensusIndex < subCommand.length - 1) {
      options.consensus = subCommand[consensusIndex + 1] ?? '';
    }

    const outputIndex = subCommand.indexOf('--output');
    if (outputIndex >= 0 && outputIndex < subCommand.length - 1) {
      options.output = subCommand[outputIndex + 1] ?? '';
    }

    const limitIndex = subCommand.indexOf('--limit');
    if (limitIndex >= 0 && limitIndex < subCommand.length - 1) {
      options.limit = subCommand[limitIndex + 1] ?? '';
    }

    return options;
  }
}