import {
  RefactoringChangeset,
  HealthAssessment,
  ImprovementMetrics,
  ChangesetAssessment,
  FunctionInfo,
  StorageAdapter,
  LineageManager,
  RefactoringOperation,
} from '../types/index.js';
import { RefactoringHealthEngine } from './refactoring-health-engine.js';
import { FunctionExplosionDetector, ExplosionDetectionResult } from './explosion-detector.js';
import { Logger } from './cli-utils.js';

/**
 * Current evaluation version for tracking algorithm changes
 */
const EVALUATION_VERSION = '3.0.0';

/**
 * GenuineImprovementCriteria
 * 
 * Comprehensive criteria for determining if a refactoring represents genuine improvement
 */
export interface GenuineImprovementCriteria {
  /** Minimum complexity reduction percentage required */
  minimumComplexityReduction: number;
  
  /** Minimum risk score improvement required */
  minimumRiskImprovement: number;
  
  /** Minimum maintainability gain required */
  minimumMaintainabilityGain: number;
  
  /** Maximum acceptable function explosion score */
  maximumExplosionScore: number;
  
  /** Minimum overall improvement score required */
  minimumOverallScore: number;
  
  /** Weight factors for different improvement aspects */
  weights: {
    complexity: number;
    risk: number;
    maintainability: number;
    explosion: number;
    codeQuality: number;
  };
  
  /** Enable strict evaluation mode */
  strictMode: boolean;
}

/**
 * Default criteria based on research and best practices
 */
export const DefaultGenuineImprovementCriteria: GenuineImprovementCriteria = {
  minimumComplexityReduction: 5.0,    // At least 5% complexity reduction
  minimumRiskImprovement: 0.0,        // Risk should not increase
  minimumMaintainabilityGain: 0.0,    // Maintainability should not decrease
  maximumExplosionScore: 0.3,         // Low explosion tolerance
  minimumOverallScore: 60,            // Minimum overall quality score
  weights: {
    complexity: 0.3,                  // 30% weight on complexity improvement
    risk: 0.25,                       // 25% weight on risk reduction
    maintainability: 0.2,             // 20% weight on maintainability
    explosion: 0.15,                  // 15% weight on explosion penalty
    codeQuality: 0.1,                 // 10% weight on general code quality
  },
  strictMode: false,
};

/**
 * ChangesetEvaluationResult
 * 
 * Comprehensive evaluation result for a refactoring changeset
 */
export interface ChangesetEvaluationResult {
  /** Unique identifier for this evaluation */
  evaluationId: string;
  
  /** Changeset that was evaluated */
  changesetId: string;
  
  /** Overall assessment of whether improvement is genuine */
  isGenuineImprovement: boolean;
  
  /** Detailed scoring breakdown */
  scores: {
    /** Overall improvement score (0-100) */
    overall: number;
    
    /** Complexity improvement score */
    complexity: number;
    
    /** Risk reduction score */
    risk: number;
    
    /** Maintainability improvement score */
    maintainability: number;
    
    /** Code quality score */
    codeQuality: number;
    
    /** Explosion penalty score (negative) */
    explosionPenalty: number;
  };
  
  /** Letter grade for the refactoring */
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  
  /** Health assessments before and after */
  health: {
    before: HealthAssessment;
    after: HealthAssessment;
  };
  
  /** Function explosion analysis */
  explosion: ExplosionDetectionResult;
  
  /** Detailed improvement metrics */
  improvement: ImprovementMetrics;
  
  /** Critical issues that prevent genuine improvement */
  criticalIssues: string[];
  
  /** Warnings about potential problems */
  warnings: string[];
  
  /** Recommendations for improvement */
  recommendations: string[];
  
  /** Evaluation metadata */
  metadata: {
    evaluatedAt: Date;
    evaluationVersion: string;
    criteriaUsed: GenuineImprovementCriteria;
    functionCount: {
      before: number;
      after: number;
    };
  };
}

/**
 * ChangesetEvaluator
 * 
 * Advanced evaluation system that combines multiple analysis techniques to provide
 * comprehensive assessment of refactoring quality and genuine improvement detection.
 * 
 * Key features:
 * - Integration with RefactoringHealthEngine for health assessment
 * - Function explosion detection using ExplosionDetector
 * - Multi-dimensional scoring system with configurable weights
 * - Detailed recommendations and actionable feedback
 */
export class ChangesetEvaluator {
  private readonly healthEngine: RefactoringHealthEngine;
  private readonly explosionDetector: FunctionExplosionDetector;
  private readonly logger: Logger;
  private readonly criteria: GenuineImprovementCriteria;

  constructor(
    private storage: StorageAdapter,
    lineageManager: LineageManager,
    criteria: Partial<GenuineImprovementCriteria> = {},
    logger?: Logger
  ) {
    this.logger = logger || new Logger(false, false);
    this.criteria = { ...DefaultGenuineImprovementCriteria, ...criteria };
    
    // Initialize health engine and explosion detector
    this.healthEngine = new RefactoringHealthEngine(storage, lineageManager);
    this.explosionDetector = new FunctionExplosionDetector(
      storage, 
      lineageManager, 
      {
        explosionRatioThreshold: this.criteria.maximumExplosionScore,
        strictMode: this.criteria.strictMode,
      },
      logger
    );
  }

  /**
   * Evaluate a refactoring changeset for genuine improvement
   */
  async evaluateChangeset(changeset: RefactoringChangeset): Promise<ChangesetEvaluationResult> {
    const evaluationId = `eval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      this.logger.info(`Starting changeset evaluation: ${changeset.id}`);
      
      // 1. Get health assessment using existing engine
      const healthAssessment = await this.healthEngine.evaluateChangeset(changeset);
      
      // 2. Detect function explosion
      const explosionResult = await this.explosionDetector.detectChangesetExplosion(changeset);
      
      // 3. Calculate comprehensive scores
      const scores = this.calculateComprehensiveScores(
        healthAssessment,
        explosionResult,
        changeset
      );
      
      // 4. Determine if improvement is genuine
      const isGenuineImprovement = this.determineGenuineImprovement(scores, explosionResult, healthAssessment.improvement);
      
      // 5. Calculate overall grade
      const grade = this.calculateOverallGrade(scores.overall, isGenuineImprovement);
      
      // 6. Generate critical issues, warnings, and recommendations
      const criticalIssues = this.identifyCriticalIssues(healthAssessment, explosionResult, scores);
      const warnings = this.generateWarnings(healthAssessment, explosionResult, scores);
      const recommendations = this.generateRecommendations(
        healthAssessment, 
        explosionResult, 
        scores, 
        isGenuineImprovement
      );
      
      // 7. Get function counts for metadata
      const beforeFunctions = await this.storage.getFunctionsBySnapshotId(changeset.beforeSnapshotId);
      const afterFunctions = await this.storage.getFunctionsBySnapshotId(changeset.afterSnapshotId);
      
      const result: ChangesetEvaluationResult = {
        evaluationId,
        changesetId: changeset.id,
        isGenuineImprovement,
        scores,
        grade,
        health: {
          before: healthAssessment.before,
          after: healthAssessment.after,
        },
        explosion: explosionResult,
        improvement: healthAssessment.improvement,
        criticalIssues,
        warnings,
        recommendations,
        metadata: {
          evaluatedAt: new Date(),
          evaluationVersion: EVALUATION_VERSION,
          criteriaUsed: this.criteria,
          functionCount: {
            before: beforeFunctions.length,
            after: afterFunctions.length,
          },
        },
      };
      
      this.logger.info(`Changeset evaluation completed: ${evaluationId}`, {
        isGenuine: isGenuineImprovement,
        grade,
        overallScore: scores.overall,
      });
      
      return result;
      
    } catch (error) {
      this.logger.error(`Error evaluating changeset ${changeset.id}`, {
        evaluationId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Return a safe default result
      return this.createErrorEvaluationResult(evaluationId, changeset.id, error);
    }
  }

  /**
   * Evaluate a refactoring operation (before full changeset creation)
   */
  async evaluateOperation(operation: RefactoringOperation): Promise<ChangesetEvaluationResult> {
    try {
      // Detect explosion in the operation
      const explosionResult = await this.explosionDetector.detectExplosion(operation);
      
      // Get parent and child function information
      const parentFunction = await this.storage.getFunction(operation.parentFunction);
      const childFunctions = await Promise.all(
        operation.childFunctions.map((id: string) => this.storage.getFunction(id))
      );
      
      const validChildFunctions = childFunctions.filter(f => f !== null) as FunctionInfo[];
      
      if (!parentFunction) {
        throw new Error(`Parent function ${operation.parentFunction} not found`);
      }
      
      // Create mock health assessments for before/after
      const beforeAssessment = this.createMockHealthAssessment([parentFunction]);
      const afterAssessment = this.createMockHealthAssessment(validChildFunctions);
      
      // Create mock changeset assessment
      const changesetAssessment: ChangesetAssessment = {
        before: beforeAssessment,
        after: afterAssessment,
        improvement: {
          complexityReduction: beforeAssessment.totalComplexity - afterAssessment.totalComplexity,
          riskImprovement: beforeAssessment.averageRiskScore - afterAssessment.averageRiskScore,
          maintainabilityGain: afterAssessment.overallScore - beforeAssessment.overallScore,
          functionExplosionScore: explosionResult.explosionScore,
          overallGrade: explosionResult.isExplosion ? 'F' : 'B',
          isGenuine: !explosionResult.isExplosion,
        },
        sessionId: operation.context.sessionId,
        changesetId: `temp_${operation.parentFunction}`,
        evaluatedAt: new Date(),
      };
      
      // Calculate scores and determine improvement
      const scores = this.calculateComprehensiveScores(changesetAssessment, explosionResult, null);
      const isGenuineImprovement = this.determineGenuineImprovement(scores, explosionResult, changesetAssessment.improvement);
      const grade = this.calculateOverallGrade(scores.overall, isGenuineImprovement);
      
      const evaluationId = `op_eval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        evaluationId,
        changesetId: `operation_${operation.parentFunction}`,
        isGenuineImprovement,
        scores,
        grade,
        health: {
          before: beforeAssessment,
          after: afterAssessment,
        },
        explosion: explosionResult,
        improvement: changesetAssessment.improvement,
        criticalIssues: explosionResult.isExplosion ? ['Function explosion detected'] : [],
        warnings: explosionResult.severity !== 'none' ? [`${explosionResult.severity} explosion risk`] : [],
        recommendations: explosionResult.recommendations,
        metadata: {
          evaluatedAt: new Date(),
          evaluationVersion: EVALUATION_VERSION,
          criteriaUsed: this.criteria,
          functionCount: {
            before: 1,
            after: validChildFunctions.length,
          },
        },
      };
      
    } catch (error) {
      this.logger.error(`Error evaluating operation`, {
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
      
      const evaluationId = `op_eval_error_${Date.now()}`;
      return this.createErrorEvaluationResult(evaluationId, `operation_${operation.parentFunction}`, error);
    }
  }

  /**
   * Calculate comprehensive scores for all improvement dimensions
   */
  private calculateComprehensiveScores(
    assessment: ChangesetAssessment,
    explosion: ExplosionDetectionResult,
    _changeset: RefactoringChangeset | null
  ): ChangesetEvaluationResult['scores'] {
    const { before, after, improvement } = assessment;
    const weights = this.criteria.weights;
    
    // 1. Complexity improvement score (0-100)
    const complexityScore = this.calculateComplexityScore(improvement.complexityReduction, before.totalComplexity);
    
    // 2. Risk reduction score (0-100)
    const riskScore = this.calculateRiskScore(improvement.riskImprovement);
    
    // 3. Maintainability improvement score (0-100)
    const maintainabilityScore = this.calculateMaintainabilityScore(improvement.maintainabilityGain);
    
    // 4. Code quality score based on overall grades (0-100)
    const codeQualityScore = this.calculateCodeQualityScore(before.overallScore, after.overallScore);
    
    // 5. Explosion penalty (negative score)
    const explosionPenalty = this.calculateExplosionPenalty(explosion.explosionScore);
    
    // 6. Calculate weighted overall score
    const rawOverallScore = (
      complexityScore * weights.complexity +
      riskScore * weights.risk +
      maintainabilityScore * weights.maintainability +
      codeQualityScore * weights.codeQuality
    ) + explosionPenalty * weights.explosion;
    
    // Ensure score is between 0 and 100
    const overall = Math.max(0, Math.min(100, rawOverallScore));
    
    return {
      overall,
      complexity: complexityScore,
      risk: riskScore,
      maintainability: maintainabilityScore,
      codeQuality: codeQualityScore,
      explosionPenalty,
    };
  }

  /**
   * Calculate complexity improvement score
   */
  private calculateComplexityScore(complexityReduction: number, originalComplexity: number): number {
    if (originalComplexity <= 0) return 50; // Neutral score for edge case
    
    const reductionPercentage = (complexityReduction / originalComplexity) * 100;
    
    // Score based on reduction percentage
    if (reductionPercentage >= 20) return 100; // Excellent reduction
    if (reductionPercentage >= 10) return 80;  // Good reduction
    if (reductionPercentage >= 5) return 60;   // Acceptable reduction
    if (reductionPercentage >= 0) return 40;   // Minimal reduction
    
    // Penalty for complexity increase
    return Math.max(0, 40 + reductionPercentage * 2);
  }

  /**
   * Calculate risk reduction score
   */
  private calculateRiskScore(riskImprovement: number): number {
    if (riskImprovement >= 50) return 100; // Excellent risk reduction
    if (riskImprovement >= 20) return 80;  // Good risk reduction
    if (riskImprovement >= 5) return 60;   // Moderate risk reduction
    if (riskImprovement >= 0) return 50;   // No risk increase
    
    // Penalty for risk increase
    return Math.max(0, 50 + riskImprovement);
  }

  /**
   * Calculate maintainability improvement score
   */
  private calculateMaintainabilityScore(maintainabilityGain: number): number {
    if (maintainabilityGain >= 10) return 100; // Excellent improvement
    if (maintainabilityGain >= 5) return 80;   // Good improvement
    if (maintainabilityGain >= 1) return 60;   // Moderate improvement
    if (maintainabilityGain >= 0) return 50;   // No degradation
    
    // Penalty for maintainability loss
    return Math.max(0, 50 + maintainabilityGain * 5);
  }

  /**
   * Calculate code quality score based on overall grades
   */
  private calculateCodeQualityScore(beforeScore: number, afterScore: number): number {
    const improvement = afterScore - beforeScore;
    
    // Base score from final quality
    let score = Math.min(100, afterScore);
    
    // Bonus for improvement
    if (improvement > 0) {
      score += Math.min(20, improvement * 2); // Up to 20 bonus points
    }
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate explosion penalty (negative score)
   */
  private calculateExplosionPenalty(explosionScore: number): number {
    // Convert explosion score to negative penalty
    return Math.min(0, -explosionScore * 50); // Up to -50 penalty
  }

  /**
   * Determine if improvement is genuine based on all criteria
   */
  private determineGenuineImprovement(
    scores: ChangesetEvaluationResult['scores'],
    explosion: ExplosionDetectionResult,
    improvement: ImprovementMetrics
  ): boolean {
    // Critical failure conditions
    if (explosion.isExplosion && explosion.severity === 'critical') {
      return false;
    }
    
    if (scores.overall < this.criteria.minimumOverallScore) {
      return false;
    }
    
    // Individual criteria checks using actual improvement metrics
    const complexityCheck = improvement.complexityReduction >= this.criteria.minimumComplexityReduction;
    const riskCheck = improvement.riskImprovement >= this.criteria.minimumRiskImprovement;
    const maintainabilityCheck = improvement.maintainabilityGain >= this.criteria.minimumMaintainabilityGain;
    
    const explosionCheck = !explosion.isExplosion || explosion.explosionScore <= this.criteria.maximumExplosionScore;
    
    if (this.criteria.strictMode) {
      // All criteria must pass in strict mode
      return complexityCheck && riskCheck && maintainabilityCheck && explosionCheck;
    } else {
      // More lenient - majority of criteria must pass
      const passingCriteria = [complexityCheck, riskCheck, maintainabilityCheck, explosionCheck].filter(Boolean).length;
      return passingCriteria >= 3;
    }
  }

  /**
   * Calculate overall letter grade
   */
  private calculateOverallGrade(
    overallScore: number, 
    isGenuineImprovement: boolean
  ): ChangesetEvaluationResult['grade'] {
    if (!isGenuineImprovement) return 'F';
    
    if (overallScore >= 95) return 'A+';
    if (overallScore >= 90) return 'A';
    if (overallScore >= 80) return 'B';
    if (overallScore >= 70) return 'C';
    if (overallScore >= 60) return 'D';
    return 'F';
  }

  /**
   * Identify critical issues that prevent genuine improvement
   */
  private identifyCriticalIssues(
    assessment: ChangesetAssessment,
    explosion: ExplosionDetectionResult,
    scores: ChangesetEvaluationResult['scores']
  ): string[] {
    const issues: string[] = [];
    
    if (explosion.severity === 'critical') {
      issues.push('Critical function explosion detected - excessive fragmentation');
    }
    
    if (assessment.improvement.complexityReduction < 0) {
      issues.push('Complexity increased instead of decreased');
    }
    
    if (assessment.improvement.riskImprovement < -10) {
      issues.push('Significant risk increase detected');
    }
    
    if (scores.overall < 30) {
      issues.push('Overall improvement score critically low');
    }
    
    if (assessment.after.averageRiskScore > assessment.before.averageRiskScore * 1.5) {
      issues.push('Risk score increased by more than 50%');
    }
    
    return issues;
  }

  /**
   * Generate warnings about potential problems
   */
  private generateWarnings(
    assessment: ChangesetAssessment,
    explosion: ExplosionDetectionResult,
    scores: ChangesetEvaluationResult['scores']
  ): string[] {
    const warnings: string[] = [];
    
    if (explosion.severity === 'moderate' || explosion.severity === 'severe') {
      warnings.push(`${explosion.severity} function explosion risk detected`);
    }
    
    if (scores.complexity < 50) {
      warnings.push('Limited complexity improvement achieved');
    }
    
    if (scores.risk < 40) {
      warnings.push('Risk reduction below expected levels');
    }
    
    if (assessment.after.totalFunctions > assessment.before.totalFunctions * 2) {
      warnings.push('Function count doubled - review for over-splitting');
    }
    
    if (scores.explosionPenalty < -20) {
      warnings.push('Significant explosion penalty applied to score');
    }
    
    return warnings;
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(
    assessment: ChangesetAssessment,
    explosion: ExplosionDetectionResult,
    scores: ChangesetEvaluationResult['scores'],
    isGenuineImprovement: boolean
  ): string[] {
    const recommendations: string[] = [];
    
    if (!isGenuineImprovement) {
      recommendations.push('🚨 Consider revising refactoring strategy for genuine improvement');
    }
    
    // Include explosion detector recommendations
    recommendations.push(...explosion.recommendations);
    
    if (scores.complexity < 60) {
      recommendations.push('💡 Focus on functions with highest complexity for better impact');
    }
    
    if (scores.risk < 60) {
      recommendations.push('🎯 Target high-risk functions identified by health assessment');
    }
    
    if (scores.maintainability < 60) {
      recommendations.push('📚 Consider improving code documentation and structure');
    }
    
    if (assessment.after.overallGrade === 'F') {
      recommendations.push('⚠️ Overall code quality still needs significant improvement');
    }
    
    if (isGenuineImprovement && scores.overall > 80) {
      recommendations.push('✅ Excellent refactoring - consider applying similar techniques elsewhere');
    }
    
    return recommendations;
  }

  /**
   * Create a mock health assessment for operation evaluation
   */
  private createMockHealthAssessment(functions: FunctionInfo[]): HealthAssessment {
    const functionsWithMetrics = functions.filter(f => f.metrics);
    const totalComplexity = functionsWithMetrics.reduce((sum, f) => sum + (f.metrics?.cyclomaticComplexity || 0), 0);
    // Risk score is calculated based on complexity with a multiplier of 5
    // This maps complexity (0-20) to risk score (0-100) where complexity of 20 equals risk score of 100
    const averageRiskScore = functionsWithMetrics.length > 0 ? totalComplexity / functionsWithMetrics.length * 5 : 0;
    
    return {
      totalFunctions: functions.length,
      totalComplexity,
      riskDistribution: { low: functions.length, medium: 0, high: 0, critical: 0 },
      averageRiskScore,
      highRiskFunctions: [],
      overallGrade: 'B',
      overallScore: Math.max(0, 100 - averageRiskScore * 2),
      qualityBreakdown: {
        complexity: { grade: 'B', score: 75 },
        maintainability: { grade: 'B', score: 75 },
        size: { grade: 'B', score: 75 },
      },
    };
  }

  /**
   * Create error evaluation result for failed evaluations
   */
  private createErrorEvaluationResult(
    evaluationId: string,
    changesetId: string,
    error: unknown
  ): ChangesetEvaluationResult {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      evaluationId,
      changesetId,
      isGenuineImprovement: false,
      scores: {
        overall: 0,
        complexity: 0,
        risk: 0,
        maintainability: 0,
        codeQuality: 0,
        explosionPenalty: 0,
      },
      grade: 'F',
      health: {
        before: this.createMockHealthAssessment([]),
        after: this.createMockHealthAssessment([]),
      },
      explosion: {
        isExplosion: false,
        explosionScore: 0,
        severity: 'none',
        metrics: {
          originalFunctionCount: 0,
          resultingFunctionCount: 0,
          newFunctionCount: 0,
          explosionRatio: 0,
          originalAverageComplexity: 0,
          resultingAverageComplexity: 0,
          originalLinesOfCode: 0,
          resultingLinesOfCode: 0,
          codeExpansionRatio: 1,
        },
        reasons: ['Evaluation failed due to error'],
        recommendations: ['Review system logs for error details'],
      },
      improvement: {
        complexityReduction: 0,
        riskImprovement: 0,
        maintainabilityGain: 0,
        functionExplosionScore: 0,
        overallGrade: 'F',
        isGenuine: false,
      },
      criticalIssues: [`Evaluation error: ${errorMessage}`],
      warnings: ['Evaluation could not be completed'],
      recommendations: ['Check system status and retry evaluation'],
      metadata: {
        evaluatedAt: new Date(),
        evaluationVersion: '3.0.0',
        criteriaUsed: this.criteria,
        functionCount: {
          before: 0,
          after: 0,
        },
      },
    };
  }
}