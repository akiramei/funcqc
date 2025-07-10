import { describe, it, expect, beforeEach, vi } from 'vitest';
import { diffCommand } from '../../src/cli/diff';
import { PGLiteStorageAdapter } from '../../src/storage/pglite-adapter';
import { ConfigManager } from '../../src/core/config';
import { FunctionInfo } from '../../src/types';

// Mock the modules
vi.mock('../../src/storage/pglite-adapter');
vi.mock('../../src/core/config');
vi.mock('../../src/similarity/similarity-manager');

describe('diff lineage detection - comprehensive tests', () => {
  let mockStorage: any;
  let mockConsoleLog: any;
  let mockSimilarityManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock console.log to capture output
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    // Mock ConfigManager
    vi.mocked(ConfigManager).mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        storage: { path: '/tmp/test.db' },
        changeDetection: {}
      })
    }) as any);

    // Mock storage
    mockStorage = {
      init: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn(),
      getSnapshots: vi.fn(),
      diffSnapshots: vi.fn(),
      saveLineage: vi.fn()
    };
    
    vi.mocked(PGLiteStorageAdapter).mockImplementation(() => mockStorage);
  });

  it('should only search among added functions for lineage of removed functions', async () => {
    // Setup test data
    const snapshot1 = { id: 'snap1', label: 'before', createdAt: Date.now() - 1000 };
    const snapshot2 = { id: 'snap2', label: 'after', createdAt: Date.now() };
    
    // Functions that existed in both snapshots (unchanged)
    const unchangedFunc1: FunctionInfo = {
      id: 'unchanged1',
      name: 'helperFunction',
      filePath: 'src/helpers.ts',
      startLine: 10,
      endLine: 20,
      signature: 'function helperFunction(): void',
      body: 'function helperFunction() { console.log("helper"); }',
      isExported: false,
      isAsync: false,
      modifiers: [],
      parameters: []
    };
    
    const unchangedFunc2: FunctionInfo = {
      id: 'unchanged2',
      name: 'utilityFunction',
      filePath: 'src/utils.ts',
      startLine: 30,
      endLine: 40,
      signature: 'function utilityFunction(): void',
      body: 'function utilityFunction() { console.log("utility"); }',
      isExported: false,
      isAsync: false,
      modifiers: [],
      parameters: []
    };
    
    // Function that was removed
    const removedFunc: FunctionInfo = {
      id: 'removed1',
      name: 'oldImplementation',
      filePath: 'src/feature.ts',
      startLine: 50,
      endLine: 60,
      signature: 'function oldImplementation(): number',
      body: 'function oldImplementation() { return 42; }',
      isExported: true,
      isAsync: false,
      modifiers: [],
      parameters: []
    };
    
    // Functions that were added (potential lineage targets)
    const addedFunc1: FunctionInfo = {
      id: 'added1',
      name: 'newImplementation',
      filePath: 'src/feature.ts',
      startLine: 50,
      endLine: 60,
      signature: 'function newImplementation(): number',
      body: 'function newImplementation() { return 42; }', // Similar to removed
      isExported: true,
      isAsync: false,
      modifiers: [],
      parameters: []
    };
    
    const addedFunc2: FunctionInfo = {
      id: 'added2',
      name: 'anotherNewFunction',
      filePath: 'src/feature2.ts',
      startLine: 70,
      endLine: 80,
      signature: 'function anotherNewFunction(): void',
      body: 'function anotherNewFunction() { /* different */ }',
      isExported: false,
      isAsync: false,
      modifiers: [],
      parameters: []
    };
    
    // Mock storage responses
    mockStorage.getSnapshot.mockImplementation((id: string) => {
      if (id === 'snap1') return snapshot1;
      if (id === 'snap2') return snapshot2;
      return null;
    });
    
    mockStorage.getSnapshots.mockResolvedValue([snapshot2, snapshot1]);
    
    mockStorage.diffSnapshots.mockResolvedValue({
      from: snapshot1,
      to: snapshot2,
      added: [addedFunc1, addedFunc2],
      removed: [removedFunc],
      modified: [],
      unchanged: [unchangedFunc1, unchangedFunc2],
      statistics: {
        addedCount: 2,
        removedCount: 1,
        modifiedCount: 0,
        complexityChange: 0,
        linesChange: 0
      }
    });

    // Mock similarity detection
    const { SimilarityManager } = await import('../../src/similarity/similarity-manager');
    const mockDetectSimilarities = vi.fn();
    
    mockSimilarityManager = {
      detectSimilarities: mockDetectSimilarities,
      getAvailableDetectors: vi.fn().mockReturnValue(['ast', 'text'])
    };
    
    vi.mocked(SimilarityManager).mockImplementation(() => mockSimilarityManager);

    // Capture functions passed to similarity detection
    let capturedFunctions: FunctionInfo[] = [];
    mockDetectSimilarities.mockImplementation((functions: FunctionInfo[]) => {
      capturedFunctions = [...functions];
      // Return a match between removed and added function
      return Promise.resolve([{
        detector: 'ast',
        similarity: 0.95,
        functions: [
          { functionId: removedFunc.id, functionName: removedFunc.name, originalFunction: removedFunc },
          { functionId: addedFunc1.id, functionName: addedFunc1.name, originalFunction: addedFunc1 }
        ]
      }]);
    });

    // Run diff with lineage detection
    await diffCommand('snap1', 'snap2', {
      lineage: true,
      lineageThreshold: '0.7',
      verbose: false,
      quiet: false
    });

    // Verify similarity detection was called
    expect(mockDetectSimilarities).toHaveBeenCalled();
    
    // Extract candidate functions (excluding the removed function itself)
    const candidateFunctionIds = capturedFunctions
      .filter(f => f.id !== removedFunc.id)
      .map(f => f.id);
    
    // Verify only added and modified functions are considered
    expect(candidateFunctionIds).toEqual(['added1', 'added2']);
    expect(candidateFunctionIds).not.toContain('unchanged1');
    expect(candidateFunctionIds).not.toContain('unchanged2');
    
    // Verify lineage candidate was displayed
    const output = mockConsoleLog.mock.calls.map(call => call.join(' ')).join('\n');
    expect(output).toContain('Function Lineage Candidates');
    expect(output).toContain('oldImplementation');
    expect(output).toContain('newImplementation');
  });

  it('should handle modified functions correctly in lineage detection', async () => {
    // Setup test data with modified functions
    const snapshot1 = { id: 'snap1', label: 'before', createdAt: Date.now() - 1000 };
    const snapshot2 = { id: 'snap2', label: 'after', createdAt: Date.now() };
    
    const beforeModified: FunctionInfo = {
      id: 'mod1-before',
      name: 'processData',
      filePath: 'src/processor.ts',
      startLine: 10,
      endLine: 20,
      signature: 'function processData(data: string): void',
      body: 'function processData(data) { /* old */ }',
      isExported: true,
      isAsync: false,
      modifiers: [],
      parameters: [{ name: 'data', type: 'string' }]
    };
    
    const afterModified: FunctionInfo = {
      id: 'mod1-after',
      name: 'processData',
      filePath: 'src/processor.ts',
      startLine: 10,
      endLine: 25,
      signature: 'function processData(data: string, options?: any): void',
      body: 'function processData(data, options) { /* new */ }',
      isExported: true,
      isAsync: false,
      modifiers: [],
      parameters: [
        { name: 'data', type: 'string' },
        { name: 'options', type: 'any', optional: true }
      ]
    };
    
    const removedFunc: FunctionInfo = {
      id: 'removed1',
      name: 'oldProcessor',
      filePath: 'src/old.ts',
      startLine: 30,
      endLine: 40,
      signature: 'function oldProcessor(data: string): void',
      body: 'function oldProcessor(data) { /* similar to processData */ }',
      isExported: false,
      isAsync: false,
      modifiers: [],
      parameters: [{ name: 'data', type: 'string' }]
    };
    
    // Mock storage responses
    mockStorage.getSnapshot.mockImplementation((id: string) => {
      if (id === 'snap1') return snapshot1;
      if (id === 'snap2') return snapshot2;
      return null;
    });
    
    mockStorage.getSnapshots.mockResolvedValue([snapshot2, snapshot1]);
    
    mockStorage.diffSnapshots.mockResolvedValue({
      from: snapshot1,
      to: snapshot2,
      added: [],
      removed: [removedFunc],
      modified: [{
        before: beforeModified,
        after: afterModified,
        changes: [{
          field: 'signature',
          oldValue: beforeModified.signature,
          newValue: afterModified.signature,
          impact: 'high'
        }]
      }],
      unchanged: [],
      statistics: {
        addedCount: 0,
        removedCount: 1,
        modifiedCount: 1,
        complexityChange: 0,
        linesChange: 5
      }
    });

    // Mock similarity detection
    const { SimilarityManager } = await import('../../src/similarity/similarity-manager');
    const mockDetectSimilarities = vi.fn();
    
    vi.mocked(SimilarityManager).mockImplementation(() => ({
      detectSimilarities: mockDetectSimilarities,
      getAvailableDetectors: vi.fn().mockReturnValue(['ast', 'text'])
    }) as any);

    // Capture functions passed to similarity detection
    let capturedFunctions: FunctionInfo[] = [];
    mockDetectSimilarities.mockImplementation((functions: FunctionInfo[]) => {
      capturedFunctions = [...functions];
      return Promise.resolve([]);
    });

    // Run diff with lineage detection
    await diffCommand('snap1', 'snap2', {
      lineage: true,
      verbose: false,
      quiet: false
    });

    // Verify similarity detection was called
    expect(mockDetectSimilarities).toHaveBeenCalled();
    
    // Extract candidate functions
    const candidateFunctionIds = capturedFunctions
      .filter(f => f.id !== removedFunc.id)
      .map(f => f.id);
    
    // Should only include the modified function (after state)
    expect(candidateFunctionIds).toEqual(['mod1-after']);
  });

  it('should not include any unchanged functions when there are many', async () => {
    // Setup test data with many unchanged functions
    const snapshot1 = { id: 'snap1', label: 'before', createdAt: Date.now() - 1000 };
    const snapshot2 = { id: 'snap2', label: 'after', createdAt: Date.now() };
    
    // Create many unchanged functions
    const unchangedFunctions: FunctionInfo[] = [];
    for (let i = 0; i < 50; i++) {
      unchangedFunctions.push({
        id: `unchanged${i}`,
        name: `stableFunction${i}`,
        filePath: `src/stable/file${Math.floor(i / 10)}.ts`,
        startLine: i * 10,
        endLine: i * 10 + 5,
        signature: `function stableFunction${i}(): void`,
        body: `function stableFunction${i}() { /* unchanged */ }`,
        isExported: false,
        isAsync: false,
        modifiers: [],
        parameters: []
      });
    }
    
    const removedFunc: FunctionInfo = {
      id: 'removed1',
      name: 'deletedFunction',
      filePath: 'src/deleted.ts',
      startLine: 100,
      endLine: 110,
      signature: 'function deletedFunction(): void',
      body: 'function deletedFunction() { /* to be removed */ }',
      isExported: true,
      isAsync: false,
      modifiers: [],
      parameters: []
    };
    
    const addedFunc: FunctionInfo = {
      id: 'added1',
      name: 'replacementFunction',
      filePath: 'src/replacement.ts',
      startLine: 100,
      endLine: 110,
      signature: 'function replacementFunction(): void',
      body: 'function replacementFunction() { /* replacement */ }',
      isExported: true,
      isAsync: false,
      modifiers: [],
      parameters: []
    };
    
    // Mock storage responses
    mockStorage.getSnapshot.mockImplementation((id: string) => {
      if (id === 'snap1') return snapshot1;
      if (id === 'snap2') return snapshot2;
      return null;
    });
    
    mockStorage.getSnapshots.mockResolvedValue([snapshot2, snapshot1]);
    
    mockStorage.diffSnapshots.mockResolvedValue({
      from: snapshot1,
      to: snapshot2,
      added: [addedFunc],
      removed: [removedFunc],
      modified: [],
      unchanged: unchangedFunctions,
      statistics: {
        addedCount: 1,
        removedCount: 1,
        modifiedCount: 0,
        complexityChange: 0,
        linesChange: 0
      }
    });

    // Mock similarity detection
    const { SimilarityManager } = await import('../../src/similarity/similarity-manager');
    const mockDetectSimilarities = vi.fn();
    
    vi.mocked(SimilarityManager).mockImplementation(() => ({
      detectSimilarities: mockDetectSimilarities,
      getAvailableDetectors: vi.fn().mockReturnValue(['ast', 'text'])
    }) as any);

    // Capture functions passed to similarity detection
    let capturedFunctions: FunctionInfo[] = [];
    mockDetectSimilarities.mockImplementation((functions: FunctionInfo[]) => {
      capturedFunctions = [...functions];
      return Promise.resolve([]);
    });

    // Run diff with lineage detection
    await diffCommand('snap1', 'snap2', {
      lineage: true,
      verbose: false,
      quiet: false
    });

    // Verify similarity detection was called
    expect(mockDetectSimilarities).toHaveBeenCalled();
    
    // Extract candidate functions
    const candidateFunctionIds = capturedFunctions
      .filter(f => f.id !== removedFunc.id)
      .map(f => f.id);
    
    // Should only include the added function, none of the unchanged
    expect(candidateFunctionIds).toEqual(['added1']);
    expect(candidateFunctionIds.length).toBe(1);
    
    // Verify no unchanged functions are included
    for (const unchangedFunc of unchangedFunctions) {
      expect(candidateFunctionIds).not.toContain(unchangedFunc.id);
    }
  });
});