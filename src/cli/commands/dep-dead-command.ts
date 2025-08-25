/**
 * DepDead Command - Command Protocol Implementation
 * 
 * Dead code detection command with Command Protocol support
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { depDeadCommand } from '../dep/dead';

// DepDead command specific options type
interface DepDeadCommandOptions {
  format?: 'table' | 'json' | 'dot';
  json?: boolean;
  verbose?: boolean;
  excludeTests?: boolean;
  excludeExports?: boolean;
  excludeSmall?: boolean;
  threshold?: string;
  showReasons?: boolean;
  minConfidence?: string;
  layerEntryPoints?: string;
  snapshot?: string;
}

export class DepDeadCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * dep deadコマンドはCALL_GRAPH分析が必要：
   * - デッドコードの検出には関数の呼び出し関係が必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    return ['BASIC', 'CALL_GRAPH'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のdepDeadCommand実装を呼び出し
    const deadCommandFn = depDeadCommand(options);
    await deadCommandFn(env);
  }
  
  /**
   * コマンドライン引数からDepDeadCommandOptionsを解析
   */
  private parseOptions(subCommand: string[]): DepDeadCommandOptions {
    const options: DepDeadCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--exclude-tests')) options.excludeTests = true;
    if (subCommand.includes('--exclude-exports')) options.excludeExports = true;
    if (subCommand.includes('--exclude-small')) options.excludeSmall = true;
    if (subCommand.includes('--show-reasons')) options.showReasons = true;

    // String options with values
    const formatIndex = subCommand.indexOf('--format');
    if (formatIndex >= 0 && formatIndex < subCommand.length - 1) {
      const formatValue = subCommand[formatIndex + 1];
      if (formatValue === 'table' || formatValue === 'json' || formatValue === 'dot') {
        options.format = formatValue;
      }
    }

    const minConfidenceIndex = subCommand.indexOf('--min-confidence');
    if (minConfidenceIndex >= 0 && minConfidenceIndex < subCommand.length - 1) {
      options.minConfidence = subCommand[minConfidenceIndex + 1] ?? '';
    }

    const layerEntryPointsIndex = subCommand.indexOf('--layer-entry-points');
    if (layerEntryPointsIndex >= 0 && layerEntryPointsIndex < subCommand.length - 1) {
      options.layerEntryPoints = subCommand[layerEntryPointsIndex + 1] ?? '';
    }

    const snapshotIndex = subCommand.indexOf('--snapshot');
    if (snapshotIndex >= 0 && snapshotIndex < subCommand.length - 1) {
      options.snapshot = subCommand[snapshotIndex + 1] ?? '';
    }

    const thresholdIndex = subCommand.indexOf('--threshold');
    if (thresholdIndex >= 0 && thresholdIndex < subCommand.length - 1) {
      options.threshold = subCommand[thresholdIndex + 1] ?? '';
    }

    return options;
  }
}