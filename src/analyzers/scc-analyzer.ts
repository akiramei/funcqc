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
      if (edge.calleeFunctionId) {
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
      allFunctions.add(edge.calleeFunctionId);
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
}