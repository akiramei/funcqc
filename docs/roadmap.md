# funcqc 開発ロードマップ

## Phase 1: MVP (4-6週間)

### Week 1-2: 基盤構築
**目標**: プロジェクト構造とコア機能の実装

#### 実装項目
- [ ] プロジェクト初期化 (TypeScript + CLI setup)
- [ ] 設定システム (`cosmiconfig`)
- [ ] TypeScript AST解析基盤
- [ ] 基本的なメトリクス計算
- [ ] PGLite ストレージ実装

#### 成果物
```bash
# 動作する最小コマンド
funcqc init
funcqc scan --dry-run  # 解析結果を表示のみ
```

#### 技術的なマイルストーン
- TypeScript Compiler APIでの関数抽出
- 基本メトリクス（LOC, パラメータ数）の計算
- PGLiteスキーマの確定

### Week 3-4: コア機能実装
**目標**: scan, list の完全実装

#### 実装項目
- [ ] `funcqc scan` 完全実装
- [ ] PGLite データベース保存機能
- [ ] `funcqc list` 基本機能
- [ ] 設定ファイル対応
- [ ] エラーハンドリング

#### 成果物
```bash
# 基本ワークフロー
funcqc init
funcqc scan --label "initial"
funcqc list --complexity ">3"
```

#### 品質目標
- 100ファイル程度のプロジェクトで5秒以内の処理
- メモリ使用量 100MB以下
- ユニットテストカバレッジ 80%以上

### Week 5-6: 安定化とドキュメント
**目標**: MVP版のリリース準備

#### 実装項目
- [ ] 統合テスト実装
- [ ] パフォーマンステスト
- [ ] ドキュメント作成
- [ ] サンプルプロジェクトでの検証
- [ ] npm パッケージ準備

#### 成果物
- funcqc v0.1.0 リリース
- 完全なREADME
- 基本的な使用例

## Phase 2: 履歴機能 (3-4週間)

### Week 7-8: 履歴管理機能
**目標**: 時系列データの管理と比較

#### 実装項目
- [ ] スナップショット管理システム
- [ ] `funcqc history` 実装
- [ ] `funcqc diff` 基本機能
- [ ] Git連携（コミット情報取得）

#### 新機能
```bash
funcqc history
funcqc diff snapshot-1 snapshot-2
funcqc scan --label "feature-xyz"
```

### Week 9-10: 高度な品質指標
**目標**: より詳細な品質分析

#### 実装項目
- [ ] サイクロ複雑度計算
- [ ] 認知的複雑度実装
- [ ] ネストレベル分析
- [ ] 品質レポート機能

#### 成果物
- funcqc v0.2.0 リリース
- 詳細な品質レポート機能

## Phase 3: AI機能 (6-8週間)

### Week 11-14: AI解析基盤
**目標**: 意味解析とベクトル検索

#### 実装項目
- [ ] LLM統合（OpenAI API / Claude API）
- [ ] 関数説明生成
- [ ] 意味ベクトル生成・保存
- [ ] ベクトル検索機能（PGLite + pgvector）

### Week 15-18: 高度な分析機能
**目標**: `suggest` 機能の実装

#### 実装項目
- [ ] 類似関数検出
- [ ] リネーム提案
- [ ] リファクタリング提案
- [ ] コード品質改善提案

#### 新機能
```bash
funcqc suggest --duplicates
funcqc suggest --rename
funcqc suggest --refactor
```

## 実装優先度マトリックス

### 高優先度（MVP必須）
1. **TypeScript AST解析** - コア機能
2. **基本メトリクス計算** - 価値提供の核心
3. **PGLite ストレージ** - データ永続化
4. **CLI基本機能** - ユーザーインターフェース

### 中優先度（早期実装推奨）
1. **Git連携** - 実用性向上
2. **差分機能** - 履歴管理
3. **フィルタリング** - 使いやすさ
4. **設定システム** - カスタマイズ性

### 低優先度（将来実装）
1. **AI機能** - 高度な分析
2. **Web UI** - 可視化
3. **プラグインシステム** - 拡張性
4. **他言語対応** - 適用範囲拡大

## 技術リスク軽減策

### 1. TypeScript Compiler API
**リスク**: 複雑なAPIの学習コスト
**軽減策**: 
- 小さなサンプルから始める
- 既存ツール（ts-morph）の調査
- プロトタイプでの検証

### 2. パフォーマンス
**リスク**: 大規模プロジェクトでの性能問題
**軽減策**:
- 早期のベンチマーク実装
- インクリメンタル処理の検討
- 並列処理の活用

### 3. メトリクス計算の正確性
**リスク**: 複雑度計算の誤り
**軽減策**:
- 既存ツールとの比較検証
- 豊富なテストケース
- 段階的な機能追加

## 開発環境セットアップ

### 開発ツール
```json
{
  "scripts": {
    "dev": "tsx watch src/cli.ts",
    "build": "tsup src/cli.ts --format cjs,esm",
    "test": "vitest",
    "test:e2e": "vitest --config vitest.e2e.config.ts",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  }
}
```

### CI/CD パイプライン
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run test:e2e
```

## マイルストーン定義

### v0.1.0 - MVP
- ✅ 基本的な関数解析
- ✅ 簡単な品質指標
- ✅ データ保存・検索
- ✅ CLI基本操作

### v0.2.0 - 履歴機能
- ✅ スナップショット管理
- ✅ 変更差分表示
- ✅ Git連携
- ✅ 高度なメトリクス

### v0.3.0 - AI統合
- ✅ 意味解析
- ✅ 類似性検出
- ✅ 改善提案
- ✅ インテリジェント検索

### v1.0.0 - 安定版
- ✅ 全機能の安定動作
- ✅ 包括的ドキュメント
- ✅ プラグインシステム
- ✅ パフォーマンス最適化

## 成功指標 (KPI)

### 技術指標
- **パフォーマンス**: 1000ファイル/30秒以内
- **メモリ効率**: 500MB以下（大規模プロジェクト）
- **精度**: 既存ツールとの差異5%以内

### ユーザー指標
- **採用率**: GitHub Stars 100+
- **実用性**: 実プロジェクトでの継続使用
- **コミュニティ**: Issue/PR での活発な議論
