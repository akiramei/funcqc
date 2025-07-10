/**
 * Real-time quality gatekeeper for AI-generated code
 * Provides immediate quality assessment with sub-20ms response time
 */

import { QualityMetrics, FunctionInfo } from '../types/index.js';
import { StreamingStats } from '../utils/streaming-stats.js';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer.js';
import { QualityCalculator } from '../metrics/quality-calculator.js';
import {
  StructuralAnalyzer,
  StructuralMetrics,
  StructuralAnomaly,
} from '../utils/structural-analyzer.js';

/**
 * Quality assessment result for real-time evaluation
 */
export interface QualityAssessment {
  /** Overall acceptability of the code */
  acceptable: boolean;
  /** Quality score (0-100) */
  qualityScore: number;
  /** Detected violations */
  violations: QualityViolation[];
  /** Structural complexity assessment */
  structuralScore: number;
  /** Structural anomalies detected */
  structuralAnomalies: StructuralAnomaly[];
  /** Structural metrics for the function */
  structuralMetrics: StructuralMetrics | undefined;
  /** Suggested improvements for AI regeneration */
  improvementInstruction: string | undefined;
  /** Response time in milliseconds */
  responseTime: number;
}

/**
 * Individual quality violation
 */
export interface QualityViolation {
  /** Metric that was violated */
  metric: keyof QualityMetrics;
  /** Actual value */
  value: number;
  /** Expected range or threshold */
  threshold: number;
  /** Z-score indicating deviation from baseline */
  zScore: number;
  /** Severity level */
  severity: 'warning' | 'critical';
  /** Human-readable suggestion */
  suggestion: string;
}

/**
 * Project baseline for adaptive thresholds
 */
export interface ProjectBaseline {
  /** Statistics for each quality metric */
  metrics: Map<keyof QualityMetrics, StreamingStats>;
  /** Structural analysis statistics */
  structuralStats: {
    avgCentrality: StreamingStats;
    callDepth: StreamingStats;
    fanOut: StreamingStats;
  };
  /** Total functions analyzed */
  totalFunctions: number;
  /** Last update timestamp */
  lastUpdated: number;
  /** Whether baseline is reliable (enough samples) */
  isReliable: boolean;
}

/**
 * Configuration for real-time quality gate
 */
export interface QualityGateConfig {
  /** Z-score threshold for warnings */
  warningThreshold: number;
  /** Z-score threshold for critical violations */
  criticalThreshold: number;
  /** Minimum functions before adaptive thresholds are used */
  minBaselineFunctions: number;
  /** Fallback to static thresholds when baseline unreliable */
  staticFallback: {
    cyclomaticComplexity: number;
    linesOfCode: number;
    cognitiveComplexity: number;
    nestingLevel: number;
    parameterCount: number;
  };
  /** Maximum analysis time before timeout (ms) */
  maxAnalysisTime: number;
}

/**
 * High-performance real-time quality gatekeeper
 *
 * Features:
 * - Sub-20ms quality assessment
 * - Adaptive thresholds based on project baseline
 * - Immediate feedback for AI code generation
 * - Structural complexity analysis
 * - Automatic improvement suggestions
 */
export class RealTimeQualityGate {
  private baseline: ProjectBaseline;
  private config: QualityGateConfig;
  private analyzer: TypeScriptAnalyzer;
  private qualityCalculator: QualityCalculator;
  private structuralAnalyzer: StructuralAnalyzer;

  constructor(config: Partial<QualityGateConfig> = {}) {
    this.config = {
      warningThreshold: 2.0,
      criticalThreshold: 3.0,
      minBaselineFunctions: 20,
      staticFallback: {
        cyclomaticComplexity: 10,
        linesOfCode: 50,
        cognitiveComplexity: 15,
        nestingLevel: 4,
        parameterCount: 5,
      },
      maxAnalysisTime: 20,
      ...config,
    };

    this.analyzer = new TypeScriptAnalyzer();
    this.qualityCalculator = new QualityCalculator();
    this.structuralAnalyzer = new StructuralAnalyzer({
      minFunctions: this.config.minBaselineFunctions,
    });

    this.baseline = this.initializeBaseline();
  }

  /**
   * Evaluate code quality in real-time
   *
   * @param code TypeScript code to evaluate
   * @param context Optional context from existing analysis
   * @returns Quality assessment with improvement suggestions
   */
  async evaluateCode(
    code: string,
    context?: { filename?: string; existingBaseline?: ProjectBaseline }
  ): Promise<QualityAssessment> {
    const startTime = performance.now();

    try {
      // Set timeout for analysis
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timeout')), this.config.maxAnalysisTime);
      });

      // Perform analysis with timeout
      const analysisPromise = this.performAnalysis(code, context?.filename || 'generated.ts');
      const result = await Promise.race([analysisPromise, timeoutPromise]);

      const responseTime = performance.now() - startTime;
      return { ...result, responseTime };
    } catch {
      const responseTime = performance.now() - startTime;

      // Return safe fallback on timeout or error
      return {
        acceptable: false,
        qualityScore: 0,
        violations: [
          {
            metric: 'linesOfCode',
            value: 0,
            threshold: 0,
            zScore: 0,
            severity: 'critical',
            suggestion: 'Analysis failed - please check code syntax',
          },
        ],
        structuralScore: 0,
        structuralAnomalies: [],
        structuralMetrics: undefined,
        improvementInstruction: 'Unable to analyze code - check for syntax errors',
        responseTime,
      };
    }
  }

  /**
   * Update project baseline with new function data
   *
   * @param functions Array of analyzed functions
   */
  updateBaseline(functions: FunctionInfo[]): void {
    for (const func of functions) {
      if (func.metrics) {
        this.updateMetricBaseline(func.metrics);
        this.baseline.totalFunctions++;
      }
    }

    // Build structural graph from functions for centrality analysis
    if (functions.length >= this.config.minBaselineFunctions) {
      this.structuralAnalyzer.buildGraph(functions);
    }

    this.baseline.lastUpdated = Date.now();
    this.baseline.isReliable = this.baseline.totalFunctions >= this.config.minBaselineFunctions;
  }

  /**
   * Get current project baseline
   */
  getBaseline(): ProjectBaseline {
    return {
      ...this.baseline,
      metrics: new Map(this.baseline.metrics),
    };
  }

  /**
   * Generate improvement instruction for AI regeneration
   *
   * @param violations Detected quality violations
   * @returns Human-readable improvement instruction
   */
  generateImprovementInstruction(
    violations: QualityViolation[],
    structuralAnomalies: StructuralAnomaly[] = []
  ): string {
    if (violations.length === 0 && structuralAnomalies.length === 0) return '';

    const instructions: string[] = [];
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    const criticalAnomalies = structuralAnomalies.filter(a => a.severity === 'critical');

    // Handle critical violations first
    for (const violation of criticalViolations) {
      switch (violation.metric) {
        case 'cyclomaticComplexity':
          instructions.push(
            `Split this function - complexity is ${violation.value} (target: <${violation.threshold})`
          );
          break;
        case 'linesOfCode':
          instructions.push(
            `Function too long (${violation.value} lines) - extract helper methods`
          );
          break;
        case 'cognitiveComplexity':
          instructions.push(`Simplify logic - cognitive complexity is ${violation.value}`);
          break;
        case 'maxNestingLevel':
          instructions.push(`Reduce nesting depth from ${violation.value} - use early returns`);
          break;
        case 'parameterCount':
          instructions.push(`Too many parameters (${violation.value}) - consider parameter object`);
          break;
        default:
          instructions.push(`Improve ${violation.metric}: ${violation.suggestion}`);
      }
    }

    // Handle critical structural anomalies
    for (const anomaly of criticalAnomalies) {
      instructions.push(anomaly.suggestion);
    }

    return instructions.slice(0, 3).join('; '); // Limit to top 3 instructions
  }

  /**
   * Calculate overall quality score
   */
  private calculateQualityScore(metrics: QualityMetrics, violations: QualityViolation[]): number {
    let score = 100;

    // Deduct points for violations
    for (const violation of violations) {
      const deduction = violation.severity === 'critical' ? 25 : 10;
      score -= deduction;
    }

    // Bonus for low complexity
    if (metrics.cyclomaticComplexity <= 3) score += 5;
    if (metrics.linesOfCode <= 20) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Perform the actual code analysis
   */
  private async performAnalysis(
    code: string,
    filename: string
  ): Promise<Omit<QualityAssessment, 'responseTime'>> {
    let functions: FunctionInfo[];

    // Check if we're analyzing a file or code string
    if (filename === 'stdin.ts' || filename === 'generated.ts') {
      // Write code to a temporary file for analysis
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');

      const tempFile = path.join(os.tmpdir(), `funcqc-temp-${Date.now()}.ts`);
      await fs.writeFile(tempFile, code, 'utf-8');

      try {
        functions = await this.analyzer.analyzeFile(tempFile);
      } finally {
        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {}); // Ignore cleanup errors
      }
    } else {
      // Analyze existing file
      functions = await this.analyzer.analyzeFile(filename);
    }

    if (functions.length === 0) {
      return {
        acceptable: true,
        qualityScore: 100,
        violations: [],
        structuralScore: 100,
        structuralAnomalies: [],
        structuralMetrics: undefined,
        improvementInstruction: undefined,
      };
    }

    // Analyze the first (main) function
    const mainFunction = functions[0];

    // Calculate quality metrics if not present
    let completeMetrics: QualityMetrics;
    if (mainFunction.metrics) {
      completeMetrics = mainFunction.metrics;
    } else {
      completeMetrics = await this.qualityCalculator.calculate(mainFunction);
    }

    // Detect violations using adaptive thresholds
    const violations = this.detectViolations(completeMetrics);

    // Perform structural analysis
    const structuralMetrics = this.structuralAnalyzer.analyzeFunction(mainFunction.id) || undefined;
    const structuralAnomalies = structuralMetrics
      ? this.structuralAnalyzer.detectAnomalies(mainFunction.id)
      : [];

    // Calculate scores
    const qualityScore = this.calculateQualityScore(completeMetrics, violations);
    const structuralScore = this.calculateStructuralScore(completeMetrics, structuralMetrics);

    // Generate improvement instruction
    const improvementInstruction =
      violations.length > 0 || structuralAnomalies.length > 0
        ? this.generateImprovementInstruction(violations, structuralAnomalies)
        : undefined;

    return {
      acceptable:
        violations.filter(v => v.severity === 'critical').length === 0 &&
        structuralAnomalies.filter(a => a.severity === 'critical').length === 0,
      qualityScore,
      violations,
      structuralScore,
      structuralAnomalies,
      structuralMetrics,
      improvementInstruction,
    };
  }

  /**
   * Detect quality violations using adaptive or static thresholds
   */
  private detectViolations(metrics: QualityMetrics): QualityViolation[] {
    const violations: QualityViolation[] = [];

    // Use adaptive thresholds if baseline is reliable
    if (this.baseline.isReliable) {
      violations.push(...this.detectAdaptiveViolations(metrics));
    } else {
      violations.push(...this.detectStaticViolations(metrics));
    }

    return violations;
  }

  /**
   * Detect violations using adaptive thresholds
   */
  private detectAdaptiveViolations(metrics: QualityMetrics): QualityViolation[] {
    const violations: QualityViolation[] = [];

    const metricEntries: [keyof QualityMetrics, number][] = [
      ['cyclomaticComplexity', metrics.cyclomaticComplexity],
      ['linesOfCode', metrics.linesOfCode],
      ['cognitiveComplexity', metrics.cognitiveComplexity || 0],
      ['maxNestingLevel', metrics.maxNestingLevel],
      ['parameterCount', metrics.parameterCount],
    ];

    for (const [metricName, value] of metricEntries) {
      const stats = this.baseline.metrics.get(metricName);
      if (stats && stats.isReliable) {
        const anomaly = stats.detectAnomaly(value);

        if (anomaly.isAnomaly) {
          violations.push({
            metric: metricName,
            value,
            threshold:
              stats.currentMean + this.config.warningThreshold * stats.currentStandardDeviation,
            zScore: anomaly.zScore,
            severity: anomaly.severity === 'critical' ? 'critical' : 'warning',
            suggestion: this.generateMetricSuggestion(metricName, value, anomaly.zScore),
          });
        }
      }
    }

    return violations;
  }

  /**
   * Detect violations using static thresholds
   */
  private detectStaticViolations(metrics: QualityMetrics): QualityViolation[] {
    const violations: QualityViolation[] = [];
    const { staticFallback } = this.config;

    if (metrics.cyclomaticComplexity > staticFallback.cyclomaticComplexity) {
      violations.push({
        metric: 'cyclomaticComplexity',
        value: metrics.cyclomaticComplexity,
        threshold: staticFallback.cyclomaticComplexity,
        zScore: 0,
        severity:
          metrics.cyclomaticComplexity > staticFallback.cyclomaticComplexity * 1.5
            ? 'critical'
            : 'warning',
        suggestion: 'Split function to reduce cyclomatic complexity',
      });
    }

    if (metrics.linesOfCode > staticFallback.linesOfCode) {
      violations.push({
        metric: 'linesOfCode',
        value: metrics.linesOfCode,
        threshold: staticFallback.linesOfCode,
        zScore: 0,
        severity: metrics.linesOfCode > staticFallback.linesOfCode * 1.5 ? 'critical' : 'warning',
        suggestion: 'Extract methods to reduce function length',
      });
    }

    return violations;
  }

  /**
   * Generate specific suggestion for a metric violation
   */
  private generateMetricSuggestion(
    metric: keyof QualityMetrics,
    _value: number,
    zScore: number
  ): string {
    const intensity = Math.abs(zScore) > 3 ? 'significantly' : 'somewhat';

    switch (metric) {
      case 'cyclomaticComplexity':
        return `Function is ${intensity} more complex than typical - consider splitting`;
      case 'linesOfCode':
        return `Function is ${intensity} longer than typical - extract helper methods`;
      case 'cognitiveComplexity':
        return `Logic is ${intensity} more complex than typical - simplify conditions`;
      case 'maxNestingLevel':
        return `Nesting is ${intensity} deeper than typical - use early returns`;
      case 'parameterCount':
        return `More parameters than typical - consider parameter object pattern`;
      default:
        return `${metric} is ${intensity} higher than project average`;
    }
  }

  /**
   * Calculate structural complexity score
   */
  private calculateStructuralScore(
    metrics: QualityMetrics,
    structuralMetrics?: StructuralMetrics
  ): number {
    // Simple structural score based on key metrics
    let score = 100;

    // Penalize high nesting
    if (metrics.maxNestingLevel > 3) {
      score -= (metrics.maxNestingLevel - 3) * 10;
    }

    // Penalize many parameters
    if (metrics.parameterCount > 4) {
      score -= (metrics.parameterCount - 4) * 8;
    }

    // Penalize low maintainability
    if (metrics.maintainabilityIndex && metrics.maintainabilityIndex < 70) {
      score -= (70 - metrics.maintainabilityIndex) / 2;
    }

    // Incorporate structural metrics if available
    if (structuralMetrics) {
      // Penalize high centrality (potential bottlenecks)
      if (structuralMetrics.betweenness > 0.1) {
        score -= structuralMetrics.betweenness * 50;
      }

      // Penalize high fan-out
      if (structuralMetrics.fanOut > 10) {
        score -= (structuralMetrics.fanOut - 10) * 3;
      }

      // Penalize deep call chains
      if (structuralMetrics.callDepth > 5) {
        score -= (structuralMetrics.callDepth - 5) * 5;
      }

      // Bonus for good clustering
      if (structuralMetrics.clustering > 0.5) {
        score += 5;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Update metrics baseline
   */
  private updateMetricBaseline(metrics: QualityMetrics): void {
    const metricEntries: [keyof QualityMetrics, number][] = [
      ['cyclomaticComplexity', metrics.cyclomaticComplexity],
      ['linesOfCode', metrics.linesOfCode],
      ['totalLines', metrics.totalLines],
      ['cognitiveComplexity', metrics.cognitiveComplexity || 0],
      ['maxNestingLevel', metrics.maxNestingLevel],
      ['parameterCount', metrics.parameterCount],
      ['returnStatementCount', metrics.returnStatementCount],
      ['branchCount', metrics.branchCount],
      ['loopCount', metrics.loopCount],
    ];

    for (const [metricName, value] of metricEntries) {
      if (!this.baseline.metrics.has(metricName)) {
        this.baseline.metrics.set(
          metricName,
          new StreamingStats({
            minSamples: this.config.minBaselineFunctions,
            anomalyThreshold: this.config.warningThreshold,
          })
        );
      }
      this.baseline.metrics.get(metricName)!.push(value);
    }
  }

  /**
   * Initialize empty baseline
   */
  private initializeBaseline(): ProjectBaseline {
    return {
      metrics: new Map(),
      structuralStats: {
        avgCentrality: new StreamingStats(),
        callDepth: new StreamingStats(),
        fanOut: new StreamingStats(),
      },
      totalFunctions: 0,
      lastUpdated: Date.now(),
      isReliable: false,
    };
  }
}
