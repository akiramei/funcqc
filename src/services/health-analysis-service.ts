/**
 * Health Analysis Service for intelligent refactoring
 * Integrates health command analysis with refactor workflows
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
} from '../cli/commands/health';

export class HealthAnalysisService implements IHealthAnalysisService {
  
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
        // This would require access to the function node, which we'll enhance later
        // For now, use basic pattern detection from suggestions
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
  
  calculateRefactoringPriority(functionInfo: FunctionInfo, suggestions: string[]): number {
    let score = 0;
    
    // Base score from complexity
    const complexity = functionInfo.metrics?.cyclomaticComplexity || 0;
    score += Math.min(complexity * 10, 100); // Cap at 100
    
    // Additional score from suggestion count and severity
    score += suggestions.length * 5;
    
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
      score += 25;
    }
    
    // Score from maintainability issues
    const maintainability = functionInfo.metrics?.maintainabilityIndex || 100;
    if (maintainability < 50) {
      score += (50 - maintainability);
    }
    
    return Math.min(score, 200); // Cap at 200
  }
  
  estimateComplexityReduction(suggestions: string[]): number {
    let reduction = 0;
    
    // Pattern-specific complexity reduction estimates
    const reductionPatterns = [
      { pattern: 'early return', reduction: 30 },
      { pattern: 'extract method', reduction: 40 },
      { pattern: 'strategy pattern', reduction: 50 },
      { pattern: 'options object', reduction: 20 },
      { pattern: 'deeply nested', reduction: 35 },
      { pattern: 'switch statement', reduction: 25 }
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
    reduction += Math.max(0, unmatched) * 10;
    
    return Math.min(reduction, 80); // Cap at 80% reduction
  }
  
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
  
  private extractPatternsFromSuggestions(healthSuggestions: string[], astSuggestions: string[]): PatternAnalysisResults {
    const allSuggestions = [...healthSuggestions, ...astSuggestions];
    
    return {
      deeplyNestedIf: allSuggestions.some(s => s.includes('nested if')) ? [1] : [],
      longParameterList: allSuggestions.some(s => s.includes('parameter')) ? ['multiple'] : [],
      magicNumbers: allSuggestions.some(s => s.includes('magic number')) ? [1] : [],
      longSwitchStatement: allSuggestions.some(s => s.includes('switch')) ? 1 : null,
      duplicatedLogic: allSuggestions.some(s => s.includes('duplicated') || s.includes('extract')) ? [1] : []
    };
  }
  
  private extractTargetPatterns(healthSuggestions: string[], astSuggestions: string[]): string[] {
    const allSuggestions = [...healthSuggestions, ...astSuggestions];
    const patterns: string[] = [];
    
    const patternMapping = [
      { keywords: ['early return', 'nested if'], pattern: 'early-return' },
      { keywords: ['options object', 'parameter'], pattern: 'options-object' },
      { keywords: ['strategy pattern', 'switch'], pattern: 'strategy-pattern' },
      { keywords: ['extract method', 'duplicated'], pattern: 'extract-method' },
      { keywords: ['magic number', 'constant'], pattern: 'extract-constants' }
    ];
    
    for (const { keywords, pattern } of patternMapping) {
      const hasPattern = allSuggestions.some(suggestion => 
        keywords.some(keyword => suggestion.toLowerCase().includes(keyword))
      );
      
      if (hasPattern) {
        patterns.push(pattern);
      }
    }
    
    return patterns;
  }
}

// Create singleton instance for easy import
export const healthAnalysisService = new HealthAnalysisService();