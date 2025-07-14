import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RefactoringHealthEngine, DefaultLineageManager } from '../src/utils/refactoring-health-engine';
import { 
  RefactoringChangeset, 
  RefactoringOperation, 
  FunctionInfo, 
  QualityMetrics,
  StorageAdapter,
  HealthAssessment,
  ImprovementMetrics,
  ChangesetAssessment,
} from '../src/types';

// Mock storage adapter for testing
class MockStorageAdapter {
  private mockFunctions: FunctionInfo[] = [];
  private mockChangesets: RefactoringChangeset[] = [];

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async getFunctionsBySnapshotId(snapshotId: string): Promise<FunctionInfo[]> {
    return this.mockFunctions.filter(f => f.snapshotId === snapshotId);
  }

  async saveRefactoringChangeset(changeset: RefactoringChangeset): Promise<void> {
    this.mockChangesets.push(changeset);
  }

  async getRefactoringChangesetsBySession(sessionId: string): Promise<RefactoringChangeset[]> {
    return this.mockChangesets.filter(c => c.sessionId === sessionId);
  }

  async getLineagesByFunctionId(functionId: string): Promise<any[]> {
    return [];
  }

  async saveLineage(lineage: any): Promise<void> {}

  setMockFunctions(functions: FunctionInfo[]) {
    this.mockFunctions = functions;
  }

  // Stub methods for StorageAdapter interface
  async saveSnapshot(): Promise<string> { return 'mock-snapshot-id'; }
  async getSnapshots(): Promise<any[]> { return []; }
  async getSnapshot(): Promise<any> { return null; }
  async deleteSnapshot(): Promise<boolean> { return true; }
  async getFunction(): Promise<any> { return null; }
  async getFunctionsBatch(): Promise<any> { return new Map(); }
  async getFunctions(): Promise<any[]> { return []; }
  async queryFunctions(): Promise<any[]> { return []; }
  async getFunctionsWithDescriptions(): Promise<any[]> { return []; }
  async getFunctionsWithoutDescriptions(): Promise<any[]> { return []; }
  async getFunctionsNeedingDescriptions(): Promise<any[]> { return []; }
  async saveFunctionDescription(): Promise<void> {}
  async getFunctionDescription(): Promise<any> { return null; }
  async searchFunctionsByDescription(): Promise<any[]> { return []; }
  async saveEmbedding(): Promise<void> {}
  async getEmbedding(): Promise<any> { return null; }
  async searchByEmbedding(): Promise<any[]> { return []; }
  async bulkSaveEmbeddings(): Promise<void> {}
  async getFunctionsWithoutEmbeddings(): Promise<any[]> { return []; }
  async getEmbeddingStats(): Promise<any> { return { total: 0, withEmbeddings: 0, withoutEmbeddings: 0 }; }
  async saveNamingEvaluation(): Promise<void> {}
  async getNamingEvaluation(): Promise<any> { return null; }
  async getFunctionsNeedingEvaluation(): Promise<any[]> { return []; }
  async getFunctionsWithEvaluations(): Promise<any[]> { return []; }
  async updateEvaluationRevisionStatus(): Promise<void> {}
  async batchSaveEvaluations(): Promise<void> {}
  async getEvaluationStatistics(): Promise<any> { return { total: 0, withEvaluations: 0, needingEvaluation: 0, averageRating: 0, ratingDistribution: {} }; }
  async diffSnapshots(): Promise<any> { return { changes: [] }; }
  async saveLineage(): Promise<void> {}
  async getLineage(): Promise<any> { return null; }
  async getLineages(): Promise<any[]> { return []; }
  async getLineagesWithFunctionFilter(): Promise<any[]> { return []; }
  async updateLineageStatus(): Promise<void> {}
  async deleteLineage(): Promise<boolean> { return true; }
  async getLineagesByCommit(): Promise<any[]> { return []; }
  async getFunctionLineageHistory(): Promise<any[]> { return []; }
  async pruneDraftLineages(): Promise<number> { return 0; }
  async saveRefactoringSession(): Promise<void> {}
  async getRefactoringSession(): Promise<any> { return null; }
  async updateRefactoringSession(): Promise<void> {}
  async getRefactoringSessions(): Promise<any[]> { return []; }
  async getRefactoringChangeset(): Promise<any> { return null; }
  async updateRefactoringChangeset(): Promise<void> {}
  async cleanup(): Promise<number> { return 0; }
  async backup(): Promise<string> { return ''; }
  async restore(): Promise<void> {}
}

describe('RefactoringHealthEngine', () => {
  let engine: RefactoringHealthEngine;
  let mockStorage: MockStorageAdapter;
  let lineageManager: DefaultLineageManager;

  beforeEach(() => {
    mockStorage = new MockStorageAdapter();
    lineageManager = new DefaultLineageManager(mockStorage as any);
    engine = new RefactoringHealthEngine(mockStorage as any, lineageManager);
  });

  afterEach(() => {
    // Clean up
  });

  describe('evaluateChangeset', () => {
    it('should correctly evaluate a function split changeset', async () => {
      // Setup mock data
      const beforeFunction: FunctionInfo = {
        id: 'func-1',
        name: 'complexFunction',
        displayName: 'complexFunction',
        signature: 'function complexFunction()',
        filePath: '/test/file.ts',
        snapshotId: 'before-snapshot',
        semanticId: 'semantic-1',
        contentId: 'content-1',
        astHash: 'ast-1',
        signatureHash: 'sig-1',
        fileHash: 'file-1',
        startLine: 1,
        endLine: 50,
        startColumn: 0,
        endColumn: 100,
        contextPath: [],
        functionType: 'function',
        modifiers: [],
        nestingLevel: 0,
        isExported: true,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        accessModifier: 'public',
        sourceCode: 'function complexFunction() { /* complex logic */ }',
        parameters: [],
        metrics: {
          linesOfCode: 50,
          totalLines: 60,
          cyclomaticComplexity: 20,
          cognitiveComplexity: 25,
          maxNestingLevel: 4,
          parameterCount: 3,
          returnStatementCount: 5,
          branchCount: 8,
          loopCount: 3,
          tryTatchCount: 1,
          asyncAwaitCount: 0,
          callbackCount: 2,
          commentLines: 10,
          codeToCommentRatio: 5,
          halsteadVolume: 500,
          halsteadDifficulty: 15,
          maintainabilityIndex: 40,
        },
        createdAt: new Date(),
      };

      const afterFunction1: FunctionInfo = {
        ...beforeFunction,
        id: 'func-1-child-1',
        name: 'validateInput',
        displayName: 'validateInput',
        snapshotId: 'after-snapshot',
        contentId: 'content-2',
        endLine: 15,
        metrics: {
          ...beforeFunction.metrics,
          linesOfCode: 15,
          cyclomaticComplexity: 5,
          cognitiveComplexity: 6,
          maxNestingLevel: 2,
        },
      };

      const afterFunction2: FunctionInfo = {
        ...beforeFunction,
        id: 'func-1-child-2',
        name: 'processData',
        displayName: 'processData',
        snapshotId: 'after-snapshot',
        contentId: 'content-3',
        endLine: 25,
        metrics: {
          ...beforeFunction.metrics,
          linesOfCode: 25,
          cyclomaticComplexity: 8,
          cognitiveComplexity: 10,
          maxNestingLevel: 3,
        },
      };

      // Mock storage data
      mockStorage.setMockFunctions([beforeFunction]);
      mockStorage.setMockFunctions([afterFunction1, afterFunction2]);

      // Create changeset
      const changeset: RefactoringChangeset = {
        id: 'changeset-1',
        sessionId: 'session-1',
        operationType: 'split',
        parentFunctionId: 'func-1',
        childFunctionIds: ['func-1-child-1', 'func-1-child-2'],
        beforeSnapshotId: 'before-snapshot',
        afterSnapshotId: 'after-snapshot',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Evaluate changeset
      const assessment = await engine.evaluateChangeset(changeset);

      // Assertions
      expect(assessment).toBeDefined();
      expect(assessment.sessionId).toBe('session-1');
      expect(assessment.changesetId).toBe('changeset-1');
      expect(assessment.improvement).toBeDefined();
      expect(assessment.improvement.complexityReduction).toBeGreaterThan(0);
      expect(assessment.improvement.functionExplosionScore).toBeGreaterThanOrEqual(0);
    });

    it('should detect fake improvements', async () => {
      // Setup mock data that represents a fake improvement
      const beforeFunction: FunctionInfo = {
        id: 'func-1',
        name: 'moderateFunction',
        displayName: 'moderateFunction',
        signature: 'function moderateFunction()',
        filePath: '/test/file.ts',
        snapshotId: 'before-snapshot',
        semanticId: 'semantic-1',
        contentId: 'content-1',
        astHash: 'ast-1',
        signatureHash: 'sig-1',
        fileHash: 'file-1',
        startLine: 1,
        endLine: 30,
        startColumn: 0,
        endColumn: 100,
        contextPath: [],
        functionType: 'function',
        modifiers: [],
        nestingLevel: 0,
        isExported: true,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        accessModifier: 'public',
        sourceCode: 'function moderateFunction() { /* moderate logic */ }',
        parameters: [],
        metrics: {
          linesOfCode: 30,
          totalLines: 35,
          cyclomaticComplexity: 12,
          cognitiveComplexity: 15,
          maxNestingLevel: 3,
          parameterCount: 2,
          returnStatementCount: 3,
          branchCount: 5,
          loopCount: 2,
          tryTatchCount: 1,
          asyncAwaitCount: 0,
          callbackCount: 1,
          commentLines: 5,
          codeToCommentRatio: 6,
          halsteadVolume: 300,
          halsteadDifficulty: 10,
          maintainabilityIndex: 60,
        },
        createdAt: new Date(),
      };

      // Create many small functions (explosion scenario)
      const afterFunctions = Array.from({ length: 10 }, (_, i) => ({
        ...beforeFunction,
        id: `func-1-child-${i}`,
        name: `smallFunction${i}`,
        displayName: `smallFunction${i}`,
        snapshotId: 'after-snapshot',
        contentId: `content-${i}`,
        endLine: 5,
        metrics: {
          ...beforeFunction.metrics,
          linesOfCode: 3,
          cyclomaticComplexity: 1,
          cognitiveComplexity: 1,
          maxNestingLevel: 1,
        },
      }));

      mockStorage.setMockFunctions([beforeFunction]);
      mockStorage.setMockFunctions(afterFunctions);

      const changeset: RefactoringChangeset = {
        id: 'changeset-fake',
        sessionId: 'session-1',
        operationType: 'split',
        parentFunctionId: 'func-1',
        childFunctionIds: afterFunctions.map(f => f.id),
        beforeSnapshotId: 'before-snapshot',
        afterSnapshotId: 'after-snapshot',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const assessment = await engine.evaluateChangeset(changeset);

      // Should detect this as a fake improvement due to function explosion
      expect(assessment.improvement.isGenuine).toBe(false);
      expect(assessment.improvement.functionExplosionScore).toBeGreaterThan(0.3);
      expect(assessment.improvement.overallGrade).toBe('F');
    });

    it('should handle empty changesets gracefully', async () => {
      mockStorage.setMockFunctions([]);

      const changeset: RefactoringChangeset = {
        id: 'changeset-empty',
        sessionId: 'session-1',
        operationType: 'split',
        parentFunctionId: 'non-existent',
        childFunctionIds: [],
        beforeSnapshotId: 'before-snapshot',
        afterSnapshotId: 'after-snapshot',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const assessment = await engine.evaluateChangeset(changeset);

      expect(assessment).toBeDefined();
      expect(assessment.before.totalFunctions).toBe(0);
      expect(assessment.after.totalFunctions).toBe(0);
      expect(assessment.improvement.complexityReduction).toBe(0);
    });
  });

  describe('createChangeset', () => {
    it('should create and evaluate a changeset', async () => {
      const operation: RefactoringOperation = {
        type: 'split',
        parentFunction: 'func-1',
        childFunctions: ['func-1-child-1', 'func-1-child-2'],
        context: {
          sessionId: 'session-1',
          description: 'Split complex function',
          targetBranch: 'main',
          beforeSnapshot: 'before-snapshot',
          afterSnapshot: 'after-snapshot',
        },
      };

      mockStorage.setMockFunctions([]);

      const changeset = await engine.createChangeset(
        'session-1',
        operation,
        'before-snapshot',
        'after-snapshot'
      );

      expect(changeset).toBeDefined();
      expect(changeset.id).toBeDefined();
      expect(changeset.sessionId).toBe('session-1');
      expect(changeset.operationType).toBe('split');
      expect(changeset.parentFunctionId).toBe('func-1');
      expect(changeset.childFunctionIds).toEqual(['func-1-child-1', 'func-1-child-2']);
    });
  });
});

describe('DefaultLineageManager', () => {
  let lineageManager: DefaultLineageManager;
  let mockStorage: MockStorageAdapter;

  beforeEach(() => {
    mockStorage = new MockStorageAdapter();
    lineageManager = new DefaultLineageManager(mockStorage as any);
  });

  it('should track refactoring operations', async () => {
    const operation: RefactoringOperation = {
      type: 'split',
      parentFunction: 'func-1',
      childFunctions: ['func-1-child-1', 'func-1-child-2'],
      context: {
        sessionId: 'session-1',
        description: 'Split complex function',
        targetBranch: 'main',
        beforeSnapshot: 'before-snapshot',
        afterSnapshot: 'after-snapshot',
      },
    };

    await expect(lineageManager.trackRefactoringOperation(operation)).resolves.not.toThrow();
  });

  it('should get related functions', async () => {
    const lineage = await lineageManager.getRelatedFunctions('func-1');

    expect(lineage).toBeDefined();
    expect(lineage.functionId).toBe('func-1');
    expect(lineage.parentFunctions).toBeInstanceOf(Array);
    expect(lineage.childFunctions).toBeInstanceOf(Array);
    expect(lineage.relatedFunctions).toBeInstanceOf(Array);
  });

  it('should calculate changeset metrics', async () => {
    const functions: FunctionInfo[] = [
      {
        id: 'func-1',
        name: 'testFunction',
        displayName: 'testFunction',
        signature: 'function testFunction()',
        filePath: '/test/file.ts',
        snapshotId: 'snapshot-1',
        semanticId: 'semantic-1',
        contentId: 'content-1',
        astHash: 'ast-1',
        signatureHash: 'sig-1',
        fileHash: 'file-1',
        startLine: 1,
        endLine: 20,
        startColumn: 0,
        endColumn: 100,
        contextPath: [],
        functionType: 'function',
        modifiers: [],
        nestingLevel: 0,
        isExported: true,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        accessModifier: 'public',
        sourceCode: 'function testFunction() { /* test logic */ }',
        parameters: [],
        metrics: {
          linesOfCode: 20,
          totalLines: 25,
          cyclomaticComplexity: 8,
          cognitiveComplexity: 10,
          maxNestingLevel: 2,
          parameterCount: 1,
          returnStatementCount: 2,
          branchCount: 3,
          loopCount: 1,
          tryTatchCount: 0,
          asyncAwaitCount: 0,
          callbackCount: 0,
          commentLines: 5,
          codeToCommentRatio: 4,
          halsteadVolume: 200,
          halsteadDifficulty: 8,
          maintainabilityIndex: 70,
        },
        createdAt: new Date(),
      },
    ];

    const metrics = await lineageManager.calculateChangesetMetrics(functions);

    expect(metrics).toBeDefined();
    expect(metrics.totalComplexity).toBe(8);
    expect(metrics.totalLinesOfCode).toBe(20);
    expect(metrics.averageComplexity).toBe(8);
    expect(metrics.functionCount).toBe(1);
    expect(metrics.riskDistribution).toBeDefined();
  });
});