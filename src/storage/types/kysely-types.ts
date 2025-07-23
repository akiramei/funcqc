/**
 * Kysely database table type definitions for funcqc
 * Defines the structure of all database tables used by the PGLite adapter
 */

/**
 * Call edges table - tracks function calls across files
 */
export interface CallEdgeTable {
  id: string;
  snapshot_id: string;
  caller_function_id: string;
  callee_function_id: string | null;
  callee_name: string;
  callee_signature: string | null;
  caller_class_name: string | null;
  callee_class_name: string | null;
  call_type: string;
  call_context: string | null;
  line_number: number;
  column_number: number;
  is_async: boolean;
  is_chained: boolean;
  confidence_score: number;
  metadata: object;
  created_at: string;
}

/**
 * Internal call edges table - tracks function calls within the same file
 */
export interface InternalCallEdgeTable {
  id: string;
  snapshot_id: string;
  file_path: string;
  caller_function_id: string;
  callee_function_id: string;
  caller_name: string;
  callee_name: string;
  caller_class_name: string | null;
  callee_class_name: string | null;
  line_number: number;
  column_number: number;
  call_type: 'direct' | 'conditional' | 'async' | 'dynamic' | null;
  call_context: string | null;
  confidence_score: number;
  detected_by: string;
  created_at: string;
}

/**
 * Main database interface for Kysely
 * Add other table interfaces as needed
 */
export interface Database {
  call_edges: CallEdgeTable;
  internal_call_edges: InternalCallEdgeTable;
  // 他のテーブルは必要に応じて追加
}

