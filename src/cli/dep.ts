// Removed unused import: OptionValues
import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand, BaseCommandOptions } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { DatabaseError } from '../storage/pglite-adapter';
import { CallEdge } from '../types';
import { DependencyMetricsCalculator, DependencyMetrics, DependencyStats, DependencyOptions } from '../analyzers/dependency-metrics';
import { ReachabilityAnalyzer } from '../analyzers/reachability-analyzer';
import { EntryPointDetector } from '../analyzers/entry-point-detector';
import { ArchitectureConfigManager } from '../config/architecture-config';
import { ArchitectureValidator } from '../analyzers/architecture-validator';
import { ArchitectureViolation, ArchitectureAnalysisResult } from '../types/architecture';
import { DotGenerator } from '../visualization/dot-generator';

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

/**
 * List function dependencies
 */
export const depListCommand: VoidCommand<DepListOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      // Get the latest snapshot if no specific snapshot is provided
      const snapshot = options.snapshot ? 
        await env.storage.getSnapshot(options.snapshot) :
        await env.storage.getLatestSnapshot();

      if (!snapshot) {
        console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      // Get both external and internal call edges for the snapshot
      const [callEdges, internalCallEdges] = await Promise.all([
        env.storage.getCallEdgesBySnapshot(snapshot.id),
        env.storage.getInternalCallEdgesBySnapshot(snapshot.id)
      ]);
      

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

      // Get function map for filtering
      const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);
      const functionMap = new Map(functions.map(f => [f.id, { id: f.id, name: f.name }]));

      // Apply filters
      let filteredEdges = applyDepFilters(allEdges, options, functionMap);

      // Apply sorting
      filteredEdges = applyDepSorting(filteredEdges, options);

      // Prioritize internal call edges (they have actual line numbers) for better demo
      filteredEdges = [...filteredEdges].sort((a, b) => {
        // Internal edges first
        const aIsInternal = a.metadata?.['source'] === 'internal';
        const bIsInternal = b.metadata?.['source'] === 'internal';
        
        if (aIsInternal && !bIsInternal) return -1;
        if (!aIsInternal && bIsInternal) return 1;
        
        // Within same type, prefer edges with line numbers
        const aHasLine = a.lineNumber && a.lineNumber > 0;
        const bHasLine = b.lineNumber && b.lineNumber > 0;
        
        if (aHasLine && !bHasLine) return -1;
        if (!aHasLine && bHasLine) return 1;
        
        return 0; // Keep original order
      });

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
 */
export const depShowCommand = (functionRef?: string): VoidCommand<DepShowOptions> => 
  (options) => async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      // Get the latest snapshot if no specific snapshot is provided
      const snapshot = options.snapshot ? 
        await env.storage.getSnapshot(options.snapshot) :
        await env.storage.getLatestSnapshot();

      if (!snapshot) {
        console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      // Find the function by name or ID (if specified)
      const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);

      let targetFunction = null;
      if (functionRef) {
        targetFunction = functions.find(f => 
          f.id === functionRef || 
          f.name === functionRef ||
          f.name.includes(functionRef)
        );

        if (!targetFunction) {
          console.log(chalk.red(`Function "${functionRef}" not found.`));
          return;
        }
      }

      // Get call edges for the snapshot
      const callEdges = await env.storage.getCallEdgesBySnapshot(snapshot.id);

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
          }
        );

        // Output results
        if (options.json) {
          outputDepShowJSON(targetFunction, dependencies);
        } else {
          outputDepShowFormatted(targetFunction, dependencies, options);
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
}

/**
 * Calculate complexity metrics for a dependency route
 */
function calculateRouteComplexity(
  path: string[],
  functions: Array<{ id: string; name: string }>,
  qualityMetrics?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }>
): RouteComplexityInfo | null {
  if (path.length === 0 || !qualityMetrics) {
    return null;
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
    avgComplexity: totalComplexity / path.length,
    complexityBreakdown,
  };
}

/**
 * Build dependency tree with specified depth and optional complexity analysis
 */
function buildDependencyTree(
  functionId: string,
  edges: CallEdge[],
  functions: Array<{ id: string; name: string }>,
  direction: 'in' | 'out' | 'both',
  maxDepth: number,
  includeExternal: boolean,
  options?: {
    showComplexity?: boolean | undefined;
    rankByLength?: boolean | undefined;
    maxRoutes?: number | undefined;
    qualityMetrics?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }> | undefined;
  }
): DependencyTreeNode {
  const visited = new Set<string>();
  const routes: RouteComplexityInfo[] = [];
  
  function buildTree(currentId: string, depth: number, dir: 'in' | 'out', currentPath: string[] = []): DependencyTreeNode | null {
    if (depth > maxDepth || visited.has(currentId)) {
      return null;
    }
    
    visited.add(currentId);
    const newPath = [...currentPath, currentId];
    
    const currentFunction = functions.find(f => f.id === currentId);
    const result: DependencyTreeNode = {
      id: currentId,
      name: currentFunction?.name || 'unknown',
      depth,
      dependencies: [],
    };
    
    if (dir === 'in' || direction === 'both') {
      // Incoming dependencies (who calls this function)
      const incoming = edges.filter(edge => 
        edge.calleeFunctionId === currentId &&
        (includeExternal || edge.callType !== 'external')
      );
      
      result.dependencies.push(...incoming.map(edge => ({
        direction: 'in' as const,
        edge,
        subtree: buildTree(edge.callerFunctionId || '', depth + 1, 'in', newPath),
      })).filter(dep => dep.subtree));
    }
    
    if (dir === 'out' || direction === 'both') {
      // Outgoing dependencies (what this function calls)
      const outgoing = edges.filter(edge => 
        edge.callerFunctionId === currentId &&
        (includeExternal || edge.callType !== 'external')
      );
      
      result.dependencies.push(...outgoing.map(edge => ({
        direction: 'out' as const,
        edge,
        subtree: buildTree(edge.calleeFunctionId || '', depth + 1, 'out', newPath),
      })).filter(dep => dep.subtree));
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
function outputDepShowFormatted(func: { id: string; name: string; file_path?: string; start_line?: number }, dependencies: DependencyTreeNode, options: DepShowOptions): void {
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
    const nameColor = node.depth === 0 ? chalk.bold.cyan : chalk.green;
    
    console.log(`${prefix}${connector}${nameColor(node.name)} ${chalk.gray(`(${node.id?.substring(0, 8)})`)}`);
    
    if (node.dependencies && node.dependencies.length > 0) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      
      node.dependencies.forEach((dep, index: number) => {
        const isLastDep = index === node.dependencies.length - 1;
        const arrow = dep.direction === 'in' ? '→' : '←';
        const typeColor = getCallTypeColor(dep.edge.callType);
        
        console.log(`${newPrefix}${isLastDep ? '└── ' : '├── '}${arrow} ${typeColor(dep.edge.callType)} ${chalk.gray(`(line ${dep.edge.lineNumber})`)}`);
        
        if (dep.subtree) {
          printTree(dep.subtree, newPrefix + (isLastDep ? '    ' : '│   '), true);
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
      // Get the latest snapshot
      const snapshot = options.snapshot ? 
        await env.storage.getSnapshot(options.snapshot) :
        await env.storage.getLatestSnapshot();

      if (!snapshot) {
        spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      spinner.text = 'Loading functions and call graph...';

      // Get all functions and call edges
      const [functions, callEdges] = await Promise.all([
        env.storage.getFunctionsBySnapshot(snapshot.id),
        env.storage.getCallEdgesBySnapshot(snapshot.id),
      ]);

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

      // Get the latest snapshot
      const snapshot = options.snapshot ? 
        await env.storage.getSnapshot(options.snapshot) :
        await env.storage.getLatestSnapshot();

      if (!snapshot) {
        spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      spinner.text = 'Loading functions and call graph...';

      // Get all functions and call edges
      const [functions, callEdges] = await Promise.all([
        env.storage.getFunctionsBySnapshot(snapshot.id),
        env.storage.getCallEdgesBySnapshot(snapshot.id),
      ]);

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