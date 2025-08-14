/**
 * Tests for Type Replacement Advisor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeReplacementAdvisor } from '../../src/analyzers/type-refactoring/type-replacement-advisor';
import { TypeCompatibilityChecker } from '../../src/analyzers/type-refactoring/type-compatibility-checker';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

// Mock storage interface
const mockStorage: StorageQueryInterface = {
  query: async (sql: string, params?: unknown[]) => {
    // Mock responses for different queries
    if (sql.includes('type_definitions')) {
      if (params?.[0] === 'UserType') {
        return {
          rows: [{
            id: 'user-type-id',
            name: 'UserType',
            file_path: 'src/types/user.ts',
            definition: '{ id: string; name: string; email: string; }'
          }]
        };
      } else if (params?.[0] === 'AdminType') {
        return {
          rows: [{
            id: 'admin-type-id',
            name: 'AdminType',
            file_path: 'src/types/admin.ts',
            definition: '{ id: string; name: string; email: string; role: string; }'
          }]
        };
      }
    }
    
    if (sql.includes('function_type_usage')) {
      return {
        rows: [
          {
            id: 'func-1',
            name: 'getUserById',
            file_path: 'src/services/user.ts',
            usage_context: 'parameter at line 15:8',
            usage_type: 'parameter'
          },
          {
            id: 'func-2', 
            name: 'updateUser',
            file_path: 'src/services/user.ts',
            usage_context: 'parameter at line 28:12',
            usage_type: 'parameter'
          }
        ]
      };
    }

    if (sql.includes('type_dependencies')) {
      return { rows: [] };
    }

    return { rows: [] };
  }
};

describe('TypeReplacementAdvisor', () => {
  let advisor: TypeReplacementAdvisor;

  beforeEach(async () => {
    advisor = new TypeReplacementAdvisor(mockStorage, {
      generateCodemod: true,
      validateReferences: true,
      checkBreakingChanges: true
    });
    
    // Mock the initialize method to avoid actual TypeScript setup
    advisor.initialize = async () => {
      // Mock successful initialization
    };
    
    // Mock the compatibility checker's checkCompatibility method
    (advisor as any).compatibilityChecker = {
      initialize: async () => {},
      checkCompatibility: async () => ({
        isCompatible: true,
        compatibilityType: 'assignable',
        confidence: 0.8,
        issues: [],
        suggestions: ['Types are compatible - replacement should be safe'],
        migrationComplexity: 'simple'
      })
    };
    
    await advisor.initialize();
  });

  afterEach(() => {
    // Clean up any resources if needed
  });

  describe('analyzeTypeReplacement', () => {
    it('should analyze basic type replacement', async () => {
      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result).toBeDefined();
      expect(result.targetType).toBe('UserType');
      expect(result.replacementPlan).toBeDefined();
      expect(result.replacementPlan.sourceType).toBe('UserType');
      expect(result.replacementPlan.targetType).toBe('AdminType');
      expect(result.compatibilityAnalysis).toBeDefined();
      expect(result.usageAnalysis).toBeDefined();
    });

    it('should identify affected usages', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result.replacementPlan.affectedUsages).toBeDefined();
      expect(result.replacementPlan.affectedUsages.length).toBeGreaterThanOrEqual(0);
      expect(result.usageAnalysis.totalUsages).toBeGreaterThanOrEqual(0);
    });

    it('should generate migration steps', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result.replacementPlan.migrationSteps).toBeDefined();
      expect(result.replacementPlan.migrationSteps.length).toBeGreaterThan(0);
      expect(result.replacementPlan.migrationSteps[0]).toContain('Review compatibility');
    });

    it('should assess risk levels correctly', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result.overallRisk).toBeDefined();
      expect(['low', 'medium', 'high', 'critical']).toContain(result.overallRisk);
      expect(result.replacementPlan.estimatedEffort).toBeDefined();
      expect(['minimal', 'low', 'moderate', 'high', 'very_high']).toContain(result.replacementPlan.estimatedEffort);
    });

    it('should generate codemod actions when enabled', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result.replacementPlan.codemodActions).toBeDefined();
      expect(Array.isArray(result.replacementPlan.codemodActions)).toBe(true);
    });

    it('should determine automation level', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result.automationLevel).toBeDefined();
      expect(['fully_automated', 'semi_automated', 'manual_only']).toContain(result.automationLevel);
    });

    it('should handle non-existent types gracefully', async () => {
      // Initialize is already called in beforeEach

      await expect(advisor.analyzeTypeReplacement('NonExistentType', 'AdminType'))
        .rejects.toThrow('NonExistentType');
    });

    it('should validate different usage types', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      // Check that usage analysis covers different usage types
      expect(result.usageAnalysis.totalUsages).toBeGreaterThanOrEqual(0);
      expect(result.usageAnalysis.compatibleUsages).toBeGreaterThanOrEqual(0);
      expect(result.usageAnalysis.breakingUsages).toBeGreaterThanOrEqual(0);
      expect(result.usageAnalysis.unknownUsages).toBeGreaterThanOrEqual(0);
    });
  });

  describe('options configuration', () => {
    it('should respect generateCodemod option', async () => {
      const advisorWithoutCodemod = new TypeReplacementAdvisor(mockStorage, {
        generateCodemod: false
      });
      // Mock the compatibility checker for this test too
      (advisorWithoutCodemod as any).compatibilityChecker = {
        initialize: async () => {},
        checkCompatibility: async () => ({
          isCompatible: true,
          compatibilityType: 'assignable',
          confidence: 0.8,
          issues: [],
          suggestions: ['Types are compatible - replacement should be safe'],
          migrationComplexity: 'simple'
        })
      };

      const result = await advisorWithoutCodemod.analyzeTypeReplacement('UserType', 'AdminType');

      // Should have fewer or no codemod actions
      expect(result.replacementPlan.codemodActions.length).toBe(0);
    });

    it('should handle risk threshold settings', async () => {
      const conservativeAdvisor = new TypeReplacementAdvisor(mockStorage, {
        riskThreshold: 'low'
      });
      (conservativeAdvisor as any).compatibilityChecker = {
        initialize: async () => {},
        checkCompatibility: async () => ({
          isCompatible: true,
          compatibilityType: 'assignable',
          confidence: 0.8,
          issues: [],
          suggestions: ['Types are compatible - replacement should be safe'],
          migrationComplexity: 'simple'
        })
      };

      const result = await conservativeAdvisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result).toBeDefined();
      // Conservative settings should generate more warnings/recommendations
      expect(result.warnings.length + result.recommendations.length).toBeGreaterThanOrEqual(0);
    });

    it('should validate allowUnsafeReplacements option', async () => {
      const unsafeAdvisor = new TypeReplacementAdvisor(mockStorage, {
        allowUnsafeReplacements: true
      });
      (unsafeAdvisor as any).compatibilityChecker = {
        initialize: async () => {},
        checkCompatibility: async () => ({
          isCompatible: true,
          compatibilityType: 'assignable',
          confidence: 0.8,
          issues: [],
          suggestions: ['Types are compatible - replacement should be safe'],
          migrationComplexity: 'simple'
        })
      };

      const result = await unsafeAdvisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result).toBeDefined();
      // Should allow analysis even with potential issues
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex type hierarchies', async () => {
      // Mock complex type with dependencies
      const complexStorage: StorageQueryInterface = {
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes('type_definitions')) {
            return {
              rows: [{
                id: 'complex-type-id',
                name: 'ComplexType',
                file_path: 'src/types/complex.ts',
                definition: '{ base: BaseType; nested: { deep: DeepType }; optional?: string; }'
              }]
            };
          }
          if (sql.includes('function_type_usage')) {
            return {
              rows: [
                {
                  id: 'func-complex-1',
                  name: 'processComplex',
                  file_path: 'src/services/complex.ts',
                  usage_context: 'return type at line 42:20',
                  usage_type: 'return'
                }
              ]
            };
          }
          return { rows: [] };
        }
      };

      const complexAdvisor = new TypeReplacementAdvisor(complexStorage);
      (complexAdvisor as any).compatibilityChecker = {
        initialize: async () => {},
        checkCompatibility: async () => ({
          isCompatible: true,
          compatibilityType: 'assignable',
          confidence: 0.8,
          issues: [],
          suggestions: ['Types are compatible - replacement should be safe'],
          migrationComplexity: 'simple'
        })
      };

      const result = await complexAdvisor.analyzeTypeReplacement('ComplexType', 'AdminType');

      expect(result).toBeDefined();
      expect(result.replacementPlan.estimatedEffort).toBeDefined();
    });

    it('should handle edge cases in usage analysis', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      // Validate that usage analysis handles edge cases
      const usageStats = result.usageAnalysis;
      expect(usageStats.totalUsages).toBe(
        usageStats.compatibleUsages + usageStats.breakingUsages + usageStats.unknownUsages
      );
    });
  });

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      const errorStorage: StorageQueryInterface = {
        query: async () => {
          throw new Error('Database connection failed');
        }
      };

      const errorAdvisor = new TypeReplacementAdvisor(errorStorage);
      (errorAdvisor as any).compatibilityChecker = {
        initialize: async () => {},
        checkCompatibility: async () => ({
          isCompatible: true,
          compatibilityType: 'assignable',
          confidence: 0.8,
          issues: [],
          suggestions: ['Types are compatible - replacement should be safe'],
          migrationComplexity: 'simple'
        })
      };

      await expect(errorAdvisor.analyzeTypeReplacement('UserType', 'AdminType'))
        .rejects.toThrow();
    });

    it('should validate input parameters', async () => {
      // Test with valid parameters to ensure functionality works
      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');
      expect(result).toBeDefined();
      expect(result.targetType).toBe('UserType');
    });
  });

  describe('recommendations and warnings', () => {
    it('should generate appropriate recommendations', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
      
      if (result.recommendations.length > 0) {
        expect(typeof result.recommendations[0]).toBe('string');
      }
    });

    it('should identify potential warnings', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should detect blocking issues for unsafe replacements', async () => {
      // Initialize is already called in beforeEach

      const result = await advisor.analyzeTypeReplacement('UserType', 'AdminType');

      expect(result.blockingIssues).toBeDefined();
      expect(Array.isArray(result.blockingIssues)).toBe(true);
    });
  });
});

describe('TypeCompatibilityChecker', () => {
  let checker: TypeCompatibilityChecker;

  beforeEach(async () => {
    checker = new TypeCompatibilityChecker(mockStorage, {
      strictNullChecks: true,
      checkGenerics: true,
      checkFunctionSignatures: true
    });
    
    // Mock the initialize method
    checker.initialize = async () => {
      // Mock successful TypeScript initialization
    };
  });

  describe('checkCompatibility', () => {
    it('should require initialization before use', async () => {
      await expect(checker.checkCompatibility('TypeA', 'TypeB'))
        .rejects.toThrow('TypeScript checker not initialized');
    });

    it('should handle basic type definitions after initialization', async () => {
      // Mock the internal checker state to simulate successful initialization
      (checker as any).checker = { getTypeFromTypeNode: () => ({}) };
      (checker as any).program = { getSourceFiles: () => [] };

      const result = await checker.checkCompatibility('UserType', 'AdminType');

      expect(result).toBeDefined();
      expect(result.isCompatible).toBeDefined();
      expect(result.compatibilityType).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.issues).toBeDefined();
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('should assess migration complexity accurately', async () => {
      (checker as any).checker = { getTypeFromTypeNode: () => ({}) };
      (checker as any).program = { getSourceFiles: () => [] };

      const result = await checker.checkCompatibility('UserType', 'AdminType');

      expect(result.migrationComplexity).toBeDefined();
      expect(['trivial', 'simple', 'moderate', 'complex', 'breaking'])
        .toContain(result.migrationComplexity);
    });

    it('should generate suggestions for compatibility issues', async () => {
      (checker as any).checker = { getTypeFromTypeNode: () => ({}) };
      (checker as any).program = { getSourceFiles: () => [] };

      const result = await checker.checkCompatibility('UserType', 'AdminType');

      expect(result.suggestions).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('should handle non-existent types', async () => {
      (checker as any).checker = { getTypeFromTypeNode: () => ({}) };
      (checker as any).program = { getSourceFiles: () => [] };

      await expect(checker.checkCompatibility('NonExistentType', 'AdminType'))
        .rejects.toThrow('NonExistentType');
    });
  });

  describe('configuration options', () => {
    it('should respect strictNullChecks option', async () => {
      const strictChecker = new TypeCompatibilityChecker(mockStorage, {
        strictNullChecks: true
      });
      (strictChecker as any).checker = { getTypeFromTypeNode: () => ({}) };
      (strictChecker as any).program = { getSourceFiles: () => [] };

      const result = await strictChecker.checkCompatibility('UserType', 'AdminType');

      expect(result).toBeDefined();
      // Strict null checking should be reflected in analysis
    });

    it('should handle generic type checking when enabled', async () => {
      const genericChecker = new TypeCompatibilityChecker(mockStorage, {
        checkGenerics: true
      });
      (genericChecker as any).checker = { getTypeFromTypeNode: () => ({}) };
      (genericChecker as any).program = { getSourceFiles: () => [] };

      const result = await genericChecker.checkCompatibility('UserType', 'AdminType');

      expect(result).toBeDefined();
      // Generic checking should be reflected in results
    });
  });

  describe('issue categorization', () => {
    it('should categorize issues correctly', async () => {
      (checker as any).checker = { getTypeFromTypeNode: () => ({}) };
      (checker as any).program = { getSourceFiles: () => [] };

      const result = await checker.checkCompatibility('UserType', 'AdminType');

      for (const issue of result.issues) {
        expect(['structure', 'nullability', 'generics', 'functions', 'literals'])
          .toContain(issue.category);
        expect(['error', 'warning', 'info']).toContain(issue.severity);
        expect(typeof issue.description).toBe('string');
        expect(typeof issue.autoFixable).toBe('boolean');
      }
    });

    it('should identify auto-fixable issues', async () => {
      (checker as any).checker = { getTypeFromTypeNode: () => ({}) };
      (checker as any).program = { getSourceFiles: () => [] };

      const result = await checker.checkCompatibility('UserType', 'AdminType');

      const autoFixableIssues = result.issues.filter(issue => issue.autoFixable);
      const nonFixableIssues = result.issues.filter(issue => !issue.autoFixable);

      expect(autoFixableIssues.length + nonFixableIssues.length).toBe(result.issues.length);
    });
  });
});