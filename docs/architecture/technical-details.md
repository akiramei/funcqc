# funcqc改善実装 - 技術詳細仕様書

## 📋 概要

この文書では、funcqc改善実装の具体的な技術詳細、アーキテクチャ設計、実装方針を詳述します。

## 🚨 Phase 1: Health精度修正の詳細実装

### 1.1 問題の技術的分析

#### 現在の実装（問題あり）
```typescript
// src/cli/commands/health/structural-analyzer.ts:209
export async function analyzeStructuralMetrics(
  snapshotId: string,
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  env: CommandEnvironment
): Promise<StructuralMetrics> {
  // ... 
  const { sccResult, depMetrics, fanStats } = performSCCAnalysis(functions, callEdges);
  
  const baseMetrics: StructuralMetrics = {
    // 問題: 再帰関数を直接カウント
    cyclicFunctions: sccResult.recursiveFunctions.length,  // ← 76を使用
    // ...
  };
}
```

#### ペナルティ計算（src/cli/commands/health/calculator.ts:140-141）
```typescript
// 現在の問題計算
const cyclicFunctionsPenalty = structuralData.cyclicFunctions > 5 
  ? (structuralData.cyclicFunctions - 5) * 3   // (76-5)*3 = 213pts
  : 0;

// 最終的な影響
// Raw: -213pts → Cap適用: -41.1pts → Health Index: 17.5/100
```

### 1.2 修正実装の詳細

#### Step 1: EnhancedCycleAnalyzer統合
```typescript
// src/cli/commands/health/structural-analyzer.ts
import { EnhancedCycleAnalyzer } from '../../../analyzers/enhanced-cycle-analyzer';
import { DEFAULT_CYCLE_OPTIONS } from '../../dep/cycles';

export async function analyzeStructuralMetrics(
  snapshotId: string,
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  env: CommandEnvironment
): Promise<StructuralMetrics> {
  
  // 既存のSCC分析は保持（他の機能で使用）
  const { sccResult, depMetrics, fanStats } = performSCCAnalysis(functions, callEdges);
  
  // 新規: Enhanced Cycle分析（dep cyclesと同じ設定）
  const enhancedAnalyzer = new EnhancedCycleAnalyzer();
  const cycleAnalysisOptions = {
    excludeRecursive: true,  // dep cyclesと同じ
    excludeClear: true,
    minComplexity: 4,
    sortByImportance: true
  };
  
  const cycleResult = await enhancedAnalyzer.analyzeClassifiedCycles(
    callEdges, 
    functions, 
    cycleAnalysisOptions
  );
  
  // 真の循環依存のみをカウント
  const trueCyclicFunctions = cycleResult.classifiedCycles
    .flat()
    .reduce((acc, cycle) => acc + cycle.functions.length, 0);
  
  const baseMetrics: StructuralMetrics = {
    totalComponents: sccResult.totalComponents,
    largestComponentSize: sccResult.largestComponentSize,
    
    // 修正: 真の循環依存のみ
    cyclicFunctions: trueCyclicFunctions,  // 1-4を期待
    
    // 追加: 詳細情報の保持
    recursiveFunctions: sccResult.recursiveFunctions.length,  // 参考情報として
    enhancedCycleAnalysis: cycleResult,  // 詳細分析結果
    
    hubFunctions: depMetrics.filter(m => m.fanIn >= hubThreshold).length,
    avgFanIn: Math.round(fanStats.avgFanIn * 10) / 10,
    avgFanOut: Math.round(fanStats.avgFanOut * 10) / 10,
    maxFanIn: fanStats.maxFanIn,
    maxFanOut: fanStats.maxFanOut,
    structuralRisk: calculateStructuralRisk(sccResult, hubFunctions, fanStats.maxFanIn, fanStats.maxFanOut),
    hubThreshold,
    hubFunctionIds: depMetrics.filter(m => m.fanIn >= hubThreshold).map(m => m.functionId),
    
    // 修正: 真の循環依存のみ
    cyclicFunctionIds: cycleResult.classifiedCycles
      .flat()
      .flatMap(cycle => cycle.functions.map(f => f.id)),
    
    pageRank: pageRankMetrics,
    depMetrics
  };
}
```

#### Step 2: StructuralMetrics型の拡張
```typescript
// src/cli/commands/health/types.ts
export interface StructuralMetrics {
  // 既存フィールド
  totalComponents: number;
  largestComponentSize: number;
  cyclicFunctions: number;  // 真の循環依存のみ
  
  // 新規フィールド（詳細情報）
  recursiveFunctions?: number;  // 参考情報
  enhancedCycleAnalysis?: CyclesAnalysisResult;  // 詳細分析
  
  // その他既存フィールドは維持
  hubFunctions: number;
  avgFanIn: number;
  avgFanOut: number;
  maxFanIn: number;
  maxFanOut: number;
  structuralRisk: string;
  hubThreshold: number;
  hubFunctionIds: string[];
  cyclicFunctionIds: string[];
  pageRank: PageRankMetrics;
  depMetrics: DependencyMetrics[];
  penaltyBreakdown?: PenaltyBreakdown;
}
```

#### Step 3: 表示の改善
```typescript
// src/cli/commands/health/display.ts
export function displayStructuralHealth(metrics: StructuralMetrics): void {
  console.log('🏗️  Structural Health Overview:');
  console.log(`  ├── SCC Components: ${metrics.totalComponents} (largest: ${metrics.largestComponentSize})`);
  
  // 改善: 詳細表示
  if (metrics.recursiveFunctions && metrics.recursiveFunctions > 0) {
    console.log(`  ├── Recursive Functions: ${metrics.recursiveFunctions} ✅ (normal patterns)`);
  }
  
  if (metrics.cyclicFunctions > 0) {
    console.log(`  ├── Cyclic Functions: ${metrics.cyclicFunctions} ⚠️ (true design issues)`);
  } else {
    console.log(`  ├── Cyclic Functions: ${metrics.cyclicFunctions} ✅ (no circular dependencies)`);
  }
  
  // 詳細分析の表示
  if (metrics.enhancedCycleAnalysis) {
    const analysis = metrics.enhancedCycleAnalysis;
    console.log(`  ├── Enhanced Cycle Analysis:`);
    console.log(`  │   ├── Total Detected: ${analysis.totalCycles}`);
    console.log(`  │   ├── Recursive (excluded): ${analysis.filteredOut?.recursive || 0}`);
    console.log(`  │   ├── Clear chains (excluded): ${analysis.filteredOut?.clear || 0}`);
    console.log(`  │   └── True Issues: ${analysis.classifiedCycles.length}`);
  }
}
```

### 1.3 テストケースの実装

```typescript
// test/cli/commands/health/structural-analyzer.test.ts
describe('StructuralAnalyzer Health Fix', () => {
  test('should exclude recursive functions from cyclic penalty', async () => {
    // Setup: 正常な再帰関数を含むテストデータ
    const functions = createTestFunctions();
    const callEdges = createRecursiveCallEdges(); // 自己参照エッジ
    
    const metrics = await analyzeStructuralMetrics(
      'test-snapshot',
      functions,
      callEdges,
      mockEnv
    );
    
    // 検証: 再帰関数は除外される
    expect(metrics.cyclicFunctions).toBe(0); // 真の循環依存なし
    expect(metrics.recursiveFunctions).toBeGreaterThan(0); // 再帰関数は存在
    
    // ペナルティ計算の検証
    const penalty = calculateStructuralPenaltyBreakdown(metrics);
    expect(penalty.cyclicFunctionsPenalty).toBe(0); // ペナルティなし
  });
  
  test('should detect true circular dependencies', async () => {
    // Setup: 真の循環依存を含むテストデータ
    const functions = createTestFunctions();
    const callEdges = createCircularCallEdges(); // A→B→C→A
    
    const metrics = await analyzeStructuralMetrics(
      'test-snapshot',
      functions,
      callEdges,
      mockEnv
    );
    
    // 検証: 真の循環依存は検出される
    expect(metrics.cyclicFunctions).toBeGreaterThan(0);
    
    const penalty = calculateStructuralPenaltyBreakdown(metrics);
    expect(penalty.cyclicFunctionsPenalty).toBeGreaterThan(0);
  });
});
```

### 1.4 検証方法

```bash
# 修正前の検証
npm run dev -- health --verbose
# Cyclic Functions: 76 ⚠️
# Health Index: 17.5/100 (Critical)

# 修正後の期待値
npm run dev -- health --verbose  
# Recursive Functions: 76 ✅ (normal patterns)
# Cyclic Functions: 1-4 ⚠️ (true design issues)
# Health Index: 45-55/100 (Fair-Good)

# dep cyclesとの一貫性確認
npm run dev -- dep cycles
# Should show same 1-4 cycles as health command
```

## 📊 Phase 2: 機能統合のアーキテクチャ設計

### 2.1 統合コマンドのアーキテクチャ

#### 共通基盤の設計
```typescript
// src/cli/commands/unified/base-command.ts
export abstract class UnifiedCommand {
  protected analyzer: EnhancedAnalyzer;
  protected formatter: UnifiedFormatter;
  protected validator: InputValidator;
  
  constructor(protected env: CommandEnvironment) {
    this.analyzer = new EnhancedAnalyzer();
    this.formatter = new UnifiedFormatter();
    this.validator = new InputValidator();
  }
  
  abstract execute(options: UnifiedOptions): Promise<void>;
  
  // 共通の段階的詳細化
  protected getDetailLevel(options: UnifiedOptions): DetailLevel {
    if (options.expert) return 'expert';
    if (options.detailed) return 'detailed';
    return 'basic';
  }
  
  // 共通の出力フォーマット
  protected formatOutput(data: any, options: UnifiedOptions): string {
    return this.formatter.format(data, {
      level: this.getDetailLevel(options),
      format: options.format || 'table',
      interactive: options.interactive || false
    });
  }
}
```

#### 共通オプション定義
```typescript
// src/cli/commands/unified/types.ts
export interface UnifiedOptions {
  // 段階的詳細化
  level?: 'basic' | 'detailed' | 'expert';
  
  // 出力制御
  format?: 'table' | 'json' | 'friendly';
  interactive?: boolean;
  
  // フィルタリング
  focus?: string[];
  limit?: number;
  
  // パフォーマンス
  cache?: boolean;
  parallel?: boolean;
}

export type DetailLevel = 'basic' | 'detailed' | 'expert';

export interface UnifiedResult {
  data: any;
  metadata: ResultMetadata;
  recommendations?: Recommendation[];
}

export interface ResultMetadata {
  executionTime: number;
  dataFreshness: Date;
  confidence: number;
  limitations?: string[];
}
```

### 2.2 `inspect`コマンドの詳細実装

```typescript
// src/cli/commands/unified/inspect.ts
export class InspectCommand extends UnifiedCommand {
  async execute(options: InspectOptions): Promise<void> {
    const { type, filters, level } = options;
    
    // 統合データ取得（並列実行）
    const [functions, files, types] = await Promise.all([
      this.getFunctions(filters),
      this.getFiles(filters),
      this.getTypes(filters)
    ]);
    
    switch (type) {
      case 'functions':
        return this.inspectFunctions(functions, options);
      case 'files':
        return this.inspectFiles(files, options);
      case 'types':
        return this.inspectTypes(types, options);
      default:
        return this.inspectAll({ functions, files, types }, options);
    }
  }
  
  private async inspectFunctions(
    functions: FunctionInfo[], 
    options: InspectOptions
  ): Promise<void> {
    // list機能のフィルタリング継承
    const filtered = this.applyFunctionFilters(functions, options);
    
    // search機能の検索統合
    const searched = options.query 
      ? this.searchFunctions(filtered, options.query)
      : filtered;
    
    // show機能の詳細表示統合
    const enriched = await this.enrichFunctionData(searched, options.level);
    
    // 統一出力
    const result = this.formatOutput(enriched, options);
    console.log(result);
  }
  
  private applyFunctionFilters(
    functions: FunctionInfo[], 
    options: InspectOptions
  ): FunctionInfo[] {
    let result = functions;
    
    // list機能からの継承フィルター
    if (options.ccGe) {
      result = result.filter(f => f.cyclomaticComplexity >= options.ccGe!);
    }
    
    if (options.locGe) {
      result = result.filter(f => f.linesOfCode >= options.locGe!);
    }
    
    if (options.file) {
      result = result.filter(f => f.filePath.includes(options.file!));
    }
    
    if (options.name) {
      const pattern = new RegExp(options.name, 'i');
      result = result.filter(f => pattern.test(f.name));
    }
    
    // 新機能: 複合フィルター
    if (options.risk) {
      result = result.filter(f => this.calculateRisk(f) >= options.risk!);
    }
    
    return result;
  }
  
  private async enrichFunctionData(
    functions: FunctionInfo[], 
    level: DetailLevel
  ): Promise<EnrichedFunctionInfo[]> {
    switch (level) {
      case 'basic':
        return functions.map(f => ({ ...f, basicMetrics: this.getBasicMetrics(f) }));
      
      case 'detailed':
        return Promise.all(functions.map(async f => ({
          ...f,
          basicMetrics: this.getBasicMetrics(f),
          dependencies: await this.getDependencies(f),
          qualityMetrics: await this.getQualityMetrics(f)
        })));
      
      case 'expert':
        return Promise.all(functions.map(async f => ({
          ...f,
          basicMetrics: this.getBasicMetrics(f),
          dependencies: await this.getDependencies(f),
          qualityMetrics: await this.getQualityMetrics(f),
          structuralAnalysis: await this.getStructuralAnalysis(f),
          refactoringOpportunities: await this.getRefactoringOpportunities(f)
        })));
    }
  }
}
```

### 2.3 `measure`コマンドの実装

```typescript
// src/cli/commands/unified/measure.ts
export class MeasureCommand extends UnifiedCommand {
  async execute(options: MeasureOptions): Promise<void> {
    const startTime = Date.now();
    
    // 統合測定実行（既存scan + analyze）
    const measurements = await this.performUnifiedMeasurement(options);
    
    // baseline比較機能
    if (options.baseline || options.compareBaseline) {
      await this.handleBaselineComparison(measurements, options);
    }
    
    // 結果表示
    this.displayMeasurements(measurements, options);
    
    const executionTime = Date.now() - startTime;
    console.log(`\n📊 Measurement completed in ${executionTime}ms`);
  }
  
  private async performUnifiedMeasurement(
    options: MeasureOptions
  ): Promise<UnifiedMeasurements> {
    // 共通データ取得（一度だけ）
    const commonData = await this.loadCommonData();
    
    // 並列実行で高速化
    const [basicMetrics, structuralMetrics, typeMetrics] = await Promise.all([
      this.measureBasicMetrics(commonData),       // scan相当
      this.measureStructuralMetrics(commonData),  // health測定部分
      this.measureTypeMetrics(commonData)         // analyze相当
    ]);
    
    // 統合結果
    return {
      basic: basicMetrics,
      structural: structuralMetrics,
      types: typeMetrics,
      metadata: {
        timestamp: new Date(),
        functions: commonData.functions.length,
        files: commonData.files.length,
        executionMode: options.mode || 'full'
      }
    };
  }
  
  private async measureStructuralMetrics(
    commonData: CommonAnalysisData
  ): Promise<StructuralMetrics> {
    // 修正されたhealth分析を使用
    return analyzeStructuralMetrics(
      commonData.snapshotId,
      commonData.functions,
      commonData.callEdges,
      this.env
    );
  }
}
```

### 2.4 データベーススキーマへの影響

#### 新規テーブル: unified_snapshots
```sql
-- 統合測定結果の保存
CREATE TABLE unified_snapshots (
  id TEXT PRIMARY KEY,
  timestamp DATETIME NOT NULL,
  measurement_type TEXT NOT NULL, -- 'measure', 'assess', 'inspect'
  options_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  execution_time_ms INTEGER,
  metadata_json TEXT,
  baseline_id TEXT REFERENCES unified_snapshots(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX idx_unified_snapshots_timestamp ON unified_snapshots(timestamp);
CREATE INDEX idx_unified_snapshots_type ON unified_snapshots(measurement_type);
CREATE INDEX idx_unified_snapshots_baseline ON unified_snapshots(baseline_id);
```

#### 既存テーブルの拡張
```sql
-- snapshots テーブルに enhanced_cycle_analysis 列追加
ALTER TABLE snapshots ADD COLUMN enhanced_cycle_analysis TEXT;

-- functions テーブルに risk_score 列追加
ALTER TABLE functions ADD COLUMN risk_score REAL;
ALTER TABLE functions ADD COLUMN last_analysis_version TEXT;
```

### 2.5 パフォーマンス最適化

#### キャッシュ戦略
```typescript
// src/analyzers/cache/unified-cache.ts
export class UnifiedAnalysisCache {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL = 5 * 60 * 1000; // 5分
  
  async getOrCompute<T>(
    key: string,
    computer: () => Promise<T>,
    dependencies: string[]
  ): Promise<T> {
    const entry = this.cache.get(key);
    
    if (entry && this.isValid(entry, dependencies)) {
      return entry.data;
    }
    
    const data = await computer();
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      dependencies: dependencies.slice()
    });
    
    return data;
  }
  
  private isValid(entry: CacheEntry, dependencies: string[]): boolean {
    // TTL チェック
    if (Date.now() - entry.timestamp > this.TTL) {
      return false;
    }
    
    // 依存関係チェック
    return dependencies.every(dep => 
      entry.dependencies.includes(dep)
    );
  }
}
```

#### 並列実行アーキテクチャ
```typescript
// src/analyzers/parallel/execution-engine.ts
export class ParallelExecutionEngine {
  private readonly workerPool: WorkerPool;
  
  constructor(maxWorkers: number = os.cpus().length) {
    this.workerPool = new WorkerPool(maxWorkers);
  }
  
  async executeParallel<T>(
    tasks: AnalysisTask[],
    options: ExecutionOptions
  ): Promise<T[]> {
    // 依存関係解析
    const dependencyGraph = this.buildDependencyGraph(tasks);
    
    // 実行順序決定
    const executionPlan = this.planExecution(dependencyGraph);
    
    // 段階的並列実行
    const results: T[] = [];
    for (const stage of executionPlan) {
      const stageResults = await Promise.all(
        stage.map(task => this.executeTask(task))
      );
      results.push(...stageResults);
    }
    
    return results;
  }
}
```

## 🔄 Phase 3: 移行戦略の技術実装

### 3.1 エイリアス実装

```typescript
// src/cli/commands/legacy/alias-registry.ts
export class LegacyAliasRegistry {
  private aliases = new Map<string, AliasConfig>();
  
  constructor() {
    this.registerAliases();
  }
  
  private registerAliases(): void {
    // scan → measure
    this.aliases.set('scan', {
      newCommand: 'measure',
      deprecatedSince: '2025-01-15',
      removalDate: '2025-07-15',
      migrationGuide: 'https://funcqc.dev/migration/scan-to-measure',
      optionMapping: {
        '--quick': '--mode quick',
        '--full': '--mode full'
      }
    });
    
    // search → inspect
    this.aliases.set('search', {
      newCommand: 'inspect',
      deprecatedSince: '2025-01-15',
      removalDate: '2025-04-15', // 早期削除
      migrationGuide: 'https://funcqc.dev/migration/search-to-inspect',
      optionMapping: (args: string[]) => {
        const keyword = args[0];
        return `--name "${keyword}"`;
      }
    });
  }
  
  handleLegacyCommand(command: string, args: string[]): LegacyCommandResult {
    const alias = this.aliases.get(command);
    if (!alias) {
      return { type: 'not_found' };
    }
    
    // 削除期限チェック
    if (new Date() > new Date(alias.removalDate)) {
      return {
        type: 'removed',
        message: this.generateRemovalMessage(alias),
        migrationGuide: alias.migrationGuide
      };
    }
    
    // 非推奨警告
    this.showDeprecationWarning(alias);
    
    // 新コマンド実行
    const newArgs = this.mapArguments(args, alias.optionMapping);
    return {
      type: 'redirect',
      newCommand: alias.newCommand,
      newArgs
    };
  }
}
```

### 3.2 設定ファイル移行

```typescript
// src/config/migration/config-migrator.ts
export class ConfigMigrator {
  private migrations = new Map<string, Migration>();
  
  constructor() {
    this.registerMigrations();
  }
  
  private registerMigrations(): void {
    // v1.0 → v2.0 設定移行
    this.migrations.set('1.0->2.0', {
      transform: (oldConfig: any): any => {
        return {
          // 新しい統合設定
          unified: {
            defaultLevel: oldConfig.verbosity === 'high' ? 'detailed' : 'basic',
            cacheEnabled: oldConfig.cache?.enabled ?? true,
            parallelEnabled: oldConfig.performance?.parallel ?? true
          },
          
          // レガシー設定の保持（互換性）
          legacy: {
            scanOptions: oldConfig.scan || {},
            healthOptions: oldConfig.health || {}
          },
          
          // 新機能設定
          features: {
            enhancedCycles: true,
            unifiedCommands: true,
            interactiveMode: false
          }
        };
      },
      validation: (newConfig: any): ValidationResult => {
        // 設定の妥当性検証
        return this.validateConfig(newConfig);
      }
    });
  }
}
```

## 🧪 テスト戦略

### 3.1 統合テスト

```typescript
// test/integration/unified-commands.test.ts
describe('Unified Commands Integration', () => {
  test('measure command should produce consistent results', async () => {
    // テストプロジェクトのセットアップ
    const testProject = await setupTestProject();
    
    // 新旧比較
    const legacyResults = await runLegacyCommands(testProject);
    const unifiedResults = await runUnifiedCommands(testProject);
    
    // 一貫性検証
    expect(unifiedResults.health.index).toBeCloseTo(
      legacyResults.health.index, 
      1 // 小数点1桁の精度
    );
    
    // パフォーマンス検証
    expect(unifiedResults.executionTime).toBeLessThan(
      legacyResults.executionTime * 0.8 // 20%高速化期待
    );
  });
  
  test('inspect command should support all legacy filters', async () => {
    const functions = await getFunctions();
    
    // list機能の全フィルターをテスト
    const inspectResult = await runInspect({
      type: 'functions',
      ccGe: 10,
      locGe: 50,
      file: 'analyzer',
      name: 'analyze*'
    });
    
    // 同等のlist結果と比較
    const listResult = await runList({
      ccGe: 10,
      locGe: 50,
      file: 'analyzer',
      name: 'analyze*'
    });
    
    expect(inspectResult.functions).toEqual(listResult.functions);
  });
});
```

### 3.2 パフォーマンステスト

```typescript
// test/performance/benchmark.test.ts
describe('Performance Benchmarks', () => {
  test('unified measure should be faster than separate commands', async () => {
    const testProject = await setupLargeTestProject(); // 1000+ functions
    
    // 既存の分離実行
    const separateStart = Date.now();
    await runScan(testProject);
    await runAnalyze(testProject);
    await runHealth(testProject);
    const separateTime = Date.now() - separateStart;
    
    // 統合実行
    const unifiedStart = Date.now();
    await runMeasure(testProject, { mode: 'full' });
    const unifiedTime = Date.now() - unifiedStart;
    
    // 20%以上の高速化期待
    expect(unifiedTime).toBeLessThan(separateTime * 0.8);
  });
});
```

## 📊 監視とメトリクス

### 3.1 実装メトリクス収集

```typescript
// src/monitoring/implementation-metrics.ts
export class ImplementationMetrics {
  private metrics = new Map<string, Metric>();
  
  recordCommandUsage(command: string, options: any, executionTime: number): void {
    const key = `command.${command}`;
    
    this.metrics.set(key, {
      type: 'counter',
      value: (this.metrics.get(key)?.value || 0) + 1,
      lastUpdated: Date.now()
    });
    
    this.metrics.set(`${key}.execution_time`, {
      type: 'histogram',
      values: [...(this.metrics.get(`${key}.execution_time`)?.values || []), executionTime],
      lastUpdated: Date.now()
    });
  }
  
  recordHealthIndexImprovement(before: number, after: number): void {
    this.metrics.set('health.improvement', {
      type: 'gauge',
      value: after - before,
      metadata: { before, after },
      lastUpdated: Date.now()
    });
  }
  
  generateReport(): MetricsReport {
    return {
      commandUsage: this.getCommandUsageStats(),
      performanceImpact: this.getPerformanceStats(),
      healthIndexTrend: this.getHealthIndexTrend(),
      migrationProgress: this.getMigrationProgress()
    };
  }
}
```

この技術詳細文書により、開発チームは具体的な実装方針と技術的な課題解決策を理解し、効率的に改善を進めることができます。