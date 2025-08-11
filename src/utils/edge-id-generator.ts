/**
 * Centralized edge ID generation utility
 * 
 * Provides deterministic, collision-resistant edge IDs based on caller->callee relationships.
 * Uses SHA256 with 20 hex characters (80 bits) for virtually zero collision probability.
 */

import * as crypto from 'crypto';

/**
 * Generate stable edge ID based on caller->callee relationship
 * 
 * @param callerFunctionId - ID of the calling function
 * @param calleeFunctionId - ID of the called function
 * @param snapshotId - ID of the snapshot (optional for backward compatibility)
 * @returns Deterministic edge ID (20 hex characters)
 */
export function generateStableEdgeId(callerFunctionId: string, calleeFunctionId: string, snapshotId?: string): string {
  // Include snapshotId in the key to ensure uniqueness across snapshots
  const edgeKey = snapshotId 
    ? `${snapshotId}:${callerFunctionId}->${calleeFunctionId}`
    : `${callerFunctionId}->${calleeFunctionId}`;
  const hash = crypto.createHash('sha256').update(edgeKey).digest('hex');
  return `edge_${hash.substring(0, 20)}`;
}

/**
 * Generate call-site specific edge ID (for future use if needed)
 * 
 * @param callerFunctionId - ID of the calling function
 * @param calleeFunctionId - ID of the called function
 * @param lineNumber - Line number of the call site
 * @param columnNumber - Column number of the call site
 * @param snapshotId - ID of the snapshot (optional for backward compatibility)
 * @returns Deterministic edge ID including call site information
 */
export function generateCallSiteEdgeId(
  callerFunctionId: string, 
  calleeFunctionId: string, 
  lineNumber: number, 
  columnNumber: number,
  snapshotId?: string
): string {
  // Include snapshotId in the key to ensure uniqueness across snapshots
  const edgeKey = snapshotId
    ? `${snapshotId}:${callerFunctionId}:${lineNumber}:${columnNumber}->${calleeFunctionId}`
    : `${callerFunctionId}:${lineNumber}:${columnNumber}->${calleeFunctionId}`;
  const hash = crypto.createHash('sha256').update(edgeKey).digest('hex');
  return `edge_${hash.substring(0, 20)}`;
}

/**
 * Validate edge ID format
 * 
 * @param edgeId - Edge ID to validate
 * @returns True if the ID matches the expected format
 */
export function isValidEdgeId(edgeId: string): boolean {
  return /^edge_[a-f0-9]{20}$/.test(edgeId);
}