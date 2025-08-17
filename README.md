# funcqc v2.0 (Function Quality Control)

> 革新的TypeScript品質管理プラットフォーム - 45機能から9機能への大胆な統合

## 🚀 v2.0の革新

**funcqc v2.0は、従来の45個の複雑なコマンドを9個の直感的な統合コマンドに再設計した革新的な品質管理プラットフォームです。**

### なぜv2.0なのか？
- ✅ **80%簡単**: 学習時間を数週間から数時間に短縮
- ✅ **統一体験**: 一貫したコマンドインターフェース
- ✅ **明確フロー**: 測定→評価→改善→管理の自然な流れ
- ✅ **高性能**: 最適化された処理エンジン

## 概要

funcqc は TypeScript プロジェクトの関数を自動分析し、品質指標の測定、変更履歴の追跡、類似関数の検出、**関数系譜追跡（lineage tracking）**を行うコマンドライン ツールです。AI による意味解析と外部ツール連携により、コードの品質向上とリファクタリングを支援します。

## 🌟 v2.0の特徴

### 🎯 統合された品質管理体験
- ✅ **ゼロ設定で開始**: `funcqc setup --action init` で即座に利用開始
- 📊 **統合された測定**: measure コマンドで包括的分析
- 🔍 **動的な評価**: assess コマンドで高度品質評価
- 🔧 **効率的改善**: improve コマンドで重複・デッドコード検出
- 👁️ **直感的検査**: inspect コマンドで関数・ファイル探索

### 🚀 高度な分析エンジン
- 🔄 **関数系譜追跡**: リネーム・分割・統合など関数の進化を自動検出
- 📝 **関数説明管理**: 自動変更検知付きの包括的文書化システム
- 🤖 **AI支援分析**: 意味的類似性検出とリファクタリング提案
- 📈 **DOT形式可視化**: 依存関係・リスク・デッドコードのグラフ生成
- 🔗 **外部ツール連携**: mizchi/similarity等の高性能ツール活用

### 💼 エンタープライズ対応
- 🚀 **CI/CD統合**: GitHub Actions での自動品質チェック・系譜分析
- 💾 **完全ポータブル**: PGLite による環境依存なし
- 📊 **高度評価**: チーム経験・ドメイン複雑度を考慮した動的評価
- 📈 **ROI可視化**: 改善効果の定量的測定

## ⚡ クイックスタート

### 基本的なワークフロー

```bash
# インストール
npm install -g funcqc

# 1. 初期化
funcqc setup --action init

# 2. プロジェクト測定
funcqc measure --level standard

# 3. 品質評価
funcqc assess --type health --verbose

# 4. 問題のある関数を検査
funcqc inspect --cc-ge 10 --limit 10

# 5. 改善機会を特定
funcqc improve --type duplicates
```

### 高度なワークフロー

```bash
# 包括的分析
funcqc measure --level complete
funcqc assess --advanced --mode dynamic --team-experience Senior

# 専門的分析
funcqc dependencies --action cycles  # 循環依存分析
funcqc types --action health         # TypeScript品質分析
funcqc refactor --action guard       # リファクタリング安全性

# データ管理
funcqc manage --action diff --from HEAD~1 --to HEAD
funcqc manage --action history
```

## 🎯 新しい9つの統合コマンド

funcqc v2.0は、従来の45個のコマンドを使いやすさを重視して9個に統合しました。

### Tier 1: 核となる品質管理ワークフロー

| コマンド | 説明 | 統合された機能 |
|---------|------|----------------|
| `funcqc inspect` | 🔍 関数・ファイル検査 | list, search, files, show |
| `funcqc measure` | 📊 プロジェクト測定 | scan, analyze, history |
| `funcqc assess` | 📊 品質評価 | health, evaluate, types health |
| `funcqc improve` | 🔧 コード改善 | similar, safe-delete, refactor-guard |

### Tier 2: 専門的分析

| コマンド | 説明 | 統合された機能 |
|---------|------|----------------|
| `funcqc dependencies` | 🔗 依存関係分析 | dep list/show/stats/lint/dead/cycles |
| `funcqc types` | 🧩 TypeScript分析 | types * (14サブコマンド) |
| `funcqc refactor` | 🔧 コード変換 | extract-vo, discriminate, canonicalize等 |

### Tier 3: 管理・支援

| コマンド | 説明 | 統合された機能 |
|---------|------|----------------|
| `funcqc setup` | 🛠️ 設定管理 | init, config |
| `funcqc manage` | 📊 データ管理 | db, diff, export, history |

### 強化されたdiff機能

manage コマンドのdiff機能は、単純な追加・削除の表示を超えて、関数の **シグネチャ変更**、**リネーム**、**移動** を自動検出します。

```bash
# 基本的な差分表示
funcqc manage --action diff --from HEAD~1 --to HEAD

# カスタム類似度閾値で変更検出
funcqc manage --action diff --from HEAD~1 --to HEAD --similarity-threshold 0.85

# インサイトモードで詳細分析
funcqc manage --action diff --from HEAD~1 --to HEAD --insights
```

### 検出される変更の種類

| 変更タイプ | 説明 | 検出条件 |
|-----------|------|----------|
| **シグネチャ変更** | 関数名は同じだがシグネチャが変更 | 同名・同ファイル・シグネチャ違い |
| **リネーム** | 関数名が変更されたが実装は類似 | 異名・類似度が閾値以上 |
| **移動** | ファイル間での関数移動 | 同名・異ファイル・類似度が閾値以上 |
| **真の追加** | 完全に新しい関数 | 類似する古い関数が存在しない |
| **真の削除** | 完全に削除された関数 | 類似する新しい関数が存在しない |

### 出力例

```
🔄 Function Changes Detected

📝 Signature Changes (1):
  • calculateTotal in src/math.ts
    - Old: calculateTotal(a: number): number
    + New: calculateTotal(a: number, b: number): number

🏷️  Renames (1):
  • src/utils.ts: processData → transformData (similarity: 0.92)

📁 Moves (1):
  • helper: src/utils.ts → src/helpers/utils.ts (similarity: 0.98)

➕ True Additions (2):
  • newFeature in src/features.ts
  • validateInput in src/validation.ts

➖ True Removals (1):
  • oldLegacyFunction in src/legacy.ts
```

## 🚨 既存ユーザー向け移行案内

**funcqc v2.0は後方互換性を維持しつつ、新しい統合コマンドへの移行を推奨します。**

### 移行例

```bash
# v1.x (旧)
funcqc scan
funcqc list --cc-ge 10
funcqc health --verbose
funcqc similar

# v2.0 (新) - より明確なワークフロー
funcqc measure --level standard
funcqc inspect --cc-ge 10
funcqc assess --type health --verbose
funcqc improve --type duplicates
```

### 移行サポート

- 📖 **詳細移行ガイド**: [MIGRATION_GUIDE.md](./docs/MIGRATION_GUIDE.md)
- ⚠️ **非推奨警告**: 旧コマンド使用時に新コマンドを案内
- 🔄 **段階的移行**: 6ヶ月の移行期間を提供
- 💬 **サポート**: [GitHub Issues](https://github.com/anthropics/funcqc/issues)で質問受付

### 主要コマンド変更

| 旧コマンド | 新コマンド | 説明 |
|-----------|-----------|------|
| `funcqc list` | `funcqc inspect` | 関数一覧・検索 |
| `funcqc scan` | `funcqc measure` | 関数分析・データ保存 |
| `funcqc health` | `funcqc assess --type health` | 品質評価 |
| `funcqc similar` | `funcqc improve --type duplicates` | 類似関数検出 |
| `funcqc history` | `funcqc measure --history` | スナップショット履歴 |
| `funcqc diff` | `funcqc manage --action diff` | 変更差分表示 |
| `funcqc dep *` | `funcqc dependencies --action *` | 依存関係分析 |
| `funcqc types *` | `funcqc types --action *` | TypeScript分析 |

## 環境変数

funcqcは動作をカスタマイズするための環境変数をサポートしています：

### 一般設定
- `NODE_ENV`: 動作モード (`production`, `development`, `test`)
- `DEBUG`: 汎用デバッグフラグ (`true`で有効)

### funcqc固有設定
- `FUNCQC_DB_PATH`: データベースファイルパス (デフォルト: `.funcqc/funcqc.db`)
- `FUNCQC_SHOW_SUMMARY`: スキャン完了時のサマリー表示 (`true`で強制表示)
- `FUNCQC_FORCE_FALLBACK`: フォールバック分析の強制実行 (`1`で有効)

### Git統合設定
- `FUNCQC_GIT_PROVIDER`: Git プロバイダー (`simple-git`, `native`, `mock`)
- `FUNCQC_GIT_TIMEOUT`: Git操作のタイムアウト (秒)
- `FUNCQC_GIT_VERBOSE`: Git操作の詳細ログ (`true`で有効)
- `FUNCQC_GIT_AUTO_DETECT`: Git設定の自動検出 (`true`で有効)
- `FUNCQC_VERBOSE`: 詳細ログ出力 (`true`で有効)

### デバッグ・開発用
- `DEBUG_STAGED_ANALYSIS`: 段階的分析のデバッグ (`true`で有効)
- `DEBUG_EXTERNAL_ANALYSIS`: 外部呼び出し分析のデバッグ (`true`で有効)
- `DEBUG_CALLBACK_REGISTRATION`: コールバック登録のデバッグ (`true`で有効)
- `DEBUG_DB`: データベースクエリのデバッグ (`true`で有効)
- `FUNCQC_DEBUG_PERFORMANCE`: パフォーマンス計測 (`true`で有効)
- `FUNCQC_DEBUG_SIMILARITY`: 類似度分析のデバッグ (`true`で有効)
- `FUNCQC_DEBUG_TARGET`: デバッグ対象関数名 (特定関数のみ)

### パフォーマンス調整
- `FUNCQC_ENABLE_LAYER_PAGERANK`: レイヤーベースPageRank分析 (`true`で有効)
- `FUNCQC_EXCLUDE_INTRA_FILE_CALLS`: ファイル内呼び出しの除外 (`false`で無効化)
- `FUNCQC_LAYER_PR_BUDGET_MV`: PageRank計算の計算量制限 (デフォルト: 150,000)

### CI/CD環境
- `CI`, `GITHUB_ACTIONS`, `CONTINUOUS_INTEGRATION`, `BUILD_NUMBER`: CI環境の検出

### 使用例
```bash
# 詳細デバッグ有効でスキャン
DEBUG=true FUNCQC_DEBUG_PERFORMANCE=true funcqc scan

# レイヤーベースPageRank分析を有効化
FUNCQC_ENABLE_LAYER_PAGERANK=true funcqc health

# 特定関数の類似度分析をデバッグ
FUNCQC_DEBUG_SIMILARITY=true FUNCQC_DEBUG_TARGET=myFunction funcqc similar
```

詳細な環境変数リファレンスは [docs/environment-variables.md](./docs/environment-variables.md) をご覧ください。

## ドキュメント

詳細な設計資料は [docs/](./docs/) フォルダをご覧ください：

### 基本機能
- [技術アーキテクチャ](./docs/architecture.md)
- [開発ロードマップ](./docs/roadmap.md)
- [CLI設計](./docs/cli-design.md)
- [データモデル](./docs/data-model.md)
- [実装ガイド](./docs/implementation-guide.md)
- [ユーザーシナリオ](./docs/user-scenarios.md)
- [環境変数リファレンス](./docs/environment-variables.md)

### 関数系譜追跡（Lineage Tracking）
- [系譜追跡概要](./docs/lineage-tracking.md) - 機能概要と利用シーン
- [CLIコマンドリファレンス](./docs/lineage-cli-commands.md) - 全コマンドの詳細説明
- [GitHub Actions統合](./docs/github-actions-lineage.md) - CI/CD連携ガイド
- [データベーススキーマ](./docs/lineage-database-schema.md) - スキーマ設計と移行
- [トラブルシューティング](./docs/lineage-troubleshooting.md) - 問題解決ガイド

## 📈 開発状況

**Current Version**: v2.0 - 革新的コマンド統合完了

### 完了したフェーズ

- [x] **Phase 1**: 基本機能実装（scan, list, diff等）
- [x] **Phase 2**: 高度な検索・フィルタリング機能
- [x] **Phase 3**: 関数説明管理・文書化機能
- [x] **Phase 4**: 関数系譜追跡（Lineage Tracking）
  - [x] 系譜検出アルゴリズム実装
  - [x] CLI統合（diff --lineage, lineage コマンド群）
  - [x] GitHub Actions 自動分析ワークフロー
  - [x] 包括的ドキュメント作成
- [x] **Phase 5**: コマンド統合プロジェクト（v2.0）
  - [x] 45コマンド → 9コマンドへの統合設計
  - [x] 統一されたユーザーインターフェース
  - [x] 品質管理ワークフローの明確化
  - [x] 高度評価エンジンの実装
  - [x] パフォーマンス最適化
  - [x] 包括的移行ガイド作成

### 次期計画

- [ ] **Phase 6**: AI支援機能・意味解析強化
- [ ] **Phase 7**: エンタープライズ機能拡充
- [ ] **Phase 8**: プラグインエコシステム構築

## 貢献

Issues や Pull Requests は大歓迎です。開発に参加される方は [実装ガイド](./docs/implementation-guide.md) をご確認ください。

## ライセンス

MIT License

## 関連プロジェクト

- [PGLite](https://github.com/electric-sql/pglite) - ポータブルなPostgreSQL実装
