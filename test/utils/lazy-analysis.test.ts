import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import {
  isCallGraphAnalysisRequired,
  ensureCallGraphData,
  loadCallGraphWithLazyAnalysis,
  validateCallGraphRequirements,
  createLazyAnalysisMessage
} from '../../src/utils/lazy-analysis.js';
import { CommandEnvironment } from '../../src/types/environment.js';
import { StorageAdapter, SnapshotInfo, CallEdge, FunctionInfo } from '../../src/types/index.js';
import { FuncqcConfig } from '../../src/types/index.js';
import { mockPGLiteForPathValidation } from '../test-utils.js';

// Mock PGLite to prevent filesystem operations
mockPGLiteForPathValidation();

// Mock dependencies
vi.mock('../../src/core/analyzer.js');
vi.mock('ora');

describe('Lazy Analysis Utilities', () => {
  let mockStorage: MockedFunction<StorageAdapter>;
  let mockEnvironment: CommandEnvironment;
  let mockConfig: FuncqcConfig;

  beforeEach(() => {
    // Create mock storage
    mockStorage = {
      getSnapshots: vi.fn(),
      getSnapshot: vi.fn(),
      getLatestSnapshot: vi.fn(),
      getFunctionsBySnapshot: vi.fn(),
      findFunctionsInSnapshot: vi.fn(),
      getSourceFilesBySnapshot: vi.fn(),
      getCallEdgesBySnapshot: vi.fn(),
      insertCallEdges: vi.fn(),
      insertInternalCallEdges: vi.fn(),
      updateAnalysisLevel: vi.fn(),
      initialize: vi.fn(),
      close: vi.fn()
    } as any;

    mockConfig = {
      roots: ['src'],
      exclude: ['**/*.test.ts'],
      storage: { type: 'pglite', path: '.test.db' },
      metrics: {
        complexityThreshold: 10,
        cognitiveComplexityThreshold: 15,
        linesOfCodeThreshold: 40,
        parameterCountThreshold: 4,
        maxNestingLevelThreshold: 3
      },
      git: { enabled: false, autoLabel: false }
    };

    mockEnvironment = {
      storage: mockStorage,
      config: mockConfig,
      commandLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isCallGraphAnalysisRequired', () => {
    it('should return false when no snapshots exist', async () => {
      mockStorage.getSnapshots.mockResolvedValue([]);

      const result = await isCallGraphAnalysisRequired(mockStorage);

      expect(result.required).toBe(false);
      expect(result.snapshot).toBeNull();
      expect(result.reason).toBe('No snapshots found');
    });

    it('should return false when call graph analysis is already completed', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          callGraphAnalysisCompleted: true
        },
        scope: 'src'
      };

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);

      const result = await isCallGraphAnalysisRequired(mockStorage);

      expect(result.required).toBe(false);
      expect(result.snapshot).toEqual(mockSnapshot);
      expect(result.reason).toBe('Call graph analysis already completed');
    });

    it('should return false when basic analysis is not completed', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          basicAnalysisCompleted: false
        },
        scope: 'src'
      };

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);

      const result = await isCallGraphAnalysisRequired(mockStorage);

      expect(result.required).toBe(false);
      expect(result.snapshot).toEqual(mockSnapshot);
      expect(result.reason).toBe('Basic analysis not completed - run `funcqc scan` first');
    });

    it('should return true when call graph analysis is required', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          basicAnalysisCompleted: true,
          callGraphAnalysisCompleted: false
        },
        scope: 'src'
      };

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);

      const result = await isCallGraphAnalysisRequired(mockStorage);

      expect(result.required).toBe(true);
      expect(result.snapshot).toEqual(mockSnapshot);
      expect(result.reason).toBe('Call graph analysis required for dependency commands');
    });

    it('should handle snapshot without metadata', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: undefined,
        scope: 'src'
      };

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);

      const result = await isCallGraphAnalysisRequired(mockStorage);

      expect(result.required).toBe(false);
      expect(result.reason).toBe('Basic analysis not completed - run `funcqc scan` first');
    });
  });

  describe('ensureCallGraphData', () => {
    it('should return existing call graph data when not required', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          callGraphAnalysisCompleted: true
        },
        scope: 'src'
      };

      const mockCallEdges: CallEdge[] = [
        {
          id: 'edge-1',
          callerFunctionId: 'func-1',
          calleeFunctionId: 'func-2',
          callType: 'direct',
          callSite: { line: 5, column: 10 }
        }
      ];

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);
      mockStorage.getCallEdgesBySnapshot.mockResolvedValue(mockCallEdges);

      const result = await ensureCallGraphData(mockEnvironment, { showProgress: false });

      expect(result.success).toBe(true);
      expect(result.snapshot).toEqual(mockSnapshot);
      expect(result.callEdges).toEqual(mockCallEdges);
      expect(result.message).toBe('Existing call graph data loaded');
    });

    it('should perform call graph analysis when required', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          basicAnalysisCompleted: true,
          callGraphAnalysisCompleted: false
        },
        scope: 'src'
      };

      const mockSourceFiles = [
        {
          filePath: 'src/test.ts',
          fileContent: 'function test() {}',
          lastModified: new Date(),
          fileSize: 100,
          linesOfCode: 3,
          hash: 'abc123'
        }
      ];

      const mockFunctions: FunctionInfo[] = [
        {
          id: 'func-1',
          name: 'test',
          displayName: 'test',
          filePath: 'src/test.ts',
          startLine: 1,
          endLine: 3,
          startColumn: 1,
          endColumn: 2,
          isExported: false,
          isAsync: false,
          parameters: [],
          returnType: 'void',
          modifiers: [],
          jsdoc: null,
          sourceCodeWithJSDoc: 'function test() {}',
          sourceCode: 'function test() {}',
          fnSignature: 'test(): void',
          loc: 3,
          semanticId: 'test-semantic',
          contentId: 'test-content'
        }
      ];

      const mockCallEdges: CallEdge[] = [
        {
          id: 'edge-1',
          callerFunctionId: 'func-1',
          calleeFunctionId: 'func-2',
          callType: 'direct',
          callSite: { line: 2, column: 5 }
        }
      ];

      // Mock the analyzer
      const mockAnalyzer = {
        analyzeCallGraphFromContent: vi.fn().mockResolvedValue({
          callEdges: mockCallEdges,
          internalCallEdges: []
        })
      };

      const { FunctionAnalyzer } = await import('../../src/core/analyzer.js');
      vi.mocked(FunctionAnalyzer).mockImplementation(() => mockAnalyzer as any);

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);
      mockStorage.getSourceFilesBySnapshot.mockResolvedValue(mockSourceFiles);
      mockStorage.findFunctionsInSnapshot.mockResolvedValue(mockFunctions);
      mockStorage.insertCallEdges.mockResolvedValue(undefined);
      mockStorage.insertInternalCallEdges.mockResolvedValue(undefined);
      mockStorage.updateAnalysisLevel.mockResolvedValue(undefined);

      const result = await ensureCallGraphData(mockEnvironment, { 
        showProgress: false,
        requireCallGraph: true 
      });

      expect(result.success).toBe(true);
      expect(result.snapshot).toEqual(mockSnapshot);
      expect(result.callEdges).toEqual(mockCallEdges);
      expect(result.message).toBe('Call graph analysis completed');

      // Verify that analysis was performed and stored
      expect(mockStorage.insertCallEdges).toHaveBeenCalledWith(mockCallEdges, mockSnapshot.id);
      expect(mockStorage.updateAnalysisLevel).toHaveBeenCalledWith(mockSnapshot.id, 'CALL_GRAPH');
    });

    it('should handle analysis errors gracefully', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          basicAnalysisCompleted: true,
          callGraphAnalysisCompleted: false
        },
        scope: 'src'
      };

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);
      mockStorage.getSourceFilesBySnapshot.mockResolvedValue([]);

      const result = await ensureCallGraphData(mockEnvironment, { 
        showProgress: false,
        requireCallGraph: true 
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('No source files found in snapshot');
    });

    it('should return early when call graph not required', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 10,
          totalFiles: 5,
          basicAnalysisCompleted: true,
          callGraphAnalysisCompleted: false
        },
        scope: 'src'
      };

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);

      const result = await ensureCallGraphData(mockEnvironment, { 
        showProgress: false,
        requireCallGraph: false 
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Call graph analysis required');
    });
  });

  describe('loadCallGraphWithLazyAnalysis', () => {
    it('should load call graph data with specific snapshot ID', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'specific-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 5,
          totalFiles: 3,
          callGraphAnalysisCompleted: true
        },
        scope: 'src'
      };

      const mockFunctions: FunctionInfo[] = [
        {
          id: 'func-1',
          name: 'test',
          displayName: 'test',
          filePath: 'src/test.ts',
          startLine: 1,
          endLine: 3,
          startColumn: 1,
          endColumn: 2,
          isExported: false,
          isAsync: false,
          parameters: [],
          returnType: 'void',
          modifiers: [],
          jsdoc: null,
          sourceCodeWithJSDoc: 'function test() {}',
          sourceCode: 'function test() {}',
          fnSignature: 'test(): void',
          loc: 3,
          semanticId: 'test-semantic',
          contentId: 'test-content'
        }
      ];

      const mockCallEdges: CallEdge[] = [
        {
          id: 'edge-1',
          callerFunctionId: 'func-1',
          calleeFunctionId: 'func-2',
          callType: 'direct',
          callSite: { line: 2, column: 5 }
        }
      ];

      mockStorage.getSnapshot.mockResolvedValue(mockSnapshot);
      mockStorage.findFunctionsInSnapshot.mockResolvedValue(mockFunctions);
      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);
      mockStorage.getCallEdgesBySnapshot.mockResolvedValue(mockCallEdges);

      const result = await loadCallGraphWithLazyAnalysis(mockEnvironment, {
        showProgress: false,
        snapshotId: 'specific-snapshot'
      });

      expect(result.snapshot).toEqual(mockSnapshot);
      expect(result.functions).toEqual(mockFunctions);
      expect(result.callEdges).toEqual(mockCallEdges);
      expect(mockStorage.getSnapshot).toHaveBeenCalledWith('specific-snapshot');
    });

    it('should load latest snapshot when no snapshot ID provided', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'latest-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 8,
          totalFiles: 4,
          callGraphAnalysisCompleted: true
        },
        scope: 'src'
      };

      const mockFunctions: FunctionInfo[] = [];
      const mockCallEdges: CallEdge[] = [];

      mockStorage.getLatestSnapshot.mockResolvedValue(mockSnapshot);
      mockStorage.findFunctionsInSnapshot.mockResolvedValue(mockFunctions);
      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);
      mockStorage.getCallEdgesBySnapshot.mockResolvedValue(mockCallEdges);

      const result = await loadCallGraphWithLazyAnalysis(mockEnvironment, {
        showProgress: false
      });

      expect(result.snapshot).toEqual(mockSnapshot);
      expect(result.functions).toEqual(mockFunctions);
      expect(result.callEdges).toEqual(mockCallEdges);
      expect(mockStorage.getLatestSnapshot).toHaveBeenCalledWith();
    });

    it('should throw error when no snapshots found', async () => {
      mockStorage.getLatestSnapshot.mockResolvedValue(null);

      await expect(loadCallGraphWithLazyAnalysis(mockEnvironment, {
        showProgress: false
      })).rejects.toThrow('No snapshots found. Run `funcqc scan` first.');
    });

    it('should indicate when lazy analysis was performed', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 5,
          totalFiles: 3,
          basicAnalysisCompleted: true,
          callGraphAnalysisCompleted: false
        },
        scope: 'src'
      };

      const mockFunctions: FunctionInfo[] = [];
      const mockCallEdges: CallEdge[] = [];

      // Mock analyzer for lazy analysis
      const mockAnalyzer = {
        analyzeCallGraphFromContent: vi.fn().mockResolvedValue({
          callEdges: mockCallEdges,
          internalCallEdges: []
        })
      };

      const { FunctionAnalyzer } = await import('../../src/core/analyzer.js');
      vi.mocked(FunctionAnalyzer).mockImplementation(() => mockAnalyzer as any);

      mockStorage.getLatestSnapshot.mockResolvedValue(mockSnapshot);
      mockStorage.findFunctionsInSnapshot.mockResolvedValue(mockFunctions);
      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);
      mockStorage.getSourceFilesBySnapshot.mockResolvedValue([{
        filePath: 'src/test.ts',
        fileContent: 'function test() {}',
        lastModified: new Date(),
        fileSize: 100,
        linesOfCode: 3,
        hash: 'abc123'
      }]);
      mockStorage.insertCallEdges.mockResolvedValue(undefined);
      mockStorage.insertInternalCallEdges.mockResolvedValue(undefined);
      mockStorage.updateAnalysisLevel.mockResolvedValue(undefined);

      const result = await loadCallGraphWithLazyAnalysis(mockEnvironment, {
        showProgress: false
      });

      expect(result.lazyAnalysisPerformed).toBe(true);
    });
  });

  describe('validateCallGraphRequirements', () => {
    let mockConsoleLog: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      mockConsoleLog.mockRestore();
    });

    it('should pass validation when call edges exist', () => {
      const mockCallEdges: CallEdge[] = [
        {
          id: 'edge-1',
          callerFunctionId: 'func-1',
          calleeFunctionId: 'func-2',
          callType: 'direct',
          callSite: { line: 5, column: 10 }
        }
      ];

      expect(() => {
        validateCallGraphRequirements(mockCallEdges, 'test-command');
      }).not.toThrow();
    });

    it('should throw error when no call edges exist', () => {
      expect(() => {
        validateCallGraphRequirements([], 'test-command');
      }).toThrow('Insufficient call graph data for analysis');
    });

    it('should provide helpful error message', () => {
      expect(() => {
        validateCallGraphRequirements([], 'dep');
      }).toThrow();

      // Check that helpful messages were logged
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('dep requires function dependencies')
      );
    });
  });

  describe('createLazyAnalysisMessage', () => {
    it('should create message for required analysis', () => {
      const message = createLazyAnalysisMessage('dep', true);
      
      expect(message).toContain('dep');
      expect(message).toContain('requires call graph analysis');
      expect(message).toContain('Performing analysis now');
    });

    it('should create message for existing data', () => {
      const message = createLazyAnalysisMessage('list', false);
      
      expect(message).toContain('list');
      expect(message).toContain('Loading existing call graph data');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle storage errors gracefully', async () => {
      mockStorage.getSnapshots.mockRejectedValue(new Error('Storage error'));

      const result = await ensureCallGraphData(mockEnvironment, { 
        showProgress: false 
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Storage error');
    });

    it('should handle analyzer errors gracefully', async () => {
      const mockSnapshot: SnapshotInfo = {
        id: 'test-snapshot',
        createdAt: 1704067200000,
        metadata: {
          totalFunctions: 5,
          totalFiles: 3,
          basicAnalysisCompleted: true,
          callGraphAnalysisCompleted: false
        },
        scope: 'src'
      };

      const mockAnalyzer = {
        analyzeCallGraphFromContent: vi.fn().mockRejectedValue(new Error('Analyzer error'))
      };

      const { FunctionAnalyzer } = await import('../../src/core/analyzer.js');
      vi.mocked(FunctionAnalyzer).mockImplementation(() => mockAnalyzer as any);

      mockStorage.getSnapshots.mockResolvedValue([mockSnapshot]);
      mockStorage.getSourceFilesBySnapshot.mockResolvedValue([{
        filePath: 'src/test.ts',
        fileContent: 'function test() {}',
        lastModified: new Date(),
        fileSize: 100,
        linesOfCode: 3,
        hash: 'abc123'
      }]);
      mockStorage.findFunctionsInSnapshot.mockResolvedValue([]);

      const result = await ensureCallGraphData(mockEnvironment, { 
        showProgress: false,
        requireCallGraph: true 
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Analyzer error');
    });
  });
});