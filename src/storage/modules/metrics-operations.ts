/**
 * Quality metrics operations module for PGLite storage
 */

import { 
  QualityMetrics, 
  FunctionInfo,
  MetricsRow
} from '../../types';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext, StorageOperationModule } from './types';
import { BatchProcessor } from '../../utils/batch-processor';
import { executeUnnestBulkInsert } from '../bulk-insert-utils';

export class MetricsOperations implements StorageOperationModule {
  readonly db;
  readonly kysely;
  private context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
    this.db = context.db;
    this.kysely = context.kysely;
  }

  /**
   * Get quality metrics for a function
   */
  async getMetrics(functionId: string): Promise<QualityMetrics | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM quality_metrics WHERE function_id = $1',
        [functionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToMetrics(result.rows[0] as MetricsRow);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get metrics: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get metrics for multiple functions
   */
  async getMetricsBatch(functionIds: string[]): Promise<Map<string, QualityMetrics>> {
    if (functionIds.length === 0) {
      return new Map();
    }

    try {
      // Use ANY for efficient batch query
      const result = await this.db.query(
        'SELECT * FROM quality_metrics WHERE function_id = ANY($1)',
        [functionIds]
      );

      const metricsMap = new Map<string, QualityMetrics>();
      for (const row of result.rows) {
        const metrics = this.mapRowToMetrics(row as MetricsRow);
        if (metrics) {
          metricsMap.set((row as MetricsRow).function_id, metrics);
        }
      }

      return metricsMap;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get metrics batch: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save metrics for a single function
   */
  async saveMetrics(functionId: string, snapshotId: string, metrics: QualityMetrics): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO quality_metrics (
          function_id, snapshot_id, lines_of_code, total_lines, cyclomatic_complexity, cognitive_complexity,
          max_nesting_level, parameter_count, return_statement_count, branch_count, loop_count,
          try_catch_count, async_await_count, callback_count, comment_lines, code_to_comment_ratio,
          halstead_volume, halstead_difficulty, maintainability_index
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        ON CONFLICT (function_id, snapshot_id) DO UPDATE SET
          lines_of_code = EXCLUDED.lines_of_code,
          total_lines = EXCLUDED.total_lines,
          cyclomatic_complexity = EXCLUDED.cyclomatic_complexity,
          cognitive_complexity = EXCLUDED.cognitive_complexity,
          max_nesting_level = EXCLUDED.max_nesting_level,
          parameter_count = EXCLUDED.parameter_count,
          return_statement_count = EXCLUDED.return_statement_count,
          branch_count = EXCLUDED.branch_count,
          loop_count = EXCLUDED.loop_count,
          try_catch_count = EXCLUDED.try_catch_count,
          async_await_count = EXCLUDED.async_await_count,
          callback_count = EXCLUDED.callback_count,
          comment_lines = EXCLUDED.comment_lines,
          code_to_comment_ratio = EXCLUDED.code_to_comment_ratio,
          halstead_volume = EXCLUDED.halstead_volume,
          halstead_difficulty = EXCLUDED.halstead_difficulty,
          maintainability_index = EXCLUDED.maintainability_index,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          functionId,
          snapshotId,
          metrics.linesOfCode,
          metrics.totalLines,
          metrics.cyclomaticComplexity,
          metrics.cognitiveComplexity,
          metrics.maxNestingLevel,
          metrics.parameterCount,
          metrics.returnStatementCount,
          metrics.branchCount,
          metrics.loopCount,
          metrics.tryCatchCount,
          metrics.asyncAwaitCount,
          metrics.callbackCount,
          metrics.commentLines,
          Number.isFinite(metrics.codeToCommentRatio) ? metrics.codeToCommentRatio : null,
          metrics.halsteadVolume ?? null,
          metrics.halsteadDifficulty ?? null,
          metrics.maintainabilityIndex ?? null,
        ]
      );
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save metrics: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save metrics for multiple functions
   */
  async saveMetricsBatch(functions: FunctionInfo[]): Promise<void> {
    const functionsWithMetrics = functions.filter(f => f.metrics);
    if (functionsWithMetrics.length === 0) return;

    try {
      // Use optimal batch size
      const batchSize = BatchProcessor.calculateFunctionBatchSize(functionsWithMetrics);
      
      // Process in batches
      for (let i = 0; i < functionsWithMetrics.length; i += batchSize) {
        const batch = functionsWithMetrics.slice(i, i + batchSize);
        
        if (batch.length >= 10) {
          await this.bulkInsertMetrics(batch);
        } else {
          // For small batches, use individual inserts
          for (const func of batch) {
            if (func.metrics) {
              await this.saveMetrics(func.id, func.snapshotId, func.metrics);
            }
          }
        }
      }
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save metrics batch: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update specific metrics for a function
   */
  async updateMetrics(
    functionId: string, 
    updates: Partial<QualityMetrics>
  ): Promise<void> {
    try {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      // Build dynamic update query
      for (const [key, value] of Object.entries(updates)) {
        const columnName = this.camelToSnake(key);
        setClauses.push(`${columnName} = $${paramIndex}`);
        values.push(value ?? null);
        paramIndex++;
      }

      if (setClauses.length === 0) return;

      values.push(functionId); // Add function_id as last parameter

      await this.db.query(
        `UPDATE quality_metrics SET ${setClauses.join(', ')} 
         WHERE function_id = $${paramIndex}`,
        values
      );
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to update metrics: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete metrics for a function
   */
  async deleteMetrics(functionId: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        'DELETE FROM quality_metrics WHERE function_id = $1',
        [functionId]
      );
      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to delete metrics: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get aggregate metrics for a snapshot
   */
  async getSnapshotMetrics(snapshotId: string): Promise<{
    totalFunctions: number;
    avgComplexity: number;
    maxComplexity: number;
    avgLinesOfCode: number;
    totalLinesOfCode: number;
    complexityDistribution: Record<string, number>;
  }> {
    try {
      const result = await this.db.query(
        `
        SELECT 
          COUNT(*) as total_functions,
          AVG(q.cyclomatic_complexity) as avg_complexity,
          MAX(q.cyclomatic_complexity) as max_complexity,
          AVG(q.lines_of_code) as avg_lines,
          SUM(q.lines_of_code) as total_lines,
          SUM(CASE WHEN q.cyclomatic_complexity <= 5 THEN 1 ELSE 0 END) as low_complexity,
          SUM(CASE WHEN q.cyclomatic_complexity > 5 AND q.cyclomatic_complexity <= 10 THEN 1 ELSE 0 END) as medium_complexity,
          SUM(CASE WHEN q.cyclomatic_complexity > 10 AND q.cyclomatic_complexity <= 20 THEN 1 ELSE 0 END) as high_complexity,
          SUM(CASE WHEN q.cyclomatic_complexity > 20 THEN 1 ELSE 0 END) as very_high_complexity
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        WHERE f.snapshot_id = $1
        `,
        [snapshotId]
      );

      const row = result.rows[0] as {
        total_functions: string;
        avg_complexity: string;
        max_complexity: string;
        avg_lines: string;
        total_lines: string;
        low_complexity: string;
        medium_complexity: string;
        high_complexity: string;
        very_high_complexity: string;
      };
      return {
        totalFunctions: parseInt(row.total_functions) || 0,
        avgComplexity: parseFloat(row.avg_complexity) || 0,
        maxComplexity: parseInt(row.max_complexity) || 0,
        avgLinesOfCode: parseFloat(row.avg_lines) || 0,
        totalLinesOfCode: parseInt(row.total_lines) || 0,
        complexityDistribution: {
          low: parseInt(row.low_complexity) || 0,
          medium: parseInt(row.medium_complexity) || 0,
          high: parseInt(row.high_complexity) || 0,
          veryHigh: parseInt(row.very_high_complexity) || 0,
        },
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get snapshot metrics: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Find functions by metric thresholds
   */
  async findByMetricThresholds(options: {
    snapshotId?: string;
    minComplexity?: number;
    maxComplexity?: number;
    minLines?: number;
    maxLines?: number;
    minMaintainability?: number;
    maxMaintainability?: number;
  }): Promise<string[]> {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (options.snapshotId) {
        conditions.push(`f.snapshot_id = $${paramIndex++}`);
        params.push(options.snapshotId);
      }

      if (options.minComplexity !== undefined) {
        conditions.push(`q.cyclomatic_complexity >= $${paramIndex++}`);
        params.push(options.minComplexity);
      }

      if (options.maxComplexity !== undefined) {
        conditions.push(`q.cyclomatic_complexity <= $${paramIndex++}`);
        params.push(options.maxComplexity);
      }

      if (options.minLines !== undefined) {
        conditions.push(`q.lines_of_code >= $${paramIndex++}`);
        params.push(options.minLines);
      }

      if (options.maxLines !== undefined) {
        conditions.push(`q.lines_of_code <= $${paramIndex++}`);
        params.push(options.maxLines);
      }

      if (options.minMaintainability !== undefined) {
        conditions.push(`q.maintainability_index >= $${paramIndex++}`);
        params.push(options.minMaintainability);
      }

      if (options.maxMaintainability !== undefined) {
        conditions.push(`q.maintainability_index <= $${paramIndex++}`);
        params.push(options.maxMaintainability);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await this.db.query(
        `
        SELECT f.id
        FROM functions f
        JOIN quality_metrics q ON f.id = q.function_id
        ${whereClause}
        ORDER BY q.cyclomatic_complexity DESC
        `,
        params
      );

      return result.rows.map(row => (row as { id: string }).id);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to find functions by metric thresholds: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Private helper methods

  /**
   * Bulk insert metrics using UNNEST for better PGLite performance
   */
  private async bulkInsertMetrics(functions: FunctionInfo[]): Promise<void> {
    const metricsRows = functions
      .filter(func => func.metrics)
      .map(func => [
        func.id,
        func.snapshotId,
        func.metrics!.linesOfCode,
        func.metrics!.totalLines,
        func.metrics!.cyclomaticComplexity,
        func.metrics!.cognitiveComplexity,
        func.metrics!.maxNestingLevel,
        func.metrics!.parameterCount,
        func.metrics!.returnStatementCount,
        func.metrics!.branchCount,
        func.metrics!.loopCount,
        func.metrics!.tryCatchCount,
        func.metrics!.asyncAwaitCount,
        func.metrics!.callbackCount,
        func.metrics!.commentLines,
        Number.isFinite(func.metrics!.codeToCommentRatio) ? func.metrics!.codeToCommentRatio : null,
        func.metrics!.halsteadVolume ?? null,
        func.metrics!.halsteadDifficulty ?? null,
        func.metrics!.maintainabilityIndex ?? null,
      ]);

    if (metricsRows.length > 0) {
      await executeUnnestBulkInsert(
        (sql, params) => this.db.query(sql, params),
        'quality_metrics',
        [
          'function_id', 'snapshot_id', 'lines_of_code', 'total_lines', 'cyclomatic_complexity',
          'cognitive_complexity', 'max_nesting_level', 'parameter_count',
          'return_statement_count', 'branch_count', 'loop_count', 'try_catch_count',
          'async_await_count', 'callback_count', 'comment_lines', 'code_to_comment_ratio',
          'halstead_volume', 'halstead_difficulty', 'maintainability_index'
        ],
        metricsRows,
        {
          idempotent: true,
          onConflict: `ON CONFLICT (function_id, snapshot_id) DO UPDATE SET
            lines_of_code = EXCLUDED.lines_of_code,
            total_lines = EXCLUDED.total_lines,
            cyclomatic_complexity = EXCLUDED.cyclomatic_complexity,
            cognitive_complexity = EXCLUDED.cognitive_complexity,
            max_nesting_level = EXCLUDED.max_nesting_level,
            parameter_count = EXCLUDED.parameter_count,
            return_statement_count = EXCLUDED.return_statement_count,
            branch_count = EXCLUDED.branch_count,
            loop_count = EXCLUDED.loop_count,
            try_catch_count = EXCLUDED.try_catch_count,
            async_await_count = EXCLUDED.async_await_count,
            callback_count = EXCLUDED.callback_count,
            comment_lines = EXCLUDED.comment_lines,
            code_to_comment_ratio = EXCLUDED.code_to_comment_ratio,
            halstead_volume = EXCLUDED.halstead_volume,
            halstead_difficulty = EXCLUDED.halstead_difficulty,
            maintainability_index = EXCLUDED.maintainability_index`,
          logger: { log: (msg: string) => console.log(msg) }
        }
      );
    }
  }

  /**
   * Map database row to QualityMetrics
   */
  private mapRowToMetrics(row: MetricsRow): QualityMetrics {
    const metrics: QualityMetrics = {
      linesOfCode: row.lines_of_code,
      totalLines: row.total_lines || row.lines_of_code,
      cyclomaticComplexity: row.cyclomatic_complexity || 1,
      cognitiveComplexity: row.cognitive_complexity || 0,
      maxNestingLevel: row.max_nesting_level || 0,
      parameterCount: row.parameter_count || 0,
      returnStatementCount: row.return_statement_count || 0,
      branchCount: row.branch_count || 0,
      loopCount: row.loop_count || 0,
      tryCatchCount: row.try_catch_count || 0,
      asyncAwaitCount: row.async_await_count || 0,
      callbackCount: row.callback_count || 0,
      commentLines: row.comment_lines || 0,
      codeToCommentRatio: row.code_to_comment_ratio || 0,
    };
    
    // Only add optional properties if they have values
    if (row.halstead_volume !== null && row.halstead_volume !== undefined) {
      metrics.halsteadVolume = row.halstead_volume;
    }
    if (row.halstead_difficulty !== null && row.halstead_difficulty !== undefined) {
      metrics.halsteadDifficulty = row.halstead_difficulty;
    }
    if (row.maintainability_index !== null && row.maintainability_index !== undefined) {
      metrics.maintainabilityIndex = row.maintainability_index;
    }
    
    return metrics;
  }

  /**
   * Convert camelCase to snake_case
   */
  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  // ========================================
  // NAMING EVALUATION METHODS
  // ========================================

  async saveNamingEvaluation(evaluation: Record<string, unknown>): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO naming_evaluations (
          function_id, overall_score, suggestions, revision_needed, evaluated_by, evaluated_at, updated_at
        ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
        ON CONFLICT (function_id) DO UPDATE SET
          overall_score = EXCLUDED.overall_score,
          suggestions = EXCLUDED.suggestions,
          revision_needed = EXCLUDED.revision_needed,
          evaluated_by = EXCLUDED.evaluated_by,
          updated_at = EXCLUDED.updated_at
        `,
        [
          evaluation['functionId'],
          evaluation['rating'] || 0,                           // rating → overall_score へマップ
          JSON.stringify(evaluation['suggestions'] || []),
          evaluation['revisionNeeded'] || false,
          evaluation['model'] || 'unknown',                    // model → evaluated_by へマップ
          new Date().toISOString(),                            // evaluated_at
          new Date().toISOString()                             // updated_at
        ]
      );
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save naming evaluation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getNamingEvaluation(functionId: string): Promise<{
    functionId: string;
    rating: number;
    issues: string[];
    suggestions: string[];
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM naming_evaluations WHERE function_id = $1',
        [functionId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as {
        function_id: string;
        overall_score: number;
        suggestions: string;
        revision_needed: boolean;
        evaluated_by: string;
        evaluated_at: string;
        updated_at: string;
      };
      return {
        functionId: row.function_id,
        rating: row.overall_score,
        issues: [], // スキーマに issues がないため空配列で整合
        suggestions: this.context.utilityOps?.parseJsonSafely(row.suggestions, []) ?? [],
        createdAt: new Date(row.evaluated_at),
        updatedAt: new Date(row.updated_at)
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get naming evaluation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getFunctionsNeedingEvaluation(snapshotId: string, options?: { limit?: number }): Promise<Array<{ functionId: string; functionName: string; lastModified: number }>> {
    try {
      let sql = `
        SELECT f.id as functionId, f.name as functionName,
               COALESCE(ne.updated_at, f.created_at) as lastModified
        FROM functions f
        LEFT JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1
        AND (ne.function_id IS NULL OR ne.revision_needed = true)
      `;
      
      const params: unknown[] = [snapshotId];
      
      if (options?.limit) {
        sql += ' LIMIT $2';
        params.push(options.limit);
      }

      const result = await this.db.query(sql, params);
      
      return result.rows.map(row => {
        const r = row as {
          functionid: string;
          functionname: string;
          lastmodified: string;
        };
        return {
          functionId: r.functionid,
          functionName: r.functionname,
          lastModified: new Date(r.lastmodified).getTime()
        };
      });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get functions needing evaluation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getFunctionsWithEvaluations(snapshotId: string, options?: { limit?: number }): Promise<Array<{ 
    functionId: string; 
    evaluation: {
      functionId: string;
      rating: number;
      issues: string[];
      suggestions: string[];
      createdAt: Date;
      updatedAt: Date;
    }
  }>> {
    try {
      let sql = `
        SELECT ne.*
        FROM functions f
        INNER JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1
      `;
      
      const params: unknown[] = [snapshotId];
      
      if (options?.limit) {
        sql += ' LIMIT $2';
        params.push(options.limit);
      }

      const result = await this.db.query(sql, params);
      
      return result.rows.map(row => {
        const r = row as {
          function_id: string;
          overall_score: number;
          suggestions: string;
          revision_needed: boolean;
          evaluated_by: string;
          evaluated_at: string;
          updated_at: string;
        };
        return {
          functionId: r.function_id,
          evaluation: {
            functionId: r.function_id,
            rating: r.overall_score,
            issues: [], // スキーマに issues がないため空配列で整合
            suggestions: this.context.utilityOps?.parseJsonSafely(r.suggestions, []) ?? [],
            createdAt: new Date(r.evaluated_at),
            updatedAt: new Date(r.updated_at)
          }
        };
      });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get functions with evaluations: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async updateEvaluationRevisionStatus(functionId: string, revisionNeeded: boolean): Promise<void> {
    try {
      await this.db.query(
        'UPDATE naming_evaluations SET revision_needed = $1, updated_at = CURRENT_TIMESTAMP WHERE function_id = $2',
        [revisionNeeded, functionId]
      );
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to update evaluation revision status: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async batchSaveEvaluations(evaluations: Array<{
    functionId: string;
    rating: number;
    issues: string[];
    suggestions: string[];
    createdAt: Date;
    updatedAt: Date;
  }>): Promise<void> {
    if (evaluations.length === 0) return;
    
    try {
      for (const evaluation of evaluations) {
        await this.saveNamingEvaluation(evaluation);
      }
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to batch save evaluations: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getEvaluationStatistics(snapshotId: string): Promise<{
    total: number;
    withEvaluations: number;
    needingEvaluation: number;
    averageRating: number;
    ratingDistribution: Record<1 | 2 | 3, number>;
  }> {
    const query = `
      SELECT 
        COUNT(f.id) as total,
        COUNT(ne.function_id) as with_evaluations,
        COUNT(CASE WHEN ne.function_id IS NULL OR ne.revision_needed = true THEN 1 END) as needing_evaluation,
        AVG(ne.overall_score) as average_rating,
        COUNT(CASE WHEN ne.overall_score = 1 THEN 1 END) as rating_1,
        COUNT(CASE WHEN ne.overall_score = 2 THEN 1 END) as rating_2,
        COUNT(CASE WHEN ne.overall_score = 3 THEN 1 END) as rating_3
      FROM functions f
      LEFT JOIN naming_evaluations ne ON f.id = ne.function_id
      WHERE f.snapshot_id = $1
    `;

    const result = await this.db.query(query, [snapshotId]);
    const row = result.rows[0] as {
      total: string;
      with_evaluations: string;
      needing_evaluation: string;
      average_rating: string;
      rating_1: string;
      rating_2: string;
      rating_3: string;
    };

    return {
      total: parseInt(row.total) || 0,
      withEvaluations: parseInt(row.with_evaluations) || 0,
      needingEvaluation: parseInt(row.needing_evaluation) || 0,
      averageRating: parseFloat(row.average_rating) || 0,
      ratingDistribution: {
        1: parseInt(row.rating_1) || 0,
        2: parseInt(row.rating_2) || 0,
        3: parseInt(row.rating_3) || 0,
      }
    };
  }
}