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

### 🔍 基本的なワークフロー（新コマンド体系）

```bash
# 1. 作業開始時にスナップショットを作成（ブランチ名でラベル付け）
npm run dev -- measure --label feature/my-branch

# 2. 関数の状況を確認
npm run dev -- assess

# 3. 作業後に再度スキャンして比較
npm run dev -- measure --label feature/my-branch-after
npm run dev -- manage --action=diff --from HEAD~1 --to HEAD  # 変更内容の確認
```

### 📊 主要コマンド一覧

#### measure - 関数測定と分析（scanの進化版）
```bash
# 基本測定（scanの後継）
npm run dev -- measure

# ラベル付き測定（推奨）
npm run dev -- measure --label <label-name>

# 高度な分析付き測定
npm run dev -- measure --level complete --call-graph --types --coupling

# 広範囲分析（旧scanの完全代替）
npm run dev -- measure --full --with-graph --with-types --with-coupling
```

#### inspect - 統合検査コマンド（list、files、show、searchの統合）
```bash
# 全関数表示（旧listの代替）
npm run dev -- inspect

# 関数一覧の表示
npm run dev -- inspect

# ファイルでフィルタ
npm run dev -- inspect --file src/storage/pglite-adapter.ts

# 関数名でフィルタ（旧searchの代替）
npm run dev -- inspect --name analyze

# 詳細情報表示（旧showの代替）
npm run dev -- inspect --detailed --name <function-name>

# ファイル一覧（旧filesの代替）
npm run dev -- inspect --type files --sort lines --desc --limit 10
```

#### assess - 統合品質評価コマンド（高度なAI分析機能付き）
```bash
# 基本品質レポート（旧healthの代替）
npm run dev -- assess --type health

# 詳細レポート（従来のhealth --verboseの代替）
npm run dev -- assess --type health --verbose

# 分析
npm run dev -- assess

# コード品質評価（旧evaluateの代替）
npm run dev -- assess --type quality

# 型システム品質評価
npm run dev -- assess --type types
```

#### 履歴管理
```bash
# スナップショット履歴を表示（旧historyの代替）
npm run dev -- manage --action=history

# 測定履歴を表示
npm run dev -- measure --history
```

#### diff - 変更差分
```bash
# スナップショット間の差分
npm run dev -- manage --action=diff --from <from> --to <to>

# 指定可能な値：
# - スナップショットID: fd526278
# - ラベル: main
# - HEAD記法: HEAD, HEAD~1, HEAD~3

# 類似関数の洞察付き
npm run dev -- manage --action=diff --from <from> --to <to> --insights

# カスタム類似度閾値（デフォルト: 0.95）
npm run dev -- manage --action=diff --from <from> --to <to> --similarity-threshold 0.8
```

#### ファイル分析（inspectに統合）
```bash
# 行数の多いファイルTOP10（旧filesの代替）
npm run dev -- inspect --type files --sort lines --desc --limit 10

# 関数数の多いファイル
npm run dev -- inspect --type files --sort funcs --desc --limit 10

# ファイル統計情報表示
npm run dev -- inspect --type files --stats
```

#### improve - コード改善（similar、safe-delete、refactor-guardの統合）
```bash
# 重複・類似コードの検出（旧similarの代替）
npm run dev -- improve --type duplicates

# カスタム類似度闾値
npm run dev -- improve --type duplicates --threshold 0.8

# デッドコード検出（旧safe-deleteの代替）
npm run dev -- improve --type dead-code

# リファクタリング安全性分析（旧refactor-guardの代替）
npm run dev -- improve --type safety

# 包括的改善分析
npm run dev -- improve
```

#### manage - データ管理（db、diff、export、import、historyの統合）
```bash
# テーブル一覧
npm run dev -- manage --action=db --list

# テーブル内容確認
npm run dev -- manage --action=db --table snapshots --limit 5
npm run dev -- manage --action=db --table functions --where "cyclomatic_complexity > 10" --limit 10

# JSON出力（他ツールとの連携用）
npm run dev -- manage --action=db --table functions --json | jq '.rows[0]'

# データエクスポート
npm run dev -- manage --action=export --format json

# バックアップ一覧
npm run dev -- manage --action=list-backups
```

#### dependencies - 依存関係分析（depの進化版）
```bash
# 依存関係概要（depコマンドの後継）
npm run dev -- dependencies

# 基本的な依存関係分析
npm run dev -- dependencies --action=lint
```




### 💡 開発時の活用例

#### 1. リファクタリング対象の特定

**🎯 リファクタリング対象の特定方法**:
```bash
# 品質問題を把握
npm run dev -- assess
```

**⚠️ 特定ファイルの確認**:
```bash
# 新規作成したファイル/関数の確認
npm run dev -- inspect --file src/new-feature.ts
npm run dev -- inspect --name newFunction
```

#### 2. 変更の影響確認
```bash
# 変更前後の差分と類似関数
npm run dev -- manage --action=diff --from HEAD~1 --to HEAD --insights

# 新規追加された関数の確認
npm run dev -- manage --action=diff --from <ブランチ開始時のラベル> --to HEAD
```

#### 3. 重複コードの発見
```bash
# 類似関数のグループを表示（旧similarの代替）
npm run dev -- improve --type duplicates

# カスタム類似度闾値で検出
npm run dev -- improve --type duplicates --threshold 0.8
```

### 🎯 diffコマンドによる品質チェック手法

**開発ワークフロー**: ブランチ作業開始時にスナップショットを取得し、作業完了後にdiffコマンドで品質変化を確認

#### 基本的な手順
```bash
# 1. ブランチ開始時にベースラインスナップショット作成
git checkout -b feature/my-feature
npm run dev -- measure --label feature/my-feature

# 2. 開発作業を実施
# [コーディング作業]

# 3. 作業完了後にスナップショット作成
npm run dev -- measure --label feature/my-feature-final

# 4. 品質変化の確認（重要）
npm run dev -- manage --action=diff --from feature/my-feature --to HEAD
```


#### 品質問題発見時の対応
```bash
# 品質問題を特定
npm run dev -- assess

# 依存関係の詳細確認
npm run dev -- dependencies --action=lint

# リファクタリング実施後に再確認
npm run dev -- manage --action=diff --from <before-label> --to HEAD
```

#### メリット
1. **客観的な品質評価**: 数値による定量的な品質変化の把握
2. **リファクタリング効果の可視化**: 改善の証拠を残せる
3. **品質劣化の早期発見**: 品質問題を検出
4. **レビュー時の情報提供**: PRレビューで品質変化を明示可能

### ⚠️ 注意事項

- スナップショットはDBに保存されるが、現在の実装では一部のデータが永続化されない場合がある
- `--label`オプションを使用してスナップショットに意味のある名前を付けることを推奨
- PGLiteはWebAssemblyベースのPostgreSQLなので、通常のPostgreSQLクライアントは使用不可


