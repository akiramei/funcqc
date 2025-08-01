/**
 * Health Index calculation logic
 */

import { FunctionInfo } from '../../../types';
import { HealthData, StructuralMetrics, ComponentScore, StructuralPenaltyBreakdown } from './types';

/**
 * Calculate composite maintainability score from available metrics
 * This replaces the broken maintainabilityIndex with a realistic score
 * based on complexity, size, structure, and readability factors
 */
export function calculateCompositeMaintainability(metricsData: Array<{ 
  cyclomaticComplexity: number; 
  cognitiveComplexity: number;
  linesOfCode: number; 
  maxNestingLevel: number;
  parameterCount: number;
  commentLines: number;
  codeToCommentRatio: number;
}>): number {
  let totalScore = 0;
  
  for (const metrics of metricsData) {
    // Complexity factor (0-25 points) - lower complexity = higher score
    const complexityScore = Math.max(0, 25 - (metrics.cyclomaticComplexity * 1.5));
    
    // Cognitive load factor (0-25 points) - lower cognitive complexity = higher score  
    const cognitiveScore = Math.max(0, 25 - (metrics.cognitiveComplexity * 1.0));
    
    // Size factor (0-20 points) - shorter functions = higher score
    const sizeScore = Math.max(0, 20 - (metrics.linesOfCode * 0.4));
    
    // Structure factor (0-15 points) - less nesting = higher score
    const structureScore = Math.max(0, 15 - (metrics.maxNestingLevel * 3));
    
    // Parameter simplicity (0-10 points) - fewer parameters = higher score
    const paramScore = Math.max(0, 10 - (metrics.parameterCount * 1.5));
    
    // Documentation factor (0-10 points) - better documentation = higher score
    // Uses logarithmic scale to prevent saturation and reward extensive documentation
    const docScore = calculateDocumentationScore(metrics.codeToCommentRatio);
    
    // Combine factors (total 100 points possible)
    const functionScore = complexityScore + cognitiveScore + sizeScore + structureScore + paramScore + docScore;
    totalScore += functionScore;
  }
  
  return metricsData.length > 0 ? Math.round((totalScore / metricsData.length) * 100) / 100 : 50;
}

/**
 * Get grade from numeric score
 */
export function getGradeFromScore(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Fair';
  if (score >= 60) return 'Poor';
  return 'Critical';
}

/**
 * Calculate structural penalty based on SCC analysis results
 */
export function calculateStructuralPenalty(structuralData?: StructuralMetrics): number {
  const breakdown = calculateStructuralPenaltyBreakdown(structuralData);
  return breakdown.totalPenalty;
}

/**
 * Calculate saturated Fan-in penalty using logarithmic function
 * This prevents extreme outliers from dominating the penalty calculation
 */
function calculateSaturatedFanInPenalty(maxFanIn: number, structuralData: StructuralMetrics): number {
  // Use a reasonable baseline (p75) to normalize the penalty
  // For typical projects, p75 fan-in is usually around 5-15
  const baselineFanIn = Math.max(15, structuralData.hubThreshold || 10);
  
  // Logarithmic penalty: k * log(1 + (maxFanIn / baseline))
  // This grows more slowly than linear for extreme values
  const scalingFactor = 25; // Tuned to give reasonable penalties
  const normalizedRatio = maxFanIn / baselineFanIn;
  
  // Apply logarithmic scaling with a minimum threshold
  if (normalizedRatio <= 1.0) {
    // Below baseline: minimal penalty
    return Math.max(0, (maxFanIn - 10) * 0.5);
  } else {
    // Above baseline: logarithmic penalty
    const logPenalty = scalingFactor * Math.log1p(normalizedRatio - 1);
    return Math.round(logPenalty * 10) / 10;
  }
}

/**
 * Calculate cross-layer dependency penalty
 * Applies penalty when cross-layer dependencies exceed 50% threshold
 */
function calculateCrossLayerPenalty(structuralData: StructuralMetrics): number {
  // Extract cross-layer ratio from PageRank layer-based analysis
  const crossLayerRatio = structuralData.pageRank?.layerBasedAnalysis?.crossLayerRatio;
  
  if (!crossLayerRatio || crossLayerRatio <= 50) {
    return 0; // No penalty if cross-layer ratio is <= 50%
  }
  
  // Progressive penalty: (ratio - 50) * 0.3
  // Example: 70.1% -> (70.1 - 50) * 0.3 = 6.03 points penalty
  const excessRatio = crossLayerRatio - 50;
  const penalty = excessRatio * 0.3;
  
  return Math.max(0, penalty);
}

/**
 * Calculate detailed structural penalty breakdown
 */
export function calculateStructuralPenaltyBreakdown(structuralData?: StructuralMetrics): StructuralPenaltyBreakdown {
  if (!structuralData) {
    return {
      largestComponent: 0,
      cyclicFunctions: 0,
      hubFunctions: 0,
      maxFanIn: 0,
      crossLayer: 0,
      totalPenalty: 0,
      riskMultiplier: 1.0
    };
  }
  
  // Calculate individual penalty components
  const largestComponentPenalty = structuralData.largestComponentSize > 10 
    ? (structuralData.largestComponentSize - 10) * 2 
    : 0;
    
  const cyclicFunctionsPenalty = structuralData.cyclicFunctions > 5 
    ? (structuralData.cyclicFunctions - 5) * 3 
    : 0;
    
  const hubFunctionsPenalty = structuralData.hubFunctions > 20 
    ? (structuralData.hubFunctions - 20) * 1 
    : 0;
    
  // IMPROVED: Saturated Fan-in penalty using logarithmic function
  // This prevents extreme outliers from dominating the penalty calculation
  const maxFanInPenalty = structuralData.maxFanIn > 10 
    ? calculateSaturatedFanInPenalty(structuralData.maxFanIn, structuralData)
    : 0;
    
  // NEW: Cross-layer dependency penalty (priority 2)
  // Apply penalty when cross-layer dependencies exceed 50%
  const crossLayerPenalty = calculateCrossLayerPenalty(structuralData);
  
  // Calculate hub∩cycle overlap adjustment
  const { hubCyclicOverlap, duplicateAdjustment } = calculateOverlapAdjustment(
    structuralData.hubFunctionIds,
    structuralData.cyclicFunctionIds,
    hubFunctionsPenalty,
    cyclicFunctionsPenalty
  );
  
  const rawPenalty = largestComponentPenalty + cyclicFunctionsPenalty + hubFunctionsPenalty + maxFanInPenalty + crossLayerPenalty;
  const adjustedPenalty = rawPenalty - duplicateAdjustment;
  
  const totalPenalty = Math.min(adjustedPenalty, 50); // Cap at 50 points
  
  const riskMultiplier = getRiskMultiplier(structuralData.structuralRisk);
  
  return {
    largestComponent: Math.round(largestComponentPenalty * 10) / 10,
    cyclicFunctions: Math.round(cyclicFunctionsPenalty * 10) / 10,
    hubFunctions: Math.round(hubFunctionsPenalty * 10) / 10,
    maxFanIn: Math.round(maxFanInPenalty * 10) / 10,
    crossLayer: Math.round(crossLayerPenalty * 10) / 10,
    totalPenalty: Math.round(totalPenalty * 10) / 10,
    riskMultiplier,
    duplicateAdjustment: Math.round(duplicateAdjustment * 10) / 10,
    hubCyclicOverlap
  };
}

/**
 * Calculate quality metrics with Health Index integration
 */
export async function calculateQualityMetrics(
  functions: FunctionInfo[], 
  structuralData?: StructuralMetrics
): Promise<HealthData> {
  const functionsWithMetrics = functions.filter(f => f.metrics);
  const allMetrics = functionsWithMetrics.map(f => f.metrics!);
  
  if (allMetrics.length === 0) {
    throw new Error('No functions with metrics found');
  }

  // Calculate risk assessment for high-risk and critical function rates
  let highRiskFunctionRate: number | undefined;
  let criticalViolationRate: number | undefined;
  
  try {
    // Import risk evaluator components
    const { StatisticalEvaluator, ThresholdEvaluator, assessAllFunctions, calculateRiskDistribution } = 
      await import('./risk-evaluator');
    
    // Perform risk assessment
    const statisticalEvaluator = new StatisticalEvaluator();
    const thresholdEvaluator = new ThresholdEvaluator();
    const projectStats = statisticalEvaluator.calculateProjectStatistics(allMetrics);
    const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
    const riskAssessments = await assessAllFunctions(functionsWithMetrics, projectStats, thresholds);
    const riskDistribution = calculateRiskDistribution(riskAssessments);
    
    // Calculate rates as percentages
    const totalFunctions = functions.length;
    highRiskFunctionRate = totalFunctions > 0 
      ? ((riskDistribution.high + riskDistribution.critical) / totalFunctions) * 100 
      : 0;
    criticalViolationRate = totalFunctions > 0 
      ? (riskDistribution.critical / totalFunctions) * 100 
      : 0;
  } catch (error) {
    // If risk assessment fails, leave rates as undefined to show N/A
    console.warn('Risk assessment failed, some metrics will show as N/A:', error);
  }

  // Calculate individual component scores
  const complexityScores = allMetrics.map(m => Math.max(0, 100 - (m.cyclomaticComplexity * 4)));
  const maintainabilityScore = calculateCompositeMaintainability(allMetrics);
  const sizeScores = allMetrics.map(m => Math.max(0, 100 - (m.linesOfCode * 2)));

  const complexity: ComponentScore = {
    grade: getGradeFromScore(complexityScores.reduce((a, b) => a + b, 0) / complexityScores.length),
    score: Math.round(complexityScores.reduce((a, b) => a + b, 0) / complexityScores.length)
  };

  const maintainability: ComponentScore = {
    grade: getGradeFromScore(maintainabilityScore),
    score: Math.round(maintainabilityScore)
  };

  const codeSize: ComponentScore = {
    grade: getGradeFromScore(sizeScores.reduce((a, b) => a + b, 0) / sizeScores.length),
    score: Math.round(sizeScores.reduce((a, b) => a + b, 0) / sizeScores.length)
  };

  // Calculate traditional overall score (weighted average)
  const overallScore = Math.round(
    (complexity.score * 0.4) + 
    (maintainability.score * 0.4) + 
    (codeSize.score * 0.2)
  );

  // NEW: Calculate Health Index with structural integration
  const structuralPenalty = calculateStructuralPenalty(structuralData);
  const structuralDangerScore = structuralPenalty;
  
  // Health Index = Traditional score - Structural penalty
  const rawHealthIndex = Math.max(0, overallScore - structuralPenalty);
  
  // Apply risk-based multiplier for additional adjustment
  const riskMultiplier = getRiskMultiplier(structuralData?.structuralRisk);
  const healthIndex = Math.max(0, rawHealthIndex * riskMultiplier);
  const healthGrade = getGradeFromScore(healthIndex);

  const result: HealthData = {
    overallGrade: getGradeFromScore(overallScore),
    overallScore,
    healthIndex: Math.round(healthIndex * 100) / 100,
    healthGrade,
    complexity,
    maintainability,
    codeSize,
    structuralDangerScore,
    rawHealthIndex: Math.round(rawHealthIndex * 100) / 100, // For debugging/transparency
    ...(highRiskFunctionRate !== undefined && { highRiskFunctionRate }),
    ...(criticalViolationRate !== undefined && { criticalViolationRate }),
    totalFunctionCount: functions.length
  };

  if (structuralData) {
    result.structure = structuralData;
  }

  return result;
}

/**
 * Calculate overlap adjustment to prevent double penalty for hub∩cyclic functions
 */
function calculateOverlapAdjustment(
  hubFunctionIds?: string[],
  cyclicFunctionIds?: string[],
  hubPenalty: number = 0,
  cyclicPenalty: number = 0
): { hubCyclicOverlap: number; duplicateAdjustment: number } {
  if (!hubFunctionIds || !cyclicFunctionIds) {
    return { hubCyclicOverlap: 0, duplicateAdjustment: 0 };
  }
  
  // Find overlap: functions that are both hub and cyclic
  const hubSet = new Set(hubFunctionIds);
  const overlapFunctions = cyclicFunctionIds.filter(id => hubSet.has(id));
  const hubCyclicOverlap = overlapFunctions.length;
  
  if (hubCyclicOverlap === 0) {
    return { hubCyclicOverlap: 0, duplicateAdjustment: 0 };
  }
  
  // Calculate adjustment: reduce penalty for overlapping functions
  // Strategy: Apply 50% reduction of the smaller penalty for overlapping functions
  const smallerPenalty = Math.min(hubPenalty, cyclicPenalty);
  const overlapRatio = hubCyclicOverlap / Math.max(hubFunctionIds.length, cyclicFunctionIds.length, 1);
  const duplicateAdjustment = smallerPenalty * overlapRatio * 0.5;
  
  return { hubCyclicOverlap, duplicateAdjustment };
}

/**
 * Calculate documentation score using logarithmic scale to prevent saturation
 * and reward extensive documentation
 */
function calculateDocumentationScore(codeToCommentRatio: number): number {
  if (codeToCommentRatio <= 0) {
    return 0; // No documentation at all
  }
  
  // Logarithmic scale: log(1 + ratio * k) * multiplier
  // This prevents saturation and provides diminishing returns for extreme values
  const k = 4; // Scale factor to adjust sensitivity
  const multiplier = 3.5; // Max theoretical score adjustment
  
  // Calculate logarithmic score
  const logScore = Math.log(1 + codeToCommentRatio * k) * multiplier;
  
  // Cap at 10 points maximum
  return Math.min(logScore, 10);
}

/**
 * Get risk-based multiplier for health index adjustment
 */
function getRiskMultiplier(structuralRisk?: 'low' | 'medium' | 'high' | 'critical'): number {
  const multipliers = {
    low: 1.0,     // No adjustment for low risk
    medium: 0.95, // 5% reduction for medium risk
    high: 0.85,   // 15% reduction for high risk
    critical: 0.7 // 30% reduction for critical risk
  };
  
  return multipliers[structuralRisk ?? 'low'];
}