import { Project } from 'ts-morph';
import { Logger } from '../utils/cli-utils';
import * as crypto from 'crypto';

/**
 * Result returned when getting or creating a virtual project
 */
export interface VirtualProjectResult {
  project: Project;
  virtualPaths: Map<string, string>;
  isNewlyCreated: boolean;
  cacheKey: string;
}

/**
 * Cached virtual project entry
 */
interface VirtualProjectEntry {
  project: Project;
  virtualPaths: Map<string, string>;
  cacheKey: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
}

/**
 * VirtualProjectManager
 * 
 * Manages virtual projects with intelligent caching to eliminate duplicate creation.
 * Key features:
 * - Snapshot-based caching with content hash validation
 * - TTL-based cache expiration
 * - Memory usage optimization
 * - Thread-safe operation
 */
export class VirtualProjectManager {
  private projectCache: Map<string, VirtualProjectEntry> = new Map();
  private logger: Logger;
  
  // Cache configuration
  private readonly TTL = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CACHE_ENTRIES = 5; // Limit memory usage
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger(false);
    this.startPeriodicCleanup();
  }

  /**
   * Get or create a virtual project for the given snapshot and content
   */
  getOrCreateProject(
    snapshotId: string,
    fileContentMap: Map<string, string>
  ): VirtualProjectResult {
    const startTime = performance.now();
    
    // Create cache key from snapshot ID and content hash
    const cacheKey = this.createCacheKey(snapshotId, fileContentMap);
    
    // Check for existing cached project
    const existing = this.projectCache.get(cacheKey);
    if (existing && this.isValidCacheEntry(existing)) {
      // Update access statistics
      existing.lastAccessedAt = Date.now();
      existing.accessCount++;
      
      const retrievalTime = performance.now() - startTime;
      this.logger.debug(`🚀 Virtual project cache HIT: ${cacheKey.substring(0, 8)} (${retrievalTime.toFixed(1)}ms, accessed ${existing.accessCount} times)`);
      
      return {
        project: existing.project,
        virtualPaths: existing.virtualPaths,
        isNewlyCreated: false,
        cacheKey
      };
    }
    
    // Create new virtual project
    this.logger.debug(`🔧 Creating new virtual project for snapshot ${snapshotId.substring(0, 8)}`);
    const { project, virtualPaths } = this.createVirtualProject(fileContentMap);
    
    // Store in cache
    const entry: VirtualProjectEntry = {
      project,
      virtualPaths,
      cacheKey,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1
    };
    
    // Ensure cache size limit
    this.ensureCacheLimit();
    this.projectCache.set(cacheKey, entry);
    
    const creationTime = performance.now() - startTime;
    this.logger.debug(`✅ Virtual project created and cached: ${cacheKey.substring(0, 8)} (${creationTime.toFixed(1)}ms)`);
    
    return {
      project,
      virtualPaths,
      isNewlyCreated: true,
      cacheKey
    };
  }

  /**
   * Create cache key from snapshot ID and file content map
   */
  private createCacheKey(snapshotId: string, fileContentMap: Map<string, string>): string {
    // Create a deterministic hash of file paths and content
    const contentItems: string[] = [];
    
    // Sort by file path for consistency
    const sortedEntries = Array.from(fileContentMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    
    for (const [filePath, content] of sortedEntries) {
      // Use file path and content hash for cache key
      const contentHash = crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
      contentItems.push(`${filePath}:${contentHash}`);
    }
    
    const contentSignature = crypto.createHash('md5').update(contentItems.join('|')).digest('hex').substring(0, 16);
    return `${snapshotId}:${contentSignature}`;
  }

  /**
   * Create a new virtual project with in-memory file system
   */
  private createVirtualProject(fileContentMap: Map<string, string>): {
    project: Project;
    virtualPaths: Map<string, string>;
  } {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipLoadingLibFiles: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true, // Use in-memory filesystem for virtual files
      compilerOptions: {
        isolatedModules: true,
        noResolve: true,
        skipLibCheck: true,
        noLib: true
      }
    });
    
    // Add virtual source files from stored content
    const virtualPaths = new Map<string, string>();
    for (const [filePath, content] of fileContentMap) {
      // Create a virtual path to avoid conflicts with real filesystem
      const virtualPath = `/virtual${filePath}`;
      virtualPaths.set(filePath, virtualPath);
      project.createSourceFile(virtualPath, content, { overwrite: true });
    }
    
    return { project, virtualPaths };
  }

  /**
   * Check if cache entry is still valid
   */
  private isValidCacheEntry(entry: VirtualProjectEntry): boolean {
    const age = Date.now() - entry.createdAt;
    return age < this.TTL;
  }

  /**
   * Ensure cache doesn't exceed maximum entries
   */
  private ensureCacheLimit(): void {
    if (this.projectCache.size < this.MAX_CACHE_ENTRIES) {
      return;
    }
    
    // Remove oldest entry (LRU strategy)
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.projectCache) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.logger.debug(`🗑️  Evicting oldest cache entry: ${oldestKey.substring(0, 8)}`);
      this.projectCache.delete(oldestKey);
    }
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.projectCache) {
      if (!this.isValidCacheEntry(entry)) {
        expiredKeys.push(key);
      }
    }
    
    if (expiredKeys.length > 0) {
      this.logger.debug(`🗑️  Clearing ${expiredKeys.length} expired cache entries`);
      for (const key of expiredKeys) {
        this.projectCache.delete(key);
      }
    }
  }

  /**
   * Start periodic cleanup of expired cache entries
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(() => {
      this.clearExpiredCache();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
    entries: Array<{
      key: string;
      createdAt: number;
      lastAccessedAt: number;
      accessCount: number;
      ageMinutes: number;
    }>;
  } {
    const now = Date.now();
    let totalHits = 0;
    let totalAccesses = 0;
    
    const entries = Array.from(this.projectCache.entries()).map(([key, entry]) => {
      const hits = entry.accessCount - 1; // First access is cache miss
      totalHits += hits;
      totalAccesses += entry.accessCount;
      
      return {
        key: key.substring(0, 16),
        createdAt: entry.createdAt,
        lastAccessedAt: entry.lastAccessedAt,
        accessCount: entry.accessCount,
        ageMinutes: Math.round((now - entry.createdAt) / (60 * 1000))
      };
    });
    
    const hitRate = totalAccesses > 0 ? totalHits / totalAccesses : 0;
    const misses = totalAccesses - totalHits;
    
    return {
      size: this.projectCache.size,
      hits: totalHits,
      misses,
      hitRate,
      entries
    };
  }

  /**
   * Clear all cached projects (for testing or manual cleanup)
   */
  clearAllCache(): void {
    this.logger.debug(`🗑️  Clearing all ${this.projectCache.size} cached virtual projects`);
    this.projectCache.clear();
  }

  /**
   * Dispose of the manager and clean up resources
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clearAllCache();
  }

  /**
   * Convert real file path to virtual path using cached mapping
   */
  getVirtualPath(cacheKey: string, realPath: string): string | undefined {
    const entry = this.projectCache.get(cacheKey);
    return entry?.virtualPaths.get(realPath);
  }

  /**
   * Get all virtual paths for a cached project
   */
  getVirtualPaths(cacheKey: string): Map<string, string> | undefined {
    const entry = this.projectCache.get(cacheKey);
    return entry?.virtualPaths;
  }
}

// Singleton instance for global use
let globalVirtualProjectManager: VirtualProjectManager | null = null;

/**
 * Get the global VirtualProjectManager instance
 */
export function getGlobalVirtualProjectManager(): VirtualProjectManager {
  if (!globalVirtualProjectManager) {
    globalVirtualProjectManager = new VirtualProjectManager();
  }
  return globalVirtualProjectManager;
}

/**
 * Reset the global VirtualProjectManager (for testing)
 */
export function resetGlobalVirtualProjectManager(): void {
  if (globalVirtualProjectManager) {
    globalVirtualProjectManager.dispose();
    globalVirtualProjectManager = null;
  }
}