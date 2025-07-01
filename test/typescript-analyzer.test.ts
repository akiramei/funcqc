import { describe, it, expect, beforeEach } from 'vitest';
import { TypeScriptAnalyzer } from '../src/analyzers/typescript-analyzer';
import * as path from 'path';

describe('TypeScriptAnalyzer', () => {
  let analyzer: TypeScriptAnalyzer;

  beforeEach(() => {
    analyzer = new TypeScriptAnalyzer();
  });

  describe('analyzeFile', () => {
    it('should extract function information from TypeScript file', async () => {
      const testFile = path.join(__dirname, 'fixtures/sample.ts');
      
      const functions = await analyzer.analyzeFile(testFile);
      
      expect(functions).toBeDefined();
      expect(functions.length).toBeGreaterThan(0);
      
      // Check fetchUser function
      const fetchUser = functions.find(f => f.name === 'fetchUser');
      expect(fetchUser).toBeDefined();
      expect(fetchUser?.isAsync).toBe(true);
      expect(fetchUser?.isExported).toBe(true);
      expect(fetchUser?.parameters).toHaveLength(1);
      expect(fetchUser?.parameters[0].name).toBe('id');
      expect(fetchUser?.parameters[0].type).toBe('string');
    });

    it('should extract method information from classes', async () => {
      const testFile = path.join(__dirname, 'fixtures/sample.ts');
      
      const functions = await analyzer.analyzeFile(testFile);
      
      // Check UserService methods
      const getUser = functions.find(f => f.name === 'getUser');
      expect(getUser).toBeDefined();
      expect(getUser?.isMethod).toBe(true);
      expect(getUser?.contextPath).toContain('UserService');
      expect(getUser?.accessModifier).toBeUndefined(); // public is default

      const fetchWithAuth = functions.find(f => f.name === 'fetchWithAuth');
      expect(fetchWithAuth).toBeDefined();
      expect(fetchWithAuth?.isMethod).toBe(true);
      expect(fetchWithAuth?.accessModifier).toBe('private');
    });

    it('should handle non-existent files', async () => {
      const nonExistentFile = path.join(__dirname, 'non-existent.ts');
      
      await expect(analyzer.analyzeFile(nonExistentFile)).rejects.toThrow();
    });
  });

  describe('function signatures', () => {
    it('should generate correct signatures', async () => {
      const testFile = path.join(__dirname, 'fixtures/sample.ts');
      
      const functions = await analyzer.analyzeFile(testFile);
      
      const fetchUser = functions.find(f => f.name === 'fetchUser');
      expect(fetchUser?.signature).toContain('fetchUser(id: string)');
      expect(fetchUser?.signature).toContain('Promise<User>');
    });
  });

  describe('function attributes', () => {
    it('should correctly identify function types', async () => {
      const testFile = path.join(__dirname, 'fixtures/sample.ts');
      
      const functions = await analyzer.analyzeFile(testFile);
      
      // Regular function
      const calculateTotal = functions.find(f => f.name === 'calculateTotal');
      expect(calculateTotal?.isArrowFunction).toBe(false);
      expect(calculateTotal?.isAsync).toBe(false);
      expect(calculateTotal?.isMethod).toBe(false);
      
      // Constructor
      const constructor = functions.find(f => f.name === 'constructor');
      expect(constructor?.isConstructor).toBe(true);
    });
  });
});
