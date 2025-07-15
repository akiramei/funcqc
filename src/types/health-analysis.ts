/**
 * Health analysis types for refactor command integration
 */

import type { FunctionInfo } from './index';

/**
 * Results from AST pattern analysis for refactoring opportunities
 */
export interface PatternAnalysisResults {
  /** Positions of deeply nested if-statements */
  deeplyNestedIf: number[];
  /** List of parameter names indicating long parameter lists */
  longParameterList: string[];
  /** Magic numbers found in the code */
  magicNumbers: number[];
  /** Position of long switch statement, if any */
  longSwitchStatement: number | null;
  /** Positions of duplicated logic blocks */
  duplicatedLogic: number[];
}

/**
 * Structured refactoring recommendation for a specific function
 */
export interface RefactoringRecommendation {
  /** Priority score for refactoring (higher = more important) */
  priority: number;
  /** Name of the function to refactor */
  functionName: string;
  /** File path containing the function */
  filePath: string;
  /** Starting line number of the function */
  startLine: number;
  /** Ending line number of the function */
  endLine: number;
  /** Recommended action to take */
  action: string;
  /** Specific improvement suggestions */
  suggestions: string[];
  /** Key metrics for the function */
  metrics: {
    cyclomaticComplexity: number;
    linesOfCode: number;
  };
}

/**
 * Result of health analysis for a single function
 */
export interface HealthAnalysisResult {
  /** Unique identifier for the function */
  functionId: string;
  /** Display name of the function */
  functionName: string;
  /** Suggestions from health command analysis */
  healthSuggestions: string[];
  /** Suggestions from AST pattern analysis */
  astSuggestions: string[];
  /** Detected refactoring patterns */
  patterns: PatternAnalysisResults;
  /** Calculated refactoring priority score */
  priority: number;
  /** Estimated complexity reduction percentage */
  estimatedImpact: number;
}

/**
 * Comprehensive refactoring plan for a function
 */
export interface RefactoringPlan {
  /** Unique identifier for the function */
  functionId: string;
  /** Display name of the function */
  functionName: string;
  /** File path containing the function */
  filePath: string;
  /** Current cyclomatic complexity */
  complexity: number;
  /** Health-based improvement suggestions */
  healthSuggestions: string[];
  /** AST-based improvement suggestions */
  astSuggestions: string[];
  /** Calculated priority score (0-200) */
  priority: number;
  /** Estimated complexity reduction percentage */
  estimatedImpact: number;
  /** Generated Claude prompt for refactoring */
  claudePrompt: string;
  /** Detected refactoring patterns to apply */
  targetPatterns: string[];
}

/**
 * Health analysis service interface for intelligent refactoring
 */
export interface IHealthAnalysisService {
  /** Analyzes a single function using health intelligence */
  analyzeFunction(functionInfo: FunctionInfo): Promise<HealthAnalysisResult>;
  /** Generates refactoring plans for multiple functions */
  generateRefactoringPlan(functions: FunctionInfo[]): Promise<RefactoringPlan[]>;
  /** Calculates priority score for refactoring */
  calculateRefactoringPriority(functionInfo: FunctionInfo, suggestions: string[]): number;
  /** Estimates complexity reduction from suggestions */
  estimateComplexityReduction(suggestions: string[]): number;
  /** Generates intelligent Claude prompts */
  generateSmartPrompt(functionInfo: FunctionInfo, suggestions: string[]): string;
}