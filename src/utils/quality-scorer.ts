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

export interface QualityWeights {
  complexity: number;
  maintainability: number;
  size: number;
  codeQuality: number;
}

/**
 * Metric-specific steepness configuration for optimal sensitivity
 */
const STEEPNESS_CONFIG = {
  // For ratio metrics (0.05 → 0.10 changes should be visible)
  ratio: 12.0,
  // For average values (complexity, size)
  average: 0.3,
  // For count metrics (parameters, violations)
  count: 1.0,
  // Default fallback
  default: 0.5,
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
  weights?: QualityWeights; // Optional weights used for scoring
}

export class QualityScorer {
  private configuredWeights?: QualityWeights;

  /**
   * Constructor with optional weight configuration
   * @param weights Custom quality weights (must sum to 1.0)
   */
  constructor(weights?: QualityWeights) {
    if (weights) {
      this.validateAndSetWeights(weights);
    }
  }

  /**
   * Validate and set custom quality weights
   */
  private validateAndSetWeights(weights: QualityWeights): void {
    // Validate all weights are positive and finite
    for (const [key, weight] of Object.entries(weights)) {
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error(`Invalid weight for ${key}: ${weight}. Must be between 0 and 1.`);
      }
    }
    
    // Validate weights sum to 1.0 with proper tolerance
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    const tolerance = 0.001;
    if (Math.abs(sum - 1.0) > tolerance) {
      throw new Error(
        `Quality weights must sum to 1.0 ± ${tolerance}, got ${sum.toFixed(6)}. ` +
        `Difference: ${Math.abs(sum - 1.0).toFixed(6)}`
      );
    }
    
    this.configuredWeights = weights;
  }
  /**
   * Enhanced logistic function with metric-specific steepness
   * score = 100 / (1 + e^(k(x-x0)))
   * @param value Current metric value
   * @param threshold Target threshold (x0)
   * @param steepness Steepness parameter (k) - higher = sharper transition
   * @param metricType Type of metric for automatic steepness selection
   * @returns Score between 0-100
   */
  private logisticScore(
    value: number, 
    threshold: number, 
    steepness?: number,
    metricType?: 'ratio' | 'average' | 'count'
  ): number {
    // Handle edge cases and boundary conditions
    if (!Number.isFinite(value) || !Number.isFinite(threshold)) {
      return 50; // Default score for invalid inputs
    }
    
    if (value <= 0 && threshold > 0) {
      return 100; // Perfect score for zero or negative values when threshold is positive
    }
    
    // Use metric-specific steepness if not provided
    const finalSteepness = steepness ?? (metricType ? STEEPNESS_CONFIG[metricType] : STEEPNESS_CONFIG.default);
    
    if (finalSteepness <= 0) {
      return 50; // Fallback for invalid steepness
    }
    
    // Prevent extreme exponential values that could cause numerical instability
    const exponent = finalSteepness * (value - threshold);
    const clampedExponent = Math.max(-50, Math.min(50, exponent));
    
    const score = 100 / (1 + Math.exp(clampedExponent));
    
    // Allow true 0/100 scores while maintaining precision
    return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
  }

  /**
   * Inverted logistic function for metrics where higher values are better
   * score = 100 * (1 - 1 / (1 + e^(k(x-x0))))
   * @param value Current metric value
   * @param threshold Minimum acceptable threshold
   * @param steepness Steepness parameter (k) - higher = sharper transition
   * @returns Score between 0-100
   */
  private invertedLogisticScore(
    value: number, 
    threshold: number, 
    steepness?: number,
    metricType?: 'ratio' | 'average' | 'count'
  ): number {
    // Handle edge cases
    if (!Number.isFinite(value) || !Number.isFinite(threshold)) {
      return 50; // Default score for invalid inputs
    }
    
    // Use metric-specific steepness if not provided
    const finalSteepness = steepness ?? (metricType ? STEEPNESS_CONFIG[metricType] : STEEPNESS_CONFIG.default);
    
    if (finalSteepness <= 0) {
      return 50; // Fallback for invalid steepness
    }
    
    // For inverted scoring, we want high scores when value >= threshold
    // Use logistic function but invert the result
    const normalizedValue = threshold - value; // Flip the relationship
    const exponent = finalSteepness * normalizedValue;
    const clampedExponent = Math.max(-50, Math.min(50, exponent));
    
    const score = 100 / (1 + Math.exp(clampedExponent));
    
    // Ensure score stays within 0-100 bounds
    return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
  }

  /**
   * Get quality weights - either configured or default
   */
  private getQualityWeights(): QualityWeights {
    if (this.configuredWeights) {
      return this.configuredWeights;
    }
    
    // Default weights based on expert recommendations
    return {
      complexity: 0.30,
      maintainability: 0.30, 
      size: 0.20,
      codeQuality: 0.20
    };
  }

  /**
   * Get default quality weights (static method for external use)
   */
  static getDefaultWeights(): QualityWeights {
    return {
      complexity: 0.30,
      maintainability: 0.30, 
      size: 0.20,
      codeQuality: 0.20
    };
  }

  /**
   * Create a scorer with custom weights
   */
  static withWeights(weights: QualityWeights): QualityScorer {
    return new QualityScorer(weights);
  }

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

    // Configurable weighted average with boundary protection
    const weights = this.getQualityWeights();
    
    // Validate all scores are within expected bounds
    const scoreEntries = Object.entries(scores);
    for (const [key, score] of scoreEntries) {
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        console.warn(`Invalid ${key} score: ${score}. Clamping to valid range.`);
        scores[key as keyof typeof scores] = Math.max(0, Math.min(100, score || 0));
      }
    }
    
    const weightedSum = 
      scores.complexity * weights.complexity +
      scores.maintainability * weights.maintainability +
      scores.size * weights.size +
      scores.codeQuality * weights.codeQuality;
    
    // Ensure final score is within bounds and properly rounded
    const overallScore = Math.round(Math.max(0, Math.min(100, weightedSum)));

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
      weights: this.getQualityWeights(), // Include weights used in calculation
    };
  }

  private calculateComplexityScore(functions: FunctionInfo[]): number {
    // Filter out functions without metrics to avoid bias
    const functionsWithMetrics = functions.filter(f => f.metrics?.cyclomaticComplexity !== undefined);
    if (functionsWithMetrics.length === 0) return 100;

    const complexities = functionsWithMetrics.map(f => f.metrics!.cyclomaticComplexity!);
    const avgComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;
    
    // Use logistic function for smooth S-curve scoring
    const highComplexityRatio = this.getComplexityRatio(functionsWithMetrics, QUALITY_THRESHOLDS.complexity.high);
    
    // Primary score using logistic function
    const primaryScore = this.logisticScore(
      highComplexityRatio, 
      QUALITY_THRESHOLDS.complexity.ratioThreshold, 
      undefined, // Use default steepness for ratio type
      'ratio' // Ratio metric type
    );

    // Secondary penalty for high average complexity using logistic function
    const avgComplexityScore = this.logisticScore(
      avgComplexity, 
      8, // Average complexity threshold
      undefined, // Use default steepness for average type
      'average' // Average metric type
    );

    // Weighted combination: primary score (80%) + average penalty (20%)
    const combinedScore = primaryScore * 0.8 + avgComplexityScore * 0.2;

    return Math.round(Math.max(0, Math.min(100, combinedScore)));
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

    // Base score from weighted average maintainability index
    const baseScore = Math.min(100, Math.max(0, weightedAvg));

    // Additional penalty using logistic function for low maintainability ratio
    const lowMaintainabilityRatio = this.getMaintainabilityRatio(functionsWithMetrics, QUALITY_THRESHOLDS.maintainability.low);
    
    // Apply logistic penalty for high ratio of low-maintainability functions
    const penaltyScore = this.logisticScore(
      lowMaintainabilityRatio,
      QUALITY_THRESHOLDS.maintainability.ratioThreshold,
      undefined, // Use default steepness for ratio type
      'ratio' // Ratio metric type
    );

    // Combine base score (70%) with penalty (30%) for balanced assessment
    const finalScore = baseScore * 0.7 + penaltyScore * 0.3;

    return Math.round(Math.max(0, Math.min(100, finalScore)));
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
    
    // Use logistic function for smooth S-curve scoring
    const largeFunctionRatio = this.getSizeRatio(functionsWithMetrics, QUALITY_THRESHOLDS.size.large);

    // Primary score using logistic function for large function ratio
    const ratioScore = this.logisticScore(
      largeFunctionRatio,
      QUALITY_THRESHOLDS.size.ratioThreshold,
      undefined, // Use default steepness for ratio type
      'ratio' // Ratio metric type
    );

    // Secondary penalty for high average size using logistic function
    const avgSizeScore = this.logisticScore(
      avgLines,
      30, // Average size threshold
      undefined, // Use default steepness for average type
      'average' // Average metric type
    );

    // Weighted combination: ratio score (75%) + average size (25%)
    const combinedScore = ratioScore * 0.75 + avgSizeScore * 0.25;

    return Math.round(Math.max(0, Math.min(100, combinedScore)));
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
    let commentScore = 100;
    let parameterScore = 100;

    // Comment ratio scoring using inverted logistic function
    const functionsWithCommentMetrics = functions.filter(f => f.metrics?.codeToCommentRatio !== undefined);
    if (functionsWithCommentMetrics.length > 0) {
      const commentRatios = functionsWithCommentMetrics.map(f => f.metrics!.codeToCommentRatio!);
      const avgCommentRatio = commentRatios.reduce((a, b) => a + b, 0) / commentRatios.length;

      // Use inverted logistic function for comment ratio (higher ratio = better score)
      commentScore = this.invertedLogisticScore(
        avgCommentRatio,
        QUALITY_THRESHOLDS.codeQuality.commentRatio.medium, // Target threshold
        15 // Steepness for comment ratio
      );
    }

    // Parameter count scoring using logistic function
    const functionsWithParamMetrics = functions.filter(f => f.metrics?.parameterCount !== undefined);
    if (functionsWithParamMetrics.length > 0) {
      const highParamFunctions = functionsWithParamMetrics.filter(
        f => f.metrics!.parameterCount! > QUALITY_THRESHOLDS.codeQuality.parameterCount
      );
      const highParamRatio = highParamFunctions.length / functionsWithParamMetrics.length;

      // Use logistic function for parameter ratio penalty
      parameterScore = this.logisticScore(
        highParamRatio,
        QUALITY_THRESHOLDS.codeQuality.parameterRatioThreshold,
        undefined, // Use default steepness for ratio type
        'ratio' // Ratio metric type
      );
    }

    // Weighted combination: comment quality (60%) + parameter quality (40%)
    const combinedScore = commentScore * 0.6 + parameterScore * 0.4;

    return Math.round(Math.max(0, Math.min(100, combinedScore)));
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
