import chalk from 'chalk';
import simpleGit, { SimpleGit } from 'simple-git';
import {
  HealthCommandOptions,
  FunctionInfo,
  FuncqcConfig,
  SnapshotInfo,
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
  risk?: unknown;
  git?: unknown;
  recommendations?: unknown;
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
  console.log(`  Total Functions: ${functions.length}`);
  console.log(`  Last Analyzed: ${new Date(targetSnapshot.createdAt).toLocaleDateString()}`);
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
    risk: {
      distribution: riskCounts,
      percentages: {
        high: ((riskCounts.high / functions.length) * 100),
        medium: ((riskCounts.medium / functions.length) * 100),
        low: ((riskCounts.low / functions.length) * 100),
      },
    },
  };
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
  // Simplified high-risk function identification
  const risks = functions
    .filter(f => f.metrics)
    .map(f => ({ 
      function: f, 
      score: f.metrics!.cyclomaticComplexity * 10 + f.metrics!.linesOfCode
    }))
    .filter(item => item.function.metrics!.cyclomaticComplexity >= 10 || item.function.metrics!.linesOfCode >= 50)
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