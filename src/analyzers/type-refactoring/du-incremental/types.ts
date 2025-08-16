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

// =============================================================================
// PHASE 2: TYPE GENERATION TYPES (B1-B3)
// =============================================================================

/**
 * Enhanced DU Plan with type generation information
 */
export interface DUTransformationPlan extends DUPlan {
  // B1: Type Generation Schema
  typeGeneration: TypeGenerationPlan;
  
  // B2: Implementation Steps
  implementationSteps: ImplementationStep[];
  
  // B3: Compatibility & Validation
  compatibilityInfo: CompatibilityInfo;
  
  // Plan metadata
  planVersion: string;
  generatedAt: string;
  estimatedEffort: EffortEstimate;
}

/**
 * B1: Type generation configuration and output
 */
export interface TypeGenerationPlan {
  // Generated TypeScript types
  unionType: GeneratedUnionType;
  smartConstructors: SmartConstructor[];
  typeGuards: TypeGuard[];
  
  // Migration helpers
  migrationTypes: MigrationType[];
  conversionFunctions: ConversionFunction[];
  
  // Validation
  compilationTest: string; // TypeScript code for compilation test
  exampleUsage: string[];  // Usage examples
}

/**
 * Generated discriminated union type definition
 */
export interface GeneratedUnionType {
  typeName: string;
  discriminantProperty: string;
  variants: GeneratedVariant[];
  baseInterface?: string; // Common properties interface
  typeDefinition: string; // Complete TypeScript type definition
}

/**
 * Individual variant in generated union
 */
export interface GeneratedVariant {
  name: string;
  discriminantValue: string | number | boolean;
  properties: VariantProperty[];
  typeDefinition: string; // TypeScript interface for this variant
  documentation?: string;
}

/**
 * Property definition for variant
 */
export interface VariantProperty {
  name: string;
  type: string;
  isRequired: boolean;
  isInherited: boolean; // From base interface
  documentation?: string;
  defaultValue?: string;
}

/**
 * Smart constructor for creating variant instances
 */
export interface SmartConstructor {
  functionName: string;
  variantName: string;
  parameters: ConstructorParameter[];
  returnType: string;
  implementation: string; // TypeScript function implementation
  documentation: string;
}

/**
 * Parameter for smart constructor
 */
export interface ConstructorParameter {
  name: string;
  type: string;
  isOptional: boolean;
  defaultValue?: string;
  documentation?: string;
}

/**
 * Type guard function definition
 */
export interface TypeGuard {
  functionName: string;
  variantName: string;
  implementation: string; // TypeScript function implementation
  returnType: string; // e.g., "obj is SuccessResult"
  documentation: string;
}

/**
 * Migration type for gradual transition
 */
export interface MigrationType {
  name: string;
  purpose: 'legacy-compat' | 'partial-migration' | 'validation';
  typeDefinition: string;
  usage: string; // How to use this migration type
}

/**
 * Conversion function for data migration
 */
export interface ConversionFunction {
  functionName: string;
  fromType: string;
  toType: string;
  implementation: string;
  safetyLevel: 'safe' | 'lossy' | 'validation-required';
  documentation: string;
}

/**
 * B2: Implementation step definition
 */
export interface ImplementationStep {
  stepNumber: number;
  title: string;
  description: string;
  category: 'preparation' | 'type-definition' | 'migration' | 'validation' | 'cleanup';
  
  // What to do
  actions: ImplementationAction[];
  
  // Verification
  successCriteria: string[];
  rollbackInstructions?: string;
  
  // Dependencies
  dependsOn: number[]; // Other step numbers
  estimatedTime: string; // e.g., "15 minutes"
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Individual action within implementation step
 */
export interface ImplementationAction {
  type: 'create-file' | 'modify-file' | 'run-command' | 'manual-check';
  description: string;
  target?: string; // File path or command
  content?: string; // File content or detailed instructions
  automated: boolean; // Can this be automated?
}

/**
 * B3: Compatibility and validation information
 */
export interface CompatibilityInfo {
  // Backward compatibility
  breakingChanges: BreakingChange[];
  migrationRequired: boolean;
  
  // Forward compatibility  
  extensibilityOptions: string[];
  futureConsiderations: string[];
  
  // Validation
  validationRules: ValidationRule[];
  testRequirements: TestRequirement[];
  
  // Risk assessment
  risks: RiskAssessment[];
  mitigations: string[];
}

/**
 * Breaking change description
 */
export interface BreakingChange {
  area: 'type-signature' | 'property-access' | 'function-signature' | 'data-structure';
  description: string;
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
  affectedFiles: string[];
}

/**
 * Validation rule for the transformation
 */
export interface ValidationRule {
  rule: string;
  description: string;
  automated: boolean;
  command?: string; // For automated validation
}

/**
 * Test requirement for the transformation
 */
export interface TestRequirement {
  type: 'unit' | 'integration' | 'compilation' | 'runtime';
  description: string;
  priority: 'critical' | 'important' | 'nice-to-have';
  implementation?: string; // Test code or description
}

/**
 * Risk assessment for transformation
 */
export interface RiskAssessment {
  risk: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
}

/**
 * Effort estimation breakdown
 */
export interface EffortEstimate {
  totalTime: string; // e.g., "2-4 hours"
  complexity: 'simple' | 'moderate' | 'complex';
  skillLevel: 'junior' | 'mid' | 'senior';
  breakdown: {
    planning: string;
    implementation: string;
    testing: string;
    review: string;
  };
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