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

interface DepListOptions extends BaseCommandOptions {
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

interface DepShowOptions extends BaseCommandOptions {
  direction?: 'in' | 'out' | 'both';
  depth?: string;
  includeExternal?: boolean;
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
      let maxDepth = 2;
      if (options.depth) {
        const parsed = parseInt(options.depth, 10);
        if (isNaN(parsed) || parsed < 1) {
          console.log(chalk.red(`Invalid depth: ${options.depth}`));
          return;
        }
        maxDepth = parsed;
      }
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
      const archConfig = await configManager.load(options.config);

      if (Object.keys(archConfig.layers).length === 0) {
        spinner.fail(chalk.yellow('No architecture layers defined. Create a .funcqc-arch.yaml configuration file.'));
        console.log(chalk.dim('\nTo create a sample configuration file, run:'));
        console.log(chalk.cyan('  funcqc dep lint --init'));
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