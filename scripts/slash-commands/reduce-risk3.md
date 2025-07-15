# /reduce-risk3

Health Intelligence-Driven Risk Reduction - funcqcの健康分析知能を活用した高度なリファクタリングワークフロー

## 概要

このワークフローは、funcqcの`refactor health-analyze`と`refactor health-prompt`コマンドを活用して、パターン特化型の知的なリファクタリングを実行します。

## 実行手順

### 1. 初期分析とセッション作成

```bash
# 現在の状態を記録
npm run dev scan

# 健康分析による高優先度関数の特定（JSON形式で取得）
npm run dev -- refactor health-analyze --format json --limit 10 --complexity-threshold 10 --priority-threshold 100 > health-analysis.json

# リファクタリングセッションを作成
npm run dev -- refactor track create "Health-Guided Risk Reduction $(date +%Y%m%d-%H%M%S)" --description "Intelligent refactoring using health analysis patterns"
```

### 2. ブランチ作成とbeforeスナップショット

```bash
# 新しいブランチを作成
git checkout -b "refactor/health-guided-$(date +%Y%m%d-%H%M%S)"

# beforeスナップショットを作成
npm run dev -- refactor snapshot create "Before health-guided refactoring"
```

### 3. 健康分析結果の確認

health-analysis.jsonから以下の情報を確認してください：
- 各関数の優先度（priority）
- 推定影響度（estimatedImpact）
- 適用可能なパターン（targetPatterns）
- 健康分析の提案（healthSuggestions）

優先度が高い関数から順に処理を行います。

### 4. 各関数のリファクタリング

health-analysis.jsonの上位5-10個の関数に対して、以下を実行：

```bash
# 関数名を指定して健康ガイド付きプロンプトを生成
npm run dev -- refactor health-prompt "functionName" --verbose
```

生成されたプロンプトには以下が含まれます：
- 現在のメトリクス（複雑度、行数、ネストレベル、保守性指標）
- 健康分析による具体的な推奨事項
- 適用すべきパターン（early-return、options-object、extract-method等）
- 目標メトリクス

### 5. パターン別リファクタリング指針

#### Early Return Pattern（早期リターン）
- 深くネストしたif文を検出した場合に適用
- エラーケースや境界条件を関数の先頭で処理
- 不要なelseブランチを削除
- ネストレベルを3以下に削減

#### Options Object Pattern（オプションオブジェクト）
- パラメータ数が4を超える関数に適用
- 関連するパラメータを論理的にグループ化
- TypeScriptインターフェースでオプションを定義
- デフォルト値を適切に設定

#### Extract Method Pattern（メソッド抽出）
- 大きな関数（40行以上）や複雑な関数に適用
- 独立した処理ブロックを別関数に抽出
- 単一責任の原則に従う
- テスト可能性を向上

#### Strategy Pattern（戦略パターン）
- 長いswitch文やif-elseチェーンに適用
- ポリモーフィズムまたはマップベースの実装に変換
- 拡張性を向上

### 6. リファクタリング実施時の注意事項

各関数をリファクタリングする際：
1. 健康分析が提案する具体的なパターンに従う
2. 単に関数を分割するのではなく、本質的な複雑さを削減する
3. 既存の機能とテストカバレッジを維持する
4. 各変更後に`npm run dev scan`を実行して改善を確認

### 7. 偽のリファクタリング検出

リファクタリング後、以下を確認：

```bash
# 健康状態の確認
npm run dev health

# 前後の比較
npm run dev -- diff <before-snapshot-id> <after-snapshot-id>
```

警告サイン：
- 関数数が20%以上増加している
- 平均複雑度が改善されていない
- 高リスク関数の数が減っていない
- 単に関数を分割しただけで、各部分が依然として複雑

### 8. afterスナップショットとレポート作成

```bash
# afterスナップショットを作成
npm run dev -- refactor snapshot create "After health-guided refactoring"

# 改善レポートの確認
npm run dev health
npm run dev -- list --cc-ge 10
```

### 9. 品質検証とPR作成

```bash
# 品質チェック
npm run lint
npm run typecheck
npm test

# PRを作成（改善メトリクスを含める）
```

PR本文には以下を含めてください：
- 健康分析による改善提案の要約
- 適用したパターンのリスト
- before/afterのメトリクス比較
- 関数爆発チェックの結果
- 全体的な品質向上の証拠

## 成功基準

- パターン実装成功率: 80%以上
- 対象関数の複雑度削減: 40%以上
- 関数爆発なし: 関数数増加20%未満
- 健康グレードの向上: 検出可能な改善
- 高リスク関数の削減: 明確な減少

## 重要な注意事項

このワークフローは、funcqcの健康分析知能を活用して、真の品質改善を実現することを目的としています。メトリクスを操作するための表面的な変更ではなく、コードの本質的な品質向上に焦点を当ててください。