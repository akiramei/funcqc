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
 * Source contents table - deduplicated file content
 */
export interface SourceContentsTable {
  id: string; // "${fileHash}_${fileSizeBytes}"
  content: string;
  file_hash: string;
  file_size_bytes: number;
  line_count: number;
  language: string;
  encoding: string;
  export_count: number;
  import_count: number;
  created_at: string;
}

/**
 * Source file refs table - file references per snapshot
 */
export interface SourceFileRefsTable {
  id: string; // UUID
  snapshot_id: string;
  file_path: string;
  content_id: string;
  file_modified_time: string | null;
  function_count: number;
  created_at: string;
}

/**
 * Functions table - core function information
 */
export interface FunctionsTable {
  id: string;
  snapshot_id: string;
  semantic_id: string;
  content_id: string;
  name: string;
  display_name: string;
  signature: string;
  file_path: string;
  context_path: string[] | null;
  function_type: string | null;
  modifiers: string[] | null;
  nesting_level: number;
  is_exported: boolean;
  is_async: boolean;
  is_generator: boolean;
  is_arrow_function: boolean;
  is_method: boolean;
  is_constructor: boolean;
  is_static: boolean;
  access_modifier: string | null;
  ast_hash: string;
  source_code: string | null;
  signature_hash: string;
  file_hash: string;
  file_content_hash: string | null;
  source_file_ref_id: string | null;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  created_at: string;
}

/**
 * Snapshots table - version management
 */
export interface SnapshotsTable {
  id: string;
  created_at: string;
  label: string | null;
  comment: string | null;
  git_commit: string | null;
  git_branch: string | null;
  git_tag: string | null;
  project_root: string;
  config_hash: string;
  scope: string;
  metadata: object;
}

/**
 * Main database interface for Kysely
 * Add other table interfaces as needed
 */
export interface Database {
  call_edges: CallEdgeTable;
  internal_call_edges: InternalCallEdgeTable;
  source_contents: SourceContentsTable;
  source_file_refs: SourceFileRefsTable;
  functions: FunctionsTable;
  snapshots: SnapshotsTable;
  // 他のテーブルは必要に応じて追加
}

