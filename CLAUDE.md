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

コミット前の必須手順として`function-indexer`を使用してコードの品質を計測し、High Risk関数が0件であることを確認する。

### function-indexer 基本ワークフロー

```bash
# Step 1: メトリクス収集（コード変更後は必須）
npx github:akiramei/function-indexer metrics collect --root ./src

# Step 2: 品質確認（High Risk関数のチェック）
npx github:akiramei/function-indexer metrics trends

# Step 3: High Risk関数が1件以上の場合は修正して Step 1 に戻る
# Step 4: High Risk関数が0件になるまで繰り返し
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
```bash
# function-indexerの短縮形
fx metrics collect --root ./src    # メトリクス収集
fx metrics trends                  # 品質確認
fx metrics                         # 概要表示
```

詳細な使い方は `@~/.claude/templates/function-indexer/AI-INTEGRATION.md` を参照。

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