/**
 * Usage Pattern Detector - Phase 4 (D1)
 * 
 * Detects existing usage patterns that can be transformed to DU patterns
 */

import { Project, SourceFile, Node } from 'ts-morph';
import fs from 'fs';
import path from 'path';
import type { 
  UsagePattern, 
  CodeLocation, 
  CallSiteAnalysis,
  TransformationOptions 
} from './transformation-types';
import type { DUPlan } from './types';

/**
 * Default transformation options
 */
const DEFAULT_OPTIONS: TransformationOptions = {
  dryRun: true,
  backupFiles: true,
  validateBeforeApply: true,
  minConfidence: 0.8,
  allowHighRiskTransformations: false,
  generateReport: true,
  verboseLogging: false
};

/**
 * Detects usage patterns for DU transformation candidates
 */
export class UsagePatternDetector {
  private project?: Project;
  private options: TransformationOptions;

  constructor(options: Partial<TransformationOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Initialize ts-morph project following existing patterns
   */
  private async initializeProject(): Promise<void> {
    // Find tsconfig.json using same pattern as core/analyzer
    const tsConfigPath = await this.findTsConfigPath();
    
    const projectOptions: import('ts-morph').ProjectOptions = {
      skipAddingFilesFromTsConfig: true, // Don't load all files, we'll add specific ones
      skipLoadingLibFiles: true,
      useInMemoryFileSystem: false
    };
    
    if (tsConfigPath) {
      projectOptions.tsConfigFilePath = tsConfigPath;
    }
    
    this.project = new Project(projectOptions);
  }

  /**
   * Find tsconfig.json following core/analyzer pattern
   */
  private async findTsConfigPath(): Promise<string | undefined> {
    // Search upward until filesystem root (cross-platform)
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
   * Analyze call sites for a specific DU candidate
   */
  async analyzeCallSites(duPlan: DUPlan, sourceFiles: string[]): Promise<CallSiteAnalysis> {
    if (this.options.verboseLogging) {
      console.log(`🔍 Analyzing call sites for ${duPlan.typeName}...`);
    }

    // Initialize project if not already done
    if (!this.project) {
      await this.initializeProject();
    }

    // Add source files to project (following core/analyzer pattern)
    const addedFiles = sourceFiles.map(filePath => {
      const normalizedPath = path.resolve(filePath); // Ensure absolute path
      return this.project!.addSourceFileAtPath(normalizedPath);
    });

    const usagePatterns: UsagePattern[] = [];

    // Analyze each file for usage patterns
    for (const sourceFile of addedFiles) {
      const patterns = await this.findUsagePatternsInFile(sourceFile, duPlan);
      usagePatterns.push(...patterns);
    }

    if (this.options.verboseLogging) {
      console.log(`   Found ${usagePatterns.length} usage patterns`);
    }

    // Generate transformation plans (simplified for Phase 4 start)
    const transformationPlans = usagePatterns
      .filter(pattern => pattern.confidence >= this.options.minConfidence)
      .map(pattern => this.createBasicTransformationPlan(pattern, duPlan));

    const safeTransformations = transformationPlans.filter(plan => plan.riskLevel === 'low').length;
    const riskyTransformations = transformationPlans.filter(plan => plan.riskLevel !== 'low').length;

    return {
      typeName: duPlan.typeName,
      usagePatterns,
      transformationPlans,
      summary: {
        totalPatterns: usagePatterns.length,
        safeTransformations,
        riskyTransformations,
        estimatedEffort: this.estimateEffort(transformationPlans.length)
      }
    };
  }

  /**
   * Find usage patterns in a single source file
   */
  private async findUsagePatternsInFile(sourceFile: SourceFile, duPlan: DUPlan): Promise<UsagePattern[]> {
    const patterns: UsagePattern[] = [];
    const discriminant = duPlan.discriminant;

    // Pattern 1: Property access checks (if/else)
    sourceFile.forEachDescendant((node) => {
      // Look for: if (obj.discriminant) or if (obj.discriminant === value)
      if (Node.isIfStatement(node)) {
        const condition = node.getExpression();
        const pattern = this.analyzeIfCondition(condition, discriminant, sourceFile);
        if (pattern) {
          patterns.push(pattern);
        }
      }

      // Pattern 2: Ternary operators
      if (Node.isConditionalExpression(node)) {
        const condition = node.getCondition();
        const pattern = this.analyzeTernaryCondition(condition, discriminant, sourceFile);
        if (pattern) {
          patterns.push(pattern);
        }
      }

      // Pattern 3: Switch statements
      if (Node.isSwitchStatement(node)) {
        const expression = node.getExpression();
        const pattern = this.analyzeSwitchExpression(expression, discriminant, sourceFile);
        if (pattern) {
          patterns.push(pattern);
        }
      }
    });

    return patterns;
  }

  /**
   * Analyze if statement condition for DU patterns
   */
  private analyzeIfCondition(condition: Node, discriminant: string, sourceFile: SourceFile): UsagePattern | null {
    // Use AST structure for more accurate detection
    if (Node.isPropertyAccessExpression(condition)) {
      if (condition.getName() === discriminant) {
        return {
          patternType: 'property-check',
          location: this.getCodeLocation(condition, sourceFile),
          originalCode: condition.getText(),
          discriminantProperty: discriminant,
          confidence: 0.95 // Higher confidence for AST-based detection
        };
      }
    }

    // Check for binary expressions (obj.prop === value)
    if (Node.isBinaryExpression(condition)) {
      const left = condition.getLeft();
      if (Node.isPropertyAccessExpression(left) && left.getName() === discriminant) {
        const discriminantValue = this.extractDiscriminantValue(condition.getRight());
        const pattern: UsagePattern = {
          patternType: 'property-check',
          location: this.getCodeLocation(condition, sourceFile),
          originalCode: condition.getText(),
          discriminantProperty: discriminant,
          confidence: 0.95
        };
        
        if (discriminantValue !== undefined) {
          pattern.discriminantValue = discriminantValue;
        }
        
        return pattern;
      }
    }

    return null;
  }

  /**
   * Extract discriminant value from AST node
   */
  private extractDiscriminantValue(node: Node): string | number | boolean | undefined {
    if (Node.isStringLiteral(node)) {
      return node.getLiteralValue();
    }
    if (Node.isNumericLiteral(node)) {
      return node.getLiteralValue();
    }
    // Handle boolean literals (true/false keywords)
    const nodeText = node.getText();
    if (nodeText === 'true') {
      return true;
    }
    if (nodeText === 'false') {
      return false;
    }
    return undefined;
  }

  /**
   * Analyze ternary condition for DU patterns
   */
  private analyzeTernaryCondition(condition: Node, discriminant: string, sourceFile: SourceFile): UsagePattern | null {
    // Apply same AST-based analysis as if conditions
    return this.analyzeIfCondition(condition, discriminant, sourceFile);
  }

  /**
   * Analyze switch expression for DU patterns
   */
  private analyzeSwitchExpression(expression: Node, discriminant: string, sourceFile: SourceFile): UsagePattern | null {
    if (Node.isPropertyAccessExpression(expression)) {
      if (expression.getName() === discriminant) {
        return {
          patternType: 'switch-statement',
          location: this.getCodeLocation(expression, sourceFile),
          originalCode: expression.getText(),
          discriminantProperty: discriminant,
          confidence: 0.98 // Very high confidence for switch statements
        };
      }
    }

    return null;
  }

  /**
   * Get code location information from AST node
   */
  private getCodeLocation(node: Node, sourceFile: SourceFile): CodeLocation {
    const start = node.getStart();
    const end = node.getEnd();
    const startLineAndColumn = sourceFile.getLineAndColumnAtPos(start);
    const endLineAndColumn = sourceFile.getLineAndColumnAtPos(end);

    return {
      filePath: sourceFile.getFilePath(),
      startLine: startLineAndColumn.line,
      endLine: endLineAndColumn.line,
      startColumn: startLineAndColumn.column,
      endColumn: endLineAndColumn.column
    };
  }

  /**
   * Create basic transformation plan (simplified for Phase 4 start)
   */
  private createBasicTransformationPlan(pattern: UsagePattern, duPlan: DUPlan): import('./transformation-types').TransformationPlan {
    const rawTag = duPlan.variants[0]?.tag;
    const safeTagPart = this.sanitizeIdentifier(String(rawTag ?? 'Valid'));
    const typeGuardName = `is${safeTagPart}${duPlan.typeName}`;
    const guardsModule = this.options.guardsModulePath || './type-guards';
    
    return {
      pattern,
      targetType: duPlan.typeName,
      transformationType: 'add-type-guard',
      // NOTE: Use placeholder instead of direct string substitution
      // Actual transformation is performed by AST-based transformer
      newCode: `/* TODO: add guard */ ${typeGuardName}(/* value */) && (${pattern.originalCode})`,
      dependencies: [`${typeGuardName} from '${guardsModule}'`],
      riskLevel: pattern.confidence >= 0.9 ? 'low' : 'medium',
      validationSteps: [
        {
          type: 'type-check',
          description: 'Verify TypeScript compilation succeeds',
          automated: true,
          command: 'npx tsc --noEmit'
        }
      ]
    };
  }

  /**
   * Sanitize identifier for safe TypeScript usage
   */
  private sanitizeIdentifier(raw: string): string {
    // Remove non-identifier characters
    let id = String(raw).replace(/[^\p{L}\p{N}_$]/gu, '');
    // Ensure it starts with a letter, underscore, or dollar sign
    if (!/^[A-Za-z_$]/.test(id)) {
      id = `Variant${id}`;
    }
    return this.capitalize(id);
  }

  /**
   * TODO: Implement proper regex-based pattern matching when needed
   * For now, using AST-based detection which is more reliable
   */

  /**
   * Estimate effort for transformations
   */
  private estimateEffort(transformationCount: number): string {
    if (transformationCount <= 5) return 'low';
    if (transformationCount <= 15) return 'medium';
    return 'high';
  }

  /**
   * Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.project) {
      try {
        // ts-morph Project のメモリを解放
        // Note: ts-morph doesn't have explicit disposal, but we clear the reference
        (this.project as Project | undefined) = undefined;
      } catch (error) {
        // Ignore cleanup errors in dispose
      }
    }
  }
}