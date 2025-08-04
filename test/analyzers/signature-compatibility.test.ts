import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TypeAwareDeletionSafety, SignatureCompatibility } from '../../src/analyzers/type-aware-deletion-safety';
import { FunctionInfo } from '../../src/types';
import { MethodOverride, TypeMember } from '../../src/types/type-system';
import { Logger } from '../../src/utils/cli-utils';

/**
 * P0 Priority Tests: Signature Compatibility Analysis
 * 
 * Tests the core signature compatibility checking logic that determines
 * whether a function implementation is compatible with its interface/parent
 * method signature. This is critical for type-aware deletion safety.
 */
describe('Signature Compatibility Analysis', () => {
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

  describe('Parameter Count Compatibility', () => {
    test('should allow exact parameter count match', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-1',
        name: 'testMethod',
        signature: '(a: string, b: number) => void',
        parameters: [
          { name: 'a', type: 'string', typeSimple: 'string', position: 0, isOptional: false, isRest: false },
          { name: 'b', type: 'number', typeSimple: 'number', position: 1, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-1',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'testMethod',
        memberKind: 'method',
        typeText: '(a: string, b: number) => void',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-1',
        snapshotId: 'snap-1',
        methodMemberId: 'member-1',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-1',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.9);
      expect(result.parameterCount).toBe(2);
      expect(result.issues).toHaveLength(0);
    });

    test('should allow implementation with fewer parameters (optional parameters)', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-2',
        name: 'testMethod',
        signature: '(a: string) => void',
        parameters: [
          { name: 'a', type: 'string', typeSimple: 'string', position: 0, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-2',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'testMethod',
        memberKind: 'method',
        typeText: '(a: string, b?: number) => void',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-2',
        snapshotId: 'snap-1',
        methodMemberId: 'member-2',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-2',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.8);
      expect(result.parameterCount).toBe(1);
    });

    test('should penalize implementation with too many extra parameters', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-3',
        name: 'testMethod',
        signature: '(a: string, b: number, c: boolean, d: object) => void',
        parameters: [
          { name: 'a', type: 'string', typeSimple: 'string', position: 0, isOptional: false, isRest: false },
          { name: 'b', type: 'number', typeSimple: 'number', position: 1, isOptional: false, isRest: false },
          { name: 'c', type: 'boolean', typeSimple: 'boolean', position: 2, isOptional: false, isRest: false },
          { name: 'd', type: 'object', typeSimple: 'object', position: 3, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-3',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'testMethod',
        memberKind: 'method',
        typeText: '(a: string) => void',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-3',
        snapshotId: 'snap-1',
        methodMemberId: 'member-3',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-3',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      // With 4 parameters vs 1 parameter, the compatibility score should be low
      // but the actual result depends on other compatibility factors
      expect(result.parameterCount).toBe(4);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toContain('Parameter count mismatch');
      
      // The overall compatibility may still be true if other factors compensate
      // but the score should be penalized
      if (result.isCompatible) {
        expect(result.compatibilityScore).toBeLessThan(0.8);
      } else {
        expect(result.compatibilityScore).toBeLessThan(0.7);
      }
    });
  });

  describe('Return Type Compatibility', () => {
    test('should allow covariant return types (more specific)', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-4',
        name: 'getResult',
        signature: '() => string',
        parameters: []
      };

      const targetMember: TypeMember = {
        id: 'target-member-4',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'getResult',
        memberKind: 'method',
        typeText: '() => any',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-4',
        snapshotId: 'snap-1',
        methodMemberId: 'member-4',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-4',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.returnTypeMatch).toBe(true);
      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.8);
    });

    test('should detect incompatible return types', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-5',
        name: 'getNumber',
        signature: '() => string',
        parameters: []
      };

      const targetMember: TypeMember = {
        id: 'target-member-5',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'getNumber',
        memberKind: 'method',
        typeText: '() => number',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-5',
        snapshotId: 'snap-1',
        methodMemberId: 'member-5',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-5',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.returnTypeMatch).toBe(false);
      expect(result.issues.some(issue => issue.includes('Return type mismatch'))).toBe(true);
      expect(result.compatibilityScore).toBeLessThan(1.0);
      
      // Overall compatibility may still be true if the score >= 0.7
      if (!result.isCompatible) {
        expect(result.compatibilityScore).toBeLessThan(0.7);
      }
    });

    test('should allow void/undefined return type compatibility', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-6',
        name: 'process',
        signature: '() => void',
        parameters: []
      };

      const targetMember: TypeMember = {
        id: 'target-member-6',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'process',
        memberKind: 'method',
        typeText: '() => undefined',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-6',
        snapshotId: 'snap-1',
        methodMemberId: 'member-6',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-6',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.returnTypeMatch).toBe(true);
      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('Generic Type Parameters', () => {
    test('should handle generic method signatures', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-7',
        name: 'transform',
        signature: '<T>(input: T) => T',
        parameters: [
          { name: 'input', type: 'T', typeSimple: 'T', position: 0, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-7',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'transform',
        memberKind: 'method',
        typeText: '<T>(input: T) => T',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-7',
        snapshotId: 'snap-1',
        methodMemberId: 'member-7',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-7',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.8);
      expect(result.parameterCount).toBe(1);
    });

    test('should handle generic constraints compatibility', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-8',
        name: 'process',
        signature: '<T extends string>(value: T) => T',
        parameters: [
          { name: 'value', type: 'T', typeSimple: 'T', position: 0, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-8',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'process',
        memberKind: 'method',
        typeText: '<T extends any>(value: T) => T',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-8',
        snapshotId: 'snap-1',
        methodMemberId: 'member-8',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-8',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('Method Overloads', () => {
    test('should handle function overloads in signature analysis', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-9',
        name: 'getValue',
        signature: '(key: string) => string | undefined',
        parameters: [
          { name: 'key', type: 'string', typeSimple: 'string', position: 0, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-9',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'getValue',
        memberKind: 'method',
        typeText: '(key: string) => string; (key: string, defaultValue: string) => string',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-9',
        snapshotId: 'snap-1',
        methodMemberId: 'member-9',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-9',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      // For overloaded methods, we expect more lenient compatibility checking
      expect(result.compatibilityScore).toBeGreaterThan(0.5);
      expect(result.parameterCount).toBe(1);
    });
  });

  describe('Rest Parameters and Optional Parameters', () => {
    test('should handle rest parameters compatibility', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-10',
        name: 'sum',
        signature: '(...numbers: number[]) => number',
        parameters: [
          { name: 'numbers', type: 'number[]', typeSimple: 'number[]', position: 0, isOptional: false, isRest: true }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-10',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'sum',
        memberKind: 'method',
        typeText: '(...numbers: number[]) => number',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-10',
        snapshotId: 'snap-1',
        methodMemberId: 'member-10',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-10',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.9);
      expect(result.parameterCount).toBe(1);
    });

    test('should handle mixed optional and required parameters', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-11',
        name: 'configure',
        signature: '(required: string, optional?: number) => void',
        parameters: [
          { name: 'required', type: 'string', typeSimple: 'string', position: 0, isOptional: false, isRest: false },
          { name: 'optional', type: 'number', typeSimple: 'number', position: 1, isOptional: true, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-11',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'configure',
        memberKind: 'method',
        typeText: '(required: string, optional?: number, extra?: boolean) => void',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-11',
        snapshotId: 'snap-1',
        methodMemberId: 'member-11',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-11',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(true);
      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.8);
      expect(result.parameterCount).toBe(2);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle missing target member gracefully', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-12',
        name: 'missingTarget',
        signature: '() => void',
        parameters: []
      };

      const methodOverride: MethodOverride = {
        id: 'override-12',
        snapshotId: 'snap-1',
        methodMemberId: 'member-12',
        sourceTypeId: 'class-1',
        targetMemberId: 'nonexistent-target',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(false);
      expect(result.compatibilityScore).toBe(0.0);
      expect(result.issues).toContain('Target method signature not found');
    });

    test('should handle analysis failure gracefully', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-13',
        name: 'errorCase',
        signature: 'invalid-signature',
        parameters: []
      };

      const methodOverride: MethodOverride = {
        id: 'override-13',
        snapshotId: 'snap-1',
        methodMemberId: 'member-13',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-13',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockRejectedValue(new Error('Database connection failed'));

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.isCompatible).toBe(false);
      // Score may vary based on implementation, but should be low for failures
      expect(result.compatibilityScore).toBeLessThan(0.7);
      expect(result.issues).toContain('Target method signature not found');
    });

    test('should handle empty signatures', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-14',
        name: 'emptySignature',
        signature: '',
        parameters: []
      };

      const targetMember: TypeMember = {
        id: 'target-member-14',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'emptySignature',
        memberKind: 'method',
        typeText: '',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-14',
        snapshotId: 'snap-1',
        methodMemberId: 'member-14',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-14',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.compatibilityScore).toBeGreaterThan(0.7);
      expect(result.parameterCount).toBe(0);
    });
  });

  describe('Complex Type Scenarios', () => {
    test('should handle union and intersection types', async () => {
      const functionInfo: Partial<FunctionInfo> = {
        id: 'test-func-15',
        name: 'processUnion',
        signature: '(value: string | number) => boolean',
        parameters: [
          { name: 'value', type: 'string | number', typeSimple: 'union', position: 0, isOptional: false, isRest: false }
        ]
      };

      const targetMember: TypeMember = {
        id: 'target-member-15',
        snapshotId: 'snap-1',
        typeId: 'interface-1',
        name: 'processUnion',
        memberKind: 'method',
        typeText: '(value: string | number | undefined) => boolean',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: 'public',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        functionId: null,
        jsdoc: null,
        metadata: {}
      };

      const methodOverride: MethodOverride = {
        id: 'override-15',
        snapshotId: 'snap-1',
        methodMemberId: 'member-15',
        sourceTypeId: 'class-1',
        targetMemberId: 'target-member-15',
        targetTypeId: 'interface-1',
        overrideKind: 'implement',
        isCompatible: true,
        compatibilityErrors: [],
        confidenceScore: 1.0,
        metadata: {}
      };

      mockStorage.getTypeMembers.mockResolvedValue([targetMember]);

      const result = await (analyzer as any).analyzeSignatureCompatibility(
        functionInfo as FunctionInfo,
        methodOverride,
        'snap-1'
      );

      expect(result.compatibilityScore).toBeGreaterThanOrEqual(0.8);
      expect(result.parameterCount).toBe(1);
    });
  });
});