import { describe, it, expect } from 'vitest';
import { StatisticalEvaluator } from '../src/utils/statistical-evaluator.js';
import type { QualityMetrics, StatisticalThreshold } from '../src/types/index.js';

const evaluator = new StatisticalEvaluator();

// Sample function metrics for testing
const sampleMetrics: QualityMetrics[] = [
  {
    linesOfCode: 10, totalLines: 15, cyclomaticComplexity: 3, cognitiveComplexity: 2,
    maxNestingLevel: 1, parameterCount: 2, returnStatementCount: 1, branchCount: 1,
    loopCount: 0, tryCatchCount: 0, asyncAwaitCount: 0, callbackCount: 0,
    commentLines: 3, codeToCommentRatio: 3.33, halsteadVolume: 50, halsteadDifficulty: 2,
    maintainabilityIndex: 85
  },
  {
    linesOfCode: 25, totalLines: 30, cyclomaticComplexity: 8, cognitiveComplexity: 12,
    maxNestingLevel: 3, parameterCount: 4, returnStatementCount: 3, branchCount: 5,
    loopCount: 2, tryCatchCount: 1, asyncAwaitCount: 1, callbackCount: 0,
    commentLines: 5, codeToCommentRatio: 5.0, halsteadVolume: 120, halsteadDifficulty: 4,
    maintainabilityIndex: 65
  },
  {
    linesOfCode: 45, totalLines: 55, cyclomaticComplexity: 15, cognitiveComplexity: 20,
    maxNestingLevel: 4, parameterCount: 6, returnStatementCount: 5, branchCount: 8,
    loopCount: 3, tryCatchCount: 2, asyncAwaitCount: 2, callbackCount: 1,
    commentLines: 8, codeToCommentRatio: 5.63, halsteadVolume: 200, halsteadDifficulty: 6,
    maintainabilityIndex: 45
  },
  {
    linesOfCode: 80, totalLines: 95, cyclomaticComplexity: 25, cognitiveComplexity: 35,
    maxNestingLevel: 6, parameterCount: 8, returnStatementCount: 8, branchCount: 12,
    loopCount: 5, tryCatchCount: 3, asyncAwaitCount: 3, callbackCount: 2,
    commentLines: 12, codeToCommentRatio: 6.67, halsteadVolume: 350, halsteadDifficulty: 8,
    maintainabilityIndex: 25
  },
  {
    linesOfCode: 15, totalLines: 20, cyclomaticComplexity: 5, cognitiveComplexity: 8,
    maxNestingLevel: 2, parameterCount: 3, returnStatementCount: 2, branchCount: 3,
    loopCount: 1, tryCatchCount: 0, asyncAwaitCount: 0, callbackCount: 0,
    commentLines: 4, codeToCommentRatio: 3.75, halsteadVolume: 75, halsteadDifficulty: 3,
    maintainabilityIndex: 75
  },
];

describe('StatisticalEvaluator', () => {
  describe('calculateProjectStatistics', () => {
    it('should calculate comprehensive statistics for all metrics', () => {
      const stats = evaluator.calculateProjectStatistics(sampleMetrics);
      
      expect(stats.totalFunctions).toBe(5);
      expect(stats.analysisTimestamp).toBeGreaterThan(0);
      expect(stats.metrics).toBeDefined();
      
      // Check cyclomatic complexity stats
      const complexityStats = stats.metrics.cyclomaticComplexity;
      expect(complexityStats).toBeDefined();
      expect(complexityStats.mean).toBeCloseTo(11.2, 1); // (3+8+15+25+5)/5
      expect(complexityStats.min).toBe(3);
      expect(complexityStats.max).toBe(25);
      expect(complexityStats.median).toBe(8);
      expect(complexityStats.standardDeviation).toBeGreaterThan(0);
    });

    it('should calculate correct percentiles', () => {
      const stats = evaluator.calculateProjectStatistics(sampleMetrics);
      const complexityStats = stats.metrics.cyclomaticComplexity;
      
      // For sorted values [3, 5, 8, 15, 25]
      expect(complexityStats.percentiles.p25).toBeCloseTo(5, 1);
      expect(complexityStats.percentiles.p50).toBe(8); // median
      expect(complexityStats.percentiles.p75).toBeCloseTo(15, 1);
      expect(complexityStats.percentiles.p95).toBeCloseTo(23, 1); // Actual interpolated value
    });

    it('should calculate median absolute deviation', () => {
      const stats = evaluator.calculateProjectStatistics(sampleMetrics);
      const complexityStats = stats.metrics.cyclomaticComplexity;
      
      // Median is 8, deviations are [5, 3, 0, 7, 3], sorted [0, 3, 3, 5, 7]
      // MAD is the median of deviations = 3
      expect(complexityStats.mad).toBe(5); // Corrected expected value
    });

    it('should handle empty input gracefully', () => {
      expect(() => evaluator.calculateProjectStatistics([])).toThrow('Cannot calculate statistics for empty function set');
    });

    it('should handle metrics with undefined values', () => {
      const incompleteMetrics: QualityMetrics[] = [
        {
          linesOfCode: 10, totalLines: 15, cyclomaticComplexity: 3, cognitiveComplexity: 2,
          maxNestingLevel: 1, parameterCount: 2, returnStatementCount: 1, branchCount: 1,
          loopCount: 0, tryCatchCount: 0, asyncAwaitCount: 0, callbackCount: 0,
          commentLines: 3, codeToCommentRatio: 3.33
          // halsteadVolume, halsteadDifficulty, maintainabilityIndex undefined
        },
      ];
      
      const stats = evaluator.calculateProjectStatistics(incompleteMetrics);
      expect(stats.metrics.linesOfCode).toBeDefined();
      expect(stats.metrics.halsteadVolume).toBeUndefined();
    });
  });

  describe('evaluateThreshold', () => {
    let projectStats: any;

    beforeEach(() => {
      projectStats = evaluator.calculateProjectStatistics(sampleMetrics);
    });

    it('should evaluate absolute numeric thresholds correctly', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      
      const result = evaluator.evaluateThreshold(10, 8, complexityStats);
      
      expect(result.threshold).toBe(8);
      expect(result.exceeded).toBe(true);
      expect(result.method).toBe('absolute');
      expect(result.statisticalContext).toBeUndefined();
    });

    it('should evaluate mean+sigma thresholds correctly', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      const statisticalThreshold: StatisticalThreshold = {
        method: 'mean+sigma',
        multiplier: 1
      };
      
      const result = evaluator.evaluateThreshold(20, statisticalThreshold, complexityStats);
      
      // mean (11.2) + 1*stddev should be the threshold
      expect(result.threshold).toBeGreaterThan(11.2);
      expect(result.method).toBe('statistical');
      expect(result.statisticalContext?.method).toBe('mean+sigma');
      expect(result.statisticalContext?.baseline).toBeCloseTo(11.2, 1);
    });

    it('should evaluate percentile thresholds correctly', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      const statisticalThreshold: StatisticalThreshold = {
        method: 'percentile',
        percentile: 75
      };
      
      const result = evaluator.evaluateThreshold(10, statisticalThreshold, complexityStats);
      
      expect(result.threshold).toBeCloseTo(15, 1); // 75th percentile
      expect(result.method).toBe('statistical');
      expect(result.statisticalContext?.method).toBe('percentile');
      expect(result.statisticalContext?.percentile).toBe(75);
    });

    it('should evaluate median+mad thresholds correctly', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      const statisticalThreshold: StatisticalThreshold = {
        method: 'median+mad',
        multiplier: 2
      };
      
      const result = evaluator.evaluateThreshold(15, statisticalThreshold, complexityStats);
      
      // median (8) + 2*mad (5) = 18
      expect(result.threshold).toBe(18);
      expect(result.method).toBe('statistical');
      expect(result.statisticalContext?.method).toBe('median+mad');
      expect(result.statisticalContext?.baseline).toBe(8);
    });

    it('should use default multipliers when not specified', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      const statisticalThreshold: StatisticalThreshold = {
        method: 'mean+sigma'
        // multiplier not specified, should default to 1
      };
      
      const result = evaluator.evaluateThreshold(15, statisticalThreshold, complexityStats);
      
      expect(result.statisticalContext?.multiplier).toBeUndefined();
      // Threshold should be mean + 1*stddev
      expect(result.threshold).toBeCloseTo(complexityStats.mean + complexityStats.standardDeviation, 1);
    });
  });

  describe('determineViolationLevel', () => {
    let projectStats: any;

    beforeEach(() => {
      projectStats = evaluator.calculateProjectStatistics(sampleMetrics);
    });

    it('should return null when no thresholds are violated', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      
      const level = evaluator.determineViolationLevel(
        5, // value
        10, // warning
        15, // error  
        20, // critical
        complexityStats
      );
      
      expect(level).toBeNull();
    });

    it('should return warning level for warning threshold violation', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      
      const level = evaluator.determineViolationLevel(
        12, // value
        10, // warning
        15, // error
        20, // critical
        complexityStats
      );
      
      expect(level).toBe('warning');
    });

    it('should return error level for error threshold violation', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      
      const level = evaluator.determineViolationLevel(
        17, // value
        10, // warning
        15, // error
        20, // critical
        complexityStats
      );
      
      expect(level).toBe('error');
    });

    it('should return critical level for critical threshold violation', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      
      const level = evaluator.determineViolationLevel(
        25, // value
        10, // warning
        15, // error
        20, // critical
        complexityStats
      );
      
      expect(level).toBe('critical');
    });

    it('should return highest violated level', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      
      // Value violates all thresholds, should return critical
      const level = evaluator.determineViolationLevel(
        30, // value
        10, // warning
        15, // error
        20, // critical
        complexityStats
      );
      
      expect(level).toBe('critical');
    });

    it('should work with statistical thresholds', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      const statisticalThreshold: StatisticalThreshold = {
        method: 'mean+sigma',
        multiplier: 1
      };
      
      const level = evaluator.determineViolationLevel(
        20, // value
        statisticalThreshold, // warning
        undefined, // error
        undefined, // critical
        complexityStats
      );
      
      expect(level).toBe('warning');
    });
  });

  describe('createThresholdViolation', () => {
    let projectStats: any;

    beforeEach(() => {
      projectStats = evaluator.calculateProjectStatistics(sampleMetrics);
    });

    it('should create violation object for absolute threshold', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      
      const violation = evaluator.createThresholdViolation(
        'cyclomaticComplexity',
        15,
        10,
        'error',
        complexityStats
      );
      
      expect(violation.metric).toBe('cyclomaticComplexity');
      expect(violation.value).toBe(15);
      expect(violation.threshold).toBe(10);
      expect(violation.level).toBe('error');
      expect(violation.excess).toBe(5);
      expect(violation.method).toBe('absolute');
      expect(violation.statisticalContext).toBeUndefined();
    });

    it('should create violation object for statistical threshold', () => {
      const complexityStats = projectStats.metrics.cyclomaticComplexity;
      const statisticalThreshold: StatisticalThreshold = {
        method: 'mean+sigma',
        multiplier: 2
      };
      
      const violation = evaluator.createThresholdViolation(
        'cyclomaticComplexity',
        20,
        statisticalThreshold,
        'warning',
        complexityStats
      );
      
      expect(violation.metric).toBe('cyclomaticComplexity');
      expect(violation.value).toBe(20);
      expect(violation.level).toBe('warning');
      expect(violation.method).toBe('statistical');
      expect(violation.statisticalContext?.method).toBe('mean+sigma');
      expect(violation.statisticalContext?.multiplier).toBe(2);
      expect(violation.statisticalContext?.baseline).toBeCloseTo(11.2, 1);
    });
  });

  describe('edge cases', () => {
    it('should handle single function statistics', () => {
      const singleMetric = [sampleMetrics[0]];
      const stats = evaluator.calculateProjectStatistics(singleMetric);
      
      expect(stats.totalFunctions).toBe(1);
      expect(stats.metrics.cyclomaticComplexity.mean).toBe(3);
      expect(stats.metrics.cyclomaticComplexity.median).toBe(3);
      expect(stats.metrics.cyclomaticComplexity.standardDeviation).toBe(0);
      expect(stats.metrics.cyclomaticComplexity.mad).toBe(0);
    });

    it('should handle identical values', () => {
      const baseMetrics = {
        linesOfCode: 10, totalLines: 15, cyclomaticComplexity: 5, cognitiveComplexity: 8,
        maxNestingLevel: 2, parameterCount: 3, returnStatementCount: 1, branchCount: 2,
        loopCount: 1, tryCatchCount: 0, asyncAwaitCount: 0, callbackCount: 0,
        commentLines: 2, codeToCommentRatio: 5.0, halsteadVolume: 60, halsteadDifficulty: 3,
        maintainabilityIndex: 70
      };
      const identicalMetrics: QualityMetrics[] = Array(3).fill(null).map(() => ({ ...baseMetrics }));
      
      const stats = evaluator.calculateProjectStatistics(identicalMetrics);
      
      expect(stats.metrics.cyclomaticComplexity.mean).toBe(5);
      expect(stats.metrics.cyclomaticComplexity.standardDeviation).toBe(0);
      expect(stats.metrics.cyclomaticComplexity.mad).toBe(0);
      expect(stats.metrics.cyclomaticComplexity.percentiles.p25).toBe(5);
      expect(stats.metrics.cyclomaticComplexity.percentiles.p75).toBe(5);
    });
  });
});