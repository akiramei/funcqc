/**
 * テスト用のモックGitProvider実装
 */

import {
  GitProvider,
  GitInfo,
  GitCommitInfo,
  GitHistoryOptions,
  GitHistoryResult,
  GitProviderConfig,
  GitError
} from './git-provider';

export interface MockGitData {
  currentCommit?: string;
  currentBranch?: string;
  currentTag?: string | null;
  branches?: string[];
  tags?: string[];
  commits?: GitCommitInfo[];
  isGitAvailable?: boolean;
  repositoryRoot?: string;
}

export class MockGitProvider implements GitProvider {
  private config: Required<GitProviderConfig>;
  private mockData: MockGitData;
  private disposed = false;

  constructor(config: GitProviderConfig = {}, mockData: MockGitData = {}) {
    this.config = {
      cwd: config.cwd || process.cwd(),
      timeout: config.timeout || 5000,
      verbose: config.verbose || false
    };

    // デフォルトのモックデータ
    this.mockData = {
      currentCommit: 'abc123def456',
      currentBranch: 'main',
      currentTag: null,
      branches: ['main', 'develop', 'feature/test'],
      tags: ['v1.0.0', 'v1.1.0'],
      commits: [
        {
          hash: 'abc123def456',
          message: 'Initial commit',
          author: 'Test User',
          date: '2024-01-01T00:00:00Z'
        }
      ],
      isGitAvailable: true,
      repositoryRoot: '/test/repo',
      ...mockData
    };
  }

  async getCurrentCommit(): Promise<string> {
    this.checkDisposed();
    if (!this.mockData.currentCommit) {
      throw new GitError('No current commit configured in mock');
    }
    return this.mockData.currentCommit;
  }

  async getCurrentBranch(): Promise<string> {
    this.checkDisposed();
    if (!this.mockData.currentBranch) {
      throw new GitError('No current branch configured in mock');
    }
    return this.mockData.currentBranch;
  }

  async getCurrentTag(): Promise<string | null> {
    this.checkDisposed();
    return this.mockData.currentTag || null;
  }

  async getGitInfo(): Promise<GitInfo> {
    this.checkDisposed();
    const gitInfo: GitInfo = {};
    
    if (this.mockData.currentCommit !== undefined) {
      gitInfo.commit = this.mockData.currentCommit;
    }
    
    if (this.mockData.currentBranch !== undefined) {
      gitInfo.branch = this.mockData.currentBranch;
    }
    
    if (this.mockData.currentTag !== undefined) {
      gitInfo.tag = this.mockData.currentTag;
    }
    
    return gitInfo;
  }

  async resolveCommit(identifier: string): Promise<string> {
    this.checkDisposed();
    
    // ブランチ名から最新コミットを返す
    if (this.mockData.branches?.includes(identifier)) {
      return this.mockData.currentCommit || 'resolved-commit-hash';
    }

    // タグ名から対応するコミットを返す
    if (this.mockData.tags?.includes(identifier)) {
      return `tag-${identifier}-commit`;
    }

    // コミットハッシュの場合はそのまま返す
    if (identifier.match(/^[a-f0-9]{6,40}$/)) {
      return identifier;
    }

    throw new GitError(`Cannot resolve identifier: ${identifier}`);
  }

  async branchExists(branchName: string): Promise<boolean> {
    this.checkDisposed();
    return this.mockData.branches?.includes(branchName) || false;
  }

  async tagExists(tagName: string): Promise<boolean> {
    this.checkDisposed();
    return this.mockData.tags?.includes(tagName) || false;
  }

  async isValidGitReference(identifier: string): Promise<boolean> {
    this.checkDisposed();
    
    // ブランチまたはタグが存在するかチェック
    if (await this.branchExists(identifier) || await this.tagExists(identifier)) {
      return true;
    }

    // コミットハッシュ形式かチェック
    return identifier.match(/^[a-f0-9]{6,40}$/) !== null;
  }

  async getHistory(options: GitHistoryOptions = {}): Promise<GitHistoryResult> {
    this.checkDisposed();
    
    const {
      maxCommits = 500
    } = options;

    const commits = this.mockData.commits || [];
    const limitedCommits = commits.slice(0, maxCommits);

    return {
      commits: limitedCommits,
      totalCount: limitedCommits.length
    };
  }

  async getCommitInfo(commitHash: string): Promise<GitCommitInfo> {
    this.checkDisposed();
    
    // モックデータから該当するコミットを探す
    const commit = this.mockData.commits?.find(c => c.hash === commitHash);
    
    if (commit) {
      return commit;
    }

    // 見つからない場合はダミーデータを返す
    return {
      hash: commitHash,
      message: `Mock commit message for ${commitHash}`,
      author: 'Mock Author',
      date: new Date().toISOString()
    };
  }

  async createWorktree(commitHash: string, path: string): Promise<void> {
    this.checkDisposed();
    
    if (this.config.verbose) {
      console.debug(`Mock: Creating worktree at ${path} for commit ${commitHash}`);
    }
    
    // モックなので実際には何もしない
  }

  async removeWorktree(path: string): Promise<void> {
    this.checkDisposed();
    
    if (this.config.verbose) {
      console.debug(`Mock: Removing worktree at ${path}`);
    }
    
    // モックなので実際には何もしない
  }

  async isGitAvailable(): Promise<boolean> {
    this.checkDisposed();
    return this.mockData.isGitAvailable !== false;
  }

  async getRepositoryRoot(): Promise<string> {
    this.checkDisposed();
    return this.mockData.repositoryRoot || '/mock/repo/root';
  }

  dispose(): void {
    this.disposed = true;
    
    if (this.config.verbose) {
      console.debug('MockGitProvider disposed');
    }
  }

  // テスト用のヘルパーメソッド

  /**
   * モックデータを更新
   */
  updateMockData(newData: Partial<MockGitData>): void {
    this.mockData = { ...this.mockData, ...newData };
  }

  /**
   * 現在のモックデータを取得
   */
  getMockData(): MockGitData {
    return { ...this.mockData };
  }

  /**
   * エラーをシミュレート
   */
  simulateError(method: keyof GitProvider, error: Error): void {
    const originalMethod = this[method];
    
    (this as Record<string, unknown>)[method] = async () => {
      throw error;
    };

    // 元のメソッドを復元するためのヘルパー
    (this as Record<string, unknown>)[`restore${method}`] = () => {
      (this as Record<string, unknown>)[method] = originalMethod;
    };
  }

  /**
   * レスポンス遅延をシミュレート
   */
  simulateDelay(method: keyof GitProvider, delayMs: number): void {
    const originalMethod = this[method];
    
    (this as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return (originalMethod as (...args: unknown[]) => unknown).apply(this, args);
    };

    // 元のメソッドを復元するためのヘルパー
    (this as Record<string, unknown>)[`restore${method}`] = () => {
      (this as Record<string, unknown>)[method] = originalMethod;
    };
  }

  private checkDisposed(): void {
    if (this.disposed) {
      throw new GitError('MockGitProvider has been disposed');
    }
  }
}