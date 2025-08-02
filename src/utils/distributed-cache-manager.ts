/**
 * Distributed cache manager to reduce central coupling
 * Provides specialized cache instances for different components
 */

import { FunctionInfo } from '../types';
import { AnalysisCache } from './analysis-cache';
import { 
  CacheProvider, 
  FunctionCacheProvider, 
  CacheProviderFactory, 
  MemoryCacheProvider 
} from './cache-interfaces';

interface CacheStatsRecord {
  [key: string]: {
    totalEntries: number;
    hitRate: number;
    hits: number;
    misses: number;
  } | unknown;
}

/**
 * Function cache adapter that wraps AnalysisCache to match interface
 */
class FunctionCacheAdapter implements FunctionCacheProvider {
  constructor(private readonly analysisCache: AnalysisCache) {}

  async get(key: string): Promise<FunctionInfo[] | null> {
    return this.analysisCache.get(key);
  }

  async set(key: string, value: FunctionInfo[]): Promise<void> {
    return this.analysisCache.set(key, value);
  }

  async clear(): Promise<void> {
    return this.analysisCache.clear();
  }

  async preload(filePaths: string[]) {
    return this.analysisCache.preload(filePaths);
  }

  getStats() {
    return this.analysisCache.getStats();
  }
}

/**
 * Independent function cache that doesn't use the central AnalysisCache
 * This reduces the bottleneck on the main get() function
 */
class IndependentFunctionCache implements FunctionCacheProvider {
  private memoryCache = new Map<string, { functions: FunctionInfo[], timestamp: number }>();
  private stats = { hits: 0, misses: 0 };
  private readonly maxEntries: number;
  private readonly maxAge: number;

  constructor(options: { maxEntries?: number; maxAge?: number } = {}) {
    this.maxEntries = options.maxEntries || 1000;
    this.maxAge = options.maxAge || 24 * 60 * 60 * 1000; // 24 hours
  }

  async get(key: string): Promise<FunctionInfo[] | null> {
    const entry = this.memoryCache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.memoryCache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.functions;
  }

  async set(key: string, value: FunctionInfo[]): Promise<void> {
    // Evict oldest entries if at capacity
    if (this.memoryCache.size >= this.maxEntries) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey !== undefined) {
        this.memoryCache.delete(firstKey);
      }
    }

    this.memoryCache.set(key, {
      functions: value,
      timestamp: Date.now()
    });
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  async preload(filePaths: string[]): Promise<{ loaded: number; total: number }> {
    // Independent cache doesn't support preloading from persistent storage
    // This is intentional to avoid the bottleneck
    return { loaded: 0, total: filePaths.length };
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      totalEntries: this.memoryCache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      hits: this.stats.hits,
      misses: this.stats.misses
    };
  }
}

/**
 * Distributed cache manager that creates specialized cache instances
 */
export class DistributedCacheManager implements CacheProviderFactory {
  private readonly cacheInstances = new Map<string, CacheProvider<unknown>>();
  private readonly mainAnalysisCache: AnalysisCache;

  constructor(options: {
    maxMemoryEntries?: number;
    maxMemorySize?: number;
    persistentCachePath?: string;
  } = {}) {
    this.mainAnalysisCache = new AnalysisCache(options);
  }

  /**
   * Create a specialized function cache
   */
  createFunctionCache(options?: {
    maxEntries?: number;
    maxSize?: number;
    persistentPath?: string;
    useMainCache?: boolean;  // Option to use main cache for backward compatibility
  }): FunctionCacheProvider {
    const cacheKey = this.generateCacheKey('function-cache', options);
    
    let cache = this.cacheInstances.get(cacheKey);
    if (!cache) {
      // Use independent cache by default to reduce centrality bottleneck
      if (options?.useMainCache) {
        cache = new FunctionCacheAdapter(this.mainAnalysisCache);
      } else {
        cache = new IndependentFunctionCache({
          maxEntries: options?.maxEntries || 1000,
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
      }
      this.cacheInstances.set(cacheKey, cache);
    }
    
    return cache as FunctionCacheProvider;
  }

  /**
   * Get the main analysis cache for cases that need persistent storage
   * This should be used sparingly to avoid centrality bottleneck
   */
  getMainAnalysisCache(): AnalysisCache {
    return this.mainAnalysisCache;
  }

  /**
   * Create a generic cache for other types
   */
  createGenericCache<T>(name: string, options?: {
    maxEntries?: number;
    ttl?: number;
  }): CacheProvider<T> {
    const cacheKey = this.generateCacheKey(`generic-${name}`, options);
    
    let cache = this.cacheInstances.get(cacheKey);
    if (!cache) {
      cache = new MemoryCacheProvider<T>(
        options?.maxEntries || 1000,
        options?.ttl || 24 * 60 * 60 * 1000
      );
      this.cacheInstances.set(cacheKey, cache);
    }
    
    return cache as CacheProvider<T>;
  }

  /**
   * Generate a safe cache key from prefix and options
   */
  private generateCacheKey(prefix: string, options?: Record<string, unknown>): string {
    if (!options) return prefix;
    
    // Create a stable key from options, handling edge cases
    const sortedEntries = Object.entries(options)
      .filter(([_, value]) => typeof value !== 'function')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${String(value)}`);
    
    return `${prefix}-${sortedEntries.join('-')}`;
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.mainAnalysisCache.clear(),
      ...Array.from(this.cacheInstances.values()).map(cache => cache.clear())
    ]);
  }

  /**
   * Get cache statistics for all instances
   */
  getAllStats(): CacheStatsRecord {
    const stats: CacheStatsRecord = {
      mainAnalysisCache: this.mainAnalysisCache.getStats()
    };

    for (const [key, cache] of this.cacheInstances.entries()) {
      if ('getStats' in cache && typeof cache.getStats === 'function') {
        stats[key] = cache.getStats();
      }
    }

    return stats;
  }
}

// Singleton instance for global use
let globalCacheManager: DistributedCacheManager | null = null;

/**
 * Get the global distributed cache manager instance
 */
export function getDistributedCacheManager(): DistributedCacheManager {
  if (!globalCacheManager) {
    globalCacheManager = new DistributedCacheManager();
  }
  return globalCacheManager;
}

/**
 * Reset the global cache manager (mainly for testing)
 */
export function resetDistributedCacheManager(): void {
  globalCacheManager = null;
}