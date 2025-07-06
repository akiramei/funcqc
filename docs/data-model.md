# funcqc データモデル詳細仕様 - 3次元識別システム

## 概要

funcqc は関数の識別において、異なる目的に応じた3つの次元で管理される複合的なシステムを採用しています。
この設計により、関数の物理的位置、意味的役割、実装内容を独立して追跡できます。

## 3次元識別システム

### 1. 物理ベース識別 (Physical Identity)

**目的**: 特定時点・場所での物理的実体の一意識別

**特徴**:
- スナップショット時点での絶対的な一意性
- メトリクス、パラメータ等の物理データとの紐付け基準
- ファイル移動、リファクタリングで変更される
- git commit、スナップショット等の時系列データと連携

**使用例**:
- 品質メトリクスの参照
- 特定時点でのデータ取得
- スナップショット間の物理的変更追跡

### 2. 意味ベース識別 (Semantic Identity)

**目的**: 関数の責務・役割による論理的識別

**特徴**:
- 関数の役割・責務による識別
- ファイル移動に対して安定
- API互換性の追跡
- リファクタリング時の論理的継続性

**構成要素**:
- ファイルパス（論理的所属）
- 関数名とシグネチャ
- 階層コンテキスト（クラス・名前空間）
- 修飾子（static, private等）
- **注意**: 物理的位置（line, column）は含まない

**使用例**:
- 関数の歴史的変遷追跡
- 関数説明の管理基準
- API変更の影響範囲特定

### 3. 内容ベース識別 (Content Identity)

**目的**: 実装内容による具体的識別

**特徴**:
- AST構造とソースコードによる識別
- 1文字でも変わると変化
- 重複コードの発見
- 実装変更の検出

**構成要素**:
- AST構造ハッシュ
- ソースコード内容
- シグネチャハッシュ

**使用例**:
- 重複実装の検出
- 実装変更の通知
- 説明の妥当性確認

## データベーススキーマ設計

### 1. スナップショット管理

```sql
-- メインのスナップショットテーブル
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,                    -- UUID v4 または "snap_" + timestamp
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  label TEXT,                            -- ユーザー定義ラベル
  git_commit TEXT,                       -- Git commit hash
  git_branch TEXT,                       -- Git branch name
  git_tag TEXT,                          -- Git tag (if any)
  project_root TEXT NOT NULL DEFAULT '', -- プロジェクトルートパス
  config_hash TEXT NOT NULL DEFAULT '',  -- 設定ファイルのハッシュ
  metadata TEXT DEFAULT '{}'             -- JSON形式の追加情報
);

CREATE INDEX idx_snapshots_created_at ON snapshots(created_at);
CREATE INDEX idx_snapshots_git_commit ON snapshots(git_commit);
CREATE INDEX idx_snapshots_git_branch ON snapshots(git_branch);
```

### 2. 関数情報テーブル（3次元識別対応）

```sql
-- 関数の基本情報（3次元識別システム）
CREATE TABLE functions (
  -- 物理識別次元
  id TEXT PRIMARY KEY,                   -- Physical UUID（物理的実体の一意識別）
  snapshot_id TEXT NOT NULL,             -- スナップショット参照
  start_line INTEGER NOT NULL,           -- ファイル内開始行
  end_line INTEGER NOT NULL,             -- ファイル内終了行
  start_column INTEGER NOT NULL DEFAULT 0,
  end_column INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
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
```

### 3. パラメータ情報

```sql
-- 関数パラメータ情報
CREATE TABLE function_parameters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
```

### 4. 品質指標

```sql
-- 品質メトリクス（内容ベース）
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
```

### 5. 関数説明管理（意味ベース）

```sql
-- 意味ベース関数説明管理
CREATE TABLE function_descriptions (
  semantic_id TEXT PRIMARY KEY,          -- 意味ベース参照
  description TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'human',  -- 'human' | 'ai' | 'jsdoc'
  validated_for_content_id TEXT,         -- 実装確認済みマーク
  needs_review BOOLEAN DEFAULT FALSE,    -- 実装変更時の確認要求
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
CREATE TRIGGER function_content_change_detection
  AFTER UPDATE ON functions
  FOR EACH ROW
  WHEN OLD.content_id != NEW.content_id
BEGIN
  UPDATE function_descriptions 
  SET needs_review = TRUE 
  WHERE semantic_id = NEW.semantic_id;
END;

CREATE INDEX idx_function_descriptions_source ON function_descriptions(source);
CREATE INDEX idx_function_descriptions_needs_review ON function_descriptions(needs_review) WHERE needs_review = TRUE;
```

## 識別子生成アルゴリズム

### 意味ベースID生成

```typescript
function generateSemanticId(
  filePath: string,
  contextPath: string[],
  name: string,
  signature: string,
  modifiers: string[]
): string {
  const components = [
    filePath,
    ...contextPath,
    name || '<anonymous>',
    signature,
    ...modifiers.sort()
    // 重要: 位置情報（line, column）は除外
  ];
  
  return crypto.createHash('sha256')
    .update(components.join('|'))
    .digest('hex');
}
```

### 内容ベースID生成

```typescript
function generateContentId(
  astHash: string,
  sourceCode: string
): string {
  return crypto.createHash('sha256')
    .update(`${astHash}|${sourceCode}`)
    .digest('hex');
}
```

### 物理ベースID生成

```typescript
function generatePhysicalId(): string {
  return crypto.randomUUID(); // 絶対的に一意なUUID
}
```

## 典型的なクエリパターン

### 1. 最新関数リスト取得

```sql
-- 最新スナップショットの有効関数リスト
SELECT f.*, qm.* 
FROM functions f
LEFT JOIN quality_metrics qm ON f.id = qm.function_id
WHERE f.snapshot_id = (
  SELECT id FROM snapshots 
  ORDER BY created_at DESC 
  LIMIT 1
)
ORDER BY f.file_path, f.start_line;
```

### 2. 意味ベース履歴追跡

```sql
-- 同じ役割の関数の歴史的変遷
SELECT f.*, s.created_at, s.label
FROM functions f
JOIN snapshots s ON f.snapshot_id = s.id
WHERE f.semantic_id = ?
ORDER BY s.created_at ASC;
```

### 3. 内容ベース重複検出

```sql
-- 同一実装の関数検索
SELECT content_id, COUNT(*) as count, 
       array_agg(semantic_id) as semantic_ids,
       array_agg(f.name || ' in ' || f.file_path) as locations
FROM functions f
WHERE f.snapshot_id = ?
GROUP BY content_id 
HAVING COUNT(*) > 1;
```

### 4. 実装変更検出

```sql
-- 説明の確認が必要な関数
SELECT f.semantic_id, f.name, f.file_path, d.description
FROM function_descriptions d
JOIN functions f ON d.semantic_id = f.semantic_id
WHERE d.needs_review = TRUE
AND f.snapshot_id = (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1);
```

### 5. 構造化説明の検索

```sql
-- 使用例が記録されている関数
SELECT f.name, f.file_path, d.description, d.usage_example
FROM function_descriptions d
JOIN functions f ON d.semantic_id = f.semantic_id
WHERE d.usage_example IS NOT NULL
AND f.snapshot_id = (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1);

-- 特定の副作用を持つ関数の検索
SELECT f.name, f.file_path, d.side_effects
FROM function_descriptions d
JOIN functions f ON d.semantic_id = f.semantic_id
WHERE d.side_effects LIKE '%console%'
AND f.snapshot_id = (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1);

-- エラー処理が文書化された関数
SELECT f.name, f.file_path, d.error_conditions
FROM function_descriptions d
JOIN functions f ON d.semantic_id = f.semantic_id
WHERE d.error_conditions IS NOT NULL
AND f.snapshot_id = (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1);
```

## データ整合性と制約

### 整合性チェッククエリ

```sql
-- 1. 孤立した関数レコード
SELECT f.id, f.name 
FROM functions f 
LEFT JOIN snapshots s ON f.snapshot_id = s.id 
WHERE s.id IS NULL;

-- 2. メトリクスがない関数
SELECT f.id, f.name 
FROM functions f 
LEFT JOIN quality_metrics q ON f.id = q.function_id 
WHERE q.function_id IS NULL;

-- 3. semantic_idの重複（同一スナップショット内）
SELECT semantic_id, COUNT(*) 
FROM functions 
WHERE snapshot_id = ? 
GROUP BY semantic_id 
HAVING COUNT(*) > 1;

-- 4. content_idが同じだがsemantic_idが異なる（実装の重複）
SELECT content_id, array_agg(DISTINCT semantic_id) as semantic_ids
FROM functions 
WHERE snapshot_id = ?
GROUP BY content_id 
HAVING COUNT(DISTINCT semantic_id) > 1;
```

## マイグレーション戦略

### 既存データの3次元識別への移行

```sql
-- Step 1: 新しいカラムを追加
ALTER TABLE functions ADD COLUMN semantic_id TEXT;
ALTER TABLE functions ADD COLUMN content_id TEXT;

-- Step 2: 既存データからsemantic_idを生成
-- （位置情報を除外した新しいアルゴリズムで再計算）

-- Step 3: 既存データからcontent_idを生成
-- （ast_hash + source_codeから生成）

-- Step 4: NOT NULL制約を追加
ALTER TABLE functions ALTER COLUMN semantic_id SET NOT NULL;
ALTER TABLE functions ALTER COLUMN content_id SET NOT NULL;

-- Step 5: インデックスを作成
CREATE INDEX idx_functions_semantic_id ON functions(semantic_id);
CREATE INDEX idx_functions_content_id ON functions(content_id);
```

### 構造化説明システムのマイグレーション (v0.1.0)

```sql
-- 構造化説明フィールドの追加（後方互換性を保持）
ALTER TABLE function_descriptions 
ADD COLUMN IF NOT EXISTS usage_example TEXT,
ADD COLUMN IF NOT EXISTS side_effects TEXT,
ADD COLUMN IF NOT EXISTS error_conditions TEXT;

-- 自動実行される安全なマイグレーション
-- - 既存データは変更されない
-- - 新フィールドはNULLABLEで追加
-- - アプリケーション側で自動検出・実行
```

## パフォーマンス最適化

### バッチ処理でのメモリ効率化

```typescript
// ファイル単位でのハッシュ値計算とメモ化
class FileHashCache {
  private cache = new Map<string, string>();
  
  getFileHash(filePath: string, content: string): string {
    const key = `${filePath}:${content.length}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, crypto.createHash('md5').update(content).digest('hex'));
    }
    return this.cache.get(key)!;
  }
}
```

### インクリメンタル更新

```typescript
// 変更ファイルのみの再解析
async function updateChangedFunctions(
  changedFiles: string[],
  latestSnapshotId: string
): Promise<void> {
  for (const filePath of changedFiles) {
    // 1. 該当ファイルの古い関数を削除
    await db.query(
      'DELETE FROM functions WHERE snapshot_id = ? AND file_path = ?',
      [latestSnapshotId, filePath]
    );
    
    // 2. 新しい関数情報を解析・保存
    const newFunctions = await analyzeFile(filePath);
    await saveFunctions(latestSnapshotId, newFunctions);
  }
}
```

## 将来拡張への考慮

### 構造化説明の拡張 (v0.2.0 以降)

```sql
-- 追加の構造化フィールド（将来実装）
ALTER TABLE function_descriptions 
ADD COLUMN IF NOT EXISTS performance_notes TEXT,     -- パフォーマンス特性
ADD COLUMN IF NOT EXISTS security_considerations TEXT, -- セキュリティ考慮事項
ADD COLUMN IF NOT EXISTS dependencies TEXT,          -- 依存関係の説明
ADD COLUMN IF NOT EXISTS testing_notes TEXT,         -- テスト方法・注意点
ADD COLUMN IF NOT EXISTS changelog TEXT;             -- 変更履歴
```

### AI解析データ

```sql
-- AI解析結果（将来実装）
CREATE TABLE ai_analysis (
  semantic_id TEXT PRIMARY KEY,          -- 意味ベース参照
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  analyzed_at TIMESTAMP NOT NULL,
  function_summary TEXT,
  purpose_description TEXT,
  complexity_reason TEXT,
  improvement_suggestions JSONB,
  confidence_score REAL DEFAULT 0,
  FOREIGN KEY (semantic_id) REFERENCES function_descriptions(semantic_id)
);
```

### 類似性検出

```sql
-- 関数類似性マッピング
CREATE TABLE function_similarities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semantic_id_1 TEXT NOT NULL,
  semantic_id_2 TEXT NOT NULL,
  similarity_type TEXT NOT NULL,        -- 'semantic' | 'structural' | 'behavioral'
  similarity_score REAL NOT NULL,      -- 0.0 - 1.0
  comparison_method TEXT NOT NULL,
  calculated_at TIMESTAMP NOT NULL,
  UNIQUE(semantic_id_1, semantic_id_2, similarity_type)
);
```

---

**設計原則**:
1. **分離の原則**: 各識別次元は独立した目的を持つ
2. **安定性の原則**: 意味ベースは物理変更に対して安定
3. **検出可能性**: 内容ベースで実装変更を確実に検出
4. **実用性**: 実際のユースケースに適合した設計

この3次元識別システムにより、関数の物理的管理、論理的追跡、実装監視が統合的に実現されます。