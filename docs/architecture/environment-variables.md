# 環境変数リファレンス

funcqcは動作をカスタマイズするための包括的な環境変数サポートを提供しています。

## 概要

環境変数は以下のカテゴリーに分類されます：

- **一般設定**: Node.js環境やデバッグの基本設定
- **funcqc固有設定**: データベースパス、表示オプションなど
- **Git統合設定**: Git操作の詳細制御
- **分析デバッグ**: 各分析ステージの詳細ログ
- **パフォーマンス調整**: 計算量制限や最適化設定
- **CI/CD環境**: 継続的インテグレーション用の設定

## 詳細リファレンス

### 一般設定

#### `NODE_ENV`
- **用途**: Node.js実行環境の指定
- **値**: `production` | `development` | `test`
- **デフォルト**: 未設定
- **影響**: 
  - `development`: 詳細なエラースタックトレースを表示
  - `test`: Git操作でモックプロバイダーを使用
  - `production`: 警告ログを抑制

#### `DEBUG`
- **用途**: 汎用デバッグフラグ
- **値**: `true` | その他
- **デフォルト**: 未設定
- **影響**: システムリソース情報、エラー詳細を表示

#### `FUNCQC_DEBUG_PATHS`
- **用途**: コールグラフ初回 0 edges 時の診断ログを出力
- **値**: `true` | その他
- **デフォルト**: 未設定

### funcqc固有設定

#### `FUNCQC_DB_PATH`
- **用途**: PGLiteデータベースファイルのパス指定
- **値**: ファイルパス
- **デフォルト**: `.funcqc/funcqc.db`
- **例**: `/tmp/test-funcqc.db`

#### `FUNCQC_SHOW_SUMMARY`
- **用途**: スキャン完了時のサマリー表示制御
- **値**: `true` | その他
- **デフォルト**: 100関数未満で自動表示
- **影響**: 大規模プロジェクトでもサマリーを強制表示

#### `FUNCQC_FORCE_FALLBACK`
- **用途**: 理想的分析のフォールバック強制実行
- **値**: `1` | その他
- **デフォルト**: 未設定
- **用途**: デバッグ・テスト用

### Git統合設定

#### `FUNCQC_GIT_PROVIDER`
- **用途**: Gitプロバイダーの指定
- **値**: `simple-git` | `native` | `mock`
- **デフォルト**: 自動検出
- **説明**:
  - `simple-git`: simple-gitライブラリを使用
  - `native`: ネイティブgitコマンドを使用
  - `mock`: モックデータを使用（テスト用）

#### `FUNCQC_GIT_TIMEOUT`
- **用途**: Git操作のタイムアウト設定
- **値**: 秒数（整数）
- **デフォルト**: プロバイダーデフォルト
- **例**: `30` (30秒)

#### `FUNCQC_GIT_VERBOSE`
- **用途**: Git操作の詳細ログ
- **値**: `true` | その他
- **デフォルト**: `false`
- **影響**: Git操作の詳細情報を表示

#### `FUNCQC_GIT_AUTO_DETECT`
- **用途**: Git設定の自動検出制御
- **値**: `true` | その他
- **デフォルト**: `true`
- **影響**: 自動検出を無効化して手動設定を優先

#### `FUNCQC_VERBOSE`
- **用途**: funcqc全般の詳細ログ
- **値**: `true` | その他
- **デフォルト**: `false`
- **影響**: 操作の詳細情報を表示

### 分析デバッグ設定

#### `DEBUG_STAGED_ANALYSIS`
- **用途**: 段階的コールグラフ分析のデバッグ
- **値**: `true` | その他
- **影響**: Local/Import/CHA/RTA各ステージの詳細ログ
- **対象**: StagedAnalysisEngine全体

#### `DEBUG_EXTERNAL_ANALYSIS`
- **用途**: 外部関数呼び出し分析のデバッグ
- **値**: `true` | その他
- **影響**: 外部ライブラリ呼び出しの検出ログ

#### `DEBUG_CALLBACK_REGISTRATION`
- **用途**: コールバック登録分析のデバッグ
- **値**: `true` | その他
- **影響**: イベントハンドラー、コールバック関数の検出ログ
- **追加**: フレームワーク固有デバッグも有効化

#### `DEBUG_DB`
- **用途**: データベースクエリのデバッグ
- **値**: `true` | その他
- **影響**: SQLクエリ、パラメーター、実行結果を表示

#### `FUNCQC_DEBUG_PERFORMANCE`
- **用途**: パフォーマンス計測の有効化
- **値**: `true` | その他
- **影響**: 各分析ステージの実行時間を計測・表示

#### `FUNCQC_DEBUG_SIMILARITY`
- **用途**: 類似度分析の詳細デバッグ
- **値**: `true` | その他
- **影響**: 類似関数の検出プロセスを詳細表示

#### `FUNCQC_DEBUG_TARGET`
- **用途**: デバッグ対象の関数名指定
- **値**: 関数名（文字列）
- **デフォルト**: `findTargetFunction`
- **用途**: 特定関数のみデバッグログを出力

### パフォーマンス調整

#### `FUNCQC_ENABLE_LAYER_PAGERANK`
- **用途**: レイヤーベースPageRank分析の有効化
- **値**: `true` | その他
- **デフォルト**: エッジ数に基づく自動判定
- **影響**: 大規模プロジェクトで計算量の多い分析を強制実行

#### `FUNCQC_EXCLUDE_INTRA_FILE_CALLS`
- **用途**: ファイル内呼び出しの除外制御
- **値**: `false` | その他
- **デフォルト**: `true`（除外する）
- **影響**: ファイル内呼び出しを含めて分析

#### `FUNCQC_LAYER_PR_BUDGET_MV`
- **用途**: PageRank計算の計算量制限
- **値**: 数値（計算量制限）
- **デフォルト**: `150000`
- **説明**: 行列ベクトル積の最大実行回数

### CI/CD環境検出

以下の環境変数によりCI環境を自動検出します：

#### `CI`
- **用途**: 汎用CI環境フラグ
- **設定元**: 多くのCIプロバイダー

#### `GITHUB_ACTIONS`
- **用途**: GitHub Actions環境の検出
- **設定元**: GitHub Actions

#### `CONTINUOUS_INTEGRATION`
- **用途**: 継続的インテグレーション環境フラグ
- **設定元**: 各種CIプロバイダー

#### `BUILD_NUMBER`
- **用途**: ビルド番号による環境識別
- **設定元**: Jenkins等のCI

### WSLサポート

#### `WSL_DISTRO_NAME`
- **用途**: WSL環境の検出
- **設定元**: WSL実行時に自動設定
- **影響**: ファイルシステム操作の調整

## 使用パターン

### 基本的なデバッグ

```bash
# 全般的なデバッグ情報
DEBUG=true funcqc scan

# 段階的分析の詳細ログ
DEBUG_STAGED_ANALYSIS=true funcqc scan
```

### 特定機能のデバッグ

```bash
# 類似度分析の詳細
FUNCQC_DEBUG_SIMILARITY=true funcqc similar

# 特定関数の分析ログ
FUNCQC_DEBUG_SIMILARITY=true FUNCQC_DEBUG_TARGET=myFunction funcqc similar

# データベースクエリの確認
DEBUG_DB=true funcqc db --table functions --limit 5
```

### パフォーマンス調整

```bash
# 大規模プロジェクトでPageRank強制実行
FUNCQC_ENABLE_LAYER_PAGERANK=true funcqc health

# パフォーマンス計測付きスキャン
FUNCQC_DEBUG_PERFORMANCE=true funcqc scan

# ファイル内呼び出しを含む分析
FUNCQC_EXCLUDE_INTRA_FILE_CALLS=false funcqc health
```

### テスト・開発環境

```bash
# テスト用データベース
FUNCQC_DB_PATH=/tmp/test-funcqc.db funcqc scan

# モックGitプロバイダー
FUNCQC_GIT_PROVIDER=mock NODE_ENV=test funcqc diff

# フォールバック分析の強制実行
FUNCQC_FORCE_FALLBACK=1 funcqc scan
```

### CI/CD環境での設定

```yaml
# GitHub Actions例
env:
  FUNCQC_GIT_VERBOSE: "true"
  FUNCQC_SHOW_SUMMARY: "true"
  DEBUG: "true"
```

## 環境変数の優先順位

1. **明示的な環境変数**: 直接設定された値が最優先
2. **設定ファイル**: funcqc設定ファイルの値
3. **デフォルト値**: コード内で定義されたデフォルト値
4. **自動検出**: 環境に基づく自動判定

## トラブルシューティング

### よくある問題

1. **分析が遅い**: `FUNCQC_DEBUG_PERFORMANCE=true`でボトルネックを特定
2. **Git操作が失敗**: `FUNCQC_GIT_VERBOSE=true`で詳細確認
3. **予期しない結果**: `DEBUG_STAGED_ANALYSIS=true`で分析プロセス確認
4. **データベースエラー**: `DEBUG_DB=true`でクエリを確認

### 推奨デバッグ手順

```bash
# 1. 基本デバッグの有効化
DEBUG=true funcqc [command]

# 2. 特定機能のデバッグ
DEBUG_[FEATURE]=true funcqc [command]

# 3. パフォーマンス分析
FUNCQC_DEBUG_PERFORMANCE=true funcqc [command]
```

この環境変数システムにより、funcqcは様々な使用シナリオに柔軟に対応できます。
- **推奨**: 通常は無効。デバッグ用途のみ

#### `FUNCQC_ENABLE_DB_FUNCTIONS_FALLBACK`
- **用途**: コールグラフ初回 0 edges 時に DB の関数を再取得して再解析（フォールバック）
- **値**: `1` | その他
- **デフォルト**: 未設定（無効）
- **推奨**: 通常は無効。根本原因の解析と修正を優先
#### `FUNCQC_MAX_SOURCE_FILES_IN_MEMORY`
- **用途**: 共有 Project 等で同時に扱うソースファイル上限を上書き
- **値**: 整数
- **デフォルト**: SystemResourceManager により自動算出

#### `FUNCQC_MAX_WORKERS`
- **用途**: ワーカー数の上限
- **値**: 整数
- **デフォルト**: CPU数・メモリ状況から自動算出

#### `FUNCQC_MIN_WORKERS`
- **用途**: ワーカー数の下限
- **値**: 整数
- **デフォルト**: 自動算出に従う

#### `FUNCQC_FILES_PER_WORKER`
- **用途**: ワーカーあたりのファイル数
- **値**: 整数
- **デフォルト**: プロジェクト規模とワーカー数から自動算出
