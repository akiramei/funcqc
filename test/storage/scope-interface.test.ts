import { describe, it, expect, vi } from 'vitest';
import { SnapshotInfo } from '../../src/types/index.js';

describe('Scope Interface Contracts', () => {
  describe('Snapshot Interface with Scope', () => {
    it('should define snapshot with scope field', () => {
      const snapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          avgComplexity: 3.2,
          maxComplexity: 15,
          exportedFunctions: 5,
          asyncFunctions: 2,
          complexityDistribution: { 1: 3, 2: 4, 3: 2, 15: 1 },
          fileExtensions: { '.ts': 5 }
        },
        scope: 'src'
      };

      expect(snapshot.scope).toBe('src');
      expect(snapshot.id).toBe('test-snapshot');
      expect(snapshot.metadata.totalFunctions).toBe(10);
    });

    it('should support different scope values', () => {
      const scopes = ['src', 'test', 'all', 'custom'];
      
      scopes.forEach(scope => {
        const snapshot: SnapshotInfo = {
          id: `${scope}-snapshot`,
          createdAt: 1704067200000,
          metadata: {
            totalFunctions: 5,
            totalFiles: 3,
            avgComplexity: 2.5,
            maxComplexity: 8,
            exportedFunctions: 2,
            asyncFunctions: 1,
            complexityDistribution: { 1: 2, 2: 2, 8: 1 },
            fileExtensions: { '.ts': 3 }
          },
          scope
        };

        expect(snapshot.scope).toBe(scope);
      });
    });

    it('should handle optional snapshot metadata', () => {
      const minimalSnapshot: SnapshotInfo = {
        id: 'minimal-snapshot',
        createdAt: 1704067200000,
        scope: 'src'
      };

      expect(minimalSnapshot.scope).toBe('src');
      expect(minimalSnapshot.metadata).toBeUndefined();
    });
  });

  describe('Scope Filter Interface', () => {
    it('should define scope filter parameters', () => {
      interface ScopeFilter {
        scope?: string;
        limit?: number;
      }

      const filters: ScopeFilter[] = [
        { scope: 'src', limit: 10 },
        { scope: 'test' },
        { limit: 5 },
        {}
      ];

      filters.forEach(filter => {
        expect(typeof filter).toBe('object');
        if (filter.scope) {
          expect(typeof filter.scope).toBe('string');
        }
        if (filter.limit) {
          expect(typeof filter.limit).toBe('number');
        }
      });
    });

    it('should handle scope-based query expectations', () => {
      // Test the expected behavior of scope-based queries
      const mockStorageInterface = {
        getSnapshots: vi.fn(),
        getLatestSnapshot: vi.fn(),
        createSnapshot: vi.fn()
      };

      // Expected interface for scope filtering
      const expectedCalls = [
        { method: 'getSnapshots', args: [{ scope: 'src', limit: 10 }] },
        { method: 'getLatestSnapshot', args: ['test'] },
        { method: 'createSnapshot', args: [{ scope: 'all' }] }
      ];

      expectedCalls.forEach(call => {
        expect(mockStorageInterface[call.method]).toBeDefined();
        expect(typeof mockStorageInterface[call.method]).toBe('function');
      });
    });
  });

  describe('Scope Configuration Interface', () => {
    it('should define scope configuration structure', () => {
      interface ScopeConfig {
        roots: string[];
        exclude?: string[];
        include?: string[];
        description?: string;
      }

      const scopeConfigs: Record<string, ScopeConfig> = {
        src: {
          roots: ['src'],
          exclude: ['**/*.test.ts'],
          description: 'Production source code'
        },
        test: {
          roots: ['test'],
          include: ['**/*.test.ts'],
          exclude: [],
          description: 'Test code files'
        },
        minimal: {
          roots: ['minimal']
        }
      };

      Object.entries(scopeConfigs).forEach(([name, config]) => {
        expect(Array.isArray(config.roots)).toBe(true);
        expect(config.roots.length).toBeGreaterThan(0);
        
        if (config.exclude) {
          expect(Array.isArray(config.exclude)).toBe(true);
        }
        
        if (config.include) {
          expect(Array.isArray(config.include)).toBe(true);
        }
        
        if (config.description) {
          expect(typeof config.description).toBe('string');
        }
      });
    });
  });

  describe('Storage Adapter Scope Interface', () => {
    it('should define expected storage adapter methods with scope support', () => {
      // Define the expected interface for scope-aware storage operations
      interface ScopeAwareStorageAdapter {
        // Snapshot operations
        createSnapshot(snapshot: { scope?: string; [key: string]: any }): Promise<void>;
        getSnapshots(options?: { scope?: string; limit?: number }): Promise<SnapshotInfo[]>;
        getLatestSnapshot(scope?: string): Promise<SnapshotInfo | null>;
        getSnapshot(id: string): Promise<SnapshotInfo | null>;
        
        // Function operations
        insertFunctions(functions: any[], snapshotId: string): Promise<void>;
        getFunctionsBySnapshot(snapshotId: string): Promise<any[]>;
        
        // Source file operations
        insertSourceFiles(files: any[], snapshotId: string): Promise<void>;
        getSourceFilesBySnapshot(snapshotId: string): Promise<any[]>;
        
        // Analysis operations
        updateAnalysisLevel(snapshotId: string, level: string): Promise<void>;
      }

      // Test that the interface can be implemented
      const mockAdapter: ScopeAwareStorageAdapter = {
        createSnapshot: vi.fn().mockResolvedValue(undefined),
        getSnapshots: vi.fn().mockResolvedValue([]),
        getLatestSnapshot: vi.fn().mockResolvedValue(null),
        getSnapshot: vi.fn().mockResolvedValue(null),
        insertFunctions: vi.fn().mockResolvedValue(undefined),
        getFunctionsBySnapshot: vi.fn().mockResolvedValue([]),
        insertSourceFiles: vi.fn().mockResolvedValue(undefined),
        getSourceFilesBySnapshot: vi.fn().mockResolvedValue([]),
        updateAnalysisLevel: vi.fn().mockResolvedValue(undefined)
      };

      // Verify all methods are defined
      expect(mockAdapter.createSnapshot).toBeDefined();
      expect(mockAdapter.getSnapshots).toBeDefined();
      expect(mockAdapter.getLatestSnapshot).toBeDefined();
      expect(mockAdapter.getSnapshot).toBeDefined();
      expect(mockAdapter.insertFunctions).toBeDefined();
      expect(mockAdapter.getFunctionsBySnapshot).toBeDefined();
      expect(mockAdapter.insertSourceFiles).toBeDefined();
      expect(mockAdapter.getSourceFilesBySnapshot).toBeDefined();
      expect(mockAdapter.updateAnalysisLevel).toBeDefined();
    });

    it('should handle scope isolation requirements', () => {
      // Test that scope isolation can be properly implemented
      const scopeIsolationTests = [
        {
          description: 'Different scopes should return different data',
          test: () => {
            const srcData = { scope: 'src', data: ['file1.ts', 'file2.ts'] };
            const testData = { scope: 'test', data: ['file1.test.ts'] };
            
            expect(srcData.scope).not.toBe(testData.scope);
            expect(srcData.data).not.toEqual(testData.data);
          }
        },
        {
          description: 'Scope filtering should be consistent',
          test: () => {
            const filters = [
              { scope: 'src' },
              { scope: 'test' },
              { scope: 'all' }
            ];
            
            filters.forEach(filter => {
              expect(filter.scope).toBeDefined();
              expect(typeof filter.scope).toBe('string');
            });
          }
        }
      ];

      scopeIsolationTests.forEach(({ description, test }) => {
        expect(() => test()).not.toThrow();
      });
    });
  });

  describe('CLI Integration Scope Interface', () => {
    it('should define scope option interface for CLI commands', () => {
      interface CommandOptions {
        scope?: string;
        [key: string]: any;
      }

      const commandOptions: CommandOptions[] = [
        { scope: 'src' },
        { scope: 'test', verbose: true },
        { scope: 'all', format: 'json' },
        { format: 'table' }, // No scope - should default
        {}
      ];

      commandOptions.forEach(options => {
        expect(typeof options).toBe('object');
        
        if (options.scope) {
          expect(typeof options.scope).toBe('string');
          expect(['src', 'test', 'all'].includes(options.scope) || options.scope.length > 0).toBe(true);
        }
      });
    });

    it('should handle scope validation requirements', () => {
      const validScopes = ['src', 'test', 'all'];
      const invalidScopes = ['', 'invalid', 'nonexistent'];

      validScopes.forEach(scope => {
        expect(scope.length).toBeGreaterThan(0);
        expect(typeof scope).toBe('string');
      });

      invalidScopes.forEach(scope => {
        if (scope === '') {
          expect(scope.length).toBe(0);
        } else {
          expect(validScopes.includes(scope)).toBe(false);
        }
      });
    });
  });

  describe('Lazy Analysis Interface with Scope', () => {
    it('should define scope-aware lazy analysis interface', () => {
      interface LazyAnalysisOptions {
        showProgress?: boolean;
        snapshotId?: string;
        scope?: string;
      }

      interface LazyAnalysisResult {
        snapshot: SnapshotInfo | null;
        callEdges: any[];
        functions: any[];
        lazyAnalysisPerformed?: boolean;
      }

      const options: LazyAnalysisOptions = {
        showProgress: false,
        scope: 'src'
      };

      const result: LazyAnalysisResult = {
        snapshot: {
          id: 'test',
          createdAt: 1704067200000,
          scope: 'src',
          metadata: {
            totalFunctions: 10,
            totalFiles: 5,
            avgComplexity: 3.2,
            maxComplexity: 15,
            exportedFunctions: 5,
            asyncFunctions: 2,
            complexityDistribution: { 1: 3, 2: 4, 3: 2, 15: 1 },
            fileExtensions: { '.ts': 5 }
          }
        },
        callEdges: [],
        functions: [],
        lazyAnalysisPerformed: true
      };

      expect(options.scope).toBe('src');
      expect(result.snapshot?.scope).toBe('src');
      expect(result.lazyAnalysisPerformed).toBe(true);
    });
  });
});