import { ListCommandOptions, FunctionInfo } from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';

/**
 * List command as a Reader function
 * Uses shared storage from environment
 */
export const listCommand: VoidCommand<ListCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const queryOptions: { sort: string; scope?: string } = {
        sort: 'file_path,start_line'
      };
      
      if (options.scope) {
        queryOptions.scope = options.scope;
      }
      
      let functions = await env.storage.queryFunctions(queryOptions);

      if (functions.length === 0) {
        console.log('No functions found. Run `funcqc scan` first.');
        return;
      }

      // Apply filters
      const originalCount = functions.length;
      functions = applyFilters(functions, options);

      // Apply sorting
      functions = applySorting(functions, options);

      // Apply limit
      const limitedFunctions = applyLimit(functions, options);

      // Output results
      if (options.json) {
        outputJSON(limitedFunctions);
      } else {
        outputFormatted(limitedFunctions, functions.length, originalCount, options);
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

function applyFilters(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  let filtered = functions;

  // Filter by complexity
  if (options.ccGe) {
    const threshold = parseInt(options.ccGe, 10);
    if (!isNaN(threshold)) {
      filtered = filtered.filter(f => f.metrics && f.metrics.cyclomaticComplexity >= threshold);
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
  switch (field) {
    case 'cc':
    case 'complexity':
      return (a, b) => (a.metrics?.cyclomaticComplexity || 0) - (b.metrics?.cyclomaticComplexity || 0);
    case 'loc':
    case 'lines':
      return (a, b) => (a.metrics?.linesOfCode || 0) - (b.metrics?.linesOfCode || 0);
    case 'name':
      return (a, b) => a.displayName.localeCompare(b.displayName);
    case 'file':
      return (a, b) => a.filePath.localeCompare(b.filePath);
    default:
      return null;
  }
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
  functions: FunctionInfo[],
  _filteredCount: number,
  _totalCount: number,
  _options: ListCommandOptions
): void {
  if (functions.length === 0) {
    console.log('No functions match the criteria.');
    return;
  }

  // Table format with headers including ID column
  console.log('ID       Name                            CC LOC File                                     Location');
  console.log('-------- ------------------------------- -- --- ---------------------------------------- --------');

  functions.forEach(func => {
    const id = func.id.substring(0, 8);
    const name = truncateString(func.displayName, 31).padEnd(31);
    const cc = (func.metrics?.cyclomaticComplexity?.toString() || '-').padStart(2);
    const loc = (func.metrics?.linesOfCode?.toString() || '-').padStart(3);
    const file = truncateString(func.filePath, 40).padEnd(40);
    const location = `${func.startLine}-${func.endLine}`;
    
    console.log(`${id} ${name} ${cc} ${loc} ${file} ${location}`);
  });
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

