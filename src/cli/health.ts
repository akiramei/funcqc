import chalk from 'chalk';
import simpleGit, { SimpleGit } from 'simple-git';
import { HealthCommandOptions, FunctionInfo, FuncqcConfig, SnapshotInfo } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { QualityScorer } from '../utils/quality-scorer';
import { riskAssessor } from '../core/risk-assessor';
import { Logger } from '../utils/cli-utils';

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

export async function healthCommand(options: HealthCommandOptions): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  
  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    if (!config.storage.path) {
      logger.error('Storage path is not configured');
      process.exit(1);
    }

    const storage = new PGLiteStorageAdapter(config.storage.path);
    await storage.init();

    // Handle different modes
    if (options.trend) {
      await displayTrendAnalysis(storage, options, logger);
    } else if (options.risks) {
      await displayDetailedRiskAssessment(storage, config, options);
    } else if (options.showConfig) {
      displayConfigurationDetails(config, options.verbose || false);
    } else {
      // Default health overview
      await displayHealthOverview(storage, config, options);
    }

    await storage.close();
    
  } catch (error) {
    logger.error('Failed to generate health report', error);
    process.exit(1);
  }
}

async function displayHealthOverview(
  storage: PGLiteStorageAdapter, 
  config: FuncqcConfig, 
  options: HealthCommandOptions
): Promise<void> {
  console.log(chalk.blue('funcqc Health Report'));
  console.log('-'.repeat(50));
  console.log();

  const snapshots = await storage.getSnapshots({ sort: 'created_at', limit: 1 });
  
  if (snapshots.length === 0) {
    console.log(chalk.yellow('Warning: No data found'));
    console.log('Run "funcqc scan" to analyze your project');
    return;
  }

  const latest = snapshots[0];
  const functions = await storage.getFunctions(latest.id);
  
  if (functions.length === 0) {
    console.log(chalk.yellow('Warning: No functions found in latest snapshot'));
    return;
  }

  // Project Overview
  console.log(chalk.yellow('Project Overview:'));
  console.log(`  Total Functions: ${functions.length}`);
  console.log(`  Last Analyzed: ${new Date(latest.createdAt).toISOString().split('T')[0]}`);
  console.log(`  Database: ${config.storage.path}`);
  console.log();

  // Quality Overview
  await displayQualityOverview(functions, config, options.verbose || false);

  // Risk Distribution
  await displayRiskDistribution(functions, config);

  // Git Status (if enabled)
  if (config.git.enabled) {
    await displayGitStatus(options.verbose || false);
  }

  if (options.verbose) {
    await displayDetailedInsights(functions, storage, snapshots);
  }
}

async function displayQualityOverview(
  functions: FunctionInfo[], 
  _config: FuncqcConfig, 
  verbose: boolean
): Promise<void> {
  console.log(chalk.yellow('Quality Overview:'));
  
  const functionsWithMetrics = functions.filter(f => f.metrics);
  if (functionsWithMetrics.length === 0) {
    console.log('  No quality metrics available');
    return;
  }

  const scorer = new QualityScorer();
  const projectScore = scorer.calculateProjectScore(functionsWithMetrics);

  console.log(`  Overall Grade: ${projectScore.overallGrade} (${projectScore.score}/100)`);
  console.log(`  Complexity Score: ${projectScore.complexityScore}/100`);
  console.log(`  Maintainability Score: ${projectScore.maintainabilityScore}/100`);
  console.log(`  Size Score: ${projectScore.sizeScore}/100`);

  if (verbose) {
    console.log(`  Code Quality Score: ${projectScore.codeQualityScore}/100`);
    console.log(`  High Risk Functions: ${projectScore.highRiskFunctions}`);
    
    if (projectScore.topProblematicFunctions.length > 0) {
      console.log('  Most Problematic Functions:');
      projectScore.topProblematicFunctions.slice(0, 3).forEach((func, index) => {
        console.log(`    ${index + 1}. ${func.name} (${func.reason})`);
      });
    }
  }
  console.log();
}

async function displayRiskDistribution(functions: FunctionInfo[], config: FuncqcConfig): Promise<void> {
  console.log(chalk.yellow('Risk Distribution:'));
  
  const functionsWithMetrics = functions.filter(f => f.metrics);
  if (functionsWithMetrics.length === 0) {
    console.log('  No risk assessment available');
    return;
  }

  try {
    const riskAssessment = await riskAssessor.assessProject(
      functionsWithMetrics,
      config.thresholds,
      config.assessment
    );

    const { riskDistribution } = riskAssessment;
    const total = riskDistribution.high + riskDistribution.medium + riskDistribution.low;
    
    console.log(`  High Risk: ${riskDistribution.high} functions (${((riskDistribution.high / total) * 100).toFixed(1)}%)`);
    console.log(`  Medium Risk: ${riskDistribution.medium} functions (${((riskDistribution.medium / total) * 100).toFixed(1)}%)`);
    console.log(`  Low Risk: ${riskDistribution.low} functions (${((riskDistribution.low / total) * 100).toFixed(1)}%)`);
    console.log();
  } catch {
    console.log('  Risk assessment failed');
    console.log();
  }
}

async function displayDetailedRiskAssessment(
  storage: PGLiteStorageAdapter,
  config: FuncqcConfig,
  options: HealthCommandOptions
): Promise<void> {
  console.log(chalk.blue('funcqc Risk Assessment'));
  console.log('-'.repeat(50));
  console.log();

  const snapshots = await storage.getSnapshots({ sort: 'created_at', limit: 1 });
  if (snapshots.length === 0) {
    console.log(chalk.yellow('Warning: No data found'));
    return;
  }

  const functions = await storage.getFunctions(snapshots[0].id);
  const functionsWithMetrics = functions.filter(f => f.metrics);
  
  if (functionsWithMetrics.length === 0) {
    console.log(chalk.yellow('Warning: No functions with metrics found'));
    return;
  }

  try {
    const riskAssessment = await riskAssessor.assessProject(
      functionsWithMetrics,
      config.thresholds,
      config.assessment
    );

    if (options.json) {
      console.log(JSON.stringify(riskAssessment, null, 2));
      return;
    }

    // Display risk summary
    const summary = riskAssessor.createAssessmentSummary(riskAssessment);
    
    console.log(chalk.yellow('Risk Summary:'));
    console.log(`  Total Functions: ${summary.totalFunctions}`);
    console.log(`  High Risk: ${summary.highRiskFunctions}`);
    console.log(`  Medium Risk: ${summary.mediumRiskFunctions}`);
    console.log(`  Low Risk: ${summary.lowRiskFunctions}`);
    console.log(`  Average Risk Score: ${summary.averageRiskScore.toFixed(1)}`);
    console.log();

    console.log(chalk.yellow('Threshold Violations:'));
    console.log(`  Critical: ${summary.criticalViolations}`);
    console.log(`  Error: ${summary.errorViolations}`);
    console.log(`  Warning: ${summary.warningViolations}`);
    console.log();

    if (summary.worstFunctionId) {
      console.log(chalk.yellow('Most Complex Function:'));
      const worstFunction = functionsWithMetrics.find(f => f.id === summary.worstFunctionId);
      if (worstFunction) {
        console.log(`  ${worstFunction.displayName}() in ${worstFunction.filePath}:${worstFunction.startLine}`);
      }
      console.log();
    }

    if (summary.mostCommonViolation) {
      console.log(chalk.yellow('Most Common Violation:'));
      console.log(`  ${summary.mostCommonViolation}`);
      console.log();
    }

  } catch (error) {
    console.error(chalk.red('Risk assessment failed:'), error instanceof Error ? error.message : String(error));
  }
}

async function displayTrendAnalysis(
  storage: PGLiteStorageAdapter,
  options: HealthCommandOptions,
  _logger: Logger
): Promise<void> {
  console.log(chalk.blue('funcqc Trend Analysis'));
  console.log('-'.repeat(50));
  console.log();

  const snapshots = await storage.getSnapshots();
  
  if (snapshots.length < 2) {
    console.log(chalk.yellow('Warning: Not enough data for trend analysis'));
    console.log('Need at least 2 snapshots to show trends');
    console.log('Run "funcqc scan" to create more snapshots');
    return;
  }

  const periodDays = determinePeriod(options);
  const trendData = await analyzeTrends(snapshots, periodDays, storage);
  
  if (options.json) {
    console.log(JSON.stringify(trendData, null, 2));
  } else {
    displayFullTrendAnalysis(trendData, periodDays);
  }
}

function determinePeriod(options: HealthCommandOptions): number {
  if (options.period) {
    const parsed = parseInt(options.period, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid period value: ${options.period}. Must be a positive number.`);
    }
    return parsed;
  }
  return 7; // Default to weekly
}

async function analyzeTrends(
  snapshots: SnapshotInfo[],
  periodDays: number,
  storage: PGLiteStorageAdapter
): Promise<TrendAnalysis> {
  const now = new Date();
  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  const periods: TrendData[] = [];
  const maxPeriods = 8;

  for (let i = 0; i < maxPeriods; i++) {
    const periodEnd = new Date(now.getTime() - i * periodMs);
    const periodStart = new Date(periodEnd.getTime() - periodMs);
    
    const periodSnapshots = snapshots.filter(s => {
      const snapshotDate = new Date(s.createdAt);
      return snapshotDate >= periodStart && snapshotDate < periodEnd;
    });

    if (periodSnapshots.length === 0) continue;

    const functions = await storage.getFunctions(periodSnapshots[0].id);
    const functionsWithMetrics = functions.filter(f => f.metrics);
    
    if (functionsWithMetrics.length === 0) continue;

    const avgComplexity = functionsWithMetrics.reduce(
      (sum, f) => sum + f.metrics!.cyclomaticComplexity, 0
    ) / functionsWithMetrics.length;

    // Simple quality score calculation
    const qualityScore = Math.max(0, 100 - (avgComplexity - 1) * 10);
    
    const highRiskCount = functionsWithMetrics.filter(
      f => f.metrics!.cyclomaticComplexity > 10
    ).length;

    periods.push({
      period: periodStart.toISOString().split('T')[0],
      snapshots: periodSnapshots,
      avgComplexity,
      totalFunctions: functionsWithMetrics.length,
      highRiskCount,
      qualityScore,
      trend: 'stable' // Simple implementation
    });
  }

  // Calculate overall trend
  const overallTrend = periods.length >= 2 && periods[0].qualityScore > periods[1].qualityScore
    ? 'improving' : periods.length >= 2 && periods[0].qualityScore < periods[1].qualityScore
    ? 'degrading' : 'stable';

  return {
    periods: periods.reverse(),
    overallTrend,
    keyInsights: generateKeyInsights(periods),
    recommendations: generateRecommendations(periods)
  };
}

function generateKeyInsights(periods: TrendData[]): string[] {
  const insights: string[] = [];
  
  if (periods.length >= 2) {
    const latest = periods[periods.length - 1];
    const previous = periods[periods.length - 2];
    
    const complexityChange = latest.avgComplexity - previous.avgComplexity;
    if (Math.abs(complexityChange) > 0.5) {
      insights.push(`Complexity ${complexityChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(complexityChange).toFixed(1)}`);
    }
    
    const riskChange = latest.highRiskCount - previous.highRiskCount;
    if (riskChange !== 0) {
      insights.push(`High-risk functions ${riskChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(riskChange)}`);
    }
  }
  
  return insights;
}

function generateRecommendations(periods: TrendData[]): string[] {
  const recommendations: string[] = [];
  
  if (periods.length > 0) {
    const latest = periods[periods.length - 1];
    
    if (latest.highRiskCount > 0) {
      recommendations.push('Review high-risk functions for refactoring opportunities');
    }
    
    if (latest.avgComplexity > 5) {
      recommendations.push('Consider breaking down complex functions');
    }
  }
  
  return recommendations;
}

function displayFullTrendAnalysis(trendData: TrendAnalysis, periodDays: number): void {
  console.log(chalk.yellow('Trend Summary:'));
  console.log(`  Period: ${periodDays} days`);
  console.log(`  Overall Trend: ${getTrendDisplay(trendData.overallTrend)}`);
  console.log(`  Data Points: ${trendData.periods.length}`);
  console.log();

  if (trendData.periods.length > 0) {
    console.log(chalk.yellow('Period Details:'));
    trendData.periods.forEach(period => {
      console.log(`  ${period.period}:`);
      console.log(`    Functions: ${period.totalFunctions}`);
      console.log(`    Avg Complexity: ${period.avgComplexity.toFixed(1)}`);
      console.log(`    High Risk: ${period.highRiskCount}`);
      console.log(`    Quality Score: ${period.qualityScore.toFixed(1)}`);
    });
    console.log();
  }

  if (trendData.keyInsights.length > 0) {
    console.log(chalk.yellow('Key Insights:'));
    trendData.keyInsights.forEach(insight => {
      console.log(`  - ${insight}`);
    });
    console.log();
  }

  if (trendData.recommendations.length > 0) {
    console.log(chalk.yellow('Recommendations:'));
    trendData.recommendations.forEach(rec => {
      console.log(`  - ${rec}`);
    });
    console.log();
  }
}

function displayConfigurationDetails(config: FuncqcConfig, verbose: boolean): void {
  console.log(chalk.blue('funcqc Configuration'));
  console.log('-'.repeat(50));
  console.log();

  console.log(chalk.yellow('Project Settings:'));
  console.log(`  Root Directories: ${config.roots.join(', ')}`);
  console.log(`  Database Path: ${config.storage.path}`);
  console.log(`  Git Integration: ${config.git.enabled ? 'enabled' : 'disabled'}`);
  console.log();

  console.log(chalk.yellow('Quality Thresholds:'));
  console.log(`  Cyclomatic Complexity: <= ${config.metrics.complexityThreshold}`);
  console.log(`  Cognitive Complexity: <= ${config.metrics.cognitiveComplexityThreshold}`);
  console.log(`  Lines of Code: <= ${config.metrics.linesOfCodeThreshold}`);
  console.log(`  Parameter Count: <= ${config.metrics.parameterCountThreshold}`);
  console.log(`  Max Nesting Level: <= ${config.metrics.maxNestingLevelThreshold}`);
  console.log();

  if (verbose) {
    console.log(chalk.yellow('Exclude Patterns:'));
    if (config.exclude.length === 0) {
      console.log('  (none)');
    } else {
      config.exclude.slice(0, 10).forEach(pattern => {
        console.log(`  - ${pattern}`);
      });
      if (config.exclude.length > 10) {
        console.log(`  ... and ${config.exclude.length - 10} more`);
      }
    }
    console.log();
  }
}

async function displayGitStatus(verbose: boolean): Promise<void> {
  try {
    const git: SimpleGit = simpleGit();
    const status = await git.status();
    
    console.log(chalk.yellow('Git Status:'));
    console.log(`  Branch: ${status.current || 'unknown'}`);
    console.log(`  Staged Files: ${status.staged.length}`);
    console.log(`  Modified Files: ${status.modified.length}`);
    
    if (verbose && (status.staged.length > 0 || status.modified.length > 0)) {
      if (status.staged.length > 0) {
        console.log('  Staged:');
        status.staged.slice(0, 5).forEach(file => {
          console.log(`    + ${file}`);
        });
      }
      if (status.modified.length > 0) {
        console.log('  Modified:');
        status.modified.slice(0, 5).forEach(file => {
          console.log(`    ~ ${file}`);
        });
      }
    }
    console.log();
  } catch {
    // Git status failed - not a git repository or git not available
    console.log(chalk.yellow('Git Status: Not available'));
    console.log();
  }
}

async function displayDetailedInsights(
  functions: FunctionInfo[],
  _storage: PGLiteStorageAdapter,
  snapshots: SnapshotInfo[]
): Promise<void> {
  console.log(chalk.yellow('Detailed Insights:'));
  
  const functionsWithMetrics = functions.filter(f => f.metrics);
  if (functionsWithMetrics.length === 0) return;

  // Find most complex functions
  const mostComplex = functionsWithMetrics
    .sort((a, b) => b.metrics!.cyclomaticComplexity - a.metrics!.cyclomaticComplexity)
    .slice(0, 3);

  console.log('  Most Complex Functions:');
  mostComplex.forEach((func, index) => {
    console.log(`    ${index + 1}. ${func.displayName}() (CC: ${func.metrics!.cyclomaticComplexity})`);
    console.log(`       ${func.filePath}:${func.startLine}`);
  });
  console.log();

  // Analysis history
  console.log(`  Analysis History: ${snapshots.length} snapshots`);
  if (snapshots.length > 1) {
    const oldest = snapshots[snapshots.length - 1];
    const daysSince = Math.floor((Date.now() - oldest.createdAt) / (1000 * 60 * 60 * 24));
    console.log(`  First Analysis: ${daysSince} days ago`);
  }
  console.log();
}

function getTrendDisplay(trend: 'improving' | 'stable' | 'degrading'): string {
  switch (trend) {
    case 'improving': return chalk.green('Improving');
    case 'degrading': return chalk.red('Degrading');
    default: return chalk.yellow('Stable');
  }
}