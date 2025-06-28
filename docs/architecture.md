# funcqc 技術アーキテクチャ仕様

## 技術スタック

### コア技術
- **言語**: TypeScript
- **AST解析**: TypeScript Compiler API (`typescript` package)
- **CLI**: Commander.js
- **データストレージ**: 
  - Phase 1: PGLite (better-sqlite3のポータブル代替)
  - Phase 2+: PostgreSQL対応
- **設定管理**: cosmiconfig
- **ファイル監視**: chokidar (将来の watch モード用)

### 外部依存
```json
{
  "dependencies": {
    "typescript": "^5.0.0",
    "commander": "^11.0.0",
    "@electric-sql/pglite": "^0.1.0",
    "kysely": "^0.27.0",
    "cosmiconfig": "^8.0.0",
    "chalk": "^5.0.0",
    "ora": "^7.0.0",
    "table": "^6.8.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
```

## アーキテクチャ構成

### レイヤー構造
```
funcqc/
├── src/
│   ├── cli/           # CLI インターフェース
│   ├── core/          # コアビジネスロジック
│   ├── analyzers/     # コード解析器
│   ├── storage/       # データ永続化
│   ├── metrics/       # 品質指標計算
│   ├── utils/         # ユーティリティ
│   └── types/         # 型定義
```

### 主要モジュール

#### 1. Code Analyzer (`analyzers/`)
```typescript
interface FunctionInfo {
  id: string;
  name: string;
  signature: string;
  filePath: string;
  startLine: number;
  endLine: number;
  astHash: string;
  isExported: boolean;
  isAsync: boolean;
  jsDoc?: string;
  parameters: ParameterInfo[];
}

interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}
```

#### 2. Metrics Calculator (`metrics/`)
```typescript
interface QualityMetrics {
  linesOfCode: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  maxNestingLevel: number;
  parameterCount: number;
  returnComplexity: number;
}
```

#### 3. Storage Layer (`storage/`)
```typescript
interface StorageAdapter {
  init(): Promise<void>;
  saveFunctions(functions: FunctionSnapshot[]): Promise<string>;
  queryFunctions(filters?: QueryFilters): Promise<FunctionInfo[]>;
  getSnapshots(): Promise<SnapshotInfo[]>;
  getSnapshot(id: string): Promise<FunctionSnapshot>;
  diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff>;
}
```

## データモデル最適化

### 1. 正規化されたスキーマ
```sql
-- スナップショット（収集単位）
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  git_commit TEXT,
  git_branch TEXT,
  label TEXT,
  metadata JSONB -- JSON形式の追加情報
);

-- 関数情報
CREATE TABLE functions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  signature TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  ast_hash TEXT NOT NULL,
  is_exported BOOLEAN DEFAULT FALSE,
  is_async BOOLEAN DEFAULT FALSE,
  js_doc TEXT,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
);

-- パラメータ
CREATE TABLE function_parameters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  optional BOOLEAN DEFAULT FALSE,
  description TEXT,
  FOREIGN KEY (function_id) REFERENCES functions(id)
);

-- 品質指標
CREATE TABLE quality_metrics (
  function_id TEXT PRIMARY KEY,
  lines_of_code INTEGER NOT NULL,
  cyclomatic_complexity INTEGER NOT NULL,
  cognitive_complexity INTEGER NOT NULL,
  max_nesting_level INTEGER NOT NULL,
  parameter_count INTEGER NOT NULL,
  return_complexity INTEGER NOT NULL,
  FOREIGN KEY (function_id) REFERENCES functions(id)
);
```

### 2. インデックス戦略
```sql
CREATE INDEX idx_functions_snapshot ON functions(snapshot_id);
CREATE INDEX idx_functions_name ON functions(name);
CREATE INDEX idx_functions_file ON functions(file_path);
CREATE INDEX idx_functions_ast_hash ON functions(ast_hash);
CREATE INDEX idx_snapshots_timestamp ON snapshots(timestamp);
```

## 設定システム

### 設定ファイル (.funcqc.config.js)
```typescript
interface FuncqcConfig {
  // 基本設定
  roots: string[];
  exclude: string[];
  include?: string[];
  
  // TypeScript設定
  tsconfig?: string;
  
  // ストレージ設定
  storage: {
    type: 'pglite' | 'postgres';
    path?: string; // PGLite用
    url?: string;  // PostgreSQL用
  };
  
  // メトリクス設定
  metrics: {
    complexityThreshold: number;
    linesOfCodeThreshold: number;
    parameterCountThreshold: number;
  };
  
  // Git連携
  git: {
    enabled: boolean;
    autoLabel: boolean;
  };
}
```

## CLI設計最適化

### コマンド体系
```bash
# 初期化
funcqc init [options]

# 収集・保存（一体化）
funcqc scan [options]

# クエリ
funcqc list [filters...] [options]

# 履歴管理
funcqc history [options]
funcqc diff <from> <to> [options]

# メンテナンス
funcqc clean [options]
funcqc export [options]
funcqc import <file> [options]

# 将来の機能
funcqc suggest [type] [options]
funcqc watch [options]
```

### 出力形式統一
```typescript
interface OutputOptions {
  format: 'table' | 'json' | 'csv';
  fields?: string[];
  sort?: string;
  limit?: number;
}
```

## エラーハンドリング戦略

### 1. 段階的エラー処理
```typescript
class FuncqcError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
  }
}

// 使用例
throw new FuncqcError(
  'Failed to parse TypeScript file',
  'PARSE_ERROR',
  { filePath, line, column }
);
```

### 2. 部分的失敗への対応
- ファイル単位での処理継続
- エラーファイルのスキップと報告
- リトライ機構

## パフォーマンス考慮

### 1. 並列処理
```typescript
// ファイルの並列解析
const results = await Promise.allSettled(
  files.map(file => analyzeFile(file))
);
```

### 2. インクリメンタル解析
```typescript
interface IncrementalOptions {
  lastSnapshot?: string;
  changedFiles?: string[];
  forceRebuild?: boolean;
}
```

### 3. メモリ効率
- ストリーミング処理
- バッチ挿入
- 適切なバッファサイズ

## テスト戦略

### 1. ユニットテスト
- 各アナライザーの単体テスト
- メトリクス計算の検証
- ストレージ操作のテスト

### 2. 統合テスト
- CLI コマンドのE2Eテスト
- サンプルプロジェクトでの動作確認

### 3. パフォーマンステスト
- 大規模プロジェクトでのベンチマーク
- メモリ使用量の監視
