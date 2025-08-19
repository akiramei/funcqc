# funcqc チートシート

## 🚀 クイックスタート

```bash
# 初期化 (1回のみ)
npm run dev init

# 基本ワークフロー
npm run dev scan                              # 関数分析
npm run dev -- list --threshold-violations   # 問題関数確認
npm run dev status                           # プロジェクト概要
```

## 📋 全コマンド一覧

### 初期化・設定
```bash
npm run dev init                    # プロジェクト初期化
npm run dev init --show            # 現在の設定表示
npm run dev init --reset           # 設定リセット
```

### スキャン・分析
```bash
npm run dev scan                    # 全ファイルスキャン
npm run dev scan --quick           # 高速スキャン（5秒概要）
npm run dev scan --dry-run         # 実行テスト（保存なし）
npm run dev scan --label "v1.0"    # ラベル付きスキャン
npm run dev scan --incremental     # 変更ファイルのみ
```

### 関数検索・一覧
```bash
# 基本一覧
npm run dev list                    # 全関数表示
npm run dev -- list --limit 10     # 件数制限
npm run dev -- list --json         # JSON出力

# フィルタ検索
npm run dev -- list --name "*Auth*"           # 名前パターン
npm run dev -- list --file "**/auth/*.ts"     # ファイルパターン
npm run dev -- list --exported               # エクスポート関数のみ
npm run dev -- list --async                  # 非同期関数のみ

# 品質ベース検索
npm run dev -- list --complexity ">10"       # 複雑度高
npm run dev -- list --lines ">50"           # 長い関数
npm run dev -- list --params ">4"           # パラメータ多
npm run dev -- list --threshold-violations   # 品質基準違反

# ソート・表示
npm run dev -- list --sort complexity:desc   # 複雑度降順
npm run dev -- list --sort lines:desc        # 行数降順
npm run dev -- list --fields name,complexity,lines  # 表示項目指定
```

### 関数詳細表示
```bash
# ❗ 重要: ID指定には--idオプションが必須
npm run dev -- show --id "13b46d5e"  # ID指定（正しい）
npm run dev -- show "functionName"   # 関数名で検索
npm run dev -- show "Logger.info"    # メソッド名もOK

# ❌ 間違いやすい使い方
npm run dev -- show "13b46d5e"      # IDを名前として検索してしまう
```

### 意味的検索
```bash
npm run dev -- search "authentication"  # キーワード検索
npm run dev -- search "database"       # DB関連関数
npm run dev -- search "validation"     # 検証系関数
```

### 品質分析
```bash
npm run dev status                     # プロジェクト状況
npm run dev status --verbose          # 詳細情報
```

### 履歴・比較
```bash
npm run dev history                    # スナップショット履歴
npm run dev history --limit 10        # 件数制限
npm run dev -- history --since "2024-01-01"  # 期間指定

npm run dev -- diff latest main       # スナップショット比較
npm run dev -- diff --summary         # 概要のみ
```

### トレンド分析
```bash
npm run dev -- trend --weekly         # 週次トレンド
npm run dev -- trend --monthly        # 月次トレンド
npm run dev -- trend --period 30      # 30日期間
```

### 類似性検出
```bash
npm run dev -- similar                # 類似関数検出
npm run dev -- similar --threshold 0.8  # 類似度閾値
npm run dev -- similar --min-lines 10   # 最小行数
```

### 関数説明管理
```bash
# 説明追加（IDまたは名前で指定）
npm run dev -- describe "13b46d5e" --text "Description in English"
npm run dev -- describe "functionName" --text "Description"

# 説明が必要な関数の確認
npm run dev -- list --no-description --exported    # 未文書化関数
npm run dev -- list --needs-description --show-id  # 更新要+ID表示

# 💡 効率的な文書化ワークフロー
npm run dev -- list --needs-description --show-id --format friendly
```

## 📄 出力フォーマットの使い分け

### 利用可能なフォーマット

| フォーマット | 用途 | 特徴 |
|------------|------|------|
| `table` (デフォルト) | 一般的な確認 | テーブル形式、レスポンシブ |
| `friendly` | 詳細分析 | 縦型、メトリクス詳細 |
| `json` | 自動処理 | 構造化データ |

```bash
# テーブル形式（デフォルト）
npm run dev -- list --show-id

# フレンドリー形式（ID確実に表示）
npm run dev -- list --format friendly --show-id

# JSON形式（パイプライン処理）
npm run dev -- list --format json | jq '.functions[].id'
```

### 💡 テーブルレンダリング失敗時

テーブル表示が失敗した場合、自動的にシンプルリストにフォールバックされます。
IDが表示されない場合は`--format friendly`を使用してください。

## 🎯 用途別コマンド選択ガイド

### 品質確認したい
```bash
# Step 1: 全体状況確認
npm run dev status

# Step 2: 問題関数特定
npm run dev -- list --threshold-violations

# Step 3: 詳細分析
npm run dev -- show "problemFunction"
```

### 関数を探したい
```bash
# 名前が分かっている場合
npm run dev -- list --name "*keyword*"
npm run dev -- show "functionName"

# 機能から探す場合
npm run dev -- search "authentication"
npm run dev -- search "validation"

# 品質特性で絞り込む場合
npm run dev -- list --complexity ">10" --exported
npm run dev -- list --async --lines ">30"
```

### リファクタリング対象を見つけたい
```bash
# 複雑な関数
npm run dev -- list --complexity ">10" --sort complexity:desc

# 大きな関数
npm run dev -- list --lines ">50" --sort lines:desc

# 重複コード
npm run dev -- similar --threshold 0.8

# 品質劣化確認
npm run dev -- trend --weekly
```

### 品質改善効果を測定したい
```bash
# Before: スキャン実行
npm run dev scan --label "before-refactor"

# After: リファクタリング後スキャン
npm run dev scan --label "after-refactor"

# 比較
npm run dev -- diff "before-refactor" "after-refactor"
```

## 🔧 よく使うオプション組み合わせ

```bash
# 高複雑度のエクスポート関数TOP10
npm run dev -- list --complexity ">5" --exported --sort complexity:desc --limit 10

# 大きくて複雑な関数
npm run dev -- list --complexity ">10" --lines ">40"

# 非同期の問題関数
npm run dev -- list --async --threshold-violations

# ファイル別品質確認
npm run dev -- list --file "src/cli/*.ts" --threshold-violations

# 説明が必要なエクスポート関数
npm run dev -- list --exported --no-description --complexity ">5"
```

## 📝 関数文書化の完全ワークフロー

### 基本フロー

```bash
# Step 1: 文書化が必要な関数をID付きで表示
npm run dev -- list --needs-description --show-id

# Step 2: テーブルから情報を読み取る
# ID: 13b46d5e
# File: src/utils/cli-utils.ts
# Location: 38-44

# Step 3: 関数の内容を確認
Read src/utils/cli-utils.ts:38

# Step 4: 英語で説明を登録
npm run dev -- describe "13b46d5e" --text "Displays informational message with blue icon"
```

### 効率化のTips

1. **複数関数の一括処理**
   ```bash
   # エクスポート関数優先
   npm run dev -- list --needs-description --exported --show-id
   
   # 複雑な関数優先
   npm run dev -- list --needs-description --complexity ">5" --show-id
   ```

2. **確実なID表示**
   ```bash
   # テーブルが崩れる場合
   npm run dev -- list --needs-description --show-id --format friendly
   ```

3. **文書化状況の確認**
   ```bash
   # 文書化済み関数の確認
   npm run dev -- show --id "13b46d5e"
   ```

## ⚡ パフォーマンス最適化

```bash
# 大規模プロジェクト用
npm run dev scan --batch-size 50

# 開発中の高速チェック
npm run dev scan --quick

# 変更分のみ分析
npm run dev scan --incremental

# JSON出力でパイプライン処理
npm run dev -- list --json | jq '.[] | select(.complexity > 10)'
```

## 📊 可視化（DOT形式出力）

```bash
# 依存関係グラフ生成
npm run dev -- dep stats --format dot > deps.dot
dot -Tpng deps.dot -o deps.png

# リスク分析の可視化
npm run dev -- risk analyze --format dot --severity high > risk.dot
dot -Tsvg risk.dot -o risk.svg

# デッドコードの可視化
npm run dev -- dead --format dot --exclude-tests > dead.dot

# オンラインで表示（GraphViz Online）
npm run dev -- dep stats --format dot | pbcopy  # クリップボードにコピー
# https://dreampuf.github.io/GraphvizOnline/ で貼り付け
```

### DOT形式の活用例

```bash
# CI/CDパイプラインでの自動生成
npm run dev -- risk analyze --format dot --severity critical > critical-risk.dot
npm run dev -- dep stats --format dot --show-hubs > hubs.dot

# バッチ変換
for f in *.dot; do dot -Tpng "$f" -o "${f%.dot}.png"; done
```

## 🚨 トラブルシューティング

```bash
# システム要件確認
npm run dev -- --check-system

# 設定確認
npm run dev init --show

# データベース状況確認
npm run dev status --verbose

# 設定リセット
npm run dev init --reset
```

## 💡 Tips

### エイリアス設定 (package.json推奨)
```json
{
  "scripts": {
    "q:scan": "npm run dev scan",
    "q:check": "npm run dev -- list --threshold-violations",
    "q:status": "npm run dev status",
    "q:complex": "npm run dev -- list --complexity '>10' --limit 10"
  }
}
```

### よくあるユースケース
1. **日常チェック**: `npm run dev status` → 問題があれば `npm run dev -- list --threshold-violations`
2. **関数調査**: `npm run dev -- search "keyword"` → `npm run dev -- show "function"`
3. **リファクタリング**: `npm run dev -- similar` → `npm run dev -- list --complexity ">10"`
4. **品質トレンド**: `npm run dev -- trend --weekly`

### コマンド短縮のポイント
- `npm run dev --` を使ってオプション付きコマンド実行
- `--json` でパイプライン処理可能
- `--limit` で大量出力を制御
- 複数フィルタの組み合わせで精密検索