// Common type definitions for replacing 'any' types

// Configuration validation types
export type ConfigValue = string | number | boolean | string[] | Record<string, unknown>;

export interface UserConfig {
  roots?: string[];
  exclude?: string[];
  include?: string[];
  scopes?: {
    [scopeName: string]: {
      roots: string[];
      exclude?: string[];
      include?: string[];
      description?: string;
    };
  };
  storage?: {
    type?: 'pglite' | 'postgres';
    path?: string;
    url?: string;
  };
  metrics?: Partial<{
    complexityThreshold: number;
    cognitiveComplexityThreshold: number;
    linesOfCodeThreshold: number;
    parameterCountThreshold: number;
    maxNestingLevelThreshold: number;
  }>;
  thresholds?: Record<string, unknown>;
  funcqcThresholds?: Record<string, unknown>;
  assessment?: Record<string, unknown>;
  projectContext?: Record<string, unknown>;
  git?: {
    enabled?: boolean;
    autoLabel?: boolean;
  };
  similarity?: Record<string, unknown>;
}

// Database row types
export interface SnapshotRow {
  id: string;
  created_at: string;
  label?: string;
  comment?: string;
  git_commit?: string;
  git_branch?: string;
  git_tag?: string;
  project_root: string;
  config_hash: string;
  scope: string;  // スコープ識別子 ('src', 'test', 'all', etc.)
  metadata: {
    totalFunctions: number;
    totalFiles: number;
    avgComplexity: number;
    maxComplexity: number;
    exportedFunctions: number;
    asyncFunctions: number;
    complexityDistribution: Record<number, number>;
    fileExtensions: Record<string, number>;
    analysisLevel?: 'NONE' | 'BASIC' | 'CALL_GRAPH';
    basicAnalysisCompleted?: boolean;
    callGraphAnalysisCompleted?: boolean;
  }; // JSONB is automatically parsed by PGLite
}

export interface FunctionRow {
  id: string; // Physical UUID
  semantic_id: string; // Semantic hash (role-based identification)
  content_id: string; // Content hash (implementation-based identification)
  snapshot_id: string;
  name: string;
  display_name: string;
  signature: string;
  signature_hash: string;
  file_path: string;
  file_hash: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  ast_hash: string;

  // Enhanced function identification
  context_path?: string[]; // PostgreSQL TEXT[] array
  function_type?: 'function' | 'method' | 'arrow' | 'local';
  modifiers?: string[]; // PostgreSQL TEXT[] array
  nesting_level?: number; // Nesting depth

  // Existing function attributes
  is_exported: boolean;
  is_async: boolean;
  is_generator: boolean;
  is_arrow_function: boolean;
  is_method: boolean;
  is_constructor: boolean;
  is_static: boolean;
  access_modifier?: 'public' | 'private' | 'protected';
  js_doc?: string;
  source_code?: string;
  source_file_ref_id?: string;  // Reference to source_file_refs table
}

export interface ParameterRow {
  function_id: string;
  name: string;
  type: string;
  type_simple: string;
  position: number;
  is_optional: boolean;
  is_rest: boolean;
  default_value?: string;
  description?: string;
}

export interface MetricsRow {
  function_id: string;
  lines_of_code: number;
  total_lines: number;
  cyclomatic_complexity: number;
  cognitive_complexity: number;
  max_nesting_level: number;
  parameter_count: number;
  return_statement_count: number;
  branch_count: number;
  loop_count: number;
  try_catch_count: number;
  async_await_count: number;
  callback_count: number;
  comment_lines: number;
  code_to_comment_ratio: number;
  halstead_volume?: number;
  halstead_difficulty?: number;
  maintainability_index?: number;
}

export interface CallEdgeRow {
  id: string;
  caller_function_id: string;
  callee_function_id?: string | null;
  callee_name: string;
  callee_signature?: string | null;
  caller_class_name?: string | null;
  callee_class_name?: string | null;
  call_type: 'direct' | 'conditional' | 'async' | 'external' | 'dynamic';
  call_context?: string | null;
  line_number: number;
  column_number: number;
  is_async: boolean;
  is_chained: boolean;
  confidence_score: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SourceFileRow {
  id: string;
  snapshot_id: string;
  file_path: string;
  file_content: string;
  file_hash: string;
  encoding: string;
  file_size_bytes: number;
  line_count: number;
  language: string;
  function_count: number;
  export_count: number;
  import_count: number;
  file_modified_time?: string | null;
  created_at: string;
}

// Diff/History related types
export interface DiffFunction {
  id: string;
  name: string;
  displayName: string;
  filePath: string;
  signature: string;
  startLine: number;
  endLine: number;
  metrics?: {
    complexity: number;
    lines: number;
    [key: string]: number | undefined;
  };
  changes?: Array<{
    field: string;
    oldValue: string | number | boolean;
    newValue: string | number | boolean;
  }>;
}

// CLI display types
export interface DisplayOptions {
  showId?: boolean;
  verbose?: boolean;
  json?: boolean;
  limit?: number;
  fields?: string[];
}

// Error/Log detail types
export type LogDetails = string | Error | Record<string, unknown> | unknown;

// Field access types
export type FieldValue = string | number | boolean | null | undefined;

// Statistics types
export interface MetricChange {
  field: string;
  oldValue: number;
  newValue: number;
  change: number;
  percentChange: number;
}

// Validation helpers
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isConfigValue(value: unknown): value is ConfigValue {
  if (value === null || value === undefined) return false;
  const type = typeof value;
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'boolean' ||
    isStringArray(value) ||
    isRecord(value)
  );
}
