/**
 * Quality Enhancement Types for funcqc v1.6
 *
 * Enhanced Code Quality Evaluation System with:
 * - Naming Quality Analysis (15% weight)
 * - Type Safety Analysis (15% weight)
 * - AI-collaborative 3-level evaluation system
 */

// =============================================================================
// Naming Quality Analysis Types
// =============================================================================

export interface NamingQualityScore {
  /** Overall naming quality score (0-100) */
  score: number;

  /** Individual component scores */
  components: {
    /** Basic naming rules score (0-100) */
    basicRules: number;
    /** Semantic appropriateness score (0-100) */
    semanticAppropriate: number;
    /** Consistency within file score (0-100) */
    consistency: number;
    /** Redundancy avoidance score (0-100) */
    redundancy: number;
  };

  /** Issues found during analysis */
  issues: NamingIssue[];

  /** Automatic evaluation confidence (0-1) */
  confidence: number;
}

export interface NamingIssue {
  /** Issue type */
  type: 'basic' | 'semantic' | 'consistency' | 'redundancy';

  /** Issue severity */
  severity: 'low' | 'medium' | 'high';

  /** Human-readable description */
  description: string;

  /** Points deducted */
  points: number;

  /** Suggested improvement */
  suggestion?: string;
}

// =============================================================================
// Type Safety Analysis Types
// =============================================================================

export interface TypeSafetyScore {
  /** Overall type safety score (0-100) */
  score: number;

  /** Individual component scores */
  components: {
    /** Any type usage penalty score (0-100) */
    anyTypeUsage: number;
    /** Type annotation completeness score (0-100) */
    typeAnnotation: number;
    /** Type specificity score (0-100) */
    typeSpecificity: number;
    /** Return type explicitness score (0-100) */
    returnTypeExplicit: number;
  };

  /** Issues found during analysis */
  issues: TypeSafetyIssue[];

  /** TypeScript-specific metrics */
  metrics: {
    /** Number of any types used */
    anyTypeCount: number;
    /** Number of untyped parameters */
    untypedParamCount: number;
    /** Has explicit return type */
    hasExplicitReturnType: boolean;
    /** Uses generic object types */
    usesGenericObjectTypes: boolean;
  };
}

export interface TypeSafetyIssue {
  /** Issue type */
  type: 'any-type' | 'missing-annotation' | 'generic-type' | 'implicit-return';

  /** Issue severity */
  severity: 'low' | 'medium' | 'high';

  /** Human-readable description */
  description: string;

  /** Points deducted */
  points: number;

  /** Suggested improvement */
  suggestion?: string;

  /** Location in code */
  location?: string;
}

// =============================================================================
// 3-Level Evaluation System Types
// =============================================================================

export interface NamingEvaluation {
  /** Function identifier */
  functionId: string;

  /** Semantic ID for function content tracking */
  semanticId: string;

  /** Function name being evaluated */
  functionName: string;

  /** Description hash for change detection */
  descriptionHash: string;

  /** Three-level rating (1=Appropriate, 2=Partially Correct, 3=Inappropriate) */
  rating: 1 | 2 | 3;

  /** When evaluation was performed */
  evaluatedAt: number;

  /** Who/what performed the evaluation */
  evaluatedBy: 'human' | 'ai' | 'auto';

  /** Optional issue description */
  issues?: string | undefined;

  /** Optional improvement suggestions */
  suggestions?: string | undefined;

  /** Whether re-evaluation is needed due to changes */
  revisionNeeded: boolean;

  /** AI model used for evaluation (if applicable) */
  aiModel?: string;

  /** Confidence score for AI evaluations (0-1) */
  confidence?: number;
}

export interface EvaluationBatch {
  /** Evaluations to register */
  evaluations: Array<{
    functionId: string;
    rating: 1 | 2 | 3;
    issues?: string;
    suggestions?: string;
  }>;

  /** Batch metadata */
  metadata?: {
    evaluatedBy?: 'human' | 'ai' | 'auto';
    aiModel?: string;
    confidence?: number;
  };
}

// =============================================================================
// Enhanced Quality Scoring Types
// =============================================================================

export interface EnhancedQualityMetrics {
  /** Original quality metrics */
  base: {
    maintainabilityScore: number;
    complexityScore: number;
    sizeScore: number;
  };

  /** New enhanced metrics */
  enhanced: {
    /** Naming quality score (0-100) */
    namingQualityScore: number;
    /** Type safety score (0-100) */
    typeSafetyScore: number;
  };

  /** Composite scores */
  composite: {
    /** Automatic naming quality analysis */
    automaticNaming: number;
    /** Human/AI evaluation-based naming score */
    evaluationNaming: number;
    /** Combined naming score (60% auto + 40% evaluation) */
    finalNaming: number;
  };

  /** Final weighted score */
  final: {
    /** Overall score (0-100) */
    score: number;
    /** Letter grade */
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
  };
}

export interface QualityScoreWeights {
  /** Weight for maintainability score */
  maintainability: number;
  /** Weight for complexity score */
  complexity: number;
  /** Weight for size score */
  size: number;
  /** Weight for naming quality score */
  namingQuality: number;
  /** Weight for type safety score */
  typeSafety: number;
}

/** Default weight distribution for v1.6 */
export const DEFAULT_QUALITY_WEIGHTS: QualityScoreWeights = {
  maintainability: 0.25,
  complexity: 0.25,
  size: 0.2,
  namingQuality: 0.15,
  typeSafety: 0.15,
};

// =============================================================================
// Enhanced Project Quality Assessment
// =============================================================================

export interface EnhancedProjectQualityScore {
  /** Overall project grade */
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';

  /** Overall project score (0-100) */
  score: number;

  /** Individual component scores */
  componentScores: {
    maintainability: number;
    complexity: number;
    size: number;
    namingQuality: number;
    typeSafety: number;
  };

  /** Project statistics */
  statistics: {
    totalFunctions: number;
    highRiskFunctions: number;
    functionsWithEvaluations: number;
    functionsNeedingEvaluation: number;
    averageConfidence: number;
  };

  /** Top problematic functions */
  topProblematicFunctions: Array<{
    name: string;
    filePath: string;
    issues: string[];
    scores: {
      naming: number;
      typeSafety: number;
      complexity: number;
      maintainability: number;
    };
  }>;

  /** Improvement recommendations */
  recommendations: QualityRecommendation[];
}

export interface QualityRecommendation {
  /** Recommendation type */
  type: 'naming' | 'type-safety' | 'complexity' | 'maintainability' | 'size';

  /** Recommendation priority */
  priority: 'high' | 'medium' | 'low';

  /** Number of functions affected */
  affectedFunctions: number;

  /** Human-readable description */
  description: string;

  /** Actionable improvement steps */
  actions: string[];

  /** Expected impact on overall score */
  expectedImpact: number;
}

// =============================================================================
// CLI Command Types
// =============================================================================

export interface EvaluateCommandOptions {
  /** Function ID to evaluate */
  functionId?: string;

  /** Rating (1-3) */
  rating?: string;

  /** Issue description */
  issues?: string;

  /** Improvement suggestions */
  suggestions?: string;

  /** Batch mode */
  batch?: boolean;

  /** Input file for batch mode */
  input?: string;

  /** AI model to use for evaluation */
  aiModel?: string;

  /** Minimum confidence threshold */
  confidence?: string;

  /** Evaluator identifier */
  evaluatedBy?: string;

  /** Output format */
  format?: 'table' | 'json' | 'friendly';
}

export interface ListCommandEnhancements {
  /** Show functions needing evaluation */
  needsEvaluation?: boolean;

  /** Show functions with evaluations */
  hasEvaluation?: boolean;

  /** Filter by evaluation rating */
  rating?: string;

  /** Filter by evaluator */
  evaluatedBy?: string;

  /** Show naming quality scores */
  showNamingScore?: boolean;

  /** Show type safety scores */
  showTypeSafetyScore?: boolean;

  /** Show enhanced quality metrics */
  showEnhancedMetrics?: boolean;
}

// =============================================================================
// Storage Extension Types
// =============================================================================

export interface StorageEnhancements {
  /** Save naming evaluation */
  saveNamingEvaluation(evaluation: NamingEvaluation): Promise<void>;

  /** Get naming evaluation by function ID */
  getNamingEvaluation(functionId: string): Promise<NamingEvaluation | null>;

  /** Get functions needing evaluation */
  getFunctionsNeedingEvaluation(
    snapshotId: string
  ): Promise<Array<{ functionId: string; functionName: string; lastModified: number }>>;

  /** Get functions with evaluations */
  getFunctionsWithEvaluations(
    snapshotId: string
  ): Promise<Array<{ functionId: string; evaluation: NamingEvaluation }>>;

  /** Update evaluation revision status */
  updateEvaluationRevisionStatus(functionId: string, revisionNeeded: boolean): Promise<void>;

  /** Batch save evaluations */
  batchSaveEvaluations(evaluations: NamingEvaluation[]): Promise<void>;

  /** Get evaluation statistics */
  getEvaluationStatistics(snapshotId: string): Promise<{
    total: number;
    withEvaluations: number;
    needingEvaluation: number;
    averageRating: number;
    ratingDistribution: Record<1 | 2 | 3, number>;
  }>;
}

// =============================================================================
// Analysis Result Types
// =============================================================================

export interface NamingAnalysisResult {
  /** Function information */
  functionInfo: {
    id: string;
    name: string;
    displayName: string;
    filePath: string;
    signature: string;
  };

  /** Naming quality analysis */
  namingQuality: NamingQualityScore;

  /** Type safety analysis */
  typeSafety: TypeSafetyScore;

  /** Existing evaluation (if any) */
  existingEvaluation?: NamingEvaluation;

  /** Recommended action */
  recommendedAction: 'no-action' | 'needs-evaluation' | 'needs-re-evaluation';

  /** Analysis confidence */
  confidence: number;
}

export interface BatchAnalysisResult {
  /** Individual analysis results */
  results: NamingAnalysisResult[];

  /** Overall statistics */
  statistics: {
    analyzed: number;
    needingEvaluation: number;
    highConfidence: number;
    averageNamingScore: number;
    averageTypeSafetyScore: number;
  };

  /** Processing metadata */
  metadata: {
    timestamp: number;
    processingTime: number;
    version: string;
  };
}
