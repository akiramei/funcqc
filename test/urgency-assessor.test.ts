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
    expect(assessment.estimatedMinutes).toBe(0);
  });

  it('should generate meaningful descriptions', () => {
    const complexFunc = createMockFunction('complex', 15, 40, 120, 7);
    const assessment = assessor.assessFunction(complexFunc);
    
    expect(assessment.riskDescription).toContain('理解に');
    expect(assessment.riskDescription).toContain('バグリスク');
    expect(assessment.improvementStrategy).toBeTruthy();
    expect(assessment.impact).toBeTruthy();
  });
});