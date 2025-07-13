import { ListCommandOptions, FunctionInfo } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';

/**
 * List command as a Reader function
 */
export const listCommand: VoidCommand<ListCommandOptions> = (options) => async (env) => {
  const errorHandler = createErrorHandler(env.commandLogger);

  try {
    const result = await queryAndFilterFunctions(options)(env);
    await outputResults(options)(result)(env);
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
        `Failed to list functions: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  }
};

/**
 * Query and filter functions - pure Reader function
 */
const queryAndFilterFunctions = (options: ListCommandOptions) => async (env: CommandEnvironment): Promise<FunctionInfo[]> => {
  // Query functions from storage
  let functions = await env.storage.queryFunctions({
    sort: 'file_path,start_line',
  });

  if (functions.length === 0) {
    return [];
  }

  // Apply filters
  functions = applyFilters(functions, options);
  
  // Apply limit
  const limit = typeof options.limit === 'string' ? parseInt(options.limit) : options.limit;
  return functions.slice(0, limit);
};

/**
 * Output results - Reader function with side effects
 */
const outputResults = (options: ListCommandOptions) => 
  (functions: FunctionInfo[]) => 
    async (env: CommandEnvironment): Promise<void> => {
      if (functions.length === 0) {
        console.log('No functions found. Run `funcqc scan` first.');
        return;
      }

      if (options.json) {
        outputJSON(functions);
      } else {
        outputFormatted(functions, options, env);
      }
    };

/**
 * Pure function to apply filters
 */
function applyFilters(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  let filtered = functions;

  // Apply complexity filter
  if (options.ccGe !== undefined) {
    const threshold = typeof options.ccGe === 'string' ? parseInt(options.ccGe) : options.ccGe;
    filtered = filtered.filter(f => 
      f.metrics?.cyclomaticComplexity !== undefined && 
      f.metrics.cyclomaticComplexity >= threshold
    );
  }

  // Apply file filter
  if (options.file) {
    const pattern = new RegExp(options.file, 'i');
    filtered = filtered.filter(f => pattern.test(f.filePath));
  }

  // Apply name filter
  if (options.name) {
    const pattern = new RegExp(options.name, 'i');
    filtered = filtered.filter(f => pattern.test(f.name));
  }

  // Apply sorting
  if (options.sort) {
    filtered = applySorting(filtered, options);
  }

  return filtered;
}

/**
 * Pure function to apply sorting
 */
function applySorting(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  const sortField = options.sort;
  const isDesc = options.desc;

  const sorted = [...functions].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortField) {
      case 'cc':
        aValue = a.metrics?.cyclomaticComplexity || 0;
        bValue = b.metrics?.cyclomaticComplexity || 0;
        break;
      case 'loc':
        aValue = a.metrics?.linesOfCode || 0;
        bValue = b.metrics?.linesOfCode || 0;
        break;
      case 'name':
        aValue = a.name;
        bValue = b.name;
        break;
      case 'file':
        aValue = a.filePath;
        bValue = b.filePath;
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return isDesc ? 1 : -1;
    if (aValue > bValue) return isDesc ? -1 : 1;
    return 0;
  });

  return sorted;
}

/**
 * Pure function for JSON output
 */
function outputJSON(functions: FunctionInfo[]): void {
  const output = {
    meta: {
      total: functions.length,
      timestamp: new Date().toISOString(),
    },
    functions: functions.map(f => ({
      id: f.id,
      name: f.name,
      file: f.filePath,
      line: f.startLine,
      metrics: f.metrics ? {
        cyclomaticComplexity: f.metrics.cyclomaticComplexity,
        linesOfCode: f.metrics.linesOfCode,
        // Include other relevant metrics
      } : undefined,
    })),
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Function for formatted output (uses environment for logging)
 */
function outputFormatted(
  functions: FunctionInfo[], 
  _options: ListCommandOptions,
  _env: CommandEnvironment
): void {
  // Display header
  console.log(`Found ${functions.length} functions`);
  
  // Create table
  const headers = ['ID', 'Name', 'CC', 'LOC', 'File', 'Location'];
  console.log(headers.join('\t'));
  console.log('-'.repeat(80));
  
  functions.forEach(f => {
    const id = f.id.substring(0, 8);
    const name = f.name.length > 30 ? f.name.substring(0, 27) + '...' : f.name;
    const cc = f.metrics?.cyclomaticComplexity?.toString() || '-';
    const loc = f.metrics?.linesOfCode?.toString() || '-';
    const file = f.filePath.length > 40 ? '...' + f.filePath.substring(f.filePath.length - 37) : f.filePath;
    const location = `${f.startLine}`;
    
    console.log([id, name, cc, loc, file, location].join('\t'));
  });
}