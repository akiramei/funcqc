import { FunctionInfo, CallEdge } from '../types';
import { EntryPoint } from './entry-point-detector';

export interface ReachabilityResult {
  reachable: Set<string>;
  unreachable: Set<string>;
  unusedExports: Set<string>;  // Export functions that are not reachable
  entryPoints: Set<string>;
}

export interface DeadCodeInfo {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  size: number;
  reason: 'unreachable' | 'no-callers' | 'test-only';
}

/**
 * Analyzes function reachability using call graph traversal
 * Identifies dead code (unreachable functions)
 */
export class ReachabilityAnalyzer {
  /**
   * Analyze reachability of all functions starting from entry points
   */
  analyzeReachability(
    allFunctions: FunctionInfo[],
    callEdges: CallEdge[],
    entryPoints: EntryPoint[]
  ): ReachabilityResult {
    const functionMap = new Map(allFunctions.map(f => [f.id, f]));
    const reachable = new Set<string>();
    const entryPointIds = new Set(entryPoints.map(ep => ep.functionId));

    // Build adjacency list for efficient traversal
    const callGraph = this.buildCallGraph(callEdges);

    // Start traversal from each entry point
    for (const entryPointId of entryPointIds) {
      if (functionMap.has(entryPointId)) {
        this.traverse(entryPointId, callGraph, reachable);
      }
    }

    // Include entry points themselves
    for (const entryPointId of entryPointIds) {
      if (functionMap.has(entryPointId)) {
        reachable.add(entryPointId);
      }
    }

    // Identify unreachable and unused export functions
    const unreachable = new Set<string>();
    const unusedExports = new Set<string>();
    
    for (const func of allFunctions) {
      if (!reachable.has(func.id)) {
        unreachable.add(func.id);
        
        // Separate unused export functions for special handling
        if (func.isExported) {
          unusedExports.add(func.id);
        }
      }
    }

    return {
      reachable,
      unreachable,
      unusedExports,
      entryPoints: entryPointIds,
    };
  }

  /**
   * Get detailed dead code information
   */
  getDeadCodeInfo(
    unreachableFunctions: Set<string>,
    allFunctions: FunctionInfo[],
    callEdges: CallEdge[],
    options: {
      excludeTests?: boolean;
      excludeSmallFunctions?: boolean;
      minFunctionSize?: number;
    } = {}
  ): DeadCodeInfo[] {
    const deadCodeInfo: DeadCodeInfo[] = [];
    const functionMap = new Map(allFunctions.map(f => [f.id, f]));

    // Build reverse call graph (who calls each function)
    const reverseCallGraph = this.buildReverseCallGraph(callEdges);

    for (const functionId of unreachableFunctions) {
      const func = functionMap.get(functionId);
      if (!func) continue;

      // Apply filters
      if (options.excludeTests && this.isTestFunction(func)) {
        continue;
      }

      const functionSize = (func.endLine - func.startLine + 1);
      if (options.excludeSmallFunctions && 
          functionSize < (options.minFunctionSize || 3)) {
        continue;
      }

      // Determine reason
      let reason: DeadCodeInfo['reason'] = 'unreachable';
      
      // Check if it has no callers at all
      const callers = reverseCallGraph.get(functionId);
      if (!callers || callers.size === 0) {
        reason = 'no-callers';
      }

      // Check if only called from tests
      if (callers && this.isOnlyCalledFromTests(callers, functionMap)) {
        reason = 'test-only';
      }

      deadCodeInfo.push({
        functionId,
        functionName: func.name,
        filePath: func.filePath,
        startLine: func.startLine,
        endLine: func.endLine,
        size: functionSize,
        reason,
      });
    }

    // Sort by file path and then by start line
    deadCodeInfo.sort((a, b) => {
      const fileCompare = a.filePath.localeCompare(b.filePath);
      if (fileCompare !== 0) return fileCompare;
      return a.startLine - b.startLine;
    });

    return deadCodeInfo;
  }

  /**
   * Build adjacency list representation of call graph
   */
  private buildCallGraph(callEdges: CallEdge[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const edge of callEdges) {
      if (!graph.has(edge.callerFunctionId)) {
        graph.set(edge.callerFunctionId, new Set());
      }
      
      // Only add if callee is an internal function (not external)
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
   * Traverse call graph using DFS
   */
  private traverse(
    functionId: string,
    callGraph: Map<string, Set<string>>,
    visited: Set<string>
  ): void {
    if (visited.has(functionId)) {
      return;
    }

    visited.add(functionId);

    const callees = callGraph.get(functionId);
    if (callees) {
      for (const calleeId of callees) {
        this.traverse(calleeId, callGraph, visited);
      }
    }
  }

  /**
   * Check if a function is a test function
   */
  private isTestFunction(func: FunctionInfo): boolean {
    const testPatterns = [
      /\.test\./,
      /\.spec\./,
      /__tests__/,
      /^test/i,
      /^it\(/,
      /^describe\(/,
    ];

    return testPatterns.some(pattern => 
      pattern.test(func.filePath) || pattern.test(func.name)
    );
  }

  /**
   * Check if a function is only called from test files
   */
  private isOnlyCalledFromTests(
    callers: Set<string>,
    functionMap: Map<string, FunctionInfo>
  ): boolean {
    if (callers.size === 0) return false;

    for (const callerId of callers) {
      const caller = functionMap.get(callerId);
      if (caller && !this.isTestFunction(caller)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get circular dependencies (Tarjan's algorithm)
   */
  findCircularDependencies(callEdges: CallEdge[]): string[][] {
    const graph = this.buildCallGraph(callEdges);
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, [...path]);
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle
          const cycleStartIndex = path.indexOf(neighbor);
          if (cycleStartIndex !== -1) {
            const cycle = path.slice(cycleStartIndex);
            cycle.push(neighbor); // Complete the cycle
            
            // Only add unique cycles
            const cycleKey = [...cycle].sort().join(',');
            const isUnique = !cycles.some(
              existing => [...existing].sort().join(',') === cycleKey
            );
            
            if (isUnique && cycle.length > 1) {
              cycles.push(cycle);
            }
          }
        }
      }

      recursionStack.delete(node);
    };

    // Run DFS from each unvisited node
    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }
}