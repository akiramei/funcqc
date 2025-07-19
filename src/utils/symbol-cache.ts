import { Node, Symbol as TsMorphSymbol, TypeChecker } from 'ts-morph';

/**
 * Symbol Cache for TypeChecker.getSymbolAtLocation optimization
 * 
 * Reduces redundant symbol resolution calls by caching results.
 * Uses WeakMap to prevent memory leaks as nodes are garbage collected.
 */
export class SymbolCache {
  // WeakMap ensures cached entries are garbage collected with their nodes
  private cache = new WeakMap<Node, TsMorphSymbol | null>();
  private typeChecker: TypeChecker;
  private hitCount = 0;
  private missCount = 0;

  constructor(typeChecker: TypeChecker) {
    this.typeChecker = typeChecker;
  }

  /**
   * Get symbol for node with caching
   * Returns cached result if available, otherwise calls TypeChecker
   */
  getSymbolAtLocation(node: Node): TsMorphSymbol | undefined {
    // Check cache first
    if (this.cache.has(node)) {
      this.hitCount++;
      const cached = this.cache.get(node);
      return cached === null ? undefined : cached;
    }

    // Cache miss - resolve symbol
    this.missCount++;
    const symbol = this.typeChecker.getSymbolAtLocation(node);
    
    // Store in cache (null for undefined to distinguish from not-cached)
    this.cache.set(node, symbol || null);
    
    return symbol;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    // WeakMap doesn't have clear(), create new instance
    this.cache = new WeakMap<Node, TsMorphSymbol | null>();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.hitCount + this.missCount;
    const hitRate = total > 0 ? this.hitCount / total : 0;
    
    return {
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: Math.round(hitRate * 100) / 100
    };
  }

  /**
   * Log cache statistics
   */
  logStats(): void {
    const stats = this.getStats();
    if (stats.hits + stats.misses > 0) {
      console.log(`   📊 Symbol cache: ${stats.hits} hits, ${stats.misses} misses (${(stats.hitRate * 100).toFixed(1)}% hit rate)`);
    }
  }
}