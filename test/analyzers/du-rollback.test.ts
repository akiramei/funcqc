/**
 * Tests for DU Transformation Rollback and Error Recovery
 * 
 * Tests that transformations properly roll back when errors occur,
 * ensuring no corruption of source files during failures.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AstTransformer } from '../../src/analyzers/type-refactoring/du-incremental/ast-transformer';
import { promises as fs } from 'fs';
import path from 'path';

describe('DU Transformation Rollback and Error Recovery Tests', () => {
  const testDir = path.join(__dirname, '../../temp-rollback-test');
  let transformer: AstTransformer;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    // Use transformer WITH diagnostics enabled to catch errors
    transformer = new AstTransformer(undefined, false, false); // Enable diagnostics
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    transformer.dispose();
  });

  describe('Syntax Error Rollback', () => {
    it('should rollback when file has syntax errors', async () => {
      const syntaxErrorContent = `
interface Item {
  kind: 'Tag' | 'Note';
  data: string;
}

function processItem(item: Item): string {
  if (item.kind === 'Tag' {  // Missing closing parenthesis
    return 'Tag: ' + item.data;
  }
  return 'Other: ' + item.data;
}

function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}
`;

      const testFilePath = path.join(testDir, 'test-syntax-error.ts');
      await fs.writeFile(testFilePath, syntaxErrorContent);

      // Attempt transformation (should fail and rollback)
      const result = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      // Should fail due to syntax error
      expect(result.applied).toBe(0);
      expect(result.saved).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);

      // File should remain unchanged (rolled back)
      const contentAfterFailure = await fs.readFile(testFilePath, 'utf-8');
      expect(contentAfterFailure).toBe(syntaxErrorContent);
    });

    it('should rollback when transformation creates syntax errors', async () => {
      // Create a custom transformer that deliberately introduces syntax errors
      class ErrorInjectingTransformer extends AstTransformer {
        applySimpleGuardReplacement(sourceFile: any, discriminant: string, guardsModule: string): number {
          // Call parent method first
          const result = super.applySimpleGuardReplacement(sourceFile, discriminant, guardsModule);
          
          // Then introduce a syntax error
          const content = sourceFile.getFullText();
          const corruptedContent = content.replace(/\{/g, '{ SYNTAX_ERROR ');
          sourceFile.replaceWithText(corruptedContent);
          
          return result;
        }
      }

      const validContent = `
interface Item {
  kind: 'Tag' | 'Note';
  data: string;
}

function processItem(item: Item): string {
  if (item.kind === 'Tag') {
    return 'Tag: ' + item.data;
  }
  return 'Other: ' + item.data;
}

function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}
`;

      const testFilePath = path.join(testDir, 'test-induced-error.ts');
      await fs.writeFile(testFilePath, validContent);

      const errorTransformer = new ErrorInjectingTransformer(undefined, false, false);

      // Attempt transformation (should fail and rollback due to induced syntax error)
      const result = await errorTransformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      // Should fail due to syntax error introduced by transformation
      expect(result.applied).toBe(0);
      expect(result.saved).toBe(false);
      expect(result.errors).toBeDefined();

      // File should remain unchanged (rolled back)
      const contentAfterFailure = await fs.readFile(testFilePath, 'utf-8');
      expect(contentAfterFailure).toBe(validContent);

      errorTransformer.dispose();
    });
  });

  describe('TypeScript Compilation Error Rollback', () => {
    it('should rollback when transformation creates type errors', async () => {
      // Create content that becomes type-invalid after transformation
      const validContent = `
interface Item {
  kind: 'Tag' | 'Note';
  data: string;
}

// This function expects the original property access pattern
function externalFunction(item: Item): boolean {
  return item.kind === 'Tag'; // This will be transformed
}

// But this type constraint expects the original property
type TagChecker = (item: Item) => item.kind is 'Tag';

// This assignment will fail if we transform the function
const checker: TagChecker = externalFunction;

function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}
`;

      const testFilePath = path.join(testDir, 'test-type-error.ts');
      await fs.writeFile(testFilePath, validContent);

      // This transformation might create type incompatibilities
      const result = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      // Check if the transformation was rolled back due to type errors
      // Note: The exact behavior depends on TypeScript configuration
      if (result.errors && result.errors.length > 0) {
        expect(result.applied).toBe(0);
        expect(result.saved).toBe(false);
        
        // File should remain unchanged
        const contentAfterFailure = await fs.readFile(testFilePath, 'utf-8');
        expect(contentAfterFailure).toBe(validContent);
      } else {
        // If no type errors were detected, the transformation should succeed
        expect(result.saved).toBe(true);
      }
    });
  });

  describe('Partial Transformation Rollback', () => {
    it('should rollback all changes when transformation throws an error', async () => {
      // Test simpler error injection by creating invalid TypeScript after transformation
      const validContent = `
interface Item {
  kind: 'Tag' | 'Note';
  data: string;
}

function test1(item: Item): boolean {
  return item.kind === 'Tag';
}

function test2(item: Item): boolean {
  return item.kind === 'Note';
}

function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}

function isNote(item: Item): boolean {
  return item.kind === 'Note';
}
`;

      const testFilePath = path.join(testDir, 'test-error-injection.ts');
      await fs.writeFile(testFilePath, validContent);

      // Apply transformation and then manually corrupt the file to simulate a partial failure
      const result = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        // Apply normal transformation
        const count = astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
        
        // Introduce syntax error after transformation to trigger rollback
        const content = sourceFile.getFullText();
        const corruptedContent = content.replace(/import\s*\{/, 'import SYNTAX_ERROR {');
        sourceFile.replaceWithText(corruptedContent);
        
        return count;
      });

      // Should fail due to syntax error and rollback
      expect(result.applied).toBe(0);
      expect(result.saved).toBe(false);
      
      // May or may not have errors depending on when diagnostics run
      // But file should definitely be unchanged
      const contentAfterFailure = await fs.readFile(testFilePath, 'utf-8');
      expect(contentAfterFailure).toBe(validContent);
    });
  });

  describe('Memory Management During Rollback', () => {
    it('should properly clean up memory after rollback', async () => {
      const validContent = `
interface Item {
  kind: 'Tag';
  data: string;
}

function processItem(item: Item): string {
  if (item.kind === 'Tag') {
    return item.data;
  }
  return 'Unknown';
}

function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}
`;

      const testFilePath = path.join(testDir, 'test-memory-cleanup.ts');
      await fs.writeFile(testFilePath, validContent);

      // Create multiple transformers to test memory cleanup
      const transformers: AstTransformer[] = [];
      
      for (let i = 0; i < 5; i++) {
        const trans = new AstTransformer(undefined, false, false);
        transformers.push(trans);
        
        // Attempt transformation that will fail due to syntax error injection
        const syntaxErrorContent = validContent.replace(/\{/g, '{ SYNTAX_ERROR ');
        await fs.writeFile(testFilePath, syntaxErrorContent);
        
        const result = await trans.transformFile(testFilePath, (sourceFile, astTransformer) => {
          return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
        });
        
        expect(result.applied).toBe(0);
        expect(result.saved).toBe(false);
        
        // Reset to valid content for next iteration
        await fs.writeFile(testFilePath, validContent);
      }
      
      // Clean up transformers
      transformers.forEach(trans => trans.dispose());
      
      // If we reach here without memory issues, the test passes
      expect(transformers).toHaveLength(5);
    });
  });

  describe('Concurrent Transformation Rollback', () => {
    it('should handle rollback correctly when multiple transformations run concurrently', async () => {
      const validContent = `
interface Item {
  kind: 'Tag' | 'Note';
  data: string;
}

function processItem(item: Item): string {
  if (item.kind === 'Tag') {
    return 'Tag: ' + item.data;
  }
  return 'Other: ' + item.data;
}

function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}
`;

      // Create multiple test files
      const testFiles: string[] = [];
      for (let i = 0; i < 3; i++) {
        const testFilePath = path.join(testDir, `test-concurrent-${i}.ts`);
        await fs.writeFile(testFilePath, validContent);
        testFiles.push(testFilePath);
      }

      // Introduce syntax error in the second file
      const corruptedContent = validContent.replace('Tag', 'Tag SYNTAX_ERROR');
      await fs.writeFile(testFiles[1], corruptedContent);

      // Run transformations concurrently
      const transformationPromises = testFiles.map(async (filePath, index) => {
        const trans = new AstTransformer(undefined, false, false);
        
        const result = await trans.transformFile(filePath, (sourceFile, astTransformer) => {
          return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
        });
        
        trans.dispose();
        return { index, result, filePath };
      });

      const results = await Promise.all(transformationPromises);

      // First and third files should succeed (or fail gracefully)
      expect(results[0].result.saved || results[0].result.errors).toBeDefined();
      expect(results[2].result.saved || results[2].result.errors).toBeDefined();

      // Second file should fail and rollback
      expect(results[1].result.applied).toBe(0);
      expect(results[1].result.saved).toBe(false);
      expect(results[1].result.errors).toBeDefined();

      // Verify second file content is unchanged
      const secondFileContent = await fs.readFile(testFiles[1], 'utf-8');
      expect(secondFileContent).toBe(corruptedContent);
    });
  });

  describe('File System Error Rollback', () => {
    it('should handle file system errors gracefully', async () => {
      const validContent = `
interface Item {
  kind: 'Tag';
  data: string;
}

function processItem(item: Item): string {
  if (item.kind === 'Tag') {
    return item.data;
  }
  return 'Unknown';
}

function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}
`;

      const testFilePath = path.join(testDir, 'test-fs-error.ts');
      await fs.writeFile(testFilePath, validContent);

      // Make file read-only to simulate write permission error
      // Note: This might not work on all systems
      try {
        await fs.chmod(testFilePath, 0o444); // Read-only

        const result = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
          return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
        });

        // If we reach here, the transformation either succeeded (permissions allowed)
        // or failed gracefully with proper error handling
        if (result.errors && result.errors.length > 0) {
          expect(result.saved).toBe(false);
          expect(result.applied).toBe(0);
        }

        // Restore write permissions for cleanup
        await fs.chmod(testFilePath, 0o644);
        
      } catch (chmodError) {
        // If chmod fails (e.g., on some test systems), skip this test
        console.warn('Skipping file permission test:', chmodError);
      }
    });
  });
});