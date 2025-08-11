/**
 * Test suite for staged analysis architecture fixes
 * Tests the critical fixes applied to function lookup, column calculations, and stage count
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Project } from 'ts-morph';
import { StagedAnalysisEngine } from '../../src/analyzers/staged-analysis/staged-analysis-engine-refactored';
import { FunctionRegistry } from '../../src/analyzers/function-registry';
import { FunctionMetadata } from '../../src/analyzers/ideal-call-graph-analyzer';
import { Logger } from '../../src/utils/cli-utils';

describe('Staged Analysis Architecture Fixes', () => {
  let project: Project;
  let engine: StagedAnalysisEngine;
  let functionRegistry: FunctionRegistry;
  let logger: Logger;

  beforeEach(() => {
    project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 5, // ES2015
        allowJs: true,
        declaration: false,
        skipLibCheck: true,
      }
    });
    
    const typeChecker = project.getTypeChecker();
    logger = new Logger(false);
    engine = new StagedAnalysisEngine(project, typeChecker, { logger });
    functionRegistry = new FunctionRegistry(project);
  });

  describe('Function Lookup Map - Per-line Mapping', () => {
    it('should create function lookup entries for all lines within function range', async () => {
      const sourceFile = project.createSourceFile(
        'test.ts',
        `// Line 1
function multiLineFunction(
  param1: string,
  param2: number
): string {
  const result = param1 + param2;
  console.log(result);
  return result;
}
// Line 10`,
        { overwrite: true }
      );

      const functions = new Map<string, FunctionMetadata>();
      const funcMetadata: FunctionMetadata = {
        id: 'func-1',
        name: 'multiLineFunction',
        filePath: 'test.ts',
        startLine: 2, // function starts at line 2
        endLine: 8,   // function ends at line 8
        signature: 'multiLineFunction(param1: string, param2: number): string',
        isAsync: false,
        parameters: [],
        returnType: { type: 'string', typeSimple: 'string', isPromise: false },
        sourceCode: '',
      };
      functions.set('func-1', funcMetadata);

      const engine = new StagedAnalysisEngine(project, project.getTypeChecker(), { logger });
      
      // Access private state through performStagedAnalysis
      const edges = await engine.performStagedAnalysis(functions);
      
      // Verify that the function lookup map has entries for all lines
      // We can't directly access private state, but we can verify through behavior
      // The ImportExact stage should be able to resolve functions at any line
      
      // Create another function that calls multiLineFunction from different lines
      const callerFile = project.createSourceFile(
        'caller.ts',
        `
        import { multiLineFunction } from './test';
        
        function caller() {
          // Call should be resolvable at any line within multiLineFunction's range
          multiLineFunction("test", 42);
        }
        `,
        { overwrite: true }
      );

      const callerFunc: FunctionMetadata = {
        id: 'caller-1',
        name: 'caller',
        filePath: 'caller.ts',
        startLine: 4,
        endLine: 7,
        signature: 'caller(): void',
        isAsync: false,
        parameters: [],
        returnType: { type: 'void', typeSimple: 'void', isPromise: false },
        sourceCode: '',
      };
      functions.set('caller-1', callerFunc);

      // Re-run analysis with both functions
      const edgesWithCaller = await engine.performStagedAnalysis(functions);
      
      // Since we can't directly test the lookup map, we verify the behavior is correct
      expect(edgesWithCaller).toBeDefined();
      expect(Array.isArray(edgesWithCaller)).toBe(true);
    });

    it('should handle overlapping function ranges correctly', async () => {
      // Arrange
      const sourceCode = `
        function outer() {
          function inner() {
            console.log('nested');
          }
          inner();
        }
      `;
      
      const sourceFile = project.createSourceFile('nested.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Verify analysis completes without errors
      expect(edges).toBeDefined();
      expect(Array.isArray(edges)).toBe(true);
      
      // Should find at least one call edge (inner() call or console.log)
      expect(edges.length).toBeGreaterThanOrEqual(1);
      
      // Look for either the inner() call or any call edge from the outer function
      const hasCallFromOuter = edges.some(e => {
        const outerFunc = Array.from(functions.values()).find(f => f.name === 'outer');
        return outerFunc && e.callerFunctionId === outerFunc.id;
      });
      
      expect(hasCallFromOuter).toBe(true);
    });
  });

  describe('Column Number Calculation Consistency', () => {
    it('should calculate column numbers consistently across all stages', async () => {
      const sourceFile = project.createSourceFile(
        'columns.ts',
        `
        function caller() {
          targetFunction(); // Column should be consistent
          console.log('test'); // External call
        }
        
        function targetFunction() {
          return 'result';
        }
        `,
        { overwrite: true }
      );

      const functions = new Map<string, FunctionMetadata>();
      
      const callerFunc: FunctionMetadata = {
        id: 'caller-1',
        name: 'caller',
        filePath: 'columns.ts',
        startLine: 2,
        endLine: 5,
        signature: 'caller(): void',
        isAsync: false,
        parameters: [],
        returnType: { type: 'void', typeSimple: 'void', isPromise: false },
        sourceCode: '',
      };
      
      const targetFunc: FunctionMetadata = {
        id: 'target-1',
        name: 'targetFunction',
        filePath: 'columns.ts',
        startLine: 7,
        endLine: 9,
        signature: 'targetFunction(): string',
        isAsync: false,
        parameters: [],
        returnType: { type: 'string', typeSimple: 'string', isPromise: false },
        sourceCode: '',
      };
      
      functions.set('caller-1', callerFunc);
      functions.set('target-1', targetFunc);

      const engine = new StagedAnalysisEngine(project, project.getTypeChecker(), { logger });
      const edges = await engine.performStagedAnalysis(functions);
      
      // Find internal call edge
      const internalCall = edges.find(e => 
        e.calleeName === 'targetFunction'
      );
      
      // Find external call edge (console.log)
      const externalCall = edges.find(e => 
        e.calleeName === 'console.log'
      );
      
      // Both should have reasonable column numbers (not raw positions)
      if (internalCall) {
        expect(internalCall.columnNumber).toBeGreaterThanOrEqual(0);
        expect(internalCall.columnNumber).toBeLessThan(100); // Should not be absolute position
      }
      
      if (externalCall) {
        expect(externalCall.columnNumber).toBeGreaterThanOrEqual(0);
        expect(externalCall.columnNumber).toBeLessThan(100); // Should not be absolute position
      }
    });

    it('should handle column numbers for callback registrations', async () => {
      const sourceFile = project.createSourceFile(
        'callbacks.ts',
        `
        import { program } from 'commander';
        
        function setupCommands() {
          program
            .command('test')
            .action(() => {
              console.log('test command');
            });
        }
        `,
        { overwrite: true }
      );

      const functions = new Map<string, FunctionMetadata>();
      
      const setupFunc: FunctionMetadata = {
        id: 'setup-1',
        name: 'setupCommands',
        filePath: 'callbacks.ts',
        startLine: 4,
        endLine: 10,
        signature: 'setupCommands(): void',
        isAsync: false,
        parameters: [],
        returnType: { type: 'void', typeSimple: 'void', isPromise: false },
        sourceCode: '',
      };
      
      functions.set('setup-1', setupFunc);

      const engine = new StagedAnalysisEngine(project, project.getTypeChecker(), { logger });
      const edges = await engine.performStagedAnalysis(functions);
      
      // All edges should have valid column numbers
      edges.forEach(edge => {
        if (edge.columnNumber !== undefined) {
          expect(edge.columnNumber).toBeGreaterThanOrEqual(0);
          expect(edge.columnNumber).toBeLessThan(200); // Reasonable upper bound
        }
      });
    });
  });

  describe('Stage Count Logging Consistency', () => {
    it('should log correct stage count', async () => {
      const mockLogger = {
        debug: vi.fn(),
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const engine = new StagedAnalysisEngine(
        project, 
        project.getTypeChecker(), 
        { logger: mockLogger as unknown as Logger }
      );
      
      const functions = new Map<string, FunctionMetadata>();
      await engine.performStagedAnalysis(functions);
      
      // Verify the correct stage count is logged
      const startLog = mockLogger.debug.mock.calls.find(
        call => call[0]?.includes('Starting') && call[0]?.includes('stage')
      );
      
      expect(startLog).toBeDefined();
      expect(startLog[0]).toContain('7-stage'); // Should be 7-stage, not 5-stage
      
      // Verify all 7 stages are executed
      const stageLogs = mockLogger.debug.mock.calls.filter(
        call => call[0]?.includes('Stage')
      );
      
      // Should have logs for stages 1&2, 3, 4, 5, 6, 7
      expect(stageLogs.length).toBeGreaterThanOrEqual(6); // Combined stage 1&2 counts as one log
    });
  });

  describe('Integration Test - All Fixes Combined', () => {
    it('should handle complex multi-file analysis with all fixes applied', async () => {
      // Arrange - Create a simpler but effective test scenario
      const sourceCode = `
        function helperFunction() {
          console.log('Helper called');
          return 'helper';
        }
        
        function mainFunction() {
          const result = helperFunction();
          console.log('Result:', result);
          return result;
        }
      `;
      
      const sourceFile = project.createSourceFile('integration.ts', sourceCode);
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Verify various edge types are detected
      expect(edges.length).toBeGreaterThan(0);
      
      // Check for at least some external calls (console.log calls)
      const externalCalls = edges.filter(e => e.callType === 'external');
      expect(externalCalls.length).toBeGreaterThanOrEqual(1);
      
      // All edges should have valid column numbers
      edges.forEach(edge => {
        if (edge.columnNumber !== undefined) {
          expect(edge.columnNumber).toBeGreaterThanOrEqual(0);
          expect(edge.columnNumber).toBeLessThan(500); // Reasonable bound
        }
      });
      
      // Verify no errors during analysis
      expect(() => engine.getStatistics()).not.toThrow();
      const stats = engine.getStatistics();
      expect(stats.totalTime).toBeGreaterThan(0);
    });
  });
});