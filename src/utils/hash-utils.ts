/**
 * Hash utility functions for consistent hashing across the codebase
 */

import * as crypto from 'crypto';
import * as fs from 'fs';

/**
 * Generate a simple hash from string
 * Uses a fast non-cryptographic hash algorithm suitable for deduplication
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate SHA256 hash from string content
 * More secure hash for file integrity validation
 */
export function sha256Hash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Calculate SHA256 hash of a file
 * Used for file integrity validation
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return sha256Hash(content);
  } catch (error) {
    throw new Error(`Failed to calculate hash for ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Get file modification time
 * Used for freshness validation
 */
export async function getFileModificationTime(filePath: string): Promise<number> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.mtime.getTime();
  } catch (error) {
    throw new Error(`Failed to get modification time for ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
}