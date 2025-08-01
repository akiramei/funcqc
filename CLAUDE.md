# CLAUDE.md

@~/.claude/CLAUDE.md  # ユーザー設定を明示的にインポート

## Database Schema - Single Source of Truth

**⚠️ CRITICAL: Database Schema Management**

### 📄 **Authoritative Schema Source**
- **Single Source of Truth**: `src/schemas/database.sql`
- **Complete Definition**: All 12 tables, indexes, constraints, and documentation
- **Automatic Loading**: Implementation reads this file dynamically

### 🚫 **Absolute Prohibitions**
- ❌ **NEVER edit schema in TypeScript files** (`pglite-adapter.ts`)
- ❌ **NEVER create separate DDL files** for individual tables

### 📋 **Table Information**
To understand any table structure, column definitions, indexes, or relationships:
```bash
# View complete schema with documentation
cat src/schemas/database.sql

# Or use your IDE to open:
src/schemas/database.sql
```

### 🛡️ **Consistency Guarantee**
- **Physical Prevention**: Implementation cannot diverge from schema file
- **Human Error Elimination**: No manual synchronization required
- **Zero Risk**: Schema inconsistencies are physically impossible

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

### Key Technologies
- **Storage**: PGLite (embedded PostgreSQL) 
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
```

## Configuration

Uses cosmiconfig for flexible configuration loading:
- `.funcqcrc` (JSON/YAML)
- `funcqc.config.js` (CommonJS)
- `package.json` (funcqc field)

Default scan excludes: `node_modules`, `dist`, `build`, `.git`

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

### 品質改善の基本手法
- **関数分割**: 大きな関数を小さな関数に分割
- **早期リターン**: ネストを減らすために早期リターンを使用
- **ヘルパーメソッド抽出**: 複雑なロジックを専用のヘルパーメソッドに抽出
- **パラメータオブジェクト化**: 多数のパラメータをオブジェクトにまとめる

## PRレビュー対応フロー

### 🛠️ pr-getツールによる体系的レビュー管理

**pr-get**ツール（`scripts/pr-get.ts`）は、GitHub PRのレビューコメントを体系的に管理し、対応漏れを防ぐためのファイルベース管理システムです。

### 📋 基本的なワークフロー

```bash
# Step 1: PRレビューコメントを取得
npx tsx scripts/pr-get.ts <PR番号> --repo <owner/repo>

# Step 2: コメントがpr/XX/comments/に個別ファイルとして保存される
# 例: pr/237/comments/comment-001-src-storage-pglite-adapter-ts.md

# Step 3: 各コメントを確認して対応
# 対応完了: pr/XX/comments/accepts/へ移動
# 不採用: pr/XX/comments/rejects/へ移動（理由を明記）

# Step 4: コミット前に未対応確認
ls pr/XX/comments/*.md  # 残っているファイル = 未対応
```

### 📁 ディレクトリ構造

```
pr/
└── <PR番号>/
    └── comments/
        ├── comment-XXX-*.md      # 未対応のレビューコメント
        ├── accepts/              # 対応完了したコメント
        │   └── comment-XXX-*.md
        └── rejects/              # 不採用としたコメント
            ├── comment-XXX-*.md
            └── README.md         # 不採用理由の説明書
```

### 🔍 pr-getツールの使用方法

```bash
# 基本使用
npx tsx scripts/pr-get.ts 237 --repo akiramei/funcqc

# 出力先変更
npx tsx scripts/pr-get.ts 237 --repo akiramei/funcqc --out custom/path/

# ドライラン（ファイル作成せず確認）
npx tsx scripts/pr-get.ts 237 --repo akiramei/funcqc --dry-run
```

### 📄 生成されるファイル形式

各レビューコメントは以下の形式で保存されます：

```markdown
---
commentId: 2234233287
reviewer: coderabbitai[bot]
createdAt: 2025-07-28T01:07:48Z
filePath: src/storage/pglite-adapter.ts
line: 744
---

[レビューコメント本文]

## 対応ログ
- [ ] 理解完了
- [ ] 対応方針決定
- [ ] 修正実施済み
- [ ] テスト確認
```

### ✅ 対応状況の管理

#### **対応完了（accepts）**
```bash
# 対応したコメントをacceptsフォルダへ移動
mv pr/237/comments/comment-001-*.md pr/237/comments/accepts/
```

#### **不採用（rejects）**
```bash
# 不採用コメントをrejectsフォルダへ移動
mv pr/237/comments/comment-002-*.md pr/237/comments/rejects/

# 理由を明記（rejects/README.md）
echo "PR範囲外のため次回対応" >> pr/237/comments/rejects/README.md
```

### 📊 進捗確認

```bash
# 対応状況の確認
echo "未対応: $(ls pr/237/comments/*.md 2>/dev/null | wc -l)件"
echo "対応済み: $(ls pr/237/comments/accepts/*.md 2>/dev/null | wc -l)件"
echo "不採用: $(ls pr/237/comments/rejects/*.md 2>/dev/null | wc -l)件"
```

### 🚨 コミット前チェック

```bash
# 未対応コメントの確認
if [ $(ls pr/237/comments/*.md 2>/dev/null | wc -l) -gt 0 ]; then
  echo "⚠️ 未対応のレビューコメントが残っています"
  ls pr/237/comments/*.md
  exit 1
fi

# 不採用理由の確認
if [ -d pr/237/comments/rejects ] && [ ! -f pr/237/comments/rejects/README.md ]; then
  echo "⚠️ 不採用理由の説明が必要です"
  exit 1
fi
```

### 💡 メリット

1. **見落とし防止**: 物理ファイルの存在により対応漏れが不可能
2. **進捗可視化**: フォルダ構造で対応状況が一目瞭然
3. **説明責任**: 不採用理由の明文化を強制
4. **監査証跡**: レビュー対応の履歴が残る

### ⚠️ 注意事項

- `pr/`ディレクトリは`.gitignore`に追加済み（コミット対象外）

## funcqc使い方ガイド（開発時の品質管理ツール）

### 🔍 基本的なワークフロー

```bash
# 1. 作業開始時にスナップショットを作成（ブランチ名でラベル付け）
npm run dev -- scan --label feature/my-branch

# 2. 関数の品質状況を確認
npm run dev -- health                    # 全体的な品質レポート
npm run dev -- list --cc-ge 10          # 複雑度10以上の関数一覧

# 3. 作業後に再度スキャンして比較
npm run dev -- scan --label feature/my-branch-after
npm run dev -- diff HEAD~1 HEAD         # 変更内容の確認
```

### 📊 主要コマンド一覧

#### scan - 関数スキャン
```bash
# 基本スキャン
npm run dev -- scan

# ラベル付きスキャン（推奨）
npm run dev -- scan --label <label-name>
```

#### list - 関数一覧表示
```bash
# 全関数表示
npm run dev -- list

# 複雑度でフィルタ
npm run dev -- list --cc-ge 10          # 複雑度10以上
npm run dev -- list --cc-ge 20 --limit 10 --sort cc --desc

# ファイルでフィルタ
npm run dev -- list --file src/storage/pglite-adapter.ts

# 関数名でフィルタ
npm run dev -- list --name analyze
```

#### health - 品質レポート
```bash
# 基本レポート
npm run dev -- health

# 詳細レポート（推奨アクション付き）
npm run dev -- health --verbose
```

#### history - スキャン履歴
```bash
# スナップショット履歴を表示
npm run dev -- history
```

#### diff - 変更差分
```bash
# スナップショット間の差分
npm run dev -- diff <from> <to>

# 指定可能な値：
# - スナップショットID: fd526278
# - ラベル: main
# - HEAD記法: HEAD, HEAD~1, HEAD~3

# 類似関数の洞察付き
npm run dev -- diff <from> <to> --insights

# カスタム類似度閾値（デフォルト: 0.95）
npm run dev -- diff <from> <to> --similarity-threshold 0.8
```

#### files - ファイル分析
```bash
# 行数の多いファイルTOP10
npm run dev -- files --sort lines --desc --limit 10

# 関数数の多いファイル
npm run dev -- files --sort funcs --desc --limit 10
```

#### similar - 類似関数検出
```bash
# 重複・類似コードの検出
npm run dev -- similar
```

#### db - データベース参照
```bash
# テーブル一覧
npm run dev -- db --list

# テーブル内容確認
npm run dev -- db --table snapshots --limit 5
npm run dev -- db --table functions --where "cyclomatic_complexity > 10" --limit 10

# JSON出力（他ツールとの連携用）
npm run dev -- db --table functions --json | jq '.rows[0]'
```

### 🎯 品質指標の理解

#### 複雑度（Cyclomatic Complexity）
- **1-5**: シンプル（良好）
- **6-10**: やや複雑（許容範囲）
- **11-20**: 複雑（要改善）
- **21+**: 非常に複雑（リファクタリング推奨）

#### High Risk関数
以下の条件を満たす関数：
- 複雑度が高い
- ネストが深い
- 行数が多い
- パラメータ数が多い

### 💡 開発時の活用例

#### 1. リファクタリング対象の特定
```bash
# High Risk関数を確認
npm run dev -- health --verbose

# 特定ファイルの複雑な関数を確認
npm run dev -- list --file src/cli/dep.ts --cc-ge 10
```

#### 2. 変更の影響確認
```bash
# 変更前後の差分と類似関数
npm run dev -- diff HEAD~1 HEAD --insights

# 新規追加された関数の品質確認（コミット前チェック）
npm run dev -- diff <ブランチ開始時のラベル> HEAD
```

#### 3. 重複コードの発見
```bash
# 類似関数のグループを表示
npm run dev -- similar
```

### 🎯 diffコマンドによる品質チェック手法

**開発ワークフロー**: ブランチ作業開始時にスナップショットを取得し、作業完了後にdiffコマンドで品質変化を確認

#### 基本的な手順
```bash
# 1. ブランチ開始時にベースラインスナップショット作成
git checkout -b feature/my-feature
npm run dev -- scan --label feature/my-feature

# 2. 開発作業を実施
# [コーディング作業]

# 3. 作業完了後にスナップショット作成
npm run dev -- scan --label feature/my-feature-final

# 4. 品質変化の確認（重要）
npm run dev -- diff feature/my-feature HEAD
```

#### 品質チェックのポイント
- **新規追加関数の複雑度**: CC（Cyclomatic Complexity）が10以下であることを確認
- **High Risk関数の増加**: 新たにHigh Risk関数が生成されていないことを確認
- **関数の分類**: 真の追加か、既存関数の変更・移動・リネームかを把握
- **全体的な品質トレンド**: 品質が改善方向に向かっているかを確認

#### 実際の出力例と対応
```bash
npm run dev -- diff feature/improve-diff-command HEAD
# 出力: +15 functions added, -3 functions removed (CC改善)
# → 高複雑度関数(CC: 18,13,11)を低複雑度関数(CC: 1-10)にリファクタリングした証拠
```

#### 品質問題発見時の対応
```bash
# 問題のある関数を特定
npm run dev -- list --cc-ge 10 --limit 10

# 特定の関数の詳細確認
npm run dev -- describe <function-name>

# リファクタリング実施後に再確認
npm run dev -- diff <before-label> HEAD
```

#### メリット
1. **客観的な品質評価**: 数値による定量的な品質変化の把握
2. **リファクタリング効果の可視化**: 複雑度改善の証拠を残せる
3. **品質劣化の早期発見**: コミット前に品質問題を検出
4. **レビュー時の情報提供**: PRレビューで品質変化を明示可能

### ⚠️ 注意事項

- スナップショットはDBに保存されるが、現在の実装では一部のデータが永続化されない場合がある
- `--label`オプションを使用してスナップショットに意味のある名前を付けることを推奨
- PGLiteはWebAssemblyベースのPostgreSQLなので、通常のPostgreSQLクライアントは使用不可

## 🔄 適切な共通化リファクタリング手順

### 概要

`similar`コマンドとアーキテクチャ情報を活用して、適切かつ安全な関数共通化リファクタリングを実行する包括的な手順です。

### 🎯 基本原則

1. **アーキテクチャ遵守**: レイヤー境界を超えた不適切な共通化を回避
2. **統合戦略の適用**: 関数の性質に応じた適切な配置決定
3. **品質確保**: 共通化後も複雑度と保守性を維持

### 📋 完全なワークフロー

#### ステップ1: 事前準備とベースライン作成

```bash
# 1. ブランチ作成とベースライン作成
git checkout -b refactor/consolidate-similar-functions
npm run dev -- scan --label refactor-baseline

# 2. アーキテクチャ情報の確認
npm run dev -- dep lint --show-consolidation    # 統合戦略を確認
npm run dev -- dep lint --show-layers          # レイヤー情報を確認
```

#### ステップ2: 類似関数の発見と分析

```bash
# 3. 類似関数の検出
npm run dev -- similar

# 4. 高複雑度関数の確認（共通化対象の優先順位付け）
npm run dev -- list --cc-ge 10 --limit 20

# 5. 品質状況の把握
npm run dev -- health --verbose
```

#### ステップ3: アーキテクチャ理解による適切な配置決定

**🏗️ アーキテクチャ情報の活用**

```bash
# レイヤー情報の詳細確認
npm run dev -- dep lint --show-layers
```

**🔧 統合戦略の適用**

- **Global Utils戦略** (`utils`層への配置)
  - 条件: ドメイン知識不要、全レイヤーで使用可能、純粋関数
  - 例: `path operations`, `string formatting`, `basic validation`
  - 信頼度: `high`

- **Layer Utils戦略** (`layer/shared/`への配置)
  - 条件: ドメイン固有知識必要、レイヤー内複数ファイルで使用
  - 例: `AST parsing helpers`, `SQL query builders`, `CLI formatters`
  - 信頼度: `medium`

- **Keep In Place戦略** (共通化しない)
  - 条件: 単一用途、アルゴリズムと密結合、異なる実装が必要
  - 例: `specialized analyzers`, `context-specific handlers`
  - 信頼度: `high`

#### ステップ4: 段階的リファクタリング実行

```bash
# 6. 類似関数グループごとに段階的に実行
# グループ1: Global Utils候補
# - 例: 類似する文字列操作関数を src/utils/ に統合

# グループ2: Layer Utils候補  
# - 例: CLI関連のフォーマット関数を src/cli/shared/ に統合

# グループ3: 分析系関数
# - 例: AST解析関連を src/analyzers/shared/ に統合
```

#### ステップ5: 各段階での品質確認

```bash
# 7. 各リファクタリング後の品質チェック
npm run dev -- scan --label refactor-step1
npm run dev -- diff refactor-baseline refactor-step1

# 8. アーキテクチャ違反のチェック
npm run dev -- dep lint

# 9. 型チェックとテスト
npm run typecheck
npm run lint
npm test
```

#### ステップ6: 最終検証と完了

```bash
# 10. 最終スナップショット作成
npm run dev -- scan --label refactor-complete

# 11. 完全な差分確認
npm run dev -- diff refactor-baseline refactor-complete --insights

# 12. 品質改善の確認
npm run dev -- health --verbose

# 13. 最終的なアーキテクチャ検証
npm run dev -- dep lint
```

### 🎯 判断基準とベストプラクティス

#### ✅ 適切な共通化の判断基準

1. **同一レイヤー内の類似関数**
   - レイヤー内shared/フォルダに配置
   - 例: `src/cli/shared/formatters.ts`

2. **複数レイヤーで使用する純粋関数**
   - utilsレイヤーに配置
   - 例: `src/utils/string-utils.ts`

3. **統合戦略の信頼度考慮**
   - `high`信頼度: 積極的に統合
   - `medium`信頼度: 慎重に判断
   - `low`信頼度: 統合を避ける

#### ❌ 避けるべき共通化パターン

1. **レイヤー境界違反**
   ```bash
   # 例: storageレイヤーの関数をcliレイヤーに配置（NG）
   # アーキテクチャ設定の avoidCrossLayerSharing を確認
   ```

2. **循環依存の作成**
   ```bash
   # 依存関係チェック
   npm run dev -- dep lint --max-violations 0
   ```

3. **ドメイン知識の混入**
   ```bash
   # ドメイン固有の関数をutilsに配置するのは避ける
   # 代わりにlayer/shared/に配置する
   ```

### 🔍 実行例

```bash
# 実際のリファクタリング例
git checkout -b refactor/consolidate-validators
npm run dev -- scan --label validator-refactor-start

# 類似するバリデーション関数を発見
npm run dev -- similar | grep -i "validat"

# アーキテクチャ情報を確認してutils層への配置を決定
npm run dev -- dep lint --show-consolidation

# 共通化実行（例: email, url, path バリデーション関数をutils/validation.tsに統合）
# [リファクタリング作業]

# 品質確認
npm run dev -- scan --label validator-refactor-complete
npm run dev -- diff validator-refactor-start validator-refactor-complete
npm run dev -- health --verbose

# 最終チェック
npm run typecheck && npm run lint && npm test
```

### 📊 期待される効果

1. **コード重複の削減**: DRY原則の適用
2. **保守性の向上**: 単一の変更箇所で複数箇所に反映
3. **品質の向上**: 共通化により一箇所でのテスト・改善が可能
4. **アーキテクチャ遵守**: レイヤー設計を維持した適切な配置
5. **複雑度管理**: 不適切な共通化による複雑度増加を回避

### ⚠️ 注意点

- **段階的実行**: 一度に大量の変更を行わず、小さなステップで進める
- **テスト重要性**: 各段階でのテスト実行を怠らない
- **品質監視**: 共通化により複雑度が増加していないか確認
- **レビュー活用**: PRレビューで統合判断の妥当性を検証

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
