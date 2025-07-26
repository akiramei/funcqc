import chalk from 'chalk';
import simpleGit, { SimpleGit } from 'simple-git';
import {
  HealthCommandOptions,
  FunctionInfo,
  FuncqcConfig,
  SnapshotInfo,
  QualityMetrics as FunctionQualityMetrics,
  QualityThresholds,
  ProjectStatistics,
  FunctionRiskAssessment,
  MetricStatistics,
} from '../../types';
// TypeScript import removed - AST analysis moved to domain layer
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { resolveSnapshotId } from '../../utils/snapshot-resolver';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { ThresholdEvaluator } from '../../utils/threshold-evaluator';
import { StatisticalEvaluator } from '../../utils/statistical-evaluator';
import { 
  generateRecommendedActions
} from '../../domain/health-analysis-logic';

interface TrendData {
  period: string;
  snapshots: SnapshotInfo[];
  avgComplexity: number;
  totalFunctions: number;
  highRiskCount: number;
  qualityScore: number;
  // NEW: Enhanced trend tracking
  healthIndex?: number;
  structuralDanger?: number;
  trend: 'improving' | 'stable' | 'degrading';
}

interface TrendAnalysis {
  periods: TrendData[];
  overallTrend: 'improving' | 'stable' | 'degrading';
  keyInsights: string[];
  recommendations: string[];
}

// ThresholdEvaluatorベースのリスク評価設定
const DEFAULT_RISK_CONFIG = {
  violationWeights: { warning: 1, error: 5, critical: 25 },
  compositeScoringMethod: 'weighted' as const,
};

interface RecommendedAction {
  priority: number;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  riskScore: number;
  action: string;
  suggestions: string[];
  metrics: {
    cyclomaticComplexity: number;
    linesOfCode: number;
  };
}

interface HealthData {
  status: 'success' | 'no-data';
  message?: string;
  snapshot?: {
    id: string;
    createdAt: string;
    totalFunctions: number;
  };
  quality?: {
    overallGrade: string;
    overallScore: number;
    // NEW: Integrated health scoring
    healthIndex?: number;
    healthGrade?: string;
    structuralDanger?: number;
    highRiskRate?: number;
    criticalViolationRate?: number;
    averageRiskScore?: number;
    complexity: {
      grade: string;
      score: number;
    };
    maintainability: {
      grade: string;
      score: number;
    };
    size: {
      grade: string;
      score: number;
    };
  };
  risk?: {
    distribution: RiskDistribution;
    percentages: {
      high: number;
      medium: number;
      low: number;
      critical: number;
    };
    averageRiskScore?: number;
    highestRiskFunction?: {
      name: string;
      riskScore: number;
      location: string;
    } | undefined;
  };
  git?: unknown;
  recommendations?: RecommendedAction[] | undefined;
}

// NEW: Risk distribution type
interface RiskDistribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

/**
 * Health command as a Reader function
 * Uses shared storage and config from environment
 */
export const healthCommand: VoidCommand<HealthCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.log('🔍 Analyzing project health...');
      
      await executeHealthCommand(env, options);
    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Health analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

async function executeHealthCommand(env: CommandEnvironment, options: HealthCommandOptions): Promise<void> {
  // Force JSON mode if --json flag is present in command line
  // Note: Due to Reader pattern wrapper, we rely on process.argv detection
  const isJsonMode = options.json || options.aiOptimized || process.argv.includes('--json');

  // Check if diff mode is requested
  if (options.diff !== undefined) {
    await handleHealthDiffCommand(env, options, isJsonMode);
    return;
  }

  if (isJsonMode) {
    await handleJsonOutput(env, options);
  } else {
    await displayHealthOverview(env, options);

    if (options.trend) {
      await displayTrendAnalysis(env, options);
    }

    if (options.showConfig) {
      displayConfigInfo(env.config);
    }
  }
}

async function handleJsonOutput(env: CommandEnvironment, options: HealthCommandOptions): Promise<void> {
  if (options.aiOptimized) {
    env.commandLogger.warn('Warning: --ai-optimized option is deprecated. Use --json instead.');
  }

  const health = await generateHealthData(env, options);
  console.log(JSON.stringify(health, null, 2));
}

async function displayHealthOverview(
  env: CommandEnvironment,
  options: HealthCommandOptions
): Promise<void> {
  console.log(chalk.blue('funcqc Health Report'));
  console.log('-'.repeat(50));
  console.log('');

  const { snapshot: targetSnapshot, functions } = await getTargetSnapshotAndFunctions(env, options);
  
  if (!targetSnapshot) {
    console.log(chalk.yellow('📋 No snapshots found.'));
    console.log(chalk.gray('   Run `funcqc scan` to create your first snapshot.'));
    return;
  }

  // Display project overview
  console.log(chalk.yellow('Project Overview:'));
  console.log(`  Snapshot ID: ${targetSnapshot.id.substring(0, 8)}${targetSnapshot.label ? ` (${targetSnapshot.label})` : ''}`);
  console.log(`  Total Functions: ${functions.length}`);
  console.log(`  Last Analyzed: ${formatDateTime(targetSnapshot.createdAt)}`);
  console.log(`  Database: ${env.config.storage.path}`);
  console.log('');

  // Calculate quality metrics and risk assessments using ThresholdEvaluator
  const qualityData = await calculateQualityMetrics(functions, env.config);
  
  // Use new ThresholdEvaluator approach
  const thresholdEvaluator = new ThresholdEvaluator();
  const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
  
  // Calculate project statistics from function metrics
  const functionsWithMetrics = functions.filter(f => f.metrics);
  const allMetrics = functionsWithMetrics.map(f => f.metrics!);
  
  const statisticalEvaluator = new StatisticalEvaluator();
  const projectStats = statisticalEvaluator.calculateProjectStatistics(allMetrics);

  const riskAssessments = await assessAllFunctions(functions, projectStats, thresholds);
  const riskCounts = calculateRiskDistribution(riskAssessments);
  const enhancedRiskStats = calculateEnhancedRiskStats(riskAssessments, functions);
  
  // NEW: Enhanced integrated health display
  console.log(chalk.green.bold('🧪 Overall Health Index: ') + 
    chalk.white.bold(`${qualityData.healthIndex}/100 (${qualityData.healthGrade})`));
  console.log('');
  
  // Display integrated insights
  console.log(chalk.yellow('📊 Health Breakdown:'));
  console.log(`  ├── Traditional Grade: ${qualityData.overallGrade} (${qualityData.overallScore}/100)`);
  console.log(`  ├── High Risk Function Rate: ${qualityData.highRiskRate || 0}% ${(qualityData.highRiskRate || 0) > 5 ? chalk.red('(Poor)') : chalk.green('(Good)')}`);
  console.log(`  ├── Critical Violation Rate: ${qualityData.criticalViolationRate || 0}% ${(qualityData.criticalViolationRate || 0) > 1 ? chalk.red('(High)') : chalk.green('(Low)')}`);
  console.log(`  └── Structural Danger Score: ${qualityData.structuralDanger}/100`);
  console.log('');

  console.log(chalk.yellow('📈 Component Scores:'));
  console.log(`  ├── Complexity: ${qualityData.complexityGrade} (${qualityData.complexityScore}/100)`);
  console.log(`  ├── Maintainability: ${qualityData.maintainabilityGrade} (${qualityData.maintainabilityScore}/100)`);
  console.log(`  └── Code Size: ${qualityData.sizeGrade} (${qualityData.sizeScore}/100)`);
  console.log('');

  // Enhanced Risk Analysis with clearer context
  console.log(chalk.yellow('⚠️  Risk Analysis:'));
  console.log(`  ├── Average Risk Score: ${enhancedRiskStats.average.toFixed(1)} (${getRiskDescription(enhancedRiskStats.average)})`);
  console.log(`  ├── Median Risk Score: ${enhancedRiskStats.median.toFixed(1)} (${getRiskDescription(enhancedRiskStats.median)})`);
  console.log(`  ├── P90 Risk Score: ${enhancedRiskStats.p90.toFixed(1)} (${getRiskDescription(enhancedRiskStats.p90)})`);
  console.log(`  └── Risk/LOC Ratio: ${enhancedRiskStats.normalizedByLOC.toFixed(3)} (size-normalized)`);
  console.log('');

  // Risk distribution with visual indicators
  const totalFunctions = functions.length;
  const highPct = ((riskCounts.high / totalFunctions) * 100).toFixed(1);
  const mediumPct = ((riskCounts.medium / totalFunctions) * 100).toFixed(1);
  const lowPct = ((riskCounts.low / totalFunctions) * 100).toFixed(1);
  
  console.log(chalk.yellow('🎯 Risk Distribution:'));
  console.log(`  ├── ${chalk.red('High Risk')}: ${riskCounts.high} functions (${highPct}%) ${riskCounts.high > 0 ? '⚠️' : '✅'}`);
  console.log(`  ├── ${chalk.yellow('Medium Risk')}: ${riskCounts.medium} functions (${mediumPct}%)`);
  console.log(`  └── ${chalk.green('Low Risk')}: ${riskCounts.low} functions (${lowPct}%) ✅`);
  
  // NEW: Add recommendation based on risk distribution
  if (riskCounts.high > 0) {
    console.log('');
    console.log(chalk.red.bold('💡 Recommendation: ') + 
      `Focus on refactoring the ${riskCounts.high} high-risk functions to improve structural health.`);
  }
  console.log('');

  // Show top risks if any
  if (riskCounts.high > 0) {
    console.log(chalk.yellow.bold('🔍 Top High-Risk Functions:'));
    await displayTopRisks(env, functions, enhancedRiskStats, Boolean(options.verbose));
  } else {
    console.log(chalk.green('✅ No high-risk functions detected!'));
  }

  // Git status
  await displayGitStatus();
}

async function displayTrendAnalysis(
  env: CommandEnvironment,
  options: HealthCommandOptions
): Promise<void> {
  console.log(chalk.blue('funcqc Trend Analysis'));
  console.log('-'.repeat(50));
  console.log('');

  const period = determinePeriod(options);
  const analysis = await calculateTrendAnalysis(env, period);

  if (analysis.periods.length < 2) {
    console.log(chalk.yellow('📊 Not enough data for trend analysis.'));
    console.log(chalk.gray('   Need at least 2 snapshots to analyze trends.'));
    return;
  }

  console.log(chalk.yellow(`📈 Overall Trend (${period} days): ${getTrendIcon(analysis.overallTrend)} ${analysis.overallTrend}`));
  console.log('');

  // Display period data
  analysis.periods.forEach((periodData, index) => {
    const trendIcon = getTrendIcon(periodData.trend);
    console.log(`  ${chalk.bold(periodData.period)}: ${trendIcon} ${periodData.trend}`);
    console.log(`    Functions: ${periodData.totalFunctions}, Avg CC: ${periodData.avgComplexity.toFixed(1)}, High Risk: ${periodData.highRiskCount}`);
    if (index < analysis.periods.length - 1) console.log('');
  });

  console.log('');

  // Key insights
  if (analysis.keyInsights.length > 0) {
    console.log(chalk.yellow('🔍 Key Insights:'));
    analysis.keyInsights.forEach(insight => {
      console.log(`  • ${insight}`);
    });
    console.log('');
  }

  // Recommendations
  if (analysis.recommendations.length > 0) {
    console.log(chalk.yellow('💡 Recommendations:'));
    analysis.recommendations.forEach(recommendation => {
      console.log(`  • ${recommendation}`);
    });
  }
}

function determinePeriod(options: HealthCommandOptions): number {
  if (options.period) {
    const parsed = parseInt(options.period, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid period: ${options.period}. Must be a positive number.`);
    }
    return parsed;
  }
  return 7; // Default to 7 days
}

/**
 * Gets the target snapshot and its functions based on options.
 * If snapshot option is provided, resolve and use that specific snapshot.
 * Otherwise, use the latest snapshot.
 */
async function getTargetSnapshotAndFunctions(
  env: CommandEnvironment, 
  options: HealthCommandOptions
): Promise<{ snapshot: SnapshotInfo | null; functions: FunctionInfo[] }> {
  let targetSnapshot: SnapshotInfo | null = null;
  
  if (options.snapshot) {
    // Resolve specific snapshot
    const snapshotId = await resolveSnapshotId(env, options.snapshot);
    if (!snapshotId) {
      throw new Error(`Snapshot not found: ${options.snapshot}`);
    }
    targetSnapshot = await env.storage.getSnapshot(snapshotId);
    if (!targetSnapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
  } else {
    // Use latest snapshot for the specified scope
    const snapshotOptions: { limit: number; scope?: string } = { limit: 1 };
    
    if (options.scope) {
      snapshotOptions.scope = options.scope;
    }
    
    const snapshots = await env.storage.getSnapshots(snapshotOptions);
    if (snapshots.length > 0) {
      targetSnapshot = snapshots[0];
    }
  }
  
  if (!targetSnapshot) {
    return { snapshot: null, functions: [] };
  }
  
  const functions = await env.storage.getFunctions(targetSnapshot.id);
  return { snapshot: targetSnapshot, functions };
}

async function generateHealthData(env: CommandEnvironment, options: HealthCommandOptions): Promise<HealthData> {
  const { snapshot: targetSnapshot, functions } = await getTargetSnapshotAndFunctions(env, options);
  
  if (!targetSnapshot) {
    return {
      status: 'no-data',
      message: 'No snapshots found. Run `funcqc scan` to create your first snapshot.',
    };
  }

  // ThresholdEvaluatorベースのリスク評価を実行（JSON用でも正しい統計を使用）
  const thresholdEvaluator = new ThresholdEvaluator();
  const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
  
  // Calculate project statistics from function metrics
  const functionsWithMetrics = functions.filter(f => f.metrics);
  const allMetrics = functionsWithMetrics.map(f => f.metrics!);
  
  const statisticalEvaluator = new StatisticalEvaluator();
  const projectStats = statisticalEvaluator.calculateProjectStatistics(allMetrics);

  const riskAssessments = await assessAllFunctions(functions, projectStats, thresholds);
  const qualityData = await calculateQualityMetrics(functions, env.config);
  
  // Generate recommendations and risk details using new approach
  const { recommendations, riskDetails } = await generateRiskAnalysis(
    riskAssessments, functions, options.risks
  );

  return {
    status: 'success',
    snapshot: {
      id: targetSnapshot.id,
      createdAt: new Date(targetSnapshot.createdAt).toISOString(),
      totalFunctions: functions.length,
    },
    quality: {
      overallGrade: qualityData.overallGrade,
      overallScore: qualityData.overallScore,
      // NEW: Enhanced health metrics
      healthIndex: qualityData.healthIndex,
      healthGrade: qualityData.healthGrade!,
      structuralDanger: qualityData.structuralDanger,
      highRiskRate: qualityData.highRiskRate!,
      criticalViolationRate: qualityData.criticalViolationRate!,
      averageRiskScore: riskDetails.averageRiskScore,
      complexity: {
        grade: qualityData.complexityGrade,
        score: qualityData.complexityScore,
      },
      maintainability: {
        grade: qualityData.maintainabilityGrade,
        score: qualityData.maintainabilityScore,
      },
      size: {
        grade: qualityData.sizeGrade,
        score: qualityData.sizeScore,
      },
    },
    risk: riskDetails,
    recommendations: recommendations,
  };
}

/**
 * ThresholdEvaluatorを使用して全関数のリスク評価を実行
 */
async function assessAllFunctions(
  functions: FunctionInfo[],
  projectStats: ProjectStatistics,
  thresholds: QualityThresholds
): Promise<FunctionRiskAssessment[]> {
  const thresholdEvaluator = new ThresholdEvaluator();
  
  return functions
    .filter((f): f is FunctionInfo & { metrics: FunctionQualityMetrics } => 
      f.metrics !== undefined
    )
    .map(fn => {
      const violations = thresholdEvaluator.evaluateFunctionThresholds(
        fn.metrics,
        thresholds,
        projectStats
      );
      return thresholdEvaluator.assessFunctionRisk(
        fn.id,
        fn.name,
        fn.filePath,
        fn.startLine,
        fn.endLine,
        fn.metrics,
        violations,
        DEFAULT_RISK_CONFIG
      );
    });
}

/**
 * 平均リスクスコアを計算（関数数で正規化）
 */
function calculateAverageRiskScore(riskAssessments: FunctionRiskAssessment[]): number {
  if (riskAssessments.length === 0) return 0;
  
  const totalRiskScore = riskAssessments.reduce((sum, assessment) => sum + assessment.riskScore, 0);
  return totalRiskScore / riskAssessments.length;
}

/**
 * Calculate enhanced risk statistics including median, P90, and normalized metrics
 */
function calculateEnhancedRiskStats(
  riskAssessments: FunctionRiskAssessment[],
  functions: FunctionInfo[]
): {
  average: number;
  median: number;
  p90: number;
  normalizedByLOC: number;
  criticalCount: number;
  highRiskCount: number;
} {
  if (riskAssessments.length === 0) {
    return {
      average: 0,
      median: 0,
      p90: 0,
      normalizedByLOC: 0,
      criticalCount: 0,
      highRiskCount: 0,
    };
  }

  // Calculate basic statistics
  const riskScores = riskAssessments.map(a => a.riskScore).sort((a, b) => a - b);
  const totalRisk = riskScores.reduce((sum, score) => sum + score, 0);
  const average = totalRisk / riskScores.length;

  // Median calculation
  const n = riskScores.length;
  const median = n % 2 === 0 
    ? (riskScores[n / 2 - 1] + riskScores[n / 2]) / 2
    : riskScores[Math.floor(n / 2)];

  // P90 calculation
  const p90Index = Math.floor(n * 0.9);
  const p90 = riskScores[p90Index];

  // LOC normalization
  const totalLOC = functions
    .map(f => f.metrics?.linesOfCode || 0)
    .reduce((sum, loc) => sum + loc, 0);
  const normalizedByLOC = totalLOC > 0 ? totalRisk / totalLOC : 0;

  // Count critical violations and high-risk functions
  const criticalCount = riskAssessments
    .flatMap(a => a.violations)
    .filter(v => v.level === 'critical').length;
  
  const highRiskCount = riskAssessments
    .filter(a => a.riskLevel === 'high').length;

  return {
    average,
    median,
    p90,
    normalizedByLOC,
    criticalCount,
    highRiskCount,
  };
}

/**
 * Calculate risk distribution from assessments
 */
function calculateRiskDistribution(riskAssessments: FunctionRiskAssessment[]): RiskDistribution {
  const distribution: RiskDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
  
  riskAssessments.forEach(assessment => {
    switch (assessment.riskLevel) {
      case 'low':
        distribution.low++;
        break;
      case 'medium':
        distribution.medium++;
        break;
      case 'high':
        distribution.high++;
        break;
      case 'critical':
        distribution.critical++;
        break;
    }
  });
  
  return distribution;
}

/**
 * Create empty metrics record
 */
function createEmptyMetricsRecord(): Record<keyof FunctionQualityMetrics, MetricStatistics> {
  const emptyMetricStats: MetricStatistics = {
    min: 0,
    max: 0,
    mean: 0,
    median: 0,
    standardDeviation: 0,
    variance: 0,
    p90: 0,
    p95: 0,
    percentiles: {
      p25: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
    },
    mad: 0,
  };

  return {
    linesOfCode: emptyMetricStats,
    totalLines: emptyMetricStats,
    cyclomaticComplexity: emptyMetricStats,
    cognitiveComplexity: emptyMetricStats,
    maxNestingLevel: emptyMetricStats,
    parameterCount: emptyMetricStats,
    returnStatementCount: emptyMetricStats,
    branchCount: emptyMetricStats,
    loopCount: emptyMetricStats,
    tryCatchCount: emptyMetricStats,
    asyncAwaitCount: emptyMetricStats,
    callbackCount: emptyMetricStats,
    commentLines: emptyMetricStats,
    codeToCommentRatio: emptyMetricStats,
    halsteadVolume: emptyMetricStats,
    halsteadDifficulty: emptyMetricStats,
    maintainabilityIndex: emptyMetricStats,
  };
}

/**
 * Create empty ProjectStatistics for cases with no metrics
 */
function createEmptyProjectStatistics(functionCount: number): ProjectStatistics {
  const emptyMetricStats: MetricStatistics = {
    min: 0,
    max: 0,
    mean: 0,
    median: 0,
    standardDeviation: 0,
    variance: 0,
    p90: 0,
    p95: 0,
    percentiles: {
      p25: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
    },
    mad: 0,
  };

  return {
    totalFunctions: functionCount,
    analysisTimestamp: Date.now(),
    averageComplexity: 0,
    averageSize: 0,
    medianComplexity: 0,
    p90Complexity: 0,
    complexityDistribution: emptyMetricStats,
    sizeDistribution: emptyMetricStats,
    riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
    metrics: createEmptyMetricsRecord(),
  };
}

/**
 * ThresholdEvaluatorベースのリスク分析を生成
 */
async function generateRiskAnalysis(
  riskAssessments: FunctionRiskAssessment[],
  functions: FunctionInfo[],
  includeRisks: boolean = false
): Promise<{ recommendations: RecommendedAction[] | undefined; riskDetails: {
  distribution: RiskDistribution;
  percentages: { high: number; medium: number; low: number; critical: number; };
  averageRiskScore: number;
  highestRiskFunction?: { name: string; riskScore: number; location: string; } | undefined;
} }> {
  const distribution = calculateRiskDistribution(riskAssessments);
  const averageRiskScore = calculateAverageRiskScore(riskAssessments);
  
  const baseRiskDetails = {
    distribution,
    percentages: {
      high: functions.length > 0 ? (distribution.high / functions.length) * 100 : 0,
      medium: functions.length > 0 ? (distribution.medium / functions.length) * 100 : 0,
      low: functions.length > 0 ? (distribution.low / functions.length) * 100 : 0,
      critical: functions.length > 0 ? (distribution.critical / functions.length) * 100 : 0,
    },
    averageRiskScore,
  };

  if (!includeRisks) {
    return { recommendations: undefined, riskDetails: baseRiskDetails };
  }

  try {
    const recommendations = generateRecommendedActions(riskAssessments, functions);
    
    // 最高リスク関数を見つける
    const highestRiskAssessment = riskAssessments
      .sort((a, b) => b.riskScore - a.riskScore)[0];
    
    const highestRiskFunction = highestRiskAssessment && functions.find(f => f.id === highestRiskAssessment.functionId);
    
    const riskDetails = {
      ...baseRiskDetails,
      highestRiskFunction: highestRiskFunction ? {
        name: highestRiskFunction.displayName,
        riskScore: Math.round(highestRiskAssessment.riskScore),
        location: `${highestRiskFunction.filePath}:${highestRiskFunction.startLine}`,
      } : undefined,
    };
    
    return { recommendations, riskDetails };
  } catch {
    // エラーが発生した場合は基本的なリスク詳細のみを返す
    return { recommendations: undefined, riskDetails: baseRiskDetails };
  }
}

// Recommended actions generation moved to domain layer for architectural compliance

// Analysis functions moved to domain layer for architectural compliance

// AST analysis functions moved to domain layer for architectural compliance

// Thresholds moved to domain layer for architectural compliance

// Enhanced suggestions function moved to domain layer for architectural compliance

// All metric analysis functions moved to domain layer for architectural compliance


/**
 * Enhanced quality metrics calculation with integrated risk assessment
 * Addresses the contradiction between Grade and Risk evaluations
 */
async function calculateQualityMetrics(functions: FunctionInfo[], _config: FuncqcConfig) {
  if (functions.length === 0) {
    return {
      overallGrade: 'N/A',
      overallScore: 0,
      healthIndex: 0,
      complexityGrade: 'N/A',
      complexityScore: 0,
      maintainabilityGrade: 'N/A',
      maintainabilityScore: 0,
      sizeGrade: 'N/A',
      sizeScore: 0,
      averageRiskScore: 0,
      riskDescription: 'No functions',
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      structuralDanger: 0,
    };
  }

  // Simple quality calculation based on metrics
  const metricsData = functions.filter(f => f.metrics).map(f => f.metrics!);
  
  if (metricsData.length === 0) {
    return {
      overallGrade: 'N/A',
      overallScore: 0,
      healthIndex: 0,
      complexityGrade: 'N/A',
      complexityScore: 0,
      maintainabilityGrade: 'N/A',
      maintainabilityScore: 0,
      sizeGrade: 'N/A',
      sizeScore: 0,
      averageRiskScore: 0,
      riskDescription: 'No metrics available',
      riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
      structuralDanger: 0,
    };
  }

  // Calculate risk assessments for integrated scoring
  const statisticalEvaluator = new StatisticalEvaluator();
  const projectStats = statisticalEvaluator.calculateProjectStatistics(metricsData);
  const thresholdEvaluator = new ThresholdEvaluator();
  const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
  const riskAssessments = await assessAllFunctions(functions, projectStats, thresholds);

  // Calculate averages for traditional scores
  const avgComplexity = metricsData.reduce((sum, m) => sum + m.cyclomaticComplexity, 0) / metricsData.length;
  const avgLoc = metricsData.reduce((sum, m) => sum + m.linesOfCode, 0) / metricsData.length;
  const avgMaintainability = metricsData.reduce((sum, m) => sum + (m.maintainabilityIndex || 50), 0) / metricsData.length;

  // Traditional scoring (higher is better)
  const complexityScore = Math.max(0, 100 - (avgComplexity * 10));
  const sizeScore = Math.max(0, 100 - (avgLoc * 2));
  const maintainabilityScore = avgMaintainability;
  const traditionalOverallScore = (complexityScore + sizeScore + maintainabilityScore) / 3;

  // NEW: Calculate risk distribution and structural danger
  const riskDistribution = calculateRiskDistribution(riskAssessments);
  const highRiskRate = (riskDistribution.high + riskDistribution.critical) / functions.length;
  const criticalViolationRate = riskAssessments
    .flatMap(a => a.violations)
    .filter(v => v.level === 'critical').length / functions.length;
  
  // NEW: Integrated Health Index - balanced realistic assessment
  const structuralDanger = (highRiskRate * 50) + (criticalViolationRate * 100);
  
  // Balanced penalty system for realistic but fair health assessment
  const riskPenalty = highRiskRate * 120;      // Moderate penalty: 9% = 10.8 point penalty
  const criticalPenalty = criticalViolationRate * 80;   // Moderate penalty: 9% = 7.2 point penalty
  
  const healthIndex = Math.max(0, Math.min(100, 
    traditionalOverallScore * 0.7 -  // Traditional metrics (70%, base score)
    riskPenalty -                     // High risk penalty (moderate)
    criticalPenalty +                 // Critical violations penalty (moderate)
    (avgMaintainability > 70 ? (avgMaintainability - 70) * 0.15 : 0)  // Small maintainability bonus
  ));

  const averageRiskScore = calculateAverageRiskScore(riskAssessments);

  return {
    // Traditional scores (for backward compatibility)
    overallGrade: getGradeFromScore(traditionalOverallScore),
    overallScore: Math.round(traditionalOverallScore),
    
    // NEW: Integrated health scoring
    healthIndex: Math.round(healthIndex * 100) / 100,
    healthGrade: getGradeFromScore(healthIndex),
    
    // Component scores
    complexityGrade: getGradeFromScore(complexityScore),
    complexityScore: Math.round(complexityScore),
    maintainabilityGrade: getGradeFromScore(maintainabilityScore),
    maintainabilityScore: Math.round(maintainabilityScore),
    sizeGrade: getGradeFromScore(sizeScore),
    sizeScore: Math.round(sizeScore),
    
    // Risk metrics
    averageRiskScore: Math.round(averageRiskScore * 100) / 100,
    riskDescription: getRiskDescription(averageRiskScore),
    riskDistribution,
    structuralDanger: Math.round(structuralDanger * 100) / 100,
    
    // NEW: Detailed risk insights
    highRiskRate: Math.round(highRiskRate * 10000) / 100, // Percentage with 2 decimals
    criticalViolationRate: Math.round(criticalViolationRate * 10000) / 100,
  };
}



async function displayTopRisks(
  _env: CommandEnvironment, 
  functions: FunctionInfo[], 
  enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>,
  verbose: boolean = false
): Promise<void> {
  // Use proper StatisticalEvaluator approach for consistency with main health display
  const statisticalEvaluator = new StatisticalEvaluator();
  const projectStats = statisticalEvaluator.calculateProjectStatistics(
    functions.map(f => f.metrics).filter(Boolean) as FunctionQualityMetrics[]
  );

  const thresholdEvaluator = new ThresholdEvaluator();
  const thresholds = thresholdEvaluator.getDefaultQualityThresholds();

  const riskAssessments = await assessAllFunctions(functions, projectStats, thresholds);
  const topRisks = riskAssessments
    .filter(assessment => assessment.riskLevel === 'high')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3);

  if (topRisks.length === 0) return;

  console.log(chalk.yellow('Risk Details:'));
  
  // Calculate actual threshold violations from risk assessments
  const allViolations = riskAssessments.flatMap(assessment => assessment.violations);
  const violationCounts = {
    critical: allViolations.filter(v => v.level === 'critical').length,
    error: allViolations.filter(v => v.level === 'error').length,
    warning: allViolations.filter(v => v.level === 'warning').length,
  };
  
  console.log(`  Threshold Violations: Critical: ${violationCounts.critical}, Error: ${violationCounts.error}, Warning: ${violationCounts.warning}`);
  
  // Calculate actual critical risk level functions (not violations count)
  const criticalRiskFunctions = riskAssessments.filter(a => a.riskLevel === 'critical').length;
  
  console.log(`  Critical Risk Functions: ${criticalRiskFunctions} (${(criticalRiskFunctions / functions.length * 100).toFixed(1)}%)`);
  console.log(`  High-Risk Functions: ${enhancedRiskStats.highRiskCount} (${(enhancedRiskStats.highRiskCount / functions.length * 100).toFixed(1)}%)`);

  if (topRisks.length > 0) {
    const topRiskAssessment = topRisks[0];
    const topRiskFunction = functions.find(f => f.id === topRiskAssessment.functionId);
    
    // Find most common violation type
    const violationTypeCount = allViolations.reduce((acc, v) => {
      acc[v.metric] = (acc[v.metric] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostCommonViolation = Object.entries(violationTypeCount)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'linesOfCode';
    
    console.log(`  Highest Risk Function: ${topRiskFunction?.displayName}() (Risk: ${Math.round(topRiskAssessment.riskScore)})`);
    console.log(`    Location: ${topRiskFunction?.filePath}:${topRiskFunction?.startLine}`);
    console.log(`  Most Common Violation: ${mostCommonViolation}`);
  }
  console.log('');

  console.log(chalk.yellow('Recommended Actions:'));
  const recommendedActions = generateRecommendedActions(topRisks, functions);
  recommendedActions.forEach((action) => {
    console.log(`  ${action.priority}. ${action.functionName}() in ${action.filePath}:${action.startLine}-${action.endLine}`);
    console.log(`     Action: ${action.action}`);
    
    
    if (verbose || action.suggestions.length <= 2) {
      // Show all suggestions in verbose mode or when there are only 2 or fewer
      action.suggestions.forEach(suggestion => {
        console.log(`     - ${suggestion}`);
      });
      if (verbose && action.suggestions.length > 2) {
        console.log(`     [Verbose mode: showing all ${action.suggestions.length} recommendations]`);
      }
    } else {
      // Show first 2 suggestions with truncation message
      action.suggestions.slice(0, 2).forEach(suggestion => {
        console.log(`     - ${suggestion}`);
      });
      console.log(`     ... and ${action.suggestions.length - 2} more steps`);
      console.log(`     (Use --verbose to see all ${action.suggestions.length} recommendations)`);
    }
    console.log('');
  });
}

async function displayGitStatus(): Promise<void> {
  try {
    const git: SimpleGit = simpleGit();
    const status = await git.status();
    
    console.log(chalk.yellow('Git Status:'));
    console.log(`  Branch: ${status.current}`);
    console.log(`  Staged Files: ${status.staged.length}`);
    console.log(`  Modified Files: ${status.modified.length}`);
  } catch {
    // Ignore git errors
  }
}

function displayConfigInfo(config: FuncqcConfig): void {
  console.log(chalk.blue('Configuration Details'));
  console.log('-'.repeat(50));
  console.log('');

  console.log(chalk.yellow('Storage:'));
  console.log(`  Type: ${config.storage.type}`);
  console.log(`  Path: ${config.storage.path}`);
  console.log('');

  console.log(chalk.yellow('Thresholds:'));
  console.log(`  Complexity: ${config.metrics.complexityThreshold}`);
  console.log(`  Cognitive Complexity: ${config.metrics.cognitiveComplexityThreshold}`);
  console.log(`  Lines of Code: ${config.metrics.linesOfCodeThreshold}`);
  console.log(`  Parameters: ${config.metrics.parameterCountThreshold}`);
  console.log(`  Nesting: ${config.metrics.maxNestingLevelThreshold}`);
  console.log('');
}

async function calculateTrendAnalysis(env: CommandEnvironment, period: number): Promise<TrendAnalysis> {
  const cutoffDate = Date.now() - (period * 24 * 60 * 60 * 1000);
  const snapshots = await env.storage.getSnapshots({ 
    limit: 50, // Get more snapshots for trend analysis
  });

  const recentSnapshots = snapshots.filter(s => s.createdAt >= cutoffDate);
  
  // Group snapshots by week for analysis
  const periods: TrendData[] = [];
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < Math.ceil(period / 7); i++) {
    const weekStart = now - ((i + 1) * weekMs);
    const weekEnd = now - (i * weekMs);
    const weekSnapshots = recentSnapshots.filter(s => 
      s.createdAt >= weekStart && s.createdAt < weekEnd
    );

    if (weekSnapshots.length === 0) continue;

    const avgComplexity = weekSnapshots.reduce((sum, s) => sum + s.metadata.avgComplexity, 0) / weekSnapshots.length;
    const totalFunctions = weekSnapshots.reduce((sum, s) => sum + s.metadata.totalFunctions, 0) / weekSnapshots.length;
    const highRiskCount = weekSnapshots.reduce((sum, s) => {
      const highRisk = Object.entries(s.metadata.complexityDistribution || {})
        .filter(([complexity]) => parseInt(complexity) >= 10)
        .reduce((count, [, functions]) => count + functions, 0);
      return sum + highRisk;
    }, 0) / weekSnapshots.length;

    periods.push({
      period: `Week ${i + 1}`,
      snapshots: weekSnapshots,
      avgComplexity,
      totalFunctions: Math.round(totalFunctions),
      highRiskCount: Math.round(highRiskCount),
      qualityScore: Math.max(0, 100 - (avgComplexity * 10)),
      trend: i === 0 ? 'stable' : calculateTrend(periods[periods.length - 1]?.qualityScore || 50, Math.max(0, 100 - (avgComplexity * 10))),
    });
  }

  periods.reverse(); // Show oldest first

  const overallTrend = periods.length >= 2 
    ? calculateTrend(periods[0].qualityScore, periods[periods.length - 1].qualityScore)
    : 'stable';

  return {
    periods,
    overallTrend,
    keyInsights: generateInsights(periods),
    recommendations: generateRecommendations(periods, overallTrend),
  };
}

function calculateTrend(oldScore: number, newScore: number): 'improving' | 'stable' | 'degrading' {
  const diff = newScore - oldScore;
  if (diff > 5) return 'improving';
  if (diff < -5) return 'degrading';
  return 'stable';
}

function generateInsights(periods: TrendData[]): string[] {
  const insights: string[] = [];
  
  if (periods.length >= 2) {
    const first = periods[0];
    const last = periods[periods.length - 1];
    
    const functionChange = last.totalFunctions - first.totalFunctions;
    if (Math.abs(functionChange) > 10) {
      insights.push(`Function count ${functionChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(functionChange)} functions`);
    }

    const complexityChange = last.avgComplexity - first.avgComplexity;
    if (Math.abs(complexityChange) > 0.5) {
      insights.push(`Average complexity ${complexityChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(complexityChange).toFixed(1)}`);
    }
  }

  return insights;
}

function generateRecommendations(periods: TrendData[], trend: string): string[] {
  const recommendations: string[] = [];

  if (trend === 'degrading') {
    recommendations.push('Consider implementing stricter quality gates');
    recommendations.push('Focus on refactoring high-complexity functions');
  } else if (trend === 'improving') {
    recommendations.push('Continue current practices - quality is improving');
    recommendations.push('Consider raising quality standards for further improvement');
  } else {
    recommendations.push('Monitor for quality changes');
    recommendations.push('Consider implementing automated quality checks');
  }

  const latestPeriod = periods[periods.length - 1];
  if (latestPeriod && latestPeriod.highRiskCount > 0) {
    recommendations.push(`Address ${latestPeriod.highRiskCount} high-risk functions`);
  }

  return recommendations;
}

function getGradeFromScore(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Fair';
  if (score >= 60) return 'Poor';
  return 'Very Poor';
}

function getRiskDescription(avgRiskScore: number): string {
  // Risk score: Higher is worse (0 = no risk, higher = more risk)
  if (avgRiskScore <= 5.0) return 'Excellent - Very low risk';
  if (avgRiskScore <= 10.0) return 'Good - Low risk';
  if (avgRiskScore <= 20.0) return 'Fair - Moderate risk';
  if (avgRiskScore <= 40.0) return 'Poor - High risk';
  return 'Critical - Very high risk';
}


function getTrendIcon(trend: string): string {
  switch (trend) {
    case 'improving': return '📈';
    case 'degrading': return '📉';
    default: return '📊';
  }
}

/**
 * Format date with time for snapshot display
 * @param date Date to format
 * @returns Formatted date string with time
 */
function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

interface HealthDiffOptions {
  fromId: string;
  toId: string;
}

interface HealthMetricsComparison {
  from: {
    snapshot: SnapshotInfo;
    functions: FunctionInfo[];
    quality: QualityMetrics;
    riskDistribution: RiskDistribution;
    enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>;
  };
  to: {
    snapshot: SnapshotInfo;
    functions: FunctionInfo[];
    quality: QualityMetrics;
    riskDistribution: RiskDistribution;
    enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>;
  };
  changes: {
    qualityChange: number;
    complexityChange: number;
    maintainabilityChange: number;
    sizeChange: number;
    functionCountChange: number;
    riskDistributionChange: {
      high: number;
      medium: number;
      low: number;
    };
    riskChanges: {
      average: number;
      median: number;
      p90: number;
      normalizedByLOC: number;
      criticalCount: number;
      highRiskCount: number;
    };
    trend: 'improving' | 'stable' | 'degrading';
  };
}

interface QualityMetrics {
  overallGrade: string;
  overallScore: number;
  complexityGrade: string;
  complexityScore: number;
  maintainabilityGrade: string;
  maintainabilityScore: number;
  sizeGrade: string;
  sizeScore: number;
  averageRiskScore: number;
  riskDescription: string;
}

interface RiskDistribution {
  high: number;
  medium: number;
  low: number;
}

async function handleHealthDiffCommand(
  env: CommandEnvironment,
  options: HealthCommandOptions,
  isJsonMode: boolean
): Promise<void> {
  try {
    const diffOptions = await parseHealthDiffOptions(env, options);
    const comparison = await compareHealthMetrics(env, diffOptions);

    if (isJsonMode) {
      const jsonData = generateHealthComparisonData(comparison);
      console.log(JSON.stringify(jsonData, null, 2));
    } else {
      displayHealthComparison(comparison);
    }
  } catch (error) {
    env.commandLogger.error(`Health comparison failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function parseHealthDiffOptions(
  env: CommandEnvironment,
  options: HealthCommandOptions
): Promise<HealthDiffOptions> {
  if (options.diff === true) {
    // --diff: Compare latest with previous
    const snapshots = await env.storage.getSnapshots({ limit: 2 });
    if (snapshots.length < 2) {
      throw new Error('Need at least 2 snapshots for comparison. Run `funcqc scan` to create more snapshots.');
    }
    return {
      fromId: snapshots[1].id, // Previous snapshot
      toId: snapshots[0].id,   // Latest snapshot
    };
  }

  if (typeof options.diff === 'string') {
    const diffParts = options.diff.split(/\s+/).filter(part => part.length > 0);
    
    if (diffParts.length === 1) {
      // --diff <snapshot_id>: Compare latest with specified snapshot
      const fromId = await resolveSnapshotId(env, diffParts[0]);
      if (!fromId) {
        throw new Error(`Snapshot not found: ${diffParts[0]}`);
      }
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found for comparison');
      }
      
      return {
        fromId,
        toId: snapshots[0].id, // Latest snapshot
      };
    }
    
    if (diffParts.length === 2) {
      // --diff <id1> <id2>: Compare two specified snapshots
      const fromId = await resolveSnapshotId(env, diffParts[0]);
      const toId = await resolveSnapshotId(env, diffParts[1]);
      
      if (!fromId) {
        throw new Error(`Snapshot not found: ${diffParts[0]}`);
      }
      if (!toId) {
        throw new Error(`Snapshot not found: ${diffParts[1]}`);
      }
      
      return { fromId, toId };
    }
    
    throw new Error('Invalid diff format. Use --diff, --diff <snapshot_id>, or --diff "<id1> <id2>"');
  }
  
  throw new Error('Invalid diff option');
}

async function compareHealthMetrics(
  env: CommandEnvironment,
  diffOptions: HealthDiffOptions
): Promise<HealthMetricsComparison> {
  const { fromId, toId } = diffOptions;
  
  if (fromId === toId) {
    throw new Error('Cannot compare identical snapshots');
  }
  
  // Get snapshots and their functions
  const [fromSnapshot, toSnapshot] = await Promise.all([
    env.storage.getSnapshot(fromId),
    env.storage.getSnapshot(toId),
  ]);
  
  if (!fromSnapshot || !toSnapshot) {
    throw new Error(`Snapshot not found: ${!fromSnapshot ? fromId : toId}`);
  }
  
  const [fromFunctions, toFunctions] = await Promise.all([
    env.storage.getFunctions(fromId),
    env.storage.getFunctions(toId),
  ]);
  
  // Calculate quality metrics for both snapshots
  const fromQuality = await calculateQualityMetrics(fromFunctions, env.config);
  const toQuality = await calculateQualityMetrics(toFunctions, env.config);
  
  // Calculate risk distributions using proper StatisticalEvaluator
  const statisticalEvaluator = new StatisticalEvaluator();
  const thresholdEvaluator = new ThresholdEvaluator();
  const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
  
  // Generate proper project statistics for both snapshots
  const fromAllMetrics = fromFunctions.map(f => f.metrics).filter(Boolean) as FunctionQualityMetrics[];
  const toAllMetrics = toFunctions.map(f => f.metrics).filter(Boolean) as FunctionQualityMetrics[];
  
  const fromProjectStats = fromAllMetrics.length > 0 
    ? statisticalEvaluator.calculateProjectStatistics(fromAllMetrics)
    : createEmptyProjectStatistics(fromFunctions.length);
  
  const toProjectStats = toAllMetrics.length > 0
    ? statisticalEvaluator.calculateProjectStatistics(toAllMetrics) 
    : createEmptyProjectStatistics(toFunctions.length);
  
  const fromRiskAssessments = await assessAllFunctions(fromFunctions, fromProjectStats, thresholds);
  const toRiskAssessments = await assessAllFunctions(toFunctions, toProjectStats, thresholds);
  
  const fromRisk = calculateRiskDistribution(fromRiskAssessments);
  const toRisk = calculateRiskDistribution(toRiskAssessments);
  
  // Calculate enhanced risk statistics for both snapshots
  const fromEnhancedRiskStats = calculateEnhancedRiskStats(fromRiskAssessments, fromFunctions);
  const toEnhancedRiskStats = calculateEnhancedRiskStats(toRiskAssessments, toFunctions);
  
  // Calculate changes
  const qualityChange = toQuality.overallScore - fromQuality.overallScore;
  const complexityChange = toQuality.complexityScore - fromQuality.complexityScore;
  const maintainabilityChange = toQuality.maintainabilityScore - fromQuality.maintainabilityScore;
  const sizeChange = toQuality.sizeScore - fromQuality.sizeScore;
  const functionCountChange = toFunctions.length - fromFunctions.length;
  
  // Enhanced risk changes
  const riskChanges = {
    average: toEnhancedRiskStats.average - fromEnhancedRiskStats.average,
    median: toEnhancedRiskStats.median - fromEnhancedRiskStats.median,
    p90: toEnhancedRiskStats.p90 - fromEnhancedRiskStats.p90,
    normalizedByLOC: toEnhancedRiskStats.normalizedByLOC - fromEnhancedRiskStats.normalizedByLOC,
    criticalCount: toEnhancedRiskStats.criticalCount - fromEnhancedRiskStats.criticalCount,
    highRiskCount: toEnhancedRiskStats.highRiskCount - fromEnhancedRiskStats.highRiskCount,
  };
  
  const riskDistributionChange = {
    high: toRisk.high - fromRisk.high,
    medium: toRisk.medium - fromRisk.medium,
    low: toRisk.low - fromRisk.low,
  };
  
  // Determine trend
  let trend: 'improving' | 'stable' | 'degrading' = 'stable';
  if (qualityChange > 5) {
    trend = 'improving';
  } else if (qualityChange < -5) {
    trend = 'degrading';
  }
  
  return {
    from: {
      snapshot: fromSnapshot,
      functions: fromFunctions,
      quality: fromQuality,
      riskDistribution: fromRisk,
      enhancedRiskStats: fromEnhancedRiskStats,
    },
    to: {
      snapshot: toSnapshot,
      functions: toFunctions,
      quality: toQuality,
      riskDistribution: toRisk,
      enhancedRiskStats: toEnhancedRiskStats,
    },
    changes: {
      qualityChange,
      complexityChange,
      maintainabilityChange,
      sizeChange,
      functionCountChange,
      riskDistributionChange,
      riskChanges,
      trend,
    },
  };
}

function displayHealthComparison(comparison: HealthMetricsComparison): void {
  const { from, to, changes } = comparison;
  
  console.log(chalk.blue.bold('\n📊 Health Comparison Report\n'));
  
  // Display snapshot information
  console.log(chalk.yellow('Snapshots:'));
  console.log(`  From: ${from.snapshot.id.substring(0, 8)}${from.snapshot.label ? ` (${from.snapshot.label})` : ''} - ${formatDateTime(from.snapshot.createdAt)}`);
  console.log(`  To:   ${to.snapshot.id.substring(0, 8)}${to.snapshot.label ? ` (${to.snapshot.label})` : ''} - ${formatDateTime(to.snapshot.createdAt)}`);
  console.log('');
  
  // Overall trend
  const trendIcon = getTrendIcon(changes.trend);
  const trendColor = changes.trend === 'improving' ? chalk.green : 
                    changes.trend === 'degrading' ? chalk.red : chalk.yellow;
  console.log(chalk.yellow(`📈 Overall Trend: ${trendIcon} ${trendColor(changes.trend.toUpperCase())}`));
  console.log('');
  
  // Quality metrics comparison
  console.log(chalk.yellow('Quality Metrics:'));
  displayMetricChange('Overall', from.quality.overallGrade, from.quality.overallScore, to.quality.overallGrade, to.quality.overallScore);
  console.log('');
  
  // Details section
  console.log(chalk.yellow('  Details:'));
  displayMetricChange('    Complexity', from.quality.complexityGrade, from.quality.complexityScore, to.quality.complexityGrade, to.quality.complexityScore);
  displayMetricChange('    Maintainability', from.quality.maintainabilityGrade, from.quality.maintainabilityScore, to.quality.maintainabilityGrade, to.quality.maintainabilityScore);
  displayMetricChange('    Size', from.quality.sizeGrade, from.quality.sizeScore, to.quality.sizeGrade, to.quality.sizeScore);
  console.log('');
  
  // Enhanced Risk Analysis comparison
  console.log(chalk.yellow('Risk Analysis Changes:'));
  displayRiskMetricChange('Average Risk Score', from.enhancedRiskStats.average, to.enhancedRiskStats.average, changes.riskChanges.average);
  displayRiskMetricChange('Median Risk Score', from.enhancedRiskStats.median, to.enhancedRiskStats.median, changes.riskChanges.median);
  displayRiskMetricChange('P90 Risk Score', from.enhancedRiskStats.p90, to.enhancedRiskStats.p90, changes.riskChanges.p90);
  displayRiskMetricChange('Risk/LOC Ratio', from.enhancedRiskStats.normalizedByLOC, to.enhancedRiskStats.normalizedByLOC, changes.riskChanges.normalizedByLOC, 3);
  displayCountChange('Critical Functions', from.enhancedRiskStats.criticalCount, to.enhancedRiskStats.criticalCount, changes.riskChanges.criticalCount);
  displayCountChange('High-Risk Functions', from.enhancedRiskStats.highRiskCount, to.enhancedRiskStats.highRiskCount, changes.riskChanges.highRiskCount);
  console.log('');
  
  // Function count change
  console.log(chalk.yellow('Function Statistics:'));
  const functionIcon = changes.functionCountChange > 0 ? '📈' : changes.functionCountChange < 0 ? '📉' : '📊';
  const functionColor = changes.functionCountChange > 0 ? chalk.blue : changes.functionCountChange < 0 ? chalk.gray : chalk.white;
  console.log(`  Total Functions: ${from.functions.length} → ${to.functions.length} ${functionIcon} ${functionColor(formatChange(changes.functionCountChange))}`);
  console.log('');
  
  // Risk distribution changes
  console.log(chalk.yellow('Risk Distribution Changes:'));
  displayRiskChange('High Risk', from.riskDistribution.high, to.riskDistribution.high, changes.riskDistributionChange.high);
  displayRiskChange('Medium Risk', from.riskDistribution.medium, to.riskDistribution.medium, changes.riskDistributionChange.medium);
  displayRiskChange('Low Risk', from.riskDistribution.low, to.riskDistribution.low, changes.riskDistributionChange.low);
}

function displayMetricChange(
  metricName: string, 
  fromGrade: string, 
  fromScore: number, 
  toGrade: string, 
  toScore: number
): void {
  const change = toScore - fromScore;
  const changeStr = formatChange(change);
  const changeColor = change > 0 ? chalk.green : change < 0 ? chalk.red : chalk.gray;
  
  console.log(`  ${metricName}: ${fromGrade}(${fromScore}) → ${toGrade}(${toScore}) ${changeColor(changeStr)}`);
}

function displayRiskChange(
  riskLevel: string,
  fromCount: number,
  toCount: number,
  change: number
): void {
  const changeStr = formatChange(change);
  const changeColor = change < 0 ? chalk.green : change > 0 ? chalk.red : chalk.gray; // Less risk is better
  const icon = change > 0 ? '⚠️' : change < 0 ? '✅' : '📊';
  
  console.log(`  ${riskLevel}: ${fromCount} → ${toCount} ${icon} ${changeColor(changeStr)}`);
}

function formatChange(change: number): string {
  if (change === 0) return '(no change)';
  return change > 0 ? `(+${change})` : `(${change})`;
}

function displayRiskMetricChange(label: string, fromValue: number, toValue: number, change: number, decimals: number = 1): void {
  const icon = change > 0 ? '📈' : change < 0 ? '📉' : '📊';
  const color = change > 0 ? chalk.red : change < 0 ? chalk.green : chalk.gray; // Higher risk is bad
  const fromStr = fromValue.toFixed(decimals);
  const toStr = toValue.toFixed(decimals);
  const changeStr = formatChange(Number(change.toFixed(decimals)));
  console.log(`  ${label}: ${fromStr} → ${toStr} ${icon} ${color(changeStr)}`);
}

function displayCountChange(label: string, fromValue: number, toValue: number, change: number): void {
  const icon = change > 0 ? '📈' : change < 0 ? '📉' : '📊';
  const color = change > 0 ? chalk.red : change < 0 ? chalk.green : chalk.gray; // Higher count is bad
  console.log(`  ${label}: ${fromValue} → ${toValue} ${icon} ${color(formatChange(change))}`);
}

function generateHealthComparisonData(comparison: HealthMetricsComparison): unknown {
  return {
    from: {
      snapshot: {
        id: comparison.from.snapshot.id,
        createdAt: new Date(comparison.from.snapshot.createdAt).toISOString(),
        label: comparison.from.snapshot.label ?? null,
        gitCommit: comparison.from.snapshot.gitCommit ?? null,
        gitBranch: comparison.from.snapshot.gitBranch ?? null,
      },
      totalFunctions: comparison.from.functions.length,
      quality: comparison.from.quality,
      riskDistribution: comparison.from.riskDistribution,
    },
    to: {
      snapshot: {
        id: comparison.to.snapshot.id,
        createdAt: new Date(comparison.to.snapshot.createdAt).toISOString(),
        label: comparison.to.snapshot.label ?? null,
        gitCommit: comparison.to.snapshot.gitCommit ?? null,
        gitBranch: comparison.to.snapshot.gitBranch ?? null,
      },
      totalFunctions: comparison.to.functions.length,
      quality: comparison.to.quality,
      riskDistribution: comparison.to.riskDistribution,
    },
    changes: comparison.changes,
    summary: {
      trend: comparison.changes.trend,
      qualityImprovement: comparison.changes.qualityChange > 0,
      functionCountChanged: comparison.changes.functionCountChange !== 0,
      riskReduced: comparison.changes.riskDistributionChange.high < 0,
    },
  };
}

// Analysis functions are now exported from domain layer for refactor command integration
// Import from '../../domain/health-analysis-logic' instead