import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QualityCalculator } from '../src/metrics/quality-calculator';
import { FunctionInfo } from '../src/types';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('QualityCalculator', () => {
  let calculator: QualityCalculator;

  beforeEach(() => {
    calculator = new QualityCalculator();
  });

  describe('calculate', () => {
    it('should calculate basic metrics for simple function', async () => {
      const functionInfo: FunctionInfo = {
        id: 'test-1',
        name: 'simpleFunction',
        displayName: 'simpleFunction',
        signature: 'simpleFunction(): void',
        signatureHash: 'hash1',
        filePath: 'test.ts',
        fileHash: 'filehash1',
        startLine: 1,
        endLine: 5,
        startColumn: 0,
        endColumn: 10,
        astHash: 'asthash1',
        isExported: false,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [],
        sourceCode: `function simpleFunction() {
  console.log('hello');
  return;
}`
      };

      const metrics = await calculator.calculate(functionInfo);

      expect(metrics).toBeDefined();
      expect(metrics.linesOfCode).toBeGreaterThan(0);
      expect(metrics.cyclomaticComplexity).toBeGreaterThanOrEqual(1);
      expect(metrics.parameterCount).toBe(0);
    });

    it('should calculate complexity for function with branches', async () => {
      const functionInfo: FunctionInfo = {
        id: 'test-2',
        name: 'complexFunction',
        displayName: 'complexFunction',
        signature: 'complexFunction(x: number): string',
        signatureHash: 'hash2',
        filePath: 'test.ts',
        fileHash: 'filehash2',
        startLine: 1,
        endLine: 15,
        startColumn: 0,
        endColumn: 10,
        astHash: 'asthash2',
        isExported: false,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [
          {
            name: 'x',
            type: 'number',
            typeSimple: 'number',
            position: 0,
            isOptional: false,
            isRest: false
          }
        ],
        sourceCode: `function complexFunction(x: number): string {
  if (x > 10) {
    if (x > 20) {
      return 'large';
    } else {
      return 'medium';
    }
  } else if (x > 0) {
    return 'small';
  } else {
    return 'negative';
  }
}`
      };

      const metrics = await calculator.calculate(functionInfo);

      expect(metrics.cyclomaticComplexity).toBeGreaterThan(1);
      expect(metrics.cognitiveComplexity).toBeGreaterThan(1);
      expect(metrics.maxNestingLevel).toBeGreaterThan(1);
      expect(metrics.branchCount).toBeGreaterThan(0);
      expect(metrics.parameterCount).toBe(1);
    });

    it('should handle async functions', async () => {
      const functionInfo: FunctionInfo = {
        id: 'test-3',
        name: 'asyncFunction',
        displayName: 'asyncFunction',
        signature: 'asyncFunction(): Promise<void>',
        signatureHash: 'hash3',
        filePath: 'test.ts',
        fileHash: 'filehash3',
        startLine: 1,
        endLine: 8,
        startColumn: 0,
        endColumn: 10,
        astHash: 'asthash3',
        isExported: false,
        isAsync: true,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [],
        sourceCode: `async function asyncFunction(): Promise<void> {
  const result = await fetch('/api/data');
  const data = await result.json();
  console.log(data);
}`
      };

      const metrics = await calculator.calculate(functionInfo);

      expect(metrics.asyncAwaitCount).toBeGreaterThan(0);
    });

    it('should handle functions with loops', async () => {
      const functionInfo: FunctionInfo = {
        id: 'test-4',
        name: 'loopFunction',
        displayName: 'loopFunction',
        signature: 'loopFunction(items: string[]): void',
        signatureHash: 'hash4',
        filePath: 'test.ts',
        fileHash: 'filehash4',
        startLine: 1,
        endLine: 10,
        startColumn: 0,
        endColumn: 10,
        astHash: 'asthash4',
        isExported: false,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [
          {
            name: 'items',
            type: 'string[]',
            typeSimple: 'Array',
            position: 0,
            isOptional: false,
            isRest: false
          }
        ],
        sourceCode: `function loopFunction(items: string[]): void {
  for (const item of items) {
    console.log(item);
  }
  
  while (items.length > 0) {
    items.pop();
  }
}`
      };

      const metrics = await calculator.calculate(functionInfo);

      expect(metrics.loopCount).toBeGreaterThan(0);
      expect(metrics.cyclomaticComplexity).toBeGreaterThan(1);
    });
  });
});
