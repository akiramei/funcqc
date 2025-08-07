import { TypeDependency, CircularDependency } from './type-dependency-analyzer';

/**
 * Type-specific Strongly Connected Component
 */
export interface TypeSCC {
  id: string;
  typeIds: string[];
  typeNames: string[];
  size: number;
  dependencies: TypeDependency[];
  isRecursive: boolean;
}

/**
 * Tarjan's algorithm adapted for Type Dependencies
 * Based on the existing SCCAnalyzer implementation
 */
export class TypeSCCAnalyzer {
  private index: number;
  private stack: string[];
  private indices: Map<string, number>;
  private lowLinks: Map<string, number>;
  private onStack: Set<string>;
  private components: TypeSCC[];
  private adjacencyList: Map<string, Set<string>>;
  private dependencyMap: Map<string, TypeDependency[]>;
  private typeNameMap: Map<string, string>;

  constructor() {
    this.index = 0;
    this.stack = [];
    this.indices = new Map();
    this.lowLinks = new Map();
    this.onStack = new Set();
    this.components = [];
    this.adjacencyList = new Map();
    this.dependencyMap = new Map();
    this.typeNameMap = new Map();
  }

  /**
   * Find all strongly connected components in type dependencies
   */
  findStronglyConnectedComponents(
    dependencies: TypeDependency[],
    typeNameMapping?: Map<string, string>
  ): {
    components: TypeSCC[];
    circularDependencies: CircularDependency[];
    totalComponents: number;
    largestComponentSize: number;
  } {
    // Reset state
    this.reset();
    
    // Store type name mapping if provided
    if (typeNameMapping) {
      this.typeNameMap = typeNameMapping;
    }
    
    // Build adjacency list and dependency map
    this.buildAdjacencyList(dependencies);
    
    // Get all unique type IDs
    const allTypeIds = new Set<string>();
    for (const dep of dependencies) {
      if (dep.sourceTypeId) allTypeIds.add(dep.sourceTypeId);
      if (dep.targetTypeId) allTypeIds.add(dep.targetTypeId);
    }
    
    // Run Tarjan's algorithm
    for (const typeId of allTypeIds) {
      if (!this.indices.has(typeId)) {
        this.strongConnect(typeId);
      }
    }
    
    // Post-process components
    this.identifyRecursiveTypes();
    this.assignComponentIds();
    
    // Convert to circular dependencies format for compatibility
    const circularDependencies = this.convertToCircularDependencies();
    
    // Calculate statistics
    const largestComponentSize = Math.max(
      ...this.components.map(c => c.size),
      0
    );
    
    return {
      components: this.components,
      circularDependencies,
      totalComponents: this.components.length,
      largestComponentSize,
    };
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
    this.dependencyMap.clear();
  }

  /**
   * Build adjacency list from type dependencies
   */
  private buildAdjacencyList(dependencies: TypeDependency[]): void {
    for (const dep of dependencies) {
      // Skip if no target type ID
      if (!dep.targetTypeId || !dep.sourceTypeId) continue;
      
      // Add to adjacency list
      if (!this.adjacencyList.has(dep.sourceTypeId)) {
        this.adjacencyList.set(dep.sourceTypeId, new Set());
      }
      this.adjacencyList.get(dep.sourceTypeId)!.add(dep.targetTypeId);
      
      // Store dependency for later reference
      const key = `${dep.sourceTypeId}->${dep.targetTypeId}`;
      if (!this.dependencyMap.has(key)) {
        this.dependencyMap.set(key, []);
      }
      this.dependencyMap.get(key)!.push(dep);
      
      // Ensure target exists in adjacency list
      if (!this.adjacencyList.has(dep.targetTypeId)) {
        this.adjacencyList.set(dep.targetTypeId, new Set());
      }
      
      // Store type names if available
      if (dep.targetTypeName && dep.targetTypeId) {
        this.typeNameMap.set(dep.targetTypeId, dep.targetTypeName);
      }
    }
  }

  /**
   * Tarjan's algorithm - main recursive function
   */
  private strongConnect(typeId: string): void {
    // Set the depth index for v to the smallest unused index
    this.indices.set(typeId, this.index);
    this.lowLinks.set(typeId, this.index);
    this.index++;
    this.stack.push(typeId);
    this.onStack.add(typeId);
    
    // Consider successors of v
    const successors = this.adjacencyList.get(typeId) || new Set();
    for (const successorId of successors) {
      if (!this.indices.has(successorId)) {
        // Successor has not yet been visited; recurse on it
        this.strongConnect(successorId);
        this.lowLinks.set(
          typeId,
          Math.min(
            this.lowLinks.get(typeId)!,
            this.lowLinks.get(successorId)!
          )
        );
      } else if (this.onStack.has(successorId)) {
        // Successor is in stack and hence in the current SCC
        this.lowLinks.set(
          typeId,
          Math.min(
            this.lowLinks.get(typeId)!,
            this.indices.get(successorId)!
          )
        );
      }
    }
    
    // If v is a root node, pop the stack and create an SCC
    if (this.lowLinks.get(typeId) === this.indices.get(typeId)) {
      const component: string[] = [];
      let w: string;
      
      do {
        w = this.stack.pop()!;
        this.onStack.delete(w);
        component.push(w);
      } while (w !== typeId);
      
      // Only add non-trivial SCCs (size > 1) or self-loops
      if (component.length > 1 || this.hasSelfLoop(typeId)) {
        const typeNames = component.map(id => 
          this.typeNameMap.get(id) || `Type_${id.substring(0, 8)}`
        );
        
        this.components.push({
          id: '', // Will be assigned later
          typeIds: component,
          typeNames: typeNames,
          size: component.length,
          dependencies: this.getComponentDependencies(component),
          isRecursive: false, // Will be determined later
        });
      }
    }
  }

  /**
   * Check if a type has a self-loop (references itself)
   */
  private hasSelfLoop(typeId: string): boolean {
    const successors = this.adjacencyList.get(typeId) || new Set();
    return successors.has(typeId);
  }

  /**
   * Get all dependencies within a component
   */
  private getComponentDependencies(typeIds: string[]): TypeDependency[] {
    const dependencies: TypeDependency[] = [];
    const typeSet = new Set(typeIds);
    
    for (const sourceId of typeIds) {
      const successors = this.adjacencyList.get(sourceId) || new Set();
      for (const targetId of successors) {
        if (typeSet.has(targetId)) {
          const key = `${sourceId}->${targetId}`;
          const depList = this.dependencyMap.get(key) || [];
          dependencies.push(...depList);
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Identify recursive types (single-type SCCs with self-loops)
   */
  private identifyRecursiveTypes(): void {
    for (const component of this.components) {
      if (component.size === 1) {
        const typeId = component.typeIds[0];
        component.isRecursive = this.hasSelfLoop(typeId);
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
      this.components[i].id = `type-scc-${i + 1}`;
    }
  }

  /**
   * Convert SCCs to CircularDependency format for backward compatibility
   */
  private convertToCircularDependencies(): CircularDependency[] {
    const circularDeps: CircularDependency[] = [];
    
    for (const component of this.components) {
      // Only process actual cycles (not single recursive types)
      if (component.size > 1) {
        // Create a cycle path by following dependencies
        const path: TypeDependency[] = [];
        
        // Build a simple cycle path (not necessarily the shortest)
        for (let i = 0; i < component.typeIds.length; i++) {
          const sourceId = component.typeIds[i];
          const targetId = component.typeIds[(i + 1) % component.typeIds.length];
          
          // Find a dependency between these two types
          const key = `${sourceId}->${targetId}`;
          const deps = this.dependencyMap.get(key);
          
          if (deps && deps.length > 0) {
            path.push(deps[0]);
          } else {
            // Try to find an indirect path
            for (const intermediateId of component.typeIds) {
              const key1 = `${sourceId}->${intermediateId}`;
              const key2 = `${intermediateId}->${targetId}`;
              const deps1 = this.dependencyMap.get(key1);
              const deps2 = this.dependencyMap.get(key2);
              
              if (deps1 && deps1.length > 0 && deps2 && deps2.length > 0) {
                path.push(deps1[0]);
                path.push(deps2[0]);
                break;
              }
            }
          }
        }
        
        circularDeps.push({
          typeIds: component.typeIds,
          typeNames: component.typeNames,
          dependencyPath: path,
          severity: component.size > 3 ? 'error' : 'warning',
        });
      }
    }
    
    return circularDeps;
  }

  /**
   * Calculate condensation graph (DAG of SCCs)
   */
  calculateCondensationGraph(
    dependencies: TypeDependency[]
  ): {
    nodes: TypeSCC[];
    edges: Array<{ from: string; to: string; count: number }>;
  } {
    const result = this.findStronglyConnectedComponents(dependencies);
    const componentMap = new Map<string, string>();
    
    // Map each type to its component
    for (const component of result.components) {
      for (const typeId of component.typeIds) {
        componentMap.set(typeId, component.id);
      }
    }
    
    // Count edges between components
    const edgeCount = new Map<string, number>();
    
    for (const dep of dependencies) {
      if (!dep.sourceTypeId || !dep.targetTypeId) continue;
      
      const fromComponent = componentMap.get(dep.sourceTypeId);
      const toComponent = componentMap.get(dep.targetTypeId);
      
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
      nodes: result.components,
      edges: condensedEdges,
    };
  }
}