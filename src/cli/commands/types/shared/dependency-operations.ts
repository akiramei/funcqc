import { TypeDefinition, TypeRelationship } from '../../../../types';

/**
 * Dependency information structure
 */
export interface DependencyInfo {
  source: string;
  target: string | undefined;
  relationship: string;
  depth: number;
}

/**
 * Circular dependency cycle information
 */
export interface CircularDependencyCycle {
  cycle: string[];
  length: number;
}

/**
 * Analyze dependencies from database relationships
 */
export function analyzeDependenciesFromDB(
  targetType: TypeDefinition,
  relationships: TypeRelationship[],
  maxDepth: number
): DependencyInfo[] {
  const dependencies: DependencyInfo[] = [];
  const visited = new Set<string>();
  
  function traverse(typeId: string, depth: number) {
    if (depth > maxDepth || visited.has(typeId)) return;
    visited.add(typeId);
    
    const relatedRelationships = relationships.filter(r => r.sourceTypeId === typeId);
    for (const rel of relatedRelationships) {
      dependencies.push({
        source: typeId,
        target: rel.targetTypeId || undefined,
        relationship: rel.relationshipKind,
        depth
      });
      
      if (rel.targetTypeId) {
        traverse(rel.targetTypeId, depth + 1);
      }
    }
  }
  
  traverse(targetType.id, 1);
  return dependencies;
}

/**
 * Find circular dependencies
 */
export function findCircularDependencies(dependencies: DependencyInfo[]): CircularDependencyCycle[] {
  // Simplified circular dependency detection
  const graph = new Map<string, Set<string>>();
  
  // Build graph
  for (const dep of dependencies) {
    if (!graph.has(dep.source)) {
      graph.set(dep.source, new Set());
    }
    if (dep.target) {
      graph.get(dep.source)!.add(dep.target);
    }
  }
  
  // Find cycles (simplified DFS)
  const cycles: CircularDependencyCycle[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  
  function hasCycle(node: string, path: string[]): boolean {
    if (recursionStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push({
        cycle: path.slice(cycleStart).concat(node),
        length: path.length - cycleStart + 1
      });
      return true;
    }
    
    if (visited.has(node)) return false;
    
    visited.add(node);
    recursionStack.add(node);
    path.push(node);
    
    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (hasCycle(neighbor, [...path])) {
        return true;
      }
    }
    
    recursionStack.delete(node);
    return false;
  }
  
  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      hasCycle(node, []);
    }
  }
  
  return cycles;
}

/**
 * Display circular dependencies in database format
 */
export function displayCircularDependenciesDB(cycles: CircularDependencyCycle[]): void {
  console.log(`\n🔄 Found ${cycles.length} circular dependencies:\n`);
  
  for (const cycle of cycles) {
    console.log(`Cycle (length ${cycle.length}): ${cycle.cycle.join(' → ')}`);
  }
}

/**
 * Display dependencies in database format
 */
export function displayDependenciesDB(typeName: string, dependencies: DependencyInfo[]): void {
  console.log(`\n🔗 Dependencies for type '${typeName}':\n`);
  
  const depsByDepth = dependencies.reduce((acc, dep) => {
    if (!acc[dep.depth]) acc[dep.depth] = [];
    acc[dep.depth].push(dep);
    return acc;
  }, {} as Record<number, DependencyInfo[]>);
  
  for (const [depth, deps] of Object.entries(depsByDepth)) {
    console.log(`Depth ${depth}:`);
    for (const dep of deps) {
      const indent = '  '.repeat(parseInt(depth) + 1);
      console.log(`${indent}${dep.relationship} → ${dep.target}`);
    }
  }
}