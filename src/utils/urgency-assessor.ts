import { FunctionInfo } from '../types';

export interface UrgencyAssessment {
  level: 'urgent' | 'weekly' | 'team' | 'low';
  rank: 'A' | 'B' | 'C' | 'D' | 'F';
  estimatedMinutes: number;
  riskDescription: string;
  improvementStrategy: string;
  impact: string;
  reasons: string[];
}

export class UrgencyAssessor {
  assessFunction(func: FunctionInfo): UrgencyAssessment {
    const metrics = func.metrics;
    if (!metrics) {
      return this.createDefaultAssessment();
    }

    const complexity = metrics.cyclomaticComplexity;
    const maintainability = metrics.maintainabilityIndex || 100;
    const lines = metrics.linesOfCode;
    const params = metrics.parameterCount;
    const nesting = metrics.maxNestingLevel;

    // Calculate urgency score based on multiple factors
    let urgencyScore = 0;
    const reasons: string[] = [];

    // Complexity impact
    if (complexity > 15) {
      urgencyScore += (complexity - 15) * 10;
      reasons.push(`高複雑度 (CC=${complexity})`);
    } else if (complexity > 10) {
      urgencyScore += (complexity - 10) * 5;
      reasons.push(`複雑度やや高 (CC=${complexity})`);
    } else if (complexity > 5) {
      urgencyScore += (complexity - 5) * 2;
    }

    // Maintainability impact
    if (maintainability < 30) {
      urgencyScore += (30 - maintainability) * 2;
      reasons.push(`保守性低 (MI=${maintainability.toFixed(1)})`);
    } else if (maintainability < 50) {
      urgencyScore += (50 - maintainability) * 1;
      reasons.push(`保守性やや低 (MI=${maintainability.toFixed(1)})`);
    }

    // Size impact
    if (lines > 100) {
      urgencyScore += (lines - 100) * 0.5;
      reasons.push(`長大関数 (${lines}行)`);
    } else if (lines > 50) {
      urgencyScore += (lines - 50) * 0.2;
    }

    // Parameter count impact
    if (params > 6) {
      urgencyScore += (params - 6) * 5;
      reasons.push(`引数過多 (${params}個)`);
    } else if (params > 4) {
      urgencyScore += (params - 4) * 2;
    }

    // Nesting impact
    if (nesting > 4) {
      urgencyScore += (nesting - 4) * 8;
      reasons.push(`深いネスト (${nesting}階層)`);
    } else if (nesting > 3) {
      urgencyScore += (nesting - 3) * 3;
    }

    return this.createAssessment(urgencyScore, complexity, maintainability, lines, params, reasons);
  }

  private createDefaultAssessment(): UrgencyAssessment {
    return {
      level: 'low',
      rank: 'A',
      estimatedMinutes: 0,
      riskDescription: '問題なし',
      improvementStrategy: '対応不要',
      impact: '影響なし',
      reasons: []
    };
  }

  private createAssessment(
    urgencyScore: number,
    complexity: number,
    maintainability: number,
    lines: number,
    params: number,
    reasons: string[]
  ): UrgencyAssessment {
    // Determine urgency level
    let level: UrgencyAssessment['level'];
    let rank: UrgencyAssessment['rank'];
    let estimatedMinutes: number;

    if (urgencyScore >= 60) {
      level = 'urgent';
      rank = 'A';
      estimatedMinutes = Math.min(15, 5 + Math.floor(urgencyScore / 20));
    } else if (urgencyScore >= 25) {
      level = 'weekly';
      rank = 'B';
      estimatedMinutes = Math.min(120, 20 + Math.floor(urgencyScore / 2));
    } else if (urgencyScore >= 10) {
      level = 'team';
      rank = 'C';
      estimatedMinutes = Math.min(480, 60 + Math.floor(urgencyScore * 2));
    } else if (urgencyScore >= 5) {
      level = 'low';
      rank = 'D';
      estimatedMinutes = Math.min(240, 30 + Math.floor(urgencyScore * 3));
    } else {
      level = 'low';
      rank = 'F';
      estimatedMinutes = Math.max(5, Math.floor(urgencyScore));
    }

    // Generate descriptions
    const riskDescription = this.generateRiskDescription(complexity, maintainability, lines);
    const improvementStrategy = this.generateImprovementStrategy(complexity, lines, params);
    const impact = this.generateImpactDescription(estimatedMinutes, urgencyScore);

    return {
      level,
      rank,
      estimatedMinutes,
      riskDescription,
      improvementStrategy,
      impact,
      reasons
    };
  }

  private generateRiskDescription(complexity: number, maintainability: number, lines: number): string {
    const understandingTime = Math.max(1, Math.floor(complexity * 0.8 + lines * 0.1));
    const bugRisk = Math.min(95, Math.max(5, 100 - maintainability + complexity * 2));
    
    return `理解に${understandingTime}分、バグリスク${bugRisk}%`;
  }

  private generateImprovementStrategy(complexity: number, lines: number, params: number): string {
    const strategies: string[] = [];
    
    if (complexity > 10) {
      strategies.push('条件分岐の整理');
    }
    if (lines > 50) {
      strategies.push('関数分割');
    }
    if (params > 4) {
      strategies.push('オブジェクト引数化');
    }
    if (complexity > 5 && lines > 30) {
      strategies.push('早期リターン');
    }

    return strategies.length > 0 ? strategies.join('、') : '軽微な整理';
  }

  private generateImpactDescription(estimatedMinutes: number, urgencyScore: number): string {
    const hoursPerMonth = Math.floor(urgencyScore * 0.2);
    const bugReduction = Math.min(50, Math.floor(urgencyScore * 0.3));
    
    if (estimatedMinutes <= 15) {
      return `${hoursPerMonth}時間/月の節約、バグリスク${bugReduction}%削減`;
    } else if (estimatedMinutes <= 120) {
      return `${hoursPerMonth}時間/月の節約、保守性向上`;
    } else {
      return `チーム全体の生産性向上、技術債務削減`;
    }
  }

  filterByUrgencyLevel(functions: FunctionInfo[], level: 'urgent' | 'weekly' | 'team'): FunctionInfo[] {
    return functions.filter(func => {
      const assessment = this.assessFunction(func);
      return assessment.level === level;
    });
  }
}