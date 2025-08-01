/**
 * Structural anomaly detection using graph centrality analysis
 * Analyzes function call graphs and AST structures for quality assessment
 */

import { FunctionInfo } from '../types/index.js';

/**
 * Graph node representing a function in the call graph
 */
export interface GraphNode {
  id: string;
  functionInfo: FunctionInfo;
  inDegree: number; // Number of incoming calls
  outDegree: number; // Number of outgoing calls
  betweenness: number; // Betweenness centrality
  closeness: number; // Closeness centrality
  pageRank: number; // PageRank score
}

/**
 * Graph edge representing function calls or dependencies
 */
export interface GraphEdge {
  from: string;
  to: string;
  weight: number; // Call frequency or dependency strength
  type: 'call' | 'import' | 'inherit';
}

/**
 * Structural metrics for a function
 */
export interface StructuralMetrics {
  /** Betweenness centrality (0-1) */
  betweenness: number;
  /** Closeness centrality (0-1) */
  closeness: number;
  /** PageRank score (0-1) */
  pageRank: number;
  /** Degree centrality (0-1) */
  degreeCentrality: number;
  /** Call depth from root functions */
  callDepth: number;
  /** Number of unique callers */
  fanIn: number;
  /** Number of unique callees */
  fanOut: number;
  /** Clustering coefficient */
  clustering: number;
}

/**
 * Structural anomaly detection result
 */
export interface StructuralAnomaly {
  metric: keyof StructuralMetrics;
  value: number;
  expectedRange: [number, number];
  severity: 'normal' | 'warning' | 'critical';
  description: string;
  suggestion: string;
}

/**
 * Configuration for structural analysis
 */
export interface StructuralAnalysisConfig {
  /** Minimum functions required for reliable analysis */
  minFunctions: number;
  /** PageRank iteration convergence threshold */
  pageRankTolerance: number;
  /** Maximum PageRank iterations */
  maxIterations: number;
  /** Damping factor for PageRank */
  dampingFactor: number;
  /** Graph mode for analysis */
  graphMode: 'directed' | 'undirected';
  /** Anomaly detection thresholds */
  thresholds: {
    betweenness: number;
    fanOut: number;
    callDepth: number;
    clustering: number;
  };
}

/**
 * High-performance structural analyzer for function graphs
 *
 * Features:
 * - Call graph construction from function dependencies
 * - Centrality measures (betweenness, closeness, PageRank)
 * - Structural anomaly detection
 * - Real-time performance optimization
 */
export class StructuralAnalyzer {
  private config: StructuralAnalysisConfig;
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private adjacencyList = new Map<string, Set<string>>();
  private reverseAdjacencyList = new Map<string, Set<string>>();

  constructor(config: Partial<StructuralAnalysisConfig> = {}) {
    this.config = {
      minFunctions: 10,
      pageRankTolerance: 0.0001,
      maxIterations: 100,
      dampingFactor: 0.85,
      graphMode: 'directed',
      thresholds: {
        betweenness: 0.1,
        fanOut: 10,
        callDepth: 5,
        clustering: 0.1,
      },
      ...config,
    };
  }

  /**
   * Build graph from function information
   */
  buildGraph(functions: FunctionInfo[]): void {
    this.reset();

    // Create name-to-function mapping for O(1) lookup
    const nameToFunctionMap = new Map<string, FunctionInfo>();
    for (const func of functions) {
      nameToFunctionMap.set(func.name, func);
    }

    // Create nodes for all functions
    for (const func of functions) {
      this.nodes.set(func.id, {
        id: func.id,
        functionInfo: func,
        inDegree: 0,
        outDegree: 0,
        betweenness: 0,
        closeness: 0,
        pageRank: 1 / functions.length,
      });

      this.adjacencyList.set(func.id, new Set());
      this.reverseAdjacencyList.set(func.id, new Set());
    }

    // Create edges from dependencies (O(n) instead of O(n²))
    for (const func of functions) {
      if (func.dependencies) {
        for (const dep of func.dependencies) {
          // O(1) lookup instead of O(n) find
          const targetFunc = nameToFunctionMap.get(dep.targetName);
          if (targetFunc) {
            this.addEdge(func.id, targetFunc.id, 1, dep.dependencyType as GraphEdge['type']);
          }
        }
      }
    }

    // Calculate centrality measures
    this.calculateCentralityMeasures();
  }

  /**
   * Analyze structural metrics for a specific function
   */
  analyzeFunction(functionId: string): StructuralMetrics | null {
    const node = this.nodes.get(functionId);
    if (!node) return null;

    const totalNodes = this.nodes.size;
    const clustering = this.calculateClustering(functionId);
    const callDepth = this.calculateCallDepth(functionId);

    return {
      betweenness: node.betweenness,
      closeness: node.closeness,
      pageRank: node.pageRank,
      degreeCentrality: (node.inDegree + node.outDegree) / (totalNodes - 1),
      callDepth,
      fanIn: node.inDegree,
      fanOut: node.outDegree,
      clustering,
    };
  }

  /**
   * Detect structural anomalies for a function
   */
  detectAnomalies(functionId: string): StructuralAnomaly[] {
    const metrics = this.analyzeFunction(functionId);
    if (!metrics) return [];

    const anomalies: StructuralAnomaly[] = [];

    // Check for high centrality (potential bottlenecks)
    if (metrics.betweenness > this.config.thresholds.betweenness) {
      anomalies.push({
        metric: 'betweenness',
        value: metrics.betweenness,
        expectedRange: [0, this.config.thresholds.betweenness],
        severity:
          metrics.betweenness > this.config.thresholds.betweenness * 2 ? 'critical' : 'warning',
        description: 'Function has unusually high betweenness centrality',
        suggestion: 'Consider splitting this function to reduce coupling',
      });
    }

    // Check for high fan-out (too many dependencies)
    if (metrics.fanOut > this.config.thresholds.fanOut) {
      anomalies.push({
        metric: 'fanOut',
        value: metrics.fanOut,
        expectedRange: [0, this.config.thresholds.fanOut],
        severity: metrics.fanOut > this.config.thresholds.fanOut * 2 ? 'critical' : 'warning',
        description: 'Function calls too many other functions',
        suggestion: 'Extract common functionality or use dependency injection',
      });
    }

    // Check for deep call chains
    if (metrics.callDepth > this.config.thresholds.callDepth) {
      anomalies.push({
        metric: 'callDepth',
        value: metrics.callDepth,
        expectedRange: [0, this.config.thresholds.callDepth],
        severity:
          metrics.callDepth > this.config.thresholds.callDepth * 1.6 ? 'critical' : 'warning',
        description: 'Function is deeply nested in call chain',
        suggestion: 'Flatten call hierarchy or use more direct approaches',
      });
    }

    // Check for low clustering (potential isolation)
    if (metrics.clustering < this.config.thresholds.clustering && metrics.fanOut > 3) {
      anomalies.push({
        metric: 'clustering',
        value: metrics.clustering,
        expectedRange: [this.config.thresholds.clustering, 1.0],
        severity: 'warning',
        description: 'Function has low clustering coefficient',
        suggestion: 'Consider grouping related functionality together',
      });
    }

    return anomalies;
  }

  /**
   * Get summary statistics for the entire graph
   */
  getGraphStatistics(): {
    nodeCount: number;
    edgeCount: number;
    density: number;
    averageClustering: number;
    averagePathLength: number;
    centralityDistribution: {
      betweenness: { mean: number; std: number };
      closeness: { mean: number; std: number };
      pageRank: { mean: number; std: number };
    };
  } {
    const nodeCount = this.nodes.size;
    const edgeCount = this.edges.length;
    const density = nodeCount > 1 ? edgeCount / (nodeCount * (nodeCount - 1)) : 0;

    // Calculate average clustering
    let totalClustering = 0;
    for (const nodeId of this.nodes.keys()) {
      totalClustering += this.calculateClustering(nodeId);
    }
    const averageClustering = nodeCount > 0 ? totalClustering / nodeCount : 0;

    // Calculate centrality statistics
    const betweennessValues = Array.from(this.nodes.values()).map(n => n.betweenness);
    const closenessValues = Array.from(this.nodes.values()).map(n => n.closeness);
    const pageRankValues = Array.from(this.nodes.values()).map(n => n.pageRank);

    return {
      nodeCount,
      edgeCount,
      density,
      averageClustering,
      averagePathLength: this.calculateAveragePathLength(),
      centralityDistribution: {
        betweenness: this.calculateDistributionStats(betweennessValues),
        closeness: this.calculateDistributionStats(closenessValues),
        pageRank: this.calculateDistributionStats(pageRankValues),
      },
    };
  }

  /**
   * Add edge to the graph
   */
  private addEdge(from: string, to: string, weight: number, type: GraphEdge['type']): void {
    this.edges.push({ from, to, weight, type });

    this.adjacencyList.get(from)?.add(to);
    this.reverseAdjacencyList.get(to)?.add(from);

    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);

    if (fromNode) fromNode.outDegree++;
    if (toNode) toNode.inDegree++;
  }

  /**
   * Calculate all centrality measures
   */
  private calculateCentralityMeasures(): void {
    this.calculateBetweennessCentrality();
    this.calculateClosenessCentrality();
    this.calculatePageRank();
  }

  /**
   * Calculate betweenness centrality using Brandes algorithm
   */
  private calculateBetweennessCentrality(): void {
    const nodeIds = Array.from(this.nodes.keys());
    const betweenness = new Map<string, number>();

    // Initialize betweenness scores
    for (const nodeId of nodeIds) {
      betweenness.set(nodeId, 0);
    }

    // Brandes algorithm for betweenness centrality
    for (const source of nodeIds) {
      const stack: string[] = [];
      const predecessors = new Map<string, string[]>();
      const distance = new Map<string, number>();
      const sigma = new Map<string, number>();
      const delta = new Map<string, number>();

      // Initialize
      for (const nodeId of nodeIds) {
        predecessors.set(nodeId, []);
        distance.set(nodeId, -1);
        sigma.set(nodeId, 0);
        delta.set(nodeId, 0);
      }

      distance.set(source, 0);
      sigma.set(source, 1);

      const queue = [source];

      // BFS
      while (queue.length > 0) {
        const v = queue.shift()!;
        stack.push(v);

        const neighbors = this.adjacencyList.get(v) || new Set();
        for (const w of neighbors) {
          // First time we see w?
          if (distance.get(w)! < 0) {
            queue.push(w);
            distance.set(w, distance.get(v)! + 1);
          }

          // Shortest path to w via v?
          if (distance.get(w) === distance.get(v)! + 1) {
            sigma.set(w, sigma.get(w)! + sigma.get(v)!);
            predecessors.get(w)!.push(v);
          }
        }
      }

      // Accumulation
      while (stack.length > 0) {
        const w = stack.pop()!;
        for (const v of predecessors.get(w)!) {
          const contribution = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
          delta.set(v, delta.get(v)! + contribution);
        }

        if (w !== source) {
          betweenness.set(w, betweenness.get(w)! + delta.get(w)!);
        }
      }
    }

    // Normalize based on graph mode
    const factor = this.config.graphMode === 'directed' ? 1 : 2;
    const normalization =
      nodeIds.length > 2 ? factor / ((nodeIds.length - 1) * (nodeIds.length - 2)) : 0;
    for (const [nodeId, score] of betweenness) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.betweenness = score * normalization;
      }
    }
  }

  /**
   * Calculate closeness centrality
   */
  private calculateClosenessCentrality(): void {
    const nodeIds = Array.from(this.nodes.keys());

    for (const source of nodeIds) {
      const distances = this.bfsShortestPaths(source);
      let totalDistance = 0;
      let reachableNodes = 0;

      for (const [, distance] of distances) {
        if (distance !== Infinity && distance > 0) {
          totalDistance += distance;
          reachableNodes++;
        }
      }

      const node = this.nodes.get(source);
      if (node && reachableNodes > 0) {
        // Two-stage normalization for closeness centrality (NetworkX wf_improved)
        // Stage 1: Reachability normalization
        const reachabilityFactor = reachableNodes / (nodeIds.length - 1);
        // Stage 2: Distance normalization
        const distanceFactor = reachableNodes / totalDistance;
        // Combined closeness centrality
        node.closeness = reachabilityFactor * distanceFactor;
      }
    }
  }

  /**
   * Calculate PageRank scores
   */
  private calculatePageRank(): void {
    const nodeIds = Array.from(this.nodes.keys());
    const n = nodeIds.length;

    if (n === 0) return;

    const pageRank = new Map<string, number>();
    const newPageRank = new Map<string, number>();

    // Initialize PageRank scores
    for (const nodeId of nodeIds) {
      pageRank.set(nodeId, 1 / n);
    }

    // PageRank iterations
    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      let maxDiff = 0;

      // Calculate dangling node mass (nodes with no outgoing edges)
      let danglingMass = 0;
      for (const nodeId of nodeIds) {
        const outDegree = this.adjacencyList.get(nodeId)?.size || 0;
        if (outDegree === 0) {
          danglingMass += pageRank.get(nodeId)!;
        }
      }

      for (const nodeId of nodeIds) {
        let sum = 0;
        const incomingNodes = this.reverseAdjacencyList.get(nodeId) || new Set();

        for (const incomingNodeId of incomingNodes) {
          const outDegree = this.adjacencyList.get(incomingNodeId)?.size || 0;
          if (outDegree > 0) {
            sum += pageRank.get(incomingNodeId)! / outDegree;
          }
        }

        // Include dangling mass redistribution
        const danglingContribution = danglingMass / n;
        const newScore =
          (1 - this.config.dampingFactor) / n +
          this.config.dampingFactor * (sum + danglingContribution);
        newPageRank.set(nodeId, newScore);

        const diff = Math.abs(newScore - pageRank.get(nodeId)!);
        maxDiff = Math.max(maxDiff, diff);
      }

      // Update PageRank scores
      for (const [nodeId, score] of newPageRank) {
        pageRank.set(nodeId, score);
      }

      // Check convergence
      if (maxDiff < this.config.pageRankTolerance) {
        break;
      }
    }

    // Update node PageRank scores
    for (const [nodeId, score] of pageRank) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.pageRank = score;
      }
    }
  }

  /**
   * BFS for shortest paths in unweighted graph
   * O(V+E) complexity instead of O(V²) Dijkstra
   */
  private bfsShortestPaths(source: string): Map<string, number> {
    const distances = new Map<string, number>();

    // Initialize all distances to infinity
    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, Infinity);
    }

    // BFS using array-based queue for O(1) dequeue
    const queue: string[] = [source];
    distances.set(source, 0);
    let head = 0; // Index for O(1) dequeue

    while (head < queue.length) {
      const current = queue[head++];
      const currentDistance = distances.get(current)!;

      const neighbors = this.adjacencyList.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (distances.get(neighbor) === Infinity) {
          distances.set(neighbor, currentDistance + 1);
          queue.push(neighbor);
        }
      }
    }

    return distances;
  }

  /**
   * Calculate clustering coefficient for a node
   * Supports both directed and undirected graph modes
   */
  private calculateClustering(nodeId: string): number {
    const neighbors = this.adjacencyList.get(nodeId) || new Set();
    const degree = neighbors.size;

    if (degree < 2) return 0;

    let triangles = 0;
    const neighborsArray = Array.from(neighbors);

    for (let i = 0; i < neighborsArray.length; i++) {
      for (let j = i + 1; j < neighborsArray.length; j++) {
        const neighbor1 = neighborsArray[i];
        const neighbor2 = neighborsArray[j];

        if (this.config.graphMode === 'directed') {
          // Directed graph: count bidirectional connections
          if (
            this.adjacencyList.get(neighbor1)?.has(neighbor2) ||
            this.adjacencyList.get(neighbor2)?.has(neighbor1)
          ) {
            triangles++;
          }
        } else {
          // Undirected graph: count any connection
          if (this.adjacencyList.get(neighbor1)?.has(neighbor2)) {
            triangles++;
          }
        }
      }
    }

    const possibleTriangles = (degree * (degree - 1)) / 2;
    return possibleTriangles > 0 ? triangles / possibleTriangles : 0;
  }

  /**
   * Calculate call depth from root functions
   */
  private calculateCallDepth(nodeId: string): number {
    const visited = new Set<string>();
    const queue = [{ nodeId, depth: 0 }];
    let maxDepth = 0;

    while (queue.length > 0) {
      const { nodeId: currentNode, depth } = queue.shift()!;

      if (visited.has(currentNode)) continue;
      visited.add(currentNode);

      maxDepth = Math.max(maxDepth, depth);

      const callers = this.reverseAdjacencyList.get(currentNode) || new Set();
      for (const caller of callers) {
        if (!visited.has(caller)) {
          queue.push({ nodeId: caller, depth: depth + 1 });
        }
      }
    }

    return maxDepth;
  }

  /**
   * Calculate average path length for the graph
   */
  private calculateAveragePathLength(): number {
    const nodeIds = Array.from(this.nodes.keys());
    let totalPathLength = 0;
    let pathCount = 0;

    for (const source of nodeIds) {
      const distances = this.bfsShortestPaths(source);
      for (const [target, distance] of distances) {
        if (source !== target && distance !== Infinity) {
          totalPathLength += distance;
          pathCount++;
        }
      }
    }

    return pathCount > 0 ? totalPathLength / pathCount : 0;
  }

  /**
   * Calculate distribution statistics
   */
  private calculateDistributionStats(values: number[]): { mean: number; std: number } {
    if (values.length === 0) return { mean: 0, std: 0 };

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);

    return { mean, std };
  }

  /**
   * Reset the analyzer state
   */
  private reset(): void {
    this.nodes.clear();
    this.edges = [];
    this.adjacencyList.clear();
    this.reverseAdjacencyList.clear();
  }
}
