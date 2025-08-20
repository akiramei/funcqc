/**
 * 統一コマンド実行システム
 * 
 * 全てのコマンドを統一的に処理する新しいcli-wrapper
 * 場当たり的な個別対応を排除し、Command protocolに基づく一貫した処理を実現
 */

import { OptionValues } from 'commander';
import { createAppEnvironment, createLightweightAppEnvironment, createCommandEnvironment, destroyAppEnvironment } from './environment';
import { AppEnvironment, CommandEnvironment } from '../types/environment';
import { BaseCommandOptions } from '../types/command';
import { Command, CommandClass, DependencyType } from '../types/command-protocol';
import { DependencyManager } from './dependency-manager';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { SystemChecker } from '../utils/system-checker';

/**
 * Convert kebab-case keys to camelCase
 */
function kebabToCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Normalize option keys by converting kebab-case to camelCase
 */
function normalizeOptionKeys<T extends Record<string, unknown>>(options: T): T {
  const normalized = {} as T;
  
  for (const [key, value] of Object.entries(options)) {
    const camelKey = kebabToCamelCase(key);
    (normalized as Record<string, unknown>)[camelKey] = value;
    
    // Keep original key as well for backward compatibility
    if (key !== camelKey) {
      (normalized as Record<string, unknown>)[key] = value;
    }
  }
  
  return normalized;
}

/**
 * 統一コマンド実行システム
 */
export class UnifiedCommandExecutor {
  private dependencyManager = new DependencyManager();
  
  /**
   * Command protocolに基づく統一的なコマンド実行
   * 
   * 処理フロー:
   * 1. コマンドインスタンス作成
   * 2. command.getRequires(subCommand)で依存関係取得
   * 3. 不足している依存関係を計算・初期化
   * 4. command.perform(env, subCommand)実行
   */
  createCommandHandler<T extends Command>(CommandClass: CommandClass<T>) {
    return async (options: BaseCommandOptions, parentCommand?: { opts(): OptionValues; parent?: { opts(): OptionValues } }): Promise<void> => {
      const subCommand = process.argv.slice(3);
      const parentOpts = this.extractParentOptions(parentCommand);
      let appEnv: AppEnvironment | null = null;
      
      // オプション正規化
      const normalizedOptions = normalizeOptionKeys(options as Record<string, unknown>) as BaseCommandOptions;
      const normalizedParentOpts = normalizeOptionKeys(parentOpts);
      
      const mergedOptions: BaseCommandOptions = { ...normalizedOptions };
      for (const [key, value] of Object.entries(normalizedParentOpts)) {
        if (!(key in mergedOptions) || mergedOptions[key as keyof BaseCommandOptions] === undefined) {
          (mergedOptions as Record<string, unknown>)[key] = value;
        }
      }
      
      try {
        // システムチェック
        this.performSystemCheck(parentOpts);
        
        // 1. コマンドインスタンス作成
        const command = new CommandClass();
        
        // 2. 依存関係を問い合わせ
        const requiredDependencies = await command.getRequires(subCommand);
        
        if (!mergedOptions.quiet) {
          console.log(`🔍 Command requires: [${requiredDependencies.join(', ') || 'none'}]`);
        }
        
        // 3. 適切な環境を作成
        appEnv = await this.createAppropriateEnvironment(requiredDependencies, parentOpts, mergedOptions);
        const commandEnv = this.createCommandEnvironment(appEnv, mergedOptions, parentOpts);
        
        // 4. 不足している依存関係を計算・初期化
        await this.ensureDependencies(requiredDependencies, commandEnv, mergedOptions);
        
        // 5. コマンド実行
        await command.perform(commandEnv, subCommand);
        
      } catch (error) {
        this.handleCommandError(error, parentOpts);
      } finally {
        if (appEnv) {
          await destroyAppEnvironment(appEnv);
        }
      }
    };
  }
  
  /**
   * 依存関係に基づいて適切な環境を作成
   */
  private async createAppropriateEnvironment(
    dependencies: DependencyType[],
    parentOpts: OptionValues,
    options: BaseCommandOptions
  ): Promise<AppEnvironment> {
    const isJsonOutput = this.isJsonOutputMode(options);
    
    // 依存関係がない場合は軽量環境
    if (dependencies.length === 0) {
      return await createLightweightAppEnvironment({
        configPath: parentOpts['config'],
        dbPath: parentOpts['cwd'] ? `${parentOpts['cwd']}/.funcqc/funcqc.db` : undefined,
        quiet: Boolean(parentOpts['quiet']) || isJsonOutput,
        verbose: Boolean(parentOpts['verbose']) && !isJsonOutput,
      });
    }
    
    // 依存関係がある場合は完全環境
    return await createAppEnvironment({
      configPath: parentOpts['config'],
      dbPath: parentOpts['cwd'] ? `${parentOpts['cwd']}/.funcqc/funcqc.db` : undefined,
      quiet: Boolean(parentOpts['quiet']) || isJsonOutput,
      verbose: Boolean(parentOpts['verbose']) && !isJsonOutput,
    });
  }
  
  /**
   * コマンド環境を作成
   */
  private createCommandEnvironment(
    appEnv: AppEnvironment,
    options: BaseCommandOptions,
    parentOpts: OptionValues
  ): CommandEnvironment {
    const isJsonOutput = this.isJsonOutputMode(options);
    
    return createCommandEnvironment(appEnv, {
      quiet: Boolean(options['quiet'] ?? parentOpts['quiet']) || isJsonOutput,
      verbose: Boolean(options['verbose'] ?? parentOpts['verbose']) && !isJsonOutput,
    });
  }
  
  /**
   * 必要な依存関係を確保（不足分のみ初期化）
   */
  private async ensureDependencies(
    required: DependencyType[],
    env: CommandEnvironment,
    options: BaseCommandOptions
  ): Promise<void> {
    if (required.length === 0) {
      if (!options.quiet) {
        console.log(`✅ No dependencies required`);
      }
      return;
    }
    
    // 不足している依存関係のみを計算
    const missing = await this.dependencyManager.calculateMissingDependencies(required, env);
    
    if (missing.length === 0) {
      if (!options.quiet) {
        console.log(`✅ All required dependencies already satisfied: [${required.join(', ')}]`);
      }
      return;
    }
    
    if (!options.quiet) {
      console.log(`⚡ Missing dependencies: [${missing.join(', ')}], initializing...`);
    }
    
    // 不足している依存関係のみを初期化
    const result = await this.dependencyManager.initializeDependencies(missing, env, options);
    
    // 部分成功の場合の処理
    if (result.partialSuccess) {
      const proceedDecision = this.dependencyManager.canProceedWithPartialSuccess(result, required);
      
      if (!proceedDecision.canProceed) {
        throw new Error(
          `Critical dependencies failed. Cannot proceed.\nFailed: ${result.failed.map(f => f.dependency).join(', ')}`
        );
      }
      
      if (!options.quiet && proceedDecision.limitations) {
        console.log(`⚠️  Proceeding with limitations:`);
        proceedDecision.limitations.forEach(limitation => {
          console.log(`   • ${limitation}`);
        });
      }
    } else if (result.failed.length > 0) {
      // 全て失敗の場合
      throw new Error(
        `All dependency initializations failed:\n${result.failed.map(f => `  ${f.dependency}: ${f.error.message}`).join('\n')}`
      );
    } else {
      // 全て成功
      if (!options.quiet) {
        console.log(`✅ All dependencies initialized successfully`);
      }
    }
  }
  
  /**
   * 親コマンドオプションを抽出
   */
  private extractParentOptions(parentCommand?: { opts(): OptionValues; parent?: { opts(): OptionValues } }): OptionValues {
    return parentCommand?.parent?.opts?.() || parentCommand?.opts?.() || {};
  }
  
  /**
   * JSONアウトプットモードを検出
   */
  private isJsonOutputMode(options: BaseCommandOptions): boolean {
    return Boolean(options['json']) || process.argv.includes('--json');
  }
  
  /**
   * システムチェックを実行
   */
  private performSystemCheck(parentOpts: OptionValues): void {
    if (!parentOpts['noCheck'] && !parentOpts['checkSystem']) {
      const logger = new Logger(parentOpts['verbose'], parentOpts['quiet']);
      const systemChecker = new SystemChecker(logger);
      systemChecker.checkSystem();
    }
  }
  
  /**
   * エラーハンドリング
   */
  private handleCommandError(error: unknown, parentOpts: OptionValues): never {
    const logger = new Logger(parentOpts['verbose'], parentOpts['quiet']);
    const errorHandler = createErrorHandler(logger);
    
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Command failed: ${error instanceof Error ? error.message : String(error)}`,
      { command: process.argv.slice(2) },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
    process.exit(1);
  }
}

/**
 * 統一コマンドハンドラーの作成（外部API）
 */
export function createUnifiedCommandHandler<T extends Command>(
  CommandClass: CommandClass<T>
) {
  const executor = new UnifiedCommandExecutor();
  return executor.createCommandHandler(CommandClass);
}