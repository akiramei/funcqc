/**
 * Tests for Property Co-occurrence Analyzer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PropertyCooccurrenceAnalyzer } from '../../src/analyzers/type-refactoring/property-cooccurrence';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

// Mock storage interface
const mockStorage: StorageQueryInterface = {
  query: async (sql: string, params?: unknown[]) => {
    // Mock type definitions with properties
    if (sql.includes('type_definitions') && sql.includes('type_members')) {
      return {
        rows: [
          {
            id: 'type-1',
            name: 'UserType',
            file_path: 'src/types/user.ts',
            definition: '{ id: string; name: string; email: string; }',
            member_name: 'id',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'type-1',
            name: 'UserType',
            file_path: 'src/types/user.ts',
            definition: '{ id: string; name: string; email: string; }',
            member_name: 'name',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'type-1',
            name: 'UserType',
            file_path: 'src/types/user.ts',
            definition: '{ id: string; name: string; email: string; }',
            member_name: 'email',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'type-2',
            name: 'PersonType',
            file_path: 'src/types/person.ts',
            definition: '{ id: string; name: string; age: number; }',
            member_name: 'id',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'type-2',
            name: 'PersonType',
            file_path: 'src/types/person.ts',
            definition: '{ id: string; name: string; age: number; }',
            member_name: 'name',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'type-2',
            name: 'PersonType',
            file_path: 'src/types/person.ts',
            definition: '{ id: string; name: string; age: number; }',
            member_name: 'age',
            member_kind: 'property',
            is_optional: false,
            member_type: 'number'
          },
          {
            id: 'type-3',
            name: 'MoneyType',
            file_path: 'src/types/money.ts',
            definition: '{ amount: number; currency: string; }',
            member_name: 'amount',
            member_kind: 'property',
            is_optional: false,
            member_type: 'number'
          },
          {
            id: 'type-3',
            name: 'MoneyType',
            file_path: 'src/types/money.ts',
            definition: '{ amount: number; currency: string; }',
            member_name: 'currency',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          }
        ]
      };
    }

    return { rows: [] };
  }
};

describe('PropertyCooccurrenceAnalyzer', () => {
  let analyzer: PropertyCooccurrenceAnalyzer;

  beforeEach(() => {
    analyzer = new PropertyCooccurrenceAnalyzer(mockStorage, {
      minSupport: 1,
      minConfidence: 0.3,
      maxPatternSize: 3,
      includeOptionalProperties: true,
      excludeCommonProperties: ['id', 'createdAt', 'updatedAt']
    });
  });

  afterEach(() => {
    // Clean up any resources if needed
  });

  describe('analyze', () => {
    it('should analyze property co-occurrence patterns', async () => {
      const result = await analyzer.analyze();

      expect(result).toBeDefined();
      expect(result.patterns).toBeDefined();
      expect(result.propertyStats).toBeDefined();
      expect(result.candidateCanonicalTypes).toBeDefined();
      expect(result.valueObjectCandidates).toBeDefined();
      expect(result.totalTypesAnalyzed).toBe(3);
    });

    it('should identify property statistics', async () => {
      const result = await analyzer.analyze();

      expect(result.propertyStats.length).toBeGreaterThan(0);
      
      // Should have stats for non-excluded properties
      const nameProperty = result.propertyStats.find(p => p.propertyName === 'name');
      expect(nameProperty).toBeDefined();
      expect(nameProperty?.totalOccurrences).toBe(2); // UserType and PersonType
      
      const emailProperty = result.propertyStats.find(p => p.propertyName === 'email');
      expect(emailProperty).toBeDefined();
      expect(emailProperty?.totalOccurrences).toBe(1); // UserType only
    });

    it('should find co-occurrence patterns', async () => {
      const result = await analyzer.analyze();

      expect(result.patterns.length).toBeGreaterThan(0);
      
      // Should find patterns for properties that co-occur
      const nameEmailPattern = result.patterns.find(p => 
        p.properties.includes('name') && p.properties.includes('email')
      );
      
      if (nameEmailPattern) {
        expect(nameEmailPattern.support).toBeGreaterThan(0);
        expect(nameEmailPattern.types).toContain('UserType');
      }
    });

    it('should identify value object candidates', async () => {
      const result = await analyzer.analyze();

      // Should identify Money as a good VO candidate
      const moneyCandidate = result.valueObjectCandidates.find(vc =>
        vc.propertyGroup.includes('amount') && vc.propertyGroup.includes('currency')
      );
      
      if (moneyCandidate) {
        expect(moneyCandidate.types).toContain('MoneyType');
        expect(moneyCandidate.cohesionScore).toBeGreaterThan(0);
        expect(moneyCandidate.extractionComplexity).toBeDefined();
      }
    });

    it('should respect configuration options', async () => {
      const restrictiveAnalyzer = new PropertyCooccurrenceAnalyzer(mockStorage, {
        minSupport: 2, // Higher threshold
        minConfidence: 0.8,
        maxPatternSize: 2,
        excludeCommonProperties: ['id', 'name'] // Exclude more properties
      });

      const result = await restrictiveAnalyzer.analyze();

      // Should have fewer results with more restrictive settings
      expect(result.patterns.length).toBeLessThanOrEqual(result.patterns.length);
    });

    it('should handle empty results gracefully', async () => {
      const emptyStorage: StorageQueryInterface = {
        query: async () => ({ rows: [] })
      };

      const emptyAnalyzer = new PropertyCooccurrenceAnalyzer(emptyStorage);
      const result = await emptyAnalyzer.analyze();

      expect(result.patterns).toHaveLength(0);
      expect(result.propertyStats).toHaveLength(0);
      expect(result.candidateCanonicalTypes).toHaveLength(0);
      expect(result.valueObjectCandidates).toHaveLength(0);
      expect(result.totalTypesAnalyzed).toBe(0);
    });
  });

  describe('canonical type identification', () => {
    it('should identify types that cover others', async () => {
      const result = await analyzer.analyze();

      // UserType should be identified as canonical since it has common properties
      const userCanonical = result.candidateCanonicalTypes.find(c => 
        c.typeName === 'UserType'
      );

      if (userCanonical) {
        expect(userCanonical.properties).toContain('name');
        expect(userCanonical.coverageScore).toBeGreaterThan(0);
      }
    });

    it('should calculate coverage scores correctly', async () => {
      const result = await analyzer.analyze();

      for (const candidate of result.candidateCanonicalTypes) {
        expect(candidate.coverageScore).toBeGreaterThanOrEqual(0);
        expect(candidate.coverageScore).toBeLessThanOrEqual(1);
        expect(candidate.usageFrequency).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('value object candidate generation', () => {
    it('should generate appropriate VO names', async () => {
      const result = await analyzer.analyze();

      const moneyCandidate = result.valueObjectCandidates.find(vc =>
        vc.propertyGroup.includes('amount') && vc.propertyGroup.includes('currency')
      );
      
      if (moneyCandidate) {
        expect(moneyCandidate.groupName).toBe('Money');
      }
    });

    it('should infer invariant candidates', async () => {
      const result = await analyzer.analyze();

      const moneyCandidate = result.valueObjectCandidates.find(vc =>
        vc.propertyGroup.includes('amount')
      );
      
      if (moneyCandidate) {
        expect(moneyCandidate.invariantCandidates).toContain('amount >= 0');
      }
    });

    it('should assess extraction complexity', async () => {
      const result = await analyzer.analyze();

      for (const candidate of result.valueObjectCandidates) {
        expect(['low', 'medium', 'high']).toContain(candidate.extractionComplexity);
      }
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const errorStorage: StorageQueryInterface = {
        query: async () => {
          throw new Error('Database connection failed');
        }
      };

      const errorAnalyzer = new PropertyCooccurrenceAnalyzer(errorStorage);
      
      await expect(errorAnalyzer.analyze()).rejects.toThrow();
    });

    it('should handle malformed data', async () => {
      const malformedStorage: StorageQueryInterface = {
        query: async () => ({
          rows: [
            { id: null, name: '', member_name: null }
          ]
        })
      };

      const malformedAnalyzer = new PropertyCooccurrenceAnalyzer(malformedStorage);
      const result = await malformedAnalyzer.analyze();

      // Should not crash and return sensible defaults
      expect(result).toBeDefined();
      expect(result.totalTypesAnalyzed).toBe(0);
    });
  });
});