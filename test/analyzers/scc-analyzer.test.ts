import { describe, it, expect, beforeEach } from 'vitest';
import { SCCAnalyzer } from '../../src/analyzers/scc-analyzer';
import { CallEdge } from '../../src/types';

describe('SCCAnalyzer', () => {
  let analyzer: SCCAnalyzer;

  beforeEach(() => {
    analyzer = new SCCAnalyzer();
  });

  describe('findStronglyConnectedComponents', () => {
    it('should find no SCCs in acyclic graph', () => {
      const callEdges: CallEdge[] = [
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.components).toHaveLength(0);
      expect(result.totalComponents).toBe(0);
      expect(result.largestComponentSize).toBe(0);
      expect(result.recursiveFunctions).toHaveLength(0);
    });

    it('should find self-loop (recursive function)', () => {
      const callEdges: CallEdge[] = [
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.components).toHaveLength(1);
      expect(result.totalComponents).toBe(1);
      expect(result.largestComponentSize).toBe(1);
      expect(result.recursiveFunctions).toHaveLength(1);
      expect(result.recursiveFunctions[0]).toBe('A');
      
      const component = result.components[0];
      expect(component.size).toBe(1);
      expect(component.functionIds).toContain('A');
      expect(component.isRecursive).toBe(true);
    });

    it('should find simple cycle (two functions)', () => {
      const callEdges: CallEdge[] = [
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.components).toHaveLength(1);
      expect(result.totalComponents).toBe(1);
      expect(result.largestComponentSize).toBe(2);
      expect(result.recursiveFunctions).toHaveLength(0);
      
      const component = result.components[0];
      expect(component.size).toBe(2);
      expect(component.functionIds).toContain('A');
      expect(component.functionIds).toContain('B');
      expect(component.isRecursive).toBe(false);
    });

    it('should find complex cycle (three functions)', () => {
      const callEdges: CallEdge[] = [
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 3,
          callContext: 'normal',
        },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.components).toHaveLength(1);
      expect(result.totalComponents).toBe(1);
      expect(result.largestComponentSize).toBe(3);
      
      const component = result.components[0];
      expect(component.size).toBe(3);
      expect(component.functionIds).toContain('A');
      expect(component.functionIds).toContain('B');
      expect(component.functionIds).toContain('C');
      expect(component.isRecursive).toBe(false);
    });

    it('should find multiple separate SCCs', () => {
      const callEdges: CallEdge[] = [
        // First cycle: A -> B -> A
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
        // Second cycle: C -> D -> E -> C
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'functionD',
          callType: 'direct',
          lineNumber: 3,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'E',
          calleeName: 'functionE',
          callType: 'direct',
          lineNumber: 4,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'E',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        // Recursive function: F -> F
        {
          callerFunctionId: 'F',
          calleeFunctionId: 'F',
          calleeName: 'functionF',
          callType: 'direct',
          lineNumber: 6,
          callContext: 'normal',
        },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.components).toHaveLength(3);
      expect(result.totalComponents).toBe(3);
      expect(result.largestComponentSize).toBe(3);
      expect(result.recursiveFunctions).toHaveLength(1);
      expect(result.recursiveFunctions[0]).toBe('F');
      
      // Find components by size
      const componentsBySize = result.components.sort((a, b) => b.size - a.size);
      expect(componentsBySize[0].size).toBe(3); // C, D, E
      expect(componentsBySize[1].size).toBe(2); // A, B
      expect(componentsBySize[2].size).toBe(1); // F (recursive)
      expect(componentsBySize[2].isRecursive).toBe(true);
    });

    it('should handle mixed graph with cycles and acyclic parts', () => {
      const callEdges: CallEdge[] = [
        // Acyclic part: G -> H -> I
        {
          callerFunctionId: 'G',
          calleeFunctionId: 'H',
          calleeName: 'functionH',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'H',
          calleeFunctionId: 'I',
          calleeName: 'functionI',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
        // Cycle: J -> K -> J
        {
          callerFunctionId: 'J',
          calleeFunctionId: 'K',
          calleeName: 'functionK',
          callType: 'direct',
          lineNumber: 3,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'K',
          calleeFunctionId: 'J',
          calleeName: 'functionJ',
          callType: 'direct',
          lineNumber: 4,
          callContext: 'normal',
        },
        // Connection from acyclic to cycle: I -> J
        {
          callerFunctionId: 'I',
          calleeFunctionId: 'J',
          calleeName: 'functionJ',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      // Should only find the cycle J -> K -> J
      expect(result.components).toHaveLength(1);
      expect(result.totalComponents).toBe(1);
      expect(result.largestComponentSize).toBe(2);
      
      const component = result.components[0];
      expect(component.size).toBe(2);
      expect(component.functionIds).toContain('J');
      expect(component.functionIds).toContain('K');
    });

    it('should generate correct component map', () => {
      const callEdges: CallEdge[] = [
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.componentMap.size).toBe(2);
      expect(result.componentMap.get('A')).toBe(result.components[0].id);
      expect(result.componentMap.get('B')).toBe(result.components[0].id);
      expect(result.componentMap.get('A')).toBe(result.componentMap.get('B'));
    });
  });

  describe('calculateCondensationGraph', () => {
    it('should create condensation graph for complex SCC structure', () => {
      const callEdges: CallEdge[] = [
        // SCC 1: A -> B -> A
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
        // SCC 2: C -> D -> C
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'functionD',
          callType: 'direct',
          lineNumber: 3,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 4,
          callContext: 'normal',
        },
        // Edge between SCCs: A -> C
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
      ];

      const result = analyzer.calculateCondensationGraph(callEdges);
      
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      
      const edge = result.edges[0];
      expect(edge.count).toBe(1);
      
      // Check that the edge connects the correct components
      const scc1 = result.nodes.find(n => n.functionIds.includes('A'));
      const scc2 = result.nodes.find(n => n.functionIds.includes('C'));
      expect(scc1).toBeDefined();
      expect(scc2).toBeDefined();
      expect(edge.from).toBe(scc1!.id);
      expect(edge.to).toBe(scc2!.id);
    });
  });

  describe('getTopologicalOrder', () => {
    it('should return topological order for DAG of SCCs', () => {
      const callEdges: CallEdge[] = [
        // SCC 1: A -> B -> A
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
        // SCC 2: C (single node)
        // Edge between SCCs: A -> C (creates topological order)
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 3,
          callContext: 'normal',
        },
      ];

      const result = analyzer.getTopologicalOrder(callEdges);
      
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      
      // The order should be: [A, B] before [C]
      const firstLevel = result![0];
      const secondLevel = result![1];
      
      expect(firstLevel).toContain('A');
      expect(firstLevel).toContain('B');
      expect(secondLevel).toContain('C');
    });

    it('should handle complex SCC correctly', () => {
      const callEdges: CallEdge[] = [
        // Complex SCC: A -> B -> A and C -> D -> C, with A -> C and D -> A
        // This creates one large SCC containing all functions
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'B',
          calleeName: 'functionB',
          callType: 'direct',
          lineNumber: 1,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'B',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 2,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'C',
          calleeFunctionId: 'D',
          calleeName: 'functionD',
          callType: 'direct',
          lineNumber: 3,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 4,
          callContext: 'normal',
        },
        // Connections that merge the SCCs
        {
          callerFunctionId: 'A',
          calleeFunctionId: 'C',
          calleeName: 'functionC',
          callType: 'direct',
          lineNumber: 5,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'D',
          calleeFunctionId: 'A',
          calleeName: 'functionA',
          callType: 'direct',
          lineNumber: 6,
          callContext: 'normal',
        },
      ];

      const result = analyzer.getTopologicalOrder(callEdges);
      
      // Should successfully return topological order with one component
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0]).toHaveLength(4); // All four functions in one SCC
    });
  });

  describe('analyzeSCCComplexity', () => {
    it('should calculate complexity metrics for SCC', () => {
      const component = {
        id: 'scc-1',
        functionIds: ['A', 'B', 'C'],
        size: 3,
        edges: [],
        isRecursive: false,
      };

      const functionMetrics = new Map([
        ['A', { cyclomaticComplexity: 10, linesOfCode: 50 }],
        ['B', { cyclomaticComplexity: 15, linesOfCode: 60 }],
        ['C', { cyclomaticComplexity: 20, linesOfCode: 70 }],
      ]);

      const result = analyzer.analyzeSCCComplexity(component, functionMetrics);
      
      expect(result.totalComplexity).toBe(45); // 10 + 15 + 20
      expect(result.totalLines).toBe(180); // 50 + 60 + 70
      expect(result.averageComplexity).toBe(15); // 45 / 3
      expect(result.riskLevel).toBe('medium'); // 3 functions, 45 complexity
    });

    it('should determine high risk for large complex SCCs', () => {
      const component = {
        id: 'scc-1',
        functionIds: ['A', 'B', 'C', 'D', 'E', 'F'],
        size: 6,
        edges: [],
        isRecursive: false,
      };

      const functionMetrics = new Map([
        ['A', { cyclomaticComplexity: 10, linesOfCode: 50 }],
        ['B', { cyclomaticComplexity: 10, linesOfCode: 50 }],
        ['C', { cyclomaticComplexity: 10, linesOfCode: 50 }],
        ['D', { cyclomaticComplexity: 10, linesOfCode: 50 }],
        ['E', { cyclomaticComplexity: 10, linesOfCode: 50 }],
        ['F', { cyclomaticComplexity: 10, linesOfCode: 50 }],
      ]);

      const result = analyzer.analyzeSCCComplexity(component, functionMetrics);
      
      expect(result.riskLevel).toBe('high'); // 6 functions > 5
    });

    it('should determine low risk for small simple SCCs', () => {
      const component = {
        id: 'scc-1',
        functionIds: ['A', 'B'],
        size: 2,
        edges: [],
        isRecursive: false,
      };

      const functionMetrics = new Map([
        ['A', { cyclomaticComplexity: 5, linesOfCode: 20 }],
        ['B', { cyclomaticComplexity: 5, linesOfCode: 20 }],
      ]);

      const result = analyzer.analyzeSCCComplexity(component, functionMetrics);
      
      expect(result.riskLevel).toBe('low'); // 2 functions, 10 total complexity
    });
  });
});