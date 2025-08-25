/**
 * 依存関係管理システム
 * 
 * 責務:
 * 1. 現在のDB状態と要求される依存関係を比較
 * 2. 不足している依存関係のみを計算
 * 3. 各依存関係を独立したトランザクションで初期化
 * 4. 部分成功の適切なハンドリング
 */

import { CommandEnvironment } from '../types/environment';
import { BaseCommandOptions } from '../types/command';
import { DependencyType, InitializationResult } from '../types/command-protocol';
import { DEPENDENCY_DEFINITIONS, DependencyOrderResolver } from '../config/dependencies';
import type { AnalysisLevel } from '../types';

interface AnalysisState {
  level: string;
  completedAnalyses: DependencyType[];
  timestamp?: Date;
}

export class DependencyManager {
  /**
   * 要求された依存関係と現在の状態を比較し、不足している依存関係のみを返す
   */
  async calculateMissingDependencies(
    required: DependencyType[],
    env: CommandEnvironment
  ): Promise<DependencyType[]> {
    if (required.length === 0) return [];
    
    // 現在のDB状態を確認
    const currentState = await this.getCurrentAnalysisState(env);
    
    // CRITICAL FIX: SNAPSHOTが要求されている場合、全ての依存関係を無効化
    if (required.includes('SNAPSHOT')) {
      // 新しいスナップショットが作成される場合、全ての分析が無効になる
      // prerequisites関係に関係なく、要求された全ての依存関係が必要
      return required;
    }
    
    // SNAPSHOTが要求されていない場合は、個別に依存関係をチェック
    const missing = required.filter(dep => !this.isDependencyMet(dep, currentState));
    
    return missing;
  }
  
  /**
   * 依存関係を順次初期化し、各々の成功/失敗を独立管理
   */
  async initializeDependencies(
    dependencies: DependencyType[],
    env: CommandEnvironment,
    options: BaseCommandOptions
  ): Promise<InitializationResult> {
    if (dependencies.length === 0) {
      return { successful: [], failed: [], partialSuccess: false };
    }
    
    // 実行順序を決定（優先順位 + 前提条件）
    const orderedDependencies = DependencyOrderResolver.resolveDependencyOrder(dependencies);
    
    const successful: DependencyType[] = [];
    const failed: Array<{ dependency: DependencyType; error: Error }> = [];
    
    if (!options.quiet) {
      console.log(`🔄 Initializing dependencies: [${orderedDependencies.join(', ')}]`);
    }
    
    // 各依存関係を順次、独立して初期化
    for (const dependency of orderedDependencies) {
      try {
        if (!options.quiet) {
          const def = DEPENDENCY_DEFINITIONS[dependency];
          console.log(`⚡ ${def.name}...`);
        }
        
        // 独立トランザクションで実行
        await this.initializeSingleDependency(dependency, env, options);
        
        // 成功を即座にDB確定（トランザクション完了）
        await this.commitDependencyCompletion(dependency, env);
        successful.push(dependency);
        
        if (!options.quiet) {
          console.log(`✅ ${DEPENDENCY_DEFINITIONS[dependency].name} completed`);
        }
        
      } catch (error) {
        // 失敗を記録（他の初期化は継続）
        const initError = error instanceof Error ? error : new Error(String(error));
        failed.push({ dependency, error: initError });
        
        if (!options.quiet) {
          console.log(`❌ ${DEPENDENCY_DEFINITIONS[dependency].name} failed: ${initError.message}`);
        }
        
        // 重要：失敗しても他の初期化は継続する
        continue;
      }
    }
    
    const partialSuccess = successful.length > 0 && failed.length > 0;
    
    if (!options.quiet && partialSuccess) {
      console.log(`⚠️  Partial initialization completed: ${successful.length} successful, ${failed.length} failed`);
    }
    
    return { successful, failed, partialSuccess };
  }
  
  /**
   * 部分成功の場合に実行可能かどうかを判定
   */
  canProceedWithPartialSuccess(
    result: InitializationResult,
    _originalRequired: DependencyType[]
  ): { canProceed: boolean; limitations?: string[] } {
    const { successful, failed } = result;
    
    // 基本ルール：BASICが成功していれば最低限の実行は可能
    if (successful.includes('BASIC')) {
      if (failed.length === 0) {
        return { canProceed: true }; // 全て成功
      }
      
      // 一部失敗の場合の制限事項
      const limitations = failed.map(f => 
        `${DEPENDENCY_DEFINITIONS[f.dependency].name} unavailable`
      );
      
      return { canProceed: true, limitations };
    }
    
    // BASICが失敗している場合は実行不可
    return { canProceed: false };
  }
  
  /**
   * 現在のDB分析状態を取得
   */
  private async getCurrentAnalysisState(env: CommandEnvironment): Promise<AnalysisState> {
    try {
      const snapshot = await env.storage.getLatestSnapshot();
      if (!snapshot) {
        return { level: 'NONE', completedAnalyses: [] };
      }
      
      const metadata = snapshot.metadata as Record<string, unknown>;
      const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
      
      return {
        level: analysisLevel,
        completedAnalyses: this.getCompletedAnalysesFromMetadata(metadata),
        timestamp: new Date(snapshot.createdAt)
      };
    } catch {
      return { level: 'NONE', completedAnalyses: [] };
    }
  }
  
  /**
   * 完了済み分析をメタデータから取得（ハイブリッド判定）
   * 新方式のcompletedAnalysesを優先し、古いanalysisLevelからのフォールバックを提供
   */
  private getCompletedAnalysesFromMetadata(metadata: Record<string, unknown>): DependencyType[] {
    // 新方式: completedAnalysesが存在する場合は優先
    const completedAnalyses = metadata?.['completedAnalyses'] as string[];
    if (completedAnalyses && Array.isArray(completedAnalyses)) {
      return completedAnalyses as DependencyType[];
    }
    
    // 古い方式: analysisLevelから推定（下位互換）
    const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
    return this.getCompletedAnalysesFromLegacyLevel(analysisLevel);
  }

  /**
   * レガシーanalysisLevelから完了済み依存関係を推定
   * 指定レベルまでの全ての依存関係が完了済みと仮定
   * 注意: レガシーデータではSNAPSHOTという概念がないため、BASIC以上があればSNAPSHOTも暗黙的に完了済みとみなす
   */
  private getCompletedAnalysesFromLegacyLevel(level: string): DependencyType[] {
    switch (level) {
      case 'COMPLETE':
        return ['SNAPSHOT', 'BASIC', 'COUPLING', 'CALL_GRAPH', 'TYPE_SYSTEM'];
      case 'TYPE_SYSTEM':
        // TYPE_SYSTEMまで完了している場合、通常はBASIC, CALL_GRAPHも完了済み
        return ['SNAPSHOT', 'BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM'];
      case 'CALL_GRAPH':
        return ['SNAPSHOT', 'BASIC', 'CALL_GRAPH'];
      case 'COUPLING':
        return ['SNAPSHOT', 'BASIC', 'COUPLING'];
      case 'BASIC':
        return ['SNAPSHOT', 'BASIC'];
      default:
        return [];
    }
  }
  
  /**
   * 依存関係が満たされているかチェック
   */
  private isDependencyMet(dependency: DependencyType, state: AnalysisState): boolean {
    // SNAPSHOTは常に新規作成なので、既存状態に関係なく必要
    if (dependency === 'SNAPSHOT') {
      return false;
    }
    return state.completedAnalyses.includes(dependency);
  }
  
  /**
   * 単一の依存関係を独立トランザクションで初期化
   */
  private async initializeSingleDependency(
    dependency: DependencyType,
    env: CommandEnvironment,
    options: BaseCommandOptions
  ): Promise<void> {
    switch (dependency) {
      case 'SNAPSHOT':
        await this.initializeSnapshot(env, options);
        break;
        
      case 'BASIC':
        await this.initializeBasicAnalysis(env, options);
        break;
        
      case 'CALL_GRAPH':
        await this.initializeCallGraphAnalysis(env, options);
        break;
        
      case 'TYPE_SYSTEM':
        await this.initializeTypeSystemAnalysis(env, options);
        break;
        
      case 'COUPLING':
        await this.initializeCouplingAnalysis(env, options);
        break;
        
      default:
        throw new Error(`Unknown dependency type: ${dependency}`);
    }
  }
  
  /**
   * 依存関係完了をDBに確定
   * 新方式: completedAnalyses配列を直接更新し、analysisLevelも互換性のため更新
   */
  private async commitDependencyCompletion(
    dependency: DependencyType,
    env: CommandEnvironment
  ): Promise<void> {
    try {
      const snapshot = await env.storage.getLatestSnapshot();
      if (!snapshot) return;
      
      // 現在の状態を取得
      const currentState = await this.getCurrentAnalysisState(env);
      const newCompleted = [...new Set([...currentState.completedAnalyses, dependency])];
      
      // 新しいレベルを計算
      const newLevel = this.calculateAnalysisLevel(newCompleted);
      
      // 直接 updateAnalysisLevel を使用し、その後 completedAnalyses を個別に更新
      await env.storage.updateAnalysisLevel(snapshot.id, newLevel as AnalysisLevel);
      
      // 新方式の completedAnalyses 配列をメタデータに追加で更新
      await this.updateCompletedAnalysesMetadata(snapshot.id, newCompleted, env);
    } catch (error) {
      // ログに記録するが、初期化処理は成功扱い
      console.warn(`Warning: Failed to update analysis completion for ${dependency}:`, error);
    }
  }
  
  /**
   * completedAnalyses配列をメタデータに更新
   * updateAnalysisLevelと同様の直接SQL更新アプローチを使用
   */
  private async updateCompletedAnalysesMetadata(
    snapshotId: string,
    completedAnalyses: DependencyType[],
    env: CommandEnvironment
  ): Promise<void> {
    try {
      // 既存のスナップショット取得（最新のメタデータを取得）
      const snapshot = await env.storage.getSnapshot(snapshotId);
      if (!snapshot) return;
      
      // 現在のメタデータを取得
      const currentMetadata = (snapshot.metadata as Record<string, unknown>) || {};
      
      // completedAnalyses配列を追加・更新
      const updatedMetadata = {
        ...currentMetadata,
        completedAnalyses: completedAnalyses
      };
      
      // 低レベルのSQLクエリで直接更新（updateAnalysisLevelと同じパターン）
      // この実装は storage adapter の内部実装に依存するため、将来的には
      // storage interface に updateSnapshotMetadata メソッドを追加することが理想
      if ('query' in env.storage && typeof env.storage.query === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (env.storage as any).query(
          'UPDATE snapshots SET metadata = $1 WHERE id = $2',
          [JSON.stringify(updatedMetadata), snapshotId]
        );
      }
    } catch (error) {
      // 失敗してもプロセスは継続（ログのみ）
      console.warn(`Warning: Failed to update completedAnalyses metadata:`, error);
    }
  }
  
  /**
   * 完了済み依存関係から適切な分析レベルを計算
   * 注意: SNAPSHOTは分析レベルではないため、計算から除外
   */
  private calculateAnalysisLevel(completed: DependencyType[]): AnalysisLevel {
    // SNAPSHOT は分析レベルの計算から除外
    const analysisTypes = completed.filter(dep => dep !== 'SNAPSHOT');
    
    if (analysisTypes.includes('BASIC') && analysisTypes.includes('CALL_GRAPH') && 
        analysisTypes.includes('TYPE_SYSTEM') && analysisTypes.includes('COUPLING')) {
      return 'COMPLETE';
    }
    
    if (analysisTypes.includes('TYPE_SYSTEM')) {
      return 'TYPE_SYSTEM';
    }
    
    if (analysisTypes.includes('CALL_GRAPH')) {
      return 'CALL_GRAPH';
    }
    
    if (analysisTypes.includes('COUPLING')) {
      return 'COUPLING';
    }
    
    if (analysisTypes.includes('BASIC')) {
      return 'BASIC';
    }
    
    return 'NONE';
  }
  
  // === 個別初期化メソッド（既存実装を活用） ===
  
  /**
   * 既存スナップショットを取得（作成は行わない）
   * BASIC等の分析系依存関係で使用
   */
  private async ensureSnapshot(env: CommandEnvironment, _options: BaseCommandOptions): Promise<string> {
    const snapshot = await env.storage.getLatestSnapshot();
    
    if (!snapshot) {
      throw new Error('No snapshot found. A SNAPSHOT dependency must be initialized first.');
    }
    
    return snapshot.id;
  }
  
  /**
   * 新規スナップショットを強制作成
   * SNAPSHOT依存関係で使用
   */
  private async initializeSnapshot(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    if (!options.quiet) {
      env.commandLogger.info('📸 Creating new snapshot...');
    }
    
    try {
      await this.createInitialSnapshot(env, options);
    } catch (e) {
      throw new Error(`Failed to create new snapshot: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    const snapshot = await env.storage.getLatestSnapshot();
    if (!snapshot) {
      throw new Error('Failed to create initial snapshot');
    }
    
    if (!options.quiet) {
      env.commandLogger.info(`📸 New snapshot created: ${snapshot.id.substring(0, 8)}`);
    }
  }
  
  /**
   * 初期スナップショットを作成
   * 他の依存関係初期化メソッドと同じパターンで実装
   * scan.tsから必要最小限の機能のみを使用
   */
  private async createInitialSnapshot(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    if (!options.quiet) {
      env.commandLogger.info('📸 Creating initial snapshot...');
    }

    try {
      // 1. ファイル発見とソースファイル収集（scan.tsから抽出）
      const { determineScanPaths, discoverFiles, collectSourceFiles, saveSourceFiles } = await this.importSnapshotUtils();
      
      const scanPaths = await determineScanPaths(env.config as unknown as Record<string, unknown>, undefined);
      const files = await discoverFiles(scanPaths, env.config as unknown as Record<string, unknown>);
      
      if (files.length === 0) {
        throw new Error('No TypeScript files found for snapshot creation');
      }

      const sourceFiles = await collectSourceFiles(files);

      // 2. コンフィグハッシュ生成
      const configHash = await this.generateConfigHash(env);

      // 3. スナップショット保存
      await saveSourceFiles(sourceFiles, env.storage, {
        comment: 'Initial snapshot created by dependency manager',
        scope: 'src',
        configHash,
      });

      if (!options.quiet) {
        env.commandLogger.info(`✓ Initial snapshot created (${files.length} files processed)`);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create initial snapshot: ${message}`);
    }
  }

  /**
   * スナップショット作成に必要な関数をscan.tsから動的インポート
   */
  private async importSnapshotUtils() {
    const { globby } = await import('globby');
    const crypto = await import('crypto');
    const fs = await import('fs/promises');
    const path = await import('path');

    // scan.tsから必要な関数を抽出（簡略版）
    const determineScanPaths = async (config: Record<string, unknown>, scopeName?: string): Promise<string[]> => {
      const { ConfigManager } = await import('./config');
      const configManager = new ConfigManager();
      await configManager.load();
      
      const actualScopeName = scopeName || config['defaultScope'] || 'src';
      
      if (config['scopes'] && (config['scopes'] as Record<string, unknown>)[actualScopeName as string]) {
        const scope = (config['scopes'] as Record<string, unknown>)[actualScopeName as string];
        return ((scope as Record<string, unknown>)['include'] as string[]) || ['src/**/*.ts', 'src/**/*.tsx'];
      }
      
      return ['src/**/*.ts', 'src/**/*.tsx'];
    };

    const discoverFiles = async (scanPaths: string[], config: Record<string, unknown>): Promise<string[]> => {
      const globOptions = {
        ignore: config['exclude'] as string[] || ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
        absolute: true,
        onlyFiles: true,
      };

      return await globby(scanPaths, globOptions);
    };

    const collectSourceFiles = async (files: string[]): Promise<Array<Record<string, unknown>>> => {
      const sourceFiles: Array<Record<string, unknown>> = [];
      const exportRegex = /^export\s+/gm;
      const importRegex = /^import\s+/gm;
      
      for (const filePath of files) {
        try {
          const [fileContent, fileStats] = await Promise.all([
            fs.readFile(filePath, 'utf-8'),
            fs.stat(filePath)
          ]);
          
          const relativePath = path.relative(process.cwd(), filePath);
          const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');
          const fileSizeBytes = Buffer.byteLength(fileContent, 'utf-8');
          const lineCount = fileContent.split('\n').length;
          const language = path.extname(filePath).slice(1) || 'typescript';
          const exportCount = (fileContent.match(exportRegex) || []).length;
          const importCount = (fileContent.match(importRegex) || []).length;
          
          sourceFiles.push({
            id: '', // 後で設定される
            snapshotId: '', // 後で設定される
            filePath: relativePath,
            fileContent: fileContent,
            fileHash: fileHash,
            encoding: 'utf-8',
            fileSizeBytes: fileSizeBytes,
            lineCount: lineCount,
            language: language,
            functionCount: 0, // 後で分析時に設定
            exportCount: exportCount,
            importCount: importCount,
            fileModifiedTime: fileStats.mtime,
            createdAt: new Date(),
          });
        } catch (error) {
          console.warn(`Warning: Failed to process ${filePath}: ${error}`);
        }
      }
      
      return sourceFiles;
    };

    const saveSourceFiles = async (sourceFiles: Array<Record<string, unknown>>, storage: unknown, options: Record<string, unknown>): Promise<string> => {
      const createSnapshotOptions = {
        comment: options['comment'] || 'Initial snapshot created by dependency manager',
        analysisLevel: 'NONE',
        scope: options['scope'] || 'src',
        configHash: options['configHash'],
      };
      
      const snapshotId = await ((storage as Record<string, unknown>)['createSnapshot'] as (...args: unknown[]) => Promise<string>)(createSnapshotOptions);
      
      // snapshotIdを設定
      const fullSourceFiles = sourceFiles.map(file => ({
        ...file,
        snapshotId: snapshotId,
      }));
      
      await ((storage as Record<string, unknown>)['saveSourceFiles'] as (...args: unknown[]) => Promise<void>)(fullSourceFiles, snapshotId);
      return snapshotId;
    };

    return { determineScanPaths, discoverFiles, collectSourceFiles, saveSourceFiles };
  }

  /**
   * コンフィグハッシュ生成
   */
  private async generateConfigHash(env: CommandEnvironment): Promise<string> {
    const crypto = await import('crypto');
    const configString = JSON.stringify(env.config);
    return crypto.createHash('sha256').update(configString).digest('hex').slice(0, 16);
  }
  
  private async initializeBasicAnalysis(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    const snapshotId = await this.ensureSnapshot(env, options);
    
    // 既存の関数をチェックして重複実行を防ぐ
    const existingFunctions = await env.storage.findFunctionsInSnapshot(snapshotId);
    if (existingFunctions.length > 0) {
      if (!options.quiet) {
        env.commandLogger.info(`📋 BASIC analysis already completed (${existingFunctions.length} functions found)`);
      }
      // 分析レベルを確認・更新
      await this.ensureAnalysisLevelUpdated(snapshotId, 'BASIC', env);
      return;
    }
    
    const { performDeferredBasicAnalysis } = await import('../cli/commands/scan');
    await performDeferredBasicAnalysis(snapshotId, env, true);
  }
  
  /**
   * AnalysisLevel の序数ランク（dependency-manager内で統一）
   */
  private readonly analysisLevelRank: Record<AnalysisLevel, number> = {
    NONE: 0,
    BASIC: 1,
    COUPLING: 2,
    CALL_GRAPH: 3,
    TYPE_SYSTEM: 4,
    COMPLETE: 5,
  };

  /**
   * 分析レベルが正しく設定されているかチェックし、必要に応じて更新
   */
  private async ensureAnalysisLevelUpdated(
    snapshotId: string,
    expectedLevel: AnalysisLevel,
    env: CommandEnvironment,
  ): Promise<void> {
    try {
      const snapshot = await env.storage.getSnapshot(snapshotId);
      if (!snapshot) return;
      
      const metadata = snapshot.metadata as Record<string, unknown>;
      const currentLevel = (metadata?.['analysisLevel'] as AnalysisLevel) ?? 'NONE';
      
      const currentRank = this.analysisLevelRank[currentLevel] ?? 0;
      const expectedRank = this.analysisLevelRank[expectedLevel];
      
      if (currentRank < expectedRank) {
        await env.storage.updateAnalysisLevel(snapshotId, expectedLevel);
      }
    } catch (error) {
      env.commandLogger.warn(`Warning: Failed to update analysis level: ${error}`);
    }
  }
  
  private async initializeCallGraphAnalysis(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    const snapshotId = await this.ensureSnapshot(env, options);
    const state = await this.getCurrentAnalysisState(env);
    const currentRank = this.analysisLevelRank[(state.level as AnalysisLevel)] ?? 0;
    if (currentRank >= this.analysisLevelRank['CALL_GRAPH']) {
      if (!options.quiet) {
        env.commandLogger.info('⏭️  CALL_GRAPH analysis already completed - skipping duplicate analysis');
      }
      return;
    }
    const { performCallGraphAnalysis } = await import('../cli/commands/scan');
    await performCallGraphAnalysis(snapshotId, env, undefined);
  }
  
  private async initializeTypeSystemAnalysis(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    const snapshotId = await this.ensureSnapshot(env, options);
    const state = await this.getCurrentAnalysisState(env);
    const currentRank = this.analysisLevelRank[(state.level as AnalysisLevel)] ?? 0;
    if (currentRank >= this.analysisLevelRank['TYPE_SYSTEM']) {
      if (!options.quiet) {
        env.commandLogger.info('⏭️  TYPE_SYSTEM analysis already completed - skipping duplicate analysis');
      }
      return;
    }
    const { performDeferredTypeSystemAnalysis } = await import('../cli/commands/scan');
    await performDeferredTypeSystemAnalysis(snapshotId, env, true);
  }
  
  private async initializeCouplingAnalysis(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    const snapshotId = await this.ensureSnapshot(env, options);
    const state = await this.getCurrentAnalysisState(env);
    const currentRank = this.analysisLevelRank[(state.level as AnalysisLevel)] ?? 0;
    if (currentRank >= this.analysisLevelRank['COUPLING']) {
      if (!options.quiet) {
        env.commandLogger.info('⏭️  COUPLING analysis already completed - skipping duplicate analysis');
      }
      return;
    }
    const { performDeferredCouplingAnalysis } = await import('../cli/commands/scan');
    await performDeferredCouplingAnalysis(snapshotId, env, undefined);
  }
}