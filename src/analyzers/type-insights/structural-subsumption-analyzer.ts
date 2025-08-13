/**
 * Structural Subsumption Analyzer
 * 
 * Detects structural containment relationships and partial isomorphism
 * between types in a TypeScript codebase. This includes:
 * - Complete subsumption (one type is a subset/superset of another)
 * - Partial isomorphism (types share significant structural similarity)
 * - Redundant types (essentially identical structures)
 */

import type { 
  StorageQueryInterface
} from './types';

import { 
  CrossTypeAnalyzer, 
  type CrossTypeAnalysisOptions,
  type TypePropertyInfo,
  type CrossTypePattern
} from './cross-type-analyzer';

// Removed FuncqcError import - using standard Error class

export interface StructuralSubsumptionOptions extends CrossTypeAnalysisOptions {
  minOverlapRatio: number;     // Minimum overlap ratio for similarity (0-1)
  includePartialMatches: boolean; // Include partial structural matches
  showRedundantOnly: boolean;  // Only show redundant (near-identical) types
  considerMethodNames: boolean; // Consider method names in analysis
}

export interface SubsumptionRelationship {
  id: string;
  sourceTypeId: string;
  sourceTypeName: string;
  targetTypeId: string; 
  targetTypeName: string;
  relationshipType: 'subset' | 'superset' | 'equivalent' | 'partial_overlap';
  overlapRatio: number;        // Jaccard similarity coefficient
  commonMembers: string[];     // Shared properties/methods
  uniqueToSource: string[];    // Members only in source
  uniqueToTarget: string[];    // Members only in target
  suggestedAction: string;
  impactScore: number;
  confidence: number;
}

export class StructuralSubsumptionAnalyzer extends CrossTypeAnalyzer {
  private subsumptionOptions: StructuralSubsumptionOptions;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<StructuralSubsumptionOptions> = {}
  ) {
    super(storage, options);
    
    this.subsumptionOptions = {
      ...this.options,
      minOverlapRatio: options.minOverlapRatio ?? 0.7,
      includePartialMatches: options.includePartialMatches ?? true,
      showRedundantOnly: options.showRedundantOnly ?? false,
      considerMethodNames: options.considerMethodNames ?? false,
      ...options
    };
  }

  /**
   * Analyze structural subsumption relationships between types
   */
  async analyze(snapshotId?: string): Promise<CrossTypePattern[]> {
    try {
      const types = await this.loadTypeInformation(snapshotId);
      
      if (types.length < 2) {
        return [];
      }

      const relationships = await this.findSubsumptionRelationships(types);
      const patterns = this.convertToPatterns(relationships);
      
      return this.filterPatterns(patterns);
    } catch (error) {
      throw new Error(`Failed to analyze structural subsumption: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Find all subsumption relationships between types
   */
  private async findSubsumptionRelationships(types: TypePropertyInfo[]): Promise<SubsumptionRelationship[]> {
    const relationships: SubsumptionRelationship[] = [];
    
    // Pre-compute member sets for all types to avoid O(n^2) recalculation
    const memberSets = new Map<string, Set<string>>();
    for (const type of types) {
      memberSets.set(type.typeId, this.getMemberSet(type));
    }
    
    // Compare each pair of types
    for (let i = 0; i < types.length; i++) {
      for (let j = i + 1; j < types.length; j++) {
        const sourceType = types[i];
        const targetType = types[j];
        const sourceMembers = memberSets.get(sourceType.typeId)!;
        const targetMembers = memberSets.get(targetType.typeId)!;
        
        const relationship = this.analyzeTypePairWithSets(
          sourceType, 
          targetType, 
          sourceMembers, 
          targetMembers
        );
        if (relationship && this.meetsFilterCriteria(relationship)) {
          relationships.push(relationship);
        }
      }
    }

    return relationships.sort((a, b) => b.impactScore - a.impactScore);
  }


  /**
   * Analyze a pair of types for subsumption relationships with pre-computed member sets
   * Performance optimized version that avoids redundant Set creation
   */
  private analyzeTypePairWithSets(
    sourceType: TypePropertyInfo, 
    targetType: TypePropertyInfo,
    sourceMembers: Set<string>,
    targetMembers: Set<string>
  ): SubsumptionRelationship | null {
    
    // Skip self-comparison
    if (sourceType.typeId === targetType.typeId) {
      return null;
    }

    // Skip empty types
    if (sourceMembers.size === 0 || targetMembers.size === 0) {
      return null;
    }

    // Calculate set operations
    const intersection = new Set([...sourceMembers].filter(x => targetMembers.has(x)));
    const union = new Set([...sourceMembers, ...targetMembers]);
    const uniqueToSource = new Set([...sourceMembers].filter(x => !targetMembers.has(x)));
    const uniqueToTarget = new Set([...targetMembers].filter(x => !sourceMembers.has(x)));

    // Calculate overlap ratio (Jaccard similarity)
    const overlapRatio = union.size === 0 ? 0 : intersection.size / union.size;

    // Determine relationship type
    const relationshipType = this.determineRelationshipType(
      sourceMembers, 
      targetMembers, 
      intersection,
      overlapRatio
    );

    if (relationshipType === null) {
      return null;
    }

    // Calculate impact score
    const impactScore = this.calculateImpactScore(
      sourceMembers,
      targetMembers,
      overlapRatio,
      relationshipType
    );

    // Generate suggested action
    const suggestedAction = this.generateSuggestedAction(
      relationshipType,
      sourceType,
      targetType,
      overlapRatio
    );

    return {
      id: `subsume_${sourceType.typeId}_${targetType.typeId}`,
      sourceTypeId: sourceType.typeId,
      sourceTypeName: sourceType.typeName,
      targetTypeId: targetType.typeId,
      targetTypeName: targetType.typeName,
      relationshipType,
      overlapRatio,
      commonMembers: Array.from(intersection).sort(),
      uniqueToSource: Array.from(uniqueToSource).sort(),
      uniqueToTarget: Array.from(uniqueToTarget).sort(),
      suggestedAction,
      impactScore,
      confidence: this.calculateSubsumptionConfidence(overlapRatio, sourceMembers.size, targetMembers.size)
    };
  }

  /**
   * Get member set for a type based on configuration
   */
  private getMemberSet(type: TypePropertyInfo): Set<string> {
    const members = new Set<string>();
    
    // Always include properties
    for (const prop of type.properties) {
      members.add(`prop:${prop}`);
    }
    
    // Include methods if configured
    if (this.subsumptionOptions.considerMethodNames) {
      for (const method of type.methods) {
        members.add(`method:${method}`);
      }
    }
    
    return members;
  }

  /**
   * Determine the relationship type between two member sets
   */
  private determineRelationshipType(
    sourceMembers: Set<string>,
    targetMembers: Set<string>,
    intersection: Set<string>,
    overlapRatio: number
  ): SubsumptionRelationship['relationshipType'] | null {
    
    const sourceSize = sourceMembers.size;
    const targetSize = targetMembers.size;
    const intersectionSize = intersection.size;

    // Equivalent: Same members (high overlap + similar sizes)
    if (overlapRatio >= 0.95 && Math.abs(sourceSize - targetSize) <= 1) {
      return 'equivalent';
    }

    // Subset: All source members are in target
    if (intersectionSize === sourceSize && sourceSize < targetSize) {
      return 'subset';
    }

    // Superset: All target members are in source  
    if (intersectionSize === targetSize && targetSize < sourceSize) {
      return 'superset';
    }

    // Partial overlap: Significant overlap but neither is subset
    if (overlapRatio >= this.subsumptionOptions.minOverlapRatio && 
        intersectionSize > 0 && 
        intersectionSize < sourceSize && 
        intersectionSize < targetSize) {
      return 'partial_overlap';
    }

    return null;
  }

  /**
   * Calculate impact score for a relationship
   */
  private calculateImpactScore(
    sourceMembers: Set<string>,
    targetMembers: Set<string>, 
    overlapRatio: number,
    relationshipType: SubsumptionRelationship['relationshipType']
  ): number {
    let score = 0;

    // Base score from overlap ratio
    score += overlapRatio * 50;

    // Bonus for relationship strength
    switch (relationshipType) {
      case 'equivalent':
        score += 30; // High impact - completely redundant
        break;
      case 'subset':
      case 'superset':
        score += 20; // High impact - clear hierarchy
        break;
      case 'partial_overlap':
        score += 10; // Medium impact - potential consolidation
        break;
    }

    // Bonus for larger types (more impact when consolidated)
    const maxSize = Math.max(sourceMembers.size, targetMembers.size);
    score += Math.min(maxSize * 2, 20);

    return Math.round(score);
  }

  /**
   * Generate suggested action for a relationship
   */
  private generateSuggestedAction(
    relationshipType: SubsumptionRelationship['relationshipType'],
    sourceType: TypePropertyInfo,
    targetType: TypePropertyInfo,
    overlapRatio: number
  ): string {
    switch (relationshipType) {
      case 'equivalent':
        return `Merge equivalent types: Consider consolidating ${sourceType.typeName} and ${targetType.typeName} into a single type`;
        
      case 'subset':
        return `Extend hierarchy: ${sourceType.typeName} could extend ${targetType.typeName} (${(overlapRatio * 100).toFixed(1)}% overlap)`;
        
      case 'superset':
        return `Extend hierarchy: ${targetType.typeName} could extend ${sourceType.typeName} (${(overlapRatio * 100).toFixed(1)}% overlap)`;
        
      case 'partial_overlap':
        return `Extract common interface: Create shared interface for ${sourceType.typeName} and ${targetType.typeName} (${(overlapRatio * 100).toFixed(1)}% overlap)`;
        
      default:
        return 'Review structural relationship';
    }
  }

  /**
   * Calculate confidence score for a relationship (overrides base class method)
   */
  private calculateSubsumptionConfidence(overlapRatio: number, sourceSize: number, targetSize: number): number {
    let confidence = overlapRatio;
    
    // Higher confidence for larger types (more data points)
    const minSize = Math.min(sourceSize, targetSize);
    if (minSize >= 5) {
      confidence += 0.1;
    }
    if (minSize >= 10) {
      confidence += 0.1;
    }
    
    // Lower confidence for very small types
    if (minSize <= 2) {
      confidence -= 0.2;
    }
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Check if relationship meets filter criteria
   */
  private meetsFilterCriteria(relationship: SubsumptionRelationship): boolean {
    // Always include subset/superset/equivalent relationships regardless of overlap ratio
    if (['subset', 'superset', 'equivalent'].includes(relationship.relationshipType)) {
      // Filter by redundant only setting
      if (this.subsumptionOptions.showRedundantOnly && 
          relationship.relationshipType !== 'equivalent') {
        return false;
      }
      return true;
    }

    // For partial overlaps, apply stricter filtering
    if (relationship.relationshipType === 'partial_overlap') {
      // Filter by overlap ratio
      if (relationship.overlapRatio < this.subsumptionOptions.minOverlapRatio) {
        return false;
      }

      // Filter by partial matches setting
      if (!this.subsumptionOptions.includePartialMatches) {
        return false;
      }
    }

    return true;
  }

  /**
   * Convert subsumption relationships to CrossTypePattern format
   */
  private convertToPatterns(relationships: SubsumptionRelationship[]): CrossTypePattern[] {
    return relationships.map(rel => ({
      id: rel.id,
      pattern: rel.commonMembers,
      support: 2, // Always 2 types in a pairwise relationship
      confidence: rel.confidence,
      lift: rel.overlapRatio, // Use overlap ratio as lift approximation
      types: [rel.sourceTypeId, rel.targetTypeId],
      suggestedAction: rel.suggestedAction,
      impactScore: rel.impactScore
    }));
  }

  /**
   * Get detailed subsumption results (used by CLI)
   */
  async getDetailedResults(snapshotId?: string): Promise<SubsumptionRelationship[]> {
    try {
      const types = await this.loadTypeInformation(snapshotId);
      return await this.findSubsumptionRelationships(types);
    } catch (error) {
      throw new Error(`Failed to get detailed subsumption results: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get configuration specific to subsumption analysis
   */
  getSubsumptionConfiguration(): StructuralSubsumptionOptions {
    return { ...this.subsumptionOptions };
  }

  /**
   * Update subsumption-specific configuration
   */
  updateSubsumptionConfiguration(newOptions: Partial<StructuralSubsumptionOptions>): void {
    this.subsumptionOptions = { ...this.subsumptionOptions, ...newOptions };
    this.updateConfiguration(newOptions);
  }
}