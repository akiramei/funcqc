/**
 * Refactoring Guardrail
 * 
 * Provides safety analysis and guidelines for type refactoring operations.
 * Generates checklists, test templates, and impact analysis to prevent
 * breaking changes during refactoring.
 */

import type { StorageQueryInterface } from '../type-insights/types';
import { StructuralSubsumptionAnalyzer } from '../type-insights/structural-subsumption-analyzer';
import { BehavioralFingerprintAnalyzer } from '../type-insights/behavioral-fingerprint-analyzer';
import { CochangeAnalyzer, type GitProvider } from '../type-insights/cochange-analyzer';

interface TypeInfo extends Record<string, unknown> {
  id: string;
  name: string;
  file_path: string;
  // 他の必要なプロパティを追加
}

interface FunctionUsageRow {
  name: string;
  file_path: string;
}

export interface RefactoringGuardRailOptions {
  includeTestTemplates: boolean;    // Generate test templates
  includeTypeChecks: boolean;       // Include TypeScript compatibility checks
  includeBehavioralChecks: boolean; // Include behavioral pattern checks
  includeImpactAnalysis: boolean;   // Include change impact analysis
  generatePRSummary: boolean;       // Generate PR summary template
  riskThreshold: 'low' | 'medium' | 'high'; // Risk tolerance level
}

export interface TypeChangeImpact {
  typeId: string;
  typeName: string;
  file: string;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  affectedFunctions: string[];      // Functions using this type
  affectedTypes: string[];          // Other types depending on this
  cochangePartners: string[];       // Types that frequently change together
  riskFactors: string[];            // Specific risk factors identified
}

export interface RefactoringChecklistItem {
  category: 'type-safety' | 'behavior' | 'breaking-change' | 'performance' | 'testing';
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  checkMethod: string;              // How to verify this item
  automationPossible: boolean;      // Can this be automated
  relatedTypes?: string[];          // Types this check applies to
}

export interface TestTemplate {
  testType: 'unit' | 'integration' | 'boundary' | 'regression';
  description: string;
  template: string;                 // Test code template
  requiredInputs: string[];         // What data is needed
  expectedOutputs: string[];        // What should be validated
}

export interface RefactoringGuardRailReport {
  targetType: string;
  operationType: 'replace' | 'merge' | 'split' | 'extract' | 'inline';
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  impactAnalysis: TypeChangeImpact[];
  checklist: RefactoringChecklistItem[];
  testTemplates: TestTemplate[];
  prSummary: string;
  recommendations: string[];
  warnings: string[];
  blockingIssues: string[];         // Issues that should prevent refactoring
}

export class RefactoringGuardRail {
  protected storage: StorageQueryInterface;
  protected options: RefactoringGuardRailOptions;
  private subsumptionAnalyzer: StructuralSubsumptionAnalyzer;
  private behavioralAnalyzer: BehavioralFingerprintAnalyzer;
  private cochangeAnalyzer?: CochangeAnalyzer;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<RefactoringGuardRailOptions> = {}
  ) {
    this.storage = storage;
    this.options = {
      includeTestTemplates: options.includeTestTemplates ?? true,
      includeTypeChecks: options.includeTypeChecks ?? true,
      includeBehavioralChecks: options.includeBehavioralChecks ?? true,
      includeImpactAnalysis: options.includeImpactAnalysis ?? true,
      generatePRSummary: options.generatePRSummary ?? true,
      riskThreshold: options.riskThreshold ?? 'medium',
      ...options
    };

    this.subsumptionAnalyzer = new StructuralSubsumptionAnalyzer(storage);
    this.behavioralAnalyzer = new BehavioralFingerprintAnalyzer(storage);
  }

  /**
   * Set Git provider for co-change analysis
   */
  setGitProvider(gitProvider: GitProvider): void {
    this.cochangeAnalyzer = new CochangeAnalyzer(this.storage, gitProvider);
  }

  /**
   * Analyze refactoring safety for a specific type
   */
  async analyzeTypeRefactoring(
    typeName: string, 
    operationType: RefactoringGuardRailReport['operationType'],
    snapshotId?: string
  ): Promise<RefactoringGuardRailReport> {
    try {
      // Get type information
      const typeInfo = await this.getTypeInformation(typeName, snapshotId);
      if (!typeInfo) {
        throw new Error(`Type '${typeName}' not found`);
      }

      // Perform impact analysis
      const impactAnalysis = await this.analyzeTypeImpact(typeInfo as TypeInfo, snapshotId);
      
      // Generate checklist
      const checklist = await this.generateRefactoringChecklist(typeInfo, operationType, impactAnalysis);
      
      // Generate test templates
      const testTemplates = this.options.includeTestTemplates 
        ? this.generateTestTemplates(typeInfo, operationType)
        : [];

      // Calculate overall risk
      const overallRisk = this.calculateOverallRisk(impactAnalysis, operationType);
      
      // Generate recommendations and warnings
      const { recommendations, warnings, blockingIssues } = 
        this.generateRecommendations(impactAnalysis, overallRisk, operationType);

      // Generate PR summary
      const prSummary = this.options.generatePRSummary 
        ? this.generatePRSummary(typeName, operationType, impactAnalysis, overallRisk)
        : '';

      return {
        targetType: typeName,
        operationType,
        overallRisk,
        impactAnalysis,
        checklist,
        testTemplates,
        prSummary,
        recommendations,
        warnings,
        blockingIssues
      };
    } catch (error) {
      throw new Error(`Failed to analyze refactoring safety for '${typeName}': ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  /**
   * Get type information from database
   */
  private async getTypeInformation(typeName: string, snapshotId?: string): Promise<Record<string, unknown> | null> {
    const query = snapshotId
      ? `SELECT * FROM type_definitions WHERE name = $1 AND snapshot_id = $2`
      : `SELECT * FROM type_definitions WHERE name = $1 ORDER BY created_at DESC LIMIT 1`;

    const params = snapshotId ? [typeName, snapshotId] : [typeName];
    const result = await this.storage.query(query, params);
    
    return (result.rows[0] as Record<string, unknown>) || null;
  }

  /**
   * Analyze the impact of changing a specific type
   */
  private async analyzeTypeImpact(typeInfo: TypeInfo, snapshotId?: string): Promise<TypeChangeImpact[]> {
    const impacts: TypeChangeImpact[] = [];

    // Analyze direct dependencies
    const directImpact = await this.analyzeDirectImpact(typeInfo, snapshotId);
    impacts.push(directImpact);

    // Analyze structural relationships if enabled
    if (this.options.includeTypeChecks) {
      const structuralImpacts = await this.analyzeStructuralImpact(typeInfo, snapshotId);
      impacts.push(...structuralImpacts);
    }

    // Analyze behavioral impacts if enabled
    if (this.options.includeBehavioralChecks) {
      const behavioralImpacts = await this.analyzeBehavioralImpact(typeInfo, snapshotId);
      impacts.push(...behavioralImpacts);
    }

    // Analyze co-change patterns if Git provider is available
    if (this.cochangeAnalyzer && this.options.includeImpactAnalysis) {
      const cochangeImpacts = await this.analyzeCochangeImpact(typeInfo, snapshotId);
      impacts.push(...cochangeImpacts);
    }

    return impacts;
  }

  /**
   * Analyze direct impact (functions using this type)
   */
  private async analyzeDirectImpact(typeInfo: Record<string, unknown>, snapshotId?: string): Promise<TypeChangeImpact> {
    // Query functions that use this type
    const query = snapshotId
      ? `SELECT DISTINCT f.name, f.file_path FROM functions f 
         JOIN function_type_usage ftu ON f.id = ftu.function_id 
         WHERE ftu.type_id = $1 AND f.snapshot_id = $2`
      : `SELECT DISTINCT f.name, f.file_path FROM functions f 
         JOIN function_type_usage ftu ON f.id = ftu.function_id 
         WHERE ftu.type_id = $1`;

    const params = snapshotId ? [typeInfo['id'], snapshotId] : [typeInfo['id']];
    const result = await this.storage.query(query, params);

    const affectedFunctions = result.rows.map((row) => {
      const typedRow = row as FunctionUsageRow;
      return typedRow.name;
    });
    
    return {
      typeId: String(typeInfo['id'] ?? ''),
      typeName: String(typeInfo['name'] ?? ''),
      file: String(typeInfo['file_path'] ?? ''),
      impactLevel: this.calculateImpactLevel(affectedFunctions.length, 'direct'),
      affectedFunctions,
      affectedTypes: [],
      cochangePartners: [],
      riskFactors: this.identifyDirectRiskFactors(affectedFunctions.length, typeInfo)
    };
  }

  /**
   * Analyze structural impact using subsumption analysis
   */
  private async analyzeStructuralImpact(typeInfo: any, snapshotId?: string): Promise<TypeChangeImpact[]> {
    try {
      const patterns = await this.subsumptionAnalyzer.analyze(snapshotId);
      const relatedPatterns = patterns.filter(p => 
        p.types.includes(typeInfo.id) || p.types.includes(typeInfo.name)
      );

      return relatedPatterns.map(pattern => ({
        typeId: typeInfo.id,
        typeName: typeInfo.name,
        file: typeInfo.file_path,
        impactLevel: this.calculateImpactLevel(pattern.support, 'structural'),
        affectedFunctions: [],
        affectedTypes: pattern.types.filter(t => t !== typeInfo.name),
        cochangePartners: [],
        riskFactors: [`Structural relationship: ${pattern.pattern.join(', ')}`]
      }));
    } catch (error) {
      console.warn('Structural impact analysis failed:', error);
      return [];
    }
  }

  /**
   * Analyze behavioral impact using fingerprint analysis
   */
  private async analyzeBehavioralImpact(typeInfo: any, snapshotId?: string): Promise<TypeChangeImpact[]> {
    try {
      const patterns = await this.behavioralAnalyzer.analyze(snapshotId);
      const relatedPatterns = patterns.filter(p => 
        p.types.includes(typeInfo.id) || p.types.includes(typeInfo.name)
      );

      return relatedPatterns.map(pattern => ({
        typeId: typeInfo.id,
        typeName: typeInfo.name,
        file: typeInfo.file_path,
        impactLevel: this.calculateImpactLevel(pattern.support, 'behavioral'),
        affectedFunctions: [],
        affectedTypes: pattern.types.filter(t => t !== typeInfo.name),
        cochangePartners: [],
        riskFactors: [`Behavioral pattern: ${pattern.pattern.join(', ')}`]
      }));
    } catch (error) {
      console.warn('Behavioral impact analysis failed:', error);
      return [];
    }
  }

  /**
   * Analyze co-change impact using Git history
   */
  private async analyzeCochangeImpact(typeInfo: any, snapshotId?: string): Promise<TypeChangeImpact[]> {
    if (!this.cochangeAnalyzer) return [];

    try {
      const reports = await this.cochangeAnalyzer.analyze(snapshotId);
      if (reports.length === 0) return [];

      const report = reports[0];
      const typeChanges = report.typeChanges.find(tc => tc.typeName === typeInfo.name);
      if (!typeChanges) return [];

      // Find co-change partners
      const cochangePartners = report.cochangeMatrix
        .filter(rel => rel.typeA === typeInfo.name || rel.typeB === typeInfo.name)
        .map(rel => rel.typeA === typeInfo.name ? rel.typeB : rel.typeA);

      return [{
        typeId: typeInfo.id,
        typeName: typeInfo.name,
        file: typeInfo.file_path,
        impactLevel: this.calculateImpactLevel(typeChanges.changeCount, 'temporal'),
        affectedFunctions: [],
        affectedTypes: [],
        cochangePartners,
        riskFactors: [
          `Change frequency: ${typeChanges.changeCount} changes in ${report.statistics.timeSpan}`,
          `Volatility: ${(typeChanges.volatility * 100).toFixed(1)}%`,
          `Co-change partners: ${cochangePartners.length}`
        ]
      }];
    } catch (error) {
      console.warn('Co-change impact analysis failed:', error);
      return [];
    }
  }

  /**
   * Calculate impact level based on metrics
   */
  private calculateImpactLevel(
    value: number, 
    type: 'direct' | 'structural' | 'behavioral' | 'temporal'
  ): TypeChangeImpact['impactLevel'] {
    const thresholds = {
      direct: { low: 3, medium: 10, high: 25 },
      structural: { low: 2, medium: 5, high: 10 },
      behavioral: { low: 2, medium: 5, high: 10 },
      temporal: { low: 5, medium: 15, high: 30 }
    };

    const threshold = thresholds[type];
    
    if (value >= threshold.high) return 'critical';
    if (value >= threshold.medium) return 'high';
    if (value >= threshold.low) return 'medium';
    return 'low';
  }

  /**
   * Identify risk factors for direct impact
   */
  private identifyDirectRiskFactors(usageCount: number, typeInfo: any): string[] {
    const factors: string[] = [];
    
    if (usageCount > 50) {
      factors.push('High usage count - widespread impact expected');
    }
    
    if (typeInfo.file_path?.includes('api') || typeInfo.file_path?.includes('public')) {
      factors.push('Public API type - external compatibility concerns');
    }
    
    if (typeInfo.name?.endsWith('Config') || typeInfo.name?.endsWith('Options')) {
      factors.push('Configuration type - may affect application behavior');
    }

    return factors;
  }

  /**
   * Generate refactoring checklist
   */
  private async generateRefactoringChecklist(
    typeInfo: any,
    operationType: RefactoringGuardRailReport['operationType'],
    impactAnalysis: TypeChangeImpact[]
  ): Promise<RefactoringChecklistItem[]> {
    const checklist: RefactoringChecklistItem[] = [];

    // Type safety checks
    checklist.push({
      category: 'type-safety',
      priority: 'critical',
      description: 'Verify TypeScript compilation passes without errors',
      checkMethod: 'Run `tsc --noEmit` and fix all type errors',
      automationPossible: true
    });

    // Breaking change checks
    if (operationType === 'replace') {
      checklist.push({
        category: 'breaking-change',
        priority: 'high',
        description: 'Verify structural compatibility between old and new types',
        checkMethod: 'Use structural subsumption analysis to check compatibility',
        automationPossible: true,
        relatedTypes: [typeInfo.name]
      });
    }

    // Behavioral checks
    checklist.push({
      category: 'behavior',
      priority: 'high',
      description: 'Verify function behavior remains consistent',
      checkMethod: 'Run existing unit tests and add regression tests',
      automationPossible: false
    });

    // Performance checks
    checklist.push({
      category: 'performance',
      priority: 'medium',
      description: 'Check for performance regressions',
      checkMethod: 'Run performance benchmarks before and after change',
      automationPossible: true
    });

    // Testing requirements
    const highImpactTypes = impactAnalysis.filter(i => 
      i.impactLevel === 'high' || i.impactLevel === 'critical'
    );
    
    if (highImpactTypes.length > 0) {
      checklist.push({
        category: 'testing',
        priority: 'critical',
        description: `Add comprehensive tests for ${highImpactTypes.length} high-impact areas`,
        checkMethod: 'Use generated test templates and ensure >80% coverage',
        automationPossible: false,
        relatedTypes: highImpactTypes.map(t => t.typeName)
      });
    }

    return checklist.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Generate test templates
   */
  private generateTestTemplates(
    typeInfo: any,
    operationType: RefactoringGuardRailReport['operationType']
  ): TestTemplate[] {
    const templates: TestTemplate[] = [];

    // Unit test template
    templates.push({
      testType: 'unit',
      description: `Unit tests for ${typeInfo.name} type usage`,
      template: `describe('${typeInfo.name}', () => {
  it('should maintain type compatibility', () => {
    // Test type instantiation
    const instance: ${typeInfo.name} = {
      // Add required properties
    };
    
    // Test type usage in functions
    // expect(someFunction(instance)).toBeDefined();
  });
  
  it('should handle edge cases', () => {
    // Test null/undefined handling
    // Test boundary values
    // Test error conditions
  });
});`,
      requiredInputs: ['Type properties', 'Usage examples', 'Edge cases'],
      expectedOutputs: ['Type compatibility', 'Function behavior', 'Error handling']
    });

    // Integration test template for replace operations
    if (operationType === 'replace') {
      templates.push({
        testType: 'integration',
        description: `Integration tests for ${typeInfo.name} replacement`,
        template: `describe('${typeInfo.name} replacement integration', () => {
  it('should work with existing APIs', () => {
    // Test API compatibility
    // Test data flow through system
    // Verify no regression in functionality
  });
});`,
        requiredInputs: ['API endpoints', 'Data flows', 'System interactions'],
        expectedOutputs: ['API compatibility', 'Data integrity', 'System behavior']
      });
    }

    // Boundary test template
    templates.push({
      testType: 'boundary',
      description: `Boundary tests for ${typeInfo.name}`,
      template: `describe('${typeInfo.name} boundaries', () => {
  it('should handle null and undefined', () => {
    // Test null handling
    // Test undefined handling
  });
  
  it('should validate required properties', () => {
    // Test missing required properties
    // Test invalid property values
  });
});`,
      requiredInputs: ['Required properties', 'Valid value ranges', 'Invalid inputs'],
      expectedOutputs: ['Validation behavior', 'Error messages', 'Graceful handling']
    });

    return templates;
  }

  /**
   * Calculate overall risk level
   */
  private calculateOverallRisk(
    impactAnalysis: TypeChangeImpact[],
    operationType: RefactoringGuardRailReport['operationType']
  ): RefactoringGuardRailReport['overallRisk'] {
    // Base risk by operation type
    const operationRisk = {
      replace: 'high',
      merge: 'high', 
      split: 'medium',
      extract: 'low',
      inline: 'medium'
    } as const;

    const baseRisk = operationRisk[operationType];
    
    // Adjust based on impact analysis
    const criticalImpacts = impactAnalysis.filter(i => i.impactLevel === 'critical').length;
    const highImpacts = impactAnalysis.filter(i => i.impactLevel === 'high').length;

    if (criticalImpacts > 0) {
      return 'critical';
    } else if (highImpacts > 2 || baseRisk === 'high') {
      return 'high';
    } else if (highImpacts > 0 || baseRisk === 'medium') {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Generate recommendations, warnings, and blocking issues
   */
  private generateRecommendations(
    impactAnalysis: TypeChangeImpact[],
    overallRisk: RefactoringGuardRailReport['overallRisk'],
    operationType: RefactoringGuardRailReport['operationType']
  ): { recommendations: string[]; warnings: string[]; blockingIssues: string[] } {
    const recommendations: string[] = [];
    const warnings: string[] = [];
    const blockingIssues: string[] = [];

    // Risk-based recommendations
    if (overallRisk === 'critical') {
      blockingIssues.push('Critical risk level - consider breaking change into smaller steps');
      recommendations.push('Implement feature flags for gradual rollout');
      recommendations.push('Create comprehensive rollback plan');
    }

    if (overallRisk === 'high') {
      warnings.push('High risk operation - extensive testing required');
      recommendations.push('Consider staging deployment');
    }

    // Impact-based recommendations
    const totalAffectedFunctions = impactAnalysis.reduce(
      (sum, impact) => sum + impact.affectedFunctions.length, 0
    );

    if (totalAffectedFunctions > 50) {
      warnings.push(`${totalAffectedFunctions} functions may be affected`);
      recommendations.push('Consider automated codemod generation');
      recommendations.push('Plan for extended testing period');
    }

    // Co-change based recommendations
    const cochangePartners = new Set(
      impactAnalysis.flatMap(impact => impact.cochangePartners)
    );

    if (cochangePartners.size > 0) {
      recommendations.push(
        `Consider updating co-changing types: ${Array.from(cochangePartners).join(', ')}`
      );
    }

    // Operation-specific recommendations
    if (operationType === 'replace') {
      recommendations.push('Use adapter pattern for gradual migration');
      recommendations.push('Maintain backward compatibility layer initially');
    }

    return { recommendations, warnings, blockingIssues };
  }

  /**
   * Generate PR summary template
   */
  private generatePRSummary(
    typeName: string,
    operationType: RefactoringGuardRailReport['operationType'],
    impactAnalysis: TypeChangeImpact[],
    overallRisk: RefactoringGuardRailReport['overallRisk']
  ): string {
    const totalAffected = impactAnalysis.reduce(
      (sum, impact) => sum + impact.affectedFunctions.length, 0
    );

    const riskEmoji = {
      low: '🟢',
      medium: '🟡', 
      high: '🟠',
      critical: '🔴'
    };

    return `## Type Refactoring: ${operationType} ${typeName}

### Summary
${riskEmoji[overallRisk]} **Risk Level: ${overallRisk.toUpperCase()}**

This PR ${operationType}s the \`${typeName}\` type with the following impact:
- **${totalAffected} functions** potentially affected
- **${impactAnalysis.length} impact areas** identified

### Impact Analysis
${impactAnalysis.map(impact => 
  `- **${impact.typeName}** (${impact.impactLevel}): ${impact.affectedFunctions.length} functions affected`
).join('\n')}

### Changes Made
- [ ] Updated type definition
- [ ] Ran TypeScript compilation check
- [ ] Updated affected functions
- [ ] Added/updated tests
- [ ] Updated documentation

### Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed
- [ ] Performance regression check

### Rollback Plan
- [ ] Revert commit available: \`git revert <commit-hash>\`
- [ ] Database migration rollback (if applicable)
- [ ] Feature flag toggle (if applicable)

---
🤖 Generated by funcqc RefactoringGuardRail`;
  }
}