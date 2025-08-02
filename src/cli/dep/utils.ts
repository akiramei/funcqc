import chalk from 'chalk';
import { CallEdge, FunctionInfo } from '../../types';
import { RouteComplexityInfo, DependencyTreeNode } from './types';

/**
 * Find function by reference with priority-based matching
 */
export function findTargetFunction(
  functionRef: string,
  functions: FunctionInfo[]
): FunctionInfo | null {
  // Search with priority: 1) ID exact match, 2) Name exact match, 3) Name partial match
  const candidates = functions.filter(f => f.id === functionRef);
  
  if (candidates.length > 0) {
    return candidates[0];
  }
  
  // Try exact name match
  const exactMatches = functions.filter(f => f.name === functionRef);
  
  if (exactMatches.length === 1) {
    return exactMatches[0];
  } else if (exactMatches.length > 1) {
    displayMultipleExactMatches(functionRef, exactMatches);
    return null;
  }
  
  // Try partial name match as fallback
  const partialMatches = functions.filter(f => f.name.includes(functionRef));
  
  if (partialMatches.length === 0) {
    console.log(chalk.red(`Function "${functionRef}" not found.`));
    return null;
  } else if (partialMatches.length === 1) {
    const targetFunction = partialMatches[0];
    console.log(chalk.dim(`Found partial match: ${targetFunction.name}`));
    return targetFunction;
  } else {
    displayMultiplePartialMatches(functionRef, partialMatches);
    return null;
  }
}

/**
 * Display multiple exact function name matches
 */
function displayMultipleExactMatches(
  functionRef: string,
  exactMatches: FunctionInfo[]
): void {
  console.log(chalk.yellow(`Multiple functions named "${functionRef}" found:`));
  exactMatches.forEach((func, index) => {
    console.log(`  ${index + 1}. ${chalk.cyan(func.name)} (${chalk.gray(func.id.substring(0, 8))}) - ${func.filePath}:${func.startLine}`);
  });
  console.log(chalk.blue('\nPlease use the function ID for precise selection:'));
  console.log(chalk.gray(`  funcqc dep show ${exactMatches[0].id}`));
}

/**
 * Display multiple partial function name matches
 */
function displayMultiplePartialMatches(
  functionRef: string,
  partialMatches: FunctionInfo[]
): void {
  console.log(chalk.yellow(`Multiple functions matching "${functionRef}" found:`));
  partialMatches.slice(0, 10).forEach((func, index) => {
    console.log(`  ${index + 1}. ${chalk.cyan(func.name)} (${chalk.gray(func.id.substring(0, 8))}) - ${func.filePath}:${func.startLine}`);
  });
  if (partialMatches.length > 10) {
    console.log(chalk.gray(`  ... and ${partialMatches.length - 10} more`));
  }
  console.log(chalk.blue('\nPlease be more specific or use the function ID:'));
  console.log(chalk.gray(`  funcqc dep show ${partialMatches[0].id}`));
}

/**
 * Create quality metrics map for complexity analysis
 */
export function createQualityMetricsMap(
  functions: FunctionInfo[]
): Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }> {
  return new Map(
    functions
      .filter(f => f.metrics)
      .map(f => [
        f.id, 
        { 
          cyclomaticComplexity: f.metrics?.cyclomaticComplexity ?? 1, 
          cognitiveComplexity: f.metrics?.cognitiveComplexity ?? 1 
        }
      ])
  );
}

/**
 * Parse and validate numeric option
 */
export function parseNumericOption(value: string | undefined, defaultValue: number, optionName: string): number | null {
  if (!value) {
    return defaultValue;
  }
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    console.log(chalk.red(`Invalid ${optionName}: ${value}`));
    return null;
  }
  
  return parsed;
}

/**
 * Get color for call type
 */
export function getCallTypeColor(type: string): (text: string) => string {
  switch (type) {
    case 'direct':
      return chalk.green;
    case 'async':
      return chalk.blue;
    case 'conditional':
      return chalk.yellow;
    case 'external':
      return chalk.gray;
    case 'virtual':
      return chalk.magenta;
    default:
      return chalk.white;
  }
}

/**
 * Calculate complexity metrics for a dependency route
 */
export function calculateRouteComplexity(
  path: string[],
  functions: Array<{ id: string; name: string; filePath?: string; startLine?: number }>,
  qualityMetrics?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }>
): RouteComplexityInfo | null {
  // Comprehensive null checks
  if (!path || path.length === 0) {
    return null;
  }
  
  if (!functions || functions.length === 0) {
    return null;
  }
  
  // If no quality metrics provided, still calculate basic route info
  if (!qualityMetrics || qualityMetrics.size === 0) {
    return {
      path,
      pathNames: path.map(id => functions.find(f => f.id === id)?.name || 'unknown'),
      totalDepth: path.length,
      totalComplexity: path.length, // Assume complexity of 1 per function
      avgComplexity: 1,
      complexityBreakdown: path.map(id => {
        const func = functions.find(f => f.id === id);
        return {
          functionId: id,
          functionName: func?.name || 'unknown',
          filePath: func?.filePath,
          startLine: func?.startLine,
          cyclomaticComplexity: 1,
          cognitiveComplexity: 1,
        };
      }),
    };
  }

  let totalComplexity = 0;
  const complexityBreakdown: RouteComplexityInfo['complexityBreakdown'] = [];
  const pathNames: string[] = [];

  for (const functionId of path) {
    const functionInfo = functions.find(f => f.id === functionId);
    const metrics = qualityMetrics.get(functionId);
    
    const functionName = functionInfo?.name || 'unknown';
    pathNames.push(functionName);
    
    if (metrics) {
      totalComplexity += metrics.cyclomaticComplexity ?? 1;
      complexityBreakdown.push({
        functionId,
        functionName,
        filePath: functionInfo?.filePath,
        startLine: functionInfo?.startLine,
        cyclomaticComplexity: metrics.cyclomaticComplexity ?? 1,
        cognitiveComplexity: metrics.cognitiveComplexity ?? 1,
      });
    } else {
      // If no metrics available, assume low complexity
      complexityBreakdown.push({
        functionId,
        functionName,
        filePath: functionInfo?.filePath,
        startLine: functionInfo?.startLine,
        cyclomaticComplexity: 1,
        cognitiveComplexity: 1,
      });
      totalComplexity += 1;
    }
  }

  return {
    path,
    pathNames,
    totalDepth: path.length,
    totalComplexity,
    avgComplexity: path.length > 0 ? totalComplexity / path.length : 0,
    complexityBreakdown,
  };
}

/**
 * Check if an external node should be included based on filter settings
 */
function shouldIncludeExternalNode(
  edge: CallEdge,
  includeExternal: boolean,
  externalFilter: 'all' | 'transit' | 'none'
): boolean {
  if (!includeExternal) return false;
  if (externalFilter === 'none') return false;
  if (externalFilter === 'all') return true;
  
  // For 'transit' mode, check if this external call leads back to internal code
  if (externalFilter === 'transit') {
    // Virtual calls (like Commander callbacks) are considered transit nodes
    if (edge.callType === 'virtual') return true;
    
    // Check if this external function is called by internal code and calls internal code
    // This requires looking ahead in the call graph
    // For now, we'll include common patterns like event handlers and callbacks
    const transitPatterns = [
      'parseAsync', 'parse', // Commander.js
      'on', 'once', 'emit',  // EventEmitter
      'then', 'catch'        // Promises
      // Array methods removed - they're too noisy
    ];
    
    return edge.calleeName ? transitPatterns.some(pattern => 
      edge.calleeName!.includes(pattern)
    ) : false;
  }
  
  return false;
}

/**
 * Create a display name for function, handling constructors specially
 */
function createFunctionDisplayName(
  functionInfo: { id: string; name: string; contextPath?: string[] } | undefined
): string {
  if (!functionInfo) return 'unknown';
  
  // Enhance constructor display with class name for internal functions
  if (functionInfo.name === 'constructor' && functionInfo.contextPath && functionInfo.contextPath.length > 0) {
    return `new ${functionInfo.contextPath[0]}`;
  }
  
  return functionInfo.name;
}

/**
 * Create external dependency node
 */
function createExternalDependencyNode(
  edge: CallEdge,
  depth: number
): DependencyTreeNode & { isExternal: boolean } {
  // Enhance constructor display with class name
  let displayName = edge.calleeName || 'unknown';
  if (edge.calleeName === 'constructor' && edge.calleeClassName) {
    displayName = `new ${edge.calleeClassName}`;
  }
  
  return {
    id: `external:${edge.calleeName}`,
    name: displayName,
    depth: depth + 1,
    dependencies: [],
    isExternal: true
  };
}

/**
 * Create virtual dependency node
 */
function createVirtualDependencyNode(
  edge: CallEdge,
  depth: number
): DependencyTreeNode & { isVirtual: boolean; frameworkInfo: string } {
  return {
    id: `virtual:${edge.calleeName}`,
    name: edge.calleeName || 'unknown',
    depth: depth + 1,
    dependencies: [],
    isVirtual: true,
    frameworkInfo: (edge.metadata as Record<string, unknown>)?.['framework'] as string || 'unknown'
  };
}

/**
 * Build dependency tree with specified depth and optional complexity analysis
 */
export function buildDependencyTree(
  functionId: string,
  edges: CallEdge[],
  functions: Array<{ id: string; name: string; contextPath?: string[]; filePath?: string; startLine?: number }>,
  direction: 'in' | 'out' | 'both',
  maxDepth: number,
  includeExternal: boolean,
  options?: {
    showComplexity?: boolean | undefined;
    rankByLength?: boolean | undefined;
    maxRoutes?: number | undefined;
    qualityMetrics?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }> | undefined;
    externalFilter?: 'all' | 'transit' | 'none';
  }
): DependencyTreeNode {
  const visited = new Set<string>();
  const routes: RouteComplexityInfo[] = [];
  const externalFilter = options?.externalFilter || 'transit';
  
  // Helper function to check if an external node should be included
  const shouldIncludeExternal = (edge: CallEdge) => 
    shouldIncludeExternalNode(edge, includeExternal, externalFilter);
  
  function buildTree(currentId: string, depth: number, dir: 'in' | 'out', currentPath: string[] = []): DependencyTreeNode | null {
    if (depth > maxDepth || visited.has(currentId)) {
      return null;
    }
    
    visited.add(currentId);
    const newPath = [...currentPath, currentId];
    
    const currentFunction = functions.find(f => f.id === currentId);
    const displayName = createFunctionDisplayName(currentFunction);
    
    const result: DependencyTreeNode = {
      id: currentId,
      name: displayName,
      depth,
      dependencies: [],
    };
    
    if (dir === 'in' || direction === 'both') {
      const incomingDeps = processIncomingDependencies(
        currentId, edges, shouldIncludeExternal, buildTree, depth, newPath
      );
      result.dependencies.push(...incomingDeps);
    }
    
    if (dir === 'out' || direction === 'both') {
      const outgoingDeps = processOutgoingDependencies(
        currentId, edges, shouldIncludeExternal, buildTree, depth, newPath, includeExternal
      );
      result.dependencies.push(...outgoingDeps);
    }
    
    // Record route if this is a leaf node or if complexity analysis is enabled
    if (options?.showComplexity && (result.dependencies.length === 0 || depth === maxDepth)) {
      const routeComplexity = calculateRouteComplexity(newPath, functions, options.qualityMetrics);
      if (routeComplexity) {
        routes.push(routeComplexity);
      }
    }
    
    return result;
  }
  
  const result = buildTree(functionId, 0, direction === 'both' ? 'out' : direction);
  
  if (!result) {
    return {
      id: functionId,
      name: 'unknown',
      depth: 0,
      dependencies: [],
    };
  }
  
  // Clean up options to match the required type signature
  const cleanedOptions = options ? {
    ...(options.showComplexity !== undefined && { showComplexity: options.showComplexity }),
    ...(options.rankByLength !== undefined && { rankByLength: options.rankByLength }),
    ...(options.maxRoutes !== undefined && { maxRoutes: options.maxRoutes }),
    ...(options.qualityMetrics !== undefined && { qualityMetrics: options.qualityMetrics }),
    ...(options.externalFilter !== undefined && { externalFilter: options.externalFilter }),
  } : undefined;
  
  return finalizeDependencyTreeWithRoutes(result, routes, cleanedOptions);
}

/**
 * Process incoming dependencies for a function
 */
function processIncomingDependencies(
  currentId: string,
  edges: CallEdge[],
  shouldIncludeExternal: (edge: CallEdge) => boolean,
  buildTreeFn: (id: string, depth: number, dir: 'in' | 'out', path: string[]) => DependencyTreeNode | null,
  depth: number,
  newPath: string[]
): Array<{ direction: 'in'; edge: CallEdge; subtree: DependencyTreeNode | null }> {
  const incoming = edges.filter(edge => {
    if (edge.calleeFunctionId !== currentId) return false;
    if (edge.callType === 'external') return shouldIncludeExternal(edge);
    return true;
  });
  
  return incoming.map(edge => {
    let subtree = null;
    
    if (edge.callerFunctionId) {
      // Internal function call - recurse
      subtree = buildTreeFn(edge.callerFunctionId, depth + 1, 'in', newPath);
    }
    // Note: For incoming dependencies, we don't typically have external callers
    
    return {
      direction: 'in' as const,
      edge,
      subtree,
    };
  }).filter(dep => dep.subtree);
}

/**
 * Process outgoing dependencies for a function
 */
function processOutgoingDependencies(
  currentId: string,
  edges: CallEdge[],
  shouldIncludeExternal: (edge: CallEdge) => boolean,
  buildTreeFn: (id: string, depth: number, dir: 'in' | 'out', path: string[]) => DependencyTreeNode | null,
  depth: number,
  newPath: string[],
  includeExternal: boolean
): Array<{ direction: 'out'; edge: CallEdge; subtree: DependencyTreeNode | null }> {
  const outgoing = edges.filter(edge => {
    if (edge.callerFunctionId !== currentId) return false;
    if (edge.callType === 'external' || edge.callType === 'virtual') {
      return shouldIncludeExternal(edge);
    }
    return true;
  });
  
  return outgoing.map(edge => {
    let subtree = null;
    
    if (edge.calleeFunctionId) {
      // Internal function call - recurse
      subtree = buildTreeFn(edge.calleeFunctionId, depth + 1, 'out', newPath);
    } else if (includeExternal && edge.calleeName) {
      // External or virtual function call - create terminal node
      if (edge.callType === 'virtual') {
        subtree = createVirtualDependencyNode(edge, depth);
      } else {
        subtree = createExternalDependencyNode(edge, depth);
      }
    }
    
    return {
      direction: 'out' as const,
      edge,
      subtree,
    };
  }).filter(dep => dep.subtree);
}

/**
 * Finalize dependency tree with route analysis
 */
function finalizeDependencyTreeWithRoutes(
  result: DependencyTreeNode,
  routes: RouteComplexityInfo[],
  options?: {
    showComplexity?: boolean;
    rankByLength?: boolean;
    maxRoutes?: number;
    qualityMetrics?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }>;
    externalFilter?: 'all' | 'transit' | 'none';
  }
): DependencyTreeNode {
  // Add route analysis results if complexity analysis is enabled
  if (options?.showComplexity && routes.length > 0) {
    // Sort routes by length if requested
    const sortedRoutes = options.rankByLength 
      ? routes.sort((a, b) => b.totalDepth - a.totalDepth)
      : routes;
    
    // Apply route limit
    const limitedRoutes = options.maxRoutes 
      ? sortedRoutes.slice(0, options.maxRoutes)
      : sortedRoutes;
      
    result.routes = limitedRoutes;
  }
  
  return result;
}