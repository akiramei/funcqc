/**
 * Enhanced Quality Scorer v1.6 for funcqc
 * 
 * Implements enhanced quality evaluation with:
 * - Maintainability: 25% (existing Halstead-based metrics)
 * - Complexity: 25% (existing McCabe complexity)
 * - Size: 20% (existing LOC metrics)
 * - Naming Quality: 15% (new, Clean Code compliance)
 * - Type Safety: 15% (new, TypeScript best practices)
 */

import { FunctionInfo, QualityScorerThresholds } from '../types';
import { 
  EnhancedQualityMetrics, 
  EnhancedProjectQualityScore, 
  QualityRecommendation,
  QualityScoreWeights,
  DEFAULT_QUALITY_WEIGHTS,
  NamingEvaluation
} from '../types/quality-enhancements';
import { NamingQualityAnalyzer } from '../analyzers/naming-quality-analyzer';
import { TypeSafetyAnalyzer } from '../analyzers/type-safety-analyzer';
import { DEFAULT_QUALITY_SCORER_THRESHOLDS } from '../config/thresholds-simple.js';

export class QualityScorerV16 {
  private namingAnalyzer: NamingQualityAnalyzer;
  private typeSafetyAnalyzer: TypeSafetyAnalyzer;
  private weights: QualityScoreWeights;
  private thresholds: QualityScorerThresholds;

  constructor(
    customWeights?: Partial<QualityScoreWeights>,
    customThresholds?: Partial<QualityScorerThresholds>
  ) {
    this.namingAnalyzer = new NamingQualityAnalyzer();
    this.typeSafetyAnalyzer = new TypeSafetyAnalyzer();
    this.weights = { ...DEFAULT_QUALITY_WEIGHTS, ...customWeights };
    this.thresholds = { ...DEFAULT_QUALITY_SCORER_THRESHOLDS, ...customThresholds };
  }

  /**
   * Calculate enhanced quality metrics for a single function
   */
  calculateFunctionScore(
    functionInfo: FunctionInfo, 
    contextFunctions: FunctionInfo[] = [],
    existingEvaluation?: NamingEvaluation
  ): EnhancedQualityMetrics {
    // Calculate base scores using existing logic
    const baseScores = this.calculateBaseScores(functionInfo);
    
    // Calculate enhanced scores using new analyzers
    const namingScore = this.namingAnalyzer.analyze(functionInfo, contextFunctions);
    const typeSafetyScore = this.typeSafetyAnalyzer.analyze(functionInfo);
    
    // Calculate composite naming score (60% automatic + 40% evaluation)
    const evaluationScore = this.convertEvaluationToScore(existingEvaluation);
    const automaticNaming = namingScore.score;
    const evaluationNaming = evaluationScore;
    const finalNaming = Math.round(automaticNaming * 0.6 + evaluationNaming * 0.4);
    
    // Calculate final weighted score
    const finalScore = Math.round(
      baseScores.maintainabilityScore * this.weights.maintainability +
      baseScores.complexityScore * this.weights.complexity +
      baseScores.sizeScore * this.weights.size +
      finalNaming * this.weights.namingQuality +
      typeSafetyScore.score * this.weights.typeSafety
    );

    return {
      base: baseScores,
      enhanced: {
        namingQualityScore: namingScore.score,
        typeSafetyScore: typeSafetyScore.score
      },
      composite: {
        automaticNaming,
        evaluationNaming,
        finalNaming
      },
      final: {
        score: Math.max(0, Math.min(100, finalScore)),
        grade: this.scoreToGrade(finalScore)
      }
    };
  }

  /**
   * Calculate enhanced project quality score
   */
  calculateProjectScore(
    functions: FunctionInfo[], 
    evaluations: Map<string, NamingEvaluation> = new Map()
  ): EnhancedProjectQualityScore {
    if (functions.length === 0) {
      return this.getEmptyProjectScore();
    }

    // Calculate individual function scores
    const functionScores = functions.map(func => ({
      function: func,
      metrics: this.calculateFunctionScore(func, functions, evaluations.get(func.id))
    }));

    // Calculate component averages
    const componentScores = this.calculateComponentAverages(functionScores);
    
    // Calculate overall score
    const overallScore = Math.round(
      componentScores.maintainability * this.weights.maintainability +
      componentScores.complexity * this.weights.complexity +
      componentScores.size * this.weights.size +
      componentScores.namingQuality * this.weights.namingQuality +
      componentScores.typeSafety * this.weights.typeSafety
    );

    // Calculate statistics
    const statistics = this.calculateProjectStatistics(functions, functionScores, evaluations);
    
    // Get top problematic functions
    const topProblematicFunctions = this.getTopProblematicFunctions(functionScores);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(functionScores, statistics);

    return {
      overallGrade: this.scoreToGrade(overallScore),
      score: overallScore,
      componentScores,
      statistics,
      topProblematicFunctions,
      recommendations
    };
  }

  /**
   * Calculate base scores using existing quality scorer logic
   */
  private calculateBaseScores(functionInfo: FunctionInfo): EnhancedQualityMetrics['base'] {
    const metrics = functionInfo.metrics;
    if (!metrics) {
      return {
        maintainabilityScore: 100,
        complexityScore: 100,
        sizeScore: 100
      };
    }

    // Maintainability score based on maintainability index
    const maintainabilityScore = Math.max(0, Math.min(100, 
      metrics.maintainabilityIndex || 100
    ));

    // Complexity score based on cyclomatic complexity with configurable thresholds
    let complexityScore = 100;
    const complexity = metrics.cyclomaticComplexity;
    if (complexity > this.thresholds.complexity.warning) {
      complexityScore -= (complexity - this.thresholds.complexity.warning) * this.thresholds.complexity.warningPenalty;
    }
    if (complexity > this.thresholds.complexity.critical) {
      complexityScore -= (complexity - this.thresholds.complexity.critical) * this.thresholds.complexity.criticalPenalty;
    }
    complexityScore = Math.max(0, Math.min(100, complexityScore));

    // Size score based on lines of code with configurable thresholds
    let sizeScore = 100;
    const lines = metrics.linesOfCode;
    if (lines > this.thresholds.size.warning) {
      sizeScore -= (lines - this.thresholds.size.warning) * this.thresholds.size.warningPenalty;
    }
    if (lines > this.thresholds.size.critical) {
      sizeScore -= (lines - this.thresholds.size.critical) * this.thresholds.size.criticalPenalty;
    }
    sizeScore = Math.max(0, Math.min(100, sizeScore));

    return {
      maintainabilityScore,
      complexityScore,
      sizeScore
    };
  }

  /**
   * Convert 3-level evaluation rating to score
   */
  private convertEvaluationToScore(evaluation?: NamingEvaluation): number {
    if (!evaluation) {
      return 80; // Default score when no evaluation exists
    }

    switch (evaluation.rating) {
      case 1: return 100; // Appropriate
      case 2: return 60;  // Partially Correct
      case 3: return 20;  // Inappropriate
      default: return 80; // Fallback
    }
  }

  /**
   * Calculate component score averages
   */
  private calculateComponentAverages(functionScores: Array<{ function: FunctionInfo; metrics: EnhancedQualityMetrics }>): EnhancedProjectQualityScore['componentScores'] {
    const count = functionScores.length;
    
    const totals = functionScores.reduce((acc, { metrics }) => ({
      maintainability: acc.maintainability + metrics.base.maintainabilityScore,
      complexity: acc.complexity + metrics.base.complexityScore,
      size: acc.size + metrics.base.sizeScore,
      namingQuality: acc.namingQuality + metrics.composite.finalNaming,
      typeSafety: acc.typeSafety + metrics.enhanced.typeSafetyScore
    }), {
      maintainability: 0,
      complexity: 0,
      size: 0,
      namingQuality: 0,
      typeSafety: 0
    });

    return {
      maintainability: Math.round(totals.maintainability / count),
      complexity: Math.round(totals.complexity / count),
      size: Math.round(totals.size / count),
      namingQuality: Math.round(totals.namingQuality / count),
      typeSafety: Math.round(totals.typeSafety / count)
    };
  }

  /**
   * Calculate project statistics
   */
  private calculateProjectStatistics(
    functions: FunctionInfo[], 
    functionScores: Array<{ function: FunctionInfo; metrics: EnhancedQualityMetrics }>,
    evaluations: Map<string, NamingEvaluation>
  ): EnhancedProjectQualityScore['statistics'] {
    const highRiskFunctions = functionScores.filter(({ function: func, metrics }) => {
      const complexity = func.metrics?.cyclomaticComplexity || 1;
      const lines = func.metrics?.linesOfCode || 0;
      const maintainability = metrics.base.maintainabilityScore;
      const overallScore = metrics.final.score;
      
      return complexity > this.thresholds.complexity.critical || 
             lines > this.thresholds.size.critical || 
             maintainability < this.thresholds.maintainability.critical || 
             overallScore < this.thresholds.grading.D;
    }).length;

    const functionsWithEvaluations = functions.filter(func => 
      evaluations.has(func.id)
    ).length;

    const functionsNeedingEvaluation = functions.filter(func => {
      const evaluation = evaluations.get(func.id);
      return !evaluation || evaluation.revisionNeeded;
    }).length;

    const confidenceScores = Array.from(evaluations.values())
      .map(evaluation => evaluation.confidence || 0.8)
      .filter(conf => conf > 0);
    
    const averageConfidence = confidenceScores.length > 0 
      ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
      : 0.8;

    return {
      totalFunctions: functions.length,
      highRiskFunctions,
      functionsWithEvaluations,
      functionsNeedingEvaluation,
      averageConfidence
    };
  }

  /**
   * Get top problematic functions
   */
  private getTopProblematicFunctions(functionScores: Array<{ function: FunctionInfo; metrics: EnhancedQualityMetrics }>): EnhancedProjectQualityScore['topProblematicFunctions'] {
    return functionScores
      .map(({ function: func, metrics }) => {
        const issues: string[] = [];
        let problemScore = 0;

        // Check complexity issues using configurable thresholds
        const complexity = func.metrics?.cyclomaticComplexity || 1;
        if (complexity > this.thresholds.complexity.critical) {
          issues.push(`High complexity (${complexity})`);
          problemScore += (complexity - this.thresholds.complexity.critical) * 5;
        }

        // Check size issues using configurable thresholds
        const lines = func.metrics?.linesOfCode || 0;
        if (lines > this.thresholds.size.critical) {
          issues.push(`Large function (${lines} lines)`);
          problemScore += (lines - this.thresholds.size.critical) * 0.5;
        }

        // Check maintainability issues using configurable thresholds
        if (metrics.base.maintainabilityScore < this.thresholds.maintainability.warning) {
          issues.push(`Low maintainability (${metrics.base.maintainabilityScore})`);
          problemScore += (this.thresholds.maintainability.warning - metrics.base.maintainabilityScore) * 2;
        }

        // Check naming issues
        if (metrics.composite.finalNaming < 70) {
          issues.push(`Poor naming quality (${metrics.composite.finalNaming})`);
          problemScore += (70 - metrics.composite.finalNaming) * 1.5;
        }

        // Check type safety issues
        if (metrics.enhanced.typeSafetyScore < 70) {
          issues.push(`Type safety concerns (${metrics.enhanced.typeSafetyScore})`);
          problemScore += (70 - metrics.enhanced.typeSafetyScore) * 1.5;
        }

        return {
          name: func.displayName,
          filePath: func.filePath,
          issues,
          scores: {
            naming: metrics.composite.finalNaming,
            typeSafety: metrics.enhanced.typeSafetyScore,
            complexity: metrics.base.complexityScore,
            maintainability: metrics.base.maintainabilityScore
          },
          problemScore
        };
      })
      .filter(func => func.problemScore > 0)
      .sort((a, b) => b.problemScore - a.problemScore)
      .slice(0, 10)
      .map(({ problemScore: _, ...rest }) => rest); // Remove problemScore from final result
  }

  /**
   * Generate quality improvement recommendations
   */
  private generateRecommendations(
    functionScores: Array<{ function: FunctionInfo; metrics: EnhancedQualityMetrics }>,
    statistics: EnhancedProjectQualityScore['statistics']
  ): QualityRecommendation[] {
    const recommendations: QualityRecommendation[] = [];

    // High Risk Functions recommendation
    if (statistics.highRiskFunctions > 0) {
      recommendations.push({
        type: 'complexity',
        priority: 'high',
        affectedFunctions: statistics.highRiskFunctions,
        description: `${statistics.highRiskFunctions} functions exceed risk thresholds`,
        actions: [
          'Break down large functions into smaller, focused functions',
          'Reduce cyclomatic complexity through early returns',
          'Extract complex logic into helper methods'
        ],
        expectedImpact: Math.min(15, statistics.highRiskFunctions * 2)
      });
    }

    // Naming Quality recommendation
    const poorNamingFunctions = functionScores.filter(({ metrics }) => 
      metrics.composite.finalNaming < 70
    ).length;
    
    if (poorNamingFunctions > 0) {
      recommendations.push({
        type: 'naming',
        priority: 'medium',
        affectedFunctions: poorNamingFunctions,
        description: `${poorNamingFunctions} functions have poor naming quality`,
        actions: [
          'Use descriptive function names with action verbs',
          'Follow consistent naming patterns within files',
          'Avoid generic names like "handler", "util", "data"',
          'Use appropriate boolean prefixes (is, has, can, should)'
        ],
        expectedImpact: Math.min(10, poorNamingFunctions * 1.5)
      });
    }

    // Type Safety recommendation
    const poorTypeSafetyFunctions = functionScores.filter(({ metrics }) => 
      metrics.enhanced.typeSafetyScore < 70
    ).length;
    
    if (poorTypeSafetyFunctions > 0) {
      recommendations.push({
        type: 'type-safety',
        priority: 'medium',
        affectedFunctions: poorTypeSafetyFunctions,
        description: `${poorTypeSafetyFunctions} functions have type safety issues`,
        actions: [
          'Replace "any" types with specific type definitions',
          'Add explicit type annotations to function parameters',
          'Use specific interfaces instead of generic object types',
          'Add explicit return type annotations for complex functions'
        ],
        expectedImpact: Math.min(12, poorTypeSafetyFunctions * 1.8)
      });
    }

    // Evaluation recommendation
    if (statistics.functionsNeedingEvaluation > 0) {
      recommendations.push({
        type: 'naming',
        priority: 'low',
        affectedFunctions: statistics.functionsNeedingEvaluation,
        description: `${statistics.functionsNeedingEvaluation} functions need naming evaluation`,
        actions: [
          'Run "funcqc evaluate" for functions lacking evaluations',
          'Review and update evaluations for modified functions',
          'Use AI-assisted evaluation for bulk assessment'
        ],
        expectedImpact: Math.min(8, statistics.functionsNeedingEvaluation * 0.5)
      });
    }

    // Sort by priority and expected impact
    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      return priorityDiff !== 0 ? priorityDiff : b.expectedImpact - a.expectedImpact;
    });
  }

  /**
   * Convert score to letter grade using configurable thresholds
   */
  private scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= this.thresholds.grading.A) return 'A';
    if (score >= this.thresholds.grading.B) return 'B';
    if (score >= this.thresholds.grading.C) return 'C';
    if (score >= this.thresholds.grading.D) return 'D';
    return 'F';
  }

  /**
   * Get empty project score for zero functions
   */
  private getEmptyProjectScore(): EnhancedProjectQualityScore {
    return {
      overallGrade: 'A',
      score: 100,
      componentScores: {
        maintainability: 100,
        complexity: 100,
        size: 100,
        namingQuality: 100,
        typeSafety: 100
      },
      statistics: {
        totalFunctions: 0,
        highRiskFunctions: 0,
        functionsWithEvaluations: 0,
        functionsNeedingEvaluation: 0,
        averageConfidence: 1.0
      },
      topProblematicFunctions: [],
      recommendations: []
    };
  }

  /**
   * Get current weight configuration
   */
  getWeights(): QualityScoreWeights {
    return { ...this.weights };
  }

  /**
   * Update weight configuration
   */
  updateWeights(newWeights: Partial<QualityScoreWeights>): void {
    this.weights = { ...this.weights, ...newWeights };
    
    // Ensure weights sum to 1.0
    const total = Object.values(this.weights).reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(total - 1.0) > 0.01) {
      throw new Error(`Quality score weights must sum to 1.0, but sum to ${total}`);
    }
  }

  /**
   * Get current threshold configuration
   */
  getThresholds(): QualityScorerThresholds {
    return { ...this.thresholds };
  }

  /**
   * Update threshold configuration
   */
  updateThresholds(newThresholds: Partial<QualityScorerThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    
    // Validate threshold consistency
    this.validateThresholds();
  }

  /**
   * Validate threshold configuration
   */
  private validateThresholds(): void {
    const { complexity, size, maintainability, grading } = this.thresholds;
    
    // Validate complexity thresholds
    if (complexity.warning >= complexity.critical) {
      throw new Error('Complexity warning threshold must be less than critical threshold');
    }
    
    // Validate size thresholds
    if (size.warning >= size.critical) {
      throw new Error('Size warning threshold must be less than critical threshold');
    }
    
    // Validate maintainability thresholds
    if (maintainability.critical >= maintainability.warning) {
      throw new Error('Maintainability critical threshold must be less than warning threshold');
    }
    
    // Validate grading thresholds are in descending order
    if (grading.A <= grading.B || grading.B <= grading.C || grading.C <= grading.D) {
      throw new Error('Grading thresholds must be in descending order (A > B > C > D)');
    }
  }
}