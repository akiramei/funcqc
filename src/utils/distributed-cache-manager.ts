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
  }): FunctionCacheProvider {
    const cacheKey = `function-cache-${JSON.stringify(options || {})}`;
    
    if (!this.cacheInstances.has(cacheKey)) {
      // For now, we use the main analysis cache for function caching
      // In the future, this could create separate instances for different use cases
      this.cacheInstances.set(cacheKey, new FunctionCacheAdapter(this.mainAnalysisCache));
    }
    
    return this.cacheInstances.get(cacheKey) as FunctionCacheProvider;
  }

  /**
   * Create a generic cache for other types
   */
  createGenericCache<T>(name: string, options?: {
    maxEntries?: number;
    ttl?: number;
  }): CacheProvider<T> {
    const cacheKey = `generic-${name}-${JSON.stringify(options || {})}`;
    
    if (!this.cacheInstances.has(cacheKey)) {
      const cache = new MemoryCacheProvider<T>(
        options?.maxEntries || 1000,
        options?.ttl || 24 * 60 * 60 * 1000
      );
      this.cacheInstances.set(cacheKey, cache);
    }
    
    return this.cacheInstances.get(cacheKey) as CacheProvider<T>;
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
  getAllStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {
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