/**
 * Validation Engine - Phase 4 (D3)
 * 
 * Validates transformations and provides rollback mechanisms
 */

import type { 
  TransformationResult,
  ValidationResult,
  ValidationStep
} from './transformation-types';
import fs from 'fs/promises';
import { execSync } from 'child_process';

/**
 * Validation and rollback engine
 */
export class ValidationEngine {
  private verboseLogging: boolean;

  constructor(verboseLogging = false) {
    this.verboseLogging = verboseLogging;
  }

  /**
   * Validate transformation results
   */
  async validateTransformations(
    _result: TransformationResult,
    validationSteps: ValidationStep[]
  ): Promise<ValidationResult[]> {
    if (this.verboseLogging) {
      console.log(`🔍 Running ${validationSteps.length} validation steps...`);
    }

    const validationResults: ValidationResult[] = [];

    for (const step of validationSteps) {
      try {
        const stepResult = await this.runValidationStep(step);
        validationResults.push(stepResult);

        if (this.verboseLogging) {
          const status = stepResult.passed ? '✅' : '❌';
          console.log(`   ${status} ${step.description}`);
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        validationResults.push({
          step,
          passed: false,
          details: `Validation failed: ${errorMessage}`
        });

        if (this.verboseLogging) {
          console.log(`   ❌ ${step.description} - ${errorMessage}`);
        }
      }
    }

    const passedCount = validationResults.filter(r => r.passed).length;
    if (this.verboseLogging) {
      console.log(`📊 Validation summary: ${passedCount}/${validationResults.length} passed`);
    }

    return validationResults;
  }

  /**
   * Run a single validation step
   */
  private async runValidationStep(step: ValidationStep): Promise<ValidationResult> {
    switch (step.type) {
      case 'type-check':
        return await this.runTypeCheck(step);
      
      case 'test-run':
        return await this.runTests(step);
      
      case 'manual-review':
        return this.requestManualReview(step);
      
      default:
        throw new Error(`Unknown validation type: ${(step as any).type}`);
    }
  }

  /**
   * Run TypeScript type checking
   */
  private async runTypeCheck(step: ValidationStep): Promise<ValidationResult> {
    if (!step.command) {
      return {
        step,
        passed: false,
        details: 'No type check command specified'
      };
    }

    try {
      execSync(step.command, { 
        encoding: 'utf-8',
        timeout: 30000 // 30 second timeout
      });

      return {
        step,
        passed: true,
        details: 'TypeScript compilation successful'
      };

    } catch (error: any) {
      // TypeScript compilation errors
      const errorOutput = error.stdout || error.stderr || error.message;
      return {
        step,
        passed: false,
        details: `TypeScript errors: ${errorOutput}`
      };
    }
  }

  /**
   * Run tests
   */
  private async runTests(step: ValidationStep): Promise<ValidationResult> {
    if (!step.command) {
      return {
        step,
        passed: false,
        details: 'No test command specified'
      };
    }

    try {
      execSync(step.command, { 
        encoding: 'utf-8',
        timeout: 60000 // 60 second timeout for tests
      });

      return {
        step,
        passed: true,
        details: 'All tests passed'
      };

    } catch (error: any) {
      const errorOutput = error.stdout || error.stderr || error.message;
      return {
        step,
        passed: false,
        details: `Test failures: ${errorOutput}`
      };
    }
  }

  /**
   * Request manual review (placeholder)
   */
  private requestManualReview(step: ValidationStep): ValidationResult {
    // In a real implementation, this would prompt for user review
    // For Phase 4 testing, we'll assume manual review passes
    return {
      step,
      passed: true,
      details: 'Manual review completed (simulated)'
    };
  }

  /**
   * Create rollback plan for transformations
   */
  async createRollbackPlan(result: TransformationResult): Promise<RollbackPlan> {
    const rollbackPlan: RollbackPlan = {
      filesModified: result.filesModified,
      backupFiles: [],
      rollbackCommands: [],
      canRollback: true
    };

    // Find backup files
    for (const filePath of result.filesModified) {
      try {
        const files = await fs.readdir('./');
        const backupFile = files.find(f => 
          f.startsWith(filePath.replace('./', '')) && 
          f.includes('.backup.')
        );
        
        if (backupFile) {
          rollbackPlan.backupFiles.push(backupFile);
        } else {
          rollbackPlan.canRollback = false;
          rollbackPlan.rollbackCommands.push(`# WARNING: No backup found for ${filePath}`);
        }
      } catch (error) {
        rollbackPlan.canRollback = false;
      }
    }

    return rollbackPlan;
  }

  /**
   * Execute rollback
   */
  async executeRollback(rollbackPlan: RollbackPlan): Promise<RollbackResult> {
    if (!rollbackPlan.canRollback) {
      return {
        success: false,
        error: 'Rollback not possible - missing backup files',
        filesRestored: []
      };
    }

    const filesRestored: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rollbackPlan.filesModified.length; i++) {
      const filePath = rollbackPlan.filesModified[i];
      const backupPath = rollbackPlan.backupFiles[i];

      if (backupPath) {
        try {
          await fs.copyFile(backupPath, filePath);
          filesRestored.push(filePath);
          
          // Clean up backup file
          await fs.unlink(backupPath);
          
          if (this.verboseLogging) {
            console.log(`🔄 Restored ${filePath} from ${backupPath}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to restore ${filePath}: ${errorMessage}`);
        }
      }
    }

    if (errors.length === 0) {
      return {
        success: true,
        filesRestored
      };
    } else {
      return {
        success: false,
        error: errors.join('; '),
        filesRestored
      };
    }
  }

  /**
   * Get validation statistics
   */
  getValidationStats(): {
    totalValidations: number;
    successRate: number;
    avgValidationTime: number;
  } {
    // Placeholder for statistics tracking
    return {
      totalValidations: 0,
      successRate: 100,
      avgValidationTime: 0
    };
  }
}

/**
 * Rollback plan information
 */
export interface RollbackPlan {
  filesModified: string[];
  backupFiles: string[];
  rollbackCommands: string[];
  canRollback: boolean;
}

/**
 * Result of rollback execution
 */
export interface RollbackResult {
  success: boolean;
  error?: string;
  filesRestored: string[];
}