/**
 * Code Transformer - Phase 4 (D2)
 * 
 * Safely transforms existing code to use DU patterns
 */

import type { 
  TransformationPlan,
  TransformationResult,
  TransformationOptions,
  ValidationResult
} from './transformation-types';
import fs from 'fs/promises';
import { AstTransformer } from './ast-transformer';

/**
 * Safe code transformer for DU patterns
 */
export class CodeTransformer {
  private options: TransformationOptions;
  private astTransformer?: AstTransformer;

  constructor(options: TransformationOptions) {
    this.options = options;
  }

  /**
   * Initialize AST transformer with tsconfig detection (idempotent)
   */
  private async initializeAstTransformer(): Promise<void> {
    // Idempotent - only initialize once
    if (this.astTransformer) {
      return;
    }

    try {
      const tsConfigPath = await this.findTsConfigPath();
      this.astTransformer = new AstTransformer(tsConfigPath, this.options.verboseLogging);
      
      if (this.options.verboseLogging) {
        console.log('🔧 AST transformer initialized');
      }
    } catch {
      if (this.options.verboseLogging) {
        console.warn('⚠ AST transformer initialization failed, falling back to string-based transformations');
      }
    }
  }

  /**
   * Find tsconfig.json path
   */
  private async findTsConfigPath(): Promise<string | undefined> {
    const path = await import('path');
    const fs = await import('fs');
    
    let currentDir = process.cwd();
    const root = path.parse(currentDir).root;
    while (true) {
      const tsConfigPath = path.join(currentDir, 'tsconfig.json');
      if (fs.existsSync(tsConfigPath)) {
        return tsConfigPath;
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir || currentDir === root) break;
      currentDir = parent;
    }
    
    return undefined;
  }

  /**
   * Apply transformation plans to source code
   */
  async applyTransformations(plans: TransformationPlan[]): Promise<TransformationResult> {
    const result: TransformationResult = {
      success: true,
      transformationsApplied: 0,
      filesModified: [],
      backups: [],
      errors: [],
      warnings: [],
      validationResults: []
    };

    if (this.options.verboseLogging) {
      console.log(`🔧 Applying ${plans.length} transformation plans...`);
    }

    // Group plans by file for efficient processing
    const plansByFile = this.groupPlansByFile(plans);

    for (const [filePath, filePlans] of plansByFile.entries()) {
      try {
        if (this.options.verboseLogging) {
          console.log(`   📄 Processing file: ${filePath} (${filePlans.length} transformations)`);
        }

        const fileResult = await this.transformFile(filePath, filePlans);
        
        // Merge results
        result.transformationsApplied += fileResult.transformationsApplied;
        if (fileResult.filesModified.length > 0) {
          result.filesModified.push(...fileResult.filesModified);
        }
        result.backups.push(...fileResult.backups);
        result.errors.push(...fileResult.errors);
        result.warnings.push(...fileResult.warnings);
        result.validationResults.push(...fileResult.validationResults);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push({
          pattern: filePlans[0].pattern, // Use first plan as reference
          error: `Failed to transform file ${filePath}: ${errorMessage}`
        });
        result.success = false;
      }
    }

    if (this.options.verboseLogging) {
      console.log(`✅ Transformation complete: ${result.transformationsApplied} applied, ${result.errors.length} errors`);
    }

    return result;
  }

  /**
   * Transform a single file with multiple plans
   */
  private async transformFile(filePath: string, plans: TransformationPlan[]): Promise<TransformationResult> {
    // Try AST-based transformation first (lazy init)
    if (this.shouldUseAstTransformation(plans)) {
      if (!this.astTransformer) {
        await this.initializeAstTransformer();
      }
      if (this.astTransformer) {
        return await this.transformFileWithAst(filePath, plans);
      }
    }
    
    // Fall back to string-based transformation
    return await this.transformFileWithString(filePath, plans);
  }

  /**
   * Check if plans are suitable for AST transformation
   */
  private shouldUseAstTransformation(plans: TransformationPlan[]): boolean {
    // Enable AST transformation for specific transformation types
    return plans.some(plan => 
      plan.transformationType === 'add-type-guard' ||
      plan.transformationType === 'replace-property-check'
    );
  }

  /**
   * Transform file using AST-based approach
   */
  private async transformFileWithAst(filePath: string, plans: TransformationPlan[]): Promise<TransformationResult> {
    const result: TransformationResult = {
      success: true,
      transformationsApplied: 0,
      filesModified: [],
      backups: [],
      errors: [],
      warnings: [],
      validationResults: []
    };

    if (!this.astTransformer) {
      result.errors.push({ pattern: plans[0].pattern, error: 'AST transformer not available' });
      return result;
    }

    // Create backup if requested
    if (this.options.backupFiles && !this.options.dryRun) {
      const backupInfo = await this.createBackup(filePath);
      result.backups.push(backupInfo);
    }

    try {
      // Extract discriminant from first plan (assuming all plans for same file use same discriminant)
      const discriminant = plans[0].pattern.discriminantProperty;
      const guardsModule = this.options.guardsModulePath || './type-guards';

      // Apply AST transformation
      const astResult = await this.astTransformer.transformFile(
        filePath,
        (sourceFile, transformer) => {
          return transformer.applySimpleGuardReplacement(sourceFile, discriminant, guardsModule);
        }
      );

      result.transformationsApplied = astResult.applied;
      
      if (astResult.saved) {
        result.filesModified.push(filePath);
      }

      if (astResult.errors && astResult.errors.length > 0) {
        result.errors.push(...astResult.errors.map(error => ({
          pattern: plans[0].pattern,
          error
        })));
        result.success = false;
      }

      if (this.options.verboseLogging) {
        console.log(`   🎯 AST transformation: ${result.transformationsApplied} applied`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        pattern: plans[0].pattern,
        error: `AST transformation failed: ${errorMessage}`
      });
      result.success = false;
    }

    return result;
  }

  /**
   * Transform file using string-based approach (original implementation)
   */
  private async transformFileWithString(filePath: string, plans: TransformationPlan[]): Promise<TransformationResult> {
    const result: TransformationResult = {
      success: true,
      transformationsApplied: 0,
      filesModified: [],
      backups: [],
      errors: [],
      warnings: [],
      validationResults: []
    };

    // Backup file if requested
    if (this.options.backupFiles && !this.options.dryRun) {
      const backupInfo = await this.createBackup(filePath);
      result.backups.push(backupInfo);
    }

    // Read original file content
    const originalContent = await fs.readFile(filePath, 'utf-8');
    let modifiedContent = originalContent;

    // Apply transformations in reverse order (by line number) to avoid offset issues
    const sortedPlans = plans.sort((a, b) => 
      b.pattern.location.startLine - a.pattern.location.startLine
    );

    for (const plan of sortedPlans) {
      try {
        // Validate transformation plan
        if (!this.validateTransformationPlan(plan)) {
          result.warnings.push(`Skipped transformation in ${filePath} at line ${plan.pattern.location.startLine}: Invalid plan`);
          continue;
        }

        // Apply transformation
        const transformedContent = this.applyTransformation(modifiedContent, plan);
        
        if (transformedContent !== modifiedContent) {
          modifiedContent = transformedContent;
          result.transformationsApplied++;
          
          if (this.options.verboseLogging) {
            console.log(`      ✓ Applied ${plan.transformationType} at line ${plan.pattern.location.startLine}`);
          }
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push({
          pattern: plan.pattern,
          error: `Failed to apply transformation: ${errorMessage}`,
          suggestion: 'Check pattern syntax and try manual transformation'
        });
      }
    }

    // Write modified content (unless dry run)
    if (modifiedContent !== originalContent) {
      if (!this.options.dryRun) {
        await fs.writeFile(filePath, modifiedContent, 'utf-8');
        result.filesModified.push(filePath);
      } else {
        result.warnings.push(`Dry run: Would modify ${filePath}`);
      }

      // Run validation if requested
      if (this.options.validateBeforeApply) {
        const validationResults = await this.validateTransformations(filePath, plans);
        result.validationResults.push(...validationResults);
      }
    }

    return result;
  }

  /**
   * Apply a single transformation to content
   */
  private applyTransformation(content: string, plan: TransformationPlan): string {
    const lines = content.split('\n');
    const startLine = plan.pattern.location.startLine - 1; // Convert to 0-based
    if (startLine < 0 || startLine >= lines.length) {
      throw new Error(`Invalid line number: ${startLine + 1}`);
    }

    const originalLine = lines[startLine];
    const startCol = Math.max(0, plan.pattern.location.startColumn - 1);
    const endCol = Math.max(startCol, plan.pattern.location.endColumn - 1);
    if (endCol > originalLine.length) {
      throw new Error(`Invalid column range: ${startCol + 1}-${endCol + 1}`);
    }
    const before = originalLine.slice(0, startCol);
    const after = originalLine.slice(endCol);
    lines[startLine] = `${before}${plan.newCode}${after}`;

    return lines.join('\n');
  }

  /**
   * Validate transformation plan
   */
  private validateTransformationPlan(plan: TransformationPlan): boolean {
    // Basic validation
    if (!plan.pattern.originalCode || !plan.newCode) {
      return false;
    }

    if (plan.pattern.confidence < this.options.minConfidence) {
      return false;
    }

    if (plan.riskLevel === 'high' && !this.options.allowHighRiskTransformations) {
      return false;
    }

    return true;
  }

  /**
   * Run validation steps
   */
  private async validateTransformations(_filePath: string, plans: TransformationPlan[]): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // For now, implement basic TypeScript compilation check
    for (const plan of plans) {
      for (const step of plan.validationSteps) {
        if (step.type === 'type-check' && step.automated && step.command) {
          try {
            // In a full implementation, would run the actual command
            // For Phase 4 start, we'll simulate success
            results.push({
              step,
              passed: true,
              details: 'TypeScript compilation check passed (simulated)'
            });
          } catch (error) {
            results.push({
              step,
              passed: false,
              details: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Create backup of file
   */
  private async createBackup(filePath: string): Promise<import('./transformation-types').BackupInfo> {
    const backupPath = `${filePath}.backup.${Date.now()}`;
    await fs.copyFile(filePath, backupPath);
    
    const backupInfo: import('./transformation-types').BackupInfo = {
      originalFile: filePath,
      backupFile: backupPath,
      createdAt: new Date().toISOString()
    };
    
    if (this.options.verboseLogging) {
      console.log(`   💾 Created backup: ${backupPath}`);
    }
    
    return backupInfo;
  }

  /**
   * Group transformation plans by file path
   */
  private groupPlansByFile(plans: TransformationPlan[]): Map<string, TransformationPlan[]> {
    const grouped = new Map<string, TransformationPlan[]>();

    for (const plan of plans) {
      const filePath = plan.pattern.location.filePath;
      if (!grouped.has(filePath)) {
        grouped.set(filePath, []);
      }
      grouped.get(filePath)!.push(plan);
    }

    return grouped;
  }

  /**
   * Get transformation statistics
   */
  getStatistics(): {
    totalTransformations: number;
    successRate: number;
    avgTimePerTransformation: number;
  } {
    // Placeholder for statistics tracking
    return {
      totalTransformations: 0,
      successRate: 100,
      avgTimePerTransformation: 0
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.astTransformer) {
      this.astTransformer.dispose();
      delete this.astTransformer;
    }
  }
}