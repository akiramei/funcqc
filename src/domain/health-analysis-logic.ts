/**
 * Health Analysis Logic - Domain Layer
 * 
 * Pure business logic for health analysis that can be shared between
 * CLI commands and services without creating architectural violations.
 * 
 * This module contains:
 * - Enhanced suggestion generation logic
 * - Source code analysis for improvement recommendations
 * - AST pattern analysis for specific refactoring opportunities
 * - Recommended action generation based on risk assessments
 */

import * as ts from 'typescript';
import type { FunctionInfo, QualityMetrics as FunctionQualityMetrics, FunctionRiskAssessment } from '../types/index';

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

// Thresholds for quality metrics
const THRESHOLDS = {
  complexity: { high: 10, critical: 15 },
  linesOfCode: { large: 40, veryLarge: 80 },
  nesting: { high: 3, deep: 5 },
  parameters: { many: 4, tooMany: 6 },
  cognitive: { high: 15, veryHigh: 25 },
  branches: { many: 8 },
  loops: { multiple: 3 },
  maintainability: { veryLow: 30 },
  totalLines: { needsComments: 20 },
  estimatedBlockSize: 25
} as const;

/**
 * Analyze source code to generate specific improvement suggestions
 */
export function analyzeSourceCodeForSuggestions(functionInfo: FunctionInfo): string[] {
  const suggestions: string[] = [];
  
  if (!functionInfo.sourceCode) {
    return suggestions;
  }
  
  try {
    // Parse the source code to AST
    const sourceFile = ts.createSourceFile(
      'temp.ts',
      functionInfo.sourceCode,
      ts.ScriptTarget.Latest,
      true
    );
    
    // Find function node
    let functionNode: ts.FunctionLikeDeclaration | null = null;
    const findFunction = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
        functionNode = node as ts.FunctionLikeDeclaration;
        return;
      }
      ts.forEachChild(node, findFunction);
    };
    findFunction(sourceFile);
    
    if (!functionNode) {
      return suggestions;
    }
    
    // Analyze specific patterns
    const analysisResults = analyzeASTPatterns(functionNode);
    
    // Generate specific suggestions based on analysis
    if (analysisResults.deeplyNestedIf.length > 0) {
      const lines = analysisResults.deeplyNestedIf.map(pos => getLineNumber(functionInfo.sourceCode!, pos)).join(', ');
      suggestions.push(`Convert deeply nested if-statements at lines ${lines} to early return pattern`);
    }
    
    if (analysisResults.longParameterList && analysisResults.longParameterList.length > 4) {
      suggestions.push(`Replace ${analysisResults.longParameterList.length} parameters with options object pattern`);
    }
    
    if (analysisResults.magicNumbers.length > 0) {
      const numbers = analysisResults.magicNumbers.slice(0, 3).join(', ');
      suggestions.push(`Extract magic numbers (${numbers}) into named constants`);
    }
    
    if (analysisResults.longSwitchStatement) {
      const lineNum = getLineNumber(functionInfo.sourceCode!, analysisResults.longSwitchStatement);
      suggestions.push(`Consider strategy pattern for switch statement at line ${lineNum}`);
    }
    
    if (analysisResults.duplicatedLogic.length > 0) {
      suggestions.push(`Extract duplicated logic blocks into helper methods`);
    }
    
  } catch {
    // If AST parsing fails, fall back gracefully
  }
  
  return suggestions;
}

/**
 * Analyze AST patterns for specific improvement opportunities
 */
export function analyzeASTPatterns(functionNode: ts.FunctionLikeDeclaration) {
  const results = {
    deeplyNestedIf: [] as number[],
    longParameterList: [] as string[],
    magicNumbers: [] as number[],
    longSwitchStatement: null as number | null,
    duplicatedLogic: [] as number[]
  };
  
  let nestingLevel = 0;
  
  const visit = (node: ts.Node) => {
    // Track deeply nested if-statements
    if (ts.isIfStatement(node)) {
      if (nestingLevel > 2) {
        results.deeplyNestedIf.push(node.getStart());
      }
      nestingLevel++;
      ts.forEachChild(node, visit);
      nestingLevel--;
      return;
    }
    
    // Track switch statements with many cases
    if (ts.isSwitchStatement(node)) {
      const caseCount = node.caseBlock.clauses.length;
      if (caseCount > 7) {
        results.longSwitchStatement = node.getStart();
      }
    }
    
    // Track magic numbers
    if (ts.isNumericLiteral(node)) {
      const value = parseFloat(node.text);
      if (value > 1 && value !== 0 && value !== 100 && !Number.isNaN(value)) {
        results.magicNumbers.push(value);
      }
    }
    
    ts.forEachChild(node, visit);
  };
  
  // Analyze parameters
  if (functionNode.parameters) {
    results.longParameterList = functionNode.parameters.map(p => p.name.getText());
  }
  
  visit(functionNode);
  
  return results;
}

/**
 * Get line number from source position
 */
function getLineNumber(sourceCode: string, position: number): number {
  const lines = sourceCode.substring(0, position).split('\n');
  return lines.length;
}

/**
 * Generate enhanced specific suggestions with contextual information
 */
export function generateEnhancedSuggestions(
  functionInfo: FunctionInfo,
  metrics?: FunctionQualityMetrics
): string[] {
  const suggestions: string[] = [];
  const funcName = functionInfo.displayName;
  const totalLines = functionInfo.endLine - functionInfo.startLine + 1;
  
  // Analyze all metric types
  suggestions.push(...analyzeComplexity(funcName, metrics));
  suggestions.push(...analyzeSize(funcName, metrics));
  suggestions.push(...analyzeNesting(funcName, metrics));
  suggestions.push(...analyzeParameters(funcName, metrics));
  suggestions.push(...analyzeCognitiveComplexity(funcName, metrics));
  suggestions.push(...analyzeAdditionalMetrics(funcName, metrics));
  
  // Add AST-based specific suggestions
  const astSuggestions = analyzeSourceCodeForSuggestions(functionInfo);
  suggestions.push(...astSuggestions);
  
  // Add fallback suggestions if needed
  if (suggestions.length === 0) {
    suggestions.push(...generateFallbackSuggestions(funcName, totalLines, metrics));
  }
  
  // Limit suggestions to most important ones and remove duplicates
  const uniqueSuggestions = [...new Set(suggestions)];
  return uniqueSuggestions.slice(0, 5); // Top 5 most important suggestions
}

/**
 * Analyze cyclomatic complexity
 */
function analyzeComplexity(funcName: string, metrics?: FunctionQualityMetrics): string[] {
  if (!metrics?.cyclomaticComplexity || metrics.cyclomaticComplexity <= THRESHOLDS.complexity.high) {
    return [];
  }
  
  const complexity = metrics.cyclomaticComplexity;
  if (complexity > THRESHOLDS.complexity.critical) {
    return [`Critical complexity (${complexity}): Extract multiple methods from ${funcName} to reduce branching logic`];
  }
  return [`High complexity (${complexity}): Extract 2-3 helper methods from conditional blocks in ${funcName}`];
}

/**
 * Analyze function size
 */
function analyzeSize(funcName: string, metrics?: FunctionQualityMetrics): string[] {
  if (!metrics?.linesOfCode || metrics.linesOfCode <= THRESHOLDS.linesOfCode.large) {
    return [];
  }
  
  const loc = metrics.linesOfCode;
  const estimatedBlocks = Math.ceil(loc / THRESHOLDS.estimatedBlockSize);
  
  if (loc > THRESHOLDS.linesOfCode.veryLarge) {
    return [`Very large function (${loc} lines): Split ${funcName} into ${estimatedBlocks} focused functions`];
  }
  return [`Large function (${loc} lines): Extract validation and processing logic into separate methods`];
}

/**
 * Analyze nesting level
 */
function analyzeNesting(funcName: string, metrics?: FunctionQualityMetrics): string[] {
  if (!metrics?.maxNestingLevel || metrics.maxNestingLevel <= THRESHOLDS.nesting.high) {
    return [];
  }
  
  const nesting = metrics.maxNestingLevel;
  if (nesting > THRESHOLDS.nesting.deep) {
    return [`Deep nesting (${nesting} levels): Refactor nested conditions in ${funcName} using early returns and guard clauses`];
  }
  return [`High nesting (${nesting} levels): Convert nested if-statements to early return pattern in ${funcName}`];
}

/**
 * Analyze parameter count
 */
function analyzeParameters(funcName: string, metrics?: FunctionQualityMetrics): string[] {
  if (!metrics?.parameterCount || metrics.parameterCount <= THRESHOLDS.parameters.many) {
    return [];
  }
  
  const params = metrics.parameterCount;
  if (params > THRESHOLDS.parameters.tooMany) {
    return [`Too many parameters (${params}): Create configuration object for ${funcName} parameters`];
  }
  return [`Many parameters (${params}): Group related parameters into options object in ${funcName}`];
}

/**
 * Analyze cognitive complexity
 */
function analyzeCognitiveComplexity(funcName: string, metrics?: FunctionQualityMetrics): string[] {
  if (!metrics?.cognitiveComplexity || metrics.cognitiveComplexity <= THRESHOLDS.cognitive.high) {
    return [];
  }
  
  const cognitive = metrics.cognitiveComplexity;
  if (cognitive > THRESHOLDS.cognitive.veryHigh) {
    return [`Very high cognitive load (${cognitive}): Major refactoring needed for ${funcName} control flow`];
  }
  return [`High cognitive load (${cognitive}): Simplify switch/case statements and conditional logic in ${funcName}`];
}

/**
 * Analyze additional metrics (branches, loops, maintainability)
 */
function analyzeAdditionalMetrics(funcName: string, metrics?: FunctionQualityMetrics): string[] {
  const suggestions: string[] = [];
  
  if (metrics?.branchCount && metrics.branchCount > THRESHOLDS.branches.many) {
    suggestions.push(`Many branches (${metrics.branchCount}): Consider strategy pattern or lookup table for ${funcName}`);
  }
  
  if (metrics?.loopCount && metrics.loopCount > THRESHOLDS.loops.multiple) {
    suggestions.push(`Multiple loops (${metrics.loopCount}): Extract loop logic into separate methods in ${funcName}`);
  }
  
  if (metrics?.maintainabilityIndex && metrics.maintainabilityIndex < THRESHOLDS.maintainability.veryLow) {
    suggestions.push(`Very low maintainability (${metrics.maintainabilityIndex.toFixed(1)}): ${funcName} needs comprehensive refactoring`);
  }
  
  return suggestions;
}

/**
 * Generate fallback suggestions when no specific issues found
 */
function generateFallbackSuggestions(funcName: string, totalLines: number, metrics?: FunctionQualityMetrics): string[] {
  const suggestions: string[] = [];
  
  suggestions.push(`General refactoring to improve maintainability`);
  
  if (totalLines > THRESHOLDS.totalLines.needsComments) {
    suggestions.push(`Add inline comments to explain complex logic in ${funcName}`);
  }
  
  if (metrics?.commentLines === 0) {
    suggestions.push(`Add documentation comments for ${funcName} function`);
  }
  
  return suggestions;
}

/**
 * Generate recommended actions based on risk assessments
 */
export function generateRecommendedActions(
  riskAssessments: FunctionRiskAssessment[], 
  functions: FunctionInfo[]
): RecommendedAction[] {
  // 高リスク関数のみを対象として、最大10件まで
  const highRiskAssessments = riskAssessments
    .filter(assessment => assessment.riskLevel === 'high')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);
    
  return highRiskAssessments.map((assessment, index) => {
    const func = functions.find(f => f.id === assessment.functionId);
    if (!func) {
      throw new Error(`Function not found for assessment: ${assessment.functionId}`);
    }
    const endLine = func.endLine ?? func.startLine + (func.metrics?.linesOfCode || 10);
    
    // より具体的な推奨事項の生成（強化版）
    const suggestions = generateEnhancedSuggestions(func, func.metrics);
    
    return {
      priority: index + 1,
      functionName: func.displayName,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: endLine,
      riskScore: Math.round(assessment.riskScore),
      action: "General refactoring to improve maintainability",
      suggestions: suggestions,
      metrics: {
        cyclomaticComplexity: func.metrics?.cyclomaticComplexity || 0,
        linesOfCode: func.metrics?.linesOfCode || 0,
      },
    };
  });
}