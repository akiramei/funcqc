import { FunctionInfo, CallEdge } from '../types';

export interface DependencyMetrics {
  functionId: string;
  functionName: string;
  filePath: string;
  fanIn: number;          // Number of functions calling this function
  fanOut: number;         // Number of functions this function calls
  depthFromEntry: number; // Shortest path from any entry point
  maxCallChain: number;   // Longest call chain through this function
  isCyclic: boolean;      // Part of a circular dependency
  totalCallers: number;   // Total number of call sites (including multiple calls from same function)
  totalCalls: number;     // Total number of calls this function makes
  uniqueCallers: number;  // Number of unique functions that call this
  uniqueCallees: number;  // Number of unique functions this calls
}

export interface DependencyStats {
  totalFunctions: number;
  avgFanIn: number;
  avgFanOut: number;
  maxFanIn: number;
  maxFanOut: number;
  hubFunctions: DependencyMetrics[];    // High fan-in functions
  utilityFunctions: DependencyMetrics[]; // High fan-out functions
  isolatedFunctions: DependencyMetrics[]; // fan-in = 0, fan-out = 0
}

/**
 * Calculates dependency metrics for functions
 */
export class DependencyMetricsCalculator {
  /**
   * Calculate dependency metrics for all functions
   */
  calculateMetrics(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    entryPoints: Set<string>,
    cyclicFunctions: Set<string>
  ): DependencyMetrics[] {
    const metrics: DependencyMetrics[] = [];
    
    // Build reverse index for efficient lookups
    const callGraph = this.buildCallGraph(callEdges);
    const reverseCallGraph = this.buildReverseCallGraph(callEdges);
    
    // Calculate depth from entry points
    const depths = this.calculateDepthFromEntries(callGraph, entryPoints);
    
    // Calculate metrics for each function
    for (const func of functions) {
      const incoming = reverseCallGraph.get(func.id) || new Set();
      const outgoing = callGraph.get(func.id) || new Set();
      
      // Count total calls (including multiple calls from same function)
      const totalCallers = this.countTotalCalls(func.id, callEdges, 'callee');
      const totalCalls = this.countTotalCalls(func.id, callEdges, 'caller');
      
      metrics.push({
        functionId: func.id,
        functionName: func.name,
        filePath: func.filePath,
        fanIn: incoming.size,
        fanOut: outgoing.size,
        depthFromEntry: depths.get(func.id) ?? -1,
        maxCallChain: this.calculateMaxCallChain(func.id, callGraph, new Set()),
        isCyclic: cyclicFunctions.has(func.id),
        totalCallers,
        totalCalls,
        uniqueCallers: incoming.size,
        uniqueCallees: outgoing.size,
      });
    }
    
    return metrics;
  }

  /**
   * Generate dependency statistics summary
   */
  generateStats(metrics: DependencyMetrics[]): DependencyStats {
    const totalFunctions = metrics.length;
    const avgFanIn = metrics.reduce((sum, m) => sum + m.fanIn, 0) / totalFunctions;
    const avgFanOut = metrics.reduce((sum, m) => sum + m.fanOut, 0) / totalFunctions;
    const maxFanIn = Math.max(...metrics.map(m => m.fanIn));
    const maxFanOut = Math.max(...metrics.map(m => m.fanOut));
    
    // Identify special categories
    const hubFunctions = metrics
      .filter(m => m.fanIn >= 5) // Called by 5+ functions
      .sort((a, b) => b.fanIn - a.fanIn)
      .slice(0, 10);
    
    const utilityFunctions = metrics
      .filter(m => m.fanOut >= 5) // Calls 5+ functions
      .sort((a, b) => b.fanOut - a.fanOut)
      .slice(0, 10);
    
    const isolatedFunctions = metrics
      .filter(m => m.fanIn === 0 && m.fanOut === 0);
    
    return {
      totalFunctions,
      avgFanIn,
      avgFanOut,
      maxFanIn,
      maxFanOut,
      hubFunctions,
      utilityFunctions,
      isolatedFunctions,
    };
  }

  /**
   * Build call graph adjacency list
   */
  private buildCallGraph(callEdges: CallEdge[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    
    for (const edge of callEdges) {
      if (!graph.has(edge.callerFunctionId)) {
        graph.set(edge.callerFunctionId, new Set());
      }
      
      if (edge.calleeFunctionId) {
        graph.get(edge.callerFunctionId)!.add(edge.calleeFunctionId);
      }
    }
    
    return graph;
  }

  /**
   * Build reverse call graph (callee -> callers)
   */
  private buildReverseCallGraph(callEdges: CallEdge[]): Map<string, Set<string>> {
    const reverseGraph = new Map<string, Set<string>>();
    
    for (const edge of callEdges) {
      if (edge.calleeFunctionId) {
        if (!reverseGraph.has(edge.calleeFunctionId)) {
          reverseGraph.set(edge.calleeFunctionId, new Set());
        }
        reverseGraph.get(edge.calleeFunctionId)!.add(edge.callerFunctionId);
      }
    }
    
    return reverseGraph;
  }

  /**
   * Calculate depth from entry points using BFS
   */
  private calculateDepthFromEntries(
    callGraph: Map<string, Set<string>>,
    entryPoints: Set<string>
  ): Map<string, number> {
    const depths = new Map<string, number>();
    const queue: { functionId: string; depth: number }[] = [];
    
    // Initialize with entry points
    for (const entryPoint of entryPoints) {
      depths.set(entryPoint, 0);
      queue.push({ functionId: entryPoint, depth: 0 });
    }
    
    // BFS traversal
    while (queue.length > 0) {
      const { functionId, depth } = queue.shift()!;
      const callees = callGraph.get(functionId) || new Set();
      
      for (const calleeId of callees) {
        const currentDepth = depths.get(calleeId);
        if (currentDepth === undefined || currentDepth > depth + 1) {
          depths.set(calleeId, depth + 1);
          queue.push({ functionId: calleeId, depth: depth + 1 });
        }
      }
    }
    
    return depths;
  }

  /**
   * Calculate maximum call chain length through a function
   */
  private calculateMaxCallChain(
    functionId: string,
    callGraph: Map<string, Set<string>>,
    visited: Set<string>
  ): number {
    if (visited.has(functionId)) {
      return 0; // Avoid infinite recursion
    }
    
    visited.add(functionId);
    
    const callees = callGraph.get(functionId) || new Set();
    if (callees.size === 0) {
      visited.delete(functionId);
      return 1;
    }
    
    let maxChain = 0;
    for (const calleeId of callees) {
      const chainLength = this.calculateMaxCallChain(calleeId, callGraph, visited);
      maxChain = Math.max(maxChain, chainLength);
    }
    
    visited.delete(functionId);
    return maxChain + 1;
  }

  /**
   * Count total number of calls (including multiple calls from same function)
   */
  private countTotalCalls(
    functionId: string,
    callEdges: CallEdge[],
    direction: 'caller' | 'callee'
  ): number {
    if (direction === 'caller') {
      return callEdges.filter(edge => edge.callerFunctionId === functionId).length;
    } else {
      return callEdges.filter(edge => edge.calleeFunctionId === functionId).length;
    }
  }
}