import { PGlite } from '@electric-sql/pglite';
import simpleGit, { SimpleGit } from 'simple-git';
import { 
  FunctionInfo, 
  SnapshotInfo, 
  StorageAdapter, 
  QueryOptions, 
  SnapshotMetadata,
  SnapshotDiff,
  FunctionChange,
  ChangeDetail,
  DiffStatistics,
  SnapshotRow,
  FunctionRow,
  ParameterRow,
  MetricsRow,
  ParameterInfo,
  QualityMetrics,
  FunctionDescription
} from '../types';
import { BatchProcessor, TransactionalBatchProcessor, BatchTransactionProcessor } from '../utils/batch-processor';

/**
 * Clean PGLite storage adapter implementation
 * Focuses on type safety, proper error handling, and clean architecture
 */
export class PGLiteStorageAdapter implements StorageAdapter {
  private db: PGlite;
  private git: SimpleGit;
  private transactionDepth: number = 0;

  constructor(dbPath: string) {
    this.db = new PGlite(dbPath);
    this.git = simpleGit();
  }

  async init(): Promise<void> {
    try {
      await this.db.waitReady;
      await this.createSchema();
      await this.createIndexes();
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async close(): Promise<void> {
    try {
      await this.db.close();
    } catch (error) {
      throw new Error(`Failed to close database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ========================================
  // SNAPSHOT OPERATIONS
  // ========================================

  async saveSnapshot(functions: FunctionInfo[], label?: string): Promise<string> {
    const snapshotId = this.generateSnapshotId();
    
    try {
      // Create snapshot record
      await this.createSnapshotRecord(snapshotId, functions, label);
      
      // Save functions in batch
      await this.saveFunctions(snapshotId, functions);
      
      return snapshotId;
    } catch (error) {
      throw new Error(`Failed to save snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]> {
    try {
      let sql = 'SELECT * FROM snapshots ORDER BY created_at DESC';
      const params: (string | number)[] = [];

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
      throw new Error(`Failed to get snapshots: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSnapshot(id: string): Promise<SnapshotInfo | null> {
    try {
      const result = await this.db.query('SELECT * FROM snapshots WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToSnapshotInfo(result.rows[0] as SnapshotRow);
    } catch (error) {
      throw new Error(`Failed to get snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteSnapshot(id: string): Promise<boolean> {
    try {
      const result = await this.db.query('DELETE FROM snapshots WHERE id = $1', [id]);
      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new Error(`Failed to delete snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ========================================
  // FUNCTION OPERATIONS
  // ========================================

  async getFunctions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      let sql = `
        SELECT 
          f.*,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        WHERE f.snapshot_id = $1
      `;
      const params: (string | number | unknown)[] = [snapshotId];

      // Add filters if provided
      if (options?.filters && options.filters.length > 0) {
        const filterClauses = options.filters.map((filter) => {
          if (filter.operator === 'KEYWORD') {
            // Handle keyword search across multiple fields
            params.push(`%${filter.value}%`);
            params.push(`%${filter.value}%`);
            params.push(`%${filter.value}%`);
            return `(
              f.name ILIKE $${params.length - 2} OR 
              f.js_doc ILIKE $${params.length - 1} OR 
              f.source_code ILIKE $${params.length}
            )`;
          } else {
            params.push(filter.value);
            return `f.${filter.field} ${filter.operator} $${params.length}`;
          }
        });
        sql += ' AND ' + filterClauses.join(' AND ');
      }

      // Add sorting with validation and proper field mapping
      const validSortFields = new Map([
        ['name', 'f.name'],
        ['file_path', 'f.file_path'], 
        ['start_line', 'f.start_line'],
        ['complexity', 'q.cyclomatic_complexity'],
        ['lines_of_code', 'q.lines_of_code'],
        ['parameter_count', 'q.parameter_count'],
        ['is_exported', 'f.is_exported'],
        ['is_async', 'f.is_async'],
        ['display_name', 'f.display_name']
      ]);
      
      const sortColumn = options?.sort && validSortFields.has(options.sort) 
        ? validSortFields.get(options.sort)!
        : 'f.start_line';
      
      sql += ` ORDER BY ${sortColumn}`;

      // Add pagination
      if (options?.limit) {
        sql += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      // Get parameters for each function
      const functions = await Promise.all(
        result.rows.map(async (row) => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to get functions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsBySnapshot(snapshotId: string): Promise<FunctionInfo[]> {
    try {
      const result = await this.db.query(`
        SELECT f.*, qm.*
        FROM functions f
        LEFT JOIN quality_metrics qm ON f.id = qm.function_id
        WHERE f.snapshot_id = $1
        ORDER BY f.start_line
      `, [snapshotId]);

      // Get parameters for each function
      const functions = await Promise.all(
        result.rows.map(async (row) => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to get functions for snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async queryFunctions(options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      // Get the latest snapshot
      const snapshots = await this.getSnapshots({ sort: 'created_at', limit: 1 });
      if (snapshots.length === 0) {
        return [];
      }
      
      // Use the latest snapshot to get functions
      return await this.getFunctions(snapshots[0].id, options);
    } catch (error) {
      throw new Error(`Failed to query functions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ========================================
  // ANALYSIS OPERATIONS (FUTURE)
  // ========================================

  async diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff> {
    try {
      const { fromSnapshot, toSnapshot } = await this.validateAndLoadSnapshots(fromId, toId);
      const { fromFunctions, toFunctions } = await this.loadSnapshotFunctions(fromId, toId);
      const diff = this.calculateSnapshotDifferences(fromFunctions, toFunctions);
      const statistics = this.calculateDiffStatistics(fromFunctions, toFunctions, diff.added, diff.removed, diff.modified);

      return {
        from: fromSnapshot,
        to: toSnapshot,
        ...diff,
        statistics
      };
    } catch (error) {
      throw new Error(`Failed to diff snapshots: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async validateAndLoadSnapshots(fromId: string, toId: string) {
    const fromSnapshot = await this.getSnapshot(fromId);
    const toSnapshot = await this.getSnapshot(toId);

    if (!fromSnapshot || !toSnapshot) {
      throw new Error(`Snapshot not found: ${!fromSnapshot ? fromId : toId}`);
    }

    return { fromSnapshot, toSnapshot };
  }

  private async loadSnapshotFunctions(fromId: string, toId: string) {
    const fromFunctions = await this.getFunctionsBySnapshot(fromId);
    const toFunctions = await this.getFunctionsBySnapshot(toId);
    return { fromFunctions, toFunctions };
  }

  private calculateSnapshotDifferences(fromFunctions: FunctionInfo[], toFunctions: FunctionInfo[]) {
    const fromMap = new Map(fromFunctions.map((f: FunctionInfo) => [f.signature, f]));
    const toMap = new Map(toFunctions.map((f: FunctionInfo) => [f.signature, f]));

    const added: FunctionInfo[] = [];
    const removed: FunctionInfo[] = [];
    const modified: FunctionChange[] = [];
    const unchanged: FunctionInfo[] = [];

    this.categorizeChangedFunctions(toFunctions, fromMap, added, modified, unchanged);
    this.findRemovedFunctions(fromFunctions, toMap, removed);

    return { added, removed, modified, unchanged };
  }

  private categorizeChangedFunctions(
    toFunctions: FunctionInfo[], 
    fromMap: Map<string, FunctionInfo>, 
    added: FunctionInfo[], 
    modified: FunctionChange[], 
    unchanged: FunctionInfo[]
  ) {
    for (const toFunc of toFunctions) {
      const fromFunc = fromMap.get(toFunc.signature);
      
      if (!fromFunc) {
        added.push(toFunc);
      } else if (fromFunc.astHash !== toFunc.astHash) {
        modified.push({
          before: fromFunc,
          after: toFunc,
          changes: this.calculateFunctionChanges(fromFunc, toFunc)
        });
      } else {
        unchanged.push(toFunc);
      }
    }
  }

  private findRemovedFunctions(fromFunctions: FunctionInfo[], toMap: Map<string, FunctionInfo>, removed: FunctionInfo[]) {
    for (const fromFunc of fromFunctions) {
      if (!toMap.has(fromFunc.signature)) {
        removed.push(fromFunc);
      }
    }
  }

  private calculateFunctionChanges(fromFunc: FunctionInfo, toFunc: FunctionInfo): ChangeDetail[] {
    const changes: ChangeDetail[] = [];

    // Compare metrics if both have them
    if (fromFunc.metrics && toFunc.metrics) {
      const metricsToCompare = [
        { key: 'cyclomaticComplexity' as const, name: 'cyclomaticComplexity' },
        { key: 'linesOfCode' as const, name: 'linesOfCode' },
        { key: 'cognitiveComplexity' as const, name: 'cognitiveComplexity' },
        { key: 'parameterCount' as const, name: 'parameterCount' }
      ];
      
      for (const { key, name } of metricsToCompare) {
        const oldValue = fromFunc.metrics[key];
        const newValue = toFunc.metrics[key];
        
        if (oldValue !== newValue) {
          changes.push({
            field: name,
            oldValue,
            newValue,
            impact: this.calculateChangeImpact(name, oldValue, newValue)
          });
        }
      }
    }

    // Compare basic properties
    const basicPropsToCompare = [
      { key: 'name' as const },
      { key: 'filePath' as const },
      { key: 'startLine' as const },
      { key: 'endLine' as const }
    ];
    
    for (const { key } of basicPropsToCompare) {
      const oldValue = fromFunc[key];
      const newValue = toFunc[key];
      
      if (oldValue !== newValue) {
        changes.push({
          field: key,
          oldValue,
          newValue,
          impact: 'low'
        });
      }
    }

    return changes;
  }

  private calculateChangeImpact(metric: string, oldValue: number, newValue: number): 'low' | 'medium' | 'high' {
    const diff = Math.abs(newValue - oldValue);
    const relativeChange = diff / Math.max(oldValue, 1);

    switch (metric) {
      case 'cyclomaticComplexity':
      case 'cognitiveComplexity':
        if (diff >= 5 || relativeChange >= 0.5) return 'high';
        if (diff >= 2 || relativeChange >= 0.2) return 'medium';
        return 'low';
      
      case 'linesOfCode':
        if (diff >= 50 || relativeChange >= 1.0) return 'high';
        if (diff >= 20 || relativeChange >= 0.5) return 'medium';
        return 'low';
      
      default:
        if (relativeChange >= 0.5) return 'high';
        if (relativeChange >= 0.2) return 'medium';
        return 'low';
    }
  }

  private calculateDiffStatistics(fromFunctions: FunctionInfo[], toFunctions: FunctionInfo[], added: FunctionInfo[], removed: FunctionInfo[], modified: FunctionChange[]): DiffStatistics {
    const fromMetrics = this.aggregateMetrics(fromFunctions);
    const toMetrics = this.aggregateMetrics(toFunctions);

    return {
      totalChanges: added.length + removed.length + modified.length,
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      complexityChange: toMetrics.avgComplexity - fromMetrics.avgComplexity,
      linesChange: toMetrics.totalLines - fromMetrics.totalLines
    };
  }

  private aggregateMetrics(functions: FunctionInfo[]): { avgComplexity: number; totalLines: number } {
    if (functions.length === 0) {
      return { avgComplexity: 0, totalLines: 0 };
    }

    const totalComplexity = functions.reduce((sum, f) => 
      sum + (f.metrics?.cyclomaticComplexity || 1), 0);
    const totalLines = functions.reduce((sum, f) => 
      sum + (f.metrics?.linesOfCode || 0), 0);

    return {
      avgComplexity: totalComplexity / functions.length,
      totalLines
    };
  }

  // ========================================
  // FUNCTION DESCRIPTION OPERATIONS
  // ========================================

  async saveFunctionDescription(description: FunctionDescription): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO function_descriptions (
          function_id, description, source, created_at, updated_at, created_by, ai_model, confidence_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (function_id) 
        DO UPDATE SET 
          description = EXCLUDED.description,
          source = EXCLUDED.source,
          updated_at = EXCLUDED.updated_at,
          created_by = EXCLUDED.created_by,
          ai_model = EXCLUDED.ai_model,
          confidence_score = EXCLUDED.confidence_score
      `, [
        description.functionId,
        description.description,
        description.source,
        new Date(description.createdAt).toISOString(),
        new Date(description.updatedAt).toISOString(),
        description.createdBy || null,
        description.aiModel || null,
        description.confidenceScore || null
      ]);
    } catch (error) {
      throw new Error(`Failed to save function description: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionDescription(functionId: string): Promise<FunctionDescription | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM function_descriptions WHERE function_id = $1',
        [functionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as {
        function_id: string;
        description: string;
        source: string;
        created_at: string;
        updated_at: string;
        created_by?: string;
        ai_model?: string;
        confidence_score?: number;
      };
      return {
        functionId: row.function_id,
        description: row.description,
        source: row.source as 'human' | 'ai' | 'jsdoc',
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        ...(row.created_by && { createdBy: row.created_by }),
        ...(row.ai_model && { aiModel: row.ai_model }),
        ...(row.confidence_score !== null && { confidenceScore: row.confidence_score })
      };
    } catch (error) {
      throw new Error(`Failed to get function description: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsNeedingDescriptions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      // Query functions where:
      // 1. No description exists, OR
      // 2. Function was created/modified after the description was last updated
      let sql = `
        SELECT 
          f.*,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.parameter_count, q.max_nesting_level, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.maintainability_index, q.halstead_volume, q.halstead_difficulty, q.code_to_comment_ratio
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.id = d.function_id
        WHERE f.snapshot_id = $1 
        AND (
          d.function_id IS NULL 
          OR f.created_at > d.updated_at
        )
      `;
      
      const params: (string | number)[] = [snapshotId];
      
      if (options?.limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(options.limit);
      }
      
      if (options?.offset) {
        sql += ' OFFSET $' + (params.length + 1);
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      // Get parameters for each function
      const functions = await Promise.all(
        result.rows.map(async (row) => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to get functions needing descriptions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async searchFunctionsByDescription(keyword: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      // Get the latest snapshot
      const snapshots = await this.getSnapshots({ sort: 'created_at', limit: 1 });
      if (snapshots.length === 0) {
        return [];
      }

      let sql = `
        SELECT 
          f.*,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.id = d.function_id
        WHERE f.snapshot_id = $1 AND (
          f.name ILIKE $2 OR 
          f.js_doc ILIKE $2 OR 
          f.source_code ILIKE $2 OR
          d.description ILIKE $2
        )
      `;
      const params: (string | number)[] = [snapshots[0].id, `%${keyword}%`];

      // Add pagination
      if (options?.limit) {
        sql += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      // Get parameters for each function
      const functions = await Promise.all(
        result.rows.map(async (row) => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to search functions by description: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsWithDescriptions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      let sql = `
        SELECT 
          f.*,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.id = d.function_id
        WHERE f.snapshot_id = $1 AND d.description IS NOT NULL
      `;
      const params: (string | number)[] = [snapshotId];

      // Add pagination
      if (options?.limit) {
        sql += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      const functions = await Promise.all(
        result.rows.map(async (row) => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to get functions with descriptions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsWithoutDescriptions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      let sql = `
        SELECT 
          f.*,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.id = d.function_id
        WHERE f.snapshot_id = $1 AND d.description IS NULL
      `;
      const params: (string | number)[] = [snapshotId];

      // Add pagination
      if (options?.limit) {
        sql += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      const functions = await Promise.all(
        result.rows.map(async (row) => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to get functions without descriptions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ========================================
  // MAINTENANCE OPERATIONS (FUTURE)
  // ========================================

  async cleanup(): Promise<number> {
    throw new Error('cleanup not implemented yet');
  }

  async backup(): Promise<string> {
    throw new Error('backup not implemented yet');
  }

  async restore(): Promise<void> {
    throw new Error('restore not implemented yet');
  }

  // ========================================
  // TRANSACTION MANAGEMENT
  // ========================================
  
  /**
   * Execute operations within a database transaction
   * Provides automatic rollback on errors and commit on success
   */
  async executeInTransaction<T>(operation: () => Promise<T>): Promise<T> {
    // Check for nested transactions
    if (this.transactionDepth > 0) {
      throw new Error('Nested transactions are not supported. Use savepoints if nested transaction behavior is needed.');
    }
    
    this.transactionDepth++;
    await this.db.query('BEGIN');
    try {
      const result = await operation();
      await this.db.query('COMMIT');
      return result;
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  
  /**
   * Begin a database transaction manually
   */
  async beginTransaction(): Promise<void> {
    await this.db.query('BEGIN');
  }
  
  /**
   * Commit the current transaction
   */
  async commitTransaction(): Promise<void> {
    await this.db.query('COMMIT');
  }
  
  /**
   * Rollback the current transaction
   */
  async rollbackTransaction(): Promise<void> {
    await this.db.query('ROLLBACK');
  }
  
  // ========================================
  // BULK OPERATIONS
  // ========================================
  
  /**
   * Bulk delete functions by snapshot ID with transaction support
   */
  async bulkDeleteFunctionsBySnapshot(snapshotId: string): Promise<number> {
    return await this.executeInTransaction(async () => {
      // Delete in reverse dependency order
      await this.db.query('DELETE FROM quality_metrics WHERE function_id IN (SELECT id FROM functions WHERE snapshot_id = $1)', [snapshotId]);
      await this.db.query('DELETE FROM function_parameters WHERE function_id IN (SELECT id FROM functions WHERE snapshot_id = $1)', [snapshotId]);
      await this.db.query('DELETE FROM function_descriptions WHERE function_id IN (SELECT id FROM functions WHERE snapshot_id = $1)', [snapshotId]);
      
      const result = await this.db.query('DELETE FROM functions WHERE snapshot_id = $1', [snapshotId]);
      return (result as unknown as { changes: number }).changes || 0;
    });
  }
  
  /**
   * Bulk update quality metrics with transaction support
   */
  async bulkUpdateQualityMetrics(updates: Array<{ functionId: string; metrics: QualityMetrics }>): Promise<void> {
    if (updates.length === 0) return;
    
    const batchSize = BatchProcessor.getOptimalBatchSize(updates.length, 2); // 2KB estimated per metric
    
    await this.executeInTransaction(async () => {
      const batches = BatchProcessor.batchArray(updates, batchSize);
      
      for (const batch of batches) {
        for (const { functionId, metrics } of batch) {
          await this.db.query(`
            UPDATE quality_metrics SET
              lines_of_code = $2, total_lines = $3, cyclomatic_complexity = $4, cognitive_complexity = $5,
              max_nesting_level = $6, parameter_count = $7, return_statement_count = $8, branch_count = $9,
              loop_count = $10, try_catch_count = $11, async_await_count = $12, callback_count = $13,
              comment_lines = $14, code_to_comment_ratio = $15, halstead_volume = $16, halstead_difficulty = $17,
              maintainability_index = $18
            WHERE function_id = $1
          `, [
            functionId, metrics.linesOfCode, metrics.totalLines, metrics.cyclomaticComplexity,
            metrics.cognitiveComplexity, metrics.maxNestingLevel, metrics.parameterCount,
            metrics.returnStatementCount, metrics.branchCount, metrics.loopCount,
            metrics.tryCatchCount, metrics.asyncAwaitCount, metrics.callbackCount,
            metrics.commentLines, metrics.codeToCommentRatio, metrics.halsteadVolume || null,
            metrics.halsteadDifficulty || null, metrics.maintainabilityIndex || null
          ]);
        }
      }
    });
  }
  
  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  private async createSchema(): Promise<void> {
    await this.db.exec(this.getSnapshotsTableSQL());
    await this.db.exec(this.getFunctionsTableSQL());
    await this.db.exec(this.getParametersTableSQL());
    await this.db.exec(this.getMetricsTableSQL());
    await this.db.exec(this.getFunctionDescriptionsTableSQL());
  }

  private getSnapshotsTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        label TEXT,
        git_commit TEXT,
        git_branch TEXT,
        git_tag TEXT,
        project_root TEXT NOT NULL DEFAULT '',
        config_hash TEXT NOT NULL DEFAULT '',
        metadata TEXT DEFAULT '{}'
      );`;
  }

  private getFunctionsTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS functions (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        signature TEXT NOT NULL,
        signature_hash TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL DEFAULT 0,
        end_column INTEGER NOT NULL DEFAULT 0,
        ast_hash TEXT NOT NULL,
        is_exported BOOLEAN DEFAULT FALSE,
        is_async BOOLEAN DEFAULT FALSE,
        is_generator BOOLEAN DEFAULT FALSE,
        is_arrow_function BOOLEAN DEFAULT FALSE,
        is_method BOOLEAN DEFAULT FALSE,
        is_constructor BOOLEAN DEFAULT FALSE,
        is_static BOOLEAN DEFAULT FALSE,
        access_modifier TEXT,
        parent_class TEXT,
        parent_namespace TEXT,
        js_doc TEXT,
        source_code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
      );`;
  }

  private getParametersTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS function_parameters (
        id SERIAL PRIMARY KEY,
        function_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        type_simple TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_optional BOOLEAN DEFAULT FALSE,
        is_rest BOOLEAN DEFAULT FALSE,
        default_value TEXT,
        description TEXT,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );`;
  }

  private getMetricsTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS quality_metrics (
        function_id TEXT PRIMARY KEY,
        lines_of_code INTEGER NOT NULL,
        total_lines INTEGER NOT NULL,
        cyclomatic_complexity INTEGER NOT NULL,
        cognitive_complexity INTEGER NOT NULL,
        max_nesting_level INTEGER NOT NULL,
        parameter_count INTEGER NOT NULL,
        return_statement_count INTEGER NOT NULL,
        branch_count INTEGER NOT NULL,
        loop_count INTEGER NOT NULL,
        try_catch_count INTEGER NOT NULL,
        async_await_count INTEGER NOT NULL,
        callback_count INTEGER NOT NULL,
        comment_lines INTEGER NOT NULL,
        code_to_comment_ratio REAL NOT NULL,
        halstead_volume REAL,
        halstead_difficulty REAL,
        maintainability_index REAL,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );`;
  }

  private getFunctionDescriptionsTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS function_descriptions (
        function_id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'human',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        ai_model TEXT,
        confidence_score REAL,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );`;
  }

  private async createIndexes(): Promise<void> {
    await this.db.exec(`
      -- Core indexes for performance
      CREATE INDEX IF NOT EXISTS idx_functions_snapshot_id ON functions(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);
      CREATE INDEX IF NOT EXISTS idx_functions_file_path ON functions(file_path);
      CREATE INDEX IF NOT EXISTS idx_functions_signature_hash ON functions(signature_hash);
      CREATE INDEX IF NOT EXISTS idx_functions_ast_hash ON functions(ast_hash);
      
      -- Snapshot indexes
      CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
      CREATE INDEX IF NOT EXISTS idx_snapshots_git_commit ON snapshots(git_commit);
      CREATE INDEX IF NOT EXISTS idx_snapshots_git_branch ON snapshots(git_branch);
      
      -- Quality metrics indexes for fast filtering
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_complexity ON quality_metrics(cyclomatic_complexity);
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_lines ON quality_metrics(lines_of_code);
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_cognitive ON quality_metrics(cognitive_complexity);
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_nesting ON quality_metrics(max_nesting_level);
      
      -- Parameter search indexes
      CREATE INDEX IF NOT EXISTS idx_function_parameters_function_id ON function_parameters(function_id);
      CREATE INDEX IF NOT EXISTS idx_function_parameters_position ON function_parameters(function_id, position);
      
      -- Description search indexes
      CREATE INDEX IF NOT EXISTS idx_function_descriptions_function_id ON function_descriptions(function_id);
      CREATE INDEX IF NOT EXISTS idx_function_descriptions_source ON function_descriptions(source);
      
      -- Composite indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_functions_snapshot_exported ON functions(snapshot_id, is_exported) WHERE is_exported = true;
    `);
  }

  private generateSnapshotId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private async createSnapshotRecord(
    snapshotId: string,
    functions: FunctionInfo[],
    label?: string
  ): Promise<void> {
    const metadata = this.calculateSnapshotMetadata(functions);
    
    await this.db.query(`
      INSERT INTO snapshots (id, label, git_commit, git_branch, git_tag, project_root, config_hash, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      snapshotId,
      label || null,
      await this.getGitCommit(),
      await this.getGitBranch(),
      await this.getGitTag(),
      process.cwd(),
      'generated', // TODO: Implement config hash
      JSON.stringify(metadata)
    ]);
  }

  /**
   * Save functions using batch processing and transactions for optimal performance
   */
  private async saveFunctions(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    if (functions.length === 0) return;
    
    // Use optimal batch size based on function count and estimated memory usage
    const batchSize = BatchProcessor.calculateFunctionBatchSize(functions);
    
    // Create transaction processor for functions
    const processor: BatchTransactionProcessor<FunctionInfo> = {
      processBatch: async (batch: FunctionInfo[]) => {
        await this.saveFunctionsBatch(snapshotId, batch);
      },
      onError: async (error: Error, _batch: FunctionInfo[]) => {
        console.warn(`Failed to save batch of ${_batch.length} functions: ${error.message}`);
      },
      onSuccess: async (_batch: FunctionInfo[]) => {
        // Optional: Log successful batch processing
      }
    };
    
    // Process all functions in batches with transaction support
    await TransactionalBatchProcessor.processWithTransaction(
      functions,
      processor,
      batchSize
    );
  }
  
  /**
   * Save a batch of functions with transaction management
   */
  async saveFunctionsBatch(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    await this.executeInTransaction(async () => {
      for (const func of functions) {
        // Insert function
        await this.db.query(`
          INSERT INTO functions (
            id, snapshot_id, name, display_name, signature, signature_hash,
            file_path, file_hash, start_line, end_line, start_column, end_column,
            ast_hash, is_exported, is_async, is_generator, is_arrow_function,
            is_method, is_constructor, is_static, access_modifier, parent_class,
            parent_namespace, js_doc, source_code
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23, $24, $25
          )
        `, [
          func.id, snapshotId, func.name, func.displayName, func.signature, func.signatureHash,
          func.filePath, func.fileHash, func.startLine, func.endLine, func.startColumn, func.endColumn,
          func.astHash, func.isExported, func.isAsync, func.isGenerator, func.isArrowFunction,
          func.isMethod, func.isConstructor, func.isStatic, func.accessModifier || null, func.parentClass || null,
          func.parentNamespace || null, func.jsDoc || null, func.sourceCode || null
        ]);

        // Insert parameters
        for (const param of func.parameters) {
          await this.db.query(`
            INSERT INTO function_parameters (
              function_id, name, type, type_simple, position, is_optional, is_rest, default_value, description
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            func.id, param.name, param.type, param.typeSimple, param.position,
            param.isOptional, param.isRest, param.defaultValue || null, param.description || null
          ]);
        }

        // Insert metrics if available
        if (func.metrics) {
          await this.db.query(`
            INSERT INTO quality_metrics (
              function_id, lines_of_code, total_lines, cyclomatic_complexity, cognitive_complexity,
              max_nesting_level, parameter_count, return_statement_count, branch_count, loop_count,
              try_catch_count, async_await_count, callback_count, comment_lines, code_to_comment_ratio,
              halstead_volume, halstead_difficulty, maintainability_index
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
            )
          `, [
            func.id, func.metrics.linesOfCode, func.metrics.totalLines, func.metrics.cyclomaticComplexity,
            func.metrics.cognitiveComplexity, func.metrics.maxNestingLevel, func.metrics.parameterCount,
            func.metrics.returnStatementCount, func.metrics.branchCount, func.metrics.loopCount,
            func.metrics.tryCatchCount, func.metrics.asyncAwaitCount, func.metrics.callbackCount,
            func.metrics.commentLines, func.metrics.codeToCommentRatio, func.metrics.halsteadVolume || null,
            func.metrics.halsteadDifficulty || null, func.metrics.maintainabilityIndex || null
          ]);
        }
      }
    });
    
    // Verify that all functions and metrics were saved correctly
    if (process.env['NODE_ENV'] !== 'production') {
      const savedCount = await this.db.query(
        'SELECT COUNT(*) as count FROM functions WHERE snapshot_id = $1',
        [snapshotId]
      );
      const metricsCount = await this.db.query(
        'SELECT COUNT(*) as count FROM quality_metrics WHERE function_id IN (SELECT id FROM functions WHERE snapshot_id = $1)',
        [snapshotId]
      );
      
      const actualFunctionCount = (savedCount.rows[0] as { count: string }).count;
      const actualMetricsCount = (metricsCount.rows[0] as { count: string }).count;
      const expectedMetricsCount = functions.filter(f => f.metrics).length;
      
      if (parseInt(actualFunctionCount) !== functions.length) {
        console.warn(`Function count mismatch: expected ${functions.length}, got ${actualFunctionCount}`);
      }
      if (parseInt(actualMetricsCount) !== expectedMetricsCount) {
        console.warn(`Metrics count mismatch: expected ${expectedMetricsCount}, got ${actualMetricsCount}`);
      }
    }
  }

  private async getFunctionParameters(functionId: string): Promise<ParameterRow[]> {
    const result = await this.db.query(
      'SELECT * FROM function_parameters WHERE function_id = $1 ORDER BY position',
      [functionId]
    );
    return result.rows as ParameterRow[];
  }

  private mapRowToSnapshotInfo(row: SnapshotRow): SnapshotInfo {
    return {
      id: row.id,
      createdAt: new Date(row.created_at).getTime(),
      ...(row.label && { label: row.label }),
      ...(row.git_commit && { gitCommit: row.git_commit }),
      ...(row.git_branch && { gitBranch: row.git_branch }),
      ...(row.git_tag && { gitTag: row.git_tag }),
      projectRoot: row.project_root,
      configHash: row.config_hash,
      metadata: JSON.parse(row.metadata || '{}')
    };
  }

  private mapRowToFunctionInfo(row: FunctionRow & Partial<MetricsRow>, parameters: ParameterRow[]): FunctionInfo {
    const functionInfo = this.createBaseFunctionInfo(row, parameters);
    this.addOptionalProperties(functionInfo, row);
    this.addMetricsIfAvailable(functionInfo, row);
    return functionInfo;
  }

  private createBaseFunctionInfo(row: FunctionRow, parameters: ParameterRow[]): FunctionInfo {
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      signature: row.signature,
      signatureHash: row.signature_hash,
      filePath: row.file_path,
      fileHash: row.file_hash,
      startLine: row.start_line,
      endLine: row.end_line,
      startColumn: row.start_column,
      endColumn: row.end_column,
      astHash: row.ast_hash,
      isExported: row.is_exported,
      isAsync: row.is_async,
      isGenerator: row.is_generator,
      isArrowFunction: row.is_arrow_function,
      isMethod: row.is_method,
      isConstructor: row.is_constructor,
      isStatic: row.is_static,
      parameters: this.mapParameters(parameters)
    };
  }

  private mapParameters(parameters: ParameterRow[]): ParameterInfo[] {
    return parameters.map(p => ({
      name: p.name,
      type: p.type,
      typeSimple: p.type_simple,
      position: p.position,
      isOptional: p.is_optional,
      isRest: p.is_rest,
      ...(p.default_value && { defaultValue: p.default_value }),
      ...(p.description && { description: p.description })
    }));
  }

  private addOptionalProperties(functionInfo: FunctionInfo, row: FunctionRow): void {
    if (row.access_modifier) functionInfo.accessModifier = row.access_modifier;
    if (row.parent_class) functionInfo.parentClass = row.parent_class;
    if (row.parent_namespace) functionInfo.parentNamespace = row.parent_namespace;
    if (row.js_doc) functionInfo.jsDoc = row.js_doc;
    if (row.source_code) functionInfo.sourceCode = row.source_code;
  }

  private addMetricsIfAvailable(functionInfo: FunctionInfo, row: Partial<MetricsRow>): void {
    if (row.lines_of_code === null || row.lines_of_code === undefined) return;
    
    functionInfo.metrics = {
      linesOfCode: row.lines_of_code ?? 0,
      totalLines: row.total_lines ?? 0,
      cyclomaticComplexity: row.cyclomatic_complexity ?? 1,
      cognitiveComplexity: row.cognitive_complexity ?? 0,
      maxNestingLevel: row.max_nesting_level ?? 0,
      parameterCount: row.parameter_count ?? 0,
      returnStatementCount: row.return_statement_count ?? 0,
      branchCount: row.branch_count ?? 0,
      loopCount: row.loop_count ?? 0,
      tryCatchCount: row.try_catch_count ?? 0,
      asyncAwaitCount: row.async_await_count ?? 0,
      callbackCount: row.callback_count ?? 0,
      commentLines: row.comment_lines ?? 0,
      codeToCommentRatio: row.code_to_comment_ratio ?? 0,
      ...this.getOptionalMetrics(row)
    };
  }

  private getOptionalMetrics(row: Partial<MetricsRow>): Partial<QualityMetrics> {
    return {
      ...(row.halstead_volume !== null && row.halstead_volume !== undefined && { halsteadVolume: row.halstead_volume }),
      ...(row.halstead_difficulty !== null && row.halstead_difficulty !== undefined && { halsteadDifficulty: row.halstead_difficulty }),
      ...(row.maintainability_index !== null && row.maintainability_index !== undefined && { maintainabilityIndex: row.maintainability_index })
    };
  }

  private calculateSnapshotMetadata(functions: FunctionInfo[]): SnapshotMetadata {
    if (functions.length === 0) {
      return {
        totalFunctions: 0,
        totalFiles: 0,
        avgComplexity: 0,
        maxComplexity: 0,
        exportedFunctions: 0,
        asyncFunctions: 0,
        complexityDistribution: {},
        fileExtensions: {}
      };
    }

    const uniqueFiles = new Set(functions.map(f => f.filePath));
    const complexities = functions
      .map(f => f.metrics?.cyclomaticComplexity || 1)
      .filter(c => c > 0);
    
    const complexityDistribution: Record<number, number> = {};
    complexities.forEach(complexity => {
      complexityDistribution[complexity] = (complexityDistribution[complexity] || 0) + 1;
    });

    const fileExtensions: Record<string, number> = {};
    functions.forEach(f => {
      const ext = f.filePath.split('.').pop() || 'unknown';
      fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
    });

    return {
      totalFunctions: functions.length,
      totalFiles: uniqueFiles.size,
      avgComplexity: complexities.length > 0 ? 
        Math.round((complexities.reduce((a, b) => a + b, 0) / complexities.length) * 10) / 10 : 0,
      maxComplexity: complexities.length > 0 ? Math.max(...complexities) : 0,
      exportedFunctions: functions.filter(f => f.isExported).length,
      asyncFunctions: functions.filter(f => f.isAsync).length,
      complexityDistribution,
      fileExtensions
    };
  }

  // Git helper methods
  private async getGitCommit(): Promise<string | null> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) return null;
      
      return await this.git.revparse(['HEAD']);
    } catch {
      return null;
    }
  }

  private async getGitBranch(): Promise<string | null> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) return null;
      
      return await this.git.revparse(['--abbrev-ref', 'HEAD']);
    } catch {
      return null;
    }
  }

  private async getGitTag(): Promise<string | null> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) return null;
      
      const tags = await this.git.tags(['--points-at', 'HEAD']);
      return tags.latest || null;
    } catch {
      return null;
    }
  }
}
