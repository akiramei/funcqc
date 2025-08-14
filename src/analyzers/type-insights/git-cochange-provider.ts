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

      return this.parseGitLogOutput(output, options.excludePaths);
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
  private parseGitLogOutput(output: string, excludePaths: string[] = []): GitCommitInfo[] {
    const commits: GitCommitInfo[] = [];
    
    // Split output into lines and group by commits
    const lines = output.split('\n');
    let currentCommit: { header: string; files: string[] } | null = null;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) {
        continue;
      }
      
      // Check if this is a commit header
      if (this.isValidCommitHeader(trimmedLine)) {
        // Process previous commit if exists
        if (currentCommit) {
          this.processCommit(currentCommit, commits, excludePaths);
        }
        
        // Start new commit
        currentCommit = { header: trimmedLine, files: [] };
      } else if (trimmedLine.includes('|') && trimmedLine.split('|').length >= 3) {
        // This looks like a malformed commit header, reset current commit
        if (currentCommit) {
          this.processCommit(currentCommit, commits, excludePaths);
        }
        currentCommit = null;
      } else if (currentCommit) {
        // This is a file line for the current commit
        currentCommit.files.push(trimmedLine);
      }
      // Ignore lines that don't belong to any commit
    }
    
    // Process the last commit
    if (currentCommit) {
      this.processCommit(currentCommit, commits, excludePaths);
    }

    return commits.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /**
   * Process a single commit and add it to the commits array if it has TypeScript files
   */
  private processCommit(commit: { header: string; files: string[] }, commits: GitCommitInfo[], excludePaths: string[]): void {
    const [hash, dateStr, ...messageParts] = commit.header.split('|');
    if (!hash || !dateStr) return;

    const message = messageParts.join('|').trim();
    const date = new Date(dateStr);
    
    // Skip commits with invalid dates
    if (isNaN(date.getTime())) return;
    
    // Process files
    const normalizedFiles = commit.files.map(file => this.normalizeFilePath(file));
    const tsFiles = normalizedFiles
      .filter(file => this.isTypeScriptFile(file))
      .filter(file => !this.isExcludedPath(file, excludePaths));
    
    
    // Only add commits that have TypeScript files
    if (tsFiles.length > 0) {
      commits.push({
        hash: hash.trim(),
        date,
        message,
        changedFiles: tsFiles
      });
    }
  }

  /**
   * Normalize file path for consistent comparison
   */
  private normalizeFilePath(filePath: string): string {
    // Convert backslashes to forward slashes and remove redundant separators
    const normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
    
    // Remove leading ./ if present
    return normalized.startsWith('./') ? normalized.slice(2) : normalized;
  }

  /**
   * Check if a file path should be excluded based on exclude patterns
   */
  private isExcludedPath(filePath: string, excludePaths: string[]): boolean {
    return excludePaths.some(pattern => {
      // Handle both exact path matches and prefix matches
      if (pattern.endsWith('/')) {
        // Directory pattern - check if file path starts with this directory
        return filePath.startsWith(pattern) || filePath.startsWith(pattern.slice(0, -1) + '/');
      } else {
        // Exact path or partial match
        return filePath.includes(pattern);
      }
    });
  }

  /**
   * Check if a line is a valid commit header (hash|date|message format)
   */
  private isValidCommitHeader(line: string): boolean {
    const parts = line.split('|');
    if (parts.length < 3) return false;
    
    const [hash, dateStr, ...messageParts] = parts;
    
    // Basic validation: hash should not be empty and should look like a hash
    if (!hash || !hash.trim()) return false;
    
    // Date string should be parseable
    if (!dateStr || !dateStr.trim()) return false;
    const date = new Date(dateStr.trim());
    if (isNaN(date.getTime())) return false;
    
    // Message part should exist (can be empty but at least one part)
    if (messageParts.length === 0) return false;
    
    return true;
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