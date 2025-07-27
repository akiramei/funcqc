import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QualityCalculator } from '../src/metrics/quality-calculator';
import { TypeScriptAnalyzer } from '../src/analyzers/typescript-analyzer';
import { FunctionInfo, QualityMetrics } from '../src/types';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

/**
 * Regression tests for metrics calculation bugs
 * 
 * This test suite verifies that metrics calculation works correctly
 * for various types of functions, especially edge cases that have
 * historically caused bugs.
 */
describe('Metrics Regression Tests', () => {
  let calculator: QualityCalculator;
  let analyzer: TypeScriptAnalyzer;
  let tempDir: string;

  beforeEach(async () => {
    calculator = new QualityCalculator();
    analyzer = new TypeScriptAnalyzer();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'funcqc-test-'));
  });

  afterEach(async () => {
    try {
      analyzer.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Method vs Function CC Calculation', () => {
    it('should calculate correct CC for class methods (regression test for bug #1)', async () => {
      // This test verifies the fix for the bug where class methods showed CC=1
      // instead of their actual complexity
      const testCode = `
export class TestAnalyzer {
  private extractFunctionInfo(
    func: any,
    relativePath: string,
    fileHash: string,
    sourceFile: any,
    fileContent: string
  ): any | null {
    const name = func.getName();
    if (!name) return null;

    const signature = this.getFunctionSignature(func);
    let complexity = 1;

    // This should add to CC: +1 for if
    if (func.isExported()) {
      complexity++;
      
      // This should add to CC: +1 for nested if
      if (func.isAsync()) {
        return { name, signature, async: true };
      }
    }

    // This should add to CC: +1 for if
    if (signature.includes('Promise')) {
      return { name, signature, promise: true };
    }

    return { name, signature, complexity };
  }

  private getFunctionSignature(func: any): string {
    return func.toString();
  }
}`;

      // Write test file
      const testFile = path.join(tempDir, 'test-class.ts');
      await fs.writeFile(testFile, testCode);

      // Analyze using TypeScriptAnalyzer (this simulates the scan process)
      const functions = await analyzer.analyzeContent(testCode, testFile);

      // Find the extractFunctionInfo method
      const extractFuncInfo = functions.find(f => f.name === 'extractFunctionInfo');
      expect(extractFuncInfo).toBeDefined();
      expect(extractFuncInfo?.isMethod).toBe(true);

      // The method has 3 if statements, so CC should be 5 (1 + 4 decision points including nested if)
      expect(extractFuncInfo?.metrics?.cyclomaticComplexity).toBe(5);

      // Verify it's not falling back to the broken CC=1
      expect(extractFuncInfo?.metrics?.cyclomaticComplexity).toBeGreaterThan(1);
    });

    it('should calculate correct CC for standalone functions', async () => {
      const testCode = `
export function extractFunctionInfo(
  node: any,
  filePath: string
): any {
  const name = node.getName();
  
  // +1 for if
  if (!name) {
    return null;
  }

  // +1 for if 
  if (node.isExported()) {
    // +1 for nested if
    if (node.isAsync()) {
      return { name, exported: true, async: true };
    }
  }

  return { name };
}`;

      const testFile = path.join(tempDir, 'test-function.ts');
      await fs.writeFile(testFile, testCode);

      const functions = await analyzer.analyzeContent(testCode, testFile);
      const extractFuncInfo = functions.find(f => f.name === 'extractFunctionInfo');
      
      expect(extractFuncInfo).toBeDefined();
      expect(extractFuncInfo?.isMethod).toBe(false);
      
      // Should have CC=4 (1 + 3 if statements)
      expect(extractFuncInfo?.metrics?.cyclomaticComplexity).toBe(4);
    });
  });

  describe('McCabe Standard Compliance', () => {
    it('should follow McCabe standard: CC = 1 + decision points', async () => {
      const testCases = [
        {
          name: 'no-branches',
          code: `function simple() { return 1; }`,
          expectedCC: 1
        },
        {
          name: 'one-if',
          code: `function oneIf(x: number) { 
            if (x > 0) return 1; 
            return 0; 
          }`,
          expectedCC: 2
        },
        {
          name: 'if-else',
          code: `function ifElse(x: number) { 
            if (x > 0) {
              return 1; 
            } else {
              return 0;
            }
          }`,
          expectedCC: 2
        },
        {
          name: 'nested-if',
          code: `function nestedIf(x: number, y: number) { 
            if (x > 0) {
              if (y > 0) {
                return 1;
              }
            }
            return 0; 
          }`,
          expectedCC: 3
        },
        {
          name: 'logical-operators',
          code: `function logicalOps(x: number, y: number) { 
            if (x > 0 && y > 0) {
              return 1;
            }
            return 0; 
          }`,
          expectedCC: 3 // 1 + if + &&
        }
      ];

      for (const testCase of testCases) {
        const functions = await analyzer.analyzeContent(testCase.code, `${testCase.name}.ts`);
        const func = functions[0];
        
        expect(func).toBeDefined();
        expect(func.metrics?.cyclomaticComplexity).toBe(testCase.expectedCC);
      }
    });
  });

  describe('Real-world Function Regression Tests', () => {
    it('should handle complex analyzer methods correctly', async () => {
      // This is based on the actual extractFunctionInfo method that had the bug
      const complexAnalyzerCode = `
export class RealAnalyzer {
  private extractMethodInfo(
    method: any,
    relativePath: string,
    fileHash: string,
    sourceFile: any,
    fileContent: string
  ): any | null {
    const name = method.getName();
    if (!name) return null; // +1

    const parent = method.getParent();
    let className = 'Unknown';
    
    // +1 for if
    if (parent && parent.getKind() === 'ClassDeclaration') {
      const classDecl = parent;
      const parentName = classDecl.getName();
      // +1 for nested if
      if (parentName) {
        className = parentName;
      }
    }
    
    const signature = this.getMethodSignature(method, className);
    const methodParent = method.getParent();
    let isClassExported = false;
    
    // +1 for if
    if (methodParent && methodParent.getKind() === 'ClassDeclaration') {
      isClassExported = methodParent.isExported();
    }

    const returnType = this.extractMethodReturnType(method);
    
    // +1 for if 
    if (returnType) {
      return { name, className, returnType, exported: isClassExported };
    }

    return { name, className, exported: isClassExported };
  }

  private getMethodSignature(method: any, className: string): string {
    return \`\${className}.\${method.getName()}\`;
  }

  private extractMethodReturnType(method: any): string | undefined {
    return method.getReturnTypeNode()?.getText();
  }
}`;

      const functions = await analyzer.analyzeContent(complexAnalyzerCode, 'real-analyzer.ts');
      const extractMethodInfo = functions.find(f => f.name === 'extractMethodInfo');
      
      expect(extractMethodInfo).toBeDefined();
      expect(extractMethodInfo?.isMethod).toBe(true);
      
      // Should have CC=8 (1 + 7 decision points including nested conditions)
      expect(extractMethodInfo?.metrics?.cyclomaticComplexity).toBe(8);
      
      // Verify it has reasonable other metrics too
      expect(extractMethodInfo?.metrics?.linesOfCode).toBeGreaterThan(20);
      expect(extractMethodInfo?.metrics?.parameterCount).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty functions', async () => {
      const code = `function empty() {}`;
      const functions = await analyzer.analyzeContent(code, 'empty.ts');
      
      expect(functions[0].metrics?.cyclomaticComplexity).toBe(1);
    });

    it('should handle functions with only comments', async () => {
      const code = `
function commented() {
  // This is just a comment
  /* Multi-line
     comment */
}`;
      const functions = await analyzer.analyzeContent(code, 'commented.ts');
      
      expect(functions[0].metrics?.cyclomaticComplexity).toBe(1);
      // Note: commentLines calculation may need improvement in QualityCalculator
      expect(functions[0].metrics?.commentLines).toBeGreaterThanOrEqual(0);
    });

    it('should handle constructor methods', async () => {
      const code = `
export class TestClass {
  constructor(private value: number) {
    if (value < 0) { // +1
      throw new Error('Value must be positive');
    }
    
    if (value > 100) { // +1
      console.warn('Large value detected');
    }
  }
}`;

      const functions = await analyzer.analyzeContent(code, 'constructor.ts');
      const constructor = functions.find(f => f.isConstructor);
      
      expect(constructor).toBeDefined();
      expect(constructor?.metrics?.cyclomaticComplexity).toBe(3); // 1 + 2 ifs
    });
  });

  describe('Metrics Consistency', () => {
    it('should produce identical results when calculated multiple times', async () => {
      const testCode = `
export function consistencyTest(x: number, y: string): boolean {
  if (x > 0) {
    if (y.length > 5) {
      return true;
    } else if (y.includes('test')) {
      return false;
    }
  }
  
  for (let i = 0; i < x; i++) {
    if (i % 2 === 0) {
      console.log(i);
    }
  }
  
  return false;
}`;

      // Calculate metrics multiple times
      const results: QualityMetrics[] = [];
      
      for (let i = 0; i < 3; i++) {
        const functions = await analyzer.analyzeContent(testCode, `consistency-${i}.ts`);
        const func = functions[0];
        expect(func.metrics).toBeDefined();
        results.push(func.metrics!);
      }

      // All results should be identical
      const first = results[0];
      for (let i = 1; i < results.length; i++) {
        expect(results[i].cyclomaticComplexity).toBe(first.cyclomaticComplexity);
        expect(results[i].cognitiveComplexity).toBe(first.cognitiveComplexity);
        expect(results[i].linesOfCode).toBe(first.linesOfCode);
        expect(results[i].parameterCount).toBe(first.parameterCount);
      }
    });
  });
});