/**
 * Advanced Risk Evaluation System
 * Restores the sophisticated risk assessment capabilities that were removed
 */

import { FunctionInfo, QualityMetrics } from '../../../types';
import { FunctionRiskAssessment, RiskDistribution } from './types';

// Risk configuration constants
const DEFAULT_RISK_CONFIG = {
  complexity: { high: 10, critical: 15 },
  linesOfCode: { large: 40, veryLarge: 80 },
  parameterCount: { many: 5, tooMany: 8 },
  cognitive: { high: 15, veryHigh: 25 },
  nesting: { deep: 3, veryDeep: 5 },
  maintainability: { veryLow: 30 },
  totalLines: { needsComments: 20 },
  estimatedBlockSize: 25
};

export interface QualityThresholds {
  complexity: { high: number; critical: number };
  linesOfCode: { large: number; veryLarge: number };
  parameterCount: { many: number; tooMany: number };
  cognitive: { high: number; veryHigh: number };
  nesting: { deep: number; veryDeep: number };
  maintainability: { veryLow: number };
  totalLines: { needsComments: number };
  estimatedBlockSize: number;
}

export interface ProjectStatistics {
  totalFunctions: number;
  analysisTimestamp: number;
  averageComplexity: number;
  averageSize: number;
  medianComplexity: number;
  p90Complexity: number;
  complexityDistribution: {
    mean: number;
    median: number;
    p90: number;
    stdDev: number;
  };
  sizeDistribution: {
    mean: number;
    median: number;
    p90: number;
    stdDev: number;
  };
  riskDistribution: RiskDistribution;
  metrics: Record<keyof QualityMetrics, {
    mean: number;
    median: number;
    p90: number;
    stdDev: number;
  }>;
}

/**
 * Advanced statistical evaluator for project metrics
 */
export class StatisticalEvaluator {
  calculateProjectStatistics(metricsData: QualityMetrics[]): ProjectStatistics {
    if (metricsData.length === 0) {
      return this.createEmptyProjectStatistics(0);
    }

    const complexities = metricsData.map(m => m.cyclomaticComplexity);
    const sizes = metricsData.map(m => m.linesOfCode);

    return {
      totalFunctions: metricsData.length,
      analysisTimestamp: Date.now(),
      averageComplexity: this.calculateMean(complexities),
      averageSize: this.calculateMean(sizes),
      medianComplexity: this.calculateMedian(complexities),
      p90Complexity: this.calculatePercentile(complexities, 90),
      complexityDistribution: this.calculateDistribution(complexities),
      sizeDistribution: this.calculateDistribution(sizes),
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      metrics: this.calculateMetricsDistribution(metricsData)
    };
  }

  private calculateMean(values: number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private calculateStandardDeviation(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateDistribution(values: number[]): {
    mean: number;
    median: number;
    p90: number;
    stdDev: number;
  } {
    const mean = this.calculateMean(values);
    return {
      mean,
      median: this.calculateMedian(values),
      p90: this.calculatePercentile(values, 90),
      stdDev: this.calculateStandardDeviation(values, mean)
    };
  }

  private calculateMetricsDistribution(metricsData: QualityMetrics[]): Record<keyof QualityMetrics, {
    mean: number;
    median: number;
    p90: number;
    stdDev: number;
  }> {
    const result = {} as Record<keyof QualityMetrics, {
      mean: number;
      median: number;
      p90: number;
      stdDev: number;
    }>;

    const keys: (keyof QualityMetrics)[] = [
      'cyclomaticComplexity', 'cognitiveComplexity', 'linesOfCode', 
      'maintainabilityIndex', 'parameterCount', 'maxNestingLevel'
    ];

    for (const key of keys) {
      const values = metricsData.map(m => m[key] || 0);
      result[key] = this.calculateDistribution(values);
    }

    return result;
  }

  private createEmptyProjectStatistics(functionCount: number): ProjectStatistics {
    const emptyMetricStats = { mean: 0, median: 0, p90: 0, stdDev: 0 };
    
    return {
      totalFunctions: functionCount,
      analysisTimestamp: Date.now(),
      averageComplexity: 0,
      averageSize: 0,
      medianComplexity: 0,
      p90Complexity: 0,
      complexityDistribution: emptyMetricStats,
      sizeDistribution: emptyMetricStats,
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      metrics: {
        cyclomaticComplexity: emptyMetricStats,
        cognitiveComplexity: emptyMetricStats,
        linesOfCode: emptyMetricStats,
        maintainabilityIndex: emptyMetricStats,
        parameterCount: emptyMetricStats,
        maxNestingLevel: emptyMetricStats,
        totalLines: emptyMetricStats,
        returnStatementCount: emptyMetricStats,
        branchCount: emptyMetricStats,
        loopCount: emptyMetricStats,
        tryCatchCount: emptyMetricStats,
        asyncAwaitCount: emptyMetricStats,
        callbackCount: emptyMetricStats,
        commentLines: emptyMetricStats,
        codeToCommentRatio: emptyMetricStats,
        halsteadVolume: emptyMetricStats,
        halsteadDifficulty: emptyMetricStats
      }
    };
  }
}

/**
 * Advanced threshold evaluator for quality assessment
 */
export class ThresholdEvaluator {
  getDefaultQualityThresholds(): QualityThresholds {
    return DEFAULT_RISK_CONFIG;
  }

  evaluateFunctionThresholds(
    metrics: QualityMetrics,
    thresholds: QualityThresholds,
    projectStats: ProjectStatistics
  ): Array<{
    type: string;
    level: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    threshold?: number;
    actual?: number;
  }> {
    const violations = [];

    // Apply project-size adjustments to thresholds
    const adjustedThresholds = this.adjustThresholdsForProject(thresholds, projectStats);

    // Complexity violations
    if (metrics.cyclomaticComplexity >= adjustedThresholds.complexity.critical) {
      violations.push({
        type: 'complexity',
        level: 'critical' as const,
        message: 'Critical complexity level',
        threshold: adjustedThresholds.complexity.critical,
        actual: metrics.cyclomaticComplexity
      });
    } else if (metrics.cyclomaticComplexity >= adjustedThresholds.complexity.high) {
      violations.push({
        type: 'complexity',
        level: 'error' as const,
        message: 'High complexity level',
        threshold: adjustedThresholds.complexity.high,
        actual: metrics.cyclomaticComplexity
      });
    }

    // Size violations
    if (metrics.linesOfCode >= thresholds.linesOfCode.veryLarge) {
      violations.push({
        type: 'size',
        level: 'critical' as const,
        message: 'Function is very large',
        threshold: thresholds.linesOfCode.veryLarge,
        actual: metrics.linesOfCode
      });
    } else if (metrics.linesOfCode >= thresholds.linesOfCode.large) {
      violations.push({
        type: 'size',
        level: 'warning' as const,
        message: 'Function is large',
        threshold: thresholds.linesOfCode.large,
        actual: metrics.linesOfCode
      });
    }

    // Parameter count violations
    if (metrics.parameterCount >= thresholds.parameterCount.tooMany) {
      violations.push({
        type: 'parameters',
        level: 'error' as const,
        message: 'Too many parameters',
        threshold: thresholds.parameterCount.tooMany,
        actual: metrics.parameterCount
      });
    } else if (metrics.parameterCount >= thresholds.parameterCount.many) {
      violations.push({
        type: 'parameters',
        level: 'warning' as const,
        message: 'Many parameters',
        threshold: thresholds.parameterCount.many,
        actual: metrics.parameterCount
      });
    }

    // Cognitive complexity violations
    if (metrics.cognitiveComplexity >= thresholds.cognitive.veryHigh) {
      violations.push({
        type: 'cognitive',
        level: 'critical' as const,
        message: 'Very high cognitive complexity',
        threshold: thresholds.cognitive.veryHigh,
        actual: metrics.cognitiveComplexity
      });
    } else if (metrics.cognitiveComplexity >= thresholds.cognitive.high) {
      violations.push({
        type: 'cognitive',
        level: 'error' as const,
        message: 'High cognitive complexity',
        threshold: thresholds.cognitive.high,
        actual: metrics.cognitiveComplexity
      });
    }

    // Nesting violations
    if (metrics.maxNestingLevel >= thresholds.nesting.veryDeep) {
      violations.push({
        type: 'nesting',
        level: 'error' as const,
        message: 'Very deep nesting',
        threshold: thresholds.nesting.veryDeep,
        actual: metrics.maxNestingLevel
      });
    } else if (metrics.maxNestingLevel >= thresholds.nesting.deep) {
      violations.push({
        type: 'nesting',
        level: 'warning' as const,
        message: 'Deep nesting',
        threshold: thresholds.nesting.deep,
        actual: metrics.maxNestingLevel
      });
    }

    // Maintainability violations
    if (metrics.maintainabilityIndex !== undefined && metrics.maintainabilityIndex < thresholds.maintainability.veryLow) {
      violations.push({
        type: 'maintainability',
        level: 'critical' as const,
        message: 'Very low maintainability',
        threshold: thresholds.maintainability.veryLow,
        actual: metrics.maintainabilityIndex
      });
    }

    return violations;
  }

  assessFunctionRisk(
    functionId: string,
    functionName: string,
    filePath: string,
    startLine: number,
    endLine: number,
    metrics: QualityMetrics,
    violations: Array<{
      type: string;
      level: 'info' | 'warning' | 'error' | 'critical';
      message: string;
      threshold?: number;
      actual?: number;
    }>,
    riskConfig: QualityThresholds
  ): FunctionRiskAssessment {
    let riskScore = 0;

    // Calculate risk score based on violations and configuration
    violations.forEach(violation => {
      // Use riskConfig for dynamic scoring weight
      const baseWeight = this.getViolationWeight(violation.level);
      const contextualWeight = this.calculateContextualWeight(violation, metrics, riskConfig);
      riskScore += baseWeight * contextualWeight;
    });

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (riskScore >= 8) {
      riskLevel = 'critical';
    } else if (riskScore >= 5) {
      riskLevel = 'high';
    } else if (riskScore >= 2) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    return {
      functionId,
      functionName,
      filePath,
      startLine,
      endLine,
      riskLevel,
      riskScore,
      violations,
      metrics: {
        cyclomaticComplexity: metrics.cyclomaticComplexity,
        cognitiveComplexity: metrics.cognitiveComplexity,
        linesOfCode: metrics.linesOfCode,
        maintainabilityIndex: metrics.maintainabilityIndex || 0,
        parameterCount: metrics.parameterCount,
        nestingDepth: metrics.maxNestingLevel
      }
    };
  }

  /**
   * Adjust thresholds based on project statistics
   */
  private adjustThresholdsForProject(
    thresholds: QualityThresholds,
    projectStats: ProjectStatistics
  ): QualityThresholds {
    // For large projects, be slightly more lenient with complexity
    const sizeMultiplier = projectStats.totalFunctions > 1000 ? 1.1 : 1.0;
    
    return {
      ...thresholds,
      complexity: {
        critical: Math.ceil(thresholds.complexity.critical * sizeMultiplier),
        high: Math.ceil(thresholds.complexity.high * sizeMultiplier),
        medium: Math.ceil(thresholds.complexity.medium * sizeMultiplier)
      }
    };
  }

  /**
   * Get base weight for violation level
   */
  private getViolationWeight(level: 'info' | 'warning' | 'error' | 'critical'): number {
    switch (level) {
      case 'critical': return 4;
      case 'error': return 2;
      case 'warning': return 1;
      case 'info': return 0.5;
    }
  }

  /**
   * Calculate contextual weight based on violation context
   */
  private calculateContextualWeight(
    violation: { type: string; threshold?: number; actual?: number },
    metrics: QualityMetrics,
    riskConfig: QualityThresholds
  ): number {
    // Base contextual weight
    let weight = 1.0;
    
    // If we have threshold and actual values, calculate severity
    if (violation.threshold && violation.actual) {
      const severity = violation.actual / violation.threshold;
      weight *= Math.min(severity, 2.0); // Cap at 2x multiplier
    }
    
    return weight;
  }
}

/**
 * Assess all functions for risk
 */
export async function assessAllFunctions(
  functions: FunctionInfo[],
  projectStats: ProjectStatistics,
  thresholds: QualityThresholds
): Promise<FunctionRiskAssessment[]> {
  const thresholdEvaluator = new ThresholdEvaluator();
  
  return functions
    .filter((f): f is FunctionInfo & { metrics: QualityMetrics } => 
      f.metrics !== undefined
    )
    .map(fn => {
      const violations = thresholdEvaluator.evaluateFunctionThresholds(
        fn.metrics,
        thresholds,
        projectStats
      );
      return thresholdEvaluator.assessFunctionRisk(
        fn.id,
        fn.name,
        fn.filePath,
        fn.startLine,
        fn.endLine,
        fn.metrics,
        violations,
        thresholds
      );
    });
}

/**
 * Calculate risk distribution from assessments
 */
export function calculateRiskDistribution(riskAssessments: FunctionRiskAssessment[]): RiskDistribution {
  const distribution: RiskDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
  
  riskAssessments.forEach(assessment => {
    switch (assessment.riskLevel) {
      case 'low':
        distribution.low++;
        break;
      case 'medium':
        distribution.medium++;
        break;
      case 'high':
        distribution.high++;
        break;
      case 'critical':
        distribution.critical++;
        break;
    }
  });
  
  return distribution;
}

/**
 * Calculate enhanced risk statistics
 */
export function calculateEnhancedRiskStats(
  riskAssessments: FunctionRiskAssessment[],
  functions: FunctionInfo[]
): {
  average: number;
  median: number;
  p90: number;
  normalizedByLOC: number;
  criticalCount: number;
  highRiskCount: number;
} {
  if (riskAssessments.length === 0) {
    return {
      average: 0,
      median: 0,
      p90: 0,
      normalizedByLOC: 0,
      criticalCount: 0,
      highRiskCount: 0
    };
  }

  const riskScores = riskAssessments.map(a => a.riskScore);
  const sortedScores = [...riskScores].sort((a, b) => a - b);
  
  const average = riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length;
  const median = sortedScores[Math.floor(sortedScores.length / 2)] || 0;
  const p90Index = Math.floor(sortedScores.length * 0.9);
  const p90 = sortedScores[p90Index] || 0;
  
  // Calculate normalized risk per LOC
  const totalLOC = functions.reduce((sum, f) => sum + (f.metrics?.linesOfCode || 0), 0);
  const totalRiskScore = riskScores.reduce((sum, score) => sum + score, 0);
  const normalizedByLOC = totalLOC > 0 ? totalRiskScore / totalLOC : 0;
  
  const criticalCount = riskAssessments.filter(a => a.riskLevel === 'critical').length;
  const highRiskCount = riskAssessments.filter(a => a.riskLevel === 'high').length;

  return {
    average: Math.round(average * 100) / 100,
    median: Math.round(median * 100) / 100,
    p90: Math.round(p90 * 100) / 100,
    normalizedByLOC: Math.round(normalizedByLOC * 1000) / 1000,
    criticalCount,
    highRiskCount
  };
}

/**
 * Calculate average risk score
 */
export function calculateAverageRiskScore(riskAssessments: FunctionRiskAssessment[]): number {
  if (riskAssessments.length === 0) return 0;
  const totalScore = riskAssessments.reduce((sum, assessment) => sum + assessment.riskScore, 0);
  return Math.round((totalScore / riskAssessments.length) * 100) / 100;
}