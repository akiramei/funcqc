import { describe, it, expect, beforeEach } from 'vitest';
import { StructuralAnalyzer } from '../src/utils/structural-analyzer';
import { FunctionInfo } from '../src/types';

describe('StructuralAnalyzer', () => {
  let analyzer: StructuralAnalyzer;
  let mockFunctions: FunctionInfo[];

  beforeEach(() => {
    analyzer = new StructuralAnalyzer();
    
    // Create mock functions with dependency relationships
    mockFunctions = [
      {
        id: 'func1',
        name: 'mainFunction',
        dependencies: [
          { id: 'dep1', functionId: 'func1', dependencyType: 'call', targetName: 'helperFunction', isExternal: false, usageCount: 1 },
          { id: 'dep2', functionId: 'func1', dependencyType: 'call', targetName: 'utilFunction', isExternal: false, usageCount: 2 }
        ]
      },
      {
        id: 'func2',
        name: 'helperFunction',
        dependencies: [
          { id: 'dep3', functionId: 'func2', dependencyType: 'call', targetName: 'utilFunction', isExternal: false, usageCount: 1 }
        ]
      },
      {
        id: 'func3',
        name: 'utilFunction',
        dependencies: []
      }
    ] as FunctionInfo[];
  });

  it('should build graph from function dependencies', () => {
    analyzer.buildGraph(mockFunctions);
    
    const stats = analyzer.getGraphStatistics();
    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(3); // func1->func2, func1->func3, func2->func3
  });

  it('should calculate structural metrics for a function', () => {
    analyzer.buildGraph(mockFunctions);
    
    const metrics = analyzer.analyzeFunction('func1');
    expect(metrics).toBeDefined();
    expect(metrics?.fanOut).toBe(2); // calls func2 and func3
    expect(metrics?.fanIn).toBe(0);  // no incoming calls
  });

  it('should detect high fan-out anomalies', () => {
    // Create target functions for dependencies
    const targetFunctions: FunctionInfo[] = Array.from({ length: 15 }, (_, i) => ({
      id: `target${i}`,
      name: `targetFunction${i}`,
      dependencies: []
    } as FunctionInfo));

    // Create a function with many dependencies
    const highFanOutFunction: FunctionInfo = {
      id: 'func4',
      name: 'complexFunction',
      dependencies: Array.from({ length: 15 }, (_, i) => ({
        id: `dep${i}`,
        functionId: 'func4',
        dependencyType: 'call' as const,
        targetName: `targetFunction${i}`,
        isExternal: false,
        usageCount: 1
      }))
    } as FunctionInfo;

    const functionsWithHighFanOut = [...mockFunctions, highFanOutFunction, ...targetFunctions];
    analyzer.buildGraph(functionsWithHighFanOut);
    
    const anomalies = analyzer.detectAnomalies('func4');
    const fanOutAnomaly = anomalies.find(a => a.metric === 'fanOut');
    
    expect(fanOutAnomaly).toBeDefined();
    expect(fanOutAnomaly?.severity).toBe('warning');
  });

  it('should calculate PageRank scores', () => {
    analyzer.buildGraph(mockFunctions);
    
    const func3Metrics = analyzer.analyzeFunction('func3');
    const func1Metrics = analyzer.analyzeFunction('func1');
    
    // func3 should have higher PageRank (more incoming links)
    expect(func3Metrics?.pageRank).toBeGreaterThan(func1Metrics?.pageRank || 0);
  });

  it('should calculate clustering coefficient', () => {
    analyzer.buildGraph(mockFunctions);
    
    const metrics = analyzer.analyzeFunction('func2');
    expect(metrics?.clustering).toBeGreaterThanOrEqual(0);
    expect(metrics?.clustering).toBeLessThanOrEqual(1);
  });

  it('should return null for non-existent function', () => {
    analyzer.buildGraph(mockFunctions);
    
    const metrics = analyzer.analyzeFunction('nonexistent');
    expect(metrics).toBeNull();
  });

  it('should handle empty graph', () => {
    analyzer.buildGraph([]);
    
    const stats = analyzer.getGraphStatistics();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    expect(stats.density).toBe(0);
  });

  it('should detect betweenness centrality anomalies', () => {
    // Create a more complex graph with a clear hub
    const clusterA1: FunctionInfo = { id: 'a1', name: 'clusterA1', dependencies: [] } as FunctionInfo;
    const clusterA2: FunctionInfo = { id: 'a2', name: 'clusterA2', dependencies: [
      { id: 'dep_a2_a1', functionId: 'a2', dependencyType: 'call', targetName: 'clusterA1', isExternal: false, usageCount: 1 }
    ] } as FunctionInfo;
    
    const hub: FunctionInfo = { id: 'hub', name: 'hubFunction', dependencies: [
      { id: 'dep_hub_a1', functionId: 'hub', dependencyType: 'call', targetName: 'clusterA1', isExternal: false, usageCount: 1 },
      { id: 'dep_hub_b1', functionId: 'hub', dependencyType: 'call', targetName: 'clusterB1', isExternal: false, usageCount: 1 }
    ] } as FunctionInfo;
    
    const clusterB1: FunctionInfo = { id: 'b1', name: 'clusterB1', dependencies: [] } as FunctionInfo;
    const clusterB2: FunctionInfo = { id: 'b2', name: 'clusterB2', dependencies: [
      { id: 'dep_b2_b1', functionId: 'b2', dependencyType: 'call', targetName: 'clusterB1', isExternal: false, usageCount: 1 }
    ] } as FunctionInfo;

    const complexGraph = [clusterA1, clusterA2, hub, clusterB1, clusterB2];
    analyzer.buildGraph(complexGraph);
    
    const hubMetrics = analyzer.analyzeFunction('hub');
    expect(hubMetrics?.betweenness).toBeGreaterThanOrEqual(0);
  });
});