/**
 * Lineage operations module for PGLite storage
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  Lineage, 
  LineageQuery, 
  LineageStatus
} from '../../types';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext, StorageOperationModule } from './types';

// Define the database row structure based on the actual schema
interface LineageRow {
  id: string;
  from_ids: string[];
  to_ids: string[];
  kind: string;
  status: string;
  confidence: number;
  note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  git_commit: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class LineageOperations implements StorageOperationModule {
  readonly db;
  private git;
  private logger;
  

  // Status values mapping
  private readonly statusValues = new Set(['draft', 'confirmed', 'final', 'approved']);

  constructor(context: StorageContext) {
    this.db = context.db;
    this.git = context.git;
    this.logger = context.logger;
  }

  /**
   * Save a new lineage record
   */
  async saveLineage(lineage: Lineage): Promise<void> {
    const lineageId = lineage.id || this.generateLineageId();

    try {
      const [gitCommit] = await Promise.all([
        this.getGitCommit(),
        this.getGitBranch()
      ]);

      await this.db.query(
        `
        INSERT INTO lineages (
          id, from_ids, to_ids, kind,
          status, confidence, note,
          git_commit, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
          from_ids = EXCLUDED.from_ids,
          to_ids = EXCLUDED.to_ids,
          kind = EXCLUDED.kind,
          status = EXCLUDED.status,
          confidence = EXCLUDED.confidence,
          note = EXCLUDED.note,
          git_commit = EXCLUDED.git_commit,
          metadata = EXCLUDED.metadata,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          lineageId,
          lineage.fromIds,
          lineage.toIds,
          lineage.kind,
          lineage.status || 'draft',
          lineage.confidence || 0.5,
          lineage.note || null,
          gitCommit,
          JSON.stringify({}), // metadata placeholder
          lineage.createdAt || new Date(),
          new Date()
        ]
      );

      // Lineage saved successfully - return void
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save lineage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get a lineage record by ID
   */
  async getLineage(id: string): Promise<Lineage | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM lineages WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToLineage(result.rows[0] as LineageRow);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get lineage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Query lineages with filters
   */
  async queryLineages(query: LineageQuery): Promise<Lineage[]> {
    try {
      let sql = 'SELECT * FROM lineages WHERE 1=1';
      const params: unknown[] = [];
      let paramIndex = 1;

      // Add filters based on query
      if (query.status) {
        sql += ` AND status = $${paramIndex++}`;
        params.push(query.status);
      }

      if (query.kind) {
        sql += ` AND kind = $${paramIndex++}`;
        params.push(query.kind);
      }

      if (query.gitCommit) {
        sql += ` AND git_commit = $${paramIndex++}`;
        params.push(query.gitCommit);
      }

      if (query.minConfidence !== undefined) {
        sql += ` AND confidence >= $${paramIndex++}`;
        params.push(query.minConfidence);
      }

      if (query.fromDate) {
        sql += ` AND created_at >= $${paramIndex++}`;
        params.push(query.fromDate.toISOString());
      }

      if (query.toDate) {
        sql += ` AND created_at <= $${paramIndex++}`;
        params.push(query.toDate.toISOString());
      }

      // Add ordering
      sql += ' ORDER BY created_at DESC';

      // Add pagination
      if (query.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(query.limit);
      }

      if (query.offset) {
        sql += ` OFFSET $${paramIndex++}`;
        params.push(query.offset);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToLineage(row as LineageRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to query lineages: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update lineage status
   */
  async updateLineageStatus(id: string, status: LineageStatus, _note?: string): Promise<void> {
    if (!this.statusValues.has(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: draft, confirmed, final, approved`);
    }

    try {
      const result = await this.db.query(
        'UPDATE lineages SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [status, id]
      );
      const changes = (result as unknown as { changes: number }).changes;
      if (changes === 0) {
        throw new Error(`Lineage with ID ${id} not found`);
      }
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to update lineage status: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete a lineage record
   */
  async deleteLineage(id: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        'DELETE FROM lineages WHERE id = $1',
        [id]
      );
      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to delete lineage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get lineages by git commit
   */
  async getLineagesByCommit(gitCommit: string): Promise<Lineage[]> {
    try {
      const result = await this.db.query(
        'SELECT * FROM lineages WHERE git_commit = $1 ORDER BY created_at DESC',
        [gitCommit]
      );

      return result.rows.map(row => this.mapRowToLineage(row as LineageRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get lineages by commit: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get function lineage history
   */
  async getFunctionLineageHistory(functionId: string, limit?: number): Promise<Lineage[]> {
    try {
      // Search for lineages where the function ID appears in either from_ids or to_ids arrays
      let sql = `
        SELECT * FROM lineages 
        WHERE $1 = ANY(from_ids) OR $1 = ANY(to_ids) 
        ORDER BY created_at DESC
      `;
      const params: unknown[] = [functionId];

      if (limit) {
        sql += ' LIMIT $2';
        params.push(limit);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToLineage(row as LineageRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get function lineage history: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Prune old lineage records
   */
  async pruneOldLineages(daysToKeep: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await this.db.query(
        'DELETE FROM lineages WHERE created_at < $1 AND status = $2',
        [cutoffDate, 'draft']
      );

      const deletedCount = (result as unknown as { changes: number }).changes;
      this.logger?.log(`Pruned ${deletedCount} old lineage records older than ${daysToKeep} days`);
      
      return deletedCount;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to prune old lineages: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get lineage statistics
   */
  async getLineageStats(): Promise<{
    totalLineages: number;
    byStatus: Record<string, number>;
    byChangeType: Record<string, number>;
    avgConfidenceScore: number;
    avgRiskScore: number;
  }> {
    try {
      const result = await this.db.query(`
        SELECT 
          COUNT(*) as total_lineages,
          COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
          COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count,
          COUNT(CASE WHEN status = 'final' THEN 1 END) as final_count,
          COUNT(CASE WHEN change_type = 'CREATED' THEN 1 END) as created_count,
          COUNT(CASE WHEN change_type = 'MODIFIED' THEN 1 END) as modified_count,
          COUNT(CASE WHEN change_type = 'DELETED' THEN 1 END) as deleted_count,
          COUNT(CASE WHEN change_type = 'MOVED' THEN 1 END) as moved_count,
          AVG(confidence_score) as avg_confidence,
          AVG(risk_score) as avg_risk
        FROM lineages
      `);

      const row = result.rows[0] as {
        total_lineages: string;
        draft_count: string;
        confirmed_count: string;
        final_count: string;
        created_count: string;
        modified_count: string;
        deleted_count: string;
        moved_count: string;
        avg_confidence: string;
        avg_risk: string;
      };
      return {
        totalLineages: parseInt(row.total_lineages) || 0,
        byStatus: {
          draft: parseInt(row.draft_count) || 0,
          confirmed: parseInt(row.confirmed_count) || 0,
          final: parseInt(row.final_count) || 0,
        },
        byChangeType: {
          CREATED: parseInt(row.created_count) || 0,
          MODIFIED: parseInt(row.modified_count) || 0,
          DELETED: parseInt(row.deleted_count) || 0,
          MOVED: parseInt(row.moved_count) || 0,
        },
        avgConfidenceScore: parseFloat(row.avg_confidence) || 0,
        avgRiskScore: parseFloat(row.avg_risk) || 0,
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get lineage stats: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update lineage confidence and risk scores
   */
  async updateLineageScores(
    id: string, 
    confidenceScore: number, 
    riskScore: number
  ): Promise<boolean> {
    try {
      const result = await this.db.query(
        `UPDATE lineages 
         SET confidence_score = $1, risk_score = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [confidenceScore, riskScore, id]
      );
      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to update lineage scores: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Batch update lineage statuses
   */
  async batchUpdateLineageStatus(
    ids: string[], 
    status: 'draft' | 'confirmed' | 'final'
  ): Promise<number> {
    if (ids.length === 0) return 0;
    if (!this.statusValues.has(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: draft, confirmed, final`);
    }

    try {
      const result = await this.db.query(
        'UPDATE lineages SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($2)',
        [status, ids]
      );
      return (result as unknown as { changes: number }).changes || 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to batch update lineage status: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Private helper methods

  private generateLineageId(): string {
    return uuidv4();
  }

  private mapRowToLineage(row: LineageRow): Lineage {
    const lineage: Lineage = {
      id: row.id,
      fromIds: row.from_ids,
      toIds: row.to_ids,
      kind: row.kind as 'rename' | 'signature-change' | 'inline' | 'split',
      status: row.status as 'draft' | 'approved' | 'rejected',
      confidence: row.confidence,
      gitCommit: row.git_commit || '',
      createdAt: new Date(row.created_at),
    };
    
    if (row.note) {
      lineage.note = row.note;
    }
    
    if (row.updated_at) {
      lineage.updatedAt = new Date(row.updated_at);
    }
    
    return lineage;
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

  // ========================================
  // ADDITIONAL LINEAGE METHODS
  // ========================================

  async getLineages(query?: LineageQuery): Promise<Lineage[]> {
    return this.queryLineages(query || {});
  }

  async getLineagesWithFunctionFilter(fromFunctionPattern?: string, toFunctionPattern?: string, query?: LineageQuery): Promise<Lineage[]> {
    try {
      let sql = 'SELECT * FROM lineages WHERE 1=1';
      const params: unknown[] = [];
      let paramIndex = 1;

      // Filter by function patterns using array operations
      if (fromFunctionPattern) {
        sql += ` AND EXISTS (SELECT 1 FROM unnest(from_ids) AS fid WHERE fid LIKE $${paramIndex++})`;
        params.push(`%${fromFunctionPattern}%`);
      }

      if (toFunctionPattern) {
        sql += ` AND EXISTS (SELECT 1 FROM unnest(to_ids) AS tid WHERE tid LIKE $${paramIndex++})`;
        params.push(`%${toFunctionPattern}%`);
      }

      if (query?.status) {
        sql += ` AND status = $${paramIndex++}`;
        params.push(query.status);
      }

      if (query?.kind) {
        sql += ` AND kind = $${paramIndex++}`;
        params.push(query.kind);
      }

      sql += ' ORDER BY created_at DESC';

      if (query?.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(query.limit);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToLineage(row as LineageRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get lineages with function filter: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getLineagesByFunctionId(functionId: string): Promise<Lineage[]> {
    return this.getFunctionLineageHistory(functionId);
  }

  async pruneDraftLineages(olderThanDays: number): Promise<number> {
    return this.pruneOldLineages(olderThanDays);
  }

}