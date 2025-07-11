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
-- Level 1: snapshots, refactoring_sessions (independent base tables)
-- Level 2: functions, function_descriptions (core entities)
-- Level 3: function_parameters, quality_metrics, function_embeddings, 
--          naming_evaluations, session_functions, refactoring_opportunities
-- Level 4: lineages, ann_index_metadata (independent)
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
  metadata JSONB DEFAULT '{}'            -- JSON形式の追加情報
);

CREATE INDEX idx_snapshots_created_at ON snapshots(created_at);
CREATE INDEX idx_snapshots_git_commit ON snapshots(git_commit);
CREATE INDEX idx_snapshots_git_branch ON snapshots(git_branch);

-- -----------------------------------------------------------------------------
-- Refactoring Sessions: Workflow management
-- -----------------------------------------------------------------------------
CREATE TABLE refactoring_sessions (
  id TEXT PRIMARY KEY,                                                      -- セッションID
  description TEXT NOT NULL,                                                -- セッション説明
  start_time TIMESTAMPTZ NOT NULL,                                          -- 開始時刻
  end_time TIMESTAMPTZ,                                                     -- 終了時刻
  git_branch TEXT,                                                          -- 作業ブランチ
  initial_commit TEXT,                                                      -- 開始時commit
  final_commit TEXT,                                                        -- 終了時commit
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')) DEFAULT 'active', -- セッション状態
  metadata JSONB DEFAULT '{}',                                              -- 追加メタデータ
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,                        -- 作成日時
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP                         -- 更新日時
);

CREATE INDEX idx_refactoring_sessions_status ON refactoring_sessions(status);
CREATE INDEX idx_refactoring_sessions_git_branch ON refactoring_sessions(git_branch);
CREATE INDEX idx_refactoring_sessions_start_time ON refactoring_sessions(start_time);
CREATE INDEX idx_refactoring_sessions_created_at ON refactoring_sessions(created_at);

-- =============================================================================
-- LEVEL 2: CORE ENTITIES
-- =============================================================================

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
  
  -- ドキュメント（将来は別テーブルに移動予定）
  js_doc TEXT,                          -- JSDocコメント
  
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
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

-- 重複検出用インデックス
CREATE INDEX idx_content_duplication ON functions(content_id, snapshot_id);

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
  id SERIAL PRIMARY KEY,
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

-- -----------------------------------------------------------------------------
-- Session Functions: Functions tracked within refactoring sessions
-- -----------------------------------------------------------------------------
CREATE TABLE session_functions (
  session_id TEXT NOT NULL,                                                 -- セッションID参照
  function_id TEXT NOT NULL,                                                -- 関数ID参照
  tracked_at TIMESTAMPTZ NOT NULL,                                          -- 追跡開始時刻
  role TEXT NOT NULL CHECK (role IN ('source', 'target', 'intermediate')) DEFAULT 'source', -- 関数の役割
  metadata JSONB DEFAULT '{}',                                              -- 追加メタデータ
  PRIMARY KEY (session_id, function_id),
  FOREIGN KEY (session_id) REFERENCES refactoring_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_functions_session_id ON session_functions(session_id);
CREATE INDEX idx_session_functions_function_id ON session_functions(function_id);
CREATE INDEX idx_session_functions_role ON session_functions(role);

-- -----------------------------------------------------------------------------
-- Refactoring Opportunities: Automated improvement detection
-- -----------------------------------------------------------------------------
CREATE TABLE refactoring_opportunities (
  id TEXT PRIMARY KEY,                                                      -- 機会ID
  pattern TEXT NOT NULL CHECK (pattern IN ('extract-method', 'split-function', 'reduce-parameters', 'extract-class', 'inline-function', 'rename-function')), -- パターン種別
  function_id TEXT NOT NULL,                                                -- 対象関数ID
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium', -- 深刻度
  impact_score INTEGER NOT NULL CHECK (impact_score >= 0 AND impact_score <= 100), -- 影響度スコア
  detected_at TIMESTAMPTZ NOT NULL,                                         -- 検出時刻
  resolved_at TIMESTAMPTZ,                                                  -- 解決時刻
  session_id TEXT,                                                          -- 関連セッション
  metadata JSONB DEFAULT '{}',                                              -- 検出詳細
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,                        -- 作成日時
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,                        -- 更新日時
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES refactoring_sessions(id) ON DELETE SET NULL
);

CREATE INDEX idx_refactoring_opportunities_pattern ON refactoring_opportunities(pattern);
CREATE INDEX idx_refactoring_opportunities_severity ON refactoring_opportunities(severity);
CREATE INDEX idx_refactoring_opportunities_function_id ON refactoring_opportunities(function_id);
CREATE INDEX idx_refactoring_opportunities_resolved ON refactoring_opportunities(resolved_at) WHERE resolved_at IS NULL;

-- =============================================================================
-- LEVEL 4: INDEPENDENT TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lineages: Function evolution tracking
-- -----------------------------------------------------------------------------
CREATE TABLE lineages (
  -- 基本識別情報
  id TEXT PRIMARY KEY,                          -- 系譜ID (UUID)
  
  -- 関数関係マッピング
  from_ids TEXT[] NOT NULL,                     -- 変更前関数IDの配列
  to_ids TEXT[] NOT NULL,                       -- 変更後関数IDの配列
  
  -- 変更分類
  kind TEXT NOT NULL CHECK (
    kind IN ('rename', 'signature-change', 'inline', 'split')
  ),                                            -- 変更種別
  
  -- レビューワークフロー
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'approved', 'rejected')
  ),                                            -- レビュー状態
  confidence REAL CHECK (
    confidence >= 0.0 AND confidence <= 1.0
  ),                                            -- 信頼度（0.0-1.0）
  note TEXT,                                    -- 人間による注記
  
  -- Git統合
  git_commit TEXT NOT NULL,                     -- 関連Git commit hash
  
  -- タイムスタンプ
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,  -- 作成日時
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP   -- 更新日時
);

-- Performance indexes
CREATE INDEX idx_lineages_status ON lineages(status);
CREATE INDEX idx_lineages_kind ON lineages(kind);
CREATE INDEX idx_lineages_confidence ON lineages(confidence);
CREATE INDEX idx_lineages_git_commit ON lineages(git_commit);
CREATE INDEX idx_lineages_created_at ON lineages(created_at);
CREATE INDEX idx_lineages_updated_at ON lineages(updated_at);

-- Array operation GIN indexes
CREATE INDEX idx_lineages_from_ids ON lineages USING GIN(from_ids);
CREATE INDEX idx_lineages_to_ids ON lineages USING GIN(to_ids);

-- Composite indexes for common query patterns
CREATE INDEX idx_lineages_status_kind ON lineages(status, kind);
CREATE INDEX idx_lineages_status_created_at ON lineages(status, created_at DESC);
CREATE INDEX idx_lineages_kind_created_at ON lineages(kind, created_at DESC);
CREATE INDEX idx_lineages_confidence_created_at ON lineages(confidence DESC, created_at DESC);

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
-- END OF SCHEMA DEFINITION
-- =============================================================================