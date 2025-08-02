/**
 * Cache interfaces for reducing central coupling
 * This provides specialized cache contracts for different use cases
 */

import { FunctionInfo } from '../types';

/**
 * Base cache interface for simple key-value operations
 */
export interface CacheProvider<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Specialized cache for function analysis results
 */
export interface FunctionCacheProvider extends CacheProvider<FunctionInfo[]> {
  preload(filePaths: string[]): Promise<{ loaded: number; total: number }>;
  getStats(): {
    totalEntries: number;
    hitRate: number;
    hits: number;
    misses: number;
  };
}

/**
 * Cache provider factory for creating different cache types
 */
export interface CacheProviderFactory {
  createFunctionCache(options?: {
    maxEntries?: number;
    maxSize?: number;
    persistentPath?: string;
    useMainCache?: boolean;
  }): FunctionCacheProvider;
  
  createGenericCache<T>(name: string, options?: {
    maxEntries?: number;
    ttl?: number;
  }): CacheProvider<T>;
}

/**
 * Simple in-memory cache implementation
 */
export class MemoryCacheProvider<T> implements CacheProvider<T> {
  private cache = new Map<string, { value: T; expires: number }>();
  private readonly ttl: number;
  private stats = { hits: 0, misses: 0 };

  constructor(private readonly maxEntries: number = 1000, ttl: number = 24 * 60 * 60 * 1000) {
    this.ttl = ttl;
  }

  async get(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.value;
  }

  async set(key: string, value: T): Promise<void> {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + this.ttl
    });
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      totalEntries: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      hits: this.stats.hits,
      misses: this.stats.misses
    };
  }
}