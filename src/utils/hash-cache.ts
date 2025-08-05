/**
 * Hash Cache Utility
 * 
 * Optimizes hash calculations by caching results based on content
 * and modification times to avoid redundant cryptographic operations.
 */

import * as crypto from 'crypto';
import { LRUCache } from './lru-cache';

export interface HashCacheEntry {
  contentHash: string;
  astHash: string;
  signatureHash: string;
  fileHash: string;
  modifiedTime: Date;
  contentLength: number;
}

export interface HashCacheOptions {
  maxEntries?: number;
  enablePersistence?: boolean;
  cacheDir?: string;
}

export class HashCache {
  private cache: LRUCache<HashCacheEntry>;
  private hashCalculationCount: number = 0;
  private cacheHitCount: number = 0;

  constructor(options: HashCacheOptions = {}) {
    this.cache = new LRUCache<HashCacheEntry>({
      maxSize: options.maxEntries || 1000,
      onEvict: (_key: string, _entry: unknown) => {
        // No cleanup needed for hash entries
      }
    });
  }

  /**
   * Get or calculate all hashes for a file content
   */
  getOrCalculateHashes(
    filePath: string,
    content: string,
    modifiedTime?: Date,
    signature?: string
  ): {
    contentHash: string;
    astHash: string;
    signatureHash: string;
    fileHash: string;
  } {
    const cacheKey = this.generateCacheKey(filePath, content.length, modifiedTime);
    const cached = this.cache.get(cacheKey);

    // Check if cached entry is still valid
    if (cached && this.isCacheEntryValid(cached, content, modifiedTime)) {
      this.cacheHitCount++;
      
      // If signature hash is needed and not cached, calculate only that
      let signatureHash = cached.signatureHash;
      if (signature && (!signatureHash || signatureHash === 'unknown')) {
        signatureHash = this.calculateSignatureHash(signature);
      }
      
      return {
        contentHash: cached.contentHash,
        astHash: cached.astHash,
        signatureHash,
        fileHash: cached.fileHash
      };
    }

    // Calculate all hashes
    this.hashCalculationCount++;
    const hashes = this.calculateAllHashes(content, signature);
    
    // Cache the results
    const entry: HashCacheEntry = {
      ...hashes,
      modifiedTime: modifiedTime || new Date(),
      contentLength: content.length
    };
    
    this.cache.set(cacheKey, entry);
    
    return hashes;
  }

  /**
   * Calculate individual content hash with caching
   */
  getOrCalculateContentHash(content: string, modifiedTime?: Date): string {
    // Use a more unique cache key that includes a quick hash of the content
    const quickContentHash = this.calculateQuickHash(content);
    const quickKey = `content:${content.length}:${quickContentHash}:${modifiedTime?.getTime() || 0}`;
    const cached = this.cache.get(quickKey);
    
    if (cached && cached.contentLength === content.length) {
      this.cacheHitCount++;
      return cached.contentHash;
    }
    
    this.hashCalculationCount++;
    const contentHash = this.calculateContentHash(content);
    
    // Cache minimal entry for content-only lookups
    this.cache.set(quickKey, {
      contentHash,
      astHash: 'unknown',
      signatureHash: 'unknown',
      fileHash: 'unknown',
      modifiedTime: modifiedTime || new Date(),
      contentLength: content.length
    });
    
    return contentHash;
  }

  /**
   * Calculate individual AST hash with caching
   */
  getOrCalculateASTHash(content: string): string {
    const normalized = this.normalizeForAST(content);
    const quickKey = `ast:${normalized.length}:${this.calculateQuickHash(normalized)}`;
    const cached = this.cache.get(quickKey);
    
    if (cached && cached.astHash !== 'unknown') {
      this.cacheHitCount++;
      return cached.astHash;
    }
    
    this.hashCalculationCount++;
    const astHash = this.calculateASTHash(content);
    
    // Cache minimal entry for AST-only lookups
    this.cache.set(quickKey, {
      contentHash: 'unknown',
      astHash,
      signatureHash: 'unknown',
      fileHash: 'unknown',
      modifiedTime: new Date(),
      contentLength: content.length
    });
    
    return astHash;
  }

  /**
   * Calculate all hashes in one pass for maximum efficiency
   */
  private calculateAllHashes(
    content: string,
    signature?: string
  ): {
    contentHash: string;
    astHash: string;
    signatureHash: string;
    fileHash: string;
  } {
    // File hash (MD5 for compatibility)
    const fileHash = crypto.createHash('md5').update(content).digest('hex');
    
    // Content hash (SHA256 for security)
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    
    // AST hash (normalized content)
    const astHash = this.calculateASTHash(content);
    
    // Signature hash
    const signatureHash = signature ? this.calculateSignatureHash(signature) : 'unknown';
    
    return {
      contentHash,
      astHash,
      signatureHash,
      fileHash
    };
  }

  private calculateContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private calculateASTHash(content: string): string {
    const normalized = this.normalizeForAST(content);
    // Use 16 characters (64 bits) to reduce collision probability
    // 8 characters (32 bits) was causing collisions between different functions
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  }

  private calculateSignatureHash(signature: string): string {
    return crypto.createHash('sha256').update(signature).digest('hex');
  }

  /**
   * Normalize content for AST comparison
   * Removes whitespace and comments for structural comparison
   * BUT preserves semantic differences in implementation
   */
  private normalizeForAST(content: string): string {
    // First remove comments to focus on actual code structure
    let normalized = content
      .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, '') // Remove multiline comments
      .replace(/\/\/.*$/gm, ''); // Remove single-line comments
    
    // Preserve significant whitespace patterns that indicate structural differences
    // but normalize insignificant whitespace
    normalized = normalized
      .replace(/^\s+/gm, '') // Remove leading whitespace on each line
      .replace(/\s+$/gm, '') // Remove trailing whitespace on each line
      .replace(/\n\s*\n/g, '\n') // Collapse multiple empty lines to single
      .replace(/\s*{\s*/g, '{') // Normalize brace spacing
      .replace(/\s*}\s*/g, '}')
      .replace(/\s*;\s*/g, ';') // Normalize semicolon spacing
      .replace(/\s*,\s*/g, ',') // Normalize comma spacing
      .replace(/\s*\(\s*/g, '(') // Normalize parenthesis spacing
      .replace(/\s*\)\s*/g, ')')
      .replace(/[ \t]+/g, ' ') // Normalize internal whitespace but preserve line breaks
      .trim();
    
    return normalized;
  }

  /**
   * Calculate quick hash for cache key generation
   */
  private calculateQuickHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
  }

  /**
   * Generate cache key for a file
   */
  private generateCacheKey(
    filePath: string,
    contentLength: number,
    modifiedTime?: Date
  ): string {
    const timeKey = modifiedTime ? modifiedTime.getTime().toString() : 'unknown';
    return `${filePath}:${contentLength}:${timeKey}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheEntryValid(entry: HashCacheEntry, content: string, modifiedTime?: Date): boolean {
    // Content length must match
    if (entry.contentLength !== content.length) {
      return false;
    }
    
    // If modification time is available, it must match or be newer
    if (modifiedTime && entry.modifiedTime && modifiedTime > entry.modifiedTime) {
      return false;
    }
    
    return true;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const cacheStats = this.cache.getStats();
    const hitRate = this.cacheHitCount + this.hashCalculationCount > 0 
      ? (this.cacheHitCount / (this.cacheHitCount + this.hashCalculationCount)) * 100 
      : 0;
    
    return {
      ...cacheStats,
      hashCalculationCount: this.hashCalculationCount,
      cacheHitCount: this.cacheHitCount,
      hitRate: Math.round(hitRate * 100) / 100,
      totalRequests: this.cacheHitCount + this.hashCalculationCount
    };
  }

  /**
   * Clear all cached hashes
   */
  clear(): void {
    this.cache.clear();
    this.hashCalculationCount = 0;
    this.cacheHitCount = 0;
  }

  /**
   * Get cache size information
   */
  getSize(): { entries: number; maxEntries: number } {
    const stats = this.cache.getStats();
    return {
      entries: stats.size,
      maxEntries: stats.maxSize
    };
  }
}

// Export singleton instance for global use
export const globalHashCache = new HashCache({
  maxEntries: 2000,
  enablePersistence: false
});