# funcqc (Function Quality Control)

> TypeScript関数の品質管理・分析ツール

## 概要

funcqc は TypeScript プロジェクトの関数を自動分析し、品質指標の測定、変更履歴の追跡、類似関数の検出を行うコマンドライン ツールです。AI による意味解析と外部ツール連携により、コードの品質向上とリファクタリングを支援します。

## 特徴

- ✅ **ゼロ設定で開始**: `funcqc init` で即座に利用開始
- 📊 **包括的な品質指標**: 複雑度、行数、ネストレベルなど
- 🔍 **関数の変更履歴追跡**: Git連携による品質変化の可視化
- 📝 **関数説明管理**: 自動変更検知付きの包括的文書化システム
- 🤖 **AI支援分析**: 意味的類似性検出とリファクタリング提案
- 🔗 **外部ツール連携**: mizchi/similarity等の高性能ツール活用
- 🚀 **CI/CD統合**: GitHub Actions での自動品質チェック
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
| `funcqc similar` | 類似関数検出 |
| `funcqc suggest` | AI改善提案 (Phase 3) |

## ドキュメント

詳細な設計資料は [docs/](./docs/) フォルダをご覧ください：

- [技術アーキテクチャ](./docs/architecture.md)
- [開発ロードマップ](./docs/roadmap.md)
- [CLI設計](./docs/cli-design.md)
- [データモデル](./docs/data-model.md)
- [実装ガイド](./docs/implementation-guide.md)
- [ユーザーシナリオ](./docs/user-scenarios.md)

## 開発状況

**Current Phase**: MVP開発中 (Phase 1)

- [x] 設計・仕様策定
- [ ] 基本機能実装
- [ ] CI/CD統合
- [ ] AI機能 (Phase 3予定)

## 貢献

Issues や Pull Requests は大歓迎です。開発に参加される方は [実装ガイド](./docs/implementation-guide.md) をご確認ください。

## ライセンス

MIT License

## 関連プロジェクト

- [mizchi/similarity](https://github.com/mizchi/similarity) - 高性能な構造類似性検出
- [PGLite](https://github.com/electric-sql/pglite) - ポータブルなPostgreSQL実装
