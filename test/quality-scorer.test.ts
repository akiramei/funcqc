import { describe, test, expect } from 'vitest';
import { QualityScorer, QualityWeights } from '../src/utils/quality-scorer';
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

  test('should use custom weights when provided', () => {
    const customWeights: QualityWeights = {
      complexity: 0.5,
      maintainability: 0.3,
      size: 0.1,
      codeQuality: 0.1
    };

    const customScorer = new QualityScorer(customWeights);
    const functions = [createMockFunction()];
    
    const score = customScorer.calculateProjectScore(functions);
    
    expect(score.weights).toEqual(customWeights);
    expect(score.overallGrade).toBeDefined();
  });

  test('should create scorer with static factory method', () => {
    const customWeights: QualityWeights = {
      complexity: 0.4,
      maintainability: 0.4,
      size: 0.1,
      codeQuality: 0.1
    };

    const scorer = QualityScorer.withWeights(customWeights);
    const functions = [createMockFunction()];
    
    const score = scorer.calculateProjectScore(functions);
    
    expect(score.weights).toEqual(customWeights);
  });

  test('should return default weights when no custom weights provided', () => {
    const defaultScorer = new QualityScorer();
    const functions = [createMockFunction()];
    
    const score = defaultScorer.calculateProjectScore(functions);
    const defaultWeights = QualityScorer.getDefaultWeights();
    
    expect(score.weights).toEqual(defaultWeights);
    expect(defaultWeights.complexity).toBe(0.30);
    expect(defaultWeights.maintainability).toBe(0.30);
    expect(defaultWeights.size).toBe(0.20);
    expect(defaultWeights.codeQuality).toBe(0.20);
  });

  test('should validate weights sum to 1.0', () => {
    const invalidWeights: QualityWeights = {
      complexity: 0.5,
      maintainability: 0.3,
      size: 0.1,
      codeQuality: 0.05 // Sum = 0.95, not 1.0
    };

    expect(() => new QualityScorer(invalidWeights)).toThrow(/Quality weights must sum to 1.0/);
  });

  test('should validate individual weights are within bounds', () => {
    const invalidWeights: QualityWeights = {
      complexity: 1.5, // > 1.0
      maintainability: 0.3,
      size: 0.1,
      codeQuality: 0.1
    };

    expect(() => new QualityScorer(invalidWeights)).toThrow(/Invalid weight for complexity/);
  });

  test('should handle weights that affect scoring differently', () => {
    // Weights heavily favoring complexity
    const complexityFocusedWeights: QualityWeights = {
      complexity: 0.7,
      maintainability: 0.1,
      size: 0.1,
      codeQuality: 0.1
    };

    // Weights heavily favoring maintainability  
    const maintainabilityFocusedWeights: QualityWeights = {
      complexity: 0.1,
      maintainability: 0.7,
      size: 0.1,
      codeQuality: 0.1
    };

    const complexityScorer = QualityScorer.withWeights(complexityFocusedWeights);
    const maintainabilityScorer = QualityScorer.withWeights(maintainabilityFocusedWeights);

    // Function with high complexity but good maintainability
    const functions = [createMockFunction({
      metrics: {
        ...createMockFunction().metrics!,
        cyclomaticComplexity: 20, // High complexity
        maintainabilityIndex: 90  // Good maintainability
      }
    })];

    const complexityScore = complexityScorer.calculateProjectScore(functions);
    const maintainabilityScore = maintainabilityScorer.calculateProjectScore(functions);

    // The maintainability-focused scorer should give a higher overall score
    // since the function has good maintainability despite high complexity
    expect(maintainabilityScore.score).toBeGreaterThan(complexityScore.score);
  });
});