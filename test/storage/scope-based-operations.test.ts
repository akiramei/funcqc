import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGLiteAdapter } from '../../src/storage/pglite-adapter.js';
import { SnapshotInfo, FunctionInfo, SourceFile } from '../../src/types/index.js';
import { mockPGLiteForPathValidation, getSafeTestDbPath } from '../test-utils.js';

// Mock PGLite to prevent filesystem operations
mockPGLiteForPathValidation();

// Mock the PGLiteAdapter
vi.mock('../../src/storage/pglite-adapter.js', () => ({
  PGLiteAdapter: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createSnapshot: vi.fn().mockResolvedValue(undefined),
    getSnapshots: vi.fn().mockResolvedValue([]),
    getSnapshot: vi.fn().mockResolvedValue(null),
    getLatestSnapshot: vi.fn().mockResolvedValue(null),
    insertFunctions: vi.fn().mockResolvedValue(undefined),
    getFunctionsBySnapshot: vi.fn().mockResolvedValue([]),
    insertSourceFiles: vi.fn().mockResolvedValue(undefined),
    getSourceFilesBySnapshot: vi.fn().mockResolvedValue([]),
    updateAnalysisLevel: vi.fn().mockResolvedValue(undefined)
  }))
}));

describe('Scope-Based Storage Operations', () => {
  let adapter: any;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = getSafeTestDbPath();
    const { PGLiteAdapter } = await import('../../src/storage/pglite-adapter.js');
    adapter = new PGLiteAdapter(testDbPath);
    await adapter.initialize();
    
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
    }
  });

  describe('Scope-Based Snapshots', () => {
    it('should create snapshots with scope information', async () => {
      const snapshotData = {
        id: 'test-snapshot-1',
        createdAt: new Date().toISOString(),
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          basicAnalysisCompleted: true
        },
        scope: 'src' as const
      };

      const mockSnapshot = { ...snapshotData };
      adapter.getSnapshots.mockResolvedValue([mockSnapshot]);

      await adapter.createSnapshot(snapshotData);
      const snapshots = await adapter.getSnapshots({ limit: 1 });

      expect(adapter.createSnapshot).toHaveBeenCalledWith(snapshotData);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].scope).toBe('src');
      expect(snapshots[0].id).toBe('test-snapshot-1');
    });

    it('should create snapshots with different scopes', async () => {
      const srcSnapshot = {
        id: 'src-snapshot',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 10, totalFiles: 5 },
        scope: 'src' as const
      };

      const testSnapshot = {
        id: 'test-snapshot',
        createdAt: new Date(Date.now() + 1000).toISOString(),
        metadata: { totalFunctions: 15, totalFiles: 3 },
        scope: 'test' as const
      };

      await adapter.createSnapshot(srcSnapshot);
      await adapter.createSnapshot(testSnapshot);

      const allSnapshots = await adapter.getSnapshots({ limit: 10 });
      expect(allSnapshots).toHaveLength(2);

      const srcSnap = allSnapshots.find(s => s.scope === 'src');
      const testSnap = allSnapshots.find(s => s.scope === 'test');

      expect(srcSnap).toBeDefined();
      expect(testSnap).toBeDefined();
      expect(srcSnap!.id).toBe('src-snapshot');
      expect(testSnap!.id).toBe('test-snapshot');
    });

    it('should default to src scope when scope not specified', async () => {
      const snapshotData = {
        id: 'default-scope-snapshot',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 5, totalFiles: 2 }
        // No scope specified
      };

      await adapter.createSnapshot(snapshotData);

      const snapshots = await adapter.getSnapshots({ limit: 1 });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].scope).toBe('src'); // Default scope
    });
  });

  describe('Scope-Based Filtering', () => {
    beforeEach(async () => {
      // Create test snapshots with different scopes
      const snapshots = [
        {
          id: 'src-snap-1',
          createdAt: '2024-01-01T10:00:00Z',
          metadata: { totalFunctions: 10, totalFiles: 5 },
          scope: 'src' as const
        },
        {
          id: 'src-snap-2',
          createdAt: '2024-01-01T11:00:00Z',
          metadata: { totalFunctions: 12, totalFiles: 6 },
          scope: 'src' as const
        },
        {
          id: 'test-snap-1',
          createdAt: '2024-01-01T12:00:00Z',
          metadata: { totalFunctions: 20, totalFiles: 10 },
          scope: 'test' as const
        },
        {
          id: 'all-snap-1',
          createdAt: '2024-01-01T13:00:00Z',
          metadata: { totalFunctions: 32, totalFiles: 16 },
          scope: 'all' as const
        }
      ];

      for (const snapshot of snapshots) {
        await adapter.createSnapshot(snapshot);
      }
    });

    it('should filter snapshots by scope', async () => {
      const srcSnapshots = await adapter.getSnapshots({ 
        limit: 10,
        scope: 'src'
      });

      expect(srcSnapshots).toHaveLength(2);
      expect(srcSnapshots.every(s => s.scope === 'src')).toBe(true);
      expect(srcSnapshots[0].id).toBe('src-snap-2'); // Latest first
      expect(srcSnapshots[1].id).toBe('src-snap-1');
    });

    it('should get latest snapshot by scope', async () => {
      const latestSrcSnapshot = await adapter.getLatestSnapshot('src');
      const latestTestSnapshot = await adapter.getLatestSnapshot('test');

      expect(latestSrcSnapshot).toBeDefined();
      expect(latestTestSnapshot).toBeDefined();
      expect(latestSrcSnapshot!.id).toBe('src-snap-2');
      expect(latestSrcSnapshot!.scope).toBe('src');
      expect(latestTestSnapshot!.id).toBe('test-snap-1');
      expect(latestTestSnapshot!.scope).toBe('test');
    });

    it('should get latest snapshot overall when no scope specified', async () => {
      const latestSnapshot = await adapter.getLatestSnapshot();

      expect(latestSnapshot).toBeDefined();
      expect(latestSnapshot!.id).toBe('all-snap-1'); // Most recent
      expect(latestSnapshot!.scope).toBe('all');
    });

    it('should return null for non-existent scope', async () => {
      const nonExistentSnapshot = await adapter.getLatestSnapshot('nonexistent');

      expect(nonExistentSnapshot).toBeNull();
    });
  });

  describe('Scope-Based Function Storage', () => {
    let testSnapshot: SnapshotInfo;

    beforeEach(async () => {
      testSnapshot = {
        id: 'function-test-snapshot',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 0, totalFiles: 0 },
        scope: 'src'
      };

      await adapter.createSnapshot(testSnapshot);
    });

    it('should store functions associated with scoped snapshot', async () => {
      const testFunctions: FunctionInfo[] = [
        {
          id: 'func-1',
          name: 'testFunction1',
          displayName: 'TestClass.testFunction1',
          filePath: 'src/test.ts',
          startLine: 10,
          endLine: 20,
          startColumn: 2,
          endColumn: 4,
          isExported: true,
          isAsync: false,
          parameters: [],
          returnType: 'void',
          modifiers: [],
          jsdoc: null,
          sourceCodeWithJSDoc: 'function testFunction1() {}',
          sourceCode: 'function testFunction1() {}',
          fnSignature: 'testFunction1(): void',
          loc: 11,
          semanticId: 'test-semantic-1',
          contentId: 'test-content-1'
        },
        {
          id: 'func-2',
          name: 'testFunction2',
          displayName: 'testFunction2',
          filePath: 'src/utils.ts',
          startLine: 5,
          endLine: 15,
          startColumn: 1,
          endColumn: 2,
          isExported: false,
          isAsync: true,
          parameters: [{ name: 'param1', type: 'string' }],
          returnType: 'Promise<void>',
          modifiers: [],
          jsdoc: null,
          sourceCodeWithJSDoc: 'async function testFunction2() {}',
          sourceCode: 'async function testFunction2() {}',
          fnSignature: 'testFunction2(param1: string): Promise<void>',
          loc: 11,
          semanticId: 'test-semantic-2',
          contentId: 'test-content-2'
        }
      ];

      await adapter.insertFunctions(testFunctions, testSnapshot.id);

      const retrievedFunctions = await adapter.getFunctionsBySnapshot(testSnapshot.id);
      expect(retrievedFunctions).toHaveLength(2);
      expect(retrievedFunctions[0].id).toBe('func-1');
      expect(retrievedFunctions[1].id).toBe('func-2');
    });

    it('should isolate functions between different scoped snapshots', async () => {
      // Create another snapshot with different scope
      const testScopeSnapshot = {
        id: 'test-scope-snapshot',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 0, totalFiles: 0 },
        scope: 'test' as const
      };

      await adapter.createSnapshot(testScopeSnapshot);

      // Insert functions into each snapshot
      const srcFunctions: FunctionInfo[] = [{
        id: 'src-func-1',
        name: 'srcFunction',
        displayName: 'srcFunction',
        filePath: 'src/main.ts',
        startLine: 1,
        endLine: 10,
        startColumn: 1,
        endColumn: 2,
        isExported: true,
        isAsync: false,
        parameters: [],
        returnType: 'void',
        modifiers: [],
        jsdoc: null,
        sourceCodeWithJSDoc: 'function srcFunction() {}',
        sourceCode: 'function srcFunction() {}',
        fnSignature: 'srcFunction(): void',
        loc: 10,
        semanticId: 'src-semantic-1',
        contentId: 'src-content-1'
      }];

      const testFunctions: FunctionInfo[] = [{
        id: 'test-func-1',
        name: 'testFunction',
        displayName: 'testFunction',
        filePath: 'test/main.test.ts',
        startLine: 1,
        endLine: 5,
        startColumn: 1,
        endColumn: 2,
        isExported: false,
        isAsync: false,
        parameters: [],
        returnType: 'void',
        modifiers: [],
        jsdoc: null,
        sourceCodeWithJSDoc: 'function testFunction() {}',
        sourceCode: 'function testFunction() {}',
        fnSignature: 'testFunction(): void',
        loc: 5,
        semanticId: 'test-semantic-1',
        contentId: 'test-content-1'
      }];

      await adapter.insertFunctions(srcFunctions, testSnapshot.id);
      await adapter.insertFunctions(testFunctions, testScopeSnapshot.id);

      // Verify isolation
      const srcSnapshotFunctions = await adapter.getFunctionsBySnapshot(testSnapshot.id);
      const testSnapshotFunctions = await adapter.getFunctionsBySnapshot(testScopeSnapshot.id);

      expect(srcSnapshotFunctions).toHaveLength(1);
      expect(testSnapshotFunctions).toHaveLength(1);
      expect(srcSnapshotFunctions[0].id).toBe('src-func-1');
      expect(testSnapshotFunctions[0].id).toBe('test-func-1');
    });
  });

  describe('Source Files with Scope', () => {
    let testSnapshot: SnapshotInfo;

    beforeEach(async () => {
      testSnapshot = {
        id: 'source-files-snapshot',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 0, totalFiles: 0 },
        scope: 'src'
      };

      await adapter.createSnapshot(testSnapshot);
    });

    it('should store source files associated with scoped snapshot', async () => {
      const sourceFiles: SourceFile[] = [
        {
          filePath: 'src/main.ts',
          fileContent: 'console.log("Hello, World!");',
          lastModified: new Date(),
          fileSize: 1024,
          linesOfCode: 10,
          hash: 'abc123'
        },
        {
          filePath: 'src/utils.ts',
          fileContent: 'export const util = () => {};',
          lastModified: new Date(),
          fileSize: 512,
          linesOfCode: 5,
          hash: 'def456'
        }
      ];

      await adapter.insertSourceFiles(sourceFiles, testSnapshot.id);

      const retrievedFiles = await adapter.getSourceFilesBySnapshot(testSnapshot.id);
      expect(retrievedFiles).toHaveLength(2);
      expect(retrievedFiles[0].filePath).toBe('src/main.ts');
      expect(retrievedFiles[1].filePath).toBe('src/utils.ts');
    });

    it('should isolate source files between different scoped snapshots', async () => {
      // Create test scope snapshot
      const testScopeSnapshot = {
        id: 'test-source-files-snapshot',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 0, totalFiles: 0 },
        scope: 'test' as const
      };

      await adapter.createSnapshot(testScopeSnapshot);

      // Insert different files into each snapshot
      const srcFiles: SourceFile[] = [{
        filePath: 'src/app.ts',
        fileContent: 'export class App {}',
        lastModified: new Date(),
        fileSize: 256,
        linesOfCode: 3,
        hash: 'src123'
      }];

      const testFiles: SourceFile[] = [{
        filePath: 'test/app.test.ts',
        fileContent: 'test("should work", () => {});',
        lastModified: new Date(),
        fileSize: 128,
        linesOfCode: 1,
        hash: 'test456'
      }];

      await adapter.insertSourceFiles(srcFiles, testSnapshot.id);
      await adapter.insertSourceFiles(testFiles, testScopeSnapshot.id);

      // Verify isolation
      const srcSnapshotFiles = await adapter.getSourceFilesBySnapshot(testSnapshot.id);
      const testSnapshotFiles = await adapter.getSourceFilesBySnapshot(testScopeSnapshot.id);

      expect(srcSnapshotFiles).toHaveLength(1);
      expect(testSnapshotFiles).toHaveLength(1);
      expect(srcSnapshotFiles[0].filePath).toBe('src/app.ts');
      expect(testSnapshotFiles[0].filePath).toBe('test/app.test.ts');
    });
  });

  describe('Analysis Level with Scope', () => {
    let testSnapshot: SnapshotInfo;

    beforeEach(async () => {
      testSnapshot = {
        id: 'analysis-level-snapshot',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 0, totalFiles: 0 },
        scope: 'src'
      };

      await adapter.createSnapshot(testSnapshot);
    });

    it('should update analysis level for scoped snapshot', async () => {
      await adapter.updateAnalysisLevel(testSnapshot.id, 'BASIC');

      const snapshot = await adapter.getSnapshot(testSnapshot.id);
      expect(snapshot).toBeDefined();
      expect(snapshot!.metadata?.analysisLevel).toBe('BASIC');
    });

    it('should isolate analysis levels between scoped snapshots', async () => {
      // Create another scoped snapshot
      const testScopeSnapshot = {
        id: 'test-analysis-snapshot',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 0, totalFiles: 0 },
        scope: 'test' as const
      };

      await adapter.createSnapshot(testScopeSnapshot);

      // Update analysis levels differently
      await adapter.updateAnalysisLevel(testSnapshot.id, 'BASIC');
      await adapter.updateAnalysisLevel(testScopeSnapshot.id, 'CALL_GRAPH');

      // Verify isolation
      const srcSnapshot = await adapter.getSnapshot(testSnapshot.id);
      const testSnapshot2 = await adapter.getSnapshot(testScopeSnapshot.id);

      expect(srcSnapshot!.metadata?.analysisLevel).toBe('BASIC');
      expect(testSnapshot2!.metadata?.analysisLevel).toBe('CALL_GRAPH');
    });
  });

  describe('Error Handling with Scopes', () => {
    it('should handle invalid scope gracefully', async () => {
      const invalidSnapshot = await adapter.getLatestSnapshot('invalid-scope');
      expect(invalidSnapshot).toBeNull();
    });

    it('should handle empty scope filter', async () => {
      const snapshots = await adapter.getSnapshots({ 
        limit: 10,
        scope: ''
      });
      // Should return all snapshots or handle gracefully
      expect(Array.isArray(snapshots)).toBe(true);
    });

    it('should maintain data integrity across scope operations', async () => {
      // Create multiple snapshots with same ID but different scopes (should fail)
      const snapshot1 = {
        id: 'duplicate-id',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 5, totalFiles: 2 },
        scope: 'src' as const
      };

      const snapshot2 = {
        id: 'duplicate-id',
        createdAt: new Date().toISOString(),
        metadata: { totalFunctions: 3, totalFiles: 1 },
        scope: 'test' as const
      };

      await adapter.createSnapshot(snapshot1);

      // This should fail due to unique constraint on ID
      await expect(adapter.createSnapshot(snapshot2)).rejects.toThrow();
    });
  });
});