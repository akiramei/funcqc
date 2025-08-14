/**
 * Type Replacement Advisor
 * 
 * Provides intelligent guidance for safe type replacements by analyzing
 * compatibility, impact, and generating migration strategies.
 */

import type { StorageQueryInterface } from '../type-insights/types';
import { RefactoringGuardRail, type RefactoringGuardRailOptions, type RefactoringGuardRailReport } from './refactoring-guardrail';
import { TypeCompatibilityChecker, type TypeCompatibilityResult, type CompatibilityCheckOptions } from './type-compatibility-checker';
// import { StructuralSubsumptionAnalyzer } from '../type-insights/structural-subsumption-analyzer';

export interface TypeReplacementOptions extends RefactoringGuardRailOptions, CompatibilityCheckOptions {
  generateCodemod?: boolean;        // Generate automatic code modification
  validateReferences?: boolean;     // Check all type usage references
  checkBreakingChanges?: boolean;   // Analyze breaking change impact
  requireExplicitMigration?: boolean; // Force explicit migration plan
  allowUnsafeReplacements?: boolean;  // Allow replacements with warnings
}

export interface TypeUsageInfo {
  functionId: string;
  functionName: string;
  filePath: string;
  usageType: 'parameter' | 'return' | 'variable' | 'property' | 'generic';
  location: {
    line: number;
    column: number;
    length: number;
  };
  context: string;                  // Surrounding code context
}

export interface CodemodAction {
  type: 'replace_type' | 'add_property' | 'remove_property' | 'wrap_nullable' | 'add_cast';
  filePath: string;
  location: {
    start: number;
    end: number;
    line: number;
    column: number;
  };
  originalCode: string;
  replacementCode: string;
  description: string;
  riskLevel: 'safe' | 'warning' | 'breaking';
  dependencies: string[];           // Other actions this depends on
}

export interface TypeReplacementPlan {
  sourceType: string;
  targetType: string;
  compatibilityResult: TypeCompatibilityResult;
  affectedUsages: TypeUsageInfo[];
  codemodActions: CodemodAction[];
  migrationSteps: string[];
  estimatedEffort: 'minimal' | 'low' | 'moderate' | 'high' | 'very_high';
  riskAssessment: string;
  rollbackPlan: string[];
  validationSteps: string[];
}

export interface TypeReplacementReport extends RefactoringGuardRailReport {
  replacementPlan: TypeReplacementPlan;
  compatibilityAnalysis: TypeCompatibilityResult;
  usageAnalysis: {
    totalUsages: number;
    breakingUsages: number;
    compatibleUsages: number;
    unknownUsages: number;
  };
  automationLevel: 'fully_automated' | 'semi_automated' | 'manual_only';
  preRequisites: string[];
  postValidation: string[];
}

export class TypeReplacementAdvisor extends RefactoringGuardRail {
  private compatibilityChecker: TypeCompatibilityChecker;
  // private structuralAnalyzer: StructuralSubsumptionAnalyzer;
  private replacementOptions: Required<TypeReplacementOptions>;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<TypeReplacementOptions> = {}
  ) {
    super(storage, options);
    
    this.replacementOptions = {
      ...this.options,
      generateCodemod: options.generateCodemod ?? true,
      validateReferences: options.validateReferences ?? true,
      checkBreakingChanges: options.checkBreakingChanges ?? true,
      requireExplicitMigration: options.requireExplicitMigration ?? false,
      allowUnsafeReplacements: options.allowUnsafeReplacements ?? false,
      strictNullChecks: options.strictNullChecks ?? true,
      exactOptionalPropertyTypes: options.exactOptionalPropertyTypes ?? false,
      checkGenerics: options.checkGenerics ?? true,
      checkFunctionSignatures: options.checkFunctionSignatures ?? true,
      includeMethodNames: options.includeMethodNames ?? true,
      ...options
    } as Required<TypeReplacementOptions>;

    this.compatibilityChecker = new TypeCompatibilityChecker(storage, options);
    // this.structuralAnalyzer = new StructuralSubsumptionAnalyzer(storage, {});
  }

  /**
   * Initialize the advisor with TypeScript configuration
   */
  async initialize(tsConfigPath?: string): Promise<void> {
    await this.compatibilityChecker.initialize(tsConfigPath);
  }

  /**
   * Analyze type replacement feasibility and generate comprehensive plan
   */
  async analyzeTypeReplacement(
    sourceTypeName: string,
    targetTypeName: string,
    snapshotId?: string
  ): Promise<TypeReplacementReport> {
    try {
      // Perform base refactoring analysis
      const baseReport = await this.analyzeTypeRefactoring(sourceTypeName, 'replace', snapshotId);

      // Perform compatibility analysis
      const compatibilityResult = await this.compatibilityChecker.checkCompatibility(
        sourceTypeName,
        targetTypeName,
        snapshotId
      );

      // Analyze type usage patterns
      const usageInfo = await this.analyzeTypeUsages(sourceTypeName, snapshotId);

      // Generate replacement plan
      const replacementPlan = await this.generateReplacementPlan(
        sourceTypeName,
        targetTypeName,
        compatibilityResult,
        usageInfo,
        snapshotId
      );

      // Assess automation level
      const automationLevel = this.determineAutomationLevel(compatibilityResult, usageInfo);

      // Generate prerequisites and validation steps
      const preRequisites = this.generatePreRequisites(compatibilityResult, replacementPlan);
      const postValidation = this.generatePostValidation(replacementPlan);

      // Calculate usage statistics
      const usageAnalysis = this.calculateUsageStatistics(usageInfo, compatibilityResult);

      return {
        ...baseReport,
        replacementPlan,
        compatibilityAnalysis: compatibilityResult,
        usageAnalysis,
        automationLevel,
        preRequisites,
        postValidation
      };

    } catch (error) {
      throw new Error(`Type replacement analysis failed: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  /**
   * Analyze all usages of a specific type
   */
  private async analyzeTypeUsages(
    typeName: string,
    _snapshotId?: string
  ): Promise<TypeUsageInfo[]> {
    const query = _snapshotId
      ? `SELECT f.id, f.name, f.file_path, ftu.usage_context, ftu.usage_type
         FROM functions f
         JOIN function_type_usage ftu ON f.id = ftu.function_id
         JOIN type_definitions td ON ftu.type_id = td.id
         WHERE td.name = $1 AND f.snapshot_id = $2`
      : `SELECT f.id, f.name, f.file_path, ftu.usage_context, ftu.usage_type
         FROM functions f
         JOIN function_type_usage ftu ON f.id = ftu.function_id
         JOIN type_definitions td ON ftu.type_id = td.id
         WHERE td.name = $1`;

    const params = _snapshotId ? [typeName, _snapshotId] : [typeName];
    const result = await this.storage.query(query, params);

    const usages: TypeUsageInfo[] = [];
    
    for (const row of result.rows) {
      const usageData = row as any;
      
      // Parse usage context to extract location information
      const location = this.parseLocationFromContext(usageData.usage_context ?? '');
      
      usages.push({
        functionId: usageData.id,
        functionName: usageData.name,
        filePath: usageData.file_path,
        usageType: usageData.usage_type ?? 'variable',
        location,
        context: usageData.usage_context ?? ''
      });
    }

    return usages;
  }

  /**
   * Parse location information from usage context
   */
  private parseLocationFromContext(context: string): TypeUsageInfo['location'] {
    // Simple parsing - in a real implementation, this would be more sophisticated
    const defaultLocation = { line: 0, column: 0, length: 0 };
    
    try {
      // Look for line:column patterns in context
      const match = context.match(/(\d+):(\d+)/);
      if (match) {
        return {
          line: parseInt(match[1], 10),
          column: parseInt(match[2], 10),
          length: context.length
        };
      }
    } catch {
      // Fallback to default
    }
    
    return defaultLocation;
  }

  /**
   * Generate comprehensive replacement plan
   */
  private async generateReplacementPlan(
    sourceTypeName: string,
    targetTypeName: string,
    compatibilityResult: TypeCompatibilityResult,
    usageInfo: TypeUsageInfo[],
    _snapshotId?: string
  ): Promise<TypeReplacementPlan> {
    const codemodActions: CodemodAction[] = [];
    const migrationSteps: string[] = [];
    
    // Generate codemod actions based on compatibility issues
    if (this.replacementOptions.generateCodemod) {
      codemodActions.push(...this.generateCodemodActions(
        sourceTypeName,
        targetTypeName,
        compatibilityResult,
        usageInfo
      ));
    }

    // Generate migration steps
    migrationSteps.push(...this.generateMigrationSteps(compatibilityResult, usageInfo));

    // Assess effort and risk
    const estimatedEffort = this.estimateReplacementEffort(compatibilityResult, usageInfo);
    const riskAssessment = this.generateRiskAssessment(compatibilityResult, usageInfo);

    // Generate rollback and validation plans
    const rollbackPlan = this.generateRollbackPlan(codemodActions);
    const validationSteps = this.generateValidationSteps(compatibilityResult, usageInfo);

    return {
      sourceType: sourceTypeName,
      targetType: targetTypeName,
      compatibilityResult,
      affectedUsages: usageInfo,
      codemodActions,
      migrationSteps,
      estimatedEffort,
      riskAssessment,
      rollbackPlan,
      validationSteps
    };
  }

  /**
   * Generate codemod actions for automatic code modification
   */
  private generateCodemodActions(
    _sourceTypeName: string,
    targetTypeName: string,
    compatibilityResult: TypeCompatibilityResult,
    usageInfo: TypeUsageInfo[]
  ): CodemodAction[] {
    const actions: CodemodAction[] = [];

    // Basic type replacement action
    for (const usage of usageInfo) {
      actions.push({
        type: 'replace_type',
        filePath: usage.filePath,
        location: {
          start: usage.location.column,
          end: usage.location.column + usage.location.length,
          line: usage.location.line,
          column: usage.location.column
        },
        originalCode: _sourceTypeName,
        replacementCode: targetTypeName,
        description: `Replace ${_sourceTypeName} with ${targetTypeName} in ${usage.usageType}`,
        riskLevel: compatibilityResult.isCompatible ? 'safe' : 'warning',
        dependencies: []
      });
    }

    // Generate additional actions based on compatibility issues
    for (const issue of compatibilityResult.issues) {
      if (issue.autoFixable && issue.suggestion) {
        const action = this.createActionFromIssue(issue, _sourceTypeName, targetTypeName);
        if (action) {
          actions.push(action);
        }
      }
    }

    return actions;
  }

  /**
   * Create codemod action from compatibility issue
   */
  private createActionFromIssue(
    issue: any,
    _sourceTypeName: string,
    targetTypeName: string
  ): CodemodAction | null {
    // This would be expanded based on different types of compatibility issues
    switch (issue.category) {
      case 'nullability':
        return {
          type: 'wrap_nullable',
          filePath: '', // Would be determined from issue context
          location: { start: 0, end: 0, line: 0, column: 0 },
          originalCode: targetTypeName,
          replacementCode: `${targetTypeName} | null`,
          description: 'Add null union to handle nullability difference',
          riskLevel: 'warning',
          dependencies: []
        };

      case 'structure':
        if (issue.description.includes('missing')) {
          return {
            type: 'add_property',
            filePath: '',
            location: { start: 0, end: 0, line: 0, column: 0 },
            originalCode: '',
            replacementCode: '// TODO: Add missing property',
            description: `Add missing property: ${issue.sourcePath}`,
            riskLevel: 'breaking',
            dependencies: []
          };
        }
        break;
    }

    return null;
  }

  /**
   * Generate migration steps
   */
  private generateMigrationSteps(
    compatibilityResult: TypeCompatibilityResult,
    usageInfo: TypeUsageInfo[]
  ): string[] {
    const steps: string[] = [];

    steps.push('1. Review compatibility analysis and ensure all team members understand changes');
    
    if (!compatibilityResult.isCompatible) {
      steps.push('2. Address compatibility issues identified in the analysis');
      steps.push('3. Update type definitions to ensure structural compatibility');
    }

    steps.push(`4. Update ${usageInfo.length} usage locations across the codebase`);
    
    if (usageInfo.some(u => u.usageType === 'parameter' || u.usageType === 'return')) {
      steps.push('5. Update function signatures - this may require updating callers');
    }

    if (this.replacementOptions.generateCodemod) {
      steps.push('6. Run generated codemod to automatically update usage sites');
    }

    steps.push('7. Run TypeScript compiler to verify no type errors');
    steps.push('8. Execute test suite to verify functionality is preserved');
    steps.push('9. Update documentation and type comments');
    steps.push('10. Deploy with monitoring and rollback plan ready');

    return steps;
  }

  /**
   * Estimate replacement effort
   */
  private estimateReplacementEffort(
    compatibilityResult: TypeCompatibilityResult,
    usageInfo: TypeUsageInfo[]
  ): TypeReplacementPlan['estimatedEffort'] {
    const complexityScore = 
      (compatibilityResult.isCompatible ? 0 : 3) +
      usageInfo.length * 0.1 +
      compatibilityResult.issues.filter(i => i.severity === 'error').length * 2;

    if (complexityScore < 1) return 'minimal';
    if (complexityScore < 3) return 'low';
    if (complexityScore < 8) return 'moderate';
    if (complexityScore < 15) return 'high';
    return 'very_high';
  }

  /**
   * Generate risk assessment
   */
  private generateRiskAssessment(
    compatibilityResult: TypeCompatibilityResult,
    usageInfo: TypeUsageInfo[]
  ): string {
    const risks: string[] = [];

    if (!compatibilityResult.isCompatible) {
      risks.push(`Type incompatibility (${compatibilityResult.migrationComplexity} complexity)`);
    }

    const breakingUsages = usageInfo.filter(u => 
      u.usageType === 'parameter' || u.usageType === 'return'
    ).length;
    
    if (breakingUsages > 0) {
      risks.push(`${breakingUsages} function signature changes required`);
    }

    if (usageInfo.length > 20) {
      risks.push('High usage count increases coordination complexity');
    }

    const errorIssues = compatibilityResult.issues.filter(i => i.severity === 'error').length;
    if (errorIssues > 0) {
      risks.push(`${errorIssues} critical compatibility issues require resolution`);
    }

    if (risks.length === 0) {
      return 'Low risk - types are compatible and changes are localized';
    }

    return `Medium to High risk: ${risks.join('; ')}`;
  }

  /**
   * Generate rollback plan
   */
  private generateRollbackPlan(codemodActions: CodemodAction[]): string[] {
    const rollbackSteps: string[] = [];

    rollbackSteps.push('1. Revert git commit containing type changes');
    
    if (codemodActions.length > 0) {
      rollbackSteps.push('2. If selective rollback needed, reverse codemod actions:');
      for (const action of codemodActions.slice(0, 5)) { // Show first 5 as examples
        rollbackSteps.push(`   - Revert "${action.description}" in ${action.filePath}`);
      }
      if (codemodActions.length > 5) {
        rollbackSteps.push(`   - ... and ${codemodActions.length - 5} more actions`);
      }
    }

    rollbackSteps.push('3. Run TypeScript compiler to verify clean state');
    rollbackSteps.push('4. Execute test suite to confirm system stability');
    rollbackSteps.push('5. Deploy previous version if necessary');

    return rollbackSteps;
  }

  /**
   * Generate validation steps
   */
  private generateValidationSteps(
    compatibilityResult: TypeCompatibilityResult,
    usageInfo: TypeUsageInfo[]
  ): string[] {
    const steps: string[] = [];

    steps.push('Compile check: tsc --noEmit');
    steps.push('Lint check: eslint affected files');
    steps.push('Unit tests: Run test suite for affected modules');

    if (usageInfo.some(u => u.usageType === 'parameter' || u.usageType === 'return')) {
      steps.push('Integration tests: Verify API contracts are maintained');
    }

    if (!compatibilityResult.isCompatible) {
      steps.push('Manual verification: Test edge cases identified in compatibility analysis');
    }

    steps.push('Performance testing: Ensure no runtime performance regression');
    steps.push('Documentation: Update type documentation and examples');

    return steps;
  }

  /**
   * Determine automation level
   */
  private determineAutomationLevel(
    compatibilityResult: TypeCompatibilityResult,
    usageInfo: TypeUsageInfo[]
  ): TypeReplacementReport['automationLevel'] {
    const errorIssues = compatibilityResult.issues.filter(i => i.severity === 'error');
    const autoFixableErrors = errorIssues.filter(i => i.autoFixable);
    
    if (compatibilityResult.isCompatible && usageInfo.length < 10) {
      return 'fully_automated';
    }
    
    if (errorIssues.length === 0 || errorIssues.length === autoFixableErrors.length) {
      return 'semi_automated';
    }
    
    return 'manual_only';
  }

  /**
   * Generate prerequisites
   */
  private generatePreRequisites(
    compatibilityResult: TypeCompatibilityResult,
    replacementPlan: TypeReplacementPlan
  ): string[] {
    const prerequisites: string[] = [];

    prerequisites.push('Backup current codebase state');
    prerequisites.push('Ensure clean git working directory');
    prerequisites.push('Run full test suite to establish baseline');

    if (!compatibilityResult.isCompatible) {
      prerequisites.push('Review and approve compatibility issue resolutions');
    }

    if (replacementPlan.codemodActions.some(a => a.riskLevel === 'breaking')) {
      prerequisites.push('Schedule maintenance window for breaking changes');
      prerequisites.push('Notify affected team members and stakeholders');
    }

    prerequisites.push('Have rollback plan ready and tested');

    return prerequisites;
  }

  /**
   * Generate post-validation steps
   */
  private generatePostValidation(replacementPlan: TypeReplacementPlan): string[] {
    const steps: string[] = [];

    steps.push('Verify all automated tests pass');
    steps.push('Perform manual smoke testing of critical paths');
    steps.push('Check TypeScript compilation is error-free');
    steps.push('Review diff to ensure only intended changes were made');

    if (replacementPlan.affectedUsages.length > 5) {
      steps.push('Spot-check sample of changed usage sites');
    }

    steps.push('Update team documentation');
    steps.push('Monitor application metrics post-deployment');

    return steps;
  }

  /**
   * Calculate usage analysis statistics
   */
  private calculateUsageStatistics(
    usageInfo: TypeUsageInfo[],
    compatibilityResult: TypeCompatibilityResult
  ): TypeReplacementReport['usageAnalysis'] {
    const totalUsages = usageInfo.length;
    
    // Simple heuristic for breaking vs compatible usages
    const breakingUsages = compatibilityResult.isCompatible ? 0 : 
      usageInfo.filter(u => u.usageType === 'parameter' || u.usageType === 'return').length;
    
    const compatibleUsages = compatibilityResult.isCompatible ? totalUsages : totalUsages - breakingUsages;
    const unknownUsages = 0; // Could be enhanced to detect complex usage patterns

    return {
      totalUsages,
      breakingUsages,
      compatibleUsages,
      unknownUsages
    };
  }
}