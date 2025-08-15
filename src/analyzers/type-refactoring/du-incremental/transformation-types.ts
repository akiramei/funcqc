/**
 * Phase 4: Call-site Transformation Types
 * 
 * Types for detecting and transforming existing code to use DU patterns
 */

/**
 * Usage pattern found in existing code
 */
export interface UsagePattern {
  patternType: 'property-check' | 'ternary-operator' | 'switch-statement' | 'property-access';
  location: CodeLocation;
  originalCode: string;
  discriminantProperty: string;
  discriminantValue?: string | number | boolean;
  confidence: number; // 0.0 - 1.0
}

/**
 * Location of code in source files
 */
export interface CodeLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

/**
 * Transformation plan for a specific usage pattern
 */
export interface TransformationPlan {
  pattern: UsagePattern;
  targetType: string;
  transformationType: 'add-type-guard' | 'replace-property-check' | 'add-smart-constructor';
  newCode: string;
  dependencies: string[]; // Required imports/helpers
  riskLevel: 'low' | 'medium' | 'high';
  validationSteps: ValidationStep[];
}

/**
 * Step to validate transformation correctness
 */
export interface ValidationStep {
  type: 'type-check' | 'test-run' | 'manual-review';
  description: string;
  automated: boolean;
  command?: string;
}

/**
 * Result of applying transformations
 */
export interface TransformationResult {
  success: boolean;
  transformationsApplied: number;
  filesModified: string[];
  errors: TransformationError[];
  warnings: string[];
  validationResults: ValidationResult[];
}

/**
 * Error during transformation
 */
export interface TransformationError {
  pattern: UsagePattern;
  error: string;
  suggestion?: string;
}

/**
 * Result of validation step
 */
export interface ValidationResult {
  step: ValidationStep;
  passed: boolean;
  details?: string;
}

/**
 * Options for transformation process
 */
export interface TransformationOptions {
  // Safety settings
  dryRun: boolean;
  backupFiles: boolean;
  validateBeforeApply: boolean;
  
  // Scope control
  targetFiles?: string[];
  excludeFiles?: string[];
  maxTransformationsPerFile?: number;
  
  // Quality thresholds
  minConfidence: number; // 0.0 - 1.0
  allowHighRiskTransformations: boolean;
  
  // Output preferences
  generateReport: boolean;
  verboseLogging: boolean;
}

/**
 * Analysis result for call-site transformation
 */
export interface CallSiteAnalysis {
  typeName: string;
  usagePatterns: UsagePattern[];
  transformationPlans: TransformationPlan[];
  summary: {
    totalPatterns: number;
    safeTransformations: number;
    riskyTransformations: number;
    estimatedEffort: string;
  };
}