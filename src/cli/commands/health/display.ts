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
  
  // Show structural risk adjustment if applicable
  if (healthData.structure?.penaltyBreakdown?.riskMultiplier && healthData.structure.penaltyBreakdown.riskMultiplier < 1.0) {
    const reduction = Math.round((1 - healthData.structure.penaltyBreakdown.riskMultiplier) * 100);
    const riskLevel = healthData.structure.structuralRisk.toUpperCase();
    console.log(`  ├── ${chalk.yellow('Structural Risk Adjustment')}: ${chalk.red(`-${reduction}% (${riskLevel})`)}`);
  }
  
  // Calculate rates for display with improved N/A handling
  const highRiskRate = healthData.highRiskFunctionRate !== undefined 
    ? formatPercentage(healthData.highRiskFunctionRate)
    : 'N/A';
  const criticalViolationRate = healthData.criticalViolationRate !== undefined 
    ? formatPercentage(healthData.criticalViolationRate)
    : 'N/A';
  
  // Determine status based on rates
  const highRiskStatus = healthData.highRiskFunctionRate !== undefined 
    ? (healthData.highRiskFunctionRate <= 5 ? 'Good' : healthData.highRiskFunctionRate <= 15 ? 'Fair' : 'Poor')
    : 'Calculating...';
  const criticalStatus = healthData.criticalViolationRate !== undefined
    ? (healthData.criticalViolationRate <= 2 ? 'Good' : healthData.criticalViolationRate <= 10 ? 'Fair' : 'High')
    : 'Calculating...';
    
  console.log(`  ├── High Risk Function Rate: ${highRiskRate}% (${highRiskStatus})`);
  console.log(`  ├── Critical Violation Rate: ${criticalViolationRate}% (${criticalStatus})`);
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
export function displayStructuralHealth(structuralData: StructuralMetrics, verbose: boolean = false): void {
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
    console.log('');  // Add spacing before PageRank section
    displayPageRankMetrics(structuralData.pageRank, verbose);
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
  
  // Calculate raw total and capping ratio for display consistency
  const rawComponents = [
    breakdown.largestComponent,
    breakdown.cyclicFunctions, 
    breakdown.hubFunctions,
    breakdown.maxFanIn,
    breakdown.crossLayer
  ];
  const rawTotal = rawComponents.reduce((sum, val) => sum + val, 0);
  const adjustedTotal = rawTotal - (breakdown.duplicateAdjustment || 0);
  const cappingRatio = breakdown.totalPenalty / Math.max(adjustedTotal, 1);
  const showRawValues = cappingRatio < 0.95; // Show raw values if significant capping occurred
  
  if (breakdown.largestComponent > 0) {
    const capped = Math.round((breakdown.largestComponent * cappingRatio) * 10) / 10;
    const display = showRawValues 
      ? `${chalk.red(`-${capped} pts`)} ${chalk.gray(`(raw: -${breakdown.largestComponent})`)}`
      : chalk.red(`-${capped} points`);
    console.log(`  ├── Large SCC Component: ${display}`);
  }
  
  if (breakdown.cyclicFunctions > 0) {
    const capped = Math.round((breakdown.cyclicFunctions * cappingRatio) * 10) / 10;
    const display = showRawValues 
      ? `${chalk.red(`-${capped} pts`)} ${chalk.gray(`(raw: -${breakdown.cyclicFunctions})`)}`
      : chalk.red(`-${capped} points`);
    console.log(`  ├── Cyclic Functions: ${display}`);
  }
  
  if (breakdown.hubFunctions > 0) {
    const capped = Math.round((breakdown.hubFunctions * cappingRatio) * 10) / 10;
    const display = showRawValues 
      ? `${chalk.yellow(`-${capped} pts`)} ${chalk.gray(`(raw: -${breakdown.hubFunctions})`)}`
      : chalk.yellow(`-${capped} points`);
    console.log(`  ├── Excessive Hub Functions: ${display}`);
  }
  
  if (breakdown.maxFanIn > 0) {
    const capped = Math.round((breakdown.maxFanIn * cappingRatio) * 10) / 10;
    const display = showRawValues 
      ? `${chalk.yellow(`-${capped} pts`)} ${chalk.gray(`(raw: -${breakdown.maxFanIn})`)}`
      : chalk.yellow(`-${capped} points`);
    console.log(`  ├── High Coupling (Fan-in): ${display}`);
  }
  
  if (breakdown.crossLayer > 0) {
    const capped = Math.round((breakdown.crossLayer * cappingRatio) * 10) / 10;
    const display = showRawValues 
      ? `${chalk.yellow(`-${capped} pts`)} ${chalk.gray(`(raw: -${breakdown.crossLayer})`)}`
      : chalk.yellow(`-${capped} points`);
    console.log(`  ├── Excessive Cross-Layer Dependencies: ${display}`);
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
 * Display layer-based PageRank analysis
 */
function displayLayerBasedPageRank(layerAnalysis: NonNullable<PageRankMetrics['layerBasedAnalysis']>): void {
  console.log('');
  console.log(chalk.cyan('📊 Layer-Based PageRank Analysis:'));
  console.log(`  ├── Total Layers: ${layerAnalysis.overallMetrics.totalLayers}`);
  console.log(`  ├── Analyzed Layers: ${layerAnalysis.overallMetrics.analyzedLayers}`);
  console.log(`  └── Total Functions: ${layerAnalysis.overallMetrics.totalFunctions}`);
  
  // Display each layer's results
  for (const layer of layerAnalysis.layerResults) {
    console.log('');
    console.log(chalk.yellow(`  🏗️  Layer: ${layer.layerName}`));
    console.log(`  ├── Functions: ${layer.functionCount}`);
    console.log(`  ├── Gini Coefficient: ${formatPercentage(layer.giniCoefficient * 100)}% ${getGiniRiskIndicator(layer.giniCoefficient)}`);
    
    if (layer.topFunctions.length > 0) {
      console.log(`  └── Top Central Functions:`);
      layer.topFunctions.forEach((func, index) => {
        const centralityPct = (func.centrality * 100).toFixed(1);
        const icon = index === 0 ? '👑' : index < 2 ? '⭐' : '🟢';
        const isLast = index === layer.topFunctions.length - 1;
        console.log(`      ${isLast ? '└──' : '├──'} ${icon} ${func.functionName} (${func.filePath}:${func.startLine}) [${centralityPct}%]`);
      });
    } else {
      console.log(`  └── No significant central functions`);
    }
  }
  
  // Display cross-layer insights
  if (layerAnalysis.crossLayerInsights.length > 0) {
    console.log('');
    console.log(chalk.yellow('  💡 Cross-Layer Insights:'));
    layerAnalysis.crossLayerInsights.forEach((insight, index) => {
      const isLast = index === layerAnalysis.crossLayerInsights.length - 1;
      console.log(`  ${isLast ? '└──' : '├──'} ${insight}`);
    });
  }
}

/**
 * Display PageRank centrality metrics
 */
export function displayPageRankMetrics(pageRank: PageRankMetrics, verbose: boolean = false): void {
  console.log(chalk.yellow('🎯 PageRank Centrality Analysis:'));
  
  const convergenceStatus = pageRank.converged 
    ? chalk.green(`✅ Converged in ${pageRank.iterations} iterations`)
    : chalk.red(`❌ Did not converge after ${pageRank.iterations} iterations`);
  
  console.log(`  ├── Convergence: ${convergenceStatus}`);
  console.log(`  ├── Functions Analyzed: ${pageRank.totalFunctions}`);
  console.log(`  ├── Average Score: ${pageRank.averageScore.toFixed(4)}`);
  console.log(`  ├── Max Score: ${pageRank.maxScore.toFixed(4)}`);
  
  // Display centrality distribution metrics
  const giniFormatted = formatPercentage(pageRank.centralityGini * 100);
  const varianceFormatted = formatPercentage(pageRank.centralityVariance * 100);
  
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
    // Calculate relative percentages based on the highest score
    const maxCentrality = Math.max(...topFunctions.map(f => f.centrality));
    
    topFunctions.forEach((func, index) => {
      // Show relative percentage where highest score = 100%
      const centralityPct = maxCentrality > 0 
        ? ((func.centrality / maxCentrality) * 100).toFixed(1)
        : '0.0';
      const icon = index === 0 ? '👑' : index < 3 ? '⭐' : '🟢';
      const location = func.filePath && func.startLine ? ` (${func.filePath}:${func.startLine})` : '';
      console.log(`  ${index === topFunctions.length - 1 ? '└──' : '├──'} ${icon} ${func.functionName}${location} (${centralityPct}%)`);
    });
  }
  
  // Display layer-based analysis if available (only in verbose mode)
  if (verbose && pageRank.layerBasedAnalysis) {
    displayLayerBasedPageRank(pageRank.layerBasedAnalysis);
  }
}

/**
 * Format percentage with validation to prevent NaN/Infinity display
 */
function formatPercentage(value: number): string {
  if (!isFinite(value) || isNaN(value)) {
    return '0.0';
  }
  return value.toFixed(1);
}

/**
 * Get risk indicator for Gini coefficient
 */
function getGiniRiskIndicator(gini: number): string {
  if (!isFinite(gini) || isNaN(gini)) {
    return chalk.green('✅ Even distribution');
  }
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