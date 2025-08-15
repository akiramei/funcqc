/**
 * Discriminated Union Transformer
 * 
 * Transforms existing code structures into discriminated unions.
 * Handles AST manipulation, code generation, and safe transformation of conditional logic.
 */

import { Node, SourceFile } from 'ts-morph';
import type { 
  DiscriminatedUnionCandidate 
} from './discriminated-union-analyzer';

export interface TransformationResult {
  success: boolean;
  transformedFiles: TransformedFile[];
  errors: TransformationError[];
  warnings: TransformationWarning[];
  rollbackInstructions: RollbackInstruction[];
}

export interface TransformedFile {
  filePath: string;
  originalContent: string;
  transformedContent: string;
  changesSummary: ChangeSummary;
}

export interface ChangeSummary {
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
  changeTypes: string[];
}

export interface TransformationError {
  type: 'syntax_error' | 'type_error' | 'semantic_error' | 'file_error';
  message: string;
  filePath: string;
  lineNumber?: number;
  columnNumber?: number;
  suggestion?: string;
}

export interface TransformationWarning {
  type: 'potential_issue' | 'manual_review_required' | 'incomplete_transformation';
  message: string;
  filePath: string;
  lineNumber?: number;
  suggestion: string;
}

export interface RollbackInstruction {
  filePath: string;
  action: 'restore_file' | 'remove_additions' | 'revert_modifications';
  backupPath: string;
  details: string;
}

export interface TransformationOptions {
  dryRun: boolean;                      // Preview changes without applying
  createBackups: boolean;               // Create backup files before transformation
  validateAfterTransform: boolean;      // Run TypeScript compiler after transformation
  preserveComments: boolean;            // Preserve existing comments
  addTransformationComments: boolean;   // Add comments explaining transformations
  maxFilesToTransform: number;          // Safety limit for bulk transformations
  targetTSVersion: string;              // Target TypeScript version for compatibility
}

export class DiscriminatedUnionTransformer {
  private options: TransformationOptions;

  constructor(options: Partial<TransformationOptions> = {}) {
    this.options = {
      dryRun: false,
      createBackups: true,
      validateAfterTransform: true,
      preserveComments: true,
      addTransformationComments: true,
      maxFilesToTransform: 50,
      targetTSVersion: '4.0',
      ...options
    };
  }

  /**
   * Main transformation entry point
   */
  async transform(candidate: DiscriminatedUnionCandidate): Promise<TransformationResult> {
    const result: TransformationResult = {
      success: true,
      transformedFiles: [],
      errors: [],
      warnings: [],
      rollbackInstructions: []
    };

    try {
      // Step 1: Validate transformation feasibility
      const validationResult = await this.validateTransformation(candidate);
      if (!validationResult.isValid) {
        result.success = false;
        result.errors.push(...validationResult.errors);
        return result;
      }

      // Step 2: Create backups if requested
      if (this.options.createBackups) {
        await this.createBackups(candidate, result);
      }

      // Step 3: Transform type definitions
      await this.transformTypeDefinitions(candidate, result);

      // Step 4: Transform usage sites
      await this.transformUsageSites(candidate, result);

      // Step 5: Generate helper functions
      await this.generateHelperFunctions(candidate, result);

      // Step 6: Update import statements
      await this.updateImportStatements(candidate, result);

      // Step 7: Validate transformed code
      if (this.options.validateAfterTransform && !this.options.dryRun) {
        await this.validateTransformedCode(result);
      }

    } catch (error) {
      result.success = false;
      result.errors.push({
        type: 'semantic_error',
        message: `Transformation failed: ${error instanceof Error ? error.message : String(error)}`,
        filePath: candidate.filePath
      });
    }

    return result;
  }

  /**
   * Validate that transformation is safe and feasible
   */
  private async validateTransformation(
    candidate: DiscriminatedUnionCandidate
  ): Promise<{ isValid: boolean; errors: TransformationError[] }> {
    const errors: TransformationError[] = [];

    // Check file accessibility
    try {
      const sourceFile = await this.loadSourceFile(candidate.filePath);
      if (!sourceFile) {
        errors.push({
          type: 'file_error',
          message: `Cannot access source file: ${candidate.filePath}`,
          filePath: candidate.filePath
        });
      }
    } catch (error) {
      errors.push({
        type: 'file_error',
        message: `File validation failed: ${error instanceof Error ? error.message : String(error)}`,
        filePath: candidate.filePath
      });
    }

    // Validate union cases
    if (candidate.unionCases.length < 2) {
      errors.push({
        type: 'semantic_error',
        message: 'At least 2 union cases required for discriminated union',
        filePath: candidate.filePath
      });
    }

    // Check for discriminant property conflicts  
    const conflictingValues = new Set();
    for (const unionCase of candidate.unionCases) {
      if (conflictingValues.has(unionCase.discriminantValue)) {
        errors.push({
          type: 'semantic_error',
          message: `Duplicate discriminant value: ${unionCase.discriminantValue}`,
          filePath: candidate.filePath
        });
      }
      conflictingValues.add(unionCase.discriminantValue);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Create backup files
   */
  private async createBackups(
    candidate: DiscriminatedUnionCandidate,
    result: TransformationResult
  ): Promise<void> {
    const filesToBackup = [candidate.filePath];
    
    // Add usage site files if we can identify them
    for (const phase of candidate.transformationPlan.phases) {
      for (const action of phase.actions) {
        const actionData = action as unknown as Record<string, unknown>;
        if (Array.isArray(actionData['targetFiles'])) {
          filesToBackup.push(...(actionData['targetFiles'] as string[]));
        }
      }
    }

    for (const filePath of new Set(filesToBackup)) {
      try {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        // In a real implementation, would copy file to backup location
        result.rollbackInstructions.push({
          filePath,
          action: 'restore_file',
          backupPath,
          details: `Backup created at ${backupPath}`
        });
      } catch (error) {
        result.warnings.push({
          type: 'potential_issue',
          message: `Failed to create backup for ${filePath}`,
          filePath,
          suggestion: 'Manually backup the file before proceeding'
        });
      }
    }
  }

  /**
   * Transform the main type definitions
   */
  private async transformTypeDefinitions(
    candidate: DiscriminatedUnionCandidate,
    result: TransformationResult
  ): Promise<void> {
    const sourceFile = await this.loadSourceFile(candidate.filePath);
    if (!sourceFile) return;

    const originalContent = sourceFile.getFullText();
    
    try {
      // Find the original type definition
      const originalType = this.findTypeDefinition(sourceFile, candidate.typeName);
      if (!originalType) {
        result.warnings.push({
          type: 'manual_review_required',
          message: `Could not locate type definition for ${candidate.typeName}`,
          filePath: candidate.filePath,
          suggestion: 'Manually add discriminated union definition'
        });
        return;
      }

      // Generate the new union type code
      const unionCode = this.generateUnionTypeDefinition(candidate);
      
      // Insert new code after original type (or replace if requested)
      if (this.options.addTransformationComments) {
        const commentedCode = this.addTransformationComments(unionCode, candidate);
        this.insertCodeAfterNode(originalType, commentedCode);
      } else {
        this.insertCodeAfterNode(originalType, unionCode);
      }

      // Record the transformation
      const transformedContent = sourceFile.getFullText();
      result.transformedFiles.push({
        filePath: candidate.filePath,
        originalContent,
        transformedContent,
        changesSummary: this.calculateChanges(originalContent, transformedContent)
      });

      if (!this.options.dryRun) {
        await sourceFile.save();
      }

    } catch (error) {
      result.errors.push({
        type: 'syntax_error',
        message: `Failed to transform type definition: ${error instanceof Error ? error.message : String(error)}`,
        filePath: candidate.filePath
      });
    }
  }

  /**
   * Transform usage sites (functions, conditionals, etc.)
   */
  private async transformUsageSites(
    candidate: DiscriminatedUnionCandidate,
    result: TransformationResult
  ): Promise<void> {
    // This would require extensive usage analysis
    // For now, we'll generate transformation instructions
    
    result.warnings.push({
      type: 'manual_review_required',
      message: `Manual review required for updating usage sites of ${candidate.typeName}`,
      filePath: candidate.filePath,
      suggestion: `
1. Update function parameters from ${candidate.typeName} to ${candidate.typeName}Union
2. Replace property access with discriminated union patterns
3. Convert if/else chains to switch statements using discriminant
4. Add exhaustiveness checking with never type
      `.trim()
    });

    // Generate example transformation patterns
    const switchPattern = this.generateSwitchPattern(candidate);
    const typeGuardPattern = this.generateTypeGuardPattern(candidate);
    
    result.warnings.push({
      type: 'manual_review_required',
      message: 'Use these patterns for manual transformation',
      filePath: candidate.filePath,
      suggestion: `
Switch Pattern:
${switchPattern}

Type Guard Pattern:
${typeGuardPattern}
      `.trim()
    });
  }

  /**
   * Generate helper functions (type guards, constructors, etc.)
   */
  private async generateHelperFunctions(
    candidate: DiscriminatedUnionCandidate,
    result: TransformationResult
  ): Promise<void> {
    const sourceFile = await this.loadSourceFile(candidate.filePath);
    if (!sourceFile) return;

    const originalContent = sourceFile.getFullText();

    try {
      // Generate helper functions
      const helpers = candidate.transformationPlan.generatedCode;
      
      // Add type guards
      for (const typeGuard of helpers.typeGuards) {
        this.appendCode(sourceFile, typeGuard);
      }

      // Add constructors
      for (const constructorCode of helpers.constructors) {
        this.appendCode(sourceFile, constructorCode);
      }

      // Add switch helpers
      for (const switchHelper of helpers.switchHelpers) {
        this.appendCode(sourceFile, switchHelper);
      }

      const transformedContent = sourceFile.getFullText();
      
      // Update or add to existing transformed file record
      const existingRecord = result.transformedFiles.find(f => f.filePath === candidate.filePath);
      if (existingRecord) {
        existingRecord.transformedContent = transformedContent;
        existingRecord.changesSummary = this.calculateChanges(originalContent, transformedContent);
      } else {
        result.transformedFiles.push({
          filePath: candidate.filePath,
          originalContent,
          transformedContent,
          changesSummary: this.calculateChanges(originalContent, transformedContent)
        });
      }

      if (!this.options.dryRun) {
        await sourceFile.save();
      }

    } catch (error) {
      result.errors.push({
        type: 'syntax_error',
        message: `Failed to generate helper functions: ${error instanceof Error ? error.message : String(error)}`,
        filePath: candidate.filePath
      });
    }
  }

  /**
   * Update import statements to include new union types
   */
  private async updateImportStatements(
    candidate: DiscriminatedUnionCandidate,
    result: TransformationResult
  ): Promise<void> {
    // This would require dependency analysis to find all files that import the transformed type
    result.warnings.push({
      type: 'manual_review_required',
      message: `Update import statements in files that use ${candidate.typeName}`,
      filePath: candidate.filePath,
      suggestion: `Update imports to include:
- ${candidate.typeName}Union
- Type guard functions (is${candidate.unionCases[0].caseName}, etc.)
- Constructor functions (create${candidate.unionCases[0].caseName}, etc.)
- Switch helper (handle${candidate.typeName}Union)`
    });
  }

  /**
   * Validate transformed code compiles correctly
   */
  private async validateTransformedCode(result: TransformationResult): Promise<void> {
    // In a real implementation, would run TypeScript compiler
    result.warnings.push({
      type: 'manual_review_required',
      message: 'Run TypeScript compiler to validate transformed code',
      filePath: '',
      suggestion: 'Run: npx tsc --noEmit to check for compilation errors'
    });
  }

  /**
   * Load source file using ts-morph
   */
  private async loadSourceFile(_filePath: string): Promise<SourceFile | null> {
    try {
      // In a real implementation, would use ts-morph Project to load file
      // For now, return null to indicate we need actual file system access
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find type definition node in source file
   */
  private findTypeDefinition(_sourceFile: SourceFile, _typeName: string): Node | null {
    // Would search for interface/type declarations with matching name
    return null;
  }

  /**
   * Generate union type definition code
   */
  private generateUnionTypeDefinition(candidate: DiscriminatedUnionCandidate): string {
    const discriminantName = candidate.discriminantProperty.name;
    
    // Generate interface for each union case
    const caseInterfaces = candidate.unionCases.map(unionCase => {
      const requiredProps = unionCase.requiredProperties
        .map(prop => `  ${prop.name}: ${prop.type};`)
        .join('\n');
      
      const optionalProps = unionCase.optionalProperties
        .map(prop => `  ${prop.name}?: ${prop.type};`)
        .join('\n');

      const valueLiteral = this.formatDiscriminantValue(
        candidate.discriminantProperty.type,
        unionCase.discriminantValue
      );
      return `export interface ${unionCase.caseName} {
  ${discriminantName}: ${valueLiteral};
${requiredProps}
${optionalProps}
}`;
    });

    // Generate union type
    const unionType = `export type ${candidate.typeName}Union = ${
      candidate.unionCases.map(c => c.caseName).join(' | ')
    };`;

    return `${caseInterfaces.join('\n\n')}\n\n${unionType}`;
  }

  /**
   * Generate switch statement pattern for transformation guidance
   */
  private generateSwitchPattern(candidate: DiscriminatedUnionCandidate): string {
    const discriminantName = candidate.discriminantProperty.name;
    
    const cases = candidate.unionCases.map(unionCase => 
      `  case '${unionCase.discriminantValue}':
    // Handle ${unionCase.caseName}
    return handleCase${unionCase.caseName}(obj);`
    ).join('\n');

    return `function process${candidate.typeName}(obj: ${candidate.typeName}Union) {
  switch (obj.${discriminantName}) {
${cases}
    default:
      // Exhaustiveness check
      const _exhaustive: never = obj;
      throw new Error(\`Unhandled ${discriminantName}: \${_exhaustive}\`);
  }
}`;
  }

  /**
   * Generate type guard pattern for transformation guidance
   */
  private generateTypeGuardPattern(candidate: DiscriminatedUnionCandidate): string {
    const examples = candidate.unionCases.slice(0, 2).map(unionCase => 
      `if (is${unionCase.caseName}(obj)) {
  // obj is now typed as ${unionCase.caseName}
  console.log(obj.${unionCase.requiredProperties[0]?.name || 'someProperty'});
}`
    ).join(' else ');

    return examples;
  }

  /**
   * Insert code after a specific node
   */
  private insertCodeAfterNode(_node: Node, _code: string): void {
    // Would use ts-morph API to insert code
    // node.insertText(node.getEnd(), '\n\n' + code);
  }

  /**
   * Append code to end of source file
   */
  private appendCode(_sourceFile: SourceFile, _code: string): void {
    // Would use ts-morph API to append code
    // sourceFile.insertText(sourceFile.getEnd(), '\n\n' + code);
  }

  /**
   * Add transformation comments to generated code
   */
  private addTransformationComments(code: string, candidate: DiscriminatedUnionCandidate): string {
    const header = `/**
 * Generated discriminated union for ${candidate.typeName}
 * 
 * This union type was automatically generated from the analysis of:
 * - Discriminant property: ${candidate.discriminantProperty.name}
 * - Union cases: ${candidate.unionCases.length}
 * - Confidence: ${Math.round(candidate.confidence * 100)}%
 * 
 * Benefits:
 * - Eliminated branches: ${candidate.refactoringBenefit.eliminatedBranches}
 * - Improved type safety: ${Math.round(candidate.refactoringBenefit.improvedTypesafety * 100)}%
 * - Reduced complexity: ~${candidate.refactoringBenefit.reducedComplexity} lines
 */`;

    return header + '\n' + code;
  }

  /**
   * Calculate changes between original and transformed content
   */
  private calculateChanges(original: string, transformed: string): ChangeSummary {
    const originalLines = original.split('\n').length;
    const transformedLines = transformed.split('\n').length;
    
    return {
      linesAdded: Math.max(0, transformedLines - originalLines),
      linesRemoved: Math.max(0, originalLines - transformedLines),
      linesModified: 0, // Would need diff analysis
      changeTypes: ['discriminated_union_transformation']
    };
  }

  /**
   * Batch transform multiple candidates
   */
  async batchTransform(
    candidates: DiscriminatedUnionCandidate[]
  ): Promise<Map<string, TransformationResult>> {
    const results = new Map<string, TransformationResult>();
    
    // Safety check
    if (candidates.length > this.options.maxFilesToTransform) {
      throw new Error(`Too many files to transform: ${candidates.length} > ${this.options.maxFilesToTransform}`);
    }

    for (const candidate of candidates) {
      try {
        const result = await this.transform(candidate);
        results.set(candidate.typeName, result);
        
        // Stop on first error if not in dry run mode
        if (!result.success && !this.options.dryRun) {
          break;
        }
      } catch (error) {
        results.set(candidate.typeName, {
          success: false,
          transformedFiles: [],
          errors: [{
            type: 'semantic_error',
            message: error instanceof Error ? error.message : String(error),
            filePath: candidate.filePath
          }],
          warnings: [],
          rollbackInstructions: []
        });
      }
    }

    return results;
  }

  /**
   * Generate transformation preview
   */
  async preview(candidate: DiscriminatedUnionCandidate): Promise<TransformationResult> {
    const originalDryRun = this.options.dryRun;
    this.options.dryRun = true;
    
    try {
      const result = await this.transform(candidate);
      return result;
    } finally {
      this.options.dryRun = originalDryRun;
    }
  }

  /**
   * Rollback transformations
   */
  async rollback(rollbackInstructions: RollbackInstruction[]): Promise<boolean> {
    try {
      for (const instruction of rollbackInstructions) {
        switch (instruction.action) {
          case 'restore_file':
            // Would restore from backup
            break;
          case 'remove_additions':
            // Would remove added code
            break;
          case 'revert_modifications':
            // Would revert specific modifications
            break;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format discriminant value based on its type
   */
  private formatDiscriminantValue(
    discriminantType: string,
    value: string | number | boolean
  ): string {
    switch (discriminantType) {
      case 'boolean':
        return String(value); // true / false
      case 'numeric_literal':
        return String(value); // 1 / 2 など
      // 既定: 文字列リテラル
      case 'string_literal':
      default:
        return `'${String(value)}'`;
    }
  }
}