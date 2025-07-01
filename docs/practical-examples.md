# funcqc 実用例集

## 🎯 実際の出力サンプルと解釈

### 1. プロジェクト全体状況の確認

**コマンド**:
```bash
npm run dev status
```

**出力例**:
```
📊 funcqc Status
══════════════════════════════════════════════════

🎯 Quality Overview
──────────────────────────────
  Overall Grade: C (77/100)
  Quality Status: 🟡 Fair - Some refactoring recommended
  ⚠️ High Risk Functions: 17 need attention

  Quality Breakdown:
    Complexity: 60/100
    Maintainability: 97/100
    Size Management: 79/100
    Code Quality: 70/100

  Functions Needing Attention:
    1. handleSingleDescribe (cli/describe.ts) - high complexity (20)
    2. handleBatchDescribe (cli/describe.ts) - high complexity (23)
    3. listCommand (cli/list.ts) - high complexity (19)
```

**AI解釈**:
- プロジェクトは中程度の品質(C評価)
- 複雑度が主な問題領域(60/100)
- 17の関数が要改善
- 最優先は`handleBatchDescribe`関数(複雑度23)

### 2. 高複雑度関数の特定

**コマンド**:
```bash
npm run dev -- list --complexity ">10" --limit 5
```

**出力例**:
```
╔═══════════╤═════════════════════════════╤══════════════════════════════════════╤═══════════╤═══════════╤══════════╤═══════╗
║ ID        │ Name                        │ File                                 │  Location │ Complexit │ Exported │ Async ║
║           │                             │                                      │           │         y │          │       ║
╟───────────┼─────────────────────────────┼──────────────────────────────────────┼───────────┼───────────┼──────────┼───────╢
║ 6f832c2d  │ ⚠️ buildFilters             │ src/cli/list.ts                      │   173-246 │        13 │ ✗        │       ║
║ c2e52a86  │ ⚠️ calculateCyclomaticComplexi │ src/metrics/quality-calculator.ts │   128-160 │        13 │ ✓        │       ║
║ 31541b85  │ ⚠️ calculateOverallQualityTren │ src/cli/history.ts                │   571-598 │        11 │ ✗        │       ║
╚═══════════╧═════════════════════════════╧══════════════════════════════════════╧═══════════╧═══════════╧══════════╧═══════╝
```

**AI解釈**:
- `buildFilters` (list.ts:173-246): 73行、複雑度13 - 関数分割候補
- `calculateCyclomaticComplexity`: エクスポート関数で複雑度13 - 優先改善対象
- 3つとも非同期ではない同期関数

### 3. 関数詳細分析

**コマンド**:
```bash
npm run dev -- show "buildFilters"
```

**出力例**:
```
📋 Function Details

🔗 buildFilters()
   ID: 6f832c2d
   📍 src/cli/list.ts:173-246

📊 Quality Metrics:
   Size:
     Lines of Code: 59 (>40)
     Parameters: 2
   Complexity:
     Cyclomatic: 13 (>10)
     Cognitive: 15
     Max Nesting: 4 (>3)
   Advanced:
     Maintainability Index: 67.3
     Halstead Volume: 782.2

📚 Documentation:
   User Description:
   Constructs database query filters from command line options for function listing.
```

**AI解釈**:
- 複数の品質基準違反(行数、複雑度、ネスト)
- 保守性指数67.3は改善が必要
- 既に説明が記載済み
- 関数分割とネスト削減が有効

### 4. 意味的検索による関連関数発見

**コマンド**:
```bash
npm run dev -- search "quality" --limit 3
```

**出力例**:
```
Search results for "quality" (3 functions found)

ID        Complexity   Function                  File:Line                    Exported Async
──────────────────────────────────────────────────────────────────────────────────────────
eebe7418 11           displaySummary            diff.ts:88                   ✗        ✗
8470fdbd 6            displayCompactFunction... history.ts:397               ✗        ✗
cf6024e8 3            displayFunctionHistory... history.ts:500               ✗        ✗
```

**AI解釈**:
- "quality"キーワードで3関数発見
- `displaySummary`が複雑度11で要注意
- 他は中程度の複雑度

### 5. 品質基準違反の詳細確認

**コマンド**:
```bash
npm run dev -- list --threshold-violations --limit 3
```

**出力例**:
```
🚨 Threshold Violations (3 functions)

 1. ⚠️ buildFilters() [ID: 6f832c2d]
   📍 src/cli/list.ts:173
   📊 Metrics: CC=13, LOC=59, Params=2
   ⚠️ ERROR: cyclomaticComplexity=13(+1.0), linesOfCode=59(+9.0), maxNestingLevel=4
   🎯 Risk Level: HIGH (score: 30.0)

 2. ⚠️ calculateCyclomaticComplexity() [ID: c2e52a86]
   📍 src/metrics/quality-calculator.ts:128
   📊 Metrics: CC=13, LOC=24, Params=1
   ⚠️ ERROR: cyclomaticComplexity=13(+1.0), maxNestingLevel=5(+1.0)
   🎯 Risk Level: HIGH (score: 6.0)
```

**AI解釈**:
- 各関数の具体的違反内容を詳細表示
- リスクスコアで優先度判定可能
- `buildFilters`はスコア30.0で最優先

## 🔄 実際の問題解決フロー

### シナリオ1: 複雑な関数の改善

**Step 1: 問題特定**
```bash
npm run dev -- list --threshold-violations
# → buildFilters関数が複雑度13で発見
```

**Step 2: 詳細分析**
```bash
npm run dev -- show "buildFilters"
# → 59行、4重ネスト、複雑度13が判明
```

**Step 3: 関連関数調査**
```bash
npm run dev -- search "filter"
npm run dev -- list --file "**/list.ts"
# → 同一ファイル内の関連関数を確認
```

**Step 4: 改善後確認**
```bash
npm run dev scan
npm run dev -- show "buildFilters"
# → 改善効果を数値で確認
```

### シナリオ2: showコマンドの正しい使い方

**問題**: IDで関数を表示したいがエラーが出る

**❌ 間違った使い方**:
```bash
npm run dev -- show "13b46d5e"
# エラー: No functions found matching pattern '13b46d5e'.
```

**✅ 正しい使い方**:
```bash
# ID指定には--idオプションが必須
npm run dev -- show --id "13b46d5e"
```

**出力例**:
```
📋 Function Details

🔗 Logger.info()
   ID: 13b46d5e
   📍 src/utils/cli-utils.ts:38-44

📝 Signature:
   public Logger.info(message: string, details?: LogDetails): void

🏷️  Attributes:
   exported, method

📚 Documentation:
   User Description:
   Displays an informational message with blue info icon...
```

**名前パターンでの検索**:
```bash
# 関数名で検索
npm run dev -- show "info"

# メソッド名で検索
npm run dev -- show "Logger.info"

# ワイルドカード使用
npm run dev -- show "*Auth*"
```

### シナリオ3: 重複コードの発見

**Step 1: 類似性検出**
```bash
npm run dev -- similar --threshold 0.8
# → 重複の可能性がある関数ペアを発見
```

**Step 2: 詳細比較**
```bash
npm run dev -- show "function1"
npm run dev -- show "function2"
# → 両関数の詳細を比較
```

**Step 3: 共通処理の抽出**
```bash
npm run dev -- search "common functionality"
# → 既存の共通処理関数を探索
```

## 📊 JSON出力の活用例

### パイプライン処理
```bash
# 複雑度10以上の関数名一覧
npm run dev -- list --complexity ">10" --json | jq '.[].name'

# エクスポート関数の平均複雑度
npm run dev -- list --exported --json | jq '[.[].metrics.cyclomaticComplexity] | add / length'

# ファイル別関数数
npm run dev -- list --json | jq 'group_by(.filePath) | map({file: .[0].filePath, count: length})'
```

### 品質レポート生成
```bash
# 週次品質サマリー
npm run dev -- trend --weekly --json > weekly-quality.json

# 問題関数リスト
npm run dev -- list --threshold-violations --json > violations.json

# 全関数メトリクス
npm run dev -- list --json > all-functions.json
```

## 🎨 効果的な調査パターン

### パターンA: トップダウン調査
```bash
1. npm run dev status                          # 全体把握
2. npm run dev -- list --threshold-violations # 問題特定
3. npm run dev -- show "specificFunction"     # 詳細分析
4. npm run dev -- search "relatedKeyword"     # 関連探索
```

### パターンB: ボトムアップ調査
```bash
1. npm run dev -- search "targetKeyword"      # キーワード検索
2. npm run dev -- list --name "*pattern*"     # パターン展開
3. npm run dev -- show "targetFunction"       # 詳細確認
4. npm run dev -- list --file "sameFile"      # 同一ファイル内探索
```

### パターンC: 横断的調査
```bash
1. npm run dev -- similar --threshold 0.8     # 類似性検出
2. npm run dev -- list --lines ">50"          # 大きな関数
3. npm run dev -- trend --weekly              # 品質推移
4. npm run dev -- list --no-description       # 文書化状況
```

## 🚀 効率化のコツ

### 1. 段階的詳細化
- 広い検索から始めて段階的に絞り込む
- 複数のフィルタを組み合わせて精密検索

### 2. 出力形式の使い分け
- 調査: デフォルト表示(色付き、読みやすい)
- 処理: JSON出力(プログラム処理可能)
- 報告: 具体的な数値とファイル位置を引用

### 3. よく使う組み合わせ
```bash
# エクスポートされた複雑な関数
npm run dev -- list --exported --complexity ">5" --sort complexity:desc

# 大きくて複雑な関数
npm run dev -- list --lines ">40" --complexity ">10"

# 文書化が必要なエクスポート関数
npm run dev -- list --exported --no-description --complexity ">5"

# 非同期関数の品質確認
npm run dev -- list --async --threshold-violations
```

## 📝 関数文書化の実際のワークフロー

### 完全な文書化フローの実例

**Step 1: 文書化が必要な関数の特定**
```bash
npm run dev -- list --needs-description --show-id --limit 3
```

**出力例**:
```
╔═══════════╤═════════════════════════════╤══════════════════════════════════════╤═══════════╤═══════════╤══════════╤═══════╗
║ ID        │ Name                        │ File                                 │  Location │ Complexit │ Exported │ Async ║
╟───────────┼─────────────────────────────┼──────────────────────────────────────┼───────────┼───────────┼──────────┼───────╢
║ c88edcfc  │ ✅ truncate                 │ src/cli/search.ts                    │   129-132 │         2 │ ✗        │       ║
║ 2e25b3da  │ ✅ displayFunctionContext   │ src/cli/show.ts                      │   321-330 │         4 │ ✗        │       ║
║ dd7bfb4f  │ ✅ debug                    │ src/utils/cli-utils.ts               │     54-60 │         1 │ ✓        │       ║
╚═══════════╧═════════════════════════════╧══════════════════════════════════════╧═══════════╧═══════════╧══════════╧═══════╝
```

**Step 2: 最初の関数(truncate)の内容確認**
```bash
# ファイルと行番号から内容を読み取る
Read src/cli/search.ts:129
```

**関数の内容**:
```typescript
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
```

**Step 3: 英語で説明を登録**
```bash
npm run dev -- describe "c88edcfc" --text "Truncates text to specified maximum length, appending ellipsis if text exceeds the limit"
```

**出力**:
```
ℹ️  Info: ✓ Description saved for function: truncate
ℹ️  Info:   Function ID: c88edcfc
ℹ️  Info:   Description: Truncates text to specified maximum length, appending ellipsis if text exceeds the limit
ℹ️  Info:   Source: human
```

**Step 4: 文書化状況の確認**
```bash
npm run dev -- show --id "c88edcfc"
```

**出力例**:
```
📚 Documentation:
   User Description:
   Truncates text to specified maximum length, appending ellipsis if text exceeds the limit
```

### テーブルが崩れる場合の対処

```bash
# テーブルレンダリングが失敗してIDが見えない場合
npm run dev -- list --needs-description --show-id --format friendly
```

**friendly形式の出力**:
```
📋 Function List (3 functions)

 1. ✅ truncate() [ID: c88edcfc]
   📍 src/cli/search.ts:129
   📊 Metrics: CC=2, LOC=4, Params=2
   📈 Maintainability Index: 100.0
```

## 🔍 トラブルシューティング実例

### 問題: "showコマンドでID指定ができない"

```bash
# 現象
npm run dev -- show "13b46d5e"
# エラー: No functions found matching pattern '13b46d5e'.

# 原因
# IDを名前パターンとして検索している

# 解決策
npm run dev -- show --id "13b46d5e"  # --idオプションを使用
```

### 問題: "関数が見つからない"
```bash
# 段階的検索
npm run dev -- list --name "*partialName*"    # 部分一致
npm run dev -- search "functionality"         # 機能検索
npm run dev -- list --file "**/target/*.ts"   # ファイル指定
```

### 問題: "出力が多すぎる"
```bash
# 結果の絞り込み
npm run dev -- list --limit 10                # 件数制限
npm run dev -- list --complexity ">5"         # 条件絞り込み
npm run dev -- list --exported               # 属性絞り込み
```

### 問題: "品質が改善されたかわからない"
```bash
# Before/After比較
npm run dev scan --label "before-refactor"
# (リファクタリング実施)
npm run dev scan --label "after-refactor"
npm run dev -- diff "before-refactor" "after-refactor"
```