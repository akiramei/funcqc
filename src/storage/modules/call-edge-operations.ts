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
import { StorageContext, StorageOperationModule } from './types';

// Type for PGLite transaction object
interface PGTransaction {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}
import { v4 as uuidv4 } from 'uuid';

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

export class CallEdgeOperations implements StorageOperationModule {
  readonly db;
  readonly kysely;
  private logger;

  constructor(context: StorageContext) {
    this.db = context.db;
    this.kysely = context.kysely;
    this.logger = context.logger;
  }

  /**
   * Insert call edges for a snapshot
   */
  async insertCallEdges(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    if (callEdges.length === 0) return;

    try {
      // Temporarily use individual inserts to avoid bulk insert issues
      if (false && callEdges.length >= 50) {
        await this.insertCallEdgesBulk(snapshotId, callEdges);
      } else {
        await this.insertCallEdgesIndividual(snapshotId, callEdges);
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
      await this.insertCallEdgesIndividualInTransaction(trx, snapshotId, callEdges);
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
   * Insert call edges using bulk insert for better performance
   */
  private async insertCallEdgesBulk(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    const callEdgeRows = callEdges.map(edge => ({
      id: edge.id || uuidv4(),
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
      await this.kysely
        .insertInto('call_edges')
        .values(callEdgeRows)
        .execute();
    } catch (error) {
      this.logger?.error(`Failed to bulk insert call edges: ${error}`);
      this.logger?.error(`Sample row data: ${JSON.stringify(callEdgeRows[0], null, 2)}`);
      throw error;
    }
  }

  /**
   * Insert call edges individually (for smaller batches)
   */
  private async insertCallEdgesIndividual(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    for (const edge of callEdges) {
      const params = [
        edge.id || uuidv4(),
        snapshotId,
        edge.callerFunctionId,
        edge.calleeFunctionId,
        edge.calleeName,
        edge.calleeSignature || null,
        edge.callerClassName || null,
        edge.calleeClassName || null,
        edge.callType || 'direct',
        this.mapCallContext(edge.callContext),
        edge.lineNumber || 0,
        edge.columnNumber || 0,
        edge.isAsync || false,
        edge.isChained || false,
        edge.confidenceScore || 1.0,
        edge.metadata ? JSON.stringify(edge.metadata) : '{}',
      ];
      
      try {
        await this.db.query(
          `
          INSERT INTO call_edges (
            id, snapshot_id, caller_function_id, callee_function_id, callee_name,
            callee_signature, caller_class_name, callee_class_name, call_type, call_context,
            line_number, column_number, is_async, is_chained, confidence_score, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          `,
          params
        );
      } catch (error) {
        this.logger?.error(`Failed to insert call edge: ${error}, params: ${JSON.stringify(params.slice(0, 5))}`);
        throw error;
      }
    }
  }

  /**
   * Insert call edges individually within a transaction
   */
  private async insertCallEdgesIndividualInTransaction(trx: PGTransaction, snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    for (const edge of callEdges) {
      const params = [
        edge.id || uuidv4(),
        snapshotId,
        edge.callerFunctionId,
        edge.calleeFunctionId,
        edge.calleeName,
        edge.calleeSignature || null,
        edge.callerClassName || null,
        edge.calleeClassName || null,
        edge.callType || 'direct',
        this.mapCallContext(edge.callContext),
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `,
        params
      );
    }
  }

  /**
   * Insert internal call edges (optimized version)
   */
  async insertInternalCallEdges(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    const internalEdges = callEdges.filter(edge => edge.callType === 'direct');
    
    if (internalEdges.length === 0) return;

    try {
      if (internalEdges.length >= 50) {
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
      id: edge.id || uuidv4(),
      snapshot_id: snapshotId,
      caller_function_id: edge.callerFunctionId,
      callee_function_id: edge.calleeFunctionId!,
      callee_name: edge.calleeName,
      line_number: edge.lineNumber,
      column_number: edge.columnNumber,
      call_type: edge.callType || 'direct',
    }));

    // Use direct SQL instead of Kysely for now to avoid type issues
    for (const row of internalCallEdgeRows) {
      await this.db.query(
        `INSERT INTO internal_call_edges (
          id, snapshot_id, caller_function_id, callee_function_id, callee_name,
          line_number, column_number, call_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.id, row.snapshot_id, row.caller_function_id, row.callee_function_id,
          row.callee_name, row.line_number, row.column_number,
          row.call_type
        ]
      );
    }
  }

  /**
   * Insert internal call edges individually
   */
  private async insertInternalCallEdgesIndividual(snapshotId: string, callEdges: CallEdge[]): Promise<void> {
    for (const edge of callEdges) {
      await this.db.query(
        `
        INSERT INTO internal_call_edges (
          id, snapshot_id, caller_function_id, callee_function_id, callee_name,
          line_number, column_number, call_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          edge.id || uuidv4(),
          snapshotId,
          edge.callerFunctionId,
          edge.calleeFunctionId,
          edge.calleeName,
          edge.lineNumber || null,
          edge.columnNumber || null,
          edge.callType || 'direct',
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
  async getInternalCalleesByFunction(callerFunctionId: string): Promise<string[]> {
    try {
      const result = await this.db.query(
        `
        SELECT DISTINCT callee_function_id 
        FROM internal_call_edges 
        WHERE caller_function_id = $1
        `,
        [callerFunctionId]
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
  async isInternalFunctionCalled(functionId: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        `
        SELECT COUNT(*) as count 
        FROM internal_call_edges 
        WHERE callee_function_id = $1
        `,
        [functionId]
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
    const query = this.kysely.selectFrom('call_edges').selectAll();

    if (options?.snapshotId) {
      query.where('snapshot_id', '=', options.snapshotId);
    }
    if (options?.callerFunctionId) {
      query.where('caller_function_id', '=', options.callerFunctionId);
    }
    if (options?.calleeFunctionId) {
      query.where('callee_function_id', '=', options.calleeFunctionId);
    }
    if (options?.calleeName) {
      query.where('callee_name', '=', options.calleeName);
    }
    if (options?.callType) {
      query.where('call_type', '=', options.callType);
    }
    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    const result = await this.db.query(query.compile().sql, query.compile().parameters as unknown[]);
    
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