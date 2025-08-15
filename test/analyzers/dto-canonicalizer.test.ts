/**
 * Tests for DTO Canonicalizer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DTOCanonicalizer } from '../../src/analyzers/type-refactoring/dto-canonicalizer';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

// Mock storage interface
const mockStorage: StorageQueryInterface = {
  query: async (sql: string, params?: unknown[]) => {
    // Mock single type definition queries - MUST be checked before general type_definitions query
    if (sql.includes('type_definitions') && params && params.length === 1) {
      const typeName = params[0] as string;
      const typeMap: Record<string, any[]> = {
        'UserType': [
          { id: 'user-type', name: 'UserType', file_path: 'src/types/user.ts', definition: '{ id: string; name: string; email: string; role: string; }', member_name: 'id', member_type: 'string', is_optional: false },
          { id: 'user-type', name: 'UserType', file_path: 'src/types/user.ts', definition: '{ id: string; name: string; email: string; role: string; }', member_name: 'name', member_type: 'string', is_optional: false },
          { id: 'user-type', name: 'UserType', file_path: 'src/types/user.ts', definition: '{ id: string; name: string; email: string; role: string; }', member_name: 'email', member_type: 'string', is_optional: false },
          { id: 'user-type', name: 'UserType', file_path: 'src/types/user.ts', definition: '{ id: string; name: string; email: string; role: string; }', member_name: 'role', member_type: 'string', is_optional: false }
        ],
        'UserSummary': [
          { id: 'user-summary', name: 'UserSummary', file_path: 'src/types/user-summary.ts', definition: '{ id: string; name: string; }', member_name: 'id', member_type: 'string', is_optional: false },
          { id: 'user-summary', name: 'UserSummary', file_path: 'src/types/user-summary.ts', definition: '{ id: string; name: string; }', member_name: 'name', member_type: 'string', is_optional: false }
        ],
        'UserProfile': [
          { id: 'user-profile', name: 'UserProfile', file_path: 'src/types/user-profile.ts', definition: '{ name: string; email: string; }', member_name: 'name', member_type: 'string', is_optional: false },
          { id: 'user-profile', name: 'UserProfile', file_path: 'src/types/user-profile.ts', definition: '{ name: string; email: string; }', member_name: 'email', member_type: 'string', is_optional: false }
        ]
      };
      
      if (typeMap[typeName]) {
        return { rows: typeMap[typeName] };
      }
    }
    
    // Mock type definitions with properties for canonicalization - general query
    if (sql.includes('type_definitions') && sql.includes('type_members')) {
      return {
        rows: [
          // UserType - full type
          {
            id: 'user-type',
            name: 'UserType',
            file_path: 'src/types/user.ts',
            definition: '{ id: string; name: string; email: string; role: string; }',
            member_name: 'id',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'user-type',
            name: 'UserType',
            file_path: 'src/types/user.ts',
            definition: '{ id: string; name: string; email: string; role: string; }',
            member_name: 'name',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'user-type',
            name: 'UserType',
            file_path: 'src/types/user.ts',
            definition: '{ id: string; name: string; email: string; role: string; }',
            member_name: 'email',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'user-type',
            name: 'UserType',
            file_path: 'src/types/user.ts',
            definition: '{ id: string; name: string; email: string; role: string; }',
            member_name: 'role',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          // UserSummary - subset of UserType
          {
            id: 'user-summary',
            name: 'UserSummary',
            file_path: 'src/types/user-summary.ts',
            definition: '{ id: string; name: string; }',
            member_name: 'id',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'user-summary',
            name: 'UserSummary',
            file_path: 'src/types/user-summary.ts',
            definition: '{ id: string; name: string; }',
            member_name: 'name',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          // UserProfile - subset with overlap
          {
            id: 'user-profile',
            name: 'UserProfile',
            file_path: 'src/types/user-profile.ts',
            definition: '{ name: string; email: string; }',
            member_name: 'name',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          },
          {
            id: 'user-profile',
            name: 'UserProfile',
            file_path: 'src/types/user-profile.ts',
            definition: '{ name: string; email: string; }',
            member_name: 'email',
            member_kind: 'property',
            is_optional: false,
            member_type: 'string'
          }
        ]
      };
    }

    // Mock function usage count
    if (sql.includes('function_type_usage') && sql.includes('COUNT')) {
      return {
        rows: [{ count: 5 }] // Mock function count
      };
    }

    // Mock affected files
    if (sql.includes('file_path') && sql.includes('DISTINCT')) {
      return {
        rows: [
          { file_path: 'src/services/user.ts' },
          { file_path: 'src/controllers/user.ts' },
          { file_path: 'src/types/user.ts' }
        ]
      };
    }

    // Mock distinct type name queries
    if (sql.includes('DISTINCT td.name FROM type_definitions')) {
      return {
        rows: [
          { name: 'UserType' },
          { name: 'UserSummary' }, 
          { name: 'UserProfile' }
        ]
      };
    }

    return { rows: [] };
  }
};

describe('DTOCanonicalizer', () => {
  let canonicalizer: DTOCanonicalizer;

  beforeEach(() => {
    canonicalizer = new DTOCanonicalizer(mockStorage, {
      minSupport: 1,
      minConfidence: 0.3,
      maxPatternSize: 5,
      includeOptionalProperties: true,
      excludeCommonProperties: ['id'],
      includeBehavioralAnalysis: true,
      requireMinimalImpact: false,
      generateCodemodActions: true,
      preserveOptionalityDifferences: true
    });
  });

  afterEach(() => {
    // Clean up any resources if needed
  });

  describe('analyze', () => {
    it('should analyze DTO types and generate canonicalization recommendations', async () => {
      const result = await canonicalizer.analyze();

      expect(result).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(result.typeRelationships).toBeDefined();
      expect(result.consolidationOpportunities).toBeDefined();
      expect(result.generatedArtifacts).toBeDefined();
      expect(result.qualityMetrics).toBeDefined();
    });

    it('should identify type relationships correctly', async () => {
      const result = await canonicalizer.analyze();

      expect(result.typeRelationships.length).toBeGreaterThan(0);
      
      // Should identify subset relationships
      const subsetRelationship = result.typeRelationships.find(r => 
        (r.sourceType === 'UserSummary' && r.targetType === 'UserType') ||
        (r.targetType === 'UserSummary' && r.sourceType === 'UserType')
      );
      
      if (subsetRelationship) {
        expect(['subset', 'superset']).toContain(subsetRelationship.relationshipType);
        expect(subsetRelationship.structuralSimilarity).toBeGreaterThan(0);
        expect(subsetRelationship.compatibilityScore).toBeGreaterThan(0);
      }
    });

    it('should generate consolidation opportunities', async () => {
      const result = await canonicalizer.analyze();

      expect(result.consolidationOpportunities.length).toBeGreaterThan(0);
      
      const opportunity = result.consolidationOpportunities[0];
      expect(opportunity.id).toBeDefined();
      expect(opportunity.types.length).toBeGreaterThan(1);
      expect(opportunity.opportunityType).toBeDefined();
      expect(opportunity.estimatedBenefit).toBeGreaterThanOrEqual(0);
      expect(opportunity.estimatedBenefit).toBeLessThanOrEqual(1);
      expect(['low', 'medium', 'high']).toContain(opportunity.implementationComplexity);
    });

    it('should calculate quality metrics', async () => {
      const result = await canonicalizer.analyze();

      expect(result.qualityMetrics.duplicateReduction).toBeGreaterThanOrEqual(0);
      expect(result.qualityMetrics.duplicateReduction).toBeLessThanOrEqual(1);
      expect(result.qualityMetrics.cohesionImprovement).toBeGreaterThanOrEqual(0);
      expect(result.qualityMetrics.cohesionImprovement).toBeLessThanOrEqual(1);
      expect(result.qualityMetrics.maintainabilityScore).toBeGreaterThanOrEqual(0);
      expect(result.qualityMetrics.maintainabilityScore).toBeLessThanOrEqual(1);
    });
  });

  describe('canonicalization recommendations', () => {
    it('should generate valid canonicalization plans', async () => {
      const result = await canonicalizer.analyze();

      if (result.recommendations.length > 0) {
        const plan = result.recommendations[0];
        
        expect(plan.canonicalType).toBeDefined();
        expect(plan.consolidationActions).toBeDefined();
        expect(plan.generatedViewTypes).toBeDefined();
        expect(plan.migrationStrategy).toBeDefined();
        expect(plan.estimatedImpact).toBeDefined();
        
        // Validate canonical type
        expect(plan.canonicalType.typeName).toBeDefined();
        expect(plan.canonicalType.properties).toBeDefined();
        expect(plan.canonicalType.subsetTypes).toBeDefined();
        expect(plan.canonicalType.coverageScore).toBeGreaterThanOrEqual(0);
        expect(plan.canonicalType.coverageScore).toBeLessThanOrEqual(1);
        
        // Validate consolidation actions
        for (const action of plan.consolidationActions) {
          expect(action.actionType).toBeDefined();
          expect(action.sourceType).toBeDefined();
          expect(action.targetType).toBeDefined();
          expect(action.description).toBeDefined();
          expect(['low', 'medium', 'high']).toContain(action.riskLevel);
          expect(typeof action.automaticMigration).toBe('boolean');
        }
        
        // Validate migration strategy
        expect(plan.migrationStrategy.approach).toBeDefined();
        expect(plan.migrationStrategy.phases).toBeDefined();
        expect(plan.migrationStrategy.phases.length).toBeGreaterThan(0);
        expect(plan.migrationStrategy.rollbackPlan).toBeDefined();
        expect(plan.migrationStrategy.estimatedDuration).toBeDefined();
        
        // Validate impact assessment
        expect(plan.estimatedImpact.typesAffected).toBeGreaterThanOrEqual(0);
        expect(plan.estimatedImpact.functionsAffected).toBeGreaterThanOrEqual(0);
        expect(plan.estimatedImpact.filesAffected).toBeDefined();
        expect(plan.estimatedImpact.estimatedSavings).toBeDefined();
        expect(plan.estimatedImpact.riskAssessment).toBeDefined();
      }
    });

    it('should generate view types for subset relationships', async () => {
      const result = await canonicalizer.analyze();

      if (result.recommendations.length > 0) {
        const plan = result.recommendations[0];
        
        for (const viewType of plan.generatedViewTypes) {
          expect(viewType.viewName).toBeDefined();
          expect(viewType.sourceCanonicalType).toBeDefined();
          expect(viewType.definition).toBeDefined();
          expect(['pick', 'omit', 'partial', 'custom']).toContain(viewType.viewType);
          expect(viewType.selectedProperties).toBeDefined();
          expect(viewType.generatedMappers.toCanonical).toBeDefined();
          expect(viewType.generatedMappers.fromCanonical).toBeDefined();
        }
      }
    });

    it('should assess risk levels appropriately', async () => {
      const result = await canonicalizer.analyze();

      if (result.recommendations.length > 0) {
        const plan = result.recommendations[0];
        
        expect(['low', 'medium', 'high', 'critical']).toContain(
          plan.estimatedImpact.riskAssessment.overallRisk
        );
        
        expect(plan.estimatedImpact.riskAssessment.riskFactors).toBeDefined();
        expect(plan.estimatedImpact.riskAssessment.mitigationStrategies).toBeDefined();
        
        // Risk factors should be strings
        plan.estimatedImpact.riskAssessment.riskFactors.forEach((factor: string) => {
          expect(typeof factor).toBe('string');
          expect(factor.length).toBeGreaterThan(0);
        });
        
        // Mitigation strategies should be strings
        plan.estimatedImpact.riskAssessment.mitigationStrategies.forEach((strategy: string) => {
          expect(typeof strategy).toBe('string');
          expect(strategy.length).toBeGreaterThan(0);
        });
      }
    });
  });

  describe('generated artifacts', () => {
    it('should generate view types, mappers, and migration scripts', async () => {
      const result = await canonicalizer.analyze();

      expect(result.generatedArtifacts.viewTypes).toBeDefined();
      expect(result.generatedArtifacts.mapperFunctions).toBeDefined();
      expect(result.generatedArtifacts.migrationScripts).toBeDefined();
      
      // View types should be valid TypeScript
      result.generatedArtifacts.viewTypes.forEach((vt: any) => {
        expect(vt.viewName).toBeDefined();
        expect(vt.definition).toContain('Pick<');
      });
      
      // Mapper functions should be valid TypeScript functions
      result.generatedArtifacts.mapperFunctions.forEach((mapper: string) => {
        expect(mapper).toContain('export function');
      });
      
      // Migration scripts should be valid bash scripts
      result.generatedArtifacts.migrationScripts.forEach((script: string) => {
        expect(script).toContain('#!/bin/bash');
      });
    });
  });

  describe('configuration options', () => {
    it('should respect minimal impact requirement', async () => {
      const conservativeCanonicalizer = new DTOCanonicalizer(mockStorage, {
        requireMinimalImpact: true
      });

      const result = await conservativeCanonicalizer.analyze();
      
      // Should have fewer or no recommendations with minimal impact requirement
      if (result.recommendations.length > 0) {
        result.recommendations.forEach(rec => {
          expect(['low', 'medium']).toContain(rec.estimatedImpact.riskAssessment.overallRisk);
        });
      }
    });

    it('should handle behavioral analysis toggle', async () => {
      const noBehavioralCanonicalizer = new DTOCanonicalizer(mockStorage, {
        includeBehavioralAnalysis: false
      });

      const result = await noBehavioralCanonicalizer.analyze();
      
      // Should still generate results without behavioral analysis
      expect(result).toBeDefined();
      expect(result.recommendations).toBeDefined();
    });

    it('should respect codemod generation setting', async () => {
      const noCodemodCanonicalizer = new DTOCanonicalizer(mockStorage, {
        generateCodemodActions: false
      });

      const result = await noCodemodCanonicalizer.analyze();
      
      if (result.recommendations.length > 0) {
        result.recommendations.forEach(rec => {
          rec.consolidationActions.forEach(action => {
            expect(action.codemodActions || []).toHaveLength(0);
          });
        });
      }
    });
  });

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      const errorStorage: StorageQueryInterface = {
        query: async () => {
          throw new Error('Database connection failed');
        }
      };

      const errorCanonicalizer = new DTOCanonicalizer(errorStorage);
      
      await expect(errorCanonicalizer.analyze()).rejects.toThrow();
    });

    it('should handle empty dataset', async () => {
      const emptyStorage: StorageQueryInterface = {
        query: async () => ({ rows: [] })
      };

      const emptyCanonicalizer = new DTOCanonicalizer(emptyStorage);
      const result = await emptyCanonicalizer.analyze();

      expect(result.recommendations).toHaveLength(0);
      expect(result.typeRelationships).toHaveLength(0);
      expect(result.consolidationOpportunities).toHaveLength(0);
      expect(result.qualityMetrics.duplicateReduction).toBe(0);
    });

    it('should handle malformed type definitions', async () => {
      const malformedStorage: StorageQueryInterface = {
        query: async () => ({
          rows: [
            { id: null, name: '', properties: null }
          ]
        })
      };

      const malformedCanonicalizer = new DTOCanonicalizer(malformedStorage);
      const result = await malformedCanonicalizer.analyze();

      // Should not crash and return sensible defaults
      expect(result).toBeDefined();
      expect(result.recommendations).toHaveLength(0);
    });
  });
});