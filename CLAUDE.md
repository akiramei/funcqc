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

## コード品質管理

### 🎯 最重要原則：Health Score最優先

**funcqcにおける品質管理の絶対原則**：**Health Score向上が唯一の目標**

#### 🚨 CRITICAL: Health Command分析結果の重視

**必須実行コマンド（例外なし）**：
```bash
# すべての品質改善作業の起点
npm run dev -- health --verbose
```

#### 📊 Health Report分析で重視すべき指標

**最優先指標（構造的問題）**：
1. **Overall Health Index**: 数値が低いほど構造的問題が深刻
2. **Structural Risk**: CRITICALの場合は緊急対応必要
3. **Structural Penalty Breakdown**: 最大のペナルティ要因を特定
   - **High Coupling (Fan-in)**: 最も重要な構造的問題
   - **Cyclic Functions**: 循環依存の数
   - **Hub Functions**: 過度な結合を持つ関数
4. **PageRank Centrality Analysis**: 中心性の不平等度
   - **Gini Coefficient**: 98%+は危険な集中状態
   - **Most Central Functions**: ボトルネック関数の特定

**注目すべき具体的数値**：
- **Max Fan-in**: 100+は異常値、要改善
- **Hub Functions**: 30個未満が目標
- **Cyclic Functions**: 10個未満が目標
- **Centrality Gini Coefficient**: 90%未満が目標

#### 🚨 CRITICAL: Health Report解釈の絶対ルール

**Health Reportの推奨アクション無視ルール**：
- 報告書で「High-Risk Functions (CC: XX)」と表示されても **CC値は一切考慮しない**
- 「analyzeFile() (Risk: 13, CC: 21)」のような表記に **惑わされない**
- **構造的分析セクションのみ**に注目する

**絶対禁止の思考パターン**：
- ❌ 「CC値が高いから問題」
- ❌ 「推奨アクションにCC値があるからCC重視」
- ❌ 「High-Risk = 高CC」という誤解
- ❌ Health ReportのCC値への一切の注目

**正しい改善対象の特定方法**：
1. **Structural Penalty Breakdown**で最大ペナルティ要因を特定
2. **Most Central Functions**でボトルネック関数を特定
3. **Max Fan-in**異常値の関数を特定
4. **Hub Functions**リストから過度結合関数を特定

**🚨 CRITICAL WARNING**：CC値による機械的リファクタリングは**禁止**
- CC削減 ≠ 品質向上
- CCは判断材料であり、分割決定ではない
- Health Scoreが改善しないリファクタリングは無価値

### 📈 スコア改善目標と成功基準

**🎯 改善目標の設定方法**:
1. **現在のHealth Index**を基準とした具体的な目標設定
2. **構造的ペナルティ**の段階的削減
3. **数値的な成功基準**の明確化

**📊 具体的な改善目標例**:
```
現在: Overall Health Index 18.2/100 (Critical)
目標: Overall Health Index 40.0/100 (Fair) 以上

現在: Max Fan-in 265 (異常値)
目標: Max Fan-in 100未満

現在: Hub Functions 41個
目標: Hub Functions 30個未満

現在: Cyclic Functions 18個  
目標: Cyclic Functions 10個未満

現在: Centrality Gini Coefficient 98.0% (極度不平等)
目標: Centrality Gini Coefficient 90%未満
```

**✅ 改善完了の判定基準**:
- Health Index が20pt以上向上
- Structural Risk が CRITICAL → WARNING 以上に改善
- 最大ペナルティ要因が50%以上削減

### 品質管理の基本フロー

**必須手順（例外なし）**:
1. **改善前**: `npm run dev -- health --verbose` で現状把握
2. **目標設定**: 上記基準に基づく具体的数値目標
3. **改善実施**: 構造的問題に集中した改善
4. **改善後**: 再度health分析で目標達成を確認
5. **PR作成前**: ファイル行数チェック（下記参照）
6. **コミット**: 目標達成時のみコミット実行

### 📏 PR作成前のファイル行数チェック（必須）

**🚨 CRITICAL: 編集ファイルの巨大化防止**

**必須チェックコマンド**:
```bash
# トップ10最大ファイル確認
npm run dev -- files --sort lines --desc --limit 10
```

**分割必要性の判定基準**:
- **編集したファイルがトップ10に入っている場合**: 必ず分割実施
- **1,000行超えのファイル**: 分割を強く推奨
- **500行超えのファイル**: 分割を検討

**トップ10圏外にする手法**:
1. **機能別分割**: 関連する関数群を別ファイルに抽出
2. **レイヤー内shared/**: 共通機能を `layer/shared/` に分離
3. **ユーティリティ抽出**: 汎用関数を `utils/` に移動
4. **型定義分離**: 大きな型定義を別の `.types.ts` ファイルに分離

**分割完了の確認**:
```bash
# 分割後に再確認（編集ファイルがトップ10圏外であることを確認）
npm run dev -- files --sort lines --desc --limit 10
```

**🎯 分割目標**:
- 編集ファイル: トップ10圏外
- 理想的行数: 500行未満
- 最大許容: 800行未満

### 品質改善の基本手法
- **Fan-in削減**: 過度な結合を持つ関数の責務分散
- **Hub関数分割**: 中心的ボトルネック関数の分解
- **循環依存解消**: Cyclic Functions の構造改善
- **中心性分散**: PageRank不平等の改善

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

#### 🚨 CRITICAL: Cyclomatic Complexity（CC）の正しい理解

**CCは「シグナル」であり「決定事項」ではない**

##### ✅ 正しいCC理解
- **CCは複雑さの存在を知らせる温度計**
- **高CC = 判断が必要な箇所**であり、自動的な分割対象ではない
- **複雑なロジックが複雑なのは当然**

##### 🚨 絶対禁止：機械的CC削減
```bash
# ❌ これらは禁止 - CC値による機械的な対象選定
npm run dev -- list --cc-ge 20
npm run dev -- list --sort cc --desc
```

##### 📋 CC値の適切な判断基準

**分割すべき場合**:
- **複数責務混在**: 異なる理由で変更される部分が混在
- **独立概念**: 別々に理解可能なドメイン概念が混在
- **再利用性**: 他の場所でも使用される可能性がある部分

**分割すべきでない場合**:
- **本質的複雑さ**: アルゴリズムや仕様そのものの複雑さ
- **順次処理**: 一連の流れとして理解すべき処理
- **密結合**: 分離すると理解が困難になる部分


#### High Risk関数
以下の条件を満たす関数（**CC値単体ではない**）：
- 複雑度が高い
- ネストが深い
- 行数が多い
- パラメータ数が多い

### 💡 開発時の活用例

#### 1. リファクタリング対象の特定

**🎯 唯一の正しいアプローチ（例外なし）**:
```bash
# 1. 必須：Health Score分析
npm run dev -- health --verbose

# 2. 構造的問題のみに注目（推奨アクションは無視）
# - Structural Penalty Breakdown
# - Most Central Functions  
# - Max Fan-in異常値
# - Hub Functions
```

**🎯 改善対象の優先順位**:
1. **High Coupling (Fan-in)**: 最大ペナルティ要因（-26.5pts等）
2. **Most Central Functions**: PageRank 100%の関数
3. **Hub Functions**: fan-in ≥ 10の関数
4. **Cyclic Functions**: 循環依存を持つ関数

**絶対に従うべき改善目標**:
- Overall Health Index: 現在値 → +20pt以上向上
- Max Fan-in: 現在値 → 100未満
- Hub Functions: 現在数 → 30個未満

**⚠️ 特定ファイルのCC確認（新規関数チェック用のみ）**:
```bash
# ✅ 許可：新規作成したファイル/関数の品質確認
npm run dev -- list --file src/new-feature.ts
npm run dev -- list --name newFunction

# ❌ 禁止：リファクタリング対象の選定
npm run dev -- list --cc-ge 10  # これは禁止
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

**新規追加関数の品質基準（予防的品質管理）:**
- **Health Score向上**: 新規追加によりHealth Scoreが悪化していないことを確認

**リファクタリング効果の評価（改善的品質管理）:**
- **Health Score向上**: 全体的な品質指標（18.2/100等）が改善していることを確認
- **Component Scores改善**: Code Size, Maintainability, Complexityの各スコア向上を確認
- **構造的問題の改善**: Hub関数、循環依存、巨大ファイル等の改善を確認

**共通チェック項目:**
- **High Risk関数の増加**: 新たにHigh Risk関数が生成されていないことを確認
- **関数の分類**: 真の追加か、既存関数の変更・移動・リネームかを把握

#### 品質問題発見時の対応
```bash
# Health Scoreで構造的問題を特定
npm run dev -- health --verbose

# 構造的問題の詳細確認
npm run dev -- dep lint

# リファクタリング実施後に再確認
npm run dev -- diff <before-label> HEAD
```

#### メリット
1. **客観的な品質評価**: 数値による定量的な品質変化の把握
2. **リファクタリング効果の可視化**: 構造的改善の証拠を残せる
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
