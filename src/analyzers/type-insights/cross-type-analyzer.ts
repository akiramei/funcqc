/**
 * Cross-Type Analysis Base Class
 * 
 * Provides common functionality for analyzing patterns across multiple types
 * in a TypeScript codebase. This includes property slices, structural relationships,
 * and behavioral patterns.
 */

import type { 
  StorageQueryInterface
} from './types';

export interface CrossTypeAnalysisOptions {
  minSupport: number;      // Minimum number of types to contain a pattern
  minConfidence: number;   // Minimum confidence for pattern significance
  maxPatternSize: number;  // Maximum items in a pattern
  includeRarePatterns: boolean; // Include low-frequency patterns
}

export interface TypePropertyInfo {
  typeId: string;
  typeName: string;
  properties: string[];
  methods: string[];
  memberCount: number;
  file: string;
}

export interface CrossTypePattern {
  id: string;
  pattern: string[];
  support: number;        // Number of types containing this pattern
  confidence: number;     // Statistical confidence score
  lift: number;          // Association rule lift metric
  types: string[];       // Type IDs containing this pattern
  suggestedAction: string;
  impactScore: number;
}

export abstract class CrossTypeAnalyzer {
  protected storage: StorageQueryInterface;
  protected options: CrossTypeAnalysisOptions;

  constructor(
    storage: StorageQueryInterface, 
    options: Partial<CrossTypeAnalysisOptions> = {}
  ) {
    this.storage = storage;
    this.options = {
      minSupport: options.minSupport ?? 3,
      minConfidence: options.minConfidence ?? 0.8,
      maxPatternSize: options.maxPatternSize ?? 5,
      includeRarePatterns: options.includeRarePatterns ?? false,
      ...options
    };
  }

  /**
   * Load all type information from the database
   */
  protected async loadTypeInformation(snapshotId?: string): Promise<TypePropertyInfo[]> {
    try {
      // Use a simpler approach - query everything and filter in memory
      const typesQuery = snapshotId 
        ? `SELECT id, name, file_path FROM type_definitions WHERE snapshot_id = $1`
        : `SELECT id, name, file_path FROM type_definitions`;
      
      const membersQuery = snapshotId
        ? `SELECT type_id, name, member_kind FROM type_members WHERE snapshot_id = $1 AND member_kind IN ('property','method','getter','setter','field')`
        : `SELECT type_id, name, member_kind FROM type_members WHERE member_kind IN ('property','method','getter','setter','field')`;

      const [typesResult, membersResult] = await Promise.all([
        this.storage.query(typesQuery, snapshotId ? [snapshotId] : []),
        this.storage.query(membersQuery, snapshotId ? [snapshotId] : [])
      ]);

      const typeInfoMap = new Map<string, TypePropertyInfo>();

      // Initialize type info
      for (const row of typesResult.rows) {
        const r = row as Record<string, unknown>;
        const typeInfo: TypePropertyInfo = {
          typeId: r['id'] as string,
          typeName: r['name'] as string,
          properties: [],
          methods: [],
          memberCount: 0,
          file: r['file_path'] as string
        };
        typeInfoMap.set(typeInfo.typeId, typeInfo);
      }

      // Group members by type
      for (const row of membersResult.rows) {
        const r = row as Record<string, unknown>;
        const typeInfo = typeInfoMap.get(r['type_id'] as string);
        if (typeInfo) {
          if (
            r['member_kind'] === 'property' ||
            r['member_kind'] === 'getter'   ||
            r['member_kind'] === 'setter'   ||
            r['member_kind'] === 'field'
          ) {
            typeInfo.properties.push(r['name'] as string);
          } else if (r['member_kind'] === 'method') {
            typeInfo.methods.push(r['name'] as string);
          }
        }
      }

      // Calculate member counts and filter
      const result = Array.from(typeInfoMap.values())
        .map(type => ({
          ...type,
          memberCount: type.properties.length + type.methods.length
        }))
        .filter(type => type.memberCount > 0);

      return result;
    } catch (error) {
      throw new Error(`Failed to load type information: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Calculate Jaccard similarity between two sets
   */
  protected calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Calculate support (frequency) of a pattern across types
   */
  protected calculateSupport(pattern: string[], types: TypePropertyInfo[]): number {
    let supportCount = 0;

    for (const type of types) {
      const typeItems = new Set([...type.properties, ...type.methods]);
      if (pattern.every(item => typeItems.has(item))) {
        supportCount++;
      }
    }

    return supportCount;
  }

  /**
   * Calculate confidence for association rule A → B
   */
  protected calculateConfidence(
    antecedent: string[], 
    consequent: string[], 
    types: TypePropertyInfo[]
  ): number {
    const antecedentSupport = this.calculateSupport(antecedent, types);
    const fullPatternSupport = this.calculateSupport([...antecedent, ...consequent], types);
    
    return antecedentSupport === 0 ? 0 : fullPatternSupport / antecedentSupport;
  }

  /**
   * Calculate lift metric for association rule
   */
  protected calculateLift(
    antecedent: string[], 
    consequent: string[], 
    types: TypePropertyInfo[]
  ): number {
    const antecedentSupport = this.calculateSupport(antecedent, types);
    const consequentSupport = this.calculateSupport(consequent, types);
    const fullPatternSupport = this.calculateSupport([...antecedent, ...consequent], types);
    
    const expectedSupport = (antecedentSupport * consequentSupport) / types.length;
    return expectedSupport === 0 ? 0 : fullPatternSupport / expectedSupport;
  }

  /**
   * Filter patterns based on configured thresholds
   */
  protected filterPatterns(patterns: CrossTypePattern[]): CrossTypePattern[] {
    return patterns.filter(pattern => {
      if (pattern.support < this.options.minSupport) return false;
      if (pattern.confidence < this.options.minConfidence) return false;
      
      return true;
    });
  }

  /**
   * Abstract method to be implemented by specific analyzers
   */
  abstract analyze(snapshotId?: string): Promise<CrossTypePattern[]>;

  /**
   * Get analyzer-specific configuration
   */
  getConfiguration(): CrossTypeAnalysisOptions {
    return { ...this.options };
  }

  /**
   * Update analyzer configuration
   */
  updateConfiguration(newOptions: Partial<CrossTypeAnalysisOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }
}