/**
 * Bulk insert utilities for optimized database operations
 */

import { FunctionInfo } from '../types';

// Note: formatPostgresArray was replaced with JSON.stringify for JSONB fields
// Keeping for reference if PostgreSQL array format is needed in the future
/*
function formatPostgresArray(arr: string[]): string {
  if (!arr || arr.length === 0) return '{}'; // Use empty PostgreSQL array for empty arrays
  // PostgreSQL array elements need both backslash and quote escaping
  return `{${arr.map(item => {
    // First escape backslashes, then quotes (critical order for security)
    const escaped = item
      .replace(/\\/g, '\\\\')      // Escape backslashes: \ -> \\
      .replace(/"/g, '\\"');       // Escape quotes: " -> \"
    return `"${escaped}"`;
  }).join(',')}}`;
}
*/


export interface BulkInsertData {
  functions: unknown[][];
  parameters: unknown[][];
  metrics: unknown[][];
}

/**
 * Prepare function data for bulk insert
 */
export function prepareBulkInsertData(
  functions: FunctionInfo[],
  snapshotId: string
): BulkInsertData {
  const functionsData: unknown[][] = [];
  const parametersData: unknown[][] = [];
  const metricsData: unknown[][] = [];

  for (const func of functions) {
    functionsData.push(buildFunctionRow(func, snapshotId));
    parametersData.push(...buildParameterRows(func, snapshotId));
    
    if (func.metrics) {
      metricsData.push(buildMetricsRow(func, snapshotId));
    }
  }

  return {
    functions: functionsData,
    parameters: parametersData,
    metrics: metricsData,
  };
}

function buildFunctionRow(func: FunctionInfo, snapshotId: string): unknown[] {
  return [
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
    JSON.stringify(func.contextPath || []),
    func.functionType || null,
    JSON.stringify(func.modifiers || []),
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
  ];
}

function buildParameterRows(func: FunctionInfo, snapshotId: string): unknown[][] {
  return func.parameters.map(param => [
    func.id,
    snapshotId,
    param.name,
    param.type,
    param.typeSimple,
    param.position,
    param.isOptional,
    param.isRest,
    param.defaultValue || null,
    param.description || null,
  ]);
}

function buildMetricsRow(func: FunctionInfo, snapshotId: string): unknown[] {
  return [
    func.id,
    snapshotId,
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
  ];
}

/**
 * Generate bulk insert SQL statements
 */
export function generateBulkInsertSQL(
  tableName: string,
  columns: string[],
  rowCount: number,
  options?: { idempotent?: boolean }
): string {
  if (rowCount === 0) return '';

  const placeholders: string[] = [];
  let paramIndex = 1;

  for (let i = 0; i < rowCount; i++) {
    const rowPlaceholders = columns.map(() => `$${paramIndex++}`);
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  let sql = `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES ${placeholders.join(', ')}
  `;

  // Add idempotent clause if requested
  if (options?.idempotent) {
    // For type_definitions table, use existing UNIQUE constraint to prevent true duplicates
    if (tableName === 'type_definitions') {
      sql += ` ON CONFLICT (snapshot_id, file_path, name, start_line) DO NOTHING`;
    } else if (columns.includes('id')) {
      sql += ` ON CONFLICT (id) DO NOTHING`;
    } // else: id column doesn't exist, skip ON CONFLICT clause
  }

  return sql;
}

/**
 * Split data into optimal batch sizes
 */
export function splitIntoBatches<T>(data: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < data.length; i += batchSize) {
    batches.push(data.slice(i, i + batchSize));
  }

  return batches;
}

const POSTGRES_MAX_PARAMETERS = 65535;
const SAFETY_BUFFER_RATIO = 0.9;
const MAX_BATCH_SIZE = 1000;

/**
 * Calculate optimal batch size based on number of columns and PostgreSQL limits
 */
export function calculateOptimalBatchSize(columnCount: number): number {
  const safeMaxParameters = Math.floor(POSTGRES_MAX_PARAMETERS * SAFETY_BUFFER_RATIO);

  // Calculate how many rows we can insert at once
  const maxRows = Math.floor(safeMaxParameters / columnCount);

  // Cap at a reasonable batch size to avoid memory issues
  return Math.min(maxRows, MAX_BATCH_SIZE);
}

/**
 * Get proper PostgreSQL array type annotations for table columns
 */
function getColumnTypeAnnotations(tableName: string, columns: string[]): string[] {
  // Define column type mappings for major tables
  const columnTypes: Record<string, Record<string, string>> = {
    functions: {
      start_line: 'integer',
      end_line: 'integer',
      start_column: 'integer',
      end_column: 'integer',
      nesting_level: 'integer',
      is_exported: 'boolean',
      is_async: 'boolean',
      is_generator: 'boolean',
      is_arrow_function: 'boolean',
      is_method: 'boolean',
      is_constructor: 'boolean',
      is_static: 'boolean',
      context_path: 'jsonb',
      modifiers: 'jsonb',
    },
    function_parameters: {
      position: 'integer',
      is_optional: 'boolean',
      is_rest: 'boolean',
    },
    quality_metrics: {
      lines_of_code: 'integer',
      total_lines: 'integer',
      cyclomatic_complexity: 'integer',
      cognitive_complexity: 'integer',
      max_nesting_level: 'integer',
      parameter_count: 'integer',
      return_statement_count: 'integer',
      branch_count: 'integer',
      loop_count: 'integer',
      try_catch_count: 'integer',
      async_await_count: 'integer',
      callback_count: 'integer',
      comment_lines: 'integer',
      code_to_comment_ratio: 'numeric',
      halstead_volume: 'numeric',
      halstead_difficulty: 'numeric',
      maintainability_index: 'numeric',
    },
    type_definitions: {
      start_line: 'integer',
      end_line: 'integer',
      start_column: 'integer',
      end_column: 'integer',
      is_abstract: 'boolean',
      is_exported: 'boolean',
      is_default_export: 'boolean',
      is_generic: 'boolean',
      generic_parameters: 'jsonb',
      resolved_type: 'jsonb',
      modifiers: 'jsonb',
      metadata: 'jsonb',
    },
    type_relationships: {
      position: 'integer',
      is_array: 'boolean',
      is_optional: 'boolean',
      generic_arguments: 'jsonb',
      confidence_score: 'numeric',
      metadata: 'jsonb',
    },
    type_members: {
      is_optional: 'boolean',
      is_readonly: 'boolean',
      is_static: 'boolean',
      is_abstract: 'boolean',
      start_line: 'integer',
      end_line: 'integer',
      start_column: 'integer',
      end_column: 'integer',
      metadata: 'jsonb',
      jsdoc: 'text',
    },
    method_overrides: {
      is_compatible: 'boolean',
      compatibility_errors: 'jsonb',
      confidence_score: 'numeric',
      metadata: 'jsonb',
    },
  };

  const tableTypes = columnTypes[tableName] || {};
  
  return columns.map(column => {
    const pgType = tableTypes[column] || 'text';
    return `${pgType}[]`;
  });
}

/**
 * Generate UNNEST-based bulk insert SQL for better PGLite performance
 * Uses column arrays instead of row-by-row parameters to reduce binding overhead
 */
export function generateUnnestBulkInsertSQL(
  tableName: string,
  columns: string[],
  options?: { idempotent?: boolean; onConflict?: string }
): string {
  if (columns.length === 0) return '';

  // Create proper type annotations for each column
  const typeAnnotations = getColumnTypeAnnotations(tableName, columns);
  const paramPlaceholders = typeAnnotations
    .map((type, index) => `$${index + 1}::${type}`)
    .join(', ');

  let sql = `
    INSERT INTO ${tableName} (${columns.join(', ')})
    SELECT * FROM unnest(${paramPlaceholders})
  `;

  // Add custom ON CONFLICT clause if provided, otherwise fall back to idempotent defaults
  if (options?.onConflict) {
    sql += ` ${options.onConflict}`;
  } else if (options?.idempotent) {
    if (tableName === 'type_definitions') {
      sql += ` ON CONFLICT (snapshot_id, file_path, name, start_line) DO NOTHING`;
    } else if (columns.includes('id')) {
      sql += ` ON CONFLICT (id) DO NOTHING`;
    }
  }

  return sql;
}

/**
 * Convert row data to column arrays for UNNEST-based bulk insert
 * Transforms [[row1col1, row1col2], [row2col1, row2col2]] 
 * to [[row1col1, row2col1], [row1col2, row2col2]]
 */
export function prepareUnnestData(rows: unknown[][]): unknown[][] {
  if (rows.length === 0) return [];
  
  const columnCount = rows[0]?.length || 0;
  const columnArrays: unknown[][] = [];
  
  // Initialize column arrays
  for (let colIndex = 0; colIndex < columnCount; colIndex++) {
    columnArrays.push([]);
  }
  
  // Transpose row data to column data
  for (const row of rows) {
    for (let colIndex = 0; colIndex < columnCount; colIndex++) {
      columnArrays[colIndex].push(row[colIndex]);
    }
  }
  
  return columnArrays;
}

/**
 * Execute UNNEST-based bulk insert with optimized batching
 * Provides better performance than VALUES-based approach for PGLite
 */
export async function executeUnnestBulkInsert(
  query: (sql: string, params: unknown[]) => Promise<unknown>,
  tableName: string,
  columns: string[],
  rows: unknown[][],
  options?: { 
    idempotent?: boolean;
    onConflict?: string;
    batchSize?: number;
    logger?: { log: (msg: string) => void };
  }
): Promise<void> {
  if (rows.length === 0) return;

  // UNNEST は列ごとに配列を束ねるため、行数に比例してパラメータ数が増えず
  // 安全な既定バッチサイズをより大きく設定（必要なら options.batchSize で上書き）
  const DEFAULT_UNNEST_BATCH = 4000;
  const batchSize = options?.batchSize ?? DEFAULT_UNNEST_BATCH;

  const sql = generateUnnestBulkInsertSQL(
    tableName,
    columns,
    {
      ...(options?.idempotent !== undefined && { idempotent: options.idempotent }),
      ...(options?.onConflict !== undefined && { onConflict: options.onConflict })
    }
  );
  
  options?.logger?.log(
    `Executing UNNEST bulk insert for ${tableName}: ${rows.length} rows in batches of ${batchSize}`
  );

  // Process in batches
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const columnArrays = prepareUnnestData(batch);
    
    await query(sql, columnArrays);
    
    if (options?.logger && rows.length > 1000 && i % 1000 === 0) {
      options.logger.log(
        `UNNEST bulk insert progress: ${i + batch.length}/${rows.length} rows`
      );
    }
  }
}
