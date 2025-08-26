/**
 * Scan Command - Command Protocol Implementation
 * 
 * 関数分析・スキャンコマンドのCommand Protocol対応実装
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { scanCommand } from './scan';

// Scan command specific options type
interface ScanCommandOptions {
  label?: string;
  comment?: string;
  scope?: string;
  realtimeGate?: boolean;
  json?: boolean;
  withBasic?: boolean;
  withCoupling?: boolean;
  withGraph?: boolean;
  withTypes?: boolean;
  full?: boolean;
  quick?: boolean;
  async?: boolean;
}

export class ScanCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * scanコマンドは常に新しいスナップショット作成が目的なので、
   * 既存分析に依存せず、オプション指定時のみ分析を実行：
   * - --full, --with-types: BASIC + COUPLING + CALL_GRAPH + TYPE_SYSTEM
   * - --with-graph: BASIC + COUPLING + CALL_GRAPH  
   * - --with-basic: BASIC のみ
   * - --with-coupling: BASIC + COUPLING
   * - デフォルト: 依存関係なし（新しいスナップショットのみ作成）
   */
  async getRequires(subCommand: string[]): Promise<DependencyType[]> {
    // --full または --with-types が指定された場合
    if (subCommand.includes('--full') || subCommand.includes('--with-types')) {
      return ['SNAPSHOT', 'BASIC', 'COUPLING', 'CALL_GRAPH', 'TYPE_SYSTEM'];
    }
    
    // --with-graph が指定された場合
    if (subCommand.includes('--with-graph')) {
      return ['SNAPSHOT', 'BASIC', 'COUPLING', 'CALL_GRAPH'];
    }
    
    // --with-basic が指定された場合
    if (subCommand.includes('--with-basic')) {
      return ['SNAPSHOT', 'BASIC'];
    }
    
    // --with-coupling が指定された場合
    if (subCommand.includes('--with-coupling')) {
      return ['SNAPSHOT', 'BASIC', 'COUPLING'];
    }
    
    // デフォルト: 新しいスナップショット作成 + BASIC分析
    return ['SNAPSHOT', 'BASIC'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のscanCommand実装を呼び出し
    const scanFn = scanCommand(options);
    await scanFn(env);
  }
  
  /**
   * コマンドライン引数からScanCommandOptionsを解析
   */
  private parseOptions(subCommand: string[]): ScanCommandOptions {
    const options: ScanCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--realtime-gate')) options.realtimeGate = true;
    if (subCommand.includes('--json') || subCommand.includes('-j')) options.json = true;
    if (subCommand.includes('--with-basic')) options.withBasic = true;
    if (subCommand.includes('--with-coupling')) options.withCoupling = true;
    if (subCommand.includes('--with-graph')) options.withGraph = true;
    if (subCommand.includes('--with-types')) options.withTypes = true;
    if (subCommand.includes('--full')) options.full = true;
    if (subCommand.includes('--quick')) options.quick = true;
    if (subCommand.includes('--async')) options.async = true;

    // String options with values
    const labelIndex = subCommand.indexOf('--label');
    if (labelIndex >= 0 && labelIndex < subCommand.length - 1) {
      options.label = subCommand[labelIndex + 1] ?? '';
    }

    const commentIndex = subCommand.indexOf('--comment');
    if (commentIndex >= 0 && commentIndex < subCommand.length - 1) {
      options.comment = subCommand[commentIndex + 1] ?? '';
    }

    const scopeIndex = subCommand.indexOf('--scope');
    if (scopeIndex >= 0 && scopeIndex < subCommand.length - 1) {
      options.scope = subCommand[scopeIndex + 1] ?? '';
    }

    return options;
  }
}