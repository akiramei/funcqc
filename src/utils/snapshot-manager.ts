/**
 * Snapshot Manager for Phase 4 Implementation
 * 
 * Simplified implementation focusing on integration with Phase 3 ChangesetEvaluator
 * and automatic before/after snapshot creation for refactoring operations.
 */

import {
  SnapshotInfo,
  FuncqcConfig,
  StorageAdapter,
  SnapshotMetadata,
  FunctionInfo,
} from '../types/index.js';
import { Logger } from './cli-utils.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Snapshot Creation Options
 */
export interface SnapshotCreationOptions {
  /** Custom label for the snapshot */
  label?: string;
  
  /** Additional comment describing the snapshot */
  comment?: string;
  
  /** Whether to include Git information */
  includeGitInfo?: boolean;
  
  /** Force snapshot creation even if no changes detected */
  force?: boolean;
  
  /** Custom metadata to include with snapshot */
  metadata?: Partial<SnapshotMetadata>;
  
  /** Session ID for refactoring-related snapshots */
  sessionId?: string;
  
  /** Operation type for automatic snapshots */
  operationType?: 'before' | 'after';
}

/**
 * Automatic Snapshot Configuration
 */
export interface AutomaticSnapshotConfig {
  /** Enable automatic snapshots */
  enabled: boolean;
  
  /** Create snapshots before refactoring operations */
  beforeRefactoring: boolean;
  
  /** Create snapshots after refactoring operations */
  afterRefactoring: boolean;
  
  /** Minimum time between automatic snapshots (in milliseconds) */
  minimumInterval: number;
  
  /** Maximum number of automatic snapshots to retain */
  maxRetentionCount: number;
}

/**
 * Default configuration for automatic snapshots
 */
export const DefaultAutomaticSnapshotConfig: AutomaticSnapshotConfig = {
  enabled: true,
  beforeRefactoring: true,
  afterRefactoring: true,
  minimumInterval: 30 * 1000, // 30 seconds (reduced for testing)
  maxRetentionCount: 20,
};

/**
 * Git Information Interface
 */
interface GitInfo {
  commit?: string;
  branch?: string;
  tag?: string;
}

/**
 * Snapshot Manager
 * 
 * Manages automatic creation and comparison of code snapshots for refactoring operations.
 * Integrates with Phase 3 ChangesetEvaluator to provide before/after comparison capabilities.
 * 
 * Key features:
 * - Automatic snapshot creation before/after refactoring
 * - Git integration for commit-based snapshots
 * - Integration with existing funcqc analysis pipeline
 * - Retention management for automatic snapshots
 */
export class SnapshotManager {
  private readonly logger: Logger;
  private readonly config: AutomaticSnapshotConfig;
  private readonly projectRoot: string;
  
  constructor(
    private storage: StorageAdapter,
    private funcqcConfig: FuncqcConfig,
    config: Partial<AutomaticSnapshotConfig> = {},
    logger?: Logger
  ) {
    this.logger = logger || new Logger(false, false);
    this.config = { ...DefaultAutomaticSnapshotConfig, ...config };
    this.projectRoot = funcqcConfig.roots[0] || process.cwd();
  }

  /**
   * Create a snapshot of the current codebase state
   */
  async createSnapshot(options: SnapshotCreationOptions = {}): Promise<SnapshotInfo> {
    try {
      this.logger.info('Creating snapshot', { options });
      
      // Generate snapshot ID and basic metadata
      const snapshotId = this.generateSnapshotId(options);
      const timestamp = new Date();
      
      // Get Git information if requested
      const gitInfo = options.includeGitInfo !== false ? await this.getGitInfo() : {};
      
      // Get current function analysis for metadata
      const analysisMetadata = await this.getCurrentAnalysisMetadata();
      
      // Create snapshot record
      const snapshot: SnapshotInfo = {
        id: snapshotId,
        createdAt: timestamp.getTime(),
        label: options.label || this.generateDefaultLabel(options),
        comment: options.comment || '',
        gitCommit: gitInfo.commit || '',
        gitBranch: gitInfo.branch || '',
        gitTag: gitInfo.tag || '',
        projectRoot: this.projectRoot,
        configHash: await this.calculateConfigHash(),
        scope: 'src', // Default scope for legacy compatibility
        metadata: {
          ...analysisMetadata,
          ...options.metadata,
        },
      };
      
      // Note: In the current implementation, we create metadata but don't store the snapshot
      // This is a Phase 4 stub that will be enhanced with full snapshot storage later
      this.logger.info(`Snapshot metadata prepared: ${snapshotId}`, {
        functions: snapshot.metadata.totalFunctions,
        files: snapshot.metadata.totalFiles,
      });
      
      return snapshot;
      
    } catch (error) {
      this.logger.error('Failed to create snapshot', {
        options,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw new Error(`Snapshot creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * Cleanup old automatic snapshots based on retention policy
   */
  async cleanupOldSnapshots(): Promise<number> {
    try {
      const snapshots = await this.storage.getSnapshots();
      
      // Filter automatic snapshots (those with session IDs)
      const automaticSnapshots = snapshots.filter(s => 
        s.label?.includes('Session ') || 
        s.comment?.includes('Automatic snapshot')
      );
      
      // Sort by creation time (oldest first)
      automaticSnapshots.sort((a, b) => a.createdAt - b.createdAt);
      
      // Calculate how many to delete
      const excessCount = automaticSnapshots.length - this.config.maxRetentionCount;
      
      if (excessCount <= 0) {
        this.logger.debug('No old snapshots to cleanup', {
          total: automaticSnapshots.length,
          retention: this.config.maxRetentionCount,
        });
        return 0;
      }
      
      // Delete excess snapshots
      const snapshotsToDelete = automaticSnapshots.slice(0, excessCount);
      let deletedCount = 0;
      
      for (const snapshot of snapshotsToDelete) {
        try {
          await this.storage.deleteSnapshot(snapshot.id);
          deletedCount++;
          this.logger.debug(`Deleted old snapshot: ${snapshot.id}`);
        } catch (error) {
          this.logger.warn('Failed to delete snapshot', {
            snapshotId: snapshot.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      this.logger.info(`Cleaned up ${deletedCount} old snapshots`);
      return deletedCount;
      
    } catch (error) {
      this.logger.error('Failed to cleanup old snapshots', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Generate snapshot ID based on options and current state
   */
  private generateSnapshotId(options: SnapshotCreationOptions): string {
    const prefix = options.operationType ? `${options.operationType}_` : '';
    const sessionSuffix = options.sessionId ? `_${options.sessionId.substring(0, 8)}` : '';
    return `${prefix}${uuidv4()}${sessionSuffix}`;
  }

  /**
   * Generate default label for snapshot
   */
  private generateDefaultLabel(options: SnapshotCreationOptions): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const type = options.operationType || 'manual';
    const session = options.sessionId ? ` (${options.sessionId.substring(0, 8)})` : '';
    return `${type}_${timestamp}${session}`;
  }

  /**
   * Get Git information for the snapshot
   */
  private async getGitInfo(): Promise<GitInfo> {
    try {
      const gitInfo: GitInfo = {};
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      try {
        gitInfo.commit = (await execAsync('git rev-parse HEAD', { 
          cwd: this.projectRoot,
          timeout: 5000,
        })).stdout.trim();
      } catch {
        // Git commit not available
      }
      
      try {
        gitInfo.branch = (await execAsync('git rev-parse --abbrev-ref HEAD', { 
          cwd: this.projectRoot,
          timeout: 5000,
        })).stdout.trim();
      } catch {
        // Git branch not available
      }
      
      try {
        gitInfo.tag = (await execAsync('git describe --tags --exact-match HEAD', { 
          cwd: this.projectRoot,
          timeout: 5000,
        })).stdout.trim();
      } catch {
        // Git tag not available (this is normal)
      }
      
      return gitInfo;
    } catch (error) {
      this.logger.warn('Failed to get Git information', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Get current analysis metadata for snapshot
   */
  private async getCurrentAnalysisMetadata(): Promise<SnapshotMetadata> {
    try {
      // Get current functions from storage (using latest snapshot)
      const snapshots = await this.storage.getSnapshots();
      if (snapshots.length === 0) {
        // No snapshots yet, return empty metadata
        return {
          totalFunctions: 0,
          totalFiles: 0,
          avgComplexity: 0,
          maxComplexity: 0,
          exportedFunctions: 0,
          asyncFunctions: 0,
          complexityDistribution: {},
          fileExtensions: {},
        };
      }
      
      // Get functions from the latest snapshot
      const latestSnapshot = snapshots.sort((a, b) => b.createdAt - a.createdAt)[0];
      const functions = await this.storage.getFunctionsBySnapshotId(latestSnapshot.id);
      
      if (functions.length === 0) {
        return {
          totalFunctions: 0,
          totalFiles: 0,
          avgComplexity: 0,
          maxComplexity: 0,
          exportedFunctions: 0,
          asyncFunctions: 0,
          complexityDistribution: {},
          fileExtensions: {},
        };
      }
      
      // Calculate statistics
      const functionsWithMetrics = functions.filter((f: FunctionInfo) => f.metrics);
      const complexities = functionsWithMetrics.map((f: FunctionInfo) => f.metrics!.cyclomaticComplexity);
      const avgComplexity = complexities.length > 0 ? 
        complexities.reduce((sum: number, c: number) => sum + c, 0) / complexities.length : 0;
      const maxComplexity = complexities.length > 0 ? Math.max(...complexities) : 0;
      
      // Count exported and async functions
      const exportedFunctions = functions.filter((f: FunctionInfo) => f.isExported).length;
      const asyncFunctions = functions.filter((f: FunctionInfo) => f.isAsync).length;
      
      // Build complexity distribution
      const complexityDistribution: Record<number, number> = {};
      complexities.forEach((complexity: number) => {
        const bucket = Math.floor(complexity / 5) * 5; // Group by 5s: 0-4, 5-9, 10-14, etc.
        complexityDistribution[bucket] = (complexityDistribution[bucket] || 0) + 1;
      });
      
      // Count unique files and file extensions
      const uniqueFiles = new Set(functions.map((f: FunctionInfo) => f.filePath)).size;
      
      // Build file extensions distribution
      const fileExtensions: Record<string, number> = {};
      functions.forEach((f: FunctionInfo) => {
        const ext = f.filePath.split('.').pop() || 'unknown';
        fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
      });
      
      return {
        totalFunctions: functions.length,
        totalFiles: uniqueFiles,
        avgComplexity: Math.round(avgComplexity * 100) / 100,
        maxComplexity,
        exportedFunctions,
        asyncFunctions,
        complexityDistribution,
        fileExtensions,
      };
    } catch (error) {
      this.logger.warn('Failed to get current analysis metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        totalFunctions: 0,
        totalFiles: 0,
        avgComplexity: 0,
        maxComplexity: 0,
        exportedFunctions: 0,
        asyncFunctions: 0,
        complexityDistribution: {},
        fileExtensions: {},
      };
    }
  }

  /**
   * Calculate configuration hash for change detection
   */
  private async calculateConfigHash(): Promise<string> {
    try {
      // Create a simple hash based on configuration key properties
      const configString = JSON.stringify({
        roots: this.funcqcConfig.roots,
        exclude: this.funcqcConfig.exclude?.sort(),
        include: this.funcqcConfig.include?.sort(),
      });
      
      // Use crypto for production-grade hashing
      const { createHash } = await import('crypto');
      return createHash('sha256')
        .update(configString)
        .digest('hex')
        .substring(0, 8);
    } catch (error) {
      this.logger.warn('Failed to calculate config hash', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 'unknown';
    }
  }
}