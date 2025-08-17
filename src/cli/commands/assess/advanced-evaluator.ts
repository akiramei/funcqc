/**
 * Advanced Evaluator - High-performance quality assessment engine
 * Integrates Dynamic Weights, Structural Analysis, Risk Evaluation, and Quality Gate
 */

import { FunctionInfo, QualityMetrics, AssessCommandOptions } from '../../../types';
import { CommandEnvironment } from '../../../types/environment';
import { DynamicWeightCalculator } from '../../../analyzers/dynamic-weight-calculator';
import { StructuralAnalyzer, StructuralMetrics, StructuralAnomaly } from '../../../utils/structural-analyzer';
import { QualityAssessment, QualityViolation } from '../../../core/realtime-quality-gate';
import { 
  DynamicWeightConfig, 
  FunctionContext, 
  ArchitecturalLayer, 
  FunctionRole, 
  CriticalityLevel 
} from '../../../types/dynamic-weights';

/**
 * Comprehensive assessment result combining all evaluation engines
 */
export interface AdvancedAssessmentResult {
  /** Overall assessment metadata */
  metadata: {
    evaluationMode: 'static' | 'dynamic';
    timestamp: number;
    totalFunctions: number;
    analysisTime: number;
  };
  
  /** Index signature for compatibility with Record<string, unknown> */
  [key: string]: unknown;

  /** Project-level assessment */
  projectAssessment: {
    overallScore: number;
    riskDistribution: RiskDistribution;
    qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F';
    structuralHealth: number;
    recommendations: string[];
  };

  /** Dynamic weight configuration (if applicable) */
  dynamicConfig?: DynamicWeightConfig;

  /** Function-level detailed results */
  functionResults: FunctionAssessmentResult[];

  /** Structural analysis summary */
  structuralSummary: {
    totalAnomalies: number;
    criticalAnomalies: number;
    anomalyTypes: Record<string, number>;
    structuralScore: number;
  };

  /** Performance metrics */
  performance: {
    evaluationTime: number;
    functionsPerSecond: number;
    memoryUsage?: number;
  };
}

/**
 * Individual function assessment result
 */
export interface FunctionAssessmentResult {
  functionId: string;
  functionName: string;
  filePath: string;
  
  /** Quality metrics */
  metrics: QualityMetrics;
  
  /** Dynamic weight calculation result (if applicable) */
  dynamicWeight?: {
    finalWeight: number;
    baseWeight: number;
    adjustments: Record<string, number>;
    explanation: string;
  };
  
  /** Structural analysis result */
  structural: {
    metrics: StructuralMetrics;
    anomalies: StructuralAnomaly[];
    score: number;
  };
  
  /** Risk evaluation */
  risk: {
    level: 'low' | 'medium' | 'high' | 'critical';
    score: number;
    violations: QualityViolation[];
    zScores: Record<string, number>;
  };
  
  /** Quality gate result */
  qualityGate: QualityAssessment;
}

/**
 * Risk distribution summary
 */
export interface RiskDistribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

/**
 * Advanced Quality Evaluator
 */
export class AdvancedEvaluator {
  private dynamicWeightCalculator?: DynamicWeightCalculator;
  private structuralAnalyzer: StructuralAnalyzer; // TODO: Integrate structural analysis

  constructor(private options: AssessCommandOptions, private env: CommandEnvironment) {
    this.structuralAnalyzer = new StructuralAnalyzer();
    // TODO: Integrate structural analysis functionality
    void this.structuralAnalyzer; // Prevent unused variable error
    
    // Initialize dynamic weight calculator if dynamic mode is enabled
    if (options.mode === 'dynamic') {
      this.initializeDynamicWeightCalculator();
    }
  }

  /**
   * Perform comprehensive advanced assessment
   */
  async performAssessment(functions: FunctionInfo[]): Promise<AdvancedAssessmentResult> {
    const startTime = Date.now();
    
    if (!this.options.quiet) {
      this.env.commandLogger.log(`🔬 Starting advanced assessment of ${functions.length} functions...`);
    }

    // Initialize result structure
    const result: AdvancedAssessmentResult = {
      metadata: {
        evaluationMode: this.options.mode || 'static',
        timestamp: startTime,
        totalFunctions: functions.length,
        analysisTime: 0
      },
      projectAssessment: {
        overallScore: 0,
        riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
        qualityGrade: 'F',
        structuralHealth: 0,
        recommendations: []
      },
      functionResults: [],
      structuralSummary: {
        totalAnomalies: 0,
        criticalAnomalies: 0,
        anomalyTypes: {},
        structuralScore: 0
      },
      performance: {
        evaluationTime: 0,
        functionsPerSecond: 0
      }
    };

    // Process functions in batches for performance
    const batchSize = 100;
    const batches = this.createBatches(functions, batchSize);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      if (!this.options.quiet) {
        this.env.commandLogger.log(`   📊 Processing batch ${i + 1}/${batches.length} (${batch.length} functions)`);
      }
      
      const batchResults = await this.processFunctionBatch(batch);
      result.functionResults.push(...batchResults);
    }

    // Calculate project-level metrics
    this.calculateProjectMetrics(result);
    
    // Generate recommendations
    if (this.options.includeRecommendations) {
      result.projectAssessment.recommendations = this.generateRecommendations(result);
    }

    // Record performance metrics
    const endTime = Date.now();
    result.metadata.analysisTime = endTime - startTime;
    result.performance.evaluationTime = endTime - startTime;
    result.performance.functionsPerSecond = Math.round(functions.length / (result.performance.evaluationTime / 1000));

    if (!this.options.quiet) {
      this.env.commandLogger.log(`✅ Advanced assessment completed in ${result.performance.evaluationTime}ms`);
      this.env.commandLogger.log(`   📈 Performance: ${result.performance.functionsPerSecond} functions/second`);
    }

    return result;
  }

  /**
   * Process a batch of functions
   */
  private async processFunctionBatch(functions: FunctionInfo[]): Promise<FunctionAssessmentResult[]> {
    const results: FunctionAssessmentResult[] = [];

    for (const func of functions) {
      try {
        const result = await this.evaluateFunction(func);
        results.push(result);
      } catch (error) {
        // Log error but continue processing
        if (!this.options.quiet) {
          this.env.commandLogger.log(`⚠️  Failed to evaluate function ${func.name}: ${error}`);
        }
      }
    }

    return results;
  }

  /**
   * Evaluate a single function using all available engines
   */
  private async evaluateFunction(func: FunctionInfo): Promise<FunctionAssessmentResult> {
    const result: FunctionAssessmentResult = {
      functionId: func.id,
      functionName: func.name,
      filePath: func.filePath,
      metrics: func.metrics || this.getDefaultMetrics(),
      structural: {
        metrics: {} as StructuralMetrics,
        anomalies: [],
        score: 0
      },
      risk: {
        level: 'low',
        score: 0,
        violations: [],
        zScores: {}
      },
      qualityGate: {} as QualityAssessment
    };

    // Structural Analysis
    if (this.options.includeStructural !== false) {
      result.structural = await this.performStructuralAnalysis(func);
    }

    // Dynamic Weight Calculation
    if (this.options.mode === 'dynamic' && this.dynamicWeightCalculator) {
      result.dynamicWeight = this.calculateDynamicWeight(func);
    }

    // Risk Evaluation
    if (this.options.includeRisk !== false) {
      result.risk = this.evaluateRisk(func, result.structural.metrics);
    }

    // Quality Gate Evaluation
    if (this.options.includeGate !== false) {
      result.qualityGate = await this.evaluateQualityGate(func);
    }

    return result;
  }

  /**
   * Initialize dynamic weight calculator
   */
  private initializeDynamicWeightCalculator(): void {
    const config: DynamicWeightConfig = {
      projectSize: 1000, // Will be updated with actual project size
      architecturePattern: this.options.architecturePattern || 'Unknown',
      domainComplexity: this.options.domainComplexity || 'Medium',
      teamExperience: this.options.teamExperience || 'Mixed',
      mode: 'dynamic'
    };

    this.dynamicWeightCalculator = new DynamicWeightCalculator({
      config,
      enableExplanation: true
    });
  }

  /**
   * Perform structural analysis for a function
   */
  private async performStructuralAnalysis(func: FunctionInfo): Promise<{
    metrics: StructuralMetrics;
    anomalies: StructuralAnomaly[];
    score: number;
  }> {
    // Mock implementation - replace with actual structural analyzer
    const metrics: StructuralMetrics = {
      cyclomaticComplexity: func.metrics?.cyclomaticComplexity || 0,
      linesOfCode: func.metrics?.linesOfCode || 0,
      parameterCount: func.metrics?.parameterCount || 0,
      nestingLevel: func.metrics?.maxNestingLevel || 0,
      fanIn: 0, // Would be calculated from call graph
      fanOut: 0, // Would be calculated from call graph
      // Required properties from StructuralMetrics interface
      betweenness: 0,
      closeness: 0,
      pageRank: 0,
      degreeCentrality: 0,
      callDepth: 0,
      clustering: 0
    };

    const anomalies: StructuralAnomaly[] = [];
    
    // Detect common structural anomalies
    if (metrics.linesOfCode > 50) {
      anomalies.push({
        metric: 'linesOfCode',
        value: metrics.linesOfCode,
        expectedRange: [10, 50] as [number, number],
        severity: 'warning',
        description: `Function has ${metrics.linesOfCode} lines, consider breaking it down`,
        suggestion: 'Extract smaller, focused methods'
      });
    }

    if (metrics.parameterCount > 5) {
      anomalies.push({
        metric: 'parameterCount',
        value: metrics.parameterCount,
        expectedRange: [1, 5] as [number, number],
        severity: 'critical',
        description: `Function has ${metrics.parameterCount} parameters`,
        suggestion: 'Use parameter objects or split the function'
      });
    }

    // Calculate structural score (0-100)
    const score = Math.max(0, 100 - (
      metrics.cyclomaticComplexity * 5 +
      metrics.linesOfCode * 0.5 +
      metrics.parameterCount * 10 +
      metrics.nestingLevel * 15
    ));

    return { metrics, anomalies, score };
  }

  /**
   * Calculate dynamic weight for a function
   */
  private calculateDynamicWeight(func: FunctionInfo): {
    finalWeight: number;
    baseWeight: number;
    adjustments: Record<string, number>;
    explanation: string;
  } {
    if (!this.dynamicWeightCalculator) {
      return {
        finalWeight: 1.0,
        baseWeight: 1.0,
        adjustments: {},
        explanation: 'Dynamic weight calculator not initialized'
      };
    }

    // Create function context
    const context: FunctionContext = {
      functionId: func.id,
      layer: this.detectArchitecturalLayer(func.filePath),
      role: this.detectFunctionRole(func),
      criticality: this.detectCriticality(func),
      filePath: func.filePath,
      fanIn: 0, // Would be calculated from call graph
      fanOut: 0 // Would be calculated from call graph
    };

    // Calculate weight
    const result = this.dynamicWeightCalculator.calculateWeight(
      func.metrics?.cyclomaticComplexity || 0,
      context,
      'complexity'
    );

    return {
      finalWeight: result.finalWeight,
      baseWeight: result.baseMetric,
      adjustments: result.breakdown.appliedRules.reduce((acc, rule) => ({ ...acc, [rule.rule]: rule.multiplier }), {} as Record<string, number>),
      explanation: `Weight calculation: ${result.breakdown.appliedRules.map(r => r.reason).join(', ')}`
    };
  }

  /**
   * Detect architectural layer from file path
   */
  private detectArchitecturalLayer(filePath: string): ArchitecturalLayer {
    if (filePath.includes('/controllers/') || filePath.includes('/api/')) return 'presentation';
    if (filePath.includes('/services/') || filePath.includes('/business/')) return 'business';
    if (filePath.includes('/repositories/') || filePath.includes('/data/')) return 'data';
    if (filePath.includes('/utils/') || filePath.includes('/helpers/')) return 'utility';
    if (filePath.includes('/config/') || filePath.includes('/infrastructure/')) return 'infrastructure';
    return 'unknown';
  }

  /**
   * Detect function role based on metrics
   */
  private detectFunctionRole(func: FunctionInfo): FunctionRole {
    const complexity = func.metrics?.cyclomaticComplexity || 0;
    
    if (complexity > 15) return 'core';
    if (complexity > 8) return 'support';
    if (func.name.includes('util') || func.name.includes('helper')) return 'utility';
    return 'unknown';
  }

  /**
   * Detect criticality from function context
   */
  private detectCriticality(func: FunctionInfo): CriticalityLevel {
    // Simple heuristic - could be enhanced with JSDoc parsing
    if (func.name.includes('critical') || func.name.includes('security')) return 'Critical';
    if (func.name.includes('important') || func.name.includes('core')) return 'Important';
    if (func.name.includes('util') || func.name.includes('helper')) return 'Low';
    return 'Normal';
  }

  /**
   * Evaluate risk for a function
   */
  private evaluateRisk(func: FunctionInfo, _structuralMetrics: StructuralMetrics): {
    level: 'low' | 'medium' | 'high' | 'critical';
    score: number;
    violations: QualityViolation[];
    zScores: Record<string, number>;
  } {
    const violations: QualityViolation[] = [];
    const zScores: Record<string, number> = {};
    
    const metrics = func.metrics || this.getDefaultMetrics();
    
    // Calculate Z-scores for key metrics
    zScores['complexity'] = this.calculateZScore(metrics.cyclomaticComplexity, 5, 3);
    zScores['linesOfCode'] = this.calculateZScore(metrics.linesOfCode, 25, 15);
    zScores['parameters'] = this.calculateZScore(metrics.parameterCount, 3, 2);

    // Check for violations
    if (metrics.cyclomaticComplexity > 10) {
      violations.push({
        metric: 'cyclomaticComplexity',
        value: metrics.cyclomaticComplexity,
        threshold: 10,
        zScore: zScores['complexity'],
        severity: metrics.cyclomaticComplexity > 15 ? 'critical' : 'warning',
        suggestion: 'Consider breaking down this complex function'
      });
    }

    if (metrics.linesOfCode > 50) {
      violations.push({
        metric: 'linesOfCode',
        value: metrics.linesOfCode,
        threshold: 50,
        zScore: zScores['linesOfCode'],
        severity: metrics.linesOfCode > 100 ? 'critical' : 'warning',
        suggestion: 'Consider splitting this long function'
      });
    }

    // Calculate overall risk score and level
    const riskScore = Math.max(
      Math.abs(zScores['complexity']),
      Math.abs(zScores['linesOfCode']),
      Math.abs(zScores['parameters'])
    );

    let level: 'low' | 'medium' | 'high' | 'critical';
    if (riskScore < 1) level = 'low';
    else if (riskScore < 2) level = 'medium';
    else if (riskScore < 3) level = 'high';
    else level = 'critical';

    return { level, score: riskScore, violations, zScores };
  }

  /**
   * Calculate Z-score for a metric
   */
  private calculateZScore(value: number, mean: number, stdDev: number): number {
    return (value - mean) / stdDev;
  }

  /**
   * Evaluate quality gate for a function
   */
  private async evaluateQualityGate(func: FunctionInfo): Promise<QualityAssessment> {
    // Simplified quality gate evaluation
    const metrics = func.metrics || this.getDefaultMetrics();
    
    const score = Math.max(0, 100 - (
      metrics.cyclomaticComplexity * 5 +
      Math.max(0, metrics.linesOfCode - 25) * 1 +
      Math.max(0, metrics.parameterCount - 3) * 10
    ));

    return {
      acceptable: score >= 70,
      qualityScore: score,
      violations: [],
      structuralScore: score,
      structuralAnomalies: [],
      structuralMetrics: undefined,
      improvementInstruction: score < 70 ? 'Consider reducing complexity and function size' : undefined,
      responseTime: 1
    };
  }

  /**
   * Calculate project-level metrics
   */
  private calculateProjectMetrics(result: AdvancedAssessmentResult): void {
    const scores = result.functionResults.map(f => f.qualityGate.qualityScore || 0);
    const riskLevels = result.functionResults.map(f => f.risk.level);
    
    // Calculate overall score
    result.projectAssessment.overallScore = scores.length > 0 
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length 
      : 0;

    // Calculate risk distribution
    result.projectAssessment.riskDistribution = {
      low: riskLevels.filter(l => l === 'low').length,
      medium: riskLevels.filter(l => l === 'medium').length,
      high: riskLevels.filter(l => l === 'high').length,
      critical: riskLevels.filter(l => l === 'critical').length
    };

    // Assign quality grade
    const score = result.projectAssessment.overallScore;
    if (score >= 90) result.projectAssessment.qualityGrade = 'A';
    else if (score >= 80) result.projectAssessment.qualityGrade = 'B';
    else if (score >= 70) result.projectAssessment.qualityGrade = 'C';
    else if (score >= 60) result.projectAssessment.qualityGrade = 'D';
    else result.projectAssessment.qualityGrade = 'F';

    // Calculate structural health
    const structuralScores = result.functionResults.map(f => f.structural.score);
    result.projectAssessment.structuralHealth = structuralScores.length > 0
      ? structuralScores.reduce((sum, score) => sum + score, 0) / structuralScores.length
      : 0;

    // Calculate structural summary
    const allAnomalies = result.functionResults.flatMap(f => f.structural.anomalies);
    result.structuralSummary.totalAnomalies = allAnomalies.length;
    result.structuralSummary.criticalAnomalies = allAnomalies.filter(a => a.severity === 'critical').length;
    
    // Count anomaly types
    const anomalyTypes: Record<string, number> = {};
    allAnomalies.forEach(anomaly => {
      const anomalyType = anomaly.metric;
      anomalyTypes[anomalyType] = (anomalyTypes[anomalyType] || 0) + 1;
    });
    result.structuralSummary.anomalyTypes = anomalyTypes;
    result.structuralSummary.structuralScore = result.projectAssessment.structuralHealth;
  }

  /**
   * Generate improvement recommendations
   */
  private generateRecommendations(result: AdvancedAssessmentResult): string[] {
    const recommendations: string[] = [];
    
    // Risk-based recommendations
    const { riskDistribution } = result.projectAssessment;
    if (riskDistribution.critical > 0) {
      recommendations.push(`🚨 Address ${riskDistribution.critical} critical risk functions immediately`);
    }
    if (riskDistribution.high > 5) {
      recommendations.push(`⚠️ Consider refactoring ${riskDistribution.high} high-risk functions`);
    }

    // Structural recommendations
    const { structuralSummary } = result;
    if (structuralSummary.criticalAnomalies > 0) {
      recommendations.push(`🏗️ Fix ${structuralSummary.criticalAnomalies} critical structural issues`);
    }

    // Score-based recommendations
    const score = result.projectAssessment.overallScore;
    if (score < 70) {
      recommendations.push('📈 Overall code quality needs improvement - focus on reducing complexity');
    }
    if (score < 50) {
      recommendations.push('🔧 Consider implementing code review processes and refactoring strategies');
    }

    return recommendations;
  }

  /**
   * Create batches of functions for processing
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Get default metrics for functions without metrics
   */
  private getDefaultMetrics(): QualityMetrics {
    return {
      linesOfCode: 0,
      totalLines: 0,
      cyclomaticComplexity: 1,
      cognitiveComplexity: 0,
      maxNestingLevel: 0,
      parameterCount: 0,
      returnStatementCount: 0,
      branchCount: 0,
      loopCount: 0,
      tryCatchCount: 0,
      asyncAwaitCount: 0,
      callbackCount: 0,
      commentLines: 0,
      codeToCommentRatio: 0
    };
  }
}