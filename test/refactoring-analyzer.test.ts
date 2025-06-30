import { describe, it, expect, beforeEach } from 'vitest';
import { RefactoringAnalyzer } from '../src/analyzers/refactoring-analyzer';
import { FunctionInfo, QualityMetrics } from '../src/types';

describe('RefactoringAnalyzer', () => {
  let analyzer: RefactoringAnalyzer;

  beforeEach(() => {
    analyzer = new RefactoringAnalyzer();
  });

  describe('analyzeCommonPatterns', () => {
    it('should identify validation patterns', async () => {
      const functions: FunctionInfo[] = [
        createMockFunction('validateEmail', 5, 8, 4),
        createMockFunction('validatePassword', 6, 10, 5),
        createMockFunction('checkUserInput', 4, 7, 3),
        createMockFunction('verifyData', 5, 9, 4)
      ];

      const patterns = analyzer.analyzeCommonPatterns(functions);
      
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe('patterns');
      expect(patterns[0].description).toContain('validation patterns');
      expect(patterns[0].functions).toHaveLength(4);
    });

    it('should identify error handling patterns', async () => {
      const functions: FunctionInfo[] = [
        createMockAsyncFunction('handleError', 8, 12, 2),
        createMockAsyncFunction('processRequest', 10, 15, 3),
        createMockAsyncFunction('fetchData', 12, 18, 2),
        createMockAsyncFunction('saveToDatabase', 9, 14, 2),
        createMockAsyncFunction('sendNotification', 7, 11, 1)
      ];

      const patterns = analyzer.analyzeCommonPatterns(functions);
      
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe('patterns');
      expect(patterns[0].description).toContain('error handling patterns');
      expect(patterns[0].functions).toHaveLength(5);
    });

    it('should identify transformation patterns', async () => {
      const functions: FunctionInfo[] = [
        createMockFunction('transformData', 7, 20, 2),
        createMockFunction('convertToJson', 5, 15, 1),
        createMockFunction('formatOutput', 6, 18, 2),
        createMockFunction('parseInput', 8, 22, 3),
        createMockFunction('serializeData', 7, 19, 2),
        createMockFunction('normalizeValues', 6, 16, 1)
      ];

      const patterns = analyzer.analyzeCommonPatterns(functions);
      
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe('patterns');
      expect(patterns[0].description).toContain('transformation patterns');
      expect(patterns[0].functions).toHaveLength(6);
    });

    it('should identify complex conditional patterns', async () => {
      const functions: FunctionInfo[] = [
        createMockFunction('processOrder', 15, 40, 6, 4),
        createMockFunction('validateForm', 12, 35, 8, 3),
        createMockFunction('routeRequest', 18, 45, 10, 5)
      ];

      const patterns = analyzer.analyzeCommonPatterns(functions);
      
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe('patterns');
      expect(patterns[0].description).toContain('conditional patterns');
      expect(patterns[0].priority).toBe('high');
      expect(patterns[0].functions).toHaveLength(3);
    });
  });

  describe('analyzeRefactoringPriority', () => {
    it('should sort functions by refactoring priority', () => {
      const functions: FunctionInfo[] = [
        createMockFunction('simpleFunction', 3, 10, 1),
        createMockFunction('complexFunction', 15, 50, 8),
        createMockFunction('mediumFunction', 8, 25, 4)
      ];

      const prioritized = analyzer.analyzeRefactoringPriority(functions);
      
      expect(prioritized).toHaveLength(3);
      expect(prioritized[0].name).toBe('complexFunction');
      expect(prioritized[1].name).toBe('mediumFunction');
      expect(prioritized[2].name).toBe('simpleFunction');
    });

    it('should filter out functions without metrics', () => {
      const functions: FunctionInfo[] = [
        createMockFunction('withMetrics', 5, 20, 3),
        createMockFunctionWithoutMetrics('withoutMetrics')
      ];

      const prioritized = analyzer.analyzeRefactoringPriority(functions);
      
      expect(prioritized).toHaveLength(1);
      expect(prioritized[0].name).toBe('withMetrics');
    });
  });

  describe('generateRefactoringPlan', () => {
    it('should create phases based on priority', () => {
      const opportunities = [
        createMockOpportunity('high', 'complexity', 50),
        createMockOpportunity('high', 'similarity', 30),
        createMockOpportunity('medium', 'length', 20),
        createMockOpportunity('low', 'patterns', 10)
      ];

      const plan = analyzer.generateRefactoringPlan(opportunities);
      
      expect(plan.phases).toHaveLength(3);
      expect(plan.phases[0].name).toContain('Critical');
      expect(plan.phases[0].opportunities).toHaveLength(2);
      expect(plan.phases[1].name).toContain('Medium');
      expect(plan.phases[2].name).toContain('Low');
      expect(plan.prerequisites).toHaveLength(4);
    });

    it('should estimate duration correctly', () => {
      const opportunities = [
        createMockOpportunity('high', 'complexity', 100),
        createMockOpportunity('medium', 'similarity', 50)
      ];

      const plan = analyzer.generateRefactoringPlan(opportunities);
      
      expect(plan.estimatedDuration).toBeTruthy();
      expect(typeof plan.estimatedDuration).toBe('string');
    });
  });
});

// Helper functions to create mock data
function createMockFunction(
  name: string, 
  complexity: number, 
  lines: number, 
  branches: number = 0,
  nesting: number = 1
): FunctionInfo {
  return {
    id: `mock-${name}`,
    name,
    displayName: name,
    signature: `function ${name}()`,
    signatureHash: 'mock-hash',
    filePath: `src/${name}.ts`,
    fileHash: 'file-hash',
    startLine: 1,
    endLine: lines + 1,
    startColumn: 0,
    endColumn: 10,
    astHash: 'ast-hash',
    isExported: true,
    isAsync: false,
    isGenerator: false,
    isArrowFunction: false,
    isMethod: false,
    isConstructor: false,
    isStatic: false,
    parameters: [],
    metrics: {
      cyclomaticComplexity: complexity,
      linesOfCode: lines,
      totalLines: lines + 2,
      cognitiveComplexity: complexity * 1.2,
      maxNestingLevel: nesting,
      parameterCount: 2,
      returnStatementCount: 1,
      branchCount: branches,
      loopCount: 1,
      tryCatchCount: 0,
      asyncAwaitCount: 0,
      callbackCount: 0,
      commentLines: 2,
      codeToCommentRatio: lines / 2,
      maintainabilityIndex: 100 - complexity * 2
    }
  };
}

function createMockAsyncFunction(
  name: string, 
  complexity: number, 
  lines: number, 
  tryCatchCount: number = 1
): FunctionInfo {
  const func = createMockFunction(name, complexity, lines);
  func.isAsync = true;
  if (func.metrics) {
    func.metrics.tryCatchCount = tryCatchCount;
    func.metrics.asyncAwaitCount = 2;
  }
  return func;
}

function createMockFunctionWithoutMetrics(name: string): FunctionInfo {
  return {
    id: `mock-${name}`,
    name,
    displayName: name,
    signature: `function ${name}()`,
    signatureHash: 'mock-hash',
    filePath: `src/${name}.ts`,
    fileHash: 'file-hash',
    startLine: 1,
    endLine: 10,
    startColumn: 0,
    endColumn: 10,
    astHash: 'ast-hash',
    isExported: true,
    isAsync: false,
    isGenerator: false,
    isArrowFunction: false,
    isMethod: false,
    isConstructor: false,
    isStatic: false,
    parameters: []
  };
}

function createMockOpportunity(
  priority: 'high' | 'medium' | 'low',
  type: 'complexity' | 'similarity' | 'length' | 'patterns',
  potentialSavings: number
) {
  return {
    type,
    priority,
    functions: [createMockFunction(`${type}Function`, 10, 30, 3)],
    metrics: {
      totalComplexity: 10,
      totalLines: 30,
      avgComplexity: 10,
      maxComplexity: 10,
      potentialSavings
    },
    description: `Mock ${type} opportunity`,
    recommendation: `Refactor ${type} issue`
  };
}