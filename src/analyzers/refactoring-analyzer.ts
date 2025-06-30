import { FunctionInfo, RefactoringOpportunity } from '../types';

export class RefactoringAnalyzer {
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
      const hasMultipleParams = func.parameters.length > 2;
      const hasManyBranches = (func.metrics?.branchCount || 0) > 3;
      
      return hasValidationName || (hasMultipleParams && hasManyBranches);
    });

    if (potentialValidationFunctions.length < 3) {
      return [];
    }

    const totalLines = potentialValidationFunctions.reduce((sum, func) => 
      sum + (func.metrics?.linesOfCode || 0), 0);
    const totalComplexity = potentialValidationFunctions.reduce((sum, func) => 
      sum + (func.metrics?.cyclomaticComplexity || 0), 0);
    const avgComplexity = totalComplexity / potentialValidationFunctions.length;

    return [{
      type: 'patterns',
      priority: totalLines > 100 ? 'high' : 'medium',
      functions: potentialValidationFunctions,
      metrics: {
        totalComplexity,
        totalLines,
        avgComplexity,
        maxComplexity: Math.max(...potentialValidationFunctions.map(f => f.metrics?.cyclomaticComplexity || 0)),
        potentialSavings: totalLines * 0.3 // Estimate 30% reduction through shared validation utilities
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
      const isAsyncWithComplexity = func.isAsync && (func.metrics?.cyclomaticComplexity || 0) > 3;
      
      return hasErrorName || hasTryCatch || isAsyncWithComplexity;
    });

    if (functionsWithErrorHandling.length < 4) {
      return [];
    }

    const totalLines = functionsWithErrorHandling.reduce((sum, func) => 
      sum + (func.metrics?.linesOfCode || 0), 0);
    const totalComplexity = functionsWithErrorHandling.reduce((sum, func) => 
      sum + (func.metrics?.cyclomaticComplexity || 0), 0);
    const avgComplexity = totalComplexity / functionsWithErrorHandling.length;

    return [{
      type: 'patterns',
      priority: functionsWithErrorHandling.length > 8 ? 'high' : 'medium',
      functions: functionsWithErrorHandling,
      metrics: {
        totalComplexity,
        totalLines,
        avgComplexity,
        maxComplexity: Math.max(...functionsWithErrorHandling.map(f => f.metrics?.cyclomaticComplexity || 0)),
        potentialSavings: totalLines * 0.2 // Estimate 20% reduction through shared error handling
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
      const hasModerateComplexity = (func.metrics?.cyclomaticComplexity || 0) >= 3 && 
                                   (func.metrics?.cyclomaticComplexity || 0) <= 8;
      
      return hasTransformName || (hasModerateComplexity && func.parameters.length > 0);
    });

    if (transformationFunctions.length < 5) {
      return [];
    }

    const totalLines = transformationFunctions.reduce((sum, func) => 
      sum + (func.metrics?.linesOfCode || 0), 0);
    const totalComplexity = transformationFunctions.reduce((sum, func) => 
      sum + (func.metrics?.cyclomaticComplexity || 0), 0);
    const avgComplexity = totalComplexity / transformationFunctions.length;

    return [{
      type: 'patterns',
      priority: totalLines > 200 ? 'high' : 'medium',
      functions: transformationFunctions,
      metrics: {
        totalComplexity,
        totalLines,
        avgComplexity,
        maxComplexity: Math.max(...transformationFunctions.map(f => f.metrics?.cyclomaticComplexity || 0)),
        potentialSavings: totalLines * 0.25 // Estimate 25% reduction through transformation utilities
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
      const highBranchCount = (func.metrics?.branchCount || 0) > 5;
      const highComplexity = (func.metrics?.cyclomaticComplexity || 0) > 8;
      const deepNesting = (func.metrics?.maxNestingLevel || 0) > 3;
      
      return highBranchCount && (highComplexity || deepNesting);
    });

    if (complexConditionalFunctions.length < 3) {
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
        maxComplexity: Math.max(...complexConditionalFunctions.map(f => f.metrics?.cyclomaticComplexity || 0)),
        potentialSavings: totalComplexity * 0.4 // Estimate 40% complexity reduction through pattern refactoring
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
    const sortedOpportunities = opportunities.sort((a, b) => {
      // Sort by priority first, then by potential impact
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      return b.metrics.potentialSavings - a.metrics.potentialSavings;
    });

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

    // Estimate duration for each phase
    phases.forEach(phase => {
      phase.estimatedDays = this.estimatePhaseDuration(phase.opportunities);
    });

    const totalDays = phases.reduce((sum, phase) => sum + phase.estimatedDays, 0);
    const estimatedDuration = this.formatDuration(totalDays);

    const prerequisites = [
      'Ensure comprehensive test coverage before refactoring',
      'Set up automated quality metrics monitoring',
      'Create backup branches for all refactoring work',
      'Establish code review process for refactored code'
    ];

    return {
      phases,
      estimatedDuration,
      prerequisites
    };
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

interface RefactoringPhase {
  name: string;
  opportunities: RefactoringOpportunity[];
  estimatedDays: number;
  dependencies: string[];
}