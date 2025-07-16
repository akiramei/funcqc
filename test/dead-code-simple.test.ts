import { describe, expect, it } from 'vitest';
import { EntryPointDetector } from '../src/analyzers/entry-point-detector';
import { ReachabilityAnalyzer } from '../src/analyzers/reachability-analyzer';

describe('Dead Code Detection - Simple Tests', () => {
  describe('EntryPointDetector', () => {
    it('should be created without errors', () => {
      const detector = new EntryPointDetector();
      expect(detector).toBeDefined();
    });

    it('should detect test files correctly', () => {
      const detector = new EntryPointDetector();
      
      // Create minimal function for testing
      const func = {
        id: 'test1',
        name: 'testFunction',
        displayName: 'testFunction',
        signature: 'testFunction(): void',
        filePath: '/src/app.test.ts',
        startLine: 1,
        endLine: 5,
        startColumn: 1,
        endColumn: 10,
        semanticId: 'semantic1',
        contentId: 'content1',
        astHash: 'ast1',
        signatureHash: 'sig1',
        fileHash: 'file1',
        isExported: false,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [],
      };

      const entryPoints = detector.detectEntryPoints([func]);
      expect(entryPoints).toHaveLength(1);
      expect(entryPoints[0].reason).toBe('test');
    });

    it('should detect exported functions correctly', () => {
      const detector = new EntryPointDetector();
      
      const func = {
        id: 'func1',
        name: 'exportedFunction',
        displayName: 'exportedFunction',
        signature: 'exportedFunction(): void',
        filePath: '/src/utils.ts',
        startLine: 1,
        endLine: 5,
        startColumn: 1,
        endColumn: 10,
        semanticId: 'semantic1',
        contentId: 'content1',
        astHash: 'ast1',
        signatureHash: 'sig1',
        fileHash: 'file1',
        isExported: true,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [],
      };

      const entryPoints = detector.detectEntryPoints([func]);
      expect(entryPoints).toHaveLength(1);
      expect(entryPoints[0].reason).toBe('exported');
    });
  });

  describe('ReachabilityAnalyzer', () => {
    it('should be created without errors', () => {
      const analyzer = new ReachabilityAnalyzer();
      expect(analyzer).toBeDefined();
    });

    it('should handle empty inputs', () => {
      const analyzer = new ReachabilityAnalyzer();
      
      const result = analyzer.analyzeReachability([], [], []);
      expect(result.reachable).toBeDefined();
      expect(result.unreachable).toBeDefined();
      expect(result.entryPoints).toBeDefined();
    });

    it('should detect circular dependencies', () => {
      const analyzer = new ReachabilityAnalyzer();
      
      const callEdges = [
        {
          id: 'edge1',
          callerFunctionId: 'func1',
          calleeFunctionId: 'func2',
          calleeName: 'function2',
          callType: 'direct' as const,
          lineNumber: 1,
          columnNumber: 1,
          isAsync: false,
          isChained: false,
          confidenceScore: 1.0,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
        {
          id: 'edge2',
          callerFunctionId: 'func2',
          calleeFunctionId: 'func1',
          calleeName: 'function1',
          callType: 'direct' as const,
          lineNumber: 2,
          columnNumber: 1,
          isAsync: false,
          isChained: false,
          confidenceScore: 1.0,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ];

      const cycles = analyzer.findCircularDependencies(callEdges);
      expect(cycles).toHaveLength(1);
    });
  });
});