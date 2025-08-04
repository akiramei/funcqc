import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TypeAwareDeletionSafety } from '../../src/analyzers/type-aware-deletion-safety';
import { FunctionInfo } from '../../src/types';
import { MethodOverride } from '../../src/types/type-system';
import { Logger } from '../../src/utils/cli-utils';

/**
 * P1 Priority Tests: Threshold Behavior Analysis
 * 
 * Tests the behavior of the dynamic scoring system around critical thresholds:
 * 1. Default threshold (0.7) behavior
 * 2. Threshold sensitivity analysis
 * 3. Score clustering around thresholds
 * 4. Threshold crossing behavior
 * 
 * These tests ensure that the scoring system provides meaningful
 * differentiation around decision boundaries.
 */
describe('Threshold Behavior Analysis', () => {
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

  describe('Default Threshold (0.7) Behavior', () => {
    test('should protect all abstract implementations above default threshold', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'threshold-abstract-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Test various abstract implementation scenarios
      const scenarios = [
        { name: 'single abstract', count: 1 },
        { name: 'double abstract', count: 2 },
        { name: 'triple abstract', count: 3 }
      ];

      for (const scenario of scenarios) {
        const overrides: MethodOverride[] = [];
        
        for (let i = 0; i < scenario.count; i++) {
          overrides.push({
            id: `abstract-threshold-${i}`,
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

        const shouldProtect = await analyzer.shouldProtectFromDeletion(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        expect(shouldProtect).toBe(true);
        
        const safetyInfo = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );
        
        expect(safetyInfo.confidenceScore).toBeGreaterThanOrEqual(0.70);
      }
    });

    test('should protect all interface implementations above default threshold', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'threshold-interface-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Test various interface implementation scenarios
      const scenarios = [
        { name: 'single interface', interfaceCount: 1, classCount: 1 },
        { name: 'multiple interfaces', interfaceCount: 3, classCount: 1 },
        { name: 'single interface, multiple classes', interfaceCount: 1, classCount: 5 },
        { name: 'multiple interfaces, multiple classes', interfaceCount: 2, classCount: 3 }
      ];

      for (const scenario of scenarios) {
        const overrides: MethodOverride[] = [];
        
        for (let i = 0; i < scenario.interfaceCount; i++) {
          overrides.push({
            id: `interface-threshold-${i}`,
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

        const implementingClasses = Array.from({ length: scenario.classCount }, (_, i) => ({ name: `Class${i}` }));
        
        mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
        mockStorage.getImplementingClasses.mockResolvedValue(implementingClasses);

        const shouldProtect = await analyzer.shouldProtectFromDeletion(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        expect(shouldProtect).toBe(true);
        
        const safetyInfo = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );
        
        expect(safetyInfo.confidenceScore).toBeGreaterThanOrEqual(0.70);
      }
    });

    test('should protect minimal method overrides above default threshold', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'threshold-override-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      const override: MethodOverride = {
        id: 'override-threshold-1',
        snapshotId: 'snap-1',
        methodMemberId: 'member-1',
        sourceTypeId: 'derived-class',
        targetMemberId: 'parent-member-1',
        targetTypeId: 'parent-class-1',
        overrideKind: 'override',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.9,
        metadata: {}
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([override]);
      mockStorage.getImplementingClasses.mockResolvedValue([]);

      const shouldProtect = await analyzer.shouldProtectFromDeletion(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      expect(shouldProtect).toBe(true);
      
      const safetyInfo = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );
      
      // Method override base score is 0.70, exactly at threshold
      expect(safetyInfo.confidenceScore).toBeGreaterThanOrEqual(0.70);
    });

    test('should not protect functions with no type-based evidence', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'no-protection-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // No overrides = no protection
      mockStorage.getMethodOverridesByFunction.mockResolvedValue([]);
      mockStorage.getImplementingClasses.mockResolvedValue([]);

      const shouldProtect = await analyzer.shouldProtectFromDeletion(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      expect(shouldProtect).toBe(false);
      
      const safetyInfo = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );
      
      expect(safetyInfo.confidenceScore).toBe(0.0);
    });
  });

  describe('Threshold Sensitivity Analysis', () => {
    test('should respect custom thresholds in shouldProtectFromDeletion', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'custom-threshold-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Create a method override that scores around 0.75
      const override: MethodOverride = {
        id: 'custom-threshold-override',
        snapshotId: 'snap-1',
        methodMemberId: 'member-1',
        sourceTypeId: 'derived-class',
        targetMemberId: 'parent-member-1',
        targetTypeId: 'parent-class-1',
        overrideKind: 'override',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.9,
        metadata: {}
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([override]);

      // Test various thresholds
      const thresholds = [0.6, 0.7, 0.75, 0.8, 0.85];
      
      for (const threshold of thresholds) {
        const shouldProtect = await analyzer.shouldProtectFromDeletion(
          functionInfo as FunctionInfo,
          'snap-1',
          threshold
        );

        const safetyInfo = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        if (safetyInfo.confidenceScore >= threshold) {
          expect(shouldProtect).toBe(true);
        } else {
          expect(shouldProtect).toBe(false);
        }
      }
    });

    test('should provide consistent protection decisions around threshold boundaries', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'boundary-consistency-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Create scenarios that score just above and below common thresholds
      const scenarios = [
        {
          name: 'just above 0.7',
          overrideCount: 1, // Should score exactly 0.70
          expectedProtected: true
        },
        {
          name: 'well above 0.7',  
          overrideCount: 2, // Should score ~0.735
          expectedProtected: true
        }
      ];

      for (const scenario of scenarios) {
        const overrides: MethodOverride[] = [];
        
        for (let i = 0; i < scenario.overrideCount; i++) {
          overrides.push({
            id: `boundary-override-${i}`,
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

        const shouldProtect = await analyzer.shouldProtectFromDeletion(
          functionInfo as FunctionInfo,
          'snap-1',
          0.7 // Default threshold
        );

        expect(shouldProtect).toBe(scenario.expectedProtected);
      }
    });
  });

  describe('Score Clustering Analysis', () => {
    test('should avoid score clustering around thresholds', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'clustering-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Test various scenarios to check for score distribution
      const scenarios = [
        { type: 'abstract', count: 1, expectedRange: { min: 0.80, max: 0.85 } },
        { type: 'abstract', count: 2, expectedRange: { min: 0.84, max: 0.89 } },
        { type: 'abstract', count: 3, expectedRange: { min: 0.88, max: 0.93 } },
        { type: 'interface', count: 1, expectedRange: { min: 0.80, max: 0.85 } },
        { type: 'interface', count: 2, expectedRange: { min: 0.82, max: 0.87 } },
        { type: 'override', count: 1, expectedRange: { min: 0.70, max: 0.70 } },
        { type: 'override', count: 2, expectedRange: { min: 0.735, max: 0.78 } }
      ];

      const actualScores: number[] = [];

      for (const scenario of scenarios) {
        const overrides: MethodOverride[] = [];
        
        for (let i = 0; i < scenario.count; i++) {
          if (scenario.type === 'abstract') {
            overrides.push({
              id: `cluster-abstract-${i}`,
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
          } else if (scenario.type === 'interface') {
            overrides.push({
              id: `cluster-interface-${i}`,
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
          } else {
            overrides.push({
              id: `cluster-override-${i}`,
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
        }

        mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
        mockStorage.getImplementingClasses.mockResolvedValue([]);

        const safetyInfo = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        actualScores.push(safetyInfo.confidenceScore);
        
        // Verify score is within expected range
        expect(safetyInfo.confidenceScore).toBeGreaterThanOrEqual(scenario.expectedRange.min);
        expect(safetyInfo.confidenceScore).toBeLessThanOrEqual(scenario.expectedRange.max);
      }

      // Verify scores show meaningful distribution (not all clustered)
      const uniqueScores = [...new Set(actualScores)];
      expect(uniqueScores.length).toBeGreaterThan(5); // Should have variety

      // Verify no excessive clustering around 0.7 threshold
      const scoresNearThreshold = actualScores.filter(score => 
        score >= 0.68 && score <= 0.72
      );
      expect(scoresNearThreshold.length).toBeLessThan(actualScores.length * 0.3); // < 30% clustering
    });
  });

  describe('Threshold Crossing Behavior', () => {
    test('should handle gradual evidence increase across thresholds smoothly', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'crossing-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Test gradual increase in method overrides
      const results: { count: number; score: number; protected: boolean }[] = [];
      
      for (let overrideCount = 0; overrideCount <= 5; overrideCount++) {
        const overrides: MethodOverride[] = [];
        
        for (let i = 0; i < overrideCount; i++) {
          overrides.push({
            id: `crossing-override-${i}`,
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

        const safetyInfo = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        const shouldProtect = await analyzer.shouldProtectFromDeletion(
          functionInfo as FunctionInfo,
          'snap-1',
          0.7
        );

        results.push({
          count: overrideCount,
          score: safetyInfo.confidenceScore,
          protected: shouldProtect
        });
      }

      // Verify smooth progression
      for (let i = 1; i < results.length; i++) {
        if (results[i].count > 0 && results[i - 1].count > 0) {
          // Score should increase or stay same (monotonic)
          expect(results[i].score).toBeGreaterThanOrEqual(results[i - 1].score);
        }
      }

      // Verify clear threshold crossing
      const crossingPoint = results.findIndex(r => r.protected);
      if (crossingPoint > 0) {
        expect(results[crossingPoint - 1].protected).toBe(false);
        expect(results[crossingPoint].protected).toBe(true);
      }

      // Verify no oscillation after crossing
      const afterCrossing = results.slice(crossingPoint);
      expect(afterCrossing.every(r => r.protected)).toBe(true);
    });

    test('should maintain stable decisions for borderline cases', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'stability-test',
        name: 'testMethod',
        signature: '() => void',
        parameters: []
      };

      // Create a borderline case (single method override = exactly 0.70)
      const override: MethodOverride = {
        id: 'borderline-override',
        snapshotId: 'snap-1',
        methodMemberId: 'member-1',
        sourceTypeId: 'derived-class',
        targetMemberId: 'parent-member-1',
        targetTypeId: 'parent-class-1',
        overrideKind: 'override',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.9,
        metadata: {}
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([override]);

      // Test multiple times to ensure stability
      const decisions: boolean[] = [];
      const scores: number[] = [];

      for (let i = 0; i < 10; i++) {
        const shouldProtect = await analyzer.shouldProtectFromDeletion(
          functionInfo as FunctionInfo,
          'snap-1',
          0.7
        );

        const safetyInfo = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        decisions.push(shouldProtect);
        scores.push(safetyInfo.confidenceScore);
      }

      // All decisions should be identical
      expect(decisions.every(d => d === decisions[0])).toBe(true);
      
      // All scores should be identical
      expect(scores.every(s => s === scores[0])).toBe(true);
      
      // Should be protected (score = 0.70 >= threshold 0.70)
      expect(decisions[0]).toBe(true);
      expect(scores[0]).toBeGreaterThanOrEqual(0.70);
    });
  });

  describe('Real-world Threshold Scenarios', () => {
    test('should handle mixed evidence with appropriate threshold behavior', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'mixed-evidence-test',
        name: 'complexMethod',
        signature: '(data: any) => Promise<string>',
        parameters: [
          { name: 'data', type: 'any', typeSimple: 'any', position: 0, isOptional: false, isRest: false }
        ]
      };

      // Complex scenario: abstract + interface + override
      const mixedOverrides: MethodOverride[] = [
        {
          id: 'mixed-abstract',
          snapshotId: 'snap-1',
          methodMemberId: 'member-1',
          sourceTypeId: 'complex-class',
          targetMemberId: 'abstract-member-1',
          targetTypeId: 'abstract-class-1',
          overrideKind: 'abstract_implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: { chaAbstractImplementation: true }
        },
        {
          id: 'mixed-interface',
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
          id: 'mixed-override',
          snapshotId: 'snap-1',
          methodMemberId: 'member-3',
          sourceTypeId: 'complex-class',
          targetMemberId: 'parent-member-1',
          targetTypeId: 'parent-class-1',
          overrideKind: 'override',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.9,
          metadata: {}
        }
      ];

      mockStorage.getMethodOverridesByFunction.mockResolvedValue(mixedOverrides);
      mockStorage.getImplementingClasses.mockResolvedValue([{ name: 'SomeClass' }]);

      // Test various thresholds
      const thresholds = [0.5, 0.7, 0.8, 0.85, 0.9];
      
      for (const threshold of thresholds) {
        const shouldProtect = await analyzer.shouldProtectFromDeletion(
          functionInfo as FunctionInfo,
          'snap-1',
          threshold
        );

        const safetyInfo = await analyzer.analyzeDeletionSafety(
          functionInfo as FunctionInfo,
          'snap-1'
        );

        // Should prioritize abstract implementation (highest priority)
        expect(safetyInfo.protectionReason).toContain('abstract base method');
        expect(safetyInfo.confidenceScore).toBeGreaterThanOrEqual(0.80); // Abstract base score

        // Protection decision should be consistent with score vs threshold
        if (safetyInfo.confidenceScore >= threshold) {
          expect(shouldProtect).toBe(true);
        } else {
          expect(shouldProtect).toBe(false);
        }
      }
    });
  });
});