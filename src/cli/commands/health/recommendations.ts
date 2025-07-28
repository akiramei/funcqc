/**
 * Advanced Recommendation System
 * Restores the sophisticated recommendation generation that was removed
 */

import { FunctionInfo } from '../../../types';
import { FunctionRiskAssessment, RecommendedAction, RiskDistribution } from './types';
import { calculateEnhancedRiskStats, calculateRiskDistribution, calculateAverageRiskScore } from './risk-evaluator';

/**
 * Generate detailed risk analysis with specific recommendations
 */
export async function generateRiskAnalysis(
  riskAssessments: FunctionRiskAssessment[],
  functions: FunctionInfo[],
  includeRisks: boolean = false
): Promise<{
  recommendations: RecommendedAction[] | undefined;
  riskDetails: {
    distribution: RiskDistribution;
    percentages: { high: number; medium: number; low: number; critical: number };
    averageRiskScore: number;
    highestRiskFunction?: { name: string; riskScore: number; location: string } | undefined;
  };
}> {
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

  // Find highest risk function
  const highestRiskAssessment = riskAssessments.reduce((highest, current) => 
    current.riskScore > highest.riskScore ? current : highest, 
    riskAssessments[0]
  );

  const riskDetails = highestRiskAssessment ? {
    ...baseRiskDetails,
    highestRiskFunction: {
      name: highestRiskAssessment.functionName,
      riskScore: highestRiskAssessment.riskScore,
      location: `${highestRiskAssessment.filePath}:${highestRiskAssessment.startLine}`
    }
  } : baseRiskDetails;

  if (!includeRisks) {
    return { recommendations: undefined, riskDetails };
  }

  // Generate comprehensive recommendations
  const recommendations = await generateRecommendations(riskAssessments, distribution);
  
  return { recommendations, riskDetails };
}

/**
 * Generate detailed recommendations based on risk assessments
 */
async function generateRecommendations(
  riskAssessments: FunctionRiskAssessment[],
  distribution: RiskDistribution
): Promise<RecommendedAction[]> {
  const recommendations: RecommendedAction[] = [];

  // Get critical and high-risk functions
  const criticalFunctions = riskAssessments
    .filter(assessment => assessment.riskLevel === 'critical')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5);

  const highRiskFunctions = riskAssessments
    .filter(assessment => assessment.riskLevel === 'high')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);

  // Generate recommendations for critical functions
  criticalFunctions.forEach((assessment, index) => {
    const action = generateFunctionSpecificAction(assessment, 'critical');
    const suggestions = generateFunctionSpecificSuggestions(assessment);
    
    recommendations.push({
      priority: index + 1,
      functionName: assessment.functionName,
      filePath: assessment.filePath,
      startLine: assessment.startLine,
      endLine: assessment.endLine,
      riskScore: assessment.riskScore,
      action: action,
      suggestions: suggestions,
      metrics: {
        cyclomaticComplexity: assessment.metrics.cyclomaticComplexity,
        linesOfCode: assessment.metrics.linesOfCode
      }
    });
  });

  // Generate recommendations for high-risk functions
  highRiskFunctions.forEach((assessment, index) => {
    if (assessment.riskLevel !== 'critical') { // Avoid duplicates
      const action = generateFunctionSpecificAction(assessment, 'high');
      const suggestions = generateFunctionSpecificSuggestions(assessment);
      
      recommendations.push({
        priority: criticalFunctions.length + index + 1,
        functionName: assessment.functionName,
        filePath: assessment.filePath,
        startLine: assessment.startLine,
        endLine: assessment.endLine,
        riskScore: assessment.riskScore,
        action: action,
        suggestions: suggestions,
        metrics: {
          cyclomaticComplexity: assessment.metrics.cyclomaticComplexity,
          linesOfCode: assessment.metrics.linesOfCode
        }
      });
    }
  });

  // Add strategic recommendations based on overall distribution
  const strategicRecommendations = generateStrategicRecommendations(distribution, riskAssessments);
  recommendations.push(...strategicRecommendations);

  return recommendations.slice(0, 10); // Limit to top 10 recommendations
}

/**
 * Generate function-specific action recommendation
 */
function generateFunctionSpecificAction(
  assessment: FunctionRiskAssessment,
  priority: 'critical' | 'high'
): string {
  const primaryIssues = assessment.violations
    .filter(v => v.level === 'critical' || v.level === 'error')
    .map(v => v.type);

  if (primaryIssues.includes('complexity')) {
    return `${priority === 'critical' ? 'URGENT' : 'HIGH PRIORITY'}: Reduce cyclomatic complexity through function decomposition`;
  } else if (primaryIssues.includes('size')) {
    return `${priority === 'critical' ? 'URGENT' : 'HIGH PRIORITY'}: Break down large function into smaller, focused units`;
  } else if (primaryIssues.includes('cognitive')) {
    return `${priority === 'critical' ? 'URGENT' : 'HIGH PRIORITY'}: Simplify cognitive complexity by reducing branching logic`;
  } else if (primaryIssues.includes('parameters')) {
    return `${priority === 'critical' ? 'URGENT' : 'HIGH PRIORITY'}: Reduce parameter count using parameter objects or builder patterns`;
  } else if (primaryIssues.includes('nesting')) {
    return `${priority === 'critical' ? 'URGENT' : 'HIGH PRIORITY'}: Flatten nested logic using early returns and guard clauses`;
  } else {
    return `${priority === 'critical' ? 'URGENT' : 'HIGH PRIORITY'}: Comprehensive refactoring needed for multiple quality issues`;
  }
}

/**
 * Generate function-specific improvement suggestions
 */
function generateFunctionSpecificSuggestions(assessment: FunctionRiskAssessment): string[] {
  const suggestions: string[] = [];
  
  assessment.violations.forEach(violation => {
    switch (violation.type) {
      case 'complexity':
        suggestions.push('Extract complex logic into separate helper functions');
        suggestions.push('Use early returns to reduce branching complexity');
        suggestions.push('Consider using strategy pattern for complex conditional logic');
        break;
      case 'size':
        suggestions.push('Break function into smaller, single-purpose functions');
        suggestions.push('Extract reusable logic into utility functions');
        suggestions.push('Consider splitting into multiple methods or classes');
        break;
      case 'cognitive':
        suggestions.push('Simplify conditional logic and reduce nested if statements');
        suggestions.push('Use descriptive variable names to improve readability');
        suggestions.push('Consider using polymorphism instead of complex branching');
        break;
      case 'parameters':
        suggestions.push('Group related parameters into configuration objects');
        suggestions.push('Use builder pattern for functions with many optional parameters');
        suggestions.push('Consider dependency injection to reduce parameter passing');
        break;
      case 'nesting':
        suggestions.push('Use guard clauses to reduce nesting levels');
        suggestions.push('Extract nested logic into separate functions');
        suggestions.push('Consider using map/filter/reduce instead of nested loops');
        break;
      case 'maintainability':
        suggestions.push('Add comprehensive documentation and comments');
        suggestions.push('Improve variable and function naming for clarity');
        suggestions.push('Add unit tests to improve code confidence');
        break;
    }
  });

  return [...new Set(suggestions)].slice(0, 3); // Remove duplicates and limit to 3
}

/**
 * Generate strategic recommendations based on overall project health
 */
function generateStrategicRecommendations(
  distribution: RiskDistribution,
  riskAssessments: FunctionRiskAssessment[]
): RecommendedAction[] {
  const recommendations: RecommendedAction[] = [];
  const totalFunctions = distribution.critical + distribution.high + distribution.medium + distribution.low;

  // Strategic recommendation for high critical function count
  if (distribution.critical > totalFunctions * 0.05) { // More than 5% critical
    recommendations.push({
      priority: 1000, // High strategic priority
      functionName: 'PROJECT-WIDE',
      filePath: 'multiple files',
      startLine: 0,
      endLine: 0,
      riskScore: 10,
      action: 'STRATEGIC: Implement comprehensive code quality improvement program',
      suggestions: [
        'Establish coding standards and review processes',
        'Implement automated quality gates in CI/CD pipeline',
        'Schedule dedicated technical debt reduction sprints'
      ],
      metrics: {
        cyclomaticComplexity: 0,
        linesOfCode: 0
      }
    });
  }

  // Strategic recommendation for architecture issues
  const complexityIssues = riskAssessments.filter(a => 
    a.violations.some(v => v.type === 'complexity' && v.level === 'critical')
  ).length;

  if (complexityIssues > 5) {
    recommendations.push({
      priority: 1001,
      functionName: 'ARCHITECTURE',
      filePath: 'project structure',
      startLine: 0,
      endLine: 0,
      riskScore: 8,
      action: 'STRATEGIC: Review and refactor project architecture',
      suggestions: [
        'Consider implementing design patterns to reduce complexity',
        'Evaluate service decomposition for large modules',
        'Establish clear separation of concerns across layers'
      ],
      metrics: {
        cyclomaticComplexity: 0,
        linesOfCode: 0
      }
    });
  }

  return recommendations;
}


/**
 * Display top risk functions with detailed information
 */
export async function displayTopRisks(
  functions: FunctionInfo[], 
  enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>,
  verbose: boolean = false
): Promise<void> {
  console.log('\n🔍 Top High-Risk Functions:\n');

  // This would typically use the risk assessments, but for now we'll use a simplified version
  // In a full restoration, this would integrate with the complete risk evaluation system
  
  const highRiskFunctions = functions
    .filter(f => f.metrics && f.metrics.cyclomaticComplexity >= 10)
    .sort((a, b) => (b.metrics?.cyclomaticComplexity || 0) - (a.metrics?.cyclomaticComplexity || 0))
    .slice(0, 5);

  if (highRiskFunctions.length === 0) {
    console.log('✅ No high-risk functions detected based on current thresholds!');
    return;
  }

  highRiskFunctions.forEach((func, index) => {
    const complexity = func.metrics?.cyclomaticComplexity || 0;
    const loc = func.metrics?.linesOfCode || 0;
    const location = `${func.filePath}:${func.startLine}`;
    
    console.log(`${index + 1}. ${func.name}`);
    console.log(`   📍 Location: ${location}`);
    console.log(`   📊 Complexity: ${complexity}, Lines: ${loc}`);
    
    if (verbose) {
      console.log(`   ⚠️  Risk Factors:`);
      if (complexity >= 15) console.log(`      • Critical complexity (${complexity} ≥ 15)`);
      else if (complexity >= 10) console.log(`      • High complexity (${complexity} ≥ 10)`);
      if (loc >= 80) console.log(`      • Very large function (${loc} lines ≥ 80)`);
      else if (loc >= 40) console.log(`      • Large function (${loc} lines ≥ 40)`);
    }
    
    console.log('');
  });

  console.log(`📈 Risk Statistics:`);
  console.log(`   Average: ${enhancedRiskStats.average}`);
  console.log(`   Median: ${enhancedRiskStats.median}`);
  console.log(`   90th Percentile: ${enhancedRiskStats.p90}`);
  console.log(`   Critical Count: ${enhancedRiskStats.criticalCount}`);
  console.log(`   High Risk Count: ${enhancedRiskStats.highRiskCount}`);
}