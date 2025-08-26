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

### 🔍 基本的なワークフロー

```bash
# 1. 作業開始時にスキャンを実行（ブランチ名でラベル付け）
npm run dev -- scan --label feature/my-branch

# 2. プロジェクトの品質状況を確認
npm run dev -- health

# 3. 作業後に再度スキャンして比較
npm run dev -- scan --label feature/my-branch-after
npm run dev -- diff feature/my-branch feature/my-branch-after
```

### 📊 主要コマンド一覧

#### scan - 関数スキャンと分析
```bash
# 基本スキャン
npm run dev -- scan

# ラベル付きスキャン（推奨）
npm run dev -- scan --label <label-name>

# 詳細分析付きスキャン
npm run dev -- scan --with-basic --with-coupling --with-graph --with-types

# フルスキャン（全解析を含む）
npm run dev -- scan --full

# 非同期実行（重い解析をバックグラウンドで）
npm run dev -- scan --async

# スコープ指定スキャン
npm run dev -- scan --scope src
```

#### list - 関数一覧表示
```bash
# 全関数表示
npm run dev -- list

# 複雑度でフィルタ
npm run dev -- list --cc-ge 10

# ファイルでフィルタ
npm run dev -- list --file src/storage/pglite-adapter.ts

# 関数名でフィルタ
npm run dev -- list --name analyze

# ソートと制限
npm run dev -- list --sort cc --desc --limit 10

# JSON出力
npm run dev -- list --json
```

#### show - 関数詳細表示
```bash
# 関数IDで詳細表示
npm run dev -- show --id 2f1cfe1d

# 関数名パターンで検索
npm run dev -- show "functionName"

# 使用情報を含む詳細表示
npm run dev -- show --id 2f1cfe1d --usage

# 履歴を含む表示
npm run dev -- show --id 2f1cfe1d --history

# ソースコード付き表示
npm run dev -- show --id 2f1cfe1d --source
```

#### files - ファイル情報表示
```bash
# ファイル一覧
npm run dev -- files

# 統計情報付き
npm run dev -- files --stats

# ソート（サイズ順）
npm run dev -- files --sort size --desc

# 言語フィルタ
npm run dev -- files --language typescript

# パスパターンフィルタ
npm run dev -- files --path "src/cli/*"
```

#### health - プロジェクト品質評価
```bash
# 基本品質レポート
npm run dev -- health

# 詳細レポート
npm run dev -- health --verbose

# トレンド分析
npm run dev -- health --trend

# リスク評価
npm run dev -- health --risks

# 差分比較
npm run dev -- health --diff
```

#### history - スナップショット履歴
```bash
# 履歴表示
npm run dev -- history

# 詳細履歴
npm run dev -- history --verbose

# 期間指定
npm run dev -- history --since "2024-01-01" --until "2024-12-31"

# ラベルフィルタ
npm run dev -- history --label feature/my-branch
```

#### diff - スナップショット比較
```bash
# 基本比較
npm run dev -- diff HEAD~1 HEAD

# サマリーのみ
npm run dev -- diff abc123 def456 --summary

# 関数名フィルタ
npm run dev -- diff v1.0 v2.0 --function "handle*"

# 類似度分析付き
npm run dev -- diff HEAD~1 HEAD --insights --similarity-threshold 0.95
```

#### similar - 類似コード検出
```bash
# 類似関数検出
npm run dev -- similar

# 類似度閾値指定
npm run dev -- similar --threshold 0.95

# 最小行数指定
npm run dev -- similar --min-lines 10

# 複数検出アルゴリズム使用
npm run dev -- similar --detectors hash-duplicate,ast-similarity
```

#### dep - 依存関係分析
```bash
# 依存関係一覧
npm run dev -- dep list

# 特定関数の依存関係詳細
npm run dev -- dep show <function-name>

# 依存関係統計
npm run dev -- dep stats

# 依存関係リント
npm run dev -- dep lint

# デッドコード検出
npm run dev -- dep dead

# デッドコード削除
npm run dev -- dep delete --execute

# 循環依存検出
npm run dev -- dep cycles
```

#### db - データベース操作
```bash
# テーブル一覧
npm run dev -- db --list

# テーブル内容確認
npm run dev -- db --table snapshots --limit 5

# WHERE句付きクエリ
npm run dev -- db --table functions --where "cyclomatic_complexity > 10"

# JSON出力
npm run dev -- db --table functions --json

# バックアップ作成
npm run dev -- db export --label "before-refactor"

# バックアップ復元
npm run dev -- db import --backup .funcqc/backups/20241201-143022-before-refactor
```

#### experimental - 実験的機能
```bash
# 関数品質評価
npm run dev -- experimental evaluate

# デバッグ残留物検出
npm run dev -- experimental residue-check

# 関数説明生成
npm run dev -- experimental describe <FunctionName>

# セマンティック検索
npm run dev -- experimental search "error handling"

# リファクタリング機会検出
npm run dev -- experimental detect
```

### 💡 開発時の活用例

#### 1. リファクタリング対象の特定
```bash
# 品質問題のある関数を特定
npm run dev -- health --verbose

# 複雑度の高い関数を確認
npm run dev -- list --cc-ge 10 --sort cc --desc

# 特定ファイル内の関数確認
npm run dev -- list --file src/problem-file.ts
```

#### 2. 変更の影響確認
```bash
# 変更前後の差分確認
npm run dev -- diff HEAD~1 HEAD --insights

# 類似コードへの影響確認
npm run dev -- similar --threshold 0.8
```

#### 3. デッドコードの削除
```bash
# デッドコード検出
npm run dev -- dep dead

# 安全な削除実行
npm run dev -- dep delete --execute
```

### 🎯 品質チェックワークフロー

#### 基本的な手順
```bash
# 1. ブランチ開始時にベースラインスキャン
git checkout -b feature/my-feature
npm run dev -- scan --label feature/my-feature

# 2. 開発作業実施
# [コーディング作業]

# 3. 作業完了後にスキャン
npm run dev -- scan --label feature/my-feature-final

# 4. 品質変化の確認
npm run dev -- diff feature/my-feature feature/my-feature-final
npm run dev -- health --verbose
```

#### 品質問題発見時の対応
```bash
# 問題関数の特定
npm run dev -- list --cc-ge 15

# 依存関係確認
npm run dev -- dep show <問題関数名>

# リファクタリング後の再確認
npm run dev -- scan --label after-refactor
npm run dev -- diff feature/my-feature after-refactor
```

### ⚠️ 注意事項

- スナップショットはPGLiteデータベースに保存される
- `--label`オプションでスナップショットに意味のある名前を付けることを推奨
- `scan --full`は時間がかかるため、通常は基本スキャンで十分
- `--async`オプションで重い解析をバックグラウンド実行可能


