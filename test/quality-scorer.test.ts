import { describe, test, expect } from 'vitest';
import { QualityScorer } from '../src/utils/quality-scorer';
import { FunctionInfo } from '../src/types';

const createMockFunction = (overrides: Partial<FunctionInfo> = {}): FunctionInfo => ({
  id: 'test-id',
  name: 'testFunction',
  displayName: 'testFunction',
  signature: 'function testFunction(): void',
  signatureHash: 'hash123',
  filePath: '/test/file.ts',
  fileHash: 'filehash123',
  startLine: 1,
  endLine: 10,
  startColumn: 0,
  endColumn: 20,
  astHash: 'asthash123',
  isExported: true,
  isAsync: false,
  isGenerator: false,
  isArrowFunction: false,
  isMethod: false,
  isConstructor: false,
  isStatic: false,
  parameters: [],
  metrics: {
    linesOfCode: 5,
    totalLines: 10,
    cyclomaticComplexity: 1,
    cognitiveComplexity: 1,
    maxNestingLevel: 1,
    parameterCount: 0,
    returnStatementCount: 1,
    branchCount: 0,
    loopCount: 0,
    tryCatchCount: 0,
    asyncAwaitCount: 0,
    callbackCount: 0,
    commentLines: 1,
    codeToCommentRatio: 0.2,
    halsteadVolume: 10,
    halsteadDifficulty: 1,
    maintainabilityIndex: 80
  },
  ...overrides
});

describe('QualityScorer', () => {
  const scorer = new QualityScorer();

  test('should give A grade for high-quality code', () => {
    const functions = [
      createMockFunction(),
      createMockFunction({ 
        metrics: { 
          ...createMockFunction().metrics!, 
          cyclomaticComplexity: 2, 
          maintainabilityIndex: 85 
        } 
      })
    ];

    const score = scorer.calculateProjectScore(functions);
    
    expect(score.overallGrade).toBe('A');
    expect(score.score).toBeGreaterThan(85);
    expect(score.highRiskFunctions).toBe(0);
  });

  test('should give lower grade for complex functions', () => {
    const functions = [
      createMockFunction({
        metrics: {
          ...createMockFunction().metrics!,
          cyclomaticComplexity: 20,
          maintainabilityIndex: 30,
          linesOfCode: 150
        }
      }),
      createMockFunction({
        metrics: {
          ...createMockFunction().metrics!,
          cyclomaticComplexity: 15,
          maintainabilityIndex: 40
        }
      })
    ];

    const score = scorer.calculateProjectScore(functions);
    
    expect(score.overallGrade).not.toBe('A');
    expect(score.highRiskFunctions).toBeGreaterThan(0);
    expect(score.topProblematicFunctions.length).toBeGreaterThan(0);
  });

  test('should identify problematic functions', () => {
    const functions = [
      createMockFunction({
        name: 'goodFunction',
        displayName: 'goodFunction'
      }),
      createMockFunction({
        name: 'badFunction',
        displayName: 'badFunction',
        metrics: {
          ...createMockFunction().metrics!,
          cyclomaticComplexity: 25,
          maintainabilityIndex: 20,
          linesOfCode: 200
        }
      })
    ];

    const score = scorer.calculateProjectScore(functions);
    
    expect(score.topProblematicFunctions).toHaveLength(1);
    expect(score.topProblematicFunctions[0].name).toBe('badFunction');
    expect(score.topProblematicFunctions[0].reason).toContain('high complexity');
  });

  test('should handle empty function list', () => {
    const score = scorer.calculateProjectScore([]);
    
    expect(score.overallGrade).toBe('A');
    expect(score.score).toBe(100);
    expect(score.totalFunctions).toBe(0);
    expect(score.highRiskFunctions).toBe(0);
    expect(score.topProblematicFunctions).toHaveLength(0);
  });

  test('should calculate complexity score correctly', () => {
    const lowComplexityFunctions = Array(10).fill(null).map(() => 
      createMockFunction({
        metrics: { ...createMockFunction().metrics!, cyclomaticComplexity: 2 }
      })
    );

    const highComplexityFunctions = Array(10).fill(null).map(() => 
      createMockFunction({
        metrics: { ...createMockFunction().metrics!, cyclomaticComplexity: 15 }
      })
    );

    const lowComplexityScore = scorer.calculateProjectScore(lowComplexityFunctions);
    const highComplexityScore = scorer.calculateProjectScore(highComplexityFunctions);

    expect(lowComplexityScore.complexityScore).toBeGreaterThan(highComplexityScore.complexityScore);
  });

  test('should handle functions without metrics', () => {
    const functions = [
      createMockFunction({ metrics: undefined }),
      createMockFunction()
    ];

    const score = scorer.calculateProjectScore(functions);
    
    expect(score.overallGrade).toBeDefined();
    expect(score.score).toBeGreaterThan(0);
  });
});