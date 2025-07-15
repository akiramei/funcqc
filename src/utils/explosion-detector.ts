import {
  FunctionInfo,
  QualityMetrics,
  RefactoringOperation,
  StorageAdapter,
  RefactoringChangeset,
  LineageManager,
  ChangesetMetrics,
} from '../types/index.js';
import { createErrorHandler } from './error-handler.js';
import { Logger } from './cli-utils.js';

/**
 * ExplosionDetectionResult
 * 
 * Represents the result of function explosion detection analysis
 */
export interface ExplosionDetectionResult {
  /** Whether function explosion was detected */
  isExplosion: boolean;
  
  /** Explosion score (0.0 = no explosion, 1.0+ = severe explosion) */
  explosionScore: number;
  
  /** Classification of explosion severity */
  severity: 'none' | 'minor' | 'moderate' | 'severe' | 'critical';
  
  /** Detailed metrics about the explosion */
  metrics: {
    /** Number of original functions before refactoring */
    originalFunctionCount: number;
    
    /** Number of functions after refactoring */
    resultingFunctionCount: number;
    
    /** Number of new functions created */
    newFunctionCount: number;
    
    /** Ratio of new functions to original functions */
    explosionRatio: number;
    
    /** Average complexity of original functions */
    originalAverageComplexity: number;
    
    /** Average complexity of resulting functions */
    resultingAverageComplexity: number;
    
    /** Total lines of code before refactoring */
    originalLinesOfCode: number;
    
    /** Total lines of code after refactoring */
    resultingLinesOfCode: number;
    
    /** Code expansion ratio (>1.0 indicates code bloat) */
    codeExpansionRatio: number;
  };
  
  /** Reasons why explosion was or wasn't detected */
  reasons: string[];
  
  /** Recommendations for addressing explosion */
  recommendations: string[];
}

/**
 * ExplosionDetectionConfig
 * 
 * Configuration for function explosion detection thresholds
 */
export interface ExplosionDetectionConfig {
  /** Threshold for explosion ratio (new functions / original functions) */
  explosionRatioThreshold: number;
  
  /** Threshold for code expansion ratio (after LOC / before LOC) */
  codeExpansionThreshold: number;
  
  /** Minimum complexity reduction required to justify function splitting */
  minimumComplexityReduction: number;
  
  /** Maximum acceptable explosion score */
  maximumExplosionScore: number;
  
  /** Penalty multiplier for excessive function creation */
  explosionPenaltyMultiplier: number;
  
  /** Minimum average function size before fragmentation penalty */
  minimumAverageFunctionSize: number;
  
  /** Enable strict mode (more conservative thresholds) */
  strictMode: boolean;
}

/**
 * DefaultExplosionDetectionConfig
 * 
 * Default configuration values based on research and best practices
 */
export const DefaultExplosionDetectionConfig: ExplosionDetectionConfig = {
  explosionRatioThreshold: 0.3,  // No more than 30% increase in function count
  codeExpansionThreshold: 1.2,   // No more than 20% increase in total LOC
  minimumComplexityReduction: 5, // At least 5% complexity reduction required
  maximumExplosionScore: 0.3,    // Maximum acceptable explosion score
  explosionPenaltyMultiplier: 2, // Penalty multiplier for explosion
  minimumAverageFunctionSize: 5, // Functions smaller than 5 lines are considered fragmented
  strictMode: false,             // Default to lenient mode
};

/**
 * FunctionExplosionDetector
 * 
 * Advanced detection system for identifying excessive function splitting that
 * creates artificial quality improvements without genuine benefit.
 * 
 * Key features:
 * - Multi-dimensional explosion analysis (count, complexity, LOC)
 * - Configurable thresholds for different explosion types
 * - Integration with existing RefactoringHealthEngine
 * - Detailed recommendations for addressing explosions
 */
export class FunctionExplosionDetector {
  private readonly logger: Logger;
  private readonly config: ExplosionDetectionConfig;

  constructor(
    private storage: StorageAdapter,
    private lineageManager: LineageManager,
    config: Partial<ExplosionDetectionConfig> = {},
    logger?: Logger
  ) {
    this.logger = logger || new Logger(false, false);
    // Initialize error handler if needed
    createErrorHandler(this.logger);
    this.config = { ...DefaultExplosionDetectionConfig, ...config };
  }

  /**
   * Detect function explosion in a refactoring operation
   */
  async detectExplosion(operation: RefactoringOperation): Promise<ExplosionDetectionResult> {
    try {
      // Get function information for parent and children
      const parentFunction = await this.getFunctionInfo(operation.parentFunction);
      const childFunctions = await Promise.all(
        operation.childFunctions.map(id => this.getFunctionInfo(id))
      );

      // Filter out null results
      const validChildFunctions = childFunctions.filter(f => f !== null) as FunctionInfo[];
      
      if (!parentFunction) {
        return this.createNoExplosionResult('Parent function not found');
      }

      if (validChildFunctions.length === 0) {
        return this.createNoExplosionResult('No valid child functions found');
      }

      // Calculate basic metrics
      const metrics = this.calculateExplosionMetrics(parentFunction, validChildFunctions);
      
      // Detect explosion based on multiple criteria
      const explosionScore = this.calculateExplosionScore(parentFunction, validChildFunctions, metrics);
      const severity = this.classifyExplosionSeverity(explosionScore);
      const isExplosion = explosionScore > this.config.maximumExplosionScore;
      
      // Generate reasons and recommendations
      const reasons = this.generateExplosionReasons(metrics, explosionScore, isExplosion);
      const recommendations = this.generateRecommendations(metrics, severity, isExplosion);

      return {
        isExplosion,
        explosionScore,
        severity,
        metrics,
        reasons,
        recommendations,
      };
      
    } catch (error) {
      this.logger.error('Error detecting function explosion', { 
        operation, 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      // Return safe default result on error
      return this.createNoExplosionResult('Error occurred during explosion detection');
    }
  }

  /**
   * Detect explosion in a changeset using before/after snapshots
   */
  async detectChangesetExplosion(changeset: RefactoringChangeset): Promise<ExplosionDetectionResult> {
    try {
      // Get functions from before and after snapshots
      const beforeFunctions = await this.storage.getFunctionsBySnapshotId(changeset.beforeSnapshotId);
      const afterFunctions = await this.storage.getFunctionsBySnapshotId(changeset.afterSnapshotId);

      // Calculate changeset metrics
      const beforeMetrics = await this.lineageManager.calculateChangesetMetrics(beforeFunctions);
      const afterMetrics = await this.lineageManager.calculateChangesetMetrics(afterFunctions);

      // Calculate explosion metrics for the entire changeset
      const explosionScore = this.calculateChangesetExplosionScore(beforeMetrics, afterMetrics);
      const severity = this.classifyExplosionSeverity(explosionScore);
      const isExplosion = explosionScore > this.config.maximumExplosionScore;

      // Create metrics object
      const metrics = {
        originalFunctionCount: beforeMetrics.functionCount,
        resultingFunctionCount: afterMetrics.functionCount,
        newFunctionCount: afterMetrics.functionCount - beforeMetrics.functionCount,
        explosionRatio: beforeMetrics.functionCount > 0 ? 
          (afterMetrics.functionCount - beforeMetrics.functionCount) / beforeMetrics.functionCount : 0,
        originalAverageComplexity: beforeMetrics.averageComplexity,
        resultingAverageComplexity: afterMetrics.averageComplexity,
        originalLinesOfCode: beforeMetrics.totalLinesOfCode,
        resultingLinesOfCode: afterMetrics.totalLinesOfCode,
        codeExpansionRatio: beforeMetrics.totalLinesOfCode > 0 ? 
          afterMetrics.totalLinesOfCode / beforeMetrics.totalLinesOfCode : 1,
      };

      const reasons = this.generateChangesetExplosionReasons(beforeMetrics, afterMetrics, explosionScore, isExplosion);
      const recommendations = this.generateChangesetRecommendations(beforeMetrics, afterMetrics, severity, isExplosion);

      return {
        isExplosion,
        explosionScore,
        severity,
        metrics,
        reasons,
        recommendations,
      };

    } catch (error) {
      this.logger.error('Error detecting changeset explosion', { 
        changesetId: changeset.id, 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return this.createNoExplosionResult('Error occurred during changeset explosion detection');
    }
  }

  /**
   * Calculate explosion metrics for parent-child function relationships
   */
  private calculateExplosionMetrics(
    parent: FunctionInfo, 
    children: FunctionInfo[]
  ): ExplosionDetectionResult['metrics'] {
    const parentMetrics = parent.metrics;
    const childMetrics = children.map(f => f.metrics).filter(m => m !== undefined) as QualityMetrics[];

    // Calculate totals for children
    const totalChildComplexity = childMetrics.reduce((sum, m) => sum + m.cyclomaticComplexity, 0);
    const totalChildLOC = childMetrics.reduce((sum, m) => sum + m.linesOfCode, 0);

    return {
      originalFunctionCount: 1, // Single parent function
      resultingFunctionCount: children.length,
      newFunctionCount: children.length - 1, // Subtract 1 since parent is replaced
      explosionRatio: children.length - 1, // Ratio relative to single parent
      originalAverageComplexity: parentMetrics?.cyclomaticComplexity || 0,
      resultingAverageComplexity: childMetrics.length > 0 ? totalChildComplexity / childMetrics.length : 0,
      originalLinesOfCode: parentMetrics?.linesOfCode || 0,
      resultingLinesOfCode: totalChildLOC,
      codeExpansionRatio: (parentMetrics?.linesOfCode || 0) > 0 ? 
        totalChildLOC / (parentMetrics?.linesOfCode || 1) : 1,
    };
  }

  /**
   * Calculate explosion score based on multiple factors
   */
  private calculateExplosionScore(
    _parent: FunctionInfo,
    _children: FunctionInfo[],
    metrics: ExplosionDetectionResult['metrics']
  ): number {
    let score = 0;

    // Factor 1: Function count explosion
    const functionCountPenalty = Math.max(0, metrics.explosionRatio - this.config.explosionRatioThreshold);
    score += functionCountPenalty * this.config.explosionPenaltyMultiplier;

    // Factor 2: Code expansion without complexity reduction
    const codeExpansionPenalty = Math.max(0, metrics.codeExpansionRatio - this.config.codeExpansionThreshold);
    score += codeExpansionPenalty * 0.5;

    // Factor 3: Insufficient complexity reduction
    const complexityReduction = metrics.originalAverageComplexity - metrics.resultingAverageComplexity;
    const complexityReductionPercentage = metrics.originalAverageComplexity > 0 ? 
      (complexityReduction / metrics.originalAverageComplexity) * 100 : 0;
    
    if (complexityReductionPercentage < this.config.minimumComplexityReduction) {
      score += 0.2; // Penalty for insufficient complexity reduction
    }

    // Factor 4: Excessive fragmentation (many small functions)
    const averageChildSize = metrics.resultingLinesOfCode / metrics.resultingFunctionCount;
    if (averageChildSize < this.config.minimumAverageFunctionSize) {
      score += 0.1 * metrics.resultingFunctionCount; // Penalty increases with number of tiny functions
    }

    // Apply strict mode multiplier if enabled
    if (this.config.strictMode) {
      score *= 1.5;
    }

    return Math.max(0, score);
  }

  /**
   * Calculate explosion score for an entire changeset
   */
  private calculateChangesetExplosionScore(before: ChangesetMetrics, after: ChangesetMetrics): number {
    let score = 0;

    // Function count explosion
    const functionIncrease = after.functionCount - before.functionCount;
    const functionIncreaseRatio = before.functionCount > 0 ? functionIncrease / before.functionCount : 0;
    
    if (functionIncreaseRatio > this.config.explosionRatioThreshold) {
      score += (functionIncreaseRatio - this.config.explosionRatioThreshold) * this.config.explosionPenaltyMultiplier;
    }

    // Code expansion
    const codeExpansionRatio = before.totalLinesOfCode > 0 ? 
      after.totalLinesOfCode / before.totalLinesOfCode : 1;
    
    if (codeExpansionRatio > this.config.codeExpansionThreshold) {
      score += (codeExpansionRatio - this.config.codeExpansionThreshold) * 0.5;
    }

    // Complexity reduction analysis
    const complexityReduction = before.averageComplexity - after.averageComplexity;
    const complexityReductionPercentage = before.averageComplexity > 0 ? 
      (complexityReduction / before.averageComplexity) * 100 : 0;
    
    if (complexityReductionPercentage < this.config.minimumComplexityReduction) {
      score += 0.2;
    }

    return Math.max(0, score);
  }

  /**
   * Classify explosion severity based on score
   */
  private classifyExplosionSeverity(score: number): ExplosionDetectionResult['severity'] {
    if (score <= 0.1) return 'none';
    if (score <= 0.3) return 'minor';
    if (score <= 0.6) return 'moderate';
    if (score <= 1.0) return 'severe';
    return 'critical';
  }

  /**
   * Generate reasons for explosion detection result
   */
  private generateExplosionReasons(
    metrics: ExplosionDetectionResult['metrics'],
    score: number,
    isExplosion: boolean
  ): string[] {
    const reasons: string[] = [];

    if (isExplosion) {
      if (metrics.explosionRatio > this.config.explosionRatioThreshold) {
        reasons.push(
          `High function explosion ratio: ${metrics.explosionRatio.toFixed(2)} ` +
          `(threshold: ${this.config.explosionRatioThreshold})`
        );
      }
      
      if (metrics.codeExpansionRatio > this.config.codeExpansionThreshold) {
        reasons.push(
          `Code expansion detected: ${(metrics.codeExpansionRatio * 100).toFixed(1)}% increase ` +
          `(threshold: ${(this.config.codeExpansionThreshold * 100).toFixed(1)}%)`
        );
      }
      
      const complexityReduction = metrics.originalAverageComplexity - metrics.resultingAverageComplexity;
      if (complexityReduction < this.config.minimumComplexityReduction) {
        reasons.push(
          `Insufficient complexity reduction: ${complexityReduction.toFixed(1)} ` +
          `(minimum: ${this.config.minimumComplexityReduction})`
        );
      }
    } else {
      reasons.push(`Explosion score ${score.toFixed(3)} is within acceptable limits`);
      
      if (metrics.originalAverageComplexity > metrics.resultingAverageComplexity) {
        const reduction = metrics.originalAverageComplexity - metrics.resultingAverageComplexity;
        reasons.push(`Good complexity reduction: ${reduction.toFixed(1)} points`);
      }
    }

    return reasons;
  }

  /**
   * Generate reasons for changeset explosion detection
   */
  private generateChangesetExplosionReasons(
    before: ChangesetMetrics,
    after: ChangesetMetrics,
    score: number,
    isExplosion: boolean
  ): string[] {
    const reasons: string[] = [];

    if (isExplosion) {
      const functionIncrease = after.functionCount - before.functionCount;
      const functionIncreaseRatio = before.functionCount > 0 ? functionIncrease / before.functionCount : 0;
      
      if (functionIncreaseRatio > this.config.explosionRatioThreshold) {
        reasons.push(
          `Significant function count increase: +${functionIncrease} functions ` +
          `(${(functionIncreaseRatio * 100).toFixed(1)}% increase)`
        );
      }
      
      const codeExpansionRatio = before.totalLinesOfCode > 0 ? 
        after.totalLinesOfCode / before.totalLinesOfCode : 1;
      
      if (codeExpansionRatio > this.config.codeExpansionThreshold) {
        reasons.push(
          `Code expansion: ${(codeExpansionRatio * 100).toFixed(1)}% increase in total LOC`
        );
      }
    } else {
      reasons.push(`Changeset explosion score ${score.toFixed(3)} is acceptable`);
      
      if (after.averageComplexity < before.averageComplexity) {
        const reduction = before.averageComplexity - after.averageComplexity;
        reasons.push(`Average complexity reduced by ${reduction.toFixed(1)} points`);
      }
    }

    return reasons;
  }

  /**
   * Generate recommendations for addressing explosion
   */
  private generateRecommendations(
    metrics: ExplosionDetectionResult['metrics'],
    severity: ExplosionDetectionResult['severity'],
    isExplosion: boolean
  ): string[] {
    const recommendations: string[] = [];

    if (!isExplosion) {
      recommendations.push('✅ Function splitting appears well-balanced');
      return recommendations;
    }

    switch (severity) {
      case 'critical':
        recommendations.push('🚨 Consider completely rethinking this refactoring approach');
        recommendations.push('💡 Try identifying larger, more meaningful function boundaries');
        recommendations.push('📊 Aim for fewer, more cohesive functions rather than many tiny ones');
        break;
        
      case 'severe':
        recommendations.push('⚠️ Significant over-splitting detected');
        recommendations.push('🔧 Consider consolidating related functionality into fewer functions');
        recommendations.push('📈 Focus on meaningful complexity reduction rather than function count');
        break;
        
      case 'moderate':
        recommendations.push('💭 Consider if all new functions are truly necessary');
        recommendations.push('🎯 Ensure each function has a clear, single responsibility');
        break;
        
      case 'minor':
        recommendations.push('👁️ Monitor for patterns of excessive splitting');
        break;
        
      default:
        break;
    }

    // Specific recommendations based on metrics
    if (metrics.codeExpansionRatio > 1.5) {
      recommendations.push('📝 Code expansion suggests possible duplication - review for shared logic');
    }
    
    if (metrics.resultingAverageComplexity < 2) {
      recommendations.push('🧩 Average function complexity is very low - consider if functions are too granular');
    }

    return recommendations;
  }

  /**
   * Generate recommendations for changeset explosions
   */
  private generateChangesetRecommendations(
    before: ChangesetMetrics,
    after: ChangesetMetrics,
    _severity: ExplosionDetectionResult['severity'],
    isExplosion: boolean
  ): string[] {
    const recommendations: string[] = [];

    if (!isExplosion) {
      recommendations.push('✅ Changeset appears well-balanced');
      return recommendations;
    }

    const functionIncrease = after.functionCount - before.functionCount;
    const riskIncrease = after.highRiskCount - before.highRiskCount;

    recommendations.push('📊 Consider the overall impact of this refactoring session');
    
    if (functionIncrease > 10) {
      recommendations.push('🔍 Large number of new functions created - review for necessity');
    }
    
    if (riskIncrease > 0) {
      recommendations.push('⚠️ High-risk function count increased - review new complexity patterns');
    }
    
    if (after.averageComplexity >= before.averageComplexity) {
      recommendations.push('📈 Average complexity did not improve - consider different refactoring strategy');
    }

    return recommendations;
  }

  /**
   * Create a "no explosion" result with reason
   */
  private createNoExplosionResult(reason: string): ExplosionDetectionResult {
    return {
      isExplosion: false,
      explosionScore: 0,
      severity: 'none',
      metrics: {
        originalFunctionCount: 0,
        resultingFunctionCount: 0,
        newFunctionCount: 0,
        explosionRatio: 0,
        originalAverageComplexity: 0,
        resultingAverageComplexity: 0,
        originalLinesOfCode: 0,
        resultingLinesOfCode: 0,
        codeExpansionRatio: 1,
      },
      reasons: [reason],
      recommendations: ['ℹ️ No analysis available due to missing data'],
    };
  }

  /**
   * Get function information by ID
   */
  private async getFunctionInfo(functionId: string): Promise<FunctionInfo | null> {
    try {
      return await this.storage.getFunction(functionId);
    } catch (error) {
      this.logger.warn(`Failed to get function info for ${functionId}`, { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }
}