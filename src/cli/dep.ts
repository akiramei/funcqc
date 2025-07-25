// Removed unused import: OptionValues
import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand, BaseCommandOptions } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { DatabaseError } from '../storage/pglite-adapter';
import { CallEdge } from '../types';
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
      // Use lazy analysis to ensure call graph data is available
      const { callEdges, functions } = await loadCallGraphWithLazyAnalysis(env, {
        showProgress: true,
        snapshotId: options.snapshot
      });

      // Validate that we have sufficient call graph data
      validateCallGraphRequirements(callEdges, 'dep show');

      let targetFunction = null;
      if (functionRef) {
        // Search with priority: 1) ID exact match, 2) Name exact match, 3) Name partial match
        const candidates = functions.filter(f => f.id === functionRef);
        
        if (candidates.length > 0) {
          // ID exact match found
          targetFunction = candidates[0];
        } else {
          // Try exact name match
          const exactMatches = functions.filter(f => f.name === functionRef);
          
          if (exactMatches.length === 1) {
            targetFunction = exactMatches[0];
          } else if (exactMatches.length > 1) {
            // Multiple exact matches (overloads)
            console.log(chalk.yellow(`Multiple functions named "${functionRef}" found:`));
            exactMatches.forEach((func, index) => {
              console.log(`  ${index + 1}. ${chalk.cyan(func.name)} (${chalk.gray(func.id.substring(0, 8))}) - ${func.filePath}:${func.startLine}`);
            });
            console.log(chalk.blue('\nPlease use the function ID for precise selection:'));
            console.log(chalk.gray(`  funcqc dep show ${exactMatches[0].id}`));
            return;
          } else {
            // Try partial name match as fallback
            const partialMatches = functions.filter(f => f.name.includes(functionRef));
            
            if (partialMatches.length === 0) {
              console.log(chalk.red(`Function "${functionRef}" not found.`));
              return;
            } else if (partialMatches.length === 1) {
              targetFunction = partialMatches[0];
              console.log(chalk.dim(`Found partial match: ${targetFunction.name}`));
            } else {
              // Multiple partial matches
              console.log(chalk.yellow(`Multiple functions matching "${functionRef}" found:`));
              partialMatches.slice(0, 10).forEach((func, index) => {
                console.log(`  ${index + 1}. ${chalk.cyan(func.name)} (${chalk.gray(func.id.substring(0, 8))}) - ${func.filePath}:${func.startLine}`);
              });
              if (partialMatches.length > 10) {
                console.log(chalk.gray(`  ... and ${partialMatches.length - 10} more`));
              }
              console.log(chalk.blue('\nPlease be more specific or use the function ID:'));
              console.log(chalk.gray(`  funcqc dep show ${partialMatches[0].id}`));
              return;
            }
          }
        }
      }

      // Get quality metrics if complexity analysis is requested
      let qualityMetricsMap: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }> | undefined;
      if (options.showComplexity) {
        // Quality metrics are already included in FunctionInfo from getFunctionsBySnapshot
        qualityMetricsMap = new Map(
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

      // Apply depth filtering if needed
      let maxDepth = 2;
      if (options.depth) {
        const parsed = parseInt(options.depth, 10);
        if (isNaN(parsed) || parsed < 1) {
          console.log(chalk.red(`Invalid depth: ${options.depth}`));
          return;
        }
        maxDepth = parsed;
      }

      // Parse maxRoutes option
      let maxRoutes = 5; // default
      if (options.maxRoutes) {
        const parsed = parseInt(options.maxRoutes, 10);
        if (isNaN(parsed) || parsed < 1) {
          console.log(chalk.red(`Invalid maxRoutes: ${options.maxRoutes}`));
          return;
        }
        maxRoutes = parsed;
      }

      if (targetFunction) {
        // Single function analysis
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

        // Output results
        if (options.json) {
          outputDepShowJSON({
            id: targetFunction.id,
            name: targetFunction.name,
            file_path: targetFunction.filePath,
            start_line: targetFunction.startLine
          }, dependencies);
        } else {
          // Create function map for file path lookups
          const functionMap = new Map(functions.map(f => [f.id, f]));
          outputDepShowFormatted({
            id: targetFunction.id,
            name: targetFunction.name,
            file_path: targetFunction.filePath,
            start_line: targetFunction.startLine
          }, dependencies, options, functionMap);
        }
      } else {
        // Global analysis - find top routes across all functions
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
  function shouldIncludeExternal(edge: CallEdge): boolean {
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
  
  function buildTree(currentId: string, depth: number, dir: 'in' | 'out', currentPath: string[] = []): DependencyTreeNode | null {
    if (depth > maxDepth || visited.has(currentId)) {
      return null;
    }
    
    visited.add(currentId);
    const newPath = [...currentPath, currentId];
    
    const currentFunction = functions.find(f => f.id === currentId);
    
    // Enhance constructor display with class name for internal functions
    let displayName = currentFunction?.name || 'unknown';
    if (currentFunction?.name === 'constructor' && currentFunction.contextPath && currentFunction.contextPath.length > 0) {
      // Use the first element of contextPath as the class name
      displayName = `new ${currentFunction.contextPath[0]}`;
    }
    
    const result: DependencyTreeNode = {
      id: currentId,
      name: displayName,
      depth,
      dependencies: [],
    };
    
    if (dir === 'in' || direction === 'both') {
      // Incoming dependencies (who calls this function)
      const incoming = edges.filter(edge => {
        if (edge.calleeFunctionId !== currentId) return false;
        if (edge.callType === 'external') return shouldIncludeExternal(edge);
        return true;
      });
      
      result.dependencies.push(...incoming.map(edge => {
        let subtree = null;
        
        if (edge.callerFunctionId) {
          // Internal function call - recurse
          subtree = buildTree(edge.callerFunctionId, depth + 1, 'in', newPath);
        }
        // Note: For incoming dependencies, we don't typically have external callers
        // as external functions calling our internal functions is less common
        
        return {
          direction: 'in' as const,
          edge,
          subtree,
        };
      }).filter(dep => dep.subtree));
    }
    
    if (dir === 'out' || direction === 'both') {
      // Outgoing dependencies (what this function calls)
      const outgoing = edges.filter(edge => {
        if (edge.callerFunctionId !== currentId) return false;
        if (edge.callType === 'external' || edge.callType === 'virtual') {
          return shouldIncludeExternal(edge);
        }
        return true;
      });
      
      result.dependencies.push(...outgoing.map(edge => {
        let subtree = null;
        
        if (edge.calleeFunctionId) {
          // Internal function call - recurse
          subtree = buildTree(edge.calleeFunctionId, depth + 1, 'out', newPath);
        } else if (includeExternal && edge.calleeName) {
          // External or virtual function call - create terminal node
          if (edge.callType === 'virtual') {
            // Virtual callback function call
            subtree = {
              id: `virtual:${edge.calleeName}`,
              name: edge.calleeName,
              depth: depth + 1,
              dependencies: [],
              isVirtual: true,
              frameworkInfo: (edge.metadata as Record<string, unknown>)?.['framework'] as string || 'unknown'
            } as DependencyTreeNode & { isVirtual: boolean; frameworkInfo: string };
          } else {
            // External function call
            // Enhance constructor display with class name
            let displayName = edge.calleeName;
            if (edge.calleeName === 'constructor' && edge.calleeClassName) {
              displayName = `new ${edge.calleeClassName}`;
            }
            
            subtree = {
              id: `external:${edge.calleeName}`,
              name: displayName,
              depth: depth + 1,
              dependencies: [],
              isExternal: true
            } as DependencyTreeNode & { isExternal: boolean };
          }
        }
        
        return {
          direction: 'out' as const,
          edge,
          subtree,
        };
      }).filter(dep => dep.subtree));
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
function outputDepShowFormatted(
  func: { id: string; name: string; file_path?: string; start_line?: number }, 
  dependencies: DependencyTreeNode, 
  options: DepShowOptions,
  functionMap?: Map<string, { id: string; name: string; filePath: string; startLine: number }>
): void {
  console.log(chalk.bold(`\nDependency Analysis for: ${chalk.cyan(func.name)}`));
  console.log(chalk.gray(`ID: ${func.id}`));
  console.log(chalk.gray(`File: ${func.file_path}:${func.start_line}`));
  console.log();

  // Show route complexity analysis if available
  if (options.showComplexity && dependencies.routes && dependencies.routes.length > 0) {
    console.log(chalk.bold('📊 Longest Routes (by depth):'));
    console.log();
    
    dependencies.routes.forEach((route, index) => {
      console.log(chalk.bold(`Route ${index + 1} (Depth: ${route.totalDepth}, Total Complexity: ${route.totalComplexity})`));
      
      // Display route path with complexity breakdown
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
    });
    
    // Summary statistics
    if (dependencies.routes.length > 1) {
      const maxComplexity = Math.max(...dependencies.routes.map(r => r.totalComplexity));
      const avgComplexity = dependencies.routes.reduce((sum, r) => sum + r.totalComplexity, 0) / dependencies.routes.length;
      const maxComplexityRoute = dependencies.routes.find(r => r.totalComplexity === maxComplexity);
      
      console.log(chalk.bold('📈 Complexity Summary:'));
      if (maxComplexityRoute) {
        console.log(`  Highest complexity route: Route ${dependencies.routes.indexOf(maxComplexityRoute) + 1} (${maxComplexity})`);
      }
      console.log(`  Average route complexity: ${avgComplexity.toFixed(1)}`);
      
      const allFunctions = dependencies.routes.flatMap(r => r.complexityBreakdown);
      if (allFunctions.length > 0) {
        const mostComplexFunction = allFunctions.reduce((max, current) => 
          current.cyclomaticComplexity > max.cyclomaticComplexity ? current : max
        );
        console.log(`  Most complex single function: ${mostComplexFunction.functionName} (${mostComplexFunction.cyclomaticComplexity})`);
      }
      console.log();
    }
  }

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
        
        // Add framework info for virtual callback edges
        // Commander.js specific display: show program.parseAsync in the flow
        if (dep.edge.callType === 'virtual' && 
            (dep.edge.metadata as Record<string, unknown>)?.['framework'] === 'commander' &&
            (dep.edge.metadata as Record<string, unknown>)?.['displayHint'] === 'commander_dispatch') {
          
          const triggerMethod = (dep.edge.metadata as Record<string, unknown>)?.['triggerMethod'] as string;
          const programCall = `program.${triggerMethod || 'parseAsync'}`;
          
          // Insert program.parseAsync as intermediate step
          let locationInfo = `line ${dep.edge.lineNumber}`;
          if (functionMap && dep.edge.callerFunctionId) {
            const callerFunc = functionMap.get(dep.edge.callerFunctionId);
            if (callerFunc?.filePath) {
              locationInfo = `${callerFunc.filePath}:${dep.edge.lineNumber}`;
            }
          }
          console.log(`${newPrefix}${isLastDep ? '└── ' : '├── '}${arrow} ${chalk.yellow('external')} ${chalk.gray(`(${locationInfo})`)}`);
          console.log(`${newPrefix + (isLastDep ? '    ' : '│   ')}└── ${chalk.dim(programCall)} ${chalk.gray('(external)')}`);
          
          // Then show the actual command function
          if (dep.subtree) {
            const commandDisplayName = `${dep.subtree.name} ${chalk.cyan('[command]')}`;
            console.log(`${newPrefix + (isLastDep ? '        ' : '│       ')}└── ${commandDisplayName}`);
            
            // Continue with recursive tree printing if there are more dependencies
            if (dep.subtree.dependencies && dep.subtree.dependencies.length > 0) {
              printTree(dep.subtree, newPrefix + (isLastDep ? '        ' : '│       '), true);
            }
          }
          return; // Skip the normal rendering
        }
        
        // Get file path for the edge
        let locationInfo = `line ${dep.edge.lineNumber}`;
        if (functionMap) {
          // For outgoing calls, use caller's file path
          // For incoming calls, use callee's file path
          const relevantFuncId = dep.direction === 'out' ? dep.edge.callerFunctionId : dep.edge.calleeFunctionId;
          if (relevantFuncId) {
            const func = functionMap.get(relevantFuncId);
            if (func?.filePath) {
              locationInfo = `${func.filePath}:${dep.edge.lineNumber}`;
            }
          }
        }
        
        console.log(`${newPrefix}${isLastDep ? '└── ' : '├── '}${arrow} ${typeColor(dep.edge.callType)} ${chalk.gray(`(${locationInfo})`)}`);
        
        if (dep.subtree) {
          // Add framework indicator for virtual nodes
          let nodeDisplayName = dep.subtree.name;
          if ((dep.subtree as { isVirtual?: boolean; frameworkInfo?: string }).isVirtual && (dep.subtree as { frameworkInfo?: string }).frameworkInfo) {
            nodeDisplayName = `${dep.subtree.name} ${chalk.cyan(`[${dep.subtree.frameworkInfo}]`)}`;
          } else if (dep.subtree.isExternal) {
            nodeDisplayName = `${dep.subtree.name} ${chalk.gray('(external)')}`;
          }
          
          // Print the node with appropriate indicators
          console.log(`${newPrefix + (isLastDep ? '    ' : '│   ')}└── ${nodeDisplayName}`);
          
          // Continue with recursive tree printing if there are more dependencies
          if (dep.subtree.dependencies && dep.subtree.dependencies.length > 0) {
            printTree(dep.subtree, newPrefix + (isLastDep ? '    ' : '│   '), true);
          }
        }
      });
    }
  }

  printTree(dependencies);
  console.log();
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
        return;
      }

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

      spinner.text = 'Calculating dependency metrics...';

      // Calculate dependency metrics
      const metricsCalculator = new DependencyMetricsCalculator();
      const metrics = metricsCalculator.calculateMetrics(
        functions,
        callEdges,
        entryPointIds,
        cyclicFunctions
      );

      // Create dependency options from CLI arguments
      const dependencyOptions: DependencyOptions = {};
      if (options.hubThreshold) {
        const parsed = parseInt(options.hubThreshold, 10);
        if (isNaN(parsed) || parsed < 0) {
          spinner.fail(`Invalid hub threshold: ${options.hubThreshold}`);
          return;
        }
        dependencyOptions.hubThreshold = parsed;
      }
      if (options.utilityThreshold) {
        const parsed = parseInt(options.utilityThreshold, 10);
        if (isNaN(parsed) || parsed < 0) {
          spinner.fail(`Invalid utility threshold: ${options.utilityThreshold}`);
          return;
        }
        dependencyOptions.utilityThreshold = parsed;
      }
      if (options.maxHubFunctions) {
        const parsed = parseInt(options.maxHubFunctions, 10);
        if (isNaN(parsed) || parsed < 1) {
          spinner.fail(`Invalid max hub functions: ${options.maxHubFunctions}`);
          return;
        }
        dependencyOptions.maxHubFunctions = parsed;
      }
      if (options.maxUtilityFunctions) {
        const parsed = parseInt(options.maxUtilityFunctions, 10);
        if (isNaN(parsed) || parsed < 1) {
          spinner.fail(`Invalid max utility functions: ${options.maxUtilityFunctions}`);
          return;
        }
        dependencyOptions.maxUtilityFunctions = parsed;
      }
      
      const stats = metricsCalculator.generateStats(metrics, dependencyOptions);

      spinner.succeed('Dependency metrics calculated');

      // Output results
      if (options.format === 'dot') {
        outputDepStatsDot(functions, callEdges, metrics, options);
      } else if (options.json || options.format === 'json') {
        outputDepStatsJSON(metrics, stats, options);
      } else {
        outputDepStatsTable(metrics, stats, options);
      }
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
  console.log(chalk.bold('\n📊 Dependency Statistics\n'));
  
  // Summary
  console.log(`Total functions: ${chalk.cyan(stats.totalFunctions)}`);
  console.log(`Average fan-in: ${chalk.yellow(stats.avgFanIn.toFixed(1))}`);
  console.log(`Average fan-out: ${chalk.yellow(stats.avgFanOut.toFixed(1))}`);
  console.log(`Maximum fan-in: ${chalk.red(stats.maxFanIn)}`);
  console.log(`Maximum fan-out: ${chalk.red(stats.maxFanOut)}`);
  console.log();

  // Hub functions (high fan-in)
  if (options.showHubs && stats.hubFunctions.length > 0) {
    console.log(chalk.bold('🎯 Hub Functions (High Fan-In):'));
    stats.hubFunctions.forEach((func: DependencyMetrics, index: number) => {
      console.log(`  ${index + 1}. ${chalk.cyan(func.functionName)} (fan-in: ${chalk.yellow(func.fanIn)})`);
    });
    console.log();
  }

  // Utility functions (high fan-out)
  if (options.showUtility && stats.utilityFunctions.length > 0) {
    console.log(chalk.bold('🔧 Utility Functions (High Fan-Out):'));
    stats.utilityFunctions.forEach((func: DependencyMetrics, index: number) => {
      console.log(`  ${index + 1}. ${chalk.cyan(func.functionName)} (fan-out: ${chalk.yellow(func.fanOut)})`);
    });
    console.log();
  }

  // Isolated functions
  if (options.showIsolated && stats.isolatedFunctions.length > 0) {
    console.log(chalk.bold('🏝️ Isolated Functions:'));
    stats.isolatedFunctions.forEach((func: DependencyMetrics, index: number) => {
      console.log(`  ${index + 1}. ${chalk.dim(func.functionName)} (${func.filePath})`);
    });
    console.log();
  }

  // Top functions by sort criteria
  let limit = 20;
  if (options.limit) {
    const parsed = parseInt(options.limit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = parsed;
    }
  }
  const sortField = options.sort || 'fanin';
  
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

  console.log(chalk.bold(`📈 Top ${limit} Functions (by ${sortField}):`));
  console.log(chalk.bold('Name                     Fan-In  Fan-Out  Depth  Cyclic'));
  console.log('─'.repeat(60));

  sortedMetrics.slice(0, limit).forEach((metric: DependencyMetrics) => {
    const name = metric.functionName.padEnd(25).substring(0, 25);
    const fanIn = metric.fanIn.toString().padStart(6);
    const fanOut = metric.fanOut.toString().padStart(8);
    const depth = metric.depthFromEntry === -1 ? '  N/A' : metric.depthFromEntry.toString().padStart(5);
    const cyclic = metric.isCyclic ? chalk.red(' ✓') : chalk.green(' ✗');

    console.log(`${name} ${fanIn}  ${fanOut}  ${depth}  ${cyclic}`);
  });
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
 * Output architecture lint results as formatted table
 */
function outputArchLintTable(
  analysisResult: ArchitectureAnalysisResult,
  violations: ArchitectureViolation[],
  options: DepLintOptions
): void {
  const { summary } = analysisResult;

  // Header
  console.log(chalk.bold('\n🏗️  Architecture Lint Report\n'));

  // Summary
  console.log(`Total functions: ${chalk.cyan(summary.totalFunctions)}`);
  console.log(`Total layers: ${chalk.cyan(summary.totalLayers)}`);
  console.log(`Total rules: ${chalk.cyan(summary.totalRules)}`);
  console.log(`Layer coverage: ${chalk.yellow((summary.layerCoverage * 100).toFixed(1))}%`);
  console.log();

  // Violation summary
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

  if (violations.length === 0) {
    console.log(chalk.green('✅ No architecture violations found!'));
    return;
  }

  // Group violations by severity
  const violationsBySeverity = violations.reduce((groups, violation) => {
    if (!groups[violation.severity]) {
      groups[violation.severity] = [];
    }
    groups[violation.severity].push(violation);
    return groups;
  }, {} as Record<string, ArchitectureViolation[]>);

  // Display violations by severity
  const severityOrder: Array<'error' | 'warning' | 'info'> = ['error', 'warning', 'info'];
  const severityIcons = { error: '❌', warning: '⚠️', info: 'ℹ️' };
  const severityColors = { error: chalk.red, warning: chalk.yellow, info: chalk.blue };

  for (const severity of severityOrder) {
    const severityViolations = violationsBySeverity[severity];
    if (!severityViolations || severityViolations.length === 0) continue;

    console.log(severityColors[severity].bold(`${severityIcons[severity]} ${severity.toUpperCase()} Violations (${severityViolations.length}):`));
    console.log();

    // Group by file for better readability
    const violationsByFile = severityViolations.reduce((groups, violation) => {
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
        
        console.log(`  ${severityColors[severity]('●')} ${chalk.cyan(source.functionName)} → ${chalk.green(target.functionName)}`);
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

  // Metrics summary if requested
  if (options.includeMetrics && analysisResult.metrics) {
    console.log(chalk.bold('📈 Architecture Metrics:'));
    console.log();
    
    const { layerCoupling, layerCohesion } = analysisResult.metrics;
    
    // Layer cohesion
    console.log(chalk.bold('Layer Cohesion (higher is better):'));
    for (const [layer, cohesion] of Object.entries(layerCohesion)) {
      const percentage = (cohesion * 100).toFixed(1);
      const color = cohesion > 0.7 ? chalk.green : cohesion > 0.4 ? chalk.yellow : chalk.red;
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

  // Suggestions
  console.log(chalk.dim('─'.repeat(60)));
  
  if (summary.layerCoverage < 0.8) {
    console.log(chalk.dim('💡 Tip: Consider adding layer patterns to improve coverage'));
  }
  
  if (summary.errorViolations > 0) {
    console.log(chalk.dim('💡 Fix error violations to pass architecture validation'));
  }
  
  if (violations.length > 10) {
    console.log(chalk.dim('💡 Use --max-violations to limit output or --severity to filter by level'));
  }
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
  
  // Apply filters based on options
  let filteredFunctions = functions;
  let filteredCallEdges = callEdges;
  
  // Filter by hub/utility/isolated functions if requested
  if (options.showHubs || options.showUtility || options.showIsolated) {
    const hubThreshold = options.hubThreshold ? parseInt(options.hubThreshold, 10) : 5;
    const utilityThreshold = options.utilityThreshold ? parseInt(options.utilityThreshold, 10) : 5;
    
    const metricsMap = new Map(metrics.map(m => [m.functionId, m]));
    
    filteredFunctions = functions.filter(func => {
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
    
    // Filter edges to only include those between remaining functions
    const remainingFunctionIds = new Set(filteredFunctions.map(f => f.id));
    filteredCallEdges = callEdges.filter(edge => 
      remainingFunctionIds.has(edge.callerFunctionId) && 
      remainingFunctionIds.has(edge.calleeFunctionId || '')
    );
  }
  
  // Apply limit if specified
  if (options.limit) {
    const limit = parseInt(options.limit, 10);
    if (!isNaN(limit) && limit > 0) {
      // Sort by fanIn + fanOut (total connectivity) and take top N
      const sortedMetrics = metrics
        .map(m => ({
          ...m,
          totalConnectivity: m.fanIn + m.fanOut
        }))
        .sort((a, b) => b.totalConnectivity - a.totalConnectivity)
        .slice(0, limit);
      
      const topFunctionIds = new Set(sortedMetrics.map(m => m.functionId));
      filteredFunctions = filteredFunctions.filter(f => topFunctionIds.has(f.id));
      
      // Filter edges to only include those between top functions
      filteredCallEdges = callEdges.filter(edge => 
        topFunctionIds.has(edge.callerFunctionId) && 
        topFunctionIds.has(edge.calleeFunctionId || '')
      );
    }
  }
  
  // Generate DOT graph
  const dotOptions = {
    title: 'Dependency Graph',
    rankdir: 'LR' as const,
    nodeShape: 'box' as const,
    includeMetrics: true,
    clusterBy: 'file' as const,
    showLabels: true,
    maxLabelLength: 25,
  };
  
  const dotOutput = dotGenerator.generateDependencyGraph(
    filteredFunctions,
    filteredCallEdges,
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
    },
  };

  console.log(JSON.stringify(result, null, 2));
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
  // Summary
  console.log(chalk.bold('\n📊 Dead Code Analysis Summary\n'));
  
  const coverage = (reachabilityResult.reachable.size / totalFunctions) * 100;
  console.log(`Total functions:      ${chalk.cyan(totalFunctions)}`);
  console.log(`Entry points:         ${chalk.green(reachabilityResult.entryPoints.size)}`);
  console.log(`Reachable functions:  ${chalk.green(reachabilityResult.reachable.size)} (${coverage.toFixed(1)}%)`);
  console.log(`Unreachable functions: ${chalk.red(reachabilityResult.unreachable.size)} (${(100 - coverage).toFixed(1)}%)`);
  console.log(`Dead code found:      ${chalk.yellow(deadCodeInfo.length)} functions`);
  console.log(`Unused exports:       ${chalk.yellow(unusedExportInfo.length)} functions\n`);

  if (deadCodeInfo.length === 0) {
    console.log(chalk.green('✅ No dead code found with current filters!'));
    return;
  }

  // Group by file
  const deadCodeByFile = new Map<string, typeof deadCodeInfo>();
  for (const info of deadCodeInfo) {
    if (!deadCodeByFile.has(info.filePath)) {
      deadCodeByFile.set(info.filePath, []);
    }
    deadCodeByFile.get(info.filePath)!.push(info);
  }

  console.log(chalk.bold('🚫 Dead Code Details\n'));

  // Display by file
  for (const [filePath, functions] of deadCodeByFile) {
    console.log(chalk.underline(filePath));
    
    for (const func of functions) {
      const location = `${func.startLine}-${func.endLine}`;
      const size = `${func.size} lines`;
      
      let reasonIcon = '❓';
      let reasonText = func.reason;
      
      switch (func.reason) {
        case 'no-callers':
          reasonIcon = '🚫';
          reasonText = 'no-callers';
          break;
        case 'unreachable':
          reasonIcon = '🔗';
          reasonText = 'unreachable';
          break;
        case 'test-only':
          reasonIcon = '🧪';
          reasonText = 'test-only';
          break;
      }

      const line = `  ${reasonIcon} ${chalk.yellow(func.functionName)} ${chalk.gray(`(${location}, ${size})`)}`;
      console.log(line);
      
      if (options.showReasons && options.verbose) {
        console.log(chalk.gray(`     Reason: ${reasonText}`));
      }
    }
    
    console.log(); // Empty line between files
  }

  // Display unused export functions
  if (unusedExportInfo.length > 0) {
    console.log(chalk.bold('⚠️  Unused Export Functions (Review Required)\n'));
    
    // Group unused exports by file
    const unusedExportsByFile = new Map<string, typeof unusedExportInfo>();
    for (const info of unusedExportInfo) {
      if (!unusedExportsByFile.has(info.filePath)) {
        unusedExportsByFile.set(info.filePath, []);
      }
      unusedExportsByFile.get(info.filePath)!.push(info);
    }
    
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

  // Summary statistics
  const totalLines = deadCodeInfo.reduce((sum, info) => sum + info.size, 0);
  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.bold(`Total dead code: ${deadCodeInfo.length} functions, ${totalLines} lines`));
  
  if (unusedExportInfo.length > 0) {
    const unusedExportLines = unusedExportInfo.reduce((sum, info) => sum + info.size, 0);
    console.log(chalk.bold(`Unused exports: ${unusedExportInfo.length} functions, ${unusedExportLines} lines`));
  }

  // Suggestions
  if (!options.excludeTests && deadCodeInfo.some(info => info.reason === 'test-only')) {
    console.log(chalk.dim('\n💡 Tip: Use --exclude-tests to hide test-only functions'));
  }

  if (!options.excludeSmall && deadCodeInfo.some(info => info.size < 5)) {
    console.log(chalk.dim('💡 Tip: Use --exclude-small to hide small functions'));
  }
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

      // Detect entry points
      const entryPointDetector = new EntryPointDetector({
        ...(options.verbose !== undefined && { verbose: options.verbose }),
        ...(options.verbose !== undefined && { debug: options.verbose })
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