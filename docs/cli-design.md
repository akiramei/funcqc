# funcqc CLI設計改善案

## 現在の設計の課題

### 1. コマンド分離の複雑さ
**問題**: `collect` と `store` の分離により、基本的な使用でも2コマンド必要
**影響**: 初心者の学習コストが高い、パイプ処理が必須

### 2. 出力形式の不統一
**問題**: JSON/テーブル形式の切り替えが各コマンドでバラバラ
**影響**: 一貫性のないUX、スクリプト化が困難

### 3. フィルタリング仕様の曖昧さ
**問題**: 検索・絞り込み条件の指定方法が不明確
**影響**: 柔軟な検索ができない

## 改善されたCLI設計

### 基本コマンド体系

```bash
# 初期化 - そのまま
funcqc init [options]

# 分析実行 - collect + store を統合
funcqc scan [paths...] [options]

# クエリ実行 - より直感的
funcqc list [filters...] [options]

# 履歴管理
funcqc history [options]
funcqc diff <snapshot1> <snapshot2> [options]

# メンテナンス
funcqc status
funcqc clean [options]

# 将来機能
funcqc suggest [type] [options]
funcqc watch [options]
```

### 詳細コマンド仕様

#### 1. `funcqc init`
```bash
# 基本初期化
funcqc init

# カスタマイズ初期化
funcqc init --root src,lib --exclude "**/*.test.ts" --db ./data/funcqc.db

# 既存設定の表示
funcqc init --show
```

**オプション**:
- `--root <paths>`: 監視対象ディレクトリ（カンマ区切り）
- `--exclude <patterns>`: 除外パターン
- `--db <path>`: データベースパス
- `--show`: 現在の設定を表示
- `--reset`: 設定をリセット

#### 2. `funcqc scan` (collect + store統合)
```bash
# 基本スキャン（設定ファイルに従う）
funcqc scan

# 特定パス指定
funcqc scan src lib

# ラベル付きスキャン
funcqc scan --label "before-refactor"

# 差分スキャンのみ
funcqc scan --incremental

# ドライラン（保存しない）
funcqc scan --dry-run
```

**オプション**:
- `--label <text>`: スナップショットにラベル付与
- `--incremental`: 変更ファイルのみ処理
- `--dry-run`: 分析のみ実行、保存しない
- `--force`: 強制的に全ファイル再分析
- `--quiet`: 最小限の出力
- `--verbose`: 詳細出力

#### 3. `funcqc list` (query改善)
```bash
# 全関数表示
funcqc list

# 名前フィルタ
funcqc list "fetch*"
funcqc list --name "get*,set*"

# ファイルフィルタ
funcqc list --file "src/utils/*"

# 品質フィルタ
funcqc list --complexity ">5"
funcqc list --lines ">50"

# 複合フィルタ
funcqc list "fetch*" --file "src/*" --exported --complexity ">3"

# 出力形式
funcqc list --json
funcqc list --csv
funcqc list --fields "name,file,complexity"
```

**フィルタオプション**:
- `--name <pattern>`: 関数名パターン（glob対応）
- `--file <pattern>`: ファイルパスパターン
- `--exported`: エクスポート関数のみ
- `--async`: async関数のみ
- `--complexity <condition>`: 複雑度条件（>5, <=3など）
- `--lines <condition>`: 行数条件
- `--params <condition>`: パラメータ数条件

**出力オプション**:
- `--format <type>`: 出力形式（table/json/csv）
- `--fields <list>`: 表示フィールド指定
- `--sort <field>`: ソート基準
- `--limit <num>`: 表示件数制限

#### 4. `funcqc history`
```bash
# スナップショット一覧
funcqc history

# 詳細表示
funcqc history --verbose

# 期間指定
funcqc history --since "2024-01-01"
funcqc history --last 10

# Git情報表示
funcqc history --git
```

#### 5. `funcqc diff`
```bash
# スナップショット間比較
funcqc diff abc123 def456

# ラベル指定比較
funcqc diff "before-refactor" "after-refactor"

# 相対指定
funcqc diff HEAD~1 HEAD

# 詳細差分表示
funcqc diff abc123 def456 --verbose

# 特定関数のみ
funcqc diff abc123 def456 --function "fetchUser"

# 統計のみ表示
funcqc diff abc123 def456 --summary
```

#### 6. `funcqc status`
```bash
# 現在の状態確認
funcqc status

# 詳細情報
funcqc status --verbose
```

**表示内容**:
- 最新スキャン時刻
- 総関数数
- 平均品質指標
- 設定情報
- Git状態（連携時）

### 共通オプション設計

#### グローバルオプション
```bash
--config <path>     # 設定ファイルパス
--no-config         # 設定ファイルを無視
--cwd <path>        # 作業ディレクトリ
--verbose          # 詳細出力
--quiet            # 最小限出力
--no-color         # カラー出力無効
--json             # JSON形式出力
--help             # ヘルプ表示
--version          # バージョン表示
```

#### 条件指定の統一フォーマット
```bash
# 数値条件
--complexity ">5"      # 5より大きい
--complexity ">=5"     # 5以上
--complexity "<10"     # 10未満
--complexity "5..10"   # 5以上10以下
--complexity "5,8,10"  # 5、8、10のいずれか

# 文字列条件（glob パターン）
--name "fetch*"        # fetchで始まる
--name "*User*"        # Userを含む
--name "get*,set*"     # getまたはsetで始まる

# 真偽値
--exported            # エクスポート済みのみ
--no-exported         # 非エクスポートのみ
```

### 出力形式の統一

#### 1. テーブル形式（デフォルト）
```
┌─────────────────┬───────────────┬────────────┬──────────────┐
│ Name            │ File          │ Lines      │ Complexity   │
├─────────────────┼───────────────┼────────────┼──────────────┤
│ fetchUser       │ src/api.ts    │ 25         │ 4            │
│ validateEmail   │ src/utils.ts  │ 12         │ 2            │
└─────────────────┴───────────────┴────────────┴──────────────┘

Total: 2 functions, Avg Complexity: 3.0
```

#### 2. JSON形式
```json
{
  "meta": {
    "total": 2,
    "avgComplexity": 3.0,
    "timestamp": "2024-06-28T10:30:00Z"
  },
  "functions": [
    {
      "id": "abc123",
      "name": "fetchUser",
      "file": "src/api.ts",
      "lines": 25,
      "complexity": 4,
      "exported": true
    }
  ]
}
```

#### 3. CSV形式
```csv
name,file,lines,complexity,exported
fetchUser,src/api.ts,25,4,true
validateEmail,src/utils.ts,12,2,false
```

### エラーハンドリングとメッセージ

#### 1. エラーメッセージの改善
```bash
# 悪い例
Error: ENOENT: no such file or directory

# 良い例
Error: Configuration file not found
  → Run 'funcqc init' to create a configuration file
  → Or specify config with --config <path>
```

#### 2. プログレス表示
```bash
# スキャン中
⠋ Scanning TypeScript files... (15/120 files)
✓ Analyzed 245 functions in 1.2s

# 差分計算中
⠋ Comparing snapshots...
✓ Found 12 changes (3 added, 2 modified, 1 removed)
```

#### 3. 警告とヒント
```bash
⚠ Warning: 5 files failed to parse (run with --verbose for details)
💡 Tip: Use --incremental for faster subsequent scans
📊 Quality summary: 15 functions exceed complexity threshold
```

### 設定ファイルとの連携

#### 1. 設定継承
```typescript
// .funcqc.config.js
export default {
  roots: ['src', 'lib'],
  exclude: ['**/*.test.ts'],
  defaults: {
    scan: {
      label: 'auto-{timestamp}'
    },
    list: {
      format: 'table',
      fields: ['name', 'file', 'complexity'],
      sort: 'complexity:desc'
    }
  }
}
```

#### 2. プロファイル機能
```bash
# プロファイル定義
funcqc init --profile development
funcqc init --profile production

# プロファイル使用
funcqc scan --profile production
```

### 自動補完とヘルプ

#### 1. Tab補完対応
```bash
# インストール時に自動補完を設定
funcqc completion --install

# 一時的な有効化
source <(funcqc completion bash)
```

#### 2. コンテキストヘルプ
```bash
# コマンド例表示
funcqc list --examples

# 利用可能フィールド表示
funcqc list --fields-help
```

### 使用例とワークフロー

#### 日常的な使用パターン
```bash
# 初回セットアップ
funcqc init --root src

# 定期的な品質チェック
funcqc scan --label "daily-check"
funcqc list --complexity ">5" --sort complexity:desc

# リファクタリング前後の比較
funcqc scan --label "before-refactor"
# ... リファクタリング作業 ...
funcqc scan --label "after-refactor"
funcqc diff before-refactor after-refactor
```

#### CI/CD統合
```bash
# Pull Request チェック
funcqc scan --label "pr-${PR_NUMBER}"
funcqc diff main "pr-${PR_NUMBER}" --json > quality-report.json
```

## 実装優先順位

### Phase 1: 基本コマンド
1. `funcqc init`
2. `funcqc scan` (基本機能)
3. `funcqc list` (基本フィルタ)
4. `funcqc status`

### Phase 2: 履歴機能
1. `funcqc history`
2. `funcqc diff`
3. 高度なフィルタリング

### Phase 3: UX改善
1. Tab補完
2. プログレス表示
3. エラーメッセージ改善
4. 設定プロファイル
