import {
  FunctionInfo,
  RefactoringOpportunity,
  RefactoringPattern,
  RefactoringReport,
  ProjectRefactoringSummary,
  QualityHotSpot,
  QualityIssue,
  RefactoringTrend,
  RefactoringRecommendation,
} from '../types/index.js';
import { StorageAdapter } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Phase 3: RefactoringAnalyzer - Core engine for analyzing refactoring opportunities
 *
 * This class provides comprehensive analysis of code quality and identifies specific
 * refactoring opportunities based on multiple quality metrics and patterns.
 */
export class RefactoringAnalyzer {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly config: RefactoringAnalyzerConfig = DEFAULT_REFACTORING_CONFIG
  ) {}

  /**
   * Performs comprehensive project analysis for refactoring opportunities
   */
  async analyzeProject(options: AnalysisOptions = {}): Promise<RefactoringReport> {
    const snapshots = await this.storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) {
      throw new Error('No snapshots found. Please run `funcqc scan` first.');
    }

    const latestSnapshot = snapshots[0];
    const functions = await this.storage.getFunctions(latestSnapshot.id);

    const filteredFunctions = this.applyAnalysisFilters(functions, options);

    // Parallel analysis for better performance
    const [opportunities, hotSpots, trends, projectSummary] = await Promise.all([
      this.detectOpportunities(filteredFunctions, options.patterns),
      this.identifyQualityHotSpots(filteredFunctions),
      this.analyzeTrends(options.since),
      this.generateProjectSummary(filteredFunctions),
    ]);

    const recommendations = this.generateRecommendations(opportunities, hotSpots);

    return {
      projectSummary,
      opportunities,
      hotSpots,
      trends,
      recommendations,
    };
  }

  /**
   * Detects specific refactoring opportunities in the given functions
   */
  async detectOpportunities(
    functions: FunctionInfo[],
    patterns?: RefactoringPattern[]
  ): Promise<RefactoringOpportunity[]> {
    const opportunities: RefactoringOpportunity[] = [];
    const enabledPatterns = patterns || Object.values(RefactoringPattern);

    for (const func of functions) {
      if (!func.metrics) continue;

      for (const pattern of enabledPatterns) {
        const opportunity = await this.detectPatternOpportunity(func, pattern);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }
    }

    return opportunities.sort((a, b) => b.impact_score - a.impact_score);
  }

  /**
   * Assesses the impact of implementing a specific refactoring opportunity
   */
  async assessImpact(opportunity: RefactoringOpportunity): Promise<ImpactAssessment> {
    const func = await this.storage.getFunction(opportunity.function_id);
    if (!func) {
      throw new Error(`Function not found: ${opportunity.function_id}`);
    }

    const riskAnalysis = this.assessRefactoringRisk(func, opportunity.pattern);
    const benefitAnalysis = this.assessRefactoringBenefit(func, opportunity.pattern);
    const effortEstimate = this.estimateRefactoringEffort(func, opportunity.pattern);

    return {
      opportunity,
      risk: riskAnalysis,
      benefit: benefitAnalysis,
      effort: effortEstimate,
      recommendation: this.calculateRecommendation(riskAnalysis, benefitAnalysis, effortEstimate),
    };
  }

  /**
   * Generates a comprehensive refactoring plan
   */
  async generatePlan(opportunities: RefactoringOpportunity[]): Promise<RefactoringPlan> {
    const prioritizedOpportunities = this.prioritizeOpportunities(opportunities);
    const phases = this.groupIntoPhases(prioritizedOpportunities);
    const dependencies = await this.analyzeDependencies(prioritizedOpportunities);

    return {
      phases,
      dependencies,
      estimatedTotalEffort: this.calculateTotalEffort(prioritizedOpportunities),
      riskLevel: this.assessOverallRisk(prioritizedOpportunities),
      expectedBenefits: this.summarizeExpectedBenefits(prioritizedOpportunities),
    };
  }

  // ========================================
  // PRIVATE ANALYSIS METHODS
  // ========================================

  private applyAnalysisFilters(
    functions: FunctionInfo[],
    options: AnalysisOptions
  ): FunctionInfo[] {
    let filtered = functions;

    if (options.complexityThreshold) {
      filtered = filtered.filter(
        f => f.metrics && f.metrics.cyclomaticComplexity >= options.complexityThreshold!
      );
    }

    if (options.sizeThreshold) {
      filtered = filtered.filter(f => f.metrics && f.metrics.linesOfCode >= options.sizeThreshold!);
    }

    if (options.filePattern) {
      const pattern = new RegExp(options.filePattern, 'i');
      filtered = filtered.filter(f => pattern.test(f.filePath));
    }

    return filtered;
  }

  private async detectPatternOpportunity(
    func: FunctionInfo,
    pattern: RefactoringPattern
  ): Promise<RefactoringOpportunity | null> {
    const detector = this.getPatternDetector(pattern);
    const detection = detector.detect(func);

    if (!detection.isCandidate) {
      return null;
    }

    return {
      id: uuidv4(),
      pattern,
      function_id: func.id,
      severity: detection.severity,
      impact_score: detection.impactScore,
      description: detection.description || 'Refactoring opportunity detected',
      suggested_actions: detection.suggestedActions || [],
      metadata: detection.metadata,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  private getPatternDetector(pattern: RefactoringPattern): PatternDetector {
    switch (pattern) {
      case RefactoringPattern.ExtractMethod:
        return new ExtractMethodDetector(this.config.patterns.extractMethod);
      case RefactoringPattern.SplitFunction:
        return new SplitFunctionDetector(this.config.patterns.splitFunction);
      case RefactoringPattern.ReduceParameters:
        return new ReduceParametersDetector(this.config.patterns.reduceParameters);
      case RefactoringPattern.ExtractClass:
        return new ExtractClassDetector(this.config.patterns.extractClass);
      case RefactoringPattern.InlineFunction:
        return new InlineFunctionDetector(this.config.patterns.inlineFunction);
      case RefactoringPattern.RenameFunction:
        return new RenameFunctionDetector(this.config.patterns.renameFunction);
      default:
        throw new Error(`Unknown refactoring pattern: ${pattern}`);
    }
  }

  private async identifyQualityHotSpots(functions: FunctionInfo[]): Promise<QualityHotSpot[]> {
    const hotSpots: QualityHotSpot[] = [];

    for (const func of functions) {
      if (!func.metrics) continue;

      const issues = this.identifyQualityIssues(func);
      if (issues.length > 0) {
        const riskScore = this.calculateRiskScore(func, issues);

        if (riskScore >= this.config.thresholds.hotSpotMinRisk) {
          hotSpots.push({
            functionId: func.id,
            functionName: func.name,
            filePath: func.filePath,
            issues,
            complexity: func.metrics.cyclomaticComplexity,
            changeFrequency: 0, // Will be calculated from Git history in future
            riskScore,
          });
        }
      }
    }

    return hotSpots.sort((a, b) => b.riskScore - a.riskScore);
  }

  private identifyQualityIssues(func: FunctionInfo): QualityIssue[] {
    const issues: QualityIssue[] = [];
    const metrics = func.metrics!;

    // Complexity issues
    if (metrics.cyclomaticComplexity >= this.config.thresholds.complexityCritical) {
      issues.push({
        type: 'complexity',
        severity: 'critical',
        description: `Very high cyclomatic complexity (${metrics.cyclomaticComplexity})`,
        suggestedActions: [
          'Extract methods',
          'Simplify conditional logic',
          'Consider strategy pattern',
        ],
      });
    } else if (metrics.cyclomaticComplexity >= this.config.thresholds.complexityHigh) {
      issues.push({
        type: 'complexity',
        severity: 'high',
        description: `High cyclomatic complexity (${metrics.cyclomaticComplexity})`,
        suggestedActions: ['Extract methods', 'Reduce branching'],
      });
    }

    // Size issues
    if (metrics.linesOfCode >= this.config.thresholds.sizeCritical) {
      issues.push({
        type: 'size',
        severity: 'critical',
        description: `Very large function (${metrics.linesOfCode} lines)`,
        suggestedActions: ['Split into smaller functions', 'Extract logical blocks'],
      });
    } else if (metrics.linesOfCode >= this.config.thresholds.sizeHigh) {
      issues.push({
        type: 'size',
        severity: 'high',
        description: `Large function (${metrics.linesOfCode} lines)`,
        suggestedActions: ['Consider extracting methods'],
      });
    }

    // Parameter count issues
    if (metrics.parameterCount >= this.config.thresholds.parametersCritical) {
      issues.push({
        type: 'coupling',
        severity: 'critical',
        description: `Too many parameters (${metrics.parameterCount})`,
        suggestedActions: ['Extract parameter object', 'Reduce dependencies'],
      });
    }

    return issues;
  }

  private calculateRiskScore(func: FunctionInfo, issues: QualityIssue[]): number {
    let score = 0;

    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          score += 40;
          break;
        case 'high':
          score += 25;
          break;
        case 'medium':
          score += 15;
          break;
        case 'low':
          score += 5;
          break;
      }
    }

    // Boost score for exported functions (higher impact)
    if (func.isExported) {
      score *= 1.2;
    }

    return Math.min(100, Math.round(score));
  }

  private async analyzeTrends(_since?: string): Promise<RefactoringTrend[]> {
    // For now, return empty array. This will be implemented with Git history analysis
    return [];
  }

  private async generateProjectSummary(
    functions: FunctionInfo[]
  ): Promise<ProjectRefactoringSummary> {
    const analyzedFunctions = functions.filter(f => f.metrics);
    const totalComplexity = analyzedFunctions.reduce(
      (sum, f) => sum + (f.metrics?.cyclomaticComplexity || 0),
      0
    );
    const avgComplexity = totalComplexity / analyzedFunctions.length;

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (avgComplexity > 8) riskLevel = 'high';
    else if (avgComplexity > 5) riskLevel = 'medium';

    return {
      totalFunctions: functions.length,
      analyzedFunctions: analyzedFunctions.length,
      opportunitiesFound: 0, // Will be set after opportunity detection
      estimatedEffort: 0, // Will be calculated based on opportunities
      riskLevel,
      priorityAreas: this.identifyPriorityAreas(analyzedFunctions),
    };
  }

  private identifyPriorityAreas(functions: FunctionInfo[]): string[] {
    const fileStats = new Map<string, { complexity: number; count: number }>();

    for (const func of functions) {
      if (!func.metrics) continue;

      const filePath = func.filePath;
      const current = fileStats.get(filePath) || { complexity: 0, count: 0 };
      current.complexity += func.metrics.cyclomaticComplexity;
      current.count += 1;
      fileStats.set(filePath, current);
    }

    return Array.from(fileStats.entries())
      .map(([file, stats]) => ({ file, avgComplexity: stats.complexity / stats.count }))
      .sort((a, b) => b.avgComplexity - a.avgComplexity)
      .slice(0, 5)
      .map(item => item.file);
  }

  private generateRecommendations(
    opportunities: RefactoringOpportunity[],
    _hotSpots: QualityHotSpot[]
  ): RefactoringRecommendation[] {
    const recommendations: RefactoringRecommendation[] = [];

    // High-impact opportunities become high-priority recommendations
    const highImpactOpportunities = opportunities.filter(o => o.impact_score >= 70);

    for (const opportunity of highImpactOpportunities) {
      recommendations.push({
        priority: 'high',
        pattern: opportunity.pattern,
        targets: [opportunity.function_id],
        reasoning: `High impact score (${opportunity.impact_score}) with ${opportunity.severity} severity`,
        estimatedEffort: this.estimateEffortForPattern(opportunity.pattern),
        expectedBenefit: this.describeBenefitForPattern(opportunity.pattern),
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private estimateEffortForPattern(pattern: RefactoringPattern): number {
    const effortMap = {
      [RefactoringPattern.ExtractMethod]: 2,
      [RefactoringPattern.SplitFunction]: 4,
      [RefactoringPattern.ReduceParameters]: 3,
      [RefactoringPattern.ExtractClass]: 8,
      [RefactoringPattern.InlineFunction]: 1,
      [RefactoringPattern.RenameFunction]: 1,
    };
    return effortMap[pattern] || 2;
  }

  private describeBenefitForPattern(pattern: RefactoringPattern): string {
    const benefitMap = {
      [RefactoringPattern.ExtractMethod]: 'Improved readability and reusability',
      [RefactoringPattern.SplitFunction]: 'Better separation of concerns and testability',
      [RefactoringPattern.ReduceParameters]: 'Reduced coupling and improved maintainability',
      [RefactoringPattern.ExtractClass]: 'Better organization and single responsibility',
      [RefactoringPattern.InlineFunction]: 'Reduced indirection and complexity',
      [RefactoringPattern.RenameFunction]: 'Improved code clarity and documentation',
    };
    return benefitMap[pattern] || 'General code quality improvement';
  }

  private prioritizeOpportunities(
    opportunities: RefactoringOpportunity[]
  ): RefactoringOpportunity[] {
    return opportunities.sort((a, b) => {
      // Primary sort: severity
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;

      // Secondary sort: impact score
      return b.impact_score - a.impact_score;
    });
  }

  private groupIntoPhases(opportunities: RefactoringOpportunity[]): RefactoringPhase[] {
    const phases: RefactoringPhase[] = [];

    // Phase 1: Critical issues
    const critical = opportunities.filter(o => o.severity === 'critical');
    if (critical.length > 0) {
      phases.push({
        name: 'Critical Issues',
        description: 'Address critical code quality issues',
        opportunities: critical,
        estimatedEffort: critical.length * 4,
        priority: 'high',
      });
    }

    // Phase 2: High impact improvements
    const high = opportunities.filter(o => o.severity === 'high');
    if (high.length > 0) {
      phases.push({
        name: 'High Impact Improvements',
        description: 'Implement high-value refactoring opportunities',
        opportunities: high,
        estimatedEffort: high.length * 3,
        priority: 'medium',
      });
    }

    return phases;
  }

  private async analyzeDependencies(
    _opportunities: RefactoringOpportunity[]
  ): Promise<RefactoringDependency[]> {
    // For now, return empty array. Dependency analysis will be implemented later
    return [];
  }

  private calculateTotalEffort(opportunities: RefactoringOpportunity[]): number {
    return opportunities.reduce(
      (total, opp) => total + this.estimateEffortForPattern(opp.pattern),
      0
    );
  }

  private assessOverallRisk(opportunities: RefactoringOpportunity[]): 'low' | 'medium' | 'high' {
    const criticalCount = opportunities.filter(o => o.severity === 'critical').length;
    const highCount = opportunities.filter(o => o.severity === 'high').length;

    if (criticalCount > 3 || highCount > 10) return 'high';
    if (criticalCount > 0 || highCount > 5) return 'medium';
    return 'low';
  }

  private summarizeExpectedBenefits(opportunities: RefactoringOpportunity[]): string[] {
    const benefits = new Set<string>();

    for (const opp of opportunities) {
      benefits.add(this.describeBenefitForPattern(opp.pattern));
    }

    return Array.from(benefits);
  }

  private assessRefactoringRisk(func: FunctionInfo, _pattern: RefactoringPattern): RiskAssessment {
    // Simplified risk assessment - will be expanded
    const riskLevel = func.isExported ? 'medium' : 'low';
    return {
      level: riskLevel,
      factors: func.isExported ? ['Function is exported', 'May affect external consumers'] : [],
      mitigation: ['Create comprehensive tests', 'Gradual rollout'],
    };
  }

  private assessRefactoringBenefit(
    _func: FunctionInfo,
    _pattern: RefactoringPattern
  ): BenefitAssessment {
    return {
      qualityImprovement: 'medium',
      maintainabilityGain: 'high',
      testabilityGain: 'medium',
      performanceImpact: 'neutral',
    };
  }

  private estimateRefactoringEffort(
    func: FunctionInfo,
    pattern: RefactoringPattern
  ): EffortEstimate {
    const baseEffort = this.estimateEffortForPattern(pattern);
    const complexityMultiplier = func.metrics
      ? Math.min(2, func.metrics.cyclomaticComplexity / 10)
      : 1;

    return {
      hours: Math.round(baseEffort * complexityMultiplier),
      difficulty: complexityMultiplier > 1.5 ? 'hard' : 'medium',
      prerequisites: [],
    };
  }

  private calculateRecommendation(
    risk: RiskAssessment,
    benefit: BenefitAssessment,
    effort: EffortEstimate
  ): 'proceed' | 'caution' | 'defer' {
    if (risk.level === 'high' && effort.difficulty === 'hard') return 'defer';
    if (benefit.qualityImprovement === 'high' || benefit.maintainabilityGain === 'high')
      return 'proceed';
    return 'caution';
  }
}

// ========================================
// CONFIGURATION INTERFACES
// ========================================

export interface RefactoringAnalyzerConfig {
  thresholds: RefactoringThresholds;
  patterns: PatternConfigs;
}

export interface RefactoringThresholds {
  complexityHigh: number;
  complexityCritical: number;
  sizeHigh: number;
  sizeCritical: number;
  parametersHigh: number;
  parametersCritical: number;
  hotSpotMinRisk: number;
}

export interface PatternConfigs {
  extractMethod: ExtractMethodConfig;
  splitFunction: SplitFunctionConfig;
  reduceParameters: ReduceParametersConfig;
  extractClass: ExtractClassConfig;
  inlineFunction: InlineFunctionConfig;
  renameFunction: RenameFunctionConfig;
}

export const DEFAULT_REFACTORING_CONFIG: RefactoringAnalyzerConfig = {
  thresholds: {
    complexityHigh: 8,
    complexityCritical: 15,
    sizeHigh: 30,
    sizeCritical: 60,
    parametersHigh: 4,
    parametersCritical: 6,
    hotSpotMinRisk: 50,
  },
  patterns: {
    extractMethod: { minLines: 15, minComplexity: 8 },
    splitFunction: { minResponsibilities: 3, minLines: 40 },
    reduceParameters: { minParameters: 5 },
    extractClass: { minMethods: 4, minCohesion: 0.3 },
    inlineFunction: { maxLines: 3, maxComplexity: 1 },
    renameFunction: { minClarityScore: 0.6 },
  },
};

// ========================================
// SUPPORTING INTERFACES
// ========================================

export interface AnalysisOptions {
  complexityThreshold?: number;
  sizeThreshold?: number;
  filePattern?: string;
  patterns?: RefactoringPattern[];
  since?: string;
}

export interface ImpactAssessment {
  opportunity: RefactoringOpportunity;
  risk: RiskAssessment;
  benefit: BenefitAssessment;
  effort: EffortEstimate;
  recommendation: 'proceed' | 'caution' | 'defer';
}

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high';
  factors: string[];
  mitigation: string[];
}

export interface BenefitAssessment {
  qualityImprovement: 'low' | 'medium' | 'high';
  maintainabilityGain: 'low' | 'medium' | 'high';
  testabilityGain: 'low' | 'medium' | 'high';
  performanceImpact: 'negative' | 'neutral' | 'positive';
}

export interface EffortEstimate {
  hours: number;
  difficulty: 'easy' | 'medium' | 'hard';
  prerequisites: string[];
}

export interface RefactoringPlan {
  phases: RefactoringPhase[];
  dependencies: RefactoringDependency[];
  estimatedTotalEffort: number;
  riskLevel: 'low' | 'medium' | 'high';
  expectedBenefits: string[];
}

export interface RefactoringPhase {
  name: string;
  description: string;
  opportunities: RefactoringOpportunity[];
  estimatedEffort: number;
  priority: 'high' | 'medium' | 'low';
}

export interface RefactoringDependency {
  from: string; // opportunity ID
  to: string; // opportunity ID
  type: 'prerequisite' | 'conflict' | 'synergy';
  description: string;
}

// Pattern detector interfaces
export interface PatternDetector {
  detect(func: FunctionInfo): PatternDetection;
}

export interface PatternDetection {
  isCandidate: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impactScore: number;
  description?: string;
  suggestedActions?: string[];
  metadata: Record<string, unknown>;
}

// Pattern-specific configurations
export interface ExtractMethodConfig {
  minLines: number;
  minComplexity: number;
}

export interface SplitFunctionConfig {
  minResponsibilities: number;
  minLines: number;
}

export interface ReduceParametersConfig {
  minParameters: number;
}

export interface ExtractClassConfig {
  minMethods: number;
  minCohesion: number;
}

export interface InlineFunctionConfig {
  maxLines: number;
  maxComplexity: number;
}

export interface RenameFunctionConfig {
  minClarityScore: number;
}

// ========================================
// PATTERN DETECTOR IMPLEMENTATIONS
// ========================================

class ExtractMethodDetector implements PatternDetector {
  constructor(private config: ExtractMethodConfig) {}

  detect(func: FunctionInfo): PatternDetection {
    if (!func.metrics) {
      return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
    }

    const isCandidate =
      func.metrics.linesOfCode >= this.config.minLines &&
      func.metrics.cyclomaticComplexity >= this.config.minComplexity;

    if (!isCandidate) {
      return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
    }

    const impactScore = Math.min(
      100,
      (func.metrics.linesOfCode / this.config.minLines) * 30 +
        (func.metrics.cyclomaticComplexity / this.config.minComplexity) * 40
    );

    const severity =
      impactScore >= 80
        ? 'critical'
        : impactScore >= 60
          ? 'high'
          : impactScore >= 40
            ? 'medium'
            : 'low';

    return {
      isCandidate: true,
      severity,
      impactScore: Math.round(impactScore),
      metadata: {
        linesOfCode: func.metrics.linesOfCode,
        complexity: func.metrics.cyclomaticComplexity,
        extractableBlocks: this.identifyExtractableBlocks(func),
      },
    };
  }

  private identifyExtractableBlocks(func: FunctionInfo): number {
    // Simplified: estimate based on complexity
    return Math.floor((func.metrics?.cyclomaticComplexity || 0) / 3);
  }
}

class SplitFunctionDetector implements PatternDetector {
  constructor(private config: SplitFunctionConfig) {}

  detect(func: FunctionInfo): PatternDetection {
    if (!func.metrics) {
      return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
    }

    const responsibilities = this.estimateResponsibilities(func);
    const isCandidate =
      responsibilities >= this.config.minResponsibilities &&
      func.metrics.linesOfCode >= this.config.minLines;

    if (!isCandidate) {
      return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
    }

    const impactScore = Math.min(
      100,
      (responsibilities / this.config.minResponsibilities) * 40 +
        (func.metrics.linesOfCode / this.config.minLines) * 30
    );

    const severity = impactScore >= 75 ? 'critical' : impactScore >= 55 ? 'high' : 'medium';

    return {
      isCandidate: true,
      severity,
      impactScore: Math.round(impactScore),
      metadata: {
        estimatedResponsibilities: responsibilities,
        linesOfCode: func.metrics.linesOfCode,
      },
    };
  }

  private estimateResponsibilities(func: FunctionInfo): number {
    // Simplified: estimate based on complexity and size
    const complexity = func.metrics?.cyclomaticComplexity || 0;
    const size = func.metrics?.linesOfCode || 0;
    return Math.floor((complexity + size / 20) / 4);
  }
}

class ReduceParametersDetector implements PatternDetector {
  constructor(private config: ReduceParametersConfig) {}

  detect(func: FunctionInfo): PatternDetection {
    const paramCount = func.parameters.length;
    const isCandidate = paramCount >= this.config.minParameters;

    if (!isCandidate) {
      return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
    }

    const impactScore = Math.min(100, (paramCount / this.config.minParameters) * 60);
    const severity = paramCount >= 8 ? 'critical' : paramCount >= 6 ? 'high' : 'medium';

    return {
      isCandidate: true,
      severity,
      impactScore: Math.round(impactScore),
      metadata: {
        parameterCount: paramCount,
        parameters: func.parameters.map(p => ({ name: p.name, type: p.type })),
      },
    };
  }
}

class ExtractClassDetector implements PatternDetector {
  constructor(_config: ExtractClassConfig) {}

  detect(_func: FunctionInfo): PatternDetection {
    // For now, this detector doesn't identify class extraction opportunities
    // This would require cross-function analysis
    return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
  }
}

class InlineFunctionDetector implements PatternDetector {
  constructor(private config: InlineFunctionConfig) {}

  detect(func: FunctionInfo): PatternDetection {
    if (!func.metrics) {
      return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
    }

    const isCandidate =
      func.metrics.linesOfCode <= this.config.maxLines &&
      func.metrics.cyclomaticComplexity <= this.config.maxComplexity;

    if (!isCandidate) {
      return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
    }

    const impactScore = 30; // Low impact but potentially useful

    return {
      isCandidate: true,
      severity: 'low',
      impactScore,
      metadata: {
        linesOfCode: func.metrics.linesOfCode,
        complexity: func.metrics.cyclomaticComplexity,
      },
    };
  }
}

class RenameFunctionDetector implements PatternDetector {
  constructor(private config: RenameFunctionConfig) {}

  detect(func: FunctionInfo): PatternDetection {
    const clarityScore = this.assessNameClarity(func.name);
    const isCandidate = clarityScore < this.config.minClarityScore;

    if (!isCandidate) {
      return { isCandidate: false, severity: 'low', impactScore: 0, metadata: {} };
    }

    const impactScore = Math.round((1 - clarityScore) * 50);
    const severity = clarityScore < 0.3 ? 'high' : clarityScore < 0.5 ? 'medium' : 'low';

    return {
      isCandidate: true,
      severity,
      impactScore,
      metadata: {
        currentName: func.name,
        clarityScore,
        issues: this.identifyNameIssues(func.name),
      },
    };
  }

  private assessNameClarity(name: string): number {
    let score = 1.0;

    // Penalize very short names
    if (name.length < 3) score -= 0.4;

    // Penalize generic names
    const genericNames = ['data', 'temp', 'value', 'result', 'item', 'obj'];
    if (genericNames.includes(name.toLowerCase())) score -= 0.3;

    // Penalize abbreviations
    if (name.length < 6 && !/^[A-Z]/.test(name)) score -= 0.2;

    return Math.max(0, score);
  }

  private identifyNameIssues(name: string): string[] {
    const issues: string[] = [];

    if (name.length < 3) issues.push('Name too short');
    if (!/^[a-z]/.test(name)) issues.push('Should start with lowercase');
    if (name.includes('_') && !name.startsWith('_')) issues.push('Consider camelCase');

    return issues;
  }
}
