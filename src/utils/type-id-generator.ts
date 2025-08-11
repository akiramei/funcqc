/**
 * Centralized type ID generation utility
 * 
 * Provides deterministic, collision-resistant type IDs based on type definition characteristics.
 * Uses SHA256 with UUID format for consistency with function IDs.
 */

import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Cache for memoizing type ID generation results
 */
const typeIdCache = new Map<string, string>();

/**
 * Generate deterministic UUID for type definitions
 * 
 * @param filePath - Source file path
 * @param typeName - Name of the type
 * @param kind - Kind of type (class, interface, type_alias, enum, namespace)
 * @param startLine - Start line number
 * @param startColumn - Start column number
 * @param snapshotId - ID of the snapshot
 * @returns Deterministic type ID (UUID format)
 */
export function generateDeterministicTypeId(
  filePath: string,
  typeName: string,
  kind: string,
  startLine: number,
  startColumn: number,
  snapshotId: string
): string {
  // Normalize file path for cross-platform consistency
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Create deterministic input string for cache key
  const cacheKey = [
    normalizedPath,
    typeName,
    kind,
    startLine.toString(),
    startColumn.toString(),
    snapshotId
  ].join(':');
  
  // Check cache first
  const cachedResult = typeIdCache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }
  
  // Generate hash and convert to UUID format
  const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
  
  // Convert to UUID format for consistency
  const uuid = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '5' + hash.substring(13, 16), // Version 5 (name-based SHA-1)
    ((parseInt(hash.substring(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.substring(17, 20), // Variant bits
    hash.substring(20, 32)
  ].join('-');
  
  // Store in cache
  typeIdCache.set(cacheKey, uuid);
  
  return uuid;
}

/**
 * Generate random UUID (fallback for non-deterministic cases)
 * @returns Random UUID
 */
export function generateRandomTypeId(): string {
  return uuidv4();
}

/**
 * Validate type ID format
 * 
 * @param typeId - Type ID to validate
 * @returns True if the ID matches the UUID format
 */
export function isValidTypeId(typeId: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(typeId);
}