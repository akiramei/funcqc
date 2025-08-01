/**
 * Architecture configuration types for funcqc
 */

/**
 * Extended layer definition with metadata for AI-assisted refactoring
 */
export interface LayerDefinition {
  /**
   * File patterns for this layer
   */
  patterns: string[];
  
  /**
   * Role and responsibility description for AI understanding
   */
  role?: string;
  
  /**
   * Consolidation strategy for similar functions in this layer
   */
  consolidationStrategy?: 'aggressive' | 'conservative' | 'none';
  
  /**
   * Whether this layer can be a target for consolidation
   */
  consolidationTarget?: boolean;
  
  /**
   * Recommended paths for internal utilities within this layer
   */
  internalUtils?: string[];
  
  /**
   * Patterns that should not be consolidated across layers
   */
  avoidCrossLayerSharing?: string[];
  
  /**
   * Maximum allowed dependencies (layer names)
   */
  maxDependencies?: string[];
}

/**
 * Consolidation strategies for different types of functions
 */
export interface ConsolidationStrategies {
  /**
   * Strategy for global utilities consolidation
   */
  globalUtils?: ConsolidationStrategy;
  
  /**
   * Strategy for layer-specific utilities consolidation
   */
  layerUtils?: ConsolidationStrategy;
  
  /**
   * Strategy for functions that should not be consolidated
   */
  keepInPlace?: ConsolidationStrategy;
}

/**
 * Individual consolidation strategy definition
 */
export interface ConsolidationStrategy {
  /**
   * Target layer or path for consolidation
   */
  target: string;
  
  /**
   * Criteria for applying this strategy
   */
  criteria: string[];
  
  /**
   * Examples of function types that match this strategy
   */
  examples?: string[];
  
  /**
   * Confidence level for automatic application
   */
  confidence?: 'high' | 'medium' | 'low';
}

export interface ArchitectureConfig {
  /**
   * Layer definitions mapping names to file patterns
   */
  layers: Record<string, string[] | LayerDefinition>;
  
  /**
   * Architecture rules defining allowed/forbidden dependencies
   */
  rules: ArchitectureRule[];
  
  /**
   * Global settings for architecture validation
   */
  settings?: ArchitectureSettings;
  
  /**
   * Consolidation strategies for refactoring similar functions
   */
  consolidationStrategies?: ConsolidationStrategies;
}

export interface ArchitectureRule {
  /**
   * Rule type: allow or forbid dependencies
   */
  type: 'allow' | 'forbid';
  
  /**
   * Source layer pattern (supports wildcards)
   */
  from: string | string[];
  
  /**
   * Target layer pattern (supports wildcards)
   */
  to: string | string[];
  
  /**
   * Optional description for this rule
   */
  description?: string;
  
  /**
   * Rule severity level
   */
  severity?: 'error' | 'warning' | 'info';
}

export interface ArchitectureSettings {
  /**
   * Whether to allow dependencies within the same layer
   */
  allowSameLayer?: boolean;
  
  /**
   * Whether to treat missing layer assignments as violations
   */
  strictMode?: boolean;
  
  /**
   * Default severity for rule violations
   */
  defaultSeverity?: 'error' | 'warning' | 'info';
  
  /**
   * Whether to ignore external dependencies (node_modules)
   */
  ignoreExternal?: boolean;
}

export interface LayerAssignment {
  /**
   * Function or file path
   */
  path: string;
  
  /**
   * Assigned layer name
   */
  layer: string;
  
  /**
   * Confidence score (0-1) for layer assignment
   */
  confidence: number;
}

export interface ArchitectureViolation {
  /**
   * Unique violation ID
   */
  id: string;
  
  /**
   * Rule that was violated
   */
  rule: ArchitectureRule;
  
  /**
   * Source function/file that made the violating call
   */
  source: {
    functionId: string;
    functionName: string;
    filePath: string;
    layer: string;
  };
  
  /**
   * Target function/file that was called in violation
   */
  target: {
    functionId: string;
    functionName: string;
    filePath: string;
    layer: string;
  };
  
  /**
   * Violation severity
   */
  severity: 'error' | 'warning' | 'info';
  
  /**
   * Human-readable violation message
   */
  message: string;
  
  /**
   * Additional context about the violation
   */
  context?: {
    callType?: string;
    lineNumber?: number;
    callContext?: string | undefined;
    importType?: string;
  };
}

export interface ArchitectureAnalysisResult {
  /**
   * Summary statistics
   */
  summary: {
    totalFunctions: number;
    totalLayers: number;
    totalRules: number;
    violations: number;
    errorViolations: number;
    warningViolations: number;
    infoViolations: number;
    layerCoverage: number; // Percentage of functions assigned to layers
  };
  
  /**
   * Layer assignments for all functions
   */
  layerAssignments: LayerAssignment[];
  
  /**
   * All detected violations
   */
  violations: ArchitectureViolation[];
  
  /**
   * Architecture health metrics
   */
  metrics: {
    /**
     * Coupling between layers (number of cross-layer calls)
     */
    layerCoupling: Record<string, Record<string, number>>;
    
    /**
     * Layer cohesion metrics
     */
    layerCohesion: Record<string, number>;
    
    /**
     * Dependency depth (maximum call chain across layers)
     */
    dependencyDepth: number;
  };
}

/**
 * Options for architecture validation
 */
export interface ArchitectureValidationOptions {
  /**
   * Configuration file path (defaults to .funcqc-arch.yaml)
   */
  configPath?: string;
  
  /**
   * Include only specific layers in analysis
   */
  includeLayers?: string[];
  
  /**
   * Exclude specific layers from analysis
   */
  excludeLayers?: string[];
  
  /**
   * Minimum severity level to report
   */
  minSeverity?: 'error' | 'warning' | 'info';
  
  /**
   * Maximum number of violations to report
   */
  maxViolations?: number;
  
  /**
   * Whether to include detailed metrics in output
   */
  includeMetrics?: boolean;
}