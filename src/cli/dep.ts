import { OptionValues } from 'commander';
import chalk from 'chalk';
import { VoidCommand } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { DatabaseError } from '../storage/pglite-adapter';
import { CallEdge } from '../types';

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

      // Apply filters
      let filteredEdges = applyDepFilters(callEdges, options);

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
function applyDepFilters(edges: CallEdge[], options: DepListOptions): CallEdge[] {
  let filtered = edges;

  if (options.caller) {
    const pattern = new RegExp(options.caller.replace(/\*/g, '.*'), 'i');
    filtered = filtered.filter(edge => {
      // Note: We would need to look up the function name from the ID
      // For now, filter by callee name which is already available
      return pattern.test(edge.calleeName || '');
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
        // Would need to look up file paths
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