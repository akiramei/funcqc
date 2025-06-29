import { FunctionInfo } from '../types';

export interface UrgencyAssessment {
  level: 'urgent' | 'weekly' | 'team' | 'low';
  rank: 'A' | 'B' | 'C' | 'D' | 'E';
  estimatedMinutes: number;
  riskDescription: string;
  improvementStrategy: string;
  impact: string;
  reasons: string[];
}

export class UrgencyAssessor {
  // Scoring thresholds
  private static readonly URGENCY_THRESHOLDS = {
    URGENT: 60,
    WEEKLY: 25,
    TEAM: 10,
    LOW: 5
  };

  // Complexity scoring
  private static readonly COMPLEXITY_WEIGHTS = {
    MODERATE_THRESHOLD: 5,
    HIGH_THRESHOLD: 10,
    CRITICAL_THRESHOLD: 15,
    MODERATE_PENALTY: 2,
    HIGH_PENALTY: 5,
    CRITICAL_PENALTY: 10
  };

  // Maintainability scoring
  private static readonly MAINTAINABILITY_THRESHOLDS = {
    POOR: 30,
    FAIR: 50,
    POOR_PENALTY: 2,
    FAIR_PENALTY: 1
  };

  // Size scoring
  private static readonly SIZE_THRESHOLDS = {
    MEDIUM: 50,
    LARGE: 100,
    HUGE: 200,
    MEDIUM_PENALTY: 0.2,
    LARGE_PENALTY: 0.5,
    HUGE_PENALTY: 1
  };

  // Parameter scoring
  private static readonly PARAMETER_THRESHOLDS = {
    MANY: 4,
    TOO_MANY: 6,
    MANY_PENALTY: 2,
    TOO_MANY_PENALTY: 5
  };

  // Nesting scoring
  private static readonly NESTING_THRESHOLDS = {
    MODERATE: 3,
    DEEP: 4,
    MODERATE_PENALTY: 3,
    DEEP_PENALTY: 8
  };

  // Time estimation constants
  private static readonly TIME_ESTIMATION = {
    URGENT_BASE: 5,
    URGENT_DIVIDER: 20,
    URGENT_MAX: 15,
    WEEKLY_BASE: 20,
    WEEKLY_DIVIDER: 2,
    WEEKLY_MAX: 120,
    TEAM_BASE: 60,
    TEAM_MULTIPLIER: 2,
    TEAM_MAX: 480,
    LOW_BASE: 30,
    LOW_MULTIPLIER: 3,
    LOW_MAX: 240,
    MINIMAL_BASE: 5
  };

  // Impact calculation constants
  private static readonly IMPACT_CALCULATION = {
    HOURS_FACTOR: 0.2,
    BUG_REDUCTION_FACTOR: 0.3,
    MAX_BUG_REDUCTION: 50
  };

  // Default values
  private static readonly DEFAULTS = {
    MAINTAINABILITY_INDEX: 50 // Conservative default when metrics are missing
  };

  assessFunction(func: FunctionInfo): UrgencyAssessment {
    const metrics = func.metrics;
    if (!metrics) {
      return this.createDefaultAssessment();
    }

    const urgencyScore = this.calculateUrgencyScore(metrics);
    const reasons = this.generateReasons(metrics);

    return this.createAssessment(
      urgencyScore.total,
      metrics.cyclomaticComplexity,
      metrics.maintainabilityIndex ?? UrgencyAssessor.DEFAULTS.MAINTAINABILITY_INDEX,
      metrics.linesOfCode,
      metrics.parameterCount,
      reasons
    );
  }

  private calculateUrgencyScore(metrics: any): { total: number } {
    const complexity = metrics.cyclomaticComplexity;
    const maintainability = metrics.maintainabilityIndex ?? UrgencyAssessor.DEFAULTS.MAINTAINABILITY_INDEX;
    const lines = metrics.linesOfCode;
    const params = metrics.parameterCount;
    const nesting = metrics.maxNestingLevel;

    let total = 0;
    total += this.calculateComplexityScore(complexity);
    total += this.calculateMaintainabilityScore(maintainability);
    total += this.calculateSizeScore(lines);
    total += this.calculateParameterScore(params);
    total += this.calculateNestingScore(nesting);

    return { total };
  }

  private generateReasons(metrics: any): string[] {
    const complexity = metrics.cyclomaticComplexity;
    const maintainability = metrics.maintainabilityIndex ?? UrgencyAssessor.DEFAULTS.MAINTAINABILITY_INDEX;
    const lines = metrics.linesOfCode;
    const params = metrics.parameterCount;
    const nesting = metrics.maxNestingLevel;

    const reasons: string[] = [];

    if (complexity > UrgencyAssessor.COMPLEXITY_WEIGHTS.CRITICAL_THRESHOLD) {
      reasons.push(`高複雑度 (CC=${complexity})`);
    } else if (complexity > UrgencyAssessor.COMPLEXITY_WEIGHTS.HIGH_THRESHOLD) {
      reasons.push(`複雑度やや高 (CC=${complexity})`);
    }

    if (maintainability < UrgencyAssessor.MAINTAINABILITY_THRESHOLDS.POOR) {
      reasons.push(`保守性低 (MI=${maintainability.toFixed(1)})`);
    } else if (maintainability < UrgencyAssessor.MAINTAINABILITY_THRESHOLDS.FAIR) {
      reasons.push(`保守性やや低 (MI=${maintainability.toFixed(1)})`);
    }

    if (lines > UrgencyAssessor.SIZE_THRESHOLDS.LARGE) {
      reasons.push(`長大関数 (${lines}行)`);
    }

    if (params > UrgencyAssessor.PARAMETER_THRESHOLDS.TOO_MANY) {
      reasons.push(`引数過多 (${params}個)`);
    }

    if (nesting > UrgencyAssessor.NESTING_THRESHOLDS.DEEP) {
      reasons.push(`深いネスト (${nesting}階層)`);
    }

    return reasons;
  }

  private calculateComplexityScore(complexity: number): number {
    const { COMPLEXITY_WEIGHTS } = UrgencyAssessor;
    if (complexity > COMPLEXITY_WEIGHTS.CRITICAL_THRESHOLD) {
      return (complexity - COMPLEXITY_WEIGHTS.CRITICAL_THRESHOLD) * COMPLEXITY_WEIGHTS.CRITICAL_PENALTY;
    } else if (complexity > COMPLEXITY_WEIGHTS.HIGH_THRESHOLD) {
      return (complexity - COMPLEXITY_WEIGHTS.HIGH_THRESHOLD) * COMPLEXITY_WEIGHTS.HIGH_PENALTY;
    } else if (complexity > COMPLEXITY_WEIGHTS.MODERATE_THRESHOLD) {
      return (complexity - COMPLEXITY_WEIGHTS.MODERATE_THRESHOLD) * COMPLEXITY_WEIGHTS.MODERATE_PENALTY;
    }
    return 0;
  }

  private calculateMaintainabilityScore(maintainability: number): number {
    const { MAINTAINABILITY_THRESHOLDS } = UrgencyAssessor;
    if (maintainability < MAINTAINABILITY_THRESHOLDS.POOR) {
      return (MAINTAINABILITY_THRESHOLDS.POOR - maintainability) * MAINTAINABILITY_THRESHOLDS.POOR_PENALTY;
    } else if (maintainability < MAINTAINABILITY_THRESHOLDS.FAIR) {
      return (MAINTAINABILITY_THRESHOLDS.FAIR - maintainability) * MAINTAINABILITY_THRESHOLDS.FAIR_PENALTY;
    }
    return 0;
  }

  private calculateSizeScore(lines: number): number {
    const { SIZE_THRESHOLDS } = UrgencyAssessor;
    if (lines > SIZE_THRESHOLDS.LARGE) {
      return (lines - SIZE_THRESHOLDS.LARGE) * SIZE_THRESHOLDS.LARGE_PENALTY;
    } else if (lines > SIZE_THRESHOLDS.MEDIUM) {
      return (lines - SIZE_THRESHOLDS.MEDIUM) * SIZE_THRESHOLDS.MEDIUM_PENALTY;
    }
    return 0;
  }

  private calculateParameterScore(params: number): number {
    const { PARAMETER_THRESHOLDS } = UrgencyAssessor;
    if (params > PARAMETER_THRESHOLDS.TOO_MANY) {
      return (params - PARAMETER_THRESHOLDS.TOO_MANY) * PARAMETER_THRESHOLDS.TOO_MANY_PENALTY;
    } else if (params > PARAMETER_THRESHOLDS.MANY) {
      return (params - PARAMETER_THRESHOLDS.MANY) * PARAMETER_THRESHOLDS.MANY_PENALTY;
    }
    return 0;
  }

  private calculateNestingScore(nesting: number): number {
    const { NESTING_THRESHOLDS } = UrgencyAssessor;
    if (nesting > NESTING_THRESHOLDS.DEEP) {
      return (nesting - NESTING_THRESHOLDS.DEEP) * NESTING_THRESHOLDS.DEEP_PENALTY;
    } else if (nesting > NESTING_THRESHOLDS.MODERATE) {
      return (nesting - NESTING_THRESHOLDS.MODERATE) * NESTING_THRESHOLDS.MODERATE_PENALTY;
    }
    return 0;
  }

  private createDefaultAssessment(): UrgencyAssessment {
    return {
      level: 'low',
      rank: 'A', // メトリクスなし = 最も良い評価
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

    const { URGENCY_THRESHOLDS, TIME_ESTIMATION } = UrgencyAssessor;
    if (urgencyScore >= URGENCY_THRESHOLDS.URGENT) {
      level = 'urgent';
      rank = 'E'; // 最も問題が多い = 最低評価
      estimatedMinutes = Math.min(
        TIME_ESTIMATION.URGENT_MAX,
        TIME_ESTIMATION.URGENT_BASE + Math.floor(urgencyScore / TIME_ESTIMATION.URGENT_DIVIDER)
      );
    } else if (urgencyScore >= URGENCY_THRESHOLDS.WEEKLY) {
      level = 'weekly';
      rank = 'D';
      estimatedMinutes = Math.min(
        TIME_ESTIMATION.WEEKLY_MAX,
        TIME_ESTIMATION.WEEKLY_BASE + Math.floor(urgencyScore / TIME_ESTIMATION.WEEKLY_DIVIDER)
      );
    } else if (urgencyScore >= URGENCY_THRESHOLDS.TEAM) {
      level = 'team';
      rank = 'C';
      estimatedMinutes = Math.min(
        TIME_ESTIMATION.TEAM_MAX,
        TIME_ESTIMATION.TEAM_BASE + Math.floor(urgencyScore * TIME_ESTIMATION.TEAM_MULTIPLIER)
      );
    } else if (urgencyScore >= URGENCY_THRESHOLDS.LOW) {
      level = 'low';
      rank = 'B';
      estimatedMinutes = Math.min(
        TIME_ESTIMATION.LOW_MAX,
        TIME_ESTIMATION.LOW_BASE + Math.floor(urgencyScore * TIME_ESTIMATION.LOW_MULTIPLIER)
      );
    } else {
      level = 'low';
      rank = 'A'; // 問題が最も少ない = 最高評価
      estimatedMinutes = Math.max(TIME_ESTIMATION.MINIMAL_BASE, Math.floor(urgencyScore));
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
    // Input validation
    if (!Number.isFinite(complexity) || !Number.isFinite(maintainability) || !Number.isFinite(lines)) {
      return '評価データが不正です';
    }
    
    // Boundary value checks
    const safeComplexity = Math.max(0, Math.min(100, complexity));
    const safeMaintainability = Math.max(0, Math.min(100, maintainability));
    const safeLines = Math.max(0, Math.min(10000, lines));
    
    const understandingTime = Math.max(1, Math.floor(safeComplexity * 0.8 + safeLines * 0.1));
    const bugRisk = Math.min(95, Math.max(5, 100 - safeMaintainability + safeComplexity * 2));
    
    return `理解に${understandingTime}分、バグリスク${bugRisk}%`;
  }

  private generateImprovementStrategy(complexity: number, lines: number, params: number): string {
    // Boundary value checks
    const safeComplexity = Math.max(0, Math.min(100, complexity));
    const safeLines = Math.max(0, Math.min(10000, lines));
    const safeParams = Math.max(0, Math.min(20, params));
    
    const strategies: string[] = [];
    
    if (safeComplexity > UrgencyAssessor.COMPLEXITY_WEIGHTS.HIGH_THRESHOLD) {
      strategies.push('条件分岐の整理');
    }
    if (safeLines > UrgencyAssessor.SIZE_THRESHOLDS.MEDIUM) {
      strategies.push('関数分割');
    }
    if (safeParams > UrgencyAssessor.PARAMETER_THRESHOLDS.MANY) {
      strategies.push('オブジェクト引数化');
    }
    if (safeComplexity > UrgencyAssessor.COMPLEXITY_WEIGHTS.MODERATE_THRESHOLD && safeLines > 30) {
      strategies.push('早期リターン');
    }

    return strategies.length > 0 ? strategies.join('、') : '軽微な整理';
  }

  private generateImpactDescription(estimatedMinutes: number, urgencyScore: number): string {
    const { IMPACT_CALCULATION } = UrgencyAssessor;
    const hoursPerMonth = Math.floor(urgencyScore * IMPACT_CALCULATION.HOURS_FACTOR);
    const bugReduction = Math.min(
      IMPACT_CALCULATION.MAX_BUG_REDUCTION,
      Math.floor(urgencyScore * IMPACT_CALCULATION.BUG_REDUCTION_FACTOR)
    );
    
    if (estimatedMinutes <= 15) {
      return `${hoursPerMonth}時間/月の節約、バグリスク${bugReduction}%削減`;
    } else if (estimatedMinutes <= 120) {
      return `${hoursPerMonth}時間/月の節約、保守性向上`;
    } else {
      return `チーム全体の生産性向上、技術債務削減`;
    }
  }

  filterByUrgencyLevel(functions: FunctionInfo[], level: 'urgent' | 'weekly' | 'team' | 'low'): FunctionInfo[] {
    return functions.filter(func => {
      const assessment = this.assessFunction(func);
      return assessment.level === level;
    });
  }
}