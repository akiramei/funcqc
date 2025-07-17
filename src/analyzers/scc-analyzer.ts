import { CallEdge } from '../types';

/**
 * Strongly Connected Component (SCC)
 */
export interface StronglyConnectedComponent {
  id: string;
  functionIds: string[];
  size: number;
  edges: CallEdge[];
  isRecursive: boolean; // Single function calling itself
}

/**
 * SCC analysis result
 */
export interface SCCAnalysisResult {
  components: StronglyConnectedComponent[];
  totalComponents: number;
  largestComponentSize: number;
  recursiveFunctions: string[];
  componentMap: Map<string, string>; // functionId -> componentId
}

/**
 * Tarjan's algorithm for finding Strongly Connected Components
 */
export class SCCAnalyzer {
  private index: number;
  private stack: string[];
  private indices: Map<string, number>;
  private lowLinks: Map<string, number>;
  private onStack: Set<string>;
  private components: StronglyConnectedComponent[];
  private adjacencyList: Map<string, Set<string>>;
  private edgeMap: Map<string, CallEdge[]>;

  constructor() {
    this.index = 0;
    this.stack = [];
    this.indices = new Map();
    this.lowLinks = new Map();
    this.onStack = new Set();
    this.components = [];
    this.adjacencyList = new Map();
    this.edgeMap = new Map();
  }

  /**
   * Find all strongly connected components using Tarjan's algorithm
   */
  findStronglyConnectedComponents(callEdges: CallEdge[]): SCCAnalysisResult {
    // Reset state
    this.reset();
    
    // Build adjacency list and edge map
    this.buildAdjacencyList(callEdges);
    
    // Get all unique function IDs
    const allFunctionIds = new Set<string>();
    for (const edge of callEdges) {
      allFunctionIds.add(edge.callerFunctionId);
      if (edge.calleeFunctionId && edge.calleeFunctionId !== '') {
        allFunctionIds.add(edge.calleeFunctionId);
      }
    }
    
    // Run Tarjan's algorithm
    for (const functionId of allFunctionIds) {
      if (!this.indices.has(functionId)) {
        this.strongConnect(functionId);
      }
    }
    
    // Post-process components
    this.identifyRecursiveFunctions();
    this.assignComponentIds();
    
    // Calculate statistics
    const largestComponentSize = Math.max(
      ...this.components.map(c => c.size),
      0
    );
    
    const recursiveFunctions = this.components
      .filter(c => c.isRecursive)
      .map(c => c.functionIds[0]);
    
    const componentMap = this.createComponentMap();
    
    return {
      components: this.components,
      totalComponents: this.components.length,
      largestComponentSize,
      recursiveFunctions,
      componentMap,
    };
  }

  /**
   * Find SCCs that include specific functions
   */
  findComponentsContaining(
    functionIds: string[],
    callEdges: CallEdge[]
  ): StronglyConnectedComponent[] {
    const result = this.findStronglyConnectedComponents(callEdges);
    const targetSet = new Set(functionIds);
    
    return result.components.filter(component =>
      component.functionIds.some(id => targetSet.has(id))
    );
  }

  /**
   * Calculate condensation graph (DAG of SCCs)
   */
  calculateCondensationGraph(
    callEdges: CallEdge[]
  ): {
    nodes: StronglyConnectedComponent[];
    edges: Array<{ from: string; to: string; count: number }>;
  } {
    const result = this.findStronglyConnectedComponents(callEdges);
    const componentMap = result.componentMap;
    
    // Get all functions involved in edges
    const allFunctions = new Set<string>();
    for (const edge of callEdges) {
      allFunctions.add(edge.callerFunctionId);
      if (edge.calleeFunctionId) {
        allFunctions.add(edge.calleeFunctionId);
      }
    }
    
    // Create nodes for all functions (SCCs and individual nodes)
    const allNodes: StronglyConnectedComponent[] = [...result.components];
    
    // Add individual nodes that aren't part of any SCC
    const functionsInSCCs = new Set(
      result.components.flatMap(c => c.functionIds)
    );
    
    for (const functionId of allFunctions) {
      if (!functionsInSCCs.has(functionId)) {
        const nodeId = `node-${functionId}`;
        allNodes.push({
          id: nodeId,
          functionIds: [functionId],
          size: 1,
          edges: [],
          isRecursive: false,
        });
        componentMap.set(functionId, nodeId);
      }
    }
    
    // Count edges between components
    const edgeCount = new Map<string, number>();
    
    for (const edge of callEdges) {
      const fromComponent = componentMap.get(edge.callerFunctionId);
      const toComponent = edge.calleeFunctionId ? 
        componentMap.get(edge.calleeFunctionId) : null;
      
      if (fromComponent && toComponent && fromComponent !== toComponent) {
        const key = `${fromComponent}->${toComponent}`;
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      }
    }
    
    // Convert to edge array
    const condensedEdges = Array.from(edgeCount.entries()).map(([key, count]) => {
      const [from, to] = key.split('->');
      return { from, to, count };
    });
    
    return {
      nodes: allNodes,
      edges: condensedEdges,
    };
  }

  /**
   * Get topological order of SCCs (if DAG)
   */
  getTopologicalOrder(callEdges: CallEdge[]): string[][] | null {
    const { nodes, edges } = this.calculateCondensationGraph(callEdges);
    
    // Build adjacency list for components
    const adjList = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();
    
    // Initialize
    for (const node of nodes) {
      adjList.set(node.id, new Set());
      inDegree.set(node.id, 0);
    }
    
    // Build graph
    for (const edge of edges) {
      adjList.get(edge.from)?.add(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
    
    // Kahn's algorithm for topological sort
    const queue: string[] = [];
    const result: string[][] = [];
    
    // Find nodes with no incoming edges
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const component = nodes.find(n => n.id === current);
      if (component) {
        result.push(component.functionIds);
      }
      
      // Process neighbors
      for (const neighbor of adjList.get(current) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }
    
    // Check if all nodes were processed (no cycles between SCCs)
    return result.length === nodes.length ? result : null;
  }

  /**
   * Reset internal state
   */
  private reset(): void {
    this.index = 0;
    this.stack = [];
    this.indices.clear();
    this.lowLinks.clear();
    this.onStack.clear();
    this.components = [];
    this.adjacencyList.clear();
    this.edgeMap.clear();
  }

  /**
   * Build adjacency list from call edges
   */
  private buildAdjacencyList(callEdges: CallEdge[]): void {
    for (const edge of callEdges) {
      // Skip external calls
      if (!edge.calleeFunctionId) continue;
      
      // Add to adjacency list
      if (!this.adjacencyList.has(edge.callerFunctionId)) {
        this.adjacencyList.set(edge.callerFunctionId, new Set());
      }
      this.adjacencyList.get(edge.callerFunctionId)!.add(edge.calleeFunctionId);
      
      // Store edge for later reference
      const key = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
      if (!this.edgeMap.has(key)) {
        this.edgeMap.set(key, []);
      }
      this.edgeMap.get(key)!.push(edge);
      
      // Ensure callee exists in adjacency list
      if (!this.adjacencyList.has(edge.calleeFunctionId)) {
        this.adjacencyList.set(edge.calleeFunctionId, new Set());
      }
    }
  }

  /**
   * Tarjan's algorithm - main recursive function
   */
  private strongConnect(functionId: string): void {
    // Set the depth index for v to the smallest unused index
    this.indices.set(functionId, this.index);
    this.lowLinks.set(functionId, this.index);
    this.index++;
    this.stack.push(functionId);
    this.onStack.add(functionId);
    
    // Consider successors of v
    const successors = this.adjacencyList.get(functionId) || new Set();
    for (const successorId of successors) {
      if (!this.indices.has(successorId)) {
        // Successor has not yet been visited; recurse on it
        this.strongConnect(successorId);
        this.lowLinks.set(
          functionId,
          Math.min(
            this.lowLinks.get(functionId)!,
            this.lowLinks.get(successorId)!
          )
        );
      } else if (this.onStack.has(successorId)) {
        // Successor is in stack and hence in the current SCC
        this.lowLinks.set(
          functionId,
          Math.min(
            this.lowLinks.get(functionId)!,
            this.indices.get(successorId)!
          )
        );
      }
    }
    
    // If v is a root node, pop the stack and print an SCC
    if (this.lowLinks.get(functionId) === this.indices.get(functionId)) {
      const component: string[] = [];
      let w: string;
      
      do {
        w = this.stack.pop()!;
        this.onStack.delete(w);
        component.push(w);
      } while (w !== functionId);
      
      // Only add non-trivial SCCs (size > 1) or self-loops
      if (component.length > 1 || this.hasSelfLoop(functionId)) {
        this.components.push({
          id: '', // Will be assigned later
          functionIds: component,
          size: component.length,
          edges: this.getComponentEdges(component),
          isRecursive: false, // Will be determined later
        });
      }
    }
  }

  /**
   * Check if a function has a self-loop (calls itself)
   */
  private hasSelfLoop(functionId: string): boolean {
    const successors = this.adjacencyList.get(functionId) || new Set();
    return successors.has(functionId);
  }

  /**
   * Get all edges within a component
   */
  private getComponentEdges(functionIds: string[]): CallEdge[] {
    const edges: CallEdge[] = [];
    const functionSet = new Set(functionIds);
    
    for (const callerId of functionIds) {
      const successors = this.adjacencyList.get(callerId) || new Set();
      for (const calleeId of successors) {
        if (functionSet.has(calleeId)) {
          const key = `${callerId}->${calleeId}`;
          const edgeList = this.edgeMap.get(key) || [];
          edges.push(...edgeList);
        }
      }
    }
    
    return edges;
  }

  /**
   * Identify recursive functions (single-node SCCs with self-loops)
   */
  private identifyRecursiveFunctions(): void {
    for (const component of this.components) {
      if (component.size === 1) {
        const functionId = component.functionIds[0];
        component.isRecursive = this.hasSelfLoop(functionId);
      }
    }
  }

  /**
   * Assign unique IDs to components
   */
  private assignComponentIds(): void {
    // Sort by size (descending) for consistent ordering
    this.components.sort((a, b) => b.size - a.size);
    
    for (let i = 0; i < this.components.length; i++) {
      this.components[i].id = `scc-${i + 1}`;
    }
  }

  /**
   * Create a map from function ID to component ID
   */
  private createComponentMap(): Map<string, string> {
    const map = new Map<string, string>();
    
    for (const component of this.components) {
      for (const functionId of component.functionIds) {
        map.set(functionId, component.id);
      }
    }
    
    return map;
  }

  /**
   * Analyze SCC complexity and risk
   */
  analyzeSCCComplexity(
    component: StronglyConnectedComponent,
    functionMetrics: Map<string, { cyclomaticComplexity: number; linesOfCode: number }>
  ): {
    totalComplexity: number;
    totalLines: number;
    averageComplexity: number;
    riskLevel: 'high' | 'medium' | 'low';
  } {
    let totalComplexity = 0;
    let totalLines = 0;
    
    for (const functionId of component.functionIds) {
      const metrics = functionMetrics.get(functionId);
      if (metrics) {
        totalComplexity += metrics.cyclomaticComplexity;
        totalLines += metrics.linesOfCode;
      }
    }
    
    const averageComplexity = component.size > 0 ? 
      totalComplexity / component.size : 0;
    
    // Determine risk level based on size and complexity
    let riskLevel: 'high' | 'medium' | 'low';
    if (component.size > 5 || totalComplexity > 50) {
      riskLevel = 'high';
    } else if (component.size > 3 || totalComplexity > 30) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }
    
    return {
      totalComplexity,
      totalLines,
      averageComplexity,
      riskLevel,
    };
  }

  /**
   * Calculate centrality-based risk scoring for SCC functions
   * This addresses the mathematical expert's suggestion to consider centrality within SCCs
   */
  analyzeSCCCentrality(
    component: StronglyConnectedComponent,
    functionMetrics?: Map<string, { cyclomaticComplexity: number; linesOfCode: number }>
  ): {
    centralityScores: Map<string, number>;
    riskAdjustment: number;
    centralityDistribution: {
      functionId: string;
      centrality: number;
      adjustedRisk: number;
    }[];
  } {
    const centralityScores = new Map<string, number>();
    const riskDistribution: {
      functionId: string;
      centrality: number;
      adjustedRisk: number;
    }[] = [];
    
    // Calculate degree centrality for each function within the SCC
    const degreeMap = new Map<string, { inDegree: number; outDegree: number }>();
    
    // Initialize degree counts
    for (const functionId of component.functionIds) {
      degreeMap.set(functionId, { inDegree: 0, outDegree: 0 });
    }
    
    // Count degrees from component edges
    for (const edge of component.edges) {
      const caller = edge.callerFunctionId;
      const callee = edge.calleeFunctionId;
      
      if (callee && component.functionIds.includes(caller) && component.functionIds.includes(callee)) {
        const callerDegree = degreeMap.get(caller)!;
        const calleeDegree = degreeMap.get(callee)!;
        
        callerDegree.outDegree++;
        calleeDegree.inDegree++;
      }
    }
    
    // Calculate centrality scores (normalized by component size)
    const maxPossibleDegree = component.size - 1;
    
    for (const [functionId, degrees] of degreeMap.entries()) {
      const totalDegree = degrees.inDegree + degrees.outDegree;
      const centrality = maxPossibleDegree > 0 ? totalDegree / (maxPossibleDegree * 2) : 0;
      centralityScores.set(functionId, centrality);
    }
    
    // Calculate risk adjustment based on centrality distribution
    const centralityValues = Array.from(centralityScores.values());
    const avgCentrality = centralityValues.reduce((sum, val) => sum + val, 0) / centralityValues.length;
    const maxCentrality = Math.max(...centralityValues);
    
    // Risk adjustment: higher centrality variance = higher risk
    const centralityVariance = centralityValues.reduce((sum, val) => sum + Math.pow(val - avgCentrality, 2), 0) / centralityValues.length;
    const riskAdjustment = 1 + (centralityVariance * 2) + (maxCentrality * 0.5);
    
    // Generate risk distribution for each function
    for (const [functionId, centrality] of centralityScores.entries()) {
      const baseRisk = functionMetrics?.get(functionId)?.cyclomaticComplexity || 1;
      const centralityMultiplier = 1 + (centrality * 0.5); // Central functions get higher risk
      const adjustedRisk = baseRisk * centralityMultiplier;
      
      riskDistribution.push({
        functionId,
        centrality,
        adjustedRisk,
      });
    }
    
    // Sort by adjusted risk (highest first)
    riskDistribution.sort((a, b) => b.adjustedRisk - a.adjustedRisk);
    
    return {
      centralityScores,
      riskAdjustment,
      centralityDistribution: riskDistribution,
    };
  }

  /**
   * Enhanced SCC risk analysis with centrality consideration
   */
  analyzeEnhancedSCCRisk(
    component: StronglyConnectedComponent,
    functionMetrics: Map<string, { cyclomaticComplexity: number; linesOfCode: number }>
  ): {
    basicAnalysis: {
      totalComplexity: number;
      totalLines: number;
      averageComplexity: number;
      riskLevel: 'high' | 'medium' | 'low';
    };
    centralityAnalysis: {
      centralityScores: Map<string, number>;
      riskAdjustment: number;
      centralityDistribution: {
        functionId: string;
        centrality: number;
        adjustedRisk: number;
      }[];
    };
    enhancedRiskLevel: 'critical' | 'high' | 'medium' | 'low';
    recommendations: string[];
  } {
    const basicAnalysis = this.analyzeSCCComplexity(component, functionMetrics);
    const centralityAnalysis = this.analyzeSCCCentrality(component, functionMetrics);
    
    // Determine enhanced risk level incorporating centrality
    const baseRiskScore = basicAnalysis.riskLevel === 'high' ? 3 : 
                         basicAnalysis.riskLevel === 'medium' ? 2 : 1;
    const adjustedRiskScore = baseRiskScore * centralityAnalysis.riskAdjustment;
    
    let enhancedRiskLevel: 'critical' | 'high' | 'medium' | 'low';
    if (adjustedRiskScore > 4) {
      enhancedRiskLevel = 'critical';
    } else if (adjustedRiskScore > 3) {
      enhancedRiskLevel = 'high';
    } else if (adjustedRiskScore > 2) {
      enhancedRiskLevel = 'medium';
    } else {
      enhancedRiskLevel = 'low';
    }
    
    // Generate recommendations based on centrality analysis
    const recommendations: string[] = [];
    const highCentralityFunctions = centralityAnalysis.centralityDistribution
      .filter(f => f.centrality > 0.7)
      .slice(0, 3);
    
    if (highCentralityFunctions.length > 0) {
      recommendations.push(
        `Focus refactoring on high-centrality functions: ${highCentralityFunctions.map(f => f.functionId).join(', ')}`
      );
    }
    
    if (centralityAnalysis.riskAdjustment > 1.5) {
      recommendations.push('Consider breaking this SCC into smaller components to reduce coupling');
    }
    
    if (component.size > 10) {
      recommendations.push('This large SCC may benefit from architectural redesign');
    }
    
    const centralityVariance = centralityAnalysis.centralityDistribution.reduce((sum, f) => 
      sum + Math.pow(f.centrality - 0.5, 2), 0) / centralityAnalysis.centralityDistribution.length;
    
    if (centralityVariance > 0.1) {
      recommendations.push('Uneven centrality distribution suggests potential architectural issues');
    }
    
    return {
      basicAnalysis,
      centralityAnalysis,
      enhancedRiskLevel,
      recommendations,
    };
  }
}