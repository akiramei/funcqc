/**
 * Co-change Analysis Tests
 * 
 * Tests for the CochangeAnalyzer that analyzes type co-evolution patterns
 * from Git history to identify temporal coupling between types.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CochangeAnalyzer, GitProvider, GitCommitInfo } from '../../src/analyzers/type-insights/cochange-analyzer';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

// Mock storage interface
const createMockStorage = (): StorageQueryInterface => ({
  query: vi.fn()
});

class MockGitProvider implements GitProvider {
  private commits: GitCommitInfo[] = [];

  setCommits(commits: GitCommitInfo[]): void {
    this.commits = commits;
  }

  async getCommitHistory(options: {
    monthsBack: number;
    maxCommits: number;
    excludePaths: string[];
  }): Promise<GitCommitInfo[]> {
    // Filter commits based on excludePaths
    return Promise.resolve(
      this.commits.map(commit => ({
        ...commit,
        changedFiles: commit.changedFiles.filter(file => 
          !options.excludePaths.some(excludePath => file.includes(excludePath))
        )
      })).filter(commit => commit.changedFiles.length > 0)
    );
  }
}

describe('CochangeAnalyzer', () => {
  let storage: StorageQueryInterface;
  let gitProvider: MockGitProvider;
  let analyzer: CochangeAnalyzer;

  beforeEach(() => {
    storage = createMockStorage();
    gitProvider = new MockGitProvider();
    analyzer = new CochangeAnalyzer(storage, gitProvider, {
      monthsBack: 6,
      minChanges: 1,
      cochangeThreshold: 0.1,
      showMatrix: true,
      suggestModules: true,
      maxCommits: 100,
      excludePaths: []
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('analyze', () => {
    it('should return empty results when no Git provider is available', async () => {
      const analyzerWithoutGit = new CochangeAnalyzer(storage);
      const reports = await analyzerWithoutGit.analyze();

      expect(reports).toHaveLength(1);
      expect(reports[0]?.pattern).toEqual(['git-history-required']);
      expect(reports[0]?.suggestedAction).toBe('Git provider required for co-change analysis');
    });

    it('should return empty results when no types are found', async () => {
      // Mock empty type definitions
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: []
      });

      const reports = await analyzer.analyze();
      expect(reports).toHaveLength(0);
    });

    it('should analyze co-change patterns for types that change together', async () => {
      // Mock type definitions
      const typeDefinitions = [
        { id: 'type1', name: 'UserType', file_path: 'src/types/user.ts' },
        { id: 'type2', name: 'ProfileType', file_path: 'src/types/profile.ts' },
        { id: 'type3', name: 'ConfigType', file_path: 'src/config/types.ts' }
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: typeDefinitions
      });

      // Mock Git commits where UserType and ProfileType change together
      const commits: GitCommitInfo[] = [
        {
          hash: 'commit1',
          date: new Date('2024-01-01'),
          message: 'Update user and profile types',
          changedFiles: ['src/types/user.ts', 'src/types/profile.ts']
        },
        {
          hash: 'commit2',
          date: new Date('2024-01-02'),
          message: 'Fix user type validation',
          changedFiles: ['src/types/user.ts']
        },
        {
          hash: 'commit3',
          date: new Date('2024-01-03'),
          message: 'Update user and profile again',
          changedFiles: ['src/types/user.ts', 'src/types/profile.ts']
        },
        {
          hash: 'commit4',
          date: new Date('2024-01-04'),
          message: 'Update config',
          changedFiles: ['src/config/types.ts']
        }
      ];

      gitProvider.setCommits(commits);

      const reports = await analyzer.analyze();

      expect(reports).toHaveLength(1);
      
      const report = reports[0];
      if (!report) throw new Error('Report should exist');

      // Check basic report structure
      expect(report.id).toBe('cochange-analysis');
      expect(report.pattern).toEqual(['temporal-coupling']);

      // Check type changes
      expect(report.typeChanges).toHaveLength(3);
      
      // Find UserType changes
      const userTypeChanges = report.typeChanges.find(tc => tc.typeName === 'UserType');
      expect(userTypeChanges).toBeDefined();
      expect(userTypeChanges?.changeCount).toBe(3); // Changed in 3 commits

      // Find ProfileType changes
      const profileTypeChanges = report.typeChanges.find(tc => tc.typeName === 'ProfileType');
      expect(profileTypeChanges).toBeDefined();
      expect(profileTypeChanges?.changeCount).toBe(2); // Changed in 2 commits

      // Check co-change relationships
      expect(report.cochangeMatrix.length).toBeGreaterThan(0);
      
      // Should find UserType-ProfileType relationship
      const userProfileRelation = report.cochangeMatrix.find(
        rel => (rel.typeA === 'UserType' && rel.typeB === 'ProfileType') ||
               (rel.typeA === 'ProfileType' && rel.typeB === 'UserType')
      );
      expect(userProfileRelation).toBeDefined();
      expect(userProfileRelation?.cochangeFrequency).toBe(2); // Changed together in 2 commits
      expect(userProfileRelation?.temporalCoupling).toBeGreaterThan(0);

      // Check statistics
      expect(report.statistics.totalTypes).toBe(3);
      expect(report.statistics.analyzedCommits).toBe(4);
      expect(report.statistics.timeSpan).toBe('6 months');
    });

    it('should suggest module reorganization for highly coupled types', async () => {
      // Mock type definitions
      const typeDefinitions = [
        { id: 'type1', name: 'OrderType', file_path: 'src/order/types.ts' },
        { id: 'type2', name: 'PaymentType', file_path: 'src/payment/types.ts' },
        { id: 'type3', name: 'ShippingType', file_path: 'src/shipping/types.ts' }
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: typeDefinitions
      });

      // Create commits where Order, Payment, and Shipping frequently change together
      const commits: GitCommitInfo[] = [];
      for (let i = 0; i < 10; i++) {
        commits.push({
          hash: `commit${i}`,
          date: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
          message: `Update e-commerce types ${i}`,
          changedFiles: ['src/order/types.ts', 'src/payment/types.ts', 'src/shipping/types.ts']
        });
      }

      gitProvider.setCommits(commits);

      // Use lower threshold to trigger module suggestions
      const analyzerWithLowThreshold = new CochangeAnalyzer(storage, gitProvider, {
        monthsBack: 6,
        minChanges: 1,
        cochangeThreshold: 0.1,
        showMatrix: true,
        suggestModules: true,
        maxCommits: 100,
        excludePaths: []
      });

      const reports = await analyzerWithLowThreshold.analyze();
      
      expect(reports).toHaveLength(1);
      const report = reports[0];
      if (!report) throw new Error('Report should exist');

      // Should suggest module reorganization
      expect(report.moduleSuggestions.length).toBeGreaterThan(0);
      
      const suggestion = report.moduleSuggestions[0];
      if (!suggestion) throw new Error('Module suggestion should exist');

      expect(suggestion.types).toContain('OrderType');
      expect(suggestion.types).toContain('PaymentType');
      expect(suggestion.types).toContain('ShippingType');
      expect(suggestion.cohesion).toBeGreaterThan(0.5); // High internal cohesion
      expect(suggestion.migrationEffort).toBeDefined();
      expect(suggestion.benefits.length).toBeGreaterThan(0);
    });

    it('should filter results based on cochange threshold', async () => {
      // Mock type definitions
      const typeDefinitions = [
        { id: 'type1', name: 'TypeA', file_path: 'src/a.ts' },
        { id: 'type2', name: 'TypeB', file_path: 'src/b.ts' }
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: typeDefinitions
      });

      // Create commits with weak coupling
      const commits: GitCommitInfo[] = [
        {
          hash: 'commit1',
          date: new Date('2024-01-01'),
          message: 'Update A and B',
          changedFiles: ['src/a.ts', 'src/b.ts']
        },
        {
          hash: 'commit2',
          date: new Date('2024-01-02'),
          message: 'Update A only',
          changedFiles: ['src/a.ts']
        },
        {
          hash: 'commit3',
          date: new Date('2024-01-03'),
          message: 'Update A only again',
          changedFiles: ['src/a.ts']
        }
      ];

      gitProvider.setCommits(commits);

      // Use high threshold that should filter out weak relationships
      const analyzerWithHighThreshold = new CochangeAnalyzer(storage, gitProvider, {
        monthsBack: 6,
        minChanges: 1,
        cochangeThreshold: 0.8, // High threshold
        showMatrix: false, // Don't show matrix
        suggestModules: true,
        maxCommits: 100,
        excludePaths: []
      });

      const reports = await analyzerWithHighThreshold.analyze();
      
      expect(reports).toHaveLength(1);
      const report = reports[0];
      if (!report) throw new Error('Report should exist');

      // Should filter out weak relationships
      expect(report.cochangeMatrix.length).toBe(0);
    });

    it('should exclude specified paths from analysis', async () => {
      // Mock type definitions including test files
      const typeDefinitions = [
        { id: 'type1', name: 'AppType', file_path: 'src/app.ts' },
        { id: 'type2', name: 'TestType', file_path: 'test/fixtures.ts' }
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: typeDefinitions
      });

      // Create commits that change both app and test files
      const commits: GitCommitInfo[] = [
        {
          hash: 'commit1',
          date: new Date('2024-01-01'),
          message: 'Update app and tests',
          changedFiles: ['src/app.ts', 'test/fixtures.ts']
        }
      ];

      gitProvider.setCommits(commits);

      // Exclude test directory
      const analyzerWithExclusions = new CochangeAnalyzer(storage, gitProvider, {
        monthsBack: 6,
        minChanges: 1,
        cochangeThreshold: 0.1,
        showMatrix: true,
        suggestModules: true,
        maxCommits: 100,
        excludePaths: ['test/']
      });

      const reports = await analyzerWithExclusions.analyze();
      
      expect(reports).toHaveLength(1);
      const report = reports[0];
      if (!report) throw new Error('Report should exist');

      // Should only find AppType changes, TestType changes should be excluded
      const appTypeChanges = report.typeChanges.find(tc => tc.typeName === 'AppType');
      const testTypeChanges = report.typeChanges.find(tc => tc.typeName === 'TestType');
      
      expect(appTypeChanges).toBeDefined();
      expect(appTypeChanges?.changeCount).toBe(1);
      expect(testTypeChanges).toBeUndefined(); // Should be excluded due to minChanges filter
    });
  });

  describe('getCochangeConfiguration', () => {
    it('should return the current configuration', () => {
      const config = analyzer.getCochangeConfiguration();
      
      expect(config.monthsBack).toBe(6);
      expect(config.minChanges).toBe(1);
      expect(config.cochangeThreshold).toBe(0.1);
      expect(config.showMatrix).toBe(true);
      expect(config.suggestModules).toBe(true);
      expect(config.maxCommits).toBe(100);
      expect(config.excludePaths).toEqual([]);
    });
  });

  describe('multiple types and path mapping', () => {
    it('should handle multiple types per file correctly', async () => {
      const storage = createMockStorage();
      const gitProvider = new MockGitProvider();
      
      // Mock type definitions with multiple types in same file
      storage.query = vi.fn().mockResolvedValue({
        rows: [
          { id: 'type1', name: 'TypeA', file_path: 'src/types.ts' },
          { id: 'type2', name: 'TypeB', file_path: 'src/types.ts' },
          { id: 'type3', name: 'TypeC', file_path: 'src/other.ts' }
        ]
      });

      // Mock Git commits that change the file with multiple types
      gitProvider.setCommits([
        {
          hash: 'hash1',
          date: new Date('2024-01-01'),
          message: 'Update types',
          changedFiles: ['src/types.ts', 'src/other.ts']
        }
      ]);

      const testAnalyzer = new CochangeAnalyzer(
        storage,
        gitProvider,
        { monthsBack: 6, maxCommits: 100, excludePaths: [], suggestModules: true, minChanges: 1 }
      );

      const reports = await testAnalyzer.analyze();
      const report = reports[0];
      expect(report).toBeDefined();
      const names = report?.typeChanges.map(tc => tc.typeName) ?? [];
      expect(names).toEqual(expect.arrayContaining(['TypeA', 'TypeB']));
    });

    it('should normalize /virtualsrc/ paths correctly', async () => {
      const storage = createMockStorage();
      const gitProvider = new MockGitProvider();
      
      // Mock type definitions with /virtualsrc/ prefix
      storage.query = vi.fn().mockResolvedValue({
        rows: [
          { id: 'type1', name: 'TypeA', file_path: '/virtualsrc/types.ts' },
          { id: 'type2', name: 'TypeB', file_path: '/virtualsrc/components.ts' }
        ]
      });

      // Mock Git commits with normal src/ paths
      gitProvider.setCommits([
        {
          hash: 'hash1',
          date: new Date('2024-01-01'),
          message: 'Update types',
          changedFiles: ['src/types.ts']  // Note: no /virtualsrc/ prefix
        }
      ]);

      const testAnalyzer = new CochangeAnalyzer(
        storage,
        gitProvider,
        { monthsBack: 6, maxCommits: 100, excludePaths: [], suggestModules: true, minChanges: 1 }
      );

      const reports = await testAnalyzer.analyze();
      const report = reports[0];
      expect(report).toBeDefined();
      const names = report?.typeChanges.map(tc => tc.typeName) ?? [];
      expect(names).toContain('TypeA');
    });
  });

  describe('path normalization', () => {
    it('should normalize various path formats consistently', async () => {
      const storage = createMockStorage();
      const gitProvider = new MockGitProvider();
      
      // Test different path formats that should all normalize to 'src/types.ts'
      const pathVariations = [
        '/virtualsrc/types.ts',
        '/virtualsrc/src/types.ts', 
        'virtualsrc/types.ts',
        'virtualsrc/src/types.ts',
        './src/types.ts',
        '/src/types.ts',
        'src/types.ts'
      ];
      
      for (const pathVariant of pathVariations) {
        // Mock type definitions with the path variant
        storage.query = vi.fn().mockResolvedValue({
          rows: [
            { id: 'type1', name: 'TestType', file_path: pathVariant }
          ]
        });

        // Mock Git commits with normalized src/ path
        gitProvider.setCommits([
          {
            hash: 'hash1',
            date: new Date('2024-01-01'),
            message: 'Update types',
            changedFiles: ['src/types.ts']
          }
        ]);

        const testAnalyzer = new CochangeAnalyzer(
          storage,
          gitProvider,
          { monthsBack: 6, maxCommits: 100, excludePaths: [], suggestModules: true, minChanges: 1 }
        );

        const reports = await testAnalyzer.analyze();
        const report = reports[0];
        expect(report).toBeDefined();
        const names = report?.typeChanges.map(tc => tc.typeName) ?? [];
        expect(names).toContain('TestType');
      }
    });
  });
});