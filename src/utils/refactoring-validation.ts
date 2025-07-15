/**
 * Refactoring validation utilities for command integration
 * Provides simplified interface for RefactoringHealthEngine integration
 */

import { RefactoringHealthEngine, DefaultLineageManager } from './refactoring-health-engine.js';
import { RefactoringIntent, RefactoringOperation } from '../types/index.js';
import { CommandEnvironment } from '../types/environment.js';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';

/**
 * Validation result for refactoring operations
 */
export interface RefactoringValidationResult {
  isGenuine: boolean;
  functionExplosionScore: number;
  overallGrade: string;
  complexityReduction: number;
  riskImprovement: number;
  maintainabilityGain: number;
  reasons: string[];
  recommendation: 'accept' | 'reject' | 'review';
}

/**
 * Refactoring validation service
 */
export class RefactoringValidator {
  private healthEngine: RefactoringHealthEngine;

  constructor(env: CommandEnvironment) {
    const lineageManager = new DefaultLineageManager(env.storage);
    this.healthEngine = new RefactoringHealthEngine(env.storage, lineageManager);
  }

  /**
   * Validate a refactoring operation before applying
   */
  async validateRefactoring(
    operation: RefactoringOperation,
    beforeSnapshotId: string,
    afterSnapshotId: string
  ): Promise<RefactoringValidationResult> {
    // Create changeset for evaluation
    const changeset = await this.healthEngine.createChangeset(
      operation.context.sessionId,
      operation,
      beforeSnapshotId,
      afterSnapshotId
    );

    // Evaluate the changeset
    const assessment = await this.healthEngine.evaluateChangeset(changeset);

    // Generate reasons for the decision
    const reasons = this.generateReasons(assessment.improvement, operation.intent);

    // Determine recommendation
    const recommendation = this.getRecommendation(assessment.improvement, operation.intent);

    return {
      isGenuine: assessment.improvement.isGenuine,
      functionExplosionScore: assessment.improvement.functionExplosionScore,
      overallGrade: assessment.improvement.overallGrade,
      complexityReduction: assessment.improvement.complexityReduction,
      riskImprovement: assessment.improvement.riskImprovement,
      maintainabilityGain: assessment.improvement.maintainabilityGain,
      reasons,
      recommendation,
    };
  }

  /**
   * Quick validation for simple scenarios
   */
  async quickValidate(
    parentFunctionId: string,
    childFunctionIds: string[],
    intent: RefactoringIntent,
    snapshotId: string
  ): Promise<RefactoringValidationResult> {
    const operation: RefactoringOperation = {
      type: 'split',
      intent,
      parentFunction: parentFunctionId,
      childFunctions: childFunctionIds,
      context: {
        sessionId: uuidv4(),
        description: `Quick validation for ${intent} operation`,
        beforeSnapshot: snapshotId,
        afterSnapshot: snapshotId,
        targetBranch: 'main',
      },
    };

    return this.validateRefactoring(operation, snapshotId, snapshotId);
  }

  /**
   * Display validation results to user
   */
  displayValidationResults(result: RefactoringValidationResult): void {
    console.log(chalk.cyan('\n🔍 Refactoring Validation Results'));
    console.log(chalk.gray('='.repeat(40)));
    
    // Main verdict
    const verdictColor = result.isGenuine ? chalk.green : chalk.red;
    const verdictIcon = result.isGenuine ? '✅' : '❌';
    console.log(`${verdictIcon} ${verdictColor(result.isGenuine ? 'GENUINE IMPROVEMENT' : 'FAKE IMPROVEMENT')}`);
    
    // Metrics
    console.log(`\n📊 Metrics:`);
    console.log(`   Function Explosion Score: ${result.functionExplosionScore.toFixed(2)}`);
    console.log(`   Overall Grade: ${this.getGradeColor(result.overallGrade)(result.overallGrade)}`);
    console.log(`   Complexity Change: ${result.complexityReduction >= 0 ? '+' : ''}${result.complexityReduction}`);
    console.log(`   Risk Improvement: ${result.riskImprovement >= 0 ? '+' : ''}${result.riskImprovement}`);
    console.log(`   Maintainability Gain: ${result.maintainabilityGain >= 0 ? '+' : ''}${result.maintainabilityGain}`);
    
    // Reasons
    console.log(`\n📝 Evaluation Reasons:`);
    result.reasons.forEach(reason => {
      console.log(`   • ${reason}`);
    });
    
    // Recommendation
    console.log(`\n💡 Recommendation: ${this.getRecommendationColor(result.recommendation)(result.recommendation.toUpperCase())}`);
    
    console.log(chalk.gray('='.repeat(40)));
  }

  /**
   * Generate human-readable reasons for evaluation result
   */
  private generateReasons(improvement: any, intent: RefactoringIntent): string[] {
    const reasons: string[] = [];

    // Function explosion analysis
    if (improvement.functionExplosionScore > 1.0) {
      reasons.push(`High function explosion score (${improvement.functionExplosionScore.toFixed(2)}) indicates excessive splitting`);
    } else if (improvement.functionExplosionScore > 0.5) {
      reasons.push(`Moderate function explosion score (${improvement.functionExplosionScore.toFixed(2)}) suggests potential over-splitting`);
    } else {
      reasons.push(`Function explosion score (${improvement.functionExplosionScore.toFixed(2)}) is within acceptable range`);
    }

    // Intent-specific analysis
    switch (intent) {
      case 'cleanup':
        if (improvement.complexityReduction < 0) {
          reasons.push(`Cleanup intent requires complexity reduction, but complexity increased by ${Math.abs(improvement.complexityReduction)}`);
        } else if (improvement.complexityReduction === 0) {
          reasons.push(`Cleanup intent expects complexity reduction, but no change detected`);
        } else {
          reasons.push(`Cleanup successfully reduced complexity by ${improvement.complexityReduction}`);
        }
        break;

      case 'split':
        if (improvement.functionExplosionScore > 0.5) {
          reasons.push(`Split operation may have created too many functions relative to original size`);
        } else {
          reasons.push(`Split operation maintained reasonable function size distribution`);
        }
        break;

      case 'extract':
        if (improvement.maintainabilityGain < 0) {
          reasons.push(`Extract operation should improve maintainability, but decreased by ${Math.abs(improvement.maintainabilityGain)}`);
        } else {
          reasons.push(`Extract operation improved maintainability by ${improvement.maintainabilityGain}`);
        }
        break;

      case 'extend':
        if (improvement.complexityReduction < -10) {
          reasons.push(`Extend operation increased complexity by ${Math.abs(improvement.complexityReduction)}, which may be excessive`);
        } else {
          reasons.push(`Extend operation complexity increase (${Math.abs(improvement.complexityReduction)}) is within acceptable range for feature addition`);
        }
        break;

      case 'rename':
        if (improvement.complexityReduction !== 0) {
          reasons.push(`Rename operation should not change complexity, but detected change of ${improvement.complexityReduction}`);
        } else {
          reasons.push(`Rename operation correctly preserved complexity`);
        }
        break;
    }

    // Risk and maintainability analysis
    if (improvement.riskImprovement < -5) {
      reasons.push(`Risk increased by ${Math.abs(improvement.riskImprovement)}, which may indicate introduced problems`);
    } else if (improvement.riskImprovement > 5) {
      reasons.push(`Risk decreased by ${improvement.riskImprovement}, indicating improved code safety`);
    }

    return reasons;
  }

  /**
   * Get recommendation based on evaluation
   */
  private getRecommendation(improvement: any, _intent: RefactoringIntent): 'accept' | 'reject' | 'review' {
    if (!improvement.isGenuine) {
      return 'reject';
    }

    if (improvement.overallGrade === 'F' || improvement.overallGrade === 'D') {
      return 'reject';
    }

    if (improvement.functionExplosionScore > 1.0) {
      return 'reject';
    }

    if (improvement.overallGrade === 'C') {
      return 'review';
    }

    return 'accept';
  }

  /**
   * Get color for grade display
   */
  private getGradeColor(grade: string) {
    switch (grade) {
      case 'A+':
      case 'A':
        return chalk.green;
      case 'B':
        return chalk.yellow;
      case 'C':
        return chalk.hex('#FFA500'); // Orange color
      case 'D':
      case 'F':
        return chalk.red;
      default:
        return chalk.gray;
    }
  }

  /**
   * Get color for recommendation display
   */
  private getRecommendationColor(recommendation: string) {
    switch (recommendation.toLowerCase()) {
      case 'accept':
        return chalk.green;
      case 'reject':
        return chalk.red;
      case 'review':
        return chalk.yellow;
      default:
        return chalk.gray;
    }
  }
}

/**
 * Convenience function to create validator
 */
export function createRefactoringValidator(env: CommandEnvironment): RefactoringValidator {
  return new RefactoringValidator(env);
}