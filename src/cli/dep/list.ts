import chalk from 'chalk';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode, type DatabaseErrorLike } from '../../utils/error-handler';
import { CallEdge, FunctionInfo, ScopeConfig } from '../../types';
import { loadComprehensiveCallGraphData, validateCallGraphRequirements } from '../../utils/lazy-analysis';
import { DepListOptions } from './types';
import { isPathInScope } from '../../utils/scope-utils';
import { ConfigManager } from '../../core/config';

/**
 * Check if a file path is in the specified scope
 */
// Cache scope configs to avoid repeated I/O per edge
const scopeCache = new Map<string, ScopeConfig>();

async function isInScope(filePath: string, scopeName: string): Promise<boolean> {
  try {
    let scopeConfig = scopeCache.get(scopeName);
    if (!scopeConfig) {
      const configManager = new ConfigManager();
      await configManager.load();
      scopeConfig = configManager.resolveScopeConfig(scopeName);
      scopeCache.set(scopeName, scopeConfig);
    }
    return isPathInScope(filePath, scopeConfig);
  } catch (error) {
    // If scope resolution fails, default to include the function
    console.warn(
      `Warning: Failed to resolve scope '${scopeName}': ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return true;
  }
}

/**
 * List function dependencies
 */
export const depListCommand: VoidCommand<DepListOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      // Use comprehensive call graph data including internal call edges
      const { allEdges, functions } = await loadComprehensiveCallGraphData(env, {
        showProgress: true,
        snapshotId: options.snapshot
      });

      // Validate that we have sufficient call graph data
      validateCallGraphRequirements(allEdges, 'dep list');

      if (allEdges.length === 0) {
        console.log(chalk.yellow('No call graph data found. The call graph analyzer may need to be run.'));
        return;
      }

      // Create function map for filtering (need full objects for filePath access)
      const functionMap = new Map(functions.map(f => [f.id, f]));

      // Apply filters
      let filteredEdges = await applyDepFilters(allEdges, options, functionMap);

      // Apply sorting
      filteredEdges = applyDepSorting(filteredEdges, options, functionMap);

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
        outputDepFormatted(limitedEdges, filteredEdges.length, allEdges.length, functions, options);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        const dbErr = error as DatabaseErrorLike;
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          dbErr.message,
          { dbCode: dbErr.code },
          dbErr.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

/**
 * Apply filters to call edges based on options
 */
async function applyDepFilters(
  edges: CallEdge[],
  options: DepListOptions,
  functionMap: Map<string, FunctionInfo>
): Promise<CallEdge[]> {
  let filtered = edges;

  // Apply scope filtering if specified
  if (options.scope) {
    const scopeFilteredEdges: CallEdge[] = [];
    
    for (const edge of filtered) {
      const caller = functionMap.get(edge.callerFunctionId);
      const callee = functionMap.get(edge.calleeFunctionId ?? '');
      
      // Check if caller or callee (if exists) are in the specified scope
      const callerInScope = caller ? await isInScope(caller.filePath, options.scope) : false;
      const calleeInScope = !!(callee && await isInScope(callee.filePath, options.scope));
      
      if (callerInScope || calleeInScope) {
        scopeFilteredEdges.push(edge);
      }
    }
    
    filtered = scopeFilteredEdges;
  }

  if (options.caller) {
    filtered = filtered.filter(edge => {
      const caller = functionMap.get(edge.callerFunctionId);
      return caller?.name.includes(options.caller || '') || edge.callerFunctionId.includes(options.caller || '');
    });
  }

  if (options.callee) {
    filtered = filtered.filter(edge => {
      const callee = functionMap.get(edge.calleeFunctionId || '');
      return callee?.name.includes(options.callee || '') || edge.calleeFunctionId?.includes(options.callee || '');
    });
  }

  if (options.file) {
    filtered = filtered.filter(edge => {
      const caller = functionMap.get(edge.callerFunctionId);
      const callee = functionMap.get(edge.calleeFunctionId || '');
      return caller?.filePath?.includes(options.file || '') ||
             callee?.filePath?.includes(options.file || '');
    });
  }

  if (options.type) {
    filtered = filtered.filter(edge => edge.callType === options.type);
  }

  return filtered;
}

/**
 * Apply sorting to call edges based on options
 */
function applyDepSorting(edges: CallEdge[], options: DepListOptions, functionMap: Map<string, FunctionInfo>): CallEdge[] {
  const sortField = options.sort || 'caller';
  const isDesc = options.desc || false;

  return edges.sort((a, b) => {
    let comparison = 0;

    switch (sortField) {
      case 'caller':
        comparison = a.callerFunctionId.localeCompare(b.callerFunctionId);
        break;
      case 'callee':
        comparison = (a.calleeFunctionId || '').localeCompare(b.calleeFunctionId || '');
        break;
      case 'file': {
        const aFile = functionMap.get(a.callerFunctionId)?.filePath || '';
        const bFile = functionMap.get(b.callerFunctionId)?.filePath || '';
        comparison = aFile.localeCompare(bFile);
        break;
      }
      case 'line':
        comparison = (a.lineNumber || 0) - (b.lineNumber || 0);
        break;
      default:
        comparison = a.callerFunctionId.localeCompare(b.callerFunctionId);
    }

    return isDesc ? -comparison : comparison;
  });
}

/**
 * Prioritize internal call edges for better demo
 */
function prioritizeInternalEdges(edges: CallEdge[]): CallEdge[] {
  return edges.sort((a, b) => {
    const aIsInternal = a.lineNumber !== undefined && a.lineNumber > 0;
    const bIsInternal = b.lineNumber !== undefined && b.lineNumber > 0;
    
    if (aIsInternal && !bIsInternal) return -1;
    if (!aIsInternal && bIsInternal) return 1;
    return 0;
  });
}

/**
 * Output dependency information in JSON format
 */
function outputDepJSON(edges: CallEdge[], filteredCount: number, totalCount: number): void {
  const output = {
    dependencies: edges.map(edge => ({
      caller: edge.callerFunctionId,
      callee: edge.calleeFunctionId,
      type: edge.callType,
      line: edge.lineNumber,
      column: edge.columnNumber
    })),
    metadata: {
      displayed: edges.length,
      filtered: filteredCount,
      total: totalCount
    }
  };
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output dependency information in formatted table
 */
function outputDepFormatted(
  edges: CallEdge[],
  filteredCount: number,
  totalCount: number,
  functions: import('../../types').FunctionInfo[],
  _options: DepListOptions
): void {
  if (edges.length === 0) {
    console.log(chalk.yellow('No dependencies found matching the criteria.'));
    return;
  }

  const functionMap = new Map(functions.map(f => [f.id, f]));

  console.log(chalk.blue('\n📊 Function Dependencies'));
  console.log(chalk.gray(`Showing ${edges.length} of ${filteredCount} filtered (${totalCount} total)\n`));

  const maxCallerWidth = Math.min(30, Math.max(...edges.map(e => {
    const caller = functionMap.get(e.callerFunctionId);
    return caller?.name?.length || e.callerFunctionId.length;
  })));

  const maxCalleeWidth = Math.min(30, Math.max(...edges.map(e => {
    const callee = functionMap.get(e.calleeFunctionId || '');
    return callee?.name?.length || e.calleeName.length;
  })));

  // Header
  console.log(
    chalk.cyan('Caller'.padEnd(maxCallerWidth)) + '  ' +
    chalk.cyan('Callee'.padEnd(maxCalleeWidth)) + '  ' +
    chalk.cyan('Type'.padEnd(8)) + '  ' +
    chalk.cyan('Location')
  );
  console.log('-'.repeat(maxCallerWidth + maxCalleeWidth + 30));

  edges.forEach(edge => {
    const caller = functionMap.get(edge.callerFunctionId);
    const callee = functionMap.get(edge.calleeFunctionId || '');
    
    const callerName = caller?.name || edge.callerFunctionId;
    const calleeName = callee?.name || edge.calleeName;
    
    const truncatedCaller = callerName.length > maxCallerWidth 
      ? callerName.substring(0, maxCallerWidth - 3) + '...'
      : callerName;
    const truncatedCallee = calleeName.length > maxCalleeWidth
      ? calleeName.substring(0, maxCalleeWidth - 3) + '...'
      : calleeName;

    const typeColor = getCallTypeColor(edge.callType);
    const location = edge.lineNumber ? `line ${edge.lineNumber}` : 'unknown';

    console.log(
      chalk.white(truncatedCaller.padEnd(maxCallerWidth)) + '  ' +
      chalk.green(truncatedCallee.padEnd(maxCalleeWidth)) + '  ' +
      typeColor(edge.callType.padEnd(8)) + '  ' +
      chalk.gray(location)
    );
  });

  console.log();
}

/**
 * Get color for call type
 */
function getCallTypeColor(callType: string): (text: string) => string {
  switch (callType) {
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