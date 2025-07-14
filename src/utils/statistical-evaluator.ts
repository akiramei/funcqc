import {
  QualityMetrics,
  ProjectStatistics,
  MetricStatistics,
  StatisticalThreshold,
  ThresholdValue,
  ThresholdViolation,
  ViolationLevel,
} from '../types/index.js';

/**
 * Statistical evaluator for project-wide quality metrics analysis
 */
export class StatisticalEvaluator {
  /**
   * Calculate comprehensive statistics for all quality metrics across functions
   */
  calculateProjectStatistics(functionMetrics: QualityMetrics[]): ProjectStatistics {
    if (functionMetrics.length === 0) {
      throw new Error('Cannot calculate statistics for empty function set');
    }

    const metricKeys = [
      'linesOfCode',
      'totalLines',
      'cyclomaticComplexity',
      'cognitiveComplexity',
      'maxNestingLevel',
      'parameterCount',
      'returnStatementCount',
      'branchCount',
      'loopCount',
      'tryCatchCount',
      'asyncAwaitCount',
      'callbackCount',
      'commentLines',
      'codeToCommentRatio',
      'halsteadVolume',
      'halsteadDifficulty',
      'maintainabilityIndex',
    ] as const;

    const statistics: Record<keyof QualityMetrics, MetricStatistics> = {} as Record<
      keyof QualityMetrics,
      MetricStatistics
    >;

    for (const key of metricKeys) {
      const values = functionMetrics
        .map(m => m[key])
        .filter((v): v is number => v !== undefined && v !== null && !isNaN(v));

      if (values.length > 0) {
        // Pass unsorted values - sorting will be done once in calculateMetricStatistics
        statistics[key] = this.calculateMetricStatistics(values);
      }
    }

    return {
      metrics: statistics,
      totalFunctions: functionMetrics.length,
      analysisTimestamp: Date.now(),
    };
  }

  /**
   * Calculate statistical measures for a single metric with unbiased variance
   */
  private calculateMetricStatistics(values: number[]): MetricStatistics {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    // Basic measures
    const min = sorted[0];
    const max = sorted[n - 1];
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const mean = sum / n;

    // Median
    const median =
      n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];

    // Unbiased variance and standard deviation for small samples
    const varianceSum = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
    const variance = n > 1 ? varianceSum / (n - 1) : 0; // Unbiased estimator (n-1)
    const standardDeviation = Math.sqrt(variance);

    // Percentiles
    const percentiles = {
      p25: this.calculatePercentile(sorted, 25),
      p50: median,
      p75: this.calculatePercentile(sorted, 75),
      p90: this.calculatePercentile(sorted, 90),
      p95: this.calculatePercentile(sorted, 95),
      p99: this.calculatePercentile(sorted, 99),
    };

    // Median Absolute Deviation (MAD)
    const deviationsFromMedian = sorted.map(val => Math.abs(val - median)).sort((a, b) => a - b);
    const mad =
      deviationsFromMedian.length % 2 === 0
        ? (deviationsFromMedian[deviationsFromMedian.length / 2 - 1] +
            deviationsFromMedian[deviationsFromMedian.length / 2]) /
          2
        : deviationsFromMedian[Math.floor(deviationsFromMedian.length / 2)];

    return {
      mean,
      median,
      standardDeviation,
      variance,
      min,
      max,
      percentiles,
      mad,
    };
  }

  /**
   * Calculate percentile value for sorted array
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (percentile < 0 || percentile > 100) {
      throw new Error('Percentile must be between 0 and 100');
    }

    const n = sortedValues.length;
    const rank = (percentile / 100) * (n - 1);
    const lowerIndex = Math.floor(rank);
    const upperIndex = Math.ceil(rank);

    if (lowerIndex === upperIndex) {
      return sortedValues[lowerIndex];
    }

    const lowerValue = sortedValues[lowerIndex];
    const upperValue = sortedValues[upperIndex];
    const fractionalPart = rank - lowerIndex;

    return lowerValue + fractionalPart * (upperValue - lowerValue);
  }

  /**
   * Evaluate a threshold value against project statistics
   */
  evaluateThreshold(
    value: number,
    threshold: ThresholdValue,
    statistics: MetricStatistics
  ): {
    threshold: number;
    exceeded: boolean;
    method: 'absolute' | 'statistical';
    statisticalContext?: Record<string, unknown>;
  } {
    if (typeof threshold === 'number') {
      return {
        threshold,
        exceeded: value >= threshold,
        method: 'absolute',
      };
    }

    // Statistical threshold evaluation
    const calculatedThreshold = this.calculateStatisticalThreshold(threshold, statistics);

    return {
      threshold: calculatedThreshold,
      exceeded: value >= calculatedThreshold,
      method: 'statistical',
      statisticalContext: {
        method: threshold.method,
        multiplier: threshold.multiplier,
        percentile: threshold.percentile,
        baseline: this.getBaseline(threshold.method, statistics),
      },
    };
  }

  /**
   * Calculate numerical threshold from statistical method
   */
  private calculateStatisticalThreshold(
    threshold: StatisticalThreshold,
    statistics: MetricStatistics
  ): number {
    switch (threshold.method) {
      case 'mean+sigma': {
        const multiplier = threshold.multiplier ?? 1;
        return statistics.mean + multiplier * statistics.standardDeviation;
      }

      case 'percentile': {
        const percentile = threshold.percentile ?? 95;
        return this.getPercentileValue(statistics, percentile);
      }

      case 'median+mad': {
        const multiplier = threshold.multiplier ?? 1;
        return statistics.median + multiplier * statistics.mad;
      }

      default:
        throw new Error(
          `Unknown statistical threshold method: ${(threshold as StatisticalThreshold).method}`
        );
    }
  }

  /**
   * Get baseline value for statistical method
   */
  private getBaseline(
    method: StatisticalThreshold['method'],
    statistics: MetricStatistics
  ): number {
    switch (method) {
      case 'mean+sigma':
        return statistics.mean;
      case 'median+mad':
        return statistics.median;
      case 'percentile':
        return 0; // Percentile doesn't have a baseline
      default:
        return 0;
    }
  }

  /**
   * Get percentile value from statistics
   */
  private getPercentileValue(statistics: MetricStatistics, percentile: number): number {
    const percentiles = statistics.percentiles;

    switch (percentile) {
      case 25:
        return percentiles.p25;
      case 50:
        return percentiles.p50;
      case 75:
        return percentiles.p75;
      case 90:
        return percentiles.p90;
      case 95:
        return percentiles.p95;
      case 99:
        return percentiles.p99;
      default:
        // Interpolation between known percentiles with extrapolation protection
        if (percentile <= 1) return percentiles.p25; // Avoid extrapolation below P1
        if (percentile < 25) return percentiles.p25;
        if (percentile < 50)
          return percentiles.p25 + ((percentiles.p50 - percentiles.p25) * (percentile - 25)) / 25;
        if (percentile < 75)
          return percentiles.p50 + ((percentiles.p75 - percentiles.p50) * (percentile - 50)) / 25;
        if (percentile < 90)
          return percentiles.p75 + ((percentiles.p90 - percentiles.p75) * (percentile - 75)) / 15;
        if (percentile < 95)
          return percentiles.p90 + ((percentiles.p95 - percentiles.p90) * (percentile - 90)) / 5;
        if (percentile < 99)
          return percentiles.p95 + ((percentiles.p99 - percentiles.p95) * (percentile - 95)) / 4;
        // For P99+ avoid extrapolation, use max value directly
        return percentiles.p99;
    }
  }

  /**
   * Determine violation level based on which thresholds are exceeded
   */
  determineViolationLevel(
    value: number,
    warningThreshold?: ThresholdValue,
    errorThreshold?: ThresholdValue,
    criticalThreshold?: ThresholdValue,
    statistics?: MetricStatistics
  ): ViolationLevel | null {
    this.validateStatisticalRequirements(
      warningThreshold,
      errorThreshold,
      criticalThreshold,
      statistics
    );

    return this.checkThresholdViolations(
      value,
      warningThreshold,
      errorThreshold,
      criticalThreshold,
      statistics
    );
  }

  private validateStatisticalRequirements(
    warningThreshold?: ThresholdValue,
    errorThreshold?: ThresholdValue,
    criticalThreshold?: ThresholdValue,
    statistics?: MetricStatistics
  ): void {
    if (!statistics && (warningThreshold || errorThreshold || criticalThreshold)) {
      const hasStatisticalThreshold = [warningThreshold, errorThreshold, criticalThreshold].some(
        t => t && typeof t === 'object'
      );

      if (hasStatisticalThreshold) {
        throw new Error('Project statistics required for statistical threshold evaluation');
      }
    }
  }

  private checkThresholdViolations(
    value: number,
    warningThreshold?: ThresholdValue,
    errorThreshold?: ThresholdValue,
    criticalThreshold?: ThresholdValue,
    statistics?: MetricStatistics
  ): ViolationLevel | null {
    const thresholds = [
      { level: 'critical' as const, threshold: criticalThreshold },
      { level: 'error' as const, threshold: errorThreshold },
      { level: 'warning' as const, threshold: warningThreshold },
    ];

    for (const { level, threshold } of thresholds) {
      if (threshold && statistics) {
        const result = this.evaluateThreshold(value, threshold, statistics);
        if (result.exceeded) return level;
      }
    }

    return null;
  }

  /**
   * Create a threshold violation object
   */
  createThresholdViolation(
    metric: keyof QualityMetrics,
    value: number,
    threshold: ThresholdValue,
    level: ViolationLevel,
    statistics: MetricStatistics
  ): ThresholdViolation {
    const evaluation = this.evaluateThreshold(value, threshold, statistics);

    // Calculate excess based on metric type
    // For maintainability (lower is worse), excess = threshold - value
    // For others (higher is worse), excess = value - threshold
    const isLowerIsBetter = metric === 'maintainabilityIndex';
    const excess = isLowerIsBetter 
      ? Math.max(0, evaluation.threshold - value)
      : Math.max(0, value - evaluation.threshold);

    const violation: ThresholdViolation = {
      metric,
      value,
      threshold: evaluation.threshold,
      level,
      excess,
      method: evaluation.method,
    };

    if (evaluation.statisticalContext) {
      violation.statisticalContext = evaluation.statisticalContext as {
        method: 'mean+sigma' | 'percentile' | 'median+mad';
        multiplier?: number;
        percentile?: number;
        baseline: number;
      };
    }

    return violation;
  }
}

export const statisticalEvaluator = new StatisticalEvaluator();
