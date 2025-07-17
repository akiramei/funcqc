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

  describe('Advanced Tarjan Algorithm Tests', () => {
    it('should handle large SCC correctly (performance test)', () => {
      // Create a cycle of 50 functions: A1 -> A2 -> ... -> A50 -> A1
      const callEdges: CallEdge[] = [];
      const functionIds: string[] = [];
      
      // Generate 50 function IDs
      for (let i = 1; i <= 50; i++) {
        functionIds.push(`A${i}`);
      }
      
      // Create circular edges
      for (let i = 0; i < 50; i++) {
        const currentId = functionIds[i];
        const nextId = functionIds[(i + 1) % 50]; // Wrap around at end
        
        callEdges.push({
          callerFunctionId: currentId,
          calleeFunctionId: nextId,
          calleeName: `function${nextId}`,
          callType: 'direct',
          lineNumber: i + 1,
          callContext: 'normal',
        });
      }

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.components).toHaveLength(1);
      expect(result.totalComponents).toBe(1);
      expect(result.largestComponentSize).toBe(50);
      expect(result.recursiveFunctions).toHaveLength(0); // No self-loops
      
      const component = result.components[0];
      expect(component.size).toBe(50);
      expect(component.functionIds).toHaveLength(50);
      expect(component.isRecursive).toBe(false);
      
      // Verify all functions are in the component
      for (const functionId of functionIds) {
        expect(component.functionIds).toContain(functionId);
      }
    });

    it('should handle complex interconnected SCCs (stress test)', () => {
      const callEdges: CallEdge[] = [
        // SCC 1: A1 -> A2 -> A3 -> A1 (size 3)
        { callerFunctionId: 'A1', calleeFunctionId: 'A2', calleeName: 'A2', callType: 'direct', lineNumber: 1, callContext: 'normal' },
        { callerFunctionId: 'A2', calleeFunctionId: 'A3', calleeName: 'A3', callType: 'direct', lineNumber: 2, callContext: 'normal' },
        { callerFunctionId: 'A3', calleeFunctionId: 'A1', calleeName: 'A1', callType: 'direct', lineNumber: 3, callContext: 'normal' },
        
        // SCC 2: B1 -> B2 -> B3 -> B4 -> B1 (size 4)
        { callerFunctionId: 'B1', calleeFunctionId: 'B2', calleeName: 'B2', callType: 'direct', lineNumber: 4, callContext: 'normal' },
        { callerFunctionId: 'B2', calleeFunctionId: 'B3', calleeName: 'B3', callType: 'direct', lineNumber: 5, callContext: 'normal' },
        { callerFunctionId: 'B3', calleeFunctionId: 'B4', calleeName: 'B4', callType: 'direct', lineNumber: 6, callContext: 'normal' },
        { callerFunctionId: 'B4', calleeFunctionId: 'B1', calleeName: 'B1', callType: 'direct', lineNumber: 7, callContext: 'normal' },
        
        // SCC 3: C1 -> C2 -> C1 (size 2)
        { callerFunctionId: 'C1', calleeFunctionId: 'C2', calleeName: 'C2', callType: 'direct', lineNumber: 8, callContext: 'normal' },
        { callerFunctionId: 'C2', calleeFunctionId: 'C1', calleeName: 'C1', callType: 'direct', lineNumber: 9, callContext: 'normal' },
        
        // Multiple recursive functions
        { callerFunctionId: 'D1', calleeFunctionId: 'D1', calleeName: 'D1', callType: 'direct', lineNumber: 10, callContext: 'normal' },
        { callerFunctionId: 'D2', calleeFunctionId: 'D2', calleeName: 'D2', callType: 'direct', lineNumber: 11, callContext: 'normal' },
        
        // Inter-SCC connections (these should not create larger SCCs)
        { callerFunctionId: 'A1', calleeFunctionId: 'B1', calleeName: 'B1', callType: 'direct', lineNumber: 12, callContext: 'normal' },
        { callerFunctionId: 'B2', calleeFunctionId: 'C1', calleeName: 'C1', callType: 'direct', lineNumber: 13, callContext: 'normal' },
        { callerFunctionId: 'C2', calleeFunctionId: 'D1', calleeName: 'D1', callType: 'direct', lineNumber: 14, callContext: 'normal' },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.components).toHaveLength(5); // 3 cycles + 2 self-loops
      expect(result.totalComponents).toBe(5);
      expect(result.largestComponentSize).toBe(4); // B1-B4 cycle
      expect(result.recursiveFunctions).toHaveLength(2); // D1, D2
      
      // Find components by size
      const componentsBySize = result.components.sort((a, b) => b.size - a.size);
      expect(componentsBySize[0].size).toBe(4); // B1-B4
      expect(componentsBySize[1].size).toBe(3); // A1-A3
      expect(componentsBySize[2].size).toBe(2); // C1-C2
      expect(componentsBySize[3].size).toBe(1); // D1 (recursive)
      expect(componentsBySize[4].size).toBe(1); // D2 (recursive)
      
      // Verify recursive functions
      const recursiveComponents = result.components.filter(c => c.isRecursive);
      expect(recursiveComponents).toHaveLength(2);
      expect(recursiveComponents[0].functionIds[0]).toMatch(/D[12]/);
      expect(recursiveComponents[1].functionIds[0]).toMatch(/D[12]/);
    });

    it('should handle edge cases with null/undefined callees', () => {
      const callEdges: CallEdge[] = [
        // Normal cycle
        { callerFunctionId: 'A', calleeFunctionId: 'B', calleeName: 'B', callType: 'direct', lineNumber: 1, callContext: 'normal' },
        { callerFunctionId: 'B', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 2, callContext: 'normal' },
        
        // External calls (should be ignored)
        { callerFunctionId: 'A', calleeFunctionId: null, calleeName: 'externalFunc', callType: 'direct', lineNumber: 3, callContext: 'normal' },
        { callerFunctionId: 'B', calleeFunctionId: '', calleeName: 'emptyFunc', callType: 'direct', lineNumber: 4, callContext: 'normal' },
        { callerFunctionId: 'C', calleeFunctionId: null, calleeName: 'anotherExternal', callType: 'direct', lineNumber: 5, callContext: 'normal' },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      expect(result.components).toHaveLength(1);
      expect(result.totalComponents).toBe(1);
      expect(result.largestComponentSize).toBe(2);
      
      const component = result.components[0];
      expect(component.size).toBe(2);
      expect(component.functionIds).toContain('A');
      expect(component.functionIds).toContain('B');
    });

    it('should handle deeply nested recursive patterns', () => {
      const callEdges: CallEdge[] = [
        // Pattern: A -> B -> C -> D -> A (4-cycle)
        // Plus each function also calls itself (self-recursive)
        { callerFunctionId: 'A', calleeFunctionId: 'B', calleeName: 'B', callType: 'direct', lineNumber: 1, callContext: 'normal' },
        { callerFunctionId: 'B', calleeFunctionId: 'C', calleeName: 'C', callType: 'direct', lineNumber: 2, callContext: 'normal' },
        { callerFunctionId: 'C', calleeFunctionId: 'D', calleeName: 'D', callType: 'direct', lineNumber: 3, callContext: 'normal' },
        { callerFunctionId: 'D', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 4, callContext: 'normal' },
        
        // Self-recursive calls
        { callerFunctionId: 'A', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 5, callContext: 'normal' },
        { callerFunctionId: 'B', calleeFunctionId: 'B', calleeName: 'B', callType: 'direct', lineNumber: 6, callContext: 'normal' },
        { callerFunctionId: 'C', calleeFunctionId: 'C', calleeName: 'C', callType: 'direct', lineNumber: 7, callContext: 'normal' },
        { callerFunctionId: 'D', calleeFunctionId: 'D', calleeName: 'D', callType: 'direct', lineNumber: 8, callContext: 'normal' },
      ];

      const result = analyzer.findStronglyConnectedComponents(callEdges);
      
      // Should form one large SCC containing all functions
      expect(result.components).toHaveLength(1);
      expect(result.totalComponents).toBe(1);
      expect(result.largestComponentSize).toBe(4);
      expect(result.recursiveFunctions).toHaveLength(0); // Not single-node recursive
      
      const component = result.components[0];
      expect(component.size).toBe(4);
      expect(component.functionIds).toContain('A');
      expect(component.functionIds).toContain('B');
      expect(component.functionIds).toContain('C');
      expect(component.functionIds).toContain('D');
      expect(component.isRecursive).toBe(false); // Multi-node SCC
    });

    it('should verify condensation graph correctness for complex scenarios', () => {
      const callEdges: CallEdge[] = [
        // SCC1: A -> B -> A
        { callerFunctionId: 'A', calleeFunctionId: 'B', calleeName: 'B', callType: 'direct', lineNumber: 1, callContext: 'normal' },
        { callerFunctionId: 'B', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 2, callContext: 'normal' },
        
        // SCC2: C -> D -> C
        { callerFunctionId: 'C', calleeFunctionId: 'D', calleeName: 'D', callType: 'direct', lineNumber: 3, callContext: 'normal' },
        { callerFunctionId: 'D', calleeFunctionId: 'C', calleeName: 'C', callType: 'direct', lineNumber: 4, callContext: 'normal' },
        
        // Individual nodes (these will NOT form cycles)
        { callerFunctionId: 'E', calleeFunctionId: 'F', calleeName: 'F', callType: 'direct', lineNumber: 5, callContext: 'normal' },
        { callerFunctionId: 'G', calleeFunctionId: 'H', calleeName: 'H', callType: 'direct', lineNumber: 6, callContext: 'normal' },
        
        // Inter-component edges (create DAG structure)
        { callerFunctionId: 'A', calleeFunctionId: 'C', calleeName: 'C', callType: 'direct', lineNumber: 7, callContext: 'normal' },
        { callerFunctionId: 'B', calleeFunctionId: 'C', calleeName: 'C', callType: 'direct', lineNumber: 8, callContext: 'normal' },
        { callerFunctionId: 'D', calleeFunctionId: 'E', calleeName: 'E', callType: 'direct', lineNumber: 9, callContext: 'normal' },
        { callerFunctionId: 'F', calleeFunctionId: 'G', calleeName: 'G', callType: 'direct', lineNumber: 10, callContext: 'normal' },
      ];

      const result = analyzer.calculateCondensationGraph(callEdges);
      
      // Should have nodes for: SCC1(A,B), SCC2(C,D), individual E, F, G, H
      expect(result.nodes).toHaveLength(6);
      
      // Should have edges between components
      expect(result.edges.length).toBeGreaterThan(0);
      
      // Verify individual nodes were created for non-SCC functions
      const individualNodes = result.nodes.filter(n => n.size === 1);
      expect(individualNodes).toHaveLength(4); // E, F, G, H
      
      // Verify SCC nodes
      const sccNodes = result.nodes.filter(n => n.size > 1);
      expect(sccNodes).toHaveLength(2); // A-B and C-D
      
      // Check edge counts (A->C and B->C should be counted)
      const edgeFromAB = result.edges.find(e => 
        e.from === result.nodes.find(n => n.functionIds.includes('A'))?.id
      );
      expect(edgeFromAB?.count).toBe(2); // A->C and B->C
    });
  });

  describe('Centrality-based Risk Analysis', () => {
    it('should calculate centrality scores correctly', () => {
      // Create a simple SCC with known centrality pattern
      const component = {
        id: 'scc-1',
        functionIds: ['A', 'B', 'C'],
        size: 3,
        edges: [
          // A is central: A->B, A->C, B->A, C->A
          { callerFunctionId: 'A', calleeFunctionId: 'B', calleeName: 'B', callType: 'direct', lineNumber: 1, callContext: 'normal' },
          { callerFunctionId: 'A', calleeFunctionId: 'C', calleeName: 'C', callType: 'direct', lineNumber: 2, callContext: 'normal' },
          { callerFunctionId: 'B', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 3, callContext: 'normal' },
          { callerFunctionId: 'C', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 4, callContext: 'normal' },
        ],
        isRecursive: false,
      };

      const result = analyzer.analyzeSCCCentrality(component);
      
      // A should have highest centrality (degree 4: 2 in, 2 out)
      // B and C should have lower centrality (degree 2 each: 1 in, 1 out)
      expect(result.centralityScores.get('A')).toBeGreaterThan(result.centralityScores.get('B')!);
      expect(result.centralityScores.get('A')).toBeGreaterThan(result.centralityScores.get('C')!);
      
      // Risk adjustment should be > 1 due to centrality variance
      expect(result.riskAdjustment).toBeGreaterThan(1);
      
      // Centrality distribution should be sorted by adjusted risk
      expect(result.centralityDistribution).toHaveLength(3);
      expect(result.centralityDistribution[0].functionId).toBe('A'); // Highest risk
    });

    it('should provide enhanced risk analysis with centrality', () => {
      const component = {
        id: 'scc-1',
        functionIds: ['A', 'B', 'C'],
        size: 3,
        edges: [
          { callerFunctionId: 'A', calleeFunctionId: 'B', calleeName: 'B', callType: 'direct', lineNumber: 1, callContext: 'normal' },
          { callerFunctionId: 'B', calleeFunctionId: 'C', calleeName: 'C', callType: 'direct', lineNumber: 2, callContext: 'normal' },
          { callerFunctionId: 'C', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 3, callContext: 'normal' },
        ],
        isRecursive: false,
      };

      const functionMetrics = new Map([
        ['A', { cyclomaticComplexity: 15, linesOfCode: 50 }],
        ['B', { cyclomaticComplexity: 10, linesOfCode: 30 }],
        ['C', { cyclomaticComplexity: 8, linesOfCode: 25 }],
      ]);

      const result = analyzer.analyzeEnhancedSCCRisk(component, functionMetrics);
      
      // Should have both basic and centrality analysis
      expect(result.basicAnalysis.totalComplexity).toBe(33); // 15 + 10 + 8
      expect(result.basicAnalysis.averageComplexity).toBe(11); // 33 / 3
      
      // Should have centrality analysis
      expect(result.centralityAnalysis.centralityScores.size).toBe(3);
      expect(result.centralityAnalysis.centralityDistribution).toHaveLength(3);
      
      // Should have enhanced risk level
      expect(['critical', 'high', 'medium', 'low']).toContain(result.enhancedRiskLevel);
      
      // Should have recommendations
      expect(result.recommendations).toBeInstanceOf(Array);
    });

    it('should handle edge cases in centrality calculation', () => {
      // Single function SCC (self-recursive)
      const component = {
        id: 'scc-1',
        functionIds: ['A'],
        size: 1,
        edges: [
          { callerFunctionId: 'A', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 1, callContext: 'normal' },
        ],
        isRecursive: true,
      };

      const result = analyzer.analyzeSCCCentrality(component);
      
      // Single function should have 0 centrality (no other functions to connect to)
      expect(result.centralityScores.get('A')).toBe(0);
      expect(result.centralityDistribution).toHaveLength(1);
    });

    it('should generate appropriate recommendations based on centrality', () => {
      // Large SCC with high centrality variance
      const component = {
        id: 'scc-1',
        functionIds: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
        size: 11,
        edges: [
          // A is highly central
          { callerFunctionId: 'A', calleeFunctionId: 'B', calleeName: 'B', callType: 'direct', lineNumber: 1, callContext: 'normal' },
          { callerFunctionId: 'A', calleeFunctionId: 'C', calleeName: 'C', callType: 'direct', lineNumber: 2, callContext: 'normal' },
          { callerFunctionId: 'A', calleeFunctionId: 'D', calleeName: 'D', callType: 'direct', lineNumber: 3, callContext: 'normal' },
          { callerFunctionId: 'B', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 4, callContext: 'normal' },
          { callerFunctionId: 'C', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 5, callContext: 'normal' },
          { callerFunctionId: 'D', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 6, callContext: 'normal' },
          // Simple cycle for remaining functions
          { callerFunctionId: 'E', calleeFunctionId: 'F', calleeName: 'F', callType: 'direct', lineNumber: 7, callContext: 'normal' },
          { callerFunctionId: 'F', calleeFunctionId: 'G', calleeName: 'G', callType: 'direct', lineNumber: 8, callContext: 'normal' },
          { callerFunctionId: 'G', calleeFunctionId: 'H', calleeName: 'H', callType: 'direct', lineNumber: 9, callContext: 'normal' },
          { callerFunctionId: 'H', calleeFunctionId: 'I', calleeName: 'I', callType: 'direct', lineNumber: 10, callContext: 'normal' },
          { callerFunctionId: 'I', calleeFunctionId: 'J', calleeName: 'J', callType: 'direct', lineNumber: 11, callContext: 'normal' },
          { callerFunctionId: 'J', calleeFunctionId: 'K', calleeName: 'K', callType: 'direct', lineNumber: 12, callContext: 'normal' },
          { callerFunctionId: 'K', calleeFunctionId: 'E', calleeName: 'E', callType: 'direct', lineNumber: 13, callContext: 'normal' },
          // Connect the two parts
          { callerFunctionId: 'A', calleeFunctionId: 'E', calleeName: 'E', callType: 'direct', lineNumber: 14, callContext: 'normal' },
          { callerFunctionId: 'E', calleeFunctionId: 'A', calleeName: 'A', callType: 'direct', lineNumber: 15, callContext: 'normal' },
        ],
        isRecursive: false,
      };

      const functionMetrics = new Map([
        ['A', { cyclomaticComplexity: 20, linesOfCode: 100 }],
        ['B', { cyclomaticComplexity: 5, linesOfCode: 20 }],
        ['C', { cyclomaticComplexity: 5, linesOfCode: 20 }],
        ['D', { cyclomaticComplexity: 5, linesOfCode: 20 }],
        ['E', { cyclomaticComplexity: 8, linesOfCode: 40 }],
        ['F', { cyclomaticComplexity: 3, linesOfCode: 15 }],
        ['G', { cyclomaticComplexity: 3, linesOfCode: 15 }],
        ['H', { cyclomaticComplexity: 3, linesOfCode: 15 }],
        ['I', { cyclomaticComplexity: 3, linesOfCode: 15 }],
        ['J', { cyclomaticComplexity: 3, linesOfCode: 15 }],
        ['K', { cyclomaticComplexity: 3, linesOfCode: 15 }],
      ]);

      const result = analyzer.analyzeEnhancedSCCRisk(component, functionMetrics);
      
      // Should recommend architectural redesign for large SCC (size > 10)
      expect(result.recommendations.some(r => r.includes('architectural redesign'))).toBe(true);
      
      // Should identify architectural issues based on centrality distribution
      expect(result.recommendations.some(r => r.includes('architectural issues'))).toBe(true);
      
      // Should have recommendations array with some content
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });
});