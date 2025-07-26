/**
 * LRU (Least Recently Used) Cache implementation
 * 
 * Thread-safe cache with automatic eviction when size limit is reached.
 * Provides O(1) get/set operations using Map and doubly-linked list.
 */

export interface CacheEntry<T> {
  key: string;
  value: T;
  prev: CacheEntry<T> | null;
  next: CacheEntry<T> | null;
  accessTime: number;
}

export interface LRUCacheOptions {
  maxSize: number;
  maxAge?: number; // TTL in milliseconds
  onEvict?: (key: string, value: unknown) => void;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private head: CacheEntry<T> | null = null;
  private tail: CacheEntry<T> | null = null;
  private readonly maxSize: number;
  private readonly maxAge: number | undefined;
  private readonly onEvict?: (key: string, value: T) => void;
  
  // Statistics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: LRUCacheOptions) {
    this.maxSize = options.maxSize;
    this.maxAge = options.maxAge ?? undefined;
    this.onEvict = options.onEvict as (key: string, value: T) => void;
    
    if (this.maxSize <= 0) {
      throw new Error('LRU cache maxSize must be greater than 0');
    }
  }

  /**
   * Get value from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (this.maxAge && Date.now() - entry.accessTime > this.maxAge) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to head (most recently used)
    this.moveToHead(entry);
    entry.accessTime = Date.now();
    
    this.hits++;
    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T): void {
    const existingEntry = this.cache.get(key);
    
    if (existingEntry) {
      // Update existing entry
      existingEntry.value = value;
      existingEntry.accessTime = Date.now();
      this.moveToHead(existingEntry);
      return;
    }

    // Create new entry
    const newEntry: CacheEntry<T> = {
      key,
      value,
      prev: null,
      next: null,
      accessTime: Date.now()
    };

    // Add to cache
    this.cache.set(key, newEntry);
    this.addToHead(newEntry);

    // Evict if necessary
    if (this.cache.size > this.maxSize) {
      this.evictLRU();
    }
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // Check TTL expiration
    if (this.maxAge && Date.now() - entry.accessTime > this.maxAge) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete key from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    this.removeEntry(entry);
    this.cache.delete(key);
    
    if (this.onEvict) {
      this.onEvict(key, entry.value);
    }
    
    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        this.onEvict(key, entry.value);
      }
    }
    
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys (ordered by recency, most recent first)
   */
  keys(): string[] {
    const keys: string[] = [];
    let current = this.head;
    
    while (current) {
      keys.push(current.key);
      current = current.next;
    }
    
    return keys;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    if (!this.maxAge) return 0;
    
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.cache) {
      if (now - entry.accessTime > this.maxAge) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.delete(key);
    }
    
    return expiredKeys.length;
  }

  /**
   * Move entry to head of list
   */
  private moveToHead(entry: CacheEntry<T>): void {
    this.removeEntry(entry);
    this.addToHead(entry);
  }

  /**
   * Add entry to head of list
   */
  private addToHead(entry: CacheEntry<T>): void {
    entry.prev = null;
    entry.next = this.head;
    
    if (this.head) {
      this.head.prev = entry;
    }
    
    this.head = entry;
    
    if (!this.tail) {
      this.tail = entry;
    }
  }

  /**
   * Remove entry from list
   */
  private removeEntry(entry: CacheEntry<T>): void {
    if (entry.prev) {
      entry.prev.next = entry.next;
    } else {
      this.head = entry.next;
    }
    
    if (entry.next) {
      entry.next.prev = entry.prev;
    } else {
      this.tail = entry.prev;
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (!this.tail) return;
    
    const key = this.tail.key;
    const value = this.tail.value;
    
    this.removeEntry(this.tail);
    this.cache.delete(key);
    this.evictions++;
    
    if (this.onEvict) {
      this.onEvict(key, value);
    }
  }
}