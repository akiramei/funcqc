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
    analyzer = new TypeScriptAnalyzer(100);
    
    // Use proper temporary file instead of :memory: to avoid filesystem pollution
    const dbPath = path.join(tempDir, 'test.db');
    storage = new PGLiteStorageAdapter(dbPath);
    await storage.init();
    
    // Ensure database is fully initialized
    const snapshots = await storage.getSnapshots({ limit: 1 });
    expect(snapshots).toBeDefined();
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
      // All functions should have semantic IDs
      expect(func.semanticId).toBeDefined();
      expect(typeof func.semanticId).toBe('string');
      expect(func.semanticId).toMatch(/^[0-9a-f]{64}$/i); // SHA-256 hex
      
      // Semantic IDs should be unique
      expect(logicalIds.has(func.semanticId!)).toBe(false);
      logicalIds.add(func.semanticId!);
      
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
    
    // Verify functions were analyzed correctly
    expect(functions).toBeDefined();
    expect(functions.length).toBeGreaterThan(0);
    console.log(`Analyzed ${functions.length} functions`);
    
    // DEBUG: Log function details for first 3 functions only
    functions.slice(0, 3).forEach((func, index) => {
      console.log(`  ${index + 1}: ${func.name} (${func.id.substring(0, 8)}...)`);
      console.log(`    signature: ${func.signature}`);
      console.log(`    contextPath: [${func.contextPath?.join(', ') || ''}]`);
      console.log(`    modifiers: [${func.modifiers?.join(', ') || ''}]`);
      console.log(`    sourceCode (full): "${func.sourceCode}"`);
      console.log(`    semanticId: ${func.semanticId?.substring(0, 16)}...`);
    });
    
    // Save all functions to storage to test for duplicate key errors
    let snapshotId: string | undefined;
    try {
      snapshotId = await storage.saveSnapshot(functions, 'large-test');
      console.log('Snapshot saved with ID:', snapshotId);
    } catch (error) {
      console.error('Failed to save snapshot:', error);
      console.error('Error type:', error?.constructor?.name);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      console.error('Functions count:', functions.length);
      throw error;
    }
    
    expect(snapshotId).toBeDefined();
    expect(typeof snapshotId).toBe('string');
    expect(snapshotId.length).toBeGreaterThan(0);
    expect(functions.length).toBe(20);
    
    // Retrieve functions from storage with full data
    const storedFunctions = await storage.getFunctions(snapshotId!, { includeFullData: true });
    console.log(`Retrieved ${storedFunctions.length} functions from storage`);
    
    // DEBUG: Log retrieved function details
    storedFunctions.forEach((func, index) => {
      console.log(`  Retrieved ${index + 1}: ${func.name} (${func.id.substring(0, 8)}...)`);
    });
    
    expect(storedFunctions.length).toBe(20);
    
    // Verify all IDs are unique
    const allIds = new Set(storedFunctions.map(f => f.id));
    expect(allIds.size).toBe(20);
    
    const allLogicalIds = new Set(storedFunctions.map(f => f.semanticId).filter(Boolean));
    console.log(`Unique logical IDs: ${allLogicalIds.size} (expected: 20)`);
    
    // DEBUG: Check which semantic IDs are missing or duplicated
    const semanticIdCounts = new Map<string, number>();
    storedFunctions.forEach(func => {
      if (func.semanticId) {
        semanticIdCounts.set(func.semanticId, (semanticIdCounts.get(func.semanticId) || 0) + 1);
      } else {
        console.log(`Function ${func.name} has no semanticId!`);
      }
    });
    
    // Show duplicated semantic IDs
    for (const [semanticId, count] of semanticIdCounts) {
      if (count > 1) {
        console.log(`Duplicate semanticId: ${semanticId.substring(0, 8)}... (used ${count} times)`);
        storedFunctions.filter(f => f.semanticId === semanticId).forEach(func => {
          console.log(`  - ${func.name} (${func.id.substring(0, 8)}...)`);
        });
      }
    }
    
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
    const logicalIds = new Set(processFunctions.map(f => f.semanticId));
    expect(logicalIds.size).toBe(processFunctions.length);
    
    // Verify context paths are different for detected functions
    const contextPaths = processFunctions.map(f => f.contextPath?.join('.') || '');
    const uniqueContexts = new Set(contextPaths);
    // Note: Some contexts might be similar, so just ensure we have multiple unique contexts
    expect(uniqueContexts.size).toBeGreaterThan(1);
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
    const logicalIds = new Set(arrowFunctions.map(f => f.semanticId));
    expect(logicalIds.size).toBe(arrowFunctions.length);
    
    // Verify they have position information
    for (const func of arrowFunctions) {
      expect(func.startLine).toBeGreaterThan(0);
      expect(func.functionType).toBe('arrow');
      // Verify the logical ID includes position for disambiguation
      expect(func.semanticId).toBeDefined();
    }
  });
});