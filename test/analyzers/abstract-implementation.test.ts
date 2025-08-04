import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TypeAwareDeletionSafety } from '../../src/analyzers/type-aware-deletion-safety';
import { FunctionInfo } from '../../src/types';
import { MethodOverride, TypeMember } from '../../src/types/type-system';
import { Logger } from '../../src/utils/cli-utils';

/**
 * P0 Priority Tests: Abstract Method Implementation Analysis
 * 
 * Tests the detection and protection of functions that implement abstract methods
 * from base classes. These implementations are critical as their deletion would
 * make the concrete class invalid (requiring it to become abstract).
 */
describe('Abstract Method Implementation Analysis', () => {
  let analyzer: TypeAwareDeletionSafety;
  let mockStorage: any;

  beforeEach(() => {
    analyzer = new TypeAwareDeletionSafety(new Logger(false, false));
    
    // Create mock storage adapter
    mockStorage = {
      getTypeMembers: vi.fn(),
      getMethodOverridesByFunction: vi.fn(),
      getImplementingClasses: vi.fn()
    };
    
    analyzer.setStorage(mockStorage);
  });

  describe('Basic Abstract Implementation Detection', () => {
    test('should detect abstract method implementation with high protection score', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'concrete-draw-method',
        name: 'draw',
        signature: '() => void',
        parameters: []
      };

      const abstractMethodOverride: MethodOverride = {
        id: 'abstract-override-1',
        snapshotId: 'snap-1',
        methodMemberId: 'concrete-draw-member',
        sourceTypeId: 'concrete-shape-class',
        targetMemberId: 'abstract-draw-member',
        targetTypeId: 'abstract-shape-class',
        overrideKind: 'abstract_implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.95,
        metadata: {
          chaAbstractImplementation: true,
          parentClass: 'AbstractShape',
          parentMethodIsAbstract: true
        }
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([abstractMethodOverride]);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should be strongly protected (base score 0.80, above threshold 0.70)
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80);
      expect(result.protectionReason).toContain('abstract base method');
      expect(result.evidenceStrength.abstractImplementationCount).toBe(1);
    });

    test('should distinguish abstract implementation from regular override', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'override-method',
        name: 'processData',
        signature: '(data: string) => string',
        parameters: [
          { name: 'data', type: 'string', typeSimple: 'string', position: 0, isOptional: false, isRest: false }
        ]
      };

      // Mix of regular override and abstract implementation
      const overrides: MethodOverride[] = [
        {
          id: 'regular-override-1',
          snapshotId: 'snap-1',
          methodMemberId: 'process-data-member',
          sourceTypeId: 'derived-class',
          targetMemberId: 'base-process-member',
          targetTypeId: 'base-class',
          overrideKind: 'override', // Regular override
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.9,
          metadata: { chaOverride: true }
        },
        {
          id: 'abstract-impl-1',
          snapshotId: 'snap-1',
          methodMemberId: 'process-data-member-2',
          sourceTypeId: 'derived-class',
          targetMemberId: 'abstract-process-member',
          targetTypeId: 'abstract-base-class',
          overrideKind: 'abstract_implement', // Abstract implementation
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: { chaAbstractImplementation: true }
        }
      ];

      mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Abstract implementation should take precedence (higher protection)
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80); // Abstract implementation base score
      expect(result.protectionReason).toContain('abstract base method');
      expect(result.evidenceStrength.abstractImplementationCount).toBe(1);
      expect(result.evidenceStrength.overrideCount).toBe(1);
    });

    test('should handle multiple abstract implementations with bonus scoring', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'multi-abstract-impl',
        name: 'multiMethod',
        signature: '() => void',
        parameters: []
      };

      // Multiple abstract method implementations (from different abstract parents)
      const overrides: MethodOverride[] = [
        {
          id: 'abstract-impl-1',
          snapshotId: 'snap-1',
          methodMemberId: 'multi-method-member-1',
          sourceTypeId: 'concrete-class',
          targetMemberId: 'abstract-method-1',
          targetTypeId: 'abstract-parent-1',
          overrideKind: 'abstract_implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: { chaAbstractImplementation: true }
        },
        {
          id: 'abstract-impl-2',
          snapshotId: 'snap-1',
          methodMemberId: 'multi-method-member-2',
          sourceTypeId: 'concrete-class',
          targetMemberId: 'abstract-method-2',
          targetTypeId: 'abstract-parent-2',
          overrideKind: 'abstract_implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: { chaAbstractImplementation: true }
        }
      ];

      mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should get bonus for multiple abstract implementations
      expect(result.confidenceScore).toBeGreaterThan(0.80); // Above base score due to multiplier
      expect(result.protectionReason).toContain('2 abstract base method');
      expect(result.evidenceStrength.abstractImplementationCount).toBe(2);
    });
  });

  describe('Abstract Implementation with Signature Compatibility', () => {
    test('should analyze signature compatibility for abstract implementations', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'abstract-impl-with-signature',
        name: 'calculate',
        signature: '(x: number, y: number) => number',
        parameters: [
          { name: 'x', type: 'number', typeSimple: 'number', position: 0, isOptional: false, isRest: false },
          { name: 'y', type: 'number', typeSimple: 'number', position: 1, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'abstract-calculate-member',
        snapshotId: 'snap-1',
        typeId: 'abstract-calculator',
        name: 'calculate',
        memberKind: 'method',
        typeText: '(x: number, y: number) => number',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: true, // Abstract method
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const abstractOverride: MethodOverride = {
        id: 'abstract-calc-override',
        snapshotId: 'snap-1',
        methodMemberId: 'concrete-calc-member',
        sourceTypeId: 'concrete-calculator',
        targetMemberId: 'abstract-calculate-member',
        targetTypeId: 'abstract-calculator',
        overrideKind: 'abstract_implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.95,
        metadata: { chaAbstractImplementation: true }
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([abstractOverride]);
      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should have high confidence with signature compatibility bonus
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80);
      expect(result.protectionReason).toContain('abstract base method');
      
      // Should have signature compatibility analysis
      if (result.signatureCompatibility) {
        expect(result.signatureCompatibility.isCompatible).toBe(true);
        expect(result.signatureCompatibility.parameterCount).toBe(2);
      }
    });

    test('should handle signature incompatibility with abstract implementations', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'incompatible-abstract-impl',
        name: 'process',
        signature: '(input: string) => void', // Implementation has different signature
        parameters: [
          { name: 'input', type: 'string', typeSimple: 'string', position: 0, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'abstract-process-member',
        snapshotId: 'snap-1',
        typeId: 'abstract-processor',
        name: 'process',
        memberKind: 'method',
        typeText: '(input: string, options: ProcessorOptions) => Promise<string>', // Different signature
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: true,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const abstractOverride: MethodOverride = {
        id: 'incompatible-abstract-override',
        snapshotId: 'snap-1',
        methodMemberId: 'concrete-process-member',
        sourceTypeId: 'concrete-processor',
        targetMemberId: 'abstract-process-member',
        targetTypeId: 'abstract-processor',
        overrideKind: 'abstract_implement',
        isCompatible: false, // Marked as incompatible
        compatibilityErrors: ['Parameter count mismatch', 'Return type mismatch'],
        confidenceScore: 0.7, // Lower confidence due to incompatibility
        metadata: { chaAbstractImplementation: true }
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([abstractOverride]);
      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should still be protected (abstract implementations are critical)
      // but with lower confidence due to signature issues
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.70); // Still above threshold
      expect(result.protectionReason).toContain('abstract base method');
      
      // Should include signature compatibility issues
      if (result.signatureCompatibility) {
        expect(result.signatureCompatibility.isCompatible).toBe(false);
        expect(result.signatureCompatibility.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle missing abstract parent method gracefully', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'orphaned-abstract-impl',
        name: 'orphanedMethod',
        signature: '() => void',
        parameters: []
      };

      const abstractOverride: MethodOverride = {
        id: 'orphaned-abstract-override',
        snapshotId: 'snap-1',
        methodMemberId: 'orphaned-member',
        sourceTypeId: 'concrete-class',
        targetMemberId: 'missing-abstract-member', // Points to non-existent member
        targetTypeId: 'missing-abstract-class',
        overrideKind: 'abstract_implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.95,
        metadata: { chaAbstractImplementation: true }
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([abstractOverride]);
      mockStorage.getTypeMembers.mockResolvedValue([]); // No target member found

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should still provide protection despite missing target
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80);
      expect(result.protectionReason).toContain('abstract base method');
      expect(result.evidenceStrength.abstractImplementationCount).toBe(1);
    });

    test('should handle mixed override types with correct prioritization', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'mixed-override-types',
        name: 'mixedMethod',
        signature: '() => string',
        parameters: []
      };

      // Mix of all override types
      const overrides: MethodOverride[] = [
        {
          id: 'interface-impl',
          snapshotId: 'snap-1',
          methodMemberId: 'mixed-member-1',
          sourceTypeId: 'implementing-class',
          targetMemberId: 'interface-method',
          targetTypeId: 'some-interface',
          overrideKind: 'implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: {}
        },
        {
          id: 'abstract-impl',
          snapshotId: 'snap-1',
          methodMemberId: 'mixed-member-2',
          sourceTypeId: 'implementing-class',
          targetMemberId: 'abstract-method',
          targetTypeId: 'abstract-class',
          overrideKind: 'abstract_implement',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.95,
          metadata: { chaAbstractImplementation: true }
        },
        {
          id: 'regular-override',
          snapshotId: 'snap-1',
          methodMemberId: 'mixed-member-3',
          sourceTypeId: 'implementing-class',
          targetMemberId: 'base-method',
          targetTypeId: 'base-class',
          overrideKind: 'override',
          isCompatible: true,
          compatibilityErrors: [],
          confidenceScore: 0.9,
          metadata: {}
        }
      ];

      mockStorage.getMethodOverridesByFunction.mockResolvedValue(overrides);
      mockStorage.getImplementingClasses.mockResolvedValue([]);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Abstract implementation should take precedence (highest protection)
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80); // Abstract impl base score
      expect(result.protectionReason).toContain('abstract base method');
      
      // Should track all evidence types
      expect(result.evidenceStrength.abstractImplementationCount).toBe(1);
      expect(result.evidenceStrength.interfaceCount).toBe(1);
      expect(result.evidenceStrength.overrideCount).toBe(1);
    });

    test('should use shouldProtectFromDeletion with correct threshold', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'threshold-test',
        name: 'thresholdTest',
        signature: '() => void',
        parameters: []
      };

      const abstractOverride: MethodOverride = {
        id: 'threshold-abstract-override',
        snapshotId: 'snap-1',
        methodMemberId: 'threshold-member',
        sourceTypeId: 'concrete-class',
        targetMemberId: 'abstract-threshold-member',
        targetTypeId: 'abstract-class',
        overrideKind: 'abstract_implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.95,
        metadata: { chaAbstractImplementation: true }
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([abstractOverride]);

      // Test with default threshold (0.7)
      const shouldProtect = await analyzer.shouldProtectFromDeletion(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      expect(shouldProtect).toBe(true); // 0.80 base score > 0.7 threshold

      // Test with higher threshold
      const shouldProtectHighThreshold = await analyzer.shouldProtectFromDeletion(
        functionInfo as FunctionInfo,
        'snap-1',
        0.85 // Higher threshold
      );

      expect(shouldProtectHighThreshold).toBe(false); // 0.80 base score < 0.85 threshold (without bonuses)
    });
  });

  describe('CHA Integration Validation', () => {
    test('should validate CHA-generated abstract_implement overrides', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'cha-generated-abstract-impl',
        name: 'chaGeneratedMethod',
        signature: '() => void',
        parameters: []
      };

      // Simulate CHA-generated abstract implementation override
      const chaGeneratedOverride: MethodOverride = {
        id: 'abstract_impl_cha_hash_123',
        snapshotId: 'snap-1',
        methodMemberId: 'cha-member',
        sourceTypeId: 'cha-concrete-class',
        targetMemberId: 'cha-abstract-member',
        targetTypeId: 'cha-abstract-class',
        overrideKind: 'abstract_implement', // Generated by CHA
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 0.95,
        metadata: {
          chaAbstractImplementation: true,
          parentClass: 'AbstractBase',
          methodSignature: '() => void',
          parentMethodIsAbstract: true
        }
      };

      mockStorage.getMethodOverridesByFunction.mockResolvedValue([chaGeneratedOverride]);

      const result = await analyzer.analyzeDeletionSafety(
        functionInfo as FunctionInfo,
        'snap-1'
      );

      // Should properly handle CHA-generated abstract implementations
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80);
      expect(result.protectionReason).toContain('abstract base method');
      expect(result.evidenceStrength.abstractImplementationCount).toBe(1);
      
      // Verify CHA metadata is preserved
      expect(chaGeneratedOverride.metadata.chaAbstractImplementation).toBe(true);
      expect(chaGeneratedOverride.metadata.parentMethodIsAbstract).toBe(true);
    });
  });
});