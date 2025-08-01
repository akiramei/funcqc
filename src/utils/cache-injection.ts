/**
 * Cache injection utilities to reduce coupling
 * Provides dependency injection for cache instances
 */

import { FunctionCacheProvider, CacheProvider } from './cache-interfaces';
import { getDistributedCacheManager } from './distributed-cache-manager';

/**
 * Cache service locator to provide cache instances
 */
export class CacheServiceLocator {
  private static functionCacheInstance: FunctionCacheProvider | null = null;
  private static genericCaches = new Map<string, CacheProvider<unknown>>();

  /**
   * Get function cache instance (singleton)
   */
  static getFunctionCache(): FunctionCacheProvider {
    if (!this.functionCacheInstance) {
      const cacheManager = getDistributedCacheManager();
      this.functionCacheInstance = cacheManager.createFunctionCache();
    }
    return this.functionCacheInstance;
  }

  /**
   * Get generic cache instance
   */
  static getGenericCache<T>(name: string): CacheProvider<T> {
    if (!this.genericCaches.has(name)) {
      const cacheManager = getDistributedCacheManager();
      this.genericCaches.set(name, cacheManager.createGenericCache<T>(name));
    }
    const cache = this.genericCaches.get(name);
    if (!cache) {
      throw new Error(`Cache '${name}' not found`);
    }
    return cache as CacheProvider<T>;
  }

  /**
   * Reset all cache instances (for testing)
   */
  static reset(): void {
    this.functionCacheInstance = null;
    this.genericCaches.clear();
  }
}

/**
 * Injectable cache provider trait for classes that need caching
 */
export class CacheAware {
  protected readonly functionCache: FunctionCacheProvider;
  protected readonly genericCacheFactory: <T>(name: string) => CacheProvider<T>;

  constructor(
    functionCache?: FunctionCacheProvider,
    genericCacheFactory?: <T>(name: string) => CacheProvider<T>
  ) {
    this.functionCache = functionCache || CacheServiceLocator.getFunctionCache();
    this.genericCacheFactory = genericCacheFactory || (<T>(name: string) => CacheServiceLocator.getGenericCache<T>(name));
  }

  /**
   * Get a named generic cache instance
   */
  protected getCache<T>(name: string): CacheProvider<T> {
    return this.genericCacheFactory<T>(name);
  }
}