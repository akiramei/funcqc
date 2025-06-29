import chalk from 'chalk';
import { TrendCommandOptions, SnapshotInfo } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
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

export async function trendCommand(options: TrendCommandOptions): Promise<void> {
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

    // Get snapshots for analysis
    const snapshots = await storage.getSnapshots();
    
    if (snapshots.length < 2) {
      console.log(chalk.yellow('⚠️  Not enough data for trend analysis.'));
      console.log(chalk.gray('Need at least 2 snapshots to show trends.'));
      console.log(chalk.blue('Run `funcqc scan` to create more snapshots.'));
      return;
    }

    // Determine period and analyze trends
    const periodDays = determinePeriod(options);
    const trendData = await analyzeTrends(snapshots, periodDays, options);
    
    // Display results
    if (options.json) {
      console.log(JSON.stringify(trendData, null, 2));
    } else if (options.summary) {
      displayTrendSummary(trendData);
    } else {
      displayFullTrendAnalysis(trendData, periodDays);
    }

    await storage.close();
  } catch (error) {
    logger.error('Failed to analyze trends', error);
    process.exit(1);
  }
}

function determinePeriod(options: TrendCommandOptions): number {
  if (options.daily) return 1;
  if (options.monthly) return 30;
  if (options.weekly) return 7;
  if (options.period) {
    const parsed = parseInt(options.period, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid period value: ${options.period}. Must be a positive number.`);
    }
    return parsed;
  }
  return 7; // Default to weekly
}

// Constants for trend analysis
const MAX_PERIODS = 8;
const QUALITY_SCORE_BASE = 100;
const COMPLEXITY_PENALTY_MULTIPLIER = 5;
const MAX_COMPLEXITY_PENALTY = 50;
const MAX_RISK_RATIO_PENALTY = 30;
const TREND_THRESHOLD = 5;

async function analyzeTrends(
  snapshots: SnapshotInfo[], 
  periodDays: number, 
  _options: TrendCommandOptions
): Promise<TrendAnalysis> {
  const now = new Date();
  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  
  // Group snapshots by periods
  const periods: TrendData[] = [];
  const maxPeriods = MAX_PERIODS; // Show last 8 periods
  
  for (let i = 0; i < maxPeriods; i++) {
    const periodEnd = new Date(now.getTime() - (i * periodMs));
    const periodStart = new Date(periodEnd.getTime() - periodMs);
    
    const periodSnapshots = snapshots.filter(s => 
      s.createdAt >= periodStart.getTime() && s.createdAt < periodEnd.getTime()
    );
    
    if (periodSnapshots.length === 0) continue;
    
    const periodData = calculatePeriodMetrics(periodSnapshots, periodStart, periodEnd, periodDays);
    
    // Calculate trend by comparing with previous period
    if (periods.length > 0) {
      const previousPeriod = periods[0]; // Most recent period in chronological order
      const scoreDiff = periodData.qualityScore - previousPeriod.qualityScore;
      
      if (scoreDiff > TREND_THRESHOLD) {
        periodData.trend = 'improving';
      } else if (scoreDiff < -TREND_THRESHOLD) {
        periodData.trend = 'degrading';
      }
    }
    
    periods.unshift(periodData); // Add to beginning for chronological order
  }
  
  // Calculate overall trend
  const overallTrend = calculateOverallTrend(periods);
  
  // Generate insights and recommendations
  const keyInsights = generateKeyInsights(periods);
  const recommendations = generateRecommendations(periods, overallTrend);
  
  return {
    periods,
    overallTrend,
    keyInsights,
    recommendations
  };
}

function calculatePeriodMetrics(
  snapshots: SnapshotInfo[], 
  periodStart: Date, 
  periodEnd: Date, 
  periodDays: number
): TrendData {
  // Use the latest snapshot in the period as representative
  const latestSnapshot = snapshots.sort((a, b) => b.createdAt - a.createdAt)[0];
  const metadata = latestSnapshot.metadata;
  
  // Calculate quality score (simplified version)
  const avgComplexity = metadata.avgComplexity || 0;
  const totalFunctions = metadata.totalFunctions || 0;
  
  // Estimate high risk functions (complexity > 10)
  const complexityDist = metadata.complexityDistribution || {};
  const highRiskCount = Object.entries(complexityDist)
    .filter(([complexity, _]) => {
      const complexityNum = parseInt(complexity, 10);
      return !isNaN(complexityNum) && complexityNum > 10;
    })
    .reduce((sum, [_, count]) => {
      const countNum = Number(count);
      return sum + (isNaN(countNum) ? 0 : countNum);
    }, 0);
  
  // Calculate quality score (0-100, higher is better)
  const qualityScore = calculateQualityScore(avgComplexity, highRiskCount, totalFunctions);
  
  // Trend will be calculated in analyzeTrends by comparing with previous periods
  const trend: 'improving' | 'stable' | 'degrading' = 'stable';
  
  const periodLabel = formatPeriodLabel(periodStart, periodEnd, periodDays);
  
  return {
    period: periodLabel,
    snapshots,
    avgComplexity,
    totalFunctions,
    highRiskCount,
    qualityScore,
    trend
  };
}

function calculateQualityScore(avgComplexity: number, highRiskCount: number, totalFunctions: number): number {
  let qualityScore = QUALITY_SCORE_BASE;
  qualityScore -= Math.min(avgComplexity * COMPLEXITY_PENALTY_MULTIPLIER, MAX_COMPLEXITY_PENALTY);
  qualityScore -= Math.min((highRiskCount / totalFunctions) * 100, MAX_RISK_RATIO_PENALTY);
  return Math.max(0, Math.min(100, qualityScore));
}

function calculateOverallTrend(periods: TrendData[]): 'improving' | 'stable' | 'degrading' {
  if (periods.length < 2) return 'stable';
  
  const recent = periods.slice(-3); // Look at last 3 periods
  const scores = recent.map(p => p.qualityScore);
  
  // Simple trend calculation
  const firstScore = scores[0];
  const lastScore = scores[scores.length - 1];
  const scoreDiff = lastScore - firstScore;
  
  if (scoreDiff > 5) return 'improving';
  if (scoreDiff < -5) return 'degrading';
  return 'stable';
}

function generateKeyInsights(periods: TrendData[]): string[] {
  const insights: string[] = [];
  
  if (periods.length === 0) return insights;
  
  const latest = periods[periods.length - 1];
  const previous = periods.length > 1 ? periods[periods.length - 2] : null;
  
  // Function count changes
  if (previous) {
    const functionChange = latest.totalFunctions - previous.totalFunctions;
    if (functionChange > 0) {
      insights.push(`Added ${functionChange} new functions since last period`);
    } else if (functionChange < 0) {
      insights.push(`Removed ${Math.abs(functionChange)} functions since last period`);
    }
    
    // Complexity changes
    const complexityChange = latest.avgComplexity - previous.avgComplexity;
    if (Math.abs(complexityChange) > 0.5) {
      const direction = complexityChange > 0 ? 'increased' : 'decreased';
      insights.push(`Average complexity ${direction} by ${Math.abs(complexityChange).toFixed(1)}`);
    }
    
    // High risk function changes
    const riskChange = latest.highRiskCount - previous.highRiskCount;
    if (riskChange !== 0) {
      const direction = riskChange > 0 ? 'increased' : 'decreased';
      insights.push(`High-risk functions ${direction} by ${Math.abs(riskChange)}`);
    }
  }
  
  // Current status
  const riskRatio = (latest.highRiskCount / latest.totalFunctions) * 100;
  if (riskRatio > 20) {
    insights.push(`High risk ratio: ${riskRatio.toFixed(1)}% of functions need attention`);
  } else if (riskRatio < 5) {
    insights.push(`Low risk profile: Only ${riskRatio.toFixed(1)}% high-risk functions`);
  }
  
  return insights;
}

function generateRecommendations(periods: TrendData[], overallTrend: string): string[] {
  const recommendations: string[] = [];
  
  if (periods.length === 0) return recommendations;
  
  const latest = periods[periods.length - 1];
  
  switch (overallTrend) {
    case 'degrading':
      recommendations.push('Quality is declining - prioritize refactoring high-complexity functions');
      recommendations.push('Consider implementing pre-commit quality checks');
      if (latest.highRiskCount > 0) {
        recommendations.push(`Focus on ${latest.highRiskCount} high-risk functions first`);
      }
      break;
      
    case 'improving':
      recommendations.push('Quality is improving - maintain current development practices');
      recommendations.push('Document successful refactoring patterns for team sharing');
      break;
      
    case 'stable':
      if (latest.avgComplexity > 5) {
        recommendations.push('Quality is stable but could be improved - consider gradual refactoring');
      } else {
        recommendations.push('Quality is stable and good - focus on maintaining standards');
      }
      break;
  }
  
  // General recommendations based on current state
  if (latest.totalFunctions > 100 && latest.highRiskCount === 0) {
    recommendations.push('Excellent code quality! Consider mentoring other teams');
  }
  
  return recommendations;
}

function formatPeriodLabel(start: Date, end: Date, periodDays: number): string {
  if (periodDays === 1) {
    return start.toLocaleDateString();
  } else if (periodDays === 7) {
    const weekStart = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Week of ${weekStart}`;
  } else if (periodDays === 30) {
    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } else {
    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${startStr} - ${endStr}`;
  }
}

function displayTrendSummary(analysis: TrendAnalysis): void {
  console.log(chalk.cyan.bold('📈 Quality Trend Summary'));
  console.log('═'.repeat(40));
  console.log();
  
  const trendIcon = {
    improving: '📈',
    stable: '➡️',
    degrading: '📉'
  }[analysis.overallTrend];
  
  const trendColor = {
    improving: chalk.green,
    stable: chalk.blue,
    degrading: chalk.red
  }[analysis.overallTrend];
  
  console.log(`${trendIcon} ${chalk.bold('Overall Trend:')} ${trendColor(analysis.overallTrend.toUpperCase())}`);
  console.log();
  
  if (analysis.keyInsights.length > 0) {
    console.log(chalk.bold('🔍 Key Insights:'));
    analysis.keyInsights.forEach(insight => {
      console.log(`  • ${insight}`);
    });
    console.log();
  }
  
  if (analysis.recommendations.length > 0) {
    console.log(chalk.bold('💡 Recommendations:'));
    analysis.recommendations.forEach(rec => {
      console.log(`  • ${rec}`);
    });
  }
}

function displayFullTrendAnalysis(analysis: TrendAnalysis, _periodDays: number): void {
  console.log(chalk.cyan.bold('📈 Quality Trends Analysis'));
  console.log('═'.repeat(60));
  console.log();
  
  // Overall trend header
  displayTrendSummary(analysis);
  console.log();
  
  // Detailed period breakdown
  console.log(chalk.bold('📊 Period Breakdown:'));
  console.log();
  
  if (analysis.periods.length === 0) {
    console.log(chalk.gray('No trend data available.'));
    return;
  }
  
  // Create a simple chart
  displayTrendChart(analysis.periods);
  console.log();
  
  // Period details
  const periodsToShow = analysis.periods.slice(-5); // Show last 5 periods
  periodsToShow.forEach((period, index) => {
    const isLatest = index === periodsToShow.length - 1;
    const periodColor = isLatest ? chalk.cyan : chalk.gray;
    
    console.log(periodColor.bold(`${period.period}:`));
    console.log(`  Functions: ${period.totalFunctions}`);
    console.log(`  Avg Complexity: ${period.avgComplexity.toFixed(1)}`);
    console.log(`  High Risk: ${period.highRiskCount}`);
    console.log(`  Quality Score: ${getQualityScoreDisplay(period.qualityScore)}`);
    console.log(`  Snapshots: ${period.snapshots.length}`);
    console.log();
  });
}

function displayTrendChart(periods: TrendData[]): void {
  const maxWidth = 40;
  const maxScore = Math.max(...periods.map(p => p.qualityScore));
  const minScore = Math.min(...periods.map(p => p.qualityScore));
  const scoreRange = maxScore - minScore || 1;
  
  console.log(chalk.bold('Quality Score Trend:'));
  console.log();
  
  periods.slice(-8).forEach(period => { // Show last 8 periods
    const normalizedScore = (period.qualityScore - minScore) / scoreRange;
    const barLength = Math.max(1, Math.round(normalizedScore * maxWidth));
    const bar = '█'.repeat(barLength);
    
    const scoreColor = period.qualityScore >= 80 ? chalk.green :
                      period.qualityScore >= 60 ? chalk.yellow :
                      chalk.red;
    
    const periodLabel = period.period.length > 12 ? 
      period.period.substring(0, 12) + '...' : 
      period.period.padEnd(15);
    
    console.log(`${chalk.gray(periodLabel)} ${scoreColor(bar)} ${period.qualityScore.toFixed(0)}`);
  });
}

function getQualityScoreDisplay(score: number): string {
  if (score >= 90) return chalk.green.bold(`${score.toFixed(0)} (Excellent)`);
  if (score >= 80) return chalk.green(`${score.toFixed(0)} (Good)`);
  if (score >= 70) return chalk.yellow(`${score.toFixed(0)} (Fair)`);
  if (score >= 60) return chalk.yellow(`${score.toFixed(0)} (Poor)`);
  return chalk.red(`${score.toFixed(0)} (Critical)`);
}