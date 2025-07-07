import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGLiteStorageAdapter } from '../../src/storage/pglite-adapter';
import { Lineage, LineageKind, LineageStatus, LineageQuery } from '../../src/types';

describe('Lineage Storage Operations', () => {
  let storage: PGLiteStorageAdapter;

  beforeEach(async () => {
    // Use temporary file-based database for testing to avoid Windows filesystem issues
    const testDbPath = `/tmp/funcqc-test-lineage-${Date.now()}.db`;
    storage = new PGLiteStorageAdapter(testDbPath);
    await storage.init();
  });

  afterEach(async () => {
    // Clean up all lineage records
    try {
      const lineages = await storage.getLineages();
      for (const lineage of lineages) {
        await storage.deleteLineage(lineage.id);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
    await storage.close();
  });

  describe('Basic CRUD Operations', () => {
    it('should save and retrieve a lineage record', async () => {
      const lineage: Lineage = {
        id: 'test-basic-crud-1',
        fromIds: ['func-id-1'],
        toIds: ['func-id-2'],
        kind: 'rename' as LineageKind,
        status: 'draft' as LineageStatus,
        confidence: 0.95,
        note: 'Simple rename from oldFunc to newFunc',
        gitCommit: 'abc123def456',
        createdAt: new Date('2024-01-01T00:00:00Z')
      };

      await storage.saveLineage(lineage);
      const retrieved = await storage.getLineage('test-basic-crud-1');

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('test-basic-crud-1');
      expect(retrieved!.fromIds).toEqual(['func-id-1']);
      expect(retrieved!.toIds).toEqual(['func-id-2']);
      expect(retrieved!.kind).toBe('rename');
      expect(retrieved!.status).toBe('draft');
      expect(retrieved!.confidence).toBe(0.95);
      expect(retrieved!.note).toBe('Simple rename from oldFunc to newFunc');
      expect(retrieved!.gitCommit).toBe('abc123def456');
    });

    it('should handle lineage with multiple from/to IDs', async () => {
      const lineage: Lineage = {
        id: 'test-lineage-split',
        fromIds: ['func-id-big'],
        toIds: ['func-id-small-1', 'func-id-small-2'],
        kind: 'split' as LineageKind,
        status: 'final' as LineageStatus,
        confidence: 0.80,
        gitCommit: 'def456ghi789',
        createdAt: new Date()
      };

      await storage.saveLineage(lineage);
      const retrieved = await storage.getLineage('test-lineage-split');

      expect(retrieved!.fromIds).toEqual(['func-id-big']);
      expect(retrieved!.toIds).toEqual(['func-id-small-1', 'func-id-small-2']);
      expect(retrieved!.kind).toBe('split');
    });

    it('should return null for non-existent lineage', async () => {
      const result = await storage.getLineage('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('Status Updates', () => {
    it('should update lineage status from draft to final', async () => {
      const lineage: Lineage = {
        id: 'test-status-update',
        fromIds: ['func-a'],
        toIds: ['func-b'],
        kind: 'signature-change' as LineageKind,
        status: 'draft' as LineageStatus,
        gitCommit: 'commit123',
        createdAt: new Date()
      };

      await storage.saveLineage(lineage);
      await storage.updateLineageStatus('test-status-update', 'final', 'Confirmed by review');

      const updated = await storage.getLineage('test-status-update');
      expect(updated!.status).toBe('final');
      expect(updated!.note).toBe('Confirmed by review');
      expect(updated!.updatedAt).toBeDefined();
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Set up test data
      const testLineages: Lineage[] = [
        {
          id: 'lineage-1',
          fromIds: ['func-1'],
          toIds: ['func-2'],
          kind: 'rename',
          status: 'draft',
          confidence: 0.95,
          gitCommit: 'commit-1',
          createdAt: new Date('2024-01-01T00:00:00Z')
        },
        {
          id: 'lineage-2',
          fromIds: ['func-3'],
          toIds: ['func-4'],
          kind: 'signature-change',
          status: 'final',
          confidence: 0.85,
          gitCommit: 'commit-2',
          createdAt: new Date('2024-01-02T00:00:00Z')
        },
        {
          id: 'lineage-3',
          fromIds: ['func-5'],
          toIds: ['func-6', 'func-7'],
          kind: 'split',
          status: 'draft',
          confidence: 0.75,
          gitCommit: 'commit-1',
          createdAt: new Date('2024-01-03T00:00:00Z')
        }
      ];

      for (const lineage of testLineages) {
        await storage.saveLineage(lineage);
      }
    });

    it('should query lineages by status', async () => {
      const draftLineages = await storage.getLineages({ status: 'draft' });
      expect(draftLineages).toHaveLength(2);
      expect(draftLineages.every(l => l.status === 'draft')).toBe(true);

      const finalLineages = await storage.getLineages({ status: 'final' });
      expect(finalLineages).toHaveLength(1);
      expect(finalLineages[0].status).toBe('final');
    });

    it('should query lineages by kind', async () => {
      const renameLineages = await storage.getLineages({ kind: 'rename' });
      expect(renameLineages).toHaveLength(1);
      expect(renameLineages[0].kind).toBe('rename');
    });

    it('should query lineages by git commit', async () => {
      const commit1Lineages = await storage.getLineages({ gitCommit: 'commit-1' });
      expect(commit1Lineages).toHaveLength(2);
      expect(commit1Lineages.every(l => l.gitCommit === 'commit-1')).toBe(true);
    });

    it('should query lineages with minimum confidence', async () => {
      const highConfidenceLineages = await storage.getLineages({ minConfidence: 0.90 });
      expect(highConfidenceLineages).toHaveLength(1);
      expect(highConfidenceLineages[0].confidence).toBeGreaterThanOrEqual(0.90);
    });

    it('should support pagination', async () => {
      const firstPage = await storage.getLineages({ limit: 2 });
      expect(firstPage).toHaveLength(2);

      const secondPage = await storage.getLineages({ limit: 2, offset: 2 });
      expect(secondPage).toHaveLength(1);
    });
  });

  describe('Delete Operations', () => {
    it('should delete a lineage record', async () => {
      const lineage: Lineage = {
        id: 'test-delete',
        fromIds: ['func-delete'],
        toIds: ['func-new'],
        kind: 'rename',
        status: 'draft',
        gitCommit: 'delete-commit',
        createdAt: new Date()
      };

      await storage.saveLineage(lineage);
      const deleted = await storage.deleteLineage('test-delete');
      expect(deleted).toBe(true);

      const retrieved = await storage.getLineage('test-delete');
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting non-existent lineage', async () => {
      const deleted = await storage.deleteLineage('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('Commit-based Operations', () => {
    it('should retrieve lineages by commit', async () => {
      const lineages: Lineage[] = [
        {
          id: 'commit-test-1',
          fromIds: ['func-a'],
          toIds: ['func-b'],
          kind: 'rename',
          status: 'final',
          gitCommit: 'target-commit',
          createdAt: new Date()
        },
        {
          id: 'commit-test-2',
          fromIds: ['func-c'],
          toIds: ['func-d'],
          kind: 'split',
          status: 'draft',
          gitCommit: 'target-commit',
          createdAt: new Date()
        }
      ];

      for (const lineage of lineages) {
        await storage.saveLineage(lineage);
      }

      const commitLineages = await storage.getLineagesByCommit('target-commit');
      expect(commitLineages).toHaveLength(2);
      expect(commitLineages.every(l => l.gitCommit === 'target-commit')).toBe(true);
    });
  });

  describe('Function History Operations', () => {
    it('should retrieve lineage history for a function', async () => {
      const functionId = 'func-with-history';
      const lineages: Lineage[] = [
        {
          id: 'history-1',
          fromIds: [functionId],
          toIds: ['func-renamed'],
          kind: 'rename',
          status: 'final',
          gitCommit: 'commit-a',
          createdAt: new Date('2024-01-01')
        },
        {
          id: 'history-2',
          fromIds: ['func-other'],
          toIds: [functionId],
          kind: 'signature-change',
          status: 'final',
          gitCommit: 'commit-b',
          createdAt: new Date('2024-01-02')
        }
      ];

      for (const lineage of lineages) {
        await storage.saveLineage(lineage);
      }

      const history = await storage.getFunctionLineageHistory(functionId);
      expect(history).toHaveLength(2);
      
      // Should be ordered by created_at DESC
      expect(history[0].gitCommit).toBe('commit-b');
      expect(history[1].gitCommit).toBe('commit-a');
    });
  });

  describe('Cleanup Operations', () => {
    it('should prune old draft lineages', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

      const lineages: Lineage[] = [
        {
          id: 'old-draft',
          fromIds: ['func-old'],
          toIds: ['func-new'],
          kind: 'rename',
          status: 'draft',
          gitCommit: 'old-commit',
          createdAt: oldDate
        },
        {
          id: 'recent-draft',
          fromIds: ['func-recent'],
          toIds: ['func-newer'],
          kind: 'rename',
          status: 'draft',
          gitCommit: 'recent-commit',
          createdAt: new Date()
        },
        {
          id: 'old-final',
          fromIds: ['func-old-final'],
          toIds: ['func-final'],
          kind: 'rename',
          status: 'final',
          gitCommit: 'old-final-commit',
          createdAt: oldDate
        }
      ];

      for (const lineage of lineages) {
        await storage.saveLineage(lineage);
      }

      const prunedCount = await storage.pruneDraftLineages(5); // Prune drafts older than 5 days
      expect(prunedCount).toBe(1); // Only old-draft should be removed

      const remaining = await storage.getLineages();
      expect(remaining).toHaveLength(2);
      expect(remaining.find(l => l.id === 'old-draft')).toBeUndefined();
      expect(remaining.find(l => l.id === 'recent-draft')).toBeDefined();
      expect(remaining.find(l => l.id === 'old-final')).toBeDefined(); // Final status should be preserved
    });
  });
});