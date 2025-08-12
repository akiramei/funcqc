/**
 * Type definitions for type insights analyzers
 */

/**
 * Basic storage interface for database queries
 */
export interface StorageQueryInterface {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Database row representing property usage
 */
export interface PropertyUsageRow {
  accessed_property: string;
  access_type: string;
  function_id: string;
  usage_count: number;
}

/**
 * Database row representing type definition
 */
export interface TypeDefinitionRow {
  id: string;
  snapshot_id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
}

/**
 * Database row representing type member
 */
export interface TypeMemberRow {
  id: string;
  type_id: string;
  snapshot_id: string;
  name: string;
  member_kind: string;
  type_text?: string;
  access_modifier?: string;
  is_readonly?: boolean;
  function_id?: string;
}

/**
 * Database row representing snapshot information
 */
export interface SnapshotRow {
  created_at: string;
  label?: string;
}

/**
 * Database row representing type relationship
 */
export interface TypeRelationshipRow {
  source_type_id: string;
  target_type_id: string;
  target_name?: string;
  relationship_kind: string;
}

/**
 * Database row for call edges
 */
export interface CallEdgeRow {
  callee_function_id: string;
  call_count: number;
}

/**
 * Database row for property name query
 */
export interface PropertyNameRow {
  name: string;
  accessed_property?: string;
}

/**
 * Database row for count queries
 */
export interface CountRow {
  direct_count?: string;
  usage_count?: string;
}

/**
 * Database row for function information
 */
export interface FunctionInfoRow {
  file_path: string;
  display_name: string;
}