import {
  QualityMetrics,
  QualityThresholds,
  MultiLevelThreshold,
  ThresholdValue,
  ThresholdViolation,
  ViolationLevel,
  ProjectStatistics,
  MetricStatistics,
  FunctionRiskAssessment,
  ProjectRiskAssessment,
  RiskAssessmentConfig,
  RiskCondition,
} from '../types/index.js';
import { statisticalEvaluator, StatisticalEvaluator } from './statistical-evaluator.js';

/**
 * Configurable threshold system with multi-level evaluation
 */
export class ThresholdEvaluator {
  private statisticalEvaluator: StatisticalEvaluator;

  constructor() {
    this.statisticalEvaluator = statisticalEvaluator;
  }

  /**
   * Evaluate all configured thresholds for a function
   */
  evaluateFunctionThresholds(
    metrics: QualityMetrics,
    thresholds: QualityThresholds,
    projectStatistics: ProjectStatistics
  ): ThresholdViolation[] {
    const violations: ThresholdViolation[] = [];
    const metricMappings = this.createMetricMappings(metrics, thresholds);

    for (const mapping of metricMappings) {
      const violation = this.evaluateSingleMetric(mapping, projectStatistics);

      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * Create mappings between metric values and their threshold configurations
   */
  private createMetricMappings(
    metrics: QualityMetrics,
    thresholds: QualityThresholds
  ): Array<{
    key: keyof QualityThresholds;
    metricKey: keyof QualityMetrics;
    value: number | undefined;
    threshold: MultiLevelThreshold | undefined;
  }> {
    return [
      {
        key: 'complexity',
        metricKey: 'cyclomaticComplexity',
        value: metrics.cyclomaticComplexity,
        threshold: thresholds.complexity,
      },
      {
        key: 'cognitiveComplexity',
        metricKey: 'cognitiveComplexity',
        value: metrics.cognitiveComplexity,
        threshold: thresholds.cognitiveComplexity,
      },
      {
        key: 'lines',
        metricKey: 'linesOfCode',
        value: metrics.linesOfCode,
        threshold: thresholds.lines,
      },
      {
        key: 'totalLines',
        metricKey: 'totalLines',
        value: metrics.totalLines,
        threshold: thresholds.totalLines,
      },
      {
        key: 'parameters',
        metricKey: 'parameterCount',
        value: metrics.parameterCount,
        threshold: thresholds.parameters,
      },
      {
        key: 'nestingLevel',
        metricKey: 'maxNestingLevel',
        value: metrics.maxNestingLevel,
        threshold: thresholds.nestingLevel,
      },
      {
        key: 'returnStatements',
        metricKey: 'returnStatementCount',
        value: metrics.returnStatementCount,
        threshold: thresholds.returnStatements,
      },
      {
        key: 'branches',
        metricKey: 'branchCount',
        value: metrics.branchCount,
        threshold: thresholds.branches,
      },
      {
        key: 'loops',
        metricKey: 'loopCount',
        value: metrics.loopCount,
        threshold: thresholds.loops,
      },
      {
        key: 'tryCatch',
        metricKey: 'tryCatchCount',
        value: metrics.tryCatchCount,
        threshold: thresholds.tryCatch,
      },
      {
        key: 'asyncAwait',
        metricKey: 'asyncAwaitCount',
        value: metrics.asyncAwaitCount,
        threshold: thresholds.asyncAwait,
      },
      {
        key: 'callbacks',
        metricKey: 'callbackCount',
        value: metrics.callbackCount,
        threshold: thresholds.callbacks,
      },
      {
        key: 'maintainability',
        metricKey: 'maintainabilityIndex',
        value: metrics.maintainabilityIndex,
        threshold: thresholds.maintainability,
      },
      {
        key: 'halsteadVolume',
        metricKey: 'halsteadVolume',
        value: metrics.halsteadVolume,
        threshold: thresholds.halsteadVolume,
      },
      {
        key: 'halsteadDifficulty',
        metricKey: 'halsteadDifficulty',
        value: metrics.halsteadDifficulty,
        threshold: thresholds.halsteadDifficulty,
      },
      {
        key: 'codeToCommentRatio',
        metricKey: 'codeToCommentRatio',
        value: metrics.codeToCommentRatio,
        threshold: thresholds.codeToCommentRatio,
      },
    ];
  }

  /**
   * Evaluate a single metric against its thresholds
   */
  private evaluateSingleMetric(
    mapping: {
      key: keyof QualityThresholds;
      metricKey: keyof QualityMetrics;
      value: number | undefined;
      threshold: MultiLevelThreshold | undefined;
    },
    projectStatistics: ProjectStatistics
  ): ThresholdViolation | null {
    if (mapping.value === undefined || mapping.threshold === undefined) {
      return null;
    }

    const metricStats = projectStatistics.metrics[mapping.metricKey];
    if (!metricStats) {
      return null;
    }

    // Handle maintainability index specially (lower is worse)
    if (mapping.metricKey === 'maintainabilityIndex') {
      return this.evaluateInvertedMultiLevelThreshold(
        mapping.metricKey,
        mapping.value,
        mapping.threshold,
        metricStats
      );
    }

    return this.evaluateMultiLevelThreshold(
      mapping.metricKey,
      mapping.value,
      mapping.threshold,
      metricStats
    );
  }

  /**
   * Evaluate a multi-level threshold (warning/error/critical)
   */
  private evaluateMultiLevelThreshold(
    metric: keyof QualityMetrics,
    value: number,
    threshold: MultiLevelThreshold,
    statistics: MetricStatistics
  ): ThresholdViolation | null {
    // Check in order of severity: critical > error > warning
    const levels: Array<{ level: ViolationLevel; threshold: ThresholdValue | undefined }> = [
      { level: 'critical', threshold: threshold.critical },
      { level: 'error', threshold: threshold.error },
      { level: 'warning', threshold: threshold.warning },
    ];

    for (const { level, threshold: thresholdValue } of levels) {
      if (!thresholdValue) continue;

      const evaluation = this.statisticalEvaluator.evaluateThreshold(
        value,
        thresholdValue,
        statistics
      );

      if (evaluation.exceeded) {
        return this.statisticalEvaluator.createThresholdViolation(
          metric,
          value,
          thresholdValue,
          level,
          statistics
        );
      }
    }

    return null;
  }

  /**
   * Assess function risk based on violations and configuration
   */
  assessFunctionRisk(
    functionId: string,
    functionName: string,
    filePath: string,
    startLine: number,
    endLine: number,
    metrics: QualityMetrics,
    violations: ThresholdViolation[],
    assessmentConfig?: RiskAssessmentConfig
  ): FunctionRiskAssessment {
    const config = this.getDefaultRiskAssessmentConfig(assessmentConfig);

    // Count violations by level
    const violationsByLevel: Record<ViolationLevel, number> = {
      warning: 0,
      error: 0,
      critical: 0,
    };

    violations.forEach(v => {
      violationsByLevel[v.level]++;
    });

    // Calculate risk score
    const riskScore = this.calculateRiskScore(violations, config);

    // Determine risk level
    const riskLevel = this.determineRiskLevel(violations, config);

    return {
      functionId,
      functionName,
      filePath,
      startLine,
      endLine,
      violations,
      totalViolations: violations.length,
      riskLevel,
      riskScore,
      violationsByLevel,
      metrics,
    };
  }

  /**
   * Calculate numerical risk score with normalized metrics
   */
  private calculateRiskScore(
    violations: ThresholdViolation[],
    config: RiskAssessmentConfig
  ): number {
    // Extract weights once for efficiency
    const { warning = 1, error = 5, critical = 25 } = config.violationWeights ?? {};
    const weights = { warning, error, critical };

    switch (config.compositeScoringMethod) {
      case 'weighted':
        // Normalized: weight × (excess / threshold) for metric-agnostic comparison
        return violations.reduce((score, violation) => {
          const weight = weights[violation.level] ?? 1;
          // Protect against near-zero division with epsilon
          const epsilon = 1e-9;
          const normalizedExcess = violation.excess / Math.max(violation.threshold, epsilon);
          return score + weight * normalizedExcess;
        }, 0);

      case 'severity':
        return violations.reduce((score, violation) => {
          const weight = weights[violation.level] ?? 1;
          // Protect against near-zero division with epsilon
          const epsilon = 1e-9;
          const severityMultiplier = violation.excess / Math.max(violation.threshold, epsilon);
          return score + weight * severityMultiplier;
        }, 0);

      case 'absolute':
        // Legacy: weight × excess (for backward compatibility)
        return violations.reduce((score, violation) => {
          const weight = weights[violation.level] ?? 1;
          return score + weight * violation.excess;
        }, 0);

      default:
        return violations.reduce((score, violation) => {
          const weight = weights[violation.level] ?? 1;
          return score + weight;
        }, 0);
    }
  }

  /**
   * Determine risk level based on violations and configuration
   */
  private determineRiskLevel(
    violations: ThresholdViolation[],
    config: RiskAssessmentConfig
  ): 'low' | 'medium' | 'high' {
    // Check for critical violations
    const criticalViolations = violations.filter(v => v.level === 'critical');
    if (criticalViolations.length > 0) {
      return 'high';
    }

    // Check minimum violations threshold
    const minViolations = config.minViolations ?? 2;
    if (violations.length >= minViolations) {
      // If we have multiple violations, check if any are error level
      const errorViolations = violations.filter(v => v.level === 'error');
      if (errorViolations.length > 0) {
        return 'high';
      }
      return 'medium';
    }

    // Check error violations even with low count
    const errorViolations = violations.filter(v => v.level === 'error');
    if (errorViolations.length > 0) {
      return 'medium';
    }

    // Only warnings or no violations
    return 'low';
  }

  /**
   * Evaluate custom risk conditions
   */
  evaluateRiskConditions(
    metrics: QualityMetrics,
    conditions: RiskCondition[],
    projectStatistics: ProjectStatistics
  ): boolean {
    return conditions.some(condition => {
      const value = metrics[condition.metric];
      if (value === undefined) return false;

      const metricStats = projectStatistics.metrics[condition.metric];
      if (!metricStats) return false;

      const evaluation = this.statisticalEvaluator.evaluateThreshold(
        value,
        condition.threshold,
        metricStats
      );

      const operator = condition.operator ?? '>';
      switch (operator) {
        case '>':
          return value > evaluation.threshold;
        case '>=':
          return value >= evaluation.threshold;
        case '<':
          return value < evaluation.threshold;
        case '<=':
          return value <= evaluation.threshold;
        case '==':
          return value === evaluation.threshold;
        case '!=':
          return value !== evaluation.threshold;
        default:
          console.warn(
            `Invalid operator "${operator}" in risk condition for metric "${condition.metric}". Defaulting to false.`
          );
          return false;
      }
    });
  }

  /**
   * Generate project-wide risk assessment
   */
  generateProjectRiskAssessment(
    functionAssessments: FunctionRiskAssessment[],
    projectStatistics: ProjectStatistics,
    configuredThresholds: QualityThresholds
  ): ProjectRiskAssessment {
    // Calculate risk distribution
    const riskDistribution = functionAssessments.reduce(
      (dist, assessment) => {
        dist[assessment.riskLevel]++;
        return dist;
      },
      { low: 0, medium: 0, high: 0, critical: 0 }
    );

    // Find top violations across all functions
    const allViolations = functionAssessments.flatMap(a => a.violations);
    const topViolations = allViolations.sort((a, b) => b.excess - a.excess).slice(0, 10);

    // Find worst functions by risk score
    const worstFunctions = functionAssessments
      .filter(a => a.riskLevel === 'high' || a.totalViolations > 0)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);

    return {
      totalFunctions: projectStatistics.totalFunctions,
      assessedFunctions: functionAssessments.length,
      riskDistribution,
      topViolations,
      worstFunctions,
      statistics: projectStatistics,
      configuredThresholds,
    };
  }

  /**
   * Evaluate inverted multi-level threshold (for maintainability where lower is worse)
   */
  private evaluateInvertedMultiLevelThreshold(
    metric: keyof QualityMetrics,
    value: number,
    threshold: MultiLevelThreshold,
    statistics: MetricStatistics
  ): ThresholdViolation | null {
    // For inverted metrics, check in reverse order: warning > error > critical
    const levels: Array<{ level: ViolationLevel; threshold: ThresholdValue | undefined }> = [
      { level: 'warning', threshold: threshold.warning },
      { level: 'error', threshold: threshold.error },
      { level: 'critical', threshold: threshold.critical },
    ];

    for (const { level, threshold: thresholdValue } of levels) {
      if (!thresholdValue) continue;

      // For inverted metrics, we check if value is LESS than threshold
      const evaluation = this.statisticalEvaluator.evaluateThreshold(
        value,
        thresholdValue,
        statistics
      );

      // Simple check: is the value less than or equal to the threshold?
      if (value <= evaluation.threshold) {
        // Create a custom violation with inverted logic
        const violation: ThresholdViolation = {
          metric,
          value,
          threshold: evaluation.threshold,
          level,
          excess: evaluation.threshold - value, // Inverted excess calculation
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

    return null;
  }

  /**
   * Get default risk assessment configuration
   */
  private getDefaultRiskAssessmentConfig(config?: RiskAssessmentConfig): RiskAssessmentConfig {
    return {
      minViolations: 2,
      violationWeights: { warning: 1, error: 5, critical: 25 },
      compositeScoringMethod: 'weighted',
      highRiskConditions: [],
      ...config,
    };
  }

  /**
   * Get default quality thresholds for common metrics
   */
  getDefaultQualityThresholds(): QualityThresholds {
    return {
      complexity: {
        warning: 8,
        error: 12,
        critical: 15,
      },
      cognitiveComplexity: {
        warning: 12,
        error: 18,
        critical: 25,
      },
      lines: {
        warning: 40,
        error: 60,
        critical: 80,
      },
      parameters: {
        warning: 5,
        error: 6,
        critical: 8,
      },
      nestingLevel: {
        warning: 3,
        error: 4,
        critical: 5,
      },
      maintainability: {
        warning: 65,
        error: 50,
        critical: 30,
      },
    };
  }

  /**
   * Merge user configuration with defaults
   */
  mergeWithDefaults(userThresholds?: QualityThresholds): QualityThresholds {
    const defaults = this.getDefaultQualityThresholds();

    if (!userThresholds) {
      return defaults;
    }

    const merged: QualityThresholds = { ...defaults };

    // Merge each threshold configuration
    const thresholdKeys: (keyof QualityThresholds)[] = [
      'complexity',
      'cognitiveComplexity',
      'lines',
      'totalLines',
      'parameters',
      'nestingLevel',
      'returnStatements',
      'branches',
      'loops',
      'tryCatch',
      'asyncAwait',
      'callbacks',
      'maintainability',
      'halsteadVolume',
      'halsteadDifficulty',
      'codeToCommentRatio',
    ];

    thresholdKeys.forEach(key => {
      if (userThresholds[key]) {
        merged[key] = {
          ...(defaults[key] || {}),
          ...userThresholds[key],
        };
      }
    });

    return merged;
  }
}

export const thresholdEvaluator = new ThresholdEvaluator();
