# funcqc (Function Quality Control)

> TypeScript関数の品質管理・分析ツール

## 概要

funcqc は TypeScript プロジェクトの関数を自動分析し、品質指標の測定、変更履歴の追跡、類似関数の検出、**関数系譜追跡（lineage tracking）**を行うコマンドライン ツールです。AI による意味解析と外部ツール連携により、コードの品質向上とリファクタリングを支援します。

## 特徴

- ✅ **ゼロ設定で開始**: `funcqc init` で即座に利用開始
- 📊 **包括的な品質指標**: 複雑度、行数、ネストレベルなど
- 🔍 **関数の変更履歴追跡**: Git連携による品質変化の可視化
- 🔄 **関数系譜追跡**: リネーム・分割・統合など関数の進化を自動検出
- 📝 **関数説明管理**: 自動変更検知付きの包括的文書化システム
- 🤖 **AI支援分析**: 意味的類似性検出とリファクタリング提案
- 📈 **DOT形式可視化**: 依存関係・リスク・デッドコードのグラフ生成
- 🔗 **外部ツール連携**: mizchi/similarity等の高性能ツール活用
- 🚀 **CI/CD統合**: GitHub Actions での自動品質チェック・系譜分析
- 💾 **完全ポータブル**: PGLite による環境依存なし

## クイックスタート

```bash
# インストール
npm install -g funcqc

# 初期化
funcqc init

# 関数分析・保存
funcqc scan

# 関数一覧表示
funcqc list

# 品質ランキング
funcqc list --sort complexity:desc --limit 10

# 関数系譜分析（リファクタリング前後の関数追跡）
funcqc diff main feature/refactor --lineage
```

## 主要コマンド

| コマンド | 説明 |
|---------|------|
| `funcqc init` | プロジェクト初期化 |
| `funcqc scan` | 関数分析・データ保存 |
| `funcqc list` | 関数一覧・検索 |
| `funcqc describe` | 関数説明管理 |
| `funcqc history` | スナップショット履歴 |
| `funcqc diff` | 変更差分表示 |
| `funcqc diff --lineage` | 関数系譜分析・リファクタリング追跡 |
| `funcqc lineage list` | 系譜レコード一覧・フィルタリング |
| `funcqc lineage show` | 系譜詳細表示 |
| `funcqc lineage review` | 系譜承認・却下管理 |
| `funcqc similar` | 類似関数検出 |
| `funcqc suggest` | AI改善提案 (Phase 3) |

## ドキュメント

詳細な設計資料は [docs/](./docs/) フォルダをご覧ください：

### 基本機能
- [技術アーキテクチャ](./docs/architecture.md)
- [開発ロードマップ](./docs/roadmap.md)
- [CLI設計](./docs/cli-design.md)
- [データモデル](./docs/data-model.md)
- [実装ガイド](./docs/implementation-guide.md)
- [ユーザーシナリオ](./docs/user-scenarios.md)

### 関数系譜追跡（Lineage Tracking）
- [系譜追跡概要](./docs/lineage-tracking.md) - 機能概要と利用シーン
- [CLIコマンドリファレンス](./docs/lineage-cli-commands.md) - 全コマンドの詳細説明
- [GitHub Actions統合](./docs/github-actions-lineage.md) - CI/CD連携ガイド
- [データベーススキーマ](./docs/lineage-database-schema.md) - スキーマ設計と移行
- [トラブルシューティング](./docs/lineage-troubleshooting.md) - 問題解決ガイド

## 開発状況

**Current Phase**: 関数系譜追跡機能完了 (Phase 4 完了)

- [x] **Phase 1**: 基本機能実装（scan, list, diff等）
- [x] **Phase 2**: 高度な検索・フィルタリング機能
- [x] **Phase 3**: 関数説明管理・文書化機能
- [x] **Phase 4**: 関数系譜追跡（Lineage Tracking）
  - [x] 系譜検出アルゴリズム実装
  - [x] CLI統合（diff --lineage, lineage コマンド群）
  - [x] GitHub Actions 自動分析ワークフロー
  - [x] 包括的ドキュメント作成
- [ ] **Phase 5**: AI支援機能・意味解析 (予定)

## 貢献

Issues や Pull Requests は大歓迎です。開発に参加される方は [実装ガイド](./docs/implementation-guide.md) をご確認ください。

## ライセンス

MIT License

## 関連プロジェクト

- [mizchi/similarity](https://github.com/mizchi/similarity) - 高性能な構造類似性検出
- [PGLite](https://github.com/electric-sql/pglite) - ポータブルなPostgreSQL実装
