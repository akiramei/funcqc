/**
 * Snapshot operations module for PGLite storage
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  SnapshotInfo, 
  FunctionInfo, 
  QueryOptions, 
  SnapshotRow, 
  SnapshotMetadata 
} from '../../types';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext, StorageOperationModule } from './types';

export class SnapshotOperations implements StorageOperationModule {
  readonly db;
  private git;
  private logger;
  
  // Unused kysely access removed

  constructor(context: StorageContext) {
    this.db = context.db;
    this.git = context.git;
    this.logger = context.logger;
  }

  /**
   * Save a new snapshot with functions
   */
  async saveSnapshot(
    functions: FunctionInfo[],
    label?: string,
    comment?: string,
    configHash?: string
  ): Promise<string> {
    const snapshotId = this.generateSnapshotId();

    try {
      // Create snapshot and save functions will be handled by main adapter
      // This is just the snapshot creation part
      await this.createSnapshotRecord(
        snapshotId,
        functions,
        configHash || 'unknown',
        label,
        comment
      );

      return snapshotId;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save snapshot: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create a new empty snapshot
   */
  async createSnapshot(options: { 
    label?: string; 
    comment?: string; 
    analysisLevel?: string; 
    scope?: string; 
    configHash?: string 
  }): Promise<string> {
    const snapshotId = this.generateSnapshotId();
    const [gitCommit, gitBranch, gitTag] = await Promise.all([
      this.getGitCommit(),
      this.getGitBranch(),
      this.getGitTag()
    ]);
    
    try {
      await this.db.query(
        `INSERT INTO snapshots (
          id, label, comment, git_commit, git_branch, git_tag,
          project_root, config_hash, scope, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          snapshotId,
          options.label || null,
          options.comment || null,
          gitCommit,
          gitBranch,
          gitTag,
          process.cwd(),
          options.configHash || 'pending',
          options.scope || 'src',
          JSON.stringify(this.createInitialMetadata(options.analysisLevel)),
        ]
      );
      
      return snapshotId;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to create snapshot: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update analysis level for a snapshot
   */
  async updateAnalysisLevel(snapshotId: string, level: 'NONE' | 'BASIC' | 'CALL_GRAPH'): Promise<void> {
    try {
      // First, recalculate snapshot metadata based on actual functions
      await this.recalculateSnapshotMetadata(snapshotId);
      
      // Then get current metadata to update analysis level
      const result = await this.db.query('SELECT metadata FROM snapshots WHERE id = $1', [snapshotId]);
      if (result.rows.length === 0) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }
      
      const row = result.rows[0] as { metadata: unknown };
      const metadata = this.parseMetadata(row.metadata);
      
      // Store analysis level and completion flags in metadata but not as part of SnapshotMetadata interface
      metadata['analysisLevel'] = level;
      metadata['basicAnalysisCompleted'] = level === 'BASIC' || level === 'CALL_GRAPH';
      metadata['callGraphAnalysisCompleted'] = level === 'CALL_GRAPH';
      
      await this.db.query(
        'UPDATE snapshots SET metadata = $1 WHERE id = $2',
        [JSON.stringify(metadata), snapshotId]
      );
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to update analysis level: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get all snapshots with optional filtering
   */
  async getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]> {
    try {
      let sql = 'SELECT * FROM snapshots';
      const params: (string | number)[] = [];
      
      if (options?.scope) {
        sql += ' WHERE scope = $' + (params.length + 1);
        params.push(options.scope);
      }
      
      sql += ' ORDER BY created_at DESC';

      if (options?.limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ' OFFSET $' + (params.length + 1);
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToSnapshotInfo(row as SnapshotRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get snapshots: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get a specific snapshot by ID
   */
  async getSnapshot(id: string): Promise<SnapshotInfo | null> {
    try {
      const result = await this.db.query('SELECT * FROM snapshots WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToSnapshotInfo(result.rows[0] as SnapshotRow);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get snapshot: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete a snapshot by ID
   */
  async deleteSnapshot(id: string): Promise<boolean> {
    try {
      const result = await this.db.query('DELETE FROM snapshots WHERE id = $1', [id]);
      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to delete snapshot: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get the latest snapshot
   */
  async getLatestSnapshot(): Promise<SnapshotInfo | null> {
    try {
      const result = await this.db.query(`
        SELECT * FROM snapshots 
        ORDER BY created_at DESC 
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToSnapshotInfo(result.rows[0] as SnapshotRow);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get latest snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the config hash from the most recent snapshot
   */
  async getLastConfigHash(): Promise<string | null> {
    try {
      const result = await this.db.query(
        'SELECT config_hash FROM snapshots ORDER BY created_at DESC LIMIT 1'
      );

      if (result.rows.length === 0) {
        return null;
      }

      return (result.rows[0] as { config_hash: string }).config_hash;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get last config hash: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Private helper methods

  private generateSnapshotId(): string {
    return uuidv4();
  }

  private async createSnapshotRecord(
    snapshotId: string,
    functions: FunctionInfo[],
    configHash: string,
    label?: string,
    comment?: string
  ): Promise<void> {
    const [gitCommit, gitBranch, gitTag] = await Promise.all([
      this.getGitCommit(),
      this.getGitBranch(),
      this.getGitTag()
    ]);

    const metadata = this.calculateSnapshotMetadata(functions);

    await this.db.query(
      `INSERT INTO snapshots (
        id, label, comment, git_commit, git_branch, git_tag,
        project_root, config_hash, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        snapshotId,
        label || null,
        comment || null,
        gitCommit,
        gitBranch,
        gitTag,
        process.cwd(),
        configHash,
        JSON.stringify(metadata),
      ]
    );
  }

  private async recalculateSnapshotMetadata(_snapshotId: string): Promise<void> {
    // This method needs access to function operations, so it will be implemented
    // in the main adapter that coordinates between modules
    this.logger?.warn('recalculateSnapshotMetadata needs to be implemented in main adapter');
  }

  private createInitialMetadata(_analysisLevel?: string): SnapshotMetadata {
    return {
      totalFunctions: 0,
      totalFiles: 0,
      avgComplexity: 0,
      maxComplexity: 0,
      exportedFunctions: 0,
      asyncFunctions: 0,
      fileExtensions: {},
      // complexityDistribution uses number keys as per interface
      complexityDistribution: {} as Record<number, number>,
    };
  }

  private calculateSnapshotMetadata(functions: FunctionInfo[]): SnapshotMetadata {
    const fileSet = new Set<string>();
    const complexityDistribution: Record<number, number> = {};
    const fileExtensions: Record<string, number> = {};

    let totalComplexity = 0;
    let maxComplexity = 0;
    let exportedFunctions = 0;
    let asyncFunctions = 0;

    for (const func of functions) {
      fileSet.add(func.filePath);
      const funcComplexity = func.metrics?.cyclomaticComplexity || 1;
      totalComplexity += funcComplexity;
      maxComplexity = Math.max(maxComplexity, funcComplexity);

      if (func.isExported) exportedFunctions++;
      if (func.isAsync) asyncFunctions++;

      // Update complexity distribution (using number keys)
      if (funcComplexity <= 5) complexityDistribution[1] = (complexityDistribution[1] || 0) + 1;
      else if (funcComplexity <= 10) complexityDistribution[2] = (complexityDistribution[2] || 0) + 1;
      else if (funcComplexity <= 20) complexityDistribution[3] = (complexityDistribution[3] || 0) + 1;
      else complexityDistribution[4] = (complexityDistribution[4] || 0) + 1;

      // Update file extensions
      const ext = func.filePath.split('.').pop() || 'unknown';
      fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
    }

    return {
      totalFunctions: functions.length,
      totalFiles: fileSet.size,
      avgComplexity: functions.length > 0 ? totalComplexity / functions.length : 0,
      maxComplexity,
      exportedFunctions,
      asyncFunctions,
      complexityDistribution,
      fileExtensions,
    };
  }

  private parseMetadata(metadata: unknown): Record<string, unknown> {
    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata);
      } catch {
        return {};
      }
    }
    
    if (typeof metadata === 'object' && metadata !== null) {
      return metadata as Record<string, unknown>;
    }
    
    return {};
  }

  private mapRowToSnapshotInfo(row: SnapshotRow): SnapshotInfo {
    const metadata = this.parseMetadata(row.metadata);
    
    return {
      id: row.id,
      ...(row.label ? { label: row.label } : {}),
      ...(row.comment ? { comment: row.comment } : {}),
      ...(row.git_commit ? { gitCommit: row.git_commit } : {}),
      ...(row.git_branch ? { gitBranch: row.git_branch } : {}),
      ...(row.git_tag ? { gitTag: row.git_tag } : {}),
      createdAt: new Date(row.created_at).getTime(),
      projectRoot: row.project_root || process.cwd(),
      configHash: row.config_hash || 'unknown',
      scope: row.scope || 'src',
      analysisLevel: metadata['analysisLevel'] || 'NONE',
      metadata: metadata as SnapshotMetadata,
    };
  }

  // Git helper methods
  private async getGitCommit(): Promise<string | null> {
    try {
      const result = await this.git.revparse(['HEAD']);
      return result?.trim() || null;
    } catch {
      return null;
    }
  }

  private async getGitBranch(): Promise<string | null> {
    try {
      const result = await this.git.branch(['--show-current']);
      return result.current || null;
    } catch {
      return null;
    }
  }

  private async getGitTag(): Promise<string | null> {
    try {
      const result = await this.git.tag(['--points-at', 'HEAD']);
      const tags = result.split('\n').filter(t => t.trim());
      return tags.length > 0 ? tags[0] : null;
    } catch {
      return null;
    }
  }
}