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

- Unit tests for analyzers and calculators in `test/`
- E2E tests for CLI commands in `test/e2e/`
- Test fixtures in `test/fixtures/`
- Separate Vitest configs for unit and E2E tests

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
npm run dev -- list --threshold-violations

# Step 3: High Risk関数が1件以上の場合は修正して Step 1 に戻る
# Step 4: High Risk関数が0件になるまで繰り返し
```

### 高度な品質管理フロー

funcqcの高機能を活用した包括的品質管理:

```bash
# Phase 1: 基本品質確認
npm run dev status                          # プロジェクト全体状況 (A-Fグレード)
npm run dev -- list --threshold-violations  # High Risk関数の確認

# Phase 2: 詳細分析
npm run dev -- list --complexity ">10" --limit 10  # 複雑な関数TOP10
npm run dev -- similar --threshold 0.8             # 重複コード検出
npm run dev -- trend --weekly                      # 品質トレンド分析

# Phase 3: 改善計画
npm run dev -- show "functionName"                 # 問題関数の詳細分析
npm run dev -- search "keyword"                    # 関連関数の発見
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
    "quality:check": "npm run dev -- list --threshold-violations",
    "quality:status": "npm run dev status",
    "quality:trends": "npm run dev -- trend --weekly",
    "quality:complex": "npm run dev -- list --complexity '>10' --limit 10"
  }
}
```

使用例:
```bash
npm run quality:scan     # メトリクス収集
npm run quality:check    # 品質確認
npm run quality:status   # 概要表示
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
npm run dev -- trend --weekly           # 週次品質推移
npm run dev -- diff main HEAD --summary # ブランチ間品質比較
npm run dev status                      # プロジェクト全体状況

# 🔍 問題関数の追跡
npm run dev -- history --id "func-id"   # 特定関数の履歴追跡
npm run dev -- describe "func-name" --text "explanation" # 関数説明追加
```

### 品質改善の新しいアプローチ

```bash
# 🎯 リファクタリング機会の発見
npm run dev -- similar --threshold 0.8 --min-lines 10  # 重複コード特定
npm run dev -- list --lines ">50" --complexity ">10"   # 大きく複雑な関数

# 📉 保守性向上のための文書化
npm run dev -- list --no-description --exported        # 文書化が必要なエクスポート関数
npm run dev -- list --needs-description               # 更新されたが説明が古い関数
```

## 📄 funcqc クイックリファレンス

### 🏆 状況別コマンド選択

| 目的 | 第1選択 | 第2選択 | 詳細確認 |
|------|---------|---------|----- ----|
| **関数発見** | `search "keyword"` | `list --name "*pattern*"` | `show "funcName"` |
| **品質確認** | `status` | `list --threshold-violations` | `trend --weekly` |
| **問題調査** | `list --complexity ">10"` | `similar --threshold 0.8` | `show "problemFunc"` |
| **コードレビュー** | `list --exported --complexity ">5"` | `list --no-description` | `diff branch1 branch2` |

### 🚀 効率的調査フロー

**AIアシスタント向け推奨フロー**:

```bash
# Step 1: 全体把握 (必須)
npm run dev status

# Step 2: 問題特定 (課題発見)
npm run dev -- list --threshold-violations

# Step 3: 詳細分析 (深掘り)
npm run dev -- show "関数名"

# Step 4: 関連探索 (横断調査)
npm run dev -- search "キーワード"
```

### 📊 よく使うコマンド組み合わせ

```bash
# 複雑なエクスポート関数TOP10
npm run dev -- list --complexity ">5" --exported --sort complexity:desc --limit 10

# 大きく複雑な関数
npm run dev -- list --complexity ">10" --lines ">40"

# 非同期の問題関数
npm run dev -- list --async --threshold-violations

# 文書化が必要なエクスポート関数
npm run dev -- list --exported --no-description --complexity ">5"
```

### ⚠️ コマンド実行時の注意点

**正しい書き方**:
```bash
✅ npm run dev -- list --threshold-violations
✅ npm run dev -- show "functionName"
✅ npm run dev -- list --complexity ">10"
```

**間違いやすい書き方**:
```bash
❌ npm run dev list --threshold-violations    # --がない
❌ npm run dev show functionName             # 引用符なし
❌ npm run dev list --complexity >10         # 特殊文字未エスケープ
```

### 🔍 関数探索の段階的アプローチ

1. **幅広検索**: `search "keyword"` - キーワードで関連関数を発見
2. **パターン検索**: `list --name "*pattern*"` - 名前パターンで絞り込み
3. **詳細確認**: `show "functionName"` - 特定関数の詳細情報
4. **関連探索**: `list --file "sameFile.ts"` - 同一ファイル内の関連関数

### 📈 出力形式の使い分け

- **人間向け**: デフォルト表示 (色付き、表形式)
- **AI処理向け**: `--json` オプション (構造化データ)
- **パイプライン処理**: `| jq` 等で後処理可能

### 📚 詳細ガイド

包括的なコマンドリファレンス: [funcqc-cheatsheet.md](./docs/funcqc-cheatsheet.md)
AI統合ガイド: [ai-integration-guide.md](./docs/ai-integration-guide.md)
実用例集: [practical-examples.md](./docs/practical-examples.md)

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
npm run dev -- trend --weekly | grep "Overall Grade"
npm run dev -- list --threshold-violations --json | jq '.length'
npm run dev -- status | grep "Risk Functions"
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