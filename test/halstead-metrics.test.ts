import { describe, test, expect } from 'vitest';
import * as ts from 'typescript';
import { QualityCalculator } from '../src/metrics/quality-calculator';
import { FunctionInfo } from '../src/types';

const createTestFunction = (sourceCode: string): FunctionInfo => ({
  id: 'test-id',
  name: 'testFunction',
  displayName: 'testFunction',
  signature: 'function testFunction(): void',
  signatureHash: 'hash123',
  filePath: '/test/file.ts',
  fileHash: 'filehash123',
  startLine: 1,
  endLine: 10,
  startColumn: 0,
  endColumn: 20,
  astHash: 'asthash123',
  isExported: true,
  isAsync: false,
  isGenerator: false,
  isArrowFunction: false,
  isMethod: false,
  isConstructor: false,
  isStatic: false,
  parameters: [],
  sourceCode
});

describe('Enhanced Halstead Metrics', () => {
  const calculator = new QualityCalculator();

  test('should calculate Halstead volume for simple function', async () => {
    const sourceCode = `
      function simpleFunction(a: number, b: number): number {
        return a + b;
      }
    `;
    
    const functionInfo = createTestFunction(sourceCode);
    const metrics = await calculator.calculate(functionInfo);
    
    expect(metrics.halsteadVolume).toBeGreaterThan(0);
    expect(typeof metrics.halsteadVolume).toBe('number');
  });

  test('should calculate Halstead difficulty', async () => {
    const sourceCode = `
      function complexFunction(x: number, y: number): number {
        let result = 0;
        if (x > 0) {
          result = x * y + 10;
        } else {
          result = x / y - 5;
        }
        return result;
      }
    `;
    
    const functionInfo = createTestFunction(sourceCode);
    const metrics = await calculator.calculate(functionInfo);
    
    expect(metrics.halsteadDifficulty).toBeGreaterThan(0);
    expect(typeof metrics.halsteadDifficulty).toBe('number');
  });

  test('should calculate maintainability index', async () => {
    const sourceCode = `
      function maintainableFunction(): void {
        // This is a simple, well-documented function
        console.log('Hello, world!');
      }
    `;
    
    const functionInfo = createTestFunction(sourceCode);
    const metrics = await calculator.calculate(functionInfo);
    
    expect(metrics.maintainabilityIndex).toBeGreaterThan(0);
    expect(metrics.maintainabilityIndex).toBeLessThanOrEqual(100);
  });

  test('should calculate comment to code ratio', async () => {
    const sourceCode = `
      function documentedFunction(): void {
        // This is a comment
        // Another comment
        console.log('Hello');
        // Final comment
      }
    `;
    
    const functionInfo = createTestFunction(sourceCode);
    const metrics = await calculator.calculate(functionInfo);
    
    expect(metrics.codeToCommentRatio).toBeGreaterThan(0);
    expect(typeof metrics.codeToCommentRatio).toBe('number');
  });

  test('should handle functions with no operators gracefully', async () => {
    const sourceCode = `
      function emptyFunction(): void {
        // Just a comment
      }
    `;
    
    const functionInfo = createTestFunction(sourceCode);
    const metrics = await calculator.calculate(functionInfo);
    
    expect(metrics.halsteadVolume).toBeGreaterThanOrEqual(0);
    expect(metrics.halsteadDifficulty).toBeGreaterThanOrEqual(0);
    expect(metrics.maintainabilityIndex).toBeGreaterThanOrEqual(0);
  });

  test('should calculate higher volume for complex functions', async () => {
    const simpleCode = `
      function simple(): number {
        return 1;
      }
    `;
    
    const complexCode = `
      function complex(a: number, b: number, c: number): number {
        let result = 0;
        for (let i = 0; i < a; i++) {
          if (b > c) {
            result += i * b / c;
          } else {
            result -= i + b - c;
          }
        }
        return result;
      }
    `;
    
    const simpleFunction = createTestFunction(simpleCode);
    const complexFunction = createTestFunction(complexCode);
    
    const simpleMetrics = await calculator.calculate(simpleFunction);
    const complexMetrics = await calculator.calculate(complexFunction);
    
    expect(complexMetrics.halsteadVolume).toBeGreaterThan(simpleMetrics.halsteadVolume);
    expect(complexMetrics.halsteadDifficulty).toBeGreaterThan(simpleMetrics.halsteadDifficulty);
  });

  test('should calculate lower maintainability for complex functions', async () => {
    const maintainableCode = `
      function calculateSum(numbers: number[]): number {
        // Calculate the sum of all numbers in the array
        return numbers.reduce((sum, num) => sum + num, 0);
      }
    `;
    
    const complexCode = `
      function complexCalculation(x: number, y: number, z: number): number {
        let result = 0;
        if (x > 0) {
          for (let i = 0; i < x; i++) {
            if (y > z) {
              result += i * y / z;
            } else {
              if (z > 10) {
                result -= i + y;
              } else {
                result += y - z;
              }
            }
          }
        }
        return result;
      }
    `;
    
    const maintainableFunction = createTestFunction(maintainableCode);
    const complexFunction = createTestFunction(complexCode);
    
    const maintainableMetrics = await calculator.calculate(maintainableFunction);
    const complexMetrics = await calculator.calculate(complexFunction);
    
    expect(maintainableMetrics.maintainabilityIndex).toBeGreaterThan(complexMetrics.maintainabilityIndex);
  });
});