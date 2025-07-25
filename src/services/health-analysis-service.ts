/**
 * Health Analysis Service for intelligent refactoring
 * Integrates health command analysis with refactor workflows
 * 
 * This service provides:
 * - Function-level health analysis using existing health command intelligence
 * - Priority-based refactoring planning
 * - Pattern-specific improvement recommendations
 * - Health-guided Claude prompt generation
 */

import type { FunctionInfo } from '../types/index';
import type { 
  HealthAnalysisResult, 
  RefactoringPlan, 
  PatternAnalysisResults,
  IHealthAnalysisService 
} from '../types/health-analysis';

import { 
  generateEnhancedSuggestions,
  analyzeSourceCodeForSuggestions
} from '../domain/health-analysis-logic';

export class HealthAnalysisService implements IHealthAnalysisService {
  
  // Priority calculation constants
  private readonly PRIORITY_WEIGHTS = {
    BASE_COMPLEXITY_MULTIPLIER: 10,
    MAX_COMPLEXITY_SCORE: 100,
    SUGGESTION_SCORE_MULTIPLIER: 5,
    HIGH_IMPACT_BONUS: 25,
    MAINTAINABILITY_THRESHOLD: 50,
    MAX_PRIORITY_SCORE: 200
  } as const;
  
  // Complexity reduction estimates by pattern (in percentage)
  private readonly REDUCTION_ESTIMATES = {
    EARLY_RETURN: 30,
    EXTRACT_METHOD: 40,
    STRATEGY_PATTERN: 50,
    OPTIONS_OBJECT: 20,
    DEEPLY_NESTED: 35,
    SWITCH_STATEMENT: 25,
    GENERIC_SUGGESTION: 10,
    MAX_REDUCTION: 80
  } as const;
  
  /**
   * Analyzes a single function using health command intelligence
   * @param functionInfo Function information including metrics and source code
   * @returns Comprehensive analysis including suggestions, patterns, and priorities
   */
  async analyzeFunction(functionInfo: FunctionInfo): Promise<HealthAnalysisResult> {
    // Get health-based suggestions
    const healthSuggestions = generateEnhancedSuggestions(functionInfo, functionInfo.metrics);
    
    // Get AST-based suggestions
    const astSuggestions = analyzeSourceCodeForSuggestions(functionInfo);
    
    // Analyze patterns (requires source code parsing)
    let patterns: PatternAnalysisResults = {
      deeplyNestedIf: [],
      longParameterList: [],
      magicNumbers: [],
      longSwitchStatement: null,
      duplicatedLogic: []
    };

    // Only analyze patterns if we have source code
    if (functionInfo.sourceCode) {
      try {
        // TODO: Enhanced AST-based pattern detection
        // Future enhancement: Direct AST node access for more accurate pattern detection
        // This would require integration with TypeScript Compiler API to parse
        // functionInfo.sourceCode and extract actual AST patterns
        // For now, use suggestion-based pattern detection as a viable alternative
        patterns = this.extractPatternsFromSuggestions(healthSuggestions, astSuggestions);
      } catch (error) {
        console.debug('Pattern analysis failed:', error);
      }
    }
    
    const priority = this.calculateRefactoringPriority(functionInfo, [...healthSuggestions, ...astSuggestions]);
    const estimatedImpact = this.estimateComplexityReduction([...healthSuggestions, ...astSuggestions]);
    
    return {
      functionId: functionInfo.id,
      functionName: functionInfo.displayName,
      healthSuggestions,
      astSuggestions,
      patterns,
      priority,
      estimatedImpact
    };
  }
  
  /**
   * Generates comprehensive refactoring plans for multiple functions
   * @param functions Array of function information to analyze
   * @returns Sorted refactoring plans (highest priority first)
   */
  async generateRefactoringPlan(functions: FunctionInfo[]): Promise<RefactoringPlan[]> {
    const plans: RefactoringPlan[] = [];
    
    for (const func of functions) {
      const analysis = await this.analyzeFunction(func);
      
      const plan: RefactoringPlan = {
        functionId: func.id,
        functionName: func.displayName,
        filePath: func.filePath,
        complexity: func.metrics?.cyclomaticComplexity || 0,
        healthSuggestions: analysis.healthSuggestions,
        astSuggestions: analysis.astSuggestions,
        priority: analysis.priority,
        estimatedImpact: analysis.estimatedImpact,
        claudePrompt: this.generateSmartPrompt(func, analysis.healthSuggestions),
        targetPatterns: this.extractTargetPatterns(analysis.healthSuggestions, analysis.astSuggestions)
      };
      
      plans.push(plan);
    }
    
    // Sort by priority (highest first)
    return plans.sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * Calculates intelligent refactoring priority based on multiple factors
   * @param functionInfo Function information including complexity metrics
   * @param suggestions Array of improvement suggestions from health analysis
   * @returns Priority score (0-200, higher means more important)
   */
  calculateRefactoringPriority(functionInfo: FunctionInfo, suggestions: string[]): number {
    let score = 0;
    
    // Base score from complexity
    const complexity = functionInfo.metrics?.cyclomaticComplexity || 0;
    score += Math.min(
      complexity * this.PRIORITY_WEIGHTS.BASE_COMPLEXITY_MULTIPLIER, 
      this.PRIORITY_WEIGHTS.MAX_COMPLEXITY_SCORE
    );
    
    // Additional score from suggestion count and severity
    score += suggestions.length * this.PRIORITY_WEIGHTS.SUGGESTION_SCORE_MULTIPLIER;
    
    // Bonus for specific high-impact patterns
    const highImpactPatterns = [
      'early return', 'deeply nested', 'strategy pattern', 
      'extract method', 'options object'
    ];
    
    const hasHighImpactPattern = suggestions.some(suggestion => 
      highImpactPatterns.some(pattern => 
        suggestion.toLowerCase().includes(pattern)
      )
    );
    
    if (hasHighImpactPattern) {
      score += this.PRIORITY_WEIGHTS.HIGH_IMPACT_BONUS;
    }
    
    // Score from maintainability issues
    const maintainability = functionInfo.metrics?.maintainabilityIndex || 100;
    if (maintainability < this.PRIORITY_WEIGHTS.MAINTAINABILITY_THRESHOLD) {
      score += (this.PRIORITY_WEIGHTS.MAINTAINABILITY_THRESHOLD - maintainability);
    }
    
    return Math.min(score, this.PRIORITY_WEIGHTS.MAX_PRIORITY_SCORE);
  }
  
  /**
   * Estimates potential complexity reduction from applying suggestions
   * @param suggestions Array of improvement suggestions
   * @returns Estimated complexity reduction percentage (0-80)
   */
  estimateComplexityReduction(suggestions: string[]): number {
    let reduction = 0;
    
    // Pattern-specific complexity reduction estimates
    const reductionPatterns = [
      { pattern: 'early return', reduction: this.REDUCTION_ESTIMATES.EARLY_RETURN },
      { pattern: 'extract method', reduction: this.REDUCTION_ESTIMATES.EXTRACT_METHOD },
      { pattern: 'strategy pattern', reduction: this.REDUCTION_ESTIMATES.STRATEGY_PATTERN },
      { pattern: 'options object', reduction: this.REDUCTION_ESTIMATES.OPTIONS_OBJECT },
      { pattern: 'deeply nested', reduction: this.REDUCTION_ESTIMATES.DEEPLY_NESTED },
      { pattern: 'switch statement', reduction: this.REDUCTION_ESTIMATES.SWITCH_STATEMENT }
    ];
    
    for (const suggestion of suggestions) {
      const lowerSuggestion = suggestion.toLowerCase();
      for (const { pattern, reduction: patternReduction } of reductionPatterns) {
        if (lowerSuggestion.includes(pattern)) {
          reduction += patternReduction;
          break; // Only count each suggestion once
        }
      }
    }
    
    // Generic reduction for other suggestions
    const unmatched = suggestions.length - reduction / 25; // Rough estimate
    reduction += Math.max(0, unmatched) * this.REDUCTION_ESTIMATES.GENERIC_SUGGESTION;
    
    return Math.min(reduction, this.REDUCTION_ESTIMATES.MAX_REDUCTION);
  }
  
  /**
   * Generates intelligent Claude prompts based on health analysis
   * @param functionInfo Function information including metrics and location
   * @param healthSuggestions Specific improvement suggestions from health analysis
   * @returns Formatted prompt with context, metrics, and specific guidance
   */
  generateSmartPrompt(functionInfo: FunctionInfo, healthSuggestions: string[]): string {
    const suggestions = healthSuggestions.map(s => `- ${s}`).join('\n');
    
    return `
Refactor the function \`${functionInfo.displayName}\` in \`${functionInfo.filePath}\` (lines ${functionInfo.startLine}–${functionInfo.endLine}).

Current metrics:
- Cyclomatic Complexity: ${functionInfo.metrics?.cyclomaticComplexity}
- Lines of Code: ${functionInfo.metrics?.linesOfCode}
- Nesting Level: ${functionInfo.metrics?.maxNestingLevel}
- Maintainability Index: ${functionInfo.metrics?.maintainabilityIndex?.toFixed(1)}

Health Analysis Recommendations:
${suggestions}

Refactoring goals based on health analysis:
- Apply the specific patterns suggested above
- Reduce cyclomatic complexity below 10
- Improve maintainability index above 70
- Maintain or improve test coverage
- Preserve all existing functionality

Important: This is health-guided refactoring. Focus on the specific patterns identified by the health analysis.
Use Extract Method pattern where appropriate to achieve genuine complexity reduction.
`;
  }
  
  /**
   * Extracts pattern information from health and AST suggestions
   * Uses more robust pattern matching compared to simple string includes
   * @param healthSuggestions Suggestions from health analysis
   * @param astSuggestions Suggestions from AST analysis  
   * @returns Structured pattern analysis results
   */
  private extractPatternsFromSuggestions(healthSuggestions: string[], astSuggestions: string[]): PatternAnalysisResults {
    const allSuggestions = [...healthSuggestions, ...astSuggestions];
    
    // More robust pattern detection using regex and multiple keyword matching
    const patterns = {
      nestedIf: /nested\s+if|deeply\s+nested|if\s+statement.*nested/i,
      parameter: /parameter.*object|long\s+parameter|many\s+parameter|\d+\s+parameter/i,
      magicNumber: /magic\s+number|hardcoded\s+value|literal\s+number/i,
      switchStatement: /switch\s+statement|long\s+switch|strategy\s+pattern/i,
      extraction: /extract\s+method|duplicated\s+logic|repeated\s+code/i
    };
    
    return {
      deeplyNestedIf: allSuggestions.some(s => patterns.nestedIf.test(s)) ? [1] : [],
      longParameterList: allSuggestions.some(s => patterns.parameter.test(s)) ? ['multiple'] : [],
      magicNumbers: allSuggestions.some(s => patterns.magicNumber.test(s)) ? [1] : [],
      longSwitchStatement: allSuggestions.some(s => patterns.switchStatement.test(s)) ? 1 : null,
      duplicatedLogic: allSuggestions.some(s => patterns.extraction.test(s)) ? [1] : []
    };
  }
  
  /**
   * Extracts target refactoring patterns from suggestions
   * Uses improved pattern matching for more accurate detection
   * @param healthSuggestions Suggestions from health analysis
   * @param astSuggestions Suggestions from AST analysis
   * @returns Array of detected refactoring patterns
   */
  private extractTargetPatterns(healthSuggestions: string[], astSuggestions: string[]): string[] {
    const allSuggestions = [...healthSuggestions, ...astSuggestions];
    const patterns: string[] = [];
    
    // Improved pattern mapping with regex for better accuracy
    const patternMapping = [
      { 
        regex: /early\s+return|nested\s+if|deeply\s+nested/i, 
        pattern: 'early-return' 
      },
      { 
        regex: /options\s+object|parameter.*object|\d+\s+parameter/i, 
        pattern: 'options-object' 
      },
      { 
        regex: /strategy\s+pattern|long\s+switch|switch\s+statement/i, 
        pattern: 'strategy-pattern' 
      },
      { 
        regex: /extract\s+method|duplicated\s+logic|repeated\s+code/i, 
        pattern: 'extract-method' 
      },
      { 
        regex: /magic\s+number|hardcoded\s+value|literal\s+number/i, 
        pattern: 'extract-constants' 
      }
    ];
    
    for (const { regex, pattern } of patternMapping) {
      const hasPattern = allSuggestions.some(suggestion => regex.test(suggestion));
      
      if (hasPattern) {
        patterns.push(pattern);
      }
    }
    
    return patterns;
  }
}

// Create singleton instance for easy import
export const healthAnalysisService = new HealthAnalysisService();