import { PGlite } from '@electric-sql/pglite';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { EmbeddingService } from '../services/embedding-service';
import { ANNConfig } from '../services/ann-index';
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
  FunctionDescription,
  NamingEvaluation,
  Lineage,
  LineageKind,
  LineageStatus,
  LineageQuery
} from '../types';
import { BatchProcessor, TransactionalBatchProcessor, BatchTransactionProcessor } from '../utils/batch-processor';
import { ErrorCode } from '../utils/error-handler';

/**
 * Custom error class for database operations with ErrorCode
 */
export class DatabaseError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Clean PGLite storage adapter implementation
 * Focuses on type safety, proper error handling, and clean architecture
 */
export class PGLiteStorageAdapter implements StorageAdapter {
  private db: PGlite;
  private git: SimpleGit;
  private transactionDepth: number = 0;
  private dbPath: string;
  private originalDbPath: string;
  
  // Static cache to avoid redundant schema checks across instances
  private static schemaCache = new Map<string, boolean>();

  constructor(dbPath: string) {
    // Validate input path
    this.validateDbPath(dbPath);
    
    // Store original path for directory check logic
    this.originalDbPath = dbPath;
    // パスを正規化してキャッシュの一貫性を保証
    this.dbPath = path.resolve(dbPath);
    this.db = new PGlite(dbPath);
    this.git = simpleGit();
  }

  /**
   * Validates the database path to prevent filesystem pollution
   */
  private validateDbPath(dbPath: string): void {
    if (!dbPath || typeof dbPath !== 'string') {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        'Database path must be a non-empty string'
      );
    }

    // Allow special database paths
    if (dbPath === ':memory:') {
      return;
    }

    // Allow PostgreSQL connection strings
    if (dbPath.startsWith('postgres://') || dbPath.startsWith('postgresql://')) {
      return;
    }

    // Prevent Windows drive letters only (which would create invalid directories)
    const isWindowsDriveOnly = /^[A-Za-z]:$/.test(dbPath);
    if (isWindowsDriveOnly) {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Invalid database path: '${dbPath}'. Drive letters alone are not valid database paths. Use a full path like 'C:\\path\\to\\database.db'`
      );
    }

    // Prevent paths with leading/trailing whitespace
    if (/^\s+|\s+$/.test(dbPath)) {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Invalid database path: '${dbPath}'. Path cannot have leading or trailing whitespace`
      );
    }

    // Prevent paths that would create problematic directories
    // Note: We check for invalid Windows filename characters, but exclude colon in drive paths and connection strings
    const invalidCharsPattern = /[<>"|?*]/;
    const suspiciousColonPattern = /[^A-Za-z]:[^\\\/]/; // Colon not part of drive letter or connection string
    
    if (invalidCharsPattern.test(dbPath)) {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Invalid database path: '${dbPath}'. Path contains invalid characters: < > " | ? *`
      );
    }

    if (suspiciousColonPattern.test(dbPath) && !dbPath.includes('://')) {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Invalid database path: '${dbPath}'. Suspicious colon placement detected`
      );
    }

    // Ensure path has a reasonable length
    if (dbPath.length > 260) { // Windows MAX_PATH limit
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Database path too long: ${dbPath.length} characters. Maximum allowed: 260`
      );
    }
  }

  /**
   * Determines if we should check for database directory existence
   * Handles Windows drive letters (C:) and special database paths
   */
  private shouldCheckDatabaseDirectory(originalPath: string): boolean {
    // Skip check for special database paths
    if (originalPath === ':memory:') {
      return false;
    }
    
    // Skip check for special PostgreSQL-style connection strings
    if (originalPath.startsWith('postgres://') || originalPath.startsWith('postgresql://')) {
      return false;
    }
    
    // For Windows: Check if it's a valid file path (not just a drive letter)
    // Valid examples: C:\path\to\db, /path/to/db, ./relative/path
    // Invalid examples: C:, D:, etc.
    const isWindowsDriveOnly = /^[A-Za-z]:$/.test(originalPath);
    if (isWindowsDriveOnly) {
      return false;
    }
    
    return true;
  }

  async init(): Promise<void> {
    try {
      // Check if database path exists (only check for directory-based databases)
      if (this.shouldCheckDatabaseDirectory(this.originalDbPath)) {
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
          throw new DatabaseError(
            ErrorCode.DATABASE_NOT_INITIALIZED,
            'Database directory not found. funcqc needs to be initialized first.',
            new Error(`Database directory does not exist: ${dbDir}`)
          );
        }
      }

      await this.db.waitReady;
      
      // Use cache to avoid redundant schema initialization  
      if (!PGLiteStorageAdapter.schemaCache.has(this.dbPath)) {
        // 同期的にキャッシュに追加して競合を防ぐ
        PGLiteStorageAdapter.schemaCache.set(this.dbPath, true);
        try {
          await this.createSchema();
          await this.createIndexes();
        } catch (error) {
          // エラーが発生した場合はキャッシュから削除
          PGLiteStorageAdapter.schemaCache.delete(this.dbPath);
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      
      // Check if it's a database not found error
      if (error instanceof Error && error.message.includes('does not exist')) {
        throw new DatabaseError(
          ErrorCode.DATABASE_NOT_INITIALIZED,
          'Database not found. funcqc needs to be initialized first.',
          error
        );
      }
      
      throw new DatabaseError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
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

  async saveSnapshot(functions: FunctionInfo[], label?: string, comment?: string, configHash?: string): Promise<string> {
    const snapshotId = this.generateSnapshotId();
    
    try {
      // Create snapshot record
      await this.createSnapshotRecord(snapshotId, functions, configHash || 'unknown', label, comment);
      
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

  /**
   * Get the config hash from the most recent snapshot
   * Returns null if no snapshots exist
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
      throw new Error(`Failed to get last config hash: ${error instanceof Error ? error.message : String(error)}`);
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
        // Create field mapping for proper table aliases
        const fieldMapping = new Map([
          // Functions table fields (f alias)
          ['name', 'f.name'],
          ['file_path', 'f.file_path'],
          ['start_line', 'f.start_line'],
          ['is_exported', 'f.is_exported'],
          ['is_async', 'f.is_async'],
          ['display_name', 'f.display_name'],
          // Quality metrics table fields (q alias)
          ['cyclomatic_complexity', 'q.cyclomatic_complexity'],
          ['cognitive_complexity', 'q.cognitive_complexity'],
          ['lines_of_code', 'q.lines_of_code'],
          ['total_lines', 'q.total_lines'],
          ['parameter_count', 'q.parameter_count'],
          ['max_nesting_level', 'q.max_nesting_level'],
          ['return_statement_count', 'q.return_statement_count'],
          ['branch_count', 'q.branch_count'],
          ['loop_count', 'q.loop_count'],
          ['try_catch_count', 'q.try_catch_count'],
          ['async_await_count', 'q.async_await_count'],
          ['callback_count', 'q.callback_count'],
          ['comment_lines', 'q.comment_lines'],
          ['code_to_comment_ratio', 'q.code_to_comment_ratio'],
          ['halstead_volume', 'q.halstead_volume'],
          ['halstead_difficulty', 'q.halstead_difficulty'],
          ['maintainability_index', 'q.maintainability_index']
        ]);

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
            // Use field mapping to get correct table alias and column name
            const mappedField = fieldMapping.get(filter.field) || `f.${filter.field}`;
            params.push(filter.value);
            return `${mappedField} ${filter.operator} $${params.length}`;
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
      
      // Handle multi-field sorting (e.g., 'file_path,start_line')
      let orderByClause = 'f.start_line'; // default
      
      if (options?.sort) {
        const sortFields = options.sort.split(',').map(field => field.trim());
        const validOrderByFields: string[] = [];
        
        for (const field of sortFields) {
          if (validSortFields.has(field)) {
            validOrderByFields.push(validSortFields.get(field)!);
          }
        }
        
        if (validOrderByFields.length > 0) {
          orderByClause = validOrderByFields.join(', ');
        }
      }
      
      sql += ` ORDER BY ${orderByClause}`;

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
    const fromMap = new Map(fromFunctions.map((f: FunctionInfo) => [f.semanticId, f]));
    const toMap = new Map(toFunctions.map((f: FunctionInfo) => [f.semanticId, f]));

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
      const fromFunc = fromMap.get(toFunc.semanticId);
      
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
      if (!toMap.has(fromFunc.semanticId)) {
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
          semantic_id, description, source, created_at, updated_at, created_by, ai_model, confidence_score, validated_for_content_id, needs_review, usage_example, side_effects, error_conditions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $11, $12)
        ON CONFLICT (semantic_id) 
        DO UPDATE SET 
          description = EXCLUDED.description,
          source = EXCLUDED.source,
          updated_at = EXCLUDED.updated_at,
          created_by = EXCLUDED.created_by,
          ai_model = EXCLUDED.ai_model,
          confidence_score = EXCLUDED.confidence_score,
          validated_for_content_id = EXCLUDED.validated_for_content_id,
          needs_review = FALSE,
          usage_example = EXCLUDED.usage_example,
          side_effects = EXCLUDED.side_effects,
          error_conditions = EXCLUDED.error_conditions
      `, [
        description.semanticId,
        description.description,
        description.source,
        new Date(description.createdAt).toISOString(),
        new Date(description.updatedAt).toISOString(),
        description.createdBy || null,
        description.aiModel || null,
        description.confidenceScore || null,
        description.validatedForContentId || null,
        description.usageExample || null,
        description.sideEffects || null,
        description.errorConditions || null
      ]);
    } catch (error) {
      throw new Error(`Failed to save function description: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionDescription(semanticId: string): Promise<FunctionDescription | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM function_descriptions WHERE semantic_id = $1',
        [semanticId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as {
        semantic_id: string;
        description: string;
        source: string;
        created_at: string;
        updated_at: string;
        created_by?: string;
        ai_model?: string;
        confidence_score?: number;
        validated_for_content_id?: string;
        usage_example?: string;
        side_effects?: string;
        error_conditions?: string;
      };
      return {
        semanticId: row.semantic_id,
        description: row.description,
        source: row.source as 'human' | 'ai' | 'jsdoc',
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        ...(row.created_by && { createdBy: row.created_by }),
        ...(row.ai_model && { aiModel: row.ai_model }),
        ...(row.confidence_score !== null && { confidenceScore: row.confidence_score }),
        ...(row.validated_for_content_id && { validatedForContentId: row.validated_for_content_id }),
        ...(row.usage_example && { usageExample: row.usage_example }),
        ...(row.side_effects && { sideEffects: row.side_effects }),
        ...(row.error_conditions && { errorConditions: row.error_conditions })
      };
    } catch (error) {
      throw new Error(`Failed to get function description: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsNeedingDescriptions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      // Query functions where:
      // 1. No description exists, OR
      // 2. Function content has changed (content_id differs from validated_for_content_id), OR
      // 3. Description needs review flag is set
      let sql = `
        SELECT 
          f.*,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.parameter_count, q.max_nesting_level, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.maintainability_index, q.halstead_volume, q.halstead_difficulty, q.code_to_comment_ratio
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.snapshot_id = $1 
        AND (
          d.semantic_id IS NULL 
          OR d.needs_review = TRUE
          OR (d.validated_for_content_id IS NULL OR d.validated_for_content_id != f.content_id)
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
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
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
          d.description, d.source, d.created_at, d.updated_at, d.ai_model
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
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
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
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
  // EMBEDDING OPERATIONS
  // ========================================

  async saveEmbedding(semanticId: string, embedding: number[], model: string = 'text-embedding-ada-002'): Promise<void> {
    try {
      // Convert array to PostgreSQL array literal
      const embeddingStr = `{${embedding.join(',')}}`;
      
      await this.db.query(`
        INSERT INTO function_embeddings (semantic_id, embedding_model, vector_dimension, embedding)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (semantic_id) 
        DO UPDATE SET 
          embedding_model = EXCLUDED.embedding_model,
          vector_dimension = EXCLUDED.vector_dimension,
          embedding = EXCLUDED.embedding,
          updated_at = CURRENT_TIMESTAMP
      `, [semanticId, model, embedding.length, embeddingStr]);
    } catch (error) {
      throw new Error(`Failed to save embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getEmbedding(semanticId: string): Promise<{ embedding: number[]; model: string } | null> {
    try {
      const result = await this.db.query(
        'SELECT embedding, embedding_model FROM function_embeddings WHERE semantic_id = $1',
        [semanticId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as { embedding: number[]; embedding_model: string };
      return {
        embedding: row.embedding,
        model: row.embedding_model
      };
    } catch (error) {
      throw new Error(`Failed to get embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async searchByEmbedding(queryEmbedding: number[], threshold: number = 0.8, limit: number = 10): Promise<Array<FunctionInfo & { similarity: number }>> {
    try {
      // Get the latest snapshot
      const snapshots = await this.getSnapshots({ sort: 'created_at', limit: 1 });
      if (snapshots.length === 0) {
        return [];
      }

      // Since PGLite doesn't have native vector operations, we need to calculate similarity in application
      // First, get all embeddings
      const embeddings = await this.db.query(`
        SELECT 
          f.*, 
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
      `, [snapshots[0].id]);

      // Calculate similarities and filter
      type EmbeddingSearchRow = FunctionRow & Partial<MetricsRow> & {
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
          const functionInfo = this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
          return { ...functionInfo, similarity };
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to search by embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async bulkSaveEmbeddings(embeddings: Array<{ semanticId: string; embedding: number[]; model: string }>): Promise<void> {
    if (embeddings.length === 0) return;

    await this.executeInTransaction(async () => {
      for (const { semanticId, embedding, model } of embeddings) {
        await this.saveEmbedding(semanticId, embedding, model);
      }
    });
  }

  async getFunctionsWithoutEmbeddings(snapshotId: string, limit?: number): Promise<FunctionInfo[]> {
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
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        LEFT JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        WHERE f.snapshot_id = $1 
        AND d.description IS NOT NULL
        AND e.semantic_id IS NULL
      `;
      const params: (string | number)[] = [snapshotId];

      if (limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(limit);
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
      throw new Error(`Failed to get functions without embeddings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsWithEmbeddings(snapshotId: string, limit?: number): Promise<FunctionInfo[]> {
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
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        INNER JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        WHERE f.snapshot_id = $1 
        AND d.description IS NOT NULL
      `;
      const params: (string | number)[] = [snapshotId];

      if (limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(limit);
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
      throw new Error(`Failed to get functions with embeddings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunction(functionId: string): Promise<FunctionInfo | null> {
    try {
      const result = await this.db.query(`
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
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.id = $1 OR f.semantic_id = $1
        LIMIT 1
      `, [functionId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as FunctionRow & Partial<MetricsRow>;
      const parameters = await this.getFunctionParameters(row.id);
      return this.mapRowToFunctionInfo(row, parameters);
    } catch (error) {
      throw new Error(`Failed to get function: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsBatch(functionIds: string[]): Promise<Map<string, FunctionInfo>> {
    if (functionIds.length === 0) {
      return new Map();
    }

    try {
      // Use PostgreSQL array for efficient batch query
      const idsArray = this.formatPostgresArrayLiteral(functionIds);
      
      const result = await this.db.query(`
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
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.id = ANY($1::text[]) OR f.semantic_id = ANY($1::text[])
      `, [idsArray]);

      // Get parameters for all functions in a single batch
      const parameterMap = await this.getFunctionParametersBatch(result.rows.map((row) => (row as FunctionRow).id));

      const functionMap = new Map<string, FunctionInfo>();
      
      for (const row of result.rows) {
        const functionRow = row as FunctionRow & Partial<MetricsRow>;
        const parameters = parameterMap.get(functionRow.id) || [];
        const functionInfo = this.mapRowToFunctionInfo(functionRow, parameters);
        
        // Store by both id and semantic_id for flexible lookup
        functionMap.set(functionRow.id, functionInfo);
        functionMap.set(functionRow.semantic_id, functionInfo);
      }

      return functionMap;
    } catch (error) {
      throw new Error(`Failed to get functions batch: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getEmbeddingStats(): Promise<{ total: number; withEmbeddings: number; withoutEmbeddings: number }> {
    try {
      const result = await this.db.query(`
        SELECT 
          COUNT(DISTINCT d.semantic_id) as total,
          COUNT(DISTINCT e.semantic_id) as with_embeddings
        FROM function_descriptions d
        LEFT JOIN function_embeddings e ON d.semantic_id = e.semantic_id
      `);

      const stats = result.rows[0] as { total: string; with_embeddings: string };
      const total = parseInt(stats.total);
      const withEmbeddings = parseInt(stats.with_embeddings);

      return {
        total,
        withEmbeddings,
        withoutEmbeddings: total - withEmbeddings
      };
    } catch (error) {
      throw new Error(`Failed to get embedding stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  // ========================================
  // ANN INDEX MANAGEMENT
  // ========================================

  /**
   * Save ANN index metadata and serialized index data
   */
  async saveANNIndex(
    indexId: string,
    config: ANNConfig,
    embeddingModel: string,
    vectorDimension: number,
    vectorCount: number,
    indexData: string,
    buildTimeMs: number,
    accuracyMetrics?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Mark all existing indexes as not current
      await this.db.query('UPDATE ann_index_metadata SET is_current = FALSE');

      // Insert new index metadata
      await this.db.query(`
        INSERT INTO ann_index_metadata (
          id, algorithm, config_json, embedding_model, vector_dimension, 
          vector_count, index_data, build_time_ms, accuracy_metrics, is_current
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        ON CONFLICT (id) DO UPDATE SET
          algorithm = EXCLUDED.algorithm,
          config_json = EXCLUDED.config_json,
          embedding_model = EXCLUDED.embedding_model,
          vector_dimension = EXCLUDED.vector_dimension,
          vector_count = EXCLUDED.vector_count,
          index_data = EXCLUDED.index_data,
          build_time_ms = EXCLUDED.build_time_ms,
          accuracy_metrics = EXCLUDED.accuracy_metrics,
          updated_at = CURRENT_TIMESTAMP,
          is_current = TRUE
      `, [
        indexId,
        config.algorithm,
        JSON.stringify(config),
        embeddingModel,
        vectorDimension,
        vectorCount,
        indexData,
        buildTimeMs,
        accuracyMetrics ? JSON.stringify(accuracyMetrics) : null
      ]);
    } catch (error) {
      throw new Error(`Failed to save ANN index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get current ANN index metadata and data
   */
  async getCurrentANNIndex(): Promise<{
    id: string;
    config: ANNConfig;
    embeddingModel: string;
    vectorDimension: number;
    vectorCount: number;
    indexData: string;
    buildTimeMs: number;
    accuracyMetrics?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    try {
      const result = await this.db.query(`
        SELECT * FROM ann_index_metadata 
        WHERE is_current = TRUE 
        ORDER BY updated_at DESC 
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as {
        id: string;
        algorithm: string;
        config_json: string;
        embedding_model: string;
        vector_dimension: number;
        vector_count: number;
        index_data: string;
        build_time_ms: number;
        accuracy_metrics: string | null;
        created_at: string;
        updated_at: string;
      };

      return {
        id: row.id,
        config: JSON.parse(row.config_json) as ANNConfig,
        embeddingModel: row.embedding_model,
        vectorDimension: row.vector_dimension,
        vectorCount: row.vector_count,
        indexData: row.index_data,
        buildTimeMs: row.build_time_ms,
        accuracyMetrics: row.accuracy_metrics ? JSON.parse(row.accuracy_metrics) : undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };
    } catch (error) {
      throw new Error(`Failed to get current ANN index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get all ANN index metadata (for history/comparison)
   */
  async getAllANNIndexes(): Promise<Array<{
    id: string;
    algorithm: string;
    embeddingModel: string;
    vectorCount: number;
    buildTimeMs: number;
    isCurrent: boolean;
    createdAt: Date;
  }>> {
    try {
      const result = await this.db.query(`
        SELECT id, algorithm, embedding_model, vector_count, build_time_ms, is_current, created_at
        FROM ann_index_metadata 
        ORDER BY created_at DESC
      `);

      return result.rows.map((row: unknown) => {
        const typedRow = row as {
          id: string;
          algorithm: string;
          embedding_model: string;
          vector_count: number;
          build_time_ms: number;
          is_current: boolean;
          created_at: string;
        };
        return {
          id: typedRow.id,
          algorithm: typedRow.algorithm,
          embeddingModel: typedRow.embedding_model,
          vectorCount: typedRow.vector_count,
          buildTimeMs: typedRow.build_time_ms,
          isCurrent: typedRow.is_current,
          createdAt: new Date(typedRow.created_at)
        };
      });
    } catch (error) {
      throw new Error(`Failed to get ANN indexes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete ANN index by ID
   */
  async deleteANNIndex(indexId: string): Promise<void> {
    try {
      await this.db.query('DELETE FROM ann_index_metadata WHERE id = $1', [indexId]);
    } catch (error) {
      throw new Error(`Failed to delete ANN index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get ANN index statistics
   */
  async getANNIndexStats(): Promise<{
    totalIndexes: number;
    currentIndex: {
      algorithm: string;
      vectorCount: number;
      buildTimeMs: number;
      model: string;
    } | null;
    averageBuildTime: number;
  }> {
    try {
      const [totalResult, currentResult, avgResult] = await Promise.all([
        this.db.query('SELECT COUNT(*) as total FROM ann_index_metadata'),
        this.db.query(`
          SELECT algorithm, vector_count, build_time_ms, embedding_model 
          FROM ann_index_metadata 
          WHERE is_current = TRUE
        `),
        this.db.query('SELECT AVG(build_time_ms) as avg_time FROM ann_index_metadata')
      ]);

      type CurrentIndexRow = {
        algorithm: string;
        vector_count: string | number;
        build_time_ms: string | number;
        embedding_model: string;
      };

      type TotalRow = { total: string };
      type AvgTimeRow = { avg_time: string | null };

      const currentIndex = currentResult.rows.length > 0 ? (() => {
        const row = currentResult.rows[0] as CurrentIndexRow;
        return {
          algorithm: row.algorithm,
          vectorCount: typeof row.vector_count === 'string' ? parseInt(row.vector_count, 10) : row.vector_count,
          buildTimeMs: typeof row.build_time_ms === 'string' ? parseInt(row.build_time_ms, 10) : row.build_time_ms,
          model: row.embedding_model
        };
      })() : null;

      const totalRow = totalResult.rows[0] as TotalRow;
      const avgRow = avgResult.rows[0] as AvgTimeRow;

      // Parse and validate numeric values with proper fallbacks
      const totalIndexes = totalRow?.total ? parseInt(totalRow.total, 10) : 0;
      const averageBuildTime = avgRow?.avg_time ? parseFloat(avgRow.avg_time) : 0;

      return {
        totalIndexes: isNaN(totalIndexes) ? 0 : totalIndexes,
        currentIndex,
        averageBuildTime: isNaN(averageBuildTime) ? 0 : averageBuildTime
      };
    } catch (error) {
      throw new Error(`Failed to get ANN index stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ========================================
  // MAINTENANCE OPERATIONS (FUTURE)
  // ========================================

  // ========================================
  // LINEAGE OPERATIONS
  // ========================================

  async saveLineage(lineage: Lineage): Promise<void> {
    try {
      // Convert arrays to PostgreSQL array literals
      const fromIdsLiteral = this.formatPostgresArrayLiteral(lineage.fromIds);
      const toIdsLiteral = this.formatPostgresArrayLiteral(lineage.toIds);

      await this.db.query(`
        INSERT INTO lineage (
          id, from_ids, to_ids, kind, status, confidence, note, git_commit, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
      `, [
        lineage.id,
        fromIdsLiteral,
        toIdsLiteral,
        lineage.kind,
        lineage.status,
        lineage.confidence || null,
        lineage.note || null,
        lineage.gitCommit,
        lineage.createdAt.toISOString(),
        lineage.updatedAt?.toISOString() || null
      ]);
    } catch (error) {
      throw new Error(`Failed to save lineage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getLineage(id: string): Promise<Lineage | null> {
    try {
      const result = await this.db.query(`
        SELECT * FROM lineage WHERE id = $1
      `, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.mapRowToLineage(row);
    } catch (error) {
      throw new Error(`Failed to get lineage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getLineages(query?: LineageQuery): Promise<Lineage[]> {
    try {
      let sql = 'SELECT * FROM lineage WHERE 1=1';
      const params: unknown[] = [];
      let paramIndex = 1;

      if (query?.status) {
        sql += ` AND status = $${paramIndex++}`;
        params.push(query.status);
      }

      if (query?.kind) {
        sql += ` AND kind = $${paramIndex++}`;
        params.push(query.kind);
      }

      if (query?.minConfidence !== undefined) {
        sql += ` AND confidence >= $${paramIndex++}`;
        params.push(query.minConfidence);
      }

      if (query?.gitCommit) {
        sql += ` AND git_commit = $${paramIndex++}`;
        params.push(query.gitCommit);
      }

      if (query?.fromDate) {
        sql += ` AND created_at >= $${paramIndex++}`;
        params.push(query.fromDate.toISOString());
      }

      if (query?.toDate) {
        sql += ` AND created_at <= $${paramIndex++}`;
        params.push(query.toDate.toISOString());
      }

      sql += ' ORDER BY created_at DESC';

      if (query?.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(query.limit);
      }

      if (query?.offset) {
        sql += ` OFFSET $${paramIndex++}`;
        params.push(query.offset);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToLineage(row));
    } catch (error) {
      throw new Error(`Failed to get lineages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getLineagesWithFunctionFilter(
    fromFunctionPattern?: string,
    toFunctionPattern?: string,
    query?: LineageQuery
  ): Promise<Lineage[]> {
    try {
      let sql = `
        SELECT DISTINCT l.* FROM lineage l
      `;
      const params: unknown[] = [];
      let paramIndex = 1;

      // Add joins if function name filtering is needed
      if (fromFunctionPattern) {
        sql += `
          JOIN functions f_from ON f_from.id = ANY(string_to_array(trim(both '{}' from l.from_ids), ','))
        `;
      }

      if (toFunctionPattern) {
        sql += `
          JOIN functions f_to ON f_to.id = ANY(string_to_array(trim(both '{}' from l.to_ids), ','))
        `;
      }

      sql += ' WHERE 1=1';

      // Add function name filters
      if (fromFunctionPattern) {
        sql += ` AND LOWER(f_from.name) LIKE $${paramIndex++}`;
        params.push(`%${fromFunctionPattern.toLowerCase()}%`);
      }

      if (toFunctionPattern) {
        sql += ` AND LOWER(f_to.name) LIKE $${paramIndex++}`;
        params.push(`%${toFunctionPattern.toLowerCase()}%`);
      }

      // Add standard lineage filters
      if (query?.status) {
        sql += ` AND l.status = $${paramIndex++}`;
        params.push(query.status);
      }

      if (query?.kind) {
        sql += ` AND l.kind = $${paramIndex++}`;
        params.push(query.kind);
      }

      if (query?.minConfidence !== undefined) {
        sql += ` AND l.confidence >= $${paramIndex++}`;
        params.push(query.minConfidence);
      }

      if (query?.gitCommit) {
        sql += ` AND l.git_commit = $${paramIndex++}`;
        params.push(query.gitCommit);
      }

      if (query?.fromDate) {
        sql += ` AND l.created_at >= $${paramIndex++}`;
        params.push(query.fromDate.toISOString());
      }

      if (query?.toDate) {
        sql += ` AND l.created_at <= $${paramIndex++}`;
        params.push(query.toDate.toISOString());
      }

      sql += ' ORDER BY l.created_at DESC';

      if (query?.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(query.limit);
      }

      if (query?.offset) {
        sql += ` OFFSET $${paramIndex++}`;
        params.push(query.offset);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToLineage(row));
    } catch (error) {
      throw new Error(`Failed to get lineages with function filter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateLineageStatus(id: string, status: LineageStatus, note?: string): Promise<void> {
    try {
      const updateNote = note !== undefined;
      const sql = updateNote
        ? 'UPDATE lineage SET status = $1, note = $2, updated_at = $3 WHERE id = $4'
        : 'UPDATE lineage SET status = $1, updated_at = $2 WHERE id = $3';
      
      const params = updateNote
        ? [status, note, new Date().toISOString(), id]
        : [status, new Date().toISOString(), id];

      await this.db.query(sql, params);
    } catch (error) {
      throw new Error(`Failed to update lineage status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private formatPostgresArrayLiteral(ids: string[]): string {
    return `{${ids.map(id => `"${id}"`).join(',')}}`;
  }

  async updateLineage(lineage: Lineage): Promise<void> {
    try {
      // Convert arrays to PostgreSQL array literals
      const fromIdsLiteral = this.formatPostgresArrayLiteral(lineage.fromIds);
      const toIdsLiteral = this.formatPostgresArrayLiteral(lineage.toIds);

      await this.db.query(`
        UPDATE lineage SET 
          from_ids = $1, 
          to_ids = $2, 
          kind = $3, 
          status = $4, 
          confidence = $5, 
          note = $6, 
          git_commit = $7, 
          updated_at = $8 
        WHERE id = $9
      `, [
        fromIdsLiteral,
        toIdsLiteral,
        lineage.kind,
        lineage.status,
        lineage.confidence,
        lineage.note,
        lineage.gitCommit,
        new Date().toISOString(),
        lineage.id
      ]);
    } catch (error) {
      throw new Error(`Failed to update lineage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteLineage(id: string): Promise<boolean> {
    try {
      const result = await this.db.query('DELETE FROM lineage WHERE id = $1', [id]);
      // Type-safe handling of PGLite query result
      const affectedRows = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
      return affectedRows > 0;
    } catch (error) {
      throw new Error(`Failed to delete lineage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getLineagesByCommit(gitCommit: string): Promise<Lineage[]> {
    try {
      const result = await this.db.query(`
        SELECT * FROM lineage WHERE git_commit = $1 ORDER BY created_at DESC
      `, [gitCommit]);

      return result.rows.map(row => this.mapRowToLineage(row));
    } catch (error) {
      throw new Error(`Failed to get lineages by commit: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionLineageHistory(functionId: string): Promise<Lineage[]> {
    try {
      const result = await this.db.query(`
        SELECT * FROM lineage 
        WHERE $1 = ANY(from_ids) OR $1 = ANY(to_ids)
        ORDER BY created_at DESC
      `, [functionId]);

      return result.rows.map(row => this.mapRowToLineage(row));
    } catch (error) {
      throw new Error(`Failed to get function lineage history: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async pruneDraftLineages(olderThanDays: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.db.query(`
        DELETE FROM lineage 
        WHERE status = 'draft' AND created_at < $1
      `, [cutoffDate.toISOString()]);

      // Type-safe handling of PGLite query result
      const affectedRows = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
      return affectedRows;
    } catch (error) {
      throw new Error(`Failed to prune draft lineages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private mapRowToLineage(row: unknown): Lineage {
    // Type guard for database row structure
    const isValidLineageRow = (obj: unknown): obj is {
      id: string;
      from_ids: string | string[];
      to_ids: string | string[];
      kind: string;
      status: string;
      confidence?: number;
      note?: string;
      git_commit: string;
      created_at: string;
      updated_at?: string;
    } => {
      return (
        typeof obj === 'object' &&
        obj !== null &&
        'id' in obj &&
        'from_ids' in obj &&
        'to_ids' in obj &&
        'kind' in obj &&
        'status' in obj &&
        'git_commit' in obj &&
        'created_at' in obj
      );
    };

    if (!isValidLineageRow(row)) {
      throw new Error('Invalid lineage row structure');
    }

    // Parse PostgreSQL arrays: {value1,value2} -> [value1, value2]
    const parsePostgresArray = (pgArray: string | string[]): string[] => {
      if (!pgArray) return [];
      
      // If it's already an array, return it
      if (Array.isArray(pgArray)) return pgArray;
      
      // If it's a string, parse it
      if (typeof pgArray === 'string') {
        if (pgArray === '{}') return [];
        // Remove outer braces and split by comma, handling quoted values
        const inner = pgArray.slice(1, -1);
        if (!inner) return [];
        return inner.split(',').map(item => item.replace(/^"(.*)"$/, '$1'));
      }
      
      return [];
    };

    return {
      id: row.id,
      fromIds: parsePostgresArray(row.from_ids),
      toIds: parsePostgresArray(row.to_ids),
      kind: row.kind as LineageKind,
      status: row.status as LineageStatus,
      confidence: row.confidence,
      note: row.note,
      gitCommit: row.git_commit,
      createdAt: new Date(row.created_at),
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    } as Lineage;
  }

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
  // FUNCTION HISTORY OPERATIONS
  // ========================================
  
  /**
   * Get function history across all snapshots efficiently
   * This avoids N+1 queries by fetching all data in a single query
   */
  async getFunctionHistory(functionId: string, options?: {
    limit?: number;
    includeAbsent?: boolean;
  }): Promise<Array<{
    snapshot: SnapshotInfo;
    function: FunctionInfo | null;
    isPresent: boolean;
  }>> {
    const limit = options?.limit || 100;
    const includeAbsent = options?.includeAbsent ?? false;
    
    try {
      // Get all snapshots ordered by creation time
      const snapshots = await this.getSnapshots({ limit });
      
      if (snapshots.length === 0) {
        return [];
      }
      
      // Build query to get function data across all snapshots in one go
      const snapshotIds = snapshots.map(s => s.id);
      const placeholders = snapshotIds.map((_, i) => `$${i + 2}`).join(',');
      
      const functionsResult = await this.db.query(`
        SELECT 
          f.*,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        WHERE f.snapshot_id IN (${placeholders})
          AND (f.id = $1 OR f.id LIKE $1 || '%')
      `, [functionId, ...snapshotIds]);
      
      // Get all function IDs for batch parameter loading
      const functionIds = functionsResult.rows.map(row => (row as FunctionRow).id);
      
      // Batch load all parameters to avoid N+1 queries
      const parametersMap = new Map<string, ParameterRow[]>();
      if (functionIds.length > 0) {
        const parametersResult = await this.db.query(
          `SELECT * FROM function_parameters WHERE function_id = ANY($1) ORDER BY position`,
          [functionIds]
        );
        
        for (const paramRow of parametersResult.rows) {
          const param = paramRow as ParameterRow;
          if (!parametersMap.has(param.function_id)) {
            parametersMap.set(param.function_id, []);
          }
          parametersMap.get(param.function_id)!.push(param);
        }
      }
      
      // Create a map for quick lookup
      const functionMap = new Map<string, FunctionInfo>();
      for (const row of functionsResult.rows) {
        const functionRow = row as FunctionRow & Partial<MetricsRow>;
        // Get parameters from preloaded map
        const parameters = parametersMap.get(functionRow.id) || [];
        const func = this.mapRowToFunctionInfo(functionRow, parameters);
        // Use snapshot_id from the row to map functions
        functionMap.set(functionRow.snapshot_id, func);
      }
      
      // Build history array
      const history = snapshots.map(snapshot => {
        const func = functionMap.get(snapshot.id) || null;
        return {
          snapshot,
          function: func,
          isPresent: !!func
        };
      });
      
      // Filter out absent functions if requested
      if (!includeAbsent) {
        return history.filter(h => h.isPresent);
      }
      
      return history;
    } catch (error) {
      throw new Error(`Failed to get function history: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    // Check if functions table has the new schema
    const needsSchemaUpdate = await this.needsSchemaUpdate();
    
    if (needsSchemaUpdate) {
      // Drop old tables and recreate with new schema
      await this.dropOldTablesIfNeeded();
    }
    
    // Check if all core tables exist in one query to optimize startup
    const existingTables = await this.getExistingTables();
    const requiredTables = ['snapshots', 'functions', 'function_parameters', 'quality_metrics', 'function_descriptions', 'function_embeddings', 'naming_evaluations', 'lineage', 'ann_index_metadata', 'refactoring_sessions', 'session_functions', 'refactoring_opportunities'];
    
    // Only create tables that don't exist
    for (const tableName of requiredTables) {
      if (!existingTables.has(tableName)) {
        switch (tableName) {
          case 'snapshots':
            await this.db.exec(this.getSnapshotsTableSQL());
            break;
          case 'functions':
            await this.db.exec(this.getFunctionsTableSQL());
            break;
          case 'function_parameters':
            await this.db.exec(this.getParametersTableSQL());
            break;
          case 'quality_metrics':
            await this.db.exec(this.getMetricsTableSQL());
            break;
          case 'function_descriptions':
            await this.db.exec(this.getFunctionDescriptionsTableSQL());
            break;
          case 'function_embeddings':
            await this.db.exec(this.getFunctionEmbeddingsTableSQL());
            break;
          case 'naming_evaluations':
            await this.db.exec(this.getNamingEvaluationsTableSQL());
            break;
          case 'lineage':
            await this.db.exec(this.getLineageTableSQL());
            break;
          case 'ann_index_metadata':
            await this.db.exec(this.getANNIndexTableSQL());
            break;
          case 'refactoring_sessions':
            await this.db.exec(this.getRefactoringSessionsTableSQL());
            break;
          case 'session_functions':
            await this.db.exec(this.getSessionFunctionsTableSQL());
            break;
          case 'refactoring_opportunities':
            await this.db.exec(this.getRefactoringOpportunitiesTableSQL());
            break;
        }
      }
    }
    
    // Run migrations for existing tables
    await this.runMigrations();
    
    // Create triggers (they can be created multiple times safely)
    try {
      await this.db.exec(this.getTriggersSQL());
    } catch (error) {
      // Ignore trigger creation errors as they may already exist or not be supported
      console.warn('Trigger creation failed:', error instanceof Error ? error.message : String(error));
    }
  }
  
  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        );
      `, [tableName]);
      return (result.rows[0] as { exists: boolean })?.exists === true;
    } catch {
      return false;
    }
  }
  
  private async getExistingTables(): Promise<Set<string>> {
    try {
      const result = await this.db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      return new Set(result.rows.map(row => (row as { table_name: string }).table_name));
    } catch {
      return new Set();
    }
  }
  
  private async needsSchemaUpdate(): Promise<boolean> {
    try {
      const functionsExists = await this.tableExists('functions');
      if (!functionsExists) {
        return false; // No update needed if table doesn't exist
      }
      
      // Check if semantic_id column exists (indicates new schema)
      const result = await this.db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'functions' AND column_name = 'semantic_id';
      `);
      
      return result.rows.length === 0; // Need update if semantic_id doesn't exist
    } catch {
      return false;
    }
  }
  
  private async dropOldTablesIfNeeded(): Promise<void> {
    try {
      
      // Drop tables in reverse dependency order
      const dropTables = [
        'quality_metrics',
        'function_parameters', 
        'function_embeddings',
        'function_descriptions',
        'functions',
        'snapshots'
      ];
      
      for (const table of dropTables) {
        await this.db.exec(`DROP TABLE IF EXISTS ${table} CASCADE;`);
      }
      
    } catch (error) {
      console.warn('Error dropping old tables:', error instanceof Error ? error.message : String(error));
    }
  }

  private getSnapshotsTableSQL(): string {
    return `
      CREATE TABLE snapshots (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        label TEXT,
        comment TEXT,
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
      CREATE TABLE functions (
        -- Physical identification dimension
        id TEXT PRIMARY KEY,                   -- Physical UUID for unique function instance
        snapshot_id TEXT NOT NULL,             -- Snapshot reference
        start_line INTEGER NOT NULL,           -- Start line in file
        end_line INTEGER NOT NULL,             -- End line in file
        start_column INTEGER NOT NULL DEFAULT 0,
        end_column INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        
        -- Semantic identification dimension
        semantic_id TEXT NOT NULL,             -- Semantic hash for role-based identification
        name TEXT NOT NULL,                    -- Function name
        display_name TEXT NOT NULL,            -- Display name (Class.method etc.)
        signature TEXT NOT NULL,               -- Complete signature
        file_path TEXT NOT NULL,               -- Relative path from project root
        context_path TEXT,                     -- Hierarchical context JSON ['Class', 'method']
        function_type TEXT,                    -- 'function' | 'method' | 'arrow' | 'local'
        modifiers TEXT,                        -- Modifiers JSON ['static', 'private', 'async']
        nesting_level INTEGER DEFAULT 0,       -- Nesting depth
        
        -- Function attributes (semantic-based)
        is_exported BOOLEAN DEFAULT FALSE,
        is_async BOOLEAN DEFAULT FALSE,
        is_generator BOOLEAN DEFAULT FALSE,
        is_arrow_function BOOLEAN DEFAULT FALSE,
        is_method BOOLEAN DEFAULT FALSE,
        is_constructor BOOLEAN DEFAULT FALSE,
        is_static BOOLEAN DEFAULT FALSE,
        access_modifier TEXT,                  -- 'public' | 'private' | 'protected'
        
        -- Content identification dimension
        content_id TEXT NOT NULL,              -- Content hash for implementation identification
        ast_hash TEXT NOT NULL,                -- AST structure hash
        source_code TEXT,                      -- Function source code
        signature_hash TEXT NOT NULL,          -- Signature hash
        
        -- Efficiency fields
        file_hash TEXT NOT NULL,               -- File content hash
        file_content_hash TEXT,                -- File change detection optimization
        
        -- Documentation (to be moved to separate table in the future)
        js_doc TEXT,                          -- JSDoc comment
        
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
      );`;
  }

  private getParametersTableSQL(): string {
    return `
      CREATE TABLE function_parameters (
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
      CREATE TABLE quality_metrics (
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
      CREATE TABLE function_descriptions (
        semantic_id TEXT PRIMARY KEY,          -- 意味ベース参照
        description TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'human',  -- 'human' | 'ai' | 'jsdoc'
        validated_for_content_id TEXT,         -- 実装確認済みマーク
        needs_review BOOLEAN DEFAULT FALSE,    -- 実装変更時の確認要求
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,                       -- 作成者
        ai_model TEXT,                         -- AI生成時のモデル名
        confidence_score REAL                  -- AI生成時の信頼度
      );`;
  }

  private getFunctionEmbeddingsTableSQL(): string {
    return `
      CREATE TABLE function_embeddings (
        semantic_id TEXT PRIMARY KEY,
        embedding_model TEXT NOT NULL DEFAULT 'text-embedding-ada-002',
        vector_dimension INTEGER NOT NULL DEFAULT 1536,
        embedding REAL[] NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (semantic_id) REFERENCES function_descriptions(semantic_id) ON DELETE CASCADE
      );`;
  }

  private getANNIndexTableSQL(): string {
    return `
      CREATE TABLE ann_index_metadata (
        id TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL CHECK (algorithm IN ('hierarchical', 'lsh', 'hybrid')),
        config_json TEXT NOT NULL,                   -- JSON serialized ANNConfig
        embedding_model TEXT NOT NULL,               -- Model used for embeddings
        vector_dimension INTEGER NOT NULL,           -- Dimension of vectors in index
        vector_count INTEGER NOT NULL DEFAULT 0,    -- Number of vectors indexed
        index_data TEXT,                            -- Serialized index data (clusters, hash tables, etc.)
        build_time_ms INTEGER,                      -- Time taken to build index
        accuracy_metrics TEXT,                      -- JSON with accuracy/performance metrics
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        is_current BOOLEAN DEFAULT TRUE             -- Whether this is the current active index
      );`;
  }

  private getNamingEvaluationsTableSQL(): string {
    return `
      CREATE TABLE naming_evaluations (
        function_id TEXT PRIMARY KEY,
        semantic_id TEXT NOT NULL,
        function_name TEXT NOT NULL,
        description_hash TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating IN (1, 2, 3)),
        evaluated_at BIGINT NOT NULL,
        evaluated_by TEXT NOT NULL CHECK (evaluated_by IN ('human', 'ai', 'auto')),
        issues TEXT,
        suggestions TEXT,
        revision_needed BOOLEAN DEFAULT FALSE,
        ai_model TEXT,
        confidence REAL CHECK (confidence >= 0.0 AND confidence <= 1.0),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );`;
  }

  private getLineageTableSQL(): string {
    return `
      CREATE TABLE lineage (
        id TEXT PRIMARY KEY,
        from_ids TEXT[] NOT NULL,
        to_ids TEXT[] NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('rename', 'signature-change', 'inline', 'split')),
        status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'rejected')),
        confidence REAL CHECK (confidence >= 0.0 AND confidence <= 1.0),
        note TEXT,
        git_commit TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ
      );`;
  }

  private getRefactoringSessionsTableSQL(): string {
    return `
      CREATE TABLE refactoring_sessions (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        git_branch TEXT,
        initial_commit TEXT,
        final_commit TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')) DEFAULT 'active',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );`;
  }

  private getSessionFunctionsTableSQL(): string {
    return `
      CREATE TABLE session_functions (
        session_id TEXT NOT NULL,
        function_id TEXT NOT NULL,
        tracked_at INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('source', 'target', 'intermediate')) DEFAULT 'source',
        metadata JSONB DEFAULT '{}',
        PRIMARY KEY (session_id, function_id),
        FOREIGN KEY (session_id) REFERENCES refactoring_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );`;
  }

  private getRefactoringOpportunitiesTableSQL(): string {
    return `
      CREATE TABLE refactoring_opportunities (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL CHECK (pattern IN ('extract-method', 'split-function', 'reduce-parameters', 'extract-class', 'inline-function', 'rename-function')),
        function_id TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
        impact_score INTEGER NOT NULL CHECK (impact_score >= 0 AND impact_score <= 100),
        detected_at INTEGER NOT NULL,
        resolved_at INTEGER,
        session_id TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES refactoring_sessions(id) ON DELETE SET NULL
      );`;
  }

  private getTriggersSQL(): string {
    return `
      -- 自動トリガー: 内容変更検出
      CREATE OR REPLACE FUNCTION update_function_description_review() RETURNS TRIGGER AS $$
      BEGIN
        UPDATE function_descriptions 
        SET needs_review = TRUE 
        WHERE semantic_id = NEW.semantic_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      
      DROP TRIGGER IF EXISTS function_content_change_detection ON functions;
      CREATE TRIGGER function_content_change_detection
        AFTER UPDATE ON functions
        FOR EACH ROW
        WHEN (OLD.content_id IS DISTINCT FROM NEW.content_id)
        EXECUTE FUNCTION update_function_description_review();
    `;
  }

  private async runMigrations(): Promise<void> {
    try {
      // Check if function_descriptions table needs new columns
      const needsStructuredFields = await this.needsStructuredFieldsMigration();
      if (needsStructuredFields) {
        await this.addStructuredFieldsToDescriptions();
      }
    } catch (error) {
      // Log migration errors but don't fail initialization
      console.warn('Migration warning:', error instanceof Error ? error.message : String(error));
    }
  }

  private async needsStructuredFieldsMigration(): Promise<boolean> {
    try {
      const result = await this.db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'function_descriptions' 
        AND column_name IN ('usage_example', 'side_effects', 'error_conditions');
      `);
      // If we don't have all 3 columns, we need migration
      return result.rows.length < 3;
    } catch {
      return false;
    }
  }

  private async addStructuredFieldsToDescriptions(): Promise<void> {
    try {
      // Add new columns if they don't exist
      await this.db.exec(`
        ALTER TABLE function_descriptions 
        ADD COLUMN IF NOT EXISTS usage_example TEXT,
        ADD COLUMN IF NOT EXISTS side_effects TEXT,
        ADD COLUMN IF NOT EXISTS error_conditions TEXT;
      `);
      console.log('Successfully added structured fields to function_descriptions table');
    } catch (error) {
      throw new Error(`Failed to add structured fields: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async createIndexes(): Promise<void> {
    try {
      await this.db.exec(`
      -- 3次元識別に最適化されたインデックス
      CREATE INDEX IF NOT EXISTS idx_functions_snapshot_id ON functions(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_functions_semantic_id ON functions(semantic_id);
      CREATE INDEX IF NOT EXISTS idx_functions_content_id ON functions(content_id);
      CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);
      CREATE INDEX IF NOT EXISTS idx_functions_file_path ON functions(file_path);
      CREATE INDEX IF NOT EXISTS idx_functions_signature_hash ON functions(signature_hash);
      CREATE INDEX IF NOT EXISTS idx_functions_ast_hash ON functions(ast_hash);

      -- 複合インデックス
      CREATE INDEX IF NOT EXISTS idx_functions_semantic_content ON functions(semantic_id, content_id);
      CREATE INDEX IF NOT EXISTS idx_functions_snapshot_semantic ON functions(snapshot_id, semantic_id);

      -- 条件付きインデックス
      CREATE INDEX IF NOT EXISTS idx_functions_exported ON functions(is_exported) WHERE is_exported = TRUE;
      CREATE INDEX IF NOT EXISTS idx_functions_async ON functions(is_async) WHERE is_async = TRUE;

      -- 重複検出用インデックス
      CREATE INDEX IF NOT EXISTS idx_content_duplication ON functions(content_id, snapshot_id);
      
      -- Snapshot indexes
      CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
      CREATE INDEX IF NOT EXISTS idx_snapshots_git_commit ON snapshots(git_commit);
      CREATE INDEX IF NOT EXISTS idx_snapshots_git_branch ON snapshots(git_branch);
      
      -- パフォーマンス最適化インデックス
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_complexity ON quality_metrics(cyclomatic_complexity);
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_cognitive ON quality_metrics(cognitive_complexity);
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_lines ON quality_metrics(lines_of_code);
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_nesting ON quality_metrics(max_nesting_level);
      
      -- Parameter search indexes
      CREATE INDEX IF NOT EXISTS idx_function_parameters_function_id ON function_parameters(function_id);
      CREATE INDEX IF NOT EXISTS idx_function_parameters_position ON function_parameters(function_id, position);
      
      -- 意味ベース関数説明管理インデックス
      CREATE INDEX IF NOT EXISTS idx_function_descriptions_source ON function_descriptions(source);
      CREATE INDEX IF NOT EXISTS idx_function_descriptions_needs_review ON function_descriptions(needs_review) WHERE needs_review = TRUE;
      
      -- Naming evaluations indexes
      CREATE INDEX IF NOT EXISTS idx_naming_evaluations_semantic_id ON naming_evaluations(semantic_id);
      CREATE INDEX IF NOT EXISTS idx_naming_evaluations_rating ON naming_evaluations(rating);
      CREATE INDEX IF NOT EXISTS idx_naming_evaluations_evaluated_by ON naming_evaluations(evaluated_by);
      CREATE INDEX IF NOT EXISTS idx_naming_evaluations_revision_needed ON naming_evaluations(revision_needed) WHERE revision_needed = TRUE;
      CREATE INDEX IF NOT EXISTS idx_naming_evaluations_evaluated_at ON naming_evaluations(evaluated_at);

      -- Lineage table indexes for performance optimization
      CREATE INDEX IF NOT EXISTS idx_lineage_status ON lineage(status);
      CREATE INDEX IF NOT EXISTS idx_lineage_kind ON lineage(kind);
      CREATE INDEX IF NOT EXISTS idx_lineage_confidence ON lineage(confidence);
      CREATE INDEX IF NOT EXISTS idx_lineage_git_commit ON lineage(git_commit);
      CREATE INDEX IF NOT EXISTS idx_lineage_created_at ON lineage(created_at);
      CREATE INDEX IF NOT EXISTS idx_lineage_updated_at ON lineage(updated_at);
      
      -- GIN indexes for array operations on from_ids and to_ids
      CREATE INDEX IF NOT EXISTS idx_lineage_from_ids_gin ON lineage USING GIN(from_ids);
      CREATE INDEX IF NOT EXISTS idx_lineage_to_ids_gin ON lineage USING GIN(to_ids);
      
      -- Composite indexes for common query patterns
      CREATE INDEX IF NOT EXISTS idx_lineage_status_kind ON lineage(status, kind);
      CREATE INDEX IF NOT EXISTS idx_lineage_status_created_at ON lineage(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lineage_kind_created_at ON lineage(kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lineage_confidence_created_at ON lineage(confidence DESC, created_at DESC);
      
      -- Refactoring session indexes
      CREATE INDEX IF NOT EXISTS idx_refactoring_sessions_status ON refactoring_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_refactoring_sessions_start_time ON refactoring_sessions(start_time);
      CREATE INDEX IF NOT EXISTS idx_refactoring_sessions_git_branch ON refactoring_sessions(git_branch);
      CREATE INDEX IF NOT EXISTS idx_refactoring_sessions_created_at ON refactoring_sessions(created_at);
      
      -- Session functions indexes
      CREATE INDEX IF NOT EXISTS idx_session_functions_session_id ON session_functions(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_functions_function_id ON session_functions(function_id);
      CREATE INDEX IF NOT EXISTS idx_session_functions_role ON session_functions(role);
      CREATE INDEX IF NOT EXISTS idx_session_functions_tracked_at ON session_functions(tracked_at);
      
      -- Refactoring opportunities indexes
      CREATE INDEX IF NOT EXISTS idx_refactoring_opportunities_pattern ON refactoring_opportunities(pattern);
      CREATE INDEX IF NOT EXISTS idx_refactoring_opportunities_function_id ON refactoring_opportunities(function_id);
      CREATE INDEX IF NOT EXISTS idx_refactoring_opportunities_severity ON refactoring_opportunities(severity);
      CREATE INDEX IF NOT EXISTS idx_refactoring_opportunities_impact_score ON refactoring_opportunities(impact_score);
      CREATE INDEX IF NOT EXISTS idx_refactoring_opportunities_detected_at ON refactoring_opportunities(detected_at);
      CREATE INDEX IF NOT EXISTS idx_refactoring_opportunities_session_id ON refactoring_opportunities(session_id);
      CREATE INDEX IF NOT EXISTS idx_refactoring_opportunities_unresolved ON refactoring_opportunities(pattern, severity) WHERE resolved_at IS NULL;
    `);
    } catch (error) {
      // このエラーは予期しないもの（構文エラーなど）なので、適切にログ出力
      throw new Error(`Failed to create database indexes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
    const metadata = this.calculateSnapshotMetadata(functions);
    // Use current UTC timestamp explicitly
    const nowUTC = new Date().toISOString();
    
    await this.db.query(`
      INSERT INTO snapshots (id, label, comment, git_commit, git_branch, git_tag, project_root, config_hash, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
    `, [
      snapshotId,
      label || null,
      comment || null,
      await this.getGitCommit(),
      await this.getGitBranch(),
      await this.getGitTag(),
      process.cwd(),
      configHash,
      JSON.stringify(metadata),
      nowUTC
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
  
  /**
   * Save a batch of functions with transaction management
   */
  private async insertFunctionRecord(func: FunctionInfo, snapshotId: string): Promise<void> {
    await this.db.query(`
      INSERT INTO functions (
        id, semantic_id, content_id, snapshot_id, name, display_name, signature, signature_hash,
        file_path, file_hash, start_line, end_line, start_column, end_column,
        ast_hash, context_path, function_type, modifiers, nesting_level,
        is_exported, is_async, is_generator, is_arrow_function,
        is_method, is_constructor, is_static, access_modifier,
        js_doc, source_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
      )
    `, [
      func.id, func.semanticId, func.contentId, snapshotId, func.name, func.displayName, func.signature, func.signatureHash,
      func.filePath, func.fileHash, func.startLine, func.endLine, func.startColumn, func.endColumn,
      func.astHash, JSON.stringify(func.contextPath || []), func.functionType || null, JSON.stringify(func.modifiers || []), func.nestingLevel || 0,
      func.isExported, func.isAsync, func.isGenerator, func.isArrowFunction,
      func.isMethod, func.isConstructor, func.isStatic, func.accessModifier || null,
      func.jsDoc || null, func.sourceCode || null
    ]);
  }

  private async insertFunctionParameters(func: FunctionInfo): Promise<void> {
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
  }

  private async insertFunctionMetrics(func: FunctionInfo): Promise<void> {
    if (!func.metrics) {
      return;
    }

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

  private async saveSingleFunction(func: FunctionInfo, snapshotId: string): Promise<void> {
    await this.insertFunctionRecord(func, snapshotId);
    await this.insertFunctionParameters(func);
    await this.insertFunctionMetrics(func);
  }

  async saveFunctionsBatch(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    await this.executeInTransaction(async () => {
      for (const func of functions) {
        await this.saveSingleFunction(func, snapshotId);
      }
    });
  }

  private async getFunctionParameters(functionId: string): Promise<ParameterRow[]> {
    const result = await this.db.query(
      'SELECT * FROM function_parameters WHERE function_id = $1 ORDER BY position',
      [functionId]
    );
    return result.rows as ParameterRow[];
  }

  private async getFunctionParametersBatch(functionIds: string[]): Promise<Map<string, ParameterRow[]>> {
    if (functionIds.length === 0) {
      return new Map();
    }

    const idsArray = this.formatPostgresArrayLiteral(functionIds);
    const result = await this.db.query(
      'SELECT * FROM function_parameters WHERE function_id = ANY($1::text[]) ORDER BY function_id, position',
      [idsArray]
    );

    const parameterMap = new Map<string, ParameterRow[]>();
    
    for (const row of result.rows as ParameterRow[]) {
      const functionId = row.function_id;
      if (!parameterMap.has(functionId)) {
        parameterMap.set(functionId, []);
      }
      parameterMap.get(functionId)!.push(row);
    }

    return parameterMap;
  }

  private mapRowToSnapshotInfo(row: SnapshotRow): SnapshotInfo {
    return {
      id: row.id,
      createdAt: new Date(row.created_at).getTime(),
      ...(row.label && { label: row.label }),
      ...(row.comment && { comment: row.comment }),
      ...(row.git_commit && { gitCommit: row.git_commit }),
      ...(row.git_branch && { gitBranch: row.git_branch }),
      ...(row.git_tag && { gitTag: row.git_tag }),
      projectRoot: row.project_root,
      configHash: row.config_hash,
      metadata: JSON.parse(row.metadata || '{}')
    };
  }

  private mapRowToFunctionInfo(row: FunctionRow & Partial<MetricsRow> & { description?: string; source?: string; created_at?: string; updated_at?: string; ai_model?: string }, parameters: ParameterRow[]): FunctionInfo {
    const functionInfo = this.createBaseFunctionInfo(row, parameters);
    this.addOptionalProperties(functionInfo, row);
    this.addMetricsIfAvailable(functionInfo, row);
    return functionInfo;
  }

  private createBaseFunctionInfo(row: FunctionRow, parameters: ParameterRow[]): FunctionInfo {
    return {
      id: row.id,
      semanticId: row.semantic_id,
      contentId: row.content_id,
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
      
      // Enhanced function identification
      ...(row.context_path && { contextPath: this.safeJsonParse(row.context_path, []) }),
      ...(row.function_type && { functionType: row.function_type }),
      ...(row.modifiers && { modifiers: this.safeJsonParse(row.modifiers, []) }),
      ...(row.nesting_level !== undefined && { nestingLevel: row.nesting_level }),
      
      // Existing function attributes
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

  private addOptionalProperties(functionInfo: FunctionInfo, row: FunctionRow & { description?: string; source?: string; created_at?: string; updated_at?: string; ai_model?: string }): void {
    if (row.access_modifier) functionInfo.accessModifier = row.access_modifier;
    if (row.js_doc) functionInfo.jsDoc = row.js_doc;
    if (row.source_code) functionInfo.sourceCode = row.source_code;
    if (row.description) {
      functionInfo.description = row.description;
      // Add description metadata as proper properties on the functionInfo object
      if (row.source) functionInfo.descriptionSource = row.source;
      if (row.created_at) functionInfo.descriptionCreatedAt = row.created_at;
      if (row.updated_at) functionInfo.descriptionUpdatedAt = row.updated_at;
      if (row.ai_model) functionInfo.descriptionAiModel = row.ai_model;
    }
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

  // ========================================
  // NAMING EVALUATION OPERATIONS (v1.6 Enhancement)
  // ========================================

  async saveNamingEvaluation(evaluation: NamingEvaluation): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO naming_evaluations (
          function_id, semantic_id, function_name, description_hash, rating,
          evaluated_at, evaluated_by, issues, suggestions, revision_needed,
          ai_model, confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (function_id) DO UPDATE SET
          semantic_id = EXCLUDED.semantic_id,
          function_name = EXCLUDED.function_name,
          description_hash = EXCLUDED.description_hash,
          rating = EXCLUDED.rating,
          evaluated_at = EXCLUDED.evaluated_at,
          evaluated_by = EXCLUDED.evaluated_by,
          issues = EXCLUDED.issues,
          suggestions = EXCLUDED.suggestions,
          revision_needed = EXCLUDED.revision_needed,
          ai_model = EXCLUDED.ai_model,
          confidence = EXCLUDED.confidence,
          updated_at = CURRENT_TIMESTAMP
      `, [
        evaluation.functionId,
        evaluation.semanticId,
        evaluation.functionName,
        evaluation.descriptionHash,
        evaluation.rating,
        evaluation.evaluatedAt,
        evaluation.evaluatedBy,
        evaluation.issues || null,
        evaluation.suggestions || null,
        evaluation.revisionNeeded,
        evaluation.aiModel || null,
        evaluation.confidence || null
      ]);
    } catch (error) {
      throw new Error(`Failed to save naming evaluation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getNamingEvaluation(functionId: string): Promise<NamingEvaluation | null> {
    try {
      const queryResult = await this.db.query(
        'SELECT * FROM naming_evaluations WHERE function_id = $1',
        [functionId]
      );

      if (queryResult.rows.length === 0) {
        return null;
      }

      const row = queryResult.rows[0] as {
        function_id: string;
        semantic_id: string;
        function_name: string;
        description_hash: string;
        rating: 1 | 2 | 3;
        evaluated_at: string;
        evaluated_by: 'human' | 'ai' | 'auto';
        issues?: string;
        suggestions?: string;
        revision_needed: boolean;
        ai_model?: string;
        confidence?: number;
      };

      const result: NamingEvaluation = {
        functionId: row.function_id,
        semanticId: row.semantic_id,
        functionName: row.function_name,
        descriptionHash: row.description_hash,
        rating: row.rating,
        evaluatedAt: parseInt(row.evaluated_at),
        evaluatedBy: row.evaluated_by,
        revisionNeeded: row.revision_needed
      };

      if (row.issues) result.issues = row.issues;
      if (row.suggestions) result.suggestions = row.suggestions;
      if (row.ai_model) result.aiModel = row.ai_model;
      if (row.confidence !== null && row.confidence !== undefined) result.confidence = row.confidence;

      return result;
    } catch (error) {
      throw new Error(`Failed to get naming evaluation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsNeedingEvaluation(snapshotId: string, options?: QueryOptions): Promise<Array<{ functionId: string; functionName: string; lastModified: number }>> {
    try {
      let sql = `
        SELECT 
          f.id as function_id,
          f.name as function_name,
          EXTRACT(EPOCH FROM f.created_at) * 1000 as last_modified
        FROM functions f
        LEFT JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1 
        AND (
          ne.function_id IS NULL 
          OR ne.revision_needed = TRUE
        )
        ORDER BY f.created_at DESC
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

      return result.rows.map(row => ({
        functionId: (row as { function_id: string }).function_id,
        functionName: (row as { function_name: string }).function_name,
        lastModified: (row as { last_modified: number }).last_modified
      }));
    } catch (error) {
      throw new Error(`Failed to get functions needing evaluation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsWithEvaluations(snapshotId: string, options?: QueryOptions): Promise<Array<{ functionId: string; evaluation: NamingEvaluation }>> {
    try {
      let sql = `
        SELECT 
          f.id as function_id,
          ne.*
        FROM functions f
        INNER JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1
        ORDER BY ne.evaluated_at DESC
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

      return result.rows.map(row => {
        const r = row as {
          function_id: string;
          semantic_id: string;
          function_name: string;
          description_hash: string;
          rating: 1 | 2 | 3;
          evaluated_at: string;
          evaluated_by: 'human' | 'ai' | 'auto';
          issues?: string;
          suggestions?: string;
          revision_needed: boolean;
          ai_model?: string;
          confidence?: number;
        };

        const evaluation: NamingEvaluation = {
          functionId: r.function_id,
          semanticId: r.semantic_id,
          functionName: r.function_name,
          descriptionHash: r.description_hash,
          rating: r.rating,
          evaluatedAt: parseInt(r.evaluated_at),
          evaluatedBy: r.evaluated_by,
          revisionNeeded: r.revision_needed
        };

        if (r.issues) evaluation.issues = r.issues;
        if (r.suggestions) evaluation.suggestions = r.suggestions;
        if (r.ai_model) evaluation.aiModel = r.ai_model;
        if (r.confidence !== null && r.confidence !== undefined) evaluation.confidence = r.confidence;

        return {
          functionId: r.function_id,
          evaluation
        };
      });
    } catch (error) {
      throw new Error(`Failed to get functions with evaluations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateEvaluationRevisionStatus(functionId: string, revisionNeeded: boolean): Promise<void> {
    try {
      await this.db.query(
        'UPDATE naming_evaluations SET revision_needed = $1, updated_at = CURRENT_TIMESTAMP WHERE function_id = $2',
        [revisionNeeded, functionId]
      );
    } catch (error) {
      throw new Error(`Failed to update evaluation revision status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async batchSaveEvaluations(evaluations: NamingEvaluation[]): Promise<void> {
    if (evaluations.length === 0) return;

    try {
      await TransactionalBatchProcessor.processWithTransaction(
        evaluations,
        {
          processBatch: async (batch: NamingEvaluation[]) => {
            const values = batch.map((_, index) => {
              const offset = index * 12;
              return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`;
            }).join(', ');

            const params = batch.flatMap((evaluation: NamingEvaluation) => [
              evaluation.functionId,
              evaluation.semanticId,
              evaluation.functionName,
              evaluation.descriptionHash,
              evaluation.rating,
              evaluation.evaluatedAt,
              evaluation.evaluatedBy,
              evaluation.issues || null,
              evaluation.suggestions || null,
              evaluation.revisionNeeded,
              evaluation.aiModel || null,
              evaluation.confidence || null
            ]);

            await this.db.query(`
              INSERT INTO naming_evaluations (
                function_id, semantic_id, function_name, description_hash, rating,
                evaluated_at, evaluated_by, issues, suggestions, revision_needed,
                ai_model, confidence
              ) VALUES ${values}
              ON CONFLICT (function_id) DO UPDATE SET
                semantic_id = EXCLUDED.semantic_id,
                function_name = EXCLUDED.function_name,
                description_hash = EXCLUDED.description_hash,
                rating = EXCLUDED.rating,
                evaluated_at = EXCLUDED.evaluated_at,
                evaluated_by = EXCLUDED.evaluated_by,
                issues = EXCLUDED.issues,
                suggestions = EXCLUDED.suggestions,
                revision_needed = EXCLUDED.revision_needed,
                ai_model = EXCLUDED.ai_model,
                confidence = EXCLUDED.confidence,
                updated_at = CURRENT_TIMESTAMP
            `, params);
          },
          onError: async (error: Error, _batch: NamingEvaluation[]) => {
            throw error;
          },
          onSuccess: async (_batch: NamingEvaluation[]) => {
            // Success callback
          }
        },
        10 // Process in batches of 10
      );
    } catch (error) {
      throw new Error(`Failed to batch save evaluations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getEvaluationStatistics(snapshotId: string): Promise<{
    total: number;
    withEvaluations: number;
    needingEvaluation: number;
    averageRating: number;
    ratingDistribution: Record<1 | 2 | 3, number>;
  }> {
    try {
      // Get total functions count
      const totalResult = await this.db.query(
        'SELECT COUNT(*) as total FROM functions WHERE snapshot_id = $1',
        [snapshotId]
      );
      const total = Number((totalResult.rows[0] as { total: string | number }).total);

      // Get functions with evaluations
      const evaluationsResult = await this.db.query(`
        SELECT 
          COUNT(*) as with_evaluations,
          AVG(ne.rating::numeric) as average_rating,
          SUM(CASE WHEN ne.rating = 1 THEN 1 ELSE 0 END) as rating_1,
          SUM(CASE WHEN ne.rating = 2 THEN 1 ELSE 0 END) as rating_2,
          SUM(CASE WHEN ne.rating = 3 THEN 1 ELSE 0 END) as rating_3
        FROM functions f
        INNER JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1
      `, [snapshotId]);

      const evalRow = evaluationsResult.rows[0] as {
        with_evaluations: string | number;
        average_rating: string | number;
        rating_1: string | number;
        rating_2: string | number;
        rating_3: string | number;
      };

      // Get functions needing evaluation
      const needingResult = await this.db.query(`
        SELECT COUNT(*) as needing_evaluation
        FROM functions f
        LEFT JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1 
        AND (ne.function_id IS NULL OR ne.revision_needed = TRUE)
      `, [snapshotId]);

      const needingEvaluation = Number((needingResult.rows[0] as { needing_evaluation: string | number }).needing_evaluation);

      return {
        total,
        withEvaluations: Number(evalRow.with_evaluations) || 0,
        needingEvaluation,
        averageRating: Number(evalRow.average_rating) || 0,
        ratingDistribution: {
          1: Number(evalRow.rating_1) || 0,
          2: Number(evalRow.rating_2) || 0,
          3: Number(evalRow.rating_3) || 0
        }
      };
    } catch (error) {
      throw new Error(`Failed to get evaluation statistics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Safely parse JSON with fallback value
   */
  private safeJsonParse<T>(jsonString: string, fallback: T): T {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.warn(`Failed to parse JSON: ${jsonString}`, error);
      return fallback;
    }
  }

  /**
   * Get direct access to the database connection for advanced operations
   */
  getDb(): PGlite {
    return this.db;
  }
}
