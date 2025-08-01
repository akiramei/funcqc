/**
 * Detailed Recommendations System - RESTORED from original implementation
 * This module restores the sophisticated recommendation system that was deleted
 */

import chalk from 'chalk';
import { FunctionInfo } from '../../../types';
import { FunctionRiskAssessment, StructuralMetrics } from './types';
import { calculateEnhancedRiskStats } from './risk-evaluator';
import { CommandEnvironment } from '../../../types/environment';
import { generateStructuralRecommendations, StructuralRecommendation } from './structural-recommendations';


/**
 * Display detailed top risks with structural recommendations - ENHANCED
 */
export async function displayTopRisksWithDetails(
  functions: FunctionInfo[], 
  riskAssessments: FunctionRiskAssessment[],
  enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>,
  structuralMetrics: StructuralMetrics,
  depMetrics: import('../../../analyzers/dependency-metrics').DependencyMetrics[],
  snapshotId: string,
  env: CommandEnvironment,
  verbose: boolean = false,
  topN?: number
): Promise<void> {
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
  
  console.log(`  Critical Functions: ${criticalRiskFunctions} (${(criticalRiskFunctions / functions.length * 100).toFixed(1)}%)`);
  console.log(`  High-Risk Functions: ${enhancedRiskStats.highRiskCount} (${(enhancedRiskStats.highRiskCount / functions.length * 100).toFixed(1)}%)`);

  // Find and display highest risk function
  const highestRiskAssessment = riskAssessments
    .sort((a, b) => b.riskScore - a.riskScore)[0];
  
  if (highestRiskAssessment) {
    const topRiskFunction = functions.find(f => f.id === highestRiskAssessment.functionId);
    
    // Find most common violation type
    const violationTypeCount = allViolations.reduce((acc, v) => {
      acc[v.type] = (acc[v.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostCommonViolation = Object.entries(violationTypeCount)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'linesOfCode';
    
    const structuralTags = highestRiskAssessment.structuralTags ? 
      ` [${highestRiskAssessment.structuralTags.join(', ')}]` : '';
    console.log(`  Highest Risk Function: ${topRiskFunction?.name}()${structuralTags} (Risk: ${Math.round(highestRiskAssessment.riskScore)})`);
    console.log(`    Location: ${topRiskFunction?.filePath}:${topRiskFunction?.startLine}`);
    if (highestRiskAssessment.originalRiskScore && highestRiskAssessment.originalRiskScore !== highestRiskAssessment.riskScore) {
      console.log(`    Original Risk: ${Math.round(highestRiskAssessment.originalRiskScore)} → Structural Weight Applied: ${Math.round(highestRiskAssessment.riskScore)}`);
    }
    console.log(`  Most Common Violation: ${mostCommonViolation}`);
  }
  console.log('');

  // Generate and display structural recommendations
  console.log(chalk.yellow('Recommended Actions:'));
  const structuralRecommendations = await generateStructuralRecommendations(
    riskAssessments, 
    functions, 
    structuralMetrics, 
    depMetrics,
    snapshotId, 
    env, 
    topN ?? (verbose ? 10 : 3)
  );
  
  await displayStructuralRecommendations(structuralRecommendations, riskAssessments, verbose);
}

/**
 * Display structural recommendations with detailed information
 */
async function displayStructuralRecommendations(
  recommendations: StructuralRecommendation[],
  riskAssessments: FunctionRiskAssessment[],
  verbose: boolean
): Promise<void> {
  recommendations.forEach((rec, index) => {
    const assessment = riskAssessments.find(a => a.functionId === rec.functionId);
    const structuralTags = assessment?.structuralTags ? 
      ` [${assessment.structuralTags.join(', ')}]` : '';
    
    console.log(`${index + 1}. ${rec.functionName}()${structuralTags} in ${rec.filePath}:${rec.startLine}-${rec.endLine}`);
    
    // Show structural context - this is the key improvement
    const contextParts: string[] = [];
    contextParts.push(`Fan-in=${rec.fanIn}`);
    if (rec.crossLayerInfo) {
      contextParts.push(`Cross-layer=${rec.crossLayerInfo}`);
    }
    if (rec.sccInfo) {
      contextParts.push('SCC participant');
    }
    console.log(`   Why this? ${contextParts.join(', ')}`);
    
    // Show top callers
    if (rec.topCallers.length > 0) {
      console.log('   Top callers (by layer):');
      const displayCount = verbose ? rec.topCallers.length : Math.min(3, rec.topCallers.length);
      rec.topCallers.slice(0, displayCount).forEach(caller => {
        console.log(`     - ${caller.layer}::${caller.functionName}  (${caller.callCount})  | ${caller.layer}`);
      });
      if (!verbose && rec.topCallers.length > 3) {
        console.log(`     ... (${rec.topCallers.length - 3} more callers)`);
      }
    }
    
    // Show expected impact
    console.log('   Expected impact:');
    console.log(`     - Fan-in ${rec.expectedImpact.fanInReduction} → ${rec.expectedImpact.penaltyReduction}`);
    
    // Show refactor steps
    console.log('   Refactor steps:');
    const stepsToShow = verbose ? rec.refactorSteps : rec.refactorSteps.slice(0, 3);
    stepsToShow.forEach((step, stepIndex) => {
      console.log(`     ${stepIndex + 1}) ${step}`);
    });
    if (!verbose && rec.refactorSteps.length > 3) {
      console.log(`     ... and ${rec.refactorSteps.length - 3} more steps`);
      console.log(`     (Use --verbose to see all ${rec.refactorSteps.length} steps)`);
    }
    
    // Show success criteria
    if (verbose || rec.successCriteria.length <= 2) {
      console.log('   Success criteria:');
      rec.successCriteria.forEach(criteria => {
        console.log(`     ✓ ${criteria}`);
      });
    }
    
    console.log('');
  });
}


