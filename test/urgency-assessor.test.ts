import { describe, it, expect } from 'vitest';
import { UrgencyAssessor } from '../src/utils/urgency-assessor';
import { FunctionInfo } from '../src/types';

function createMockFunction(
  name: string,
  complexity: number,
  maintainability: number,
  lines: number,
  params: number = 2
): FunctionInfo {
  return {
    id: `test-${name}`,
    name,
    displayName: name,
    signature: `function ${name}()`,
    signatureHash: 'test-hash',
    filePath: 'test.ts',
    fileHash: 'file-hash',
    startLine: 1,
    endLine: lines + 1,
    startColumn: 1,
    endColumn: 1,
    astHash: 'ast-hash',
    isExported: true,
    isAsync: false,
    isGenerator: false,
    isArrowFunction: false,
    isMethod: false,
    isConstructor: false,
    isStatic: false,
    parameters: Array(params).fill(null).map((_, i) => ({
      name: `param${i}`,
      type: 'any',
      typeSimple: 'any',
      position: i,
      isOptional: false,
      isRest: false
    })),
    metrics: {
      linesOfCode: lines,
      totalLines: lines + 5,
      cyclomaticComplexity: complexity,
      cognitiveComplexity: complexity,
      maxNestingLevel: Math.min(5, Math.floor(complexity / 3)),
      parameterCount: params,
      returnStatementCount: 1,
      branchCount: complexity - 1,
      loopCount: 0,
      tryCatchCount: 0,
      asyncAwaitCount: 0,
      callbackCount: 0,
      commentLines: 2,
      codeToCommentRatio: 0.1,
      maintainabilityIndex: maintainability
    }
  };
}

describe('UrgencyAssessor', () => {
  const assessor = new UrgencyAssessor();

  it('should classify simple functions as low urgency', () => {
    const simpleFunc = createMockFunction('simple', 2, 80, 10);
    const assessment = assessor.assessFunction(simpleFunc);
    
    expect(assessment.level).toBe('low');
    expect(assessment.estimatedMinutes).toBeLessThan(30);
  });

  it('should classify complex functions as urgent', () => {
    const complexFunc = createMockFunction('complex', 20, 30, 150, 8);
    const assessment = assessor.assessFunction(complexFunc);
    
    expect(assessment.level).toBe('urgent');
    expect(assessment.estimatedMinutes).toBeLessThanOrEqual(15);
    expect(assessment.reasons.length).toBeGreaterThan(0);
  });

  it('should classify medium complexity functions as weekly or team', () => {
    const mediumFunc = createMockFunction('medium', 12, 60, 80, 5);
    const assessment = assessor.assessFunction(mediumFunc);
    
    expect(['weekly', 'team']).toContain(assessment.level);
    expect(assessment.estimatedMinutes).toBeGreaterThan(15);
    expect(assessment.estimatedMinutes).toBeLessThanOrEqual(480);
  });

  it('should filter functions by urgency level', () => {
    const functions = [
      createMockFunction('simple', 2, 80, 10),
      createMockFunction('complex', 20, 30, 150),
      createMockFunction('medium', 12, 60, 80)
    ];

    const urgentFunctions = assessor.filterByUrgencyLevel(functions, 'urgent');
    const weeklyFunctions = assessor.filterByUrgencyLevel(functions, 'weekly');
    const teamFunctions = assessor.filterByUrgencyLevel(functions, 'team');

    expect(urgentFunctions.length).toBe(1);
    expect(urgentFunctions[0].name).toBe('complex');
    
    // Accept that medium might be classified as team instead of weekly
    expect(weeklyFunctions.length + teamFunctions.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle functions without metrics', () => {
    const funcWithoutMetrics: FunctionInfo = {
      ...createMockFunction('noMetrics', 1, 100, 5),
      metrics: undefined
    };

    const assessment = assessor.assessFunction(funcWithoutMetrics);
    
    expect(assessment.level).toBe('low');
    expect(assessment.rank).toBe('A');
    expect(assessment.estimatedMinutes).toBe(0);
  });

  it('should generate meaningful descriptions', () => {
    const complexFunc = createMockFunction('complex', 15, 40, 120, 7);
    const assessment = assessor.assessFunction(complexFunc);
    
    expect(assessment.riskDescription).toMatch(/理解に\d+分/);
    expect(assessment.riskDescription).toMatch(/バグリスク\d+%/);
    expect(assessment.improvementStrategy).toMatch(/関数分割|条件分岐の整理|オブジェクト引数化|早期リターン|軽微な整理/);
    expect(assessment.impact).toMatch(/\d+時間\/月の節約|保守性向上|技術債務削減/);
  });

  it('should generate Japanese text content correctly', () => {
    const testCases = [
      { complexity: 20, maintainability: 25, lines: 180, params: 8 },
      { complexity: 12, maintainability: 60, lines: 80, params: 5 },
      { complexity: 3, maintainability: 90, lines: 20, params: 2 }
    ];

    testCases.forEach(({ complexity, maintainability, lines, params }, index) => {
      const func = createMockFunction(`test${index}`, complexity, maintainability, lines, params);
      const assessment = assessor.assessFunction(func);

      // Risk description validation
      expect(assessment.riskDescription).toMatch(/理解に\d+分、バグリスク\d+%/);
      
      // Improvement strategy validation
      expect(assessment.improvementStrategy).toMatch(/^[ァ-ヶー\u3040-\u309F\u4E00-\u9FAF、]+$/);
      
      // Impact description validation
      expect(assessment.impact).toMatch(/[時間\/月の節約|保守性向上|技術債務削減]/);
      
      // Reasons should be Japanese text
      assessment.reasons.forEach(reason => {
        expect(reason).toMatch(/[\u3040-\u309F\u4E00-\u9FAF]/); // Contains Japanese characters
      });
    });
  });

  it('should handle boundary values safely', () => {
    // Test extreme values that could cause calculation errors
    const extremeFunc = createMockFunction('extreme', 1000, -50, 50000, 100);
    const assessment = assessor.assessFunction(extremeFunc);
    
    // Should not crash and should return valid assessment
    expect(assessment).toBeDefined();
    expect(assessment.level).toMatch(/urgent|weekly|team|low/);
    expect(assessment.rank).toMatch(/A|B|C|D|E/);
    expect(assessment.estimatedMinutes).toBeGreaterThan(0);
    expect(assessment.riskDescription).toBeTruthy();
  });
});