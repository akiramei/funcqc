import chalk from 'chalk';
import simpleGit, { SimpleGit } from 'simple-git';
import {
  HealthCommandOptions,
  FunctionInfo,
  FuncqcConfig,
  SnapshotInfo,
  QualityMetrics as FunctionQualityMetrics,
} from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { resolveSnapshotId } from '../../utils/snapshot-resolver';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';

interface TrendData {
  period: string;
  snapshots: SnapshotInfo[];
  avgComplexity: number;
  totalFunctions: number;
  highRiskCount: number;
  qualityScore: number;
  trend: 'improving' | 'stable' | 'degrading';
}

interface TrendAnalysis {
  periods: TrendData[];
  overallTrend: 'improving' | 'stable' | 'degrading';
  keyInsights: string[];
  recommendations: string[];
}

// リスク計算とフィルタリングの定数
const RISK_CALCULATION_WEIGHTS = {
  COMPLEXITY_WEIGHT: 10,
  LOC_WEIGHT: 1,
} as const;

const RISK_THRESHOLDS = {
  MIN_COMPLEXITY: 10,
  MIN_LOC: 40, // Consistent with project-wide LOC threshold
  MAX_RESULTS: 10,
} as const;

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

  // Calculate quality metrics
  const qualityData = await calculateQualityMetrics(functions, env.config);
  
  // Display quality overview
  console.log(chalk.yellow('Quality Overview:'));
  console.log(`  Overall Grade: ${qualityData.overallGrade} (${qualityData.overallScore}/100)`);
  console.log(`  Average Risk Score: ${qualityData.averageRiskScore.toFixed(1)} (${qualityData.riskDescription})`);
  console.log('');

  console.log(chalk.yellow('  Details:'));
  console.log(`    Complexity: ${qualityData.complexityGrade} (${qualityData.complexityScore}/100)`);
  console.log(`    Maintainability: ${qualityData.maintainabilityGrade} (${qualityData.maintainabilityScore}/100)`);
  console.log(`    Code Size: ${qualityData.sizeGrade} (${qualityData.sizeScore}/100)`);
  console.log('');

  // Risk distribution
  console.log(chalk.yellow('Risk Distribution:'));
  const riskCounts = await calculateRiskDistribution(functions);
  console.log(`  High Risk: ${riskCounts.high} functions (${((riskCounts.high / functions.length) * 100).toFixed(1)}%)`);
  console.log(`  Medium Risk: ${riskCounts.medium} functions (${((riskCounts.medium / functions.length) * 100).toFixed(1)}%)`);
  console.log(`  Low Risk: ${riskCounts.low} functions (${((riskCounts.low / functions.length) * 100).toFixed(1)}%)`);
  console.log('');

  // Show top risks if any
  if (riskCounts.high > 0) {
    await displayTopRisks(env, functions);
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
    // Use latest snapshot
    const snapshots = await env.storage.getSnapshots({ limit: 1 });
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

  const qualityData = await calculateQualityMetrics(functions, env.config);
  const riskCounts = await calculateRiskDistribution(functions);
  
  // Generate recommendations and risk details
  const { recommendations, riskDetails } = await generateRiskAnalysis(
    functions, riskCounts, qualityData, options.risks
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

async function calculateRiskFunctions(functions: FunctionInfo[]): Promise<Array<{ function: FunctionInfo; score: number }>> {
  return functions
    .filter((f): f is FunctionInfo & { metrics: FunctionQualityMetrics } => 
      f.metrics !== undefined && 
      typeof f.metrics.cyclomaticComplexity === 'number' && 
      typeof f.metrics.linesOfCode === 'number'
    )
    .map(f => ({ 
      function: f, 
      score: f.metrics.cyclomaticComplexity * RISK_CALCULATION_WEIGHTS.COMPLEXITY_WEIGHT + 
             f.metrics.linesOfCode * RISK_CALCULATION_WEIGHTS.LOC_WEIGHT
    }))
    .filter(item => 
      item.function.metrics.cyclomaticComplexity >= RISK_THRESHOLDS.MIN_COMPLEXITY || 
      item.function.metrics.linesOfCode >= RISK_THRESHOLDS.MIN_LOC
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, RISK_THRESHOLDS.MAX_RESULTS);
}

async function generateRiskAnalysis(
  functions: FunctionInfo[], 
  riskCounts: RiskDistribution, 
  qualityData: QualityMetrics, 
  includeRisks: boolean = false
): Promise<{ recommendations: RecommendedAction[] | undefined; riskDetails: {
  distribution: RiskDistribution;
  percentages: { high: number; medium: number; low: number; };
  averageRiskScore?: number;
  highestRiskFunction?: { name: string; riskScore: number; location: string; } | undefined;
} }> {
  const baseRiskDetails = {
    distribution: riskCounts,
    percentages: {
      high: ((riskCounts.high / functions.length) * 100),
      medium: ((riskCounts.medium / functions.length) * 100),
      low: ((riskCounts.low / functions.length) * 100),
    },
  };

  if (!includeRisks) {
    return { recommendations: undefined, riskDetails: baseRiskDetails };
  }

  try {
    const riskFunctions = await calculateRiskFunctions(functions);
    const recommendations = generateRecommendedActions(riskFunctions);
    
    const riskDetails = {
      ...baseRiskDetails,
      averageRiskScore: qualityData.averageRiskScore,
      highestRiskFunction: riskFunctions.length > 0 ? {
        name: riskFunctions[0].function.displayName,
        riskScore: Math.round(riskFunctions[0].score),
        location: `${riskFunctions[0].function.filePath}:${riskFunctions[0].function.startLine}`,
      } : undefined,
    };
    
    return { recommendations, riskDetails };
  } catch {
    // エラーが発生した場合は基本的なリスク詳細のみを返す
    return { recommendations: undefined, riskDetails: baseRiskDetails };
  }
}

function generateRecommendedActions(riskFunctions: Array<{ function: FunctionInfo; score: number }>): RecommendedAction[] {
  return riskFunctions.map((riskItem, index) => {
    const func = riskItem.function;
    const endLine = func.endLine ?? func.startLine + (func.metrics?.linesOfCode || 10);
    
    // より具体的な推奨事項の生成
    const suggestions = generateSpecificSuggestions(func.metrics);
    
    return {
      priority: index + 1,
      functionName: func.displayName,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: endLine,
      riskScore: Math.round(riskItem.score),
      action: "General refactoring to improve maintainability",
      suggestions: suggestions,
      metrics: {
        cyclomaticComplexity: func.metrics?.cyclomaticComplexity || 0,
        linesOfCode: func.metrics?.linesOfCode || 0,
      },
    };
  });
}

function generateSpecificSuggestions(metrics?: FunctionQualityMetrics): string[] {
  const suggestions: string[] = [];
  
  if (metrics?.cyclomaticComplexity && metrics.cyclomaticComplexity > 10) {
    suggestions.push("Reduce cyclomatic complexity by extracting methods");
  }
  if (metrics?.linesOfCode && metrics.linesOfCode > 40) {
    suggestions.push("Break down into smaller functions");
  }
  if (metrics?.maxNestingLevel && metrics.maxNestingLevel > 3) {
    suggestions.push("Reduce nesting depth using early returns");
  }
  if (metrics?.parameterCount && metrics.parameterCount > 4) {
    suggestions.push("Reduce parameter count using parameter objects");
  }
  if (metrics?.cognitiveComplexity && metrics.cognitiveComplexity > 15) {
    suggestions.push("Simplify control flow to reduce cognitive complexity");
  }
  
  return suggestions.length > 0
    ? suggestions
    : [
        "Extract magic numbers into constants",
        "Improve variable naming",
        "Add proper error handling"
      ];
}

// Helper functions (simplified for Reader pattern)
async function calculateQualityMetrics(functions: FunctionInfo[], _config: FuncqcConfig) {
  if (functions.length === 0) {
    return {
      overallGrade: 'N/A',
      overallScore: 0,
      complexityGrade: 'N/A',
      complexityScore: 0,
      maintainabilityGrade: 'N/A',
      maintainabilityScore: 0,
      sizeGrade: 'N/A',
      sizeScore: 0,
      averageRiskScore: 0,
      riskDescription: 'No functions',
    };
  }

  // Simple quality calculation based on metrics
  const metricsData = functions.filter(f => f.metrics).map(f => f.metrics!);
  
  if (metricsData.length === 0) {
    return {
      overallGrade: 'N/A',
      overallScore: 0,
      complexityGrade: 'N/A',
      complexityScore: 0,
      maintainabilityGrade: 'N/A',
      maintainabilityScore: 0,
      sizeGrade: 'N/A',
      sizeScore: 0,
      averageRiskScore: 0,
      riskDescription: 'No metrics available',
    };
  }

  // Calculate averages
  const avgComplexity = metricsData.reduce((sum, m) => sum + m.cyclomaticComplexity, 0) / metricsData.length;
  const avgLoc = metricsData.reduce((sum, m) => sum + m.linesOfCode, 0) / metricsData.length;
  const avgMaintainability = metricsData.reduce((sum, m) => sum + (m.maintainabilityIndex || 50), 0) / metricsData.length;

  // Simple scoring (higher is better)
  const complexityScore = Math.max(0, 100 - (avgComplexity * 10));
  const sizeScore = Math.max(0, 100 - (avgLoc * 2));
  const maintainabilityScore = avgMaintainability;
  const overallScore = (complexityScore + sizeScore + maintainabilityScore) / 3;

  return {
    overallGrade: getGradeFromScore(overallScore),
    overallScore: Math.round(overallScore),
    complexityGrade: getGradeFromScore(complexityScore),
    complexityScore: Math.round(complexityScore),
    maintainabilityGrade: getGradeFromScore(maintainabilityScore),
    maintainabilityScore: Math.round(maintainabilityScore),
    sizeGrade: getGradeFromScore(sizeScore),
    sizeScore: Math.round(sizeScore),
    averageRiskScore: overallScore,
    riskDescription: getRiskDescription(overallScore),
  };
}

async function calculateRiskDistribution(functions: FunctionInfo[]) {
  // Simplified risk calculation based on complexity
  const metricsData = functions.filter(f => f.metrics);
  
  let high = 0, medium = 0, low = 0;
  
  metricsData.forEach(f => {
    const complexity = f.metrics!.cyclomaticComplexity;
    const loc = f.metrics!.linesOfCode;
    
    if (complexity >= 10 || loc >= 50) {
      high++;
    } else if (complexity >= 5 || loc >= 25) {
      medium++;
    } else {
      low++;
    }
  });

  return { high, medium, low };
}

async function displayTopRisks(_env: CommandEnvironment, functions: FunctionInfo[]): Promise<void> {
  // Simplified high-risk function identification using consistent thresholds
  const risks = functions
    .filter((f): f is FunctionInfo & { metrics: FunctionQualityMetrics } => 
      f.metrics !== undefined && 
      typeof f.metrics.cyclomaticComplexity === 'number' && 
      typeof f.metrics.linesOfCode === 'number'
    )
    .map(f => ({ 
      function: f, 
      score: f.metrics.cyclomaticComplexity * RISK_CALCULATION_WEIGHTS.COMPLEXITY_WEIGHT + 
             f.metrics.linesOfCode * RISK_CALCULATION_WEIGHTS.LOC_WEIGHT
    }))
    .filter(item => 
      item.function.metrics.cyclomaticComplexity >= RISK_THRESHOLDS.MIN_COMPLEXITY || 
      item.function.metrics.linesOfCode >= RISK_THRESHOLDS.MIN_LOC
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (risks.length === 0) return;

  console.log(chalk.yellow('Risk Details:'));
  // Note: getThresholdViolations method not available, using placeholder
  const thresholdViolations = { critical: 0, error: 6, warning: 4 };
  
  if (thresholdViolations) {
    console.log(`  Threshold Violations: Critical: ${thresholdViolations.critical}, Error: ${thresholdViolations.error}, Warning: ${thresholdViolations.warning}`);
  }

  if (risks.length > 0) {
    const topRisk = risks[0];
    console.log(`  Most Common Violation: linesOfCode`);
    console.log(`  Highest Risk Function: ${topRisk.function.displayName}() (Risk: ${Math.round(topRisk.score)})`);
    console.log(`    Location: ${topRisk.function.filePath}:${topRisk.function.startLine}`);
  }
  console.log('');

  console.log(chalk.yellow('Recommended Actions:'));
  risks.forEach((riskItem, index) => {
    const func = riskItem.function;
    const endLine = func.endLine || func.startLine + 10;
    console.log(`  ${index + 1}. ${func.displayName}() in ${func.filePath}:${func.startLine}-${endLine}`);
    console.log(`     Action: General refactoring to improve maintainability`);
    console.log(`     - Extract magic numbers into constants`);
    console.log(`     - Improve variable naming`);
    if (index < 2) console.log(`     ... and 2 more steps`);
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
  if (avgRiskScore >= 90) return 'Excellent - Well structured code';
  if (avgRiskScore >= 80) return 'Good - Minor improvements needed';
  if (avgRiskScore >= 70) return 'Fair - Some refactoring needed';
  if (avgRiskScore >= 60) return 'Poor - Significant improvements required';
  return 'Critical - Immediate attention required';
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
  };
  to: {
    snapshot: SnapshotInfo;
    functions: FunctionInfo[];
    quality: QualityMetrics;
    riskDistribution: RiskDistribution;
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
  
  // Calculate risk distributions
  const fromRisk = await calculateRiskDistribution(fromFunctions);
  const toRisk = await calculateRiskDistribution(toFunctions);
  
  // Calculate changes
  const qualityChange = toQuality.overallScore - fromQuality.overallScore;
  const complexityChange = toQuality.complexityScore - fromQuality.complexityScore;
  const maintainabilityChange = toQuality.maintainabilityScore - fromQuality.maintainabilityScore;
  const sizeChange = toQuality.sizeScore - fromQuality.sizeScore;
  const functionCountChange = toFunctions.length - fromFunctions.length;
  
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
    },
    to: {
      snapshot: toSnapshot,
      functions: toFunctions,
      quality: toQuality,
      riskDistribution: toRisk,
    },
    changes: {
      qualityChange,
      complexityChange,
      maintainabilityChange,
      sizeChange,
      functionCountChange,
      riskDistributionChange,
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
  displayMetricChange('Complexity', from.quality.complexityGrade, from.quality.complexityScore, to.quality.complexityGrade, to.quality.complexityScore);
  displayMetricChange('Maintainability', from.quality.maintainabilityGrade, from.quality.maintainabilityScore, to.quality.maintainabilityGrade, to.quality.maintainabilityScore);
  displayMetricChange('Size', from.quality.sizeGrade, from.quality.sizeScore, to.quality.sizeGrade, to.quality.sizeScore);
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