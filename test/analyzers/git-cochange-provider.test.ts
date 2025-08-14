/**
 * Git Co-change Provider Tests
 * 
 * Tests for the GitCochangeProvider that extracts commit history
 * and file change patterns for temporal coupling analysis.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitCochangeProvider } from '../../src/analyzers/type-insights/git-cochange-provider';
import { execFileSync } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  execFileSync: vi.fn()
}));

const mockExecFileSync = vi.mocked(execFileSync);

describe('GitCochangeProvider', () => {
  let provider: GitCochangeProvider;

  beforeEach(() => {
    provider = new GitCochangeProvider('/test/repo', 30000);
    vi.clearAllMocks();
    // Set default mock implementation to handle any execFileSync call
    mockExecFileSync.mockImplementation(() => '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCommitHistory', () => {
    it('should parse git log output correctly', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|First commit
src/types/user.ts
src/types/profile.ts

hash2|2024-01-02 11:00:00 +0000|Second commit
src/utils/helpers.ts
src/types/user.ts

hash3|2024-01-03 12:00:00 +0000|Third commit
src/config/types.ts`;

      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: []
      };

      const commits = await provider.getCommitHistory(options);

      expect(commits).toHaveLength(3);
      
      // Check first commit
      expect(commits[0]?.hash).toBe('hash3');
      expect(commits[0]?.message).toBe('Third commit');
      expect(commits[0]?.changedFiles).toEqual(['src/config/types.ts']);

      // Check second commit
      expect(commits[1]?.hash).toBe('hash2');
      expect(commits[1]?.message).toBe('Second commit');
      expect(commits[1]?.changedFiles).toEqual(['src/utils/helpers.ts', 'src/types/user.ts']);

      // Check third commit (chronologically first)
      expect(commits[2]?.hash).toBe('hash1');
      expect(commits[2]?.message).toBe('First commit');
      expect(commits[2]?.changedFiles).toEqual(['src/types/user.ts', 'src/types/profile.ts']);
    });

    it('should filter out non-TypeScript files', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|Mixed files

src/types/user.ts
package.json
README.md
src/utils/helper.tsx
src/types/config.d.ts
test/user.test.ts
src/types/api.spec.ts`;

      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: []
      };

      const commits = await provider.getCommitHistory(options);

      expect(commits).toHaveLength(1);
      expect(commits[0]?.changedFiles).toEqual([
        'src/types/user.ts',
        'src/utils/helper.tsx'
        // Should exclude: package.json, README.md, .d.ts files, .test.ts files, .spec.ts files
      ]);
    });

    it('should handle exclude paths correctly', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|Commit with excludes

src/types/user.ts
node_modules/package/index.ts
test/fixtures/types.ts`;

      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: ['node_modules', 'test/']
      };

      const commits = await provider.getCommitHistory(options);

      expect(commits).toHaveLength(1);
      expect(commits[0]?.changedFiles).toEqual(['src/types/user.ts']);
    });

    it('should normalize file paths correctly', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|Path normalization

./src/types/user.ts
src\\\\config\\\\types.ts`;

      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: []
      };

      const commits = await provider.getCommitHistory(options);

      expect(commits).toHaveLength(1);
      expect(commits[0]?.changedFiles).toEqual([
        'src/types/user.ts',
        'src/config/types.ts'
      ]);
    });

    it('should handle empty commits correctly', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|Empty commit


hash2|2024-01-02 11:00:00 +0000|Commit with files

src/types/user.ts`;

      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: []
      };

      const commits = await provider.getCommitHistory(options);

      // Should only return commits with changed files
      expect(commits).toHaveLength(1);
      expect(commits[0]?.hash).toBe('hash2');
      expect(commits[0]?.changedFiles).toEqual(['src/types/user.ts']);
    });

    it('should handle malformed git output gracefully', async () => {
      const mockGitOutput = `invalid|line|format
hash1|2024-01-01 10:00:00 +0000|Valid commit

src/types/user.ts

|missing|hash

hash2|invalid-date|Another commit

src/types/config.ts`;

      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: []
      };

      const commits = await provider.getCommitHistory(options);

      // Should only return valid commits (hash1 is valid, hash2 has invalid date)
      expect(commits).toHaveLength(1);
      expect(commits[0]?.hash).toBe('hash1');
      expect(commits[0]?.changedFiles).toEqual(['src/types/user.ts']);
    });

    it('should construct correct git command with options', async () => {
      const mockGitOutput = '';
      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 3,
        maxCommits: 500,
        excludePaths: ['test/', 'node_modules/']
      };

      await provider.getCommitHistory(options);

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining([
          'log',
          expect.stringMatching(/--since=/),
          '--pretty=format:%H|%ci|%s',
          '--name-only',
          '--max-count=500',
          '--',
          '.',
          ':(exclude)test/',
          ':(exclude)node_modules/'
        ]),
        expect.objectContaining({
          cwd: '/test/repo',
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024
        })
      );

      const gitArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(gitArgs).toContain('--max-count=500');
      expect(gitArgs.some(arg => arg.startsWith('--since='))).toBe(true);
      expect(gitArgs).toContain(':(exclude)test/');
      expect(gitArgs).toContain(':(exclude)node_modules/');
    });

    it('should throw error on git command failure', async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('Git command failed');
      });

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: []
      };

      await expect(provider.getCommitHistory(options))
        .rejects.toThrow('Failed to get Git commit history: git log --since=');
    });
  });

  describe('getCommitFiles', () => {
    it('should get files for a specific commit', async () => {
      const mockGitOutput = `
src/types/user.ts
src/types/profile.ts
package.json`;

      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const files = await provider.getCommitFiles('hash123');

      expect(files).toEqual(['src/types/user.ts', 'src/types/profile.ts']);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['show', '--no-patch', '--name-only', '--pretty=format:', 'hash123'],
        expect.objectContaining({
          cwd: '/test/repo',
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024
        })
      );
    });

    it('should throw error on commit files failure', async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('Invalid commit hash');
      });

      await expect(provider.getCommitFiles('invalid-hash'))
        .rejects.toThrow('Failed to get commit files for invalid-hash: git show --no-patch --name-only --pretty=format: invalid-hash failed: Invalid commit hash');
    });
  });

  describe('getCochangeFrequency', () => {
    it('should calculate co-change frequency between files', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|First commit

src/types/user.ts
src/types/profile.ts

hash2|2024-01-02 11:00:00 +0000|Second commit

src/types/user.ts
src/utils/helpers.ts

hash3|2024-01-03 12:00:00 +0000|Third commit

src/types/user.ts
src/types/profile.ts`;

      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: []
      };

      const frequency = await provider.getCochangeFrequency(
        'src/types/user.ts',
        'src/types/profile.ts',
        options
      );

      // user.ts and profile.ts changed together in 2 commits
      expect(frequency).toBe(2);
    });
  });

  describe('utility methods', () => {
    it('should check Git availability', async () => {
      mockExecFileSync.mockReturnValueOnce('git version 2.39.0');
      
      const isAvailable = await provider.isGitAvailable();
      expect(isAvailable).toBe(true);

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['--version'],
        expect.objectContaining({
          cwd: '/test/repo',
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 10 * 1024 * 1024
        })
      );
    });

    it('should handle Git not available', async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('Git not found');
      });
      
      const isAvailable = await provider.isGitAvailable();
      expect(isAvailable).toBe(false);
    });

    it('should check if directory is Git repository', async () => {
      mockExecFileSync.mockReturnValueOnce('.git');
      
      const isRepo = await provider.isGitRepository();
      expect(isRepo).toBe(true);

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--git-dir'],
        expect.objectContaining({
          cwd: '/test/repo',
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 10 * 1024 * 1024
        })
      );
    });

    it('should handle non-Git directory', async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('Not a git repository');
      });
      
      const isRepo = await provider.isGitRepository();
      expect(isRepo).toBe(false);
    });

    it('should get repository root', async () => {
      mockExecFileSync.mockReturnValueOnce('/path/to/repo\n');
      
      const root = await provider.getRepositoryRoot();
      expect(root).toBe('/path/to/repo');

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--show-toplevel'],
        expect.objectContaining({
          cwd: '/test/repo',
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 10 * 1024 * 1024
        })
      );
    });

    it('should get repository statistics', async () => {
      // Mock getCommitHistory call
      provider.getCommitHistory = vi.fn().mockResolvedValueOnce([
        {
          hash: 'hash1',
          date: new Date('2024-01-01'),
          message: 'First',
          changedFiles: ['file1.ts']
        },
        {
          hash: 'hash2',
          date: new Date('2024-01-02'),
          message: 'Second',
          changedFiles: ['file2.ts']
        }
      ]);

      // Mock total commit count
      mockExecFileSync.mockReturnValueOnce('150\n');

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: []
      };

      const stats = await provider.getRepositoryStats(options);

      expect(stats.totalCommits).toBe(150);
      expect(stats.analyzedCommits).toBe(2);
      expect(stats.timeSpan).toBe('6 months');
      expect(stats.oldestCommit).toEqual(new Date('2024-01-01'));
      expect(stats.newestCommit).toEqual(new Date('2024-01-02'));
    });
  });

  describe('input validation', () => {
    it('should handle negative monthsBack gracefully', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|Test commit\n\nsrc/types/user.ts`;
      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: -5, // Invalid negative value
        maxCommits: 100,
        excludePaths: []
      };

      const commits = await provider.getCommitHistory(options);
      
      // Should still work but with normalized monthsBack (0)
      expect(commits).toHaveLength(1);
      
      // Check that git command was called with --since using current date (monthsBack=0)
      const gitArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      const sinceArg = gitArgs.find(arg => arg.startsWith('--since='));
      expect(sinceArg).toBeDefined();
      // Should be today's date since monthsBack was normalized to 0
    });

    it('should handle invalid maxCommits gracefully', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|Test commit\n\nsrc/types/user.ts`;
      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: -10, // Invalid negative value
        excludePaths: []
      };

      const commits = await provider.getCommitHistory(options);
      
      // Should still work but with normalized maxCommits (clamped to 1)
      expect(commits).toHaveLength(1);
      
      // Check that git command was called with normalized max-count (negative clamped to 1)
      const gitArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(gitArgs).toContain('--max-count=1');
    });

    it('should handle NaN values gracefully', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|Test commit\n\nsrc/types/user.ts`;
      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: NaN,
        maxCommits: NaN,
        excludePaths: []
      };

      const commits = await provider.getCommitHistory(options);
      
      // Should use default values (monthsBack=0, maxCommits=1000)
      expect(commits).toHaveLength(1);
      
      const gitArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(gitArgs).toContain('--max-count=1000');
    });

    it('should filter empty exclude paths', async () => {
      const mockGitOutput = `hash1|2024-01-01 10:00:00 +0000|Test commit\n\nsrc/types/user.ts`;
      mockExecFileSync.mockReturnValueOnce(mockGitOutput);

      const options = {
        monthsBack: 6,
        maxCommits: 100,
        excludePaths: ['  ', '', 'node_modules/', '   test/   ', '']
      };

      await provider.getCommitHistory(options);
      
      // Should only include non-empty, trimmed paths
      const gitArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(gitArgs).toContain(':(exclude)node_modules/');
      expect(gitArgs).toContain(':(exclude)test/');
      // Should not contain empty or whitespace-only excludes
      expect(gitArgs.filter(arg => arg === ':(exclude)')).toHaveLength(0);
      expect(gitArgs.filter(arg => arg === ':(exclude)  ')).toHaveLength(0);
    });

    it('should normalize repository stats with invalid monthsBack', async () => {
      // Mock getCommitHistory call
      provider.getCommitHistory = vi.fn().mockResolvedValueOnce([
        {
          hash: 'hash1',
          date: new Date('2024-01-01'),
          message: 'Test',
          changedFiles: ['file1.ts']
        }
      ]);

      // Mock total commit count
      mockExecFileSync.mockReturnValueOnce('42\n');

      const options = {
        monthsBack: -3, // Invalid negative value
        maxCommits: 100,
        excludePaths: []
      };

      const stats = await provider.getRepositoryStats(options);

      // Should normalize monthsBack to 0 for display
      expect(stats.timeSpan).toBe('0 months');
      expect(stats.analyzedCommits).toBe(1);
      expect(stats.totalCommits).toBe(42);
    });
  });

  describe('configuration methods', () => {
    it('should set repository root', () => {
      provider.setRepositoryRoot('/new/path');
      // No direct way to test this, but it should not throw
    });

    it('should set timeout', () => {
      provider.setTimeout(60000);
      // No direct way to test this, but it should not throw
    });
  });
});