/**
 * Health analysis types for refactor command integration
 */

import type { FunctionInfo } from './index';

export interface PatternAnalysisResults {
  deeplyNestedIf: number[];
  longParameterList: string[];
  magicNumbers: number[];
  longSwitchStatement: number | null;
  duplicatedLogic: number[];
}

export interface RefactoringRecommendation {
  priority: number;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  action: string;
  suggestions: string[];
  metrics: {
    cyclomaticComplexity: number;
    linesOfCode: number;
  };
}

export interface HealthAnalysisResult {
  functionId: string;
  functionName: string;
  healthSuggestions: string[];
  astSuggestions: string[];
  patterns: PatternAnalysisResults;
  priority: number;
  estimatedImpact: number;
}

export interface RefactoringPlan {
  functionId: string;
  functionName: string;
  filePath: string;
  complexity: number;
  healthSuggestions: string[];
  astSuggestions: string[];
  priority: number;
  estimatedImpact: number;
  claudePrompt: string;
  targetPatterns: string[];
}

/**
 * Health analysis service interface
 */
export interface IHealthAnalysisService {
  analyzeFunction(functionInfo: FunctionInfo): Promise<HealthAnalysisResult>;
  generateRefactoringPlan(functions: FunctionInfo[]): Promise<RefactoringPlan[]>;
  calculateRefactoringPriority(functionInfo: FunctionInfo, suggestions: string[]): number;
  estimateComplexityReduction(suggestions: string[]): number;
  generateSmartPrompt(functionInfo: FunctionInfo, suggestions: string[]): string;
}