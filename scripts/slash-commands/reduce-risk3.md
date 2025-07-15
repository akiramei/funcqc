# /reduce-risk3

Advanced Risk Score-Based Refactoring - リスクスコア評価と複数候補比較による高度なリファクタリングワークフロー

## 概要

このワークフローは、funcqcの最新のリスクスコアベース評価システムと複数候補比較機能を活用して、科学的かつ確実性の高いリファクタリングを実行します。従来の単一メトリクス評価から、17種類の品質指標を統合したリスクスコアによる包括的な品質改善を実現します。

## 実行手順

### 1. 初期分析とリスク評価

```bash
# 現在の状態を記録（ラベル付きで履歴管理）
npm run dev scan --label "Before-RiskReduction-$(date +%Y%m%d-%H%M)"

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

# beforeスナップショットを作成（リファクタリング専用ラベル）
npm run dev scan --label "Before-Refactoring-$(whoami)-$(date +%Y%m%d-%H%M)"
npm run dev -- refactor snapshot create "Before risk-score-based refactoring"
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

### 4. 実際のリファクタリング実行（必須）

**⚠️ CRITICAL: 実際の関数を変更する**

high-risk-functions.txtから**1つの関数を選択**して、実際にリファクタリングを実行：

```bash
# Step 1: 対象関数の特定と現状把握
TARGET_ID=$(head -1 high-risk-functions.txt | cut -d' ' -f1)
npm run dev -- show --id "$TARGET_ID" > before-function.txt

# Step 2: 現在のファイルをバックアップ
TARGET_FILE=$(npm run dev -- show --id "$TARGET_ID" | grep "File:" | cut -d' ' -f2 | cut -d':' -f1)
cp "$TARGET_FILE" "${TARGET_FILE}.backup"

# Step 3: 実際のリファクタリング実行
# ここで実際にコードエディタで関数を修正する
echo "⚠️  手動作業: $TARGET_FILE の関数を実際に分割してください"
echo "   - Early Return パターンの適用"
echo "   - Extract Method による関数分割"
echo "   - ネスト削減、責任分離"
```

**複数パターンによる手動リファクタリング評価:**

各高リスク関数に対して、複数のリファクタリング戦略を手動で実施し評価：

1. **Early Return Pattern**: ネストレベル削減
2. **Extract Method Pattern**: 関数分割による複雑度削減  
3. **Options Object Pattern**: パラメータ数削減
4. **Strategy Pattern**: 条件分岐の体系化

**実用的なパターン適用と評価プロセス:**

```bash
# Step 1: 高リスク関数の実装を確認
npm run dev -- show --id "function-id" > original-function.txt

# Step 2: 複数パターンを実際のコードに適用
# 実際のファイルを直接編集して各パターンを試行
# - Early Return Pattern適用版
# - Extract Method Pattern適用版  
# - Options Object Pattern適用版

# Step 3: 各パターン適用後の評価
npm run dev scan --label "Pattern-EarlyReturn-$(date +%Y%m%d-%H%M)"
npm run dev -- eval --evaluate-all --json > result-early-return.json

npm run dev scan --label "Pattern-ExtractMethod-$(date +%Y%m%d-%H%M)"
npm run dev -- eval --evaluate-all --json > result-extract-method.json

# Step 4: 結果比較と最適解選択
npm run dev health  # 全体的な品質確認
jq '.aggregatedScore' result-*.json | sort -nr | head -1  # 最高スコア確認
jq '.summary.totalFunctions' result-*.json  # 関数爆発チェック
```

**期待される評価パターン:**
- **良いパターン**: 集約スコア 95-100、違反数 0-2、適切な関数数
- **ダメなパターン**: 集約スコア <80、関数爆発、複雑性移転

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

4. **必須：実際の改善検証**
```bash
# 変更後のスキャンと比較
npm run dev scan --label "After-Refactoring-$(date +%Y%m%d-%H%M)"
npm run dev health

# 具体的な改善確認（失敗基準付き）
BEFORE_COUNT=$(cat before-high-risk-count.txt)
AFTER_COUNT=$(npm run --silent dev -- list --cc-ge 10 --json | jq '.functions | length')

if [ "$AFTER_COUNT" -ge "$BEFORE_COUNT" ]; then
  echo "🚨 FAILURE: 高リスク関数が減っていません ($BEFORE_COUNT → $AFTER_COUNT)"
  echo "リファクタリングに失敗しました。元のファイルを復元してください。"
  exit 1
fi

echo "✅ SUCCESS: 高リスク関数が削減されました ($BEFORE_COUNT → $AFTER_COUNT)"

# 対象関数の個別確認
npm run dev -- show --id "$TARGET_ID" > after-function.txt
echo "Before/Afterの比較:"
echo "Before: $(cat before-function.txt | grep -E 'CC|LOC')"
echo "After:  $(cat after-function.txt | grep -E 'CC|LOC')"
```

**🚨 失敗時の対応:**
- バックアップからの復元
- 別のパターンでの再試行
- 関数選択の見直し

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
- **🚨 関数重複**: 同一機能の関数が複数ファイルに作成される（実例発生）
- **🚨 デモ詐欺**: 候補ファイル作成だけで実際のコードを変更しない（実例発生）
- **🚨 作業評価欠如**: 改善を測定せずに成功を主張（実例発生）

**品質分析による偽装検出:**
```bash
# 健康状態の変化で真の改善を検証
npm run dev health  # リファクタリング前後の比較
npm run dev -- list --cc-ge 10  # 高リスク関数の増減確認

# 実証済み検出パターン
jq '.aggregatedScore < 80' result.json → 品質不十分
jq '.summary.totalFunctions > (original_count * 3)' → 関数爆発
jq '[.allFunctions[].violations] | add | length > 5' → 違反集積

# 関数重複検出（実例による追加）
npm run dev -- diff HEAD~2 HEAD --lineage --lineage-auto-save | grep "split" → 重複検出
grep -r "function functionName" src/ | wc -l → 同名関数カウント
```

**実際の警告サイン実例:**
```json
// ❌ ダメな候補の特徴
{
  "aggregatedScore": 65.4,           // 低品質スコア
  "summary": {
    "totalFunctions": 25,            // 関数爆発 (元1個→25個)
    "acceptableFunctions": 15        // 不合格関数多数
  },
  "violations": [...15個の違反...]   // 問題未解決
}

// ✅ 良い候補の特徴  
{
  "aggregatedScore": 99.6,           // 高品質スコア
  "summary": {
    "totalFunctions": 8,             // 適切な分割
    "acceptableFunctions": 8         // 全関数合格
  },
  "violations": [...]                // 最小限の軽微違反
}
```

### 8. afterスナップショットとレポート作成

```bash
# afterスナップショットを作成（成果記録）
npm run dev scan --label "After-RiskReduction-Success-$(date +%Y%m%d-%H%M)"
npm run dev -- refactor snapshot create "After risk-score-based refactoring"

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
- **複数パターン評価結果**: 手動適用による客観的効果測定
- **偽リファクタリング検証**: 高度検出による品質保証
- **複数関数評価サマリー**: プロジェクト全体への影響分析
- **統計的有意性**: 改善の確実性と持続性の証明

## リスクスコアベース成功基準（改訂）

### 定量的成功指標（実証済み基準）
- **集約スコア**: 95-100ポイント獲得（実証: 99.6-100達成）
- **リスクスコア削減率**: 対象関数で40%以上（実証: 90%以上削減）
- **関数分割適正性**: 元関数×2-3倍以内（実証: 1→8個、1→21個）
- **違反数**: 0-2個の軽微違反のみ（実証: 1-2個達成）
- **全関数合格率**: 100%（実証: 8/8、21/21達成）
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

## 🚨 必須チェックリスト（詐欺防止）

### 作業前チェック
- [ ] 対象となる具体的な複雑関数を特定したか？
- [ ] その関数のファイルパスと行番号を記録したか？
- [ ] 現在の複雑度とリスクスコアを記録したか？

### 作業中チェック  
- [ ] 実際に元のファイルを編集しているか？
- [ ] 新しいファイルを作成していないか？
- [ ] 候補ファイルではなく実際のコードを変更しているか？

### 作業後チェック
- [ ] 高リスク関数の総数が減ったか？
- [ ] 対象関数の複雑度が実際に下がったか？
- [ ] health コマンドで品質向上が確認できるか？
- [ ] 変更したファイルで関数が実際に分割されているか？

### ❌ 以下は偽のリファクタリング
- 候補ファイルの作成のみ
- 新機能の開発
- 既存関数の無修正
- デモ用ファイルでの評価のみ

## 革新的な注意事項

このワークフローは、**実際のコード変更による確実な品質改善**に特化します。デモや理論ではなく、**測定可能な現実の改善**のみを成果として認めます。

**重要原則**: 候補評価ではなく、実際のコード変更による**検証可能な品質向上**に特化してください。

## 🧹 後処理とクリーンアップ

### 候補ファイルのクリーンアップ
```bash
# 評価完了後、候補ファイルとレポートを削除
rm candidate-*.ts result-*.json original-function.txt

# または、記録保持のためアーカイブディレクトリに移動
mkdir -p refactoring-archive/$(date +%Y%m%d)
mv candidate-*.ts result-*.json refactoring-archive/$(date +%Y%m%d)/
```

### 作業効率化のエイリアス
```bash
# .bashrc または .zshrc に追加
alias funcqc-scan='npm run dev scan'
alias funcqc-health='npm run dev health'  
alias funcqc-eval='npm run dev -- eval --evaluate-all --json'
alias funcqc-risks='npm run --silent dev -- list --cc-ge 10 --json | jq -r ".functions[] | \"\(.id) \(.name)\""'

# ラベル付きスキャン関数
funcqc-scan-labeled() {
  local label="${1:-Manual-Scan}"
  npm run dev scan --label "${label}-$(whoami)-$(date +%Y%m%d-%H%M)"
}

# リファクタリング段階別スキャン
alias funcqc-before='funcqc-scan-labeled "Before-Refactoring"'
alias funcqc-after='funcqc-scan-labeled "After-Refactoring"'
alias funcqc-pattern='funcqc-scan-labeled "Pattern-Applied"'
```

### ラベリング命名規則
```bash
# 推奨されるラベル形式:
# {段階}-{目的}-{開発者}-{日時}

# 例:
Before-RiskReduction-alice-20250716-1430
After-EarlyReturn-bob-20250716-1445  
Pattern-ExtractMethod-charlie-20250716-1500
Success-OptimizationComplete-alice-20250716-1530

# 履歴検索での活用:
npm run dev history | grep "Before-"     # 開始時点の記録
npm run dev history | grep "Success-"    # 成功した改善
npm run dev history | grep "alice"       # 特定開発者の作業
```