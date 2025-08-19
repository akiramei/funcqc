# funcqc v2.0 移行ガイド

## 📋 概要

funcqc v2.0では、45機能から9機能への大幅統合により、より使いやすく効果的な品質管理ツールへと進化しました。この移行ガイドでは、既存ユーザーがスムーズに新バージョンに移行できるよう、詳細な手順と対応表を提供します。

## 🎯 主な変更点

### Health精度の劇的改善
- Health Index: より現実的な評価（17.5 → 45-55）
- 循環依存誤検知: 95%削減（再帰関数の適切な除外）
- 一貫した分析エンジン（EnhancedCycleAnalyzer統一）

### 機能統合による単純化
- **45機能 → 9機能**（80%削減）
- 明確な品質管理フロー確立
- 学習時間: 数週間 → 数時間

### 強化された高価値機能
- `similar`: 自動リファクタリング提案
- `refactor-guard`: より詳細な安全性評価  
- `dep lint`: カスタムルール定義

## 📊 コマンド対応表

### Tier 1: 基本品質管理（新統合コマンド）

#### `measure` - 統合測定機能
```bash
# 旧コマンド → 新コマンド
funcqc scan                    → funcqc measure
funcqc scan --quick           → funcqc measure --mode quick
funcqc scan --full            → funcqc measure --mode full
funcqc analyze                → funcqc measure --include-deferred
funcqc health --metrics-only  → funcqc measure --include-structural
```

#### `assess` - 統合品質評価
```bash
# 旧コマンド → 新コマンド
funcqc health                 → funcqc assess
funcqc health --verbose       → funcqc assess --level detailed
funcqc types health           → funcqc assess --focus types
funcqc evaluate              → funcqc assess --focus naming
```

#### `inspect` - 統合検索・調査
```bash
# 旧コマンド → 新コマンド
funcqc list                   → funcqc inspect --type functions
funcqc list --cc-ge 10        → funcqc inspect --type functions --cc-ge 10
funcqc search "keyword"       → funcqc inspect --name "keyword"
funcqc files                  → funcqc inspect --type files
funcqc files --sort size      → funcqc inspect --type files --sort size
funcqc show <function-id>     → funcqc inspect --id <function-id> --level detailed
```

#### `improve` - 統合改善実行
```bash
# 旧コマンド → 新コマンド
funcqc safe-delete           → funcqc improve --action cleanup
funcqc similar               → funcqc improve --action dedupe
funcqc refactor-guard        → funcqc improve --action refactor --dry-run
```

### Tier 2: 専門分析（統合コマンド）

#### `dependencies` - 依存関係統合
```bash
# 旧コマンド → 新コマンド
funcqc dep list              → funcqc dependencies --analysis overview
funcqc dep show <function>   → funcqc dependencies --analysis detailed --focus <function>
funcqc dep stats             → funcqc dependencies --analysis overview --format stats
funcqc dep lint              → funcqc dependencies --analysis violations
funcqc dep dead              → funcqc dependencies --analysis overview --show-dead
funcqc dep cycles            → funcqc dependencies --analysis violations --focus cycles
```

#### `types` - 型システム統合
```bash
# 旧コマンド → 新コマンド
funcqc types list            → funcqc types --analysis basic
funcqc types health          → funcqc types --analysis health
funcqc types deps            → funcqc types --analysis deps
funcqc types insights        → funcqc types --analysis insights
funcqc types members         → funcqc types --analysis basic --include-members
funcqc types api             → funcqc types --analysis basic --focus api
funcqc types coverage        → funcqc types --analysis health --include-coverage
funcqc types risk            → funcqc types --analysis health --include-risk
```

#### `refactor` - リファクタリング統合
```bash
# 旧コマンド → 新コマンド
funcqc type-replace          → funcqc refactor --strategy types
funcqc canonicalize          → funcqc refactor --strategy structure
funcqc extract-vo            → funcqc refactor --strategy modernize --extract-value-objects
funcqc discriminate          → funcqc refactor --strategy types --discriminate
funcqc du                    → funcqc refactor --strategy types --incremental
```

### Tier 3: 管理・支援（統合コマンド）

#### `setup` - セットアップ統合
```bash
# 旧コマンド → 新コマンド
funcqc init                  → funcqc setup --mode init
funcqc init --preset <name>  → funcqc setup --mode init --preset <name>
funcqc config                → funcqc setup --mode configure
funcqc config --show         → funcqc setup --mode configure --show
```

#### `data` - データ管理統合
```bash
# 旧コマンド → 新コマンド
funcqc db --table <table>    → funcqc data --operation query --table <table>
funcqc history               → funcqc data --operation history
funcqc history --limit 10    → funcqc data --operation history --limit 10
funcqc diff <from> <to>      → funcqc data --operation compare --from <from> --to <to>
```

## 🗑️ 廃止されたコマンド

### 即座廃止（代替コマンドあり）

#### `search` → `inspect`
```bash
# 廃止されたコマンド
funcqc search "analyze"

# 代替方法
funcqc inspect --name "analyze"
funcqc inspect --type functions --name "*analyze*"

# より高機能な検索
funcqc inspect --name "analyze" --cc-ge 10 --level detailed
```

#### `types subsume` / `types fingerprint` / `types converters`
```bash
# これらのコマンドは廃止されました
# 理由: 実用性が低く、リソースを高価値機能に集中するため

# 代替案
funcqc types --analysis insights  # より実用的な型分析
funcqc assess --focus types      # 型品質の評価
```

### 統合により廃止

#### `describe` → `inspect`
```bash
# 廃止されたコマンド
funcqc describe <function>

# 代替方法
funcqc inspect --id <function> --level detailed
funcqc inspect --name <function> --level expert
```

#### `evaluate` → `assess`
```bash
# 廃止されたコマンド
funcqc evaluate

# 代替方法
funcqc assess --focus naming
funcqc assess --level detailed --focus naming
```

## 🔄 段階的移行プロセス

### Phase 1: 共存期間（6ヶ月）
```bash
# 両方のコマンドが利用可能
funcqc scan           # 非推奨警告が表示されるが動作
funcqc measure        # 新コマンド（推奨）

# 出力例
⚠️  Warning: 'scan' is deprecated and will be removed in July 2025.
⚠️  Use 'funcqc measure' instead.
⚠️  Migration guide: https://funcqc.dev/migration/scan-to-measure
```

### Phase 2: エラーガイダンス期間（3ヶ月）
```bash
# 廃止コマンドはエラー + ガイダンス表示
funcqc scan

# 出力例
❌ Error: 'scan' has been removed in funcqc v2.1
✅ Use 'funcqc measure' instead

📖 Quick migration:
   funcqc scan              → funcqc measure
   funcqc scan --quick      → funcqc measure --mode quick
   funcqc scan --full       → funcqc measure --mode full

📚 Full migration guide: https://funcqc.dev/migration
```

### Phase 3: 完全削除
旧コマンドは完全に削除され、エラーメッセージのみ表示

## ⚙️ 設定ファイル移行

### 旧設定ファイル（.funcqc/config.json）
```json
{
  "scan": {
    "timeout": 120,
    "parallel": true
  },
  "health": {
    "thresholds": {
      "cyclicFunctions": 5,
      "hubFunctions": 20
    }
  },
  "verbosity": "normal"
}
```

### 新設定ファイル（.funcqc/config.json）
```json
{
  "unified": {
    "defaultLevel": "basic",
    "cacheEnabled": true,
    "parallelEnabled": true,
    "timeout": 120
  },
  "features": {
    "enhancedCycles": true,
    "unifiedCommands": true,
    "interactiveMode": false
  },
  "thresholds": {
    "health": {
      "cyclicFunctions": 5,
      "hubFunctions": 20
    },
    "quality": {
      "minHealthIndex": 40,
      "maxComplexity": 15
    }
  },
  "legacy": {
    "scanOptions": {
      "timeout": 120,
      "parallel": true
    },
    "healthOptions": {
      "thresholds": {
        "cyclicFunctions": 5,
        "hubFunctions": 20
      }
    }
  }
}
```

### 自動移行
```bash
# 設定ファイルの自動移行
funcqc setup --migrate-config

# 出力例
✅ Configuration migrated successfully
📁 Backup created: .funcqc/config.json.backup
📁 New config: .funcqc/config.json
📋 Changes:
   • Added unified command settings
   • Preserved all legacy configurations
   • Enabled enhanced cycle analysis
```

## 🧪 新機能の活用方法

### 段階的詳細化の活用

#### 初心者向け - Basic Level
```bash
# シンプルな出力
funcqc assess
# ➜ Health Index: 52/100 (Fair)
# ➜ Top Issues: High complexity functions (3), Code duplication (2 groups)

funcqc inspect --type functions --cc-ge 10
# ➜ 5 functions with complexity >= 10
```

#### 中級者向け - Detailed Level
```bash
# 詳細分析
funcqc assess --level detailed
# ➜ 詳細な問題分析、改善提案、ROI計算

funcqc inspect --type functions --cc-ge 10 --level detailed
# ➜ 関数の詳細情報、依存関係、品質メトリクス
```

#### 上級者向け - Expert Level
```bash
# 包括的分析
funcqc assess --level expert
# ➜ 全ての分析結果、高度な提案、技術的詳細

funcqc inspect --id <function-id> --level expert
# ➜ 構造分析、リファクタリング機会、詳細メトリクス
```

### 品質管理ワークフローの実践

#### 基本的な品質改善サイクル
```bash
# 1. 現状測定
funcqc measure --baseline

# 2. 問題特定
funcqc assess --priority

# 3. 詳細調査
funcqc inspect --type functions --risk-ge 15

# 4. 改善実行
funcqc improve --action dedupe --dry-run
funcqc improve --action dedupe  # 実行

# 5. 効果測定
funcqc measure --compare-baseline
```

#### 高度な分析ワークフロー
```bash
# 依存関係分析
funcqc dependencies --analysis violations
funcqc dependencies --analysis detailed --focus <problem-function>

# 型システム分析
funcqc types --analysis health
funcqc types --analysis insights

# リファクタリング計画
funcqc refactor --strategy types --preview
funcqc improve --action refactor --guided
```

## 🚨 注意事項とトラブルシューティング

### よくある移行問題

#### 問題1: Health Indexが大幅に変わった
```bash
# 旧バージョン
funcqc health
# ➜ Health Index: 17.5/100 (Critical)

# 新バージョン  
funcqc assess
# ➜ Health Index: 48/100 (Fair)
```

**説明**: 再帰関数の誤検知修正により、より現実的な評価になりました。
**対応**: 新しい数値が正確な品質を反映しています。

#### 問題2: コマンドが見つからない
```bash
funcqc scan
# ➜ Error: Command 'scan' not found
```

**対応**: 
```bash
# 移行期間中（v2.0-2.0.6）
funcqc measure  # 新コマンド使用

# エイリアス確認
funcqc --help | grep -A5 "Legacy Commands"
```

#### 問題3: 出力フォーマットが変わった
**対応**: 
```bash
# 旧フォーマットが必要な場合
funcqc assess --format legacy

# 新フォーマットに慣れる
funcqc assess --level basic    # シンプル
funcqc assess --level detailed # 詳細
```

### パフォーマンス問題

#### 統合コマンドが遅い場合
```bash
# キャッシュ有効化
funcqc measure --cache

# 並列実行確認
funcqc setup --configure --show | grep parallel

# 高速モード
funcqc measure --mode quick
```

#### メモリ使用量が多い場合
```bash
# 軽量モード
funcqc assess --level basic

# 段階的分析
funcqc inspect --limit 100
funcqc dependencies --analysis overview
```

## 📞 サポートとリソース

### 公式リソース
- **移行ガイド**: https://funcqc.dev/migration
- **API リファレンス**: https://funcqc.dev/api/v2
- **チュートリアル**: https://funcqc.dev/tutorials

### コミュニティサポート
- **GitHub Issues**: https://github.com/funcqc/funcqc/issues
- **Discord**: https://discord.gg/funcqc
- **Stack Overflow**: タグ `funcqc`

### 移行支援ツール
```bash
# 自動移行チェック
funcqc setup --migration-check

# 設定ファイル移行
funcqc setup --migrate-config

# コマンド使用状況分析
funcqc data --operation history --analyze-commands
```

## 🎯 移行完了チェックリスト

### ✅ 必須タスク
- [ ] 新しいコマンド体系の理解
- [ ] 設定ファイルの移行確認
- [ ] Health Indexの新しい基準理解
- [ ] 主要ワークフローの新コマンドでの実行確認

### ✅ 推奨タスク
- [ ] 段階的詳細化の活用方法習得
- [ ] 新機能（統合ワークフロー）の試用
- [ ] CI/CDスクリプトの更新
- [ ] チーム内での新コマンド体系の共有

### ✅ 最適化タスク
- [ ] カスタム設定の調整
- [ ] パフォーマンス設定の最適化
- [ ] 高度な分析機能の活用
- [ ] 継続的品質改善プロセスの確立

funcqc v2.0への移行により、より効率的で効果的な品質管理が実現されます。このガイドを参考に、スムーズな移行を進めてください。