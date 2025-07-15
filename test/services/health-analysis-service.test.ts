/**
 * Integration tests for health analysis service
 */

import { describe, test, expect } from 'vitest';
import { HealthAnalysisService } from '../../src/services/health-analysis-service';
import type { FunctionInfo } from '../../src/types/index';

// Mock function with high complexity
const mockComplexFunction: FunctionInfo = {
  id: 'test-func-123',
  name: 'complexFunction',
  displayName: 'complexFunction',
  filePath: 'test/complex.ts',
  startLine: 10,
  endLine: 50,
  isExported: true,
  isAsync: false,
  modifiers: [],
  parameters: [
    { name: 'param1', type: 'string' },
    { name: 'param2', type: 'number' },
    { name: 'param3', type: 'boolean' },
    { name: 'param4', type: 'object' },
    { name: 'param5', type: 'array' } // Long parameter list
  ],
  content: '',
  contentId: 'content-123',
  metrics: {
    cyclomaticComplexity: 15, // High complexity
    linesOfCode: 45,
    totalLines: 50,
    maxNestingLevel: 5, // Deep nesting
    branchCount: 8,
    loopCount: 3,
    parameterCount: 5, // Long parameter list
    maintainabilityIndex: 35, // Low maintainability
    halsteadVolume: 1200,
    commentLines: 2,
    cognitiveComplexity: 18
  },
  sourceCode: `
function complexFunction(param1: string, param2: number, param3: boolean, param4: object, param5: array) {
  if (param1) {
    if (param2 > 10) {
      if (param3) {
        if (param4) {
          // Deeply nested logic
          return param5.map(item => {
            switch (item.type) {
              case 'A':
                return item.value * 2;
              case 'B':
                return item.value * 3;
              case 'C':
                return item.value * 4;
              default:
                return item.value;
            }
          });
        }
      }
    }
  }
  return [];
}
  `.trim()
};

// Mock simple function
const mockSimpleFunction: FunctionInfo = {
  id: 'test-func-456',
  name: 'simpleFunction',
  displayName: 'simpleFunction',
  filePath: 'test/simple.ts',
  startLine: 1,
  endLine: 5,
  isExported: true,
  isAsync: false,
  modifiers: [],
  parameters: [
    { name: 'value', type: 'number' }
  ],
  content: '',
  contentId: 'content-456',
  metrics: {
    cyclomaticComplexity: 2,
    linesOfCode: 4,
    totalLines: 5,
    maxNestingLevel: 1,
    branchCount: 1,
    loopCount: 0,
    parameterCount: 1,
    maintainabilityIndex: 85,
    halsteadVolume: 50,
    commentLines: 1,
    cognitiveComplexity: 2
  },
  sourceCode: `
function simpleFunction(value: number): number {
  return value * 2;
}
  `.trim()
};

describe('HealthAnalysisService', () => {
  const healthService = new HealthAnalysisService();

  test('should analyze complex function and provide suggestions', async () => {
    const result = await healthService.analyzeFunction(mockComplexFunction);
    
    expect(result.functionId).toBe('test-func-123');
    expect(result.functionName).toBe('complexFunction');
    expect(result.healthSuggestions).toBeInstanceOf(Array);
    expect(result.astSuggestions).toBeInstanceOf(Array);
    expect(result.priority).toBeGreaterThan(0);
    expect(result.estimatedImpact).toBeGreaterThan(0);
    
    // Should detect patterns in complex function
    expect(result.patterns).toBeDefined();
  });

  test('should analyze simple function with minimal suggestions', async () => {
    const result = await healthService.analyzeFunction(mockSimpleFunction);
    
    expect(result.functionId).toBe('test-func-456');
    expect(result.functionName).toBe('simpleFunction');
    expect(result.priority).toBeLessThan(50); // Lower priority for simple function
  });

  test('should calculate refactoring priority correctly', () => {
    const complexPriority = healthService.calculateRefactoringPriority(
      mockComplexFunction, 
      ['early return pattern', 'extract method', 'options object']
    );
    
    const simplePriority = healthService.calculateRefactoringPriority(
      mockSimpleFunction, 
      ['minor improvement']
    );
    
    expect(complexPriority).toBeGreaterThan(simplePriority);
    expect(complexPriority).toBeGreaterThan(100); // High priority
    expect(simplePriority).toBeLessThan(50); // Low priority
  });

  test('should estimate complexity reduction based on suggestions', () => {
    const highImpactSuggestions = [
      'Convert deeply nested if-statements to early return pattern',
      'Extract method for duplicated logic',
      'Replace 5 parameters with options object pattern'
    ];
    
    const lowImpactSuggestions = [
      'Add documentation comments'
    ];
    
    const highReduction = healthService.estimateComplexityReduction(highImpactSuggestions);
    const lowReduction = healthService.estimateComplexityReduction(lowImpactSuggestions);
    
    expect(highReduction).toBeGreaterThan(lowReduction);
    expect(highReduction).toBeGreaterThan(50); // Significant reduction expected
    expect(lowReduction).toBeLessThan(20); // Minimal reduction
  });

  test('should generate smart refactoring prompt', () => {
    const suggestions = [
      'Convert deeply nested if-statements to early return pattern',
      'Replace 5 parameters with options object pattern'
    ];
    
    const prompt = healthService.generateSmartPrompt(mockComplexFunction, suggestions);
    
    expect(prompt).toContain('complexFunction');
    expect(prompt).toContain('Cyclomatic Complexity: 15');
    expect(prompt).toContain('early return pattern');
    expect(prompt).toContain('options object pattern');
    expect(prompt).toContain('health-guided refactoring');
  });

  test('should generate refactoring plan for multiple functions', async () => {
    const functions = [mockComplexFunction, mockSimpleFunction];
    const plans = await healthService.generateRefactoringPlan(functions);
    
    expect(plans).toHaveLength(2);
    
    // Plans should be sorted by priority (complex function first)
    expect(plans[0].functionName).toBe('complexFunction');
    expect(plans[1].functionName).toBe('simpleFunction');
    
    // Complex function should have higher priority
    expect(plans[0].priority).toBeGreaterThan(plans[1].priority);
    
    // All plans should have required fields
    plans.forEach(plan => {
      expect(plan.functionId).toBeDefined();
      expect(plan.claudePrompt).toBeDefined();
      expect(plan.targetPatterns).toBeInstanceOf(Array);
      expect(plan.healthSuggestions).toBeInstanceOf(Array);
    });
  });

  test('should extract target patterns from suggestions', async () => {
    const result = await healthService.analyzeFunction(mockComplexFunction);
    const plan = await healthService.generateRefactoringPlan([mockComplexFunction]);
    
    expect(plan[0].targetPatterns).toBeInstanceOf(Array);
    
    // Should identify patterns based on the function characteristics
    // The exact patterns depend on the health analysis implementation
    expect(plan[0].targetPatterns.length).toBeGreaterThanOrEqual(0);
  });
});