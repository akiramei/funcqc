/**
 * SafeDelete Command - Command Protocol Implementation
 * 
 * 安全削除コマンドのCommand Protocol対応実装
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { safeDeleteCommand } from './safe-delete';

// SafeDelete command specific options type
interface SafeDeleteCommandOptions {
  confidenceThreshold?: string;
  maxBatch?: string;
  noTests?: boolean;
  noTypeCheck?: boolean;
  noBackup?: boolean;
  execute?: boolean;
  force?: boolean;
  dryRun?: boolean;
  includeExports?: boolean;
  exclude?: string;
  format?: string;
  verbose?: boolean;
  restore?: string;
}

export class SafeDeleteCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * safe-deleteコマンドはBASIC + CALL_GRAPH分析が必要：
   * - デッドコードの検出には関数の呼び出し関係が必要
   * - 安全な削除のためには依存関係の完全な分析が必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // safe-deleteコマンドは常にBASIC + CALL_GRAPH分析が必要
    return ['BASIC', 'CALL_GRAPH'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のsafeDeleteCommand実装を呼び出し
    const safeDeleteFn = safeDeleteCommand(options);
    await safeDeleteFn(env);
  }
  
  /**
   * コマンドライン引数からSafeDeleteCommandOptionsを解析
   */
  private parseOptions(subCommand: string[]): SafeDeleteCommandOptions {
    const options: SafeDeleteCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--no-tests')) options.noTests = true;
    if (subCommand.includes('--no-type-check')) options.noTypeCheck = true;
    if (subCommand.includes('--no-backup')) options.noBackup = true;
    if (subCommand.includes('--execute')) options.execute = true;
    if (subCommand.includes('--force')) options.force = true;
    if (subCommand.includes('--dry-run')) options.dryRun = true;
    if (subCommand.includes('--include-exports')) options.includeExports = true;
    if (subCommand.includes('--verbose')) options.verbose = true;

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
      options.exclude = subCommand[excludeIndex + 1] ?? '';
    }

    const formatIndex = subCommand.indexOf('--format');
    if (formatIndex >= 0 && formatIndex < subCommand.length - 1) {
      options.format = subCommand[formatIndex + 1] ?? '';
    }

    const restoreIndex = subCommand.indexOf('--restore');
    if (restoreIndex >= 0 && restoreIndex < subCommand.length - 1) {
      options.restore = subCommand[restoreIndex + 1] ?? '';
    }

    return options;
  }
}