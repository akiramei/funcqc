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

    it('should calculate enhanced cognitive complexity for switch statements', async () => {
      const functionInfo: FunctionInfo = {
        id: 'test-5',
        name: 'switchFunction',
        displayName: 'switchFunction',
        signature: 'switchFunction(type: string): string',
        signatureHash: 'hash5',
        filePath: 'test.ts',
        fileHash: 'filehash5',
        startLine: 1,
        endLine: 20,
        startColumn: 0,
        endColumn: 10,
        astHash: 'asthash5',
        isExported: false,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [
          {
            name: 'type',
            type: 'string',
            typeSimple: 'string',
            position: 0,
            isOptional: false,
            isRest: false
          }
        ],
        sourceCode: `function switchFunction(type: string): string {
  switch (type) {
    case 'A':
      return 'Type A';
    case 'B':
      console.log('Processing B');
      // Fall-through case (no break)
    case 'C':
      return 'Type B or C';
    case 'D':
      if (Math.random() > 0.5) {
        return 'Random D';
      }
      break;
    default:
      return 'Unknown';
  }
  return 'End';
}`
      };

      const metrics = await calculator.calculate(functionInfo);

      // Switch statement should have higher cognitive complexity due to:
      // - Switch statement itself (+1)
      // - Multiple case clauses (+1 each, with fall-through penalty)
      // - Nested if statement with nesting bonus
      expect(metrics.cognitiveComplexity).toBeGreaterThan(5);
      expect(metrics.cyclomaticComplexity).toBeGreaterThan(1);
      expect(metrics.branchCount).toBeGreaterThan(0);
    });

    it('should penalize fall-through cases in switch statements', async () => {
      const fallThroughFunction: FunctionInfo = {
        id: 'test-6a',
        name: 'fallThroughSwitch',
        displayName: 'fallThroughSwitch',
        signature: 'fallThroughSwitch(x: number): string',
        signatureHash: 'hash6a',
        filePath: 'test.ts',
        fileHash: 'filehash6a',
        startLine: 1,
        endLine: 15,
        startColumn: 0,
        endColumn: 10,
        astHash: 'asthash6a',
        isExported: false,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [{ name: 'x', type: 'number', typeSimple: 'number', position: 0, isOptional: false, isRest: false }],
        sourceCode: `function fallThroughSwitch(x: number): string {
  switch (x) {
    case 1:
      console.log('One');
      // Fall-through
    case 2:
      console.log('One or Two');
      // Fall-through
    case 3:
      return 'Result';
    default:
      return 'Default';
  }
}`
      };

      const properSwitchFunction: FunctionInfo = {
        id: 'test-6b',
        name: 'properSwitch',
        displayName: 'properSwitch',
        signature: 'properSwitch(x: number): string',
        signatureHash: 'hash6b',
        filePath: 'test.ts',
        fileHash: 'filehash6b',
        startLine: 1,
        endLine: 15,
        startColumn: 0,
        endColumn: 10,
        astHash: 'asthash6b',
        isExported: false,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [{ name: 'x', type: 'number', typeSimple: 'number', position: 0, isOptional: false, isRest: false }],
        sourceCode: `function properSwitch(x: number): string {
  switch (x) {
    case 1:
      console.log('One');
      break;
    case 2:
      console.log('Two');
      break;
    case 3:
      return 'Three';
    default:
      return 'Default';
  }
}`
      };

      const fallThroughMetrics = await calculator.calculate(fallThroughFunction);
      const properMetrics = await calculator.calculate(properSwitchFunction);

      // Fall-through switch should have higher cognitive complexity
      expect(fallThroughMetrics.cognitiveComplexity).toBeGreaterThan(properMetrics.cognitiveComplexity);
    });
  });
});
