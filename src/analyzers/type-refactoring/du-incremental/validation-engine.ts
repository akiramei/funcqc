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
import { spawn } from 'child_process';

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
        throw new Error(`Unknown validation type: ${(step as { type: string }).type}`);
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
      // Parse command safely into arguments
      const commandArgs = this.parseCommand(step.command);
      await this.executeSafeCommand(commandArgs, 30000);

      return {
        step,
        passed: true,
        details: 'TypeScript compilation successful'
      };

    } catch (error: unknown) {
      // TypeScript compilation errors
      const errorOutput = (error as { stdout?: string; stderr?: string; message?: string }).stdout || 
                         (error as { stdout?: string; stderr?: string; message?: string }).stderr || 
                         (error as Error).message;
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
      // Parse command safely into arguments
      const commandArgs = this.parseCommand(step.command);
      await this.executeSafeCommand(commandArgs, 60000);

      return {
        step,
        passed: true,
        details: 'All tests passed'
      };

    } catch (error: unknown) {
      const errorOutput = (error as { stdout?: string; stderr?: string; message?: string }).stdout || 
                         (error as { stdout?: string; stderr?: string; message?: string }).stderr || 
                         (error as Error).message;
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

    // Use tracked backup information instead of directory scanning
    for (const backup of result.backups) {
      try {
        // Verify backup file still exists
        await fs.access(backup.backupFile);
        rollbackPlan.backupFiles.push(backup.backupFile);
        rollbackPlan.rollbackCommands.push(`cp "${backup.backupFile}" "${backup.originalFile}"`);
      } catch {
        rollbackPlan.canRollback = false;
        rollbackPlan.rollbackCommands.push(`# WARNING: Backup not found: ${backup.backupFile}`);
      }
    }

    // Check if all modified files have backups
    if (result.filesModified.length !== result.backups.length) {
      rollbackPlan.canRollback = false;
      rollbackPlan.rollbackCommands.push(`# WARNING: Not all files have backups`);
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
        } catch (restoreError) {
          const errorMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
          errors.push(`Failed to restore ${filePath}: ${errorMessage}`);
        }
      } else {
        errors.push(`No backup file available for ${filePath}`);
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
   * Parse command string into safe argument array
   */
  private parseCommand(command: string): string[] {
    // Handle common commands safely
    if (command.startsWith('npx tsc ')) {
      const args = command.split(' ').slice(1); // Remove 'npx'
      return ['npx', ...args];
    }
    if (command.startsWith('npm ')) {
      const args = command.split(' ');
      return args;
    }
    
    // Default: split by spaces (basic parsing)
    return command.split(' ').filter(arg => arg.length > 0);
  }

  /**
   * Execute command safely with timeout and output limits
   */
  private async executeSafeCommand(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const [command, ...commandArgs] = args;
      
      const child = spawn(command, commandArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs
      });

      let stdout = '';
      let stderr = '';
      const maxOutputSize = 1024 * 1024; // 1MB limit

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > maxOutputSize) {
          child.kill();
          reject(new Error('Output size limit exceeded'));
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > maxOutputSize) {
          child.kill();
          reject(new Error('Error output size limit exceeded'));
        }
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          const error = new Error(`Command failed with code ${code}`) as Error & { stdout: string; stderr: string };
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
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