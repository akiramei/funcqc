/**
 * Measure Command - Command Protocol準拠版
 * 
 * 新しい設計に基づくmeasureコマンドの実装
 * 自分の依存関係を明確に申告し、cli-wrapperに依存せず動作する
 */

import { Command, DependencyType, DependencyViolationError } from '../../types/command-protocol';
import { CommandEnvironment } from '../../types/environment';
import { MeasureCommandOptions, SnapshotInfo } from '../../types';
import { createErrorHandler, ErrorCode, DatabaseErrorLike } from '../../utils/error-handler';
import chalk from 'chalk';
import { formatRelativeDate, formatDiffValue, formatSizeDisplay } from './history';

export class UnifiedMeasureCommand implements Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   */
  async getRequires(subCommand: string[]): Promise<DependencyType[]> {
    // --history オプションの場合：依存関係なし
    if (subCommand.includes('--history')) {
      return [];
    }
    
    // --full オプションの場合：全ての依存関係
    if (subCommand.includes('--full')) {
      return ['BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM', 'COUPLING'];
    }
    
    // --level オプションの処理
    const levelIndex = subCommand.indexOf('--level');
    if (levelIndex >= 0 && levelIndex < subCommand.length - 1) {
      const level = subCommand[levelIndex + 1];
      return this.getLevelDependencies(level);
    }
    
    // 個別オプションの確認
    const dependencies: DependencyType[] = ['BASIC']; // デフォルトでBASICは必要
    
    if (subCommand.includes('--call-graph') || subCommand.includes('--with-graph')) {
      dependencies.push('CALL_GRAPH');
    }
    
    if (subCommand.includes('--types') || subCommand.includes('--with-types')) {
      dependencies.push('TYPE_SYSTEM');
    }
    
    if (subCommand.includes('--coupling') || subCommand.includes('--with-coupling')) {
      dependencies.push('COUPLING');
    }
    
    // オプションが何もない場合は軽量モード（依存関係なし）
    if (subCommand.length === 0 || 
        (subCommand.length === 1 && (subCommand.includes('--json') || subCommand.includes('--quiet') || subCommand.includes('--verbose')))) {
      return [];
    }
    
    return [...new Set(dependencies)];
  }
  
  /**
   * レベルに基づく依存関係を取得
   */
  private getLevelDependencies(level: string): DependencyType[] {
    switch (level) {
      case 'quick':
        return []; // 軽量モード
      case 'basic':
        return ['BASIC'];
      case 'standard':
        return ['BASIC', 'CALL_GRAPH'];
      case 'deep':
        return ['BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM', 'COUPLING'];
      case 'complete':
        return ['BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM', 'COUPLING'];
      default:
        return ['BASIC']; // デフォルト
    }
  }
  
  /**
   * 実際の処理を実行
   * 
   * 前提条件: getRequires()で返した依存関係は全て初期化済み
   */
  async perform(env: CommandEnvironment, subCommand: string[]): Promise<void> {
    const options = this.parseOptions(subCommand);
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      // 履歴表示モード
      if (options.history) {
        await this.displaySnapshotHistory(env, options);
        return;
      }
      
      // 測定モード
      await this.executeMeasurement(env, options);
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        const dbErr = error as DatabaseErrorLike;
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          dbErr.message,
          { dbCode: dbErr.code },
          dbErr.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to execute measurement: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  }
  
  /**
   * コマンドライン引数からオプションを解析
   */
  private parseOptions(subCommand: string[]): MeasureCommandOptions {
    const options: MeasureCommandOptions = {};
    
    // フラグ系オプション
    if (subCommand.includes('--history')) options.history = true;
    if (subCommand.includes('--full')) options.full = true;
    if (subCommand.includes('--force')) options.force = true;
    if (subCommand.includes('--json')) options.json = true;
    if (subCommand.includes('--quiet')) options.quiet = true;
    if (subCommand.includes('--verbose')) options.verbose = true;
    
    // 値を持つオプション
    const levelIndex = subCommand.indexOf('--level');
    if (levelIndex >= 0 && levelIndex < subCommand.length - 1) {
      options.level = subCommand[levelIndex + 1] as any;
    }
    
    const labelIndex = subCommand.indexOf('--label');
    if (labelIndex >= 0 && labelIndex < subCommand.length - 1) {
      options.label = subCommand[labelIndex + 1];
    }
    
    const commentIndex = subCommand.indexOf('--comment');
    if (commentIndex >= 0 && commentIndex < subCommand.length - 1) {
      options.comment = subCommand[commentIndex + 1];
    }
    
    return options;
  }
  
  /**
   * 測定処理を実行
   */
  private async executeMeasurement(env: CommandEnvironment, options: MeasureCommandOptions): Promise<void> {
    if (!options.quiet) {
      env.commandLogger.info('📊 Starting measurement...');
    }
    
    // この時点で必要な依存関係は全て初期化済みのはず
    // 依存関係が満たされていない場合はcli-wrapper側の責務違反
    
    const snapshot = await env.storage.getLatestSnapshot();
    if (!snapshot) {
      throw new DependencyViolationError(
        'measure',
        'BASIC',
        'No snapshot found - basic analysis should have been initialized'
      );
    }
    
    // 測定結果の表示
    if (options.json) {
      await this.outputMeasurementResults(env, options);
    } else if (!options.quiet) {
      await this.displayMeasurementSummary(env, options);
    }
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Measurement completed successfully!');
    }
  }
  
  /**
   * スナップショット履歴表示
   */
  private async displaySnapshotHistory(env: CommandEnvironment, options: MeasureCommandOptions): Promise<void> {
    const limit = 20; // デフォルト制限
    
    const snapshots = await env.storage.getSnapshots({ limit });
    
    if (snapshots.length === 0) {
      console.log('📈 No snapshots found. Run `funcqc measure` to create your first snapshot.');
      return;
    }
    
    if (options.json) {
      this.displaySnapshotHistoryJSON(snapshots);
      return;
    }
    
    console.log(chalk.cyan.bold(`\n📈 Snapshot History (${snapshots.length} snapshots)\n`));
    this.displayCompactHistory(snapshots);
  }
  
  /**
   * JSON形式での履歴表示
   */
  private displaySnapshotHistoryJSON(snapshots: SnapshotInfo[]): void {
    const output = {
      snapshots: snapshots.map(snapshot => ({
        id: snapshot.id,
        label: snapshot.label || null,
        comment: snapshot.comment || null,
        scope: snapshot.scope || 'src',
        createdAt: new Date(snapshot.createdAt).toISOString(),
        gitBranch: snapshot.gitBranch || null,
        gitCommit: snapshot.gitCommit || null,
        metadata: {
          totalFunctions: snapshot.metadata.totalFunctions,
          totalFiles: snapshot.metadata.totalFiles,
          avgComplexity: snapshot.metadata.avgComplexity,
          maxComplexity: snapshot.metadata.maxComplexity
        }
      })),
      summary: {
        totalSnapshots: snapshots.length
      }
    };
    
    console.log(JSON.stringify(output, null, 2));
  }
  
  /**
   * コンパクトな履歴テーブル表示
   */
  private displayCompactHistory(snapshots: SnapshotInfo[]): void {
    // ヘッダー表示
    console.log(
      'ID       Created       Scope Label               Functions +/-      Files +/-    Size'
    );
    console.log(
      '-------- ------------- ----- ------------------- --------- -------- ----- ------ ----------'
    );
    
    // 各スナップショット表示
    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i];
      const prevSnapshot = this.findPreviousSnapshotWithSameScope(snapshots, i);
      
      const id = snapshot.id.substring(0, 8);
      const created = formatRelativeDate(snapshot.createdAt).padEnd(13);
      const scope = (snapshot.scope || 'src').padEnd(5);
      const label = this.truncateWithEllipsis(snapshot.label || '', 19).padEnd(19);
      
      // 関数数の差分
      const currentFunctions = snapshot.metadata.totalFunctions ?? 0;
      const prevFunctions = prevSnapshot?.metadata.totalFunctions ?? 0;
      const functionDiff = prevSnapshot ? currentFunctions - prevFunctions : 0;
      const functionsDisplay = currentFunctions.toString().padStart(9);
      const functionsDiffDisplay = formatDiffValue(functionDiff, 8);
      
      // ファイル数の差分
      const currentFiles = snapshot.metadata.totalFiles ?? 0;
      const prevFiles = prevSnapshot?.metadata.totalFiles ?? 0;
      const filesDiff = prevSnapshot ? currentFiles - prevFiles : 0;
      const filesDisplay = currentFiles.toString().padStart(5);
      const filesDiffDisplay = formatDiffValue(filesDiff, 6);
      
      // サイズ表示
      const sizeDisplay = formatSizeDisplay(snapshot.metadata);
      
      console.log(
        `${id} ${created} ${scope} ${label} ${functionsDisplay} ${functionsDiffDisplay} ${filesDisplay} ${filesDiffDisplay} ${sizeDisplay}`
      );
    }
  }
  
  /**
   * 文字列を省略形式で切り詰め
   */
  private truncateWithEllipsis(str: string, maxLength: number): string {
    if (!str || str.length <= maxLength) {
      return str;
    }
    return str.substring(0, maxLength - 3) + '...';
  }
  
  /**
   * 同じスコープの前のスナップショットを検索
   */
  private findPreviousSnapshotWithSameScope(snapshots: SnapshotInfo[], currentIndex: number): SnapshotInfo | null {
    const currentSnapshot = snapshots[currentIndex];
    const currentScope = currentSnapshot.scope || 'src';
    
    for (let i = currentIndex + 1; i < snapshots.length; i++) {
      const candidateSnapshot = snapshots[i];
      const candidateScope = candidateSnapshot.scope || 'src';
      
      if (candidateScope === currentScope) {
        return candidateSnapshot;
      }
    }
    
    return null;
  }
  
  /**
   * JSON形式での測定結果出力
   */
  private async outputMeasurementResults(env: CommandEnvironment, options: MeasureCommandOptions): Promise<void> {
    const snapshot = await env.storage.getLatestSnapshot();
    const results = {
      measurement: {
        timestamp: new Date().toISOString(),
        level: options.level || 'custom',
        scope: options.scope || 'all',
        snapshotId: snapshot?.id,
        analysisLevel: snapshot?.metadata.analysisLevel
      },
      // 実際のメトリクスデータを含める
      metrics: snapshot ? {
        totalFunctions: snapshot.metadata.totalFunctions,
        totalFiles: snapshot.metadata.totalFiles,
        avgComplexity: snapshot.metadata.avgComplexity,
        maxComplexity: snapshot.metadata.maxComplexity
      } : null
    };
    
    console.log(JSON.stringify(results, null, 2));
  }
  
  /**
   * 人間可読形式での測定結果表示
   */
  private async displayMeasurementSummary(env: CommandEnvironment, options: MeasureCommandOptions): Promise<void> {
    const snapshot = await env.storage.getLatestSnapshot();
    
    console.log();
    console.log('📊 Measurement Summary');
    console.log('--------------------------------------------------');
    console.log(`🎯 Level: ${options.level || 'custom'}`);
    console.log(`📦 Scope: ${options.scope || 'all'}`);
    
    if (snapshot) {
      console.log(`📸 Snapshot: ${snapshot.id.substring(0, 8)}`);
      console.log(`📊 Analysis Level: ${snapshot.metadata.analysisLevel || 'BASIC'}`);
      console.log();
      
      console.log('📈 Results:');
      console.log(`   • Functions analyzed: ${snapshot.metadata.totalFunctions || 0}`);
      console.log(`   • Files processed: ${snapshot.metadata.totalFiles || 0}`);
      console.log(`   • Average complexity: ${(snapshot.metadata.avgComplexity || 0).toFixed(1)}`);
      console.log(`   • Maximum complexity: ${snapshot.metadata.maxComplexity || 0}`);
    }
    
    console.log();
    console.log('💡 Next steps:');
    console.log('   • Run `funcqc inspect` to explore results');
    console.log('   • Run `funcqc assess` for quality analysis');
    console.log('   • Run `funcqc inspect --cc-ge 10` for complex functions');
  }
}