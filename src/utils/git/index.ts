/**
 * Git抽象化レイヤーのエクスポート
 */

// 基本インターフェースとタイプ
export type {
  GitProvider,
  GitInfo,
  GitCommitInfo,
  GitHistoryOptions,
  GitHistoryResult,
  GitProviderConfig,
  GitProviderType
} from './git-provider';

// エラークラス
export {
  GitError,
  GitTimeoutError
} from './git-provider';

// プロバイダー実装
export { SimpleGitProvider } from './simple-git-provider';
export { NativeGitProvider } from './native-git-provider';
export { 
  MockGitProvider,
  type MockGitData 
} from './mock-git-provider';

// ファクトリー
export {
  GitFactory,
  createDefaultGitProvider,
  createGitProvider,
  type GitFactoryConfig
} from './git-factory';

// 便利な関数とデフォルトエクスポート
export { createDefaultGitProvider as default } from './git-factory';