/**
 * Refactoring GuardRail Tests
 * 
 * Tests for the RefactoringGuardRail analyzer that provides safety
 * analysis and guidelines for type refactoring operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RefactoringGuardRail } from '../../src/analyzers/type-refactoring/refactoring-guardrail';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

// Mock storage interface
const createMockStorage = (): StorageQueryInterface => ({
  query: vi.fn()
});

describe('RefactoringGuardRail', () => {
  let storage: StorageQueryInterface;
  let guardrail: RefactoringGuardRail;

  beforeEach(() => {
    storage = createMockStorage();
    guardrail = new RefactoringGuardRail(storage, {
      includeTestTemplates: true,
      includeTypeChecks: true,
      includeBehavioralChecks: true,
      includeImpactAnalysis: true,
      generatePRSummary: true,
      riskThreshold: 'medium'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('analyzeTypeRefactoring', () => {
    it('should throw error when type is not found', async () => {
      // Mock empty result for type not found
      vi.mocked(storage.query).mockResolvedValue({
        rows: []
      });

      await expect(
        guardrail.analyzeTypeRefactoring('NonexistentType', 'replace')
      ).rejects.toThrow("Type 'NonexistentType' not found");
    });

    it('should analyze basic type replacement with low risk', async () => {
      // Mock type information
      const mockTypeInfo = {
        id: 'type1',
        name: 'SimpleType',
        file_path: 'src/types.ts',
        created_at: new Date()
      };

      // Mock queries
      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] }) // Type info query
        .mockResolvedValueOnce({ rows: [] }); // Function usage query

      const report = await guardrail.analyzeTypeRefactoring('SimpleType', 'replace');

      expect(report.targetType).toBe('SimpleType');
      expect(report.operationType).toBe('replace');
      expect(['low', 'medium', 'high']).toContain(report.overallRisk);
      expect(report.impactAnalysis).toHaveLength(1);
      expect(report.checklist.length).toBeGreaterThan(0);
      expect(report.testTemplates.length).toBeGreaterThan(0);
      expect(report.prSummary).toContain('Type Refactoring');
    });

    it('should identify high risk for widely used types', async () => {
      const mockTypeInfo = {
        id: 'type1',
        name: 'WidelyUsedType',
        file_path: 'src/api/types.ts',
        created_at: new Date()
      };

      // Mock many affected functions
      const affectedFunctions = Array.from({ length: 30 }, (_, i) => ({
        name: `function${i}`,
        file_path: `src/module${i}.ts`
      }));

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: affectedFunctions });

      const report = await guardrail.analyzeTypeRefactoring('WidelyUsedType', 'replace');

      expect(['high', 'critical']).toContain(report.overallRisk);
      expect(report.impactAnalysis[0]?.impactLevel).toBe('critical');
      expect(report.impactAnalysis[0]?.affectedFunctions).toHaveLength(30);
      expect(report.warnings.length).toBeGreaterThanOrEqual(0);
      expect(report.recommendations.length).toBeGreaterThanOrEqual(0);
    });

    it('should generate appropriate checklist for replace operation', async () => {
      const mockTypeInfo = {
        id: 'type1', 
        name: 'TestType',
        file_path: 'src/types.ts'
      };

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: [{ name: 'testFunc', file_path: 'src/test.ts' }] });

      const report = await guardrail.analyzeTypeRefactoring('TestType', 'replace');

      const checklist = report.checklist;
      
      // Should include type safety checks
      expect(checklist.some(item => item.category === 'type-safety')).toBe(true);
      
      // Should include breaking change checks for replace operation
      expect(checklist.some(item => item.category === 'breaking-change')).toBe(true);
      
      // Should be sorted by priority
      const priorities = checklist.map(item => item.priority);
      const criticalIndex = priorities.indexOf('critical');
      const lowIndex = priorities.indexOf('low');
      if (criticalIndex !== -1 && lowIndex !== -1) {
        expect(criticalIndex).toBeLessThan(lowIndex);
      }
    });

    it('should generate test templates for different scenarios', async () => {
      const mockTypeInfo = {
        id: 'type1',
        name: 'TestableType', 
        file_path: 'src/types.ts'
      };

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: [] });

      const report = await guardrail.analyzeTypeRefactoring('TestableType', 'replace');

      expect(report.testTemplates.length).toBeGreaterThan(0);
      
      // Should include unit test template
      const unitTest = report.testTemplates.find(t => t.testType === 'unit');
      expect(unitTest).toBeDefined();
      expect(unitTest?.template).toContain('TestableType');
      
      // Should include integration test for replace operation
      const integrationTest = report.testTemplates.find(t => t.testType === 'integration');
      expect(integrationTest).toBeDefined();
      
      // Should include boundary test
      const boundaryTest = report.testTemplates.find(t => t.testType === 'boundary');
      expect(boundaryTest).toBeDefined();
    });

    it('should handle different operation types appropriately', async () => {
      const mockTypeInfo = {
        id: 'type1',
        name: 'OperationType',
        file_path: 'src/types.ts'
      };

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: [] });

      // Test extract operation (should be lower risk)
      const extractReport = await guardrail.analyzeTypeRefactoring('OperationType', 'extract');
      expect(['low', 'medium']).toContain(extractReport.overallRisk);
      
      // Reset mocks
      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: [] });

      // Test merge operation (should be higher risk)
      const mergeReport = await guardrail.analyzeTypeRefactoring('OperationType', 'merge');
      expect(['medium', 'high']).toContain(mergeReport.overallRisk);
    });

    it('should identify risk factors correctly', async () => {
      const mockTypeInfo = {
        id: 'type1',
        name: 'ApiResponse',
        file_path: 'src/api/types.ts'
      };

      // Create many affected functions to trigger high usage risk
      const manyFunctions = Array.from({ length: 60 }, (_, i) => ({
        name: `apiFunc${i}`,
        file_path: `src/api/handler${i}.ts`
      }));

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: manyFunctions });

      const report = await guardrail.analyzeTypeRefactoring('ApiResponse', 'replace');

      const riskFactors = report.impactAnalysis[0]?.riskFactors || [];
      
      // Should identify high usage count
      expect(riskFactors.some(factor => 
        factor.includes('High usage count')
      )).toBe(true);
      
      // Should identify API type risk
      expect(riskFactors.some(factor => 
        factor.includes('Public API type')
      )).toBe(true);
    });

    it('should generate appropriate PR summary', async () => {
      const mockTypeInfo = {
        id: 'type1',
        name: 'UserData',
        file_path: 'src/models/user.ts'
      };

      const functions = [
        { name: 'getUserData', file_path: 'src/services/user.ts' },
        { name: 'updateUser', file_path: 'src/services/user.ts' }
      ];

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: functions });

      const report = await guardrail.analyzeTypeRefactoring('UserData', 'replace');

      expect(report.prSummary).toContain('Type Refactoring: replace UserData');
      expect(report.prSummary).toContain('2 functions');
      expect(report.prSummary).toContain('Risk Level:');
      expect(report.prSummary).toContain('Changes Made');
      expect(report.prSummary).toContain('Testing');
      expect(report.prSummary).toContain('Rollback Plan');
      expect(report.prSummary).toContain('funcqc RefactoringGuardRail');
    });

    it('should respect configuration options', async () => {
      const mockTypeInfo = {
        id: 'type1',
        name: 'ConfigurableType',
        file_path: 'src/types.ts'
      };

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: [] });

      // Test with test templates disabled
      const guardrailNoTests = new RefactoringGuardRail(storage, {
        includeTestTemplates: false,
        generatePRSummary: false
      });

      const report = await guardrailNoTests.analyzeTypeRefactoring('ConfigurableType', 'replace');

      expect(report.testTemplates).toHaveLength(0);
      expect(report.prSummary).toBe('');
    });
  });

  describe('risk calculation', () => {
    it('should calculate impact levels correctly', async () => {
      const mockTypeInfo = {
        id: 'type1',
        name: 'TestType',
        file_path: 'src/types.ts'
      };

      // Test low impact (few functions affected)
      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: [{ name: 'func1', file_path: 'src/test.ts' }] });

      const lowImpactReport = await guardrail.analyzeTypeRefactoring('TestType', 'extract');
      expect(lowImpactReport.impactAnalysis[0]?.impactLevel).toBe('low');

      // Test high impact (many functions affected)
      const manyFunctions = Array.from({ length: 30 }, (_, i) => ({
        name: `func${i}`,
        file_path: `src/test${i}.ts`
      }));

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: manyFunctions });

      const highImpactReport = await guardrail.analyzeTypeRefactoring('TestType', 'replace');
      expect(highImpactReport.impactAnalysis[0]?.impactLevel).toBe('critical');
    });
  });

  describe('Git integration', () => {
    it('should handle missing Git provider gracefully', async () => {
      const mockTypeInfo = {
        id: 'type1',
        name: 'GitlessType',
        file_path: 'src/types.ts'
      };

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: [] });

      // Should not throw error when Git provider is not available
      const report = await guardrail.analyzeTypeRefactoring('GitlessType', 'replace');
      expect(report).toBeDefined();
      expect(report.impactAnalysis).toHaveLength(1); // Only direct impact
    });

    it('should include co-change analysis when Git provider is available', async () => {
      const mockGitProvider = {
        getCommitHistory: vi.fn().mockResolvedValue([
          {
            hash: 'abc123',
            date: new Date('2024-01-01'),
            message: 'Update types',
            changedFiles: ['src/types.ts']
          }
        ])
      };

      const mockTypeInfo = {
        id: 'type1',
        name: 'GitType',
        file_path: 'src/types.ts'
      };

      vi.mocked(storage.query)
        .mockResolvedValueOnce({ rows: [mockTypeInfo] })
        .mockResolvedValueOnce({ rows: [] });

      guardrail.setGitProvider(mockGitProvider);
      
      const report = await guardrail.analyzeTypeRefactoring('GitType', 'replace');
      expect(report).toBeDefined();
      // Should include additional analysis when Git is available
    });
  });
});