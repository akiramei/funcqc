import { FunctionInfo } from '../../types';

/**
 * Filter functions based on minimum lines of code requirement
 * 
 * @param functions - Array of functions to filter
 * @param config - Configuration object with minLines threshold
 * @returns Filtered array of functions that meet the criteria
 */
export function filterValidFunctions(
  functions: FunctionInfo[],
  config: { minLines: number }
): FunctionInfo[] {
  // Skip filtering if minLines is 0 or negative (i.e., DB filtering was already applied)
  if (config.minLines <= 0) {
    return functions;
  }
  
  return functions.filter(func => {
    // If no metrics available, include the function (conservative approach)
    if (!func.metrics) return true;
    
    // If metrics exist but linesOfCode is undefined, include the function
    if (func.metrics.linesOfCode === undefined) return true;
    
    // Otherwise, apply the filter
    return func.metrics.linesOfCode >= config.minLines;
  });
}