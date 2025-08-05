/**
 * Git操作の統一インターフェース
 * 
 * プロジェクト内のすべてのGit操作を抽象化し、
 * 実装の切り替えやテストの簡素化を可能にします。
 */

export interface GitInfo {
  commit?: string;
  branch?: string;
  tag?: string | null;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitHistoryOptions {
  monthsBack?: number;
  maxCommits?: number;
  excludePaths?: string[];
}

export interface GitHistoryResult {
  commits: GitCommitInfo[];
  totalCount: number;
}

export interface GitProvider {
  /**
   * 現在のコミットハッシュを取得
   */
  getCurrentCommit(): Promise<string>;

  /**
   * 現在のブランチ名を取得
   */
  getCurrentBranch(): Promise<string>;

  /**
   * 現在のタグを取得（存在する場合）
   */
  getCurrentTag(): Promise<string | null>;

  /**
   * Git情報を一括取得
   */
  getGitInfo(): Promise<GitInfo>;

  /**
   * 指定されたコミットハッシュを解決
   */
  resolveCommit(identifier: string): Promise<string>;

  /**
   * ブランチが存在するかチェック
   */
  branchExists(branchName: string): Promise<boolean>;

  /**
   * タグが存在するかチェック
   */
  tagExists(tagName: string): Promise<boolean>;

  /**
   * 指定された識別子がGitリファレンスとして有効かチェック
   */
  isValidGitReference(identifier: string): Promise<boolean>;

  /**
   * Git履歴を取得（デバッグパターン学習用）
   */
  getHistory(options?: GitHistoryOptions): Promise<GitHistoryResult>;

  /**
   * 指定されたコミットの詳細情報を取得
   */
  getCommitInfo(commitHash: string): Promise<GitCommitInfo>;

  /**
   * ワークツリーを作成
   */
  createWorktree(commitHash: string, path: string): Promise<void>;

  /**
   * ワークツリーを削除
   */
  removeWorktree(path: string): Promise<void>;

  /**
   * Gitが利用可能かチェック
   */
  isGitAvailable(): Promise<boolean>;

  /**
   * リポジトリルートディレクトリを取得
   */
  getRepositoryRoot(): Promise<string>;

  /**
   * プロバイダーのクリーンアップ処理
   */
  dispose(): void;
}

/**
 * Git操作のエラー
 */
export class GitError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly stdout?: string,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Git操作のタイムアウトエラー
 */
export class GitTimeoutError extends GitError {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message, 'TIMEOUT');
    this.name = 'GitTimeoutError';
  }
}

/**
 * Git プロバイダーの設定
 */
export interface GitProviderConfig {
  /** 作業ディレクトリ */
  cwd?: string;
  /** タイムアウト（ミリ秒） */
  timeout?: number;
  /** デバッグログを有効にするか */
  verbose?: boolean;
}

/**
 * Git プロバイダーのタイプ
 */
export type GitProviderType = 'simple-git' | 'native' | 'mock';