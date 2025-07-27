/**
 * Trend Analysis System - RESTORED from original implementation
 * Provides comprehensive historical analysis of code quality trends
 */

import chalk from 'chalk';
import { HealthCommandOptions } from '../../../types';
import { CommandEnvironment } from '../../../types/environment';
import { TrendData, TrendAnalysis } from './types';

/**
 * Display comprehensive trend analysis - RESTORED from original implementation
 */
export async function displayTrendAnalysis(
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

/**
 * Calculate comprehensive trend analysis - RESTORED from original implementation
 */
export async function calculateTrendAnalysis(env: CommandEnvironment, period: number): Promise<TrendAnalysis> {
  const cutoffDate = Date.now() - (period * 24 * 60 * 60 * 1000);
  const snapshots = await env.storage.getSnapshots({ 
    limit: 50, // Get more snapshots for trend analysis
  });

  const recentSnapshots = snapshots.filter(s => s.createdAt >= cutoffDate);
  
  // Group snapshots by reasonable intervals for analysis
  const periods: TrendData[] = [];
  const now = Date.now();
  
  // For periods <= 7 days, group by day. For longer periods, group by week
  const intervalMs = period <= 7 ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000; // 1 day or 1 week
  const intervalName = period <= 7 ? 'Day' : 'Week';
  const intervalCount = period <= 7 ? period : Math.ceil(period / 7);

  for (let i = 0; i < intervalCount; i++) {
    const intervalStart = now - ((i + 1) * intervalMs);
    const intervalEnd = now - (i * intervalMs);
    const intervalSnapshots = recentSnapshots.filter(s => 
      s.createdAt >= intervalStart && s.createdAt < intervalEnd
    );

    if (intervalSnapshots.length === 0) continue;

    const avgComplexity = intervalSnapshots.reduce((sum, s) => {
      // Use snapshot's metadata directly
      const metadata = s.metadata as { avgComplexity?: number };
      return sum + (metadata?.avgComplexity || 0);
    }, 0) / intervalSnapshots.length;
    
    const totalFunctions = intervalSnapshots.reduce((sum, s) => {
      const metadata = s.metadata as { totalFunctions?: number };
      return sum + (metadata?.totalFunctions || 0);
    }, 0) / intervalSnapshots.length;
    
    const highRiskCount = intervalSnapshots.reduce((sum, s) => {
      const metadata = s.metadata as { complexityDistribution?: Record<string, number> };
      const complexityDistribution = metadata?.complexityDistribution || {};
      const highRisk = Object.entries(complexityDistribution)
        .filter(([complexity]) => parseInt(complexity) >= 10)
        .reduce((count, [, functions]) => count + (functions || 0), 0);
      return sum + highRisk;
    }, 0) / intervalSnapshots.length;

    const qualityScore = Math.max(0, 100 - (avgComplexity * 10));

    periods.push({
      period: `${intervalName} ${i + 1}`,
      snapshots: intervalSnapshots,
      avgComplexity,
      totalFunctions: Math.round(totalFunctions),
      highRiskCount: Math.round(highRiskCount),
      qualityScore,
      trend: i === 0 ? 'stable' : calculateTrend(periods[periods.length - 1]?.qualityScore || 50, qualityScore),
    });
  }

  periods.reverse(); // Show oldest first

  const overallTrend = periods.length >= 2 
    ? calculateTrend(periods[0].qualityScore, periods[periods.length - 1].qualityScore)
    : 'stable';

  const keyInsights = generateInsights(periods);
  const recommendations = generateRecommendations(periods, overallTrend);

  return {
    periods,
    overallTrend,
    keyInsights,
    recommendations
  };
}

/**
 * Determine analysis period from options - RESTORED from original implementation
 */
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
 * Get trend icon for display - RESTORED from original implementation
 */
function getTrendIcon(trend: 'improving' | 'stable' | 'degrading'): string {
  switch (trend) {
    case 'improving': return '📈';
    case 'degrading': return '📉';
    case 'stable': return '➡️';
    default: return '❓';
  }
}

/**
 * Calculate trend direction from quality scores - RESTORED from original implementation
 */
function calculateTrend(fromScore: number, toScore: number): 'improving' | 'stable' | 'degrading' {
  const diff = toScore - fromScore;
  if (diff > 5) return 'improving';
  if (diff < -5) return 'degrading';
  return 'stable';
}

/**
 * Generate insights from trend data - RESTORED from original implementation
 */
function generateInsights(periods: TrendData[]): string[] {
  const insights: string[] = [];
  
  if (periods.length >= 2) {
    const first = periods[0];
    const last = periods[periods.length - 1];
    
    const complexityChange = last.avgComplexity - first.avgComplexity;
    const functionChange = last.totalFunctions - first.totalFunctions;
    const riskChange = last.highRiskCount - first.highRiskCount;
    
    if (Math.abs(complexityChange) > 0.5) {
      const direction = complexityChange > 0 ? 'increased' : 'decreased';
      insights.push(`Average complexity ${direction} by ${Math.abs(complexityChange).toFixed(1)} over the period`);
    }
    
    if (functionChange !== 0) {
      const direction = functionChange > 0 ? 'added' : 'removed';
      insights.push(`${Math.abs(functionChange)} functions ${direction} ${functionChange > 0 ? 'to' : 'from'} the codebase`);
    }
    
    if (Math.abs(riskChange) > 1) {
      const direction = riskChange > 0 ? 'increased' : 'decreased';
      insights.push(`High-risk functions ${direction} by ${Math.abs(riskChange)}`);
    }
  }

  return insights;
}

/**
 * Generate recommendations based on trend analysis - RESTORED from original implementation
 */
function generateRecommendations(periods: TrendData[], trend: string): string[] {
  const recommendations: string[] = [];

  if (trend === 'degrading') {
    recommendations.push('Consider implementing stricter quality gates');
    recommendations.push('Focus on refactoring high-complexity functions');
    recommendations.push('Review recent changes that may have introduced complexity');
  } else if (trend === 'improving') {
    recommendations.push('Continue current development practices');
    recommendations.push('Document what has been working well');
    recommendations.push('Consider sharing successful patterns with the team');
  } else {
    recommendations.push('Monitor trends and maintain current quality levels');
    recommendations.push('Look for opportunities to improve gradually');
  }

  // Add specific recommendations based on recent data
  if (periods.length > 0) {
    const latest = periods[periods.length - 1];
    if (latest.highRiskCount > 5) {
      recommendations.push('Address high-risk functions to improve overall health');
    }
    if (latest.avgComplexity > 5) {
      recommendations.push('Focus on reducing function complexity in new development');
    }
  }

  return recommendations;
}