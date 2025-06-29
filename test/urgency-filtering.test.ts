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

describe('Urgency Filtering', () => {
  const assessor = new UrgencyAssessor();

  it('should filter functions by all urgency levels', () => {
    const functions = [
      createMockFunction('simple', 2, 80, 10),        // Should be 'low'
      createMockFunction('complex', 20, 30, 150, 8),  // Should be 'urgent'
      createMockFunction('medium', 12, 60, 80, 5),    // Should be 'weekly' or 'team'
      createMockFunction('minimal', 1, 90, 5),        // Should be 'low'
    ];

    // Test each urgency level
    const urgentFunctions = assessor.filterByUrgencyLevel(functions, 'urgent');
    const weeklyFunctions = assessor.filterByUrgencyLevel(functions, 'weekly');
    const teamFunctions = assessor.filterByUrgencyLevel(functions, 'team');
    const lowFunctions = assessor.filterByUrgencyLevel(functions, 'low');

    // Verify at least one function is classified as urgent
    expect(urgentFunctions.length).toBeGreaterThan(0);
    expect(urgentFunctions.some(f => f.name === 'complex')).toBe(true);

    // Verify low priority functions are captured
    expect(lowFunctions.length).toBeGreaterThan(0);
    expect(lowFunctions.some(f => f.name === 'simple' || f.name === 'minimal')).toBe(true);

    // Verify total coverage (every function should be classified)
    const totalClassified = urgentFunctions.length + weeklyFunctions.length + teamFunctions.length + lowFunctions.length;
    expect(totalClassified).toBe(functions.length);
  });

  it('should provide comprehensive assessment information for each level', () => {
    const functions = [
      createMockFunction('urgent', 20, 25, 150, 8),
      createMockFunction('weekly', 12, 55, 75, 5),
      createMockFunction('team', 8, 65, 45, 3),
      createMockFunction('low', 3, 85, 15, 2)
    ];

    functions.forEach(func => {
      const assessment = assessor.assessFunction(func);
      
      // Verify all required fields are present
      expect(assessment.level).toMatch(/urgent|weekly|team|low/);
      expect(assessment.rank).toMatch(/A|B|C|D|E/);
      expect(assessment.estimatedMinutes).toBeGreaterThanOrEqual(0);
      expect(assessment.riskDescription).toBeTruthy();
      expect(assessment.improvementStrategy).toBeTruthy();
      expect(assessment.impact).toBeTruthy();
      expect(Array.isArray(assessment.reasons)).toBe(true);
    });
  });

  it('should have proper urgency level distribution', () => {
    const functions = [
      // Create a variety of functions with different characteristics
      createMockFunction('very-simple', 1, 95, 5),      // Should be low
      createMockFunction('simple', 3, 80, 15),          // Should be low
      createMockFunction('moderate', 6, 65, 35),        // Should be team
      createMockFunction('concerning', 11, 50, 60),     // Should be weekly
      createMockFunction('problematic', 15, 35, 100),   // Should be urgent
      createMockFunction('very-complex', 25, 20, 200)   // Should be urgent
    ];

    const assessments = functions.map(func => ({
      name: func.name,
      assessment: assessor.assessFunction(func)
    }));

    // Check that we have representation across urgency levels
    const levels = assessments.map(a => a.assessment.level);
    const uniqueLevels = new Set(levels);
    
    expect(uniqueLevels.size).toBeGreaterThan(1); // Should have multiple urgency levels
    expect(levels).toContain('low');              // Should have low priority items
    expect(levels).toContain('urgent');           // Should have urgent items
  });
});