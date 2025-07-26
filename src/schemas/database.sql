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
-- Level 3: function_parameters, quality_metrics, call_edges, function_embeddings, 
--          naming_evaluations
-- Level 4: ann_index_metadata (independent)
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
  context_path TEXT[],                   -- 階層コンテキスト ['Class', 'method']
  function_type TEXT,                    -- 'function' | 'method' | 'arrow' | 'local'
  modifiers TEXT[],                      -- ['static', 'private', 'async']
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
  name TEXT NOT NULL,
  type TEXT NOT NULL,                    -- TypeScript型表現
  type_simple TEXT NOT NULL,             -- 簡略型（string, number等）
  position INTEGER NOT NULL,             -- 0ベースの位置
  is_optional BOOLEAN DEFAULT FALSE,
  is_rest BOOLEAN DEFAULT FALSE,         -- ...rest パラメータ
  default_value TEXT,                    -- デフォルト値（あれば）
  description TEXT,                      -- JSDocからの説明
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
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
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
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
-- Function Embeddings: Vector embeddings for similarity search
-- -----------------------------------------------------------------------------
CREATE TABLE function_embeddings (
  function_id TEXT PRIMARY KEY,
  embedding REAL[] NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

CREATE INDEX idx_function_embeddings_model ON function_embeddings(model_name, model_version);
CREATE INDEX idx_function_embeddings_created_at ON function_embeddings(created_at);

-- -----------------------------------------------------------------------------
-- Naming Evaluations: Function naming quality assessment
-- -----------------------------------------------------------------------------
CREATE TABLE naming_evaluations (
  function_id TEXT PRIMARY KEY,
  clarity_score REAL NOT NULL CHECK (clarity_score >= 0 AND clarity_score <= 10),
  consistency_score REAL NOT NULL CHECK (consistency_score >= 0 AND consistency_score <= 10),
  descriptiveness_score REAL NOT NULL CHECK (descriptiveness_score >= 0 AND descriptiveness_score <= 10),
  overall_score REAL NOT NULL CHECK (overall_score >= 0 AND overall_score <= 10),
  suggestions TEXT[],
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
-- LEVEL 4: INDEPENDENT TABLES
-- =============================================================================


-- -----------------------------------------------------------------------------
-- ANN Index Metadata: Vector index management
-- -----------------------------------------------------------------------------
CREATE TABLE ann_index_metadata (
  id TEXT PRIMARY KEY,
  index_type TEXT NOT NULL,
  embedding_dimension INTEGER NOT NULL,
  distance_metric TEXT NOT NULL,
  index_parameters JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_rebuilt_at TIMESTAMPTZ,
  total_vectors INTEGER DEFAULT 0,
  index_size_bytes INTEGER DEFAULT 0
);

CREATE INDEX idx_ann_index_metadata_index_type ON ann_index_metadata(index_type);
CREATE INDEX idx_ann_index_metadata_created_at ON ann_index_metadata(created_at);

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


CREATE TRIGGER update_ann_index_metadata_updated_at BEFORE UPDATE ON ann_index_metadata
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_function_embeddings_updated_at BEFORE UPDATE ON function_embeddings
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
-- END OF SCHEMA DEFINITION
-- =============================================================================