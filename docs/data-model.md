# funcqc データモデル詳細仕様 - 3次元識別システム

> **⚠️ DEPRECATED**: このファイルは非推奨です。最新のデータベーススキーマ定義は `src/schemas/database.sql` を参照してください。
> 
> **📋 New Single Source of Truth**: `src/schemas/database.sql` が funcqc データベーススキーマの唯一の権威ある情報源となりました。
> 
> このファイルは段階的に廃止され、将来のバージョンで削除される予定です。

## 概要

funcqc は関数の識別において、異なる目的に応じた3つの次元で管理される複合的なシステムを採用しています。
この設計により、関数の物理的位置、意味的役割、実装内容を独立して追跡できます。

## 関連ドキュメント

このファイルで定義されたスキーマの運用・実装情報は以下を参照：
- [lineage-database-schema.md](./lineage-database-schema.md) - Lineage運用とメンテナンス
- [function-identity-design.md](./function-identity-design.md) - 3次元識別システムの設計思想
- [phase3-unified-refactoring-workflow.md](./phase3-unified-refactoring-workflow.md) - リファクタリングワークフロー
- [lineage-tracking.md](./lineage-tracking.md) - Lineage追跡機能の概要

## 3次元識別システム

### 1. 物理ベース識別 (Physical Identity)

**目的**: 特定時点・場所での物理的実体の一意識別

**特徴**:
- スナップショット時点での絶対的な一意性
- メトリクス、パラメータ等の物理データとの紐付け基準
- ファイル移動、リファクタリングで変更される
- git commit、スナップショット等の時系列データと連携

**使用例**:
- 品質メトリクスの参照
- 特定時点でのデータ取得
- スナップショット間の物理的変更追跡

### 2. 意味ベース識別 (Semantic Identity)

**目的**: 関数の責務・役割による論理的識別

**特徴**:
- 関数の役割・責務による識別
- ファイル移動に対して安定
- API互換性の追跡
- リファクタリング時の論理的継続性

**構成要素**:
- ファイルパス（論理的所属）
- 関数名とシグネチャ
- 階層コンテキスト（クラス・名前空間）
- 修飾子（static, private等）
- **注意**: 物理的位置（line, column）は含まない

**使用例**:
- 関数の歴史的変遷追跡
- 関数説明の管理基準
- API変更の影響範囲特定

### 3. 内容ベース識別 (Content Identity)

**目的**: 実装内容による具体的識別

**特徴**:
- AST構造とソースコードによる識別
- 1文字でも変わると変化
- 重複コードの発見
- 実装変更の検出

**構成要素**:
- AST構造ハッシュ
- ソースコード内容
- シグネチャハッシュ

**使用例**:
- 重複実装の検出
- 実装変更の通知
- 説明の妥当性確認

## 実装詳細について

**データベーススキーマの詳細仕様**: [src/schemas/database.sql](../src/schemas/database.sql)

すべてのテーブル定義、インデックス、トリガー、および制約は上記ファイルに統合されました。
このファイルはコンセプト理解のための説明のみを含み、実装詳細は含まれません。

## マイグレーション履歴

このファイルは以前、詳細なスキーマ定義を含んでいましたが、情報の一元管理のため、
すべての実装詳細は `src/schemas/database.sql` に移行されました。

### 移行理由

1. **Single Source of Truth**: 唯一の権威ある情報源による一貫性保証
2. **メンテナンス性**: 重複した情報の同期問題を解決
3. **実装連携**: アプリケーションが直接読み込む形式で管理

詳細な実装情報、テーブル定義、制約、インデックスについては、
必ず `src/schemas/database.sql` を参照してください。