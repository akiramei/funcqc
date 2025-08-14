/**
 * Discriminated Union Analyzer
 * 
 * Analyzes type structures to identify opportunities for discriminated union refactoring.
 * Detects flag properties, mutually exclusive property groups, and correlation patterns
 * that could benefit from discriminated union transformation.
 */

import type { StorageQueryInterface } from '../type-insights/types';
import { PropertyCooccurrenceAnalyzer, type PropertyCooccurrenceOptions, type CooccurrenceAnalysisResult } from './property-cooccurrence';

export interface DiscriminatedUnionCandidate {
  typeName: string;
  filePath: string;
  discriminantProperty: DiscriminantProperty;
  unionCases: UnionCase[];
  confidence: number;
  refactoringBenefit: RefactoringBenefit;
  transformationPlan: TransformationPlan;
}

export interface DiscriminantProperty {
  name: string;
  type: 'boolean' | 'string_literal' | 'numeric_literal' | 'enum';
  possibleValues: string[];
  usage: {
    frequency: number;
    mutuallyExclusive: boolean;
    correlatedProperties: string[];
  };
}

export interface UnionCase {
  caseName: string;
  discriminantValue: string;
  requiredProperties: PropertyInfo[];
  optionalProperties: PropertyInfo[];
  incompatibleProperties: string[];
  usageFrequency: number;
}

export interface PropertyInfo {
  name: string;
  type: string;
  isOptional: boolean;
  constraints?: ValidationRule[];
}

export interface ValidationRule {
  type: 'range' | 'format' | 'custom' | 'required_if';
  rule: string;
  description: string;
}

export interface RefactoringBenefit {
  eliminatedBranches: number;
  improvedTypesafety: number; // 0-1 score
  reducedComplexity: number;   // Lines of code reduction estimate
  eliminatedRuntimeChecks: number;
}

export interface TransformationPlan {
  strategy: 'full_replacement' | 'gradual_migration' | 'adapter_pattern';
  phases: TransformationPhase[];
  estimatedEffort: 'low' | 'medium' | 'high';
  riskAssessment: RiskAssessment;
  generatedCode: GeneratedUnionCode;
}

export interface TransformationPhase {
  phaseNumber: number;
  name: string;
  description: string;
  actions: TransformationAction[];
  estimatedDuration: string;
  prerequisites: string[];
  rollbackPlan: string;
}

export interface TransformationAction {
  type: 'create_union_type' | 'replace_properties' | 'update_switch_cases' | 'add_type_guards' | 'update_functions';
  description: string;
  targetFiles: string[];
  codeChanges: CodeChange[];
  automationPossible: boolean;
}

export interface CodeChange {
  filePath: string;
  originalCode: string;
  transformedCode: string;
  changeType: 'type_definition' | 'property_access' | 'conditional_logic' | 'function_signature';
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];
  mitigationStrategies: string[];
  breakingChanges: BreakingChange[];
}

export interface BreakingChange {
  type: 'property_removal' | 'property_restructure' | 'type_narrowing' | 'api_change';
  description: string;
  affectedFiles: string[];
  migrationStrategy: string;
}

export interface GeneratedUnionCode {
  unionDefinition: string;
  typeGuards: string[];
  constructors: string[];
  switchHelpers: string[];
  migrationUtils: string[];
}

export interface DiscriminatedUnionAnalysisResult {
  candidates: DiscriminatedUnionCandidate[];
  statistics: {
    totalTypesAnalyzed: number;
    flagPropertiesFound: number;
    mutualExclusionPatternsFound: number;
    potentialBenefitScore: number;
  };
  recommendedApproach: RecommendedApproach;
}

export interface RecommendedApproach {
  prioritizedCandidates: DiscriminatedUnionCandidate[];
  implementationOrder: string[];
  overallStrategy: 'aggressive' | 'conservative' | 'selective';
  estimatedTimeToComplete: string;
}

export interface DiscriminatedUnionOptions extends PropertyCooccurrenceOptions {
  minDiscriminantUsage: number;     // Minimum usage frequency for discriminant properties
  minCaseCount: number;             // Minimum number of union cases to consider
  maxCaseCount: number;             // Maximum number of union cases (complexity limit)
  minMutualExclusivity: number;     // Minimum mutual exclusivity score (0-1)
  requireCorrelatedProperties: boolean; // Require correlated properties for each case
  includeEnumDiscriminants: boolean;    // Include enum-based discriminants
  includeBooleanFlags: boolean;         // Include boolean flag analysis
  minimumBenefitThreshold: number;      // Minimum refactoring benefit score
  allowBreakingChanges: boolean;        // Allow transformations that break existing API
}

export class DiscriminatedUnionAnalyzer {
  private options: DiscriminatedUnionOptions;

  constructor(
    private storage: StorageQueryInterface,
    options: Partial<DiscriminatedUnionOptions> = {}
  ) {
    this.options = {
      // PropertyCooccurrenceOptions defaults
      minSupport: 2,
      minConfidence: 0.6,
      maxPatternSize: 8,
      includeOptionalProperties: true,
      excludeCommonProperties: ['id', 'createdAt', 'updatedAt'],
      
      // DiscriminatedUnion-specific defaults
      minDiscriminantUsage: 0.3,
      minCaseCount: 2,
      maxCaseCount: 8,
      minMutualExclusivity: 0.7,
      requireCorrelatedProperties: true,
      includeEnumDiscriminants: true,
      includeBooleanFlags: true,
      minimumBenefitThreshold: 0.5,
      allowBreakingChanges: false,
      
      ...options
    };
  }

  /**
   * Main analysis entry point
   */
  async analyze(snapshotId?: string): Promise<DiscriminatedUnionAnalysisResult> {
    // Step 1: Get property co-occurrence data as foundation
    const cooccurrenceAnalyzer = new PropertyCooccurrenceAnalyzer(this.storage, this.options);
    const cooccurrenceResult = await cooccurrenceAnalyzer.analyze(snapshotId);

    // Step 2: Identify discriminant property candidates
    const discriminantCandidates = await this.identifyDiscriminantCandidates(snapshotId);

    // Step 3: Analyze each type for discriminated union patterns
    const candidates: DiscriminatedUnionCandidate[] = [];
    for (const typeAnalysis of cooccurrenceResult.candidateCanonicalTypes) {
      const candidate = await this.analyzeSingleType(
        typeAnalysis.typeName,
        discriminantCandidates,
        cooccurrenceResult,
        snapshotId
      );
      
      if (candidate && this.meetsQualityThreshold(candidate)) {
        candidates.push(candidate);
      }
    }

    // Step 4: Generate statistics and recommendations
    const statistics = this.calculateStatistics(candidates, cooccurrenceResult.totalTypesAnalyzed);
    const recommendedApproach = this.generateRecommendations(candidates);

    return {
      candidates,
      statistics,
      recommendedApproach
    };
  }

  /**
   * Identify potential discriminant properties across all types
   */
  private async identifyDiscriminantCandidates(snapshotId?: string): Promise<Map<string, DiscriminantProperty[]>> {
    const query = snapshotId
      ? `SELECT DISTINCT tm.member_name, tm.member_type, td.name as type_name, td.file_path,
         COUNT(*) as usage_count
         FROM type_members tm
         JOIN type_definitions td ON tm.type_id = td.id
         WHERE td.snapshot_id = $1 AND tm.member_kind = 'property'
         AND (tm.member_type LIKE '%literal%' OR tm.member_type IN ('boolean', 'string', 'number'))
         GROUP BY tm.member_name, tm.member_type, td.name, td.file_path
         ORDER BY tm.member_name, usage_count DESC`
      : `SELECT DISTINCT tm.member_name, tm.member_type, td.name as type_name, td.file_path,
         COUNT(*) as usage_count
         FROM type_members tm
         JOIN type_definitions td ON tm.type_id = td.id
         WHERE tm.member_kind = 'property'
         AND (tm.member_type LIKE '%literal%' OR tm.member_type IN ('boolean', 'string', 'number'))
         GROUP BY tm.member_name, tm.member_type, td.name, td.file_path
         ORDER BY tm.member_name, usage_count DESC`;

    const params = snapshotId ? [snapshotId] : [];
    const result = await this.storage.query(query, params);

    const candidateMap = new Map<string, DiscriminantProperty[]>();

    // Group by property name and analyze patterns
    const propertyGroups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of result.rows) {
      const rowData = row as Record<string, unknown>;
      const propName = rowData['member_name'] as string;
      if (!propertyGroups.has(propName)) {
        propertyGroups.set(propName, []);
      }
      propertyGroups.get(propName)!.push(rowData);
    }

    // Analyze each property group for discriminant potential
    for (const [propName, rows] of propertyGroups) {
      const discriminant = await this.analyzeDiscriminantCandidate(propName, rows);
      if (discriminant && this.isViableDiscriminant(discriminant)) {
        for (const row of rows) {
          const typeName = row['type_name'] as string;
          if (!candidateMap.has(typeName)) {
            candidateMap.set(typeName, []);
          }
          candidateMap.get(typeName)!.push(discriminant);
        }
      }
    }

    return candidateMap;
  }

  /**
   * Analyze a single property for discriminant potential
   */
  private async analyzeDiscriminantCandidate(
    propertyName: string, 
    usageRows: Array<Record<string, unknown>>
  ): Promise<DiscriminantProperty | null> {
    // Determine discriminant type
    const types = usageRows.map(row => row['member_type'] as string);
    const uniqueTypes = [...new Set(types)];
    
    let discriminantType: DiscriminantProperty['type'];
    if (uniqueTypes.includes('boolean')) {
      discriminantType = 'boolean';
    } else if (uniqueTypes.some(t => t.includes('literal'))) {
      discriminantType = 'string_literal';
    } else if (uniqueTypes.includes('number')) {
      discriminantType = 'numeric_literal';
    } else {
      return null; // Not a suitable discriminant type
    }

    // Extract possible values (simplified for now)
    const possibleValues = discriminantType === 'boolean' 
      ? ['true', 'false']
      : [`${propertyName}_value_1`, `${propertyName}_value_2`]; // Would need AST analysis for actual values

    const totalUsage = usageRows.reduce((sum, row) => sum + parseInt(row['usage_count'] as string), 0);
    const frequency = totalUsage / usageRows.length;

    return {
      name: propertyName,
      type: discriminantType,
      possibleValues,
      usage: {
        frequency,
        mutuallyExclusive: true, // Would need correlation analysis
        correlatedProperties: [] // Would need co-occurrence analysis
      }
    };
  }

  /**
   * Check if a discriminant candidate is viable
   */
  private isViableDiscriminant(discriminant: DiscriminantProperty): boolean {
    return (
      discriminant.usage.frequency >= this.options.minDiscriminantUsage &&
      discriminant.possibleValues.length >= this.options.minCaseCount &&
      discriminant.possibleValues.length <= this.options.maxCaseCount &&
      discriminant.usage.mutuallyExclusive
    );
  }

  /**
   * Analyze a single type for discriminated union potential
   */
  private async analyzeSingleType(
    typeName: string,
    discriminantCandidates: Map<string, DiscriminantProperty[]>,
    _cooccurrenceResult: CooccurrenceAnalysisResult,
    snapshotId?: string
  ): Promise<DiscriminatedUnionCandidate | null> {
    const discriminants = discriminantCandidates.get(typeName) || [];
    if (discriminants.length === 0) {
      return null;
    }

    // For now, pick the best discriminant (most frequent with good mutual exclusivity)
    const bestDiscriminant = discriminants.reduce((best, current) => 
      current.usage.frequency > best.usage.frequency ? current : best
    );

    // Generate union cases based on discriminant values
    const unionCases = await this.generateUnionCases(typeName, bestDiscriminant, snapshotId);
    if (unionCases.length < this.options.minCaseCount) {
      return null;
    }

    // Calculate confidence and benefits
    const confidence = this.calculateConfidence(bestDiscriminant, unionCases);
    const refactoringBenefit = await this.calculateRefactoringBenefit(typeName, unionCases, snapshotId);

    // Generate transformation plan
    const transformationPlan = await this.generateTransformationPlan(
      typeName,
      bestDiscriminant,
      unionCases,
      refactoringBenefit
    );

    return {
      typeName,
      filePath: await this.getTypeFilePath(typeName, snapshotId),
      discriminantProperty: bestDiscriminant,
      unionCases,
      confidence,
      refactoringBenefit,
      transformationPlan
    };
  }

  /**
   * Generate union cases based on discriminant values
   */
  private async generateUnionCases(
    typeName: string,
    discriminant: DiscriminantProperty,
    _snapshotId?: string
  ): Promise<UnionCase[]> {
    const cases: UnionCase[] = [];

    for (const value of discriminant.possibleValues) {
      const caseName = this.generateCaseName(typeName, discriminant.name, value);
      
      const unionCase: UnionCase = {
        caseName,
        discriminantValue: value,
        requiredProperties: [], // Would need correlation analysis
        optionalProperties: [], // Would need correlation analysis
        incompatibleProperties: [], // Would need exclusion analysis
        usageFrequency: 0.5 // Would need actual usage analysis
      };

      cases.push(unionCase);
    }

    return cases;
  }

  /**
   * Generate appropriate case name for union variant
   */
  private generateCaseName(typeName: string, _discriminantName: string, value: string): string {
    // Convert discriminant value to PascalCase
    const capitalizedValue = value.charAt(0).toUpperCase() + value.slice(1);
    return `${typeName}${capitalizedValue}`;
  }

  /**
   * Calculate confidence score for discriminated union candidate
   */
  private calculateConfidence(discriminant: DiscriminantProperty, unionCases: UnionCase[]): number {
    let score = 0;

    // Base score from discriminant quality
    score += discriminant.usage.frequency * 0.4;
    score += discriminant.usage.mutuallyExclusive ? 0.3 : 0;

    // Score from union case distribution
    const caseFrequencies = unionCases.map(c => c.usageFrequency);
    const avgFrequency = caseFrequencies.reduce((a, b) => a + b, 0) / caseFrequencies.length;
    const variance = caseFrequencies.reduce((sum, freq) => sum + Math.pow(freq - avgFrequency, 2), 0) / caseFrequencies.length;
    score += (1 - Math.sqrt(variance)) * 0.3; // Lower variance = better distribution = higher score

    return Math.min(1, Math.max(0, score));
  }

  /**
   * Calculate refactoring benefits
   */
  private async calculateRefactoringBenefit(
    _typeName: string,
    unionCases: UnionCase[],
    _snapshotId?: string
  ): Promise<RefactoringBenefit> {
    // This would need more detailed analysis of actual usage patterns
    const eliminatedBranches = unionCases.length * 2; // Estimate: each case eliminates ~2 conditional branches
    const improvedTypesafety = 0.7; // Estimate: 70% improvement in type safety
    const reducedComplexity = unionCases.length * 5; // Estimate: 5 lines reduced per case
    const eliminatedRuntimeChecks = unionCases.length * 1; // Estimate: 1 runtime check per case

    return {
      eliminatedBranches,
      improvedTypesafety,
      reducedComplexity,
      eliminatedRuntimeChecks
    };
  }

  /**
   * Generate comprehensive transformation plan
   */
  private async generateTransformationPlan(
    typeName: string,
    discriminant: DiscriminantProperty,
    unionCases: UnionCase[],
    benefit: RefactoringBenefit
  ): Promise<TransformationPlan> {
    const strategy: TransformationPlan['strategy'] = this.options.allowBreakingChanges 
      ? 'full_replacement'
      : 'gradual_migration';

    const estimatedEffort = benefit.reducedComplexity > 20 ? 'high' : 
                          benefit.reducedComplexity > 10 ? 'medium' : 'low';

    const phases = await this.generateTransformationPhases(typeName, discriminant, unionCases, strategy);
    const riskAssessment = this.assessTransformationRisks(typeName, unionCases, strategy);
    const generatedCode = await this.generateUnionCode(typeName, discriminant, unionCases);

    return {
      strategy,
      phases,
      estimatedEffort,
      riskAssessment,
      generatedCode
    };
  }

  /**
   * Generate transformation phases
   */
  private async generateTransformationPhases(
    typeName: string,
    _discriminant: DiscriminantProperty,
    unionCases: UnionCase[],
    strategy: TransformationPlan['strategy']
  ): Promise<TransformationPhase[]> {
    const phases: TransformationPhase[] = [];

    if (strategy === 'gradual_migration') {
      // Phase 1: Create union type definition
      phases.push({
        phaseNumber: 1,
        name: 'Union Type Definition',
        description: `Create discriminated union type for ${typeName}`,
        actions: [{
          type: 'create_union_type',
          description: `Define ${typeName}Union with ${unionCases.length} variants`,
          targetFiles: [await this.getTypeFilePath(typeName)],
          codeChanges: [],
          automationPossible: true
        }],
        estimatedDuration: '1-2 hours',
        prerequisites: [],
        rollbackPlan: 'Remove union type definition'
      });

      // Phase 2: Add type guards and constructors
      phases.push({
        phaseNumber: 2,
        name: 'Type Guards and Constructors',
        description: 'Add helper functions for type safety',
        actions: [{
          type: 'add_type_guards',
          description: 'Create type guard functions for each union variant',
          targetFiles: [await this.getTypeFilePath(typeName)],
          codeChanges: [],
          automationPossible: true
        }],
        estimatedDuration: '2-3 hours',
        prerequisites: ['Phase 1 completed'],
        rollbackPlan: 'Remove helper functions'
      });

      // Phase 3: Update switch cases and conditional logic
      phases.push({
        phaseNumber: 3,
        name: 'Logic Transformation',
        description: 'Transform conditional logic to use union types',
        actions: [{
          type: 'update_switch_cases',
          description: 'Convert if/else chains to exhaustive switch statements',
          targetFiles: [], // Would need usage analysis
          codeChanges: [],
          automationPossible: false
        }],
        estimatedDuration: '4-8 hours',
        prerequisites: ['Phase 1 and 2 completed'],
        rollbackPlan: 'Revert conditional logic changes'
      });
    } else {
      // Full replacement strategy - single phase
      phases.push({
        phaseNumber: 1,
        name: 'Complete Transformation',
        description: `Full replacement of ${typeName} with discriminated union`,
        actions: [
          {
            type: 'create_union_type',
            description: 'Create union type definition',
            targetFiles: [await this.getTypeFilePath(typeName)],
            codeChanges: [],
            automationPossible: true
          },
          {
            type: 'replace_properties',
            description: 'Replace original type properties',
            targetFiles: [], // Would need usage analysis
            codeChanges: [],
            automationPossible: false
          },
          {
            type: 'update_functions',
            description: 'Update all functions using the type',
            targetFiles: [], // Would need usage analysis
            codeChanges: [],
            automationPossible: false
          }
        ],
        estimatedDuration: '1-2 days',
        prerequisites: [],
        rollbackPlan: 'Full revert to original type structure'
      });
    }

    return phases;
  }

  /**
   * Assess transformation risks
   */
  private assessTransformationRisks(
    typeName: string,
    unionCases: UnionCase[],
    strategy: TransformationPlan['strategy']
  ): RiskAssessment {
    const riskFactors: string[] = [];
    const mitigationStrategies: string[] = [];
    const breakingChanges: BreakingChange[] = [];

    let overallRisk: RiskAssessment['overallRisk'] = 'low';

    // Assess complexity risk
    if (unionCases.length > 5) {
      riskFactors.push('High number of union cases increases complexity');
      mitigationStrategies.push('Consider grouping related cases or splitting into multiple unions');
      overallRisk = 'medium';
    }

    // Assess breaking change risk
    if (strategy === 'full_replacement') {
      riskFactors.push('Full replacement may break existing code');
      mitigationStrategies.push('Use gradual migration strategy instead');
      overallRisk = 'high';

      breakingChanges.push({
        type: 'property_restructure',
        description: `${typeName} structure will change significantly`,
        affectedFiles: [], // Would need usage analysis
        migrationStrategy: 'Provide adapter functions during transition period'
      });
    }

    return {
      overallRisk,
      riskFactors,
      mitigationStrategies,
      breakingChanges
    };
  }

  /**
   * Generate union type code
   */
  private async generateUnionCode(
    typeName: string,
    discriminant: DiscriminantProperty,
    unionCases: UnionCase[]
  ): Promise<GeneratedUnionCode> {
    // Generate union type definition
    const caseDefinitions = unionCases.map(unionCase => {
      const requiredProps = unionCase.requiredProperties
        .map(prop => `${prop.name}: ${prop.type}`)
        .join(';\n  ');
      
      return `export interface ${unionCase.caseName} {
  ${discriminant.name}: '${unionCase.discriminantValue}';
  ${requiredProps}
}`;
    }).join('\n\n');

    const unionDefinition = `${caseDefinitions}

export type ${typeName}Union = ${unionCases.map(c => c.caseName).join(' | ')};`;

    // Generate type guards
    const typeGuards = unionCases.map(unionCase => 
      `export function is${unionCase.caseName}(obj: ${typeName}Union): obj is ${unionCase.caseName} {
  return obj.${discriminant.name} === '${unionCase.discriminantValue}';
}`
    );

    // Generate constructors
    const constructors = unionCases.map(unionCase => 
      `export function create${unionCase.caseName}(data: Omit<${unionCase.caseName}, '${discriminant.name}'>): ${unionCase.caseName} {
  return { ...data, ${discriminant.name}: '${unionCase.discriminantValue}' };
}`
    );

    // Generate switch helper
    const switchHelpers = [
      `export function handle${typeName}Union<T>(
  obj: ${typeName}Union,
  handlers: {
    ${unionCases.map(c => `${c.discriminantValue}: (obj: ${c.caseName}) => T`).join(';\n    ')}
  }
): T {
  switch (obj.${discriminant.name}) {
    ${unionCases.map(c => `case '${c.discriminantValue}': return handlers.${c.discriminantValue}(obj);`).join('\n    ')}
    default: throw new Error(\`Unhandled ${discriminant.name}: \${(obj as any).${discriminant.name}}\`);
  }
}`
    ];

    // Generate migration utilities
    const migrationUtils = [
      `// Migration utility to convert legacy ${typeName} to ${typeName}Union
export function migrate${typeName}To Union(legacy: any): ${typeName}Union {
  // Implementation would depend on specific legacy structure
  throw new Error('Migration logic needs to be implemented based on actual data structure');
}`
    ];

    return {
      unionDefinition,
      typeGuards,
      constructors,
      switchHelpers,
      migrationUtils
    };
  }

  /**
   * Get file path for a type
   */
  private async getTypeFilePath(typeName: string, snapshotId?: string): Promise<string> {
    const query = snapshotId
      ? 'SELECT file_path FROM type_definitions WHERE name = $1 AND snapshot_id = $2 LIMIT 1'
      : 'SELECT file_path FROM type_definitions WHERE name = $1 LIMIT 1';
    
    const params = snapshotId ? [typeName, snapshotId] : [typeName];
    const result = await this.storage.query(query, params);
    
    return result.rows.length > 0 ? (result.rows[0] as Record<string, unknown>)['file_path'] as string : `src/types/${typeName.toLowerCase()}.ts`;
  }

  /**
   * Check if candidate meets quality threshold
   */
  private meetsQualityThreshold(candidate: DiscriminatedUnionCandidate): boolean {
    return (
      candidate.confidence >= 0.6 &&
      candidate.refactoringBenefit.improvedTypesafety >= this.options.minimumBenefitThreshold &&
      candidate.unionCases.length >= this.options.minCaseCount &&
      candidate.unionCases.length <= this.options.maxCaseCount
    );
  }

  /**
   * Calculate overall statistics
   */
  private calculateStatistics(
    candidates: DiscriminatedUnionCandidate[],
    totalTypes: number
  ): DiscriminatedUnionAnalysisResult['statistics'] {
    const flagPropertiesFound = candidates.reduce((sum, c) => 
      sum + (c.discriminantProperty.type === 'boolean' ? 1 : 0), 0
    );

    const mutualExclusionPatternsFound = candidates.filter(c => 
      c.discriminantProperty.usage.mutuallyExclusive
    ).length;

    const potentialBenefitScore = candidates.reduce((sum, c) => 
      sum + c.refactoringBenefit.improvedTypesafety, 0
    ) / Math.max(candidates.length, 1);

    return {
      totalTypesAnalyzed: totalTypes,
      flagPropertiesFound,
      mutualExclusionPatternsFound,
      potentialBenefitScore
    };
  }

  /**
   * Generate implementation recommendations
   */
  private generateRecommendations(candidates: DiscriminatedUnionCandidate[]): RecommendedApproach {
    // Sort by confidence and benefit
    const prioritizedCandidates = candidates.sort((a, b) => {
      const scoreA = a.confidence * 0.6 + a.refactoringBenefit.improvedTypesafety * 0.4;
      const scoreB = b.confidence * 0.6 + b.refactoringBenefit.improvedTypesafety * 0.4;
      return scoreB - scoreA;
    });

    const implementationOrder = prioritizedCandidates.map(c => c.typeName);

    // Determine overall strategy based on candidate risk profiles
    const highRiskCandidates = candidates.filter(c => 
      c.transformationPlan.riskAssessment.overallRisk === 'high' || 
      c.transformationPlan.riskAssessment.overallRisk === 'critical'
    ).length;

    const overallStrategy: RecommendedApproach['overallStrategy'] = 
      highRiskCandidates / candidates.length > 0.5 ? 'conservative' :
      candidates.length > 10 ? 'selective' : 'aggressive';

    const totalEffortHours = candidates.reduce((sum, c) => {
      const hours = c.transformationPlan.estimatedEffort === 'high' ? 16 :
                   c.transformationPlan.estimatedEffort === 'medium' ? 8 : 4;
      return sum + hours;
    }, 0);

    const estimatedTimeToComplete = `${Math.ceil(totalEffortHours / 8)} days`;

    return {
      prioritizedCandidates,
      implementationOrder,
      overallStrategy,
      estimatedTimeToComplete
    };
  }
}