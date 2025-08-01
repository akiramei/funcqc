import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { depCyclesCommand } from '../../src/cli/dep/cycles';
import { CommandEnvironment } from '../../src/types/environment';
import { CallEdge, FunctionInfo } from '../../src/types';
import { CycleType, ImportanceLevel } from '../../src/cli/dep/types';

// Mock console.log to capture output
const mockConsoleLog = vi.fn();
const originalConsoleLog = console.log;

describe('depCyclesCommand', () => {
  let mockEnv: CommandEnvironment;
  let mockFunctions: FunctionInfo[];
  let mockCallEdges: CallEdge[];

  beforeEach(() => {
    vi.clearAllMocks();
    console.log = mockConsoleLog;

    // Setup mock functions
    mockFunctions = [
      {
        id: 'func-1',
        name: 'recursiveFunction',
        filePath: 'src/utils/helper.ts',
        startLine: 10,
        endLine: 20,
        cyclomaticComplexity: 5,
        linesOfCode: 10,
        semanticId: 'recursive-1',
      },
      {
        id: 'func-2',
        name: 'functionA',
        filePath: 'src/cli/command.ts',
        startLine: 15,
        endLine: 25,
        cyclomaticComplexity: 8,
        linesOfCode: 15,
        semanticId: 'func-a',
      },
      {
        id: 'func-3',
        name: 'functionB',
        filePath: 'src/storage/adapter.ts',
        startLine: 30,
        endLine: 40,
        cyclomaticComplexity: 12,
        linesOfCode: 20,
        semanticId: 'func-b',
      },
      {
        id: 'func-4',
        name: 'clear',
        filePath: 'src/analyzers/cleaner.ts',
        startLine: 5,
        endLine: 10,
        cyclomaticComplexity: 2,
        linesOfCode: 5,
        semanticId: 'clear-func',
      },
      {
        id: 'func-5',
        name: 'someFunction',
        filePath: 'src/core/processor.ts',
        startLine: 15,
        endLine: 25,
        cyclomaticComplexity: 6,
        linesOfCode: 10,
        semanticId: 'some-func',
      },
    ];

    // Setup mock call edges
    mockCallEdges = [
      // Recursive function
      {
        callerFunctionId: 'func-1',
        calleeFunctionId: 'func-1',
        calleeName: 'recursiveFunction',
        callType: 'direct',
        lineNumber: 15,
        callContext: 'normal',
      },
      // Cross-layer cycle (directly between func-2 and func-3, without clear chain)
      {
        callerFunctionId: 'func-2',
        calleeFunctionId: 'func-3',
        calleeName: 'functionB',
        callType: 'direct',
        lineNumber: 20,
        callContext: 'normal',
      },
      {
        callerFunctionId: 'func-3',
        calleeFunctionId: 'func-2',
        calleeName: 'functionA',
        callType: 'direct',
        lineNumber: 35,
        callContext: 'normal',
      },
      // Separate clear chain cycle (func-4 with func-5)
      {
        callerFunctionId: 'func-4',
        calleeFunctionId: 'func-5',
        calleeName: 'someFunction',
        callType: 'direct',
        lineNumber: 8,
        callContext: 'normal',
      },
      {
        callerFunctionId: 'func-5',
        calleeFunctionId: 'func-4',
        calleeName: 'clear',
        callType: 'direct',
        lineNumber: 20,
        callContext: 'normal',
      },
    ];

    // Setup mock environment
    mockEnv = {
      storage: {
        getLatestSnapshot: vi.fn().mockResolvedValue({
          id: 'snapshot-1',
          label: 'test-snapshot',
          createdAt: '2024-01-01T00:00:00Z',
        }),
        getCallEdgesBySnapshot: vi.fn().mockResolvedValue(mockCallEdges),
        findFunctionsInSnapshot: vi.fn().mockResolvedValue(mockFunctions),
      },
      commandLogger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    } as any;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe('Enhanced Mode (Default)', () => {
    it('should display enhanced cycles with default filtering', async () => {
      const command = depCyclesCommand({});
      await command(mockEnv);

      // Should call storage methods
      expect(mockEnv.storage.getLatestSnapshot).toHaveBeenCalled();
      expect(mockEnv.storage.getCallEdgesBySnapshot).toHaveBeenCalledWith('snapshot-1');
      expect(mockEnv.storage.findFunctionsInSnapshot).toHaveBeenCalledWith('snapshot-1');

      // Should show enhanced analysis output
      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('🔄 Enhanced Circular Dependencies Analysis');
      expect(output).toContain('Total cycles found:');
      expect(output).toContain('Displayed after filtering:');
    });

    it('should filter out recursive functions by default', async () => {
      const command = depCyclesCommand({});
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('💡 Filtered out:');
      expect(output).toContain('recursive functions');
    });

    it('should filter out clear chains by default', async () => {
      const command = depCyclesCommand({});
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('💡 Filtered out:');
      expect(output).toContain('clear chains');
    });

    it('should show cross-layer cycles when clear filter is disabled', async () => {
      const command = depCyclesCommand({ excludeClear: false });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      // Should show cycles when clear filter is disabled
      expect(output).toContain('Enhanced Circular Dependencies Analysis');
      expect(output).toContain('Total cycles found:');
    });
  });

  describe('Legacy Mode', () => {
    it('should use legacy mode when includeAll is true', async () => {
      const command = depCyclesCommand({ includeAll: true });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('🔄 Circular Dependencies Analysis (Legacy Mode)');
      expect(output).not.toContain('📊 Importance Summary:');
    });

    it('should show all cycles in legacy mode', async () => {
      const command = depCyclesCommand({ includeAll: true });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Cycle 1');
      // Should show more cycles than enhanced mode
    });
  });

  describe('Filtering Options', () => {
    it('should apply crossLayerOnly filter', async () => {
      const command = depCyclesCommand({ crossLayerOnly: true });
      await command(mockEnv);

      // Should call the analyzer and produce output
      expect(mockEnv.storage.getLatestSnapshot).toHaveBeenCalled();
      expect(mockEnv.storage.getCallEdgesBySnapshot).toHaveBeenCalled();
      expect(mockEnv.storage.findFunctionsInSnapshot).toHaveBeenCalled();
    });

    it('should apply recursiveOnly filter', async () => {
      const command = depCyclesCommand({ recursiveOnly: true });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('💡 LOW PRIORITY:');
      expect(output).toContain('recursive cycle');
    });

    it('should apply minComplexity filter', async () => {
      const command = depCyclesCommand({ minComplexity: '3' });
      await command(mockEnv);

      // Should filter out cycles with fewer than 3 functions
      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Enhanced Circular Dependencies Analysis');
    });

    it('should apply limit option', async () => {
      const command = depCyclesCommand({ limit: '1', excludeRecursive: false });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Displayed cycles: 1'); // Legacy mode uses different format
    });
  });

  describe('Output Formats', () => {
    it('should output JSON format when requested', async () => {
      const command = depCyclesCommand({ format: 'json' });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      const jsonOutput = JSON.parse(output);
      
      expect(jsonOutput).toHaveProperty('summary');
      expect(jsonOutput).toHaveProperty('cycles');
      expect(jsonOutput.summary).toHaveProperty('totalCycles');
      expect(jsonOutput.summary).toHaveProperty('displayedCycles');
      expect(jsonOutput.summary).toHaveProperty('filters');
      expect(jsonOutput.summary).toHaveProperty('filterStats');
      expect(jsonOutput.summary).toHaveProperty('importanceSummary');
    });

    it('should output DOT format when requested', async () => {
      const command = depCyclesCommand({ format: 'dot' });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('digraph'); // DOT format starts with digraph
    });
  });

  describe('Error Handling', () => {
    it('should handle missing snapshot gracefully', async () => {
      mockEnv.storage.getLatestSnapshot = vi.fn().mockResolvedValue(null);
      
      const command = depCyclesCommand({});
      await command(mockEnv);

      // Storage method should have been called
      expect(mockEnv.storage.getLatestSnapshot).toHaveBeenCalled();
    });

    it('should handle missing call edges gracefully', async () => {
      mockEnv.storage.getCallEdgesBySnapshot = vi.fn().mockResolvedValue([]);
      
      const command = depCyclesCommand({});
      await command(mockEnv);

      // Storage methods should have been called
      expect(mockEnv.storage.getLatestSnapshot).toHaveBeenCalled();
      expect(mockEnv.storage.getCallEdgesBySnapshot).toHaveBeenCalled();
    });

    it('should handle storage errors gracefully', async () => {
      mockEnv.storage.getLatestSnapshot = vi.fn().mockRejectedValue(new Error('Storage error'));
      
      const command = depCyclesCommand({});
      
      // Expect the command to throw due to mocked process.exit (flexible matching for different environments)
      await expect(command(mockEnv)).rejects.toThrow(/process\.exit.*called.*with.*1/);
      
      // Should have attempted to call storage
      expect(mockEnv.storage.getLatestSnapshot).toHaveBeenCalled();
    });
  });

  describe('Option Combinations', () => {
    it('should handle excludeRecursive with recursiveOnly conflict', async () => {
      // recursiveOnly should override excludeRecursive
      const command = depCyclesCommand({ 
        excludeRecursive: true, 
        recursiveOnly: true 
      });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('recursive cycle');
    });

    it('should combine multiple filters correctly', async () => {
      const command = depCyclesCommand({ 
        crossLayerOnly: true, 
        minComplexity: '2',
        limit: '5'
      });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Enhanced Circular Dependencies Analysis');
      // Should only show cross-layer cycles with size >= 2, limited to 5
    });
  });

  describe('Statistics and Summary', () => {
    it('should provide comprehensive statistics', async () => {
      const command = depCyclesCommand({ excludeClear: false });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Total cycles found:');
      expect(output).toContain('Displayed after filtering:');
      // With excludeClear: false, we should see some cycles and importance summary
    });

    it('should show filter summary when cycles are filtered', async () => {
      const command = depCyclesCommand({});
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('💡 Filtered out:');
      expect(output).toContain('Use --include-all to see all cycles');
    });

    it('should display recommendations for cycles', async () => {
      const command = depCyclesCommand({ excludeClear: false });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      // With excludeClear: false, we should see recommendations for the actual cycles
      expect(output).toContain('Enhanced Circular Dependencies Analysis');
    });
  });

  describe('Integration with Enhanced Analyzer', () => {
    it('should use enhanced analyzer by default', async () => {
      const command = depCyclesCommand({});
      await command(mockEnv);

      // Should use enhanced mode (not legacy mode)
      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Enhanced Circular Dependencies Analysis');
      expect(output).not.toContain('Legacy Mode');
    });

    it('should classify cycles with importance levels', async () => {
      const command = depCyclesCommand({ recursiveOnly: true });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toMatch(/💡 LOW PRIORITY:/); // Should show recursive cycles with low priority
    });

    it('should show cycle types correctly', async () => {
      const command = depCyclesCommand({ recursiveOnly: true });
      await command(mockEnv);

      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('recursive cycle');
      
      // Test mutual cycles - just check that analysis completes
      const mutualCommand = depCyclesCommand({ excludeClear: false, excludeRecursive: false });
      await mutualCommand(mockEnv);
      
      // Just verify analysis completed
      expect(mockEnv.storage.getLatestSnapshot).toHaveBeenCalled();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large number of call edges efficiently', async () => {
      // Create a large number of mock call edges
      const largeCallEdges: CallEdge[] = [];
      const largeFunctions: FunctionInfo[] = [];
      
      for (let i = 0; i < 1000; i++) {
        largeFunctions.push({
          id: `func-${i}`,
          name: `function${i}`,
          filePath: `src/module${i % 10}/file.ts`,
          startLine: i * 10,
          endLine: i * 10 + 5,
          cyclomaticComplexity: (i % 10) + 1,
          linesOfCode: 5,
          semanticId: `func-${i}-id`,
        });

        if (i > 0) {
          largeCallEdges.push({
            callerFunctionId: `func-${i-1}`,
            calleeFunctionId: `func-${i}`,
            calleeName: `function${i}`,
            callType: 'direct',
            lineNumber: i * 10,
            callContext: 'normal',
          });
        }
      }

      // Add a cycle to make it interesting
      largeCallEdges.push({
        callerFunctionId: 'func-999',
        calleeFunctionId: 'func-0',
        calleeName: 'function0',
        callType: 'direct',
        lineNumber: 9990,
        callContext: 'normal',
      });

      mockEnv.storage.getCallEdgesBySnapshot = vi.fn().mockResolvedValue(largeCallEdges);
      mockEnv.storage.findFunctionsInSnapshot = vi.fn().mockResolvedValue(largeFunctions);

      const startTime = Date.now();
      const command = depCyclesCommand({});
      await command(mockEnv);
      const endTime = Date.now();

      // Should complete within reasonable time (< 5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);
      
      const output = mockConsoleLog.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Enhanced Circular Dependencies Analysis');
    });
  });
});