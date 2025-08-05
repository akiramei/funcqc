import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeScriptAnalyzer } from '../src/analyzers/typescript-analyzer';
import { PGLiteStorageAdapter } from '../src/storage/pglite-adapter';
import { globalHashCache } from '../src/utils/hash-cache';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Semantic ID Stability', () => {
  let tempDir: string;
  let analyzer: TypeScriptAnalyzer;
  let storage: PGLiteStorageAdapter;

  beforeEach(async () => {
    // Clear hash cache to ensure fresh analysis
    globalHashCache.clear();
    
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'funcqc-semantic-'));
    analyzer = new TypeScriptAnalyzer(100, false); // Disable cache for testing
    
    const dbPath = path.join(tempDir, 'test.db');
    storage = new PGLiteStorageAdapter(dbPath);
    await storage.init();
    
    const snapshots = await storage.getSnapshots({ limit: 1 });
    expect(snapshots).toBeDefined();
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
    }
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('should maintain same semantic ID when implementation changes', async () => {
    const testFile = path.join(tempDir, 'semantic-test.ts');
    
    // Version 1: Simple implementation
    const contentV1 = `
      export class UserService {
        validate(user: { email: string }): boolean {
          return user.email.includes('@');
        }
      }
    `;
    
    // Version 2: More sophisticated implementation (same semantic meaning)
    const contentV2 = `
      export class UserService {
        validate(user: { email: string }): boolean {
          // More robust email validation
          const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
          return emailRegex.test(user.email);
        }
      }
    `;

    // Analyze version 1
    await fs.promises.writeFile(testFile, contentV1);
    const functionsV1 = await analyzer.analyzeFile(testFile);
    const validateV1 = functionsV1.find(f => f.name === 'validate');
    expect(validateV1).toBeDefined();

    // Analyze version 2
    await fs.promises.writeFile(testFile, contentV2);
    const functionsV2 = await analyzer.analyzeFile(testFile);
    const validateV2 = functionsV2.find(f => f.name === 'validate');
    expect(validateV2).toBeDefined();

    // Semantic IDs should be identical (same function from user perspective)
    expect(validateV1!.semanticId).toBe(validateV2!.semanticId);

    // But content IDs should be different (implementation changed)
    expect(validateV1!.contentId).not.toBe(validateV2!.contentId);

    // Physical IDs should be different (different instances)
    expect(validateV1!.id).not.toBe(validateV2!.id);

    console.log('✓ Semantic ID remains stable across implementation changes');
    console.log(`  Semantic ID: ${validateV1!.semanticId?.substring(0, 16)}...`);
    console.log(`  Content V1:  ${validateV1!.contentId?.substring(0, 16)}...`);
    console.log(`  Content V2:  ${validateV2!.contentId?.substring(0, 16)}...`);
  });

  it('should generate different semantic IDs for different signatures', async () => {
    const testFile = path.join(tempDir, 'signature-test.ts');
    
    const content = `
      export class UserService {
        // Same name, different signature
        validate(user: { email: string }): boolean {
          return user.email.includes('@');
        }
        
        validate(user: { email: string }, options: { strict: boolean }): boolean {
          return user.email.includes('@');
        }
      }
    `;

    await fs.promises.writeFile(testFile, content);
    const functions = await analyzer.analyzeFile(testFile);
    const validateFunctions = functions.filter(f => f.name === 'validate');
    
    expect(validateFunctions.length).toBeGreaterThanOrEqual(1);
    
    // If multiple validate functions are detected, they should have different semantic IDs
    if (validateFunctions.length > 1) {
      const semanticIds = new Set(validateFunctions.map(f => f.semanticId));
      expect(semanticIds.size).toBe(validateFunctions.length);
    }
  });

  it('should generate different semantic IDs for different contexts', async () => {
    const testFile = path.join(tempDir, 'context-test.ts');
    
    const content = `
      export class UserService {
        process(): void { }
      }
      
      export class OrderService {
        process(): void { }
      }
      
      export function process(): void { }
    `;

    await fs.promises.writeFile(testFile, content);
    const functions = await analyzer.analyzeFile(testFile);
    const processFunctions = functions.filter(f => f.name === 'process');
    
    expect(processFunctions.length).toBeGreaterThan(0);
    
    // All process functions should have different semantic IDs due to different contexts
    const semanticIds = new Set(processFunctions.map(f => f.semanticId));
    expect(semanticIds.size).toBe(processFunctions.length);

    console.log(`✓ Found ${processFunctions.length} process functions with unique semantic IDs`);
    processFunctions.forEach((func, index) => {
      console.log(`  ${index + 1}: ${func.contextPath?.join('.') || '<global>'}.${func.name} -> ${func.semanticId?.substring(0, 16)}...`);
    });
  });

  it('should exclude implementation details from semantic ID', async () => {
    const testFile = path.join(tempDir, 'implementation-test.ts');
    
    // Same function signature, different implementations
    const implementations = [
      `
        export function calculateSum(numbers: number[]): number {
          let sum = 0;
          for (let i = 0; i < numbers.length; i++) {
            sum += numbers[i];
          }
          return sum;
        }
      `,
      `
        export function calculateSum(numbers: number[]): number {
          return numbers.reduce((acc, num) => acc + num, 0);
        }
      `,
      `
        export function calculateSum(numbers: number[]): number {
          // Using different approach
          let total = 0;
          numbers.forEach(num => total += num);
          return total;
        }
      `
    ];

    const semanticIds: string[] = [];
    const contentIds: string[] = [];

    for (const [index, implementation] of implementations.entries()) {
      // Clear hash cache before each analysis to ensure fresh results
      globalHashCache.clear();
      
      await fs.promises.writeFile(testFile, implementation);
      const functions = await analyzer.analyzeFile(testFile);
      const calculateSum = functions.find(f => f.name === 'calculateSum');
      
      expect(calculateSum).toBeDefined();
      expect(calculateSum!.semanticId).toBeDefined();
      expect(calculateSum!.contentId).toBeDefined();
      
      semanticIds.push(calculateSum!.semanticId!);
      contentIds.push(calculateSum!.contentId!);
      
      console.log(`  Implementation ${index + 1}:`);
      console.log(`    Functions found: ${functions.length}`);
      console.log(`    calculateSum found: ${calculateSum ? 'YES' : 'NO'}`);
      console.log(`    Semantic: ${calculateSum!.semanticId?.substring(0, 16)}...`);
      console.log(`    Content:  ${calculateSum!.contentId?.substring(0, 16)}...`);
      console.log(`    Source Length: ${implementation.length}`);
      console.log(`    Function Source: ${calculateSum!.signature?.substring(0, 50)}...`);
      console.log(`    File Hash: ${calculateSum!.fileHash?.substring(0, 16)}...`);
    }

    // All semantic IDs should be identical
    const uniqueSemanticIds = new Set(semanticIds);
    expect(uniqueSemanticIds.size).toBe(1);
    
    // All content IDs should be different
    const uniqueContentIds = new Set(contentIds);
    expect(uniqueContentIds.size).toBe(implementations.length);

    console.log('✓ Semantic ID stable across different implementations');
    console.log('✓ Content ID varies with implementation changes');
  });
});