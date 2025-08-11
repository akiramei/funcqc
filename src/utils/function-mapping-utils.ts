/**
 * Function ID Mapping Utilities
 * 
 * Provides consistent function ID mapping across health and scan commands
 * to ensure proper coupling data storage without foreign key violations.
 */

import { FunctionInfo } from '../types';

/**
 * Generate composite key for function mapping
 * Format: filePath:startLine:functionName
 */
export function generateFunctionCompositeKey(
  filePath: string,
  startLine: number,
  functionName: string
): string {
  return `${filePath}:${startLine}:${functionName}`;
}

/**
 * Create function lookup map from FunctionInfo array
 * Uses composite key to ensure reliable mapping between analyzers
 */
export function createFunctionLookupMap(functions: FunctionInfo[]): Map<string, string> {
  const functionLookupMap = new Map<string, string>();
  
  for (const func of functions) {
    // Use composite key: filePath:startLine:name for reliable mapping
    const compositeKey = generateFunctionCompositeKey(func.filePath, func.startLine, func.name);
    functionLookupMap.set(compositeKey, func.id);
    
    // Also keep the direct ID mapping as fallback
    functionLookupMap.set(func.id, func.id);
  }
  
  return functionLookupMap;
}

/**
 * Generate composite key from function analysis data
 * Used to match OnePassASTVisitor results with FunctionInfo
 */
export function generateCompositeKeyFromAnalysis(
  filePath: string,
  startLine: number,
  functionName: string
): string {
  return generateFunctionCompositeKey(filePath, startLine, functionName);
}