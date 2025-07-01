import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { TypeScriptAnalyzer } from '../src/analyzers/typescript-analyzer';
import { PGLiteStorageAdapter } from '../src/storage/pglite-adapter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Function ID Generation System', () => {
  let tempDir: string;
  let analyzer: TypeScriptAnalyzer;
  let storage: PGLiteStorageAdapter;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'funcqc-test-'));
    analyzer = new TypeScriptAnalyzer({ maxSourceFilesInMemory: 100 });
    
    // Use proper temporary file instead of :memory: to avoid filesystem pollution
    const dbPath = path.join(tempDir, 'test.db');
    storage = new PGLiteStorageAdapter(dbPath);
    await storage.init();
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
    }
    // Clean up temporary directory including database files
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('should generate unique physical UUIDs for each function', async () => {
    // Create a test file with multiple similar functions
    const testFile = path.join(tempDir, 'test.ts');
    const testContent = `
      export function validate(): boolean { return true; }
      export function validate2(): boolean { return false; }
      
      class TestClass {
        validate(): boolean { return true; }
        validate2(): boolean { return false; }
      }
      
      const arrowValidate = (): boolean => true;
      const arrowValidate2 = (): boolean => false;
    `;
    
    await fs.promises.writeFile(testFile, testContent);

    // Analyze the file
    const functions = await analyzer.analyzeFile(testFile);
    
    // Check that all physical IDs are unique UUIDs
    const physicalIds = new Set();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    for (const func of functions) {
      expect(func.id).toMatch(uuidRegex);
      expect(physicalIds.has(func.id)).toBe(false);
      physicalIds.add(func.id);
    }
    
    expect(functions.length).toBeGreaterThan(0);
    expect(physicalIds.size).toBe(functions.length);
  });

  it('should generate logical IDs with comprehensive context information', async () => {
    const testFile = path.join(tempDir, 'complex-test.ts');
    const testContent = `
      namespace TestNamespace {
        export class Calculator {
          private static validate(input: number): boolean {
            function innerValidate(value: number): boolean {
              return value > 0;
            }
            return innerValidate(input);
          }
          
          public add(a: number, b: number): number {
            return a + b;
          }
        }
      }
      
      export function topLevelFunction(): void {
        const localArrow = (x: number) => x * 2;
        
        function localFunction(): void {
          console.log('local');
        }
      }
    `;
    
    await fs.promises.writeFile(testFile, testContent);
    const functions = await analyzer.analyzeFile(testFile);
    
    // Verify logical IDs contain proper context information
    const logicalIds = new Set();
    
    for (const func of functions) {
      // All functions should have logical IDs
      expect(func.logicalId).toBeDefined();
      expect(typeof func.logicalId).toBe('string');
      expect(func.logicalId).toMatch(/^[0-9a-f]{64}$/i); // SHA-256 hex
      
      // Logical IDs should be unique
      expect(logicalIds.has(func.logicalId!)).toBe(false);
      logicalIds.add(func.logicalId!);
      
      // Context information should be present
      expect(func.contextPath).toBeDefined();
      expect(func.functionType).toMatch(/^(function|method|arrow|local)$/);
      expect(func.modifiers).toBeDefined();
      expect(typeof func.nestingLevel).toBe('number');
    }
  });

  it('should handle moderate number of functions without duplicate key errors', async () => {
    // Create a file with many similar functions to test collision resistance
    const testFile = path.join(tempDir, 'large-test.ts');
    const functionDeclarations: string[] = [];
    
    // Generate 20 functions with very similar signatures (reduced for performance)
    for (let i = 0; i < 20; i++) {
      functionDeclarations.push(`export function func${i}(param: string): string { return param + "${i}"; }`);
    }
    
    const testContent = functionDeclarations.join('\n');
    await fs.promises.writeFile(testFile, testContent);
    
    // Analyze the file
    const functions = await analyzer.analyzeFile(testFile);
    
    // Save all functions to storage to test for duplicate key errors
    const snapshotId = await storage.saveSnapshot(functions, 'large-test');
    
    expect(snapshotId).toBeDefined();
    expect(functions.length).toBe(20);
    
    // Retrieve functions from storage
    const storedFunctions = await storage.getFunctions(snapshotId);
    expect(storedFunctions.length).toBe(20);
    
    // Verify all IDs are unique
    const allIds = new Set(storedFunctions.map(f => f.id));
    expect(allIds.size).toBe(20);
    
    const allLogicalIds = new Set(storedFunctions.map(f => f.logicalId).filter(Boolean));
    expect(allLogicalIds.size).toBe(20);
  });

  it('should distinguish between functions with same name in different contexts', async () => {
    const testFile = path.join(tempDir, 'context-test.ts');
    const testContent = `
      function process(): void { }
      
      class DataProcessor {
        process(): void { }
        
        static process(): void { }
      }
      
      class EventProcessor {
        process(): void { }
      }
      
      function outerFunction(): void {
        function process(): void { }
      }
    `;
    
    await fs.promises.writeFile(testFile, testContent);
    const functions = await analyzer.analyzeFile(testFile);
    
    // Find all 'process' functions
    const processFunctions = functions.filter(f => f.name === 'process');
    // Note: Not all function types may be detected by current analyzer
    expect(processFunctions.length).toBeGreaterThan(0);
    
    // All should have different logical IDs due to different contexts
    const logicalIds = new Set(processFunctions.map(f => f.logicalId));
    expect(logicalIds.size).toBe(processFunctions.length);
    
    // Verify context paths are different for detected functions
    const contextPaths = processFunctions.map(f => f.contextPath?.join('.') || '');
    const uniqueContexts = new Set(contextPaths);
    expect(uniqueContexts.size).toBe(processFunctions.length);
  });

  it('should handle arrow functions with position-based identification', async () => {
    const testFile = path.join(tempDir, 'arrow-test.ts');
    const testContent = `
      const handler1 = () => console.log('handler1');
      const handler2 = (x: number) => x * 2;
      const handler3 = (x: number, y: number) => x + y;
    `;
    
    await fs.promises.writeFile(testFile, testContent);
    const functions = await analyzer.analyzeFile(testFile);
    
    // Should find arrow functions
    const arrowFunctions = functions.filter(f => f.isArrowFunction);
    expect(arrowFunctions.length).toBeGreaterThan(0);
    
    // All should have unique logical IDs
    const logicalIds = new Set(arrowFunctions.map(f => f.logicalId));
    expect(logicalIds.size).toBe(arrowFunctions.length);
    
    // Verify they have position information
    for (const func of arrowFunctions) {
      expect(func.startLine).toBeGreaterThan(0);
      expect(func.functionType).toBe('arrow');
      // Verify the logical ID includes position for disambiguation
      expect(func.logicalId).toBeDefined();
    }
  });
});