/**
 * Embedding operations module for PGLite storage
 * Handles vector embeddings and similarity search
 */

import { 
  FunctionInfo, 
  FunctionRow,
  MetricsRow,
  ParameterInfo
} from '../../types';
import { SnapshotRow } from '../../types/common';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext, StorageOperationModule } from './types';
import { EmbeddingService } from '../../services/embedding-service';

export interface EmbeddingInfo {
  semanticId: string;
  embeddingModel: string;
  vectorDimension: number;
  embedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EmbeddingStats {
  totalEmbeddings: number;
  byModel: Record<string, number>;
  avgDimension: number;
  functionsWithEmbeddings: number;
  functionsWithoutEmbeddings: number;
}

export class EmbeddingOperations implements StorageOperationModule {
  readonly db;
  readonly kysely;
  private logger;

  constructor(context: StorageContext) {
    this.db = context.db;
    this.kysely = context.kysely;
    this.logger = context.logger;
  }

  /**
   * Save an embedding for a function
   */
  async saveEmbedding(
    semanticId: string,
    embedding: number[],
    model: string = 'text-embedding-ada-002'
  ): Promise<void> {
    try {
      // Convert array to PostgreSQL array literal
      const embeddingStr = `{${embedding.join(',')}}`;

      await this.db.query(
        `
        INSERT INTO function_embeddings (semantic_id, embedding_model, vector_dimension, embedding)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (semantic_id) 
        DO UPDATE SET 
          embedding_model = EXCLUDED.embedding_model,
          vector_dimension = EXCLUDED.vector_dimension,
          embedding = EXCLUDED.embedding,
          updated_at = CURRENT_TIMESTAMP
        `,
        [semanticId, model, embedding.length, embeddingStr]
      );
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save embedding: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get embedding for a function
   */
  async getEmbedding(semanticId: string): Promise<EmbeddingInfo | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM function_embeddings WHERE semantic_id = $1',
        [semanticId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as {
        semantic_id: string;
        embedding_model: string;
        vector_dimension: number;
        embedding: number[];
        created_at: string;
        updated_at: string;
      };
      return {
        semanticId: row.semantic_id,
        embeddingModel: row.embedding_model,
        vectorDimension: row.vector_dimension,
        embedding: row.embedding,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get embedding: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Search functions by embedding similarity
   */
  async searchByEmbedding(
    queryEmbedding: number[],
    threshold: number = 0.8,
    limit: number = 10
  ): Promise<Array<FunctionInfo & { similarity: number }>> {
    try {
      // Get the latest snapshot
      const snapshots = await this.db.query(`
        SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1
      `);
      
      if (snapshots.rows.length === 0) {
        return [];
      }

      // Since PGLite doesn't have native vector operations, we calculate similarity in application
      const embeddings = await this.db.query(
        `
        SELECT 
          f.id, f.snapshot_id, f.start_line, f.end_line, f.start_column, f.end_column,
          f.created_at, f.semantic_id, f.name, f.display_name, f.signature, f.file_path,
          f.context_path, f.function_type, f.modifiers, f.nesting_level, f.is_exported,
          f.is_async, f.is_generator, f.is_arrow_function, f.is_method, f.is_constructor,
          f.is_static, f.access_modifier, f.content_id, f.ast_hash, f.source_code,
          f.signature_hash, f.file_hash, f.file_content_hash, 
          e.embedding,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        INNER JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.snapshot_id = $1
        `,
        [(snapshots.rows[0] as SnapshotRow).id]
      );

      // Calculate similarities and filter
      type EmbeddingSearchRow = FunctionRow &
        Partial<MetricsRow> & {
          embedding: number[];
          description?: string;
        };

      const results: Array<{ row: EmbeddingSearchRow; similarity: number }> = [];

      for (const row of embeddings.rows) {
        const rowData = row as EmbeddingSearchRow;
        const embedding = rowData.embedding;
        const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, embedding);

        if (similarity >= threshold) {
          results.push({ row: rowData, similarity });
        }
      }

      // Sort by similarity descending
      results.sort((a, b) => b.similarity - a.similarity);

      // Take top N results
      const topResults = results.slice(0, limit);

      // Map to FunctionInfo with similarity
      const functions = await Promise.all(
        topResults.map(async ({ row, similarity }) => {
          const parameters = await this.getFunctionParameters(row.id);
          const functionInfo = this.mapRowToFunctionInfo(
            row as FunctionRow & Partial<MetricsRow>,
            parameters
          );
          return { ...functionInfo, similarity };
        })
      );

      return functions;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to search by embedding: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Bulk save embeddings
   */
  async bulkSaveEmbeddings(
    embeddings: Array<{
      semanticId: string;
      embedding: number[];
      model?: string;
    }>
  ): Promise<void> {
    if (embeddings.length === 0) return;

    try {
      const values = embeddings.map(({ semanticId, embedding, model = 'text-embedding-ada-002' }) => ({
        semantic_id: semanticId,
        embedding_model: model,
        vector_dimension: embedding.length,
        embedding: `{${embedding.join(',')}}`,
      }));

      // Use direct SQL for bulk insert with conflict resolution
      const placeholders = values.map((_, i) => {
        const base = i * 4;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      }).join(', ');
      
      const params: unknown[] = [];
      for (const value of values) {
        params.push(value.semantic_id, value.embedding_model, value.vector_dimension, value.embedding);
      }
      
      await this.db.query(`
        INSERT INTO function_embeddings (semantic_id, embedding_model, vector_dimension, embedding)
        VALUES ${placeholders}
        ON CONFLICT (semantic_id) DO UPDATE SET
          embedding_model = EXCLUDED.embedding_model,
          vector_dimension = EXCLUDED.vector_dimension,
          embedding = EXCLUDED.embedding,
          updated_at = CURRENT_TIMESTAMP
      `, params);

      this.logger?.log(`Bulk saved ${embeddings.length} embeddings`);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to bulk save embeddings: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get functions without embeddings
   */
  async getFunctionsWithoutEmbeddings(snapshotId?: string): Promise<FunctionInfo[]> {
    try {
      let whereClause = 'WHERE e.semantic_id IS NULL';
      const params: unknown[] = [];
      
      if (snapshotId) {
        whereClause += ' AND f.snapshot_id = $1';
        params.push(snapshotId);
      }

      const result = await this.db.query(
        `
        SELECT f.*, q.lines_of_code, q.cyclomatic_complexity, q.cognitive_complexity
        FROM functions f
        LEFT JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        ${whereClause}
        ORDER BY f.start_line
        `,
        params
      );

      const functions = await Promise.all(
        result.rows.map(async (row) => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(
            row as FunctionRow & Partial<MetricsRow>,
            parameters
          );
        })
      );

      return functions;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get functions without embeddings: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get functions with embeddings
   */
  async getFunctionsWithEmbeddings(snapshotId?: string): Promise<FunctionInfo[]> {
    try {
      let whereClause = 'WHERE e.semantic_id IS NOT NULL';
      const params: unknown[] = [];
      
      if (snapshotId) {
        whereClause += ' AND f.snapshot_id = $1';
        params.push(snapshotId);
      }

      const result = await this.db.query(
        `
        SELECT f.*, q.lines_of_code, q.cyclomatic_complexity, q.cognitive_complexity
        FROM functions f
        INNER JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        ${whereClause}
        ORDER BY f.start_line
        `,
        params
      );

      const functions = await Promise.all(
        result.rows.map(async (row) => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(
            row as FunctionRow & Partial<MetricsRow>,
            parameters
          );
        })
      );

      return functions;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get functions with embeddings: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get embedding statistics
   */
  async getEmbeddingStats(): Promise<EmbeddingStats> {
    try {
      const [embeddingResult, functionResult] = await Promise.all([
        this.db.query(`
          SELECT 
            COUNT(*) as total_embeddings,
            embedding_model,
            AVG(vector_dimension) as avg_dimension
          FROM function_embeddings
          GROUP BY embedding_model
        `),
        this.db.query(`
          SELECT 
            COUNT(CASE WHEN e.semantic_id IS NOT NULL THEN 1 END) as with_embeddings,
            COUNT(CASE WHEN e.semantic_id IS NULL THEN 1 END) as without_embeddings
          FROM functions f
          LEFT JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        `)
      ]);

      const byModel: Record<string, number> = {};
      let totalEmbeddings = 0;
      let avgDimension = 0;

      for (const row of embeddingResult.rows) {
        const rowData = row as {
          embedding_model: string;
          total_embeddings: string;
          avg_dimension: string;
        };
        byModel[rowData.embedding_model] = parseInt(rowData.total_embeddings);
        totalEmbeddings += parseInt(rowData.total_embeddings);
        avgDimension = parseFloat(rowData.avg_dimension) || 0;
      }

      const functionData = functionResult.rows[0] as {
        with_embeddings: string;
        without_embeddings: string;
      };

      return {
        totalEmbeddings,
        byModel,
        avgDimension,
        functionsWithEmbeddings: parseInt(functionData.with_embeddings) || 0,
        functionsWithoutEmbeddings: parseInt(functionData.without_embeddings) || 0,
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get embedding stats: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete embedding for a function
   */
  async deleteEmbedding(semanticId: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        'DELETE FROM function_embeddings WHERE semantic_id = $1',
        [semanticId]
      );
      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to delete embedding: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update embedding for a function
   */
  async updateEmbedding(
    semanticId: string,
    embedding: number[],
    model?: string
  ): Promise<void> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    updates.push(`embedding = $${paramIndex++}`);
    values.push(`{${embedding.join(',')}}`);

    updates.push(`vector_dimension = $${paramIndex++}`);
    values.push(embedding.length);

    if (model) {
      updates.push(`embedding_model = $${paramIndex++}`);
      values.push(model);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(semanticId); // WHERE clause

    try {
      const result = await this.db.query(
        `UPDATE function_embeddings SET ${updates.join(', ')} WHERE semantic_id = $${paramIndex}`,
        values
      );

      if ((result as unknown as { changes: number }).changes === 0) {
        throw new Error(`No embedding found for semantic_id: ${semanticId}`);
      }
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to update embedding: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Private helper methods

  private async getFunctionParameters(functionId: string): Promise<ParameterInfo[]> {
    const result = await this.db.query(
      'SELECT * FROM function_parameters WHERE function_id = $1 ORDER BY position',
      [functionId]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      name: row.name,
      type: row.type || undefined,
      typeSimple: row.type_simple || undefined,
      position: row.position || 0,
      isOptional: row.is_optional || false,
      isRest: row.is_rest || false,
      defaultValue: row.default_value || undefined,
    }));
  }

  private mapRowToFunctionInfo(
    row: FunctionRow & Partial<MetricsRow>,
    parameters: ParameterInfo[]
  ): FunctionInfo {
    return {
      id: row.id,
      semanticId: row.semantic_id,
      contentId: row.content_id,
      name: row.name,
      displayName: row.display_name || row.name,
      signature: row.signature,
      signatureHash: row.signature_hash,
      filePath: row.file_path,
      fileHash: row.file_hash,
      startLine: row.start_line,
      endLine: row.end_line,
      startColumn: row.start_column,
      endColumn: row.end_column,
      astHash: row.ast_hash,
      contextPath: row.context_path || [],
      functionType: (row.function_type as 'function' | 'method' | 'arrow' | 'local') || 'function',
      modifiers: Array.isArray(row.modifiers) 
        ? row.modifiers 
        : (row.modifiers && typeof row.modifiers === 'string' ? (row.modifiers as string).split(',') : []),
      nestingLevel: row.nesting_level || 0,
      isExported: row.is_exported || false,
      isAsync: row.is_async || false,
      isGenerator: row.is_generator || false,
      isArrowFunction: row.is_arrow_function || false,
      isMethod: row.is_method || false,
      isConstructor: row.is_constructor || false,
      isStatic: row.is_static || false,
      accessModifier: (row.access_modifier as 'public' | 'private' | 'protected') || undefined,
      sourceCode: row.source_code || '',
      parameters,
    };
  }
}