import { describe, it, expect, beforeEach } from 'vitest';
import { ASTSimilarityDetector } from '../src/similarity/ast-similarity-detector';
import { FunctionInfo, QualityMetrics } from '../src/types';

describe('ASTSimilarityDetector', () => {
  let detector: ASTSimilarityDetector;

  beforeEach(() => {
    detector = new ASTSimilarityDetector();
  });

  const createMockFunction = (
    id: string,
    name: string,
    filePath: string,
    sourceCode: string,
    metrics?: Partial<QualityMetrics>
  ): FunctionInfo => ({
    id,
    name,
    displayName: name,
    signature: `function ${name}()`,
    signatureHash: `hash-${name}`,
    filePath,
    fileHash: 'file-hash',
    startLine: 1,
    endLine: 10,
    startColumn: 0,
    endColumn: 100,
    astHash: `ast-${name}`,
    isExported: true,
    isAsync: false,
    isGenerator: false,
    isArrowFunction: false,
    isMethod: false,
    isConstructor: false,
    isStatic: false,
    parameters: [],
    sourceCode,
    metrics: {
      linesOfCode: 10,
      totalLines: 12,
      cyclomaticComplexity: 2,
      cognitiveComplexity: 3,
      maxNestingLevel: 1,
      parameterCount: 0,
      returnStatementCount: 1,
      branchCount: 1,
      loopCount: 0,
      tryCatchCount: 0,
      asyncAwaitCount: 0,
      callbackCount: 0,
      commentLines: 2,
      codeToCommentRatio: 5,
      ...metrics
    } as QualityMetrics
  });

  describe('detect', () => {
    it('should detect identical functions', async () => {
      const code = `
        function calculate(x, y) {
          if (x > 0) {
            return x + y;
          }
          return y;
        }
      `;

      const functions = [
        createMockFunction('func1', 'calculate', 'file1.ts', code),
        createMockFunction('func2', 'compute', 'file2.ts', code)
      ];

      // Make AST hashes match for identical code
      functions[0].astHash = 'same-hash';
      functions[1].astHash = 'same-hash';

      const results = await detector.detect(functions, { threshold: 0.8 });

      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBe(1.0);
      expect(results[0].functions).toHaveLength(2);
      expect(results[0].type).toBe('structural');
    });

    it('should detect similar functions with different variable names', async () => {
      const code1 = `
        function calculate(x, y) {
          const result = x + y;
          return result * 2;
        }
      `;

      const code2 = `
        function compute(a, b) {
          const sum = a + b;
          return sum * 2;
        }
      `;

      const functions = [
        createMockFunction('func1', 'calculate', 'file1.ts', code1),
        createMockFunction('func2', 'compute', 'file2.ts', code2)
      ];

      const results = await detector.detect(functions, { threshold: 0.7 });

      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBeGreaterThan(0.7);
      expect(results[0].functions).toHaveLength(2);
    });

    it('should respect threshold setting', async () => {
      const code1 = `function a() { return 1; }`;
      const code2 = `function b() { return 2; }`;
      const code3 = `function c() { return 1; }`;

      const functions = [
        createMockFunction('func1', 'a', 'file1.ts', code1),
        createMockFunction('func2', 'b', 'file2.ts', code2),
        createMockFunction('func3', 'c', 'file3.ts', code3)
      ];

      const highThresholdResults = await detector.detect(functions, { threshold: 0.95 });
      const lowThresholdResults = await detector.detect(functions, { threshold: 0.5 });

      expect(highThresholdResults.length).toBeLessThan(lowThresholdResults.length);
    });

    it('should respect minLines option', async () => {
      const shortCode = `function a() { return 1; }`;
      const longCode = `
        function b() {
          const x = 1;
          const y = 2;
          const z = 3;
          const result = x + y + z;
          return result;
        }
      `;

      const functions = [
        createMockFunction('func1', 'a', 'file1.ts', shortCode, { linesOfCode: 1 }),
        createMockFunction('func2', 'b', 'file2.ts', longCode, { linesOfCode: 7 }),
        createMockFunction('func3', 'c', 'file3.ts', shortCode, { linesOfCode: 1 })
      ];

      const results = await detector.detect(functions, { minLines: 5 });

      // Should not detect similarities for functions with less than 5 lines
      expect(results).toHaveLength(0);
    });

    it('should respect crossFile option', async () => {
      const code = `function similar() { return true; }`;

      const functions = [
        createMockFunction('func1', 'similar1', 'file1.ts', code),
        createMockFunction('func2', 'similar2', 'file1.ts', code),
        createMockFunction('func3', 'similar3', 'file2.ts', code)
      ];

      // Make them similar
      functions.forEach(f => f.astHash = 'similar-hash');

      const crossFileResults = await detector.detect(functions, { crossFile: true });
      const sameFileOnly = await detector.detect(functions, { crossFile: false });

      expect(crossFileResults.length).toBeGreaterThan(sameFileOnly.length);
    });

    it('should group multiple similar functions together', async () => {
      const code = `
        function process(data) {
          return data.map(x => x * 2);
        }
      `;

      const functions = [
        createMockFunction('func1', 'process1', 'file1.ts', code),
        createMockFunction('func2', 'process2', 'file2.ts', code),
        createMockFunction('func3', 'process3', 'file3.ts', code),
        createMockFunction('func4', 'different', 'file4.ts', 'function different() { return null; }')
      ];

      // Make first three similar
      functions[0].astHash = 'process-hash';
      functions[1].astHash = 'process-hash';
      functions[2].astHash = 'process-hash';

      const results = await detector.detect(functions, { threshold: 0.8 });

      expect(results).toHaveLength(1);
      expect(results[0].functions).toHaveLength(3);
      expect(results[0].functions.map(f => f.functionName)).toContain('process1');
      expect(results[0].functions.map(f => f.functionName)).toContain('process2');
      expect(results[0].functions.map(f => f.functionName)).toContain('process3');
    });

    it('should include metadata in results', async () => {
      const code1 = `function a(x) { return x + 1; }`;
      const code2 = `function b(y) { return y + 1; }`;

      const functions = [
        createMockFunction('func1', 'a', 'file1.ts', code1, {
          cyclomaticComplexity: 1,
          linesOfCode: 1
        }),
        createMockFunction('func2', 'b', 'file2.ts', code2, {
          cyclomaticComplexity: 1,
          linesOfCode: 1
        })
      ];

      functions[0].signatureHash = 'sig1';
      functions[1].signatureHash = 'sig2';

      const results = await detector.detect(functions, { threshold: 0.5 });

      expect(results).toHaveLength(1);
      expect(results[0].metadata).toBeDefined();
      expect(results[0].metadata?.astHashMatch).toBe(false);
      expect(results[0].metadata?.signatureHashMatch).toBe(false);
      expect(results[0].metadata?.complexityDiff).toBe(0);
      expect(results[0].metadata?.linesDiff).toBe(0);
    });
  });

  describe('isAvailable', () => {
    it('should return true', async () => {
      const available = await detector.isAvailable();
      expect(available).toBe(true);
    });
  });
});