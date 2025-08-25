/**
 * DepDelete Command - Command Protocol Implementation
 * 
 * Safe deletion command as dep delete subcommand with Command Protocol support
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { depSafeDeleteCommand } from '../dep/safe-delete';

// DepDelete command specific options type
interface DepDeleteCommandOptions {
  confidenceThreshold?: string;
  maxBatch?: string;
  noTests?: boolean;
  noTypeCheck?: boolean;
  noBackup?: boolean;
  execute?: boolean;
  force?: boolean;
  dryRun?: boolean;
  includeExports?: boolean;
  exclude?: string[];
  format?: 'table' | 'json';
  verbose?: boolean;
  restore?: string;
  excludeTests?: boolean;
  excludeExports?: boolean;
  minConfidence?: string;
  layerEntryPoints?: string;
  snapshot?: string;
}

export class DepDeleteCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * dep deleteコマンドはCALL_GRAPH分析が必要：
   * - デッドコードの検出には関数の呼び出し関係が必要
   * - 安全な削除のためには依存関係の完全な分析が必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // dep deleteコマンドは常にBASIC + CALL_GRAPH分析が必要
    return ['BASIC', 'CALL_GRAPH'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のdepSafeDeleteCommand実装を呼び出し
    const safeDeleteFn = depSafeDeleteCommand(options);
    await safeDeleteFn(env);
  }
  
  /**
   * コマンドライン引数からDepDeleteCommandOptionsを解析
   */
  private parseOptions(subCommand: string[]): DepDeleteCommandOptions {
    const options: DepDeleteCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--no-tests')) options.noTests = true;
    if (subCommand.includes('--no-type-check')) options.noTypeCheck = true;
    if (subCommand.includes('--no-backup')) options.noBackup = true;
    if (subCommand.includes('--execute')) options.execute = true;
    if (subCommand.includes('--force')) options.force = true;
    if (subCommand.includes('--dry-run')) options.dryRun = true;
    if (subCommand.includes('--include-exports')) options.includeExports = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    if (subCommand.includes('--exclude-tests')) options.excludeTests = true;
    if (subCommand.includes('--exclude-exports')) options.excludeExports = true;

    // String options with values
    const confidenceThresholdIndex = subCommand.indexOf('--confidence-threshold');
    if (confidenceThresholdIndex >= 0 && confidenceThresholdIndex < subCommand.length - 1) {
      options.confidenceThreshold = subCommand[confidenceThresholdIndex + 1] ?? '';
    }

    const maxBatchIndex = subCommand.indexOf('--max-batch');
    if (maxBatchIndex >= 0 && maxBatchIndex < subCommand.length - 1) {
      options.maxBatch = subCommand[maxBatchIndex + 1] ?? '';
    }

    const excludeIndex = subCommand.indexOf('--exclude');
    if (excludeIndex >= 0 && excludeIndex < subCommand.length - 1) {
      const excludeValue = subCommand[excludeIndex + 1];
      options.exclude = excludeValue ? excludeValue.split(',') : [];
    }

    const formatIndex = subCommand.indexOf('--format');
    if (formatIndex >= 0 && formatIndex < subCommand.length - 1) {
      const formatValue = subCommand[formatIndex + 1];
      if (formatValue === 'table' || formatValue === 'json') {
        options.format = formatValue;
      }
    }

    const restoreIndex = subCommand.indexOf('--restore');
    if (restoreIndex >= 0 && restoreIndex < subCommand.length - 1) {
      options.restore = subCommand[restoreIndex + 1] ?? '';
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

    return options;
  }
}