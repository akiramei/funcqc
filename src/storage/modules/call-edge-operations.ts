/**
 * Call edge operations module for PGLite storage
 * Handles function call relationships and call graph operations
 */

import { 
  CallEdge
} from '../../types';
import { CallEdgeRow } from '../../types/common';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageOperationModule } from './types';
import { BaseStorageOperations } from '../shared/base-storage-operations';
import type { StorageContext } from './types';

// Type for PGLite transaction object
interface PGTransaction {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}
import { generateStableEdgeId } from '../../utils/edge-id-generator';
import { calculateOptimalBatchSize } from '../bulk-insert-utils';

export interface CallEdgeStats {
  totalCallEdges: number;
  internalCallEdges: number;
  externalCallEdges: number;
  averageCallsPerFunction: number;
  functionsWithNoCalls: number;
  functionsWithMostCalls: Array<{
    functionId: string;
    functionName: string;
    callCount: number;
  }>;
}

export class CallEdgeOperations extends BaseStorageOperations implements StorageOperationModule {
  constructor(context: StorageContext) {
    super(context);
  }

  /**
   * Insert call edges for a snapshot
   */
  async insertCallEdges(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    if (callEdges.length === 0) return;

    try {
      // Conservative approach: keep existing threshold but with improved chunking
      if (callEdges.length >= 10) {
        await this.insertCallEdgesBulk(snapshotId, callEdges);
      } else {
        // Use existing individual insert for small batches
        await this.db.transaction(async (trx: PGTransaction) => {
          await this.insertCallEdgesIndividualInTransaction(trx, snapshotId, callEdges);
        });
      }
      
      this.logger?.log(`Inserted ${callEdges.length} call edges for snapshot ${snapshotId}`);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to insert call edges: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Insert call edges within a transaction for atomic operations
   */
  async insertCallEdgesInTransaction(trx: PGTransaction, snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    if (callEdges.length === 0) return;

    try {
      // Use bulk insert for better performance, even in transactions
      if (callEdges.length >= 5) { // Lower threshold for bulk insert in transactions
        await this.insertCallEdgesBulkInTransaction(trx, snapshotId, callEdges);
      } else {
        await this.insertCallEdgesIndividualInTransaction(trx, snapshotId, callEdges);
      }
      this.logger?.log(`Inserted ${callEdges.length} call edges for snapshot ${snapshotId} in transaction`);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to insert call edges in transaction: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Insert call edges in bulk within a transaction for maximum performance
   */
  private async insertCallEdgesBulkInTransaction(trx: PGTransaction, snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    // Dynamic chunk sizing based on call_edges table columns (17 columns)
    const CHUNK_SIZE = calculateOptimalBatchSize(17);
    
    if (callEdges.length <= CHUNK_SIZE) {
      await this.insertCallEdgesChunkInTransaction(trx, snapshotId, callEdges);
    } else {
      // Process in chunks sequentially within the same transaction
      for (let i = 0; i < callEdges.length; i += CHUNK_SIZE) {
        const chunk = callEdges.slice(i, i + CHUNK_SIZE);
        await this.insertCallEdgesChunkInTransaction(trx, snapshotId, chunk);
      }
    }
  }

  /**
   * Insert a single chunk of call edges within a transaction using JSONB bulk insert
   */
  private async insertCallEdgesChunkInTransaction(trx: PGTransaction, snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    const callEdgeRows = callEdges.map(edge => ({
      id: edge.id || generateStableEdgeId(
        edge.callerFunctionId,
        edge.calleeFunctionId ?? `external:${edge.calleeName ?? edge.calleeSignature ?? 'unknown'}`,
        snapshotId
      ),
      snapshot_id: snapshotId,
      caller_function_id: edge.callerFunctionId,
      callee_function_id: edge.calleeFunctionId,
      callee_name: edge.calleeName,
      callee_signature: edge.calleeSignature || null,
      caller_class_name: edge.callerClassName || null,
      callee_class_name: edge.calleeClassName || null,
      call_type: edge.callType || 'direct',
      call_context: this.mapCallContext(edge.callContext),
      line_number: edge.lineNumber || 0,
      column_number: edge.columnNumber || 0,
      is_async: edge.isAsync || false,
      is_chained: edge.isChained || false,
      confidence_score: edge.confidenceScore || 1.0,
      metadata: edge.metadata || {},
      created_at: new Date().toISOString(),
    }));

    try {
      // Validate function IDs within the same snapshot (transaction path)
      const functionIdsResult = await trx.query(
        'SELECT id FROM functions WHERE snapshot_id = $1',
        [snapshotId]
      );
      const validFunctionIds = new Set(
        (functionIdsResult.rows as Array<{ id: string }>).map(r => r.id)
      );
      const validCallEdgeRows = callEdgeRows.filter(row =>
        validFunctionIds.has(row.caller_function_id) &&
        (row.callee_function_id == null ||
          validFunctionIds.has(row.callee_function_id))
      );
      if (validCallEdgeRows.length < callEdgeRows.length) {
        const skipped = callEdgeRows.length - validCallEdgeRows.length;
        this.logger?.debug(
          `Skipped ${skipped} call edges with invalid function IDs (transaction path)`
        );
      }

      // Sanitize data to remove NUL characters (only if detected for performance)
      const sanitizedRows = validCallEdgeRows.map(row => {
        const sanitizedRow = { ...row };
        
        // Check for NUL characters and sanitize only if found
        const stringFields = ['id', 'callee_name', 'callee_signature', 'caller_class_name', 'callee_class_name', 'call_type', 'call_context'] as const;
        for (const field of stringFields) {
          const value = sanitizedRow[field as keyof typeof sanitizedRow];
          if (typeof value === 'string' && value.includes('\u0000')) {
            (sanitizedRow as Record<string, unknown>)[field] = value.replaceAll('\u0000', '\uFFFD');
          }
        }
        
        // Sanitize metadata JSON only if NUL detected
        if (sanitizedRow.metadata) {
          const metadataStr = JSON.stringify(sanitizedRow.metadata);
          if (metadataStr.includes('\u0000')) {
            const cleanMetadataStr = metadataStr.replaceAll('\u0000', '\uFFFD');
            sanitizedRow.metadata = JSON.parse(cleanMetadataStr);
          }
        }
        
        return sanitizedRow;
      });

      // Use JSONB bulk insert approach for better PGLite compatibility within transaction
      const payload = JSON.stringify(sanitizedRows);
      
      const sql = `
        WITH payload AS (SELECT $1::jsonb AS data)
        INSERT INTO call_edges (
          id, snapshot_id, caller_function_id, callee_function_id,
          callee_name, callee_signature, caller_class_name, callee_class_name,
          call_type, call_context, line_number, column_number,
          is_async, is_chained, confidence_score, metadata, created_at
        )
        SELECT
          t.id, t.snapshot_id, t.caller_function_id, t.callee_function_id,
          t.callee_name, t.callee_signature, t.caller_class_name, t.callee_class_name,
          t.call_type, t.call_context, t.line_number::int, t.column_number::int,
          t.is_async::boolean, t.is_chained::boolean, t.confidence_score::real, 
          t.metadata::jsonb, t.created_at::timestamptz
        FROM jsonb_to_recordset((SELECT data FROM payload)) AS t(
          id text,
          snapshot_id text,
          caller_function_id text,
          callee_function_id text,
          callee_name text,
          callee_signature text,
          caller_class_name text,
          callee_class_name text,
          call_type text,
          call_context text,
          line_number int,
          column_number int,
          is_async boolean,
          is_chained boolean,
          confidence_score real,
          metadata jsonb,
          created_at timestamptz
        )
        ON CONFLICT (id) DO NOTHING
      `;
      
      await trx.query(sql, [payload]);
    } catch (error) {
      this.logger?.error(`Failed to bulk insert call edges in transaction: ${error}`);
      this.logger?.error(`Sample row data: ${JSON.stringify(callEdgeRows[0], null, 2)}`);
      throw error;
    }
  }

  /**
   * Insert call edges using bulk insert for better performance
   * Processes large datasets in optimized chunks
   */
  private async insertCallEdgesBulk(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    // Dynamic chunk sizing based on call_edges table columns (17 columns)
    const CHUNK_SIZE = calculateOptimalBatchSize(17);
    
    if (callEdges.length <= CHUNK_SIZE) {
      await this.insertCallEdgesChunk(snapshotId, callEdges);
    } else {
      // Process in chunks sequentially 
      for (let i = 0; i < callEdges.length; i += CHUNK_SIZE) {
        const chunk = callEdges.slice(i, i + CHUNK_SIZE);
        await this.insertCallEdgesChunk(snapshotId, chunk);
      }
    }
  }

  /**
   * Insert a single chunk of call edges
   */
  private async insertCallEdgesChunk(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    const callEdgeRows = callEdges.map(edge => ({
      id: edge.id || generateStableEdgeId(
        edge.callerFunctionId,
        edge.calleeFunctionId ?? `external:${edge.calleeName ?? edge.calleeSignature ?? 'unknown'}`,
        snapshotId
      ),
      snapshot_id: snapshotId,
      caller_function_id: edge.callerFunctionId,
      callee_function_id: edge.calleeFunctionId,
      callee_name: edge.calleeName,
      callee_signature: edge.calleeSignature || null,
      caller_class_name: edge.callerClassName || null,
      callee_class_name: edge.calleeClassName || null,
      call_type: edge.callType || 'direct',
      call_context: this.mapCallContext(edge.callContext),
      line_number: edge.lineNumber || 0,
      column_number: edge.columnNumber || 0,
      is_async: edge.isAsync || false,
      is_chained: edge.isChained || false,
      confidence_score: edge.confidenceScore || 1.0,
      metadata: edge.metadata || {},
      created_at: new Date().toISOString(),
    }));

    try {
      // Get valid function IDs from functions table to filter call edges
      const functionIdsResult = await this.db.query('SELECT id FROM functions WHERE snapshot_id = $1', [snapshotId]);
      const validFunctionIds = new Set((functionIdsResult.rows as Array<{ id: string }>).map(row => row.id));
      
      // Filter call edges to only include those with valid caller_function_id and callee_function_id
      const validCallEdgeRows = callEdgeRows.filter(row => 
        validFunctionIds.has(row.caller_function_id) && 
        (row.callee_function_id === null || row.callee_function_id === undefined || validFunctionIds.has(row.callee_function_id))
      );
      
      if (validCallEdgeRows.length < callEdgeRows.length) {
        const skipped = callEdgeRows.length - validCallEdgeRows.length;
        this.logger?.debug(`Skipped ${skipped} call edges with invalid function IDs (arrow functions, external functions, etc.)`);
      }

      // Sanitize data to remove NUL characters that cause "invalid message format" error
      const sanitizedRows = validCallEdgeRows.map(row => {
        const sanitizedRow = { ...row };
        
        // Remove NUL characters from string fields
        const stringFields = ['id', 'callee_name', 'callee_signature', 'caller_class_name', 'callee_class_name', 'call_type', 'call_context'] as const;
        for (const field of stringFields) {
          const value = sanitizedRow[field as keyof typeof sanitizedRow];
          if (typeof value === 'string') {
            (sanitizedRow as Record<string, unknown>)[field] = value.replaceAll('\u0000', '\uFFFD');
          }
        }
        
        // Sanitize metadata JSON
        if (sanitizedRow.metadata) {
          const metadataStr = JSON.stringify(sanitizedRow.metadata);
          if (metadataStr.includes('\u0000')) {
            const cleanMetadataStr = metadataStr.replaceAll('\u0000', '\uFFFD');
            sanitizedRow.metadata = JSON.parse(cleanMetadataStr);
          }
        }
        
        return sanitizedRow;
      });

      // Use JSON bulk insert approach for better PGLite compatibility
      const payload = JSON.stringify(sanitizedRows);
      
      const sql = `
        WITH payload AS (SELECT $1::jsonb AS data)
        INSERT INTO call_edges (
          id, snapshot_id, caller_function_id, callee_function_id,
          callee_name, callee_signature, caller_class_name, callee_class_name,
          call_type, call_context, line_number, column_number,
          is_async, is_chained, confidence_score, metadata, created_at
        )
        SELECT
          t.id, t.snapshot_id, t.caller_function_id, t.callee_function_id,
          t.callee_name, t.callee_signature, t.caller_class_name, t.callee_class_name,
          t.call_type, t.call_context, t.line_number::int, t.column_number::int,
          t.is_async::boolean, t.is_chained::boolean, t.confidence_score::real, 
          t.metadata::jsonb, t.created_at::timestamptz
        FROM jsonb_to_recordset((SELECT data FROM payload)) AS t(
          id text,
          snapshot_id text,
          caller_function_id text,
          callee_function_id text,
          callee_name text,
          callee_signature text,
          caller_class_name text,
          callee_class_name text,
          call_type text,
          call_context text,
          line_number int,
          column_number int,
          is_async boolean,
          is_chained boolean,
          confidence_score real,
          metadata jsonb,
          created_at timestamptz
        )
        ON CONFLICT (id) DO NOTHING
      `;
      
      await this.db.query(sql, [payload]);
    } catch (error) {
      this.logger?.error(`Failed to bulk insert call edges: ${error}`);
      this.logger?.error(`Sample row data: ${JSON.stringify(callEdgeRows[0], null, 2)}`);
      throw error;
    }
  }


  /**
   * Insert call edges individually within a transaction
   */
  private async insertCallEdgesIndividualInTransaction(trx: PGTransaction, snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    // 1) 同スナップショット内の有効な function_id を取得
    const functionIdsResult = await trx.query(
      'SELECT id FROM functions WHERE snapshot_id = $1',
      [snapshotId]
    );
    const validFunctionIds = new Set(
      (functionIdsResult.rows as Array<{ id: string }>).map(r => r.id)
    );

    // 2) 事前フィルタ
    const filtered = callEdges.filter(e =>
      validFunctionIds.has(e.callerFunctionId) &&
      (e.calleeFunctionId == null || validFunctionIds.has(e.calleeFunctionId))
    );
    if (filtered.length < callEdges.length) {
      const skipped = callEdges.length - filtered.length;
      this.logger?.debug(`Skipped ${skipped} call edges with invalid function IDs (individual tx path)`);
    }

    for (const edgeRaw of filtered) {
      // NUL byte sanitization to prevent "invalid message format" errors
      const edge = {
        ...edgeRaw,
        calleeName: typeof edgeRaw.calleeName === 'string' ? edgeRaw.calleeName.replaceAll('\u0000', '\uFFFD') : edgeRaw.calleeName,
        calleeSignature: edgeRaw.calleeSignature ? edgeRaw.calleeSignature.replaceAll('\u0000', '\uFFFD') : null,
        callerClassName: edgeRaw.callerClassName ? edgeRaw.callerClassName.replaceAll('\u0000', '\uFFFD') : null,
        calleeClassName: edgeRaw.calleeClassName ? edgeRaw.calleeClassName.replaceAll('\u0000', '\uFFFD') : null,
        callType: edgeRaw.callType ? edgeRaw.callType.replaceAll('\u0000', '\uFFFD') : 'direct',
        callContext: this.mapCallContext(edgeRaw.callContext),
        metadata: (() => {
          try {
            const s = JSON.stringify(edgeRaw.metadata || {});
            return s.includes('\u0000') ? JSON.parse(s.replaceAll('\u0000', '\uFFFD')) : edgeRaw.metadata || {};
          } catch { 
            return {}; 
          }
        })()
      };

      const params = [
        edge.id || generateStableEdgeId(
          edge.callerFunctionId,
          edge.calleeFunctionId ?? `external:${edge.calleeName ?? edge.calleeSignature ?? 'unknown'}`,
          snapshotId
        ),
        snapshotId,
        edge.callerFunctionId,
        edge.calleeFunctionId,
        edge.calleeName,
        edge.calleeSignature || null,
        edge.callerClassName || null,
        edge.calleeClassName || null,
        edge.callType || 'direct',
        edge.callContext,
        edge.lineNumber || 0,
        edge.columnNumber || 0,
        edge.isAsync || false,
        edge.isChained || false,
        edge.confidenceScore || 1.0,
        edge.metadata ? JSON.stringify(edge.metadata) : '{}',
      ];
      
      await trx.query(
        `
        INSERT INTO call_edges (
          id, snapshot_id, caller_function_id, callee_function_id, callee_name,
          callee_signature, caller_class_name, callee_class_name, call_type, call_context,
          line_number, column_number, is_async, is_chained, confidence_score, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, ($16)::jsonb)
        ON CONFLICT (id) DO NOTHING
        `,
        params
      );
    }
  }

  /**
   * Insert internal call edges (optimized version)
   */
  async insertInternalCallEdges(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    // Include all internal call types (direct, async, conditional, dynamic)
    // Only exclude external calls if needed
    const internalEdges = callEdges.filter(edge => edge.callType !== 'external');
    
    if (internalEdges.length === 0) return;

    try {
      // Conservative threshold with improved filter
      if (internalEdges.length >= 10) {
        await this.insertInternalCallEdgesBulk(snapshotId, internalEdges);
      } else {
        await this.insertInternalCallEdgesIndividual(snapshotId, internalEdges);
      }
      
      this.logger?.log(`Inserted ${internalEdges.length} internal call edges for snapshot ${snapshotId}`);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to insert internal call edges: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Bulk insert internal call edges
   */
  private async insertInternalCallEdgesBulk(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    const internalCallEdgeRows = callEdges.map(edge => ({
      id: edge.id || generateStableEdgeId(edge.callerFunctionId, edge.calleeFunctionId!, snapshotId),
      snapshot_id: snapshotId,
      file_path: (edge.metadata as Record<string, unknown>)?.['filePath'] || null,
      caller_function_id: edge.callerFunctionId,
      callee_function_id: edge.calleeFunctionId!,
      caller_name: (edge.metadata as Record<string, unknown>)?.['callerName'] || 'unknown', // Use actual caller function name
      callee_name: edge.calleeName,
      caller_class_name: edge.callerClassName || null,
      callee_class_name: edge.calleeClassName || null,
      line_number: edge.lineNumber || null,
      column_number: edge.columnNumber || null,
      call_type: edge.callType || 'direct',
      call_context: edge.callContext || 'normal',
      confidence_score: edge.confidenceScore || 1.0,
      detected_by: (edge.metadata as Record<string, unknown>)?.['detectedBy'] || 'ast',
    }));

    try {
      // 同スナップショット内の有効な function_id のみ許可
      const functionIdsResult = await this.db.query(
        'SELECT id FROM functions WHERE snapshot_id = $1',
        [snapshotId]
      );
      const validFunctionIds = new Set((functionIdsResult.rows as Array<{ id: string }>).map(r => r.id));
      const validRows = internalCallEdgeRows.filter(row =>
        validFunctionIds.has(row.caller_function_id) && validFunctionIds.has(row.callee_function_id)
      );
      if (validRows.length < internalCallEdgeRows.length) {
        const skipped = internalCallEdgeRows.length - validRows.length;
        this.logger?.debug(`Skipped ${skipped} internal call edges with invalid function IDs`);
      }

      // Sanitize data to remove NUL characters
      const sanitizedRows = validRows.map(row => {
        const sanitizedRow = { ...row };
        
        // Remove NUL characters from string fields
        const stringFields = ['id', 'file_path', 'caller_name', 'callee_name', 'caller_class_name', 'callee_class_name', 'call_type', 'call_context', 'detected_by'] as const;
        for (const field of stringFields) {
          const value = sanitizedRow[field as keyof typeof sanitizedRow];
          if (typeof value === 'string') {
            (sanitizedRow as Record<string, unknown>)[field] = value.replaceAll('\u0000', '\uFFFD');
          }
        }
        
        return sanitizedRow;
      });

      // Use JSON bulk insert approach
      const payload = JSON.stringify(sanitizedRows);
      
      const sql = `
        WITH payload AS (SELECT $1::jsonb AS data)
        INSERT INTO internal_call_edges (
          id, snapshot_id, file_path, caller_function_id, callee_function_id, 
          caller_name, callee_name, caller_class_name, callee_class_name,
          line_number, column_number, call_type, call_context, confidence_score, detected_by
        )
        SELECT
          t.id, t.snapshot_id, t.file_path, t.caller_function_id, t.callee_function_id,
          t.caller_name, t.callee_name, t.caller_class_name, t.callee_class_name,
          t.line_number::int, t.column_number::int, t.call_type, t.call_context, 
          t.confidence_score::real, t.detected_by
        FROM jsonb_to_recordset((SELECT data FROM payload)) AS t(
          id text,
          snapshot_id text,
          file_path text,
          caller_function_id text,
          callee_function_id text,
          caller_name text,
          callee_name text,
          caller_class_name text,
          callee_class_name text,
          line_number int,
          column_number int,
          call_type text,
          call_context text,
          confidence_score real,
          detected_by text
        )
        ON CONFLICT (id) DO NOTHING
      `;
      
      await this.db.query(sql, [payload]);
    } catch (error) {
      this.logger?.error(`Failed to bulk insert internal call edges: ${error}`);
      this.logger?.error(`Sample row data: ${JSON.stringify(internalCallEdgeRows[0], null, 2)}`);
      throw error;
    }
  }

  /**
   * Insert internal call edges individually
   */
  private async insertInternalCallEdgesIndividual(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    // 1) 有効な function_id を同スナップショットから取得
    const functionIdsResult = await this.db.query(
      'SELECT id FROM functions WHERE snapshot_id = $1',
      [snapshotId]
    );
    const validFunctionIds = new Set((functionIdsResult.rows as Array<{ id: string }>).map(r => r.id));

    // 2) 事前フィルタ
    const filtered = callEdges.filter(e =>
      validFunctionIds.has(e.callerFunctionId) && validFunctionIds.has(e.calleeFunctionId!)
    );
    if (filtered.length < callEdges.length) {
      const skipped = callEdges.length - filtered.length;
      this.logger?.debug(`Skipped ${skipped} internal call edges with invalid function IDs (individual path)`);
    }

    for (const edge of filtered) {
      await this.db.query(
        `
        INSERT INTO internal_call_edges (
          id, snapshot_id, file_path, caller_function_id, callee_function_id,
          caller_name, callee_name, caller_class_name, callee_class_name,
          line_number, column_number, call_type, call_context, confidence_score, detected_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO NOTHING
        `,
        [
          edge.id || generateStableEdgeId(edge.callerFunctionId, edge.calleeFunctionId!, snapshotId),
          snapshotId,
          (edge.metadata as Record<string, unknown>)?.['filePath'] || null,
          edge.callerFunctionId,
          edge.calleeFunctionId,
          (edge.metadata as Record<string, unknown>)?.['callerName'] || 'unknown', // Use actual caller function name
          edge.calleeName,
          edge.callerClassName || null,
          edge.calleeClassName || null,
          edge.lineNumber || null,
          edge.columnNumber || null,
          edge.callType || 'direct',
          edge.callContext || 'normal',
          edge.confidenceScore || 1.0,
          (edge.metadata as Record<string, unknown>)?.['detectedBy'] || 'ast',
        ]
      );
    }
  }

  /**
   * Get call edges by caller function
   */
  async getCallEdgesByCaller(callerFunctionId: string): Promise<CallEdge[]> {
    try {
      const result = await this.db.query(
        `
        SELECT * FROM call_edges 
        WHERE caller_function_id = $1 
        ORDER BY line_number, column_number
        `,
        [callerFunctionId]
      );

      return result.rows.map(row => this.mapRowToCallEdge(row as CallEdgeRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get call edges by caller: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get call edges by callee function
   */
  async getCallEdgesByCallee(calleeFunctionId: string): Promise<CallEdge[]> {
    try {
      const result = await this.db.query(
        `
        SELECT * FROM call_edges 
        WHERE callee_function_id = $1 
        ORDER BY line_number, column_number
        `,
        [calleeFunctionId]
      );

      return result.rows.map(row => this.mapRowToCallEdge(row as CallEdgeRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get call edges by callee: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get internal call edges for a snapshot
   */
  async getInternalCallEdges(snapshotId: string): Promise<CallEdge[]> {
    try {
      const result = await this.db.query(
        `
        SELECT * FROM internal_call_edges 
        WHERE snapshot_id = $1 
        ORDER BY line_number, column_number
        `,
        [snapshotId]
      );

      return result.rows.map(row => this.mapRowToInternalCallEdge(row as CallEdgeRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get internal call edges: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get internal callees by function
   */
  async getInternalCalleesByFunction(callerFunctionId: string, snapshotId: string): Promise<string[]> {
    try {
      const result = await this.db.query(
        `
        SELECT DISTINCT callee_function_id 
        FROM internal_call_edges 
        WHERE snapshot_id = $1
          AND caller_function_id = $2
        `,
        [snapshotId, callerFunctionId]
      );

      return result.rows.map(row => (row as { callee_function_id: string }).callee_function_id);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get internal callees by function: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if an internal function is called
   */
  async isInternalFunctionCalled(functionId: string, snapshotId: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        `
        SELECT COUNT(*) as count 
        FROM internal_call_edges 
        WHERE callee_function_id = $1
          AND snapshot_id = $2
        `,
        [functionId, snapshotId]
      );

      return parseInt((result.rows[0] as { count: string }).count) > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to check if internal function is called: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get call graph statistics for a snapshot
   */
  async getCallEdgeStats(snapshotId: string): Promise<CallEdgeStats> {
    try {
      const [edgeStats, topCallers] = await Promise.all([
        this.db.query(`
          SELECT 
            COUNT(*) as total_call_edges,
            COUNT(CASE WHEN call_type != 'external' THEN 1 END) as internal_call_edges,
            COUNT(CASE WHEN call_type = 'external' THEN 1 END) as external_call_edges,
            COUNT(DISTINCT caller_function_id) as distinct_callers
          FROM call_edges
          WHERE snapshot_id = $1
        `, [snapshotId]),
        
        this.db.query(`
          SELECT 
            ce.caller_function_id,
            f.name as function_name,
            COUNT(*) as call_count
          FROM call_edges ce
          JOIN functions f ON ce.caller_function_id = f.id
          WHERE ce.snapshot_id = $1
          GROUP BY ce.caller_function_id, f.name
          ORDER BY call_count DESC
          LIMIT 5
        `, [snapshotId])
      ]);

      const stats = edgeStats.rows[0] as {
        total_call_edges: string;
        internal_call_edges: string;
        external_call_edges: string;
        distinct_callers: string;
      };
      const totalFunctions = await this.getTotalFunctionsCount(snapshotId);

      return {
        totalCallEdges: parseInt(stats.total_call_edges) || 0,
        internalCallEdges: parseInt(stats.internal_call_edges) || 0,
        externalCallEdges: parseInt(stats.external_call_edges) || 0,
        averageCallsPerFunction: totalFunctions > 0 
          ? (parseInt(stats.total_call_edges) || 0) / totalFunctions 
          : 0,
        functionsWithNoCalls: totalFunctions - (parseInt(stats.distinct_callers) || 0),
        functionsWithMostCalls: topCallers.rows.map(row => {
          const typedRow = row as {
            caller_function_id: string;
            function_name: string;
            call_count: string;
          };
          return {
            functionId: typedRow.caller_function_id,
            functionName: typedRow.function_name,
            callCount: parseInt(typedRow.call_count),
          };
        }),
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get call edge stats: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete call edges for a snapshot
   */
  async deleteCallEdges(snapshotId: string): Promise<number> {
    try {
      const result = await this.db.query(
        'DELETE FROM call_edges WHERE snapshot_id = $1',
        [snapshotId]
      );
      return (result as unknown as { changes: number }).changes || 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Failed to delete call edges: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get call graph for visualization
   */
  async getCallGraph(snapshotId: string, options?: {
    includeExternal?: boolean;
    maxDepth?: number;
    rootFunctionId?: string;
  }): Promise<{
    nodes: Array<{ id: string; name: string; type: 'internal' | 'external' }>;
    edges: Array<{ source: string; target: string; type: string }>;
  }> {
    try {
      const nodes = new Map<string, { id: string; name: string; type: 'internal' | 'external' }>();
      const edges: Array<{ source: string; target: string; type: string }> = [];

      let query = `
        SELECT 
          ce.caller_function_id,
          ce.callee_function_id,
          ce.callee_name,
          ce.call_type,
          f1.name as caller_name,
          f2.name as callee_name_internal
        FROM call_edges ce
        LEFT JOIN functions f1 ON ce.caller_function_id = f1.id
        LEFT JOIN functions f2 ON ce.callee_function_id = f2.id
        WHERE ce.snapshot_id = $1
      `;

      const params: unknown[] = [snapshotId];

      if (!options?.includeExternal) {
        query += ' AND ce.call_type != \'external\'';
      }

      if (options?.rootFunctionId) {
        query += ` AND ce.caller_function_id = $${params.length + 1}`;
        params.push(options.rootFunctionId);
      }

      const result = await this.db.query(query, params);

      for (const row of result.rows) {
        const rowData = row as {
          caller_function_id: string;
          callee_function_id?: string;
          callee_name: string;
          call_type: string;
          caller_name?: string;
          callee_name_internal?: string;
        };
        
        // Add caller node
        if (!nodes.has(rowData.caller_function_id)) {
          nodes.set(rowData.caller_function_id, {
            id: rowData.caller_function_id,
            name: rowData.caller_name || 'Unknown',
            type: 'internal'
          });
        }

        // Add callee node
        if (rowData.callee_function_id && !nodes.has(rowData.callee_function_id)) {
          nodes.set(rowData.callee_function_id, {
            id: rowData.callee_function_id,
            name: rowData.callee_name_internal || rowData.callee_name || 'Unknown',
            type: rowData.call_type === 'external' ? 'external' : 'internal'
          });
        }

        // Add edge
        const targetId = rowData.callee_function_id || `external_${rowData.callee_name}`;
        edges.push({
          source: rowData.caller_function_id,
          target: targetId,
          type: rowData.call_type || 'direct'
        });
      }

      return {
        nodes: Array.from(nodes.values()),
        edges
      };
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get call graph: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Private helper methods

  private async getTotalFunctionsCount(snapshotId: string): Promise<number> {
    const result = await this.db.query(
      'SELECT COUNT(*) as count FROM functions WHERE snapshot_id = $1',
      [snapshotId]
    );
    return parseInt((result.rows[0] as { count: string }).count) || 0;
  }

  private mapRowToCallEdge(row: CallEdgeRow): CallEdge {
    return {
      id: row.id,
      callerFunctionId: row.caller_function_id,
      calleeFunctionId: row.callee_function_id || undefined,
      calleeName: row.callee_name,
      lineNumber: row.line_number,
      columnNumber: row.column_number,
      callType: row.call_type || 'direct',
      isAsync: row.is_async || false,
      isChained: row.is_chained || false,
      confidenceScore: row.confidence_score || 1.0,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      createdAt: row.created_at || new Date().toISOString(),
    };
  }

  private mapRowToInternalCallEdge(row: CallEdgeRow): CallEdge {
    return {
      id: row.id,
      callerFunctionId: row.caller_function_id,
      calleeFunctionId: row.callee_function_id ?? undefined,
      calleeName: row.callee_name,
      lineNumber: row.line_number,
      columnNumber: row.column_number,
      callType: row.call_type || 'direct',
      isAsync: row.is_async || false,
      isChained: row.is_chained || false,
      confidenceScore: row.confidence_score || 1.0,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      createdAt: row.created_at || new Date().toISOString(),
    };
  }


  // ========================================
  // ADDITIONAL CALL EDGE METHODS
  // ========================================

  async getCallEdges(options?: {
    snapshotId?: string;
    callerFunctionId?: string;
    calleeFunctionId?: string;
    calleeName?: string;
    callType?: string;
    limit?: number;
    offset?: number;
  }): Promise<CallEdge[]> {
    let qb = this.kysely.selectFrom('call_edges').selectAll();

    if (options?.snapshotId) {
      qb = qb.where('snapshot_id', '=', options.snapshotId);
    }
    if (options?.callerFunctionId) {
      qb = qb.where('caller_function_id', '=', options.callerFunctionId);
    }
    if (options?.calleeFunctionId) {
      qb = qb.where('callee_function_id', '=', options.calleeFunctionId);
    }
    if (options?.calleeName) {
      qb = qb.where('callee_name', '=', options.calleeName);
    }
    if (options?.callType) {
      qb = qb.where('call_type', '=', options.callType);
    }
    if (options?.limit) {
      qb = qb.limit(options.limit);
    }
    if (options?.offset) {
      qb = qb.offset(options.offset);
    }

    const compiled = qb.compile();
    const result = await this.db.query(compiled.sql, compiled.parameters as unknown[]);
    
    return result.rows.map(row => this.mapRowToCallEdge(row as CallEdgeRow));
  }


  async getCallEdgesBySnapshot(snapshotId: string): Promise<CallEdge[]> {
    const query = this.kysely
      .selectFrom('call_edges')
      .selectAll()
      .where('snapshot_id', '=', snapshotId);

    const result = await this.db.query(query.compile().sql, query.compile().parameters as unknown[]);
    
    return result.rows.map(row => this.mapRowToCallEdge(row as CallEdgeRow));
  }

  async getInternalCallEdgesBySnapshot(snapshotId: string): Promise<CallEdge[]> {
    const query = this.kysely
      .selectFrom('internal_call_edges')
      .selectAll()
      .where('snapshot_id', '=', snapshotId);

    const result = await this.db.query(query.compile().sql, query.compile().parameters as unknown[]);
    
    return result.rows.map(row => this.mapRowToInternalCallEdge(row as CallEdgeRow));
  }

  /**
   * Map call context to valid database values
   */
  private mapCallContext(context?: string): string {
    if (!context) return 'normal';
    
    // Map analysis contexts to database-valid contexts
    switch (context) {
      case 'local_exact':
      case 'import_exact':
      case 'cha':
      case 'rta':
        return 'normal';
      case 'conditional':
        return 'conditional';
      case 'loop':
        return 'loop';
      case 'try':
        return 'try';
      case 'catch':
        return 'catch';
      default:
        return 'normal';
    }
  }


}