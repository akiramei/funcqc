/**
 * Debug Residue Detection Types
 * 
 * Types for detecting and categorizing debug code residue in TypeScript projects
 */

/**
 * Classification of debug residue findings
 */
export type ResidueKind = 'AutoRemove' | 'NeedsReview' | 'Exempt';

/**
 * Pattern types that can be detected
 */
export type ResiduePattern = 
  | 'debugger'
  | 'console.debug'
  | 'console.trace'
  | 'console.log'
  | 'console.error'
  | 'alert'
  | 'logger.debug'
  | 'process.stdout.write'
  | 'process.stderr.write'
  | 'debug-marker'
  | 'custom';

/**
 * A single debug residue finding
 */
export interface ResidueFinding {
  /** Absolute file path */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Classification of the finding */
  kind: ResidueKind;
  /** Pattern that was detected */
  pattern: ResiduePattern;
  /** Human-readable reason for the classification */
  reason: string;
  /** The actual code snippet */
  code: string;
  /** Optional function display name from funcqc */
  functionDisplayName?: string;
  /** Detailed context when --verbose is used */
  context?: ResidueContext;
}

/**
 * Detailed context for a finding (populated with --verbose/--details)
 */
export interface ResidueContext {
  /** Name of the containing function */
  functionName: string | undefined;
  /** Type of function (async, arrow, method, etc.) */
  functionType: string | undefined;
  /** Name of the containing class, if any */
  className: string | undefined;
  /** Code lines before and after the finding */
  surroundingCode: {
    before: string[];
    after: string[];
  };
  /** Import statements in the file */
  imports: string[];
  /** Available helper functions (logger, notifyUser, etc.) */
  availableHelpers: string[];
  /** Whether the code is inside a try-catch block */
  isInTryCatch: boolean;
  /** Whether the code is inside a conditional */
  isInConditional: boolean;
  /** Whether the code is under NODE_ENV check */
  isUnderNodeEnvGuard: boolean;
  /** Inferred purpose of the function */
  functionPurpose: string | undefined;
  /** Type of file (api-handler, service, util, etc.) */
  fileType: string;
}

/**
 * Configuration for debug residue detection
 */
export interface ResidueDetectionConfig {
  /** Path to TypeScript config file */
  tsconfigPath?: string;
  /** Function names that are exempt from removal */
  exemptFunctionNames?: string[];
  /** Custom patterns to detect as AutoRemove */
  autoRemovePatterns?: string[];
  /** Custom debug markers (e.g., // DEBUG:, // TEMP:) */
  customMarkers?: string[];
  /** Files or patterns to exclude from analysis */
  exclude?: string[];
  /** Logger names to track (winston, pino, etc.) */
  loggerNames?: string[];
}

/**
 * Summary of all findings
 */
export interface ResidueSummary {
  /** Total number of findings */
  total: number;
  /** Number of AutoRemove findings */
  autoRemove: number;
  /** Number of NeedsReview findings */
  needsReview: number;
  /** Number of Exempt findings */
  exempt: number;
  /** Files analyzed */
  filesAnalyzed: number;
  /** Functions analyzed */
  functionsAnalyzed: number;
}

/**
 * Complete residue check result
 */
export interface ResidueCheckResult {
  /** All findings */
  findings: ResidueFinding[];
  /** Summary statistics */
  summary: ResidueSummary;
  /** Configuration used */
  config: ResidueDetectionConfig;
  /** Timestamp of the check */
  timestamp: string;
  /** Version of the detection algorithm */
  version: string;
}

/**
 * Options for AI-optimized output
 */
export interface AIOptimizedOutput {
  /** Version of the output format */
  version: string;
  /** Output mode */
  mode: 'ai-optimized';
  /** Findings with additional AI context */
  findings: AIOptimizedFinding[];
  /** Global project context */
  globalContext: GlobalProjectContext;
}

/**
 * Finding with AI-specific information
 */
export interface AIOptimizedFinding extends ResidueFinding {
  /** Unique identifier for the finding */
  id: string;
  /** Confidence score for the classification */
  confidence: number;
  /** Information needed for taking action */
  actionableInfo?: {
    /** Current code that needs modification */
    currentCode: string;
    /** Available replacement options */
    availableReplacements?: Record<string, ReplacementOption>;
    /** Side effects of removal */
    sideEffects?: SideEffectInfo;
  };
  /** Factors influencing the decision */
  decisionFactors?: DecisionFactors;
  /** Recommended action to take */
  recommendedAction?: RecommendedAction;
}

/**
 * Replacement option for a finding
 */
export interface ReplacementOption {
  /** Whether this replacement is available */
  available: boolean;
  /** Suggested code to replace with */
  suggestedCall: string;
  /** Why this replacement is suggested */
  rationale?: string;
}

/**
 * Information about side effects
 */
export interface SideEffectInfo {
  /** Variables that would become unused */
  unusedVariables: string[];
  /** Whether removal would break the code */
  breakingChanges: boolean;
  /** Impact on tests */
  testImpact: 'none' | 'low' | 'medium' | 'high';
}

/**
 * Decision factors for classification
 */
export interface DecisionFactors {
  /** Probability that this is user-facing */
  isUserFacing: number;
  /** Probability that this is audit logging */
  isAuditLog: number;
  /** Probability that this is debug-only */
  isDebugOnly: number;
  /** Whether this is in production code */
  inProductionCode: boolean;
  /** Whether alternatives exist */
  hasAlternative: boolean;
}

/**
 * Recommended action for a finding
 */
export interface RecommendedAction {
  /** Primary action to take */
  primary: 'remove' | 'replace_with_logger' | 'replace_with_notifier' | 'keep_with_comment' | 'keep';
  /** Fallback if primary fails */
  fallback?: string;
  /** Explanation of the recommendation */
  reasoning: string;
}

/**
 * Global project context for AI
 */
export interface GlobalProjectContext {
  /** Type of project (web-api, cli-tool, library, etc.) */
  projectType: string;
  /** Whether a logger is available */
  hasLogger: boolean;
  /** Whether a notification system exists */
  hasNotificationSystem: boolean;
  /** Logging library in use */
  loggingConvention: string | undefined;
  /** Output conventions in the project */
  outputConvention: {
    userFacing: string[];
    debugging: string[];
    logging: string[];
  } | undefined;
}

/**
 * Command options for residue-check
 */
export interface ResidueCheckOptions {
  /** Output as JSON */
  json?: boolean;
  /** Verbose output with context */
  verbose?: boolean;
  /** Detailed output with full analysis */
  details?: boolean;
  /** AI-optimized output mode */
  aiMode?: boolean;
  /** Path to configuration file */
  config?: string;
  /** Specific path to analyze */
  path?: string;
  /** Fix AutoRemove items automatically */
  fix?: boolean;
  /** Preview fixes without applying */
  previewFixes?: boolean;
  /** Only fix AutoRemove items */
  fixAutoOnly?: boolean;
  /** Interactive mode for NeedsReview */
  interactive?: boolean;
  /** Generate fix script */
  generateFixScript?: boolean;
  /** Quiet mode */
  quiet?: boolean;
}