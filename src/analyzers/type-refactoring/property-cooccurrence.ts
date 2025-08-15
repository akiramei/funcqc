/**
 * Property Co-occurrence Analyzer
 * 
 * Analyzes property combinations within types to identify common patterns
 * for DTO canonicalization and Value Object extraction.
 */

import type { StorageQueryInterface } from '../type-insights/types';

export interface PropertyCooccurrencePattern {
  id: string;
  properties: string[];           // Set of properties that co-occur
  support: number;                // Number of types containing all these properties
  confidence: number;             // Confidence score (0.0 - 1.0)
  types: string[];               // Type names containing this pattern
  frequency: number;             // How often these properties appear together
  relationshipType: 'subset' | 'superset' | 'overlap' | 'identical';
}

export interface PropertyUsageStats {
  propertyName: string;
  totalOccurrences: number;       // Total times this property appears
  typeCount: number;              // Number of different types using this property
  usageContexts: PropertyContext[];
}

export interface PropertyContext {
  typeName: string;
  typeId: string;
  filePath: string;
  isOptional: boolean;
  propertyType: string;
  cooccurringProperties: string[]; // Other properties in the same type
}

export interface CooccurrenceAnalysisResult {
  patterns: PropertyCooccurrencePattern[];
  propertyStats: PropertyUsageStats[];
  candidateCanonicalTypes: CandidateCanonicalType[];
  valueObjectCandidates: ValueObjectCandidate[];
  totalTypesAnalyzed: number;
}

export interface CandidateCanonicalType {
  typeName: string;
  typeId: string;
  properties: string[];
  subsetTypes: string[];          // Types that are subsets of this type
  coverageScore: number;          // How well this type covers others
  usageFrequency: number;         // How often this type is used
  recommendationReason: string;
}

export interface ValueObjectCandidate {
  propertyGroup: string[];
  groupName: string;              // Suggested VO name
  types: string[];               // Types containing this property group
  cohesionScore: number;         // How well these properties belong together
  extractionComplexity: 'low' | 'medium' | 'high';
  usageSites: number;            // Number of places this group is used
  invariantCandidates: string[]; // Potential invariants for this VO
}

export interface PropertyCooccurrenceOptions {
  minSupport: number;            // Minimum number of types for a pattern
  minConfidence: number;         // Minimum confidence for pattern significance
  maxPatternSize: number;        // Maximum number of properties in a pattern
  includeOptionalProperties: boolean;
  excludeCommonProperties: string[]; // Properties to ignore (id, createdAt, etc.)
}

export class PropertyCooccurrenceAnalyzer {
  private storage: StorageQueryInterface;
  private options: Required<PropertyCooccurrenceOptions>;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<PropertyCooccurrenceOptions> = {}
  ) {
    this.storage = storage;
    this.options = {
      minSupport: options.minSupport ?? 2,
      minConfidence: options.minConfidence ?? 0.5,
      maxPatternSize: options.maxPatternSize ?? 5,
      includeOptionalProperties: options.includeOptionalProperties ?? true,
      excludeCommonProperties: options.excludeCommonProperties ?? [
        'id', 'createdAt', 'updatedAt', 'version', 'timestamp'
      ],
      ...options
    } as Required<PropertyCooccurrenceOptions>;
  }

  /**
   * Analyze property co-occurrence patterns across types
   */
  async analyze(snapshotId?: string): Promise<CooccurrenceAnalysisResult> {
    // Get all type definitions with their properties
    const typeProperties = await this.extractTypeProperties(snapshotId);
    
    // Calculate property usage statistics
    const propertyStats = this.calculatePropertyStats(typeProperties);
    
    // Find co-occurrence patterns
    const patterns = this.findCooccurrencePatterns(typeProperties, propertyStats);
    
    // Identify canonical type candidates
    const candidateCanonicalTypes = this.identifyCanonicalTypeCandidates(
      typeProperties, 
      patterns
    );
    
    // Identify Value Object candidates
    const valueObjectCandidates = this.identifyValueObjectCandidates(
      patterns,
      propertyStats
    );

    return {
      patterns,
      propertyStats,
      candidateCanonicalTypes,
      valueObjectCandidates,
      totalTypesAnalyzed: typeProperties.length
    };
  }

  /**
   * Extract properties from type definitions in the database
   */
  private async extractTypeProperties(snapshotId?: string): Promise<TypePropertyMap[]> {
    const query = snapshotId
      ? `SELECT td.id, td.name, td.file_path, td.definition, tm.member_name, tm.member_kind, tm.is_optional, tm.member_type
         FROM type_definitions td
         LEFT JOIN type_members tm ON td.id = tm.type_id
         WHERE td.snapshot_id = $1 AND (tm.member_kind = 'property' OR tm.member_kind IS NULL)
         ORDER BY td.name, tm.member_name`
      : `SELECT td.id, td.name, td.file_path, td.definition, tm.member_name, tm.member_kind, tm.is_optional, tm.member_type
         FROM type_definitions td
         LEFT JOIN type_members tm ON td.id = tm.type_id
         WHERE tm.member_kind = 'property' OR tm.member_kind IS NULL
         ORDER BY td.name, tm.member_name`;

    const params = snapshotId ? [snapshotId] : [];
    const result = await this.storage.query(query, params);

    // Group properties by type
    const typePropertiesMap = new Map<string, TypePropertyMap>();
    
    for (const row of result.rows) {
      const rowData = row as Record<string, unknown>;
      const typeId = rowData['id'] as string;
      
      if (!typePropertiesMap.has(typeId)) {
        typePropertiesMap.set(typeId, {
          typeId,
          typeName: rowData['name'] as string,
          filePath: rowData['file_path'] as string,
          definition: rowData['definition'] as string,
          properties: []
        });
      }

      const typeProperties = typePropertiesMap.get(typeId)!;
      
      // Add property if it exists and is not in exclude list
      if (rowData['member_name'] && 
          !this.options.excludeCommonProperties.includes(rowData['member_name'] as string)) {
        
        // Skip optional properties if configured to do so
        if (!this.options.includeOptionalProperties && rowData['is_optional']) {
          continue;
        }

        typeProperties.properties.push({
          name: rowData['member_name'] as string,
          type: (rowData['member_type'] as string) || 'unknown',
          isOptional: (rowData['is_optional'] as boolean) || false
        });
      }
    }

    return Array.from(typePropertiesMap.values())
      .filter(type => type.properties.length > 0); // Only include types with properties
  }

  /**
   * Calculate usage statistics for each property
   */
  private calculatePropertyStats(typeProperties: TypePropertyMap[]): PropertyUsageStats[] {
    const statsMap = new Map<string, PropertyUsageStats>();

    for (const typeInfo of typeProperties) {
      const cooccurringProperties = typeInfo.properties.map(p => p.name);
      
      for (const property of typeInfo.properties) {
        if (!statsMap.has(property.name)) {
          statsMap.set(property.name, {
            propertyName: property.name,
            totalOccurrences: 0,
            typeCount: 0,
            usageContexts: []
          });
        }

        const stats = statsMap.get(property.name)!;
        stats.totalOccurrences++;
        stats.typeCount++;
        stats.usageContexts.push({
          typeName: typeInfo.typeName,
          typeId: typeInfo.typeId,
          filePath: typeInfo.filePath,
          isOptional: property.isOptional,
          propertyType: property.type,
          cooccurringProperties: cooccurringProperties.filter(p => p !== property.name)
        });
      }
    }

    return Array.from(statsMap.values())
      .sort((a, b) => b.totalOccurrences - a.totalOccurrences);
  }

  /**
   * Find significant co-occurrence patterns
   */
  private findCooccurrencePatterns(
    typeProperties: TypePropertyMap[],
    propertyStats: PropertyUsageStats[]
  ): PropertyCooccurrencePattern[] {
    const patterns: PropertyCooccurrencePattern[] = [];

    // Generate all possible property combinations up to maxPatternSize
    for (let size = 2; size <= this.options.maxPatternSize; size++) {
      const combinations = this.generatePropertyCombinations(propertyStats, size);
      
      for (const combination of combinations) {
        const pattern = this.evaluatePropertyCombination(combination, typeProperties);
        
        if (pattern.support >= this.options.minSupport && 
            pattern.confidence >= this.options.minConfidence) {
          patterns.push(pattern);
        }
      }
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Generate property combinations of specified size
   */
  private generatePropertyCombinations(
    propertyStats: PropertyUsageStats[],
    size: number
  ): string[][] {
    // Consider all properties for combinations, not just those with high support
    const properties = propertyStats.map(stat => stat.propertyName);
    
    return this.getCombinations(properties, size);
  }

  /**
   * Get all combinations of specified size from array
   */
  private getCombinations<T>(array: T[], size: number): T[][] {
    if (size === 1) return array.map(item => [item]);
    if (size > array.length) return [];

    const combinations: T[][] = [];
    
    for (let i = 0; i <= array.length - size; i++) {
      const first = array[i];
      const smallerCombinations = this.getCombinations(array.slice(i + 1), size - 1);
      
      for (const smallerCombination of smallerCombinations) {
        combinations.push([first, ...smallerCombination]);
      }
    }

    return combinations;
  }

  /**
   * Evaluate a property combination to create a pattern
   */
  private evaluatePropertyCombination(
    properties: string[],
    typeProperties: TypePropertyMap[]
  ): PropertyCooccurrencePattern {
    const typesWithAllProperties = typeProperties.filter(typeInfo =>
      properties.every(prop => 
        typeInfo.properties.some(p => p.name === prop)
      )
    );

    const support = typesWithAllProperties.length;
    const totalTypes = typeProperties.length;
    const confidence = support / totalTypes;

    // Determine relationship type
    const relationshipType = this.determineRelationshipType(
      properties,
      typesWithAllProperties
    );

    return {
      id: `pattern_${properties.sort().join('_')}`,
      properties: properties.sort(),
      support,
      confidence,
      types: typesWithAllProperties.map(t => t.typeName),
      frequency: this.calculateFrequency(properties, typeProperties),
      relationshipType
    };
  }

  /**
   * Determine the relationship type between property sets
   */
  private determineRelationshipType(
    properties: string[],
    typesWithProperties: TypePropertyMap[]
  ): PropertyCooccurrencePattern['relationshipType'] {
    const propertySets = typesWithProperties.map(type => 
      new Set(type.properties.map(p => p.name))
    );

    const targetSet = new Set(properties);
    let identicalCount = 0;
    let subsetCount = 0;
    let supersetCount = 0;

    for (const propertySet of propertySets) {
      if (this.setsEqual(targetSet, propertySet)) {
        identicalCount++;
      } else if (this.isSubset(targetSet, propertySet)) {
        subsetCount++;
      } else if (this.isSubset(propertySet, targetSet)) {
        supersetCount++;
      }
    }

    if (identicalCount > 0) return 'identical';
    if (subsetCount > supersetCount) return 'subset';
    if (supersetCount > subsetCount) return 'superset';
    return 'overlap';
  }

  /**
   * Calculate frequency score for property combination
   */
  private calculateFrequency(
    properties: string[],
    typeProperties: TypePropertyMap[]
  ): number {
    let totalOccurrences = 0;
    
    for (const typeInfo of typeProperties) {
      const typePropertyNames = new Set(typeInfo.properties.map(p => p.name));
      const matchingCount = properties.filter(prop => typePropertyNames.has(prop)).length;
      
      if (matchingCount > 0) {
        totalOccurrences += matchingCount / properties.length;
      }
    }

    return totalOccurrences / typeProperties.length;
  }

  /**
   * Identify canonical type candidates
   */
  private identifyCanonicalTypeCandidates(
    typeProperties: TypePropertyMap[],
    patterns: PropertyCooccurrencePattern[]
  ): CandidateCanonicalType[] {
    const candidates: CandidateCanonicalType[] = [];

    for (const typeInfo of typeProperties) {
      const typePropertyNames = new Set(typeInfo.properties.map(p => p.name));
      
      // Find other types that are subsets of this type
      const subsetTypes = typeProperties.filter(other => {
        if (other.typeId === typeInfo.typeId) return false;
        
        const otherPropertyNames = new Set(other.properties.map(p => p.name));
        return this.isSubset(otherPropertyNames, typePropertyNames);
      });

      if (subsetTypes.length > 0) {
        // Calculate coverage score based on how many types this covers
        const coverageScore = subsetTypes.length / typeProperties.length;
        
        // Calculate usage frequency (placeholder - would be enhanced with actual usage data)
        const usageFrequency = this.calculateTypeUsageFrequency(typeInfo, patterns);

        candidates.push({
          typeName: typeInfo.typeName,
          typeId: typeInfo.typeId,
          properties: Array.from(typePropertyNames),
          subsetTypes: subsetTypes.map(t => t.typeName),
          coverageScore,
          usageFrequency,
          recommendationReason: `Covers ${subsetTypes.length} subset types with ${coverageScore.toFixed(2)} coverage`
        });
      }
    }

    return candidates.sort((a, b) => b.coverageScore - a.coverageScore);
  }

  /**
   * Calculate type usage frequency
   */
  private calculateTypeUsageFrequency(
    typeInfo: TypePropertyMap,
    patterns: PropertyCooccurrencePattern[]
  ): number {
    // Count how many patterns this type participates in
    const participatingPatterns = patterns.filter(pattern =>
      pattern.types.includes(typeInfo.typeName)
    );

    return participatingPatterns.reduce((sum, pattern) => sum + pattern.confidence, 0);
  }

  /**
   * Identify Value Object candidates
   */
  private identifyValueObjectCandidates(
    patterns: PropertyCooccurrencePattern[],
    propertyStats: PropertyUsageStats[]
  ): ValueObjectCandidate[] {
    const candidates: ValueObjectCandidate[] = [];

    // Look for patterns that could be good Value Objects
    for (const pattern of patterns) {
      if (pattern.properties.length >= 2 && pattern.properties.length <= 4) {
        const cohesionScore = this.calculateCohesionScore(pattern, propertyStats);
        const extractionComplexity = this.assessExtractionComplexity(pattern);
        const usageSites = pattern.support;

        if (cohesionScore > 0.6) {
          candidates.push({
            propertyGroup: pattern.properties,
            groupName: this.generateVOName(pattern.properties),
            types: pattern.types,
            cohesionScore,
            extractionComplexity,
            usageSites,
            invariantCandidates: this.inferInvariantCandidates(pattern.properties)
          });
        }
      }
    }

    return candidates.sort((a, b) => b.cohesionScore - a.cohesionScore);
  }

  /**
   * Calculate cohesion score for a property group
   */
  private calculateCohesionScore(
    pattern: PropertyCooccurrencePattern,
    propertyStats: PropertyUsageStats[]
  ): number {
    // Base score from pattern confidence
    let score = pattern.confidence;

    // Bonus for properties that often appear together
    const propertyFrequencies = pattern.properties.map(prop => {
      const stats = propertyStats.find(s => s.propertyName === prop);
      return stats ? stats.totalOccurrences : 0;
    });

    const avgFrequency = propertyFrequencies.reduce((sum, freq) => sum + freq, 0) / propertyFrequencies.length;
    const frequencyBonus = Math.min(avgFrequency / 10, 0.3); // Cap bonus at 0.3

    return Math.min(score + frequencyBonus, 1.0);
  }

  /**
   * Assess extraction complexity for Value Object
   */
  private assessExtractionComplexity(
    pattern: PropertyCooccurrencePattern
  ): ValueObjectCandidate['extractionComplexity'] {
    const propertyCount = pattern.properties.length;
    const typeCount = pattern.types.length;

    if (propertyCount <= 2 && typeCount <= 5) return 'low';
    if (propertyCount <= 3 && typeCount <= 10) return 'medium';
    return 'high';
  }

  /**
   * Generate suggested Value Object name
   */
  private generateVOName(properties: string[]): string {
    // Simple heuristic - could be enhanced with better naming logic
    const sortedProps = properties.sort();
    
    // Look for common patterns
    if (sortedProps.includes('start') && sortedProps.includes('end')) {
      return 'TimeRange';
    }
    if (sortedProps.includes('amount') && sortedProps.includes('currency')) {
      return 'Money';
    }
    if (sortedProps.includes('lat') && sortedProps.includes('lng')) {
      return 'Coordinate';
    }
    if (sortedProps.includes('width') && sortedProps.includes('height')) {
      return 'Dimensions';
    }

    // Default: combine property names
    const capitalizedProps = sortedProps.map(prop => 
      prop.charAt(0).toUpperCase() + prop.slice(1)
    );
    
    return capitalizedProps.join('') + 'VO';
  }

  /**
   * Infer potential invariants for property group
   */
  private inferInvariantCandidates(properties: string[]): string[] {
    const invariants: string[] = [];

    // Common invariant patterns
    if (properties.includes('start') && properties.includes('end')) {
      invariants.push('start <= end');
    }
    if (properties.includes('min') && properties.includes('max')) {
      invariants.push('min <= max');
    }
    if (properties.includes('amount')) {
      invariants.push('amount >= 0');
    }
    if (properties.includes('count') || properties.includes('quantity')) {
      invariants.push('count >= 0');
    }
    if (properties.includes('email')) {
      invariants.push('email matches valid email format');
    }

    return invariants;
  }

  /**
   * Utility: Check if set A is a subset of set B
   */
  private isSubset<T>(setA: Set<T>, setB: Set<T>): boolean {
    for (const item of setA) {
      if (!setB.has(item)) return false;
    }
    return true;
  }

  /**
   * Utility: Check if two sets are equal
   */
  private setsEqual<T>(setA: Set<T>, setB: Set<T>): boolean {
    return setA.size === setB.size && this.isSubset(setA, setB);
  }
}

interface TypePropertyMap {
  typeId: string;
  typeName: string;
  filePath: string;
  definition: string;
  properties: {
    name: string;
    type: string;
    isOptional: boolean;
  }[];
}