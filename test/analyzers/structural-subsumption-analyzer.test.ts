/**
 * Structural Subsumption Analyzer Tests
 * 
 * Tests for detecting structural relationships between types,
 * including subset/superset relations and partial overlaps.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StructuralSubsumptionAnalyzer, type SubsumptionRelationship } from '../../src/analyzers/type-insights/structural-subsumption-analyzer';
import type { TypePropertyInfo } from '../../src/analyzers/type-insights/cross-type-analyzer';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

// Mock storage interface
const createMockStorage = (): StorageQueryInterface => ({
  query: vi.fn()
});

// Helper to create test type data
const createTestType = (
  id: string,
  name: string,
  properties: string[] = [],
  methods: string[] = []
): TypePropertyInfo => ({
  typeId: id,
  typeName: name,
  properties,
  methods,
  memberCount: properties.length + methods.length,
  file: `test-${id}.ts`
});

describe('StructuralSubsumptionAnalyzer', () => {
  let storage: StorageQueryInterface;
  let analyzer: StructuralSubsumptionAnalyzer;

  beforeEach(() => {
    storage = createMockStorage();
    analyzer = new StructuralSubsumptionAnalyzer(storage);
    vi.clearAllMocks();
  });

  describe('Basic Configuration', () => {
    it('should initialize with default options', () => {
      const config = analyzer.getSubsumptionConfiguration();
      
      expect(config.minOverlapRatio).toBe(0.7);
      expect(config.includePartialMatches).toBe(true);
      expect(config.showRedundantOnly).toBe(false);
      expect(config.considerMethodNames).toBe(false);
    });

    it('should accept custom configuration', () => {
      const customAnalyzer = new StructuralSubsumptionAnalyzer(storage, {
        minOverlapRatio: 0.8,
        includePartialMatches: false,
        showRedundantOnly: true,
        considerMethodNames: true
      });

      const config = customAnalyzer.getSubsumptionConfiguration();
      
      expect(config.minOverlapRatio).toBe(0.8);
      expect(config.includePartialMatches).toBe(false);
      expect(config.showRedundantOnly).toBe(true);
      expect(config.considerMethodNames).toBe(true);
    });

    it('should update configuration dynamically', () => {
      analyzer.updateSubsumptionConfiguration({
        minOverlapRatio: 0.9,
        considerMethodNames: true
      });

      const config = analyzer.getSubsumptionConfiguration();
      expect(config.minOverlapRatio).toBe(0.9);
      expect(config.considerMethodNames).toBe(true);
    });
  });

  describe('Equivalent Types Detection', () => {
    it('should detect equivalent types with identical properties', async () => {
      // Mock data: Two types with identical properties
      const typeA = createTestType('type-a', 'UserProfile', ['id', 'name', 'email']);
      const typeB = createTestType('type-b', 'ProfileData', ['id', 'name', 'email']);

      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'UserProfile', file_path: 'user.ts' },
          { id: 'type-b', name: 'ProfileData', file_path: 'profile.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'id', member_kind: 'property' },
          { type_id: 'type-a', name: 'name', member_kind: 'property' },
          { type_id: 'type-a', name: 'email', member_kind: 'property' },
          { type_id: 'type-b', name: 'id', member_kind: 'property' },
          { type_id: 'type-b', name: 'name', member_kind: 'property' },
          { type_id: 'type-b', name: 'email', member_kind: 'property' }
        ]
      });

      const results = await analyzer.getDetailedResults();
      
      expect(results).toHaveLength(1);
      expect(results[0].relationshipType).toBe('equivalent');
      expect(results[0].overlapRatio).toBeCloseTo(1.0);
      expect(results[0].commonMembers).toEqual(['prop:email', 'prop:id', 'prop:name']);
      expect(results[0].uniqueToSource).toEqual([]);
      expect(results[0].uniqueToTarget).toEqual([]);
    });

    it('should detect near-equivalent types with small differences', async () => {
      // TypeA: {id, name, email, phone}
      // TypeB: {id, name, email, address} 
      // Overlap ratio: 3/5 = 0.6 (below default 0.7 threshold)
      
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'ContactInfo', file_path: 'contact.ts' },
          { id: 'type-b', name: 'UserContact', file_path: 'user.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'id', member_kind: 'property' },
          { type_id: 'type-a', name: 'name', member_kind: 'property' },
          { type_id: 'type-a', name: 'email', member_kind: 'property' },
          { type_id: 'type-a', name: 'phone', member_kind: 'property' },
          { type_id: 'type-b', name: 'id', member_kind: 'property' },
          { type_id: 'type-b', name: 'name', member_kind: 'property' },
          { type_id: 'type-b', name: 'email', member_kind: 'property' },
          { type_id: 'type-b', name: 'address', member_kind: 'property' }
        ]
      });

      // Lower threshold to catch this relationship
      const lowThresholdAnalyzer = new StructuralSubsumptionAnalyzer(storage, {
        minOverlapRatio: 0.5
      });

      const results = await lowThresholdAnalyzer.getDetailedResults();
      
      expect(results).toHaveLength(1);
      expect(results[0].relationshipType).toBe('partial_overlap');
      expect(results[0].overlapRatio).toBeCloseTo(0.6);
      expect(results[0].commonMembers).toEqual(['prop:email', 'prop:id', 'prop:name']);
    });
  });

  describe('Subset/Superset Detection', () => {
    it('should detect subset relationship', async () => {
      // TypeA (subset): {id, name}
      // TypeB (superset): {id, name, email, phone}
      
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'BasicUser', file_path: 'basic.ts' },
          { id: 'type-b', name: 'DetailedUser', file_path: 'detailed.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'id', member_kind: 'property' },
          { type_id: 'type-a', name: 'name', member_kind: 'property' },
          { type_id: 'type-b', name: 'id', member_kind: 'property' },
          { type_id: 'type-b', name: 'name', member_kind: 'property' },
          { type_id: 'type-b', name: 'email', member_kind: 'property' },
          { type_id: 'type-b', name: 'phone', member_kind: 'property' }
        ]
      });

      const results = await analyzer.getDetailedResults();
      
      expect(results).toHaveLength(1);
      expect(results[0].relationshipType).toBe('subset');
      expect(results[0].sourceTypeName).toBe('BasicUser');
      expect(results[0].targetTypeName).toBe('DetailedUser');
      expect(results[0].commonMembers).toEqual(['prop:id', 'prop:name']);
      expect(results[0].uniqueToSource).toEqual([]);
      expect(results[0].uniqueToTarget).toEqual(['prop:email', 'prop:phone']);
    });

    it('should detect superset relationship', async () => {
      // TypeA (superset): {id, name, email, phone}
      // TypeB (subset): {id, name}
      
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'DetailedUser', file_path: 'detailed.ts' },
          { id: 'type-b', name: 'BasicUser', file_path: 'basic.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'id', member_kind: 'property' },
          { type_id: 'type-a', name: 'name', member_kind: 'property' },
          { type_id: 'type-a', name: 'email', member_kind: 'property' },
          { type_id: 'type-a', name: 'phone', member_kind: 'property' },
          { type_id: 'type-b', name: 'id', member_kind: 'property' },
          { type_id: 'type-b', name: 'name', member_kind: 'property' }
        ]
      });

      const results = await analyzer.getDetailedResults();
      
      expect(results).toHaveLength(1);
      expect(results[0].relationshipType).toBe('superset');
      expect(results[0].sourceTypeName).toBe('DetailedUser');
      expect(results[0].targetTypeName).toBe('BasicUser');
      expect(results[0].commonMembers).toEqual(['prop:id', 'prop:name']);
      expect(results[0].uniqueToSource).toEqual(['prop:email', 'prop:phone']);
      expect(results[0].uniqueToTarget).toEqual([]);
    });
  });

  describe('Partial Overlap Detection', () => {
    it('should detect partial overlap relationships', async () => {
      // TypeA: {id, name, email}
      // TypeB: {id, name, phone}
      // Overlap: 2/4 = 0.5 (below default threshold)
      
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'EmailUser', file_path: 'email-user.ts' },
          { id: 'type-b', name: 'PhoneUser', file_path: 'phone-user.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'id', member_kind: 'property' },
          { type_id: 'type-a', name: 'name', member_kind: 'property' },
          { type_id: 'type-a', name: 'email', member_kind: 'property' },
          { type_id: 'type-b', name: 'id', member_kind: 'property' },
          { type_id: 'type-b', name: 'name', member_kind: 'property' },
          { type_id: 'type-b', name: 'phone', member_kind: 'property' }
        ]
      });

      const lowThresholdAnalyzer = new StructuralSubsumptionAnalyzer(storage, {
        minOverlapRatio: 0.4
      });

      const results = await lowThresholdAnalyzer.getDetailedResults();
      
      expect(results).toHaveLength(1);
      expect(results[0].relationshipType).toBe('partial_overlap');
      expect(results[0].overlapRatio).toBeCloseTo(0.5);
      expect(results[0].commonMembers).toEqual(['prop:id', 'prop:name']);
      expect(results[0].uniqueToSource).toEqual(['prop:email']);
      expect(results[0].uniqueToTarget).toEqual(['prop:phone']);
    });

    it('should filter out partial overlaps when disabled', async () => {
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'TypeA', file_path: 'a.ts' },
          { id: 'type-b', name: 'TypeB', file_path: 'b.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'shared', member_kind: 'property' },
          { type_id: 'type-a', name: 'uniqueA', member_kind: 'property' },
          { type_id: 'type-b', name: 'shared', member_kind: 'property' },
          { type_id: 'type-b', name: 'uniqueB', member_kind: 'property' }
        ]
      });

      const noPartialAnalyzer = new StructuralSubsumptionAnalyzer(storage, {
        minOverlapRatio: 0.3,
        includePartialMatches: false
      });

      const results = await noPartialAnalyzer.getDetailedResults();
      
      expect(results).toHaveLength(0);
    });
  });

  describe('Method Name Consideration', () => {
    it('should include method names when enabled', async () => {
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'ServiceA', file_path: 'service-a.ts' },
          { id: 'type-b', name: 'ServiceB', file_path: 'service-b.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'data', member_kind: 'property' },
          { type_id: 'type-a', name: 'init', member_kind: 'method' },
          { type_id: 'type-a', name: 'destroy', member_kind: 'method' },
          { type_id: 'type-b', name: 'data', member_kind: 'property' },
          { type_id: 'type-b', name: 'init', member_kind: 'method' },
          { type_id: 'type-b', name: 'cleanup', member_kind: 'method' }
        ]
      });

      const methodAnalyzer = new StructuralSubsumptionAnalyzer(storage, {
        considerMethodNames: true,
        minOverlapRatio: 0.4
      });

      const results = await methodAnalyzer.getDetailedResults();
      
      expect(results).toHaveLength(1);
      expect(results[0].commonMembers).toContain('prop:data');
      expect(results[0].commonMembers).toContain('method:init');
      expect(results[0].uniqueToSource).toContain('method:destroy');
      expect(results[0].uniqueToTarget).toContain('method:cleanup');
    });

    it('should ignore method names when disabled (default)', async () => {
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'ServiceA', file_path: 'service-a.ts' },
          { id: 'type-b', name: 'ServiceB', file_path: 'service-b.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'data', member_kind: 'property' },
          { type_id: 'type-a', name: 'init', member_kind: 'method' },
          { type_id: 'type-b', name: 'data', member_kind: 'property' },
          { type_id: 'type-b', name: 'cleanup', member_kind: 'method' }
        ]
      });

      const results = await analyzer.getDetailedResults();
      
      expect(results).toHaveLength(1);
      expect(results[0].relationshipType).toBe('equivalent'); // Both have only 'data' property
      expect(results[0].commonMembers).toEqual(['prop:data']);
      expect(results[0].commonMembers).not.toContain('method:init');
      expect(results[0].commonMembers).not.toContain('method:cleanup');
    });
  });

  describe('Filtering and Edge Cases', () => {
    it('should handle empty types gracefully', async () => {
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'EmptyType', file_path: 'empty.ts' },
          { id: 'type-b', name: 'AnotherEmpty', file_path: 'another.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [] // No members for either type
      });

      const results = await analyzer.getDetailedResults();
      
      expect(results).toHaveLength(0);
    });

    it('should skip self-comparison', async () => {
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'SelfType', file_path: 'self.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          { type_id: 'type-a', name: 'prop1', member_kind: 'property' },
          { type_id: 'type-a', name: 'prop2', member_kind: 'property' }
        ]
      });

      const results = await analyzer.getDetailedResults();
      
      expect(results).toHaveLength(0);
    });

    it('should show only redundant types when configured', async () => {
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'TypeA', file_path: 'a.ts' },
          { id: 'type-b', name: 'TypeB', file_path: 'b.ts' },
          { id: 'type-c', name: 'TypeC', file_path: 'c.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          // TypeA and TypeB are equivalent
          { type_id: 'type-a', name: 'id', member_kind: 'property' },
          { type_id: 'type-a', name: 'name', member_kind: 'property' },
          { type_id: 'type-b', name: 'id', member_kind: 'property' },
          { type_id: 'type-b', name: 'name', member_kind: 'property' },
          // TypeC is subset
          { type_id: 'type-c', name: 'id', member_kind: 'property' }
        ]
      });

      const redundantOnlyAnalyzer = new StructuralSubsumptionAnalyzer(storage, {
        showRedundantOnly: true,
        minOverlapRatio: 0.5
      });

      const results = await redundantOnlyAnalyzer.getDetailedResults();
      
      expect(results).toHaveLength(1);
      expect(results[0].relationshipType).toBe('equivalent');
    });
  });

  describe('Impact Scoring and Confidence', () => {
    it('should calculate higher impact for equivalent types', async () => {
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'type-a', name: 'TypeA', file_path: 'a.ts' },
          { id: 'type-b', name: 'TypeB', file_path: 'b.ts' },
          { id: 'type-c', name: 'TypeC', file_path: 'c.ts' },
          { id: 'type-d', name: 'TypeD', file_path: 'd.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          // Equivalent types (high impact)
          { type_id: 'type-a', name: 'id', member_kind: 'property' },
          { type_id: 'type-a', name: 'name', member_kind: 'property' },
          { type_id: 'type-b', name: 'id', member_kind: 'property' },
          { type_id: 'type-b', name: 'name', member_kind: 'property' },
          // Partial overlap (lower impact)
          { type_id: 'type-c', name: 'id', member_kind: 'property' },
          { type_id: 'type-c', name: 'different', member_kind: 'property' },
          { type_id: 'type-d', name: 'id', member_kind: 'property' },
          { type_id: 'type-d', name: 'other', member_kind: 'property' }
        ]
      });

      const results = await analyzer.getDetailedResults();
      
      const equivalentResult = results.find(r => r.relationshipType === 'equivalent');
      const partialResult = results.find(r => r.relationshipType === 'partial_overlap');
      
      expect(equivalentResult?.impactScore).toBeGreaterThan(partialResult?.impactScore || 0);
    });

    it('should calculate confidence based on type sizes', async () => {
      vi.mocked(storage.query).mockResolvedValueOnce({
        rows: [
          { id: 'large-a', name: 'LargeTypeA', file_path: 'large-a.ts' },
          { id: 'large-b', name: 'LargeTypeB', file_path: 'large-b.ts' },
          { id: 'small-a', name: 'SmallTypeA', file_path: 'small-a.ts' },
          { id: 'small-b', name: 'SmallTypeB', file_path: 'small-b.ts' }
        ]
      }).mockResolvedValueOnce({
        rows: [
          // Large equivalent types (should have higher confidence)
          ...Array.from({ length: 10 }, (_, i) => ({
            type_id: 'large-a',
            name: `prop${i}`,
            member_kind: 'property'
          })),
          ...Array.from({ length: 10 }, (_, i) => ({
            type_id: 'large-b',
            name: `prop${i}`,
            member_kind: 'property'
          })),
          // Small equivalent types (lower confidence)
          { type_id: 'small-a', name: 'id', member_kind: 'property' },
          { type_id: 'small-b', name: 'id', member_kind: 'property' }
        ]
      });

      const results = await analyzer.getDetailedResults();
      
      const largeResult = results.find(r => r.sourceTypeName.includes('Large'));
      const smallResult = results.find(r => r.sourceTypeName.includes('Small'));
      
      expect(largeResult?.confidence).toBeGreaterThan(smallResult?.confidence || 0);
    });
  });

  describe('Error Handling', () => {
    it('should handle storage query errors gracefully', async () => {
      vi.mocked(storage.query).mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(analyzer.getDetailedResults()).rejects.toThrow('Failed to get detailed subsumption results');
    });

    it('should handle malformed database responses', async () => {
      vi.mocked(storage.query)
        .mockResolvedValueOnce({
          rows: [
            { id: 'type-a', name: 'TypeA', file_path: 'test.ts' } // Complete row
          ]
        })
        .mockResolvedValueOnce({
          rows: [] // Empty members - should result in no relationships
        });

      const results = await analyzer.getDetailedResults();
      expect(results).toHaveLength(0);
    });
  });
});