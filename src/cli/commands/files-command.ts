/**
 * Files Command - Command Protocol Implementation
 * 
 * ファイル分析コマンドのCommand Protocol対応実装
 */

import { Command, DependencyType } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { FilesCommandOptions } from '../../types';
import { filesCommand } from './files';

export class FilesCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * filesコマンドは常にBASIC分析が必要：
   * - ファイル情報（行数、サイズ、関数数など）を表示するため
   * - 統計情報やソート機能にファイル単位のメトリクスが必要
   */
  async getRequires(_subCommand: string[]): Promise<DependencyType[]> {
    // filesコマンドは常にBASIC分析が必要
    return ['BASIC'];
  }
  
  /**
   * 実際の処理を実行
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    
    // 既存のfilesCommand実装を呼び出し
    const filesFn = filesCommand()(options);
    await filesFn(env);
  }
  
  /**
   * コマンドライン引数からFilesCommandOptionsを解析
   */
  private parseOptions(subCommand: string[]): FilesCommandOptions {
    const options: FilesCommandOptions = {};

    // Boolean flags
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--desc')) options.desc = true;
    if (subCommand.includes('--stats')) options.stats = true;

    // String options with values
    const limitIndex = subCommand.indexOf('--limit');
    if (limitIndex >= 0 && limitIndex < subCommand.length - 1) {
      options.limit = subCommand[limitIndex + 1] ?? '';
    }

    const sortIndex = subCommand.indexOf('--sort');
    if (sortIndex >= 0 && sortIndex < subCommand.length - 1) {
      options.sort = subCommand[sortIndex + 1] ?? '';
    }

    const languageIndex = subCommand.indexOf('--language');
    if (languageIndex >= 0 && languageIndex < subCommand.length - 1) {
      options.language = subCommand[languageIndex + 1] ?? '';
    }

    const pathIndex = subCommand.indexOf('--path');
    if (pathIndex >= 0 && pathIndex < subCommand.length - 1) {
      options.path = subCommand[pathIndex + 1] ?? '';
    }

    const snapshotIndex = subCommand.indexOf('--snapshot');
    if (snapshotIndex >= 0 && snapshotIndex < subCommand.length - 1) {
      options.snapshot = subCommand[snapshotIndex + 1] ?? '';
    }

    return options;
  }
}