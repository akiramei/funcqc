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
import { DEPENDENCY_DEFINITIONS } from '../config/dependencies';
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
    
    // CRITICAL FIX: SNAPSHOTが要求されている場合、既存状態をチェックせずに全て実行
    if (required.includes('SNAPSHOT')) {
      // 新しいスナップショットが作成される場合、全ての分析が無効になる
      // 既存スナップショットの読み込みは不要
      return required;
    }
    
    // 現在のDB状態を確認（SNAPSHOTが不要な場合のみ）
    const currentState = await this.getCurrentAnalysisState(env);
    
    // 個別に依存関係をチェック
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
    
    // 実行順序を決定（優先順位のみ、前提条件は既にcalculateMissingDependenciesで処理済み）
    const orderedDependencies = dependencies.sort((a, b) => 
      DEPENDENCY_DEFINITIONS[a].priority - DEPENDENCY_DEFINITIONS[b].priority
    );
    
    const successful: DependencyType[] = [];
    const failed: Array<{ dependency: DependencyType; error: Error }> = [];
    
    if (!options.quiet && options.verbose) {
      env.commandLogger?.info?.(`🔄 Initializing dependencies: [${orderedDependencies.join(', ')}]`);
    }
    
    // 各依存関係を順次、独立して初期化
    for (const dependency of orderedDependencies) {
      try {
        if (!options.quiet && options.verbose) {
          const def = DEPENDENCY_DEFINITIONS[dependency];
          env.commandLogger?.info?.(`⚡ ${def.name}...`);
        }
        
        // 独立トランザクションで実行
        await this.initializeSingleDependency(dependency, env, options);
        
        // 成功を即座にDB確定（トランザクション完了）
        await this.commitDependencyCompletion(dependency, env);
        successful.push(dependency);
        
        if (!options.quiet && options.verbose) {
          env.commandLogger?.info?.(`✅ ${DEPENDENCY_DEFINITIONS[dependency].name} completed`);
        }
        
      } catch (error) {
        // 失敗を記録（他の初期化は継続）
        const initError = error instanceof Error ? error : new Error(String(error));
        failed.push({ dependency, error: initError });
        
        if (!options.quiet) {
          env.commandLogger?.error?.(`❌ ${DEPENDENCY_DEFINITIONS[dependency].name} failed: ${initError.message}`);
        }
        
        // 重要：失敗しても他の初期化は継続する
        continue;
      }
    }
    
    const partialSuccess = successful.length > 0 && failed.length > 0;
    
    if (!options.quiet && partialSuccess) {
      env.commandLogger?.warn?.(`⚠️  Partial initialization completed: ${successful.length} successful, ${failed.length} failed`);
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
      const completedAnalyses = this.getCompletedAnalysesFromMetadata(metadata);
      
      
      return {
        level: analysisLevel,
        completedAnalyses,
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
    const snapshot = await env.storage.getLatestSnapshot();
    if (!snapshot) return;
    const targetSnapshotId = snapshot.id;
    
    // 現在の状態を取得（rollback用に事前取得）
    const currentState = await this.getCurrentAnalysisState(env);
    const prevLevel = (currentState.level as AnalysisLevel) ?? 'NONE';
    
    try {
      const newCompleted = [...new Set([...currentState.completedAnalyses, dependency])];
      
      // 新しいレベルを計算
      const newLevel = this.calculateAnalysisLevel(newCompleted);
      
      // 直接 updateAnalysisLevel を使用し、その後 completedAnalyses を個別に更新
      await env.storage.updateAnalysisLevel(targetSnapshotId, newLevel as AnalysisLevel);
      
      // 新方式の completedAnalyses 配列をメタデータに追加で更新
      await this.updateCompletedAnalysesMetadata(targetSnapshotId, newCompleted, env);
      
      env.commandLogger?.debug?.(
        `Successfully recorded completion of ${dependency}, current completed: [${newCompleted.join(', ')}]`
      );
    } catch (error) {
      // メタデータ更新の失敗は重大な問題として扱う
      env.commandLogger?.error?.(
        `CRITICAL: Failed to record analysis completion for ${dependency}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // ベストエフォートのロールバックで不整合を緩和
      try {
        await env.storage.updateAnalysisLevel(targetSnapshotId, prevLevel);
      } catch (rollbackErr) {
        env.commandLogger?.warn?.(
          `Rollback of analysisLevel failed: ${
            rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
          }`
        );
      }
      throw error; // 失敗を呼び出し元に伝播
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
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found for metadata update`);
      }
      
      // 現在のメタデータを取得
      const currentMetadata = (snapshot.metadata as Record<string, unknown>) || {};
      
      // completedAnalyses配列を追加・更新
      const updatedMetadata = {
        ...currentMetadata,
        completedAnalyses: completedAnalyses
      };
      
      // メタデータ更新実行（型安全にquery methodを使用）
      
      await env.storage.query(
        'UPDATE snapshots SET metadata = $1 WHERE id = $2',
        [JSON.stringify(updatedMetadata), snapshotId]
      );
      
      // 更新後の検証
      const verifySnapshot = await env.storage.getSnapshot(snapshotId);
      const verifyMetadata = verifySnapshot?.metadata as Record<string, unknown>;
      const storedAnalyses = verifyMetadata?.['completedAnalyses'];
      
      // デバッグ用の詳細ログ
      env.commandLogger?.debug?.(
        `Verification details: ${JSON.stringify({
          snapshotExists: !!verifySnapshot,
          metadataExists: !!verifyMetadata,
          completedAnalysesRaw: storedAnalyses,
          completedAnalysesType: typeof storedAnalyses,
          isArray: Array.isArray(storedAnalyses)
        })}`
      );
      
      if (!Array.isArray(storedAnalyses) || storedAnalyses.length !== completedAnalyses.length) {
        throw new Error(`Metadata update verification failed. Expected: [${completedAnalyses.join(', ')}], Got: ${Array.isArray(storedAnalyses) ? '[' + storedAnalyses.join(', ') + ']' : 'not an array or undefined'}`);
      }
      
      env.commandLogger?.debug?.(
        `Metadata update verified successfully: [${storedAnalyses.join(', ')}]`
      );
      
    } catch (error) {
      // 失敗時は詳細なエラー情報を出力し、エラーを再throw（隠蔽しない）
      env.commandLogger?.error?.(
        `CRITICAL: Failed to update completedAnalyses metadata for snapshot ${snapshotId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error; // エラーを隠蔽せず、呼び出し元に伝播
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
    if (!options.quiet && options.verbose) {
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
    
    if (!options.quiet && options.verbose) {
      env.commandLogger.info(`📸 New snapshot created: ${snapshot.id.substring(0, 8)}`);
    }
  }
  
  /**
   * 初期スナップショットを作成
   * 他の依存関係初期化メソッドと同じパターンで実装
   * scan.tsから必要最小限の機能のみを使用
   */
  private async createInitialSnapshot(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    if (!options.quiet && options.verbose) {
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
      const snapshotId = await saveSourceFiles(sourceFiles, env.storage, {
        comment: 'Initial snapshot created by dependency manager',
        scope: 'src',
        configHash,
      });

      if (!options.quiet) {
        env.commandLogger.info(`✓ Initial snapshot created (${files.length} files processed)`);
      }

      // Initialize shared ts-morph Project once per snapshot, registering all files in advance
      try {
        if (env.projectManager) {
          const fileContentMap = new Map<string, string>();
          for (const f of sourceFiles) {
            const filePath = (f as Record<string, unknown>)['filePath'] as string;
            const content = (f as Record<string, unknown>)['fileContent'] as string;
            if (filePath && typeof content === 'string') {
              fileContentMap.set(filePath, content);
            }
          }
          if (fileContentMap.size > 0) {
            await env.projectManager.getOrCreateProject(snapshotId, fileContentMap);
            if (!options.quiet && options.verbose) {
              env.commandLogger.info(`📚 Shared project initialized with ${fileContentMap.size} files`);
            }
          }
        }
      } catch (projErr) {
        env.commandLogger.warn(`Warning: Failed to pre-initialize shared project: ${projErr}`);
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
    
    // CRITICAL FIX: Always ensure virtual project is available for commands that need it
    await this.ensureVirtualProject(snapshotId, env);
    
    // メタデータのフラグをチェックして重複実行を防ぐ
    const snapshot = await env.storage.getSnapshot(snapshotId);
    const completedAnalyses = snapshot?.metadata?.completedAnalyses || [];
    const basicCompleted = completedAnalyses.includes('BASIC');
      
    if (basicCompleted) {
      if (!options.quiet && options.verbose) {
        env.commandLogger.info(`📋 BASIC analysis already completed - restoring to shared data`);
      }
      
      // CRITICAL: Restore BASIC analysis results from DB to scanSharedData
      await this.restoreBasicAnalysisToSharedData(snapshotId, env);
      return;
    }
    
    const { performDeferredBasicAnalysis } = await import('../cli/commands/scan');
    await performDeferredBasicAnalysis(snapshotId, env, true);
    
    // Note: performDeferredBasicAnalysis now sets shared data internally and returns the result
    
    // CRITICAL FIX: Update completedAnalyses metadata after BASIC analysis completion
    await this.ensureAnalysisLevelUpdated(snapshotId, 'BASIC', env);
  }
  
  /**
   * Restore BASIC analysis results from database to scanSharedData
   * Ensures that "completed dependency" and "fresh analysis" have identical scanSharedData state
   */
  private async restoreBasicAnalysisToSharedData(snapshotId: string, env: CommandEnvironment): Promise<void> {
    env.commandLogger.debug(`🔧 Restoring BASIC analysis to scanSharedData for snapshot ${snapshotId}`);
    
    // Ensure scanSharedData is properly initialized with source files and project
    const { ensureScanSharedData } = await import('../utils/scan-shared-data-helpers');
    await ensureScanSharedData(env, snapshotId);
    
    env.commandLogger.debug(`✅ scanSharedData initialized: sourceFiles=${env.scanSharedData?.sourceFiles?.length || 0}, snapshotId=${env.scanSharedData?.snapshotId}`);
    
    
    // Load functions and create BasicAnalysisResult from DB
    const functions = await env.storage.findFunctionsInSnapshot(snapshotId);
    
    const basicResult = {
      functions,
      functionsAnalyzed: functions.length,
      errors: [], // Historical data doesn't track errors
      batchStats: {
        totalBatches: 1,
        functionsPerBatch: [functions.length],
        processingTimes: [0] // Historical data doesn't have timing info
      }
    };
    
    // Set results in shared data using helper function
    const { setBasicAnalysisResults } = await import('../utils/scan-shared-data-helpers');
    setBasicAnalysisResults(env, basicResult);
    
    // Update source file function counts using efficient SQL grouping
    await this.updateSourceFileFunctionCountsFromDB(snapshotId, env);
  }

  /**
   * Restore CALL_GRAPH analysis results from database to scanSharedData
   */
  private async restoreCallGraphAnalysisToSharedData(snapshotId: string, env: CommandEnvironment): Promise<void> {
    env.commandLogger.debug(`🔧 Restoring CALL_GRAPH analysis to scanSharedData for snapshot ${snapshotId}`);
    
    // Ensure scanSharedData is initialized (should already be done by BASIC)
    if (!env.scanSharedData) {
      const { ensureScanSharedData } = await import('../utils/scan-shared-data-helpers');
      await ensureScanSharedData(env, snapshotId);
    }
    
    // Load call edges from database
    const callEdges = await env.storage.getCallEdgesBySnapshot(snapshotId);
    const internalCallEdges = await env.storage.getInternalCallEdgesBySnapshot(snapshotId);
    
    // Build dependency map
    const dependencyMap = new Map<string, {callers: string[], callees: string[], depth: number}>();
    
    for (const edge of callEdges) {
      if (edge.callerFunctionId && edge.calleeFunctionId) {
        // Add to callee's callers
        if (!dependencyMap.has(edge.calleeFunctionId)) {
          dependencyMap.set(edge.calleeFunctionId, {callers: [], callees: [], depth: 0});
        }
        dependencyMap.get(edge.calleeFunctionId)!.callers.push(edge.callerFunctionId);
        
        // Add to caller's callees
        if (!dependencyMap.has(edge.callerFunctionId)) {
          dependencyMap.set(edge.callerFunctionId, {callers: [], callees: [], depth: 0});
        }
        dependencyMap.get(edge.callerFunctionId)!.callees.push(edge.calleeFunctionId);
      }
    }
    
    // Calculate confidence statistics
    const highConfidenceEdges = callEdges.filter(e => e.confidenceScore && e.confidenceScore >= 0.95).length;
    const mediumConfidenceEdges = callEdges.filter(e => e.confidenceScore && e.confidenceScore >= 0.7 && e.confidenceScore < 0.95).length;
    const lowConfidenceEdges = callEdges.length - highConfidenceEdges - mediumConfidenceEdges;

    const callGraphResult = {
      callEdges,
      internalCallEdges,
      dependencyMap,
      stats: {
        totalEdges: callEdges.length,
        highConfidenceEdges,
        mediumConfidenceEdges,
        lowConfidenceEdges,
        analysisTime: 0 // Historical data doesn't have timing info
      }
    };
    
    // Set results in shared data using helper function
    const { setCallGraphAnalysisResults } = await import('../utils/scan-shared-data-helpers');
    setCallGraphAnalysisResults(env, callGraphResult);
    
    env.commandLogger.debug(`✅ CALL_GRAPH restored: ${callEdges.length} call edges, ${internalCallEdges.length} internal edges`);
  }

  /**
   * Restore TYPE_SYSTEM analysis results from database to scanSharedData
   */
  private async restoreTypeSystemAnalysisToSharedData(snapshotId: string, env: CommandEnvironment): Promise<void> {
    env.commandLogger.debug(`🔧 Restoring TYPE_SYSTEM analysis to scanSharedData for snapshot ${snapshotId}`);
    
    // Ensure scanSharedData is initialized (should already be done by BASIC)
    if (!env.scanSharedData) {
      const { ensureScanSharedData } = await import('../utils/scan-shared-data-helpers');
      await ensureScanSharedData(env, snapshotId);
    }
    
    // Load type definitions from database
    const typeDefinitionsQuery = `
      SELECT id, name, kind, file_path, start_line, end_line, 
             is_exported, is_generic, generic_parameters, 
             type_text, resolved_type, modifiers, jsdoc, 
             is_abstract, is_default_export, snapshot_id
      FROM type_definitions 
      WHERE snapshot_id = $1
    `;
    const result = await env.storage.query(typeDefinitionsQuery, [snapshotId]);
    
    const typeDefinitions = result.rows.map(row => {
      const r = row as Record<string, unknown>;
      return {
        id: r['id'] as string,
        name: r['name'] as string,
        kind: r['kind'] as string,
        filePath: r['file_path'] as string,
        startLine: r['start_line'] as number,
        endLine: r['end_line'] as number,
        isExported: r['is_exported'] as boolean,
        isGeneric: r['is_generic'] as boolean,
        genericParameters: r['generic_parameters'] as string || '',
        typeText: r['type_text'] as string || '',
        resolvedType: r['resolved_type'] || {},
        modifiers: r['modifiers'] as string || '',
        jsdoc: r['jsdoc'] as string || '',
        isAbstract: r['is_abstract'] as boolean,
        isDefaultExport: r['is_default_export'] as boolean,
        snapshotId: r['snapshot_id'] as string
      };
    });
    
    // Build basic type dependency and safety maps (placeholders for now)
    const typeDependencyMap = new Map<string, {
      usedTypes: string[];
      exposedTypes: string[];
      typeComplexity: number;
    }>();
    
    const typeSafetyMap = new Map<string, {
      hasAnyTypes: boolean;
      hasUnknownTypes: boolean;
      typeAnnotationRatio: number;
    }>();
    
    // Calculate type statistics
    const interfaces = typeDefinitions.filter(t => t.kind === 'interface').length;
    const classes = typeDefinitions.filter(t => t.kind === 'class').length;
    const enums = typeDefinitions.filter(t => t.kind === 'enum').length;
    const typeAliases = typeDefinitions.filter(t => t.kind === 'type_alias').length;

    const typeSystemResult = {
      typesAnalyzed: typeDefinitions.length,
      completed: true,
      typeDefinitions,
      typeDependencyMap,
      typeSafetyMap,
      typeCouplingData: {
        stronglyTypedPairs: [],
        typeInconsistencies: []
      },
      stats: {
        interfaces,
        classes,
        enums,
        typeAliases,
        analysisTime: 0 // Historical data doesn't have timing info
      }
    };
    
    // Set results in shared data using helper function
    const { setTypeSystemAnalysisResults } = await import('../utils/scan-shared-data-helpers');
    setTypeSystemAnalysisResults(env, typeSystemResult);
    
    env.commandLogger.debug(`✅ TYPE_SYSTEM restored: ${typeDefinitions.length} type definitions`);
  }

  /**
   * Restore COUPLING analysis results from database to scanSharedData
   */
  private async restoreCouplingAnalysisToSharedData(snapshotId: string, env: CommandEnvironment): Promise<void> {
    env.commandLogger.debug(`🔧 Restoring COUPLING analysis to scanSharedData for snapshot ${snapshotId}`);
    
    // Ensure scanSharedData is initialized (should already be done by BASIC)
    if (!env.scanSharedData) {
      const { ensureScanSharedData } = await import('../utils/scan-shared-data-helpers');
      await ensureScanSharedData(env, snapshotId);
    }
    
    // Load coupling data from database
    const couplingDataQuery = `
      SELECT COUNT(*) as total_coupling_points
      FROM parameter_property_usage 
      WHERE snapshot_id = $1
    `;
    const result = await env.storage.query(couplingDataQuery, [snapshotId]);
    const totalCouplingPoints = (result.rows[0] as { total_coupling_points: string }).total_coupling_points;
    
    // For now, create basic coupling structure - in future iterations,
    // we would build more sophisticated matrices from parameter_property_usage data
    const functionCouplingMatrix = new Map<string, Map<string, number>>();
    const fileCouplingData = new Map<string, {
      incomingCoupling: number;
      outgoingCoupling: number;
      totalCoupling: number;
    }>();
    const highCouplingFunctions: Array<{
      functionId: string;
      couplingScore: number;
      reasons: string[];
    }> = [];

    const couplingResult = {
      functionCouplingMatrix,
      fileCouplingData,
      highCouplingFunctions,
      stats: {
        filesCoupled: parseInt(totalCouplingPoints), // Use coupling points as proxy for files
        couplingRelationships: parseInt(totalCouplingPoints),
        analysisTime: 0 // Historical data doesn't have timing info
      }
    };
    
    // Set results in shared data using helper function
    const { setCouplingAnalysisResults } = await import('../utils/scan-shared-data-helpers');
    setCouplingAnalysisResults(env, couplingResult);
    
    env.commandLogger.debug(`✅ COUPLING restored: ${totalCouplingPoints} coupling data points`);
  }
  
  /**
   * Ensure scanSharedData is populated for already satisfied dependencies
   * This maintains consistency between fresh analysis and DB restoration
   */
  async ensureScanSharedDataForSatisfiedDependencies(
    satisfied: DependencyType[], 
    env: CommandEnvironment
  ): Promise<void> {
    const currentState = await this.getCurrentAnalysisState(env);
    const snapshotId = (await env.storage.getLatestSnapshot())?.id;
    
    if (!snapshotId) {
      return;
    }
    
    // Always restore BASIC if satisfied (most commands need functions data)
    if (satisfied.includes('BASIC') && currentState.completedAnalyses.includes('BASIC')) {
      await this.restoreBasicAnalysisToSharedData(snapshotId, env);
    }
    
    // Restore CALL_GRAPH if satisfied
    if (satisfied.includes('CALL_GRAPH') && currentState.completedAnalyses.includes('CALL_GRAPH')) {
      await this.restoreCallGraphAnalysisToSharedData(snapshotId, env);
    }
    
    // Restore TYPE_SYSTEM if satisfied
    if (satisfied.includes('TYPE_SYSTEM') && currentState.completedAnalyses.includes('TYPE_SYSTEM')) {
      await this.restoreTypeSystemAnalysisToSharedData(snapshotId, env);
    }
    
    // Restore COUPLING if satisfied
    if (satisfied.includes('COUPLING') && currentState.completedAnalyses.includes('COUPLING')) {
      await this.restoreCouplingAnalysisToSharedData(snapshotId, env);
    }
  }

  /**
   * Update source file function counts using efficient SQL grouping
   * Uses already registered functions data to avoid re-analysis
   */
  private async updateSourceFileFunctionCountsFromDB(snapshotId: string, env: CommandEnvironment): Promise<void> {
    // Use storage layer method for SQL operation
    const functionCountByFile = await env.storage.getFunctionCountsByFile(snapshotId);
    
    // Update source files with function counts
    await env.storage.updateSourceFileFunctionCounts(functionCountByFile, snapshotId);
  }
  
  /**
   * Virtual projectが利用可能であることを保証
   * BASIC dependency を持つコマンドが正常に動作するために必要
   */
  private async ensureVirtualProject(snapshotId: string, env: CommandEnvironment): Promise<void> {
    if (!env.projectManager) {
      throw new Error('ProjectManager not available in environment');
    }
    
    // Check if project already exists
    const existingProject = env.projectManager.getCachedProject(snapshotId);
    if (existingProject) {
      // Project already available
      return;
    }
    
    // Create virtual project for the snapshot
    const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
    const fileContentMap = new Map<string, string>();
    
    for (const sourceFile of sourceFiles) {
      fileContentMap.set(sourceFile.filePath, sourceFile.fileContent);
    }
    
    await env.projectManager.getOrCreateProject(snapshotId, fileContentMap);
  }

  /**
   * 分析レベルが正しく設定されているかチェックし、必要に応じて更新
   */
  private async ensureAnalysisLevelUpdated(
    snapshotId: string,
    completedDependency: DependencyType,
    env: CommandEnvironment,
  ): Promise<void> {
    try {
      const snapshot = await env.storage.getSnapshot(snapshotId);
      if (!snapshot) return;
      
      const metadata = snapshot.metadata as Record<string, unknown>;
      const currentCompleted = this.getCompletedAnalysesFromMetadata(metadata);
      
      // 指定された依存関係を completedAnalyses に追加（前提条件も含める）
      const prerequisites = DEPENDENCY_DEFINITIONS[completedDependency].prerequisites;
      const newCompleted = [...new Set([...currentCompleted, ...prerequisites, completedDependency])];
      
      // analysisLevel を新しいレベルに更新
      const newLevel = this.calculateAnalysisLevel(newCompleted);
      
      await env.storage.updateAnalysisLevel(snapshotId, newLevel as AnalysisLevel);
      await this.updateCompletedAnalysesMetadata(snapshotId, newCompleted, env);
      
    } catch (error) {
      env.commandLogger.warn(`Warning: Failed to update analysis level: ${error}`);
    }
  }
  
  private async initializeCallGraphAnalysis(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    const snapshotId = await this.ensureSnapshot(env, options);
    
    // メタデータのフラグをチェックして重複実行を防ぐ
    const snapshot = await env.storage.getSnapshot(snapshotId);
    const callGraphCompleted = snapshot?.metadata && 'callGraphAnalysisCompleted' in snapshot.metadata ? 
      snapshot.metadata.callGraphAnalysisCompleted : false;
      
    if (callGraphCompleted) {
      if (!options.quiet && options.verbose) {
        env.commandLogger.info('⏭️  CALL_GRAPH analysis already completed (flag check)');
      }
      return;
    }
    const { performCallGraphAnalysis } = await import('../cli/commands/scan');
    await performCallGraphAnalysis(snapshotId, env, undefined);
    
    // CRITICAL FIX: Update completedAnalyses metadata after CALL_GRAPH analysis completion
    await this.ensureAnalysisLevelUpdated(snapshotId, 'CALL_GRAPH', env);
  }
  
  private async initializeTypeSystemAnalysis(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    const snapshotId = await this.ensureSnapshot(env, options);
    
    // Check metadata flags instead of analysisLevel
    const snapshot = await env.storage.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    const typeSystemCompleted = snapshot?.metadata && 'typeSystemAnalysisCompleted' in snapshot.metadata ? 
      snapshot.metadata.typeSystemAnalysisCompleted : false;
      
    if (typeSystemCompleted) {
      if (!options.quiet && options.verbose) {
        env.commandLogger.info('⏭️  TYPE_SYSTEM analysis already completed - skipping duplicate analysis');
      }
      return;
    }
    
    const { performDeferredTypeSystemAnalysis } = await import('../cli/commands/scan');
    await performDeferredTypeSystemAnalysis(snapshotId, env, true);
    
    // CRITICAL FIX: Update completedAnalyses metadata after TYPE_SYSTEM analysis completion
    await this.ensureAnalysisLevelUpdated(snapshotId, 'TYPE_SYSTEM', env);
  }
  
  private async initializeCouplingAnalysis(env: CommandEnvironment, options: BaseCommandOptions): Promise<void> {
    const snapshotId = await this.ensureSnapshot(env, options);
    
    // Check metadata flags instead of analysisLevel
    const snapshot = await env.storage.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    const couplingCompleted = snapshot?.metadata && 'couplingAnalysisCompleted' in snapshot.metadata ? 
      snapshot.metadata.couplingAnalysisCompleted : false;
      
    if (couplingCompleted) {
      if (!options.quiet && options.verbose) {
        env.commandLogger.info('⏭️  COUPLING analysis already completed - skipping duplicate analysis');
      }
      return;
    }
    
    const { performDeferredCouplingAnalysis } = await import('../cli/commands/scan');
    await performDeferredCouplingAnalysis(snapshotId, env, undefined);
    
    // CRITICAL FIX: Update completedAnalyses metadata after COUPLING analysis completion
    await this.ensureAnalysisLevelUpdated(snapshotId, 'COUPLING', env);
  }
}
