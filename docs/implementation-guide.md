# funcqc 実装開始ガイド

## 🚀 今すぐ始められる実装手順

### Step 1: プロジェクト初期化 (Day 1)

```bash
# プロジェクト作成
mkdir funcqc
cd funcqc
npm init -y

# TypeScript セットアップ
npm install -D typescript @types/node tsx tsup vitest
npm install commander @electric-sql/pglite kysely chalk ora table cosmiconfig

# 設定ファイル作成
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
EOF

cat > package.json << 'EOF'
{
  "name": "funcqc",
  "version": "0.1.0",
  "description": "Function Quality Control for TypeScript projects",
  "main": "./dist/index.js",
  "bin": {
    "funcqc": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsup src/cli.ts src/index.ts --format cjs --dts",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
EOF
```

### Step 2: プロジェクト構造作成 (Day 1)

```bash
# ディレクトリ構造作成
mkdir -p src/{cli,core,analyzers,storage,metrics,utils,types}
mkdir -p test/{fixtures,integration}

# 基本ファイル作成
touch src/{cli.ts,index.ts}
touch src/cli/{init,scan,list,status}.ts
touch src/core/{config,analyzer}.ts
touch src/analyzers/{typescript-analyzer}.ts
touch src/storage/{pglite-adapter}.ts
touch src/metrics/{quality-calculator}.ts
touch src/types/{index,function-info,snapshot}.ts
```

### Step 3: 型定義とインターフェース (Day 2)

#### `src/types/index.ts`
```typescript
export interface FuncqcConfig {
  roots: string[];
  exclude: string[];
  include?: string[];
  
  storage: {
    type: 'pglite';
    path: string;
  };
  
  metrics: {
    complexityThreshold: number;
    linesOfCodeThreshold: number;
    parameterCountThreshold: number;
  };
  
  git: {
    enabled: boolean;
    autoLabel: boolean;
  };
}

export interface FunctionInfo {
  id: string;
  name: string;
  signature: string;
  filePath: string;
  startLine: number;
  endLine: number;
  astHash: string;
  isExported: boolean;
  isAsync: boolean;
  jsDoc?: string;
  parameters: ParameterInfo[];
}

export interface ParameterInfo {
  name: string;
  type: string;
  position: number;
  optional: boolean;
  description?: string;
}

export interface QualityMetrics {
  linesOfCode: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  maxNestingLevel: number;
  parameterCount: number;
}

export interface SnapshotInfo {
  id: string;
  createdAt: number;
  label?: string;
  gitCommit?: string;
  gitBranch?: string;
  totalFunctions: number;
  totalFiles: number;
}
```

### Step 4: TypeScript解析器の実装 (Day 3-4)

#### `src/analyzers/typescript-analyzer.ts`
```typescript
import * as ts from 'typescript';
import * as path from 'path';
import { FunctionInfo, ParameterInfo } from '../types';

export class TypeScriptAnalyzer {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(private configPath?: string) {
    const config = this.loadTSConfig();
    this.program = ts.createProgram(config.fileNames, config.options);
    this.checker = this.program.getTypeChecker();
  }

  async analyzeFile(filePath: string): Promise<FunctionInfo[]> {
    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error(`File not found: ${filePath}`);
    }

    const functions: FunctionInfo[] = [];
    
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) || 
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node)) {
        
        const functionInfo = this.extractFunctionInfo(node, sourceFile);
        if (functionInfo) {
          functions.push(functionInfo);
        }
      }
      
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return functions;
  }

  private extractFunctionInfo(
    node: ts.FunctionLikeDeclaration, 
    sourceFile: ts.SourceFile
  ): FunctionInfo | null {
    const name = this.getFunctionName(node);
    if (!name) return null;

    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    
    return {
      id: this.generateFunctionId(node, sourceFile),
      name,
      signature: this.getSignature(node),
      filePath: path.relative(process.cwd(), sourceFile.fileName),
      startLine: start.line + 1,
      endLine: end.line + 1,
      astHash: this.calculateASTHash(node),
      isExported: this.isExported(node),
      isAsync: this.isAsync(node),
      jsDoc: this.getJSDoc(node),
      parameters: this.extractParameters(node)
    };
  }

  private getFunctionName(node: ts.FunctionLikeDeclaration): string | null {
    if (node.name) {
      return node.name.getText();
    }
    
    // 無名関数の場合、親コンテキストから名前を推測
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && parent.name) {
      return parent.name.getText();
    }
    
    return null;
  }

  private extractParameters(node: ts.FunctionLikeDeclaration): ParameterInfo[] {
    return node.parameters.map((param, index) => ({
      name: param.name.getText(),
      type: this.getParameterType(param),
      position: index,
      optional: !!param.questionToken,
      description: this.getParameterDescription(param)
    }));
  }

  // ... その他のヘルパーメソッド
}
```

### Step 5: CLI実装 (Day 5-6)

#### `src/cli.ts`
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './cli/init';
import { scanCommand } from './cli/scan';
import { listCommand } from './cli/list';
import { statusCommand } from './cli/status';

const program = new Command();

program
  .name('funcqc')
  .description('Function Quality Control for TypeScript projects')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize funcqc configuration')
  .option('--root <paths>', 'Root directories to scan (comma-separated)')
  .option('--exclude <patterns>', 'Exclude patterns')
  .option('--db <path>', 'Database path')
  .action(initCommand);

program
  .command('scan [paths...]')
  .description('Scan and analyze functions')
  .option('--label <text>', 'Label for this snapshot')
  .option('--dry-run', 'Analyze only, don\'t save')
  .option('--incremental', 'Process changed files only')
  .action(scanCommand);

program
  .command('list [patterns...]')
  .description('List functions')
  .option('--name <pattern>', 'Filter by function name')
  .option('--file <pattern>', 'Filter by file path')
  .option('--exported', 'Show exported functions only')
  .option('--async', 'Show async functions only')
  .option('--complexity <condition>', 'Filter by complexity')
  .option('--json', 'Output as JSON')
  .action(listCommand);

program
  .command('status')
  .description('Show current status')
  .action(statusCommand);

program.parse();
```

### Step 6: ストレージ実装 (Day 7-8)

#### `src/storage/pglite-adapter.ts`
```typescript
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { FunctionInfo, SnapshotInfo, QualityMetrics } from '../types';

interface DatabaseSchema {
  snapshots: {
    id: string;
    created_at: Date;
    label: string | null;
    git_commit: string | null;
    metadata: unknown;
  };
  functions: {
    id: string;
    snapshot_id: string;
    name: string;
    signature: string;
    file_path: string;
    start_line: number;
    end_line: number;
    ast_hash: string;
    is_exported: boolean;
    is_async: boolean;
    js_doc: string | null;
    metrics: {
      linesOfCode: number;
      cyclomaticComplexity: number;
      cognitiveComplexity: number;
      maxNestingLevel: number;
      parameterCount: number;
    };
  };
}

export class PGLiteStorageAdapter {
  private db: PGlite;
  private kysely: Kysely<DatabaseSchema>;

  constructor(dbPath: string) {
    this.db = new PGlite(dbPath);
    this.kysely = new Kysely({
      dialect: new PostgresDialect({
        pool: this.db as any
      })
    });
  }

  async init(): Promise<void> {
    await this.createSchema();
  }

  private async createSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        label TEXT,
        git_commit TEXT,
        metadata JSONB DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS functions (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        signature TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        ast_hash TEXT NOT NULL,
        is_exported BOOLEAN DEFAULT FALSE,
        is_async BOOLEAN DEFAULT FALSE,
        js_doc TEXT,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_functions_snapshot_id ON functions(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);
      CREATE INDEX IF NOT EXISTS idx_functions_file_path ON functions(file_path);
    `);
  }

  async saveSnapshot(functions: FunctionInfo[], label?: string): Promise<string> {
    const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return await this.kysely.transaction().execute(async (trx) => {
      // スナップショット作成
      await trx
        .insertInto('snapshots')
        .values({
          id: snapshotId,
          label,
          git_commit: await this.getGitCommit(),
          metadata: {
            totalFunctions: functions.length,
            totalFiles: new Set(functions.map(f => f.filePath)).size
          }
        })
        .execute();

      // 関数データ一括挿入
      if (functions.length > 0) {
        await trx
          .insertInto('functions')
          .values(functions.map(f => ({
            id: f.id,
            snapshot_id: snapshotId,
            name: f.name,
            signature: f.signature,
            file_path: f.filePath,
            start_line: f.startLine,
            end_line: f.endLine,
            ast_hash: f.astHash,
            is_exported: f.isExported,
            is_async: f.isAsync,
            js_doc: f.jsDoc || null,
            metrics: {
              linesOfCode: f.metrics?.linesOfCode || 0,
              cyclomaticComplexity: f.metrics?.cyclomaticComplexity || 1,
              cognitiveComplexity: f.metrics?.cognitiveComplexity || 1,
              maxNestingLevel: f.metrics?.maxNestingLevel || 1,
              parameterCount: f.parameters.length
            }
          })))
          .execute();
      }

      return snapshotId;
    });
  }

  async queryFunctions(filters: QueryFilter[] = []): Promise<FunctionInfo[]> {
    let query = this.kysely
      .selectFrom('functions')
      .selectAll('functions')
      .orderBy('functions.name');

    // 動的フィルタ適用
    for (const filter of filters) {
      query = this.applyFilter(query, filter);
    }

    const results = await query.execute();
    return results.map(this.mapToFunctionInfo);
  }

  private async getGitCommit(): Promise<string | null> {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }

  // ... その他のメソッド
}
```

### Step 7: テスト実装 (Day 9-10)

#### `test/typescript-analyzer.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { TypeScriptAnalyzer } from '../src/analyzers/typescript-analyzer';
import * as path from 'path';

describe('TypeScriptAnalyzer', () => {
  it('should extract function information', async () => {
    const analyzer = new TypeScriptAnalyzer();
    const testFile = path.join(__dirname, 'fixtures/sample.ts');
    
    const functions = await analyzer.analyzeFile(testFile);
    
    expect(functions).toHaveLength(2);
    expect(functions[0].name).toBe('fetchUser');
    expect(functions[0].isAsync).toBe(true);
    expect(functions[0].parameters).toHaveLength(1);
  });
});
```

#### `test/fixtures/sample.ts`
```typescript
export async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}

function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

## 🎯 開発のコツと推奨事項

### 1. 段階的な実装
- **Week 1-2**: 基本的なAST解析と関数抽出
- **Week 3-4**: データベース保存とクエリ機能
- **Week 5-6**: CLI の完成とテスト

### 2. 技術的な注意点
- **TypeScript Compiler API**: 複雑なので小さな例から始める
- **パフォーマンス**: 大きなファイルでの処理速度を早期にテスト
- **エラー処理**: ファイル解析エラーに対する頑健性

### 3. ユーザビリティ重視
- **プログレス表示**: 長時間処理でのフィードバック
- **エラーメッセージ**: 分かりやすく改善提案を含める
- **設定の簡素化**: デフォルト値で即座に使用可能

### 4. 拡張性の確保
- **プラグインアーキテクチャ**: メトリクス計算の拡張可能性
- **複数言語対応**: 将来的なJavaScript/React対応
- **AI統合**: 後からの機能追加を考慮した設計

## 🚀 MVP完成後の展開

1. **コミュニティフィードバック収集**
2. **実プロジェクトでの運用テスト**  
3. **パフォーマンス最適化**
4. **AI機能の段階的追加**
5. **Web UI開発**

このガイドに従って実装を進めれば、4-6週間でMVP版のfuncqcが完成します。ユーザーに価値を提供しながら、段階的に高度な機能を追加していくことで、成功確率の高い開発が可能になります。
