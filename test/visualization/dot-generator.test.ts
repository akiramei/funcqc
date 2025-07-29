import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DotGenerator } from '../../src/visualization/dot-generator';
import { FunctionInfo, CallEdge } from '../../src/types';
import { DependencyMetrics } from '../../src/analyzers/dependency-metrics';
import { StronglyConnectedComponent } from '../../src/analyzers/scc-analyzer';

describe('DotGenerator', () => {
  let dotGenerator: DotGenerator;
  let mockFunctions: FunctionInfo[];
  let mockCallEdges: CallEdge[];
  let mockDependencyMetrics: DependencyMetrics[];
  let mockSCComponents: StronglyConnectedComponent[];

  beforeEach(() => {
    dotGenerator = new DotGenerator();
    
    // Create mock functions
    mockFunctions = [
      {
        id: 'func1',
        name: 'function1',
        filePath: '/src/file1.ts',
        startLine: 1,
        endLine: 10,
        isExported: true,
        isAsync: false,
        modifier: 'export',
        semanticId: 'semantic1',
        contentId: 'content1',
        hashId: 'hash1',
        snapshotId: 'snapshot1',
        typeParameters: [],
        returnType: 'void',
        parameters: [],
        isArrowFunction: false,
        isAnonymous: false,
        className: null,
        parentId: null,
        calleeNames: [],
        jsDoc: null,
        gitCommitHash: null,
        gitBranch: null,
        gitAuthor: null,
        gitTimestamp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'func2',
        name: 'function2',
        filePath: '/src/file2.ts',
        startLine: 1,
        endLine: 15,
        isExported: false,
        isAsync: true,
        modifier: 'private',
        semanticId: 'semantic2',
        contentId: 'content2',
        hashId: 'hash2',
        snapshotId: 'snapshot1',
        typeParameters: [],
        returnType: 'Promise<void>',
        parameters: [],
        isArrowFunction: true,
        isAnonymous: false,
        className: null,
        parentId: null,
        calleeNames: [],
        jsDoc: null,
        gitCommitHash: null,
        gitBranch: null,
        gitAuthor: null,
        gitTimestamp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // Create mock call edges
    mockCallEdges = [
      {
        id: 'edge1',
        callerFunctionId: 'func1',
        calleeFunctionId: 'func2',
        calleeName: 'function2',
        callType: 'direct',
        lineNumber: 5,
        columnNumber: 10,
        isAsync: false,
        calleeSignature: 'function2(): Promise<void>',
        callContext: 'normal',
      },
    ];

    // Create mock dependency metrics
    mockDependencyMetrics = [
      {
        functionId: 'func1',
        fanIn: 0,
        fanOut: 1,
        depth: 0,
        callCount: 1,
        calledByCount: 0,
        createdAt: new Date(),
      },
      {
        functionId: 'func2',
        fanIn: 1,
        fanOut: 0,
        depth: 1,
        callCount: 0,
        calledByCount: 1,
        createdAt: new Date(),
      },
    ];


    // Create mock SCC components
    mockSCComponents = [
      {
        id: 'scc1',
        functionIds: ['func1', 'func2'],
        size: 2,
        isRecursive: false,
        edges: [
          {
            id: 'edge1',
            callerFunctionId: 'func1',
            calleeFunctionId: 'func2',
            calleeName: 'function2',
            callType: 'direct',
            lineNumber: 5,
            columnNumber: 10,
            isAsync: false,
            calleeSignature: 'function2(): Promise<void>',
            callContext: 'normal',
          },
        ],
      },
    ];
  });

  describe('generateDependencyGraph', () => {
    it('should generate valid DOT format for dependency graph', () => {
      const result = dotGenerator.generateDependencyGraph(
        mockFunctions,
        mockCallEdges,
        mockDependencyMetrics
      );

      expect(result).toContain('digraph G {');
      expect(result).toContain('label="Function Graph"');
      expect(result).toContain('rankdir=TB');
      expect(result).toContain('"func1"');
      expect(result).toContain('"func2"');
      expect(result).toContain('"func1" -> "func2"');
      expect(result).toContain('}');
    });

    it('should include metrics in tooltip when includeMetrics is true', () => {
      const result = dotGenerator.generateDependencyGraph(
        mockFunctions,
        mockCallEdges,
        mockDependencyMetrics,
        { includeMetrics: true }
      );

      expect(result).toContain('tooltip');
      expect(result).toContain('Fan-in:');
      expect(result).toContain('Fan-out:');
    });

    it('should cluster by file when clusterBy is set to file', () => {
      const result = dotGenerator.generateDependencyGraph(
        mockFunctions,
        mockCallEdges,
        mockDependencyMetrics,
        { clusterBy: 'file' }
      );

      expect(result).toContain('subgraph cluster_');
      expect(result).toContain('file1.ts');
      expect(result).toContain('file2.ts');
    });

    it('should truncate long labels when maxLabelLength is set', () => {
      const longNameFunction = {
        ...mockFunctions[0],
        name: 'thisIsAVeryLongFunctionNameThatShouldBeTruncated',
      };

      const result = dotGenerator.generateDependencyGraph(
        [longNameFunction],
        [],
        mockDependencyMetrics,
        { maxLabelLength: 10 }
      );

      expect(result).toContain('thisIsA...');
    });
  });


  describe('generateCircularDependencyGraph', () => {
    it('should generate valid DOT format for circular dependency graph', () => {
      const cycles = [['function1', 'function2', 'function1']];
      
      const result = dotGenerator.generateCircularDependencyGraph(
        mockFunctions,
        cycles
      );

      expect(result).toContain('digraph G {');
      expect(result).toContain('label="Function Graph"');
      expect(result).toContain('"function1"');
      expect(result).toContain('"function2"');
      expect(result).toContain('"function1" -> "function2"');
      expect(result).toContain('}');
    });

    it('should highlight cycle nodes with highlight color', () => {
      const cycles = [['function1', 'function2', 'function1']];
      
      const result = dotGenerator.generateCircularDependencyGraph(
        mockFunctions,
        cycles,
        { highlightColor: 'red' }
      );

      expect(result).toContain('fillcolor=red');
      expect(result).toContain('color=red');
    });
  });

  describe('generateSCCGraph', () => {
    it('should generate valid DOT format for SCC graph', () => {
      const result = dotGenerator.generateSCCGraph(
        mockFunctions,
        mockSCComponents
      );

      expect(result).toContain('digraph G {');
      expect(result).toContain('label="Function Graph"');
      expect(result).toContain('subgraph cluster_scc1');
      expect(result).toContain('SCC scc1');
      expect(result).toContain('"func1"');
      expect(result).toContain('"func2"');
      expect(result).toContain('}');
    });

    it('should include component metrics in tooltip when includeMetrics is true', () => {
      const result = dotGenerator.generateSCCGraph(
        mockFunctions,
        mockSCComponents,
        { includeMetrics: true }
      );

      expect(result).toContain('tooltip');
      expect(result).toContain('Component:');
      expect(result).toContain('Size:');
      expect(result).toContain('Recursive:');
    });
  });

  describe('generateDeadCodeGraph', () => {
    it('should generate valid DOT format for dead code graph', () => {
      const deadFunctions = new Set(['func2']);
      
      const result = dotGenerator.generateDeadCodeGraph(
        mockFunctions,
        mockCallEdges,
        deadFunctions
      );

      expect(result).toContain('digraph G {');
      expect(result).toContain('label="Function Graph"');
      expect(result).toContain('Live Code');
      expect(result).toContain('Dead Code');
      expect(result).toContain('"func1"');
      expect(result).toContain('"func2"');
      expect(result).toContain('}');
    });

    it('should color dead code nodes differently', () => {
      const deadFunctions = new Set(['func2']);
      
      const result = dotGenerator.generateDeadCodeGraph(
        mockFunctions,
        mockCallEdges,
        deadFunctions
      );

      expect(result).toContain('fillcolor=lightcoral');
      expect(result).toContain('style=filled,dashed');
    });
  });

  describe('DOT format validation', () => {
    it('should generate syntactically correct DOT format', () => {
      const result = dotGenerator.generateDependencyGraph(
        mockFunctions,
        mockCallEdges,
        mockDependencyMetrics
      );

      // Check basic DOT structure
      expect(result).toMatch(/^digraph G \{[\s\S]*\}$/);
      expect(result).toContain('label=');
      expect(result).toContain('rankdir=');
      
      // Check node definitions
      expect(result).toMatch(/"[^"]*" \[[^\]]*\];/);
      
      // Check edge definitions
      expect(result).toMatch(/"[^"]*" -> "[^"]*" \[[^\]]*\];/);
    });

    it('should sanitize node IDs to be DOT-compliant', () => {
      const specialCharFunction = {
        ...mockFunctions[0],
        id: 'func-with-special@chars#123',
      };

      const specialCharMetrics = {
        ...mockDependencyMetrics[0],
        functionId: 'func-with-special@chars#123',
      };

      const result = dotGenerator.generateDependencyGraph(
        [specialCharFunction],
        [],
        [specialCharMetrics]
      );

      // Special characters should be replaced with underscores
      expect(result).toContain('func_with_special_chars_123');
      expect(result).not.toContain('func-with-special@chars#123');
    });
  });

  describe('options handling', () => {
    it('should apply custom title', () => {
      const result = dotGenerator.generateDependencyGraph(
        mockFunctions,
        mockCallEdges,
        mockDependencyMetrics,
        { title: 'Custom Graph Title' }
      );

      expect(result).toContain('label="Custom Graph Title"');
    });

    it('should apply custom rank direction', () => {
      const result = dotGenerator.generateDependencyGraph(
        mockFunctions,
        mockCallEdges,
        mockDependencyMetrics,
        { rankdir: 'LR' }
      );

      expect(result).toContain('rankdir=LR');
    });

    it('should apply custom node shape', () => {
      const result = dotGenerator.generateDependencyGraph(
        mockFunctions,
        mockCallEdges,
        mockDependencyMetrics,
        { nodeShape: 'circle' }
      );

      expect(result).toContain('shape=circle');
    });

    it('should apply custom colors', () => {
      const result = dotGenerator.generateDependencyGraph(
        mockFunctions,
        mockCallEdges,
        mockDependencyMetrics,
        { 
          nodeColor: 'lightgreen',
          edgeColor: 'blue',
          highlightColor: 'red',
        }
      );

      expect(result).toContain('fillcolor=lightgreen');
      expect(result).toContain('color=blue');
    });
  });
});