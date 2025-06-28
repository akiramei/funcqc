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
        topProblematicFunctions: []
      };
    }

    const scores = {
      complexity: this.calculateComplexityScore(functions),
      maintainability: this.calculateMaintainabilityScore(functions),
      size: this.calculateSizeScore(functions),
      codeQuality: this.calculateCodeQualityScore(functions)
    };

    // Weighted average: complexity and maintainability are most important
    const overallScore = Math.round(
      scores.complexity * 0.35 +
      scores.maintainability * 0.35 +
      scores.size * 0.15 +
      scores.codeQuality * 0.15
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
      topProblematicFunctions
    };
  }

  private calculateComplexityScore(functions: FunctionInfo[]): number {
    const complexities = functions.map(f => f.metrics?.cyclomaticComplexity || 1);
    const avgComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;
    const maxComplexity = Math.max(...complexities);
    
    // Score based on average and max complexity
    let score = 100;
    
    // Penalize high average complexity
    if (avgComplexity > 5) score -= (avgComplexity - 5) * 8;
    if (avgComplexity > 10) score -= (avgComplexity - 10) * 15;
    
    // Penalize very high max complexity
    if (maxComplexity > 15) score -= (maxComplexity - 15) * 5;
    if (maxComplexity > 25) score -= (maxComplexity - 25) * 10;
    
    return Math.max(0, Math.min(100, score));
  }

  private calculateMaintainabilityScore(functions: FunctionInfo[]): number {
    const maintainabilityIndexes = functions
      .map(f => f.metrics?.maintainabilityIndex || 100)
      .filter(mi => mi > 0);
    
    if (maintainabilityIndexes.length === 0) return 100;
    
    const avgMaintainability = maintainabilityIndexes.reduce((a, b) => a + b, 0) / maintainabilityIndexes.length;
    
    // Convert maintainability index (0-100) to score
    return Math.max(0, Math.min(100, Math.round(avgMaintainability)));
  }

  private calculateSizeScore(functions: FunctionInfo[]): number {
    const lines = functions.map(f => f.metrics?.linesOfCode || 0);
    const avgLines = lines.reduce((a, b) => a + b, 0) / lines.length;
    const maxLines = Math.max(...lines);
    
    let score = 100;
    
    // Penalize large functions
    if (avgLines > 20) score -= (avgLines - 20) * 2;
    if (avgLines > 50) score -= (avgLines - 50) * 5;
    
    if (maxLines > 100) score -= (maxLines - 100) * 1;
    if (maxLines > 200) score -= (maxLines - 200) * 2;
    
    return Math.max(0, Math.min(100, score));
  }

  private calculateCodeQualityScore(functions: FunctionInfo[]): number {
    let score = 100;
    
    // Check comment ratios
    const commentRatios = functions.map(f => f.metrics?.codeToCommentRatio || 0);
    const avgCommentRatio = commentRatios.reduce((a, b) => a + b, 0) / commentRatios.length;
    
    // Penalize low comment ratio
    if (avgCommentRatio < 0.1) score -= 20;
    else if (avgCommentRatio < 0.05) score -= 30;
    
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
          problemScore
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
        reason: f.reason
      }));
    
    return problematic;
  }
}