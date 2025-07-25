# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Before generating any code, you MUST read and comply with the following policy:

📄 [Compliance-Policy-for-AI-generated-Code.md](./docs/Compliance-Policy-for-AI-generated-Code.md)

You are strictly required to:

1. Read the full compliance policy.
2. Repeat all mandatory rules listed in the policy.
3. Confirm your full understanding and intention to comply by stating:

> “I have read, understood, and will fully comply with the Compliance Policy for AI-generated Code.”

🚫 Do NOT generate any code until you complete the above steps.

All violations of this policy will result in code rejection and may be flagged as compliance failures.

@~/.claude/CLAUDE.md  # ユーザー設定を明示的にインポート

## Database Schema - Single Source of Truth

**⚠️ CRITICAL: Database Schema Management**

### 📄 **Authoritative Schema Source**
- **Single Source of Truth**: `src/schemas/database.sql`
- **Complete Definition**: All 12 tables, indexes, constraints, and documentation
- **Automatic Loading**: Implementation reads this file dynamically

### 🚫 **Absolute Prohibitions**
- ❌ **NEVER edit schema in TypeScript files** (`pglite-adapter.ts`)
- ❌ **NEVER edit schema in documentation** (`data-model.md` - DEPRECATED)
- ❌ **NEVER create separate DDL files** for individual tables

### ✅ **Schema Modification Process**
1. **Edit Only**: `src/schemas/database.sql`
2. **Restart funcqc**: Changes auto-applied on next run
3. **Verification**: Run `funcqc list --limit 1` to confirm

### 📋 **Table Information**
To understand any table structure, column definitions, indexes, or relationships:
```bash
# View complete schema with documentation
cat src/schemas/database.sql

# Or use your IDE to open:
src/schemas/database.sql
```

**Tables included**: `snapshots`, `functions`, `function_parameters`, `quality_metrics`, `function_descriptions`, `function_embeddings`, `naming_evaluations`, `lineages`, `ann_index_metadata`, `refactoring_sessions`, `session_functions`, `refactoring_opportunities`

### 🛡️ **Consistency Guarantee**
- **Physical Prevention**: Implementation cannot diverge from schema file
- **Human Error Elimination**: No manual synchronization required
- **Zero Risk**: Schema inconsistencies are physically impossible

## Database Migration System

**⚠️ CRITICAL: Data-Preserving Migration Management**

### 🚀 **Migration System Overview**
funcqc uses a custom SimpleMigrationManager that provides data-preserving database migrations for PGLite (WASM PostgreSQL). This system replaces the previous destructive `dropOldTablesIfNeeded()` approach.

### 📄 **Key Features**
- **Data Preservation**: OLD_ prefix backup strategy maintains historical data
- **Transaction Safety**: BEGIN/COMMIT/ROLLBACK for atomic operations  
- **Legacy Support**: Automatic detection and migration of old database schemas
- **CLI Management**: Complete command-line interface for migration operations
- **Zero Dependency**: Embedded PostgreSQL with no external database requirements

### 🔧 **Migration Commands**
```bash
# Check migration status
funcqc migrate status

# Show system information
funcqc migrate info

# Clean up old backup tables (older than 30 days)
funcqc migrate cleanup --days 30

# Reset migration history (development only)
funcqc migrate reset --force

# Create new migration file
funcqc migrate create --name "description_of_change"
```

### 📋 **Migration Workflow for Schema Changes**
When you need to modify the database schema:

1. **Edit Schema**: Modify `src/schemas/database.sql` with your changes
2. **Test Locally**: Run `funcqc scan` to trigger automatic migration
3. **Verify Migration**: Use `funcqc migrate status` to confirm success
4. **Monitor Data**: Check that existing data is preserved
5. **Cleanup**: Use `funcqc migrate cleanup` to remove old backups when ready

### 🛡️ **Data Safety Features**
- **Automatic Backup**: All existing data backed up with OLD_ prefix before changes
- **Rollback Capability**: Transaction-based operations allow rollback on failure  
- **Legacy Detection**: Automatically detects and migrates old database formats
- **Fallback Strategy**: Direct schema creation if migration fails
- **Comprehensive Logging**: Detailed console output for troubleshooting

### 🚨 **Migration System vs Manual Changes**
- ✅ **Use Migration System**: For all schema modifications and data preservation
- ❌ **Avoid Manual Schema Changes**: Direct DDL execution bypasses safety mechanisms
- ❌ **Never Delete Migration History**: Maintains data lineage and audit trail

## Development Commands

### Building and Development
- `npm run dev` - Run CLI in development mode with tsx
- `npm run build` - Build distribution files using tsup
- `npm run typecheck` - TypeScript type checking without emit

### Testing
- `npm test` - Run unit tests with Vitest
- `npm run test:watch` - Run tests in watch mode  
- `npm run test:e2e` - Run end-to-end CLI tests
- `npm run test:coverage` - Generate test coverage reports

### Code Quality
- `npm run lint` - ESLint validation
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

### CLI Usage
- `npm run dev init` - Initialize funcqc configuration
- `npm run dev scan` - Analyze TypeScript functions
- `npm run dev list` - Display function analysis results
- `npm run dev history` - View snapshot history
- `npm run dev diff` - Compare snapshots

## Architecture Overview

funcqc is a TypeScript function quality control tool with a layered architecture:

### Core Components
- **CLI Layer** (`src/cli.ts`, `src/cli/`): Commander.js-based interface with subcommands
- **Core** (`src/core/`): Central analyzer and configuration management using cosmiconfig
- **Storage** (`src/storage/`): PGLite adapter with Kysely query builder for zero-dependency persistence
- **Analyzers** (`src/analyzers/`): TypeScript AST analysis using TypeScript Compiler API
- **Metrics** (`src/metrics/`): Quality calculator computing 17 different metrics

### Data Flow
1. **Scan**: Files → TypeScript Analyzer → Function Extraction → Quality Calculator → PGLite Storage
2. **Query**: CLI Command → Storage Query → Filter/Sort → Formatted Output
3. **History**: Snapshots stored with Git integration for change tracking

### Key Technologies
- **Storage**: PGLite (embedded PostgreSQL) with Kysely ORM
- **Analysis**: TypeScript Compiler API for AST parsing
- **CLI**: Commander.js with chalk/ora for rich output
- **Build**: tsup bundler, TypeScript 5.3+, Vitest testing

### 🚨 CRITICAL: Database Technology Understanding

**PGLite is NOT SQLite**:
- **PGLite**: PostgreSQL compiled to WebAssembly (WASM)
- **SQLite**: Completely different database engine written in C
- **No relation**: Despite similar names, they are entirely different technologies
- **Different APIs**: PGLite uses PostgreSQL syntax, SQLite uses its own syntax
- **Different features**: Never assume features from one exist in the other

**Technical Facts**:
```typescript
// PGLite - PostgreSQL WASM
const pgdb = new PGLite('./data');     // PostgreSQL in WASM
await pgdb.exec('CREATE TABLE...');    // PostgreSQL SQL syntax

// SQLite - Different database entirely  
const sqlitedb = new Database('./data.sqlite'); // SQLite C library
sqlitedb.exec('CREATE TABLE...');      // SQLite SQL syntax
```

**❌ NEVER assume**:
- `:memory:` functionality exists in PGLite because it exists in SQLite
- Similar API behavior between PGLite and SQLite
- Feature parity between the two systems
- Cross-compatibility or similar implementation approaches

### Database Schema
- `snapshots`: Version history with metadata and Git integration
- `functions`: Core function information with multiple hash types
- `function_parameters`: Parameter details
- `quality_metrics`: 17 computed quality metrics including complexity, size, and maintainability

## Configuration

Uses cosmiconfig for flexible configuration loading:
- `.funcqcrc` (JSON/YAML)
- `funcqc.config.js` (CommonJS)
- `package.json` (funcqc field)

Default scan excludes: `node_modules`, `dist`, `build`, `.git`

## Quality Metrics

The quality calculator computes comprehensive metrics:
- **Complexity**: Cyclomatic, cognitive complexity
- **Size**: Lines of code, total lines, parameter count
- **Structure**: Nesting level, branches, loops
- **Advanced**: Halstead volume, maintainability index
- **Patterns**: Async/await usage, error handling

## Testing Strategy

- Unit tests for analyzers and calculators in `test/` (452 tests)
- Test fixtures in `test/fixtures/`
- Manual functional testing using `npm run dev` commands
- Note: E2E tests removed due to high maintenance cost vs value ratio

## Development Notes

- Strict TypeScript configuration with comprehensive type safety
- Husky pre-commit hooks for linting and formatting
- PGLite provides embedded PostgreSQL without external dependencies
- Kysely ensures type-safe database operations
- Rich CLI output with progress indicators and colored formatting

## コード品質管理

コミット前の必須手順として`funcqc`を使用してコードの品質を計測し、High Risk関数が0件であることを確認する。

### funcqc 基本ワークフロー

```bash
# Step 1: メトリクス収集（コード変更後は必須）
npm run dev scan

# Step 2: 品質確認（High Risk関数のチェック）
npm run dev -- list --cc-ge 10

# Step 3: High Risk関数が1件以上の場合は修正して Step 1 に戻る
# Step 4: High Risk関数が0件になるまで繰り返し
```

### 高度な品質管理フロー

funcqcの高機能を活用した包括的品質管理:

```bash
# Phase 1: 基本品質確認
npm run dev health                        # プロジェクト全体状況とリスク評価
npm run dev -- list --cc-ge 10           # High Risk関数の確認

# Phase 2: 詳細分析
npm run dev -- list --cc-ge 10 --limit 10 --sort cc --desc  # 複雑な関数TOP10
npm run dev -- similar --threshold 0.8   # 重複コード検出
npm run dev -- diff HEAD~1 HEAD          # 最新変更の品質影響分析

# Phase 3: 改善計画
npm run dev -- show "functionName"       # 問題関数の詳細分析
npm run dev -- search "keyword"          # 関連関数の発見
```

### High Risk 判定基準
- Cyclomatic Complexity > 10
- Cognitive Complexity > 15  
- Lines of Code > 40
- Nesting Depth > 3
- Parameter Count > 4

### 品質改善の基本手法
- **関数分割**: 大きな関数を小さな関数に分割
- **パラメータオブジェクト化**: 多数のパラメータをオブジェクトにまとめる
- **早期リターン**: ネストを減らすために早期リターンを使用
- **ヘルパーメソッド抽出**: 複雑なロジックを専用のヘルパーメソッドに抽出

### 短縮コマンド（エイリアス）

package.jsonに以下のスクリプトを追加して短縮化:

```json
{
  "scripts": {
    "quality:scan": "npm run dev scan",
    "quality:check": "npm run dev -- list --cc-ge 10",
    "quality:health": "npm run dev health",
    "quality:trends": "npm run dev -- trend --weekly",
    "quality:complex": "npm run dev -- list --cc-ge 10 --limit 10 --sort cc --desc"
  }
}
```

使用例:
```bash
npm run quality:scan     # メトリクス収集
npm run quality:check    # 品質確認
npm run quality:health   # 概要表示
```

## 🚀 高速関数検索機能の活用

funcqcの関数検索機能により、従来のglob/grep検索を大幅に改善できます。

### 🏆 function-indexerからfuncqcへの進化

**継承された優位性**:
- ✅ ゼロ設定での即座実行
- ✅ 高精度なメトリクス計算
- ✅ Git統合による変更追跡
- ✅ 直感的な関数発見

**大幅な機能強化**:
- 💾 **17種類の包括的メトリクス** (Halstead, 保守性指数含む)
- 📊 **A-Fグレード評価システム** (単一指標から4領域スコアへ)
- 📈 **時系列トレンド分析** (週次/月次/日次)
- 🎯 **AST類似性検出** (重複コード自動特定)
- 💾 **embedded PostgreSQL** (安定性と高速性)

**改善された問題点**:
- ❌ レポート生成の不安定性 → ✅ 安定したCLI出力
- ❌ 履歴管理の貧弱性 → ✅ 完全なスナップショット管理
- ❌ 設定の非柔軟性 → ✅ cosmiconfigベースの柔軟設定

### 従来アプローチの問題と改善

**❌ 従来のglob/grep検索**:
- 全ファイル走査で時間がかかる（数秒〜数十秒）
- 関数の境界や詳細情報が不明
- コメント・文字列内の偽陽性マッチ

**✅ funcqc高速検索**:
- インスタント検索（0.1秒未満）
- 正確な関数位置（ファイルパス:行番号）
- 品質メトリクスも同時取得

### 関数調査の効率化例

```bash
# 🔍 関数の基本検索
npm run dev list --name "*Auth*"      # 認証関連関数を瞬時に発見
npm run dev show --name "handleAuth"  # 関数詳細を即座に表示

# 📊 品質ベースの検索
npm run dev list --complexity ">10"     # 複雑な関数のみ抽出
npm run dev list --async --exported     # 非同期エクスポート関数のみ
npm run dev list --lines ">50" --params ">4"  # 大きく複雑な関数を特定

# 🔬 意味的検索
npm run dev search "database"          # データベース関連関数を意味検索
npm run dev list --keyword "validation" # 検証系関数を発見

# 🎯 リファクタリング対象の特定
npm run dev similar --threshold 0.8    # 類似コード検出
npm run dev list --threshold-violations # 品質基準違反関数
```

### 開発ワークフローの改善効果

| 作業 | 従来方法 | funcqc方法 | 時短効果 |
|------|----------|------------|----------|
| 関数探索 | `grep -r "functionName"` (5-10分) | `npm run dev list --name "pattern"` (30秒) | **90%時短** |
| 品質確認 | 手動コードレビュー (15-30分) | `npm run dev list --threshold-violations` (1分) | **95%時短** |
| リファクタリング計画 | 経験的判断 (30-60分) | `npm run dev similar` + trend分析 (5-10分) | **80%時短** |

### プロジェクト品質の可視化

```bash
# 📈 品質トレンド分析
npm run dev history                      # スナップショット履歴
npm run dev -- diff HEAD~1 HEAD          # 最新変更の品質比較
npm run dev health                      # プロジェクト全体状況

# 🔍 問題関数の追跡
npm run dev -- history --id "func-id"   # 特定関数の履歴追跡
npm run dev -- describe "func-name" --text "explanation" # 関数説明追加
```

### 品質改善の新しいアプローチ

```bash
# 🎯 リファクタリング機会の発見
npm run dev -- similar --threshold 0.8 --min-lines 10  # 重複コード特定
npm run dev -- list --cc-ge 10                         # 複雑な関数の特定

# 📉 ファイル別分析
npm run dev -- list --file "*.ts" --cc-ge 5            # 特定ファイルの複雑関数
npm run dev -- list --name "*test*"                    # テスト関連関数
```

## 📄 funcqc クイックリファレンス

### 🏆 状況別コマンド選択

| 目的 | 第1選択 | 第2選択 | 詳細確認 |
|------|---------|---------|----- ----|
| **関数発見** | `search "keyword"` | `list --name "*pattern*"` | `show "funcName"` |
| **品質確認** | `health` | `list --cc-ge 10` | `diff HEAD~1 HEAD` |
| **問題調査** | `list --cc-ge 10` | `similar --threshold 0.8` | `show "problemFunc"` |
| **コードレビュー** | `list --cc-ge 5 --limit 10` | `list --name "*exported*"` | `similar --threshold 0.8` |
| **関数文書化** | `describe --list-undocumented` | `describe --needs-description` | `describe "funcId" --text "説明"` |

### 🚀 効率的調査フロー

**AIアシスタント向け推奨フロー**:

```bash
# Step 1: 全体把握 (必須)
npm run dev health

# Step 2: 問題特定 (課題発見)
npm run dev -- list --cc-ge 10

# Step 3: 詳細分析 (深掘り)
npm run dev -- show "関数名"

# Step 4: 関連探索 (横断調査)
npm run dev -- search "キーワード"
```

### 📊 よく使うコマンド組み合わせ

```bash
# 複雑な関数TOP10
npm run dev -- list --cc-ge 5 --sort cc --desc --limit 10

# 非常に複雑な関数
npm run dev -- list --cc-ge 15

# 特定ファイルの複雑関数
npm run dev -- list --cc-ge 10 --file "src/cli/*.ts"

# 関数名パターンで検索
npm run dev -- list --name "*handle*" --cc-ge 5
```

### ⚠️ コマンド実行時の注意点

**正しい書き方**:
```bash
✅ npm run dev -- list --cc-ge 10
✅ npm run dev -- show "functionName"      # 関数名で検索
✅ npm run dev -- show --id "13b46d5e"     # ID指定（重要: --idオプション必須）
✅ npm run dev -- list --cc-ge 10 --json    # JSON出力
```

**間違いやすい書き方**:
```bash
❌ npm run dev list --cc-ge 10             # --がない
❌ npm run dev show functionName           # 引用符なし
❌ npm run dev show "13b46d5e"            # IDを名前として検索（エラーになる）
❌ npm run dev -- list --complexity ">10" # 存在しないオプション
```

**🚨 showコマンドの正しい使い方**:
```bash
# ID指定の場合（最も確実）
npm run dev -- show --id "13b46d5e"        # ✅ 正解: --idオプションを使用

# 関数名指定の場合
npm run dev -- show "functionName"         # ✅ 名前パターンで検索
npm run dev -- show "Logger.info"          # ✅ メソッド名もOK
npm run dev -- show "*Auth*"               # ✅ ワイルドカード使用可能

# ❌ よくある間違い
npm run dev -- show "13b46d5e"             # IDを名前として扱ってしまう
```

### 🔍 関数探索の段階的アプローチ

1. **幅広検索**: `search "keyword"` - キーワードで関連関数を発見
2. **パターン検索**: `list --name "*pattern*"` - 名前パターンで絞り込み
3. **詳細確認**: `show "functionName"` - 特定関数の詳細情報
4. **関連探索**: `list --file "sameFile.ts"` - 同一ファイル内の関連関数

### 📈 出力形式の使い分け

**利用可能なフォーマット**:
- **table** (デフォルト): テーブル形式、レスポンシブ
- **json**: 構造化データ、パイプライン処理可能（jqで加工可能）

**使い分け**:
```bash
# 通常の一覧表示
npm run dev -- list                         # テーブル形式

# データ処理・自動化（重要：--silent使用）
npm run --silent dev -- list --json | jq '.functions[]'  # JSON形式

# IDと名前のみ抽出
npm run --silent dev -- list --json | jq -r '.functions[] | "\(.id) \(.name)"'
```

**⚠️ テーブルレンダリング失敗時の対処**:
```bash
# テーブルが崩れてIDが見えない場合
npm run dev -- list --cc-ge 10 --json | jq -r '.functions[] | "\(.id) \(.name)"'
```

**IDが必要な場合の確実な表示方法**:
```bash
# 複雑な関数をID付きで表示
npm run --silent dev -- list --cc-ge 5 --json | jq -r '.functions[] | "\(.id) \(.name) (CC:\(.metrics.cyclomaticComplexity))"'

# 特定ファイルの関数をID付きで表示
npm run --silent dev -- list --file "src/cli/*.ts" --json | jq -r '.functions[] | "\(.id) \(.name)"'
```

### 📚 詳細ガイド

包括的なコマンドリファレンス: [funcqc-cheatsheet.md](./docs/funcqc-cheatsheet.md)
AI統合ガイド: [ai-integration-guide.md](./docs/ai-integration-guide.md)
実用例集: [practical-examples.md](./docs/practical-examples.md)
関数文書化ワークフロー: [function-documentation-workflow.md](./docs/function-documentation-workflow.md)

### 🎯 関数文書化の効率的ワークフロー

**基本文書化フロー**:
```bash
# Step 1: 複雑な関数をID付きで表示
npm run --silent dev -- list --cc-ge 10 --json | jq -r '.functions[] | "\(.id) \(.name)"'

# Step 2: 関数の詳細を確認
npm run dev -- show --id "functionId"

# Step 3: コードを直接確認
Read src/path/to/file.ts:lineNumber

# Step 4: リファクタリング実施
# 関数を小さな関数に分割
```

**効率化のコツ**:
```bash
# 複雑な関数優先
npm run --silent dev -- list --cc-ge 10 --json | jq -r '.functions[] | "\(.id) \(.name) (CC:\(.metrics.cyclomaticComplexity))"'

# 特定ファイルの複雑関数
npm run --silent dev -- list --file "src/cli/*.ts" --cc-ge 5 --json | jq -r '.functions[]'

# 同一ファイル内の関数一覧
npm run dev -- list --file "src/cli/list.ts"
```

## 📝 関数説明管理機能

funcqcには関数の説明を管理する包括的な機能が搭載されています。

### 🔍 説明状況の確認

```bash
# 説明がない関数を発見
npm run dev -- describe --list-undocumented

# 説明更新が必要な関数を発見（内容変更検知含む）
npm run dev -- describe --needs-description

# 完全な関数IDと共に表示
npm run dev -- describe --list-undocumented --show-id
```

### ✏️ 関数説明の追加・管理

```bash
# 個別の説明追加
npm run dev -- describe "function-id" --text "関数の説明"

# 説明の確認
npm run dev -- describe "function-id"

# 説明のソース指定（人間・AI・JSDoc）
npm run dev -- describe "function-id" --text "説明" --source human
npm run dev -- describe "function-id" --text "説明" --source ai --model "gpt-4"
```

### 🚀 効率的な文書化ワークフロー

```bash
# Step 1: 文書化が必要な関数を特定
npm run dev -- describe --list-undocumented --show-id

# Step 2: 優先度の高い関数から文書化
npm run dev -- describe "function-id" --text "説明文"

# Step 3: 定期的な更新チェック
npm run dev -- describe --needs-description
```

### 🔄 自動変更検知システム

funcqcは関数の内容が変更された際に、説明の更新が必要かどうかを自動的に検知します：

- **content_id**ベースの整合性チェック
- **PostgreSQLトリガー**による自動フラグ設定
- **semantic_id**による関数の持続的追跡

### 📊 出力フォーマット

```
ID       Name                            Description
-------- ------------------------------- -----------------------------------------
3d2e3fa4 analyze                         Analyzes function naming quality and...
56c03f63 parseToAST                      
a1b2c3d4 validateUser                    Validates user input data and retur...
```

- **ID**: 8文字の短縮関数ID（`--show-id`で完全ID表示）
- **Name**: 関数名（31文字で切り捨て）
- **Description**: 説明文（40文字で切り捨て + `...`）

## 🚀 次世代品質管理の実現

funcqcへの移行により、従来の「High Risk関数ゼロ」から「包括的品質管理」へと進化しました。

### 📈 新しい品質基準

**継続的品質管理の3段階**:

1. **基本品質** (従来のHigh Risk基準を維持)
   - High Risk関数: 0件
   - Cyclomatic Complexity ≤ 10
   - Lines of Code ≤ 40

2. **中級品質** (全体グレードB以上)
   - 総合グレード: B (80+)
   - 保守性スコア: 85+
   - 重複コード: なし

3. **高品質** (持続的改善)
   - 総合グレード: A (90+)
   - 品質トレンド: 向上傾向
   - 文書化率: 80%+

### 🏅 成果測定指標

```bash
# 週次品質レポート
npm run dev -- diff HEAD~7 HEAD           # 週次変更の品質影響
npm run dev -- list --threshold-violations --json | jq '.length'
npm run dev health | grep -i "risk"
```

## AI開発協働における心構え

### 認知リソース配分の現実認識

AIの計算能力は有限であり、以下のような配分が発生する：

```typescript
interface CognitiveResourceAllocation {
  仕様理解と実現: 60%,      // メイン機能の正確な実装
  アーキテクチャ設計: 25%,   // 拡張性・保守性
  エラーハンドリング: 10%,   // 基本的な防御
  細部の完全性: 5%          // ← 見落としが発生しやすい領域
}
```

### レビューとの補完関係

この配分は最適戦略であり、以下の協働システムを前提とする：

1. **AIの役割**: 仕様実現とアーキテクチャ設計に注力
2. **レビューの役割**: 細部への注力不足を補完
3. **ツールの役割**: 機械的チェック（ゼロ除算、型安全性等）

### レビュー対応の原則

#### 謙虚な姿勢の重要性
- 「もしかしたら見落としがあったかも」という前提で臨む
- 初期反応を疑い、必ず再確認する
- レビューコメントを感謝の気持ちで受け入れる

#### 標準的な対応パターン
```typescript
// レビューコメントへの推奨反応
"ご指摘ありがとうございます。
仕様実現に注力していたため、この細部を見落としていました。
確認して修正いたします。"
```

### 価値創造の最適化

#### 重点配分領域
- ✅ ビジネスロジックの正確性
- ✅ ユースケースの網羅性
- ✅ アーキテクチャの適切性
- ✅ ユーザビリティ

#### ツール・レビューに委ねる領域
- 🤖 ゼロ除算チェック
- 🤖 null/undefined参照
- 🤖 基本的なセキュリティパターン
- 👥 配列の破壊的変更
- 👥 エッジケースの検証

この心構えにより、AIと人間の協働システムが最も効果的に機能し、より価値の高いソフトウェアを生み出すことができる。

## AI協調による調査方針

### Geminiツールの活用
調査や技術検討時に、以下のツールを状況に応じて組み合わせて使用：
- ローカルファイル調査（Read/Grep/Glob）
- Web検索（WebSearch）
- Gemini AI相談（geminiChat/googleSearch）

### Gemini使用の明示的指示
ユーザーがGeminiを使いたい場合の指示方法：
- 「Geminiに聞いて: ○○」
- 「Geminiで検索: ○○」
- 「Gemini経由で: ○○」

### 自動的なGemini活用
Claudeが調査時に必要と判断した場合、Geminiへの相談も選択肢として検討する。

## 🚨 JSON出力使用時の必須事項: --silent オプション

### 問題: npmの標準出力がJSON出力に混在

**エラー例**:
```bash
# ❌ 失敗するパターン
npm run dev -- list --json | jq '.functions'
# エラー: parse error: Invalid numeric literal at line 2, column 2
```

原因: npmが以下の行を出力するため
```
> funcqc@0.1.0 dev
> tsx src/cli.ts list --json
```

### ✅ 解決方法: --silent オプションを必ず使用

```bash
# ✅ 正しいパターン
npm run --silent dev -- list --json | jq '.functions'

# ✅ 具体例
npm run --silent dev -- list --cc-ge 10 --json | jq -r '.functions[] | "\(.metrics.cyclomaticComplexity)\t\(.name)"' | sort -nr
```

### 代替方法

1. **直接tsx実行**
```bash
npx tsx src/cli.ts list --json | jq '...'
```

2. **エラー出力リダイレクト**（非推奨）
```bash
npm run dev -- list --json 2>/dev/null | tail -n +4 | jq '...'
```

**重要**: JSON出力を使う際は必ず`npm run --silent`を使用すること。これによりデバッグ効率が大幅に向上し、調査の中断を防げる。

## 🚨 重要な知見: 問題解決における早期相談の重要性

### 問題: 確信のない試行錯誤による時間浪費

**事例1**: Vitestでasync error handlingテストが失敗する問題
- **悪いパターン**: テストをスキップして「ツールの問題」と決めつけ、30分以上の試行錯誤を実施
- **改善後**: Geminiに5分相談した結果、`await`不足という根本原因が即座に判明し解決

**事例2**: TypeScriptの`exactOptionalPropertyTypes`エラー問題  
- **悪いパターン**: 複数回の型キャスト修正を試行、15分以上の試行錯誤を継続
- **改善後**: Geminiに相談して、optional property の正しい扱い方を即座に習得し解決

### ❌ 避けるべき悪いパターン
1. **推測による回避**: 根本原因を調べずに問題を迂回する
2. **確信のない試行錯誤**: 複数回の修正とテスト実行を繰り返す
3. **ツール責任論**: 「フレームワークの問題」と決めつけて諦める

### ✅ 採用すべき良いパターン
1. **早期相談**: 問題に遭遇したらすぐにGeminiに相談
2. **具体的な質問**: エラーコードと実装を含めて詳細に説明
3. **専門知識の活用**: フレームワーク固有の問題は経験豊富なAIに聞く

### 🚨 Geminiに相談すべき明確な判断基準

#### **即座に相談**（迷わずGemini）
- TypeScriptコンパイルエラーが**2回の修正**で解決しない時
- テスト失敗で**1回目から原因が不明**な時
- エラーメッセージをGoogle検索しても解決しない時
- **15分経過**しても進展がない時

#### **危険な思考パターンを検出したら即相談**
- 🚨 「もう少しで解決できそう」と思っている時
- 🚨 「きっと○○が原因だろう」と推測している時  
- 🚨 「前回も似た問題を解決したから」と過信している時
- 🚨 回避策を考え始めた時（根本解決の前に）

#### **その他の相談タイミング**
- フレームワーク特有の問題に遭遇した時
- ベストプラクティスを確認したい時
- 複数の解決策で迷っている時

### 効果的な相談方法
- 具体的なエラーメッセージを含める
- 関連するコードスニペットを提供
- 期待する動作と実際の動作を明記
- 使用しているツール/バージョンを明記

### 📊 時間効率の劇的改善
**5分の相談で30分の試行錯誤を省ける** - これは開発生産性における重要な投資対効果である。

### 🧠 メタ認知による自己モニタリング

開発中に以下を定期的に自問することで、早期相談を促進：

#### **15分タイマーの活用**
```bash
# 問題発生時に設定
echo "$(date): Problem started" > /tmp/debug_timer
# 15分後にアラート
sleep 900 && echo "🚨 15分経過 - Geminiに相談する時間です"
```

#### **セルフチェック質問**
- ❓ この問題で既に何分経過した？
- ❓ 同じ種類のエラーを何回修正した？  
- ❓ 「きっと○○だろう」と推測していないか？
- ❓ 根本解決 vs 回避策、どちらを考えている？

### 🎯 実装すべき習慣

1. **問題発生 → 即座にタイマー開始**
2. **2回目の修正前 → 必ずGemini検討**  
3. **「もう少し」思考 → 危険信号として認識**
4. **振り返り → なぜ相談が遅れたかを分析**

**教訓**: 迷ったらまず相談。認知バイアスに対抗する**構造的対策**が、専門知識を持つAIの活用を成功させる重要な戦略である。

## 🚀 funcqc による開発パフォーマンス向上ガイド

### 💡 **listとshowコマンドによる高効率コード理解**

funcqcのlistとshowコマンドは、従来のファイル探索やコード理解を革命的に改善します。AIアシスタントの作業パフォーマンス向上に最適化された使用法を以下に示します。

### 🎯 **ファイル内関数レイアウトの瞬間理解**

```bash
# 特定ファイルの全関数構造を把握
npm run --silent dev -- list --file "src/core/realtime-quality-gate.ts" --json

# 複雑度順でファイル内関数を表示  
npm run dev -- list --file "src/core/realtime-quality-gate.ts" --sort cc --desc

# 特定ファイルの関数数と品質概要
npm run dev -- list --file "src/core/realtime-quality-gate.ts" --summary
```

**効果**: 
- ファイル全体の関数構造を数秒で把握
- 各関数の品質メトリクスを一覧表示
- リファクタリング対象の即座特定

### 🔍 **showコマンドによる関数詳細とソースコード取得**

```bash
# 関数IDによる確実な詳細取得
npm run dev -- show --id "026c3af0-ceca-480d-93f4-f2f369630a2e" --source

# 関数名による検索（パターンマッチ）
npm run dev -- show "evaluateAllFunctions" --source

# 複数関数の詳細を一括取得
npm run --silent dev -- list --file "target.ts" --json | jq -r '.functions[].id' | xargs -I {} npm run dev -- show --id {} --source
```

**取得可能な情報**:
- **完全なソースコード**: JSDoc + 実装コード
- **関数メタデータ**: 位置、修飾子、エクスポート状況、型情報
- **品質メトリクス**: 複雑度、LOC、パラメータ数等
- **ファイル状況**: 変更検知（"⚠️ Modified since last scan"）

### 🚀 **AI開発ワークフローでの活用パターン**

#### **パターン1: 新機能理解**
```bash
# Step 1: ファイル全体構造把握
npm run dev -- list --file "src/new-feature.ts"

# Step 2: 主要関数の詳細確認  
npm run dev -- show "mainFunction" --source

# Step 3: 関連関数の確認
npm run dev -- list --name "*helper*" --file "src/new-feature.ts"
```

#### **パターン2: バグ調査**
```bash
# Step 1: 問題のある関数特定
npm run dev -- list --cc-ge 10 --file "problematic.ts"

# Step 2: 詳細ソースコード取得
npm run dev -- show --id "function-id" --source

# Step 3: 関連する複雑な関数も確認
npm run dev -- list --file "problematic.ts" --cc-ge 5 --sort cc --desc
```

#### **パターン3: リファクタリング計画**
```bash
# Step 1: 品質問題の関数を特定
npm run --silent dev -- list --cc-ge 10 --json | jq -r '.functions[] | "\(.id) \(.name) \(.filePath)"'

# Step 2: 各関数の詳細とソースコード確認
npm run dev -- show --id "target-id" --source

# Step 3: 同一ファイル内の関連関数も確認
npm run dev -- list --file "same-file.ts" --sort cc --desc
```

### 🎯 **従来手法 vs funcqc手法 比較**

| 作業内容 | 従来手法 | funcqc手法 | 時短効果 |
|----------|----------|------------|----------|
| **ファイル構造理解** | VSCode探索 + 手動スクロール (10-15分) | `list --file` (30秒) | **95%時短** |
| **関数詳細確認** | ファイル検索 + 手動コピー (5-10分) | `show --source` (10秒) | **98%時短** |
| **品質問題特定** | 手動コードレビュー (30-60分) | `list --cc-ge 10` (1分) | **95%時短** |
| **関連関数発見** | grep + 手動確認 (10-20分) | `list --name "*pattern*"` (30秒) | **90%時短** |

### 💡 **AI作業効率化のベストプラクティス**

#### **🚀 関数調査の黄金ルール**
1. **まずlist**: ファイル全体の構造を把握
2. **次にshow**: 特定関数の詳細とソースを確認
3. **最後にRead**: 必要に応じて周辺コードを確認

#### **🎯 ID活用の重要性**
```bash
# ❌ 曖昧な関数名検索（複数マッチの可能性）
npm run dev -- show "process"

# ✅ ID指定による確実な関数特定
npm run dev -- show --id "exact-function-id" --source
```

#### **🔄 JSON出力によるデータ処理**
```bash
# ファイル内関数の一覧をID付きで取得
npm run --silent dev -- list --file "target.ts" --json | jq -r '.functions[] | "\(.id) \(.name)"'

# 複雑度上位5関数のIDを取得
npm run --silent dev -- list --file "target.ts" --json | jq -r '.functions | sort_by(.metrics.cyclomaticComplexity) | reverse | .[0:5] | .[] | .id'
```

### ⚡ **開発速度向上の実証データ**

funcqcを活用することで、以下の劇的な効率向上が実現されます：

- **コード理解時間**: 従来15分 → funcqc 1分 (93%削減)
- **関数詳細確認**: 従来10分 → funcqc 10秒 (99%削減)  
- **品質問題発見**: 従来30分 → funcqc 2分 (93%削減)
- **リファクタリング計画**: 従来60分 → funcqc 10分 (83%削減)

### 🚨 **重要: この機能を最大限活用すること**

funcqcのlistとshowコマンドは、AIアシスタントにとって**grep/find/Read操作の上位互換**です。以下の場合は必ずfuncqcを優先してください：

- 関数の詳細情報が必要な時
- ファイル内の構造を理解したい時  
- 品質メトリクスと共にコードを確認したい時
- 複数関数の比較が必要な時

この機能により、コード理解から実装まで、AI開発パフォーマンスが飛躍的に向上します。

## 🚨 CRITICAL: TypeScript/ESLint エラー対応における論理矛盾の検出

### 🔴 **STEP: コンパイラ提案の論理チェック（必須）**

**ABSOLUTE REQUIREMENT**: TypeScriptエラーで`_`で始まる変数/関数が提案された場合、即座に設計見直しを行うこと。

**適用ケース:**
- `Cannot find name 'varName'. Did you mean '_varName'?`
- `Parameter 'paramName' is declared but never used`と同時に`_paramName`の使用がある場合

**🚨 絶対禁止事項:**
- ❌ コンパイラが`_`付き変数を提案した時の安易な採用
- ❌ `_`付きパラメータを実際に使用すること
- ❌ 論理矛盾を無視した機械的修正（sed等の一括置換）

### 📋 **必須チェックリスト**
コンパイラが`_`付き提案をした時：
- [ ] この変数は本当に使わないのか？使うのか？を明確化
- [ ] 使うなら`_`を削除、使わないなら使用箇所を削除
- [ ] 設計の一貫性を確保（パラメータ名と使用箇所の統一）

### 🚨 **根本原則**
**「コンパイラが`_`で始まる名前を提案した時点で設計ミス」**

なぜなら：
1. `_`付き変数は「使わない」宣言
2. コンパイラがそれを提案する = 実際には使いたい
3. **前提が論理的に矛盾している**

**CRITICAL WARNING**: `_`付き変数の提案は「設計に論理矛盾がある」という警告です。必ず設計を見直してください。