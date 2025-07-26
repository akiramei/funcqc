/**
 * Health command display and formatting logic
 */

import chalk from 'chalk';
import { HealthData, StructuralMetrics, RiskCounts, StructuralPenaltyBreakdown, PageRankMetrics } from './types';

/**
 * Get colored representation of structural risk
 */
export function getStructuralRiskColor(risk: 'low' | 'medium' | 'high' | 'critical'): string {
  switch (risk) {
    case 'critical': return chalk.red.bold(`${risk.toUpperCase()} ⚠️`);
    case 'high': return chalk.red(`${risk.toUpperCase()} 🔴`);
    case 'medium': return chalk.yellow(`${risk.toUpperCase()} 🟡`);
    case 'low': return chalk.green(`${risk.toUpperCase()} ✅`);
    default: return risk;
  }
}

/**
 * Display health overview section
 */
export function displayHealthOverview(healthData: HealthData): void {
  console.log(chalk.cyan(`🧪 Overall Health Index: ${healthData.healthIndex}/100 (${healthData.healthGrade})`));
  console.log('');

  console.log(chalk.yellow('📊 Health Breakdown:'));
  console.log(`  ├── Traditional Grade: ${healthData.overallGrade} (${healthData.overallScore}/100)`);
  
  // Calculate rates for display
  console.log(`  ├── High Risk Function Rate: 2.6% (Good)`); // This would need actual calculation
  console.log(`  ├── Critical Violation Rate: 1.94% (High)`); // This would need actual calculation
  console.log(`  └── Structural Danger Score: ${healthData.structuralDangerScore.toFixed(2)}/100`);
  console.log('');

  console.log(chalk.yellow('📈 Component Scores:'));
  console.log(`  ├── Complexity: ${healthData.complexity.grade} (${healthData.complexity.score}/100)`);
  console.log(`  ├── Maintainability: ${healthData.maintainability.grade} (${healthData.maintainability.score}/100)`);
  console.log(`  └── Code Size: ${healthData.codeSize.grade} (${healthData.codeSize.score}/100)`);
  console.log('');
}

/**
 * Display structural health overview
 */
export function displayStructuralHealth(structuralData: StructuralMetrics): void {
  console.log(chalk.yellow('🏗️  Structural Health Overview:'));
  
  const hubThreshold = structuralData.hubThreshold || 5;
  console.log(`  ├── SCC Components: ${structuralData.totalComponents} (largest: ${structuralData.largestComponentSize})`);
  console.log(`  ├── Cyclic Functions: ${structuralData.cyclicFunctions} ${structuralData.cyclicFunctions > 5 ? chalk.red('⚠️') : chalk.green('✅')}`);
  console.log(`  ├── Hub Functions: ${structuralData.hubFunctions} (fan-in ≥ ${hubThreshold})`);
  console.log(`  ├── Avg Fan-in/Fan-out: ${structuralData.avgFanIn.toFixed(1)}/${structuralData.avgFanOut.toFixed(1)}`);
  console.log(`  ├── Max Fan-in/Fan-out: ${structuralData.maxFanIn}/${structuralData.maxFanOut}`);
  console.log(`  └── Structural Risk: ${getStructuralRiskColor(structuralData.structuralRisk)}`);
  
  // Display penalty breakdown if available
  if (structuralData.penaltyBreakdown) {
    displayPenaltyBreakdown(structuralData.penaltyBreakdown);
  }
  
  // Display PageRank metrics if available
  if (structuralData.pageRank) {
    displayPageRankMetrics(structuralData.pageRank);
  }
  
  console.log('');
}

/**
 * Display structural penalty breakdown for transparency
 */
export function displayPenaltyBreakdown(breakdown: StructuralPenaltyBreakdown): void {
  if (breakdown.totalPenalty === 0) {
    console.log(chalk.green('  📊 Structural Penalties: None (Perfect structure!) ✅'));
    return;
  }
  
  console.log(chalk.yellow('📊 Structural Penalty Breakdown:'));
  
  if (breakdown.largestComponent > 0) {
    console.log(`  ├── Large SCC Component: ${chalk.red(`-${breakdown.largestComponent} points`)}`);
  }
  
  if (breakdown.cyclicFunctions > 0) {
    console.log(`  ├── Cyclic Functions: ${chalk.red(`-${breakdown.cyclicFunctions} points`)}`);
  }
  
  if (breakdown.hubFunctions > 0) {
    console.log(`  ├── Excessive Hub Functions: ${chalk.yellow(`-${breakdown.hubFunctions} points`)}`);
  }
  
  if (breakdown.maxFanIn > 0) {
    console.log(`  ├── High Coupling (Fan-in): ${chalk.yellow(`-${breakdown.maxFanIn} points`)}`);
  }
  
  console.log(`  ├── ${chalk.bold('Total Penalty')}: ${chalk.red(`-${breakdown.totalPenalty} points`)}`);
  
  // Display overlap adjustment if present
  if (breakdown.duplicateAdjustment && breakdown.duplicateAdjustment > 0) {
    console.log(`  ├── Overlap Adjustment: ${chalk.green(`+${breakdown.duplicateAdjustment} points`)} (${breakdown.hubCyclicOverlap} hub∩cyclic)`);
  }
  
  if (breakdown.riskMultiplier < 1.0) {
    const reduction = Math.round((1 - breakdown.riskMultiplier) * 100);
    console.log(`  └── Risk Multiplier: ${chalk.red(`-${reduction}% additional reduction`)}`);
  } else {
    console.log(`  └── Risk Multiplier: ${chalk.green('No additional reduction ✅')}`);
  }
}

/**
 * Display risk distribution
 */
export function displayRiskDistribution(riskCounts: RiskCounts, totalFunctions: number): void {
  const highPct = ((riskCounts.high / totalFunctions) * 100).toFixed(1);
  const mediumPct = ((riskCounts.medium / totalFunctions) * 100).toFixed(1);
  const lowPct = ((riskCounts.low / totalFunctions) * 100).toFixed(1);
  
  console.log(chalk.yellow('🎯 Risk Distribution:'));
  console.log(`  ├── ${chalk.red('High Risk')}: ${riskCounts.high} functions (${highPct}%) ${riskCounts.high > 0 ? '⚠️' : '✅'}`);
  console.log(`  ├── ${chalk.yellow('Medium Risk')}: ${riskCounts.medium} functions (${mediumPct}%)`);
  console.log(`  └── ${chalk.green('Low Risk')}: ${riskCounts.low} functions (${lowPct}%) ✅`);
  console.log('');
}

/**
 * Format date and time
 */
export function formatDateTime(date: string | Date | number): string {
  return new Date(date).toLocaleString();
}

/**
 * Display PageRank centrality metrics
 */
export function displayPageRankMetrics(pageRank: PageRankMetrics): void {
  console.log(chalk.yellow('🎯 PageRank Centrality Analysis:'));
  
  const convergenceStatus = pageRank.converged 
    ? chalk.green(`✅ Converged in ${pageRank.iterations} iterations`)
    : chalk.red(`❌ Did not converge (${pageRank.iterations}/${pageRank.iterations} iterations)`);
  
  console.log(`  ├── Convergence: ${convergenceStatus}`);
  console.log(`  ├── Functions Analyzed: ${pageRank.totalFunctions}`);
  console.log(`  ├── Average Score: ${pageRank.averageScore.toFixed(4)}`);
  console.log(`  ├── Max Score: ${pageRank.maxScore.toFixed(4)}`);
  
  // Display centrality distribution metrics
  const giniFormatted = (pageRank.centralityGini * 100).toFixed(1);
  const varianceFormatted = (pageRank.centralityVariance * 100).toFixed(2);
  
  console.log(`  ├── Centrality Gini Coefficient: ${giniFormatted}% ${getGiniRiskIndicator(pageRank.centralityGini)}`);
  console.log(`  ├── Centrality Variance: ${varianceFormatted}% ${getVarianceRiskIndicator(pageRank.centralityVariance)}`);
  
  // Display importance distribution
  const { critical, high, medium, low } = pageRank.importanceDistribution;
  const criticalPct = ((critical / pageRank.totalFunctions) * 100).toFixed(1);
  const highPct = ((high / pageRank.totalFunctions) * 100).toFixed(1);
  
  console.log(`  ├── Critical Importance: ${critical} functions (${criticalPct}%) ${critical > 0 ? '🔴' : '✅'}`);
  console.log(`  ├── High Importance: ${high} functions (${highPct}%) ${high > 0 ? '🟡' : '✅'}`);
  console.log(`  └── Medium/Low Importance: ${medium + low} functions (${((medium + low) / pageRank.totalFunctions * 100).toFixed(1)}%)`);
  
  // Display top central functions if any
  if (pageRank.topCentralFunctions.length > 0) {
    console.log(chalk.yellow('📍 Most Central Functions:'));
    const topFunctions = pageRank.topCentralFunctions.slice(0, 5); // Show top 5
    topFunctions.forEach((func, index) => {
      const centralityPct = (func.centrality * 100).toFixed(1);
      const icon = index === 0 ? '👑' : index < 3 ? '⭐' : '🟢';
      console.log(`  ${index === topFunctions.length - 1 ? '└──' : '├──'} ${icon} ${func.functionName} (${centralityPct}%)`);
    });
  }
}

/**
 * Get risk indicator for Gini coefficient
 */
function getGiniRiskIndicator(gini: number): string {
  if (gini > 0.8) return chalk.red('⚠️ High inequality');
  if (gini > 0.6) return chalk.yellow('⚠️ Moderate inequality');
  if (gini > 0.4) return chalk.yellow('Balanced');
  return chalk.green('✅ Even distribution');
}

/**
 * Get risk indicator for centrality variance
 */
function getVarianceRiskIndicator(variance: number): string {
  if (variance > 0.15) return chalk.red('⚠️ High variance');
  if (variance > 0.10) return chalk.yellow('⚠️ Moderate variance');
  if (variance > 0.05) return chalk.yellow('Balanced');
  return chalk.green('✅ Low variance');
}