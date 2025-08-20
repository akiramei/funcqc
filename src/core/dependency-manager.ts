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
    
    // 要求された依存関係をフィルタリング
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
        completedAnalyses: this.getCompletedAnalysesFromLevel(analysisLevel, metadata),
        timestamp: new Date(snapshot.createdAt)
      };
    } catch {
      return { level: 'NONE', completedAnalyses: [] };
    }
  }
  
  /**
   * 分析レベルから完了済み依存関係を推定
   */
  private getCompletedAnalysesFromLevel(level: string, _metadata: Record<string, unknown>): DependencyType[] {
    const completed: DependencyType[] = [];
    
    // レベルから推定
    switch (level) {
      case 'COMPLETE':
        completed.push('BASIC', 'CALL_GRAPH', 'TYPE_SYSTEM', 'COUPLING');
        break;
      case 'TYPE_SYSTEM':
        completed.push('BASIC', 'TYPE_SYSTEM');
        break;
      case 'CALL_GRAPH':
        completed.push('BASIC', 'CALL_GRAPH');
        break;
      case 'COUPLING':
        completed.push('BASIC', 'COUPLING');
        break;
      case 'BASIC':
        completed.push('BASIC');
        break;
    }
    
    // メタデータから詳細チェック（将来の拡張用）
    // if (metadata.callGraphAnalysisCompleted) completed.push('CALL_GRAPH');
    // if (metadata.typeSystemAnalysisCompleted) completed.push('TYPE_SYSTEM');
    // if (metadata.couplingAnalysisCompleted) completed.push('COUPLING');
    
    return [...new Set(completed)];
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
      
      // DB状態を更新
      await env.storage.updateAnalysisLevel(snapshot.id, newLevel as AnalysisLevel);
    } catch (error) {
      // ログに記録するが、初期化処理は成功扱い
      console.warn(`Warning: Failed to update analysis level for ${dependency}:`, error);
    }
  }
  
  /**
   * 完了済み依存関係から適切な分析レベルを計算
   */
  private calculateAnalysisLevel(completed: DependencyType[]): AnalysisLevel {
    if (completed.includes('BASIC') && completed.includes('CALL_GRAPH') && 
        completed.includes('TYPE_SYSTEM') && completed.includes('COUPLING')) {
      return 'COMPLETE';
    }
    
    if (completed.includes('TYPE_SYSTEM')) {
      return 'TYPE_SYSTEM';
    }
    
    if (completed.includes('CALL_GRAPH')) {
      return 'CALL_GRAPH';
    }
    
    if (completed.includes('COUPLING')) {
      return 'COUPLING';
    }
    
    if (completed.includes('BASIC')) {
      return 'BASIC';
    }
    
    return 'NONE';
  }
  
  // === 個別初期化メソッド（既存実装を活用） ===
  
  private async initializeBasicAnalysis(env: CommandEnvironment, _options: BaseCommandOptions): Promise<void> {
    const { performDeferredBasicAnalysis } = await import('../cli/commands/scan');
    const snapshot = await env.storage.getLatestSnapshot();
    if (!snapshot) throw new Error('No snapshot found for basic analysis');
    
    await performDeferredBasicAnalysis(snapshot.id, env, true);
  }
  
  private async initializeCallGraphAnalysis(env: CommandEnvironment, _options: BaseCommandOptions): Promise<void> {
    const { performCallGraphAnalysis } = await import('../cli/commands/scan');
    const snapshot = await env.storage.getLatestSnapshot();
    if (!snapshot) throw new Error('No snapshot found for call graph analysis');
    
    await performCallGraphAnalysis(snapshot.id, env, undefined);
  }
  
  private async initializeTypeSystemAnalysis(env: CommandEnvironment, _options: BaseCommandOptions): Promise<void> {
    const { performDeferredTypeSystemAnalysis } = await import('../cli/commands/scan');
    const snapshot = await env.storage.getLatestSnapshot();
    if (!snapshot) throw new Error('No snapshot found for type system analysis');
    
    await performDeferredTypeSystemAnalysis(snapshot.id, env, true);
  }
  
  private async initializeCouplingAnalysis(env: CommandEnvironment, _options: BaseCommandOptions): Promise<void> {
    const { performDeferredCouplingAnalysis } = await import('../cli/commands/scan');
    const snapshot = await env.storage.getLatestSnapshot();
    if (!snapshot) throw new Error('No snapshot found for coupling analysis');
    
    await performDeferredCouplingAnalysis(snapshot.id, env, undefined);
  }
}