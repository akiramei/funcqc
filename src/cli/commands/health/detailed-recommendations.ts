/**
 * Detailed Recommendations System - RESTORED from original implementation
 * This module restores the sophisticated recommendation system that was deleted
 */

import chalk from 'chalk';
import { FunctionInfo } from '../../../types';
import { FunctionRiskAssessment } from './types';
import { calculateEnhancedRiskStats } from './risk-evaluator';

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

/**
 * Display detailed top risks with recommendations - RESTORED from original implementation
 */
export async function displayTopRisksWithDetails(
  functions: FunctionInfo[], 
  riskAssessments: FunctionRiskAssessment[],
  enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>,
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

  // Generate and display detailed recommendations
  console.log(chalk.yellow('Recommended Actions:'));
  const recommendedActions = generateDetailedRecommendedActions(riskAssessments, functions, verbose, topN);
  
  recommendedActions.forEach((action) => {
    const assessment = riskAssessments.find(a => a.functionName === action.functionName);
    const structuralTags = assessment?.structuralTags ? 
      ` [${assessment.structuralTags.join(', ')}]` : '';
    
    console.log(`${action.priority}. ${action.functionName}()${structuralTags} in ${action.filePath}:${action.startLine}-${action.endLine}`);
    console.log(`   Action: ${action.action}`);
    
    if (verbose || action.suggestions.length <= 2) {
      // Show all suggestions in verbose mode or when there are only 2 or fewer
      action.suggestions.forEach(suggestion => {
        console.log(`   - ${suggestion}`);
      });
      if (verbose && action.suggestions.length > 2) {
        console.log(`   [Verbose mode: showing all ${action.suggestions.length} recommendations]`);
      }
    } else {
      // Show first 2 suggestions with truncation message
      action.suggestions.slice(0, 2).forEach(suggestion => {
        console.log(`   - ${suggestion}`);
      });
      console.log(`   ... and ${action.suggestions.length - 2} more steps`);
      console.log(`   (Use --verbose to see all ${action.suggestions.length} recommendations)`);
    }
    console.log('');
  });
}

/**
 * Generate detailed recommended actions - RESTORED from original implementation
 */
function generateDetailedRecommendedActions(
  riskAssessments: FunctionRiskAssessment[], 
  functions: FunctionInfo[],
  verbose: boolean = false,
  topN?: number
): RecommendedAction[] {
  // Determine number of recommendations: topN takes precedence, fallback to verbose/default logic
  const maxRecommendations = topN ?? (verbose ? 10 : 3);
  const highRiskAssessments = riskAssessments
    .filter(assessment => assessment.riskLevel === 'high' || assessment.riskLevel === 'critical')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, maxRecommendations);
    
  return highRiskAssessments.map((assessment, index) => {
    const func = functions.find(f => f.id === assessment.functionId);
    if (!func) {
      throw new Error(`Function not found for assessment: ${assessment.functionId}`);
    }
    const endLine = func.endLine ?? func.startLine + (func.metrics?.linesOfCode || 10);
    
    // Generate enhanced suggestions based on metrics and violations
    const suggestions = generateEnhancedSuggestions(func, assessment);
    
    return {
      priority: index + 1,
      functionName: func.name,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: endLine,
      riskScore: Math.round(assessment.riskScore),
      action: generateActionDescription(func, assessment),
      suggestions: suggestions,
      metrics: {
        cyclomaticComplexity: func.metrics?.cyclomaticComplexity || 0,
        linesOfCode: func.metrics?.linesOfCode || 0,
      },
    };
  });
}

/**
 * Generate action description based on function metrics and violations
 */
function generateActionDescription(func: FunctionInfo, assessment: FunctionRiskAssessment): string {
  const metrics = func.metrics;
  if (!metrics) return "General refactoring to improve maintainability";

  const violations = assessment.violations.filter(v => v.level === 'critical' || v.level === 'error');
  
  if (violations.some(v => v.type === 'complexity')) {
    if (metrics.cyclomaticComplexity >= 15) {
      return `Critical complexity (${metrics.cyclomaticComplexity}): Extract multiple methods from ${func.name} to reduce branching logic`;
    } else {
      return `High complexity (${metrics.cyclomaticComplexity}): Extract 2-3 helper methods from conditional blocks in ${func.name}`;
    }
  }
  
  if (violations.some(v => v.type === 'size')) {
    const loc = metrics.linesOfCode;
    const estimatedBlocks = Math.ceil(loc / 25); // 25 lines per block estimate
    if (loc >= 80) {
      return `Very large function (${loc} lines): Split ${func.name} into ${estimatedBlocks} focused functions`;
    } else {
      return `Large function (${loc} lines): Extract validation and processing logic into separate methods`;
    }
  }

  return "General refactoring to improve maintainability";
}

/**
 * Generate enhanced suggestions based on metrics and violations
 */
function generateEnhancedSuggestions(func: FunctionInfo, assessment: FunctionRiskAssessment): string[] {
  const suggestions: string[] = [];
  const metrics = func.metrics;
  
  if (!metrics) {
    suggestions.push("Add comprehensive documentation and comments");
    suggestions.push("Improve variable and function naming for clarity");
    return suggestions;
  }

  // Analyze violations and generate specific suggestions
  assessment.violations.forEach(violation => {
    switch (violation.type) {
      case 'complexity':
        if (metrics.cyclomaticComplexity >= 15) {
          suggestions.push(`Extract multiple methods from ${func.name} to reduce branching logic`);
          suggestions.push(`Use early returns to reduce branching complexity`);
        } else {
          suggestions.push(`Extract 2-3 helper methods from conditional blocks in ${func.name}`);
        }
        break;
        
      case 'size': {
        const loc = metrics.linesOfCode;
        const estimatedBlocks = Math.ceil(loc / 25);
        if (loc >= 80) {
          suggestions.push(`Split ${func.name} into ${estimatedBlocks} focused functions`);
        } else {
          suggestions.push(`Extract validation and processing logic into separate methods`);
        }
        break;
      }
        
      case 'cognitive':
        suggestions.push(`Simplify switch/case statements and conditional logic in ${func.name}`);
        suggestions.push(`Consider strategy pattern for complex conditional logic`);
        break;
        
      case 'parameters':
        if (metrics.parameterCount > 6) {
          suggestions.push(`Create configuration object for ${func.name} parameters`);
        } else {
          suggestions.push(`Group related parameters into options object in ${func.name}`);
        }
        break;
        
      case 'nesting':
        suggestions.push(`Convert nested if-statements to early return pattern in ${func.name}`);
        suggestions.push(`Use guard clauses to reduce nesting levels`);
        break;
        
      case 'maintainability':
        suggestions.push(`${func.name} needs comprehensive refactoring`);
        suggestions.push(`Add inline comments to explain complex logic`);
        break;
    }
  });

  // Add general suggestions if none specific
  if (suggestions.length === 0) {
    suggestions.push("General refactoring to improve maintainability");
    suggestions.push("Add comprehensive documentation and comments");
    suggestions.push("Improve variable and function naming for clarity");
  }

  // Remove duplicates and limit to top 5
  const uniqueSuggestions = [...new Set(suggestions)];
  return uniqueSuggestions.slice(0, 5);
}