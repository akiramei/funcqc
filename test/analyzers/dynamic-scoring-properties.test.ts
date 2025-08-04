import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TypeAwareDeletionSafety } from '../../src/analyzers/type-aware-deletion-safety';
import { FunctionInfo } from '../../src/types';
import { MethodOverride } from '../../src/types/type-system';
import { Logger } from '../../src/utils/cli-utils';

/**
 * P1 Priority Tests: Dynamic Scoring Properties
 * 
 * Tests the mathematical properties of the dynamic scoring system:
 * 1. Monotonicity: More evidence → Higher scores (within same category)
 * 2. Boundary Stability: Score caps are respected
 * 3. Category Separation: Clear separation between protection levels
 * 4. Score Distribution: Proper score ranges for different scenarios
 * 
 * These tests ensure the scoring system behaves predictably and maintains
 * its mathematical invariants as the system evolves.
 */
describe('Dynamic Scoring Properties', () => {
  let analyzer: TypeAwareDeletionSafety;
  let mockStorage: any;

  beforeEach(() => {
    analyzer = new TypeAwareDeletionSafety(new Logger(false, false));
    
    mockStorage = {
      getTypeMembers: vi.fn(),
      getMethodOverridesByFunction: vi.fn(),
      getImplementingClasses: vi.fn()
    };
    
    analyzer.setStorage(mockStorage);
  });

  describe('Monotonicity Properties', () => {
    describe('Abstract Implementation Monotonicity', () => {
      test('should increase score with more abstract implementations', async () => {
        const functionInfo: Partial<FunctionInfo> = {
          id: 'monotonic-abstract-test',
          name: 'testMethod',
          signature: '() => void',
          parameters: []
        };

        // Test with 1, 2, 3, 4, 5 abstract implementations
        const results: number[] = [];
        
        for (let count = 1; count <= 5; count++) {
          const overrides: MethodOverride[] = [];
          
          for (let i = 0; i < count; i++) {
            overrides.push({
              id: `abstract-override-${i}`,
              snapshotId: 'snap-1',
              methodMemberId: `member-${i}`,
              sourceTypeId: 'concrete-class',
              targetMemberId: `abstract-member-${i}`,
              targetTypeId: `abstract-class-${i}`,
              overrideKind: 'abstract_implement',
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.95,
              metadata: { chaAbstractImplementation: true }
            });
          }

          mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
          
          const result = await analyzer.analyzeDeletionSafety(
            functionInfo as FunctionInfo,
            'snap-1'
          );
          
          results.push(result.confidenceScore);
        }

        // Verify monotonicity: score[i] <= score[i+1] for all i
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i]).toBeLessThanOrEqual(results[i + 1]);
        }

        // Verify base score is maintained (should be >= 0.80)
        expect(results[0]).toBeGreaterThanOrEqual(0.80);
        
        // Verify cap is respected (should be <= 0.95)
        expect(Math.max(...results)).toBeLessThanOrEqual(0.95);
        
        // Verify meaningful progression (not all the same)
        expect(results[results.length - 1]).toBeGreaterThan(results[0]);
      });

      test('should increase score with higher signature compatibility', async () => {
        const functionInfo: Partial<FunctionInfo> = {
          id: 'signature-compat-test',
          name: 'testMethod',
          signature: '() => void',
          parameters: []
        };

        const baseOverride: MethodOverride = {
          id: 'abstract-override-1',
          snapshotId: 'snap-1',
          methodMemberId: 'member-1',
          sourceTypeId: 'concrete-class',
          targetMemberId: 'abstract-member-1',
          targetTypeId: 'abstract-class-1',
          overrideKind: 'abstract_implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: { chaAbstractImplementation: true }
        };

        mockStorage.getMethodOverridesByFunction.mockResolvedValue([baseOverride]);

        // Test with different compatibility scores: 0.5, 0.7, 0.9, 1.0
        const compatibilityScores = [0.5, 0.7, 0.9, 1.0];
        const results: number[] = [];

        for (const compatScore of compatibilityScores) {
          // Create interface info with varying compatibility scores
          const mockAnalyzeInterfaceImplementations = vi.spyOn(analyzer as any, 'analyzeInterfaceImplementations');
          mockAnalyzeInterfaceImplementations.mockResolvedValue({
            isImplementation: false,
            interfaces: [],
            implementingClasses: [],
            compatibilityScore: compatScore,
            signatureCompatibility: {
              isCompatible: compatScore >= 0.7,
              compatibilityScore: compatScore,
              issues: compatScore < 0.7 ? ['Some compatibility issue'] : [],
              parameterCount: 1,
              returnTypeMatch: true,
              parameterTypesMatch: true
            }
          });

          const result = await analyzer.analyzeDeletionSafety(
            functionInfo as FunctionInfo,
            'snap-1'
          );
          
          results.push(result.confidenceScore);
          
          mockAnalyzeInterfaceImplementations.mockRestore();
        }

        // Verify monotonicity with signature compatibility
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i]).toBeLessThanOrEqual(results[i + 1]);
        }

        // Verify meaningful progression
        expect(results[results.length - 1]).toBeGreaterThan(results[0]);
      });
    });

    describe('Interface Implementation Monotonicity', () => {
      test('should increase score with more implementing classes', async () => {
        const functionInfo: Partial<FunctionInfo> = {
          id: 'interface-monotonic-test',
          name: 'testMethod',
          signature: '() => void',
          parameters: []
        };

        const interfaceOverride: MethodOverride = {
          id: 'interface-override-1',
          snapshotId: 'snap-1',
          methodMemberId: 'member-1',
          sourceTypeId: 'implementing-class',
          targetMemberId: 'interface-member-1',
          targetTypeId: 'interface-1',
          overrideKind: 'implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: {}
        };

        mockStorage.getMethodOverridesByFunction.mockResolvedValue([interfaceOverride]);

        // Test with 1, 3, 5, 10 implementing classes
        const classCountCases = [1, 3, 5, 10];
        const results: number[] = [];

        for (const classCount of classCountCases) {
          const implementingClasses = Array.from({ length: classCount }, (_, i) => ({ name: `Class${i}` }));
          mockStorage.getImplementingClasses.mockResolvedValue(implementingClasses);

          const result = await analyzer.analyzeDeletionSafety(
            functionInfo as FunctionInfo,
            'snap-1'
          );
          
          results.push(result.confidenceScore);
        }

        // Verify monotonicity
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i]).toBeLessThanOrEqual(results[i + 1]);
        }

        // Verify base score (should be >= 0.80)
        expect(results[0]).toBeGreaterThanOrEqual(0.80);
        
        // Verify cap (should be <= 0.98)
        expect(Math.max(...results)).toBeLessThanOrEqual(0.98);
      });

      test('should increase score with more interfaces implemented', async () => {
        const functionInfo: Partial<FunctionInfo> = {
          id: 'multi-interface-test',
          name: 'testMethod',
          signature: '() => void',
          parameters: []
        };

        // Test with 1, 2, 3, 4 interfaces
        const interfaceCounts = [1, 2, 3, 4];
        const results: number[] = [];

        for (const interfaceCount of interfaceCounts) {
          const overrides: MethodOverride[] = [];
          
          for (let i = 0; i < interfaceCount; i++) {
            overrides.push({
              id: `interface-override-${i}`,
              snapshotId: 'snap-1',
              methodMemberId: `member-${i}`,
              sourceTypeId: 'implementing-class',
              targetMemberId: `interface-member-${i}`,
              targetTypeId: `interface-${i}`,
              overrideKind: 'implement',
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.95,
              metadata: {}
            });
          }

          mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
          mockStorage.getImplementingClasses.mockResolvedValue([{ name: 'SomeClass' }]);

          const result = await analyzer.analyzeDeletionSafety(
            functionInfo as FunctionInfo,
            'snap-1'
          );
          
          results.push(result.confidenceScore);
        }

        // Verify monotonicity
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i]).toBeLessThanOrEqual(results[i + 1]);
        }

        // Verify meaningful progression
        expect(results[results.length - 1]).toBeGreaterThan(results[0]);
      });
    });

    describe('Method Override Monotonicity', () => {
      test('should increase score with more method overrides', async () => {
        const functionInfo: Partial<FunctionInfo> = {
          id: 'override-monotonic-test',
          name: 'testMethod',
          signature: '() => void',
          parameters: []
        };

        // Test with 1, 2, 3, 5 method overrides
        const overrideCounts = [1, 2, 3, 5];
        const results: number[] = [];

        for (const overrideCount of overrideCounts) {
          const overrides: MethodOverride[] = [];
          
          for (let i = 0; i < overrideCount; i++) {
            overrides.push({
              id: `method-override-${i}`,
              snapshotId: 'snap-1',
              methodMemberId: `member-${i}`,
              sourceTypeId: 'derived-class',
              targetMemberId: `parent-member-${i}`,
              targetTypeId: `parent-class-${i}`,
              overrideKind: 'override',
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.9,
              metadata: {}
            });
          }

          mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);

          const result = await analyzer.analyzeDeletionSafety(
            functionInfo as FunctionInfo,
            'snap-1'
          );
          
          results.push(result.confidenceScore);
        }

        // Verify monotonicity
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i]).toBeLessThanOrEqual(results[i + 1]);
        }

        // Verify base score (should be >= 0.70)
        expect(results[0]).toBeGreaterThanOrEqual(0.70);
        
        // Verify cap (should be <= 0.90)
        expect(Math.max(...results)).toBeLessThanOrEqual(0.90);
      });
    });
  });

  describe('Boundary Stability Properties', () => {
    test('should respect abstract implementation score cap of 0.95', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'abstract-cap-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Create scenario designed to exceed cap: many abstract implementations + perfect compatibility
      const overrides: MethodOverride[] = [];
      for (let i = 0; i < 20; i++) { // Excessive count to test cap
        overrides.push({
          id: `abstract-override-${i}`,
          snapshotId: 'snap-1',
          methodMemberId: `member-${i}`,
          sourceTypeId: 'concrete-class',
          targetMemberId: `abstract-member-${i}`,
          targetTypeId: `abstract-class-${i}`,
          overrideKind: 'abstract_implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: { chaAbstractImplementation: true }
        });
      }

      mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);

      // Mock perfect signature compatibility
      const mockAnalyzeInterfaceImplementations = vi.spyOn(analyzer as any, 'analyzeInterfaceImplementations');
      mockAnalyzeInterfaceImplementations.mockResolvedValue({
        isImplementation: false,
        interfaces: [],
        implementingClasses: [],
        compatibilityScore: 1.0, // Perfect compatibility
        signatureCompatibility: {
          isCompatible: true,
          compatibilityScore: 1.0,
          issues: [],
          parameterCount: 1,
          returnTypeMatch: true,
          parameterTypesMatch: true
        }
      });

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should respect cap of 0.95
      expect(result.confidenceScore).toBeLessThanOrEqual(0.95);
      expect(result.confidenceScore).toBeGreaterThan(0.90); // Should be high but capped

      mockAnalyzeInterfaceImplementations.mockRestore();
    });

    test('should respect interface implementation score cap of 0.98', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'interface-cap-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Create scenario designed to exceed cap: many interfaces + many classes + perfect compatibility
      const overrides: MethodOverride[] = [];
      for (let i = 0; i < 15; i++) { // Excessive count to test cap
        overrides.push({
          id: `interface-override-${i}`,
          snapshotId: 'snap-1',
          methodMemberId: `member-${i}`,
          sourceTypeId: 'implementing-class',
          targetMemberId: `interface-member-${i}`,
          targetTypeId: `interface-${i}`,
          overrideKind: 'implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: {}
        });
      }

      mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
      
      // Mock many implementing classes
      const manyClasses = Array.from({ length: 50 }, (_, i) => ({ name: `Class${i}` }));
      mockStorage.getImplementingClasses.mockResolvedValue(manyClasses);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should respect cap of 0.98
      expect(result.confidenceScore).toBeLessThanOrEqual(0.98);
      expect(result.confidenceScore).toBeGreaterThan(0.95); // Should be very high but capped
    });

    test('should respect method override score cap of 0.90', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'override-cap-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Create scenario designed to exceed cap: many method overrides
      const overrides: MethodOverride[] = [];
      for (let i = 0; i < 25; i++) { // Excessive count to test cap
        overrides.push({
          id: `method-override-${i}`,
          snapshotId: 'snap-1',
          methodMemberId: `member-${i}`,
          sourceTypeId: 'derived-class',
          targetMemberId: `parent-member-${i}`,
          targetTypeId: `parent-class-${i}`,
          overrideKind: 'override',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.9,
          metadata: {}
        });
      }

      mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should respect cap of 0.90
      expect(result.confidenceScore).toBeLessThanOrEqual(0.90);
      expect(result.confidenceScore).toBeGreaterThan(0.80); // Should be high but capped
    });

    test('should maintain minimum base scores', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'base-score-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Test minimum scenarios for each category
      const testCases = [
        {
          name: 'abstract implementation',
          overrides: [{
            id: 'min-abstract-override',
            snapshotId: 'snap-1',
            methodMemberId: 'member-1',
            sourceTypeId: 'concrete-class',
            targetMemberId: 'abstract-member-1',
            targetTypeId: 'abstract-class-1',
            overrideKind: 'abstract_implement' as const,
            isCompatible: true,
            compatibilityErrors: [],
            confidenceScore: 0.95,
            metadata: { chaAbstractImplementation: true }
          }],
          expectedMinScore: 0.80
        },
        {
          name: 'interface implementation',
          overrides: [{
            id: 'min-interface-override',
            snapshotId: 'snap-1',
            methodMemberId: 'member-1',
            sourceTypeId: 'implementing-class',
            targetMemberId: 'interface-member-1',
            targetTypeId: 'interface-1',
            overrideKind: 'implement' as const,
            isCompatible: true,
            compatibilityErrors: [],
            confidenceScore: 0.95,
            metadata: {}
          }],
          expectedMinScore: 0.80
        },
        {
          name: 'method override',
          overrides: [{
            id: 'min-method-override',
            snapshotId: 'snap-1',
            methodMemberId: 'member-1',
            sourceTypeId: 'derived-class',
            targetMemberId: 'parent-member-1',
            targetTypeId: 'parent-class-1',
            overrideKind: 'override' as const,
            isCompatible: true,
            compatibilityErrors: [],
            confidenceScore: 0.9,
            metadata: {}
          }],
          expectedMinScore: 0.70
        }
      ];

      for (const testCase of testCases) {
        mockStorage.getMethodOverridesByFunction.mockResolvedValue(testCase.overrides);
        mockStorage.getImplementingClasses.mockResolvedValue([]);

        const result = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        expect(result.confidenceScore).toBeGreaterThanOrEqual(testCase.expectedMinScore);
      }
    });
  });

  describe('Category Separation Properties', () => {
    test('should maintain clear separation between protection levels', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'separation-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Test minimal cases for each category to verify separation
      const categories = [
        {
          name: 'abstract implementation',
          overrides: [{
            id: 'abstract-sep-test',
            snapshotId: 'snap-1',
            methodMemberId: 'member-1',
            sourceTypeId: 'concrete-class',
            targetMemberId: 'abstract-member-1',
            targetTypeId: 'abstract-class-1',
            overrideKind: 'abstract_implement' as const,
            isCompatible: true,
            compatibilityErrors: [],
            confidenceScore: 0.95,
            metadata: { chaAbstractImplementation: true }
          }]
        },
        {
          name: 'interface implementation',
          overrides: [{
            id: 'interface-sep-test',
            snapshotId: 'snap-1',
            methodMemberId: 'member-1',
            sourceTypeId: 'implementing-class',
            targetMemberId: 'interface-member-1',
            targetTypeId: 'interface-1',
            overrideKind: 'implement' as const,
            isCompatible: true,
            compatibilityErrors: [],
            confidenceScore: 0.95,
            metadata: {}
          }]
        },
        {
          name: 'method override',
          overrides: [{
            id: 'override-sep-test',
            snapshotId: 'snap-1',
            methodMemberId: 'member-1',
            sourceTypeId: 'derived-class',
            targetMemberId: 'parent-member-1',
            targetTypeId: 'parent-class-1',
            overrideKind: 'override' as const,
            isCompatible: true,
            compatibilityErrors: [],
            confidenceScore: 0.9,
            metadata: {}
          }]
        }
      ];

      const results: { name: string; score: number }[] = [];

      for (const category of categories) {
        mockStorage.getMethodOverridesByFunction.mockResolvedValue(category.overrides);
        mockStorage.getImplementingClasses.mockResolvedValue([]);

        const result = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        results.push({ name: category.name, score: result.confidenceScore });
      }

      // Verify expected ordering: abstract >= interface >= override
      const abstractScore = results.find(r => r.name === 'abstract implementation')?.score || 0;
      const interfaceScore = results.find(r => r.name === 'interface implementation')?.score || 0;
      const overrideScore = results.find(r => r.name === 'method override')?.score || 0;

      // Note: Abstract and interface have same base score (0.80), so they may be equal in minimal cases
      expect(abstractScore).toBeGreaterThanOrEqual(interfaceScore);
      expect(interfaceScore).toBeGreaterThan(overrideScore);
      
      // Verify meaningful separation (at least 0.1 between override and interface)
      expect(interfaceScore - overrideScore).toBeGreaterThanOrEqual(0.1);
    });

    test('should handle priority correctly when multiple types are present', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'priority-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Mix all types: abstract implementation should take precedence
      const mixedOverrides: MethodOverride[] = [
        {
          id: 'mixed-override-1',
          snapshotId: 'snap-1',
          methodMemberId: 'member-1',
          sourceTypeId: 'complex-class',
          targetMemberId: 'parent-member-1',
          targetTypeId: 'parent-class-1',
          overrideKind: 'override',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.9,
          metadata: {}
        },
        {
          id: 'mixed-override-2',
          snapshotId: 'snap-1',
          methodMemberId: 'member-2',
          sourceTypeId: 'complex-class',
          targetMemberId: 'interface-member-1',
          targetTypeId: 'interface-1',
          overrideKind: 'implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: {}
        },
        {
          id: 'mixed-override-3',
          snapshotId: 'snap-1',
          methodMemberId: 'member-3',
          sourceTypeId: 'complex-class',
          targetMemberId: 'abstract-member-1',
          targetTypeId: 'abstract-class-1',
          overrideKind: 'abstract_implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: { chaAbstractImplementation: true }
        }
      ];

      mockStorage.getMethodOverridesByFunction.mockResolvedValue(mixedOverrides);
      mockStorage.getImplementingClasses.mockResolvedValue([]);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should prioritize abstract implementation (highest priority)
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80); // Abstract base score
      expect(result.protectionReason).toContain('abstract base method');
      expect(result.evidenceStrength.abstractImplementationCount).toBe(1);
      expect(result.evidenceStrength.interfaceCount).toBe(1);
      expect(result.evidenceStrength.overrideCount).toBe(1);
    });
  });

  describe('Score Distribution Properties', () => {
    test('should provide meaningful score ranges for different scenarios', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'distribution-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Test various scenarios and verify score distribution
      const scenarios = [
        {
          name: 'minimal abstract implementation',
          setup: () => {
            const overrides = [{
              id: 'minimal-abstract',
              snapshotId: 'snap-1',
              methodMemberId: 'member-1',
              sourceTypeId: 'concrete-class',
              targetMemberId: 'abstract-member-1',
              targetTypeId: 'abstract-class-1',
              overrideKind: 'abstract_implement' as const,
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.95,
              metadata: { chaAbstractImplementation: true }
            }];
            mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
            mockStorage.getImplementingClasses.mockResolvedValue([]);
          },
          expectedRange: { min: 0.80, max: 0.85 }
        },
        {
          name: 'rich abstract implementation',
          setup: () => {
            const overrides = Array.from({ length: 3 }, (_, i) => ({
              id: `rich-abstract-${i}`,
              snapshotId: 'snap-1',
              methodMemberId: `member-${i}`,
              sourceTypeId: 'concrete-class',
              targetMemberId: `abstract-member-${i}`,
              targetTypeId: `abstract-class-${i}`,
              overrideKind: 'abstract_implement' as const,
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.95,
              metadata: { chaAbstractImplementation: true }
            }));
            mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
            mockStorage.getImplementingClasses.mockResolvedValue([]);
          },
          expectedRange: { min: 0.85, max: 0.95 }
        },
        {
          name: 'minimal interface implementation',
          setup: () => {
            const overrides = [{
              id: 'minimal-interface',
              snapshotId: 'snap-1',
              methodMemberId: 'member-1',
              sourceTypeId: 'implementing-class',
              targetMemberId: 'interface-member-1',
              targetTypeId: 'interface-1',
              overrideKind: 'implement' as const,
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.95,
              metadata: {}
            }];
            mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
            mockStorage.getImplementingClasses.mockResolvedValue([{ name: 'SingleClass' }]);
          },
          expectedRange: { min: 0.80, max: 0.85 }
        },
        {
          name: 'rich interface implementation',
          setup: () => {
            const overrides = Array.from({ length: 3 }, (_, i) => ({
              id: `rich-interface-${i}`,
              snapshotId: 'snap-1',
              methodMemberId: `member-${i}`,
              sourceTypeId: 'implementing-class',
              targetMemberId: `interface-member-${i}`,
              targetTypeId: `interface-${i}`,
              overrideKind: 'implement' as const,
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.95,
              metadata: {}
            }));
            mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
            const manyClasses = Array.from({ length: 5 }, (_, i) => ({ name: `Class${i}` }));
            mockStorage.getImplementingClasses.mockResolvedValue(manyClasses);
          },
          expectedRange: { min: 0.90, max: 0.98 }
        },
        {
          name: 'minimal method override',
          setup: () => {
            const overrides = [{
              id: 'minimal-override',
              snapshotId: 'snap-1',
              methodMemberId: 'member-1',
              sourceTypeId: 'derived-class',
              targetMemberId: 'parent-member-1',
              targetTypeId: 'parent-class-1',
              overrideKind: 'override' as const,
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.9,
              metadata: {}
            }];
            mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
            mockStorage.getImplementingClasses.mockResolvedValue([]);
          },
          expectedRange: { min: 0.70, max: 0.75 }
        },
        {
          name: 'rich method override',
          setup: () => {
            const overrides = Array.from({ length: 4 }, (_, i) => ({
              id: `rich-override-${i}`,
              snapshotId: 'snap-1',
              methodMemberId: `member-${i}`,
              sourceTypeId: 'derived-class',
              targetMemberId: `parent-member-${i}`,
              targetTypeId: `parent-class-${i}`,
              overrideKind: 'override' as const,
              isCompatible: true,
              compatibilityErrors: [],
              confidenceScore: 0.9,
              metadata: {}
            }));
            mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
            mockStorage.getImplementingClasses.mockResolvedValue([]);
          },
          expectedRange: { min: 0.80, max: 0.90 }
        }
      ];

      for (const scenario of scenarios) {
        scenario.setup();

        const result = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        expect(result.confidenceScore).toBeGreaterThanOrEqual(scenario.expectedRange.min);
        expect(result.confidenceScore).toBeLessThanOrEqual(scenario.expectedRange.max);
      }
    });

    test('should handle edge cases with graceful degradation', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'edge-case-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Test edge case: very low signature compatibility
      const lowCompatOverride: MethodOverride = {
        id: 'low-compat-override',
        snapshotId: 'snap-1',
        methodMemberId: 'member-1',
        sourceTypeId: 'concrete-class',
        targetMemberId: 'abstract-member-1',
        targetTypeId: 'abstract-class-1',
        overrideKind: 'abstract_implement',
        isCompatible: false, // Incompatible
        compatibilityErrors: ['Major signature mismatch'],
        confidenceScore: 0.3, // Very low
        metadata: { chaAbstractImplementation: true }
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([lowCompatOverride]);

      // Mock very low signature compatibility
      const mockAnalyzeInterfaceImplementations = vi.spyOn(analyzer as any, 'analyzeInterfaceImplementations');
      mockAnalyzeInterfaceImplementations.mockResolvedValue({
        isImplementation: false,
        interfaces: [],
        implementingClasses: [],
        compatibilityScore: 0.3, // Very low compatibility
        signatureCompatibility: {
          isCompatible: false,
          compatibilityScore: 0.3,
          issues: ['Major signature mismatch'],
          parameterCount: 1,
          returnTypeMatch: false,
          parameterTypesMatch: false
        }
      });

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should still protect (abstract implementation is critical) but with lower score
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.70); // Above default threshold
      expect(result.confidenceScore).toBeLessThan(0.85); // But lower due to compatibility issues

      mockAnalyzeInterfaceImplementations.mockRestore();
    });
  });

  describe('Mathematical Invariants', () => {
    test('should maintain score consistency across similar inputs', async () => {
      const functionInfo1: Partial<FunctionInfo> = {
        id: 'consistency-test-1',
        name: 'testMethod1',
        signature: '() => void',
        parameters: []
      };

      const functionInfo2: Partial<FunctionInfo> = {
        id: 'consistency-test-2',
        name: 'testMethod2',
        signature: '() => void',
        parameters: []
      };

      // Identical override configurations
      const identicalOverrides = [{
        id: 'consistent-override',
        snapshotId: 'snap-1',
        methodMemberId: 'member-1',
        sourceTypeId: 'concrete-class',
        targetMemberId: 'abstract-member-1',
        targetTypeId: 'abstract-class-1',
        overrideKind: 'abstract_implement' as const,
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.95,
        metadata: { chaAbstractImplementation: true }
      }];

      // Test both functions with identical setups
      mockStorage.getMethodOverridesByFunction.mockResolvedValue(identicalOverrides);
      mockStorage.getImplementingClasses.mockResolvedValue([]);

      const result1 = await analyzer.analyzeDeletionSafety(
        functionInfo1 as FunctionInfo,
        'snap-1'
      );

      const result2 = await analyzer.analyzeDeletionSafety(
        functionInfo2 as FunctionInfo,
        'snap-1'
      );

      // Should produce identical scores for identical configurations
      expect(result1.confidenceScore).toBe(result2.confidenceScore);
      expect(result1.protectionReason).toBe(result2.protectionReason);
    });

    test('should maintain transitivity in score ordering', async () => {
      // If A > B and B > C, then A > C
      const functionInfo: Partial<FunctionInfo> = {
        id: 'transitivity-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Three scenarios with increasing evidence strength
      const scenarios = [
        { name: 'A', abstractCount: 1, interfaceCount: 0, overrideCount: 0 },
        { name: 'B', abstractCount: 2, interfaceCount: 0, overrideCount: 0 },
        { name: 'C', abstractCount: 3, interfaceCount: 0, overrideCount: 0 }
      ];

      const results: { name: string; score: number }[] = [];

      for (const scenario of scenarios) {
        const overrides: MethodOverride[] = [];
        
        for (let i = 0; i < scenario.abstractCount; i++) {
          overrides.push({
            id: `trans-abstract-${i}`,
            snapshotId: 'snap-1',
            methodMemberId: `member-${i}`,
            sourceTypeId: 'concrete-class',
            targetMemberId: `abstract-member-${i}`,
            targetTypeId: `abstract-class-${i}`,
            overrideKind: 'abstract_implement',
            isCompatible: true,
            compatibilityErrors: [],
            confidenceScore: 0.95,
            metadata: { chaAbstractImplementation: true }
          });
        }

        mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
        mockStorage.getImplementingClasses.mockResolvedValue([]);

        const result = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        results.push({ name: scenario.name, score: result.confidenceScore });
      }

      // Verify transitivity: A <= B <= C
      const scoreA = results.find(r => r.name === 'A')?.score || 0;
      const scoreB = results.find(r => r.name === 'B')?.score || 0;
      const scoreC = results.find(r => r.name === 'C')?.score || 0;

      expect(scoreA).toBeLessThanOrEqual(scoreB);
      expect(scoreB).toBeLessThanOrEqual(scoreC);
    });
  });
});