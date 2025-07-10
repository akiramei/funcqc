// Common type definitions for replacing 'any' types

// Configuration validation types
export type ConfigValue = string | number | boolean | string[] | Record<string, unknown>;

export interface UserConfig {
  roots?: string[];
  exclude?: string[];
  include?: string[];
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
  metadata: string; // JSON string
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
  context_path?: string; // Hierarchical context JSON
  function_type?: 'function' | 'method' | 'arrow' | 'local';
  modifiers?: string; // Modifiers JSON ['static', 'private', 'async']
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
