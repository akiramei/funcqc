import { describe, it, expect } from 'vitest';
import { FunctionClassifier } from '../../src/utils/function-classifier';
import { FunctionInfo } from '../../src/types';

// Mock FunctionInfo for testing
const createMockFunction = (overrides: Partial<FunctionInfo> = {}): FunctionInfo => ({
  id: 'test-id',
  name: 'testFunction',
  filePath: '/test/file.ts',
  startLine: 1,
  endLine: 10,
  cyclomaticComplexity: 1,
  parameters: [],
  returnType: 'void',
  isExported: false,
  isAsync: false,
  isMethod: false,
  isStatic: false,
  isConstructor: false,
  modifiers: [],
  ...overrides,
});

describe('FunctionClassifier', () => {
  describe('isStaticMethod', () => {
    it('should identify static methods using isStatic flag', () => {
      const func = createMockFunction({
        isMethod: true,
        isStatic: true,
      });
      
      expect(FunctionClassifier.isStaticMethod(func)).toBe(true);
    });

    it('should identify static methods using modifiers array', () => {
      const func = createMockFunction({
        isMethod: true,
        modifiers: ['static', 'public'],
      });
      
      expect(FunctionClassifier.isStaticMethod(func)).toBe(true);
    });

    it('should not identify regular methods as static', () => {
      const func = createMockFunction({
        isMethod: true,
        isStatic: false,
      });
      
      expect(FunctionClassifier.isStaticMethod(func)).toBe(false);
    });

    it('should not identify non-methods as static methods', () => {
      const func = createMockFunction({
        isMethod: false,
        isStatic: true,
      });
      
      expect(FunctionClassifier.isStaticMethod(func)).toBe(false);
    });
  });

  describe('isInstanceMethod', () => {
    it('should identify instance methods', () => {
      const func = createMockFunction({
        isMethod: true,
        isStatic: false,
      });
      
      expect(FunctionClassifier.isInstanceMethod(func)).toBe(true);
    });

    it('should not identify static methods as instance methods', () => {
      const func = createMockFunction({
        isMethod: true,
        isStatic: true,
      });
      
      expect(FunctionClassifier.isInstanceMethod(func)).toBe(false);
    });
  });

  describe('isConstructor', () => {
    it('should identify constructors using isConstructor flag', () => {
      const func = createMockFunction({
        isConstructor: true,
      });
      
      expect(FunctionClassifier.isConstructor(func)).toBe(true);
    });

    it('should identify constructors using name', () => {
      const func = createMockFunction({
        name: 'constructor',
      });
      
      expect(FunctionClassifier.isConstructor(func)).toBe(true);
    });

    it('should identify constructors using modifiers', () => {
      const func = createMockFunction({
        modifiers: ['constructor'],
      });
      
      expect(FunctionClassifier.isConstructor(func)).toBe(true);
    });
  });

  describe('isExported', () => {
    it('should identify exported functions', () => {
      const func = createMockFunction({
        isExported: true,
      });
      
      expect(FunctionClassifier.isExported(func)).toBe(true);
    });

    it('should identify non-exported functions', () => {
      const func = createMockFunction({
        isExported: false,
      });
      
      expect(FunctionClassifier.isExported(func)).toBe(false);
    });
  });

  describe('isTestFunction', () => {
    it('should identify test functions by file path', () => {
      const func = createMockFunction({
        filePath: '/test/file.test.ts',
      });
      
      expect(FunctionClassifier.isTestFunction(func)).toBe(true);
    });

    it('should identify test functions by name', () => {
      const func = createMockFunction({
        name: 'testSomething',
      });
      
      expect(FunctionClassifier.isTestFunction(func)).toBe(true);
    });

    it('should identify spec files', () => {
      const func = createMockFunction({
        filePath: '/src/component.spec.ts',
      });
      
      expect(FunctionClassifier.isTestFunction(func)).toBe(true);
    });

    it('should identify __tests__ directory', () => {
      const func = createMockFunction({
        filePath: '/src/__tests__/component.ts',
      });
      
      expect(FunctionClassifier.isTestFunction(func)).toBe(true);
    });

    it('should not identify regular functions as test functions', () => {
      const func = createMockFunction({
        filePath: '/src/component.ts',
        name: 'processData',
      });
      
      expect(FunctionClassifier.isTestFunction(func)).toBe(false);
    });
  });

  describe('isTestFile', () => {
    const testFilePaths = [
      '/test/file.test.ts',
      '/test/file.spec.js',
      '/src/__tests__/component.ts',
      '/cypress/integration/test.ts',
      '/test/unit/file.integration.ts',
      '/e2e/test.e2e.js',
    ];

    testFilePaths.forEach(filePath => {
      it(`should identify test file: ${filePath}`, () => {
        expect(FunctionClassifier.isTestFile(filePath)).toBe(true);
      });
    });

    const regularFilePaths = [
      '/src/component.ts',
      '/src/utils/helper.js',
      '/lib/index.ts',
    ];

    regularFilePaths.forEach(filePath => {
      it(`should not identify regular file as test: ${filePath}`, () => {
        expect(FunctionClassifier.isTestFile(filePath)).toBe(false);
      });
    });
  });

  describe('getClassification', () => {
    it('should return multiple classifications', () => {
      const func = createMockFunction({
        isMethod: true,
        isStatic: true,
        isExported: true,
        filePath: '/src/index.ts',
      });
      
      const classifications = FunctionClassifier.getClassification(func);
      
      expect(classifications).toContain('static-method');
      expect(classifications).toContain('exported');
      expect(classifications).toContain('index');
    });

    it('should return regular for functions with no special characteristics', () => {
      const func = createMockFunction({
        filePath: '/src/utils.ts',
        name: 'helper',
      });
      
      const classifications = FunctionClassifier.getClassification(func);
      
      expect(classifications).toEqual(['regular']);
    });
  });

  describe('getMetadata', () => {
    it('should return comprehensive metadata', () => {
      const func = createMockFunction({
        isMethod: true,
        isStatic: true,
        isExported: true,
        className: 'TestClass',
      });
      
      const metadata = FunctionClassifier.getMetadata(func);
      
      expect(metadata.isStaticMethod).toBe(true);
      expect(metadata.isInstanceMethod).toBe(false);
      expect(metadata.isExported).toBe(true);
      expect(metadata.className).toBe('TestClass');
      expect(metadata.classifications).toContain('static-method');
      expect(metadata.classifications).toContain('exported');
    });

    it('should handle functions without className', () => {
      const func = createMockFunction({
        name: 'regularFunction',
        filePath: '/src/utils/helper.ts', // Use non-test file path
      });
      
      const metadata = FunctionClassifier.getMetadata(func);
      
      expect(metadata).not.toHaveProperty('className');
      expect(metadata.classifications).toEqual(['regular']);
    });
  });
});