/**
 * Function operations module for PGLite storage
 */

import { 
  FunctionInfo, 
  QueryOptions, 
  FunctionRow,
  MetricsRow,
  ParameterInfo,
  QualityMetrics
} from '../../types';
import { SnapshotRow, ParameterRow } from '../../types/common';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext, StorageOperationModule } from './types';
import { 
  BatchProcessor,
  TransactionalBatchProcessor,
  BatchTransactionProcessor 
} from '../../utils/batch-processor';
import { 
  prepareBulkInsertData,
  executeUnnestBulkInsert
} from '../bulk-insert-utils';
import { buildScopeWhereClause } from '../../utils/scope-utils';
import { ConfigManager } from '../../core/config';

// Type for PGLite transaction object
interface PGTransaction {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export class FunctionOperations implements StorageOperationModule {
  readonly db;
  private context: StorageContext;
  private logger;

  // Field mappings for query building
  private readonly fieldMapping = new Map([
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
    ['maintainability_index', 'q.maintainability_index'],
    // Change count fields (cc alias)
    ['change_count', 'cc.change_count'],
    ['changes', 'cc.change_count'],
  ]);

  // Valid sort fields mapping
  private readonly validSortFields = new Map([
    ['name', 'f.name'],
    ['file_path', 'f.file_path'],
    ['start_line', 'f.start_line'],
    ['complexity', 'q.cyclomatic_complexity'],
    ['lines_of_code', 'q.lines_of_code'],
    ['parameter_count', 'q.parameter_count'],
    ['is_exported', 'f.is_exported'],
    ['is_async', 'f.is_async'],
    ['display_name', 'f.display_name'],
    ['changes', 'cc.change_count'],
  ]);

  constructor(context: StorageContext) {
    this.db = context.db;
    this.context = context;
    this.logger = context.logger;
  }

  get kysely() {
    return this.context.kysely;
  }

  /**
   * Check if change count is needed for the query
   */
  private needsChangeCount(options?: QueryOptions): boolean {
    if (!options?.filters) return false;
    
    // Check if there's a change count filter or sort
    const hasChangeFilter = options.filters.some(filter => 
      filter.field === 'change_count' || filter.field === 'changes'
    );
    
    const hasChangeSort = options?.sort && 
      typeof options.sort === 'string' && 
      options.sort.split(',').some(field => field.trim() === 'changes');
    
    return hasChangeFilter || !!hasChangeSort;
  }

  /**
   * Get functions for a snapshot with filtering and pagination
   */
  async getFunctions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      const isListCommand = !options?.includeFullData;
      const needsChangeCount = this.needsChangeCount(options);
      
      let sql = this.buildFunctionQuery(isListCommand, needsChangeCount);
      const params: (string | number | unknown)[] = [snapshotId];

      // Add scope-based filtering if scope is specified
      if (options?.scope) {
        try {
          const configManager = new ConfigManager();
          await configManager.load();
          const scopeConfig = configManager.resolveScopeConfig(options.scope);
          const scopeFilter = buildScopeWhereClause(scopeConfig, 'f.file_path', params.length);
          
          if (scopeFilter.whereClause !== '1=1') {
            sql += ' AND ' + scopeFilter.whereClause;
            params.push(...scopeFilter.params);
          }
        } catch (error) {
          // Log warning but continue without scope filtering to avoid breaking queries
          this.logger?.warn(`Failed to apply scope filtering for '${options.scope}': ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Add filters
      if (options?.filters && options.filters.length > 0) {
        const filterClause = this.buildFilterClause(options.filters, params);
        sql += ' AND ' + filterClause;
      }

      // Add sorting
      sql += this.buildOrderByClause(options?.sort);

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
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get functions: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get a single function by ID
   */
  async getFunction(functionId: string): Promise<FunctionInfo | null> {
    try {
      const result = await this.db.query(
        `
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
        `,
        [functionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as FunctionRow & Partial<MetricsRow>;
      const parameters = await this.getFunctionParameters(row.id);
      return this.mapRowToFunctionInfo(row, parameters);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get function: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Find a single function by ID (alias for getFunction)
   */
  async findFunction(functionId: string): Promise<FunctionInfo | null> {
    return this.getFunction(functionId);
  }

  /**
   * Get all functions for a snapshot
   */
  async getFunctionsBySnapshot(snapshotId: string): Promise<FunctionInfo[]> {
    try {
      const result = await this.db.query(
        this.buildFunctionQuery(false) + ' ORDER BY f.start_line',
        [snapshotId]
      );

      const functions = await Promise.all(
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get functions for snapshot: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Find all functions in a snapshot
   */
  async findFunctionsInSnapshot(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    if (options) {
      return this.getFunctions(snapshotId, options);
    }
    return this.getFunctionsBySnapshot(snapshotId);
  }

  /**
   * Save functions within a transaction for atomic operations
   */
  async saveFunctionsInTransaction(trx: PGTransaction, snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    if (functions.length === 0) return;

    try {
      // Prepare all bulk insert data
      const bulkData = prepareBulkInsertData(functions, snapshotId);
      
      // Execute all inserts within the provided transaction
      // 1. Bulk insert functions
      await this.executeBulkInsertInTransaction(
        trx,
        'functions',
        [
          'id', 'semantic_id', 'content_id', 'snapshot_id', 'name', 'display_name',
          'signature', 'signature_hash', 'file_path', 'file_hash', 'start_line',
          'end_line', 'start_column', 'end_column', 'ast_hash', 'context_path',
          'function_type', 'modifiers', 'nesting_level', 'is_exported', 'is_async',
          'is_generator', 'is_arrow_function', 'is_method', 'is_constructor',
          'is_static', 'access_modifier', 'source_code', 'source_file_ref_id'
        ],
        bulkData.functions
      );
      
      // 2. Bulk insert parameters (if any)
      if (bulkData.parameters.length > 0) {
        await this.executeBulkInsertInTransaction(
          trx,
          'function_parameters',
          [
            'function_id', 'snapshot_id', 'name', 'type', 'type_simple', 'position',
            'is_optional', 'is_rest', 'default_value', 'description'
          ],
          bulkData.parameters
        );
      }
      
      // 3. Bulk insert metrics (if any)
      if (bulkData.metrics.length > 0) {
        await this.executeBulkInsertInTransaction(
          trx,
          'quality_metrics',
          [
            'function_id', 'snapshot_id', 'lines_of_code', 'total_lines', 'cyclomatic_complexity',
            'cognitive_complexity', 'max_nesting_level', 'parameter_count',
            'return_statement_count', 'branch_count', 'loop_count', 'try_catch_count',
            'async_await_count', 'callback_count', 'comment_lines',
            'code_to_comment_ratio', 'halstead_volume', 'halstead_difficulty',
            'maintainability_index'
          ],
          bulkData.metrics
        );
      }
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save functions in transaction: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save functions for a snapshot (non-transactional version)
   */
  async saveFunctions(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    if (functions.length === 0) return;

    try {
      // Use optimal batch size based on function count
      const batchSize = BatchProcessor.calculateFunctionBatchSize(functions);

      // Create transaction processor
      const processor: BatchTransactionProcessor<FunctionInfo> = {
        processBatch: async (batch: FunctionInfo[]) => {
          await this.saveFunctionsBatch(snapshotId, batch);
        },
        onError: async (error: Error, batch: FunctionInfo[]) => {
          this.logger?.warn(`Failed to save batch of ${batch.length} functions: ${error.message}`);
        },
        onSuccess: async (_batch: FunctionInfo[]) => {
          // Optional: Log successful batch processing
        },
      };

      // Process all functions in batches with transaction support
      await TransactionalBatchProcessor.processWithTransaction(functions, processor, batchSize);

      // Verify save in development
      if (process.env['NODE_ENV'] !== 'production' && functions.length < 100) {
        await this.verifySavedFunctions(snapshotId, functions.length);
      }
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to save functions: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save a batch of functions
   */
  private async saveFunctionsBatch(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    // Use bulk insert for better performance when batch size is large enough
    if (functions.length >= 10) {
      await this.saveFunctionsBulk(snapshotId, functions);
    } else {
      // For small batches, use individual inserts
      for (const func of functions) {
        await this.saveSingleFunction(func, snapshotId);
      }
    }
  }

  /**
   * Save functions using true bulk insert with transaction
   */
  private async saveFunctionsBulk(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    // Prepare all bulk insert data
    const bulkData = prepareBulkInsertData(functions, snapshotId);
    
    // Execute all inserts within a single transaction
    await this.db.transaction(async (trx: PGTransaction) => {
      // 1. Bulk insert functions
      await this.executeBulkInsert(
        trx,
        'functions',
        [
          'id', 'semantic_id', 'content_id', 'snapshot_id', 'name', 'display_name',
          'signature', 'signature_hash', 'file_path', 'file_hash', 'start_line',
          'end_line', 'start_column', 'end_column', 'ast_hash', 'context_path',
          'function_type', 'modifiers', 'nesting_level', 'is_exported', 'is_async',
          'is_generator', 'is_arrow_function', 'is_method', 'is_constructor',
          'is_static', 'access_modifier', 'source_code', 'source_file_ref_id'
        ],
        bulkData.functions
      );
      
      // 2. Bulk insert parameters (if any)
      if (bulkData.parameters.length > 0) {
        await this.executeBulkInsert(
          trx,
          'function_parameters',
          [
            'function_id', 'snapshot_id', 'name', 'type', 'type_simple', 'position',
            'is_optional', 'is_rest', 'default_value', 'description'
          ],
          bulkData.parameters
        );
      }
      
      // 3. Bulk insert metrics (if any)
      if (bulkData.metrics.length > 0) {
        await this.executeBulkInsert(
          trx,
          'quality_metrics',
          [
            'function_id', 'snapshot_id', 'lines_of_code', 'total_lines', 'cyclomatic_complexity',
            'cognitive_complexity', 'max_nesting_level', 'parameter_count',
            'return_statement_count', 'branch_count', 'loop_count', 'try_catch_count',
            'async_await_count', 'callback_count', 'comment_lines',
            'code_to_comment_ratio', 'halstead_volume', 'halstead_difficulty',
            'maintainability_index'
          ],
          bulkData.metrics
        );
      }
    });
  }

  /**
   * Save a single function
   */
  private async saveSingleFunction(func: FunctionInfo, snapshotId: string): Promise<void> {
    await this.insertFunctionRecord(func, snapshotId);
    await this.insertFunctionParameters(func);
    await this.insertFunctionMetrics(func);
  }

  /**
   * Insert function record
   */
  private async insertFunctionRecord(func: FunctionInfo, snapshotId: string): Promise<void> {
    await this.db.query(
      `
      INSERT INTO functions (
        id, semantic_id, content_id, snapshot_id, name, display_name, signature, signature_hash,
        file_path, file_hash, start_line, end_line, start_column, end_column,
        ast_hash, context_path, function_type, modifiers, nesting_level,
        is_exported, is_async, is_generator, is_arrow_function,
        is_method, is_constructor, is_static, access_modifier,
        source_code, source_file_ref_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
      )
      `,
      [
        func.id,
        func.semanticId,
        func.contentId,
        snapshotId,
        func.name,
        func.displayName,
        func.signature,
        func.signatureHash,
        func.filePath,
        func.fileHash,
        func.startLine,
        func.endLine,
        func.startColumn,
        func.endColumn,
        func.astHash,
        func.contextPath ? JSON.stringify(func.contextPath) : '[]',
        func.functionType || null,
        func.modifiers ? JSON.stringify(func.modifiers) : '[]',
        func.nestingLevel || 0,
        func.isExported,
        func.isAsync,
        func.isGenerator,
        func.isArrowFunction,
        func.isMethod,
        func.isConstructor,
        func.isStatic,
        func.accessModifier || null,
        func.sourceCode || null,
        func.sourceFileRefId || null,
      ]
    );
  }

  /**
   * Insert function parameters
   */
  private async insertFunctionParameters(func: FunctionInfo): Promise<void> {
    if (!func.parameters || func.parameters.length === 0) {
      return;
    }

    for (let i = 0; i < func.parameters.length; i++) {
      const param = func.parameters[i];
      await this.db.query(
        `
        INSERT INTO function_parameters (
          function_id, snapshot_id, name, type, type_simple, position,
          is_optional, is_rest, default_value, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          func.id, func.snapshotId, param.name, param.type, param.typeSimple, i,
          param.isOptional, param.isRest ?? false, param.defaultValue ?? null, param.description ?? null
        ]
      );
    }
  }

  /**
   * Insert function metrics
   */
  private async insertFunctionMetrics(func: FunctionInfo): Promise<void> {
    if (!func.metrics) {
      return;
    }

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
      `,
      [
        func.id,
        func.snapshotId,
        func.metrics.linesOfCode,
        func.metrics.totalLines,
        func.metrics.cyclomaticComplexity,
        func.metrics.cognitiveComplexity,
        func.metrics.maxNestingLevel,
        func.metrics.parameterCount,
        func.metrics.returnStatementCount,
        func.metrics.branchCount,
        func.metrics.loopCount,
        func.metrics.tryCatchCount,
        func.metrics.asyncAwaitCount,
        func.metrics.callbackCount,
        func.metrics.commentLines,
        func.metrics.codeToCommentRatio,
        func.metrics.halsteadVolume || null,
        func.metrics.halsteadDifficulty || null,
        func.metrics.maintainabilityIndex || null,
      ]
    );
  }

  /**
   * Execute bulk insert within a transaction with optimal UNNEST-based batching
   * Uses UNNEST approach for better PGLite performance vs VALUES approach
   */
  private async executeBulkInsertInTransaction(
    trx: PGTransaction,
    tableName: string,
    columns: string[],
    data: unknown[][]
  ): Promise<void> {
    if (data.length === 0) return;
    
    // Use UNNEST-based bulk insert with table-specific UPSERT support
    const getConflictClause = (table: string): { idempotent?: boolean; onConflict?: string } => {
      switch (table) {
        case 'quality_metrics':
          return {
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
              maintainability_index = EXCLUDED.maintainability_index`
          };
        case 'function_parameters':
          return {
            onConflict: `ON CONFLICT (function_id, snapshot_id, position) DO UPDATE SET
              name = EXCLUDED.name,
              type = EXCLUDED.type,
              type_simple = EXCLUDED.type_simple,
              is_optional = EXCLUDED.is_optional,
              is_rest = EXCLUDED.is_rest,
              default_value = EXCLUDED.default_value,
              description = EXCLUDED.description`
          };
        case 'functions':
          return {
            onConflict: `ON CONFLICT (id) DO UPDATE SET
              semantic_id = EXCLUDED.semantic_id,
              content_id = EXCLUDED.content_id,
              snapshot_id = EXCLUDED.snapshot_id,
              name = EXCLUDED.name,
              display_name = EXCLUDED.display_name,
              signature = EXCLUDED.signature,
              signature_hash = EXCLUDED.signature_hash,
              file_path = EXCLUDED.file_path,
              file_hash = EXCLUDED.file_hash,
              start_line = EXCLUDED.start_line,
              end_line = EXCLUDED.end_line,
              start_column = EXCLUDED.start_column,
              end_column = EXCLUDED.end_column,
              ast_hash = EXCLUDED.ast_hash,
              context_path = EXCLUDED.context_path,
              function_type = EXCLUDED.function_type,
              modifiers = EXCLUDED.modifiers,
              nesting_level = EXCLUDED.nesting_level,
              is_exported = EXCLUDED.is_exported,
              is_async = EXCLUDED.is_async,
              is_generator = EXCLUDED.is_generator,
              is_arrow_function = EXCLUDED.is_arrow_function,
              is_method = EXCLUDED.is_method,
              is_constructor = EXCLUDED.is_constructor,
              is_static = EXCLUDED.is_static,
              access_modifier = EXCLUDED.access_modifier,
              source_code = EXCLUDED.source_code,
              source_file_ref_id = EXCLUDED.source_file_ref_id`
          };
        default:
          return { idempotent: true };
      }
    };

    await executeUnnestBulkInsert(
      (sql, params) => trx.query(sql, params),
      tableName,
      columns,
      data,
      getConflictClause(tableName)
    );
  }

  /**
   * Execute bulk insert with optimal batching (creates own transaction)
   */
  private async executeBulkInsert(
    trx: PGTransaction,
    tableName: string,
    columns: string[],
    data: unknown[][]
  ): Promise<void> {
    // Delegate to transaction-aware version
    await this.executeBulkInsertInTransaction(trx, tableName, columns, data);
  }

  // Legacy bulk insert methods removed - functionality now handled by:
  // saveFunctionsBulk -> executeBulkInsertInTransaction for true bulk operations

  /**
   * Get function parameters
   */
  private async getFunctionParameters(functionId: string): Promise<ParameterInfo[]> {
    const result = await this.db.query(
      'SELECT * FROM function_parameters WHERE function_id = $1 ORDER BY position',
      [functionId]
    );

    return (result.rows as ParameterRow[]).map((row) => {
      const param: ParameterInfo = {
        name: row.name,
        type: row.type || 'unknown',
        typeSimple: row.type_simple || 'unknown',
        position: row.position || 0,
        isOptional: row.is_optional || false,
        isRest: row.is_rest || false,
      };
      if (row.default_value) {
        param.defaultValue = row.default_value;
      }
      return param;
    });
  }

  /**
   * Build function query based on whether full data is needed
   */
  private buildFunctionQuery(isListCommand: boolean, includeChangeCount: boolean = false): string {
    if (isListCommand) {
      const changeCountSelect = includeChangeCount 
        ? ', cc.change_count'
        : '';
      const changeCountJoin = includeChangeCount 
        ? `LEFT JOIN (
            SELECT semantic_id, COUNT(DISTINCT content_id) as change_count
            FROM functions
            GROUP BY semantic_id
          ) cc ON f.semantic_id = cc.semantic_id`
        : '';
      
      return `
        SELECT 
          f.id, f.name, f.file_path, f.start_line, f.end_line,
          f.is_exported, f.is_async, f.source_file_ref_id, f.semantic_id,
          q.lines_of_code, q.cyclomatic_complexity, q.cognitive_complexity, q.parameter_count${changeCountSelect}
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        ${changeCountJoin}
        WHERE f.snapshot_id = $1
      `;
    } else {
      const changeCountSelect = includeChangeCount 
        ? ', cc.change_count'
        : '';
      const changeCountJoin = includeChangeCount 
        ? `LEFT JOIN (
            SELECT semantic_id, COUNT(DISTINCT content_id) as change_count
            FROM functions
            GROUP BY semantic_id
          ) cc ON f.semantic_id = cc.semantic_id`
        : '';
      
      return `
        SELECT 
          f.id, f.semantic_id, f.content_id, f.snapshot_id, f.name, f.display_name, 
          f.signature, f.signature_hash, f.file_path, f.file_hash, f.start_line, f.end_line,
          f.start_column, f.end_column, f.ast_hash, f.context_path, f.function_type, 
          f.modifiers, f.nesting_level, f.is_exported, f.is_async, f.is_generator,
          f.is_arrow_function, f.is_method, f.is_constructor, f.is_static, 
          f.access_modifier, f.source_code, f.source_file_ref_id, f.created_at,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index${changeCountSelect}
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        ${changeCountJoin}
        WHERE f.snapshot_id = $1
      `;
    }
  }

  /**
   * Build filter clause from query filters
   */
  private buildFilterClause(filters: Array<{ field: string; operator: string; value: unknown }>, params: unknown[]): string {
    const filterClauses = filters.map(filter => {
      if (filter.operator === 'KEYWORD') {
        // Handle keyword search across multiple fields
        params.push(`%${filter.value}%`);
        params.push(`%${filter.value}%`);
        return `(
          f.name ILIKE $${params.length - 1} OR 
          f.source_code ILIKE $${params.length}
        )`;
      } else {
        // Use field mapping to get correct table alias and column name
        const mappedField = this.fieldMapping.get(filter.field) || `f.${filter.field}`;
        params.push(filter.value);
        return `${mappedField} ${filter.operator} $${params.length}`;
      }
    });

    return filterClauses.join(' AND ');
  }

  /**
   * Build order by clause
   */
  private buildOrderByClause(sort?: string): string {
    let orderByClause = ' ORDER BY f.start_line'; // default

    if (sort) {
      const sortFields = sort.split(',').map(field => field.trim());
      const validOrderByFields: string[] = [];

      for (const field of sortFields) {
        if (this.validSortFields.has(field)) {
          validOrderByFields.push(this.validSortFields.get(field)!);
        }
      }

      if (validOrderByFields.length > 0) {
        orderByClause = ' ORDER BY ' + validOrderByFields.join(', ');
      }
    }

    return orderByClause;
  }

  /**
   * Map database row to FunctionInfo
   */
  private mapRowToFunctionInfo(
    row: FunctionRow & Partial<MetricsRow> & { change_count?: number },
    parameters: ParameterInfo[]
  ): FunctionInfo {
    const base = this.mapBasicFunctionInfo(row, parameters);
    this.enhanceFunctionInfoWithMetrics(base, row);
    this.enhanceFunctionInfoWithChangeCount(base, row);
    return base;
  }

  /**
   * Map basic function information from database row
   */
  private mapBasicFunctionInfo(
    row: FunctionRow & { change_count?: number },
    parameters: ParameterInfo[]
  ): FunctionInfo {
    return {
      id: row.id,
      snapshotId: row.snapshot_id,
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
      contextPath: this.context.utilityOps?.parseJsonSafely(row.context_path, []) ?? [],
      functionType: this.mapFunctionType(row.function_type),
      modifiers: this.mapModifiers(row.modifiers),
      nestingLevel: row.nesting_level || 0,
      ...this.mapFunctionFlags(row),
      ...this.mapAccessModifier(row.access_modifier),
      sourceCode: row.source_code || '',
      ...this.mapSourceFileId(row.source_file_ref_id),
      parameters,
    };
  }

  /**
   * Map function type with fallback
   */
  private mapFunctionType(functionType: string | undefined): 'function' | 'method' | 'arrow' | 'local' {
    return (functionType as 'function' | 'method' | 'arrow' | 'local') || 'function';
  }

  /**
   * Map modifiers array - handles PGLite auto-parsing
   */
  private mapModifiers(modifiers: unknown): string[] {
    // Use safe JSON parsing to handle both strings and already-parsed arrays
    const parsed = this.context.utilityOps?.parseJsonSafely(modifiers, []) ?? [];
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // Fallback for comma-separated string format
    if (typeof parsed === 'string') {
      return (parsed as string).split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    }
    return [];
  }

  /**
   * Map function boolean flags
   */
  private mapFunctionFlags(row: FunctionRow): Pick<FunctionInfo, 'isExported' | 'isAsync' | 'isGenerator' | 'isArrowFunction' | 'isMethod' | 'isConstructor' | 'isStatic'> {
    return {
      isExported: row.is_exported || false,
      isAsync: row.is_async || false,
      isGenerator: row.is_generator || false,
      isArrowFunction: row.is_arrow_function || false,
      isMethod: row.is_method || false,
      isConstructor: row.is_constructor || false,
      isStatic: row.is_static || false,
    };
  }

  /**
   * Map access modifier if present
   */
  private mapAccessModifier(accessModifier: string | undefined): Partial<FunctionInfo> {
    if (accessModifier) {
      return { accessModifier: accessModifier as 'public' | 'private' | 'protected' };
    }
    return {};
  }

  /**
   * Map source file ID if present
   */
  private mapSourceFileId(sourceFileRefId: string | undefined): Partial<FunctionInfo> {
    if (sourceFileRefId) {
      return { sourceFileRefId: sourceFileRefId };
    }
    return {};
  }

  /**
   * Enhance function info with metrics if available
   */
  private enhanceFunctionInfoWithMetrics(
    functionInfo: FunctionInfo,
    row: Partial<MetricsRow>
  ): void {
    if (row.lines_of_code !== undefined) {
      const metrics = this.mapMetrics(row);
      if (metrics) {
        functionInfo.metrics = metrics;
      }
    }
  }

  /**
   * Enhance function info with change count if available
   */
  private enhanceFunctionInfoWithChangeCount(
    functionInfo: FunctionInfo,
    row: { change_count?: number }
  ): void {
    if (row.change_count !== undefined) {
      functionInfo.changeCount = row.change_count;
    }
  }

  /**
   * Map metrics from database row
   */
  private mapMetrics(row: Partial<MetricsRow>): QualityMetrics | undefined {
    if (!row.lines_of_code) return undefined;

    const metrics: QualityMetrics = {
      linesOfCode: row.lines_of_code!,
      totalLines: row.total_lines || row.lines_of_code!,
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
   * Query functions with options, using latest snapshot if no snapshotId specified
   */
  async queryFunctions(options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      if (!this.kysely) {
        throw new Error('Database not initialized. kysely is null.');
      }
      
      // Get the latest snapshot for the specified scope
      let sql = 'SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 1';
      const params: unknown[] = [];
      
      if (options?.scope) {
        sql = 'SELECT * FROM snapshots WHERE scope = $1 ORDER BY created_at DESC LIMIT 1';
        params.push(options.scope);
      }
      
      const snapshotResult = await this.db.query(sql, params);
      const snapshots = snapshotResult.rows;
      
      if (snapshots.length === 0) {
        return [];
      }

      // Use the latest snapshot to get functions
      return await this.getFunctions((snapshots[0] as SnapshotRow).id, options);
    } catch (error) {
      throw new Error(
        `Failed to query functions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Find functions with options (using latest snapshot)
   */
  async findFunctions(options?: QueryOptions): Promise<FunctionInfo[]> {
    return this.queryFunctions(options);
  }

  /**
   * Verify saved functions count
   */
  private async verifySavedFunctions(snapshotId: string, expectedCount: number): Promise<void> {
    const savedCount = await this.db.query(
      'SELECT COUNT(*) as count FROM functions WHERE snapshot_id = $1',
      [snapshotId]
    );
    const actualCount = parseInt((savedCount.rows[0] as { count: string }).count);

    if (actualCount !== expectedCount) {
      this.logger?.warn(`Function count mismatch: expected ${expectedCount}, got ${actualCount}`);
    }
  }

  // ========================================
  // ADDITIONAL METHODS FOR COMPATIBILITY
  // ========================================

  async getFunctionsBatch(functionIds: string[]): Promise<Map<string, FunctionInfo>> {
    const result = new Map<string, FunctionInfo>();
    
    // Process in batches to avoid query limits
    const batchSize = 100;
    for (let i = 0; i < functionIds.length; i += batchSize) {
      const batch = functionIds.slice(i, i + batchSize);
      const placeholders = batch.map((_, i) => `$${i + 1}`).join(', ');
      const queryResult = await this.db.query(`
        SELECT f.*, q.*
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        WHERE f.id IN (${placeholders})
      `, batch);
      
      const functions = await Promise.all(
        queryResult.rows.map(async row => {
          const functionInfo = await this.buildFunctionInfo(row as FunctionRow & MetricsRow);
          return functionInfo;
        })
      );
      
      functions.forEach(func => {
        if (func) {
          result.set(func.id, func);
        }
      });
    }
    
    return result;
  }

  async storeFunctions(functions: FunctionInfo[], snapshotId: string): Promise<void> {
    return this.saveFunctions(snapshotId, functions);
  }

  async getFunctionsWithDescriptions(snapshotId: string, _options?: QueryOptions): Promise<FunctionInfo[]> {
    const result = await this.db.query(`
      SELECT f.*, q.*, fd.description
      FROM functions f
      LEFT JOIN quality_metrics q ON f.id = q.function_id
      INNER JOIN function_descriptions fd ON f.semantic_id = fd.semantic_id
      WHERE f.snapshot_id = $1
      ORDER BY f.start_line
    `, [snapshotId]);
    
    return Promise.all(
      result.rows.map(async row => {
        return this.buildFunctionInfo(row as FunctionRow & MetricsRow & { description?: string });
      })
    );
  }

  async getFunctionsWithoutDescriptions(snapshotId: string, _options?: QueryOptions): Promise<FunctionInfo[]> {
    const result = await this.db.query(`
      SELECT f.*, q.*
      FROM functions f
      LEFT JOIN quality_metrics q ON f.id = q.function_id
      LEFT JOIN function_descriptions fd ON f.semantic_id = fd.semantic_id
      WHERE f.snapshot_id = $1 AND fd.semantic_id IS NULL
      ORDER BY f.start_line
    `, [snapshotId]);
    
    return Promise.all(
      result.rows.map(async row => {
        return this.buildFunctionInfo(row as FunctionRow & MetricsRow);
      })
    );
  }

  async getFunctionsNeedingDescriptions(snapshotId: string, _options?: QueryOptions): Promise<FunctionInfo[]> {
    const result = await this.db.query(`
      SELECT f.*, q.*
      FROM functions f
      LEFT JOIN quality_metrics q ON f.id = q.function_id
      LEFT JOIN function_descriptions fd ON f.semantic_id = fd.semantic_id
      WHERE f.snapshot_id = $1 AND (fd.semantic_id IS NULL OR fd.needs_review = true)
      ORDER BY f.start_line
    `, [snapshotId]);
    
    return Promise.all(
      result.rows.map(async row => {
        return this.buildFunctionInfo(row as FunctionRow & MetricsRow);
      })
    );
  }

  async extractFunctionSourceCode(functionId: string): Promise<string | null> {
    try {
      const result = await this.db.query(
        'SELECT source_code FROM functions WHERE id = $1 LIMIT 1',
        [functionId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0] as { source_code?: string };
      return row.source_code || null;
    } catch (error) {
      this.logger?.error(`Failed to extract function source code: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async saveFunctionDescription(description: {
    semanticId: string;
    description: string;
    source: string;
    model?: string;
    contentId?: string;
    needsUpdate?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO function_descriptions (
        semantic_id, description, source, created_by, ai_model, confidence_score,
        validated_for_content_id, needs_review, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (semantic_id) DO UPDATE SET
        description = EXCLUDED.description,
        source = EXCLUDED.source,
        created_by = EXCLUDED.created_by,
        ai_model = EXCLUDED.ai_model,
        confidence_score = EXCLUDED.confidence_score,
        validated_for_content_id = EXCLUDED.validated_for_content_id,
        needs_review = EXCLUDED.needs_review,
        updated_at = EXCLUDED.updated_at
    `, [
      description.semanticId,
      description.description,
      description.source ?? 'human',
      null,                              // created_by
      description.model ?? null,         // ai_model
      null,                              // confidence_score  
      description.contentId ?? null,     // validated_for_content_id
      description.needsUpdate ?? false,  // needs_review
      new Date().toISOString(),
      new Date().toISOString()
    ]);
  }

  async getFunctionDescription(semanticId: string): Promise<{
    semanticId: string;
    description: string;
    source: string;
    model: string;
    contentId: string;
    needsUpdate: boolean;
    createdAt: Date;
    updatedAt: string;
  } | null> {
    const result = await this.db.query('SELECT * FROM function_descriptions WHERE semantic_id = $1', [semanticId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as {
      semantic_id: string;
      description: string;
      source: string;
      created_by: string;
      ai_model: string;
      confidence_score: number;
      validated_for_content_id: string;
      needs_review: boolean;
      created_at: string;
      updated_at: string;
    };
    return {
      semanticId: row.semantic_id,
      description: row.description,
      source: row.source,
      model: row.ai_model,
      contentId: row.validated_for_content_id,
      needsUpdate: row.needs_review,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
    };
  }

  async searchFunctionsByDescription(keyword: string, _options?: QueryOptions): Promise<FunctionInfo[]> {
    const result = await this.db.query(`
      SELECT f.*, q.*, fd.description
      FROM functions f
      LEFT JOIN quality_metrics q ON f.id = q.function_id
      INNER JOIN function_descriptions fd ON f.semantic_id = fd.semantic_id
      WHERE fd.description LIKE $1
      ORDER BY f.start_line
    `, [`%${keyword}%`]);
    
    return Promise.all(
      result.rows.map(async row => {
        return this.buildFunctionInfo(row as FunctionRow & MetricsRow & { description?: string });
      })
    );
  }

  // Helper method to build FunctionInfo from database row
  private async buildFunctionInfo(row: FunctionRow & Partial<MetricsRow> & { description?: string }): Promise<FunctionInfo> {
    const parameters = await this.getFunctionParameters(row.id);
    const basicInfo = this.buildBasicFunctionInfo(row);
    const optionalFields = this.buildOptionalFields(row);
    const metrics = this.buildFunctionMetrics(row);

    return {
      ...basicInfo,
      parameters,
      ...optionalFields,
      ...metrics
    };
  }


  /**
   * Build basic function information
   */
  private buildBasicFunctionInfo(row: FunctionRow & Partial<MetricsRow>): Omit<FunctionInfo, 'parameters' | 'jsDoc' | 'sourceCode' | 'metrics'> {
    return {
      id: row.id,
      snapshotId: row.snapshot_id,
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
      isExported: row.is_exported,
      isAsync: row.is_async,
      isGenerator: row.is_generator,
      isArrowFunction: row.is_arrow_function,
      isMethod: row.is_method,
      isConstructor: row.is_constructor,
      isStatic: row.is_static || false,
      astHash: row.ast_hash || '',
      modifiers: this.parseModifiers(row.modifiers)
    };
  }

  /**
   * Parse function modifiers from various input formats - handles PGLite auto-parsing
   */
  private parseModifiers(modifiers: unknown): string[] {
    // Delegate to mapModifiers for consistent handling
    return this.mapModifiers(modifiers);
  }

  /**
   * Build optional fields (jsDoc, sourceCode)
   */
  private buildOptionalFields(row: FunctionRow & { js_doc?: string; source_code?: string }): Partial<Pick<FunctionInfo, 'jsDoc' | 'sourceCode'>> {
    const fields: Partial<Pick<FunctionInfo, 'jsDoc' | 'sourceCode'>> = {};
    
    if (row.js_doc) {
      fields.jsDoc = row.js_doc;
    }
    
    if (row.source_code) {
      fields.sourceCode = row.source_code;
    }
    
    return fields;
  }

  /**
   * Build function metrics if available
   */
  private buildFunctionMetrics(row: Partial<MetricsRow>): Partial<Pick<FunctionInfo, 'metrics'>> {
    if (!row.cyclomatic_complexity) {
      return {};
    }

    const basicMetrics = this.buildBasicMetrics(row);
    const advancedMetrics = this.buildAdvancedMetrics(row);

    return {
      metrics: {
        ...basicMetrics,
        ...advancedMetrics
      }
    };
  }

  /**
   * Build basic metrics (always present)
   */
  private buildBasicMetrics(row: Partial<MetricsRow>) {
    return {
      cyclomaticComplexity: row.cyclomatic_complexity!,
      linesOfCode: row.lines_of_code || 0,
      totalLines: row.total_lines || row.lines_of_code || 0,
      parameterCount: row.parameter_count || 0,
      maxNestingLevel: row.max_nesting_level || 0,
      branchCount: row.branch_count || 0,
      loopCount: row.loop_count || 0,
      returnStatementCount: row.return_statement_count || 0,
      tryCatchCount: row.try_catch_count || 0,
      asyncAwaitCount: row.async_await_count || 0,
      callbackCount: row.callback_count || 0,
      commentLines: row.comment_lines || 0,
      codeToCommentRatio: row.code_to_comment_ratio || 0,
      cognitiveComplexity: row.cognitive_complexity || 0,
    };
  }

  /**
   * Build advanced metrics (optional)
   */
  private buildAdvancedMetrics(row: Partial<MetricsRow>) {
    const advanced: Partial<{
      halsteadVolume: number;
      halsteadDifficulty: number;
      maintainabilityIndex: number;
    }> = {};

    if (row.halstead_volume !== null && row.halstead_volume !== undefined) {
      advanced.halsteadVolume = row.halstead_volume;
    }
    
    if (row.halstead_difficulty !== null && row.halstead_difficulty !== undefined) {
      advanced.halsteadDifficulty = row.halstead_difficulty;
    }
    
    if (row.maintainability_index !== null && row.maintainability_index !== undefined) {
      advanced.maintainabilityIndex = row.maintainability_index;
    }

    return advanced;
  }

}