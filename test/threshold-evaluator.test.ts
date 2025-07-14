import { describe, it, expect } from 'vitest';
import { ThresholdEvaluator } from '../src/utils/threshold-evaluator.js';
import type { QualityMetrics, QualityThresholds, RiskAssessmentConfig, ProjectStatistics } from '../src/types/index.js';

const evaluator = new ThresholdEvaluator();

// Sample metrics for testing
const sampleMetrics: QualityMetrics = {
  linesOfCode: 45,
  totalLines: 55,
  cyclomaticComplexity: 15,
  cognitiveComplexity: 20,
  maxNestingLevel: 4,
  parameterCount: 6,
  returnStatementCount: 5,
  branchCount: 8,
  loopCount: 3,
  tryCatchCount: 2,
  asyncAwaitCount: 2,
  callbackCount: 1,
  commentLines: 8,
  codeToCommentRatio: 5.63,
  halsteadVolume: 200,
  halsteadDifficulty: 6,
  maintainabilityIndex: 45
};

// Sample project statistics
const sampleProjectStats: ProjectStatistics = {
  totalFunctions: 5,
  analysisTimestamp: Date.now(),
  metrics: {
    cyclomaticComplexity: {
      mean: 11.2, median: 8, standardDeviation: 8.7, variance: 75.7,
      min: 3, max: 25, mad: 3,
      percentiles: { p25: 5, p50: 8, p75: 15, p90: 22, p95: 25, p99: 25 }
    },
    linesOfCode: {
      mean: 35, median: 25, standardDeviation: 28.7, variance: 823.5,
      min: 10, max: 80, mad: 10,
      percentiles: { p25: 15, p50: 25, p75: 45, p90: 70, p95: 80, p99: 80 }
    },
    parameterCount: {
      mean: 4.6, median: 4, standardDeviation: 2.4, variance: 5.8,
      min: 2, max: 8, mad: 1,
      percentiles: { p25: 3, p50: 4, p75: 6, p90: 7, p95: 8, p99: 8 }
    },
    maintainabilityIndex: {
      mean: 59, median: 65, standardDeviation: 24.2, variance: 585.6,
      min: 25, max: 85, mad: 20,
      percentiles: { p25: 45, p50: 65, p75: 75, p90: 82, p95: 85, p99: 85 }
    },
    cognitiveComplexity: {
      mean: 15.4, median: 12, standardDeviation: 12.8, variance: 163.8,
      min: 2, max: 35, mad: 8,
      percentiles: { p25: 8, p50: 12, p75: 20, p90: 30, p95: 35, p99: 35 }
    },
    totalLines: {
      mean: 43, median: 35, standardDeviation: 32.4, variance: 1049.6,
      min: 15, max: 95, mad: 15,
      percentiles: { p25: 20, p50: 35, p75: 55, p90: 85, p95: 95, p99: 95 }
    },
    maxNestingLevel: {
      mean: 3.2, median: 3, standardDeviation: 1.9, variance: 3.6,
      min: 1, max: 6, mad: 1,
      percentiles: { p25: 2, p50: 3, p75: 4, p90: 5, p95: 6, p99: 6 }
    },
    returnStatementCount: {
      mean: 3.4, median: 3, standardDeviation: 2.9, variance: 8.4,
      min: 1, max: 8, mad: 2,
      percentiles: { p25: 2, p50: 3, p75: 5, p90: 7, p95: 8, p99: 8 }
    },
    branchCount: {
      mean: 5.4, median: 5, standardDeviation: 4.3, variance: 18.5,
      min: 1, max: 12, mad: 3,
      percentiles: { p25: 3, p50: 5, p75: 8, p90: 11, p95: 12, p99: 12 }
    },
    loopCount: {
      mean: 2.2, median: 2, standardDeviation: 1.9, variance: 3.6,
      min: 0, max: 5, mad: 1,
      percentiles: { p25: 1, p50: 2, p75: 3, p90: 4, p95: 5, p99: 5 }
    },
    tryCatchCount: {
      mean: 1.2, median: 1, standardDeviation: 1.1, variance: 1.2,
      min: 0, max: 3, mad: 1,
      percentiles: { p25: 0, p50: 1, p75: 2, p90: 3, p95: 3, p99: 3 }
    },
    asyncAwaitCount: {
      mean: 1.2, median: 1, standardDeviation: 1.3, variance: 1.7,
      min: 0, max: 3, mad: 1,
      percentiles: { p25: 0, p50: 1, p75: 2, p90: 3, p95: 3, p99: 3 }
    },
    callbackCount: {
      mean: 0.4, median: 0, standardDeviation: 0.5, variance: 0.3,
      min: 0, max: 1, mad: 0,
      percentiles: { p25: 0, p50: 0, p75: 1, p90: 1, p95: 1, p99: 1 }
    },
    commentLines: {
      mean: 6.2, median: 5, standardDeviation: 3.6, variance: 13.0,
      min: 3, max: 12, mad: 2,
      percentiles: { p25: 4, p50: 5, p75: 8, p90: 11, p95: 12, p99: 12 }
    },
    codeToCommentRatio: {
      mean: 4.9, median: 5.6, standardDeviation: 1.4, variance: 2.0,
      min: 3.3, max: 6.7, mad: 1.0,
      percentiles: { p25: 3.8, p50: 5.6, p75: 6.0, p90: 6.5, p95: 6.7, p99: 6.7 }
    },
    halsteadVolume: {
      mean: 174, median: 150, standardDeviation: 119.2, variance: 14208.4,
      min: 50, max: 350, mad: 75,
      percentiles: { p25: 75, p50: 150, p75: 200, p90: 320, p95: 350, p99: 350 }
    },
    halsteadDifficulty: {
      mean: 4.6, median: 4, standardDeviation: 2.4, variance: 5.8,
      min: 2, max: 8, mad: 2,
      percentiles: { p25: 3, p50: 4, p75: 6, p90: 7, p95: 8, p99: 8 }
    }
  } as ProjectStatistics // Simplified for testing
};

describe('ThresholdEvaluator', () => {
  describe('evaluateFunctionThresholds', () => {
    it('should evaluate absolute thresholds correctly', () => {
      const thresholds: QualityThresholds = {
        complexity: {
          warning: 10,
          error: 15,
          critical: 20
        },
        lines: {
          warning: 30,
          error: 50,
          critical: 100
        },
        parameters: {
          warning: 4,
          error: 6,
          critical: 8
        }
      };

      const violations = evaluator.evaluateFunctionThresholds(
        sampleMetrics,
        thresholds,
        sampleProjectStats
      );

      expect(violations).toHaveLength(3);
      
      // Complexity: 15 exceeds warning (10) but meets error threshold (15), should be error level
      const complexityViolation = violations.find(v => v.metric === 'cyclomaticComplexity');
      expect(complexityViolation?.level).toBe('error');
      expect(complexityViolation?.value).toBe(15);
      expect(complexityViolation?.threshold).toBe(15);

      // Lines: 45 should trigger warning (exceeds 30, but not 50)
      const linesViolation = violations.find(v => v.metric === 'linesOfCode');
      expect(linesViolation?.level).toBe('warning');
      expect(linesViolation?.value).toBe(45);
      expect(linesViolation?.threshold).toBe(30);

      // Parameters: 6 = error level (exceeds 6)
      const paramViolation = violations.find(v => v.metric === 'parameterCount');
      expect(paramViolation?.level).toBe('error');
      expect(paramViolation?.value).toBe(6);
      expect(paramViolation?.threshold).toBe(6);
    });

    it('should evaluate statistical thresholds correctly', () => {
      const thresholds: QualityThresholds = {
        complexity: {
          warning: { method: 'mean+sigma', multiplier: 0.3 }, // Lower multiplier to trigger violation
          error: { method: 'mean+sigma', multiplier: 2 },
          critical: { method: 'percentile', percentile: 95 }
        }
      };

      const violations = evaluator.evaluateFunctionThresholds(
        sampleMetrics,
        thresholds,
        sampleProjectStats
      );

      const complexityViolation = violations.find(v => v.metric === 'cyclomaticComplexity');
      expect(complexityViolation).toBeDefined();
      expect(complexityViolation?.method).toBe('statistical');
      expect(complexityViolation?.statisticalContext?.method).toBe('mean+sigma');
    });

    it('should return empty array when no thresholds are violated', () => {
      const thresholds: QualityThresholds = {
        complexity: {
          warning: 50, // Very high thresholds
          error: 100,
          critical: 200
        }
      };

      const violations = evaluator.evaluateFunctionThresholds(
        sampleMetrics,
        thresholds,
        sampleProjectStats
      );

      expect(violations).toHaveLength(0);
    });

    it('should handle missing metrics gracefully', () => {
      const incompleteMetrics = { ...sampleMetrics };
      (incompleteMetrics as any).cyclomaticComplexity = undefined;

      const thresholds: QualityThresholds = {
        complexity: { warning: 10 }
      };

      const violations = evaluator.evaluateFunctionThresholds(
        incompleteMetrics,
        thresholds,
        sampleProjectStats
      );

      expect(violations).toHaveLength(0);
    });
  });

  describe('assessFunctionRisk', () => {
    it('should assess risk correctly with multiple violations', () => {
      const violations = [
        {
          metric: 'cyclomaticComplexity' as const,
          value: 25,
          threshold: 15,
          level: 'error' as const,
          excess: 10,
          method: 'absolute' as const
        },
        {
          metric: 'linesOfCode' as const,
          value: 120,
          threshold: 100,
          level: 'critical' as const,
          excess: 20,
          method: 'absolute' as const
        }
      ];

      const assessment = evaluator.assessFunctionRisk(
        'func-1', 
        'testFunction', 
        '/test/file.ts', 
        1, 
        50,
        sampleMetrics,
        violations
      );

      expect(assessment.functionId).toBe('func-1');
      expect(assessment.violations).toHaveLength(2);
      expect(assessment.totalViolations).toBe(2);
      expect(assessment.riskLevel).toBe('high'); // Due to critical violation
      expect(assessment.violationsByLevel.error).toBe(1);
      expect(assessment.violationsByLevel.critical).toBe(1);
      expect(assessment.riskScore).toBeGreaterThan(0);
    });

    it('should assign medium risk for error violations without critical', () => {
      const violations = [
        {
          metric: 'cyclomaticComplexity' as const,
          value: 18,
          threshold: 15,
          level: 'error' as const,
          excess: 3,
          method: 'absolute' as const
        }
      ];

      const assessment = evaluator.assessFunctionRisk(
        'func-2', 
        'testFunction2', 
        '/test/file2.ts', 
        1, 
        30,
        sampleMetrics,
        violations
      );

      expect(assessment.riskLevel).toBe('medium');
    });

    it('should assign low risk for only warning violations', () => {
      const violations = [
        {
          metric: 'parameterCount' as const,
          value: 5,
          threshold: 4,
          level: 'warning' as const,
          excess: 1,
          method: 'absolute' as const
        }
      ];

      const assessment = evaluator.assessFunctionRisk(
        'func-3', 
        'testFunction3', 
        '/test/file3.ts', 
        1, 
        20,
        sampleMetrics,
        violations
      );

      expect(assessment.riskLevel).toBe('low');
    });

    it('should use custom assessment configuration', () => {
      const violations = [
        {
          metric: 'cyclomaticComplexity' as const,
          value: 12,
          threshold: 10,
          level: 'warning' as const,
          excess: 2,
          method: 'absolute' as const
        }
      ];

      const config: RiskAssessmentConfig = {
        minViolations: 1, // Lower threshold
        violationWeights: { warning: 5, error: 10, critical: 20 },
        compositeScoringMethod: 'weighted'
      };

      const assessment = evaluator.assessFunctionRisk(
        'func-4', 
        'testFunction4', 
        '/test/file4.ts', 
        1, 
        25,
        sampleMetrics,
        violations, 
        config
      );

      expect(assessment.riskLevel).toBe('medium'); // Only warning, but meets minViolations so escalated
      expect(assessment.riskScore).toBe(1); // 5 weight * (2 excess / 10 threshold) = 5 * 0.2 = 1
    });
  });

  describe('getDefaultQualityThresholds', () => {
    it('should provide sensible default thresholds', () => {
      const defaults = evaluator.getDefaultQualityThresholds();

      expect(defaults.complexity?.warning).toBe(8);
      expect(defaults.complexity?.error).toBe(12);
      expect(defaults.complexity?.critical).toBe(15);

      expect(defaults.lines?.warning).toBe(40);
      expect(defaults.lines?.error).toBe(60);
      expect(defaults.lines?.critical).toBe(80);

      expect(defaults.parameters?.warning).toBe(5);
      expect(defaults.parameters?.error).toBe(6);
      expect(defaults.parameters?.critical).toBe(8);
    });
  });

  describe('mergeWithDefaults', () => {
    it('should merge user thresholds with defaults', () => {
      const userThresholds: QualityThresholds = {
        complexity: {
          warning: 12, // Override default
          // error and critical use defaults
        },
        lines: {
          critical: 200 // Override only critical
        }
        // Other metrics use all defaults
      };

      const merged = evaluator.mergeWithDefaults(userThresholds);

      expect(merged.complexity?.warning).toBe(12); // User override
      expect(merged.complexity?.error).toBe(12); // Default from getDefaultQualityThresholds
      expect(merged.complexity?.critical).toBe(15); // Default

      expect(merged.lines?.warning).toBe(40); // Default
      expect(merged.lines?.error).toBe(60); // Default
      expect(merged.lines?.critical).toBe(200); // User override

      expect(merged.parameters?.warning).toBe(5); // All defaults
    });

    it('should return defaults when no user thresholds provided', () => {
      const merged = evaluator.mergeWithDefaults();
      const defaults = evaluator.getDefaultQualityThresholds();

      expect(merged).toEqual(defaults);
    });
  });

  describe('generateProjectRiskAssessment', () => {
    it('should generate comprehensive project assessment', () => {
      const functionAssessments = [
        {
          functionId: 'func-1',
          violations: [{ level: 'critical' as const } as any],
          totalViolations: 1,
          riskLevel: 'high' as const,
          riskScore: 50,
          violationsByLevel: { warning: 0, error: 0, critical: 1 }
        },
        {
          functionId: 'func-2',
          violations: [{ level: 'error' as const } as any],
          totalViolations: 1,
          riskLevel: 'medium' as const,
          riskScore: 20,
          violationsByLevel: { warning: 0, error: 1, critical: 0 }
        },
        {
          functionId: 'func-3',
          violations: [],
          totalViolations: 0,
          riskLevel: 'low' as const,
          riskScore: 0,
          violationsByLevel: { warning: 0, error: 0, critical: 0 }
        }
      ];

      const thresholds = evaluator.getDefaultQualityThresholds();
      const assessment = evaluator.generateProjectRiskAssessment(
        functionAssessments,
        sampleProjectStats,
        thresholds
      );

      expect(assessment.totalFunctions).toBe(5);
      expect(assessment.assessedFunctions).toBe(3);
      expect(assessment.riskDistribution.high).toBe(1);
      expect(assessment.riskDistribution.medium).toBe(1);
      expect(assessment.riskDistribution.low).toBe(1);
      expect(assessment.worstFunctions).toHaveLength(2); // Only functions with violations
      expect(assessment.statistics).toBe(sampleProjectStats);
      expect(assessment.configuredThresholds).toBe(thresholds);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty violations list', () => {
      const assessment = evaluator.assessFunctionRisk(
        'func-empty', 
        'emptyFunction', 
        '/test/empty.ts', 
        1, 
        5,
        sampleMetrics,
        []
      );

      expect(assessment.totalViolations).toBe(0);
      expect(assessment.riskLevel).toBe('low');
      expect(assessment.riskScore).toBe(0);
    });

    it('should handle undefined threshold values', () => {
      const thresholds: QualityThresholds = {
        complexity: {
          warning: undefined,
          error: 15,
          critical: undefined
        }
      };

      const violations = evaluator.evaluateFunctionThresholds(
        sampleMetrics,
        thresholds,
        sampleProjectStats
      );

      // Should only find error level violation (complexity = 15 meets error threshold = 10)
      expect(violations).toHaveLength(1);
      expect(violations[0].level).toBe('error');
    });

    it('should prioritize highest violation level', () => {
      const thresholds: QualityThresholds = {
        complexity: {
          warning: 5,   // Will be violated
          error: 10,    // Will be violated
          critical: 12  // Will be violated (complexity = 15)
        }
      };

      const violations = evaluator.evaluateFunctionThresholds(
        sampleMetrics,
        thresholds,
        sampleProjectStats
      );

      // Should only return the highest level (critical)
      expect(violations).toHaveLength(1);
      expect(violations[0].level).toBe('critical');
    });
  });
});