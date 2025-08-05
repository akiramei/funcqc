/**
 * child_processを使用したネイティブGitProvider実装
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
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

const execAsync = promisify(exec);

export class NativeGitProvider implements GitProvider {
  private config: Required<GitProviderConfig>;

  constructor(config: GitProviderConfig = {}) {
    this.config = {
      cwd: config.cwd || process.cwd(),
      timeout: config.timeout || 5000,
      verbose: config.verbose || false
    };
  }

  async getCurrentCommit(): Promise<string> {
    try {
      const result = await this.execGitCommand('git rev-parse HEAD');
      return result.trim();
    } catch (error) {
      throw this.createGitError('Failed to get current commit', error);
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const result = await this.execGitCommand('git rev-parse --abbrev-ref HEAD');
      return result.trim();
    } catch (error) {
      throw this.createGitError('Failed to get current branch', error);
    }
  }

  async getCurrentTag(): Promise<string | null> {
    try {
      const result = await this.execGitCommand('git describe --tags --exact-match HEAD');
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
      const result = await this.execGitCommand(`git rev-parse ${this.sanitizeInput(identifier)}`);
      return result.trim();
    } catch (error) {
      throw this.createGitError(`Failed to resolve commit: ${identifier}`, error);
    }
  }

  async branchExists(branchName: string): Promise<boolean> {
    try {
      await this.execGitCommand(`git rev-parse --verify ${this.sanitizeInput(branchName)}`);
      return true;
    } catch {
      return false;
    }
  }

  async tagExists(tagName: string): Promise<boolean> {
    try {
      await this.execGitCommand(`git rev-parse --verify refs/tags/${this.sanitizeInput(tagName)}`);
      return true;
    } catch {
      return false;
    }
  }

  async isValidGitReference(identifier: string): Promise<boolean> {
    try {
      await this.execGitCommand(`git rev-parse --verify ${this.sanitizeInput(identifier)}`);
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

      let gitCmd = `git log --oneline --since="${sinceStr}" --max-count=${maxCommits} --format="%H|%s|%an|%ai"`;

      // 除外パスを追加
      if (excludePaths.length > 0) {
        const excludeArgs = excludePaths.map(path => `:(exclude)${path}`).join(' ');
        gitCmd += ` -- ${excludeArgs}`;
      }

      const result = await this.execGitCommand(gitCmd);
      const lines = result.trim().split('\n').filter(line => line.length > 0);

      const commits: GitCommitInfo[] = lines.map(line => {
        const [hash, message, author, date] = line.split('|');
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
      const sanitizedHash = this.sanitizeInput(commitHash);
      const result = await this.execGitCommand(
        `git show ${sanitizedHash} --no-patch --format="%H|%s|%an|%ai"`
      );

      const [hash, message, author, date] = result.trim().split('|');
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

  async createWorktree(commitHash: string, path: string): Promise<void> {
    try {
      const sanitizedHash = this.sanitizeInput(commitHash);
      const sanitizedPath = this.sanitizeInput(path);
      await this.execGitCommand(`git worktree add ${sanitizedPath} ${sanitizedHash}`);
    } catch (error) {
      throw this.createGitError(`Failed to create worktree at ${path}`, error);
    }
  }

  async removeWorktree(path: string): Promise<void> {
    try {
      const sanitizedPath = this.sanitizeInput(path);
      await this.execGitCommand(`git worktree remove ${sanitizedPath} --force`);
    } catch (error) {
      throw this.createGitError(`Failed to remove worktree at ${path}`, error);
    }
  }

  async isGitAvailable(): Promise<boolean> {
    try {
      await this.execGitCommand('git --version');
      return true;
    } catch {
      return false;
    }
  }

  async getRepositoryRoot(): Promise<string> {
    try {
      const result = await this.execGitCommand('git rev-parse --show-toplevel');
      return result.trim();
    } catch (error) {
      throw this.createGitError('Failed to get repository root', error);
    }
  }

  dispose(): void {
    if (this.config.verbose) {
      console.debug('NativeGitProvider disposed');
    }
  }

  /**
   * Gitコマンドを安全に実行
   */
  private async execGitCommand(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(command, {
        cwd: this.config.cwd,
        timeout: this.config.timeout,
        encoding: 'utf8'
      });
      return stdout;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'killed' in error && 'signal' in error && 
          error.killed && error.signal === 'SIGTERM') {
        throw new GitTimeoutError(
          `Git command timed out after ${this.config.timeout}ms: ${command}`,
          this.config.timeout
        );
      }
      throw error;
    }
  }

  /**
   * 同期的にGitコマンドを実行（レガシーサポート用）
   */
  execGitCommandSync(command: string): string {
    try {
      const result = execSync(command, {
        cwd: this.config.cwd,
        timeout: this.config.timeout,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return result;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && error.status === null) {
        throw new GitTimeoutError(
          `Git command timed out after ${this.config.timeout}ms: ${command}`,
          this.config.timeout
        );
      }
      throw this.createGitError(`Failed to execute git command: ${command}`, error);
    }
  }

  private createGitError(message: string, originalError: unknown): GitError {
    if (originalError instanceof Error) {
      const errorMessage = originalError.message;
      
      // タイムアウトエラーの検出
      if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
        return new GitTimeoutError(message, this.config.timeout);
      }

      // child_processエラーから詳細情報を抽出
      let stdout: string | undefined;
      let stderr: string | undefined;
      let code: string | undefined;

      if ('stdout' in originalError) {
        stdout = String(originalError.stdout);
      }
      if ('stderr' in originalError) {
        stderr = String(originalError.stderr);
      }
      if ('code' in originalError) {
        code = String(originalError.code);
      }

      return new GitError(
        `${message}: ${errorMessage}`,
        code || 'NATIVE_GIT_ERROR',
        stdout,
        stderr
      );
    }

    return new GitError(message, 'UNKNOWN_ERROR');
  }

  /**
   * 入力値をサニタイズしてコマンドインジェクションを防ぐ
   */
  private sanitizeInput(input: string): string {
    // 危険な文字を除外
    const sanitized = input.replace(/[;&|`$(){}[\]<>'"\\]/g, '');
    
    // 空白文字のエスケープ
    return `"${sanitized}"`;
  }
}