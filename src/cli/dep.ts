import { OptionValues } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { DatabaseError } from '../storage/pglite-adapter';
import { CallEdge } from '../types';
import { DependencyMetricsCalculator, DependencyMetrics, DependencyStats } from '../analyzers/dependency-metrics';
import { ReachabilityAnalyzer } from '../analyzers/reachability-analyzer';
import { EntryPointDetector } from '../analyzers/entry-point-detector';

interface DepListOptions extends OptionValues {
  caller?: string;
  callee?: string;
  file?: string;
  type?: 'direct' | 'async' | 'conditional' | 'external';
  limit?: string;
  sort?: 'caller' | 'callee' | 'file' | 'line';
  desc?: boolean;
  json?: boolean;
  snapshot?: string;
}

interface DepShowOptions extends OptionValues {
  direction?: 'in' | 'out' | 'both';
  depth?: string;
  includeExternal?: boolean;
  json?: boolean;
  snapshot?: string;
}

interface DepStatsOptions extends OptionValues {
  sort?: 'fanin' | 'fanout' | 'depth' | 'name';
  limit?: string;
  showHubs?: boolean;
  showUtility?: boolean;
  showIsolated?: boolean;
  json?: boolean;
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

      // Get call edges for the snapshot
      const callEdges = await env.storage.getCallEdgesBySnapshot(snapshot.id);

      if (callEdges.length === 0) {
        console.log(chalk.yellow('No call graph data found. The call graph analyzer may need to be run.'));
        return;
      }

      // Get function map for filtering
      const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);
      const functionMap = new Map(functions.map(f => [f.id, { id: f.id, name: f.name }]));

      // Apply filters
      let filteredEdges = applyDepFilters(callEdges, options, functionMap);

      // Apply sorting
      filteredEdges = applyDepSorting(filteredEdges, options);

      // Apply limit
      const limit = options.limit ? parseInt(options.limit) : 20;
      const limitedEdges = filteredEdges.slice(0, limit);

      // Output results
      if (options.json) {
        outputDepJSON(limitedEdges, filteredEdges.length, callEdges.length);
      } else {
        outputDepFormatted(limitedEdges, filteredEdges.length, callEdges.length, options);
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
export const depShowCommand = (functionRef: string): VoidCommand<DepShowOptions> => 
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

      // Find the function by name or ID
      const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);

      const targetFunction = functions.find(f => 
        f.id === functionRef || 
        f.name === functionRef ||
        f.name.includes(functionRef)
      );

      if (!targetFunction) {
        console.log(chalk.red(`Function "${functionRef}" not found.`));
        return;
      }

      // Get call edges for the snapshot
      const callEdges = await env.storage.getCallEdgesBySnapshot(snapshot.id);

      // Dependencies will be built by buildDependencyTree function

      // Apply depth filtering if needed
      const maxDepth = options.depth ? parseInt(options.depth) : 2;
      const dependencies = buildDependencyTree(
        targetFunction.id,
        callEdges,
        functions,
        options.direction || 'both',
        maxDepth,
        options.includeExternal || false
      );

      // Output results
      if (options.json) {
        outputDepShowJSON(targetFunction, dependencies);
      } else {
        outputDepShowFormatted(targetFunction, dependencies, options);
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
    const caller = edge.callerFunctionId ? edge.callerFunctionId.substring(0, 8) : 'unknown';
    const callee = edge.calleeName || 'unknown';
    const type = edge.callType || 'unknown';
    const line = edge.lineNumber?.toString() || '-';
    const context = edge.callContext || 'normal';

    const typeColor = getCallTypeColor(type);
    
    console.log([
      chalk.cyan(caller),
      chalk.green(callee),
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
}

/**
 * Build dependency tree with specified depth
 */
function buildDependencyTree(
  functionId: string,
  edges: CallEdge[],
  functions: Array<{ id: string; name: string }>,
  direction: 'in' | 'out' | 'both',
  maxDepth: number,
  includeExternal: boolean
): DependencyTreeNode {
  const visited = new Set<string>();
  
  function buildTree(currentId: string, depth: number, dir: 'in' | 'out'): DependencyTreeNode | null {
    if (depth > maxDepth || visited.has(currentId)) {
      return null;
    }
    
    visited.add(currentId);
    
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
        subtree: buildTree(edge.callerFunctionId || '', depth + 1, 'in'),
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
        subtree: buildTree(edge.calleeFunctionId || '', depth + 1, 'out'),
      })).filter(dep => dep.subtree));
    }
    
    return result;
  }
  
  return buildTree(functionId, 0, direction === 'both' ? 'out' : direction) || {
    id: functionId,
    name: 'unknown',
    depth: 0,
    dependencies: [],
  };
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
function outputDepShowFormatted(func: { id: string; name: string; file_path?: string; start_line?: number }, dependencies: DependencyTreeNode, _options: DepShowOptions): void {
  console.log(chalk.bold(`\nDependency Analysis for: ${chalk.cyan(func.name)}`));
  console.log(chalk.gray(`ID: ${func.id}`));
  console.log(chalk.gray(`File: ${func.file_path}:${func.start_line}`));
  console.log();

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

      const stats = metricsCalculator.generateStats(metrics);

      spinner.succeed('Dependency metrics calculated');

      // Output results
      if (options.json) {
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
  const limit = options.limit ? parseInt(options.limit) : 20;
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
  const limit = options.limit ? parseInt(options.limit) : 20;
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