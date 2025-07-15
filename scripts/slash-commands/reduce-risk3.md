# /reduce-risk3

Advanced Risk Score-Based Refactoring - リスクスコア評価と複数候補比較による高度なリファクタリングワークフロー

## 概要

このワークフローは、funcqcの最新のリスクスコアベース評価システムと複数候補比較機能を活用して、科学的かつ確実性の高いリファクタリングを実行します。従来の単一メトリクス評価から、17種類の品質指標を統合したリスクスコアによる包括的な品質改善を実現します。

## 実行手順

### 1. 初期分析とリスク評価

```bash
# 現在の状態を記録
npm run dev scan

# リスクスコアベースの高優先度関数特定（新機能）
npm run --silent dev -- list --cc-ge 10 --json | jq -r '.functions[] | "\(.id) \(.name) \(.filePath):\(.startLine)"' > high-risk-functions.txt

# 複数関数評価でプロジェクト全体の状況把握（新機能）
npm run dev -- eval --evaluate-all --json > project-quality-assessment.json

# プロジェクト全体のリスク分布確認
npm run dev health

# リファクタリングセッションを作成
npm run dev -- refactor track create "Risk-Score-Based Reduction $(date +%Y%m%d-%H%M%S)" --description "Advanced refactoring using risk score evaluation and candidate comparison"
```

### 2. ブランチ作成とbeforeスナップショット

```bash
# 新しいブランチを作成
git checkout -b "refactor/health-guided-$(date +%Y%m%d-%H%M%S)"

# beforeスナップショットを作成
npm run dev -- refactor snapshot create "Before health-guided refactoring"
```

### 3. リスクスコア分析結果の確認

high-risk-functions.txtとproject-quality-assessment.jsonから以下の情報を確認してください：

**リスクスコア分析（新機能）:**
- 各関数のリスクスコア（17種類のメトリクスから計算）
- 重み付け違反（critical: 25, error: 5, warning: 1）
- 正規化された超過値（メトリクス非依存の比較）
- 構造的複雑度とコグニティブ負荷

**複数関数評価結果（新機能）:**
- 全関数の包括的品質評価
- 集約スコアと個別関数スコア
- 受入可能性判定結果
- ベスト/ワースト関数の特定

リスクスコアが最も高い関数から順に処理を行います。

### 4. 複数候補リファクタリング（新機能）

high-risk-functions.txtの上位5-10個の関数に対して、以下の革新的なアプローチを実行：

```bash
# 関数の詳細リスクスコア分析
npm run dev -- show --id "function-id-from-list"

# 複数関数評価で当該ファイル全体の状況把握
npm run dev -- eval path/to/file.ts --evaluate-all --json
```

**RefactoringCandidateEvaluatorの活用（新機能）:**

各高リスク関数に対して、複数のリファクタリング戦略を同時評価：

1. **Early Return Pattern**: ネストレベル削減
2. **Extract Method Pattern**: 関数分割による複雑度削減  
3. **Options Object Pattern**: パラメータ数削減
4. **Strategy Pattern**: 条件分岐の体系化

```typescript
// 例: 複数候補の科学的評価
const candidates = [
  earlyReturnCandidate,
  extractMethodCandidate, 
  optionsObjectCandidate
];

const comparison = await evaluator.evaluateAndSelectBest(originalCode, candidates);
console.log(`最適解: ${comparison.winner.candidate.name}`);
console.log(`リスクスコア削減: ${comparison.winner.scoring.riskScoreReduction}%`);
```

### 5. リスクスコアベース・パターン適用指針（改訂）

#### Early Return Pattern（早期リターン）
**適用条件（リスクスコア判定）:**
- `maxNestingLevel` > 3 での warning/error 違反
- `cognitiveComplexity` の critical 違反
- 条件分岐系メトリクスの複合的な高リスク

**リスクスコア削減目標:** 6-15ポイント
**効果:** ネスト関連違反の削除、認知的負荷軽減

#### Options Object Pattern（オプションオブジェクト）
**適用条件（リスクスコア判定）:**
- `parameterCount` > 4 での error/critical 違反
- パラメータ関連の重み付けスコア上昇
- 関数シグネチャの複雑性による保守性低下

**リスクスコア削減目標:** 2-8ポイント
**効果:** パラメータ違反の解消、インターフェース明確化

#### Extract Method Pattern（メソッド抽出）
**適用条件（リスクスコア判定）:**
- `linesOfCode` > 40 での critical 違反
- `cyclomaticComplexity` と `linesOfCode` の複合高リスク
- `maintainabilityIndex` < 70 の品質劣化

**リスクスコア削減目標:** 10-25ポイント
**効果:** 複数メトリクスの同時改善、責任分離

#### Strategy Pattern（戦略パターン）
**適用条件（リスクスコア判定）:**
- `branchCount` と `cyclomaticComplexity` の複合違反
- Switch/if-else構造による複雑性爆発
- 拡張性制約によるリスク増大

**リスクスコア削減目標:** 8-20ポイント
**効果:** 分岐複雑性の体系化、拡張性向上

### 6. リスクスコアベース・リファクタリング実施指針（改訂）

各関数をリファクタリングする際の**科学的アプローチ:**

1. **事前リスクスコア測定**
```bash
npm run dev -- show --id "function-id" | grep "Risk Score"
```

2. **複数候補作成と評価**
```bash
# 候補A: Early Return適用
# 候補B: Extract Method適用  
# 候補C: 複合パターン適用
npm run dev -- eval candidate-a.ts --evaluate-all --json
npm run dev -- eval candidate-b.ts --evaluate-all --json
npm run dev -- eval candidate-c.ts --evaluate-all --json
```

3. **リスクスコア削減の定量検証**
- 目標削減率: 最低40%のリスクスコア改善
- 副作用監視: 他関数への影響を複数関数評価で確認
- 統合評価: 17種類メトリクスの総合的改善

4. **変更後の即座検証**
```bash
npm run dev scan
npm run dev health  
npm run --silent dev -- list --cc-ge 10 --json | jq '.functions | length'
```

**重要:** 単一メトリクス最適化ではなく、リスクスコア全体の体系的改善に焦点

### 7. 高度な偽リファクタリング検出（改訂）

リスクスコアベース評価による**科学的検証:**

```bash
# 包括的な品質変化分析
npm run dev health
npm run dev -- diff <before-snapshot-id> <after-snapshot-id>

# リスクスコア分布の変化確認
npm run --silent dev -- list --json | jq '.functions[] | select(.metrics.riskScore > 10) | .name'

# 複数関数評価による副作用検出
npm run dev -- eval . --evaluate-all --json | jq '.summary'
```

**高度な警告サイン検出:**
- **リスクスコア偽装**: 個別メトリクス改善だけで総合リスクスコア未改善
- **複雑性移転**: 関数分割により複雑性が単に他の場所に移動
- **メトリクス爆発**: 17種類メトリクスのうち改善が3つ以下
- **構造的劣化**: 新関数群の相互依存性増加
- **認知負荷増大**: 分割により理解困難性が向上

**RefactoringCandidateEvaluatorによる偽装検出:**
```bash
# 候補比較で真の改善を検証
comparison.winner.scoring.riskScoreReduction < 40% → 要再検討
comparison.baseline.score > comparison.winner.score → 改悪判定
```

### 8. afterスナップショットとレポート作成

```bash
# afterスナップショットを作成
npm run dev -- refactor snapshot create "After health-guided refactoring"

# 改善レポートの確認
npm run dev health
npm run dev -- list --cc-ge 10
```

### 9. 最終品質検証とPR作成（改訂）

```bash
# 包括的品質チェック
npm run lint
npm run typecheck
npm test

# リスクスコア改善の最終確認
npm run --silent dev -- list --json | jq '.functions[] | select(.metrics.riskScore > 10) | length'
npm run dev health

# 複数関数評価による全体検証
npm run dev -- eval . --evaluate-all --json > final-assessment.json
```

**科学的PR作成**（以下を含める）：
- **リスクスコア削減実績**: Before/Afterの定量比較
- **適用パターンと効果**: 各パターンのリスクスコア削減寄与度
- **17メトリクス改善分布**: 包括的品質向上の証拠
- **複数候補評価結果**: RefactoringCandidateEvaluatorによる客観的選択根拠
- **偽リファクタリング検証**: 高度検出による品質保証
- **複数関数評価サマリー**: プロジェクト全体への影響分析
- **統計的有意性**: 改善の確実性と持続性の証明

## リスクスコアベース成功基準（改訂）

### 定量的成功指標
- **リスクスコア削減率**: 対象関数で40%以上
- **17メトリクス改善**: 5種類以上のメトリクスで測定可能な向上
- **複数候補評価**: 最適解選択での70ポイント以上獲得
- **複雑性移転防止**: 新関数群のリスクスコア総和が元の80%以下
- **偽リファクタリング検出**: ゼロ件（高度検出システムによる）

### 質的成功指標
- **パターン適用精度**: リスクスコア分析に基づく適切なパターン選択
- **構造的整合性**: 分割後関数群の凝集度向上
- **認知負荷削減**: 理解容易性の実質的改善
- **保守性向上**: `maintainabilityIndex`の統計的有意な改善

### 持続性指標
- **品質安定性**: 改善効果の時系列での持続
- **拡張性確保**: 新機能追加時の品質劣化耐性
- **開発効率向上**: リファクタリング後の開発速度改善

## 革新的な注意事項

このワークフローは、**funcqcの最新リスクスコア知能と複数候補比較システム**を活用した、次世代の科学的リファクタリング手法です。従来の経験的・単一メトリクスアプローチを超越し、17種類の品質指標を統合した包括的な品質改善を実現します。

**重要原則**: 表面的なメトリクス操作ではなく、リスクスコア全体の体系的削減による**本質的なコード品質向上**に特化してください。