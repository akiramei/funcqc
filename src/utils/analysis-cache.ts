/**
 * Caching utilities for TypeScript analysis results
 */

import { LRUCache } from 'lru-cache';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { FunctionInfo } from '../types';

export interface CacheEntry {
  fileHash: string;
  lastModified: number;
  functions: FunctionInfo[];
  createdAt: number;
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number; // in bytes
  hitRate: number;
  hits: number;
  misses: number;
}

export class AnalysisCache {
  private memoryCache: LRUCache<string, CacheEntry>;
  private persistentCachePath: string;
  private stats = {
    hits: 0,
    misses: 0
  };

  constructor(options: {
    maxMemoryEntries?: number;
    maxMemorySize?: number; // in MB
    persistentCachePath?: string;
  } = {}) {
    // Configure in-memory cache
    this.memoryCache = new LRUCache({
      max: options.maxMemoryEntries || 1000,
      maxSize: (options.maxMemorySize || 100) * 1024 * 1024, // Convert MB to bytes
      sizeCalculation: (entry: CacheEntry) => {
        // Estimate size: JSON stringify the functions and calculate size
        return JSON.stringify(entry.functions).length * 2; // *2 for UTF-16
      },
      ttl: 1000 * 60 * 60 * 24 // 24 hours TTL
    });

    // Setup persistent cache
    this.persistentCachePath = options.persistentCachePath || 
      path.join(process.cwd(), '.funcqc-cache');
    
    // Initialize persistent cache asynchronously
    this.initializePersistentCache().catch(error => {
      console.warn(`Failed to initialize persistent cache: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Get cached analysis result for a file
   */
  async get(filePath: string): Promise<FunctionInfo[] | null> {
    const cacheKey = this.generateCacheKey(filePath);
    
    // Try memory cache first
    const memoryEntry = this.memoryCache.get(cacheKey);
    if (memoryEntry && await this.isValidCacheEntry(filePath, memoryEntry)) {
      this.stats.hits++;
      return memoryEntry.functions;
    }

    // Try persistent cache
    const persistentEntry = await this.loadFromPersistentCache(cacheKey);
    if (persistentEntry && await this.isValidCacheEntry(filePath, persistentEntry)) {
      // Promote to memory cache
      this.memoryCache.set(cacheKey, persistentEntry);
      this.stats.hits++;
      return persistentEntry.functions;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Store analysis result in cache
   */
  async set(filePath: string, functions: FunctionInfo[]): Promise<void> {
    const cacheKey = this.generateCacheKey(filePath);
    const fileStats = await fs.promises.stat(filePath);
    
    const entry: CacheEntry = {
      fileHash: await this.calculateFileHash(filePath),
      lastModified: fileStats.mtimeMs,
      functions,
      createdAt: Date.now()
    };

    // Store in memory cache
    this.memoryCache.set(cacheKey, entry);

    // Store in persistent cache (async, don't wait)
    this.saveToPersistentCache(cacheKey, entry).catch(error => {
      console.warn(`Failed to save to persistent cache: ${error.message}`);
    });
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    await this.clearPersistentCache();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const memorySize = this.memoryCache.calculatedSize || 0;
    const totalRequests = this.stats.hits + this.stats.misses;
    
    return {
      totalEntries: this.memoryCache.size,
      totalSize: memorySize,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      hits: this.stats.hits,
      misses: this.stats.misses
    };
  }

  /**
   * Preload cache entries for a list of files
   */
  async preload(filePaths: string[]): Promise<{ loaded: number; total: number }> {
    let loaded = 0;
    
    await Promise.all(
      filePaths.map(async (filePath) => {
        const cached = await this.get(filePath);
        if (cached) {
          loaded++;
        }
      })
    );

    return { loaded, total: filePaths.length };
  }

  /**
   * Cleanup expired entries
   */
  async cleanup(): Promise<void> {
    // LRUCache handles TTL automatically, but we can prune explicitly
    this.memoryCache.purgeStale();
    await this.cleanupPersistentCache();
  }

  private generateCacheKey(filePath: string): string {
    return crypto.createHash('md5')
      .update(path.resolve(filePath))
      .digest('hex');
  }

  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private async isValidCacheEntry(filePath: string, entry: CacheEntry): Promise<boolean> {
    try {
      const fileStats = await fs.promises.stat(filePath);
      
      // Check if file was modified
      if (fileStats.mtimeMs > entry.lastModified) {
        return false;
      }

      // Check if file content changed (hash comparison)
      const currentHash = await this.calculateFileHash(filePath);
      return currentHash === entry.fileHash;
    } catch {
      // File doesn't exist or can't be read
      return false;
    }
  }

  private async initializePersistentCache(): Promise<void> {
    try {
      try {
        await fs.promises.access(this.persistentCachePath);
      } catch {
        await fs.promises.mkdir(this.persistentCachePath, { recursive: true });
      }
    } catch (error) {
      console.warn(`Failed to initialize persistent cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async loadFromPersistentCache(cacheKey: string): Promise<CacheEntry | null> {
    try {
      const filePath = path.join(this.persistentCachePath, `${cacheKey}.json`);
      try {
        await fs.promises.access(filePath);
      } catch {
        return null;
      }

      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as CacheEntry;
    } catch {
      return null;
    }
  }

  private async saveToPersistentCache(cacheKey: string, entry: CacheEntry): Promise<void> {
    try {
      const filePath = path.join(this.persistentCachePath, `${cacheKey}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(entry));
    } catch (error) {
      console.warn(`Failed to save to persistent cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async clearPersistentCache(): Promise<void> {
    try {
      try {
        await fs.promises.access(this.persistentCachePath);
        await fs.promises.rm(this.persistentCachePath, { recursive: true });
        await this.initializePersistentCache();
      } catch {
        // Directory doesn't exist, nothing to clear
      }
    } catch (error) {
      console.warn(`Failed to clear persistent cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async cleanupPersistentCache(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.persistentCachePath);
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const file of files) {
        const filePath = path.join(this.persistentCachePath, file);
        const stats = await fs.promises.stat(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.promises.unlink(filePath);
        }
      }
    } catch {
      // Silent fail
    }
  }
}