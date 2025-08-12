-- =============================================================================
-- FUNCQC DATABASE SCHEMA - COMPLETE DEFINITION
-- =============================================================================
--
-- This file contains the complete database schema for funcqc.
-- 
-- ⚠️  CRITICAL: This is the SINGLE SOURCE OF TRUTH for all database schema.
-- ⚠️  DO NOT EDIT schema definitions in TypeScript files.
-- ⚠️  ALL schema changes must be made in this file only.
--
-- ## Architecture Overview
--
-- funcqc uses a 3-dimensional function identification system:
-- - Physical Identity: UUID-based unique identification per snapshot
-- - Semantic Identity: Role/responsibility-based logical identification  
-- - Content Identity: Implementation content-based identification
--
-- ## Table Dependencies (Creation Order)
--
-- Level 1: snapshots (independent base tables)
-- Level 2: functions, function_descriptions (core entities)
-- Level 3: function_parameters, quality_metrics, call_edges, naming_evaluations
--
-- =============================================================================

-- =============================================================================
-- LEVEL 1: BASE TABLES (No dependencies)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Snapshots: Version management and Git integration
-- -----------------------------------------------------------------------------
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,                    -- UUID v4 または "snap_" + timestamp
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  label TEXT,                            -- ユーザー定義ラベル
  comment TEXT,                          -- ユーザーコメント
  git_commit TEXT,                       -- Git commit hash
  git_branch TEXT,                       -- Git branch name
  git_tag TEXT,                          -- Git tag (if any)
  project_root TEXT NOT NULL DEFAULT '', -- プロジェクトルートパス
  config_hash TEXT NOT NULL DEFAULT '',  -- 設定ファイルのハッシュ
  scope TEXT NOT NULL DEFAULT 'src',     -- スコープ識別子 ('src', 'test', 'all', etc.)
  metadata JSONB DEFAULT '{}'            -- JSON形式の追加情報
);

CREATE INDEX idx_snapshots_created_at ON snapshots(created_at);
CREATE INDEX idx_snapshots_git_commit ON snapshots(git_commit);
CREATE INDEX idx_snapshots_git_branch ON snapshots(git_branch);
CREATE INDEX idx_snapshots_scope ON snapshots(scope);
-- Composite index for scope-aware queries
CREATE INDEX idx_snapshots_scope_created_at ON snapshots(scope, created_at DESC);


-- =============================================================================
-- LEVEL 2: CORE ENTITIES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Source Contents: Deduplicated file content storage (N:1 design)
-- -----------------------------------------------------------------------------
CREATE TABLE source_contents (
  id TEXT PRIMARY KEY,                          -- Content ID (hash_size composite)
  content TEXT NOT NULL,                        -- Complete file source code
  file_hash TEXT NOT NULL,                      -- Content hash for deduplication
  file_size_bytes INTEGER NOT NULL,             -- Content size in bytes
  line_count INTEGER NOT NULL,                  -- Total lines in file
  language TEXT NOT NULL,                       -- Detected language (typescript, javascript, etc)
  encoding TEXT DEFAULT 'utf-8',                -- File encoding
  export_count INTEGER DEFAULT 0,               -- Number of exports 
  import_count INTEGER DEFAULT 0,               -- Number of imports
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(file_hash, file_size_bytes)            -- Ensure deduplication
);

-- Indexes for source contents
CREATE INDEX idx_source_contents_file_hash ON source_contents(file_hash);
CREATE INDEX idx_source_contents_language ON source_contents(language);
CREATE INDEX idx_source_contents_created_at ON source_contents(created_at);

-- -----------------------------------------------------------------------------
-- Source File References: Per-snapshot file references (N:1 design)
-- -----------------------------------------------------------------------------
CREATE TABLE source_file_refs (
  id TEXT PRIMARY KEY,                          -- Reference ID (UUID)
  snapshot_id TEXT NOT NULL,                    -- Snapshot this reference belongs to
  file_path TEXT NOT NULL,                      -- Relative path from project root
  content_id TEXT NOT NULL,                     -- Reference to source_contents
  file_modified_time TIMESTAMPTZ,               -- Original file modification time
  function_count INTEGER DEFAULT 0,             -- Number of functions in this file
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES source_contents(id) ON DELETE RESTRICT,
  
  UNIQUE(snapshot_id, file_path)                -- One reference per file per snapshot
);

-- Indexes for source file references
CREATE INDEX idx_source_file_refs_snapshot_id ON source_file_refs(snapshot_id);
CREATE INDEX idx_source_file_refs_file_path ON source_file_refs(file_path);
CREATE INDEX idx_source_file_refs_content_id ON source_file_refs(content_id);
CREATE INDEX idx_source_file_refs_function_count ON source_file_refs(function_count);

-- -----------------------------------------------------------------------------
-- Functions: Core function information with 3-dimensional identification
-- -----------------------------------------------------------------------------
CREATE TABLE functions (
  -- 物理識別次元
  id TEXT PRIMARY KEY,                   -- Physical UUID（物理的実体の一意識別）
  snapshot_id TEXT NOT NULL,             -- スナップショット参照
  start_line INTEGER NOT NULL,           -- ファイル内開始行
  end_line INTEGER NOT NULL,             -- ファイル内終了行
  start_column INTEGER NOT NULL DEFAULT 0,
  end_column INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  -- 意味識別次元
  semantic_id TEXT NOT NULL,             -- Semantic hash（役割ベース識別）
  name TEXT NOT NULL,                    -- 関数名
  display_name TEXT NOT NULL,            -- 表示用名前（クラス.メソッド等）
  signature TEXT NOT NULL,               -- 完全なシグネチャ
  file_path TEXT NOT NULL,               -- プロジェクトルートからの相対パス
  context_path JSONB DEFAULT '[]',       -- 階層コンテキスト ['Class', 'method']
  function_type TEXT,                    -- 'function' | 'method' | 'arrow' | 'local'
  modifiers JSONB DEFAULT '[]',          -- ['static', 'private', 'async']
  nesting_level INTEGER DEFAULT 0,       -- ネスト深度
  
  -- 関数属性（意味ベース）
  is_exported BOOLEAN DEFAULT FALSE,
  is_async BOOLEAN DEFAULT FALSE,
  is_generator BOOLEAN DEFAULT FALSE,
  is_arrow_function BOOLEAN DEFAULT FALSE,
  is_method BOOLEAN DEFAULT FALSE,
  is_constructor BOOLEAN DEFAULT FALSE,
  is_static BOOLEAN DEFAULT FALSE,
  access_modifier TEXT,                  -- 'public' | 'private' | 'protected'
  
  -- 内容識別次元
  content_id TEXT NOT NULL,              -- Content hash（実装内容識別）
  ast_hash TEXT NOT NULL,                -- AST構造のハッシュ
  source_code TEXT,                      -- 関数のソースコード
  signature_hash TEXT NOT NULL,          -- シグネチャのハッシュ
  
  -- 効率化用フィールド
  file_hash TEXT NOT NULL,               -- ファイル内容のハッシュ
  file_content_hash TEXT,                -- ファイル変更検出高速化用
  
  -- File relationship (N:1 design)
  source_file_ref_id TEXT,               -- Reference to source_file_refs table
  
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (source_file_ref_id) REFERENCES source_file_refs(id) ON DELETE SET NULL
);

-- 3次元識別に最適化されたインデックス
CREATE INDEX idx_functions_snapshot_id ON functions(snapshot_id);
CREATE INDEX idx_functions_semantic_id ON functions(semantic_id);
CREATE INDEX idx_functions_content_id ON functions(content_id);
CREATE INDEX idx_functions_name ON functions(name);
CREATE INDEX idx_functions_file_path ON functions(file_path);
CREATE INDEX idx_functions_signature_hash ON functions(signature_hash);
CREATE INDEX idx_functions_ast_hash ON functions(ast_hash);

-- 複合インデックス
CREATE INDEX idx_functions_semantic_content ON functions(semantic_id, content_id);
CREATE INDEX idx_functions_snapshot_semantic ON functions(snapshot_id, semantic_id);

-- 条件付きインデックス
CREATE INDEX idx_functions_exported ON functions(is_exported) WHERE is_exported = TRUE;
CREATE INDEX idx_functions_async ON functions(is_async) WHERE is_async = TRUE;

-- File relationship indexes (N:1 design)
CREATE INDEX idx_functions_source_file_ref_id ON functions(source_file_ref_id);

-- -----------------------------------------------------------------------------
-- Function Descriptions: Semantic-based function documentation
-- -----------------------------------------------------------------------------
CREATE TABLE function_descriptions (
  semantic_id TEXT PRIMARY KEY,          -- 意味ベース参照
  description TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'human',  -- 'human' | 'ai' | 'jsdoc'
  validated_for_content_id TEXT,         -- 実装確認済みマーク
  needs_review BOOLEAN DEFAULT FALSE,    -- 実装変更時の確認要求
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,                       -- 作成者
  ai_model TEXT,                         -- AI生成時のモデル名
  confidence_score REAL,                 -- AI生成時の信頼度
  -- 構造化説明フィールド（v0.1.0追加）
  usage_example TEXT,                    -- 使用例（コードサンプル等）
  side_effects TEXT,                     -- 副作用と出力の説明
  error_conditions TEXT,                 -- エラー条件とハンドリング
  UNIQUE(semantic_id)
);

-- 自動トリガー: 内容変更検出
-- Note: Triggers are created separately in the application layer for compatibility
-- CREATE TRIGGER function_content_change_detection
--   AFTER UPDATE ON functions
--   FOR EACH ROW
--   WHEN OLD.content_id != NEW.content_id
-- BEGIN
--   UPDATE function_descriptions 
--   SET needs_review = TRUE 
--   WHERE semantic_id = NEW.semantic_id;
-- END;

CREATE INDEX idx_function_descriptions_source ON function_descriptions(source);
CREATE INDEX idx_function_descriptions_needs_review ON function_descriptions(needs_review) WHERE needs_review = TRUE;

-- =============================================================================
-- LEVEL 3: DEPENDENT TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function Parameters: Parameter information
-- -----------------------------------------------------------------------------
CREATE TABLE function_parameters (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  function_id TEXT NOT NULL,             -- 物理ID参照
  snapshot_id TEXT NOT NULL,             -- スナップショット参照
  name TEXT NOT NULL,
  type TEXT NOT NULL,                    -- TypeScript型表現
  type_simple TEXT NOT NULL,             -- 簡略型（string, number等）
  position INTEGER NOT NULL,             -- 0ベースの位置
  is_optional BOOLEAN DEFAULT FALSE,
  is_rest BOOLEAN DEFAULT FALSE,         -- ...rest パラメータ
  default_value TEXT,                    -- デフォルト値（あれば）
  description TEXT,                      -- JSDocからの説明
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE INDEX idx_function_parameters_function_id ON function_parameters(function_id);
CREATE INDEX idx_function_parameters_position ON function_parameters(function_id, position);

-- -----------------------------------------------------------------------------
-- Function Documentation: JSDoc comments and documentation
-- -----------------------------------------------------------------------------
CREATE TABLE function_documentation (
  function_id TEXT PRIMARY KEY,          -- 物理ID参照
  js_doc TEXT,                          -- JSDocコメント
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

CREATE INDEX idx_function_documentation_created_at ON function_documentation(created_at);

-- -----------------------------------------------------------------------------
-- Quality Metrics: Content-based quality indicators
-- -----------------------------------------------------------------------------
CREATE TABLE quality_metrics (
  function_id TEXT PRIMARY KEY,          -- 物理ID参照
  snapshot_id TEXT NOT NULL,             -- スナップショット参照
  lines_of_code INTEGER NOT NULL,       -- 実行可能行数
  total_lines INTEGER NOT NULL,         -- コメント込み総行数
  cyclomatic_complexity INTEGER NOT NULL,
  cognitive_complexity INTEGER NOT NULL,
  max_nesting_level INTEGER NOT NULL,
  parameter_count INTEGER NOT NULL,
  return_statement_count INTEGER NOT NULL,
  branch_count INTEGER NOT NULL,        -- if, switch等の分岐数
  loop_count INTEGER NOT NULL,          -- for, while等のループ数
  try_catch_count INTEGER NOT NULL,     -- try-catch文の数
  async_await_count INTEGER NOT NULL,   -- await使用回数
  callback_count INTEGER NOT NULL,      -- コールバック関数の数
  comment_lines INTEGER DEFAULT 0,      -- コメント行数
  code_to_comment_ratio REAL DEFAULT 0, -- コード/コメント比
  halstead_volume REAL,                 -- Halstead Volume（オプション）
  halstead_difficulty REAL,            -- Halstead Difficulty（オプション）
  maintainability_index REAL,          -- 保守性指標（オプション）
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

-- パフォーマンス最適化インデックス
CREATE INDEX idx_quality_metrics_complexity ON quality_metrics(cyclomatic_complexity);
CREATE INDEX idx_quality_metrics_cognitive ON quality_metrics(cognitive_complexity);
CREATE INDEX idx_quality_metrics_lines ON quality_metrics(lines_of_code);
CREATE INDEX idx_quality_metrics_nesting ON quality_metrics(max_nesting_level);

-- -----------------------------------------------------------------------------
-- Call Edges: Function call relationships for dependency analysis
-- -----------------------------------------------------------------------------
CREATE TABLE call_edges (
  id TEXT PRIMARY KEY,                          -- Edge ID (UUID)
  snapshot_id TEXT NOT NULL,                    -- Snapshot this edge belongs to
  caller_function_id TEXT NOT NULL,             -- Physical ID of calling function
  callee_function_id TEXT,                      -- Physical ID of called function (NULL for external)
  callee_name TEXT NOT NULL,                    -- Function/method name being called
  callee_signature TEXT,                        -- Full signature if resolvable
  caller_class_name TEXT,                        -- Class name for caller if it's a method/constructor
  callee_class_name TEXT,                        -- Class name for callee if it's a method/constructor
  call_type TEXT NOT NULL CHECK (              -- Type of call relationship
    call_type IN ('direct', 'conditional', 'async', 'external', 'dynamic', 'virtual')
  ),
  call_context TEXT,                            -- Context: 'normal', 'conditional', 'loop', 'try', 'catch'
  line_number INTEGER NOT NULL,                 -- Line where call occurs
  column_number INTEGER DEFAULT 0,              -- Column position
  is_async BOOLEAN DEFAULT FALSE,               -- Is it an await call
  is_chained BOOLEAN DEFAULT FALSE,             -- Part of method chain
  confidence_score REAL DEFAULT 1.0,           -- Analysis confidence (0-1)
  metadata JSONB DEFAULT '{}',                  -- Additional call metadata
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (caller_function_id) REFERENCES functions(id) ON DELETE CASCADE,
  FOREIGN KEY (callee_function_id) REFERENCES functions(id) ON DELETE SET NULL
);

-- Indexes for call graph traversal and analysis
CREATE INDEX idx_call_edges_snapshot ON call_edges(snapshot_id);
CREATE INDEX idx_call_edges_caller ON call_edges(caller_function_id);
CREATE INDEX idx_call_edges_callee ON call_edges(callee_function_id);
CREATE INDEX idx_call_edges_callee_name ON call_edges(callee_name);
CREATE INDEX idx_call_edges_call_type ON call_edges(call_type);
CREATE INDEX idx_call_edges_snapshot_caller ON call_edges(snapshot_id, caller_function_id);
CREATE INDEX idx_call_edges_snapshot_callee ON call_edges(snapshot_id, callee_function_id);
CREATE INDEX idx_call_edges_line_number ON call_edges(caller_function_id, line_number);
CREATE INDEX idx_call_edges_confidence ON call_edges(confidence_score);

-- Performance indexes for graph analysis
CREATE INDEX idx_call_edges_is_async ON call_edges(is_async) WHERE is_async = TRUE;
CREATE INDEX idx_call_edges_external ON call_edges(call_type) WHERE call_type = 'external';
CREATE INDEX idx_call_edges_context ON call_edges(call_context);

-- -----------------------------------------------------------------------------
-- Internal Call Edges: Intra-file function call tracking for safe-delete analysis
-- -----------------------------------------------------------------------------
CREATE TABLE internal_call_edges (
  id TEXT PRIMARY KEY,                          -- Edge ID (UUID)
  snapshot_id TEXT NOT NULL,                    -- Snapshot this edge belongs to
  file_path TEXT NOT NULL,                      -- Source file path (relative to project root)
  caller_function_id TEXT NOT NULL,             -- Physical ID of calling function
  callee_function_id TEXT NOT NULL,             -- Physical ID of called function (within same file)
  caller_name TEXT NOT NULL,                    -- Calling function name
  callee_name TEXT NOT NULL,                    -- Called function name
  caller_class_name TEXT,                        -- Class name for caller if it's a method/constructor
  callee_class_name TEXT,                        -- Class name for callee if it's a method/constructor
  line_number INTEGER NOT NULL,                 -- Line where call occurs
  column_number INTEGER DEFAULT 0,              -- Column position
  call_type TEXT NOT NULL DEFAULT 'direct',     -- Call type: 'direct', 'conditional', 'async', 'dynamic'
  call_context TEXT,                            -- Context: 'normal', 'conditional', 'loop', 'try', 'catch'
  confidence_score REAL DEFAULT 1.0,           -- Analysis confidence (0-1)
  detected_by TEXT NOT NULL DEFAULT 'ast',     -- Detection method: 'ast', 'ideal_call_graph'
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (caller_function_id) REFERENCES functions(id) ON DELETE CASCADE,
  FOREIGN KEY (callee_function_id) REFERENCES functions(id) ON DELETE CASCADE
);

-- Indexes optimized for safe-delete internal function protection
CREATE INDEX idx_internal_call_edges_snapshot ON internal_call_edges(snapshot_id);
CREATE INDEX idx_internal_call_edges_file_path ON internal_call_edges(file_path);
CREATE INDEX idx_internal_call_edges_caller ON internal_call_edges(caller_function_id);
CREATE INDEX idx_internal_call_edges_callee ON internal_call_edges(callee_function_id);
CREATE INDEX idx_internal_call_edges_file_caller ON internal_call_edges(file_path, caller_function_id);
CREATE INDEX idx_internal_call_edges_file_callee ON internal_call_edges(file_path, callee_function_id);
CREATE INDEX idx_internal_call_edges_snapshot_file ON internal_call_edges(snapshot_id, file_path);
CREATE INDEX idx_internal_call_edges_confidence ON internal_call_edges(confidence_score);
CREATE INDEX idx_internal_call_edges_detected_by ON internal_call_edges(detected_by);


-- -----------------------------------------------------------------------------
-- Naming Evaluations: Function naming quality assessment
-- -----------------------------------------------------------------------------
CREATE TABLE naming_evaluations (
  function_id TEXT PRIMARY KEY,
  clarity_score REAL NOT NULL CHECK (clarity_score >= 0 AND clarity_score <= 10),
  consistency_score REAL NOT NULL CHECK (consistency_score >= 0 AND consistency_score <= 10),
  descriptiveness_score REAL NOT NULL CHECK (descriptiveness_score >= 0 AND descriptiveness_score <= 10),
  overall_score REAL NOT NULL CHECK (overall_score >= 0 AND overall_score <= 10),
  suggestions JSONB DEFAULT '[]',
  revision_needed BOOLEAN DEFAULT FALSE,
  evaluated_by TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

CREATE INDEX idx_naming_evaluations_overall_score ON naming_evaluations(overall_score);
CREATE INDEX idx_naming_evaluations_evaluated_by ON naming_evaluations(evaluated_by);
CREATE INDEX idx_naming_evaluations_revision_needed ON naming_evaluations(revision_needed) WHERE revision_needed = TRUE;
CREATE INDEX idx_naming_evaluations_evaluated_at ON naming_evaluations(evaluated_at);





-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Auto-update triggers for updated_at columns
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER update_naming_evaluations_updated_at BEFORE UPDATE ON naming_evaluations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_function_descriptions_updated_at BEFORE UPDATE ON function_descriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();



CREATE TRIGGER update_function_documentation_updated_at BEFORE UPDATE ON function_documentation
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------------------------
-- Content change detection trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_function_for_review()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM function_descriptions WHERE semantic_id = NEW.semantic_id) THEN
        UPDATE function_descriptions 
        SET needs_review = TRUE 
        WHERE semantic_id = NEW.semantic_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER function_content_change_detection
    AFTER UPDATE ON functions
    FOR EACH ROW
    WHEN (OLD.content_id IS DISTINCT FROM NEW.content_id)
    EXECUTE FUNCTION mark_function_for_review();


-- =============================================================================
-- TYPE SYSTEM TABLES (Unified type information storage)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Type Definitions: All type declarations (class, interface, type alias, enum)
-- -----------------------------------------------------------------------------
CREATE TABLE type_definitions (
  id TEXT PRIMARY KEY,                          -- UUID
  snapshot_id TEXT NOT NULL,                    -- Snapshot this definition belongs to
  name TEXT NOT NULL,                           -- Type name
  kind TEXT NOT NULL CHECK (kind IN (          -- Kind of type definition
    'class', 'interface', 'type_alias', 'enum', 'namespace'
  )),
  file_path TEXT NOT NULL,                      -- Source file path
  start_line INTEGER NOT NULL,                  -- Start line in file
  end_line INTEGER NOT NULL,                    -- End line in file
  start_column INTEGER NOT NULL DEFAULT 0,      -- Start column
  end_column INTEGER NOT NULL DEFAULT 0,        -- End column
  
  -- Type-specific attributes
  is_abstract BOOLEAN DEFAULT FALSE,            -- For classes
  is_exported BOOLEAN DEFAULT FALSE,            -- Export status
  is_default_export BOOLEAN DEFAULT FALSE,      -- Default export
  is_generic BOOLEAN DEFAULT FALSE,             -- Has generic parameters
  generic_parameters JSONB DEFAULT '[]',        -- Generic parameters with constraints
  
  -- Type content
  type_text TEXT,                               -- Original type definition text
  resolved_type JSONB,                          -- Resolved type structure (for type aliases)
  
  -- Metadata
  modifiers JSONB DEFAULT '[]',                 -- ['export', 'declare', 'const', etc.]
  jsdoc TEXT,                                   -- JSDoc comments
  metadata JSONB DEFAULT '{}',                  -- Additional metadata
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  UNIQUE(snapshot_id, file_path, name, start_line)
);

-- Indexes for type definitions
CREATE INDEX idx_type_definitions_snapshot ON type_definitions(snapshot_id);
CREATE INDEX idx_type_definitions_name ON type_definitions(name);
CREATE INDEX idx_type_definitions_kind ON type_definitions(kind);
CREATE INDEX idx_type_definitions_file_path ON type_definitions(file_path);
CREATE INDEX idx_type_definitions_exported ON type_definitions(is_exported) WHERE is_exported = TRUE;

-- Composite indexes for type-aware deletion safety performance
CREATE INDEX idx_type_definitions_snapshot_name ON type_definitions(snapshot_id, name);          -- findTypeByName optimization
CREATE INDEX idx_type_definitions_snapshot_kind ON type_definitions(snapshot_id, kind);          -- kind-based filtering
CREATE INDEX idx_type_definitions_name_kind ON type_definitions(name, kind);                     -- multi-attribute lookups

-- -----------------------------------------------------------------------------
-- Type Relationships: Inheritance, implementation, and type algebra
-- -----------------------------------------------------------------------------
CREATE TABLE type_relationships (
  id TEXT PRIMARY KEY,                          -- UUID
  snapshot_id TEXT NOT NULL,                    -- Snapshot this relationship belongs to
  source_type_id TEXT NOT NULL,                 -- Source type ID
  target_type_id TEXT,                          -- Target type ID (NULL for external/primitive)
  target_name TEXT NOT NULL,                    -- Target type name (for external references)
  relationship_kind TEXT NOT NULL CHECK (       -- Kind of relationship
    relationship_kind IN (
      'extends',           -- Class/Interface inheritance
      'implements',        -- Interface implementation
      'union',            -- Union type member
      'intersection',     -- Intersection type member
      'generic_constraint', -- Generic type constraint
      'type_parameter',   -- Generic type parameter usage
      'references'        -- General type reference
    )
  ),
  
  -- Relationship metadata
  position INTEGER DEFAULT 0,                   -- Order in union/intersection/implements
  is_array BOOLEAN DEFAULT FALSE,              -- Is array type reference
  is_optional BOOLEAN DEFAULT FALSE,           -- Is optional/nullable
  generic_arguments JSONB DEFAULT '[]',         -- Generic type arguments
  confidence_score REAL DEFAULT 1.0,           -- Resolution confidence
  metadata JSONB DEFAULT '{}',                  -- Additional metadata
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (source_type_id) REFERENCES type_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (target_type_id) REFERENCES type_definitions(id) ON DELETE SET NULL
);

-- Indexes for type relationships
CREATE INDEX idx_type_relationships_snapshot ON type_relationships(snapshot_id);
CREATE INDEX idx_type_relationships_source ON type_relationships(source_type_id);
CREATE INDEX idx_type_relationships_target ON type_relationships(target_type_id);
CREATE INDEX idx_type_relationships_kind ON type_relationships(relationship_kind);
CREATE INDEX idx_type_relationships_target_name ON type_relationships(target_name);

-- Composite indexes for interface implementation queries
CREATE INDEX idx_type_relationships_target_kind ON type_relationships(target_type_id, relationship_kind);  -- getImplementingClasses optimization
CREATE INDEX idx_type_relationships_source_kind ON type_relationships(source_type_id, relationship_kind); -- source-based relationship queries
CREATE INDEX idx_type_relationships_snapshot_kind ON type_relationships(snapshot_id, relationship_kind);  -- snapshot-scoped relationship queries

-- Specialized covering index for getImplementingClasses query:
-- SELECT td.* FROM type_definitions td JOIN type_relationships tr ON td.id = tr.source_type_id 
-- WHERE tr.target_type_id = ? AND tr.relationship_kind = 'implements' AND td.kind = 'class'
-- Note: Using standard multi-column index for PGLite compatibility
CREATE INDEX idx_type_definitions_class_covering ON type_definitions(kind, snapshot_id, id, name) WHERE kind = 'class';

-- -----------------------------------------------------------------------------
-- Type Members: Properties and methods of types
-- -----------------------------------------------------------------------------
CREATE TABLE type_members (
  id TEXT PRIMARY KEY,                          -- UUID
  snapshot_id TEXT NOT NULL,                    -- Snapshot this member belongs to
  type_id TEXT NOT NULL,                        -- Parent type ID
  name TEXT NOT NULL,                           -- Member name
  member_kind TEXT NOT NULL CHECK (             -- Kind of member
    member_kind IN (
      'property', 'method', 'getter', 'setter', 
      'constructor', 'index_signature', 'call_signature'
    )
  ),
  
  -- Member details
  type_text TEXT,                               -- Type annotation
  is_optional BOOLEAN DEFAULT FALSE,           -- Optional member
  is_readonly BOOLEAN DEFAULT FALSE,           -- Readonly property
  is_static BOOLEAN DEFAULT FALSE,             -- Static member
  is_abstract BOOLEAN DEFAULT FALSE,           -- Abstract member
  access_modifier TEXT CHECK (                  -- Access level
    access_modifier IN ('public', 'protected', 'private')
  ),
  
  -- Position info
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_column INTEGER NOT NULL DEFAULT 0,
  end_column INTEGER NOT NULL DEFAULT 0,
  
  -- Function linkage (for methods)
  function_id TEXT,                             -- Link to functions table
  
  -- Metadata
  jsdoc TEXT,                                   -- Member-specific JSDoc
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (type_id) REFERENCES type_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE SET NULL,
  
  UNIQUE(snapshot_id, type_id, name, member_kind, start_line)
);

-- Indexes for type members
CREATE INDEX idx_type_members_snapshot ON type_members(snapshot_id);
CREATE INDEX idx_type_members_type ON type_members(type_id);
CREATE INDEX idx_type_members_name ON type_members(name);
CREATE INDEX idx_type_members_kind ON type_members(member_kind);
CREATE INDEX idx_type_members_function ON type_members(function_id);

-- Composite indexes for method resolution and override analysis
CREATE INDEX idx_type_members_type_snapshot ON type_members(type_id, snapshot_id);               -- getTypeMembers optimization
CREATE INDEX idx_type_members_function_snapshot ON type_members(function_id, snapshot_id);       -- function-based lookups
CREATE INDEX idx_type_members_name_kind ON type_members(name, member_kind);                     -- method signature matching
CREATE INDEX idx_type_members_type_name_kind ON type_members(type_id, name, member_kind);       -- specific member lookups

-- Covering index for getTargetMethodSignature queries in signature compatibility analysis
-- Note: Using standard multi-column index for PGLite compatibility
CREATE INDEX idx_type_members_signature_covering ON type_members(id, snapshot_id, type_id, name, member_kind);

-- -----------------------------------------------------------------------------
-- Method Override Tracking: Enhanced with type system integration
-- -----------------------------------------------------------------------------
CREATE TABLE method_overrides (
  id TEXT PRIMARY KEY,                          -- UUID
  snapshot_id TEXT NOT NULL,                    -- Snapshot
  method_member_id TEXT NOT NULL,               -- Type member ID of the method
  source_type_id TEXT NOT NULL,                 -- Type containing the method
  target_member_id TEXT,                        -- Overridden member ID
  target_type_id TEXT,                          -- Type containing overridden method
  override_kind TEXT NOT NULL CHECK (           -- Kind of override
    override_kind IN (
      'override',           -- Class method override
      'implement',          -- Interface implementation
      'abstract_implement', -- Abstract method implementation
      'signature_implement' -- Call/Index signature implementation
    )
  ),
  
  -- Override validation
  is_compatible BOOLEAN DEFAULT TRUE,           -- Type compatibility check
  compatibility_errors JSONB DEFAULT '[]',      -- Type errors if incompatible
  confidence_score REAL DEFAULT 1.0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (method_member_id) REFERENCES type_members(id) ON DELETE CASCADE,
  FOREIGN KEY (source_type_id) REFERENCES type_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (target_member_id) REFERENCES type_members(id) ON DELETE SET NULL,
  FOREIGN KEY (target_type_id) REFERENCES type_definitions(id) ON DELETE SET NULL
);

-- Indexes for method overrides
CREATE INDEX idx_method_overrides_v2_snapshot ON method_overrides(snapshot_id);
CREATE INDEX idx_method_overrides_v2_method ON method_overrides(method_member_id);
CREATE INDEX idx_method_overrides_v2_source ON method_overrides(source_type_id);
CREATE INDEX idx_method_overrides_v2_target ON method_overrides(target_type_id);
CREATE INDEX idx_method_overrides_v2_kind ON method_overrides(override_kind);

-- Composite indexes for deletion safety analysis performance
CREATE INDEX idx_method_overrides_method_snapshot ON method_overrides(method_member_id, snapshot_id); -- getMethodOverridesByFunction join optimization
CREATE INDEX idx_method_overrides_source_kind ON method_overrides(source_type_id, override_kind);     -- type-specific override queries
CREATE INDEX idx_method_overrides_target_kind ON method_overrides(target_type_id, override_kind);     -- interface implementation queries
CREATE INDEX idx_method_overrides_snapshot_kind ON method_overrides(snapshot_id, override_kind);      -- snapshot-scoped override analysis

-- Critical JOIN optimization: method_overrides ⋈ type_members on function_id
-- This index enables efficient lookups for getMethodOverridesByFunction queries
CREATE INDEX idx_type_members_function_join ON type_members(function_id) WHERE function_id IS NOT NULL;
CREATE INDEX idx_method_overrides_member_join ON method_overrides(method_member_id);

-- Covering index for the most critical type-aware deletion safety query:
-- SELECT * FROM method_overrides mo JOIN type_members tm ON mo.method_member_id = tm.id WHERE tm.function_id = ?
-- Note: Using standard multi-column index instead of INCLUDE for PGLite compatibility
CREATE INDEX idx_method_overrides_covering ON method_overrides(method_member_id, snapshot_id, override_kind, source_type_id, target_member_id, target_type_id);

-- -----------------------------------------------------------------------------
-- Parameter Property Usage: Coupling analysis data
-- -----------------------------------------------------------------------------
CREATE TABLE parameter_property_usage (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id TEXT NOT NULL,                    -- Snapshot reference
  function_id TEXT NOT NULL,                    -- Function using the parameter
  parameter_name TEXT NOT NULL,                 -- Parameter name
  parameter_type_id TEXT,                       -- Type ID if resolvable
  accessed_property TEXT NOT NULL,              -- Property that was accessed
  access_type TEXT NOT NULL CHECK (             -- Type of access
    access_type IN ('read', 'write', 'modify', 'pass')
  ),
  access_line INTEGER NOT NULL,                 -- Line where access occurs
  access_context TEXT,                          -- Context: 'assignment', 'function_call', etc.
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE,
  FOREIGN KEY (parameter_type_id) REFERENCES type_definitions(id) ON DELETE SET NULL
);

-- Indexes for coupling analysis performance
CREATE INDEX idx_parameter_property_usage_snapshot ON parameter_property_usage(snapshot_id);
CREATE INDEX idx_parameter_property_usage_function ON parameter_property_usage(function_id);
CREATE INDEX idx_parameter_property_usage_type ON parameter_property_usage(parameter_type_id);
CREATE INDEX idx_parameter_property_usage_param_name ON parameter_property_usage(parameter_name);
CREATE INDEX idx_parameter_property_usage_access_type ON parameter_property_usage(access_type);

-- Composite index for coupling analysis queries
CREATE INDEX idx_parameter_property_usage_analysis ON parameter_property_usage(
  function_id, parameter_name, parameter_type_id
);

-- =============================================================================
-- END OF SCHEMA DEFINITION
-- =============================================================================