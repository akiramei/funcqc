import { ListCommandOptions, FunctionInfo } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';

export async function listCommand(
  options: ListCommandOptions
): Promise<void> {
  try {
    const configManager = new ConfigManager();
    // Use lightweight config loading for read-only operations
    const config = configManager.loadLightweight();
    
    const storage = new PGLiteStorageAdapter(config.storage.path);
    await storage.init();
    
    try {
      let functions = await storage.queryFunctions({
        sort: 'file_path,start_line'
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
    } finally {
      await storage.close();
    }
    
  } catch (error) {
    console.error('Failed to list functions:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function outputJSON(functions: FunctionInfo[]): void {
  const output = {
    meta: {
      total: functions.length,
      timestamp: new Date().toISOString()
    },
    functions: functions.map(func => ({
      id: func.id,
      name: func.name,
      file: func.filePath,
      signature: func.signature,
      startLine: func.startLine,
      endLine: func.endLine,
      isExported: func.isExported,
      isAsync: func.isAsync,
      metrics: func.metrics
    }))
  };
  
  console.log(JSON.stringify(output, null, 2));
}

function applyFilters(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  let filtered = functions;
  
  // Filter by complexity
  if (options.ccGe) {
    const threshold = parseInt(options.ccGe);
    if (!isNaN(threshold)) {
      filtered = filtered.filter(f => (f.metrics?.cyclomaticComplexity || 0) >= threshold);
    }
  }
  
  // Filter by file path
  if (options.file) {
    const pattern = options.file.toLowerCase();
    filtered = filtered.filter(f => f.filePath.toLowerCase().includes(pattern));
  }
  
  // Filter by function name
  if (options.name) {
    const pattern = options.name.toLowerCase();
    filtered = filtered.filter(f => f.name.toLowerCase().includes(pattern));
  }
  
  return filtered;
}

function applySorting(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  if (!options.sort) {
    return functions;
  }
  
  // Parse sort fields
  const sortFields = options.sort.split(',').map(s => s.trim());
  
  return [...functions].sort((a, b) => {
    for (const field of sortFields) {
      let compareResult = 0;
      
      switch (field) {
        case 'cc':
          compareResult = (a.metrics?.cyclomaticComplexity || 0) - (b.metrics?.cyclomaticComplexity || 0);
          break;
        case 'loc':
          compareResult = (a.metrics?.linesOfCode || 0) - (b.metrics?.linesOfCode || 0);
          break;
        case 'name':
          compareResult = a.name.localeCompare(b.name);
          break;
        case 'file':
          compareResult = a.filePath.localeCompare(b.filePath);
          break;
        default:
          console.warn(`Unknown sort field: ${field}`);
      }
      
      if (compareResult !== 0) {
        return options.desc ? -compareResult : compareResult;
      }
    }
    return 0;
  });
}

function applyLimit(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  if (!options.limit) {
    return functions;
  }
  
  const limit = parseInt(options.limit);
  if (isNaN(limit) || limit <= 0) {
    return functions;
  }
  
  return functions.slice(0, limit);
}

function outputFormatted(
  functions: FunctionInfo[], 
  filteredCount: number, 
  originalCount: number, 
  options: ListCommandOptions
): void {
  console.log('ID       Name                            CC LOC File                                     Location');
  console.log('-------- ------------------------------- -- --- ---------------------------------------- --------');
  
  for (const func of functions) {
    const id = func.id.substring(0, 8);
    const name = func.name.length > 31 ? func.name.substring(0, 28) + '...' : func.name;
    const complexity = String(func.metrics?.cyclomaticComplexity || 1);
    const loc = String(func.metrics?.linesOfCode || 0);
    const filePath = func.filePath.length > 40 ? '...' + func.filePath.substring(func.filePath.length - 37) : func.filePath;
    const location = `${func.startLine}-${func.endLine}`;
    
    console.log(`${id.padEnd(8)} ${name.padEnd(31)} ${complexity.padStart(2)} ${loc.padStart(3)} ${filePath.padEnd(40)} ${location}`);
  }
  
  // Display summary information
  console.log('');
  if (filteredCount < originalCount) {
    console.log(`Showing ${functions.length} of ${filteredCount} filtered functions (${originalCount} total)`);
  } else if (options.limit && functions.length < filteredCount) {
    console.log(`Showing ${functions.length} of ${filteredCount} functions`);
  } else {
    console.log(`Total: ${functions.length} functions`);
  }
}