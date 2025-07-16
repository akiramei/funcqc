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
  private memoizedCallChains = new Map<string, number>();
  private callCountCache = new Map<string, { incoming: number; outgoing: number }>();
  
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
    
    // Clear memoization cache for each calculation
    this.memoizedCallChains.clear();
    this.callCountCache.clear();
    
    // Build call graphs efficiently in single pass
    const { callGraph, reverseCallGraph } = this.buildCallGraphs(callEdges);
    
    // Pre-aggregate call counts for O(1) lookup
    this.preAggregateCallCounts(callEdges);
    
    // Calculate depth from entry points
    const depths = this.calculateDepthFromEntries(callGraph, entryPoints);
    
    // Calculate metrics for each function
    for (const func of functions) {
      const incoming = reverseCallGraph.get(func.id) || new Set();
      const outgoing = callGraph.get(func.id) || new Set();
      
      // Get pre-aggregated call counts
      const callCounts = this.callCountCache.get(func.id) || { incoming: 0, outgoing: 0 };
      const totalCallers = callCounts.incoming;
      const totalCalls = callCounts.outgoing;
      
      const isCyclic = cyclicFunctions.has(func.id);
      const isRecursive = this.isRecursiveFunction(func.id, callGraph);
      const cycleLength = isCyclic ? this.calculateCycleLength(func.id, callGraph) : undefined;
      
      const metric: DependencyMetrics = {
        functionId: func.id,
        functionName: func.name,
        filePath: func.filePath,
        fanIn: incoming.size,
        fanOut: outgoing.size,
        depthFromEntry: depths.get(func.id) ?? -1,
        maxCallChain: this.calculateMaxCallChainMemoized(func.id, callGraph, cyclicFunctions),
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
   * Calculate maximum call chain length with memoization
   */
  private calculateMaxCallChainMemoized(
    functionId: string,
    callGraph: Map<string, Set<string>>,
    cyclicFunctions: Set<string>
  ): number {
    // Return 0 for cyclic functions to avoid infinite recursion
    if (cyclicFunctions.has(functionId)) {
      return 0;
    }
    
    // Check memoization cache
    const cached = this.memoizedCallChains.get(functionId);
    if (cached !== undefined) {
      return cached;
    }
    
    const result = this.calculateMaxCallChainRecursive(functionId, callGraph, new Set(), cyclicFunctions);
    this.memoizedCallChains.set(functionId, result);
    return result;
  }

  /**
   * Recursive helper for max call chain calculation
   */
  private calculateMaxCallChainRecursive(
    functionId: string,
    callGraph: Map<string, Set<string>>,
    visited: Set<string>,
    cyclicFunctions: Set<string>
  ): number {
    if (visited.has(functionId) || cyclicFunctions.has(functionId)) {
      return 0;
    }
    
    visited.add(functionId);
    
    const callees = callGraph.get(functionId) || new Set();
    if (callees.size === 0) {
      visited.delete(functionId);
      return 1;
    }
    
    let maxChain = 0;
    for (const calleeId of callees) {
      const chainLength = this.calculateMaxCallChainRecursive(calleeId, callGraph, visited, cyclicFunctions);
      maxChain = Math.max(maxChain, chainLength);
    }
    
    visited.delete(functionId);
    return maxChain + 1;
  }

  /**
   * Calculate cycle length for a function in a cycle
   */
  private calculateCycleLength(
    functionId: string,
    callGraph: Map<string, Set<string>>
  ): number | undefined {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (currentId: string, path: string[]): number | undefined => {
      if (recursionStack.has(currentId)) {
        // Found a cycle, calculate its length
        const cycleStartIndex = path.indexOf(currentId);
        return cycleStartIndex >= 0 ? path.length - cycleStartIndex : undefined;
      }
      
      if (visited.has(currentId)) {
        return undefined;
      }
      
      visited.add(currentId);
      recursionStack.add(currentId);
      path.push(currentId);
      
      const callees = callGraph.get(currentId) || new Set();
      for (const calleeId of callees) {
        const cycleLength = dfs(calleeId, path);
        if (cycleLength !== undefined) {
          return cycleLength;
        }
      }
      
      recursionStack.delete(currentId);
      path.pop();
      return undefined;
    };
    
    return dfs(functionId, []);
  }

  /**
   * Check if a function is recursive (calls itself directly or indirectly)
   */
  private isRecursiveFunction(
    functionId: string,
    callGraph: Map<string, Set<string>>
  ): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (currentId: string): boolean => {
      if (recursionStack.has(currentId)) {
        return currentId === functionId;
      }
      
      if (visited.has(currentId)) {
        return false;
      }
      
      visited.add(currentId);
      recursionStack.add(currentId);
      
      const callees = callGraph.get(currentId) || new Set();
      for (const calleeId of callees) {
        if (dfs(calleeId)) {
          return true;
        }
      }
      
      recursionStack.delete(currentId);
      return false;
    };
    
    return dfs(functionId);
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

}