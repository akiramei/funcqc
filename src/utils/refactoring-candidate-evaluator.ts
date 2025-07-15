/**
 * Refactoring Candidate Evaluator
 * 
 * Evaluates multiple refactoring candidates and selects the best one
 * based on quality metrics and constraints.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  RealTimeQualityGate,
  MultipleQualityAssessment,
  QualityAssessment,
} from '../core/realtime-quality-gate.js';
import { FunctionInfo } from '../types/index.js';

/**
 * Refactoring candidate with code and metadata
 */
export interface RefactoringCandidate {
  /** Unique identifier for the candidate */
  id: string;
  /** Human-readable name */
  name: string;
  /** Refactored code */
  code: string;
  /** Strategy used for refactoring */
  strategy: string;
  /** Expected improvement description */
  description: string;
  /** Metadata about the refactoring */
  metadata: {
    originalComplexity?: number;
    targetComplexity?: number;
    estimatedReduction?: number;
    patterns?: string[];
  };
}

/**
 * Evaluation result for a single candidate
 */
export interface CandidateEvaluation {
  /** The candidate that was evaluated */
  candidate: RefactoringCandidate;
  /** Quality assessment result */
  assessment: QualityAssessment | MultipleQualityAssessment;
  /** Calculated score for ranking */
  score: number;
  /** Whether the candidate is acceptable */
  acceptable: boolean;
  /** Detailed scoring breakdown */
  scoring: {
    qualityScore: number;
    improvementScore: number;
    structuralScore: number;
    complexityReduction: number;
  };
  /** Performance metrics */
  metrics: {
    evaluationTime: number;
    functionCount: number;
    avgComplexity: number;
  };
}

/**
 * Comparison result between candidates
 */
export interface CandidateComparison {
  /** All evaluated candidates sorted by score */
  candidates: CandidateEvaluation[];
  /** Best candidate */
  winner: CandidateEvaluation;
  /** Original code evaluation for comparison */
  baseline: CandidateEvaluation;
  /** Summary statistics */
  summary: {
    totalCandidates: number;
    acceptableCandidates: number;
    averageScore: number;
    bestStrategy: string;
    improvementAchieved: boolean;
  };
}

/**
 * Configuration for candidate evaluation
 */
export interface EvaluationConfig {
  /** Weight for quality score (0-1) */
  qualityWeight: number;
  /** Weight for improvement score (0-1) */
  improvementWeight: number;
  /** Weight for structural score (0-1) */
  structuralWeight: number;
  /** Minimum acceptable score */
  minAcceptableScore: number;
  /** Prefer candidates with fewer functions */
  penalizeFunctionCount: boolean;
  /** Timeout for evaluation in ms */
  evaluationTimeout: number;
}

/**
 * Evaluates multiple refactoring candidates and selects the best one
 */
export class RefactoringCandidateEvaluator {
  private qualityGate: RealTimeQualityGate;
  private config: EvaluationConfig;

  constructor(
    qualityGate: RealTimeQualityGate,
    config: Partial<EvaluationConfig> = {}
  ) {
    this.qualityGate = qualityGate;
    this.config = {
      qualityWeight: 0.4,
      improvementWeight: 0.3,
      structuralWeight: 0.3,
      minAcceptableScore: 70,
      penalizeFunctionCount: true,
      evaluationTimeout: 10000,
      ...config,
    };
  }

  /**
   * Evaluate multiple candidates and return the best one
   */
  async evaluateAndSelectBest(
    originalCode: string,
    candidates: RefactoringCandidate[]
  ): Promise<CandidateComparison> {
    // Evaluate the original code as baseline
    const baseline = await this.evaluateCandidate({
      id: 'original',
      name: 'Original Code',
      code: originalCode,
      strategy: 'none',
      description: 'Original unmodified code',
      metadata: {},
    });

    // Evaluate all candidates
    const evaluations = await Promise.all(
      candidates.map(candidate => this.evaluateCandidate(candidate))
    );

    // Sort by score (highest first)
    const sortedCandidates = evaluations.sort((a, b) => b.score - a.score);

    // Calculate summary statistics
    const acceptableCandidates = sortedCandidates.filter(c => c.acceptable);
    const averageScore = sortedCandidates.reduce((sum, c) => sum + c.score, 0) / sortedCandidates.length;
    const bestStrategy = sortedCandidates[0]?.candidate.strategy || 'none';
    const improvementAchieved = sortedCandidates[0]?.score > baseline.score;

    return {
      candidates: sortedCandidates,
      winner: sortedCandidates[0],
      baseline,
      summary: {
        totalCandidates: candidates.length,
        acceptableCandidates: acceptableCandidates.length,
        averageScore,
        bestStrategy,
        improvementAchieved,
      },
    };
  }

  /**
   * Evaluate a single candidate
   */
  async evaluateCandidate(candidate: RefactoringCandidate): Promise<CandidateEvaluation> {
    const startTime = performance.now();
    
    try {
      // Create temporary file
      const tempFile = path.join(os.tmpdir(), `funcqc-candidate-${candidate.id}-${Date.now()}.ts`);
      await fs.writeFile(tempFile, candidate.code, 'utf-8');

      let assessment: QualityAssessment | MultipleQualityAssessment;
      
      try {
        // Evaluate all functions in the candidate
        assessment = await this.qualityGate.evaluateAllFunctions(candidate.code, {
          filename: tempFile,
        });
      } finally {
        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {}); // Ignore cleanup errors
      }

      const evaluationTime = performance.now() - startTime;
      
      // Calculate metrics
      const metrics = this.calculateMetrics(assessment);
      
      // Calculate scoring
      const scoring = this.calculateScoring(assessment, candidate);
      
      // Calculate overall score
      const score = this.calculateOverallScore(scoring);
      
      // Determine acceptability
      const acceptable = this.isAcceptable(assessment, score);

      return {
        candidate,
        assessment,
        score,
        acceptable,
        scoring,
        metrics: {
          evaluationTime,
          ...metrics,
        },
      };
    } catch {
      // Return failed evaluation
      const evaluationTime = performance.now() - startTime;
      
      return {
        candidate,
        assessment: this.createFailedAssessment(),
        score: 0,
        acceptable: false,
        scoring: {
          qualityScore: 0,
          improvementScore: 0,
          structuralScore: 0,
          complexityReduction: 0,
        },
        metrics: {
          evaluationTime,
          functionCount: 0,
          avgComplexity: 0,
        },
      };
    }
  }

  /**
   * Calculate metrics from assessment
   */
  private calculateMetrics(assessment: QualityAssessment | MultipleQualityAssessment): {
    functionCount: number;
    avgComplexity: number;
  } {
    if (this.isMultipleAssessment(assessment)) {
      const functionCount = assessment.allFunctions.length;
      const avgComplexity = assessment.allFunctions.reduce((sum, f) => 
        sum + (f.functionInfo.metrics?.cyclomaticComplexity || 0), 0
      ) / functionCount;
      
      return { functionCount, avgComplexity };
    } else {
      return {
        functionCount: 1,
        avgComplexity: this.getAverageComplexity(assessment),
      };
    }
  }

  /**
   * Calculate detailed scoring breakdown
   */
  private calculateScoring(
    assessment: QualityAssessment | MultipleQualityAssessment,
    candidate: RefactoringCandidate
  ): {
    qualityScore: number;
    improvementScore: number;
    structuralScore: number;
    complexityReduction: number;
  } {
    let qualityScore: number;
    let structuralScore: number;
    
    if (this.isMultipleAssessment(assessment)) {
      qualityScore = assessment.aggregatedScore;
      structuralScore = assessment.allFunctions.reduce((sum, f) => 
        sum + f.assessment.structuralScore, 0
      ) / assessment.allFunctions.length;
    } else {
      qualityScore = assessment.qualityScore;
      structuralScore = assessment.structuralScore;
    }

    // Calculate improvement score based on expected vs actual
    const expectedReduction = candidate.metadata.estimatedReduction || 0;
    const actualReduction = Math.max(0, (candidate.metadata.originalComplexity || 0) - 
      (this.getAverageComplexity(assessment)));
    const improvementScore = Math.min(100, (actualReduction / Math.max(1, expectedReduction)) * 100);

    // Calculate complexity reduction percentage
    const complexityReduction = candidate.metadata.originalComplexity 
      ? Math.max(0, ((candidate.metadata.originalComplexity - this.getAverageComplexity(assessment)) / 
        candidate.metadata.originalComplexity) * 100)
      : 0;

    return {
      qualityScore,
      improvementScore,
      structuralScore,
      complexityReduction,
    };
  }

  /**
   * Calculate overall score using weighted average
   */
  private calculateOverallScore(scoring: {
    qualityScore: number;
    improvementScore: number;
    structuralScore: number;
    complexityReduction: number;
  }): number {
    const { qualityWeight, improvementWeight, structuralWeight } = this.config;
    
    return (
      scoring.qualityScore * qualityWeight +
      scoring.improvementScore * improvementWeight +
      scoring.structuralScore * structuralWeight
    );
  }

  /**
   * Determine if candidate is acceptable
   */
  private isAcceptable(
    assessment: QualityAssessment | MultipleQualityAssessment,
    score: number
  ): boolean {
    const meetsScoreThreshold = score >= this.config.minAcceptableScore;
    
    if (this.isMultipleAssessment(assessment)) {
      return meetsScoreThreshold && assessment.overallAcceptable;
    } else {
      return meetsScoreThreshold && assessment.acceptable;
    }
  }

  /**
   * Get average complexity from assessment
   */
  private getAverageComplexity(assessment: QualityAssessment | MultipleQualityAssessment): number {
    if (this.isMultipleAssessment(assessment)) {
      return assessment.allFunctions.reduce((sum, f) => 
        sum + (f.functionInfo.metrics?.cyclomaticComplexity || 0), 0
      ) / assessment.allFunctions.length;
    } else {
      // For single assessment, try to extract cyclomatic complexity from violations
      const complexityViolation = assessment.violations.find(v => v.metric === 'cyclomaticComplexity');
      if (complexityViolation) {
        return complexityViolation.value;
      }
      
      // Fallback: return 1 as minimum complexity (better than using fanOut)
      return 1;
    }
  }

  /**
   * Type guard for multiple assessment
   */
  private isMultipleAssessment(
    assessment: QualityAssessment | MultipleQualityAssessment
  ): assessment is MultipleQualityAssessment {
    return 'allFunctions' in assessment;
  }

  /**
   * Create failed assessment for error cases
   */
  private createFailedAssessment(): QualityAssessment {
    return {
      acceptable: false,
      qualityScore: 0,
      violations: [],
      structuralScore: 0,
      structuralAnomalies: [],
      structuralMetrics: undefined,
      improvementInstruction: 'Evaluation failed',
      responseTime: 0,
    };
  }
}

/**
 * Utility functions for creating refactoring candidates
 */
export class RefactoringCandidateGenerator {
  /**
   * Generate multiple refactoring candidates for a function
   */
  static generateCandidates(
    originalCode: string,
    functionInfo: FunctionInfo,
    strategies: string[] = ['early-return', 'extract-method', 'options-object']
  ): RefactoringCandidate[] {
    const candidates: RefactoringCandidate[] = [];
    
    strategies.forEach((strategy, index) => {
      const candidate = this.generateCandidate(originalCode, functionInfo, strategy, index);
      if (candidate) {
        candidates.push(candidate);
      }
    });

    return candidates;
  }

  /**
   * Generate a single candidate for a specific strategy
   */
  private static generateCandidate(
    originalCode: string,
    functionInfo: FunctionInfo,
    strategy: string,
    index: number
  ): RefactoringCandidate | null {
    const originalComplexity = functionInfo.metrics?.cyclomaticComplexity || 0;
    
    switch (strategy) {
      case 'early-return':
        return {
          id: `early-return-${index}`,
          name: 'Early Return Pattern',
          code: this.applyEarlyReturnPattern(originalCode),
          strategy,
          description: 'Reduce nesting with early returns',
          metadata: {
            originalComplexity,
            targetComplexity: Math.max(1, originalComplexity - 3),
            estimatedReduction: 30,
            patterns: ['early-return', 'reduce-nesting'],
          },
        };
        
      case 'extract-method':
        return {
          id: `extract-method-${index}`,
          name: 'Extract Method',
          code: this.applyExtractMethodPattern(originalCode),
          strategy,
          description: 'Split function into smaller methods',
          metadata: {
            originalComplexity,
            targetComplexity: Math.max(1, originalComplexity - 5),
            estimatedReduction: 40,
            patterns: ['extract-method', 'split-function'],
          },
        };
        
      case 'options-object':
        return {
          id: `options-object-${index}`,
          name: 'Options Object Pattern',
          code: this.applyOptionsObjectPattern(originalCode),
          strategy,
          description: 'Replace multiple parameters with options object',
          metadata: {
            originalComplexity,
            targetComplexity: Math.max(1, originalComplexity - 1),
            estimatedReduction: 20,
            patterns: ['options-object', 'parameter-object'],
          },
        };
        
      default:
        return null;
    }
  }

  /**
   * Apply early return pattern (simplified implementation)
   */
  private static applyEarlyReturnPattern(code: string): string {
    // This is a simplified implementation
    // In a real implementation, you would use AST manipulation
    return code.replace(/if\s*\(/g, 'if (').replace(/\s*\{\s*return/g, ' {\n  return');
  }

  /**
   * Apply extract method pattern (simplified implementation)
   */
  private static applyExtractMethodPattern(code: string): string {
    // This is a simplified implementation
    // In a real implementation, you would use AST manipulation
    return code + '\n\n// Helper method extracted\nfunction helperMethod() {\n  // Implementation\n}';
  }

  /**
   * Apply options object pattern (simplified implementation)
   */
  private static applyOptionsObjectPattern(code: string): string {
    // This is a simplified implementation
    // In a real implementation, you would use AST manipulation
    return code.replace(/function\s+(\w+)\s*\([^)]+\)/g, 'function $1(options)');
  }
}