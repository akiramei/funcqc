import { FunctionInfo, CallEdge } from '../types';

/**
 * Configuration options for dependency analysis
 */
export interface DependencyOptions {
  hubThreshold?: number;      // Minimum fan-in for hub functions (default: 5)
  utilityThreshold?: number;  // Minimum fan-out for utility functions (default: 5)
  maxHubFunctions?: number;   // Maximum number of hub functions to return (default: 10)
  maxUtilityFunctions?: number; // Maximum number of utility functions to return (default: 10)
}

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
  uniqueCallers: number;  // Number of unique functions that call this (same as fanIn)
  uniqueCallees: number;  // Number of unique functions this calls (same as fanOut)
  cycleLength?: number;   // Length of the cycle if isCyclic is true
  isRecursive?: boolean;  // True if function calls itself directly or indirectly
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
  private callCountCache = new Map<string, { incoming: number; outgoing: number }>();
  private static readonly EMPTY_SET = new Set<string>(); // Shared empty set to avoid allocations
  
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
    
    // Clear cache for each calculation
    this.callCountCache.clear();
    
    // Build call graphs efficiently in single pass
    const { callGraph, reverseCallGraph } = this.buildCallGraphs(callEdges);
    
    // Pre-aggregate call counts for O(1) lookup
    this.preAggregateCallCounts(callEdges);
    
    // Calculate depth from entry points
    const depths = this.calculateDepthFromEntries(callGraph, entryPoints);
    
    // Calculate max call chains once for all functions using memoized DP
    const maxChains = this.computeMaxChains(callGraph, cyclicFunctions);
    
    
    // Calculate metrics for each function
    for (const func of functions) {
      const incoming = reverseCallGraph.get(func.id) ?? DependencyMetricsCalculator.EMPTY_SET;
      const outgoing = callGraph.get(func.id) ?? DependencyMetricsCalculator.EMPTY_SET;
      
      // Get pre-aggregated call counts
      const callCounts = this.callCountCache.get(func.id) || { incoming: 0, outgoing: 0 };
      const totalCallers = callCounts.incoming;
      const totalCalls = callCounts.outgoing;
      
      const isCyclic = cyclicFunctions.has(func.id);
      // Optimize: use SCC results instead of per-node DFS
      const isRecursive = isCyclic; // SCC already identified cyclic functions
      // Skip expensive cycle length calculation for now - could be supplied from SCC component size
      const cycleLength = undefined;
      
      const metric: DependencyMetrics = {
        functionId: func.id,
        functionName: func.name,
        filePath: func.filePath,
        fanIn: incoming.size,
        fanOut: outgoing.size,
        depthFromEntry: depths.get(func.id) ?? -1,
        maxCallChain: maxChains.get(func.id) ?? 1,
        isCyclic,
        totalCallers,
        totalCalls,
        uniqueCallers: incoming.size,
        uniqueCallees: outgoing.size,
      };
      
      // Add optional properties only if they have values
      if (cycleLength !== undefined) {
        metric.cycleLength = cycleLength;
      }
      if (isRecursive) {
        metric.isRecursive = isRecursive;
      }
      
      metrics.push(metric);
    }
    
    return metrics;
  }

  /**
   * Generate dependency statistics summary
   */
  generateStats(metrics: DependencyMetrics[], options?: DependencyOptions): DependencyStats {
    const totalFunctions = metrics.length;
    const avgFanIn = totalFunctions > 0 ? metrics.reduce((sum, m) => sum + m.fanIn, 0) / totalFunctions : 0;
    const avgFanOut = totalFunctions > 0 ? metrics.reduce((sum, m) => sum + m.fanOut, 0) / totalFunctions : 0;
    const maxFanIn = metrics.length > 0 ? Math.max(...metrics.map(m => m.fanIn)) : 0;
    const maxFanOut = metrics.length > 0 ? Math.max(...metrics.map(m => m.fanOut)) : 0;
    
    // Identify special categories with configurable thresholds
    const hubThreshold = options?.hubThreshold ?? 5;
    const utilityThreshold = options?.utilityThreshold ?? 5;
    const maxHubFunctions = options?.maxHubFunctions ?? 10;
    const maxUtilityFunctions = options?.maxUtilityFunctions ?? 10;
    
    const hubFunctions = metrics
      .filter(m => m.fanIn >= hubThreshold)
      .sort((a, b) => b.fanIn - a.fanIn)
      .slice(0, maxHubFunctions);
    
    const utilityFunctions = metrics
      .filter(m => m.fanOut >= utilityThreshold)
      .sort((a, b) => b.fanOut - a.fanOut)
      .slice(0, maxUtilityFunctions);
    
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
   * Build both call graphs efficiently in single pass
   */
  private buildCallGraphs(callEdges: CallEdge[]): {
    callGraph: Map<string, Set<string>>;
    reverseCallGraph: Map<string, Set<string>>;
  } {
    const callGraph = new Map<string, Set<string>>();
    const reverseCallGraph = new Map<string, Set<string>>();
    
    for (const edge of callEdges) {
      // Add null check for safety
      if (!edge.calleeFunctionId) {
        continue;
      }
      
      // Build forward graph
      if (!callGraph.has(edge.callerFunctionId)) {
        callGraph.set(edge.callerFunctionId, new Set());
      }
      callGraph.get(edge.callerFunctionId)!.add(edge.calleeFunctionId);
      
      // Build reverse graph in same loop
      if (!reverseCallGraph.has(edge.calleeFunctionId)) {
        reverseCallGraph.set(edge.calleeFunctionId, new Set());
      }
      reverseCallGraph.get(edge.calleeFunctionId)!.add(edge.callerFunctionId);
    }
    
    return { callGraph, reverseCallGraph };
  }

  /**
   * Pre-aggregate call counts for O(1) lookup
   */
  private preAggregateCallCounts(callEdges: CallEdge[]): void {
    const countMap = new Map<string, { incoming: number; outgoing: number }>();
    
    for (const edge of callEdges) {
      if (!edge.calleeFunctionId) {
        continue;
      }
      
      // Count outgoing calls
      const callerCounts = countMap.get(edge.callerFunctionId) || { incoming: 0, outgoing: 0 };
      callerCounts.outgoing++;
      countMap.set(edge.callerFunctionId, callerCounts);
      
      // Count incoming calls
      const calleeCounts = countMap.get(edge.calleeFunctionId) || { incoming: 0, outgoing: 0 };
      calleeCounts.incoming++;
      countMap.set(edge.calleeFunctionId, calleeCounts);
    }
    
    this.callCountCache = countMap;
  }

  /**
   * Calculate maximum call chain length using memoized DP - O(V+E) instead of O(N*(V+E))
   */
  private computeMaxChains(
    callGraph: Map<string, Set<string>>,
    _cyclicFunctions: Set<string>
  ): Map<string, number> {
    const cache = new Map<string, number>();
    const visiting = new Set<string>();

    const dfs = (id: string): number => {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      
      if (visiting.has(id)) {
        // Cycle detected: return 0 to break recursion
        cache.set(id, 0);
        return 0;
      }
      
      visiting.add(id);
      let maxChain = 0;
      const children = callGraph.get(id) ?? DependencyMetricsCalculator.EMPTY_SET;
      for (const childId of children) {
        maxChain = Math.max(maxChain, dfs(childId));
      }
      visiting.delete(id);
      
      const result = maxChain + 1;
      cache.set(id, result);
      return result;
    };

    // Calculate for all nodes in the call graph
    for (const nodeId of callGraph.keys()) {
      dfs(nodeId);
    }
    
    return cache;
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
    let head = 0; // Index-based queue pointer for O(1) pop
    
    // Initialize with entry points
    for (const entryPoint of entryPoints) {
      depths.set(entryPoint, 0);
      queue.push({ functionId: entryPoint, depth: 0 });
    }
    
    // BFS traversal with O(1) pop
    while (head < queue.length) {
      const { functionId, depth } = queue[head++]; // O(1) instead of O(n) shift()
      const callees = callGraph.get(functionId) ?? DependencyMetricsCalculator.EMPTY_SET;
      
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

}