# funcqc ユーザーシナリオ対応分析

## 1. 関数一覧と属性判別 ✅ **完全対応可能**

### 現在の設計での対応状況
```bash
# 基本的な関数一覧
funcqc list

# 詳細属性での絞り込み
funcqc list --exported --async
funcqc list --file "*.tsx" --format json

# 関数タイプ別表示
funcqc list --method-only    # クラスメソッドのみ
funcqc list --arrow-only     # アロー関数のみ
```

### データベーススキーマ対応
```sql
CREATE TABLE functions (
  -- 基本情報
  name TEXT NOT NULL,
  signature TEXT NOT NULL,
  file_path TEXT NOT NULL,
  
  -- 属性判別
  is_exported BOOLEAN DEFAULT FALSE,
  is_async BOOLEAN DEFAULT FALSE,
  is_generator BOOLEAN DEFAULT FALSE,
  is_arrow_function BOOLEAN DEFAULT FALSE,
  is_method BOOLEAN DEFAULT FALSE,
  is_constructor BOOLEAN DEFAULT FALSE,
  is_static BOOLEAN DEFAULT FALSE,
  access_modifier TEXT, -- 'public' | 'private' | 'protected'
  parent_class TEXT,    -- 所属クラス名
  
  -- ファイル拡張子検出
  file_extension TEXT   -- '.ts' | '.tsx' | '.js' | '.jsx'
);
```

### 実装例
```typescript
// TSX ファイルの React コンポーネント検出
class TypeScriptAnalyzer {
  extractFunctionInfo(node: ts.FunctionLikeDeclaration): FunctionInfo {
    return {
      name: this.getFunctionName(node),
      isArrowFunction: ts.isArrowFunction(node),
      isMethod: ts.isMethodDeclaration(node),
      isConstructor: ts.isConstructorDeclaration(node),
      isStatic: this.hasStaticModifier(node),
      accessModifier: this.getAccessModifier(node),
      parentClass: this.getParentClassName(node),
      isReactComponent: this.isReactComponent(node), // TSX対応
      // ...
    };
  }
}
```

**対応度**: ✅ **100%** - 現在の設計で完全対応

---

## 2. 品質指標表示 ✅ **完全対応可能**

### 対応可能な指標
```bash
# 品質指標での絞り込み
funcqc list --complexity ">5" --lines ">50" --params ">3"

# 品質レポート
funcqc report --quality-metrics
```

### 計算可能な指標
```typescript
interface QualityMetrics {
  // 現在対応可能
  linesOfCode: number;              // ✅ AST解析で容易
  cyclomaticComplexity: number;     // ✅ 分岐文カウント
  cognitiveComplexity: number;      // ✅ 重み付きネスト計算
  maxNestingLevel: number;          // ✅ AST構造解析
  parameterCount: number;           // ✅ パラメータノード数
  
  // 追加実装が必要だが対応可能
  halsteadVolume: number;           // 🔶 オペレータ・オペランド分析
  maintainabilityIndex: number;     // 🔶 複合指標計算
  fanIn: number;                    // 🔶 依存関係解析
  fanOut: number;                   // 🔶 依存関係解析
  
  // 高度な分析（AI支援）
  semanticComplexity: number;       // 🤖 AI による意味解析
}
```

### 実装例
```typescript
class ComplexityCalculator {
  calculateCyclomaticComplexity(node: ts.Node): number {
    let complexity = 1; // 基底複雑度
    
    const visit = (node: ts.Node) => {
      if (ts.isIfStatement(node) || 
          ts.isWhileStatement(node) ||
          ts.isForStatement(node) ||
          ts.isSwitchStatement(node)) {
        complexity++;
      }
      
      ts.forEachChild(node, visit);
    };
    
    visit(node);
    return complexity;
  }
  
  calculateCognitiveComplexity(node: ts.Node): number {
    // 認知的複雑度の計算ロジック
    // ネストレベルに応じた重み付け
  }
}
```

**対応度**: ✅ **95%** - 基本指標は完全対応、高度な指標は段階的実装

---

## 3. 関数の変更履歴追跡 ✅ **対応可能**

### 変更履歴の追跡方法
```bash
# 特定関数の履歴
funcqc history --function "fetchUser" --file "src/api.ts"

# 品質指標の変化
funcqc diff --function "fetchUser" --metrics-only
funcqc chart --function "fetchUser" --metric complexity
```

### データベース設計
```sql
-- 関数の一意識別（オーバーロード対応）
CREATE TABLE functions (
  id TEXT PRIMARY KEY,              -- AST + signature ベース
  semantic_id TEXT,                 -- 名前 + ファイル位置ベース
  signature_hash TEXT,              -- オーバーロード識別用
  
  -- 変更追跡
  snapshot_id TEXT,
  previous_version_id TEXT,         -- 前バージョンへの参照
  change_type TEXT,                 -- 'added' | 'modified' | 'removed'
);

-- 変更詳細
CREATE TABLE function_changes (
  id SERIAL PRIMARY KEY,
  function_id TEXT,
  snapshot_id TEXT,
  change_field TEXT,                -- 'signature' | 'complexity' | 'lines'
  old_value TEXT,
  new_value TEXT,
  impact_score INTEGER              -- 変更の影響度
);
```

### 実装例
```typescript
class FunctionTracker {
  async trackChanges(
    oldFunctions: FunctionInfo[], 
    newFunctions: FunctionInfo[]
  ): Promise<FunctionChange[]> {
    
    const changes: FunctionChange[] = [];
    
    for (const newFunc of newFunctions) {
      // セマンティックIDで同一関数を特定
      const oldFunc = this.findSemanticMatch(newFunc, oldFunctions);
      
      if (oldFunc) {
        // オーバーロードの変更検出
        if (oldFunc.signatureHash !== newFunc.signatureHash) {
          changes.push({
            type: 'signature_change',
            function: newFunc,
            oldSignature: oldFunc.signature,
            newSignature: newFunc.signature
          });
        }
        
        // 品質指標の変化
        const metricsChange = this.compareMetrics(oldFunc, newFunc);
        if (metricsChange.hasSignificantChange) {
          changes.push({
            type: 'quality_change',
            function: newFunc,
            metricsChange
          });
        }
      }
    }
    
    return changes;
  }
}
```

**対応度**: ✅ **90%** - 基本的な履歴追跡は対応、オーバーロード詳細追跡は高度な実装が必要

---

## 4. 品質悪化の検出 ✅ **対応可能**

### 悪化検出機能
```bash
# 品質悪化の検出
funcqc regressions --since "1 week ago"
funcqc regressions --threshold complexity:+2,lines:+50

# Git連携での原因調査
funcqc blame --regression complexity --function "processData"
```

### 実装アプローチ
```typescript
interface QualityRegression {
  functionId: string;
  functionName: string;
  regressionType: 'complexity' | 'lines' | 'parameters';
  oldValue: number;
  newValue: number;
  changePercent: number;
  snapshotId: string;
  gitCommit?: string;
  gitAuthor?: string;
  pullRequest?: string;
  relatedIssue?: string;
}

class RegressionDetector {
  async detectRegressions(
    fromSnapshot: string, 
    toSnapshot: string,
    thresholds: QualityThresholds
  ): Promise<QualityRegression[]> {
    
    const query = `
      WITH regression_analysis AS (
        SELECT 
          f2.id,
          f2.name,
          f1.metrics->>'cyclomaticComplexity' as old_complexity,
          f2.metrics->>'cyclomaticComplexity' as new_complexity,
          s2.git_commit,
          s2.git_author,
          s2.metadata->>'pullRequest' as pr
        FROM functions f1
        JOIN functions f2 ON f1.semantic_id = f2.semantic_id
        JOIN snapshots s1 ON f1.snapshot_id = s1.id
        JOIN snapshots s2 ON f2.snapshot_id = s2.id
        WHERE s1.id = $1 AND s2.id = $2
          AND (f2.metrics->>'cyclomaticComplexity')::int > 
              (f1.metrics->>'cyclomaticComplexity')::int + $3
      )
      SELECT * FROM regression_analysis;
    `;
    
    const results = await this.db.query(query, [
      fromSnapshot, 
      toSnapshot, 
      thresholds.complexity
    ]);
    
    return results.rows.map(this.mapToRegression);
  }
}
```

### Git/Issue連携
```typescript
class GitIntegration {
  async enrichWithGitInfo(regression: QualityRegression): Promise<QualityRegression> {
    // Git blame で変更者特定
    const blameInfo = await this.getBlameInfo(
      regression.functionFile, 
      regression.functionLine
    );
    
    // PR情報取得
    const prInfo = await this.getPullRequestInfo(regression.gitCommit);
    
    // Issue連携
    const relatedIssues = await this.findRelatedIssues(prInfo.number);
    
    return {
      ...regression,
      gitAuthor: blameInfo.author,
      pullRequest: prInfo.url,
      relatedIssue: relatedIssues[0]?.url
    };
  }
}
```

**対応度**: ✅ **85%** - 基本的な悪化検出は対応、Git/Issue連携は追加実装が必要

---

## 5. 品質ランキング ✅ **完全対応可能**

### ランキング機能
```bash
# 複雑度ワースト
funcqc ranking --metric complexity --worst 10

# 改善度ベスト
funcqc ranking --metric improvement --best 10 --since "1 month ago"

# ファイル別品質
funcqc ranking --by-file --metric maintainability
```

### 実装例
```typescript
class QualityRanking {
  async getWorstFunctions(
    metric: 'complexity' | 'lines' | 'maintainability',
    limit: number = 10
  ): Promise<RankingResult[]> {
    
    const query = `
      SELECT 
        name,
        file_path,
        (metrics->>'${metric}')::int as score,
        RANK() OVER (ORDER BY (metrics->>'${metric}')::int DESC) as rank
      FROM functions f
      JOIN snapshots s ON f.snapshot_id = s.id
      WHERE s.id = (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1)
      ORDER BY score DESC
      LIMIT $1;
    `;
    
    return await this.db.query(query, [limit]);
  }
  
  async getImprovementRanking(days: number): Promise<ImprovementResult[]> {
    // 期間内での品質改善度ランキング
    const query = `
      WITH improvement_calc AS (
        SELECT 
          f2.name,
          f1.metrics->>'cyclomaticComplexity' as old_score,
          f2.metrics->>'cyclomaticComplexity' as new_score,
          ((f1.metrics->>'cyclomaticComplexity')::int - 
           (f2.metrics->>'cyclomaticComplexity')::int) as improvement
        FROM functions f1
        JOIN functions f2 ON f1.semantic_id = f2.semantic_id
        WHERE f1.snapshot_id IN (
          SELECT id FROM snapshots 
          WHERE created_at >= NOW() - INTERVAL '${days} days'
          ORDER BY created_at LIMIT 1
        )
        AND f2.snapshot_id = (
          SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1
        )
      )
      SELECT *, RANK() OVER (ORDER BY improvement DESC) as rank
      FROM improvement_calc
      WHERE improvement > 0
      ORDER BY improvement DESC;
    `;
    
    return await this.db.query(query);
  }
}
```

**対応度**: ✅ **100%** - PGLiteの高度なSQL機能で完全対応

---

## 6. 関数ネーミング妥当性 🤖 **AI機能で対応**

### AI支援によるネーミング分析
```bash
# ネーミング妥当性チェック
funcqc suggest --naming-check
funcqc suggest --naming-check --function "fetchUser"

# 単一責務違反の検出
funcqc suggest --single-responsibility
```

### 実装アプローチ（Phase 3）
```typescript
class NamingAnalyzer {
  async analyzeNaming(functionInfo: FunctionInfo): Promise<NamingAnalysis> {
    // AI APIを使用した分析
    const prompt = `
      Analyze this TypeScript function for naming appropriateness:
      
      Function name: ${functionInfo.name}
      Signature: ${functionInfo.signature}
      Source code: ${functionInfo.sourceCode}
      
      Provide analysis for:
      1. Is the name descriptive of the actual functionality?
      2. Does the function have single responsibility?
      3. Suggest better names if needed
      4. Identify if function should be split
      
      Respond in JSON format.
    `;
    
    const analysis = await this.aiService.analyze(prompt);
    return this.parseNamingAnalysis(analysis);
  }
  
  async detectMultipleResponsibilities(
    functionInfo: FunctionInfo
  ): Promise<ResponsibilityAnalysis> {
    // コード構造とAI分析の組み合わせ
    const structuralAnalysis = this.analyzeCodeStructure(functionInfo);
    const semanticAnalysis = await this.aiService.analyzeSemantic(functionInfo);
    
    return {
      hasMultipleResponsibilities: structuralAnalysis.suspiciousPatterns.length > 0,
      suspiciousPatterns: structuralAnalysis.suspiciousPatterns,
      suggestedSplit: semanticAnalysis.splitSuggestions,
      confidenceScore: semanticAnalysis.confidence
    };
  }
}
```

**対応度**: 🤖 **60%** - 構造解析は対応、セマンティック分析はAI機能実装後

---

## 7. 引数最適化提案 🤖 **AI機能で対応**

### 引数分析機能
```bash
# 引数最適化提案
funcqc suggest --parameters
funcqc suggest --parameters --threshold 4

# 型導入提案
funcqc suggest --type-extraction --file "src/utils.ts"
```

### 実装アプローチ
```typescript
class ParameterAnalyzer {
  analyzeParameters(functionInfo: FunctionInfo): ParameterAnalysis {
    const issues: ParameterIssue[] = [];
    
    // 引数数チェック
    if (functionInfo.parameters.length > 4) {
      issues.push({
        type: 'too_many_parameters',
        count: functionInfo.parameters.length,
        suggestion: 'Consider using an options object'
      });
    }
    
    // 同じ型の連続引数
    const consecutiveSameType = this.findConsecutiveSameTypeParams(
      functionInfo.parameters
    );
    
    if (consecutiveSameType.length > 0) {
      issues.push({
        type: 'confusing_order',
        parameters: consecutiveSameType,
        suggestion: 'Consider using named parameters or different types'
      });
    }
    
    return { issues, suggestions: this.generateSuggestions(issues) };
  }
  
  async suggestTypeExtraction(
    functions: FunctionInfo[]
  ): Promise<TypeExtractionSuggestion[]> {
    // 共通パラメータパターンの検出
    const parameterPatterns = this.findCommonParameterPatterns(functions);
    
    return parameterPatterns.map(pattern => ({
      suggestedTypeName: this.generateTypeName(pattern),
      functions: pattern.functions,
      commonParameters: pattern.parameters,
      benefits: this.calculateBenefits(pattern)
    }));
  }
}
```

**対応度**: 🤖 **70%** - 構造分析は対応、高度な提案はAI機能実装後

---

## 8. バックアップ・復元 ✅ **完全対応可能**

### バックアップ機能
```bash
# データベース全体のバックアップ
funcqc backup --output funcqc-backup.sql
funcqc backup --format json --output funcqc-backup.json

# 特定期間のバックアップ
funcqc backup --since "2024-01-01" --output partial-backup.sql

# 復元
funcqc restore funcqc-backup.sql
funcqc import funcqc-backup.json
```

### 実装
```typescript
class BackupManager {
  async createBackup(options: BackupOptions): Promise<string> {
    switch (options.format) {
      case 'sql':
        return await this.createSQLBackup(options);
      case 'json':
        return await this.createJSONBackup(options);
    }
  }
  
  private async createSQLBackup(options: BackupOptions): Promise<string> {
    // PGLiteのpg_dumpライクな機能
    const tables = ['snapshots', 'functions', 'function_parameters'];
    let backup = '';
    
    for (const table of tables) {
      const schema = await this.getTableSchema(table);
      const data = await this.getTableData(table, options.filters);
      
      backup += `-- Table: ${table}\n`;
      backup += schema + '\n';
      backup += this.generateInsertStatements(table, data) + '\n\n';
    }
    
    return backup;
  }
  
  async restore(backupFile: string): Promise<void> {
    const format = this.detectFormat(backupFile);
    
    if (format === 'sql') {
      await this.restoreFromSQL(backupFile);
    } else {
      await this.restoreFromJSON(backupFile);
    }
  }
}
```

**対応度**: ✅ **100%** - PGLiteの標準機能で完全対応

---

## 9. GitHub Actions統合 ✅ **完全対応可能**

### CI/CD 統合例
```yaml
# .github/workflows/funcqc-check.yml
name: Function Quality Check
on:
  pull_request:
    branches: [main]

jobs:
  quality-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 履歴比較のため
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install funcqc
        run: npm install -g funcqc
      
      - name: Initialize funcqc
        run: funcqc init --root src
      
      - name: Scan current state
        run: funcqc scan --label "pr-${{ github.event.number }}"
      
      - name: Get baseline
        run: |
          git checkout main
          funcqc scan --label "main-baseline"
          git checkout ${{ github.head_ref }}
      
      - name: Compare quality
        run: |
          funcqc diff main-baseline "pr-${{ github.event.number }}" \
            --format json > quality-report.json
      
      - name: Check for regressions
        run: |
          funcqc regressions \
            --from main-baseline \
            --to "pr-${{ github.event.number }}" \
            --threshold complexity:+2,lines:+20 \
            --fail-on-regression
      
      - name: Comment PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('quality-report.json'));
            
            const comment = `## 📊 Function Quality Report
            
            **Changes detected:**
            - Added: ${report.added.length} functions
            - Modified: ${report.modified.length} functions  
            - Removed: ${report.removed.length} functions
            
            **Quality metrics:**
            - Average complexity: ${report.stats.avgComplexity}
            - Functions over threshold: ${report.stats.overThreshold}
            `;
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

### Docker対応
```dockerfile
# Dockerfile for CI/CD
FROM node:20-alpine

RUN npm install -g funcqc

WORKDIR /workspace

ENTRYPOINT ["funcqc"]
```

**対応度**: ✅ **100%** - PGLiteの軽量性により完全対応

---

## 10. 制約環境での動作 ✅ **対応可能**

### 軽量モード
```bash
# メモリ制限環境
funcqc scan --lightweight --no-ai --batch-size 50

# ディスク容量制限
funcqc scan --compress --retention-days 30

# CPU制限環境
funcqc scan --single-thread --timeout 300
```

### 実装
```typescript
class ConstrainedEnvironmentAdapter {
  async scanWithConstraints(options: ConstrainedOptions): Promise<void> {
    if (options.memoryLimit) {
      // バッチサイズを制限
      this.batchSize = Math.min(this.batchSize, options.memoryLimit / 10);
      
      // 定期的なガベージコレクション
      this.enablePeriodicGC();
    }
    
    if (options.diskLimit) {
      // 古いスナップショットの自動削除
      await this.cleanupOldSnapshots(options.retentionDays);
      
      // 圧縮保存
      this.enableCompression();
    }
    
    if (options.cpuLimit) {
      // 並列処理を制限
      this.maxConcurrency = 1;
      
      // タイムアウト設定
      this.timeout = options.timeout;
    }
  }
}
```

**対応度**: ✅ **90%** - PGLiteの軽量性により制約環境でも動作可能

---

## 総合対応度サマリー

| シナリオ | 対応度 | MVP対応 | フル対応 |
|---------|--------|---------|----------|
| 関数一覧・属性判別 | ✅ 100% | Phase 1 | Phase 1 |
| 品質指標表示 | ✅ 95% | Phase 1 | Phase 2 |
| 変更履歴追跡 | ✅ 90% | Phase 2 | Phase 2 |
| 品質悪化検出 | ✅ 85% | Phase 2 | Phase 2 |
| 品質ランキング | ✅ 100% | Phase 1 | Phase 1 |
| ネーミング妥当性 | 🤖 60% | - | Phase 3 |
| 引数最適化提案 | 🤖 70% | - | Phase 3 |
| バックアップ・復元 | ✅ 100% | Phase 1 | Phase 1 |
| CI/CD統合 | ✅ 100% | Phase 1 | Phase 1 |
| 制約環境動作 | ✅ 90% | Phase 1 | Phase 2 |

### 🎯 **結論**

**MVP (Phase 1-2)** で **80%以上** のユーザーシナリオに対応可能。特に：

1. ✅ **即座に価値提供**: 関数一覧、品質指標、ランキング
2. ✅ **実用的な履歴管理**: 変更追跡、品質悪化検出
3. ✅ **運用統合**: CI/CD、バックアップ、制約環境
4. 🤖 **将来拡張**: AI機能による高度な分析

PGLite採用により、これらすべてのシナリオが **ポータブル** かつ **高性能** に実現可能です。
