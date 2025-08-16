/**
 * Tests for DU Transformation Idempotency 
 * 
 * Ensures that applying the same transformation twice produces no changes
 * on the second application. This is critical for transformation safety.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AstTransformer } from '../../src/analyzers/type-refactoring/du-incremental/ast-transformer';
import { promises as fs } from 'fs';
import path from 'path';

describe('DU Transformation Idempotency Tests', () => {
  const testDir = path.join(__dirname, '../../temp-idempotent-test');
  let transformer: AstTransformer;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    transformer = new AstTransformer(undefined, false, true); // Skip diagnostics for testing
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    transformer.dispose();
  });

  describe('Simple Guard Replacement Idempotency', () => {
    it('should apply no changes on second application of guard replacement', async () => {
      const originalContent = `
interface Item {
  kind: 'Tag' | 'Note' | 'Task';
  data: string;
}

function processItem(item: Item): string {
  if (item.kind === 'Tag') {
    return 'Tag: ' + item.data;
  } else if (item.kind === 'Note') {
    return 'Note: ' + item.data;
  }
  return 'Other: ' + item.data;
}

function filterItems(items: Item[]): Item[] {
  return items.filter(item => item.kind === 'Tag' || item.kind === 'Note');
}

// Guard functions (would be imported)
function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}

function isNote(item: Item): boolean {
  return item.kind === 'Note';
}

function isTask(item: Item): boolean {
  return item.kind === 'Task';
}
`;

      const testFilePath = path.join(testDir, 'test-idempotent-guards.ts');
      await fs.writeFile(testFilePath, originalContent);

      // First application
      const firstResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      expect(firstResult.applied).toBeGreaterThan(0);
      expect(firstResult.saved).toBe(true);

      // Read content after first transformation
      const afterFirstTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterFirstTransform).toContain('isTag(item)');
      expect(afterFirstTransform).toContain('isNote(item)');

      // Second application (should be idempotent)
      const secondResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      // Second application should find no changes to make
      expect(secondResult.applied).toBe(0);
      expect(secondResult.saved).toBe(false); // No changes, so no save

      // Content should be unchanged after second application
      const afterSecondTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterSecondTransform).toBe(afterFirstTransform);
    });

    it('should handle mixed transformed and non-transformed code correctly', async () => {
      // Start with partially transformed content
      const partiallyTransformedContent = `
import { isTag, isNote } from './guards';

interface Item {
  kind: 'Tag' | 'Note' | 'Task';
  data: string;
}

function processItem(item: Item): string {
  // Already transformed
  if (isTag(item)) {
    return 'Tag: ' + item.data;
  } else if (isNote(item)) {
    return 'Note: ' + item.data;
  }
  return 'Other: ' + item.data;
}

function checkItem(item: Item): boolean {
  // Not yet transformed
  return item.kind === 'Task';
}

function isTask(item: Item): boolean {
  return item.kind === 'Task';
}
`;

      const testFilePath = path.join(testDir, 'test-partial.ts');
      await fs.writeFile(testFilePath, partiallyTransformedContent);

      // Apply transformation
      const firstResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      expect(firstResult.applied).toBeGreaterThan(0); // Multiple transformations may be applied
      expect(firstResult.saved).toBe(true);

      const afterFirstTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterFirstTransform).toContain('isTask(item)');

      // Second application should be idempotent
      const secondResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      expect(secondResult.applied).toBe(0);
      expect(secondResult.saved).toBe(false);

      const afterSecondTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterSecondTransform).toBe(afterFirstTransform);
    });
  });

  describe('Switch Statement Transformation Idempotency', () => {
    it('should apply no changes on second application of switch transformation', async () => {
      const originalContent = `
interface Status {
  kind: 'success' | 'error' | 'pending';
  message: string;
}

function handleStatus(status: Status): string {
  switch (status.kind) {
    case 'success':
      return 'Success: ' + status.message;
    case 'error':
      return 'Error: ' + status.message;
    case 'pending':
      return 'Pending: ' + status.message;
    default:
      return 'Unknown';
  }
}

function getIcon(status: Status): string {
  switch (status.kind) {
    case 'success':
      return '✓';
    case 'error':
      return '✗';
    case 'pending':
      return '⏳';
    default:
      return '?';
  }
}

function isSuccess(status: Status): boolean {
  return status.kind === 'success';
}

function isError(status: Status): boolean {
  return status.kind === 'error';
}

function isPending(status: Status): boolean {
  return status.kind === 'pending';
}
`;

      const testFilePath = path.join(testDir, 'test-switch-idempotent.ts');
      await fs.writeFile(testFilePath, originalContent);

      // First application
      const firstResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySwitchToIfElseTransformation(sourceFile, 'kind', './guards');
      });

      expect(firstResult.applied).toBeGreaterThan(0);
      expect(firstResult.saved).toBe(true);

      const afterFirstTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterFirstTransform).toContain('if (isSuccess(status))');
      expect(afterFirstTransform).toContain('else if (isError(status))');
      expect(afterFirstTransform).not.toContain('switch (status.kind)');

      // Second application should be idempotent
      const secondResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySwitchToIfElseTransformation(sourceFile, 'kind', './guards');
      });

      expect(secondResult.applied).toBe(0);
      expect(secondResult.saved).toBe(false);

      const afterSecondTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterSecondTransform).toBe(afterFirstTransform);
    });
  });

  describe('Exhaustiveness Check Idempotency', () => {
    it('should apply no changes on second application of exhaustiveness checks', async () => {
      const originalContent = `
interface Action {
  type: 'create' | 'update' | 'delete';
  payload: any;
}

function processAction(action: Action): void {
  switch (action.type) {
    case 'create':
      console.log('Creating');
      break;
    case 'update':
      console.log('Updating');
      break;
    case 'delete':
      console.log('Deleting');
      break;
    default:
      console.log('Unknown action');
      return;
  }
}

function getActionName(action: Action): string {
  switch (action.type) {
    case 'create':
      return 'Create';
    case 'update':
      return 'Update';
    case 'delete':
      return 'Delete';
    default:
      return 'Unknown';
  }
}
`;

      const testFilePath = path.join(testDir, 'test-exhaustive-idempotent.ts');
      await fs.writeFile(testFilePath, originalContent);

      // First application
      const firstResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.addExhaustivenessChecks(sourceFile, 'type');
      });

      expect(firstResult.applied).toBeGreaterThan(0);
      expect(firstResult.saved).toBe(true);

      const afterFirstTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterFirstTransform).toContain('const _exhaustive: never = action.type as never');
      expect(afterFirstTransform).toContain('return _exhaustive');

      // Second application should be idempotent
      const secondResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.addExhaustivenessChecks(sourceFile, 'type');
      });

      expect(secondResult.applied).toBe(0);
      expect(secondResult.saved).toBe(false);

      const afterSecondTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterSecondTransform).toBe(afterFirstTransform);
    });

    it('should not add duplicate exhaustiveness checks', async () => {
      // Start with content that already has some exhaustiveness checks
      const mixedContent = `
interface Action {
  type: 'create' | 'update' | 'delete';
  payload: any;
}

function processAction(action: Action): void {
  switch (action.type) {
    case 'create':
      console.log('Creating');
      break;
    case 'update':
      console.log('Updating');
      break;
    default:
      const _exhaustive: never = action.type as never;
      return _exhaustive;
  }
}

function getActionName(action: Action): string {
  switch (action.type) {
    case 'create':
      return 'Create';
    case 'update':
      return 'Update';
    case 'delete':
      return 'Delete';
    default:
      return 'Unknown';
  }
}
`;

      const testFilePath = path.join(testDir, 'test-mixed-exhaustive.ts');
      await fs.writeFile(testFilePath, mixedContent);

      // Apply exhaustiveness checks
      const result = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.addExhaustivenessChecks(sourceFile, 'type');
      });

      expect(result.applied).toBe(1); // Only getActionName should get exhaustiveness check
      expect(result.saved).toBe(true);

      const afterTransform = await fs.readFile(testFilePath, 'utf-8');
      
      // Should have exactly 2 exhaustiveness checks (one was already there, one added)
      const exhaustiveMatches = afterTransform.match(/const _exhaustive: never/g);
      expect(exhaustiveMatches).toBeTruthy();
      expect(exhaustiveMatches!.length).toBe(2);

      // Second application should be idempotent
      const secondResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.addExhaustivenessChecks(sourceFile, 'type');
      });

      expect(secondResult.applied).toBe(0);
      expect(secondResult.saved).toBe(false);

      const afterSecondTransform = await fs.readFile(testFilePath, 'utf-8');
      expect(afterSecondTransform).toBe(afterTransform);
    });
  });

  describe('Multi-Transformation Idempotency', () => {
    it('should maintain idempotency across multiple transformation types', async () => {
      const originalContent = `
interface Event {
  type: 'click' | 'hover' | 'focus';
  target: string;
}

function handleEvent(event: Event): void {
  if (event.type === 'click') {
    console.log('Clicked:', event.target);
  }

  switch (event.type) {
    case 'hover':
      console.log('Hovered:', event.target);
      break;
    case 'focus':
      console.log('Focused:', event.target);
      break;
    default:
      console.log('Unknown event');
  }
}

function isClick(event: Event): boolean {
  return event.type === 'click';
}

function isHover(event: Event): boolean {
  return event.type === 'hover';
}

function isFocus(event: Event): boolean {
  return event.type === 'focus';
}
`;

      const testFilePath = path.join(testDir, 'test-multi-idempotent.ts');
      await fs.writeFile(testFilePath, originalContent);

      // Apply transformations in sequence (first pass)
      const guardResult1 = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'type', './guards');
      });

      const switchResult1 = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySwitchToIfElseTransformation(sourceFile, 'type', './guards');
      });

      const exhaustiveResult1 = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.addExhaustivenessChecks(sourceFile, 'type');
      });

      // Verify first pass made changes
      expect(guardResult1.applied + switchResult1.applied + exhaustiveResult1.applied).toBeGreaterThan(0);

      const afterFirstPass = await fs.readFile(testFilePath, 'utf-8');

      // Apply same transformations again (second pass - should be idempotent)
      const guardResult2 = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'type', './guards');
      });

      const switchResult2 = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySwitchToIfElseTransformation(sourceFile, 'type', './guards');
      });

      const exhaustiveResult2 = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.addExhaustivenessChecks(sourceFile, 'type');
      });

      // Second pass should make no changes
      expect(guardResult2.applied).toBe(0);
      expect(switchResult2.applied).toBe(0);
      expect(exhaustiveResult2.applied).toBe(0);

      expect(guardResult2.saved).toBe(false);
      expect(switchResult2.saved).toBe(false);
      expect(exhaustiveResult2.saved).toBe(false);

      const afterSecondPass = await fs.readFile(testFilePath, 'utf-8');
      expect(afterSecondPass).toBe(afterFirstPass);
    });
  });

  describe('Import Statement Idempotency', () => {
    it('should not duplicate import statements on repeated applications', async () => {
      const originalContent = `
interface Item {
  kind: 'A' | 'B';
  value: string;
}

function test1(item: Item): boolean {
  return item.kind === 'A';
}

function test2(item: Item): boolean {
  return item.kind === 'B';
}

function isA(item: Item): boolean {
  return item.kind === 'A';
}

function isB(item: Item): boolean {
  return item.kind === 'B';
}
`;

      const testFilePath = path.join(testDir, 'test-import-idempotent.ts');
      await fs.writeFile(testFilePath, originalContent);

      // First application
      const firstResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      expect(firstResult.applied).toBeGreaterThan(0);
      expect(firstResult.saved).toBe(true);

      const afterFirstTransform = await fs.readFile(testFilePath, 'utf-8');
      
      // Should have one import statement
      const importMatches = afterFirstTransform.match(/import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?/g);
      expect(importMatches).toBeTruthy();
      expect(importMatches!.length).toBe(1);

      // Second application
      const secondResult = await transformer.transformFile(testFilePath, (sourceFile, astTransformer) => {
        return astTransformer.applySimpleGuardReplacement(sourceFile, 'kind', './guards');
      });

      expect(secondResult.applied).toBe(0);
      expect(secondResult.saved).toBe(false);

      const afterSecondTransform = await fs.readFile(testFilePath, 'utf-8');
      
      // Should still have only one import statement
      const secondImportMatches = afterSecondTransform.match(/import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?/g);
      expect(secondImportMatches).toBeTruthy();
      expect(secondImportMatches!.length).toBe(1);

      expect(afterSecondTransform).toBe(afterFirstTransform);
    });
  });
});