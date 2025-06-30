import { FunctionInfo, RefactoringOpportunity, RefactoringPhase } from '../types';

export class RefactoringAnalyzer {
  // Pattern detection thresholds
  private static readonly VALIDATION_MIN_PARAM_COUNT = 2;
  private static readonly VALIDATION_MIN_BRANCH_COUNT = 3;
  private static readonly VALIDATION_MIN_FUNCTION_COUNT = 3;
  private static readonly VALIDATION_HIGH_PRIORITY_LINES = 100;
  private static readonly VALIDATION_SAVINGS_RATIO = 0.3;

  private static readonly ERROR_HANDLING_MIN_COMPLEXITY = 3;
  private static readonly ERROR_HANDLING_MIN_FUNCTION_COUNT = 4;
  private static readonly ERROR_HANDLING_HIGH_PRIORITY_COUNT = 8;
  private static readonly ERROR_HANDLING_SAVINGS_RATIO = 0.2;

  private static readonly TRANSFORM_MIN_COMPLEXITY = 3;
  private static readonly TRANSFORM_MAX_COMPLEXITY = 8;
  private static readonly TRANSFORM_MIN_FUNCTION_COUNT = 5;
  private static readonly TRANSFORM_HIGH_PRIORITY_LINES = 200;
  private static readonly TRANSFORM_SAVINGS_RATIO = 0.25;

  private static readonly CONDITIONAL_MIN_BRANCH_COUNT = 5;
  private static readonly CONDITIONAL_MIN_COMPLEXITY = 8;
  private static readonly CONDITIONAL_MIN_NESTING = 3;
  private static readonly CONDITIONAL_MIN_FUNCTION_COUNT = 3;
  private static readonly CONDITIONAL_SAVINGS_RATIO = 0.4;

  analyzeCommonPatterns(functions: FunctionInfo[]): RefactoringOpportunity[] {
    const opportunities: RefactoringOpportunity[] = [];
    
    // Pattern 1: Functions with repeated validation logic
    const validationPatterns = this.findValidationPatterns(functions);
    opportunities.push(...validationPatterns);
    
    // Pattern 2: Functions with similar error handling
    const errorHandlingPatterns = this.findErrorHandlingPatterns(functions);
    opportunities.push(...errorHandlingPatterns);
    
    // Pattern 3: Functions with repeated data transformation
    const transformationPatterns = this.findTransformationPatterns(functions);
    opportunities.push(...transformationPatterns);
    
    // Pattern 4: Functions with similar conditional structures
    const conditionalPatterns = this.findConditionalPatterns(functions);
    opportunities.push(...conditionalPatterns);
    
    return opportunities;
  }

  private findValidationPatterns(functions: FunctionInfo[]): RefactoringOpportunity[] {
    // Find functions that likely contain validation logic based on:
    // - Parameter count > 2
    // - Function name contains validation keywords
    // - High branch count (indicating multiple validations)
    
    const validationKeywords = ['validate', 'check', 'verify', 'ensure', 'assert'];
    const potentialValidationFunctions = functions.filter(func => {
      const hasValidationName = validationKeywords.some(keyword => 
        func.name.toLowerCase().includes(keyword));
      const hasMultipleParams = func.parameters.length > RefactoringAnalyzer.VALIDATION_MIN_PARAM_COUNT;
      const hasManyBranches = (func.metrics?.branchCount || 0) > RefactoringAnalyzer.VALIDATION_MIN_BRANCH_COUNT;
      
      return hasValidationName || (hasMultipleParams && hasManyBranches);
    });

    if (potentialValidationFunctions.length < RefactoringAnalyzer.VALIDATION_MIN_FUNCTION_COUNT) {
      return [];
    }

    const totalLines = potentialValidationFunctions.reduce((sum, func) => 
      sum + (func.metrics?.linesOfCode || 0), 0);
    const totalComplexity = potentialValidationFunctions.reduce((sum, func) => 
      sum + (func.metrics?.cyclomaticComplexity || 0), 0);
    const avgComplexity = totalComplexity / potentialValidationFunctions.length;

    return [{
      type: 'patterns',
      priority: totalLines > RefactoringAnalyzer.VALIDATION_HIGH_PRIORITY_LINES ? 'high' : 'medium',
      functions: potentialValidationFunctions,
      metrics: {
        totalComplexity,
        totalLines,
        avgComplexity,
        maxComplexity: potentialValidationFunctions.length > 0 ? Math.max(...potentialValidationFunctions.map(f => f.metrics?.cyclomaticComplexity || 0)) : 0,
        potentialSavings: totalLines * RefactoringAnalyzer.VALIDATION_SAVINGS_RATIO
      },
      description: `Common validation patterns (${potentialValidationFunctions.length} functions)`,
      recommendation: 'Consider creating shared validation utilities or a validation framework'
    }];
  }

  private findErrorHandlingPatterns(functions: FunctionInfo[]): RefactoringOpportunity[] {
    // Find functions with similar error handling patterns based on:
    // - Try-catch blocks
    // - Async functions (likely to have error handling)
    // - Functions with error-related names
    
    const errorKeywords = ['error', 'catch', 'handle', 'fail', 'exception'];
    const functionsWithErrorHandling = functions.filter(func => {
      const hasErrorName = errorKeywords.some(keyword => 
        func.name.toLowerCase().includes(keyword));
      const hasTryCatch = (func.metrics?.tryCatchCount || 0) > 0;
      const isAsyncWithComplexity = func.isAsync && (func.metrics?.cyclomaticComplexity || 0) > RefactoringAnalyzer.ERROR_HANDLING_MIN_COMPLEXITY;
      
      return hasErrorName || hasTryCatch || isAsyncWithComplexity;
    });

    if (functionsWithErrorHandling.length < RefactoringAnalyzer.ERROR_HANDLING_MIN_FUNCTION_COUNT) {
      return [];
    }

    const totalLines = functionsWithErrorHandling.reduce((sum, func) => 
      sum + (func.metrics?.linesOfCode || 0), 0);
    const totalComplexity = functionsWithErrorHandling.reduce((sum, func) => 
      sum + (func.metrics?.cyclomaticComplexity || 0), 0);
    const avgComplexity = totalComplexity / functionsWithErrorHandling.length;

    return [{
      type: 'patterns',
      priority: functionsWithErrorHandling.length > RefactoringAnalyzer.ERROR_HANDLING_HIGH_PRIORITY_COUNT ? 'high' : 'medium',
      functions: functionsWithErrorHandling,
      metrics: {
        totalComplexity,
        totalLines,
        avgComplexity,
        maxComplexity: functionsWithErrorHandling.length > 0 ? Math.max(...functionsWithErrorHandling.map(f => f.metrics?.cyclomaticComplexity || 0)) : 0,
        potentialSavings: totalLines * RefactoringAnalyzer.ERROR_HANDLING_SAVINGS_RATIO
      },
      description: `Repeated error handling patterns (${functionsWithErrorHandling.length} functions)`,
      recommendation: 'Consider implementing centralized error handling utilities or decorators'
    }];
  }

  private findTransformationPatterns(functions: FunctionInfo[]): RefactoringOpportunity[] {
    // Find functions that likely perform data transformation based on:
    // - Function names with transformation keywords
    // - Functions that return different types (indicating transformation)
    // - Functions with moderate complexity (transformation logic)
    
    const transformKeywords = ['transform', 'convert', 'map', 'format', 'parse', 'serialize', 'normalize'];
    const transformationFunctions = functions.filter(func => {
      const hasTransformName = transformKeywords.some(keyword => 
        func.name.toLowerCase().includes(keyword));
      const hasModerateComplexity = (func.metrics?.cyclomaticComplexity || 0) >= RefactoringAnalyzer.TRANSFORM_MIN_COMPLEXITY && 
                                   (func.metrics?.cyclomaticComplexity || 0) <= RefactoringAnalyzer.TRANSFORM_MAX_COMPLEXITY;
      
      return hasTransformName || (hasModerateComplexity && func.parameters.length > 0);
    });

    if (transformationFunctions.length < RefactoringAnalyzer.TRANSFORM_MIN_FUNCTION_COUNT) {
      return [];
    }

    const totalLines = transformationFunctions.reduce((sum, func) => 
      sum + (func.metrics?.linesOfCode || 0), 0);
    const totalComplexity = transformationFunctions.reduce((sum, func) => 
      sum + (func.metrics?.cyclomaticComplexity || 0), 0);
    const avgComplexity = totalComplexity / transformationFunctions.length;

    return [{
      type: 'patterns',
      priority: totalLines > RefactoringAnalyzer.TRANSFORM_HIGH_PRIORITY_LINES ? 'high' : 'medium',
      functions: transformationFunctions,
      metrics: {
        totalComplexity,
        totalLines,
        avgComplexity,
        maxComplexity: transformationFunctions.length > 0 ? Math.max(...transformationFunctions.map(f => f.metrics?.cyclomaticComplexity || 0)) : 0,
        potentialSavings: totalLines * RefactoringAnalyzer.TRANSFORM_SAVINGS_RATIO
      },
      description: `Data transformation patterns (${transformationFunctions.length} functions)`,
      recommendation: 'Consider creating reusable transformation utilities or a data mapping framework'
    }];
  }

  private findConditionalPatterns(functions: FunctionInfo[]): RefactoringOpportunity[] {
    // Find functions with complex conditional logic that might benefit from:
    // - Strategy pattern
    // - State machine
    // - Lookup tables
    
    const complexConditionalFunctions = functions.filter(func => {
      const highBranchCount = (func.metrics?.branchCount || 0) > RefactoringAnalyzer.CONDITIONAL_MIN_BRANCH_COUNT;
      const highComplexity = (func.metrics?.cyclomaticComplexity || 0) > RefactoringAnalyzer.CONDITIONAL_MIN_COMPLEXITY;
      const deepNesting = (func.metrics?.maxNestingLevel || 0) > RefactoringAnalyzer.CONDITIONAL_MIN_NESTING;
      
      return highBranchCount && (highComplexity || deepNesting);
    });

    if (complexConditionalFunctions.length < RefactoringAnalyzer.CONDITIONAL_MIN_FUNCTION_COUNT) {
      return [];
    }

    const totalLines = complexConditionalFunctions.reduce((sum, func) => 
      sum + (func.metrics?.linesOfCode || 0), 0);
    const totalComplexity = complexConditionalFunctions.reduce((sum, func) => 
      sum + (func.metrics?.cyclomaticComplexity || 0), 0);
    const avgComplexity = totalComplexity / complexConditionalFunctions.length;

    return [{
      type: 'patterns',
      priority: 'high', // Complex conditionals are high priority
      functions: complexConditionalFunctions,
      metrics: {
        totalComplexity,
        totalLines,
        avgComplexity,
        maxComplexity: complexConditionalFunctions.length > 0 ? Math.max(...complexConditionalFunctions.map(f => f.metrics?.cyclomaticComplexity || 0)) : 0,
        potentialSavings: totalComplexity * RefactoringAnalyzer.CONDITIONAL_SAVINGS_RATIO
      },
      description: `Complex conditional patterns (${complexConditionalFunctions.length} functions)`,
      recommendation: 'Consider refactoring using Strategy pattern, lookup tables, or state machines'
    }];
  }

  analyzeRefactoringPriority(functions: FunctionInfo[]): Array<FunctionInfo & { refactoringScore: number }> {
    // Sort functions by refactoring priority based on multiple factors
    return functions
      .filter(func => func.metrics) // Only include functions with metrics
      .map(func => ({
        ...func,
        refactoringScore: this.calculateRefactoringScore(func)
      }))
      .sort((a, b) => b.refactoringScore - a.refactoringScore);
  }

  private calculateRefactoringScore(func: FunctionInfo): number {
    if (!func.metrics) return 0;

    const metrics = func.metrics;
    let score = 0;

    // Complexity weight (40% of score)
    const complexityScore = Math.min(100, (metrics.cyclomaticComplexity / 20) * 100);
    score += complexityScore * 0.4;

    // Length weight (25% of score)
    const lengthScore = Math.min(100, (metrics.linesOfCode / 50) * 100);
    score += lengthScore * 0.25;

    // Nesting weight (20% of score)
    const nestingScore = Math.min(100, (metrics.maxNestingLevel / 5) * 100);
    score += nestingScore * 0.2;

    // Parameter count weight (10% of score)
    const paramScore = Math.min(100, (metrics.parameterCount / 8) * 100);
    score += paramScore * 0.1;

    // Maintainability penalty (5% of score)
    if (metrics.maintainabilityIndex && metrics.maintainabilityIndex < 60) {
      score += (60 - metrics.maintainabilityIndex) * 0.05;
    }

    return score;
  }

  generateRefactoringPlan(opportunities: RefactoringOpportunity[]): {
    phases: RefactoringPhase[];
    estimatedDuration: string;
    prerequisites: string[];
  } {
    const sortedOpportunities = this.sortOpportunitiesByPriority(opportunities);
    const phases = this.groupOpportunitiesIntoPhases(sortedOpportunities);
    this.estimateDurationForPhases(phases);

    const totalDays = phases.reduce((sum, phase) => sum + phase.estimatedDays, 0);
    const estimatedDuration = this.formatDuration(totalDays);
    const prerequisites = this.getRefactoringPrerequisites();

    return {
      phases,
      estimatedDuration,
      prerequisites
    };
  }

  private sortOpportunitiesByPriority(opportunities: RefactoringOpportunity[]): RefactoringOpportunity[] {
    return opportunities.sort((a, b) => {
      // Sort by priority first, then by potential impact
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      return b.metrics.potentialSavings - a.metrics.potentialSavings;
    });
  }

  private groupOpportunitiesIntoPhases(sortedOpportunities: RefactoringOpportunity[]): RefactoringPhase[] {
    const phases: RefactoringPhase[] = [];
    let currentPhase: RefactoringPhase = {
      name: 'Phase 1: Critical Issues',
      opportunities: [],
      estimatedDays: 0,
      dependencies: []
    };

    // Group opportunities into phases
    for (const opportunity of sortedOpportunities) {
      if (opportunity.priority === 'high' && currentPhase.name.includes('Critical')) {
        currentPhase.opportunities.push(opportunity);
      } else if (opportunity.priority === 'medium' && currentPhase.opportunities.length < 5) {
        if (currentPhase.name.includes('Critical') && currentPhase.opportunities.length > 0) {
          phases.push(currentPhase);
          currentPhase = {
            name: 'Phase 2: Medium Priority',
            opportunities: [opportunity],
            estimatedDays: 0,
            dependencies: []
          };
        } else {
          currentPhase.opportunities.push(opportunity);
        }
      } else {
        if (currentPhase.opportunities.length > 0) {
          phases.push(currentPhase);
        }
        currentPhase = {
          name: `Phase ${phases.length + 1}: Low Priority`,
          opportunities: [opportunity],
          estimatedDays: 0,
          dependencies: []
        };
      }
    }

    if (currentPhase.opportunities.length > 0) {
      phases.push(currentPhase);
    }

    return phases;
  }

  private estimateDurationForPhases(phases: RefactoringPhase[]): void {
    phases.forEach(phase => {
      phase.estimatedDays = this.estimatePhaseDuration(phase.opportunities);
    });
  }

  private getRefactoringPrerequisites(): string[] {
    return [
      'Ensure comprehensive test coverage before refactoring',
      'Set up automated quality metrics monitoring',
      'Create backup branches for all refactoring work',
      'Establish code review process for refactored code'
    ];
  }

  private estimatePhaseDuration(opportunities: RefactoringOpportunity[]): number {
    return opportunities.reduce((sum, opp) => {
      let baseDays = 0;
      
      switch (opp.type) {
        case 'complexity':
          baseDays = opp.functions.length * 0.5; // 0.5 days per complex function
          break;
        case 'similarity':
          baseDays = Math.max(1, opp.functions.length * 0.3); // 0.3 days per similar function
          break;
        case 'length':
          baseDays = opp.functions.length * 0.4; // 0.4 days per long function
          break;
        case 'patterns':
          baseDays = opp.functions.length * 0.2; // 0.2 days per function + pattern creation
          break;
      }
      
      // Apply priority multiplier
      const priorityMultiplier = opp.priority === 'high' ? 1.5 : 
                                opp.priority === 'medium' ? 1.2 : 1.0;
      
      return sum + (baseDays * priorityMultiplier);
    }, 0);
  }

  private formatDuration(days: number): string {
    if (days < 1) return 'Less than 1 day';
    if (days < 5) return `${Math.ceil(days)} days`;
    if (days < 10) return `1-2 weeks`;
    if (days < 20) return `2-4 weeks`;
    return `1-2 months`;
  }
}

