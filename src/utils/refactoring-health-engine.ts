import {
  RefactoringChangeset,
  HealthAssessment,
  ImprovementMetrics,
  ChangesetAssessment,
  RefactoringOperation,
  LineageManager,
  FunctionInfo,
  QualityMetrics,
  FunctionRiskAssessment,
  RiskDistribution,
  ProjectStatistics,
  MetricStatistics,
  ChangesetMetrics,
  FunctionLineage,
  RefactoringContext,
  StorageAdapter,
} from '../types/index.js';
import { ThresholdEvaluator } from './threshold-evaluator.js';
import { StatisticalEvaluator } from './statistical-evaluator.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * RefactoringHealthEngine
 * 
 * Integrates the health command's sophisticated evaluation engine with refactoring
 * operations to provide accurate assessment of genuine improvements vs. cosmetic changes.
 * 
 * Key features:
 * - Health engine integration via ThresholdEvaluator
 * - Function explosion detection
 * - Changeset-based evaluation
 * - Lineage tracking integration
 * - True improvement measurement
 */
export class RefactoringHealthEngine {
  private thresholdEvaluator: ThresholdEvaluator;
  private statisticalEvaluator: StatisticalEvaluator;
  private lineageManager: LineageManager;

  constructor(
    private storage: StorageAdapter,
    lineageManager: LineageManager
  ) {
    this.thresholdEvaluator = new ThresholdEvaluator();
    this.statisticalEvaluator = new StatisticalEvaluator();
    this.lineageManager = lineageManager;
  }

  /**
   * Evaluate a refactoring changeset for genuine improvement
   */
  async evaluateChangeset(changeset: RefactoringChangeset): Promise<ChangesetAssessment> {
    // Get functions from before and after snapshots
    const beforeFunctions = await this.getFunctionsFromSnapshot(changeset.beforeSnapshotId);
    const afterFunctions = await this.getFunctionsFromSnapshot(changeset.afterSnapshotId);

    // Calculate health assessments using ThresholdEvaluator
    const beforeAssessment = await this.calculateHealthAssessment(beforeFunctions);
    const afterAssessment = await this.calculateHealthAssessment(afterFunctions);

    // Calculate improvement metrics
    const improvementMetrics = await this.calculateImprovementMetrics(
      beforeAssessment,
      afterAssessment,
      changeset
    );

    // Create assessment result
    const assessment: ChangesetAssessment = {
      before: beforeAssessment,
      after: afterAssessment,
      improvement: improvementMetrics,
      sessionId: changeset.sessionId,
      changesetId: changeset.id,
      evaluatedAt: new Date(),
    };

    return assessment;
  }

  /**
   * Calculate health assessment for a set of functions using ThresholdEvaluator
   */
  private async calculateHealthAssessment(functions: FunctionInfo[]): Promise<HealthAssessment> {
    if (functions.length === 0) {
      return this.createEmptyHealthAssessment();
    }

    // Get project statistics for threshold evaluation
    const projectStats = await this.getProjectStatistics(functions);

    // Evaluate all functions with threshold evaluator
    const functionRiskAssessments: FunctionRiskAssessment[] = [];
    let totalComplexity = 0;
    let totalRiskScore = 0;

    for (const func of functions) {
      const riskAssessment = await this.evaluateFunctionRisk(func, projectStats);
      functionRiskAssessments.push(riskAssessment);
      totalComplexity += func.metrics.cyclomaticComplexity;
      totalRiskScore += riskAssessment.riskScore;
    }

    // Calculate risk distribution
    const riskDistribution = this.calculateRiskDistribution(functionRiskAssessments);

    // Calculate overall grade and score
    const averageRiskScore = totalRiskScore / functions.length;
    const overallScore = this.calculateOverallScore(functionRiskAssessments);
    const overallGrade = this.calculateOverallGrade(overallScore);

    // Calculate quality breakdown
    const qualityBreakdown = this.calculateQualityBreakdown(functions);

    return {
      totalFunctions: functions.length,
      totalComplexity,
      riskDistribution,
      averageRiskScore,
      highRiskFunctions: functionRiskAssessments.filter(f => f.riskScore > 100),
      overallGrade,
      overallScore,
      qualityBreakdown,
    };
  }

  /**
   * Calculate improvement metrics with function explosion detection
   */
  private async calculateImprovementMetrics(
    before: HealthAssessment,
    after: HealthAssessment,
    changeset: RefactoringChangeset
  ): Promise<ImprovementMetrics> {
    const complexityReduction = before.totalComplexity - after.totalComplexity;
    const riskImprovement = before.averageRiskScore - after.averageRiskScore;
    const maintainabilityGain = after.overallScore - before.overallScore;

    // Calculate function explosion score
    const functionExplosionScore = this.calculateFunctionExplosionScore(
      before.totalFunctions,
      after.totalFunctions,
      changeset
    );

    // Determine if improvement is genuine
    const isGenuine = this.isGenuineImprovement(
      complexityReduction,
      riskImprovement,
      maintainabilityGain,
      functionExplosionScore
    );

    // Calculate overall improvement grade
    const overallGrade = this.calculateImprovementGrade(
      complexityReduction,
      riskImprovement,
      maintainabilityGain,
      functionExplosionScore,
      isGenuine
    );

    return {
      complexityReduction,
      riskImprovement,
      maintainabilityGain,
      functionExplosionScore,
      overallGrade,
      isGenuine,
    };
  }

  /**
   * Calculate function explosion score to detect excessive splitting
   */
  private calculateFunctionExplosionScore(
    beforeCount: number,
    afterCount: number,
    changeset: RefactoringChangeset
  ): number {
    if (beforeCount === 0) return 0;
    
    const functionIncrease = afterCount - beforeCount;
    
    // Function explosion score is the ratio of new functions to original lines of code
    // Higher values indicate excessive splitting
    if (changeset.operationType === 'split' && changeset.parentFunctionId) {
      // For split operations, we calculate based on child functions created
      const childCount = changeset.childFunctionIds.length;
      return childCount / Math.max(beforeCount, 1);
    }
    
    // General explosion score
    return functionIncrease / beforeCount;
  }

  /**
   * Determine if improvement is genuine based on multiple factors
   */
  private isGenuineImprovement(
    complexityReduction: number,
    riskImprovement: number,
    maintainabilityGain: number,
    functionExplosionScore: number
  ): boolean {
    // Genuine improvement criteria:
    // 1. Meaningful complexity reduction (>= 5%)
    // 2. Risk improvement or at least not worse
    // 3. Maintainability gain or at least not worse
    // 4. Function explosion score within reasonable bounds (<= 0.3)
    
    const meaningfulComplexityReduction = complexityReduction >= 5;
    const riskNotWorse = riskImprovement >= 0;
    const maintainabilityNotWorse = maintainabilityGain >= 0;
    const explosionWithinBounds = functionExplosionScore <= 0.3;

    return meaningfulComplexityReduction && 
           riskNotWorse && 
           maintainabilityNotWorse && 
           explosionWithinBounds;
  }

  /**
   * Calculate overall improvement grade
   */
  private calculateImprovementGrade(
    complexityReduction: number,
    riskImprovement: number,
    maintainabilityGain: number,
    functionExplosionScore: number,
    isGenuine: boolean
  ): 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' {
    if (!isGenuine) {
      return 'F'; // Fake improvement gets F grade
    }

    // Calculate composite score
    const complexityScore = Math.min(complexityReduction / 20, 1); // 20+ reduction = max score
    const riskScore = Math.min(riskImprovement / 100, 1); // 100+ risk improvement = max score
    const maintainabilityScore = Math.min(maintainabilityGain / 20, 1); // 20+ gain = max score
    const explosionPenalty = Math.max(0, functionExplosionScore - 0.1) * 2; // Penalty for explosion

    const totalScore = (complexityScore + riskScore + maintainabilityScore) / 3 - explosionPenalty;

    if (totalScore >= 0.9) return 'A+';
    if (totalScore >= 0.8) return 'A';
    if (totalScore >= 0.7) return 'B';
    if (totalScore >= 0.6) return 'C';
    if (totalScore >= 0.5) return 'D';
    return 'F';
  }

  /**
   * Evaluate function risk using ThresholdEvaluator
   */
  private async evaluateFunctionRisk(
    func: FunctionInfo,
    projectStats: ProjectStatistics
  ): Promise<FunctionRiskAssessment> {
    // Use the existing threshold configuration
    const thresholds = {
      cyclomaticComplexity: { warning: 10, error: 15, critical: 20 },
      linesOfCode: { warning: 50, error: 100, critical: 150 },
      cognitiveComplexity: { warning: 15, error: 25, critical: 35 },
      maxNestingLevel: { warning: 3, error: 5, critical: 7 },
      parameterCount: { warning: 4, error: 6, critical: 8 },
    };

    const violations = this.thresholdEvaluator.evaluateFunctionThresholds(
      func.metrics,
      thresholds,
      projectStats
    );

    // Calculate risk score based on violations
    const riskScore = violations.reduce((total, violation) => {
      const weights = { warning: 1, error: 5, critical: 25 };
      return total + (weights[violation.level] || 0);
    }, 0);

    return {
      functionId: func.id,
      functionName: func.name,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: func.endLine,
      riskScore,
      violations,
      riskLevel: this.calculateRiskLevel(riskScore),
      metrics: func.metrics,
    };
  }

  /**
   * Calculate risk level based on risk score
   */
  private calculateRiskLevel(riskScore: number): 'low' | 'medium' | 'high' | 'critical' {
    if (riskScore >= 100) return 'critical';
    if (riskScore >= 50) return 'high';
    if (riskScore >= 10) return 'medium';
    return 'low';
  }

  /**
   * Calculate risk distribution
   */
  private calculateRiskDistribution(assessments: FunctionRiskAssessment[]): RiskDistribution {
    const distribution = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    assessments.forEach(assessment => {
      distribution[assessment.riskLevel]++;
    });

    return distribution;
  }

  /**
   * Calculate overall score from function risk assessments
   */
  private calculateOverallScore(assessments: FunctionRiskAssessment[]): number {
    if (assessments.length === 0) return 100;

    const totalRiskScore = assessments.reduce((sum, assessment) => sum + assessment.riskScore, 0);
    const averageRiskScore = totalRiskScore / assessments.length;

    // Convert risk score to quality score (inverse relationship)
    return Math.max(0, 100 - averageRiskScore / 10);
  }

  /**
   * Calculate overall grade from score
   */
  private calculateOverallGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  /**
   * Calculate quality breakdown
   */
  private calculateQualityBreakdown(functions: FunctionInfo[]): {
    complexity: { grade: string; score: number };
    maintainability: { grade: string; score: number };
    size: { grade: string; score: number };
  } {
    // Calculate average metrics
    const avgComplexity = functions.reduce((sum, f) => sum + f.metrics.cyclomaticComplexity, 0) / functions.length;
    const avgSize = functions.reduce((sum, f) => sum + f.metrics.linesOfCode, 0) / functions.length;
    const avgMaintainability = functions.reduce((sum, f) => sum + (f.metrics.maintainabilityIndex || 50), 0) / functions.length;

    return {
      complexity: {
        score: Math.max(0, 100 - avgComplexity * 5),
        grade: this.calculateOverallGrade(Math.max(0, 100 - avgComplexity * 5)),
      },
      maintainability: {
        score: avgMaintainability,
        grade: this.calculateOverallGrade(avgMaintainability),
      },
      size: {
        score: Math.max(0, 100 - avgSize * 2),
        grade: this.calculateOverallGrade(Math.max(0, 100 - avgSize * 2)),
      },
    };
  }

  /**
   * Get project statistics for threshold evaluation
   */
  private async getProjectStatistics(functions: FunctionInfo[]): Promise<ProjectStatistics> {
    const metrics = functions.map(f => f.metrics);
    
    return {
      totalFunctions: functions.length,
      averageComplexity: metrics.reduce((sum, m) => sum + m.cyclomaticComplexity, 0) / metrics.length,
      averageSize: metrics.reduce((sum, m) => sum + m.linesOfCode, 0) / metrics.length,
      medianComplexity: this.calculateMedian(metrics.map(m => m.cyclomaticComplexity)),
      p90Complexity: this.calculatePercentile(metrics.map(m => m.cyclomaticComplexity), 0.9),
      complexityDistribution: this.calculateComplexityDistribution(metrics),
      sizeDistribution: this.calculateSizeDistribution(metrics),
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 }, // Will be calculated
    };
  }

  /**
   * Calculate median value
   */
  private calculateMedian(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.floor(percentile * (sorted.length - 1));
    return sorted[index];
  }

  /**
   * Calculate complexity distribution
   */
  private calculateComplexityDistribution(metrics: QualityMetrics[]): MetricStatistics {
    const complexities = metrics.map(m => m.cyclomaticComplexity);
    return {
      min: Math.min(...complexities),
      max: Math.max(...complexities),
      mean: complexities.reduce((sum, c) => sum + c, 0) / complexities.length,
      median: this.calculateMedian(complexities),
      p90: this.calculatePercentile(complexities, 0.9),
      p95: this.calculatePercentile(complexities, 0.95),
      standardDeviation: this.calculateStandardDeviation(complexities),
    };
  }

  /**
   * Calculate size distribution
   */
  private calculateSizeDistribution(metrics: QualityMetrics[]): MetricStatistics {
    const sizes = metrics.map(m => m.linesOfCode);
    return {
      min: Math.min(...sizes),
      max: Math.max(...sizes),
      mean: sizes.reduce((sum, s) => sum + s, 0) / sizes.length,
      median: this.calculateMedian(sizes),
      p90: this.calculatePercentile(sizes, 0.9),
      p95: this.calculatePercentile(sizes, 0.95),
      standardDeviation: this.calculateStandardDeviation(sizes),
    };
  }

  /**
   * Calculate standard deviation
   */
  private calculateStandardDeviation(values: number[]): number {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Get functions from snapshot
   */
  private async getFunctionsFromSnapshot(snapshotId: string): Promise<FunctionInfo[]> {
    return await this.storage.getFunctionsBySnapshotId(snapshotId);
  }

  /**
   * Create empty health assessment
   */
  private createEmptyHealthAssessment(): HealthAssessment {
    return {
      totalFunctions: 0,
      totalComplexity: 0,
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      averageRiskScore: 0,
      highRiskFunctions: [],
      overallGrade: 'A',
      overallScore: 100,
      qualityBreakdown: {
        complexity: { grade: 'A', score: 100 },
        maintainability: { grade: 'A', score: 100 },
        size: { grade: 'A', score: 100 },
      },
    };
  }

  /**
   * Create a new refactoring changeset
   */
  async createChangeset(
    sessionId: string,
    operation: RefactoringOperation,
    beforeSnapshotId: string,
    afterSnapshotId: string
  ): Promise<RefactoringChangeset> {
    const changeset: RefactoringChangeset = {
      id: uuidv4(),
      sessionId,
      operationType: operation.type,
      parentFunctionId: operation.parentFunction,
      childFunctionIds: operation.childFunctions,
      beforeSnapshotId,
      afterSnapshotId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Evaluate the changeset
    const assessment = await this.evaluateChangeset(changeset);
    
    // Update changeset with assessment results
    changeset.healthAssessment = assessment.before;
    changeset.improvementMetrics = assessment.improvement;
    changeset.isGenuineImprovement = assessment.improvement.isGenuine;
    changeset.functionExplosionScore = assessment.improvement.functionExplosionScore;

    return changeset;
  }

  /**
   * Save a changeset to the database
   */
  async saveChangeset(changeset: RefactoringChangeset): Promise<void> {
    await this.storage.saveRefactoringChangeset(changeset);
  }

  /**
   * Get changesets for a session
   */
  async getChangesetsBySession(sessionId: string): Promise<RefactoringChangeset[]> {
    return await this.storage.getRefactoringChangesetsBySession(sessionId);
  }
}

/**
 * Implementation of LineageManager for tracking function relationships
 */
export class DefaultLineageManager implements LineageManager {
  constructor(private storage: StorageAdapter) {}

  async trackRefactoringOperation(operation: RefactoringOperation): Promise<void> {
    // Track the refactoring operation in the lineages table
    const lineageData = {
      id: uuidv4(),
      from_ids: [operation.parentFunction],
      to_ids: operation.childFunctions,
      kind: operation.type,
      status: 'approved' as const,
      confidence: 0.95,
      git_commit: operation.context.afterSnapshot,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await this.storage.saveLineage(lineageData);
  }

  async getRelatedFunctions(functionId: string): Promise<FunctionLineage> {
    const lineages = await this.storage.getLineagesByFunctionId(functionId);
    
    const parentFunctions: string[] = [];
    const childFunctions: string[] = [];
    let lineageType: 'split' | 'extract' | 'merge' | 'rename' = 'split';

    for (const lineage of lineages) {
      if (lineage.from_ids.includes(functionId)) {
        childFunctions.push(...lineage.to_ids);
        lineageType = lineage.kind as 'split' | 'extract' | 'merge' | 'rename';
      }
      if (lineage.to_ids.includes(functionId)) {
        parentFunctions.push(...lineage.from_ids);
        lineageType = lineage.kind as 'split' | 'extract' | 'merge' | 'rename';
      }
    }

    return {
      functionId,
      parentFunctions,
      childFunctions,
      relatedFunctions: [...parentFunctions, ...childFunctions],
      lineageType,
      createdAt: new Date(),
    };
  }

  async calculateChangesetMetrics(functions: FunctionInfo[]): Promise<ChangesetMetrics> {
    const totalComplexity = functions.reduce((sum, f) => sum + f.metrics.cyclomaticComplexity, 0);
    const totalLinesOfCode = functions.reduce((sum, f) => sum + f.metrics.linesOfCode, 0);
    const averageComplexity = totalComplexity / functions.length;
    const highRiskCount = functions.filter(f => f.metrics.cyclomaticComplexity > 10).length;

    const riskDistribution = functions.reduce((dist, f) => {
      const complexity = f.metrics.cyclomaticComplexity;
      if (complexity >= 20) dist.critical++;
      else if (complexity >= 15) dist.high++;
      else if (complexity >= 10) dist.medium++;
      else dist.low++;
      return dist;
    }, { low: 0, medium: 0, high: 0, critical: 0 });

    return {
      totalComplexity,
      totalLinesOfCode,
      averageComplexity,
      highRiskCount,
      functionCount: functions.length,
      riskDistribution,
    };
  }
}