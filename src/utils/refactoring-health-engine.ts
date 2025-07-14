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
  StorageAdapter,
  Lineage,
} from '../types/index.js';
import { ThresholdEvaluator } from './threshold-evaluator.js';
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

  constructor(
    private storage: StorageAdapter,
    private lineageManager: LineageManager
  ) {
    this.thresholdEvaluator = new ThresholdEvaluator();
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

    // Calculate changeset metrics using LineageManager
    const beforeMetrics = await this.lineageManager.calculateChangesetMetrics(beforeFunctions);
    const afterMetrics = await this.lineageManager.calculateChangesetMetrics(afterFunctions);

    // Calculate improvement metrics
    const improvementMetrics = await this.calculateImprovementMetrics(
      beforeAssessment,
      afterAssessment,
      changeset,
      beforeMetrics,
      afterMetrics
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
      if (!func.metrics) continue; // Skip functions without metrics
      
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
    changeset: RefactoringChangeset,
    _beforeMetrics?: ChangesetMetrics,
    _afterMetrics?: ChangesetMetrics
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
      functionExplosionScore,
      before.totalComplexity
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
    functionExplosionScore: number,
    beforeComplexity: number
  ): boolean {
    // Genuine improvement criteria:
    // 1. Meaningful complexity reduction (>= 5%)
    // 2. Risk improvement or at least not worse
    // 3. Maintainability gain or at least not worse
    // 4. Function explosion score within reasonable bounds (<= 0.3)
    
    const complexityReductionPercentage = beforeComplexity > 0 ? (complexityReduction / beforeComplexity) * 100 : 0;
    const meaningfulComplexityReduction = complexityReductionPercentage >= 5;
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
    if (!func.metrics) {
      throw new Error(`Function ${func.id} has no metrics`);
    }

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

    // Calculate violation counts by level
    const violationsByLevel = violations.reduce((counts, violation) => {
      counts[violation.level] = (counts[violation.level] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    return {
      functionId: func.id,
      functionName: func.name,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: func.endLine,
      riskScore,
      violations,
      totalViolations: violations.length,
      violationsByLevel: violationsByLevel as any,
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
    // Filter functions with metrics
    const functionsWithMetrics = functions.filter(f => f.metrics);
    
    if (functionsWithMetrics.length === 0) {
      return {
        complexity: { score: 100, grade: 'A' },
        maintainability: { score: 100, grade: 'A' },
        size: { score: 100, grade: 'A' },
      };
    }

    // Calculate average metrics
    if (functionsWithMetrics.length === 0) {
      throw new Error('No functions with metrics available for quality breakdown calculation');
    }
    const avgComplexity = functionsWithMetrics.reduce((sum, f) => sum + f.metrics!.cyclomaticComplexity, 0) / functionsWithMetrics.length;
    const avgSize = functionsWithMetrics.reduce((sum, f) => sum + f.metrics!.linesOfCode, 0) / functionsWithMetrics.length;
    const avgMaintainability = functionsWithMetrics.reduce((sum, f) => sum + (f.metrics!.maintainabilityIndex || 50), 0) / functionsWithMetrics.length;

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
    const metrics = functions.map(f => f.metrics).filter(m => m !== undefined) as QualityMetrics[];
    
    if (metrics.length === 0) {
      // Return default statistics for empty metrics
      return {
        totalFunctions: 0,
        analysisTimestamp: Date.now(),
        averageComplexity: 0,
        averageSize: 0,
        medianComplexity: 0,
        p90Complexity: 0,
        complexityDistribution: this.createEmptyMetricStatistics(),
        sizeDistribution: this.createEmptyMetricStatistics(),
        riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
        metrics: {} as Record<keyof QualityMetrics, MetricStatistics>,
      };
    }
    
    return {
      totalFunctions: functions.length,
      analysisTimestamp: Date.now(),
      averageComplexity: metrics.reduce((sum, m) => sum + m.cyclomaticComplexity, 0) / metrics.length,
      averageSize: metrics.reduce((sum, m) => sum + m.linesOfCode, 0) / metrics.length,
      medianComplexity: this.calculateMedian(metrics.map(m => m.cyclomaticComplexity)),
      p90Complexity: this.calculatePercentile(metrics.map(m => m.cyclomaticComplexity), 0.9),
      complexityDistribution: this.calculateComplexityDistribution(metrics),
      sizeDistribution: this.calculateSizeDistribution(metrics),
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 }, // Will be calculated
      metrics: {} as Record<keyof QualityMetrics, MetricStatistics>, // Simplified for now
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
    const mean = complexities.reduce((sum, c) => sum + c, 0) / complexities.length;
    const variance = complexities.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / complexities.length;
    
    return {
      min: Math.min(...complexities),
      max: Math.max(...complexities),
      mean,
      median: this.calculateMedian(complexities),
      standardDeviation: Math.sqrt(variance),
      variance,
      p90: this.calculatePercentile(complexities, 0.9),
      p95: this.calculatePercentile(complexities, 0.95),
      percentiles: {
        p25: this.calculatePercentile(complexities, 0.25),
        p50: this.calculateMedian(complexities),
        p75: this.calculatePercentile(complexities, 0.75),
        p90: this.calculatePercentile(complexities, 0.9),
        p95: this.calculatePercentile(complexities, 0.95),
        p99: this.calculatePercentile(complexities, 0.99),
      },
      mad: 0, // Simplified for now
    };
  }

  /**
   * Calculate size distribution
   */
  private calculateSizeDistribution(metrics: QualityMetrics[]): MetricStatistics {
    const sizes = metrics.map(m => m.linesOfCode);
    const mean = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
    const variance = sizes.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sizes.length;
    
    return {
      min: Math.min(...sizes),
      max: Math.max(...sizes),
      mean,
      median: this.calculateMedian(sizes),
      standardDeviation: Math.sqrt(variance),
      variance,
      p90: this.calculatePercentile(sizes, 0.9),
      p95: this.calculatePercentile(sizes, 0.95),
      percentiles: {
        p25: this.calculatePercentile(sizes, 0.25),
        p50: this.calculateMedian(sizes),
        p75: this.calculatePercentile(sizes, 0.75),
        p90: this.calculatePercentile(sizes, 0.9),
        p95: this.calculatePercentile(sizes, 0.95),
        p99: this.calculatePercentile(sizes, 0.99),
      },
      mad: 0, // Simplified for now
    };
  }


  /**
   * Create empty metric statistics
   */
  private createEmptyMetricStatistics(): MetricStatistics {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      standardDeviation: 0,
      variance: 0,
      p90: 0,
      p95: 0,
      percentiles: {
        p25: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0,
      },
      mad: 0,
    };
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
    const lineageData: Lineage = {
      id: uuidv4(),
      fromIds: [operation.parentFunction],
      toIds: operation.childFunctions,
      kind: operation.type as any,
      status: 'approved' as const,
      confidence: 0.95,
      gitCommit: operation.context.afterSnapshot,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.storage.saveLineage(lineageData);
  }

  async getRelatedFunctions(functionId: string): Promise<FunctionLineage> {
    const lineages = await this.storage.getLineagesByFunctionId(functionId);
    
    const parentFunctions: string[] = [];
    const childFunctions: string[] = [];
    let lineageType: 'split' | 'extract' | 'merge' | 'rename' = 'split';

    for (const lineage of lineages) {
      if (lineage.fromIds.includes(functionId)) {
        childFunctions.push(...lineage.toIds);
        lineageType = lineage.kind as 'split' | 'extract' | 'merge' | 'rename';
      }
      if (lineage.toIds.includes(functionId)) {
        parentFunctions.push(...lineage.fromIds);
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
    const functionsWithMetrics = functions.filter(f => f.metrics);
    
    if (functionsWithMetrics.length === 0) {
      return {
        totalComplexity: 0,
        totalLinesOfCode: 0,
        averageComplexity: 0,
        highRiskCount: 0,
        functionCount: 0,
        riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      };
    }

    const totalComplexity = functionsWithMetrics.reduce((sum, f) => sum + f.metrics!.cyclomaticComplexity, 0);
    const totalLinesOfCode = functionsWithMetrics.reduce((sum, f) => sum + f.metrics!.linesOfCode, 0);
    const averageComplexity = totalComplexity / functionsWithMetrics.length;
    const highRiskCount = functionsWithMetrics.filter(f => f.metrics!.cyclomaticComplexity > 10).length;

    const riskDistribution = functionsWithMetrics.reduce((dist, f) => {
      const complexity = f.metrics!.cyclomaticComplexity;
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