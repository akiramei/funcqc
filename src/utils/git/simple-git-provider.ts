/**
 * simple-gitライブラリを使用したGitProvider実装
 */

import simpleGit, { SimpleGit } from 'simple-git';
import {
  GitProvider,
  GitInfo,
  GitCommitInfo,
  GitHistoryOptions,
  GitHistoryResult,
  GitProviderConfig,
  GitError,
  GitTimeoutError
} from './git-provider';

export class SimpleGitProvider implements GitProvider {
  private git: SimpleGit;
  private config: Required<GitProviderConfig>;

  constructor(config: GitProviderConfig = {}) {
    this.config = {
      cwd: config.cwd || process.cwd(),
      timeout: config.timeout || 5000,
      verbose: config.verbose || false
    };

    this.git = simpleGit({
      baseDir: this.config.cwd,
      binary: 'git',
      maxConcurrentProcesses: 1,
      timeout: {
        block: this.config.timeout
      }
    });
  }

  async getCurrentCommit(): Promise<string> {
    try {
      const result = await this.git.revparse(['HEAD']);
      return result.trim();
    } catch (error) {
      throw this.createGitError('Failed to get current commit', error);
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const result = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return result.trim();
    } catch (error) {
      throw this.createGitError('Failed to get current branch', error);
    }
  }

  async getCurrentTag(): Promise<string | null> {
    try {
      const result = await this.git.raw(['describe', '--tags', '--exact-match', 'HEAD']);
      return result.trim() || null;
    } catch (error) {
      // タグが存在しない場合は正常な状態
      if (this.config.verbose) {
        console.debug('No tag found for current commit:', error);
      }
      return null;
    }
  }

  async getGitInfo(): Promise<GitInfo> {
    const gitInfo: GitInfo = {};

    try {
      gitInfo.commit = await this.getCurrentCommit();
    } catch {
      // Git commit not available
    }

    try {
      gitInfo.branch = await this.getCurrentBranch();
    } catch {
      // Git branch not available
    }

    try {
      gitInfo.tag = await this.getCurrentTag();
    } catch {
      // Git tag not available (normal)
      gitInfo.tag = null;
    }

    return gitInfo;
  }

  async resolveCommit(identifier: string): Promise<string> {
    try {
      const result = await this.git.revparse([identifier]);
      return result.trim();
    } catch (error) {
      throw this.createGitError(`Failed to resolve commit: ${identifier}`, error);
    }
  }

  async branchExists(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    } catch (error) {
      if (this.config.verbose) {
        console.debug('Failed to check branch existence:', error);
      }
      return false;
    }
  }

  async tagExists(tagName: string): Promise<boolean> {
    try {
      const tags = await this.git.tags();
      return tags.all.includes(tagName);
    } catch (error) {
      if (this.config.verbose) {
        console.debug('Failed to check tag existence:', error);
      }
      return false;
    }
  }

  async isValidGitReference(identifier: string): Promise<boolean> {
    try {
      // ブランチ名かチェック
      if (await this.branchExists(identifier)) {
        return true;
      }

      // タグ名かチェック
      if (await this.tagExists(identifier)) {
        return true;
      }

      // コミットハッシュかチェック
      await this.git.revparse([identifier]);
      return true;
    } catch {
      return false;
    }
  }

  async getHistory(options: GitHistoryOptions = {}): Promise<GitHistoryResult> {
    const {
      monthsBack = 3,
      maxCommits = 500,
      excludePaths = []
    } = options;

    try {
      const since = new Date();
      since.setMonth(since.getMonth() - monthsBack);
      const sinceStr = since.toISOString().split('T')[0];

      const gitOptions: string[] = [
        'log',
        '--oneline',
        '--since', sinceStr,
        '--max-count', maxCommits.toString(),
        '--format=%H%x00%s%x00%an%x00%ai'
      ];

      // 除外パスを追加
      if (excludePaths.length > 0) {
        gitOptions.push('--');
        for (const excludePath of excludePaths) {
          gitOptions.push(`:(exclude)${excludePath}`);
        }
      }

      const result = await this.git.raw(gitOptions);
      const lines = result.trim().split('\n').filter(line => line.length > 0);

      const commits: GitCommitInfo[] = lines.map(line => {
        const [hash, message, author, date] = line.split('\x00');
        return {
          hash: hash.trim(),
          message: message.trim(),
          author: author.trim(),
          date: date.trim()
        };
      });

      return {
        commits,
        totalCount: commits.length
      };
    } catch (error) {
      throw this.createGitError('Failed to get git history', error);
    }
  }

  async getCommitInfo(commitHash: string): Promise<GitCommitInfo> {
    try {
      const result = await this.git.show([
        commitHash,
        '--no-patch',
        '--format=%H%x00%s%x00%an%x00%ai'
      ]);

      const [hash, message, author, date] = result.trim().split('\x00');
      return {
        hash: hash.trim(),
        message: message.trim(),
        author: author.trim(),
        date: date.trim()
      };
    } catch (error) {
      throw this.createGitError(`Failed to get commit info: ${commitHash}`, error);
    }
  }

  async getCommitDiff(commitHash: string): Promise<string> {
    try {
      const result = await this.git.show([commitHash, '-p']);
      return result;
    } catch (error) {
      throw this.createGitError(`Failed to get commit diff: ${commitHash}`, error);
    }
  }

  async createWorktree(commitHash: string, path: string): Promise<void> {
    try {
      await this.git.raw(['worktree', 'add', path, commitHash]);
    } catch (error) {
      throw this.createGitError(`Failed to create worktree at ${path}`, error);
    }
  }

  async removeWorktree(path: string): Promise<void> {
    try {
      await this.git.raw(['worktree', 'remove', path, '--force']);
    } catch (error) {
      throw this.createGitError(`Failed to remove worktree at ${path}`, error);
    }
  }

  async isGitAvailable(): Promise<boolean> {
    try {
      await this.git.version();
      return true;
    } catch {
      return false;
    }
  }

  async getRepositoryRoot(): Promise<string> {
    try {
      const result = await this.git.revparse(['--show-toplevel']);
      return result.trim();
    } catch (error) {
      throw this.createGitError('Failed to get repository root', error);
    }
  }

  dispose(): void {
    // simple-gitは明示的なクリーンアップ不要
    if (this.config.verbose) {
      console.debug('SimpleGitProvider disposed');
    }
  }

  private createGitError(message: string, originalError: unknown): GitError {
    if (originalError instanceof Error) {
      // simple-gitのエラーから詳細情報を抽出
      const errorMessage = originalError.message;
      
      // タイムアウトエラーの検出
      if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
        return new GitTimeoutError(message, this.config.timeout);
      }

      return new GitError(
        `${message}: ${errorMessage}`,
        'SIMPLE_GIT_ERROR',
        undefined,
        errorMessage
      );
    }

    return new GitError(message, 'UNKNOWN_ERROR');
  }
}