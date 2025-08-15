/**
 * Discriminated Union Incremental Analysis Types
 * 
 * Core types for the step-by-step DU transformation approach.
 * These types define the DU Plan format and analysis results.
 */

/**
 * Main DU Plan structure - the single source of truth for DU transformation
 */
export interface DUPlan {
  typeName: string;
  discriminant: string;
  variants: DUVariant[];
  coverage: CoverageAnalysis;
  risk?: 'low' | 'medium' | 'high';
  refs?: ReferenceAnalysis;
  timestamp: string;
  snapshotId?: string | undefined;
}

/**
 * Individual variant in the discriminated union
 */
export interface DUVariant {
  tag: string | number | boolean;
  when: VariantCondition;
  required: string[];
  forbidden?: string[];
  observedCount?: number;
}

/**
 * Condition that defines when this variant applies
 */
export interface VariantCondition {
  eq?: string | number | boolean;
  oneOf?: Array<string | number | boolean>;
  exists?: string[];
}

/**
 * Coverage analysis - how well the DU covers observed cases
 */
export interface CoverageAnalysis {
  observedTotal: number;
  covered: number;
  rate: number; // 0.0 - 1.0
}

/**
 * Reference analysis - impact estimation for transformation
 */
export interface ReferenceAnalysis {
  files: number;
  callsites: number;
  switchStatements: number;
  conditionalChecks: number;
}

/**
 * Flag correlation analysis result
 */
export interface FlagCorrelation {
  propertyA: string;
  propertyB: string;
  cooccurrenceCount: number;
  totalCount: number;
  phiCoefficient: number; // φ係数 (-1 to 1)
  jaccardIndex: number;   // Jaccard係数 (0 to 1)
  relationshipType: 'exclusive' | 'correlated' | 'independent';
}

/**
 * Discriminant candidate analysis
 */
export interface DiscriminantCandidate {
  propertyName: string;
  propertyType: 'boolean' | 'string_literal' | 'numeric_literal' | 'enum';
  possibleValues: Array<string | number | boolean>;
  usageFrequency: number; // 0.0 - 1.0
  mutualExclusivity: number; // 0.0 - 1.0
  correlatedProperties: string[];
  typeOccurrences: Map<string, number>; // typeName -> count
}

/**
 * Detection analysis result
 */
export interface DetectionResult {
  candidates: DUPlan[];
  flagCorrelations: FlagCorrelation[];
  discriminantCandidates: DiscriminantCandidate[];
  statistics: DetectionStatistics;
  recommendations: DetectionRecommendations;
}

/**
 * Detection statistics
 */
export interface DetectionStatistics {
  totalTypesAnalyzed: number;
  flagPropertiesFound: number;
  mutualExclusionPatterns: number;
  viableDiscriminants: number;
  avgCoverageRate: number;
}

/**
 * Detection recommendations
 */
export interface DetectionRecommendations {
  highPriority: string[]; // Type names with high DU potential
  mediumPriority: string[]; // Type names with medium DU potential
  lowPriority: string[]; // Type names with low DU potential
  implementationOrder: string[]; // Suggested order for implementation
  estimatedEffort: 'low' | 'medium' | 'high';
}

/**
 * Type property information for analysis
 */
export interface TypePropertyInfo {
  typeName: string;
  typeId: string;
  filePath: string;
  properties: PropertyInfo[];
}

/**
 * Property information within a type
 */
export interface PropertyInfo {
  name: string;
  type: string;
  isOptional: boolean;
  isLiteral: boolean;
  literalValues?: Array<string | number | boolean> | undefined;
}

/**
 * Detection options for configuring the analysis
 */
export interface DetectionOptions {
  minCoverageRate: number; // Minimum coverage rate to consider viable (default: 0.8)
  minMutualExclusivity: number; // Minimum mutual exclusivity score (default: 0.7)
  minUsageFrequency: number; // Minimum usage frequency for discriminant (default: 0.3)
  maxVariants: number; // Maximum number of variants (default: 8)
  minVariants: number; // Minimum number of variants (default: 2)
  includeRiskAssessment: boolean; // Include risk assessment in analysis (default: true)
  includeReferenceAnalysis: boolean; // Include reference counting (default: true)
  excludeCommonProperties: string[]; // Properties to exclude from analysis
}

/**
 * Analysis phase enumeration
 */
export enum AnalysisPhase {
  DETECTION = 'detection',
  PLANNING = 'planning', 
  GENERATION = 'generation',
  MIGRATION = 'migration',
  TRANSFORMATION = 'transformation'
}

/**
 * Analysis result wrapper with phase information
 */
export interface PhaseResult<T> {
  phase: AnalysisPhase;
  success: boolean;
  result?: T;
  errors: string[];
  warnings: string[];
  duration: number;
}