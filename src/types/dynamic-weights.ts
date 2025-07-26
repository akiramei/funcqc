/**
 * Dynamic Weight System - Phase 1 Implementation
 * 
 * This module provides dynamic weight calculation for function quality evaluation,
 * adapting thresholds based on project characteristics and function context.
 */

/**
 * Evaluation modes for quality assessment
 */
export type EvaluationMode = 'static' | 'dynamic';

/**
 * Project characteristics that influence weight calculations
 */
export interface DynamicWeightConfig {
  /** Total number of functions in the project */
  projectSize: number;
  
  /** Architecture pattern detection result */
  architecturePattern: 'MVC' | 'Microservices' | 'Layered' | 'Unknown';
  
  /** Domain complexity level (manual configuration or auto-detected) */
  domainComplexity: 'High' | 'Medium' | 'Low';
  
  /** Team experience level (affects tolerance levels) */
  teamExperience: 'Senior' | 'Mixed' | 'Junior';
  
  /** Evaluation mode selection */
  mode: EvaluationMode;
  
  /** Phase 2: Total number of source files */
  fileCount?: number;
  
  /** Phase 2: Maximum directory depth for structure complexity */
  maxDirectoryDepth?: number;
  
  /** Phase 2: Average functions per file ratio */
  avgFunctionsPerFile?: number;
}

/**
 * Architectural layers for function classification
 */
export type ArchitecturalLayer = 
  | 'presentation'    // Controllers, UI components, API endpoints
  | 'business'        // Domain logic, services, use cases
  | 'data'           // Repositories, DAOs, database access
  | 'utility'        // Helper functions, common utilities
  | 'infrastructure' // Configuration, logging, framework code
  | 'unknown';       // Cannot be classified

/**
 * Function role classification based on usage patterns
 */
export type FunctionRole = 
  | 'core'     // Central business logic functions
  | 'support'  // Supporting functions with moderate coupling
  | 'utility'  // Low-coupling utility functions
  | 'facade'   // High fan-out coordination functions
  | 'unknown'; // Cannot be classified

/**
 * Business criticality level
 */
export type CriticalityLevel = 'Critical' | 'Important' | 'Normal' | 'Low';

/**
 * Context information for a function used in weight calculation
 */
export interface FunctionContext {
  /** Function unique identifier */
  functionId: string;
  
  /** Detected architectural layer */
  layer: ArchitecturalLayer;
  
  /** Function role based on coupling patterns */
  role: FunctionRole;
  
  /** Business criticality (from JSDoc annotations or configuration) */
  criticality: CriticalityLevel;
  
  /** File path for layer detection */
  filePath: string;
  
  /** Fan-in metric */
  fanIn: number;
  
  /** Fan-out metric */
  fanOut: number;
  
  /** Change frequency (for future phases) */
  churnRate?: number;
  
  /** Stability index (for future phases) */
  stabilityIndex?: number;
}

/**
 * Weight calculation result with breakdown for transparency
 */
export interface WeightCalculationResult {
  /** Final calculated weight multiplier */
  finalWeight: number;
  
  /** Base metric value before weight application */
  baseMetric: number;
  
  /** Final weighted metric value */
  weightedMetric: number;
  
  /** Breakdown of weight contributions for explain functionality */
  breakdown: WeightBreakdown;
  
  /** Whether this result used dynamic weighting */
  isDynamic: boolean;
}

/**
 * Detailed breakdown of weight calculation for transparency
 */
export interface WeightBreakdown {
  /** Project size contribution to weight */
  projectSizeWeight: number;
  
  /** Architectural layer contribution */
  layerWeight: number;
  
  /** Function role contribution */
  roleWeight: number;
  
  /** Criticality level contribution */
  criticalityWeight: number;
  
  /** Domain complexity contribution */
  domainWeight: number;
  
  /** List of applied rules with explanations */
  appliedRules: Array<{
    rule: string;
    multiplier: number;
    reason: string;
  }>;
}

/**
 * Dynamic threshold configuration for different metrics
 */
export interface DynamicThresholds {
  /** Hub function threshold (fan-in based) */
  hubThreshold: number;
  
  /** Utility function threshold (fan-out based) */
  utilityThreshold: number;
  
  /** Cyclomatic complexity threshold */
  complexityThreshold: number;
  
  /** Lines of code threshold */
  locThreshold: number;
  
  /** Cognitive complexity threshold */
  cognitiveComplexityThreshold: number;
}

/**
 * Options for dynamic weight calculation
 */
export interface DynamicWeightOptions {
  /** Configuration for dynamic weights */
  config: DynamicWeightConfig;
  
  /** Enable detailed explanation output */
  enableExplanation?: boolean;
  
  /** Custom weight multipliers for fine-tuning */
  customMultipliers?: Partial<{
    projectSize: number;
    layer: number;
    role: number;
    criticality: number;
    domain: number;
  }>;
  
  /** Weight value bounds to prevent extreme values */
  weightBounds?: {
    min: number;
    max: number;
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_DYNAMIC_CONFIG: DynamicWeightConfig = {
  projectSize: 1000,
  architecturePattern: 'Unknown',
  domainComplexity: 'Medium',
  teamExperience: 'Mixed',
  mode: 'static'
};

/**
 * Default weight bounds
 */
export const DEFAULT_WEIGHT_BOUNDS = {
  min: 0.5,
  max: 1.5
};