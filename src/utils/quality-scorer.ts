import { FunctionInfo } from '../types';

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
    const complexities = functions.map(f => f.metrics?.cyclomaticComplexity || 1);
    const avgComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;
    
    // Use ratio-based scoring instead of extreme max penalties
    const highComplexityRatio = this.getHighComplexityRatio(functions, 10);
    const veryHighComplexityRatio = this.getHighComplexityRatio(functions, 15);
    
    let score = 100;

    // Penalize high average complexity (moderate impact)
    if (avgComplexity > 5) score -= (avgComplexity - 5) * 4;
    if (avgComplexity > 10) score -= (avgComplexity - 10) * 8;

    // Penalize based on proportion of high complexity functions
    // 10% threshold: moderate penalty, 20% threshold: severe penalty
    if (highComplexityRatio > 0.05) score -= (highComplexityRatio - 0.05) * 300;
    if (veryHighComplexityRatio > 0.02) score -= (veryHighComplexityRatio - 0.02) * 500;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate the ratio of functions exceeding complexity threshold
   */
  private getHighComplexityRatio(functions: FunctionInfo[], threshold: number): number {
    const highComplexityFunctions = functions.filter(
      f => (f.metrics?.cyclomaticComplexity || 1) > threshold
    );
    return highComplexityFunctions.length / functions.length;
  }

  private calculateMaintainabilityScore(functions: FunctionInfo[]): number {
    // Use Lines of Code weighted average for more realistic assessment
    const weightedData = functions.map(f => ({
      mi: f.metrics?.maintainabilityIndex || 100,
      weight: Math.max(1, f.metrics?.linesOfCode || 1), // Minimum weight of 1
    })).filter(data => data.mi > 0);

    if (weightedData.length === 0) return 100;

    const totalWeight = weightedData.reduce((sum, data) => sum + data.weight, 0);
    const weightedAvg = weightedData.reduce((sum, data) => sum + data.mi * data.weight, 0) / totalWeight;

    // Additional penalty for functions with very low maintainability
    const lowMaintainabilityRatio = this.getLowMaintainabilityRatio(functions, 50);
    let score = Math.round(weightedAvg);
    
    // Penalize if significant portion has low maintainability
    if (lowMaintainabilityRatio > 0.1) {
      score -= (lowMaintainabilityRatio - 0.1) * 200;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate the ratio of functions with low maintainability
   */
  private getLowMaintainabilityRatio(functions: FunctionInfo[], threshold: number): number {
    const lowMaintainabilityFunctions = functions.filter(
      f => (f.metrics?.maintainabilityIndex || 100) < threshold
    );
    return lowMaintainabilityFunctions.length / functions.length;
  }

  private calculateSizeScore(functions: FunctionInfo[]): number {
    const lines = functions.map(f => f.metrics?.linesOfCode || 0);
    const avgLines = lines.reduce((a, b) => a + b, 0) / lines.length;
    
    // Use ratio-based scoring for large functions
    const largeFunctionRatio = this.getLargeFunctionRatio(functions, 50);
    const veryLargeFunctionRatio = this.getLargeFunctionRatio(functions, 100);

    let score = 100;

    // Penalize high average size (moderate impact)
    if (avgLines > 20) score -= (avgLines - 20) * 1.5;
    if (avgLines > 40) score -= (avgLines - 40) * 3;

    // Penalize based on proportion of large functions
    if (largeFunctionRatio > 0.1) score -= (largeFunctionRatio - 0.1) * 200;
    if (veryLargeFunctionRatio > 0.05) score -= (veryLargeFunctionRatio - 0.05) * 300;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate the ratio of functions exceeding size threshold
   */
  private getLargeFunctionRatio(functions: FunctionInfo[], threshold: number): number {
    const largeFunctions = functions.filter(
      f => (f.metrics?.linesOfCode || 0) > threshold
    );
    return largeFunctions.length / functions.length;
  }

  private calculateCodeQualityScore(functions: FunctionInfo[]): number {
    let score = 100;

    // Check comment ratios
    const commentRatios = functions.map(f => f.metrics?.codeToCommentRatio || 0);
    const avgCommentRatio = commentRatios.reduce((a, b) => a + b, 0) / commentRatios.length;

    // Penalize low comment ratio
    if (avgCommentRatio < 0.05) score -= 30;
    else if (avgCommentRatio < 0.1) score -= 20;

    // Check for very high parameter counts
    const highParamFunctions = functions.filter(f => (f.metrics?.parameterCount || 0) > 5).length;
    const highParamRatio = highParamFunctions / functions.length;

    if (highParamRatio > 0.1) score -= highParamRatio * 50;

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
      const complexity = f.metrics?.cyclomaticComplexity || 1;
      const maintainability = f.metrics?.maintainabilityIndex || 100;
      const lines = f.metrics?.linesOfCode || 0;

      return complexity > 10 || maintainability < 50 || lines > 100;
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

        if (complexity > 15) {
          problemScore += (complexity - 15) * 5;
          reasons.push(`high complexity (${complexity})`);
        }

        if (maintainability < 50) {
          problemScore += (50 - maintainability) * 2;
          reasons.push(`low maintainability (${maintainability.toFixed(1)})`);
        }

        if (lines > 100) {
          problemScore += (lines - 100) * 0.5;
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
