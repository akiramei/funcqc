/**
 * Git Co-change Provider
 * 
 * Specialized Git provider for co-change analysis that extracts
 * commit history and file change patterns needed for temporal coupling analysis.
 */

import { execSync } from 'child_process';
import path from 'path';
import { GitProvider, GitCommitInfo } from './cochange-analyzer';

export interface GitCochangeOptions {
  monthsBack: number;
  maxCommits: number;
  excludePaths: string[];
}

export class GitCochangeProvider implements GitProvider {
  private repositoryRoot: string;
  private timeout: number;

  constructor(repositoryRoot?: string, timeout: number = 30000) {
    this.repositoryRoot = repositoryRoot || process.cwd();
    this.timeout = timeout;
  }

  /**
   * Get commit history for co-change analysis
   */
  async getCommitHistory(options: GitCochangeOptions): Promise<GitCommitInfo[]> {
    try {
      // Calculate date threshold
      const dateThreshold = new Date();
      dateThreshold.setMonth(dateThreshold.getMonth() - options.monthsBack);
      const sinceDate = dateThreshold.toISOString().split('T')[0]; // YYYY-MM-DD format

      // Build git log command
      let gitCommand = `git log --since="${sinceDate}" --pretty=format:"%H|%ci|%s" --name-only --max-count=${options.maxCommits}`;
      
      // Add path exclusions
      if (options.excludePaths.length > 0) {
        const excludePatterns = options.excludePaths
          .map(p => `':!${p}'`)
          .join(' ');
        gitCommand += ` -- . ${excludePatterns}`;
      }

      const output = execSync(gitCommand, {
        cwd: this.repositoryRoot,
        encoding: 'utf8',
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      return this.parseGitLogOutput(output);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get Git commit history: ${error.message}`);
      }
      throw new Error(`Failed to get Git commit history: ${String(error)}`);
    }
  }

  /**
   * Parse git log output into structured commit information
   */
  private parseGitLogOutput(output: string): GitCommitInfo[] {
    const commits: GitCommitInfo[] = [];
    const commitBlocks = output.split('\n\n').filter(block => block.trim());

    for (const block of commitBlocks) {
      const lines = block.split('\n').filter(line => line.trim());
      if (lines.length === 0) continue;

      const headerLine = lines[0];
      if (!headerLine) continue;

      const [hash, dateStr, ...messageParts] = headerLine.split('|');
      if (!hash || !dateStr) continue;

      const message = messageParts.join('|').trim();
      const date = new Date(dateStr);
      
      // Skip commits with invalid dates
      if (isNaN(date.getTime())) continue;
      
      // Extract changed files (excluding the header line)
      const changedFiles = lines.slice(1)
        .filter(line => line.trim() && !line.includes('|'))
        .map(file => this.normalizeFilePath(file.trim()))
        .filter(file => this.isTypeScriptFile(file));

      if (changedFiles.length > 0) {
        commits.push({
          hash: hash.trim(),
          date,
          message,
          changedFiles
        });
      }
    }

    return commits.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /**
   * Normalize file path for consistent comparison
   */
  private normalizeFilePath(filePath: string): string {
    // Convert backslashes to forward slashes
    const normalized = filePath.replace(/\\/g, '/');
    
    // Remove leading ./ if present
    return normalized.startsWith('./') ? normalized.slice(2) : normalized;
  }

  /**
   * Check if file is a TypeScript file that might contain type definitions
   */
  private isTypeScriptFile(filePath: string): boolean {
    const tsExtensions = ['.ts', '.tsx'];
    const ext = path.extname(filePath).toLowerCase();
    
    // Include TypeScript files but exclude test files and declaration files
    return tsExtensions.includes(ext) && 
           !filePath.includes('.test.') && 
           !filePath.includes('.spec.') &&
           !filePath.endsWith('.d.ts');
  }

  /**
   * Get files changed in a specific commit
   */
  async getCommitFiles(commitHash: string): Promise<string[]> {
    try {
      const output = execSync(`git show --name-only --pretty=format: ${commitHash}`, {
        cwd: this.repositoryRoot,
        encoding: 'utf8',
        timeout: this.timeout
      });

      return output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && this.isTypeScriptFile(line))
        .map(file => this.normalizeFilePath(file));
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get commit files for ${commitHash}: ${error.message}`);
      }
      throw new Error(`Failed to get commit files for ${commitHash}: ${String(error)}`);
    }
  }

  /**
   * Get co-change frequency between two files over time
   */
  async getCochangeFrequency(
    fileA: string, 
    fileB: string, 
    options: GitCochangeOptions
  ): Promise<number> {
    try {
      const commits = await this.getCommitHistory(options);
      let cochangeCount = 0;

      for (const commit of commits) {
        const hasFileA = commit.changedFiles.some(f => f.includes(fileA) || fileA.includes(f));
        const hasFileB = commit.changedFiles.some(f => f.includes(fileB) || fileB.includes(f));
        
        if (hasFileA && hasFileB) {
          cochangeCount++;
        }
      }

      return cochangeCount;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to calculate co-change frequency: ${error.message}`);
      }
      throw new Error(`Failed to calculate co-change frequency: ${String(error)}`);
    }
  }

  /**
   * Check if Git is available in the current environment
   */
  async isGitAvailable(): Promise<boolean> {
    try {
      execSync('git --version', {
        cwd: this.repositoryRoot,
        timeout: 5000
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the current directory is a Git repository
   */
  async isGitRepository(): Promise<boolean> {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: this.repositoryRoot,
        timeout: 5000
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current repository root directory
   */
  async getRepositoryRoot(): Promise<string> {
    try {
      const output = execSync('git rev-parse --show-toplevel', {
        cwd: this.repositoryRoot,
        encoding: 'utf8',
        timeout: 5000
      });
      return output.trim();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get repository root: ${error.message}`);
      }
      throw new Error(`Failed to get repository root: ${String(error)}`);
    }
  }

  /**
   * Get basic statistics about the repository
   */
  async getRepositoryStats(options: GitCochangeOptions): Promise<{
    totalCommits: number;
    analyzedCommits: number;
    timeSpan: string;
    oldestCommit: Date | null;
    newestCommit: Date | null;
  }> {
    try {
      const commits = await this.getCommitHistory(options);
      
      let oldestCommit: Date | null = null;
      let newestCommit: Date | null = null;
      
      if (commits.length > 0) {
        const dates = commits.map(c => c.date).sort((a, b) => a.getTime() - b.getTime());
        oldestCommit = dates[0] ?? null;
        newestCommit = dates[dates.length - 1] ?? null;
      }

      // Get total commit count
      const totalCommitsOutput = execSync('git rev-list --count HEAD', {
        cwd: this.repositoryRoot,
        encoding: 'utf8',
        timeout: this.timeout
      });
      
      return {
        totalCommits: parseInt(totalCommitsOutput.trim(), 10) || 0,
        analyzedCommits: commits.length,
        timeSpan: `${options.monthsBack} months`,
        oldestCommit,
        newestCommit
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get repository stats: ${error.message}`);
      }
      throw new Error(`Failed to get repository stats: ${String(error)}`);
    }
  }

  /**
   * Set the repository root directory
   */
  setRepositoryRoot(rootPath: string): void {
    this.repositoryRoot = rootPath;
  }

  /**
   * Set timeout for Git operations
   */
  setTimeout(timeoutMs: number): void {
    this.timeout = timeoutMs;
  }
}