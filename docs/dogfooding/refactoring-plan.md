# displayAIOptimizedHealth関数リファクタリング計画

## 📊 現状分析

**対象関数**: `displayAIOptimizedHealth` (src/cli/health.ts:635-751)
**リスクスコア**: 1022 (最高リスク)
**複雑度**: CC=47, COG=47 (極めて高い)
**規模**: 113行 (巨大)
**問題点**: 単一関数に多すぎる責務、深いネスト、複雑な処理フロー

## 🎯 リファクタリング戦略

### Phase 1: 責務の分離と抽出

#### 1. `assessHighRiskFunctions()` - RiskAssessor処理部分
**責務**: 高リスク関数の評価とソート
**抽出対象**: 665-697行
**期待効果**: CC削減、評価ロジックの独立性向上

```typescript
async function assessHighRiskFunctions(
  functionsWithMetrics: FunctionInfo[],
  config: FuncqcConfig
): Promise<{ function: FunctionInfo; riskScore: number; riskFactors: string[] }[]>
```

#### 2. `generateHealthReport()` - レポート生成部分  
**責務**: AIOptimizedHealthReportの構築
**抽出対象**: 700-742行
**期待効果**: データ変換ロジックの明確化

```typescript
function generateHealthReport(
  functionsWithMetrics: FunctionInfo[],
  sortedHighRiskFunctions: Array<{function: FunctionInfo; riskScore: number; riskFactors: string[]}>,
  projectScore: any,
  latest: any,
  config: FuncqcConfig
): AIOptimizedHealthReport
```

#### 3. `handleHealthError()` - エラーハンドリング部分
**責務**: エラー処理とJSON出力
**抽出対象**: 745-750行  
**期待効果**: エラー処理の統一化

```typescript
function handleHealthError(error: unknown): void
```

#### 4. `validateHealthData()` - データ検証部分
**責務**: スナップショットと関数データの検証
**抽出対象**: 641-660行
**期待効果**: 早期リターンロジックの整理

```typescript
async function validateHealthData(
  storage: PGLiteStorageAdapter
): Promise<{ latest: any; functionsWithMetrics: FunctionInfo[] } | null>
```

### Phase 2: メイン関数の簡潔化

リファクタリング後のメイン関数は以下のような簡潔な構造になる予定：

```typescript
async function displayAIOptimizedHealth(
  storage: PGLiteStorageAdapter,
  config: FuncqcConfig,
  _options: HealthCommandOptions
): Promise<void> {
  try {
    // データ検証
    const validatedData = await validateHealthData(storage);
    if (!validatedData) return;
    
    const { latest, functionsWithMetrics } = validatedData;
    
    // プロジェクトスコア計算
    const scorer = new QualityScorer();
    const projectScore = scorer.calculateProjectScore(functionsWithMetrics);
    
    // 高リスク関数評価
    const sortedHighRiskFunctions = await assessHighRiskFunctions(functionsWithMetrics, config);
    
    // レポート生成・出力
    const report = generateHealthReport(functionsWithMetrics, sortedHighRiskFunctions, projectScore, latest, config);
    console.log(JSON.stringify(report, null, 2));
    
  } catch (error) {
    handleHealthError(error);
  }
}
```

## 📈 期待される改善効果

### 定量的改善
- **CC**: 47 → 15未満 (68%削減)
- **COG**: 47 → 15未満 (68%削減)  
- **リスクスコア**: 1022 → 300未満 (70%削減)
- **関数サイズ**: 113行 → 30行未満 (73%削減)

### 定性的改善
- **責務の明確化**: 各関数が単一責務を持つ
- **テスタビリティ**: 各部分を独立してテスト可能
- **再利用性**: 抽出された関数の他箇所での利用可能性
- **保守性**: 変更影響範囲の限定化

## 🔄 実装手順

1. **validateHealthData()** の抽出・実装
2. **handleHealthError()** の抽出・実装
3. **assessHighRiskFunctions()** の抽出・実装
4. **generateHealthReport()** の抽出・実装
5. **メイン関数のリファクタリング**
6. **各段階での動作確認とメトリクス測定**

## 🎯 成功指標

- ✅ TypeScriptコンパイルエラーなし
- ✅ 既存テストの全てが通過
- ✅ health --json 出力の変更なし（機能回帰なし）
- ✅ リスクスコア70%以上削減
- ✅ funcqc自体のhealth評価の改善