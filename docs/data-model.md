# funcqc データモデル詳細仕様

## データベーススキーマ設計

### 1. スナップショット管理

```sql
-- メインのスナップショットテーブル
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,                    -- UUID v4 または "snap_" + timestamp
  created_at INTEGER NOT NULL,           -- Unix timestamp
  label TEXT,                            -- ユーザー定義ラベル
  git_commit TEXT,                       -- Git commit hash
  git_branch TEXT,                       -- Git branch name
  git_tag TEXT,                          -- Git tag (if any)
  project_root TEXT NOT NULL,            -- プロジェクトルートパス
  config_hash TEXT NOT NULL,             -- 設定ファイルのハッシュ
  stats_total_functions INTEGER DEFAULT 0,
  stats_total_files INTEGER DEFAULT 0,
  stats_avg_complexity REAL DEFAULT 0,
  metadata JSONB                          -- JSON形式の追加情報
);

-- スナップショット統計情報（非正規化による高速化）
CREATE TABLE snapshot_stats (
  snapshot_id TEXT PRIMARY KEY,
  total_functions INTEGER NOT NULL,
  total_files INTEGER NOT NULL,
  total_lines INTEGER NOT NULL,
  avg_complexity REAL NOT NULL,
  max_complexity INTEGER NOT NULL,
  exported_functions INTEGER NOT NULL,
  async_functions INTEGER NOT NULL,
  complexity_distribution JSONB,          -- JSON: {1: 10, 2: 15, ...}
  file_extensions JSONB,                  -- JSON: {".ts": 50, ".tsx": 10}
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE INDEX idx_snapshots_created_at ON snapshots(created_at);
CREATE INDEX idx_snapshots_label ON snapshots(label);
CREATE INDEX idx_snapshots_git_commit ON snapshots(git_commit);
```

### 2. 関数情報

```sql
-- 関数の基本情報
CREATE TABLE functions (
  id TEXT PRIMARY KEY,                   -- 関数固有ID（AST + signature ベース）
  snapshot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,           -- 表示用名前（クラス.メソッド等）
  signature TEXT NOT NULL,              -- 完全なシグネチャ
  signature_hash TEXT NOT NULL,         -- シグネチャのハッシュ（変更検出用）
  file_path TEXT NOT NULL,              -- プロジェクトルートからの相対パス
  file_hash TEXT NOT NULL,              -- ファイル内容のハッシュ
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  ast_hash TEXT NOT NULL,               -- AST構造のハッシュ
  is_exported BOOLEAN DEFAULT FALSE,
  is_async BOOLEAN DEFAULT FALSE,
  is_generator BOOLEAN DEFAULT FALSE,
  is_arrow_function BOOLEAN DEFAULT FALSE,
  is_method BOOLEAN DEFAULT FALSE,
  is_constructor BOOLEAN DEFAULT FALSE,
  is_static BOOLEAN DEFAULT FALSE,
  access_modifier TEXT,                 -- 'public' | 'private' | 'protected' | null
  parent_class TEXT,                    -- 所属クラス名（メソッドの場合）
  parent_namespace TEXT,                -- 所属名前空間
  js_doc TEXT,                          -- JSDocコメント
  source_code TEXT,                     -- 関数のソースコード（オプション）
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

-- パラメータ情報
CREATE TABLE function_parameters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                   -- TypeScript型表現
  type_simple TEXT,                     -- 簡略型（string, number等）
  position INTEGER NOT NULL,            -- 0ベースの位置
  is_optional BOOLEAN DEFAULT FALSE,
  is_rest BOOLEAN DEFAULT FALSE,        -- ...rest パラメータ
  default_value TEXT,                   -- デフォルト値（あれば）
  description TEXT,                     -- JSDocからの説明
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

-- 戻り値情報
CREATE TABLE function_returns (
  function_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                   -- TypeScript型表現
  type_simple TEXT,                     -- 簡略型
  is_promise BOOLEAN DEFAULT FALSE,     -- Promise型かどうか
  promise_type TEXT,                    -- Promise<T>のT部分
  description TEXT,                     -- JSDocからの説明
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

-- インデックス
CREATE INDEX idx_functions_snapshot ON functions(snapshot_id);
CREATE INDEX idx_functions_name ON functions(name);
CREATE INDEX idx_functions_file ON functions(file_path);
CREATE INDEX idx_functions_ast_hash ON functions(ast_hash);
CREATE INDEX idx_functions_signature_hash ON functions(signature_hash);
CREATE INDEX idx_functions_exported ON functions(is_exported) WHERE is_exported = TRUE;
CREATE INDEX idx_functions_async ON functions(is_async) WHERE is_async = TRUE;
CREATE INDEX idx_function_parameters_function ON function_parameters(function_id);
```

### 3. 品質指標

```sql
-- 品質メトリクス
CREATE TABLE quality_metrics (
  function_id TEXT PRIMARY KEY,
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

-- 依存関係情報
CREATE TABLE function_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id TEXT NOT NULL,
  dependency_type TEXT NOT NULL,        -- 'import' | 'call' | 'inherit'
  target_name TEXT NOT NULL,            -- 依存先の名前
  target_file TEXT,                     -- 依存先ファイル（分かれば）
  target_module TEXT,                   -- 依存先モジュール名
  is_external BOOLEAN DEFAULT FALSE,    -- 外部モジュールかどうか
  usage_count INTEGER DEFAULT 1,       -- 使用回数
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

CREATE INDEX idx_quality_metrics_complexity ON quality_metrics(cyclomatic_complexity);
CREATE INDEX idx_quality_metrics_lines ON quality_metrics(lines_of_code);
CREATE INDEX idx_function_dependencies_function ON function_dependencies(function_id);
CREATE INDEX idx_function_dependencies_target ON function_dependencies(target_name);
```

### 4. AI解析データ（将来実装）

```sql
-- AI解析結果
CREATE TABLE ai_analysis (
  function_id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,             -- 使用したAIモデル
  model_version TEXT NOT NULL,          -- モデルバージョン
  analyzed_at INTEGER NOT NULL,         -- 解析時刻
  function_summary TEXT,                -- 関数の要約
  purpose_description TEXT,             -- 目的・用途の説明
  input_description TEXT,               -- 入力の説明
  output_description TEXT,              -- 出力の説明
  side_effects TEXT,                    -- 副作用の説明
  complexity_reason TEXT,               -- 複雑な理由の説明
  improvement_suggestions JSONB,         -- 改善提案（JSON配列）
  semantic_tags JSONB,                   -- 意味的タグ（JSON配列）
  confidence_score REAL DEFAULT 0,     -- 分析の信頼度
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

-- 意味ベクトル（ベクトル検索用）
CREATE TABLE semantic_vectors (
  function_id TEXT PRIMARY KEY,
  vector_model TEXT NOT NULL,           -- ベクトルモデル名
  vector_dimension INTEGER NOT NULL,    -- ベクトル次元数
  vector_data vector(1536),             -- PGLite pgvector型
  normalized BOOLEAN DEFAULT TRUE,      -- 正規化済みかどうか
  created_at INTEGER NOT NULL,
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

-- 類似性マッピング
CREATE TABLE function_similarities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id_1 TEXT NOT NULL,
  function_id_2 TEXT NOT NULL,
  similarity_type TEXT NOT NULL,        -- 'semantic' | 'structural' | 'behavioral'
  similarity_score REAL NOT NULL,      -- 0.0 - 1.0
  comparison_method TEXT NOT NULL,      -- 比較手法
  calculated_at INTEGER NOT NULL,
  FOREIGN KEY (function_id_1) REFERENCES functions(id) ON DELETE CASCADE,
  FOREIGN KEY (function_id_2) REFERENCES functions(id) ON DELETE CASCADE,
  UNIQUE(function_id_1, function_id_2, similarity_type)
);

CREATE INDEX idx_ai_analysis_model ON ai_analysis(model_name, model_version);
CREATE INDEX idx_semantic_vectors_model ON semantic_vectors(vector_model);
CREATE INDEX idx_similarities_score ON function_similarities(similarity_score DESC);

-- ベクトル検索用インデックス
CREATE INDEX idx_semantic_vectors_hnsw 
  ON semantic_vectors 
  USING hnsw (vector_data vector_cosine_ops);
```

### 5. テスト連携（オプション）

```sql
-- テスト情報
CREATE TABLE test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id TEXT NOT NULL,
  test_file TEXT NOT NULL,              -- テストファイルパス
  test_name TEXT NOT NULL,              -- テスト名
  test_type TEXT NOT NULL,              -- 'unit' | 'integration' | 'e2e'
  status TEXT NOT NULL,                 -- 'pass' | 'fail' | 'skip'
  execution_time_ms REAL,               -- 実行時間（ミリ秒）
  coverage_line_percent REAL,          -- 行カバレッジ
  coverage_branch_percent REAL,        -- 分岐カバレッジ
  assertions_count INTEGER,            -- アサーション数
  error_message TEXT,                  -- エラーメッセージ（失敗時）
  executed_at INTEGER NOT NULL,
  FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
);

CREATE INDEX idx_test_results_function ON test_results(function_id);
CREATE INDEX idx_test_results_status ON test_results(status);
```

## データアクセス層設計

### 1. リポジトリパターン

```typescript
// 基本リポジトリインターフェース
interface Repository<T, K = string> {
  findById(id: K): Promise<T | null>;
  findAll(filters?: QueryFilter[]): Promise<T[]>;
  save(entity: T): Promise<K>;
  update(id: K, entity: Partial<T>): Promise<boolean>;
  delete(id: K): Promise<boolean>;
  count(filters?: QueryFilter[]): Promise<number>;
}

// 関数リポジトリ
interface FunctionRepository extends Repository<FunctionInfo> {
  findBySnapshot(snapshotId: string): Promise<FunctionInfo[]>;
  findByName(pattern: string): Promise<FunctionInfo[]>;
  findByFile(pathPattern: string): Promise<FunctionInfo[]>;
  findByComplexity(min?: number, max?: number): Promise<FunctionInfo[]>;
  findSimilar(functionId: string, threshold: number): Promise<FunctionInfo[]>;
  findDuplicates(options: DuplicateOptions): Promise<FunctionInfo[][]>;
}

// スナップショットリポジトリ
interface SnapshotRepository extends Repository<SnapshotInfo> {
  findLatest(): Promise<SnapshotInfo | null>;
  findByLabel(label: string): Promise<SnapshotInfo | null>;
  findByGitCommit(commit: string): Promise<SnapshotInfo | null>;
  findBetween(from: Date, to: Date): Promise<SnapshotInfo[]>;
  getStatistics(snapshotId: string): Promise<SnapshotStats>;
}
```

### 2. クエリビルダー

```typescript
class FunctionQueryBuilder {
  private filters: QueryFilter[] = [];

  name(pattern: string): this {
    this.filters.push({ field: 'name', operator: 'LIKE', value: `%${pattern}%` });
    return this;
  }

  file(pattern: string): this {
    this.filters.push({ field: 'file_path', operator: 'LIKE', value: `%${pattern}%` });
    return this;
  }

  complexity(min?: number, max?: number): this {
    if (min !== undefined) {
      this.filters.push({ field: 'cyclomatic_complexity', operator: '>=', value: min });
    }
    if (max !== undefined) {
      this.filters.push({ field: 'cyclomatic_complexity', operator: '<=', value: max });
    }
    return this;
  }

  exported(value: boolean = true): this {
    this.filters.push({ field: 'is_exported', operator: '=', value });
    return this;
  }

  async(value: boolean = true): this {
    this.filters.push({ field: 'is_async', operator: '=', value });
    return this;
  }

  lines(min?: number, max?: number): this {
    if (min !== undefined) {
      this.filters.push({ field: 'lines_of_code', operator: '>=', value: min });
    }
    if (max !== undefined) {
      this.filters.push({ field: 'lines_of_code', operator: '<=', value: max });
    }
    return this;
  }

  build(): QueryFilter[] {
    return this.filters;
  }
}

// 使用例
const functions = await functionRepo.findAll(
  new FunctionQueryBuilder()
    .name('fetch')
    .complexity(3, 10)
    .exported()
    .build()
);
```

### 3. 差分計算アルゴリズム

```typescript
interface SnapshotDiff {
  from: SnapshotInfo;
  to: SnapshotInfo;
  added: FunctionInfo[];           // 新規追加
  removed: FunctionInfo[];         // 削除
  modified: FunctionChange[];      // 変更
  unchanged: FunctionInfo[];       // 不変
  statistics: DiffStatistics;
}

interface FunctionChange {
  before: FunctionInfo;
  after: FunctionInfo;
  changes: ChangeDetail[];
}

interface ChangeDetail {
  field: string;
  oldValue: any;
  newValue: any;
  impact: 'low' | 'medium' | 'high';
}

class SnapshotDiffer {
  async diff(fromId: string, toId: string): Promise<SnapshotDiff> {
    const [fromFunctions, toFunctions] = await Promise.all([
      this.functionRepo.findBySnapshot(fromId),
      this.functionRepo.findBySnapshot(toId)
    ]);

    // AST ハッシュベースでマッチング
    const fromMap = new Map(fromFunctions.map(f => [f.astHash, f]));
    const toMap = new Map(toFunctions.map(f => [f.astHash, f]));

    const added = toFunctions.filter(f => !fromMap.has(f.astHash));
    const removed = fromFunctions.filter(f => !toMap.has(f.astHash));
    
    // シグネチャハッシュで変更検出
    const modified = this.findModifications(fromFunctions, toFunctions);
    const unchanged = toFunctions.filter(f => 
      fromMap.has(f.astHash) && fromMap.get(f.astHash)?.signatureHash === f.signatureHash
    );

    return {
      from: await this.snapshotRepo.findById(fromId),
      to: await this.snapshotRepo.findById(toId),
      added,
      removed,
      modified,
      unchanged,
      statistics: this.calculateDiffStats(added, removed, modified)
    };
  }

  private findModifications(
    fromFunctions: FunctionInfo[], 
    toFunctions: FunctionInfo[]
  ): FunctionChange[] {
    const changes: FunctionChange[] = [];
    
    for (const toFunc of toFunctions) {
      const fromFunc = fromFunctions.find(f => 
        f.name === toFunc.name && 
        f.filePath === toFunc.filePath &&
        f.astHash !== toFunc.astHash
      );
      
      if (fromFunc) {
        const changeDetails = this.analyzeChanges(fromFunc, toFunc);
        if (changeDetails.length > 0) {
          changes.push({
            before: fromFunc,
            after: toFunc,
            changes: changeDetails
          });
        }
      }
    }
    
    return changes;
  }
}
```

### 4. パフォーマンス最適化

```typescript
// バッチ処理でのメモリ効率化
class BatchProcessor<T> {
  constructor(
    private batchSize: number = 100,
    private processor: (batch: T[]) => Promise<void>
  ) {}

  async process(items: T[]): Promise<void> {
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      await this.processor(batch);
      
      // メモリ圧迫を避けるため適度にGCを実行
      if (i % (this.batchSize * 10) === 0) {
        global.gc?.();
      }
    }
  }
}

// インクリメンタル更新
class IncrementalAnalyzer {
  async analyzeChangedFiles(
    changedFiles: string[],
    lastSnapshotId: string
  ): Promise<FunctionInfo[]> {
    const lastSnapshot = await this.snapshotRepo.findById(lastSnapshotId);
    const lastFunctions = await this.functionRepo.findBySnapshot(lastSnapshotId);
    
    // 変更ファイルのみ再解析
    const newFunctions: FunctionInfo[] = [];
    
    for (const file of changedFiles) {
      const fileFunctions = await this.analyzeFile(file);
      newFunctions.push(...fileFunctions);
      
      // 古い関数情報を削除
      const oldFileFunctions = lastFunctions.filter(f => f.filePath === file);
      for (const oldFunc of oldFileFunctions) {
        await this.functionRepo.delete(oldFunc.id);
      }
    }
    
    return newFunctions;
  }
}
```

## データマイグレーション戦略

### 1. スキーマバージョン管理

```typescript
interface Migration {
  version: number;
  description: string;
  up: (db: Database) => Promise<void>;
  down: (db: Database) => Promise<void>;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema',
    up: async (db) => {
      // 初期テーブル作成
    },
    down: async (db) => {
      // ロールバック処理
    }
  },
  {
    version: 2,
    description: 'Add AI analysis tables',
    up: async (db) => {
      // AI関連テーブル追加
    },
    down: async (db) => {
      // AI関連テーブル削除
    }
  }
];
```

### 2. データ整合性チェック

```sql
-- 整合性チェッククエリ
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

-- 3. 重複したAST ハッシュ（同一スナップショット内）
SELECT ast_hash, COUNT(*) 
FROM functions 
WHERE snapshot_id = ? 
GROUP BY ast_hash 
HAVING COUNT(*) > 1;
```
