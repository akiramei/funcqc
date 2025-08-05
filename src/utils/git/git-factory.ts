/**
 * GitProviderのファクトリークラス
 * 
 * 設定に基づいて適切なGitProviderインスタンスを作成します。
 */

import {
  GitProvider,
  GitProviderType,
  GitProviderConfig
} from './git-provider';
import { SimpleGitProvider } from './simple-git-provider';
import { NativeGitProvider } from './native-git-provider';
import { MockGitProvider, MockGitData } from './mock-git-provider';

export interface GitFactoryConfig extends GitProviderConfig {
  /** 使用するGitプロバイダーのタイプ */
  provider?: GitProviderType;
  /** 自動検出を有効にするか */
  autoDetect?: boolean;
  /** モック用のデータ（provider="mock"の場合のみ使用） */
  mockData?: MockGitData;
}

export class GitFactory {
  private static instance: GitFactory;
  private providers = new Map<string, GitProvider>();

  private constructor() {}

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(): GitFactory {
    if (!GitFactory.instance) {
      GitFactory.instance = new GitFactory();
    }
    return GitFactory.instance;
  }

  /**
   * GitProviderを作成
   */
  createProvider(config: GitFactoryConfig = {}): GitProvider {
    const providerType = this.determineProviderType(config);
    const cacheKey = this.generateCacheKey(providerType, config);

    // キャッシュされたプロバイダーがあれば返す
    if (this.providers.has(cacheKey)) {
      return this.providers.get(cacheKey)!;
    }

    let provider: GitProvider;

    switch (providerType) {
      case 'simple-git':
        provider = new SimpleGitProvider(config);
        break;
      
      case 'native':
        provider = new NativeGitProvider(config);
        break;
      
      case 'mock':
        provider = new MockGitProvider(config, config.mockData);
        break;
      
      default:
        throw new Error(`Unsupported Git provider type: ${providerType}`);
    }

    // プロバイダーをキャッシュ
    this.providers.set(cacheKey, provider);

    return provider;
  }

  /**
   * デフォルトのGitProviderを作成（設定とグローバル環境変数を考慮）
   */
  createDefaultProvider(): GitProvider {
    const config = this.loadConfigFromEnvironment();
    return this.createProvider(config);
  }

  /**
   * すべてのプロバイダーを破棄
   */
  disposeAll(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
  }

  /**
   * 特定のプロバイダーを破棄
   */
  disposeProvider(config: GitFactoryConfig): void {
    const providerType = this.determineProviderType(config);
    const cacheKey = this.generateCacheKey(providerType, config);

    const provider = this.providers.get(cacheKey);
    if (provider) {
      provider.dispose();
      this.providers.delete(cacheKey);
    }
  }

  /**
   * 利用可能なGitプロバイダーを自動検出
   */
  async detectAvailableProviders(): Promise<GitProviderType[]> {
    const available: GitProviderType[] = [];

    // simple-gitが利用可能かチェック
    try {
      const simpleGitProvider = new SimpleGitProvider();
      if (await simpleGitProvider.isGitAvailable()) {
        available.push('simple-git');
      }
      simpleGitProvider.dispose();
    } catch {
      // simple-gitが利用できない
    }

    // ネイティブGitコマンドが利用可能かチェック
    try {
      const nativeProvider = new NativeGitProvider();
      if (await nativeProvider.isGitAvailable()) {
        available.push('native');
      }
      nativeProvider.dispose();
    } catch {
      // ネイティブGitが利用できない
    }

    // モックは常に利用可能
    available.push('mock');

    return available;
  }

  /**
   * 推奨されるGitプロバイダーを取得
   */
  async getRecommendedProvider(): Promise<GitProviderType> {
    const available = await this.detectAvailableProviders();

    // 優先順位: simple-git > native > mock
    if (available.includes('simple-git')) {
      return 'simple-git';
    }
    
    if (available.includes('native')) {
      return 'native';
    }
    
    return 'mock';
  }

  private determineProviderType(config: GitFactoryConfig): GitProviderType {
    // 設定で明示的に指定されている場合
    if (config.provider) {
      return config.provider;
    }

    // 環境変数から読み込み
    const envProvider = process.env['FUNCQC_GIT_PROVIDER'] as GitProviderType;
    if (envProvider && ['simple-git', 'native', 'mock'].includes(envProvider)) {
      return envProvider;
    }

    // テスト環境の場合はモックを使用
    if (process.env['NODE_ENV'] === 'test') {
      return 'mock';
    }

    // 自動検出が有効な場合は推奨プロバイダーを使用
    if (config.autoDetect !== false) {
      // 非同期なので一旦デフォルトを返し、後で推奨プロバイダーに切り替える
      return 'simple-git';
    }

    // デフォルトはsimple-git
    return 'simple-git';
  }

  private generateCacheKey(providerType: GitProviderType, config: GitFactoryConfig): string {
    const key = {
      type: providerType,
      cwd: config.cwd || process.cwd(),
      timeout: config.timeout || 5000
    };
    return JSON.stringify(key);
  }

  private loadConfigFromEnvironment(): GitFactoryConfig {
    const config: GitFactoryConfig = {};

    // 環境変数から設定を読み込み
    if (process.env['FUNCQC_GIT_PROVIDER']) {
      config.provider = process.env['FUNCQC_GIT_PROVIDER'] as GitProviderType;
    }

    if (process.env['FUNCQC_GIT_TIMEOUT']) {
      const timeout = parseInt(process.env['FUNCQC_GIT_TIMEOUT'], 10);
      if (!isNaN(timeout) && timeout > 0) {
        config.timeout = timeout;
      }
    }

    if (process.env['FUNCQC_GIT_VERBOSE']) {
      config.verbose = process.env['FUNCQC_GIT_VERBOSE'] === 'true';
    }

    if (process.env['FUNCQC_GIT_AUTO_DETECT']) {
      config.autoDetect = process.env['FUNCQC_GIT_AUTO_DETECT'] === 'true';
    }

    return config;
  }
}

/**
 * 便利な関数：デフォルトのGitProviderを取得
 */
export function createDefaultGitProvider(): GitProvider {
  return GitFactory.getInstance().createDefaultProvider();
}

/**
 * 便利な関数：指定された設定でGitProviderを作成
 */
export function createGitProvider(config: GitFactoryConfig): GitProvider {
  return GitFactory.getInstance().createProvider(config);
}