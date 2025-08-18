import { ListCommandOptions, FunctionInfo, QueryOptions } from '../../types';
import { ErrorCode, createErrorHandler, isDatabaseErrorLike, type DatabaseErrorLike } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';

/**
 * List command as a Reader function
 * Uses shared storage from environment
 */
export const listCommand: VoidCommand<ListCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    // 非推奨警告
    console.warn('\x1b[33m⚠️  DEPRECATED: The "list" command is deprecated and will be removed in a future version.\x1b[0m');
    console.warn('\x1b[36m💡 Use "funcqc inspect" instead for enhanced functionality.\x1b[0m');
    console.warn('\x1b[90m   Example: funcqc inspect (same options work)\x1b[0m');
    console.warn('');

    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const needsChangeCount = needsChangeCountData(options);
      
      const queryOptions: QueryOptions = {
        sort: 'file_path,start_line'
      };
      
      if (options.scope) {
        queryOptions.scope = options.scope;
      }
      
      // Add dummy filter to trigger change count inclusion if needed
      if (needsChangeCount) {
        queryOptions.filters = [{ field: 'changes', operator: '>=', value: 0 }];
      }
      
      let functions = await env.storage.findFunctions(queryOptions);

      if (functions.length === 0) {
        console.log('No functions found. Run `funcqc scan` first.');
        return;
      }

      // Apply filters
      functions = applyFilters(functions, options);

      // Apply sorting
      functions = applySorting(functions, options);

      // Apply limit
      const limitedFunctions = applyLimit(functions, options);

      // Output results
      if (options.json) {
        outputJSON(limitedFunctions);
      } else {
        outputFormatted(limitedFunctions);
      }
    } catch (error) {
      if (isDatabaseErrorLike(error)) {
        const dbErr = error as DatabaseErrorLike;
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `List command failed: ${dbErr.message}`,
          { dbCode: dbErr.code, op: 'list.query' },
          dbErr.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `List command failed: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

function needsChangeCountData(options: ListCommandOptions): boolean {
  // Check if change count filtering or sorting is needed
  return !!(
    options.changesGe || 
    (options.sort && options.sort.includes('changes'))
  );
}

function applyFilters(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  let filtered = functions;

  // Filter by complexity
  if (options.ccGe) {
    const threshold = parseInt(options.ccGe, 10);
    if (!isNaN(threshold)) {
      filtered = filtered.filter(f => f.metrics && f.metrics.cyclomaticComplexity >= threshold);
    }
  }

  // Filter by change count
  if (options.changesGe) {
    const threshold = parseInt(options.changesGe, 10);
    if (!isNaN(threshold)) {
      filtered = filtered.filter(f => f.changeCount !== undefined && f.changeCount >= threshold);
    }
  }

  // Filter by file pattern
  if (options.file) {
    const pattern = new RegExp(options.file.replace(/\*/g, '.*'), 'i');
    filtered = filtered.filter(f => pattern.test(f.filePath));
  }

  // Filter by function name pattern
  if (options.name) {
    const pattern = new RegExp(options.name.replace(/\*/g, '.*'), 'i');
    filtered = filtered.filter(f => pattern.test(f.displayName));
  }

  return filtered;
}

function applySorting(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  if (!options.sort) {
    return functions;
  }

  const sortField = options.sort.toLowerCase();
  const sortFn = getSortFunction(sortField);

  if (!sortFn) {
    console.warn(`Unknown sort field: ${options.sort}. Using default sort.`);
    return functions;
  }

  const sorted = [...functions].sort(sortFn);
  return options.desc ? sorted.reverse() : sorted;
}

function getSortFunction(field: string): ((a: FunctionInfo, b: FunctionInfo) => number) | null {
  const sortHandlers = createSortHandlers();
  return sortHandlers[field] || null;
}

function createSortHandlers(): Record<string, (a: FunctionInfo, b: FunctionInfo) => number> {
  return {
    'cc': sortByComplexity,
    'complexity': sortByComplexity,
    'loc': sortByLinesOfCode,
    'lines': sortByLinesOfCode,
    'changes': sortByChangeCount,
    'name': sortByName,
    'file': sortByFile,
  };
}

function sortByComplexity(a: FunctionInfo, b: FunctionInfo): number {
  return (a.metrics?.cyclomaticComplexity || 0) - (b.metrics?.cyclomaticComplexity || 0);
}

function sortByLinesOfCode(a: FunctionInfo, b: FunctionInfo): number {
  return (a.metrics?.linesOfCode || 0) - (b.metrics?.linesOfCode || 0);
}

function sortByChangeCount(a: FunctionInfo, b: FunctionInfo): number {
  return (a.changeCount || 0) - (b.changeCount || 0);
}

function sortByName(a: FunctionInfo, b: FunctionInfo): number {
  return a.displayName.localeCompare(b.displayName);
}

function sortByFile(a: FunctionInfo, b: FunctionInfo): number {
  return a.filePath.localeCompare(b.filePath);
}

function applyLimit(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  if (!options.limit) {
    return functions;
  }

  const limit = parseInt(options.limit, 10);
  if (isNaN(limit) || limit <= 0) {
    return functions;
  }

  return functions.slice(0, limit);
}

function outputJSON(functions: FunctionInfo[]): void {
  console.log(JSON.stringify({ functions }, null, 2));
}

function outputFormatted(
  functions: FunctionInfo[]
): void {
  if (functions.length === 0) {
    console.log('No functions match the criteria.');
    return;
  }

  // Check if any function has change count data
  const hasChangeCounts = functions.some(f => f.changeCount !== undefined);

  if (hasChangeCounts) {
    // Table format with CHG column
    console.log('ID       Name                            CC LOC CHG File                                 Line');
    console.log('-------- ------------------------------- -- --- --- ------------------------------------ ----');

    functions.forEach(func => {
      const id = func.id.substring(0, 8);
      const name = truncateString(func.displayName, 31).padEnd(31);
      const cc = (func.metrics?.cyclomaticComplexity?.toString() || '-').padStart(2);
      const loc = (func.metrics?.linesOfCode?.toString() || '-').padStart(3);
      const chg = (func.changeCount?.toString() || '-').padStart(3);
      const file = truncateString(func.filePath, 36).padEnd(36);
      const line = func.startLine.toString().padStart(4);
      
      console.log(`${id} ${name} ${cc} ${loc} ${chg} ${file} ${line}`);
    });
  } else {
    // Original table format without CHG column
    console.log('ID       Name                            CC LOC File                                     Line');
    console.log('-------- ------------------------------- -- --- ---------------------------------------- ----');

    functions.forEach(func => {
      const id = func.id.substring(0, 8);
      const name = truncateString(func.displayName, 31).padEnd(31);
      const cc = (func.metrics?.cyclomaticComplexity?.toString() || '-').padStart(2);
      const loc = (func.metrics?.linesOfCode?.toString() || '-').padStart(3);
      const file = truncateString(func.filePath, 40).padEnd(40);
      const line = func.startLine.toString().padStart(4);
      
      console.log(`${id} ${name} ${cc} ${loc} ${file} ${line}`);
    });
  }
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

