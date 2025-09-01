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

    it('should detect static methods as entry points', () => {
      const detector = new EntryPointDetector();
      
      // Create minimal static method for testing
      const staticMethod = {
        id: 'static1',
        name: 'getStorage',
        displayName: 'getStorage',
        signature: 'static getStorage(): void',
        filePath: '/src/storage-manager.ts',
        startLine: 59,
        endLine: 64,
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
        isMethod: true,
        isConstructor: false,
        isStatic: true,
        parameters: [],
        className: 'StorageManager',
        contextPath: ['StorageManager'],
        modifiers: ['static']
      };

      const entryPoints = detector.detectEntryPoints([staticMethod]);
      expect(entryPoints).toHaveLength(2); // Both 'static-method' and 'exported'
      expect(entryPoints.map(ep => ep.reason)).toContain('static-method');
      expect(entryPoints.find(ep => ep.reason === 'static-method')?.className).toBe('StorageManager');
    });

    it('should exclude static methods when excludeStaticMethods option is true', () => {
      const detector = new EntryPointDetector({ excludeStaticMethods: true });
      
      // Create minimal static method for testing
      const staticMethod = {
        id: 'static1',
        name: 'getStorage',
        displayName: 'getStorage',
        signature: 'static getStorage(): void',
        filePath: '/src/storage-manager.ts',
        startLine: 59,
        endLine: 64,
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
        isMethod: true,
        isConstructor: false,
        isStatic: true,
        parameters: [],
        className: 'StorageManager',
        contextPath: ['StorageManager'],
        modifiers: ['static']
      };

      const entryPoints = detector.detectEntryPoints([staticMethod]);
      expect(entryPoints).toHaveLength(1); // Only 'exported', not 'static-method'
      expect(entryPoints[0].reason).toBe('exported');
      expect(entryPoints.map(ep => ep.reason)).not.toContain('static-method');
    });

    it('should detect exported functions as entry points (prevents false positives)', () => {
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
      // Exported functions SHOULD be automatically considered entry points to prevent false positives
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
      expect(result.unusedExports).toBeDefined();
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

    it('should detect unused export functions', () => {
      const analyzer = new ReachabilityAnalyzer();
      
      const functions = [
        {
          id: 'func1',
          name: 'usedFunction',
          isExported: true,
          filePath: '/src/api.ts',
          startLine: 1,
          endLine: 10,
          startColumn: 1,
          endColumn: 1,
          displayName: 'usedFunction',
          signature: 'usedFunction(): void',
          semanticId: 'semantic1',
          contentId: 'content1',
          astHash: 'ast1',
          signatureHash: 'sig1',
          fileHash: 'file1',
          isAsync: false,
          isGenerator: false,
          isArrowFunction: false,
          isMethod: false,
          isConstructor: false,
          isStatic: false,
          parameters: [],
        },
        {
          id: 'func2',
          name: 'unusedExportFunction',
          isExported: true,
          filePath: '/src/old-api.ts',
          startLine: 1,
          endLine: 10,
          startColumn: 1,
          endColumn: 1,
          displayName: 'unusedExportFunction',
          signature: 'unusedExportFunction(): void',
          semanticId: 'semantic2',
          contentId: 'content2',
          astHash: 'ast2',
          signatureHash: 'sig2',
          fileHash: 'file2',
          isAsync: false,
          isGenerator: false,
          isArrowFunction: false,
          isMethod: false,
          isConstructor: false,
          isStatic: false,
          parameters: [],
        },
        {
          id: 'func3',
          name: 'internalFunction',
          isExported: false,
          filePath: '/src/internal.ts',
          startLine: 1,
          endLine: 10,
          startColumn: 1,
          endColumn: 1,
          displayName: 'internalFunction',
          signature: 'internalFunction(): void',
          semanticId: 'semantic3',
          contentId: 'content3',
          astHash: 'ast3',
          signatureHash: 'sig3',
          fileHash: 'file3',
          isAsync: false,
          isGenerator: false,
          isArrowFunction: false,
          isMethod: false,
          isConstructor: false,
          isStatic: false,
          parameters: [],
        }
      ];

      const callEdges = [
        // No calls to any function - all are unreachable
      ];

      const entryPoints = [
        // No entry points - simulating scenario where exports are not automatically entry points
      ];

      const result = analyzer.analyzeReachability(functions, callEdges, entryPoints);
      
      // All functions should be unreachable
      expect(result.unreachable.size).toBe(3);
      
      // Only exported functions should be in unusedExports
      expect(result.unusedExports.size).toBe(2);
      expect(result.unusedExports.has('func1')).toBe(true);  // usedFunction (exported)
      expect(result.unusedExports.has('func2')).toBe(true);  // unusedExportFunction (exported)
      expect(result.unusedExports.has('func3')).toBe(false); // internalFunction (not exported)
    });
  });
});