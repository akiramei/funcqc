# Scan共有データパイプライン設計

## 概要

funcqcのscanコマンドにおける分析フェーズ間でのデータ共有アーキテクチャの設計文書です。効率的なデータ再利用により、パフォーマンス向上と一貫性のある分析結果を実現します。

## 設計原則

1. **データ共有による効率化**: 各分析フェーズの成果物を共有し、重複計算を排除
2. **統一インターフェース**: 一括実行（--full）と遅延実行（analyze）で同一の共有データ構造
3. **段階的価値向上**: 各フェーズの成果物が次フェーズの精度を向上
4. **パフォーマンス最適化**: 明示的な最適化フラグではなく、常にベストプラクティスを適用

## データフロー概要

```
ファイル発見・スナップショット作成
        ↓
Virtual Project作成（共有データの起点）
        ↓
BASIC分析 → functions
        ↓
CALL_GRAPH分析 → callEdges, internalCallEdges
        ↓
TYPE_SYSTEM分析 → 型依存関係データ
        ↓
COUPLING分析 → 結合度データ
        ↓
他コマンドでの共有データ活用
```

## 共有データ構造

### 核となる共有データ（ScanSharedData）

```typescript
export interface ScanSharedData {
  /** スナップショットID */
  snapshotId: string;
  
  /** 共有ts-morphプロジェクト（全分析の基盤） */
  project: Project;
  
  /** ソースファイル情報（DB正規化済み） */
  sourceFiles: SourceFileInfo[];
  
  /** BASIC分析で抽出された関数情報 */
  functions: FunctionInfo[];
  
  /** ファイルIDマッピング */
  sourceFileIdMap: Map<string, string>;
  
  /** ファイル内容マップ */
  fileContentMap: Map<string, string>;
  
  /** CALL_GRAPH分析結果 */
  callGraphResults?: CallGraphAnalysisResult;
  
  /** TYPE_SYSTEM分析結果 */
  typeSystemResults?: TypeSystemAnalysisResult;
  
  /** COUPLING分析結果 */
  couplingResults?: CouplingAnalysisResult;
}
```

## 分析フェーズ詳細

### 1. BASIC分析

**入力データ**:
- `project`: Virtual Project
- `sourceFiles`: ソースファイル情報

**処理内容**:
- AST解析による関数抽出
- メトリクス計算
- DB保存（functionsテーブル、metricsテーブル）

**共有データ出力**:
- `functions`: 抽出された関数情報
- `batchStats`: バッチ処理統計

### 2. CALL_GRAPH分析

**入力データ**:
- `project`: Virtual Project（AST情報）
- `functions`: BASIC分析結果

**処理内容**:
- 関数間呼び出し関係分析
- 内部呼び出し関係分析
- 信頼度計算

**共有データ出力**:
```typescript
callGraphResults: {
  callEdges: CallEdge[];           // 外部呼び出し
  internalCallEdges: InternalCallEdge[]; // 内部呼び出し
  dependencyMap: Map<string, {     // 依存関係マップ
    callers: string[];
    callees: string[];
    depth: number;
  }>;
  stats: {
    totalEdges: number;
    highConfidenceEdges: number;
    analysisTime: number;
  };
}
```

**他分析での活用**:
- TYPE_SYSTEM: 型の流れ追跡
- COUPLING: 構造的依存関係の基礎

### 3. TYPE_SYSTEM分析

**入力データ**:
- `project`: TypeChecker利用
- `functions`: 型分析対象
- `callGraphResults`: 型の流れ分析

**処理内容**:
- 関数の型情報分析
- 型依存関係抽出
- 型安全性評価

**共有データ出力**:
```typescript
typeSystemResults: {
  typeDependencyMap: Map<string, {
    usedTypes: string[];
    exposedTypes: string[];
    typeComplexity: number;
  }>;
  typeSafetyMap: Map<string, {
    hasAnyTypes: boolean;
    typeAnnotationRatio: number;
  }>;
  typeCouplingData: {
    stronglyTypedPairs: Array<{func1: string, func2: string, strength: number}>;
    typeInconsistencies: Array<{edge: CallEdge, issue: string}>;
  };
}
```

**他分析での活用**:
- COUPLING: 型レベル結合度分析

### 4. COUPLING分析

**入力データ**:
- `functions`: 基本情報
- `callGraphResults`: 構造的依存関係
- `typeSystemResults`: 型レベル依存関係

**処理内容**:
- 多面的結合度分析（構造×型×品質）
- 結合度統計計算
- 問題箇所特定

**共有データ出力**:
```typescript
couplingResults: {
  functionCouplingMatrix: Map<string, Map<string, number>>;
  fileCouplingData: Map<string, {
    incomingCoupling: number;
    outgoingCoupling: number;
    totalCoupling: number;
  }>;
  highCouplingFunctions: Array<{
    functionId: string;
    couplingScore: number;
    reasons: string[];
  }>;
}
```

## 実行パターン

### パターン1: 一括実行（--full）

```typescript
async function performFullScan(config: ScanPipelineConfig) {
  // 1. 初期データ構築
  const sharedData: ScanSharedData = {
    snapshotId,
    project: await createVirtualProject(snapshotId),
    sourceFiles: await loadSourceFiles(snapshotId),
    functions: [],
    sourceFileIdMap: await buildFileIdMap(snapshotId),
    fileContentMap: await buildContentMap(snapshotId)
  };

  // 2. 段階的分析実行（メモリ上でデータ蓄積）
  if (config.enableBasic) {
    const basicResult = await performBasicAnalysis(sharedData);
    sharedData.functions = basicResult.functions;
  }

  if (config.enableCallGraph) {
    const callGraphResult = await performCallGraphAnalysis(sharedData);
    sharedData.callGraphResults = callGraphResult;
  }

  if (config.enableTypeSystem) {
    const typeSystemResult = await performTypeSystemAnalysis(sharedData);
    sharedData.typeSystemResults = typeSystemResult;
  }

  if (config.enableCoupling) {
    const couplingResult = await performCouplingAnalysis(sharedData);
    sharedData.couplingResults = couplingResult;
  }

  return sharedData;
}
```

### パターン2: 遅延実行（analyze）

```typescript
async function performDeferredAnalysis(
  snapshotId: string, 
  analysisType: 'CALL_GRAPH' | 'TYPE_SYSTEM' | 'COUPLING'
) {
  // 1. 既存データをDBから復元
  const sharedData: ScanSharedData = {
    snapshotId,
    project: await recreateVirtualProject(snapshotId),
    sourceFiles: await storage.getSourceFilesBySnapshot(snapshotId),
    functions: await storage.findFunctionsInSnapshot(snapshotId),
    sourceFileIdMap: await buildFileIdMapFromDB(snapshotId),
    fileContentMap: await buildContentMapFromDB(snapshotId)
  };

  // 2. 必要な前段階の成果物をロード
  if (analysisType !== 'CALL_GRAPH') {
    sharedData.callGraphResults = await loadCallGraphFromDB(snapshotId);
  }
  
  if (analysisType === 'COUPLING') {
    sharedData.typeSystemResults = await loadTypeSystemFromDB(snapshotId);
  }

  // 3. 対象分析実行（同一の分析関数を使用）
  switch (analysisType) {
    case 'CALL_GRAPH':
      return await performCallGraphAnalysis(sharedData);
    case 'TYPE_SYSTEM':
      return await performTypeSystemAnalysis(sharedData);
    case 'COUPLING':
      return await performCouplingAnalysis(sharedData);
  }
}
```

## 他コマンドでの共有データ活用

### healthコマンド

```typescript
async function calculateProjectHealth(snapshotId: string) {
  const sharedData = await loadCompleteAnalysisData(snapshotId);
  
  // 全分析結果を統合した包括的な品質評価
  const healthScore = calculateHealthFromSharedData({
    functions: sharedData.functions,
    coupling: sharedData.couplingResults,
    types: sharedData.typeSystemResults,
    callGraph: sharedData.callGraphResults
  });
  
  return healthScore;
}
```

### listコマンド

```typescript
// 結合度でソート
funcqc list --sort coupling --desc

// 実装例
async function listFunctionsWithCoupling(options: ListOptions) {
  const sharedData = await loadCompleteAnalysisData(snapshotId);
  const coupling = sharedData.couplingResults?.functionCouplingMatrix;
  
  return sharedData.functions
    .map(f => ({ ...f, coupling: coupling?.get(f.id) }))
    .sort((a, b) => (b.coupling || 0) - (a.coupling || 0));
}
```

## パフォーマンス考慮事項

### ts-morph Projectのキャッシュ利用

- **前提**: ts-morphが内部でAST情報をキャッシュしていると仮定
- **検証**: 2回目以降のSourceFile取得・AST走査の性能測定
- **最適化**: 必要に応じて明示的なASTキャッシュ層を追加

### メモリ使用量管理

- 大規模プロジェクトでのメモリ使用量監視
- 不要になった中間データの適切な解放
- ストリーミング処理への切り替え閾値設定

## 実装ステップ

1. **Phase 1**: 基本的な共有データ構造の実装
2. **Phase 2**: 一括実行パターンでの分析フェーズ統合
3. **Phase 3**: 遅延実行パターンの実装
4. **Phase 4**: 他コマンドでの共有データ活用
5. **Phase 5**: パフォーマンス最適化・監視機能追加

## 期待効果

- **パフォーマンス向上**: 重複計算の排除により20-30%の実行時間短縮
- **分析精度向上**: 段階的データ蓄積による多面的で精密な分析
- **コード品質向上**: 統一インターフェースによる保守性・拡張性の向上
- **開発効率向上**: 新機能追加時の既存データ活用による開発速度向上