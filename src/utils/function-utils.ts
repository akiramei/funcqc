import { FunctionInfo } from '../types/index.js';

/**
 * Group functions by their file path for efficient processing
 * 
 * @param functions Array of functions to group
 * @returns Map where keys are file paths and values are arrays of functions in that file
 */
export function groupFunctionsByFile(functions: FunctionInfo[]): Map<string, FunctionInfo[]> {
  const grouped = new Map<string, FunctionInfo[]>();
  
  for (const func of functions) {
    const filePath = func.filePath;
    if (!grouped.has(filePath)) {
      grouped.set(filePath, []);
    }
    grouped.get(filePath)!.push(func);
  }
  
  return grouped;
}

/**
 * Sort functions by start line in reverse order (for safe deletion)
 * 
 * @param functions Array of functions to sort
 * @returns Sorted array with functions from bottom to top of file
 */
export function sortFunctionsForDeletion(functions: FunctionInfo[]): FunctionInfo[] {
}

/**
 * Calculate basic statistics for a group of functions
 * 
 * @param functions Array of functions to analyze
 * @returns Object containing basic statistics
 */
export function calculateFunctionStats(functions: FunctionInfo[]) {
  const fileCount = new Set(functions.map(f => f.filePath)).size;
  const avgLinesOfCode = functions.length > 0 
    : 0;

    totalFunctions: functions.length,
    uniqueFiles: fileCount,
    exportedFunctions: exportedCount,
    averageLinesOfCode: avgLinesOfCode,
  };
}

/**
 * Format function statistics for display
 * 
 * @param stats Statistics object from calculateFunctionStats
 * @returns Formatted string suitable for console output
 */
export function formatFunctionStats(stats: ReturnType<typeof calculateFunctionStats>): string {
  return [
    `Functions: ${stats.totalFunctions}`,
    `Files: ${stats.uniqueFiles}`,
    `Exported: ${stats.exportedFunctions}`,
    `Avg LOC: ${stats.averageLinesOfCode}`,
  ].join(' | ');
}