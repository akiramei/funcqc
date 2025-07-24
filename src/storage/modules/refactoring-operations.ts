/**
 * Refactoring operations module for PGLite storage
 * Handles refactoring sessions and changesets
 */

// UUID import removed - using ID from input
import { 
  RefactoringSession,
  RefactoringChangeset,
  QueryOptions
} from '../../types';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext, StorageOperationModule } from './types';

/**
 * Default values for changeset operations
 */
const DEFAULT_CHANGESET_VALUES = {
  operationType: 'update',
  status: 'draft',
  confidenceScore: 0.5,
} as const;

interface RefactoringSessionRow {
  id: string;
  name: string;
  description: string;
  status: string;
  target_branch: string;
  start_time: string;
  end_time: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

interface RefactoringChangesetRow {
  id: string;
  session_id: string;
  changeset_type: string;
  target_function_id: string;
  source_snapshot_id: string;
  target_snapshot_id: string | null;
  change_description: string;
  status: string;
  confidence_score: number;
  risk_assessment: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export class RefactoringOperations implements StorageOperationModule {
  readonly db;
  readonly kysely;
  constructor(context: StorageContext) {
    this.db = context.db;
    this.kysely = context.kysely;
  }

  /**
   * Save a refactoring session
   */
  async saveRefactoringSession(session: RefactoringSession): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO refactoring_sessions (
          id, name, description, status, target_branch, start_time,
          end_time, metadata, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          target_branch = EXCLUDED.target_branch,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `, [
        session.id,
        session.name,
        session.description,
        session.status,
        session.target_branch,
        new Date(session.start_time).toISOString(),
        session.end_time ? new Date(session.end_time).toISOString() : null,
        JSON.stringify(session.metadata || {}),
        session.created_at.toISOString(),
        session.updated_at.toISOString(),
      ]);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save refactoring session: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get a refactoring session by ID
   */
  async getRefactoringSession(id: string): Promise<RefactoringSession | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM refactoring_sessions WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToRefactoringSession(result.rows[0] as RefactoringSessionRow);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get refactoring session: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get refactoring sessions with filtering and pagination
   */
  async getRefactoringSessions(options?: QueryOptions): Promise<RefactoringSession[]> {
    try {
      let sql = 'SELECT * FROM refactoring_sessions';
      const params: unknown[] = [];
      let paramIndex = 1;

      // Add filters
      const conditions: string[] = [];
      
      if (options?.filters) {
        for (const filter of options.filters) {
          if (filter.field === 'status') {
            conditions.push(`status = $${paramIndex++}`);
            params.push(filter.value);
          } else if (filter.field === 'target_branch') {
            conditions.push(`target_branch = $${paramIndex++}`);
            params.push(filter.value);
          }
        }
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      // Add sorting
      sql += ' ORDER BY created_at DESC';

      // Add pagination
      if (options?.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ` OFFSET $${paramIndex++}`;
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToRefactoringSession(row as RefactoringSessionRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get refactoring sessions: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get all refactoring sessions
   */
  async getAllRefactoringSessions(): Promise<RefactoringSession[]> {
    try {
      const result = await this.db.query(
        'SELECT * FROM refactoring_sessions ORDER BY created_at DESC'
      );
      return result.rows.map(row => this.mapRowToRefactoringSession(row as RefactoringSessionRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get all refactoring sessions: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update a refactoring session
   */
  async updateRefactoringSession(
    id: string,
    updates: Partial<RefactoringSession>
  ): Promise<boolean> {
    try {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      // Build dynamic update query
      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }

      if (updates.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(updates.description);
      }

      if (updates.status !== undefined) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(updates.status);
      }

      if (updates.target_branch !== undefined) {
        setClauses.push(`target_branch = $${paramIndex++}`);
        values.push(updates.target_branch);
      }

      if (updates.end_time !== undefined) {
        setClauses.push(`end_time = $${paramIndex++}`);
        values.push(updates.end_time ? new Date(updates.end_time).toISOString() : null);
      }

      if (updates.metadata !== undefined) {
        setClauses.push(`metadata = $${paramIndex++}`);
        values.push(JSON.stringify(updates.metadata));
      }

      if (setClauses.length === 0) {
        return false;
      }

      setClauses.push(`updated_at = $${paramIndex++}`);
      values.push(new Date().toISOString());

      values.push(id); // WHERE clause

      const result = await this.db.query(
        `UPDATE refactoring_sessions SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to update refactoring session: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save a refactoring changeset
   */
  async saveRefactoringChangeset(changeset: RefactoringChangeset): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO session_functions (
          id, session_id, changeset_type, target_function_id, source_snapshot_id,
          target_snapshot_id, change_description, status, confidence_score,
          risk_assessment, metadata, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          changeset_type = EXCLUDED.changeset_type,
          change_description = EXCLUDED.change_description,
          status = EXCLUDED.status,
          confidence_score = EXCLUDED.confidence_score,
          risk_assessment = EXCLUDED.risk_assessment,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `, [
        changeset.id,
        changeset.sessionId,
        changeset.operationType || DEFAULT_CHANGESET_VALUES.operationType,
        changeset.parentFunctionId || '',
        changeset.beforeSnapshotId,
        changeset.afterSnapshotId || null,
        `${changeset.operationType || DEFAULT_CHANGESET_VALUES.operationType} operation`,
        DEFAULT_CHANGESET_VALUES.status,
        DEFAULT_CHANGESET_VALUES.confidenceScore,
        JSON.stringify({}),
        JSON.stringify({}),
        changeset.createdAt ? new Date(changeset.createdAt).toISOString() : new Date().toISOString(),
        changeset.updatedAt ? new Date(changeset.updatedAt).toISOString() : new Date().toISOString(),
      ]);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save refactoring changeset: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get a refactoring changeset by ID
   */
  async getRefactoringChangeset(id: string): Promise<RefactoringChangeset | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM session_functions WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToRefactoringChangeset(result.rows[0] as RefactoringChangesetRow);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get refactoring changeset: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get refactoring changesets by session ID
   */
  async getRefactoringChangesetsBySession(sessionId: string): Promise<RefactoringChangeset[]> {
    try {
      const result = await this.db.query(
        'SELECT * FROM session_functions WHERE session_id = $1 ORDER BY created_at',
        [sessionId]
      );

      return result.rows.map(row => this.mapRowToRefactoringChangeset(row as RefactoringChangesetRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get refactoring changesets by session: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update a refactoring changeset
   */
  async updateRefactoringChangeset(
    id: string,
    updates: Partial<RefactoringChangeset>
  ): Promise<boolean> {
    try {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      // Build dynamic update query using type assertion
      const updateData = updates as Record<string, unknown>;
      
      if (updateData['changeset_type'] !== undefined) {
        setClauses.push(`changeset_type = $${paramIndex++}`);
        values.push(updateData['changeset_type']);
      }

      if (updateData['change_description'] !== undefined) {
        setClauses.push(`change_description = $${paramIndex++}`);
        values.push(updateData['change_description']);
      }

      if (updateData['status'] !== undefined) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(updateData['status']);
      }

      if (updateData['confidence_score'] !== undefined) {
        setClauses.push(`confidence_score = $${paramIndex++}`);
        values.push(updateData['confidence_score']);
      }

      if (updateData['risk_assessment'] !== undefined) {
        setClauses.push(`risk_assessment = $${paramIndex++}`);
        values.push(JSON.stringify(updateData['risk_assessment']));
      }

      if (updateData['metadata'] !== undefined) {
        setClauses.push(`metadata = $${paramIndex++}`);
        values.push(JSON.stringify(updateData['metadata']));
      }

      if (updateData['target_snapshot_id'] !== undefined) {
        setClauses.push(`target_snapshot_id = $${paramIndex++}`);
        values.push(updateData['target_snapshot_id']);
      }

      if (setClauses.length === 0) {
        return false;
      }

      setClauses.push(`updated_at = $${paramIndex++}`);
      values.push(new Date().toISOString());

      values.push(id); // WHERE clause

      const result = await this.db.query(
        `UPDATE session_functions SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to update refactoring changeset: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete a refactoring session and its changesets
   */
  async deleteRefactoringSession(id: string): Promise<boolean> {
    try {
      // Delete changesets first (foreign key constraint)
      await this.db.query('DELETE FROM session_functions WHERE session_id = $1', [id]);
      
      // Delete the session
      const result = await this.db.query('DELETE FROM refactoring_sessions WHERE id = $1', [id]);
      
      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to delete refactoring session: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get refactoring statistics
   */
  async getRefactoringStats(): Promise<{
    totalSessions: number;
    byStatus: Record<string, number>;
    totalChangesets: number;
    changesetsByStatus: Record<string, number>;
    avgConfidenceScore: number;
  }> {
    try {
      const [sessionResult, changesetResult] = await Promise.all([
        this.db.query(`
          SELECT 
            COUNT(*) as total_sessions,
            status,
            COUNT(status) as status_count
          FROM refactoring_sessions
          GROUP BY status
        `),
        this.db.query(`
          SELECT 
            COUNT(*) as total_changesets,
            status,
            COUNT(status) as status_count,
            AVG(confidence_score) as avg_confidence
          FROM session_functions
          GROUP BY status
        `)
      ]);

      const byStatus: Record<string, number> = {};
      let totalSessions = 0;

      for (const row of sessionResult.rows) {
        const rowData = row as { status: string; status_count: string };
        byStatus[rowData.status] = parseInt(rowData.status_count);
        totalSessions += parseInt(rowData.status_count);
      }

      const changesetsByStatus: Record<string, number> = {};
      let totalChangesets = 0;
      let avgConfidenceScore = 0;

      for (const row of changesetResult.rows) {
        const rowData = row as { status: string; status_count: string; avg_confidence: string };
        changesetsByStatus[rowData.status] = parseInt(rowData.status_count);
        totalChangesets += parseInt(rowData.status_count);
        avgConfidenceScore = parseFloat(rowData.avg_confidence) || 0;
      }

      return {
        totalSessions,
        byStatus,
        totalChangesets,
        changesetsByStatus,
        avgConfidenceScore,
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get refactoring stats: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Private helper methods

  private mapRowToRefactoringSession(row: RefactoringSessionRow): RefactoringSession {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: (row.status === 'draft' ? 'active' : row.status) as 'active' | 'completed' | 'cancelled',
      target_branch: row.target_branch,
      start_time: new Date(row.start_time).getTime(),
      ...(row.end_time ? { end_time: new Date(row.end_time).getTime() } : {}),
      metadata: this.parseJsonSafely(row.metadata, {}),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  private mapRowToRefactoringChangeset(row: RefactoringChangesetRow): RefactoringChangeset {
    return {
      id: row.id,
      sessionId: row.session_id,
      operationType: row.changeset_type as 'split' | 'extract' | 'merge' | 'rename',
      intent: 'cleanup' as const,
      childFunctionIds: [],
      parentFunctionId: row.target_function_id,
      beforeSnapshotId: row.source_snapshot_id,
      afterSnapshotId: row.target_snapshot_id || '',
      // Store additional properties in metadata rather than as direct properties
      ...(row.change_description ? { 
        metadata: { 
          ...this.parseJsonSafely(row.metadata, {}), 
          changeDescription: row.change_description 
        } 
      } : { metadata: this.parseJsonSafely(row.metadata, {}) }),
      // Store risk assessment in metadata instead of as HealthAssessment
      // since HealthAssessment requires many properties that may not be available
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private parseJsonSafely<T>(jsonString: string, fallback: T): T {
    try {
      return JSON.parse(jsonString);
    } catch {
      return fallback;
    }
  }

}