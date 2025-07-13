import chalk from 'chalk';
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
      let functions = await env.storage.queryFunctions({
        sort: 'file_path,start_line',
      });

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
  filteredCount: number,
  totalCount: number,
  _options: ListCommandOptions
): void {
  if (functions.length === 0) {
    console.log('No functions match the criteria.');
    return;
  }

  // Header
  console.log(chalk.blue(`\nFunctions List (${functions.length} of ${filteredCount} filtered, ${totalCount} total):`));
  console.log('─'.repeat(80));

  // Table header
  const headers = ['Name', 'File', 'Lines', 'CC', 'Params'];
  const colWidths = [30, 35, 7, 5, 8];

  console.log(
    headers.map((h, i) => chalk.bold(h.padEnd(colWidths[i]))).join(' ')
  );
  console.log('─'.repeat(80));

  // Table rows
  functions.forEach(func => {
    const name = truncate(func.displayName, colWidths[0]);
    const file = truncate(`${func.filePath}:${func.startLine}`, colWidths[1]);
    const lines = (func.metrics?.linesOfCode || 0).toString().padEnd(colWidths[2]);
    const cc = (func.metrics?.cyclomaticComplexity || 0).toString().padEnd(colWidths[3]);
    const params = (func.metrics?.parameterCount || 0).toString().padEnd(colWidths[4]);

    // Color code based on complexity
    let ccColor = chalk.green;
    if (func.metrics?.cyclomaticComplexity) {
      if (func.metrics.cyclomaticComplexity >= 10) ccColor = chalk.red;
      else if (func.metrics.cyclomaticComplexity >= 5) ccColor = chalk.yellow;
    }

    console.log(
      `${name.padEnd(colWidths[0])} ${file.padEnd(colWidths[1])} ${lines} ${ccColor(cc)} ${params}`
    );
  });

  // Footer
  if (filteredCount < totalCount) {
    console.log('─'.repeat(80));
    console.log(chalk.gray(`Filtered ${totalCount - filteredCount} functions`));
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}