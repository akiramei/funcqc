import { describe, it, expect, beforeEach } from 'vitest';
import { EnhancedCycleAnalyzer } from '../../src/analyzers/enhanced-cycle-analyzer';
import { CallEdge, FunctionInfo } from '../../src/types';
import { CycleType, ImportanceLevel } from '../../src/cli/dep/types';

describe('EnhancedCycleAnalyzer', () => {
  let analyzer: EnhancedCycleAnalyzer;

  beforeEach(() => {
    analyzer = new EnhancedCycleAnalyzer();
  });

  describe('analyzeClassifiedCycles', () => {
    it('should classify recursive functions correctly', () => {
      const callEdges: CallEdge[] = [
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'A',
          calleeName: 'recursiveFunction',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'recursiveFunction',
          filePath: 'src/utils/helper.ts',
          startLine: 10,
          endLine: 20,
          cyclomaticComplexity: 5,
          linesOfCode: 10,
          semanticId: 'recursive-func-1',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions);

      expect(result.classifiedCycles).toHaveLength(1);
      expect(result.totalCycles).toBe(1);
      
      const cycle = result.classifiedCycles[0];
      expect(cycle.type).toBe(CycleType.RECURSIVE);
      expect(cycle.importance).toBe(ImportanceLevel.LOW); // Same file
      expect(cycle.nodes).toHaveLength(1);
      expect(cycle.nodes[0]).toBe('A');
      expect(cycle.crossFile).toBe(false);
      expect(cycle.crossModule).toBe(false);
      expect(cycle.crossLayer).toBe(false);
    });

    it('should classify mutual cycles correctly', () => {
      const callEdges: CallEdge[] = [
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'functionA',
          filePath: 'src/module1/service.ts',
          startLine: 5,
          endLine: 10,
          cyclomaticComplexity: 3,
          linesOfCode: 5,
          semanticId: 'func-a-1',
        },
        {
          id: 'B',
          name: 'functionB',
          filePath: 'src/module2/handler.ts',
          startLine: 15,
          endLine: 20,
          cyclomaticComplexity: 4,
          linesOfCode: 5,
          semanticId: 'func-b-1',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions);

      expect(result.classifiedCycles).toHaveLength(1);
      
      const cycle = result.classifiedCycles[0];
      expect(cycle.type).toBe(CycleType.MUTUAL);
      expect(cycle.importance).toBe(ImportanceLevel.HIGH); // Cross-module
      expect(cycle.nodes).toHaveLength(2);
      expect(cycle.crossFile).toBe(true);
      expect(cycle.crossModule).toBe(true);
      expect(cycle.crossLayer).toBe(false);
      expect(cycle.fileCount).toBe(2);
      expect(cycle.moduleCount).toBe(2);
    });

    it('should classify complex cycles correctly', () => {
      const callEdges: CallEdge[] = [
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'functionD',
          callType: 'direct',
          lineNumber: 25,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 35,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'functionA',
          filePath: 'src/cli/command.ts',
          startLine: 5,
          endLine: 10,
          cyclomaticComplexity: 8,
          linesOfCode: 15,
          semanticId: 'func-a-1',
        },
        {
          id: 'B',
          name: 'functionB',
          filePath: 'src/core/processor.ts',
          startLine: 15,
          endLine: 20,
          cyclomaticComplexity: 12,
          linesOfCode: 20,
          semanticId: 'func-b-1',
        },
        {
          id: 'C',
          name: 'functionC',
          filePath: 'src/storage/adapter.ts',
          startLine: 25,
          endLine: 30,
          cyclomaticComplexity: 6,
          linesOfCode: 12,
          semanticId: 'func-c-1',
        },
        {
          id: 'D',
          name: 'functionD',
          filePath: 'src/analyzers/scanner.ts',
          startLine: 35,
          endLine: 40,
          cyclomaticComplexity: 10,
          linesOfCode: 18,
          semanticId: 'func-d-1',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions);

      expect(result.classifiedCycles).toHaveLength(1);
      
      const cycle = result.classifiedCycles[0];
      expect(cycle.type).toBe(CycleType.COMPLEX);
      expect(cycle.importance).toBe(ImportanceLevel.CRITICAL); // Cross-layer (cli, core, storage, analyzers)
      expect(cycle.nodes).toHaveLength(4);
      expect(cycle.crossFile).toBe(true);
      expect(cycle.crossModule).toBe(true);
      expect(cycle.crossLayer).toBe(true);
      expect(cycle.fileCount).toBe(4);
      expect(cycle.moduleCount).toBe(4);
      expect(cycle.layerCount).toBe(4);
      expect(cycle.cyclomaticComplexity).toBe(36); // 8 + 12 + 6 + 10
      expect(cycle.averageComplexity).toBe(9); // 36 / 4
    });

    it('should apply excludeRecursive filter correctly', () => {
      const callEdges: CallEdge[] = [
        // Recursive function
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'A',
          calleeName: 'recursiveA',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        // Mutual cycle
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'recursiveA',
          filePath: 'src/test.ts',
          startLine: 5,
          endLine: 10,
          cyclomaticComplexity: 3,
          linesOfCode: 5,
          semanticId: 'recursive-a',
        },
        {
          id: 'B',
          name: 'functionB',
          filePath: 'src/test.ts',
          startLine: 10,
          endLine: 15,
          cyclomaticComplexity: 4,
          linesOfCode: 5,
          semanticId: 'func-b',
        },
        {
          id: 'C',
          name: 'functionC',
          filePath: 'src/test.ts',
          startLine: 15,
          endLine: 20,
          cyclomaticComplexity: 5,
          linesOfCode: 5,
          semanticId: 'func-c',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions, {
        excludeRecursive: true,
      });

      expect(result.classifiedCycles).toHaveLength(1); // Only mutual cycle
      expect(result.totalCycles).toBe(2); // Both cycles found initially
      expect(result.filterStats.excludedRecursive).toBe(1); // One recursive excluded
      
      const cycle = result.classifiedCycles[0];
      expect(cycle.type).toBe(CycleType.MUTUAL);
    });

    it('should apply minComplexity filter correctly', () => {
      const callEdges: CallEdge[] = [
        // Small cycle (2 functions)
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
        // Large cycle (5 functions)
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'functionD',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'E',
          calleeName: 'functionE',
          callType: 'direct',
          lineNumber: 20,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'E',
          calleeFunctionId: 'F',
          calleeName: 'functionF',
          callType: 'direct',
          lineNumber: 25,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'F',
          calleeFunctionId: 'G',
          calleeName: 'functionG',
          callType: 'direct',
          lineNumber: 30,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'G',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 35,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        { id: 'A', name: 'functionA', filePath: 'src/test.ts', startLine: 5, endLine: 10, cyclomaticComplexity: 2, linesOfCode: 5, semanticId: 'func-a' },
        { id: 'B', name: 'functionB', filePath: 'src/test.ts', startLine: 10, endLine: 15, cyclomaticComplexity: 3, linesOfCode: 5, semanticId: 'func-b' },
        { id: 'C', name: 'functionC', filePath: 'src/test.ts', startLine: 15, endLine: 20, cyclomaticComplexity: 4, linesOfCode: 5, semanticId: 'func-c' },
        { id: 'D', name: 'functionD', filePath: 'src/test.ts', startLine: 20, endLine: 25, cyclomaticComplexity: 5, linesOfCode: 5, semanticId: 'func-d' },
        { id: 'E', name: 'functionE', filePath: 'src/test.ts', startLine: 25, endLine: 30, cyclomaticComplexity: 6, linesOfCode: 5, semanticId: 'func-e' },
        { id: 'F', name: 'functionF', filePath: 'src/test.ts', startLine: 30, endLine: 35, cyclomaticComplexity: 7, linesOfCode: 5, semanticId: 'func-f' },
        { id: 'G', name: 'functionG', filePath: 'src/test.ts', startLine: 35, endLine: 40, cyclomaticComplexity: 8, linesOfCode: 5, semanticId: 'func-g' },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions, {
        minComplexity: 4, // Filter out cycles with < 4 functions
      });

      expect(result.classifiedCycles).toHaveLength(1); // Only the 5-function cycle
      expect(result.totalCycles).toBe(2); // Both cycles found initially
      
      const cycle = result.classifiedCycles[0];
      expect(cycle.nodes).toHaveLength(5); // The large cycle
      expect(cycle.type).toBe(CycleType.COMPLEX);
    });

    it('should apply crossLayerOnly filter correctly', () => {
      const callEdges: CallEdge[] = [
        // Cross-layer cycle (cli -> storage -> cli)
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'storageFunction',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'cliFunction',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
        // Same-layer cycle (utils -> utils)
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'utilsFunction2',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'C',
          calleeName: 'utilsFunction1',
          callType: 'direct',
          lineNumber: 20,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'cliFunction',
          filePath: 'src/cli/command.ts',
          startLine: 5,
          endLine: 10,
          cyclomaticComplexity: 3,
          linesOfCode: 5,
          semanticId: 'cli-func',
        },
        {
          id: 'B',
          name: 'storageFunction',
          filePath: 'src/storage/adapter.ts',
          startLine: 10,
          endLine: 15,
          cyclomaticComplexity: 4,
          linesOfCode: 5,
          semanticId: 'storage-func',
        },
        {
          id: 'C',
          name: 'utilsFunction1',
          filePath: 'src/utils/helper1.ts',
          startLine: 15,
          endLine: 20,
          cyclomaticComplexity: 2,
          linesOfCode: 5,
          semanticId: 'utils-func-1',
        },
        {
          id: 'D',
          name: 'utilsFunction2',
          filePath: 'src/utils/helper2.ts',
          startLine: 20,
          endLine: 25,
          cyclomaticComplexity: 3,
          linesOfCode: 5,
          semanticId: 'utils-func-2',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions, {
        crossLayerOnly: true,
      });

      expect(result.classifiedCycles).toHaveLength(1); // Only cross-layer cycle
      expect(result.totalCycles).toBe(2); // Both cycles found initially
      
      const cycle = result.classifiedCycles[0];
      expect(cycle.crossLayer).toBe(true);
      expect(cycle.importance).toBe(ImportanceLevel.CRITICAL);
    });

    it('should apply recursiveOnly filter correctly', () => {
      const callEdges: CallEdge[] = [
        // Recursive function
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'A',
          calleeName: 'recursiveFunction',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        // Mutual cycle
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'recursiveFunction',
          filePath: 'src/test.ts',
          startLine: 5,
          endLine: 10,
          cyclomaticComplexity: 3,
          linesOfCode: 5,
          semanticId: 'recursive-func',
        },
        {
          id: 'B',
          name: 'functionB',
          filePath: 'src/test.ts',
          startLine: 10,
          endLine: 15,
          cyclomaticComplexity: 4,
          linesOfCode: 5,
          semanticId: 'func-b',
        },
        {
          id: 'C',
          name: 'functionC',
          filePath: 'src/test.ts',
          startLine: 15,
          endLine: 20,
          cyclomaticComplexity: 5,
          linesOfCode: 5,
          semanticId: 'func-c',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions, {
        recursiveOnly: true,
      });

      expect(result.classifiedCycles).toHaveLength(1); // Only recursive function
      expect(result.totalCycles).toBe(2); // Both cycles found initially
      
      const cycle = result.classifiedCycles[0];
      expect(cycle.type).toBe(CycleType.RECURSIVE);
      expect(cycle.nodes).toHaveLength(1);
      expect(cycle.nodes[0]).toBe('A');
    });

    it('should exclude clear cycles when excludeClear is true', () => {
      const callEdges: CallEdge[] = [
        // Clear cycle
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'clear',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'someFunction',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
        // Regular cycle
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'functionD',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 20,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'someFunction',
          filePath: 'src/test.ts',
          startLine: 5,
          endLine: 10,
          cyclomaticComplexity: 3,
          linesOfCode: 5,
          semanticId: 'some-func',
        },
        {
          id: 'B',
          name: 'clear',
          filePath: 'src/test.ts',
          startLine: 10,
          endLine: 15,
          cyclomaticComplexity: 1,
          linesOfCode: 3,
          semanticId: 'clear-func',
        },
        {
          id: 'C',
          name: 'functionC',
          filePath: 'src/test.ts',
          startLine: 15,
          endLine: 20,
          cyclomaticComplexity: 4,
          linesOfCode: 5,
          semanticId: 'func-c',
        },
        {
          id: 'D',
          name: 'functionD',
          filePath: 'src/test.ts',
          startLine: 20,
          endLine: 25,
          cyclomaticComplexity: 5,
          linesOfCode: 5,
          semanticId: 'func-d',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions, {
        excludeClear: true,
      });

      expect(result.classifiedCycles).toHaveLength(1); // Only regular cycle
      expect(result.totalCycles).toBe(2); // Both cycles found initially
      
      const cycle = result.classifiedCycles[0];
      expect(cycle.nodes).not.toContain('B'); // Clear function not included
    });

    it('should calculate importance scores correctly', () => {
      const callEdges: CallEdge[] = [
        // Critical cross-layer cycle
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'storageFunction',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'cliFunction',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'cliFunction',
          filePath: 'src/cli/command.ts',
          startLine: 5,
          endLine: 10,
          cyclomaticComplexity: 15,
          linesOfCode: 25,
          semanticId: 'cli-func',
        },
        {
          id: 'B',
          name: 'storageFunction',
          filePath: 'src/storage/adapter.ts',
          startLine: 10,
          endLine: 15,
          cyclomaticComplexity: 20,
          linesOfCode: 30,
          semanticId: 'storage-func',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions);
      const cycle = result.classifiedCycles[0];

      expect(cycle.importance).toBe(ImportanceLevel.CRITICAL);
      expect(cycle.score).toBeGreaterThan(8); // High score for critical cycle
      expect(cycle.cyclomaticComplexity).toBe(35); // 15 + 20
      expect(cycle.averageComplexity).toBe(17.5); // 35 / 2
    });

    it('should generate appropriate recommendations', () => {
      const callEdges: CallEdge[] = [
        // Large complex cross-layer cycle
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'functionD',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'E',
          calleeName: 'functionE',
          callType: 'direct',
          lineNumber: 20,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'E',
          calleeFunctionId: 'F',
          calleeName: 'functionF',
          callType: 'direct',
          lineNumber: 25,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'F',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 30,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        { id: 'A', name: 'functionA', filePath: 'src/cli/command.ts', startLine: 5, endLine: 10, cyclomaticComplexity: 8, linesOfCode: 15, semanticId: 'func-a' },
        { id: 'B', name: 'functionB', filePath: 'src/core/processor.ts', startLine: 10, endLine: 15, cyclomaticComplexity: 12, linesOfCode: 20, semanticId: 'func-b' },
        { id: 'C', name: 'functionC', filePath: 'src/storage/adapter.ts', startLine: 15, endLine: 20, cyclomaticComplexity: 6, linesOfCode: 12, semanticId: 'func-c' },
        { id: 'D', name: 'functionD', filePath: 'src/analyzers/scanner.ts', startLine: 20, endLine: 25, cyclomaticComplexity: 10, linesOfCode: 18, semanticId: 'func-d' },
        { id: 'E', name: 'functionE', filePath: 'src/utils/helper.ts', startLine: 25, endLine: 30, cyclomaticComplexity: 4, linesOfCode: 8, semanticId: 'func-e' },
        { id: 'F', name: 'functionF', filePath: 'src/services/worker.ts', startLine: 30, endLine: 35, cyclomaticComplexity: 7, linesOfCode: 14, semanticId: 'func-f' },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions);
      const cycle = result.classifiedCycles[0];

      expect(cycle.recommendations).toContain('URGENT: Cross-layer cycle violates architectural boundaries');
      expect(cycle.recommendations).toContain('Consider introducing interfaces or dependency injection');
      expect(cycle.recommendations).toContain('Large cycle suggests design issues');
      expect(cycle.recommendations).toContain('Break into smaller, focused components');
    });

    it('should sort cycles by importance score', () => {
      const callEdges: CallEdge[] = [
        // Low importance cycle (same file)
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
        // High importance cycle (cross-layer)
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'functionD',
          callType: 'direct',
          lineNumber: 15,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 20,
          callContext: 'normal',
        },
      ];

      const functions: FunctionInfo[] = [
        {
          id: 'A',
          name: 'functionA',
          filePath: 'src/utils/helper.ts',
          startLine: 5,
          endLine: 10,
          cyclomaticComplexity: 3,
          linesOfCode: 5,
          semanticId: 'func-a',
        },
        {
          id: 'B',
          name: 'functionB',
          filePath: 'src/utils/helper.ts',
          startLine: 10,
          endLine: 15,
          cyclomaticComplexity: 4,
          linesOfCode: 5,
          semanticId: 'func-b',
        },
        {
          id: 'C',
          name: 'functionC',
          filePath: 'src/cli/command.ts',
          startLine: 15,
          endLine: 20,
          cyclomaticComplexity: 10,
          linesOfCode: 15,
          semanticId: 'func-c',
        },
        {
          id: 'D',
          name: 'functionD',
          filePath: 'src/storage/adapter.ts',
          startLine: 20,
          endLine: 25,
          cyclomaticComplexity: 12,
          linesOfCode: 18,
          semanticId: 'func-d',
        },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions);

      expect(result.classifiedCycles).toHaveLength(2);
      
      // Should be sorted by score (highest first)
      const firstCycle = result.classifiedCycles[0];
      const secondCycle = result.classifiedCycles[1];
      
      expect(firstCycle.score).toBeGreaterThanOrEqual(secondCycle.score);
      expect(firstCycle.importance).toBe(ImportanceLevel.CRITICAL); // Cross-layer
      expect(secondCycle.importance).toBe(ImportanceLevel.LOW); // Same file
    });

    it('should provide comprehensive filter statistics', () => {
      const callEdges: CallEdge[] = [
        // Recursive function
        { callerFunctionId: 'A', calleeFunctionId: 'A', calleeName: 'recursiveA', callType: 'direct', lineNumber: 1, callContext: 'normal' },
        
        // Clear cycle
        { callerFunctionId: 'B', calleeFunctionId: 'C', calleeName: 'clear', callType: 'direct', lineNumber: 2, callContext: 'normal' },
        { callerFunctionId: 'C', calleeFunctionId: 'B', calleeName: 'functionB', callType: 'direct', lineNumber: 3, callContext: 'normal' },
        
        // Small cycle (< minComplexity)
        { callerFunctionId: 'D', calleeFunctionId: 'E', calleeName: 'functionE', callType: 'direct', lineNumber: 4, callContext: 'normal' },
        { callerFunctionId: 'E', calleeFunctionId: 'D', calleeName: 'functionD', callType: 'direct', lineNumber: 5, callContext: 'normal' },
        
        // Valid complex cycle
        { callerFunctionId: 'F', calleeFunctionId: 'G', calleeName: 'functionG', callType: 'direct', lineNumber: 6, callContext: 'normal' },
        { callerFunctionId: 'G', calleeFunctionId: 'H', calleeName: 'functionH', callType: 'direct', lineNumber: 7, callContext: 'normal' },
        { callerFunctionId: 'H', calleeFunctionId: 'I', calleeName: 'functionI', callType: 'direct', lineNumber: 8, callContext: 'normal' },
        { callerFunctionId: 'I', calleeFunctionId: 'F', calleeName: 'functionF', callType: 'direct', lineNumber: 9, callContext: 'normal' },
      ];

      const functions: FunctionInfo[] = [
        { id: 'A', name: 'recursiveA', filePath: 'src/test.ts', startLine: 1, endLine: 5, cyclomaticComplexity: 3, linesOfCode: 4, semanticId: 'recursive-a' },
        { id: 'B', name: 'functionB', filePath: 'src/test.ts', startLine: 6, endLine: 10, cyclomaticComplexity: 2, linesOfCode: 4, semanticId: 'func-b' },
        { id: 'C', name: 'clear', filePath: 'src/test.ts', startLine: 11, endLine: 15, cyclomaticComplexity: 1, linesOfCode: 4, semanticId: 'clear-func' },
        { id: 'D', name: 'functionD', filePath: 'src/test.ts', startLine: 16, endLine: 20, cyclomaticComplexity: 2, linesOfCode: 4, semanticId: 'func-d' },
        { id: 'E', name: 'functionE', filePath: 'src/test.ts', startLine: 21, endLine: 25, cyclomaticComplexity: 3, linesOfCode: 4, semanticId: 'func-e' },
        { id: 'F', name: 'functionF', filePath: 'src/test.ts', startLine: 26, endLine: 30, cyclomaticComplexity: 4, linesOfCode: 4, semanticId: 'func-f' },
        { id: 'G', name: 'functionG', filePath: 'src/test.ts', startLine: 31, endLine: 35, cyclomaticComplexity: 5, linesOfCode: 4, semanticId: 'func-g' },
        { id: 'H', name: 'functionH', filePath: 'src/test.ts', startLine: 36, endLine: 40, cyclomaticComplexity: 6, linesOfCode: 4, semanticId: 'func-h' },
        { id: 'I', name: 'functionI', filePath: 'src/test.ts', startLine: 41, endLine: 45, cyclomaticComplexity: 7, linesOfCode: 4, semanticId: 'func-i' },
      ];

      const result = analyzer.analyzeClassifiedCycles(callEdges, functions, {
        excludeRecursive: true,
        excludeClear: true,
        minComplexity: 4,
      });

      expect(result.classifiedCycles).toHaveLength(1); // Only the 4-function cycle meets criteria
      expect(result.totalCycles).toBe(4); // All cycles found initially
      expect(result.filterStats.excludedRecursive).toBe(1);
      expect(result.filterStats.excludedClear).toBe(1);
      expect(result.filterStats.excludedByComplexity).toBe(3); // 1 recursive + 1 clear + 1 small = 3 with size < 4
    });
  });
});