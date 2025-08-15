/**
 * Usage Pattern Detector - Phase 4 (D1)
 * 
 * Detects existing usage patterns that can be transformed to DU patterns
 */

import { Project, SourceFile, Node } from 'ts-morph';
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
  private project: Project;
  private options: TransformationOptions;

  constructor(options: Partial<TransformationOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.project = new Project({
      useInMemoryFileSystem: false,
      skipFileDependencyResolution: true
    });
  }

  /**
   * Analyze call sites for a specific DU candidate
   */
  async analyzeCallSites(duPlan: DUPlan, sourceFiles: string[]): Promise<CallSiteAnalysis> {
    if (this.options.verboseLogging) {
      console.log(`🔍 Analyzing call sites for ${duPlan.typeName}...`);
    }

    // Add source files to project
    const addedFiles = sourceFiles.map(filePath => 
      this.project.addSourceFileAtPath(filePath)
    );

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
    const conditionText = condition.getText();
    
    // Simple pattern matching for discriminant property
    if (conditionText.includes(`.${discriminant}`)) {
      return {
        patternType: 'property-check',
        location: this.getCodeLocation(condition, sourceFile),
        originalCode: conditionText,
        discriminantProperty: discriminant,
        confidence: 0.9 // High confidence for exact property match
      };
    }

    return null;
  }

  /**
   * Analyze ternary condition for DU patterns
   */
  private analyzeTernaryCondition(condition: Node, discriminant: string, sourceFile: SourceFile): UsagePattern | null {
    const conditionText = condition.getText();
    
    if (conditionText.includes(`.${discriminant}`)) {
      return {
        patternType: 'ternary-operator',
        location: this.getCodeLocation(condition, sourceFile),
        originalCode: conditionText,
        discriminantProperty: discriminant,
        confidence: 0.85 // Slightly lower confidence for ternary
      };
    }

    return null;
  }

  /**
   * Analyze switch expression for DU patterns
   */
  private analyzeSwitchExpression(expression: Node, discriminant: string, sourceFile: SourceFile): UsagePattern | null {
    const expressionText = expression.getText();
    
    if (expressionText.includes(`.${discriminant}`)) {
      return {
        patternType: 'switch-statement',
        location: this.getCodeLocation(expression, sourceFile),
        originalCode: expressionText,
        discriminantProperty: discriminant,
        confidence: 0.95 // High confidence for switch statements
      };
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
    const typeGuardName = `is${this.capitalize(duPlan.variants[0]?.tag?.toString() || 'Valid')}${duPlan.typeName}`;
    
    return {
      pattern,
      targetType: duPlan.typeName,
      transformationType: 'add-type-guard',
      newCode: pattern.originalCode.replace(
        new RegExp(`\\.${pattern.discriminantProperty}`),
        ` && ${typeGuardName}(obj)`
      ),
      dependencies: [`${typeGuardName} from './path/to/type-guards'`],
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
    // ts-morph cleanup if needed
  }
}