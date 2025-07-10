import { FunctionInfo } from '../types';

/**
 * Quality assessment thresholds and penalty coefficients
 */
const QUALITY_THRESHOLDS = {
  // Complexity thresholds
  complexity: {
    high: 10,
    veryHigh: 15,
    ratioThreshold: 0.05, // 5% threshold for penalties
    penaltyCoefficient: 250, // Unified smooth penalty
  },
  // Maintainability thresholds
  maintainability: {
    low: 50,
    ratioThreshold: 0.1, // 10% threshold
    penaltyCoefficient: 250,
  },
  // Size thresholds
  size: {
    large: 50,
    veryLarge: 100,
    ratioThreshold: 0.1, // 10% threshold
    penaltyCoefficient: 200,
    avgPenalty: 2.0, // Per-line penalty for average
  },
  // Code quality thresholds
  codeQuality: {
    commentRatio: {
      low: 0.05,
      medium: 0.1,
    },
    parameterCount: 5,
    parameterRatioThreshold: 0.1,
  },
  // High risk function criteria (unified with scoring)
  highRisk: {
    complexity: 10,
    maintainability: 50,
    size: 100,
  },
} as const;

export interface ProjectQualityScore {
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  complexityScore: number;
  maintainabilityScore: number;
  sizeScore: number;
  codeQualityScore: number;
  totalFunctions: number;
  highRiskFunctions: number;
  topProblematicFunctions: Array<{
    name: string;
    filePath: string;
    complexity: number;
    maintainabilityIndex: number;
    reason: string;
  }>;
}

export class QualityScorer {
  calculateProjectScore(functions: FunctionInfo[]): ProjectQualityScore {
    if (functions.length === 0) {
      return {
        overallGrade: 'A',
        score: 100,
        complexityScore: 100,
        maintainabilityScore: 100,
        sizeScore: 100,
        codeQualityScore: 100,
        totalFunctions: 0,
        highRiskFunctions: 0,
        topProblematicFunctions: [],
      };
    }

    const scores = {
      complexity: this.calculateComplexityScore(functions),
      maintainability: this.calculateMaintainabilityScore(functions),
      size: this.calculateSizeScore(functions),
      codeQuality: this.calculateCodeQualityScore(functions),
    };

    // Balanced weighted average with adjusted weights
    const overallScore = Math.round(
      scores.complexity * 0.30 +
        scores.maintainability * 0.30 +
        scores.size * 0.20 +
        scores.codeQuality * 0.20
    );

    const overallGrade = this.scoreToGrade(overallScore);
    const highRiskFunctions = this.countHighRiskFunctions(functions);
    const topProblematicFunctions = this.getTopProblematicFunctions(functions);

    return {
      overallGrade,
      score: overallScore,
      complexityScore: scores.complexity,
      maintainabilityScore: scores.maintainability,
      sizeScore: scores.size,
      codeQualityScore: scores.codeQuality,
      totalFunctions: functions.length,
      highRiskFunctions,
      topProblematicFunctions,
    };
  }

  private calculateComplexityScore(functions: FunctionInfo[]): number {
    // Filter out functions without metrics to avoid bias
    const functionsWithMetrics = functions.filter(f => f.metrics?.cyclomaticComplexity !== undefined);
    if (functionsWithMetrics.length === 0) return 100;

    const complexities = functionsWithMetrics.map(f => f.metrics!.cyclomaticComplexity!);
    const avgComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;
    
    // Use unified ratio-based scoring with smooth linear penalty
    const highComplexityRatio = this.getComplexityRatio(functionsWithMetrics, QUALITY_THRESHOLDS.complexity.high);
    
    let score = 100;

    // Smooth linear penalty for high complexity ratio
    if (highComplexityRatio > QUALITY_THRESHOLDS.complexity.ratioThreshold) {
      const excessRatio = highComplexityRatio - QUALITY_THRESHOLDS.complexity.ratioThreshold;
      score -= excessRatio * QUALITY_THRESHOLDS.complexity.penaltyCoefficient;
    }

    // Light penalty for high average complexity (avoid double penalty)
    if (avgComplexity > 8) {
      score -= (avgComplexity - 8) * 3;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate the ratio of functions exceeding complexity threshold
   */
  private getComplexityRatio(functions: FunctionInfo[], threshold: number): number {
    const highComplexityFunctions = functions.filter(
      f => f.metrics?.cyclomaticComplexity !== undefined && f.metrics.cyclomaticComplexity > threshold
    );
    return functions.length > 0 ? highComplexityFunctions.length / functions.length : 0;
  }

  private calculateMaintainabilityScore(functions: FunctionInfo[]): number {
    // Filter functions with valid maintainability metrics
    const functionsWithMetrics = functions.filter(
      f => f.metrics?.maintainabilityIndex !== undefined && f.metrics.maintainabilityIndex > 0
    );
    
    if (functionsWithMetrics.length === 0) return 100;

    // Use Lines of Code weighted average for more realistic assessment
    const weightedData = functionsWithMetrics.map(f => ({
      mi: f.metrics!.maintainabilityIndex!,
      weight: Math.max(1, f.metrics?.linesOfCode || 1), // Minimum weight of 1
    }));

    const totalWeight = weightedData.reduce((sum, data) => sum + data.weight, 0);
    const weightedAvg = weightedData.reduce((sum, data) => sum + data.mi * data.weight, 0) / totalWeight;

    // Additional penalty for functions with very low maintainability
    const lowMaintainabilityRatio = this.getMaintainabilityRatio(functionsWithMetrics, QUALITY_THRESHOLDS.maintainability.low);
    let score = Math.round(weightedAvg);
    
    // Smooth linear penalty for low maintainability ratio
    if (lowMaintainabilityRatio > QUALITY_THRESHOLDS.maintainability.ratioThreshold) {
      const excessRatio = lowMaintainabilityRatio - QUALITY_THRESHOLDS.maintainability.ratioThreshold;
      score -= excessRatio * QUALITY_THRESHOLDS.maintainability.penaltyCoefficient;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate the ratio of functions with low maintainability
   */
  private getMaintainabilityRatio(functions: FunctionInfo[], threshold: number): number {
    const lowMaintainabilityFunctions = functions.filter(
      f => f.metrics?.maintainabilityIndex !== undefined && f.metrics.maintainabilityIndex < threshold
    );
    return functions.length > 0 ? lowMaintainabilityFunctions.length / functions.length : 0;
  }

  private calculateSizeScore(functions: FunctionInfo[]): number {
    // Filter functions with valid size metrics
    const functionsWithMetrics = functions.filter(f => f.metrics?.linesOfCode !== undefined);
    if (functionsWithMetrics.length === 0) return 100;

    const lines = functionsWithMetrics.map(f => f.metrics!.linesOfCode!);
    const avgLines = lines.reduce((a, b) => a + b, 0) / lines.length;
    
    // Use unified ratio-based scoring for large functions
    const largeFunctionRatio = this.getSizeRatio(functionsWithMetrics, QUALITY_THRESHOLDS.size.large);

    let score = 100;

    // Penalize high average size with adjusted coefficients
    if (avgLines > 30) {
      score -= (avgLines - 30) * QUALITY_THRESHOLDS.size.avgPenalty;
    }

    // Smooth linear penalty for large function ratio
    if (largeFunctionRatio > QUALITY_THRESHOLDS.size.ratioThreshold) {
      const excessRatio = largeFunctionRatio - QUALITY_THRESHOLDS.size.ratioThreshold;
      score -= excessRatio * QUALITY_THRESHOLDS.size.penaltyCoefficient;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate the ratio of functions exceeding size threshold
   */
  private getSizeRatio(functions: FunctionInfo[], threshold: number): number {
    const largeFunctions = functions.filter(
      f => f.metrics?.linesOfCode !== undefined && f.metrics.linesOfCode > threshold
    );
    return functions.length > 0 ? largeFunctions.length / functions.length : 0;
  }

  private calculateCodeQualityScore(functions: FunctionInfo[]): number {
    let score = 100;

    // Filter functions with valid metrics
    const functionsWithCommentMetrics = functions.filter(f => f.metrics?.codeToCommentRatio !== undefined);
    if (functionsWithCommentMetrics.length > 0) {
      const commentRatios = functionsWithCommentMetrics.map(f => f.metrics!.codeToCommentRatio!);
      const avgCommentRatio = commentRatios.reduce((a, b) => a + b, 0) / commentRatios.length;

      // Penalize low comment ratio using thresholds
      if (avgCommentRatio < QUALITY_THRESHOLDS.codeQuality.commentRatio.low) {
        score -= 30;
      } else if (avgCommentRatio < QUALITY_THRESHOLDS.codeQuality.commentRatio.medium) {
        score -= 20;
      }
    }

    // Check for very high parameter counts
    const functionsWithParamMetrics = functions.filter(f => f.metrics?.parameterCount !== undefined);
    if (functionsWithParamMetrics.length > 0) {
      const highParamFunctions = functionsWithParamMetrics.filter(
        f => f.metrics!.parameterCount! > QUALITY_THRESHOLDS.codeQuality.parameterCount
      );
      const highParamRatio = highParamFunctions.length / functionsWithParamMetrics.length;

      if (highParamRatio > QUALITY_THRESHOLDS.codeQuality.parameterRatioThreshold) {
        score -= (highParamRatio - QUALITY_THRESHOLDS.codeQuality.parameterRatioThreshold) * 200;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  private scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private countHighRiskFunctions(functions: FunctionInfo[]): number {
    return functions.filter(f => {
      const complexity = f.metrics?.cyclomaticComplexity;
      const maintainability = f.metrics?.maintainabilityIndex;
      const lines = f.metrics?.linesOfCode;

      // Use unified thresholds and require valid metrics
      return (
        (complexity !== undefined && complexity > QUALITY_THRESHOLDS.highRisk.complexity) ||
        (maintainability !== undefined && maintainability < QUALITY_THRESHOLDS.highRisk.maintainability) ||
        (lines !== undefined && lines > QUALITY_THRESHOLDS.highRisk.size)
      );
    }).length;
  }

  private getTopProblematicFunctions(functions: FunctionInfo[]): Array<{
    name: string;
    filePath: string;
    complexity: number;
    maintainabilityIndex: number;
    reason: string;
  }> {
    const problematic = functions
      .map(f => {
        const complexity = f.metrics?.cyclomaticComplexity || 1;
        const maintainability = f.metrics?.maintainabilityIndex || 100;
        const lines = f.metrics?.linesOfCode || 0;

        let problemScore = 0;
        const reasons: string[] = [];

        // Use unified thresholds for consistency
        if (complexity > QUALITY_THRESHOLDS.complexity.veryHigh) {
          problemScore += (complexity - QUALITY_THRESHOLDS.complexity.veryHigh) * 5;
          reasons.push(`high complexity (${complexity})`);
        }

        if (maintainability < QUALITY_THRESHOLDS.maintainability.low) {
          problemScore += (QUALITY_THRESHOLDS.maintainability.low - maintainability) * 2;
          reasons.push(`low maintainability (${maintainability.toFixed(1)})`);
        }

        if (lines > QUALITY_THRESHOLDS.size.veryLarge) {
          problemScore += (lines - QUALITY_THRESHOLDS.size.veryLarge) * 1.5; // Increased weight for visibility
          reasons.push(`large size (${lines} lines)`);
        }

        return {
          name: f.displayName,
          filePath: f.filePath,
          complexity,
          maintainabilityIndex: maintainability,
          reason: reasons.join(', '),
          problemScore,
        };
      })
      .filter(f => f.problemScore > 0)
      .sort((a, b) => b.problemScore - a.problemScore)
      .slice(0, 5)
      .map(f => ({
        name: f.name,
        filePath: f.filePath,
        complexity: f.complexity,
        maintainabilityIndex: f.maintainabilityIndex,
        reason: f.reason,
      }));

    return problematic;
  }
}
