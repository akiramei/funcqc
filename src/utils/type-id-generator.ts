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
  
  // Generate SHA-256 hash (256 bits), take first 128 bits for UUID
  const hashHex = crypto.createHash('sha256').update(cacheKey).digest('hex');
  const bytes = Buffer.from(hashHex.slice(0, 32), 'hex'); // 16 bytes = 128 bits
  
  // Set RFC 4122 version 5 (name-based) and variant bits for proper UUID format
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // Version 5 (0101xxxx)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant RFC 4122 (10xxxxxx)
  
  const hex = bytes.toString('hex');
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
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