// Removed unused import: OptionValues
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { VoidCommand, BaseCommandOptions } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { DatabaseError } from '../storage/pglite-adapter';
import { CallEdge, FunctionInfo } from '../types';
import { DependencyMetricsCalculator, DependencyMetrics, DependencyStats, DependencyOptions } from '../analyzers/dependency-metrics';
import { ReachabilityAnalyzer, DeadCodeInfo, ReachabilityResult } from '../analyzers/reachability-analyzer';
import { EntryPointDetector } from '../analyzers/entry-point-detector';
import { ArchitectureConfigManager } from '../config/architecture-config';
import { ArchitectureValidator } from '../analyzers/architecture-validator';
import { ArchitectureViolation, ArchitectureAnalysisResult } from '../types/architecture';
import { DotGenerator } from '../visualization/dot-generator';
import { loadCallGraphWithLazyAnalysis, validateCallGraphRequirements } from '../utils/lazy-analysis';

interface RouteComplexityInfo {
  path: string[];           // Function IDs in the route
  pathNames: string[];      // Function names in the route
  totalDepth: number;       // Route length
  totalComplexity: number;  // Sum of cyclomatic complexity for all functions in route
  avgComplexity: number;    // Average complexity per function
  complexityBreakdown: Array<{
    functionId: string;
    functionName: string;
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
  }>;
}

interface DepListOptions extends BaseCommandOptions {
  caller?: string;
  callee?: string;
  callerClass?: string;
  calleeClass?: string;
  file?: string;
  type?: 'direct' | 'async' | 'conditional' | 'external';
  limit?: string;
  sort?: 'caller' | 'callee' | 'file' | 'line';
  desc?: boolean;
  json?: boolean;
  snapshot?: string;
}

interface DepShowOptions extends BaseCommandOptions {
  direction?: 'in' | 'out' | 'both';
  depth?: string;
  includeExternal?: boolean;
  externalFilter?: 'all' | 'transit' | 'none';
  showComplexity?: boolean;    // Show complexity metrics for each function in routes
  rankByLength?: boolean;      // Sort routes by depth (longest first)
  maxRoutes?: string;          // Limit number of displayed routes
  json?: boolean;
  snapshot?: string;
}

interface DepStatsOptions extends BaseCommandOptions {
  sort?: 'fanin' | 'fanout' | 'depth' | 'name';
  limit?: string;
  showHubs?: boolean;
  showUtility?: boolean;
  showIsolated?: boolean;
  hubThreshold?: string;
  utilityThreshold?: string;
  maxHubFunctions?: string;
  maxUtilityFunctions?: string;
  json?: boolean;
  format?: 'table' | 'json' | 'dot';
  snapshot?: string;
}

interface DepLintOptions extends BaseCommandOptions {
  config?: string;
  format?: 'table' | 'json';
  severity?: 'error' | 'warning' | 'info';
  maxViolations?: string;
  includeMetrics?: boolean;
  fix?: boolean;
  snapshot?: string;
}

interface DepDeadOptions extends BaseCommandOptions {
  excludeTests?: boolean;
  excludeExports?: boolean;
  excludeSmall?: boolean;
  threshold?: string;
  format?: 'table' | 'json' | 'dot';
  showReasons?: boolean;
  verbose?: boolean;
  snapshot?: string;
  layerEntryPoints?: string; // Comma-separated list of layer names
}

/**
 * List function dependencies
 */
export const depListCommand: VoidCommand<DepListOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      // Use lazy analysis to ensure call graph data is available
      const { snapshot, callEdges, functions } = await loadCallGraphWithLazyAnalysis(env, {
        showProgress: true,
        snapshotId: options.snapshot
      });

      // Validate that we have sufficient call graph data
      validateCallGraphRequirements(callEdges, 'dep list');

      // Get internal call edges for the snapshot
      if (!snapshot) {
        throw new Error('Failed to load snapshot');
      }
      const internalCallEdges = await env.storage.getInternalCallEdgesBySnapshot(snapshot.id);

      // Convert internal call edges to CallEdge format for unified processing
      const convertedInternalEdges: CallEdge[] = internalCallEdges.map(edge => ({
        id: edge.id,
        callerFunctionId: edge.callerFunctionId,
        calleeFunctionId: edge.calleeFunctionId,
        calleeName: edge.calleeName,
        calleeSignature: undefined,
        callerClassName: edge.callerClassName,
        calleeClassName: edge.calleeClassName,
        callType: edge.callType,
        callContext: edge.callContext,
        lineNumber: edge.lineNumber,
        columnNumber: edge.columnNumber,
        isAsync: false,
        isChained: false,
        confidenceScore: edge.confidenceScore,
        metadata: { source: 'internal', filePath: edge.filePath },
        createdAt: edge.createdAt,
      }));

      // Combine all edges
      const allEdges = [...callEdges, ...convertedInternalEdges];

      if (allEdges.length === 0) {
        console.log(chalk.yellow('No call graph data found. The call graph analyzer may need to be run.'));
        return;
      }

      // Create function map for filtering
      const functionMap = new Map(functions.map(f => [f.id, { id: f.id, name: f.name }]));

      // Apply filters
      let filteredEdges = applyDepFilters(allEdges, options, functionMap);

      // Apply sorting
      filteredEdges = applyDepSorting(filteredEdges, options);

      // Prioritize internal call edges (they have actual line numbers) for better demo
      filteredEdges = prioritizeInternalEdges(filteredEdges);

      // Apply limit
      let limit = 20;
      if (options.limit) {
        const parsed = parseInt(options.limit, 10);
        if (isNaN(parsed) || parsed < 1) {
          console.log(chalk.red(`Invalid limit: ${options.limit}`));
          return;
        }
        limit = parsed;
      }
      const limitedEdges = filteredEdges.slice(0, limit);

      // Output results
      if (options.json) {
        outputDepJSON(limitedEdges, filteredEdges.length, allEdges.length);
      } else {
        outputDepFormatted(limitedEdges, filteredEdges.length, allEdges.length, options);
      }
    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

/**
 * Find function by reference with priority-based matching
 */
function findTargetFunction(
  functionRef: string,
  functions: import('../types').FunctionInfo[]
): import('../types').FunctionInfo | null {
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
  exactMatches: import('../types').FunctionInfo[]
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
  partialMatches: import('../types').FunctionInfo[]
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
function createQualityMetricsMap(
  functions: import('../types').FunctionInfo[]
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
function parseNumericOption(value: string | undefined, defaultValue: number, optionName: string): number | null {
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
 * Perform single function dependency analysis
 */
function performSingleFunctionAnalysis(
  targetFunction: import('../types').FunctionInfo,
  callEdges: CallEdge[],
  functions: import('../types').FunctionInfo[],
  options: DepShowOptions,
  maxDepth: number,
  maxRoutes: number,
  qualityMetricsMap?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }>
): void {
  const dependencies = buildDependencyTree(
    targetFunction.id,
    callEdges,
    functions,
    options.direction || 'both',
    maxDepth,
    options.includeExternal || false,
    {
      showComplexity: options.showComplexity,
      rankByLength: options.rankByLength,
      maxRoutes,
      qualityMetrics: qualityMetricsMap,
      externalFilter: options.externalFilter || 'transit',
    }
  );

  if (options.json) {
    outputDepShowJSON({
      id: targetFunction.id,
      name: targetFunction.name,
      file_path: targetFunction.filePath,
      start_line: targetFunction.startLine
    }, dependencies);
  } else {
    const functionMap = new Map(functions.map(f => [f.id, f]));
    outputDepShowFormatted({
      id: targetFunction.id,
      name: targetFunction.name,
      file_path: targetFunction.filePath,
      start_line: targetFunction.startLine
    }, dependencies, options, functionMap);
  }
}

/**
 * Show detailed dependency information for a function
 * 
 * @param functionRef - Optional function ID or name. If provided, overrides the --name option.
 *                      This parameter enables both programmatic usage and CLI argument passing.
 * 
 * @example
 * // CLI usage with positional argument
 * funcqc dep show myFunction
 * 
 * // CLI usage with option
 * funcqc dep show --name myFunction
 * 
 * // Programmatic usage
 * depShowCommand('myFunction')(options)(env)
 */
export const depShowCommand = (functionRef?: string): VoidCommand<DepShowOptions> => 
  (options) => async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const { callEdges, functions } = await loadCallGraphWithLazyAnalysis(env, {
        showProgress: true,
        snapshotId: options.snapshot
      });

      validateCallGraphRequirements(callEdges, 'dep show');

      const targetFunction = functionRef ? findTargetFunction(functionRef, functions) : null;
      if (functionRef && !targetFunction) {
        return;
      }

      const qualityMetricsMap = options.showComplexity ? createQualityMetricsMap(functions) : undefined;
      
      const maxDepth = parseNumericOption(options.depth, 2, 'depth');
      const maxRoutes = parseNumericOption(options.maxRoutes, 5, 'maxRoutes');
      
      if (maxDepth === null || maxRoutes === null) {
        return;
      }

      if (targetFunction) {
        performSingleFunctionAnalysis(
          targetFunction,
          callEdges,
          functions,
          options,
          maxDepth,
          maxRoutes,
          qualityMetricsMap
        );
      } else {
        await performGlobalRouteAnalysis(
          functions, 
          callEdges, 
          maxDepth, 
          maxRoutes, 
          options, 
          qualityMetricsMap
        );
      }
    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

/**
 * Apply filters to call edges
 */
function applyDepFilters(edges: CallEdge[], options: DepListOptions, functionMap?: Map<string, { id: string; name: string }>): CallEdge[] {
  let filtered = edges;

  if (options.caller && functionMap) {
    const pattern = new RegExp(options.caller.replace(/\*/g, '.*'), 'i');
    filtered = filtered.filter(edge => {
      // Look up the caller function name from the function map
      const callerFunction = Array.from(functionMap.values()).find(f => f.id === edge.callerFunctionId);
      const callerName = callerFunction?.name || '';
      return pattern.test(callerName);
    });
  }

  if (options.callee) {
    const pattern = new RegExp(options.callee.replace(/\*/g, '.*'), 'i');
    filtered = filtered.filter(edge => 
      pattern.test(edge.calleeName || '')
    );
  }

  if (options.callerClass) {
    const pattern = new RegExp(options.callerClass.replace(/\*/g, '.*'), 'i');
    filtered = filtered.filter(edge => 
      edge.callerClassName && pattern.test(edge.callerClassName)
    );
  }

  if (options.calleeClass) {
    const pattern = new RegExp(options.calleeClass.replace(/\*/g, '.*'), 'i');
    filtered = filtered.filter(edge => 
      edge.calleeClassName && pattern.test(edge.calleeClassName)
    );
  }

  if (options.type) {
    filtered = filtered.filter(edge => edge.callType === options.type);
  }

  if (options.file) {
    // File filtering would require looking up function file paths
    // This is a placeholder for now
  }

  return filtered;
}

/**
 * Apply sorting to call edges
 */
function applyDepSorting(edges: CallEdge[], options: DepListOptions): CallEdge[] {
  const sortField = options.sort || 'caller';
  const descending = options.desc || false;

  const sorted = [...edges].sort((a, b) => {
    let comparison = 0;

    switch (sortField) {
      case 'caller':
        comparison = (a.callerFunctionId || '').localeCompare(b.callerFunctionId || '');
        break;
      case 'callee':
        comparison = (a.calleeName || '').localeCompare(b.calleeName || '');
        break;
      case 'line':
        comparison = (a.lineNumber || 0) - (b.lineNumber || 0);
        break;
      case 'file':
        // TODO: Implement file sorting by looking up function file paths
        comparison = 0;
        break;
    }

    return descending ? -comparison : comparison;
  });

  return sorted;
}

/**
 * Prioritize internal call edges for better visibility in demo/analysis contexts.
 * Internal edges (with actual line numbers) are moved to the front of the array.
 * 
 * @param edges - Array of call edges to prioritize
 * @returns Prioritized array with internal edges first, then external edges
 */
function prioritizeInternalEdges(edges: CallEdge[]): CallEdge[] {
  return [...edges].sort((a, b) => {
    // Prioritize edges with line numbers (internal calls) over those without
    const aHasLineNumber = (a.lineNumber ?? 0) > 0;
    const bHasLineNumber = (b.lineNumber ?? 0) > 0;
    
    if (aHasLineNumber && !bHasLineNumber) {
      return -1; // a comes first
    }
    if (!aHasLineNumber && bHasLineNumber) {
      return 1; // b comes first
    }
    
    // If both have line numbers or both don't, maintain original relative order
    return 0;
  });
}

/**
 * Output dependency list as JSON
 */
function outputDepJSON(edges: CallEdge[], totalFiltered: number, totalOriginal: number): void {
  const result = {
    dependencies: edges,
    summary: {
      shown: edges.length,
      total_filtered: totalFiltered,
      total_original: totalOriginal,
    },
  };
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output dependency list in formatted table
 */
function outputDepFormatted(edges: CallEdge[], totalFiltered: number, totalOriginal: number, _options: DepListOptions): void {
  if (edges.length === 0) {
    console.log(chalk.yellow('No dependencies found matching the criteria.'));
    return;
  }

  console.log(chalk.bold('\nFunction Dependencies:'));
  console.log(chalk.gray(`Showing ${edges.length} of ${totalFiltered} dependencies (${totalOriginal} total)\n`));

  // Table header
  const headers = ['Caller', 'Callee', 'Type', 'Line', 'Context'];
  console.log(headers.map(h => chalk.bold(h)).join('\t'));
  console.log(headers.map(() => '─'.repeat(10)).join('\t'));

  // Table rows
  edges.forEach(edge => {
    const callerWithClass = edge.callerClassName ? `${edge.callerClassName}::${edge.callerFunctionId?.substring(0, 8)}` : (edge.callerFunctionId ? edge.callerFunctionId.substring(0, 8) : 'unknown');
    const calleeWithClass = edge.calleeClassName ? `${edge.calleeClassName}::${edge.calleeName}` : (edge.calleeName || 'unknown');
    const type = edge.callType || 'unknown';
    
    
    const line = (edge.lineNumber && edge.lineNumber > 0) ? edge.lineNumber.toString() : '-';
    const context = edge.callContext || 'normal';

    const typeColor = getCallTypeColor(type);
    
    console.log([
      chalk.cyan(callerWithClass),
      chalk.green(calleeWithClass),
      typeColor(type),
      chalk.gray(line),
      chalk.dim(context),
    ].join('\t'));
  });

  console.log();
}

interface DependencyTreeNode {
  id: string;
  name: string;
  depth: number;
  dependencies: Array<{
    direction: 'in' | 'out';
    edge: CallEdge;
    subtree: DependencyTreeNode | null;
  }>;
  routes?: RouteComplexityInfo[];  // Route complexity analysis results
  isExternal?: boolean;  // Indicates if this is an external function node
  isVirtual?: boolean;   // Indicates if this is a virtual callback function node
  frameworkInfo?: string; // Framework name for virtual callback nodes
}

/**
 * Calculate complexity metrics for a dependency route
 */
function calculateRouteComplexity(
  path: string[],
  functions: Array<{ id: string; name: string }>,
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
        cyclomaticComplexity: metrics.cyclomaticComplexity ?? 1,
        cognitiveComplexity: metrics.cognitiveComplexity ?? 1,
      });
    } else {
      // If no metrics available, assume low complexity
      complexityBreakdown.push({
        functionId,
        functionName,
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
 * Build dependency tree with specified depth and optional complexity analysis
 */
/**
 * Configuration for dependency tree building
 */
interface DependencyTreeConfig {
  functionId: string;
  edges: CallEdge[];
  functions: Array<{ id: string; name: string; contextPath?: string[] }>;
  direction: 'in' | 'out' | 'both';
  maxDepth: number;
  includeExternal: boolean;
  options?: {
    showComplexity?: boolean | undefined;
    rankByLength?: boolean | undefined;
    maxRoutes?: number | undefined;
    qualityMetrics?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }> | undefined;
    externalFilter?: 'all' | 'transit' | 'none';
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
  options?: DependencyTreeConfig['options']
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

function buildDependencyTree(
  functionId: string,
  edges: CallEdge[],
  functions: Array<{ id: string; name: string; contextPath?: string[] }>,
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
  
  const result = buildTree(functionId, 0, direction === 'both' ? 'out' : direction) || {
    id: functionId,
    name: 'unknown',
    depth: 0,
    dependencies: [],
  };
  
  return finalizeDependencyTreeWithRoutes(result, routes, options);
}

/**
 * Output dependency show as JSON
 */
function outputDepShowJSON(func: { id: string; name: string; file_path?: string; start_line?: number }, dependencies: DependencyTreeNode): void {
  const result = {
    function: func,
    dependencies,
  };
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output dependency show in formatted tree
 */
/**
 * Display header information for dependency analysis
 */
function displayDependencyAnalysisHeader(
  func: { id: string; name: string; file_path?: string; start_line?: number }
): void {
  console.log(chalk.bold(`\nDependency Analysis for: ${chalk.cyan(func.name)}`));
  console.log(chalk.gray(`ID: ${func.id}`));
  console.log(chalk.gray(`File: ${func.file_path}:${func.start_line}`));
  console.log();
}

/**
 * Display individual route with complexity breakdown
 */
function displayRouteComplexityBreakdown(route: RouteComplexityInfo, index: number): void {
  console.log(chalk.bold(`Route ${index + 1} (Depth: ${route.totalDepth}, Total Complexity: ${route.totalComplexity})`));
  
  route.complexityBreakdown.forEach((breakdown, pathIndex) => {
    const isLast = pathIndex === route.complexityBreakdown.length - 1;
    const connector = pathIndex === 0 ? '  ' : isLast ? '      └─→ ' : '      ├─→ ';
    const complexityInfo = chalk.gray(`(CC: ${breakdown.cyclomaticComplexity})`);
    
    if (pathIndex === 0) {
      console.log(`  ${chalk.cyan(breakdown.functionName)} ${complexityInfo}`);
    } else {
      console.log(`${connector}${chalk.green(breakdown.functionName)} ${complexityInfo}`);
    }
  });
  
  console.log();
}

/**
 * Calculate and display complexity summary statistics
 */
function displayComplexitySummary(routes: RouteComplexityInfo[]): void {
  if (routes.length <= 1) return;

  const maxComplexity = Math.max(...routes.map(r => r.totalComplexity));
  const avgComplexity = routes.reduce((sum, r) => sum + r.totalComplexity, 0) / routes.length;
  const maxComplexityRoute = routes.find(r => r.totalComplexity === maxComplexity);
  
  console.log(chalk.bold('📈 Complexity Summary:'));
  if (maxComplexityRoute) {
    console.log(`  Highest complexity route: Route ${routes.indexOf(maxComplexityRoute) + 1} (${maxComplexity})`);
  }
  console.log(`  Average route complexity: ${avgComplexity.toFixed(1)}`);
  
  const allFunctions = routes.flatMap(r => r.complexityBreakdown);
  if (allFunctions.length > 0) {
    const mostComplexFunction = allFunctions.reduce((max, current) => 
      current.cyclomaticComplexity > max.cyclomaticComplexity ? current : max
    );
    console.log(`  Most complex single function: ${mostComplexFunction.functionName} (${mostComplexFunction.cyclomaticComplexity})`);
  }
  console.log();
}

/**
 * Display route complexity analysis for all routes
 */
function displayRouteComplexityAnalysis(routes: RouteComplexityInfo[]): void {
  console.log(chalk.bold('📊 Longest Routes (by depth):'));
  console.log();
  
  routes.forEach((route, index) => {
    displayRouteComplexityBreakdown(route, index);
  });
  
  displayComplexitySummary(routes);
}

/**
 * Display dependency tree structure recursively
 */
function displayDependencyTree(
  dependencies: DependencyTreeNode,
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>
): void {
  
  function printTree(node: DependencyTreeNode | null, prefix: string = '', isLast: boolean = true): void {
    if (!node) return;

    const connector = isLast ? '└── ' : '├── ';
    const isExternal = node.isExternal;
    const nameColor = node.depth === 0 ? chalk.bold.cyan : (isExternal ? chalk.dim : chalk.green);
    const idDisplay = isExternal ? 'external' : node.id?.substring(0, 8);
    
    console.log(`${prefix}${connector}${nameColor(node.name)} ${chalk.gray(`(${idDisplay})`)}`);
    
    if (node.dependencies && node.dependencies.length > 0) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      
      node.dependencies.forEach((dep, index: number) => {
        const isLastDep = index === node.dependencies.length - 1;
        const arrow = dep.direction === 'in' ? '←' : '→';
        const typeColor = getCallTypeColor(dep.edge.callType);
        
        // Handle virtual callback edges (Commander.js specific)
        if (dep.edge.callType === 'virtual' && 
            (dep.edge.metadata as Record<string, unknown>)?.['framework'] === 'commander' &&
            (dep.edge.metadata as Record<string, unknown>)?.['displayHint'] === 'commander_dispatch') {
          
          displayCommanderVirtualEdge(dep, newPrefix, isLastDep, arrow, functionMap, printTree);
          return;
        }
        
        // Get file path for the edge
        const locationInfo = getEdgeLocationInfo(dep, functionMap);
        console.log(`${newPrefix}${isLastDep ? '└── ' : '├── '}${arrow} ${typeColor(dep.edge.callType)} ${chalk.gray(`(${locationInfo})`)}`);
        
        if (dep.subtree) {
          displaySubtreeNode(dep.subtree, newPrefix, isLastDep, printTree);
        }
      });
    }
  }

  printTree(dependencies);
  console.log();
}

/**
 * Display Commander.js virtual callback edge
 */
function displayCommanderVirtualEdge(
  dep: { direction: 'in' | 'out'; edge: CallEdge; subtree: DependencyTreeNode | null },
  newPrefix: string,
  isLastDep: boolean,
  arrow: string,
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>,
  printTree?: (node: DependencyTreeNode | null, prefix: string, isLast: boolean) => void
): void {
  const triggerMethod = (dep.edge.metadata as Record<string, unknown>)?.['triggerMethod'] as string;
  const programCall = `program.${triggerMethod || 'parseAsync'}`;
  
  let locationInfo = `line ${dep.edge.lineNumber}`;
  if (functionMap && dep.edge.callerFunctionId) {
    const callerFunc = functionMap.get(dep.edge.callerFunctionId);
    if (callerFunc?.filePath) {
      locationInfo = `${callerFunc.filePath}:${dep.edge.lineNumber}`;
    }
  }
  
  console.log(`${newPrefix}${isLastDep ? '└── ' : '├── '}${arrow} ${chalk.yellow('external')} ${chalk.gray(`(${locationInfo})`)}`);
  console.log(`${newPrefix + (isLastDep ? '    ' : '│   ')}└── ${chalk.dim(programCall)} ${chalk.gray('(external)')}`);
  
  if (dep.subtree) {
    const commandDisplayName = `${dep.subtree.name} ${chalk.cyan('[command]')}`;
    console.log(`${newPrefix + (isLastDep ? '        ' : '│       ')}└── ${commandDisplayName}`);
    
    if (dep.subtree.dependencies && dep.subtree.dependencies.length > 0 && printTree) {
      printTree(dep.subtree, newPrefix + (isLastDep ? '        ' : '│       '), true);
    }
  }
}

/**
 * Get location information for edge display
 */
function getEdgeLocationInfo(
  dep: { direction: 'in' | 'out'; edge: CallEdge; subtree: DependencyTreeNode | null },
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>
): string {
  let locationInfo = `line ${dep.edge.lineNumber}`;
  if (functionMap) {
    const relevantFuncId = dep.direction === 'out' ? dep.edge.callerFunctionId : dep.edge.calleeFunctionId;
    if (relevantFuncId) {
      const func = functionMap.get(relevantFuncId);
      if (func?.filePath) {
        locationInfo = `${func.filePath}:${dep.edge.lineNumber}`;
      }
    }
  }
  return locationInfo;
}

/**
 * Display subtree node with appropriate indicators
 */
function displaySubtreeNode(
  subtree: DependencyTreeNode,
  newPrefix: string,
  isLastDep: boolean,
  printTree: (node: DependencyTreeNode | null, prefix: string, isLast: boolean) => void
): void {
  let nodeDisplayName = subtree.name;
  if ((subtree as { isVirtual?: boolean; frameworkInfo?: string }).isVirtual && (subtree as { frameworkInfo?: string }).frameworkInfo) {
    nodeDisplayName = `${subtree.name} ${chalk.cyan(`[${subtree.frameworkInfo}]`)}`;
  } else if (subtree.isExternal) {
    nodeDisplayName = `${subtree.name} ${chalk.gray('(external)')}`;
  }
  
  console.log(`${newPrefix + (isLastDep ? '    ' : '│   ')}└── ${nodeDisplayName}`);
  
  if (subtree.dependencies && subtree.dependencies.length > 0) {
    printTree(subtree, newPrefix + (isLastDep ? '    ' : '│   '), true);
  }
}

function outputDepShowFormatted(
  func: { id: string; name: string; file_path?: string; start_line?: number }, 
  dependencies: DependencyTreeNode, 
  options: DepShowOptions,
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>
): void {
  displayDependencyAnalysisHeader(func);

  // Show route complexity analysis if available
  if (options.showComplexity && dependencies.routes && dependencies.routes.length > 0) {
    displayRouteComplexityAnalysis(dependencies.routes);
  }

  displayDependencyTree(dependencies, functionMap);
}

/**
 * Get color for call type
 */
function getCallTypeColor(type: string): (text: string) => string {
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
 * Show dependency statistics and metrics
 */
export const depStatsCommand: VoidCommand<DepStatsOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Calculating dependency metrics...').start();

    try {
      await executeDepStatsAnalysis(env, options, spinner);
    } catch (error) {
      spinner.fail('Failed to calculate dependency metrics');
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

/**
 * Execute the complete dependency statistics analysis
 */
async function executeDepStatsAnalysis(
  env: CommandEnvironment, 
  options: DepStatsOptions, 
  spinner: Ora
): Promise<void> {
  // Load call graph data
  const { callEdges, functions } = await loadCallGraphData(env, options, spinner);
  
  // Analyze dependencies
  const { entryPointIds, cyclicFunctions } = await analyzeDependencyStructure(functions, callEdges, spinner);
  
  // Calculate metrics
  const { metrics, stats } = await calculateDependencyMetrics(
    functions, 
    callEdges, 
    entryPointIds, 
    cyclicFunctions, 
    options, 
    spinner
  );
  
  spinner.succeed('Dependency metrics calculated');
  
  // Output results
  outputDepStatsResults(functions, callEdges, metrics, stats, options);
}

/**
 * Load and validate call graph data
 */
async function loadCallGraphData(
  env: CommandEnvironment, 
  options: DepStatsOptions, 
  spinner: Ora
): Promise<{ callEdges: CallEdge[]; functions: FunctionInfo[] }> {
  // Use lazy analysis to ensure call graph data is available
  const { callEdges, functions } = await loadCallGraphWithLazyAnalysis(env, {
    showProgress: false, // We manage progress with our own spinner
    snapshotId: options.snapshot
  });

  // Validate that we have sufficient call graph data
  validateCallGraphRequirements(callEdges, 'dep stats');

  spinner.text = 'Loading functions and call graph...';

  if (functions.length === 0) {
    spinner.fail(chalk.yellow('No functions found in the snapshot.'));
    throw new Error('No functions found in the snapshot.');
  }
  
  return { callEdges, functions };
}

/**
 * Analyze dependency structure (entry points and cycles)
 */
async function analyzeDependencyStructure(
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  spinner: Ora
): Promise<{ entryPointIds: Set<string>; cyclicFunctions: Set<string> }> {
  spinner.text = 'Detecting entry points...';

  // Detect entry points
  const entryPointDetector = new EntryPointDetector();
  const entryPoints = entryPointDetector.detectEntryPoints(functions);
  const entryPointIds = new Set(entryPoints.map(ep => ep.functionId));

  spinner.text = 'Detecting circular dependencies...';

  // Detect circular dependencies
  const reachabilityAnalyzer = new ReachabilityAnalyzer();
  const cycles = reachabilityAnalyzer.findCircularDependencies(callEdges);
  const cyclicFunctions = new Set<string>();
  cycles.forEach(cycle => cycle.forEach(func => cyclicFunctions.add(func)));
  
  return { entryPointIds, cyclicFunctions };
}

/**
 * Calculate dependency metrics and generate statistics
 */
async function calculateDependencyMetrics(
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  entryPointIds: Set<string>,
  cyclicFunctions: Set<string>,
  options: DepStatsOptions,
  spinner: Ora
): Promise<{ metrics: DependencyMetrics[]; stats: DependencyStats }> {
  spinner.text = 'Calculating dependency metrics...';

  // Calculate dependency metrics
  const metricsCalculator = new DependencyMetricsCalculator();
  const metrics = metricsCalculator.calculateMetrics(
    functions,
    callEdges,
    entryPointIds,
    cyclicFunctions
  );

  // Parse CLI options into dependency options
  const dependencyOptions = parseDependencyOptions(options, spinner);
  
  const stats = metricsCalculator.generateStats(metrics, dependencyOptions);
  
  return { metrics, stats };
}

/**
 * Parse and validate CLI options into DependencyOptions
 */
function parseDependencyOptions(
  options: DepStatsOptions, 
  spinner: Ora
): DependencyOptions {
  const dependencyOptions: DependencyOptions = {};
  
  if (options.hubThreshold) {
    const parsed = parseInt(options.hubThreshold, 10);
    if (isNaN(parsed) || parsed < 0) {
      spinner.fail(`Invalid hub threshold: ${options.hubThreshold}`);
      throw new Error(`Invalid hub threshold: ${options.hubThreshold}`);
    }
    dependencyOptions.hubThreshold = parsed;
  }
  
  if (options.utilityThreshold) {
    const parsed = parseInt(options.utilityThreshold, 10);
    if (isNaN(parsed) || parsed < 0) {
      spinner.fail(`Invalid utility threshold: ${options.utilityThreshold}`);
      throw new Error(`Invalid utility threshold: ${options.utilityThreshold}`);
    }
    dependencyOptions.utilityThreshold = parsed;
  }
  
  if (options.maxHubFunctions) {
    const parsed = parseInt(options.maxHubFunctions, 10);
    if (isNaN(parsed) || parsed < 1) {
      spinner.fail(`Invalid max hub functions: ${options.maxHubFunctions}`);
      throw new Error(`Invalid max hub functions: ${options.maxHubFunctions}`);
    }
    dependencyOptions.maxHubFunctions = parsed;
  }
  
  if (options.maxUtilityFunctions) {
    const parsed = parseInt(options.maxUtilityFunctions, 10);
    if (isNaN(parsed) || parsed < 1) {
      spinner.fail(`Invalid max utility functions: ${options.maxUtilityFunctions}`);
      throw new Error(`Invalid max utility functions: ${options.maxUtilityFunctions}`);
    }
    dependencyOptions.maxUtilityFunctions = parsed;
  }
  
  return dependencyOptions;
}

/**
 * Output dependency statistics results in the requested format
 */
function outputDepStatsResults(
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  metrics: DependencyMetrics[],
  stats: DependencyStats,
  options: DepStatsOptions
): void {
  if (options.format === 'dot') {
    outputDepStatsDot(functions, callEdges, metrics, options);
  } else if (options.json || options.format === 'json') {
    outputDepStatsJSON(metrics, stats, options);
  } else {
    outputDepStatsTable(metrics, stats, options);
  }
}

/**
 * Output dependency stats as JSON
 */
function outputDepStatsJSON(metrics: DependencyMetrics[], stats: DependencyStats, options: DepStatsOptions): void {
  let limit = 20;
  if (options.limit) {
    const parsed = parseInt(options.limit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = parsed;
    }
  }
  const sortField = options.sort || 'fanin';
  
  // Sort metrics
  const sortedMetrics = [...metrics].sort((a, b) => {
    switch (sortField) {
      case 'fanin':
        return b.fanIn - a.fanIn;
      case 'fanout':
        return b.fanOut - a.fanOut;
      case 'depth':
        return b.depthFromEntry - a.depthFromEntry;
      case 'name':
        return a.functionName.localeCompare(b.functionName);
      default:
        return 0;
    }
  });

  const result = {
    summary: stats,
    metrics: sortedMetrics.slice(0, limit),
    filters: {
      sort: sortField,
      limit,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output dependency stats as formatted table
 */
function outputDepStatsTable(metrics: DependencyMetrics[], stats: DependencyStats, options: DepStatsOptions): void {
  displayStatsSummary(stats);
  displayHubFunctions(stats, options);
  displayUtilityFunctions(stats, options);
  displayIsolatedFunctions(stats, options);
  displayTopFunctionsTable(metrics, options);
}

/**
 * Display statistical summary
 */
function displayStatsSummary(stats: DependencyStats): void {
  console.log(chalk.bold('\n📊 Dependency Statistics\n'));
  console.log(`Total functions: ${chalk.cyan(stats.totalFunctions)}`);
  console.log(`Average fan-in: ${chalk.yellow(stats.avgFanIn.toFixed(1))}`);
  console.log(`Average fan-out: ${chalk.yellow(stats.avgFanOut.toFixed(1))}`);
  console.log(`Maximum fan-in: ${chalk.red(stats.maxFanIn)}`);
  console.log(`Maximum fan-out: ${chalk.red(stats.maxFanOut)}`);
  console.log();
}

/**
 * Display hub functions (high fan-in)
 */
function displayHubFunctions(stats: DependencyStats, options: DepStatsOptions): void {
  if (!options.showHubs || stats.hubFunctions.length === 0) {
    return;
  }
  
  console.log(chalk.bold('🎯 Hub Functions (High Fan-In):'));
  stats.hubFunctions.forEach((func: DependencyMetrics, index: number) => {
    console.log(`  ${index + 1}. ${chalk.cyan(func.functionName)} (fan-in: ${chalk.yellow(func.fanIn)})`);
  });
  console.log();
}

/**
 * Display utility functions (high fan-out)
 */
function displayUtilityFunctions(stats: DependencyStats, options: DepStatsOptions): void {
  if (!options.showUtility || stats.utilityFunctions.length === 0) {
    return;
  }
  
  console.log(chalk.bold('🔧 Utility Functions (High Fan-Out):'));
  stats.utilityFunctions.forEach((func: DependencyMetrics, index: number) => {
    console.log(`  ${index + 1}. ${chalk.cyan(func.functionName)} (fan-out: ${chalk.yellow(func.fanOut)})`);
  });
  console.log();
}

/**
 * Display isolated functions
 */
function displayIsolatedFunctions(stats: DependencyStats, options: DepStatsOptions): void {
  if (!options.showIsolated || stats.isolatedFunctions.length === 0) {
    return;
  }
  
  console.log(chalk.bold('🏝️ Isolated Functions:'));
  stats.isolatedFunctions.forEach((func: DependencyMetrics, index: number) => {
    console.log(`  ${index + 1}. ${chalk.dim(func.functionName)} (${func.filePath})`);
  });
  console.log();
}

/**
 * Parse display limit from options
 */
function parseDisplayLimit(options: DepStatsOptions): number {
  const defaultLimit = 20;
  
  if (!options.limit) {
    return defaultLimit;
  }
  
  const parsed = parseInt(options.limit, 10);
  return (!isNaN(parsed) && parsed > 0) ? parsed : defaultLimit;
}

/**
 * Sort metrics by specified criteria
 */
function sortMetricsByCriteria(metrics: DependencyMetrics[], sortField: string): DependencyMetrics[] {
  return [...metrics].sort((a, b) => {
    switch (sortField) {
      case 'fanin':
        return b.fanIn - a.fanIn;
      case 'fanout':
        return b.fanOut - a.fanOut;
      case 'depth':
        return b.depthFromEntry - a.depthFromEntry;
      case 'name':
        return a.functionName.localeCompare(b.functionName);
      default:
        return 0;
    }
  });
}

/**
 * Display top functions table
 */
function displayTopFunctionsTable(metrics: DependencyMetrics[], options: DepStatsOptions): void {
  const limit = parseDisplayLimit(options);
  const sortField = options.sort || 'fanin';
  const sortedMetrics = sortMetricsByCriteria(metrics, sortField);

  console.log(chalk.bold(`📈 Top ${limit} Functions (by ${sortField}):`));
  console.log(chalk.bold('Name                     Fan-In  Fan-Out  Depth  Cyclic'));
  console.log('─'.repeat(60));

  sortedMetrics.slice(0, limit).forEach((metric: DependencyMetrics) => {
    displayMetricRow(metric);
  });
}

/**
 * Display a single metric row in the table
 */
function displayMetricRow(metric: DependencyMetrics): void {
  const name = metric.functionName.padEnd(25).substring(0, 25);
  const fanIn = metric.fanIn.toString().padStart(6);
  const fanOut = metric.fanOut.toString().padStart(8);
  const depth = metric.depthFromEntry === -1 ? '  N/A' : metric.depthFromEntry.toString().padStart(5);
  const cyclic = metric.isCyclic ? chalk.red(' ✓') : chalk.green(' ✗');

  console.log(`${name} ${fanIn}  ${fanOut}  ${depth}  ${cyclic}`);
}

/**
 * Lint architecture dependencies against defined rules
 */
export const depLintCommand: VoidCommand<DepLintOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Loading architecture configuration...').start();

    try {
      // Load architecture configuration
      const configManager = new ArchitectureConfigManager();
      const archConfig = configManager.load(options.config);

      if (Object.keys(archConfig.layers).length === 0) {
        spinner.fail(chalk.yellow('No architecture layers defined. Create a .funcqc-arch.yaml configuration file.'));
        console.log(chalk.dim('\nExample configuration:'));
        console.log(chalk.cyan(`layers:
  cli: ["src/cli/**"]
  core: ["src/core/**"]
  storage: ["src/storage/**"]
rules:
  - type: forbid
    from: "storage"
    to: "cli"
    description: "Storage should not depend on CLI"
    severity: error`));
        return;
      }

      spinner.text = 'Loading snapshot data...';

      // Use lazy analysis to ensure call graph data is available
      const { callEdges, functions } = await loadCallGraphWithLazyAnalysis(env, {
        showProgress: false, // We manage progress with our own spinner
        snapshotId: options.snapshot
      });

      // Validate that we have sufficient call graph data
      validateCallGraphRequirements(callEdges, 'dep lint');

      spinner.text = 'Loading functions and call graph...';

      if (functions.length === 0) {
        spinner.fail(chalk.yellow('No functions found in the snapshot.'));
        return;
      }

      if (callEdges.length === 0) {
        spinner.fail(chalk.yellow('No call graph data found. The call graph analyzer may need to be run.'));
        return;
      }

      spinner.text = 'Analyzing architecture compliance...';

      // Validate architecture
      const validator = new ArchitectureValidator(archConfig);
      const analysisResult = validator.analyzeArchitecture(functions, callEdges);

      spinner.succeed('Architecture analysis complete');

      // Apply filters
      let filteredViolations = analysisResult.violations;

      // Filter by severity
      if (options.severity) {
        const severityOrder = { info: 1, warning: 2, error: 3 };
        const minSeverity = severityOrder[options.severity];
        filteredViolations = filteredViolations.filter(v => 
          severityOrder[v.severity] >= minSeverity
        );
      }

      // Apply limit
      if (options.maxViolations) {
        const limit = parseInt(options.maxViolations, 10);
        if (!isNaN(limit) && limit > 0) {
          filteredViolations = filteredViolations.slice(0, limit);
        }
      }

      // Output results
      if (options.format === 'json') {
        outputArchLintJSON(analysisResult, filteredViolations, options);
      } else {
        outputArchLintTable(analysisResult, filteredViolations, options);
      }

      // Exit with error code if there are violations
      if (filteredViolations.some(v => v.severity === 'error')) {
        process.exit(1);
      }

    } catch (error) {
      spinner.fail('Failed to analyze architecture');
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

/**
 * Output architecture lint results as JSON
 */
function outputArchLintJSON(
  analysisResult: ArchitectureAnalysisResult,
  violations: ArchitectureViolation[],
  options: DepLintOptions
): void {
  const result = {
    summary: analysisResult.summary,
    violations: violations,
    ...(options.includeMetrics && {
      metrics: analysisResult.metrics,
      layerAssignments: analysisResult.layerAssignments,
    }),
    filters: {
      severity: options.severity,
      maxViolations: options.maxViolations,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output architecture lint report header and summary
 */
function displayArchLintHeader(summary: ArchitectureAnalysisResult['summary']): void {
  console.log(chalk.bold('\n🏗️  Architecture Lint Report\n'));
  console.log(`Total functions: ${chalk.cyan(summary.totalFunctions)}`);
  console.log(`Total layers: ${chalk.cyan(summary.totalLayers)}`);
  console.log(`Total rules: ${chalk.cyan(summary.totalRules)}`);
  console.log(`Layer coverage: ${chalk.yellow((summary.layerCoverage * 100).toFixed(1))}%`);
  console.log();
}

/**
 * Display violation summary statistics
 */
function displayViolationSummary(summary: ArchitectureAnalysisResult['summary']): void {
  const violationSummary = [
    { label: 'Error violations', count: summary.errorViolations, color: chalk.red },
    { label: 'Warning violations', count: summary.warningViolations, color: chalk.yellow },
    { label: 'Info violations', count: summary.infoViolations, color: chalk.blue },
  ];

  console.log(chalk.bold('📊 Violation Summary:'));
  violationSummary.forEach(({ label, count, color }) => {
    if (count > 0) {
      console.log(`  ${color('●')} ${label}: ${color(count)}`);
    }
  });
  console.log();
}

/**
 * Group violations by severity level
 */
function groupViolationsBySeverity(violations: ArchitectureViolation[]): Record<string, ArchitectureViolation[]> {
  return violations.reduce((groups, violation) => {
    if (!groups[violation.severity]) {
      groups[violation.severity] = [];
    }
    groups[violation.severity].push(violation);
    return groups;
  }, {} as Record<string, ArchitectureViolation[]>);
}

/**
 * Display violations organized by severity and file
 */
function displayViolationDetails(violations: ArchitectureViolation[]): void {
  const violationsBySeverity = groupViolationsBySeverity(violations);
  const severityOrder: Array<'error' | 'warning' | 'info'> = ['error', 'warning', 'info'];
  const severityIcons = { error: '❌', warning: '⚠️', info: 'ℹ️' };
  const severityColors = { error: chalk.red, warning: chalk.yellow, info: chalk.blue };

  for (const severity of severityOrder) {
    const severityViolations = violationsBySeverity[severity];
    if (!severityViolations || severityViolations.length === 0) continue;

    console.log(severityColors[severity].bold(`${severityIcons[severity]} ${severity.toUpperCase()} Violations (${severityViolations.length}):`));
    console.log();

    displayViolationsByFile(severityViolations, severityColors[severity]);
  }
}

/**
 * Group and display violations by file
 */
function displayViolationsByFile(violations: ArchitectureViolation[], severityColor: typeof chalk.red): void {
  const violationsByFile = violations.reduce((groups, violation) => {
    const file = violation.source.filePath;
    if (!groups[file]) {
      groups[file] = [];
    }
    groups[file].push(violation);
    return groups;
  }, {} as Record<string, ArchitectureViolation[]>);

  for (const [filePath, fileViolations] of Object.entries(violationsByFile)) {
    console.log(chalk.underline(filePath));
    
    fileViolations.forEach(violation => {
      const { source, target, message, context } = violation;
      
      console.log(`  ${severityColor('●')} ${chalk.cyan(source.functionName)} → ${chalk.green(target.functionName)}`);
      console.log(`    ${chalk.gray('Layer:')} ${source.layer} → ${target.layer}`);
      console.log(`    ${chalk.gray('Rule:')} ${message}`);
      
      if (context?.lineNumber) {
        console.log(`    ${chalk.gray('Line:')} ${context.lineNumber}`);
      }
      
      if (context?.callType) {
        console.log(`    ${chalk.gray('Call type:')} ${getCallTypeColor(context.callType)(context.callType)}`);
      }
      
      console.log();
    });
  }
}

/**
 * Display architecture metrics if enabled
 */
function displayArchitectureMetrics(metrics: NonNullable<ArchitectureAnalysisResult['metrics']>): void {
  console.log(chalk.bold('📈 Architecture Metrics:'));
  console.log();
  
  const { layerCoupling, layerCohesion } = metrics;
  
  // Layer cohesion
  console.log(chalk.bold('Layer Cohesion (higher is better):'));
  for (const [layer, cohesion] of Object.entries(layerCohesion)) {
    const cohesionValue = cohesion as number;
    const percentage = (cohesionValue * 100).toFixed(1);
    const color = cohesionValue > 0.7 ? chalk.green : cohesionValue > 0.4 ? chalk.yellow : chalk.red;
    console.log(`  ${layer}: ${color(percentage)}%`);
  }
  console.log();
  
  // Layer coupling matrix
  console.log(chalk.bold('Layer Coupling Matrix:'));
  const layers = Object.keys(layerCoupling);
  if (layers.length > 0) {
    console.log(`${''.padEnd(12)} ${layers.map(l => l.padEnd(8)).join('')}`);
    
    for (const fromLayer of layers) {
      const row = layers.map(toLayer => {
        const count = layerCoupling[fromLayer]?.[toLayer] || 0;
        return count.toString().padEnd(8);
      });
      console.log(`${fromLayer.padEnd(12)} ${row.join('')}`);
    }
  }
}

/**
 * Display helpful suggestions based on analysis results
 */
function displayArchLintSuggestions(summary: ArchitectureAnalysisResult['summary'], violationCount: number): void {
  console.log(chalk.dim('─'.repeat(60)));
  
  if (summary.layerCoverage < 0.8) {
    console.log(chalk.dim('💡 Tip: Consider adding layer patterns to improve coverage'));
  }
  
  if (summary.errorViolations > 0) {
    console.log(chalk.dim('💡 Fix error violations to pass architecture validation'));
  }
  
  if (violationCount > 10) {
    console.log(chalk.dim('💡 Use --max-violations to limit output or --severity to filter by level'));
  }
}

/**
 * Output architecture lint results as formatted table
 */
function outputArchLintTable(
  analysisResult: ArchitectureAnalysisResult,
  violations: ArchitectureViolation[],
  options: DepLintOptions
): void {
  const { summary } = analysisResult;

  displayArchLintHeader(summary);
  displayViolationSummary(summary);

  if (violations.length === 0) {
    console.log(chalk.green('✅ No architecture violations found!'));
    return;
  }

  displayViolationDetails(violations);

  if (options.includeMetrics && analysisResult.metrics) {
    displayArchitectureMetrics(analysisResult.metrics);
  }

  displayArchLintSuggestions(summary, violations.length);
}

/**
 * Apply function type filters (hub/utility/isolated) to functions and call edges
 */
function applyFunctionTypeFilters(
  functions: import('../types').FunctionInfo[],
  callEdges: CallEdge[],
  metrics: DependencyMetrics[],
  options: DepStatsOptions
): { filteredFunctions: import('../types').FunctionInfo[]; filteredCallEdges: CallEdge[] } {
  if (!options.showHubs && !options.showUtility && !options.showIsolated) {
    return { filteredFunctions: functions, filteredCallEdges: callEdges };
  }
  
  const hubThreshold = options.hubThreshold ? parseInt(options.hubThreshold, 10) : 5;
  const utilityThreshold = options.utilityThreshold ? parseInt(options.utilityThreshold, 10) : 5;
  const metricsMap = new Map(metrics.map(m => [m.functionId, m]));
  
  const filteredFunctions = functions.filter(func => {
    const metric = metricsMap.get(func.id);
    if (!metric) return false;
    
    const isHub = metric.fanIn >= hubThreshold;
    const isUtility = metric.fanOut >= utilityThreshold;
    const isIsolated = metric.fanIn === 0 && metric.fanOut === 0;
    
    return (
      (options.showHubs && isHub) ||
      (options.showUtility && isUtility) ||
      (options.showIsolated && isIsolated) ||
      (!options.showHubs && !options.showUtility && !options.showIsolated)
    );
  });
  
  const remainingFunctionIds = new Set(filteredFunctions.map(f => f.id));
  const filteredCallEdges = callEdges.filter(edge => 
    remainingFunctionIds.has(edge.callerFunctionId) && 
    remainingFunctionIds.has(edge.calleeFunctionId || '')
  );
  
  return { filteredFunctions, filteredCallEdges };
}

/**
 * Apply connectivity-based limit filter to functions and call edges
 */
function applyConnectivityLimitFilter(
  functions: import('../types').FunctionInfo[],
  callEdges: CallEdge[],
  metrics: DependencyMetrics[],
  limitOption: string | undefined
): { filteredFunctions: import('../types').FunctionInfo[]; filteredCallEdges: CallEdge[] } {
  if (!limitOption) {
    return { filteredFunctions: functions, filteredCallEdges: callEdges };
  }
  
  const limit = parseInt(limitOption, 10);
  if (isNaN(limit) || limit <= 0) {
    return { filteredFunctions: functions, filteredCallEdges: callEdges };
  }
  
  const sortedMetrics = metrics
    .map(m => ({
      ...m,
      totalConnectivity: m.fanIn + m.fanOut
    }))
    .sort((a, b) => b.totalConnectivity - a.totalConnectivity)
    .slice(0, limit);
  
  const topFunctionIds = new Set(sortedMetrics.map(m => m.functionId));
  const filteredFunctions = functions.filter(f => topFunctionIds.has(f.id));
  const filteredCallEdges = callEdges.filter(edge => 
    topFunctionIds.has(edge.callerFunctionId) && 
    topFunctionIds.has(edge.calleeFunctionId || '')
  );
  
  return { filteredFunctions, filteredCallEdges };
}

/**
 * Create DOT generation options for dependency graph
 */
function createDotGraphOptions(): {
  title: string;
  rankdir: 'LR';
  nodeShape: 'box';
  includeMetrics: boolean;
  clusterBy: 'file';
  showLabels: boolean;
  maxLabelLength: number;
} {
  return {
    title: 'Dependency Graph',
    rankdir: 'LR' as const,
    nodeShape: 'box' as const,
    includeMetrics: true,
    clusterBy: 'file' as const,
    showLabels: true,
    maxLabelLength: 25,
  };
}

/**
 * Output dependency stats as DOT format
 */
function outputDepStatsDot(
  functions: import('../types').FunctionInfo[],
  callEdges: CallEdge[],
  metrics: DependencyMetrics[],
  options: DepStatsOptions
): void {
  const dotGenerator = new DotGenerator();
  
  // Apply function type filters
  const typeFiltered = applyFunctionTypeFilters(functions, callEdges, metrics, options);
  
  // Apply connectivity limit filter
  const limitFiltered = applyConnectivityLimitFilter(
    typeFiltered.filteredFunctions,
    typeFiltered.filteredCallEdges,
    metrics,
    options.limit
  );
  
  // Generate and output DOT graph
  const dotOptions = createDotGraphOptions();
  const dotOutput = dotGenerator.generateDependencyGraph(
    limitFiltered.filteredFunctions,
    limitFiltered.filteredCallEdges,
    metrics,
    dotOptions
  );
  
  console.log(dotOutput);
}

/**
 * Output dead code results as JSON (for dep dead subcommand)
 */
function outputDepDeadJSON(
  deadCodeInfo: DeadCodeInfo[],
  unusedExportInfo: DeadCodeInfo[],
  reachabilityResult: ReachabilityResult,
  totalFunctions: number,
  options: DepDeadOptions
): void {
  const result = {
    summary: {
      totalFunctions,
      reachableFunctions: reachabilityResult.reachable.size,
      unreachableFunctions: reachabilityResult.unreachable.size,
      unusedExports: reachabilityResult.unusedExports.size,
      entryPoints: reachabilityResult.entryPoints.size,
      deadCodeCount: deadCodeInfo.length,
      coverage: ((reachabilityResult.reachable.size / totalFunctions) * 100).toFixed(2) + '%',
    },
    deadCode: deadCodeInfo,
    unusedExports: unusedExportInfo,
    filters: {
      excludeTests: options.excludeTests || false,
      excludeExports: options.excludeExports || false,
      excludeSmall: options.excludeSmall || false,
      threshold: options.threshold || 3,
      layerEntryPoints: options.layerEntryPoints?.split(',').map(s => s.trim()) || [],
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Display dead code analysis summary header
 */
function displayDeadCodeSummary(
  reachabilityResult: ReachabilityResult,
  totalFunctions: number,
  deadCodeInfo: DeadCodeInfo[],
  unusedExportInfo: DeadCodeInfo[],
  options: DepDeadOptions
): void {
  console.log(chalk.bold('\n📊 Dead Code Analysis Summary\n'));
  
  const coverage = (reachabilityResult.reachable.size / totalFunctions) * 100;
  console.log(`Total functions:      ${chalk.cyan(totalFunctions)}`);
  console.log(`Entry points:         ${chalk.green(reachabilityResult.entryPoints.size)}`);
  
  if (options.layerEntryPoints) {
    const layers = options.layerEntryPoints.split(',').map(s => s.trim());
    console.log(`Layer entry points:   ${chalk.blue(layers.join(', '))}`);
  }
  
  console.log(`Reachable functions:  ${chalk.green(reachabilityResult.reachable.size)} (${coverage.toFixed(1)}%)`);
  console.log(`Unreachable functions: ${chalk.red(reachabilityResult.unreachable.size)} (${(100 - coverage).toFixed(1)}%)`);
  console.log(`Dead code found:      ${chalk.yellow(deadCodeInfo.length)} functions`);
  console.log(`Unused exports:       ${chalk.yellow(unusedExportInfo.length)} functions\n`);
}

/**
 * Group dead code information by file path
 */
function groupDeadCodeByFile(deadCodeInfo: DeadCodeInfo[]): Map<string, DeadCodeInfo[]> {
  const deadCodeByFile = new Map<string, DeadCodeInfo[]>();
  for (const info of deadCodeInfo) {
    if (!deadCodeByFile.has(info.filePath)) {
      deadCodeByFile.set(info.filePath, []);
    }
    deadCodeByFile.get(info.filePath)!.push(info);
  }
  return deadCodeByFile;
}

/**
 * Get reason icon and text for dead code reason
 */
function getReasonDisplay(reason: string): { icon: string; text: string } {
  switch (reason) {
    case 'no-callers':
      return { icon: '🚫', text: 'no-callers' };
    case 'unreachable':
      return { icon: '🔗', text: 'unreachable' };
    case 'test-only':
      return { icon: '🧪', text: 'test-only' };
    default:
      return { icon: '❓', text: reason };
  }
}

/**
 * Display dead code details grouped by file
 */
function displayDeadCodeDetails(deadCodeByFile: Map<string, DeadCodeInfo[]>, options: DepDeadOptions): void {
  console.log(chalk.bold('🚫 Dead Code Details\n'));

  for (const [filePath, functions] of deadCodeByFile) {
    console.log(chalk.underline(filePath));
    
    for (const func of functions) {
      const location = `${func.startLine}-${func.endLine}`;
      const size = `${func.size} lines`;
      const reasonDisplay = getReasonDisplay(func.reason);

      const line = `  ${reasonDisplay.icon} ${chalk.yellow(func.functionName)} ${chalk.gray(`(${location}, ${size})`)}`;
      console.log(line);
      
      if (options.showReasons && options.verbose) {
        console.log(chalk.gray(`     Reason: ${reasonDisplay.text}`));
      }
    }
    
    console.log(); // Empty line between files
  }
}

/**
 * Display unused export functions
 */
function displayUnusedExports(unusedExportInfo: DeadCodeInfo[]): void {
  console.log(chalk.bold('⚠️  Unused Export Functions (Review Required)\n'));
  
  const unusedExportsByFile = groupDeadCodeByFile(unusedExportInfo);
  
  for (const [filePath, functions] of unusedExportsByFile) {
    console.log(chalk.underline(filePath));
    
    for (const func of functions) {
      const location = `${func.startLine}-${func.endLine}`;
      const size = `${func.size} lines`;
      
      console.log(`  📦 ${chalk.yellow(func.functionName)} (${chalk.gray(location)}, ${chalk.gray(size)})`);
    }
    
    console.log(); // Empty line between files
  }
  
  console.log(chalk.dim('💡 These export functions are not used internally but may be public APIs.'));
  console.log(chalk.dim('💡 Review manually to determine if they should be removed or kept.\n'));
}

/**
 * Display summary statistics and suggestions
 */
function displaySummaryAndSuggestions(
  deadCodeInfo: DeadCodeInfo[],
  unusedExportInfo: DeadCodeInfo[],
  options: DepDeadOptions
): void {
  const totalLines = deadCodeInfo.reduce((sum, info) => sum + info.size, 0);
  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.bold(`Total dead code: ${deadCodeInfo.length} functions, ${totalLines} lines`));
  
  if (unusedExportInfo.length > 0) {
    const unusedExportLines = unusedExportInfo.reduce((sum, info) => sum + info.size, 0);
    console.log(chalk.bold(`Unused exports: ${unusedExportInfo.length} functions, ${unusedExportLines} lines`));
  }

  if (!options.excludeTests && deadCodeInfo.some(info => info.reason === 'test-only')) {
    console.log(chalk.dim('\n💡 Tip: Use --exclude-tests to hide test-only functions'));
  }

  if (!options.excludeSmall && deadCodeInfo.some(info => info.size < 5)) {
    console.log(chalk.dim('💡 Tip: Use --exclude-small to hide small functions'));
  }
}

/**
 * Output dead code results as a formatted table (for dep dead subcommand)
 */
function outputDepDeadTable(
  deadCodeInfo: DeadCodeInfo[],
  unusedExportInfo: DeadCodeInfo[],
  reachabilityResult: ReachabilityResult,
  totalFunctions: number,
  options: DepDeadOptions
): void {
  displayDeadCodeSummary(reachabilityResult, totalFunctions, deadCodeInfo, unusedExportInfo, options);

  if (deadCodeInfo.length === 0) {
    console.log(chalk.green('✅ No dead code found with current filters!'));
    return;
  }

  const deadCodeByFile = groupDeadCodeByFile(deadCodeInfo);
  displayDeadCodeDetails(deadCodeByFile, options);

  if (unusedExportInfo.length > 0) {
    displayUnusedExports(unusedExportInfo);
  }

  displaySummaryAndSuggestions(deadCodeInfo, unusedExportInfo, options);
}

/**
 * Output dead code analysis as DOT format (for dep dead subcommand)
 */
function outputDepDeadDot(
  functions: import('../types').FunctionInfo[],
  callEdges: CallEdge[],
  reachabilityResult: ReachabilityResult,
  options: DepDeadOptions
): void {
  const dotGenerator = new DotGenerator();
  
  // Create set of dead function IDs
  const deadFunctionIds = reachabilityResult.unreachable;
  
  // Apply filters
  let filteredFunctions = functions;
  
  // Filter out test functions if requested
  if (options.excludeTests) {
    filteredFunctions = filteredFunctions.filter(func => 
      !func.name.includes('test') && 
      !func.name.includes('Test') &&
      !func.filePath.includes('test') &&
      !func.filePath.includes('spec')
    );
  }
  
  // Filter out small functions if requested
  if (options.excludeSmall) {
    const minSize = options.threshold ? parseInt(options.threshold, 10) : 3;
    filteredFunctions = filteredFunctions.filter(func => 
      func.endLine - func.startLine >= minSize
    );
  }
  
  // Filter call edges to only include those between remaining functions
  const remainingFunctionIds = new Set(filteredFunctions.map(f => f.id));
  const filteredCallEdges = callEdges.filter(edge => 
    remainingFunctionIds.has(edge.callerFunctionId) && 
    remainingFunctionIds.has(edge.calleeFunctionId || '')
  );
  
  // Generate DOT graph
  const dotOptions = {
    title: 'Dead Code Analysis',
    rankdir: 'TB' as const,
    nodeShape: 'box' as const,
    includeMetrics: false,
    clusterBy: 'file' as const,
    showLabels: true,
    maxLabelLength: 30,
  };
  
  const dotOutput = dotGenerator.generateDeadCodeGraph(
    filteredFunctions,
    filteredCallEdges,
    deadFunctionIds as Set<string>,
    dotOptions
  );
  
  console.log(dotOutput);
}

export const depDeadCommand: VoidCommand<DepDeadOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    // Check for common user mistakes with format option
    // Note: args checking removed for type safety - Commander.js will handle invalid arguments
    
    const spinner = ora('Analyzing dead code...').start();

    try {
      // Use lazy analysis to ensure call graph data is available
      const { callEdges, functions } = await loadCallGraphWithLazyAnalysis(env, {
        showProgress: false, // We manage progress with our own spinner
        snapshotId: options.snapshot
      });

      // Validate that we have sufficient call graph data
      validateCallGraphRequirements(callEdges, 'dep dead');

      spinner.text = 'Loading functions and call graph...';

      if (functions.length === 0) {
        spinner.fail(chalk.yellow('No functions found in the latest snapshot.'));
        return;
      }

      spinner.text = 'Detecting entry points...';

      // Parse layer entry points if specified
      const layerEntryPoints = options.layerEntryPoints
        ? options.layerEntryPoints.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : undefined;
      
      // Detect entry points
      const entryPointDetector = new EntryPointDetector({
        ...(options.verbose !== undefined && { verbose: options.verbose }),
        ...(options.verbose !== undefined && { debug: options.verbose }),
        ...(layerEntryPoints && { layerEntryPoints })
      });
      let entryPoints = entryPointDetector.detectEntryPoints(functions);

      // Apply entry point filters
      if (options.excludeExports) {
        // Remove exported functions from entry points
        entryPoints = entryPoints.filter(ep => ep.reason !== 'exported');
      }

      if (options.excludeTests) {
        // Remove test functions from entry points
        entryPoints = entryPoints.filter(ep => ep.reason !== 'test');
      }

      spinner.text = 'Analyzing reachability...';

      // Analyze reachability
      const reachabilityAnalyzer = new ReachabilityAnalyzer();
      const reachabilityResult = reachabilityAnalyzer.analyzeReachability(
        functions,
        callEdges,
        entryPoints
      );

      // Get detailed dead code information
      const deadCodeInfo = reachabilityAnalyzer.getDeadCodeInfo(
        reachabilityResult.unreachable,
        functions,
        callEdges,
        {
          excludeTests: options.excludeTests ?? false,
          excludeSmallFunctions: options.excludeSmall ?? false,
          minFunctionSize: options.threshold ? parseInt(options.threshold) : 3,
        }
      );

      // Get unused export functions information
      const unusedExportInfo = reachabilityAnalyzer.getDeadCodeInfo(
        reachabilityResult.unusedExports,
        functions,
        callEdges,
        {
          excludeTests: false,
          excludeSmallFunctions: false,
          minFunctionSize: 1,
        }
      );

      spinner.succeed('Dead code analysis complete');

      // Output results
      if (options.format === 'dot') {
        outputDepDeadDot(
          functions,
          callEdges,
          reachabilityResult,
          options
        );
      } else if (options.format === 'json') {
        outputDepDeadJSON(
          deadCodeInfo,
          unusedExportInfo,
          reachabilityResult,
          functions.length,
          options
        );
      } else {
        outputDepDeadTable(
          deadCodeInfo,
          unusedExportInfo,
          reachabilityResult,
          functions.length,
          options
        );
      }
    } catch (error) {
      spinner.fail('Failed to analyze dead code');
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  };

/**
 * Perform global route analysis across all functions to find the most complex/longest routes
 */
async function performGlobalRouteAnalysis(
  functions: Array<{ id: string; name: string; metrics?: { cyclomaticComplexity: number } }>,
  callEdges: CallEdge[],
  maxDepth: number,
  maxRoutes: number,
  options: DepShowOptions,
  qualityMetricsMap?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }>
): Promise<void> {
  const allRoutes: RouteComplexityInfo[] = [];

  // Sample a subset of functions for performance (avoid analyzing thousands of functions)
  const sampleSize = Math.min(functions.length, 100);
  const sampleFunctions = functions.slice(0, sampleSize);

  console.log(chalk.blue(`🔍 Analyzing routes from ${sampleSize} functions...`));

  for (const func of sampleFunctions) {
    try {
      const dependencies = buildDependencyTree(
        func.id,
        callEdges,
        functions,
        options.direction || 'both',
        maxDepth,
        options.includeExternal || false,
        {
          showComplexity: options.showComplexity,
          rankByLength: options.rankByLength,
          maxRoutes: 50, // Get more routes for global analysis
          qualityMetrics: qualityMetricsMap,
          externalFilter: options.externalFilter || 'all',
        }
      );

      if (dependencies.routes) {
        allRoutes.push(...dependencies.routes);
      }
    } catch {
      // Skip functions that cause errors
    }
  }

  // Sort routes by the selected criteria
  if (options.rankByLength) {
    // Sort by depth first, then by total complexity
    allRoutes.sort((a, b) => {
      if (b.totalDepth !== a.totalDepth) {
        return b.totalDepth - a.totalDepth;
      }
      return b.totalComplexity - a.totalComplexity;
    });
  } else {
    // Sort by total complexity first, then by depth
    allRoutes.sort((a, b) => {
      if (b.totalComplexity !== a.totalComplexity) {
        return b.totalComplexity - a.totalComplexity;
      }
      return b.totalDepth - a.totalDepth;
    });
  }

  // Take top routes
  const topRoutes = allRoutes.slice(0, maxRoutes);

  // Output results
  console.log(chalk.bold('\n📊 Top Routes in Project:\n'));
  
  if (topRoutes.length === 0) {
    console.log(chalk.yellow('No routes found.'));
    return;
  }

  topRoutes.forEach((route, index) => {
    console.log(`${chalk.bold(`Route ${index + 1}`)} (Depth: ${chalk.cyan(route.totalDepth)}, Total Complexity: ${chalk.magenta(route.totalComplexity)})`);
    
    if (options.showComplexity && route.complexityBreakdown) {
      route.complexityBreakdown.forEach((func, i) => {
        const prefix = i === (route.complexityBreakdown?.length ?? 0) - 1 ? '└──' : '├──';
        console.log(`  ${prefix} ${func.functionName} (CC: ${func.cyclomaticComplexity})`);
      });
    } else {
      route.pathNames.forEach((funcName, i) => {
        const prefix = i === route.pathNames.length - 1 ? '└──' : '├──';
        console.log(`  ${prefix} ${funcName}`);
      });
    }
    console.log();
  });
}