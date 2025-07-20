import {
  FunctionInfo,
  QualityMetrics,
  QualityThresholds,
  RiskAssessmentConfig,
  ProjectStatistics,
  FunctionRiskAssessment,
  ProjectRiskAssessment,
  ThresholdViolation,
  ProjectContext,
} from '../types/index.js';
import { statisticalEvaluator } from '../utils/statistical-evaluator.js';
import { thresholdEvaluator } from '../utils/threshold-evaluator.js';

/**
 * Risk assessor that provides comprehensive quality assessment
 * with configurable thresholds and statistical evaluation
 */
export class RiskAssessor {
  /**
   * Perform comprehensive risk assessment on a set of functions
   */
  async assessProject(
    functions: FunctionInfo[],
    thresholds?: QualityThresholds,
    assessmentConfig?: RiskAssessmentConfig,
    projectContext?: ProjectContext
  ): Promise<ProjectRiskAssessment> {
    if (functions.length === 0) {
      throw new Error('Cannot assess project with no functions');
    }

    // Filter functions with complete metrics
    const functionsWithMetrics = functions.filter(
    );
    if (functionsWithMetrics.length === 0) {
      throw new Error('No functions found with complete metrics');
    }

    // Calculate project statistics
    const projectStatistics = statisticalEvaluator.calculateProjectStatistics(
      functionsWithMetrics.map(f => f.metrics)

    // Merge user thresholds with defaults, considering project context
    const configuredThresholds = this.getContextualThresholds(thresholds, projectContext);

    // Assess each function
    const functionAssessments: FunctionRiskAssessment[] = [];

    for (const func of functionsWithMetrics) {
      const violations = thresholdEvaluator.evaluateFunctionThresholds(
        func.metrics,
        configuredThresholds,
        projectStatistics
      );

      // Check custom risk conditions if configured
      let customRiskMet = false;
      if (assessmentConfig?.highRiskConditions?.length) {
        customRiskMet = thresholdEvaluator.evaluateRiskConditions(
          func.metrics!,
          assessmentConfig.highRiskConditions,
          projectStatistics
        );
      }

      let assessment = thresholdEvaluator.assessFunctionRisk(
        func.id,
        func.name,
        func.filePath,
        func.startLine,
        func.endLine,
        func.metrics,
        violations,
        assessmentConfig
      );

      // Override risk level if custom conditions are met
      if (customRiskMet && assessment.riskLevel !== 'high') {
        assessment = {
          ...assessment,
          riskLevel: 'high',
          riskScore: Math.max(assessment.riskScore, 100), // Boost score for custom conditions
        };
      }

      functionAssessments.push(assessment);
    }

    // Generate comprehensive project assessment
    return thresholdEvaluator.generateProjectRiskAssessment(
      functionAssessments,
      projectStatistics,
      configuredThresholds
    );
  }

  /**
   * Assess a single function's risk
   */
  async assessFunction(
    functionInfo: FunctionInfo,
    projectStatistics: ProjectStatistics,
    thresholds?: QualityThresholds,
    assessmentConfig?: RiskAssessmentConfig
  ): Promise<FunctionRiskAssessment> {
    if (!functionInfo.metrics) {
      throw new Error('Function metrics are required for risk assessment');
    }

    const configuredThresholds = thresholdEvaluator.mergeWithDefaults(thresholds);

    const violations = thresholdEvaluator.evaluateFunctionThresholds(
      functionInfo.metrics,
      configuredThresholds,
      projectStatistics
    );

    return thresholdEvaluator.assessFunctionRisk(
      functionInfo.id,
      functionInfo.name,
      functionInfo.filePath,
      functionInfo.startLine,
      functionInfo.endLine,
      functionInfo.metrics,
      violations,
      assessmentConfig
    );
  }

  /**
   * Get violations for a specific function without full assessment
   */
  getViolations(
    functionInfo: FunctionInfo,
    projectStatistics: ProjectStatistics,
    thresholds?: QualityThresholds
  ): ThresholdViolation[] {
    if (!functionInfo.metrics) {
      return [];
    }

    const configuredThresholds = thresholdEvaluator.mergeWithDefaults(thresholds);

    return thresholdEvaluator.evaluateFunctionThresholds(
      functionInfo.metrics,
      configuredThresholds,
      projectStatistics
    );
  }

  /**
   * Get contextually adjusted thresholds based on project context
   */
  private getContextualThresholds(
    userThresholds?: QualityThresholds,
    projectContext?: ProjectContext
  ): QualityThresholds {
    let baseThresholds = thresholdEvaluator.mergeWithDefaults(userThresholds);

    if (!projectContext) {
      return baseThresholds;
    }

    // Adjust thresholds based on experience level
    if (projectContext.experienceLevel) {
      baseThresholds = this.adjustForExperienceLevel(
        baseThresholds,
        projectContext.experienceLevel
      );
    }

    // Adjust thresholds based on project type
    if (projectContext.projectType) {
      baseThresholds = this.adjustForProjectType(baseThresholds, projectContext.projectType);
    }

    // Adjust thresholds based on codebase size
    if (projectContext.codebaseSize) {
      baseThresholds = this.adjustForCodebaseSize(baseThresholds, projectContext.codebaseSize);
    }

    return baseThresholds;
  }

  /**
   * Adjust thresholds based on team experience level
   */
  private adjustForExperienceLevel(
    thresholds: QualityThresholds,
    experienceLevel: 'junior' | 'mid' | 'senior'
  ): QualityThresholds {
    const adjustmentFactors = {
      junior: 0.8, // Stricter thresholds for junior teams
      mid: 1.0, // Standard thresholds
      senior: 1.2, // More relaxed for experienced teams
    };

    const factor = adjustmentFactors[experienceLevel];
    return this.scaleNumericThresholds(thresholds, factor);
  }

  /**
   * Adjust thresholds based on project type
   */
  private adjustForProjectType(
    thresholds: QualityThresholds,
    projectType: 'prototype' | 'production' | 'legacy'
  ): QualityThresholds {
    const adjustmentFactors = {
      prototype: 1.3, // More relaxed for prototypes
      production: 0.9, // Stricter for production code
      legacy: 1.1, // Slightly relaxed for legacy maintenance
    };

    const factor = adjustmentFactors[projectType];
    return this.scaleNumericThresholds(thresholds, factor);
  }

  /**
   * Adjust thresholds based on codebase size
   */
  private adjustForCodebaseSize(
    thresholds: QualityThresholds,
    codebaseSize: 'small' | 'medium' | 'large'
  ): QualityThresholds {
    const adjustmentFactors = {
      small: 0.9, // Stricter for small codebases (easier to maintain quality)
      medium: 1.0, // Standard
      large: 1.1, // Slightly relaxed for large codebases
    };

    const factor = adjustmentFactors[codebaseSize];
    return this.scaleNumericThresholds(thresholds, factor);
  }

  /**
   * Scale numeric thresholds by a factor, preserving statistical thresholds
   */
  private scaleNumericThresholds(thresholds: QualityThresholds, factor: number): QualityThresholds {
    const scaled = { ...thresholds };

    Object.keys(scaled).forEach(key => {
      const threshold = scaled[key as keyof QualityThresholds];
      if (threshold) {
        const scaledThreshold = { ...threshold };

        // Scale only numeric thresholds, preserve statistical ones
        ['warning', 'error', 'critical'].forEach(level => {
          const value = scaledThreshold[level as keyof typeof scaledThreshold];
          if (typeof value === 'number') {
            scaledThreshold[level as keyof typeof scaledThreshold] = Math.round(value * factor);
          }
          // Statistical thresholds remain unchanged
        });

        scaled[key as keyof QualityThresholds] = scaledThreshold;
      }
    });

    return scaled;
  }

  /**
   * Create assessment summary for reporting
   */
  createAssessmentSummary(assessment: ProjectRiskAssessment): {
    totalFunctions: number;
    highRiskFunctions: number;
    mediumRiskFunctions: number;
    lowRiskFunctions: number;
    totalViolations: number;
    criticalViolations: number;
    errorViolations: number;
    warningViolations: number;
    averageRiskScore: number;
    worstFunctionId: string | null;
    mostCommonViolation: string | null;
  } {
    const { riskDistribution, worstFunctions, topViolations } = assessment;

    const totalViolations = topViolations.length;
    const criticalViolations = topViolations.filter(v => v.level === 'critical').length;
    const errorViolations = topViolations.filter(v => v.level === 'error').length;
    const warningViolations = topViolations.filter(v => v.level === 'warning').length;

    const averageRiskScore =
      worstFunctions.length > 0
        ? worstFunctions.reduce((sum, f) => sum + f.riskScore, 0) / worstFunctions.length
        : 0;

    const worstFunctionId = worstFunctions.length > 0 ? worstFunctions[0].functionId : null;

    // Find most common violation type
    const violationCounts = topViolations.reduce(
      (counts, violation) => {
        counts[violation.metric] = (counts[violation.metric] || 0) + 1;
        return counts;
      },
      {} as Record<string, number>
    );

    const mostCommonViolation =
      Object.keys(violationCounts).length > 0
        ? Object.entries(violationCounts).sort(([, a], [, b]) => b - a)[0][0]
        : null;

    return {
      totalFunctions: assessment.totalFunctions,
      highRiskFunctions: riskDistribution.high,
      mediumRiskFunctions: riskDistribution.medium,
      lowRiskFunctions: riskDistribution.low,
      totalViolations,
      criticalViolations,
      errorViolations,
      warningViolations,
      averageRiskScore,
      worstFunctionId,
      mostCommonViolation,
    };
  }
}

export const riskAssessor = new RiskAssessor();
