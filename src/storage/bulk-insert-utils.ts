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
    parametersData.push(...buildParameterRows(func));
    
    if (func.metrics) {
      metricsData.push(buildMetricsRow(func));
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
    func.sourceFileId || null,
  ];
}

function buildParameterRows(func: FunctionInfo): unknown[][] {
  return func.parameters.map(param => [
    func.id,
    func.snapshotId,
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

function buildMetricsRow(func: FunctionInfo): unknown[] {
  return [
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
    func.metrics!.codeToCommentRatio,
    func.metrics!.halsteadVolume || null,
    func.metrics!.halsteadDifficulty || null,
    func.metrics!.maintainabilityIndex || null,
  ];
}

/**
 * Generate bulk insert SQL statements
 */
export function generateBulkInsertSQL(
  tableName: string,
  columns: string[],
  rowCount: number
): string {
  if (rowCount === 0) return '';

  const placeholders: string[] = [];
  let paramIndex = 1;

  for (let i = 0; i < rowCount; i++) {
    const rowPlaceholders = columns.map(() => `$${paramIndex++}`);
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  return `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES ${placeholders.join(', ')}
  `;
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
