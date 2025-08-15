/**
 * DU Incremental Detector
 * 
 * Core detection logic for discriminated union opportunities.
 * Implements Step A (A1-A3): Detection, Risk Assessment, Impact Analysis
 */

import type { StorageQueryInterface } from '../../type-insights/types';
import type {
  DUPlan,
  DUVariant,
  DetectionResult,
  DetectionOptions,
  FlagCorrelation,
  DiscriminantCandidate,
  TypePropertyInfo,
  PropertyInfo,
  DetectionStatistics,
  DetectionRecommendations,
  CoverageAnalysis,
  ReferenceAnalysis
} from './types';

/**
 * Default detection options
 */
const DEFAULT_OPTIONS: DetectionOptions = {
  minCoverageRate: 0.8,
  minMutualExclusivity: 0.7,
  minUsageFrequency: 0.3,
  maxVariants: 8,
  minVariants: 2,
  includeRiskAssessment: true,
  includeReferenceAnalysis: true,
  excludeCommonProperties: ['id', 'createdAt', 'updatedAt', 'timestamp', 'version']
};

/**
 * DU Incremental Detector - Step A Implementation
 */
export class DUIncrementalDetector {
  private storage: StorageQueryInterface;
  private options: DetectionOptions;

  constructor(storage: StorageQueryInterface, options: Partial<DetectionOptions> = {}) {
    this.storage = storage;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Main detection entry point - Step A: Complete Detection Analysis
   */
  async detect(snapshotId?: string): Promise<DetectionResult> {
    try {
      // A1: Flag and correlation collection
      const typeProperties = await this.extractTypeProperties(snapshotId);
      const flagCorrelations = await this.analyzeFlagCorrelations(typeProperties);
      const discriminantCandidates = await this.identifyDiscriminantCandidates(typeProperties, flagCorrelations);

      // A2: Risk classification and constraint conditions
      const duPlans = await this.generateDUPlans(typeProperties, discriminantCandidates, snapshotId);
      const riskedPlans = await this.assessRisks(duPlans);

      // A3: Impact estimation (reference counting)
      const finalPlans = await this.analyzeImpactScope(riskedPlans, snapshotId);

      // Generate statistics and recommendations
      const statistics = this.calculateStatistics(finalPlans, flagCorrelations, discriminantCandidates, typeProperties.length);
      const recommendations = this.generateRecommendations(finalPlans);

      return {
        candidates: finalPlans,
        flagCorrelations,
        discriminantCandidates,
        statistics,
        recommendations
      };

    } catch (error) {
      throw new Error(`DU detection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * A1.1: Extract type properties from database
   */
  private async extractTypeProperties(snapshotId?: string): Promise<TypePropertyInfo[]> {
    const query = snapshotId
      ? `SELECT DISTINCT 
           td.id as type_id,
           td.name as type_name, 
           td.file_path,
           tm.name as member_name,
           tm.type_text as member_type,
           tm.is_optional
         FROM type_definitions td
         JOIN type_members tm ON td.id = tm.type_id
         WHERE td.snapshot_id = $1 
           AND tm.member_kind = 'property'
           AND td.kind IN ('interface', 'type_alias')
         ORDER BY td.name, tm.name`
      : `SELECT DISTINCT 
           td.id as type_id,
           td.name as type_name, 
           td.file_path,
           tm.name as member_name,
           tm.type_text as member_type,
           tm.is_optional
         FROM type_definitions td
         JOIN type_members tm ON td.id = tm.type_id
         WHERE tm.member_kind = 'property'
           AND td.kind IN ('interface', 'type_alias')
         ORDER BY td.name, tm.name`;

    const params = snapshotId ? [snapshotId] : [];
    const result = await this.storage.query(query, params);

    // Group by type
    const typeMap = new Map<string, TypePropertyInfo>();
    
    for (const row of result.rows) {
      const rowData = row as Record<string, unknown>;
      const typeName = rowData['type_name'] as string;
      const typeId = rowData['type_id'] as string;
      const filePath = rowData['file_path'] as string;
      const memberName = rowData['member_name'] as string;
      const memberType = rowData['member_type'] as string;
      const isOptional = rowData['is_optional'] as boolean;

      if (!typeMap.has(typeName)) {
        typeMap.set(typeName, {
          typeName,
          typeId,
          filePath,
          properties: []
        });
      }

      const typeInfo = typeMap.get(typeName)!;
      
      // Skip excluded common properties
      if (this.options.excludeCommonProperties.includes(memberName)) {
        continue;
      }

      const propertyInfo: PropertyInfo = {
        name: memberName,
        type: memberType,
        isOptional,
        isLiteral: this.isLiteralType(memberType),
        literalValues: this.extractLiteralValues(memberType) || undefined
      };

      typeInfo.properties.push(propertyInfo);
    }

    return Array.from(typeMap.values());
  }

  /**
   * A1.2: Analyze flag correlations using φ coefficient and Jaccard index
   */
  private async analyzeFlagCorrelations(typeProperties: TypePropertyInfo[]): Promise<FlagCorrelation[]> {
    const correlations: FlagCorrelation[] = [];

    for (const typeInfo of typeProperties) {
      const properties = typeInfo.properties;
      
      // Analyze all property pairs within each type
      for (let i = 0; i < properties.length; i++) {
        for (let j = i + 1; j < properties.length; j++) {
          const propA = properties[i];
          const propB = properties[j];

          // Only analyze potential flag properties
          if (!this.isPotentialFlag(propA) && !this.isPotentialFlag(propB)) {
            continue;
          }

          const correlation = await this.calculateCorrelation(propA, propB, typeProperties);
          if (correlation.phiCoefficient !== 0 || correlation.jaccardIndex > 0.1) {
            correlations.push(correlation);
          }
        }
      }
    }

    return correlations;
  }

  /**
   * A1.3: Identify discriminant candidates based on correlations
   */
  private async identifyDiscriminantCandidates(
    typeProperties: TypePropertyInfo[],
    correlations: FlagCorrelation[]
  ): Promise<DiscriminantCandidate[]> {
    const candidates: DiscriminantCandidate[] = [];
    const propertyStats = new Map<string, { types: Set<string>, totalCount: number, correlations: FlagCorrelation[] }>();

    // Collect property statistics
    for (const typeInfo of typeProperties) {
      for (const prop of typeInfo.properties) {
        if (!this.isPotentialDiscriminant(prop)) continue;

        if (!propertyStats.has(prop.name)) {
          propertyStats.set(prop.name, {
            types: new Set(),
            totalCount: 0,
            correlations: []
          });
        }

        const stats = propertyStats.get(prop.name)!;
        stats.types.add(typeInfo.typeName);
        stats.totalCount++;
      }
    }

    // Find correlations for each property
    for (const correlation of correlations) {
      const propAStats = propertyStats.get(correlation.propertyA);
      const propBStats = propertyStats.get(correlation.propertyB);
      
      if (propAStats) propAStats.correlations.push(correlation);
      if (propBStats) propBStats.correlations.push(correlation);
    }

    // Generate discriminant candidates
    for (const [propName, stats] of propertyStats) {
      const usageFrequency = stats.types.size / typeProperties.length;
      
      if (usageFrequency < this.options.minUsageFrequency) {
        continue;
      }

      // Find a representative property to get type and values
      const representativeType = typeProperties.find(t => 
        t.properties.some(p => p.name === propName)
      );
      const representativeProp = representativeType?.properties.find(p => p.name === propName);
      
      if (!representativeProp) continue;

      const mutualExclusivity = this.calculateMutualExclusivity(stats.correlations, propName);
      const possibleValues = representativeProp.literalValues || this.inferPossibleValues(representativeProp);

      if (possibleValues.length >= this.options.minVariants && 
          possibleValues.length <= this.options.maxVariants &&
          mutualExclusivity >= this.options.minMutualExclusivity) {

        const candidate: DiscriminantCandidate = {
          propertyName: propName,
          propertyType: this.classifyDiscriminantType(representativeProp),
          possibleValues,
          usageFrequency,
          mutualExclusivity,
          correlatedProperties: stats.correlations.map(c => 
            c.propertyA === propName ? c.propertyB : c.propertyA
          ),
          typeOccurrences: new Map(Array.from(stats.types).map(typeName => [typeName, 1]))
        };

        candidates.push(candidate);
      }
    }

    return candidates;
  }

  /**
   * A2: Generate DU plans and assess risks
   */
  private async generateDUPlans(
    typeProperties: TypePropertyInfo[],
    discriminantCandidates: DiscriminantCandidate[],
    snapshotId?: string
  ): Promise<DUPlan[]> {
    const plans: DUPlan[] = [];

    for (const candidate of discriminantCandidates) {
      const typesWithDiscriminant = typeProperties.filter(t =>
        t.properties.some(p => p.name === candidate.propertyName)
      );

      for (const typeInfo of typesWithDiscriminant) {
        const plan = await this.createDUPlan(typeInfo, candidate, snapshotId);
        if (plan && this.meetsCoverageThreshold(plan)) {
          plans.push(plan);
        }
      }
    }

    return plans;
  }

  /**
   * A2.1: Create DU plan for a specific type and discriminant
   */
  private async createDUPlan(
    typeInfo: TypePropertyInfo,
    discriminant: DiscriminantCandidate,
    snapshotId?: string
  ): Promise<DUPlan | null> {
    const variants: DUVariant[] = [];

    for (const value of discriminant.possibleValues) {
      const correlatedProps = discriminant.correlatedProperties.filter(propName =>
        typeInfo.properties.some(p => p.name === propName)
      );

      const variant: DUVariant = {
        tag: value,
        when: { eq: value },
        required: [discriminant.propertyName, ...correlatedProps],
        forbidden: [],
        observedCount: 1 // Would need more sophisticated analysis for real counts
      };

      variants.push(variant);
    }

    if (variants.length < this.options.minVariants) {
      return null;
    }

    const coverage = this.calculateCoverage(variants, typeInfo);

    return {
      typeName: typeInfo.typeName,
      discriminant: discriminant.propertyName,
      variants,
      coverage,
      timestamp: new Date().toISOString(),
      snapshotId
    };
  }

  /**
   * A2.2: Assess risks for DU plans
   */
  private async assessRisks(plans: DUPlan[]): Promise<DUPlan[]> {
    return plans.map(plan => {
      let risk: 'low' | 'medium' | 'high' = 'low';

      // Risk factors
      if (plan.variants.length > 6) {
        risk = 'medium'; // High number of variants increases complexity
      }

      if (plan.coverage.rate < 0.9) {
        risk = 'high'; // Low coverage indicates potential data loss
      }

      // Check for broad discriminant types (not literal)
      const hasNonLiteralDiscriminant = plan.variants.some(v => 
        typeof v.tag === 'string' && v.tag.includes('_value_')
      );
      if (hasNonLiteralDiscriminant) {
        risk = 'high'; // Broad types are risky for discrimination
      }

      return { ...plan, risk };
    });
  }

  /**
   * A3: Analyze impact scope (reference counting)
   */
  private async analyzeImpactScope(plans: DUPlan[], snapshotId?: string): Promise<DUPlan[]> {
    if (!this.options.includeReferenceAnalysis) {
      return plans;
    }

    const plansWithRefs: DUPlan[] = [];

    for (const plan of plans) {
      const refs = await this.countReferences(plan.typeName, plan.discriminant, snapshotId);
      plansWithRefs.push({ ...plan, refs });
    }

    return plansWithRefs;
  }

  /**
   * A3.1: Count references to type and discriminant property
   */
  private async countReferences(typeName: string, _discriminant: string, snapshotId?: string): Promise<ReferenceAnalysis> {
    // This is a simplified implementation - in practice would need more sophisticated AST analysis
    const fileQuery = snapshotId
      ? `SELECT COUNT(DISTINCT td.file_path) as file_count 
         FROM type_definitions td 
         WHERE td.name = $1 AND td.snapshot_id = $2`
      : `SELECT COUNT(DISTINCT td.file_path) as file_count 
         FROM type_definitions td 
         WHERE td.name = $1`;

    const fileParams = snapshotId ? [typeName, snapshotId] : [typeName];
    const fileResult = await this.storage.query(fileQuery, fileParams);
    const fileCount = (fileResult.rows[0] as Record<string, unknown>)['file_count'] as number;

    return {
      files: fileCount,
      callsites: fileCount * 3, // Estimated: 3 callsites per file
      switchStatements: Math.floor(fileCount * 0.5), // Estimated: 50% of files have switches
      conditionalChecks: fileCount * 2 // Estimated: 2 conditional checks per file
    };
  }

  // Helper methods

  private isLiteralType(typeStr: string): boolean {
    return typeStr.includes('literal') || 
           typeStr === 'boolean' || 
           typeStr.match(/^['"`][^'"`]*['"`]$/) !== null ||
           typeStr.match(/^\d+$/) !== null;
  }

  private extractLiteralValues(typeStr: string): Array<string | number | boolean> | undefined {
    if (typeStr === 'boolean') {
      return [true, false];
    }

    // Extract string literals
    const stringMatch = typeStr.match(/['"`]([^'"`]*)['"`]/g);
    if (stringMatch) {
      return stringMatch.map(s => s.slice(1, -1));
    }

    // Extract number literals
    const numberMatch = typeStr.match(/\b\d+\b/g);
    if (numberMatch) {
      return numberMatch.map(Number);
    }

    return undefined;
  }

  private isPotentialFlag(prop: PropertyInfo): boolean {
    return prop.type === 'boolean' || this.isLiteralType(prop.type);
  }

  private isPotentialDiscriminant(prop: PropertyInfo): boolean {
    return this.isPotentialFlag(prop) && !prop.isOptional;
  }

  private async calculateCorrelation(propA: PropertyInfo, propB: PropertyInfo, allTypes: TypePropertyInfo[]): Promise<FlagCorrelation> {
    let cooccurrenceCount = 0;
    let totalCount = 0;

    // Count co-occurrences across all types
    for (const typeInfo of allTypes) {
      const hasA = typeInfo.properties.some(p => p.name === propA.name);
      const hasB = typeInfo.properties.some(p => p.name === propB.name);

      if (hasA || hasB) {
        totalCount++;
        if (hasA && hasB) {
          cooccurrenceCount++;
        }
      }
    }

    // Calculate φ coefficient (simplified)
    const jaccardIndex = totalCount > 0 ? cooccurrenceCount / totalCount : 0;
    const phiCoefficient = jaccardIndex > 0.8 ? 1 : jaccardIndex < 0.2 ? -1 : 0;

    const relationshipType: FlagCorrelation['relationshipType'] = 
      phiCoefficient < -0.5 ? 'exclusive' :
      phiCoefficient > 0.5 ? 'correlated' : 'independent';

    return {
      propertyA: propA.name,
      propertyB: propB.name,
      cooccurrenceCount,
      totalCount,
      phiCoefficient,
      jaccardIndex,
      relationshipType
    };
  }

  private calculateMutualExclusivity(correlations: FlagCorrelation[], propName: string): number {
    const relevantCorrelations = correlations.filter(c => 
      c.propertyA === propName || c.propertyB === propName
    );

    if (relevantCorrelations.length === 0) return 0.5;

    const exclusiveCount = relevantCorrelations.filter(c => c.relationshipType === 'exclusive').length;
    return exclusiveCount / relevantCorrelations.length;
  }

  private classifyDiscriminantType(prop: PropertyInfo): DiscriminantCandidate['propertyType'] {
    if (prop.type === 'boolean') return 'boolean';
    if (prop.type.includes('literal') || prop.literalValues) return 'string_literal';
    if (prop.type === 'number') return 'numeric_literal';
    return 'enum';
  }

  private inferPossibleValues(prop: PropertyInfo): Array<string | number | boolean> {
    if (prop.literalValues) return prop.literalValues;
    if (prop.type === 'boolean') return [true, false];
    
    // Fallback: generate placeholder values
    return [`${prop.name}_value_1`, `${prop.name}_value_2`];
  }

  private calculateCoverage(variants: DUVariant[], _typeInfo: TypePropertyInfo): CoverageAnalysis {
    const observedTotal = variants.reduce((sum, v) => sum + (v.observedCount || 0), 0);
    const covered = observedTotal; // Simplified: assume all observed cases are covered
    const rate = observedTotal > 0 ? covered / observedTotal : 0;

    return { observedTotal, covered, rate };
  }

  private meetsCoverageThreshold(plan: DUPlan): boolean {
    return plan.coverage.rate >= this.options.minCoverageRate;
  }

  private calculateStatistics(
    plans: DUPlan[],
    correlations: FlagCorrelation[],
    candidates: DiscriminantCandidate[],
    totalTypes: number
  ): DetectionStatistics {
    const flagPropertiesFound = candidates.filter(c => c.propertyType === 'boolean').length;
    const mutualExclusionPatterns = correlations.filter(c => c.relationshipType === 'exclusive').length;
    const viableDiscriminants = candidates.length;
    const avgCoverageRate = plans.length > 0 
      ? plans.reduce((sum, p) => sum + p.coverage.rate, 0) / plans.length 
      : 0;

    return {
      totalTypesAnalyzed: totalTypes,
      flagPropertiesFound,
      mutualExclusionPatterns,
      viableDiscriminants,
      avgCoverageRate
    };
  }

  private generateRecommendations(plans: DUPlan[]): DetectionRecommendations {
    // Sort plans by coverage and risk
    const sortedPlans = plans.sort((a, b) => {
      const scoreA = a.coverage.rate * (a.risk === 'low' ? 1 : a.risk === 'medium' ? 0.7 : 0.3);
      const scoreB = b.coverage.rate * (b.risk === 'low' ? 1 : b.risk === 'medium' ? 0.7 : 0.3);
      return scoreB - scoreA;
    });

    const highPriority = sortedPlans.filter(p => p.risk === 'low' && p.coverage.rate > 0.9).map(p => p.typeName);
    const mediumPriority = sortedPlans.filter(p => p.risk === 'medium' || (p.risk === 'low' && p.coverage.rate <= 0.9)).map(p => p.typeName);
    const lowPriority = sortedPlans.filter(p => p.risk === 'high').map(p => p.typeName);

    const estimatedEffort: DetectionRecommendations['estimatedEffort'] = 
      plans.length <= 3 ? 'low' : 
      plans.length <= 8 ? 'medium' : 'high';

    return {
      highPriority,
      mediumPriority,
      lowPriority,
      implementationOrder: [...highPriority, ...mediumPriority, ...lowPriority],
      estimatedEffort
    };
  }
}