/**
 * DTO Canonicalizer
 * 
 * Analyzes DTO types and provides recommendations for canonicalization,
 * reducing duplication by consolidating similar types into canonical forms.
 */

import type { StorageQueryInterface } from '../type-insights/types';
import { PropertyCooccurrenceAnalyzer, type CandidateCanonicalType, type PropertyCooccurrenceOptions } from './property-cooccurrence';
// import { StructuralSubsumptionAnalyzer } from '../type-insights/structural-subsumption-analyzer';

export interface CanonicalizationPlan {
  canonicalType: CandidateCanonicalType;
  consolidationActions: ConsolidationAction[];
  generatedViewTypes: ViewTypeDefinition[];
  migrationStrategy: MigrationStrategy;
  estimatedImpact: CanonizationImpact;
}

export interface ConsolidationAction {
  actionType: 'merge_into_canonical' | 'create_view_type' | 'generate_mapper' | 'update_usage_sites';
  sourceType: string;
  targetType: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  automaticMigration: boolean;
  codemodActions?: CodemodAction[];
}

export interface ViewTypeDefinition {
  viewName: string;
  sourceCanonicalType: string;
  definition: string;              // TypeScript type definition
  viewType: 'pick' | 'omit' | 'partial' | 'custom';
  selectedProperties: string[];
  generatedMappers: {
    toCanonical: string;           // Function to convert to canonical
    fromCanonical: string;         // Function to convert from canonical
  };
}

export interface MigrationStrategy {
  approach: 'big_bang' | 'gradual' | 'adapter_layer' | 'feature_flag';
  phases: MigrationPhase[];
  rollbackPlan: string[];
  estimatedDuration: string;
  prerequisites: string[];
}

export interface MigrationPhase {
  phaseNumber: number;
  name: string;
  description: string;
  actions: string[];
  estimatedEffort: string;
  riskLevel: 'low' | 'medium' | 'high';
  dependencies: number[];          // Phase numbers this depends on
}

export interface CanonizationImpact {
  typesAffected: number;
  functionsAffected: number;
  filesAffected: string[];
  estimatedSavings: {
    duplicateTypesEliminated: number;
    linesOfCodeReduced: number;
    maintenanceComplexityReduction: number; // 0.0 - 1.0
  };
  riskAssessment: {
    overallRisk: 'low' | 'medium' | 'high' | 'critical';
    riskFactors: string[];
    mitigationStrategies: string[];
  };
}

export interface CodemodAction {
  type: 'replace_type_import' | 'replace_type_annotation' | 'add_mapper_call' | 'update_function_signature';
  filePath: string;
  location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  originalCode: string;
  replacementCode: string;
  description: string;
}

export interface DTOCanonicalizationOptions extends PropertyCooccurrenceOptions {
  includeBehavioralAnalysis: boolean;
  requireMinimalImpact: boolean;  // Only suggest changes with low impact
  generateCodemodActions: boolean;
  preserveOptionalityDifferences: boolean;
}

export interface CanonicalizationResult {
  recommendations: CanonicalizationPlan[];
  typeRelationships: TypeRelationship[];
  consolidationOpportunities: ConsolidationOpportunity[];
  generatedArtifacts: {
    viewTypes: ViewTypeDefinition[];
    mapperFunctions: string[];
    migrationScripts: string[];
  };
  qualityMetrics: {
    duplicateReduction: number;    // Percentage reduction in duplicate types
    cohesionImprovement: number;   // Type cohesion improvement score
    maintainabilityScore: number;   // Overall maintainability improvement
  };
}

export interface TypeRelationship {
  sourceType: string;
  targetType: string;
  relationshipType: 'identical' | 'subset' | 'superset' | 'overlap' | 'disjoint';
  structuralSimilarity: number;   // 0.0 - 1.0
  compatibilityScore: number;     // How compatible they are for merging
  consolidationViability: 'high' | 'medium' | 'low' | 'not_viable';
}

export interface ConsolidationOpportunity {
  id: string;
  types: string[];
  opportunityType: 'merge_identical' | 'create_superset' | 'extract_common' | 'create_union';
  estimatedBenefit: number;       // Benefit score (0.0 - 1.0)
  implementationComplexity: 'low' | 'medium' | 'high';
  description: string;
  prerequisites: string[];
}

export class DTOCanonicalizer {
  private storage: StorageQueryInterface;
  private options: Required<DTOCanonicalizationOptions>;
  private cooccurrenceAnalyzer: PropertyCooccurrenceAnalyzer;
  // private _subsumptionAnalyzer: StructuralSubsumptionAnalyzer;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<DTOCanonicalizationOptions> = {}
  ) {
    this.storage = storage;
    this.options = {
      ...this.getDefaultOptions(),
      ...options
    } as Required<DTOCanonicalizationOptions>;

    this.cooccurrenceAnalyzer = new PropertyCooccurrenceAnalyzer(storage, options);
    // this._subsumptionAnalyzer = new StructuralSubsumptionAnalyzer(storage);
  }

  private getDefaultOptions(): Required<DTOCanonicalizationOptions> {
    return {
      minSupport: 2,
      minConfidence: 0.6,
      maxPatternSize: 5,
      includeOptionalProperties: true,
      excludeCommonProperties: ['id', 'createdAt', 'updatedAt'],
      includeBehavioralAnalysis: true,
      requireMinimalImpact: false,
      generateCodemodActions: true,
      preserveOptionalityDifferences: true
    };
  }

  /**
   * Analyze types and generate canonicalization recommendations
   */
  async analyze(snapshotId?: string): Promise<CanonicalizationResult> {
    // Perform co-occurrence analysis to identify patterns
    const cooccurrenceResult = await this.cooccurrenceAnalyzer.analyze(snapshotId);

    // Analyze structural relationships between types
    const typeRelationships = await this.analyzeTypeRelationships(snapshotId);

    // Identify consolidation opportunities
    const consolidationOpportunities = this.identifyConsolidationOpportunities(
      cooccurrenceResult.candidateCanonicalTypes,
      typeRelationships
    );

    // Generate canonicalization plans
    const recommendations = await this.generateCanonicalizationPlans(
      cooccurrenceResult.candidateCanonicalTypes,
      typeRelationships,
      consolidationOpportunities,
      snapshotId
    );

    // Generate artifacts (view types, mappers, etc.)
    const generatedArtifacts = this.generateArtifacts(recommendations);

    // Calculate quality metrics
    const qualityMetrics = this.calculateQualityMetrics(
      recommendations,
      cooccurrenceResult.totalTypesAnalyzed
    );

    return {
      recommendations,
      typeRelationships,
      consolidationOpportunities,
      generatedArtifacts,
      qualityMetrics
    };
  }

  /**
   * Analyze structural relationships between types
   */
  private async analyzeTypeRelationships(_snapshotId?: string): Promise<TypeRelationship[]> {
    const relationships: TypeRelationship[] = [];

    try {
      // Get all types from database directly for DTO analysis
      const typeQuery = _snapshotId
        ? `SELECT DISTINCT td.name FROM type_definitions td WHERE td.snapshot_id = $1 ORDER BY td.name`
        : `SELECT DISTINCT td.name FROM type_definitions td ORDER BY td.name`;
      
      const typeParams = _snapshotId ? [_snapshotId] : [];
      console.debug('Type query:', typeQuery);
      console.debug('Type params:', typeParams);
      const typeResult = await this.storage.query(typeQuery, typeParams);
      console.debug('Type result rows:', typeResult.rows);
      const typeNames = typeResult.rows.map((row: any) => row.name);
      console.debug('Extracted type names:', typeNames);

      // Analyze pairwise relationships between all types
      for (let i = 0; i < typeNames.length; i++) {
        for (let j = i + 1; j < typeNames.length; j++) {
          const sourceType = typeNames[i];
          const targetType = typeNames[j];

          const relationship = await this.analyzeTypePair(
            sourceType,
            targetType,
            null, // No pattern needed for direct analysis
            _snapshotId
          );

          if (relationship) {
            relationships.push(relationship);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to analyze type relationships:', error);
    }

    return relationships.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  }

  /**
   * Analyze relationship between two specific types
   */
  private async analyzeTypePair(
    sourceType: string,
    targetType: string,
    _pattern: any,
    snapshotId?: string
  ): Promise<TypeRelationship | null> {
    try {
      console.debug(`\nAnalyzing pair: ${sourceType} vs ${targetType}`);
      
      // Get type definitions
      const sourceTypeInfo = await this.getTypeDefinition(sourceType, snapshotId);
      const targetTypeInfo = await this.getTypeDefinition(targetType, snapshotId);
      
      console.debug(`Source type info:`, sourceTypeInfo ? 'found' : 'null');
      console.debug(`Target type info:`, targetTypeInfo ? 'found' : 'null');

      if (!sourceTypeInfo || !targetTypeInfo) {
        console.debug(`Skipping pair ${sourceType} vs ${targetType} - missing type info`);
        return null;
      }

      // Determine relationship type based on property comparison
      const relationshipType = this.determineRelationshipType(sourceTypeInfo, targetTypeInfo);

      // Calculate structural similarity
      const structuralSimilarity = this.calculateStructuralSimilarity(
        sourceTypeInfo,
        targetTypeInfo
      );

      // Calculate compatibility score for merging
      const compatibilityScore = this.calculateCompatibilityScore(
        sourceTypeInfo,
        targetTypeInfo,
        relationshipType,
        structuralSimilarity
      );

      // Assess consolidation viability
      const consolidationViability = this.assessConsolidationViability(
        compatibilityScore,
        structuralSimilarity,
        relationshipType
      );

      return {
        sourceType,
        targetType,
        relationshipType,
        structuralSimilarity,
        compatibilityScore,
        consolidationViability
      };
    } catch (error) {
      console.warn(`Failed to analyze type pair ${sourceType} - ${targetType}:`, error);
      return null;
    }
  }

  /**
   * Get type definition from database
   */
  private async getTypeDefinition(typeName: string, snapshotId?: string): Promise<any> {
    const query = snapshotId
      ? `SELECT td.*, tm.member_name, tm.member_type, tm.is_optional 
         FROM type_definitions td 
         LEFT JOIN type_members tm ON td.id = tm.type_id 
         WHERE td.name = $1 AND td.snapshot_id = $2`
      : `SELECT td.*, tm.member_name, tm.member_type, tm.is_optional 
         FROM type_definitions td 
         LEFT JOIN type_members tm ON td.id = tm.type_id 
         WHERE td.name = $1 ORDER BY td.created_at DESC LIMIT 1`;

    const params = snapshotId ? [typeName, snapshotId] : [typeName];
    console.debug(`Getting type definition for: ${typeName}`);
    console.debug(`Query:`, query);
    console.debug(`Params:`, params);
    const result = await this.storage.query(query, params);
    console.debug(`Result rows for ${typeName}:`, result.rows.length, 'rows');

    if (result.rows.length === 0) return null;

    // Group properties
    const typeInfo = result.rows[0] as any;
    const properties = result.rows
      .filter((row: any) => row.member_name)
      .map((row: any) => ({
        name: row.member_name,
        type: row.member_type,
        isOptional: row.is_optional
      }));

    const finalResult = {
      ...typeInfo,
      properties
    };
    
    console.debug(`Returning type definition for ${typeName}:`, {
      name: finalResult.name,
      propertiesCount: properties.length,
      propertyNames: properties.map((p: any) => p.name)
    });

    return finalResult;
  }

  /**
   * Determine relationship type between two types
   */
  private determineRelationshipType(
    sourceType: any,
    targetType: any
  ): TypeRelationship['relationshipType'] {
    // Filter out excluded common properties
    const sourceProps = new Set(
      sourceType.properties
        .filter((p: any) => !this.options.excludeCommonProperties.includes(p.name))
        .map((p: any) => p.name)
    );
    const targetProps = new Set(
      targetType.properties
        .filter((p: any) => !this.options.excludeCommonProperties.includes(p.name))
        .map((p: any) => p.name)
    );

    // Debug logging for troubleshooting
    console.debug(`Comparing types: ${sourceType.name} vs ${targetType.name}`);
    console.debug(`Source props:`, Array.from(sourceProps));
    console.debug(`Target props:`, Array.from(targetProps));
    console.debug(`Excluded properties:`, this.options.excludeCommonProperties);

    if (this.setsEqual(sourceProps, targetProps)) {
      console.debug(`Result: identical`);
      return 'identical';
    } else if (this.isSubset(sourceProps, targetProps)) {
      console.debug(`Result: subset (${sourceType.name} ⊆ ${targetType.name})`);
      return 'subset';
    } else if (this.isSubset(targetProps, sourceProps)) {
      console.debug(`Result: superset (${sourceType.name} ⊇ ${targetType.name})`);
      return 'superset';
    } else if (this.hasOverlap(sourceProps, targetProps)) {
      console.debug(`Result: overlap`);
      return 'overlap';
    } else {
      console.debug(`Result: disjoint`);
      return 'disjoint';
    }
  }

  /**
   * Calculate structural similarity between types
   */
  private calculateStructuralSimilarity(sourceType: any, targetType: any): number {
    const sourceProps = new Set(sourceType.properties.map((p: any) => p.name));
    const targetProps = new Set(targetType.properties.map((p: any) => p.name));

    const intersection = new Set([...sourceProps].filter(p => targetProps.has(p)));
    const union = new Set([...sourceProps, ...targetProps]);

    return intersection.size / union.size; // Jaccard similarity
  }

  /**
   * Calculate compatibility score for merging types
   */
  private calculateCompatibilityScore(
    sourceType: any,
    targetType: any,
    relationshipType: TypeRelationship['relationshipType'],
    structuralSimilarity: number
  ): number {
    let baseScore = structuralSimilarity;

    // Bonus for favorable relationship types
    switch (relationshipType) {
      case 'identical':
        baseScore += 0.3;
        break;
      case 'subset':
      case 'superset':
        baseScore += 0.2;
        break;
      case 'overlap':
        baseScore += 0.1;
        break;
      case 'disjoint':
        baseScore -= 0.2;
        break;
    }

    // Penalty for optionality differences if preserving them
    if (this.options.preserveOptionalityDifferences) {
      const optionalityDiff = this.calculateOptionalityDifference(sourceType, targetType);
      baseScore -= optionalityDiff * 0.1;
    }

    return Math.max(0, Math.min(1, baseScore));
  }

  /**
   * Calculate difference in optionality between types
   */
  private calculateOptionalityDifference(sourceType: any, targetType: any): number {
    const sourceOptional = new Set(
      sourceType.properties.filter((p: any) => p.isOptional).map((p: any) => p.name)
    );
    const targetOptional = new Set(
      targetType.properties.filter((p: any) => p.isOptional).map((p: any) => p.name)
    );

    const commonProps = new Set(
      sourceType.properties
        .map((p: any) => p.name)
        .filter((name: string) => targetType.properties.some((tp: any) => tp.name === name))
    );

    let differences = 0;
    for (const prop of commonProps) {
      if (sourceOptional.has(prop) !== targetOptional.has(prop)) {
        differences++;
      }
    }

    return commonProps.size > 0 ? differences / commonProps.size : 0;
  }

  /**
   * Assess viability of consolidating types
   */
  private assessConsolidationViability(
    compatibilityScore: number,
    structuralSimilarity: number,
    relationshipType: TypeRelationship['relationshipType']
  ): TypeRelationship['consolidationViability'] {
    if (compatibilityScore >= 0.8 && structuralSimilarity >= 0.7) {
      return 'high';
    } else if (compatibilityScore >= 0.6 && structuralSimilarity >= 0.5) {
      return 'medium';
    } else if (compatibilityScore >= 0.4 || relationshipType === 'overlap') {
      return 'low';
    } else {
      return 'not_viable';
    }
  }

  /**
   * Identify consolidation opportunities
   */
  private identifyConsolidationOpportunities(
    _canonicalCandidates: CandidateCanonicalType[],
    relationships: TypeRelationship[]
  ): ConsolidationOpportunity[] {
    const opportunities: ConsolidationOpportunity[] = [];
    let opportunityId = 1;

    // Group types by compatibility for merging
    const highCompatibilityGroups = this.groupTypesByCompatibility(relationships, 0.7);

    for (const group of highCompatibilityGroups) {
      if (group.length >= 2) {
        const estimatedBenefit = this.calculateConsolidationBenefit(group, relationships);
        const complexity = this.assessImplementationComplexity(group, relationships);

        opportunities.push({
          id: `consolidation_${opportunityId++}`,
          types: group,
          opportunityType: this.determineOpportunityType(group, relationships),
          estimatedBenefit,
          implementationComplexity: complexity,
          description: this.generateOpportunityDescription(group, relationships),
          prerequisites: this.generatePrerequisites(group)
        });
      }
    }

    return opportunities.sort((a, b) => b.estimatedBenefit - a.estimatedBenefit);
  }

  /**
   * Group types by compatibility score
   */
  private groupTypesByCompatibility(
    relationships: TypeRelationship[],
    minCompatibility: number
  ): string[][] {
    const groups: string[][] = [];
    const processed = new Set<string>();

    for (const relationship of relationships) {
      if (relationship.compatibilityScore >= minCompatibility) {
        const { sourceType, targetType } = relationship;

        if (!processed.has(sourceType) && !processed.has(targetType)) {
          groups.push([sourceType, targetType]);
          processed.add(sourceType);
          processed.add(targetType);
        }
      }
    }

    return groups;
  }

  /**
   * Calculate benefit of consolidating a group of types
   */
  private calculateConsolidationBenefit(
    types: string[],
    relationships: TypeRelationship[]
  ): number {
    // Base benefit from reducing type count
    const typeReductionBenefit = (types.length - 1) / types.length;

    // Bonus for high structural similarity
    const avgSimilarity = relationships
      .filter(r => types.includes(r.sourceType) && types.includes(r.targetType))
      .reduce((sum, r) => sum + r.structuralSimilarity, 0) / relationships.length;

    return Math.min(1, typeReductionBenefit + avgSimilarity * 0.3);
  }

  /**
   * Assess implementation complexity
   */
  private assessImplementationComplexity(
    types: string[],
    relationships: TypeRelationship[]
  ): ConsolidationOpportunity['implementationComplexity'] {
    const typeCount = types.length;
    const avgCompatibility = relationships
      .filter(r => types.includes(r.sourceType) && types.includes(r.targetType))
      .reduce((sum, r) => sum + r.compatibilityScore, 0) / relationships.length;

    if (typeCount <= 2 && avgCompatibility >= 0.8) return 'low';
    if (typeCount <= 4 && avgCompatibility >= 0.6) return 'medium';
    return 'high';
  }

  /**
   * Determine opportunity type based on relationships
   */
  private determineOpportunityType(
    types: string[],
    relationships: TypeRelationship[]
  ): ConsolidationOpportunity['opportunityType'] {
    const typeRelationships = relationships.filter(r =>
      types.includes(r.sourceType) && types.includes(r.targetType)
    );

    const identicalCount = typeRelationships.filter(r => r.relationshipType === 'identical').length;
    const subsetCount = typeRelationships.filter(r => 
      r.relationshipType === 'subset' || r.relationshipType === 'superset'
    ).length;

    if (identicalCount > 0) return 'merge_identical';
    if (subsetCount > 0) return 'create_superset';
    return 'extract_common';
  }

  /**
   * Generate description for consolidation opportunity
   */
  private generateOpportunityDescription(
    types: string[],
    relationships: TypeRelationship[]
  ): string {
    const opportunityType = this.determineOpportunityType(types, relationships);
    
    switch (opportunityType) {
      case 'merge_identical':
        return `Merge ${types.length} identical types: ${types.join(', ')}`;
      case 'create_superset':
        return `Create superset type from ${types.length} related types: ${types.join(', ')}`;
      case 'extract_common':
        return `Extract common properties from ${types.length} overlapping types: ${types.join(', ')}`;
      default:
        return `Consolidate ${types.length} types: ${types.join(', ')}`;
    }
  }

  /**
   * Generate prerequisites for consolidation
   */
  private generatePrerequisites(types: string[]): string[] {
    return [
      'Analyze usage patterns of affected types',
      'Create comprehensive test coverage',
      'Plan migration strategy for dependent code',
      `Review impact on ${types.length} type definitions`
    ];
  }

  /**
   * Generate canonicalization plans
   */
  private async generateCanonicalizationPlans(
    _canonicalCandidates: CandidateCanonicalType[],
    relationships: TypeRelationship[],
    _opportunities: ConsolidationOpportunity[],
    snapshotId?: string
  ): Promise<CanonicalizationPlan[]> {
    const plans: CanonicalizationPlan[] = [];

    for (const candidate of _canonicalCandidates.slice(0, 5)) { // Top 5 candidates
      const plan = await this.createCanonicalizationPlan(
        candidate,
        relationships,
        _opportunities,
        snapshotId
      );
      
      if (plan) {
        plans.push(plan);
      }
    }

    return plans;
  }

  /**
   * Create a canonicalization plan for a specific candidate
   */
  private async createCanonicalizationPlan(
    candidate: CandidateCanonicalType,
    relationships: TypeRelationship[],
    _opportunities: ConsolidationOpportunity[],
    snapshotId?: string
  ): Promise<CanonicalizationPlan | null> {
    try {
      // Generate consolidation actions
      const consolidationActions = await this.generateConsolidationActions(
        candidate,
        relationships,
        snapshotId
      );

      // Generate view types
      const generatedViewTypes = this.generateViewTypes(candidate, relationships);

      // Create migration strategy
      const migrationStrategy = this.createMigrationStrategy(
        candidate,
        consolidationActions
      );

      // Estimate impact
      const estimatedImpact = await this.estimateCanonizationImpact(
        candidate,
        consolidationActions,
        snapshotId
      );

      return {
        canonicalType: candidate,
        consolidationActions,
        generatedViewTypes,
        migrationStrategy,
        estimatedImpact
      };
    } catch (error) {
      console.warn(`Failed to create canonicalization plan for ${candidate.typeName}:`, error);
      return null;
    }
  }

  /**
   * Generate consolidation actions for a canonical type
   */
  private async generateConsolidationActions(
    candidate: CandidateCanonicalType,
    relationships: TypeRelationship[],
    _snapshotId?: string
  ): Promise<ConsolidationAction[]> {
    const actions: ConsolidationAction[] = [];

    // Actions for subset types
    for (const subsetType of candidate.subsetTypes) {
      const relationship = relationships.find(r =>
        (r.sourceType === subsetType && r.targetType === candidate.typeName) ||
        (r.targetType === subsetType && r.sourceType === candidate.typeName)
      );

      if (relationship?.consolidationViability === 'high') {
        actions.push({
          actionType: 'merge_into_canonical',
          sourceType: subsetType,
          targetType: candidate.typeName,
          description: `Merge ${subsetType} into canonical type ${candidate.typeName}`,
          riskLevel: 'low',
          automaticMigration: true,
          codemodActions: this.generateCodemodActions(subsetType, candidate.typeName)
        });

        actions.push({
          actionType: 'create_view_type',
          sourceType: subsetType,
          targetType: `${subsetType}View`,
          description: `Create view type ${subsetType}View as subset of ${candidate.typeName}`,
          riskLevel: 'low',
          automaticMigration: true
        });
      }
    }

    return actions;
  }

  /**
   * Generate codemod actions for type replacement
   */
  private generateCodemodActions(sourceType: string, targetType: string): CodemodAction[] {
    // This would be expanded to generate actual AST transformations
    return [
      {
        type: 'replace_type_import',
        filePath: '', // Would be filled with actual file paths
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        originalCode: `import { ${sourceType} } from`,
        replacementCode: `import { ${targetType} } from`,
        description: `Replace import of ${sourceType} with ${targetType}`
      }
    ];
  }

  /**
   * Generate view types for canonical type
   */
  private generateViewTypes(
    candidate: CandidateCanonicalType,
    relationships: TypeRelationship[]
  ): ViewTypeDefinition[] {
    const viewTypes: ViewTypeDefinition[] = [];

    for (const subsetType of candidate.subsetTypes) {
      // Find properties that exist in the subset type
      const relationship = relationships.find(r =>
        r.sourceType === subsetType || r.targetType === subsetType
      );

      if (relationship) {
        viewTypes.push({
          viewName: `${subsetType}View`,
          sourceCanonicalType: candidate.typeName,
          definition: `export type ${subsetType}View = Pick<${candidate.typeName}, ${this.generatePickedProperties(candidate, subsetType)}>`,
          viewType: 'pick',
          selectedProperties: this.getSubsetProperties(candidate, subsetType),
          generatedMappers: {
            toCanonical: this.generateToCanonicalMapper(candidate.typeName, subsetType),
            fromCanonical: this.generateFromCanonicalMapper(candidate.typeName, subsetType)
          }
        });
      }
    }

    return viewTypes;
  }

  /**
   * Generate picked properties string for Pick utility type
   */
  private generatePickedProperties(_candidate: CandidateCanonicalType, _subsetType: string): string {
    // Simplified - would need actual property analysis
    return `'id' | 'name'`; // Placeholder
  }

  /**
   * Get properties that exist in subset type
   */
  private getSubsetProperties(_candidate: CandidateCanonicalType, _subsetType: string): string[] {
    // Simplified - would need actual property analysis
    return ['id', 'name']; // Placeholder
  }

  /**
   * Generate mapper function to convert to canonical type
   */
  private generateToCanonicalMapper(canonicalType: string, sourceType: string): string {
    return `
export function to${canonicalType}(source: ${sourceType}): ${canonicalType} {
  return {
    ...source,
    // Add any additional required properties
  };
}`;
  }

  /**
   * Generate mapper function to convert from canonical type
   */
  private generateFromCanonicalMapper(canonicalType: string, targetType: string): string {
    return `
export function from${canonicalType}To${targetType}(canonical: ${canonicalType}): ${targetType} {
  return {
    // Pick only the required properties for ${targetType}
    id: canonical.id,
    name: canonical.name,
  };
}`;
  }

  /**
   * Create migration strategy
   */
  private createMigrationStrategy(
    _candidate: CandidateCanonicalType,
    actions: ConsolidationAction[]
  ): MigrationStrategy {
    const phases: MigrationPhase[] = [
      {
        phaseNumber: 1,
        name: 'Preparation',
        description: 'Set up canonical type and view types',
        actions: [
          'Create canonical type definition',
          'Generate view types',
          'Create mapper functions'
        ],
        estimatedEffort: '1-2 days',
        riskLevel: 'low',
        dependencies: []
      },
      {
        phaseNumber: 2,
        name: 'Migration',
        description: 'Migrate usage sites to use canonical type',
        actions: [
          'Update import statements',
          'Replace type annotations',
          'Add mapper calls where needed'
        ],
        estimatedEffort: '3-5 days',
        riskLevel: 'medium',
        dependencies: [1]
      },
      {
        phaseNumber: 3,
        name: 'Cleanup',
        description: 'Remove deprecated types and clean up',
        actions: [
          'Remove deprecated type definitions',
          'Clean up unused imports',
          'Update documentation'
        ],
        estimatedEffort: '1 day',
        riskLevel: 'low',
        dependencies: [2]
      }
    ];

    return {
      approach: actions.length <= 3 ? 'big_bang' : 'gradual',
      phases,
      rollbackPlan: [
        'Revert changes to type definitions',
        'Restore original imports',
        'Remove mapper functions'
      ],
      estimatedDuration: `${phases.reduce((sum, phase) => {
        const days = parseInt(phase.estimatedEffort.split('-')[0]);
        return sum + days;
      }, 0)}-${phases.reduce((sum, phase) => {
        const days = parseInt(phase.estimatedEffort.split('-')[1]?.split(' ')[0] || phase.estimatedEffort.split('-')[0]);
        return sum + days;
      }, 0)} days`,
      prerequisites: [
        'Complete test coverage for affected types',
        'Backup current type definitions',
        'Team approval for breaking changes'
      ]
    };
  }

  /**
   * Estimate canonicalization impact
   */
  private async estimateCanonizationImpact(
    candidate: CandidateCanonicalType,
    actions: ConsolidationAction[],
    snapshotId?: string
  ): Promise<CanonizationImpact> {
    // Get affected functions count
    const functionsAffected = await this.countAffectedFunctions(candidate, snapshotId);
    const filesAffected = await this.getAffectedFiles(candidate, snapshotId);

    const estimatedSavings = {
      duplicateTypesEliminated: candidate.subsetTypes.length,
      linesOfCodeReduced: candidate.subsetTypes.length * 10, // Rough estimate
      maintenanceComplexityReduction: Math.min(candidate.subsetTypes.length / 10, 0.8)
    };

    const riskFactors: string[] = [];
    if (functionsAffected > 20) riskFactors.push('High number of affected functions');
    if (filesAffected.length > 10) riskFactors.push('Changes span many files');
    if (actions.some(a => a.riskLevel === 'high')) riskFactors.push('High-risk consolidation actions');

    const overallRisk = this.calculateOverallRisk(functionsAffected, filesAffected.length, riskFactors.length);

    return {
      typesAffected: candidate.subsetTypes.length + 1,
      functionsAffected,
      filesAffected,
      estimatedSavings,
      riskAssessment: {
        overallRisk,
        riskFactors,
        mitigationStrategies: this.generateMitigationStrategies(riskFactors)
      }
    };
  }

  /**
   * Count functions affected by canonicalization
   */
  private async countAffectedFunctions(
    candidate: CandidateCanonicalType,
    snapshotId?: string
  ): Promise<number> {
    const allTypes = [candidate.typeName, ...candidate.subsetTypes];
    const query = snapshotId
      ? `SELECT COUNT(DISTINCT f.id) as count
         FROM functions f
         JOIN function_type_usage ftu ON f.id = ftu.function_id
         JOIN type_definitions td ON ftu.type_id = td.id
         WHERE td.name = ANY($1) AND f.snapshot_id = $2`
      : `SELECT COUNT(DISTINCT f.id) as count
         FROM functions f
         JOIN function_type_usage ftu ON f.id = ftu.function_id
         JOIN type_definitions td ON ftu.type_id = td.id
         WHERE td.name = ANY($1)`;

    const params = snapshotId ? [allTypes, snapshotId] : [allTypes];
    const result = await this.storage.query(query, params);
    
    return (result.rows[0] as any)?.count || 0;
  }

  /**
   * Get files affected by canonicalization
   */
  private async getAffectedFiles(
    candidate: CandidateCanonicalType,
    snapshotId?: string
  ): Promise<string[]> {
    const allTypes = [candidate.typeName, ...candidate.subsetTypes];
    const query = snapshotId
      ? `SELECT DISTINCT f.file_path
         FROM functions f
         JOIN function_type_usage ftu ON f.id = ftu.function_id
         JOIN type_definitions td ON ftu.type_id = td.id
         WHERE td.name = ANY($1) AND f.snapshot_id = $2`
      : `SELECT DISTINCT f.file_path
         FROM functions f
         JOIN function_type_usage ftu ON f.id = ftu.function_id
         JOIN type_definitions td ON ftu.type_id = td.id
         WHERE td.name = ANY($1)`;

    const params = snapshotId ? [allTypes, snapshotId] : [allTypes];
    const result = await this.storage.query(query, params);
    
    return result.rows.map((row: any) => row.file_path);
  }

  /**
   * Calculate overall risk level
   */
  private calculateOverallRisk(
    functionsAffected: number,
    filesAffected: number,
    riskFactorCount: number
  ): CanonizationImpact['riskAssessment']['overallRisk'] {
    let riskScore = 0;
    
    if (functionsAffected > 50) riskScore += 2;
    else if (functionsAffected > 20) riskScore += 1;
    
    if (filesAffected > 20) riskScore += 2;
    else if (filesAffected > 10) riskScore += 1;
    
    riskScore += riskFactorCount;

    if (riskScore >= 5) return 'critical';
    if (riskScore >= 3) return 'high';
    if (riskScore >= 2) return 'medium';
    return 'low';
  }

  /**
   * Generate mitigation strategies for identified risks
   */
  private generateMitigationStrategies(riskFactors: string[]): string[] {
    const strategies: string[] = [];

    if (riskFactors.some(rf => rf.includes('functions'))) {
      strategies.push('Implement gradual migration with feature flags');
      strategies.push('Add comprehensive integration tests');
    }

    if (riskFactors.some(rf => rf.includes('files'))) {
      strategies.push('Use automated codemod tools');
      strategies.push('Implement changes in small batches');
    }

    if (riskFactors.some(rf => rf.includes('High-risk'))) {
      strategies.push('Manual review of all high-risk consolidations');
      strategies.push('Create detailed rollback procedures');
    }

    strategies.push('Monitor application metrics post-deployment');
    strategies.push('Maintain backward compatibility layer initially');

    return strategies;
  }

  /**
   * Generate artifacts from recommendations
   */
  private generateArtifacts(recommendations: CanonicalizationPlan[]): {
    viewTypes: ViewTypeDefinition[];
    mapperFunctions: string[];
    migrationScripts: string[];
  } {
    const viewTypes = recommendations.flatMap(plan => plan.generatedViewTypes);
    const mapperFunctions = viewTypes.flatMap(vt => [
      vt.generatedMappers.toCanonical,
      vt.generatedMappers.fromCanonical
    ]);
    const migrationScripts = recommendations.map(plan =>
      this.generateMigrationScript(plan)
    );

    return {
      viewTypes,
      mapperFunctions,
      migrationScripts
    };
  }

  /**
   * Generate migration script for a plan
   */
  private generateMigrationScript(plan: CanonicalizationPlan): string {
    return `#!/bin/bash
# Migration script for ${plan.canonicalType.typeName} canonicalization

echo "Starting canonicalization of ${plan.canonicalType.typeName}..."

# Phase 1: Setup
${plan.migrationStrategy.phases[0]?.actions.map(action => `echo "  ${action}"`).join('\n')}

# Phase 2: Migration  
${plan.migrationStrategy.phases[1]?.actions.map(action => `echo "  ${action}"`).join('\n')}

# Phase 3: Cleanup
${plan.migrationStrategy.phases[2]?.actions.map(action => `echo "  ${action}"`).join('\n')}

echo "Canonicalization completed successfully!"
`;
  }

  /**
   * Calculate quality metrics
   */
  private calculateQualityMetrics(
    recommendations: CanonicalizationPlan[],
    totalTypesAnalyzed: number
  ): CanonicalizationResult['qualityMetrics'] {
    // Handle empty dataset case
    if (recommendations.length === 0 || totalTypesAnalyzed === 0) {
      return {
        duplicateReduction: 0,
        cohesionImprovement: 0,
        maintainabilityScore: 0
      };
    }

    const totalDuplicatesEliminated = recommendations.reduce(
      (sum, plan) => sum + plan.estimatedImpact.estimatedSavings.duplicateTypesEliminated,
      0
    );

    const duplicateReduction = totalDuplicatesEliminated / totalTypesAnalyzed;

    const avgComplexityReduction = recommendations.reduce(
      (sum, plan) => sum + plan.estimatedImpact.estimatedSavings.maintenanceComplexityReduction,
      0
    ) / recommendations.length;

    // Calculate maintainability score based on consolidation benefits
    const maintainabilityScore = Math.min(1.0, 
      duplicateReduction * 0.5 + avgComplexityReduction * 0.5
    );

    return {
      duplicateReduction,
      cohesionImprovement: avgComplexityReduction,
      maintainabilityScore
    };
  }

  // Utility methods
  private isSubset<T>(setA: Set<T>, setB: Set<T>): boolean {
    for (const item of setA) {
      if (!setB.has(item)) return false;
    }
    return true;
  }

  private setsEqual<T>(setA: Set<T>, setB: Set<T>): boolean {
    return setA.size === setB.size && this.isSubset(setA, setB);
  }

  private hasOverlap<T>(setA: Set<T>, setB: Set<T>): boolean {
    for (const item of setA) {
      if (setB.has(item)) return true;
    }
    return false;
  }
}