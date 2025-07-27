import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TypeScriptAnalyzer } from '../../src/analyzers/typescript-analyzer';
import { PGLiteStorageAdapter } from '../../src/storage/pglite-adapter';
import { QualityCalculator } from '../../src/metrics/quality-calculator';
import { FunctionInfo } from '../../src/types';

describe('Performance Optimization Tests', () => {
  let tempDir: string;
  let storage: PGLiteStorageAdapter;
  let analyzer: TypeScriptAnalyzer;
  let qualityCalculator: QualityCalculator;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'funcqc-perf-'));
    const dbPath = path.join(tempDir, 'test.db');
    storage = new PGLiteStorageAdapter(dbPath);
    await storage.init();
    analyzer = new TypeScriptAnalyzer(100);
    qualityCalculator = new QualityCalculator();
  });

  afterEach(async () => {
    await storage?.close();
    analyzer?.cleanup();
    if (tempDir && fs.existsSync(tempDir)) {
      await fs.promises.rmdir(tempDir, { recursive: true });
    }
  });

  it('should demonstrate transaction batching performance improvement', async () => {
    // Generate test functions
    const testFunctions: FunctionInfo[] = [];
    for (let i = 0; i < 100; i++) {
      testFunctions.push({
        id: `func-${i}-${Date.now()}`,
        semanticId: `semantic-${i}-${Date.now()}`,
        contentId: `content-${i}-${Date.now()}`,
        name: `testFunction${i}`,
        displayName: `testFunction${i}`,
        signature: `testFunction${i}(): void`,
        signatureHash: `hash-${i}`,
        filePath: `test/file${i}.ts`,
        fileHash: `file-hash-${i}`,
        startLine: i * 10,
        endLine: i * 10 + 5,
        startColumn: 0,
        endColumn: 0,
        astHash: `ast-${i}`,
        isExported: true,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [],
        metrics: {
          linesOfCode: 5,
          totalLines: 7,
          cyclomaticComplexity: 1,
          cognitiveComplexity: 0,
          maxNestingLevel: 0,
          parameterCount: 0,
          returnStatementCount: 1,
          branchCount: 0,
          loopCount: 0,
          tryCatchCount: 0,
          asyncAwaitCount: 0,
          callbackCount: 0,
          commentLines: 0,
          codeToCommentRatio: 0
        }
      });
    }

    // Measure save performance
    const startTime = Date.now();
    await storage.saveSnapshot(testFunctions, 'performance-test', undefined, 'test-config-hash');
    const saveTime = Date.now() - startTime;

    console.log(`Saved ${testFunctions.length} functions in ${saveTime}ms`);
    console.log(`Functions per second: ${Math.round((testFunctions.length / saveTime) * 1000)}`);

    // Verify data integrity
    const snapshots = await storage.getSnapshots();
    expect(snapshots).toHaveLength(1);
    
    const functions = await storage.getFunctions(snapshots[0].id);
    expect(functions).toHaveLength(testFunctions.length);

    // Performance expectations
    expect(saveTime).toBeLessThan(5000); // Should complete within 5 seconds
    const functionsPerSecond = (testFunctions.length / saveTime) * 1000;
    expect(functionsPerSecond).toBeGreaterThan(20); // At least 20 functions/second
  });

  it('should handle large batches efficiently', async () => {
    // Test with 500 functions
    const largeBatch: FunctionInfo[] = [];
    for (let i = 0; i < 500; i++) {
      largeBatch.push({
        id: `large-func-${i}`,
        semanticId: `large-semantic-${i}`,
        contentId: `large-content-${i}`,
        name: `largeFunction${i}`,
        displayName: `largeFunction${i}`,
        signature: `largeFunction${i}(param: string): void`,
        signatureHash: `large-hash-${i}`,
        filePath: `src/large/file${Math.floor(i / 10)}.ts`,
        fileHash: `large-file-hash-${Math.floor(i / 10)}`,
        startLine: (i % 10) * 20,
        endLine: (i % 10) * 20 + 15,
        startColumn: 0,
        endColumn: 0,
        astHash: `large-ast-${i}`,
        isExported: i % 2 === 0,
        isAsync: i % 3 === 0,
        isGenerator: false,
        isArrowFunction: i % 4 === 0,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [
          {
            name: 'param',
            type: 'string',
            typeSimple: 'string',
            position: 0,
            isOptional: false,
            isRest: false
          }
        ],
        metrics: {
          linesOfCode: 10 + (i % 5),
          totalLines: 15 + (i % 5),
          cyclomaticComplexity: 1 + (i % 3),
          cognitiveComplexity: i % 4,
          maxNestingLevel: i % 3,
          parameterCount: 1,
          returnStatementCount: 1,
          branchCount: i % 2,
          loopCount: i % 3 === 0 ? 1 : 0,
          tryCatchCount: i % 5 === 0 ? 1 : 0,
          asyncAwaitCount: i % 3 === 0 ? 2 : 0,
          callbackCount: 0,
          commentLines: 2,
          codeToCommentRatio: 0.2
        }
      });
    }

    const startTime = Date.now();
    await storage.saveSnapshot(largeBatch, 'large-batch-test', undefined, 'large-test-config-hash');
    const totalTime = Date.now() - startTime;

    console.log(`Large batch results:`);
    console.log(`  Functions: ${largeBatch.length}`);
    console.log(`  Total time: ${totalTime}ms`);
    console.log(`  Functions/second: ${Math.round((largeBatch.length / totalTime) * 1000)}`);

    // Verify performance improvement
    expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
    const functionsPerSecond = (largeBatch.length / totalTime) * 1000;
    expect(functionsPerSecond).toBeGreaterThan(50); // At least 50 functions/second for large batches
  });
});