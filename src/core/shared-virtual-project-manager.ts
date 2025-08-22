/**
 * Shared Virtual Project Manager
 * 
 * Manages virtual projects across different analyzers to achieve true integration.
 * Ensures single project creation per snapshot for optimal performance.
 */

import { Project } from 'ts-morph';
import { VirtualProjectFactory } from './virtual-project-factory';
import chalk from 'chalk';

interface CachedProject {
  project: Project;
  fileContentMap: Map<string, string>;
  createdAt: number;
  snapshotId: string;
}

class SharedVirtualProjectManager {
  private projectCache = new Map<string, CachedProject>();
  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  
  /**
   * Get or create virtual project for given snapshot
   * Returns existing project if available, creates new one otherwise
   */
  async getOrCreateProject(
    snapshotId: string,
    fileContentMap: Map<string, string>
  ): Promise<{ project: Project; isNewlyCreated: boolean }> {
    // Check if project exists in cache
    const cached = this.projectCache.get(snapshotId);
    
    
    if (cached && this.isProjectValid(cached)) {
      // 追加ファイルがある場合は反映してから返す
      if (fileContentMap.size > cached.fileContentMap.size) {
        console.log(chalk.gray(`🔄 Updating virtual project for snapshot ${snapshotId.substring(0, 8)} with additional files...`));
        for (const [filePath, content] of fileContentMap) {
          if (!cached.fileContentMap.has(filePath)) {
            const existing = cached.project.getSourceFile(filePath);
            if (existing) {
              existing.replaceWithText(content);
            } else {
              cached.project.createSourceFile(filePath, content, { overwrite: true });
            }
          }
        }
        cached.fileContentMap = new Map(fileContentMap);
        console.log(chalk.gray(`⚡ Updated virtual project (${cached.project.getSourceFiles().length} files)`));
      }
      // アクセスでTTLを延長
      cached.createdAt = Date.now();
      console.log(chalk.gray(`⚡ Reusing virtual project for snapshot ${snapshotId.substring(0, 8)} (${cached.project.getSourceFiles().length} files)`));
      return { project: cached.project, isNewlyCreated: false };
    }

    // ここまで来たら新規作成
    
    // Create new virtual project only if no cache exists
    console.log(chalk.gray(`🔧 Creating virtual project for snapshot ${snapshotId.substring(0, 8)}...`));
    
    const config = VirtualProjectFactory.getRecommendedConfig('call-graph');
    const { project, creationTimeMs } = await VirtualProjectFactory.createFromContent(
      fileContentMap,
      config
    );
    
    // Cache the project
    this.projectCache.set(snapshotId, {
      project,
      fileContentMap: new Map(fileContentMap), // Create copy to avoid reference issues
      createdAt: Date.now(),
      snapshotId
    });
    
    console.log(chalk.gray(`✅ Virtual project created and cached (${creationTimeMs.toFixed(0)}ms)`));
    
    // Clean up old cache entries
    this.cleanupExpiredProjects();
    
    return { project, isNewlyCreated: true };
  }
  
  /**
   * Check if cached project is still valid
   */
  private isProjectValid(cached: CachedProject): boolean {
    const now = Date.now();
    const isExpired = (now - cached.createdAt) > this.CACHE_TTL_MS;
    
    if (isExpired) {
      return false;
    }
    
    // Additional validation: check if project still has source files
    try {
      const sourceFiles = cached.project.getSourceFiles();
      return sourceFiles.length > 0;
    } catch {
      return false;
    }
  }
  
  /**
   * Clean up expired projects from cache
   */
  private cleanupExpiredProjects(): void {
    for (const [snapshotId, cached] of this.projectCache.entries()) {
      if (!this.isProjectValid(cached)) {
        try {
          // Projects don't have dispose method in ts-morph, just remove from cache
        } catch {
          // Ignore disposal errors
        }
        
        this.projectCache.delete(snapshotId);
        console.log(chalk.gray(`🗑️  Cleaned up expired virtual project for snapshot ${snapshotId.substring(0, 8)}`));
      }
    }
  }
  
  /**
   * Manually dispose project for specific snapshot
   */
  disposeProject(snapshotId: string): void {
    const cached = this.projectCache.get(snapshotId);
    if (cached) {
      try {
        // Projects don't have dispose method in ts-morph, just remove from cache
      } catch {
        // Ignore disposal errors
      }
      
      this.projectCache.delete(snapshotId);
      console.log(chalk.gray(`🗑️  Disposed virtual project for snapshot ${snapshotId.substring(0, 8)}`));
    }
  }
  
  /**
   * Get cached project for snapshot if available
   */
  getCachedProject(snapshotId: string): Project | null {
    const cached = this.projectCache.get(snapshotId);
    if (cached && this.isProjectValid(cached)) {
      return cached.project;
    }
    return null;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { cachedProjects: number; totalFiles: number } {
    let totalFiles = 0;
    
    for (const cached of this.projectCache.values()) {
      totalFiles += cached.project.getSourceFiles().length;
    }
    
    return {
      cachedProjects: this.projectCache.size,
      totalFiles
    };
  }
  
  /**
   * Clear all cached projects
   */
  clearAll(): void {
    for (const [_snapshotId, _cached] of this.projectCache.entries()) {
      try {
        // Projects don't have dispose method in ts-morph, just remove from cache
      } catch {
        // Ignore disposal errors
      }
    }
    
    this.projectCache.clear();
    console.log(chalk.gray('🗑️  Cleared all virtual project cache'));
  }
}

// Global singleton instance
const globalSharedProjectManager = new SharedVirtualProjectManager();

export { globalSharedProjectManager as SharedVirtualProjectManager };