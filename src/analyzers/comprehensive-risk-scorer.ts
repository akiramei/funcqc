import { FunctionInfo, CallEdge } from '../types';
import { DependencyMetrics } from './dependency-metrics';
import { RiskPattern } from './risk-detector';
import { StronglyConnectedComponent } from './scc-analyzer';

/**
 * Risk factor contribution to overall score
 */
export interface RiskFactor {
  name: string;
  weight: number; // 0-1
  score: number; // 0-100
  description: string;
}

/**
 * Comprehensive risk assessment for a function
 */
export interface ComprehensiveRiskAssessment {
  functionId: string;
  functionName: string;
  filePath: string;
  overallScore: number; // 0-100
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  factors: RiskFactor[];
  patterns: RiskPattern[];
  recommendations: string[];
  priority: number; // For ranking
}

/**
 * Risk scoring configuration
 */
export interface RiskScoringConfig {
  // Complexity weights
  cyclomaticComplexityWeight: number;
  cognitiveComplexityWeight: number;
  nestingDepthWeight: number;
  
  // Size weights
  linesOfCodeWeight: number;
  parameterCountWeight: number;
  
  // Dependency weights
  fanInWeight: number;
  fanOutWeight: number;
  
  // Pattern weights
  wrapperPatternWeight: number;
  fakeSplitPatternWeight: number;
  isolatedFunctionWeight: number;
  
  // SCC weights
  stronglyConnectedWeight: number;
  recursiveCallWeight: number;
  
  // Quality weights
  maintainabilityWeight: number;
  halsteadVolumeWeight: number;
  
  // Thresholds
  complexityThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  
  sizeThresholds: {
    small: number;
    medium: number;
    large: number;
    huge: number;
  };
}

/**
 * Default risk scoring configuration
 */
export const DEFAULT_RISK_CONFIG: RiskScoringConfig = {
  // Complexity weights (total: 0.40)
  cyclomaticComplexityWeight: 0.15,
  cognitiveComplexityWeight: 0.15,
  nestingDepthWeight: 0.10,
  
  // Size weights (total: 0.20)
  linesOfCodeWeight: 0.15,
  parameterCountWeight: 0.05,
  
  // Dependency weights (total: 0.20)
  fanInWeight: 0.10,
  fanOutWeight: 0.10,
  
  // Pattern weights (total: 0.15)
  wrapperPatternWeight: 0.05,
  fakeSplitPatternWeight: 0.05,
  isolatedFunctionWeight: 0.05,
  
  // SCC weights (total: 0.05)
  stronglyConnectedWeight: 0.03,
  recursiveCallWeight: 0.02,
  
  // Quality weights (total: 0.00 - not implemented yet)
  maintainabilityWeight: 0.00,
  halsteadVolumeWeight: 0.00,
  
  // Thresholds
  complexityThresholds: {
    low: 5,
    medium: 10,
    high: 20,
    critical: 30,
  },
  
  sizeThresholds: {
    small: 20,
    medium: 50,
    large: 100,
    huge: 200,
  },
};

/**
 * Comprehensive risk scoring system
 */
export class ComprehensiveRiskScorer {
  private config: RiskScoringConfig;

  constructor(config: Partial<RiskScoringConfig> = {}) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
  }

  /**
   * Calculate comprehensive risk assessments for all functions
   */
  assessRisks(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    dependencyMetrics: DependencyMetrics[],
    riskPatterns: RiskPattern[],
    sccComponents: StronglyConnectedComponent[]
  ): ComprehensiveRiskAssessment[] {
    // Create lookup maps
    const metricsMap = new Map(dependencyMetrics.map(m => [m.functionId, m]));
    const patternsMap = this.groupPatternsByFunction(riskPatterns);
    const sccMap = this.createSCCMap(sccComponents);
    
    // Calculate assessments
    const assessments: ComprehensiveRiskAssessment[] = [];
    
    for (const func of functions) {
      const metrics = metricsMap.get(func.id);
      const patterns = patternsMap.get(func.id) || [];
      const scc = sccMap.get(func.id);
      
      const assessment = this.assessFunction(func, metrics, patterns, scc, callEdges);
      assessments.push(assessment);
    }
    
    // Sort by priority (highest risk first)
    assessments.sort((a, b) => b.priority - a.priority);
    
    return assessments;
  }

  /**
   * Assess risk for a single function
   */
  private assessFunction(
    func: FunctionInfo,
    metrics?: DependencyMetrics,
    patterns: RiskPattern[] = [],
    scc?: StronglyConnectedComponent,
    callEdges: CallEdge[] = []
  ): ComprehensiveRiskAssessment {
    const factors: RiskFactor[] = [];
    
    // Complexity factors
    factors.push(...this.calculateComplexityFactors(func));
    
    // Size factors
    factors.push(...this.calculateSizeFactors(func));
    
    // Dependency factors
    if (metrics) {
      factors.push(...this.calculateDependencyFactors(metrics));
    }
    
    // Pattern factors
    factors.push(...this.calculatePatternFactors(patterns));
    
    // SCC factors
    if (scc) {
      factors.push(...this.calculateSCCFactors(func, scc));
    }
    
    // Calculate overall score
    const overallScore = this.calculateOverallScore(factors);
    const riskLevel = this.determineRiskLevel(overallScore);
    const priority = this.calculatePriority(overallScore, factors, patterns);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(func, factors, patterns);
    
    return {
      functionId: func.id,
      functionName: func.name,
      filePath: func.filePath,
      overallScore,
      riskLevel,
      factors,
      patterns,
      recommendations,
      priority,
    };
  }

  /**
   * Calculate complexity-related risk factors
   */
  private calculateComplexityFactors(func: FunctionInfo): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // Cyclomatic complexity
    const ccScore = this.scoreComplexity(
      func.metrics.cyclomaticComplexity,
      this.config.complexityThresholds
    );
    factors.push({
      name: 'cyclomaticComplexity',
      weight: this.config.cyclomaticComplexityWeight,
      score: ccScore,
      description: `Cyclomatic complexity: ${func.metrics.cyclomaticComplexity}`,
    });
    
    // Cognitive complexity
    const cognitiveScore = this.scoreComplexity(
      func.metrics.cognitiveComplexity,
      this.config.complexityThresholds
    );
    factors.push({
      name: 'cognitiveComplexity',
      weight: this.config.cognitiveComplexityWeight,
      score: cognitiveScore,
      description: `Cognitive complexity: ${func.metrics.cognitiveComplexity}`,
    });
    
    // Nesting depth
    const nestingScore = this.scoreNesting(func.metrics.maxNestingDepth);
    factors.push({
      name: 'nestingDepth',
      weight: this.config.nestingDepthWeight,
      score: nestingScore,
      description: `Max nesting depth: ${func.metrics.maxNestingDepth}`,
    });
    
    return factors;
  }

  /**
   * Calculate size-related risk factors
   */
  private calculateSizeFactors(func: FunctionInfo): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // Lines of code
    const locScore = this.scoreSize(
      func.metrics.linesOfCode,
      this.config.sizeThresholds
    );
    factors.push({
      name: 'linesOfCode',
      weight: this.config.linesOfCodeWeight,
      score: locScore,
      description: `Lines of code: ${func.metrics.linesOfCode}`,
    });
    
    // Parameter count
    const paramScore = this.scoreParameterCount(func.parameters.length);
    factors.push({
      name: 'parameterCount',
      weight: this.config.parameterCountWeight,
      score: paramScore,
      description: `Parameter count: ${func.parameters.length}`,
    });
    
    return factors;
  }

  /**
   * Calculate dependency-related risk factors
   */
  private calculateDependencyFactors(metrics: DependencyMetrics): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // Fan-in
    const fanInScore = this.scoreFanIn(metrics.fanIn);
    factors.push({
      name: 'fanIn',
      weight: this.config.fanInWeight,
      score: fanInScore,
      description: `Fan-in: ${metrics.fanIn}`,
    });
    
    // Fan-out
    const fanOutScore = this.scoreFanOut(metrics.fanOut);
    factors.push({
      name: 'fanOut',
      weight: this.config.fanOutWeight,
      score: fanOutScore,
      description: `Fan-out: ${metrics.fanOut}`,
    });
    
    return factors;
  }

  /**
   * Calculate pattern-related risk factors
   */
  private calculatePatternFactors(patterns: RiskPattern[]): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // Wrapper function pattern
    const wrapperPattern = patterns.find(p => p.type === 'wrapper');
    if (wrapperPattern) {
      factors.push({
        name: 'wrapperPattern',
        weight: this.config.wrapperPatternWeight,
        score: wrapperPattern.score,
        description: 'Function appears to be a wrapper',
      });
    }
    
    // Fake split pattern
    const fakeSplitPattern = patterns.find(p => p.type === 'fake-split');
    if (fakeSplitPattern) {
      factors.push({
        name: 'fakeSplitPattern',
        weight: this.config.fakeSplitPatternWeight,
        score: fakeSplitPattern.score,
        description: 'Function appears to be artificially split',
      });
    }
    
    // Isolated function
    const isolatedPattern = patterns.find(p => p.type === 'isolated');
    if (isolatedPattern) {
      factors.push({
        name: 'isolatedFunction',
        weight: this.config.isolatedFunctionWeight,
        score: isolatedPattern.score,
        description: 'Function is isolated (no callers or callees)',
      });
    }
    
    return factors;
  }

  /**
   * Calculate SCC-related risk factors
   */
  private calculateSCCFactors(
    func: FunctionInfo,
    scc: StronglyConnectedComponent
  ): RiskFactor[] {
    const factors: RiskFactor[] = [];
    
    // Strongly connected component membership
    if (scc.size > 1) {
      const sccScore = this.scoreSCCMembership(scc.size);
      factors.push({
        name: 'stronglyConnected',
        weight: this.config.stronglyConnectedWeight,
        score: sccScore,
        description: `Part of ${scc.size}-function circular dependency`,
      });
    }
    
    // Recursive call
    if (scc.isRecursive && scc.size === 1) {
      factors.push({
        name: 'recursiveCall',
        weight: this.config.recursiveCallWeight,
        score: 60, // Fixed score for recursive functions
        description: 'Function calls itself recursively',
      });
    }
    
    return factors;
  }

  /**
   * Score complexity metrics
   */
  private scoreComplexity(
    value: number,
    thresholds: { low: number; medium: number; high: number; critical: number }
  ): number {
    if (value >= thresholds.critical) return 90;
    if (value >= thresholds.high) return 70;
    if (value >= thresholds.medium) return 50;
    if (value >= thresholds.low) return 30;
    return 10;
  }

  /**
   * Score nesting depth
   */
  private scoreNesting(depth: number): number {
    if (depth >= 5) return 80;
    if (depth >= 4) return 60;
    if (depth >= 3) return 40;
    if (depth >= 2) return 20;
    return 0;
  }

  /**
   * Score size metrics
   */
  private scoreSize(
    value: number,
    thresholds: { small: number; medium: number; large: number; huge: number }
  ): number {
    if (value >= thresholds.huge) return 90;
    if (value >= thresholds.large) return 70;
    if (value >= thresholds.medium) return 50;
    if (value >= thresholds.small) return 30;
    return 10;
  }

  /**
   * Score parameter count
   */
  private scoreParameterCount(count: number): number {
    if (count >= 8) return 80;
    if (count >= 6) return 60;
    if (count >= 4) return 40;
    if (count >= 3) return 20;
    return 0;
  }

  /**
   * Score fan-in (incoming dependencies)
   */
  private scoreFanIn(fanIn: number): number {
    if (fanIn >= 20) return 70;
    if (fanIn >= 10) return 50;
    if (fanIn >= 5) return 30;
    if (fanIn >= 2) return 10;
    return 0;
  }

  /**
   * Score fan-out (outgoing dependencies)
   */
  private scoreFanOut(fanOut: number): number {
    if (fanOut >= 15) return 80;
    if (fanOut >= 10) return 60;
    if (fanOut >= 7) return 40;
    if (fanOut >= 5) return 20;
    return 0;
  }

  /**
   * Score SCC membership
   */
  private scoreSCCMembership(componentSize: number): number {
    if (componentSize >= 10) return 90;
    if (componentSize >= 5) return 70;
    if (componentSize >= 3) return 50;
    return 30;
  }

  /**
   * Calculate overall weighted score
   */
  private calculateOverallScore(factors: RiskFactor[]): number {
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const factor of factors) {
      weightedSum += factor.score * factor.weight;
      totalWeight += factor.weight;
    }
    
    // Normalize to 0-100 scale
    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  /**
   * Determine risk level from overall score
   */
  private determineRiskLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  /**
   * Calculate priority for ranking
   */
  private calculatePriority(
    overallScore: number,
    factors: RiskFactor[],
    patterns: RiskPattern[]
  ): number {
    let priority = overallScore;
    
    // Boost priority for specific high-impact factors
    const highComplexity = factors.find(f => 
      f.name === 'cyclomaticComplexity' && f.score >= 70
    );
    if (highComplexity) priority += 10;
    
    // Boost priority for critical patterns
    const criticalPatterns = patterns.filter(p => p.severity === 'critical');
    priority += criticalPatterns.length * 15;
    
    // Boost priority for large functions
    const largeFunction = factors.find(f => 
      f.name === 'linesOfCode' && f.score >= 70
    );
    if (largeFunction) priority += 5;
    
    return Math.min(priority, 100);
  }

  /**
   * Generate specific recommendations
   */
  private generateRecommendations(
    func: FunctionInfo,
    factors: RiskFactor[],
    patterns: RiskPattern[]
  ): string[] {
    const recommendations: string[] = [];
    
    // Complexity recommendations
    const complexityFactor = factors.find(f => f.name === 'cyclomaticComplexity');
    if (complexityFactor && complexityFactor.score >= 50) {
      recommendations.push('Reduce cyclomatic complexity by extracting methods or simplifying conditional logic');
    }
    
    // Size recommendations
    const sizeFactor = factors.find(f => f.name === 'linesOfCode');
    if (sizeFactor && sizeFactor.score >= 50) {
      recommendations.push('Break down this large function into smaller, focused functions');
    }
    
    // Parameter recommendations
    const paramFactor = factors.find(f => f.name === 'parameterCount');
    if (paramFactor && paramFactor.score >= 40) {
      recommendations.push('Consider using parameter objects to reduce parameter count');
    }
    
    // Dependency recommendations
    const fanInFactor = factors.find(f => f.name === 'fanIn');
    if (fanInFactor && fanInFactor.score >= 50) {
      recommendations.push('High fan-in indicates this function may have too many responsibilities');
    }
    
    const fanOutFactor = factors.find(f => f.name === 'fanOut');
    if (fanOutFactor && fanOutFactor.score >= 50) {
      recommendations.push('High fan-out suggests this function may be doing too much');
    }
    
    // Pattern-specific recommendations
    for (const pattern of patterns) {
      switch (pattern.type) {
        case 'wrapper':
          recommendations.push('Consider removing this wrapper function if it adds no value');
          break;
        case 'fake-split':
          recommendations.push('Consider consolidating artificially split functions');
          break;
        case 'isolated':
          recommendations.push('Review if this isolated function is still needed');
          break;
      }
    }
    
    return recommendations;
  }

  /**
   * Group patterns by function ID
   */
  private groupPatternsByFunction(patterns: RiskPattern[]): Map<string, RiskPattern[]> {
    const map = new Map<string, RiskPattern[]>();
    
    for (const pattern of patterns) {
      const existing = map.get(pattern.functionId) || [];
      existing.push(pattern);
      map.set(pattern.functionId, existing);
    }
    
    return map;
  }

  /**
   * Create SCC map from components
   */
  private createSCCMap(components: StronglyConnectedComponent[]): Map<string, StronglyConnectedComponent> {
    const map = new Map<string, StronglyConnectedComponent>();
    
    for (const component of components) {
      for (const functionId of component.functionIds) {
        map.set(functionId, component);
      }
    }
    
    return map;
  }

  /**
   * Get risk statistics for all assessments
   */
  getRiskStatistics(assessments: ComprehensiveRiskAssessment[]): {
    totalFunctions: number;
    riskDistribution: Record<string, number>;
    averageScore: number;
    topRisks: ComprehensiveRiskAssessment[];
    mostCommonFactors: Array<{ name: string; count: number; avgScore: number }>;
  } {
    const riskDistribution = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    
    let totalScore = 0;
    const factorCounts = new Map<string, { count: number; totalScore: number }>();
    
    for (const assessment of assessments) {
      riskDistribution[assessment.riskLevel]++;
      totalScore += assessment.overallScore;
      
      // Count factors
      for (const factor of assessment.factors) {
        const existing = factorCounts.get(factor.name) || { count: 0, totalScore: 0 };
        existing.count++;
        existing.totalScore += factor.score;
        factorCounts.set(factor.name, existing);
      }
    }
    
    const averageScore = assessments.length > 0 ? totalScore / assessments.length : 0;
    const topRisks = assessments.slice(0, 10); // Top 10 risks
    
    // Most common factors
    const mostCommonFactors = Array.from(factorCounts.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgScore: data.totalScore / data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return {
      totalFunctions: assessments.length,
      riskDistribution,
      averageScore: Math.round(averageScore),
      topRisks,
      mostCommonFactors,
    };
  }
}