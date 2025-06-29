# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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