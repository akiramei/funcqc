// Re-export common types
export * from './common';

// Re-export quality enhancement types
export * from './quality-enhancements';

// Re-export architecture types
export * from './architecture';

// Re-export dynamic weights types
export * from './dynamic-weights';

import { NamingEvaluation } from './quality-enhancements';
import { QualityAssessment, MultipleQualityAssessment } from '../core/realtime-quality-gate.js';

// Core configuration types
export interface FuncqcConfig {
  // Legacy support - will be deprecated in favor of scopes
  roots: string[];
  exclude: string[];
  include?: string[];
  
  // New scope-based configuration
  defaultScope?: string;
  globalExclude?: string[];
  
  // スコープ設定: 複数のスコープを定義可能
  scopes?: {
    [scopeName: string]: {
      roots: string[];
      exclude?: string[];
      include?: string[];
      description?: string;
    };
  };

  storage: {
    type: 'pglite' | 'postgres';
    path?: string;
    url?: string;
  };

  metrics: {
    complexityThreshold: number;
    cognitiveComplexityThreshold: number;
    linesOfCodeThreshold: number;
    parameterCountThreshold: number;
    maxNestingLevelThreshold: number;
  };

  // Enhanced configurable thresholds system
  thresholds?: QualityThresholds;

  // Enhanced funcqc-specific thresholds (new)
  funcqcThresholds?: Partial<FuncqcThresholds>;

  // Risk assessment configuration
  assessment?: RiskAssessmentConfig;

  // Project context for statistical evaluation
  projectContext?: ProjectContext;

  git: {
    enabled: boolean;
    autoLabel: boolean;
  };

  similarity?: {
    detectors: Record<string, SimilarityDetectorConfig>;
    consensus: ConsensusStrategy;
    defaultThreshold?: number;
  };

  ann?: {
    algorithm?: 'hierarchical' | 'lsh' | 'hybrid';
    clusterCount?: number;
    hashBits?: number;
    approximationLevel?: 'fast' | 'balanced' | 'accurate';
    cacheSize?: number;
  };

  changeDetection?: {
    // Thresholds for determining change significance
    locChangeThreshold?: number; // Default: 0.5 (50% change)
    complexityChangeThreshold?: number; // Default: 5 (CC points)
    depthChangeThreshold?: number; // Default: 2 levels
    parameterChangeThreshold?: number; // Default: 2 parameters

    // Weights for calculating composite score
    locWeight?: number; // Default: 0.3
    complexityWeight?: number; // Default: 0.4
    depthWeight?: number; // Default: 0.2
    parameterWeight?: number; // Default: 0.1

    // Enable/disable specific detectors
    enableFunctionSplitDetection?: boolean; // Default: true
  };
}

export interface SimilarityDetectorConfig {
  enabled: boolean;
  threshold: number;
  weights?: SimilarityWeights;
  options?: Record<string, unknown>;
}

export interface SimilarityWeights {
  astStructure?: number; // Default: 0.4
  signature?: number; // Default: 0.2
  metrics?: number; // Default: 0.2
  parameters?: number; // Default: 0.1
  returnType?: number; // Default: 0.1
}

export interface ConsensusStrategy {
  strategy: 'majority' | 'intersection' | 'union' | 'weighted';
  weightings?: Record<string, number>;
  threshold?: number;
}

// Function analysis types
export interface FunctionInfo {
  // 物理識別次元
  id: string; // Physical UUID（物理的実体の一意識別）
  startLine: number; // ファイル内開始行
  endLine: number; // ファイル内終了行
  startColumn: number; // ファイル内開始列
  endColumn: number; // ファイル内終了列
  positionId?: string; // Position-based hash（文字オフセット識別）

  // 意味識別次元
  semanticId: string; // Semantic hash（役割ベース識別）
  name: string; // 関数名
  displayName: string; // 表示用名前（クラス.メソッド等）
  signature: string; // 完全なシグネチャ
  filePath: string; // プロジェクトルートからの相対パス
  contextPath?: string[]; // 階層コンテキスト ['Class', 'method']
  functionType?: 'function' | 'method' | 'arrow' | 'local';
  modifiers?: string[]; // ['static', 'private', 'async']
  nestingLevel?: number; // ネスト深度
  className?: string; // クラス名（メソッドやコンストラクタの場合）

  // 関数属性（意味ベース）
  isExported: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  isArrowFunction: boolean;
  isMethod: boolean;
  isConstructor: boolean;
  isStatic: boolean;
  accessModifier?: 'public' | 'private' | 'protected';

  // 内容識別次元
  contentId: string; // Content hash（実装内容識別）
  astHash: string; // AST構造のハッシュ
  sourceCode?: string; // 関数のソースコード（廃止予定）
  signatureHash: string; // シグネチャのハッシュ

  // 効率化用フィールド
  fileHash: string; // ファイル内容のハッシュ
  fileContentHash?: string; // ファイル変更検出高速化用
  
  // File relationship (New)
  sourceFileId?: string; // Reference to source_files table

  // ドキュメント
  jsDoc?: string; // JSDocコメント
  description?: string; // ユーザー説明（function_descriptionsテーブルから）

  // 説明メタデータ
  descriptionSource?: string; // 説明のソース（human/ai/jsdoc）
  descriptionCreatedAt?: string; // 説明作成日時
  descriptionUpdatedAt?: string; // 説明更新日時
  descriptionAiModel?: string; // AIモデル名（source=aiの場合）

  // Relations
  parameters: ParameterInfo[];
  returnType?: ReturnTypeInfo;
  metrics?: QualityMetrics;
  dependencies?: DependencyInfo[];
}

// Source File types for enhanced analysis capabilities
export interface SourceFile {
  id: string; // File ID (UUID)
  snapshotId: string; // Snapshot this file belongs to
  filePath: string; // Relative path from project root
  fileContent: string; // Complete file source code
  fileHash: string; // Content hash for deduplication
  encoding: string; // File encoding
  fileSizeBytes: number; // Content size in bytes
  lineCount: number; // Total lines in file
  language: string; // Detected language (typescript, javascript, etc)
  functionCount: number; // Number of functions in this file
  exportCount: number; // Number of exports
  importCount: number; // Number of imports
  fileModifiedTime?: Date; // Original file modification time
  createdAt: Date; // Database creation timestamp
}

// New interfaces for N:1 design
export interface SourceContent {
  id: string; // Content ID: "${fileHash}_${fileSizeBytes}"
  content: string; // Complete file source code
  fileHash: string; // SHA-256 hash of content
  fileSizeBytes: number; // Content size in bytes
  lineCount: number; // Total lines in content
  language: string; // Detected language
  encoding: string; // File encoding
  exportCount: number; // Number of exports
  importCount: number; // Number of imports
  createdAt: Date; // Database creation timestamp
}

export interface SourceFileRef {
  id: string; // Reference ID (UUID)
  snapshotId: string; // Snapshot this reference belongs to
  filePath: string; // Relative path from project root
  contentId: string; // Reference to source_contents
  fileModifiedTime?: Date; // Original file modification time
  functionCount: number; // Number of functions in this file for this snapshot
  createdAt: Date; // Database creation timestamp
}

export interface ParameterInfo {
  name: string;
  type: string;
  typeSimple: string;
  position: number;
  isOptional: boolean;
  isRest: boolean;
  defaultValue?: string;
  description?: string;
}

export interface CallEdge {
  id: string;
  callerFunctionId: string;
  calleeFunctionId?: string | undefined;
  calleeName: string;
  calleeSignature?: string | undefined;
  callerClassName?: string | undefined;
  calleeClassName?: string | undefined;
  callType: 'direct' | 'conditional' | 'async' | 'external' | 'dynamic' | 'virtual';
  callContext?: string | undefined;
  lineNumber: number;
  columnNumber: number;
  isAsync: boolean;
  isChained: boolean;
  confidenceScore: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  
  // Extensions for ideal call graph system
  calleeCandidates?: string[]; // Function IDs of potential targets when calleeFunctionId is unresolved
  resolutionLevel?: 'local_exact' | 'import_exact' | 'cha_resolved' | 'rta_resolved' | 'runtime_confirmed' | 'external_detected' | 'callback_registration' | 'unresolved';
  resolutionSource?: string; // Module or file where the target was found
  runtimeConfirmed?: boolean; // Whether edge is confirmed by runtime traces
}

export interface InternalCallEdge {
  id: string;
  snapshotId: string;
  filePath: string;
  callerFunctionId: string;
  calleeFunctionId: string;
  callerName: string;
  calleeName: string;
  callerClassName?: string | undefined;
  calleeClassName?: string | undefined;
  lineNumber: number;
  columnNumber: number;
  callType: 'direct' | 'conditional' | 'async' | 'dynamic';
  callContext?: string | undefined;
  confidenceScore: number;
  detectedBy: 'ast' | 'ideal_call_graph';
  createdAt: string;
}

export interface ReturnTypeInfo {
  type: string;
  typeSimple: string;
  isPromise: boolean;
  promiseType?: string;
  description?: string;
}

export interface QualityMetrics {
  linesOfCode: number;
  totalLines: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  maxNestingLevel: number;
  parameterCount: number;
  returnStatementCount: number;
  branchCount: number;
  loopCount: number;
  tryCatchCount: number;
  asyncAwaitCount: number;
  callbackCount: number;
  commentLines: number;
  codeToCommentRatio: number;
  halsteadVolume?: number;
  halsteadDifficulty?: number;
  maintainabilityIndex?: number;
}

export interface DependencyInfo {
  id: string;
  functionId: string;
  dependencyType: 'import' | 'call' | 'inherit';
  targetName: string;
  targetFile?: string;
  targetModule?: string;
  isExternal: boolean;
  usageCount: number;
}


// Snapshot and versioning types
export interface SnapshotInfo {
  id: string;
  createdAt: number;
  label?: string;
  comment?: string;
  gitCommit?: string;
  gitBranch?: string;
  gitTag?: string;
  projectRoot: string;
  configHash: string;
  scope: string;  // スコープ識別子 ('src', 'test', 'all', etc.)
  metadata: SnapshotMetadata;
  analysisLevel?: 'NONE' | 'BASIC' | 'CALL_GRAPH';
  basicAnalysisCompleted?: boolean;
  callGraphAnalysisCompleted?: boolean;
}

export interface SnapshotMetadata {
  totalFunctions: number;
  totalFiles: number;
  avgComplexity: number;
  maxComplexity: number;
  exportedFunctions: number;
  asyncFunctions: number;
  complexityDistribution: Record<number, number>;
  fileExtensions: Record<string, number>;
}

// Query and filtering types
export interface QueryFilter {
  field: string;
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN' | 'KEYWORD';
  value: unknown;
}

export interface QueryOptions {
  filters?: QueryFilter[];
  sort?: string;
  limit?: number;
  offset?: number;
  fields?: string[];
  includeFullData?: boolean;  // For performance optimization
  scope?: string;  // Filter by scope (src, test, all, or custom scope)
}

// Analysis and comparison types
export interface SnapshotDiff {
  from: SnapshotInfo;
  to: SnapshotInfo;
  added: FunctionInfo[];
  removed: FunctionInfo[];
  modified: FunctionChange[];
  unchanged: FunctionInfo[];
  statistics: DiffStatistics;
}

export interface FunctionChange {
  before: FunctionInfo;
  after: FunctionInfo;
  changes: ChangeDetail[];
}

export interface ChangeDetail {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  impact: 'low' | 'medium' | 'high';
}

export interface DiffStatistics {
  totalChanges: number;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  complexityChange: number;
  linesChange: number;
}

// Error handling types
export interface FuncqcError extends Error {
  code: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  recoveryActions?: string[];
  originalError?: Error;
}

export interface AnalysisResult<T> {
  success: boolean;
  data?: T;
  errors: FuncqcError[];
  warnings: string[];
}

// CLI types
export interface CommandOptions {
  config?: string;
  noConfig?: boolean;
  cwd?: string;
  verbose?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

export interface InitCommandOptions extends CommandOptions {
  root?: string;
  exclude?: string;
  db?: string;
  show?: boolean;
  reset?: boolean;
  force?: boolean;
}

export interface ScanCommandOptions extends CommandOptions {
  label?: string;
  comment?: string;
  scope?: string; // Scan specific scope (src, test, all, or custom scope)
  realtimeGate?: boolean; // Enable real-time quality gate with adaptive thresholds
  json?: boolean;
  force?: boolean;
  skipBasicAnalysis?: boolean; // Skip basic analysis for fast scan
}

export interface ListCommandOptions extends CommandOptions {
  json?: boolean; // JSON output for jq/script processing
  limit?: string;
  sort?: string;
  desc?: boolean;
  ccGe?: string;
  file?: string;
  name?: string;
  scope?: string; // Filter by scope (src, test, all, or custom scope)
}

export interface ShowCommandOptions extends CommandOptions {
  id?: string;
  json?: boolean; // JSON output for jq/script processing
  usage?: boolean; // Show usage information, examples, error handling, side effects
  current?: boolean; // Show current quality metrics and analysis (default when no options specified)
  history?: boolean; // Show historical metrics and changes for this function
  source?: boolean; // Show source code (combinable with other options)
}

export interface FilesCommandOptions extends CommandOptions {
  json?: boolean; // JSON output for jq/script processing
  limit?: string;
  sort?: string;
  desc?: boolean;
  language?: string;
  path?: string;
  snapshot?: string;
  stats?: boolean;
}

export interface HealthCommandOptions extends CommandOptions {
  trend?: boolean;
  risks?: boolean; // Show detailed risk assessment
  showConfig?: boolean;
  verbose?: boolean;
  json?: boolean; // JSON output for jq/script processing
  quiet?: boolean;  // Ensure BaseCommandOptions compatibility
  period?: string;
  aiOptimized?: boolean; // Deprecated: use json instead
  snapshot?: string; // Snapshot ID/identifier for historical health analysis
  diff?: string | boolean; // Compare snapshots: true (latest-prev), string (snapshot ID), or "id1 id2"
  scope?: string; // Analyze specific scope (src, test, all, or custom scope)
  mode?: 'static' | 'dynamic'; // Evaluation mode for dynamic weight calculation
  explainWeight?: string; // Function ID to explain weight calculation for
}

export interface HistoryCommandOptions extends CommandOptions {
  verbose?: boolean;
  since?: string;
  until?: string;
  limit?: string;
  author?: string;
  branch?: string;
  label?: string;
  scope?: string;
  json?: boolean;
}

export interface EvaluateCommandOptions extends CommandOptions {
  stdin?: boolean; // Read code from stdin
  aiGenerated?: boolean; // Code is AI-generated (affects exit codes)
  strict?: boolean; // Strict mode for critical violations
  json?: boolean; // JSON output for integration
  evaluateAll?: boolean; // Evaluate all functions in the file/code
}


export interface DbCommandOptions extends CommandOptions {
  table?: string; // Table name to query
  limit?: string; // Limit number of rows
  limitAll?: boolean; // Get all rows (no limit)
  where?: string; // Simple WHERE condition
  columns?: string; // Columns to select (comma-separated)
  json?: boolean; // JSON output
  list?: boolean; // List all tables
}

// Additional type definitions for CLI components
export interface CliComponents {
  analyzer: { 
    analyzeFile(file: string): Promise<FunctionInfo[]>;
    analyzeFileWithCallGraph?(file: string): Promise<{ functions: FunctionInfo[]; callEdges: CallEdge[] }>;
    analyzeContent(content: string, virtualPath: string): Promise<FunctionInfo[]>;
    cleanup?(): Promise<void>;
  };
  storage: StorageAdapter;
  qualityCalculator: { calculate(func: FunctionInfo): QualityMetrics };
  optimalConfig: import('../utils/system-resource-manager').OptimalConfig;
  memoryMonitor?: NodeJS.Timeout;
  monitoringTimeout?: NodeJS.Timeout;
}

export interface FunctionChangeImproved {
  after: FunctionInfo;
  changes: ChangeDetail[];
}

export interface FunctionChangeDegraded {
  after: FunctionInfo;
  changes: ChangeDetail[];
}

export interface TopFunctionChanges {
  improved: FunctionChangeImproved[];
  degraded: FunctionChangeDegraded[];
}

export interface TrendDataSnapshot {
  complexityChange: number;
  functionChange: number;
}

// Use ora's official type definition for better compatibility
export type SpinnerInterface = ReturnType<typeof import('ora').default>;

// Storage adapter interface
export interface StorageAdapter {
  init(): Promise<void>;
  close(): Promise<void>;

  // Snapshot operations
  saveSnapshot(
    functions: FunctionInfo[],
    label?: string,
    comment?: string,
    configHash?: string
  ): Promise<string>;
  createSnapshot(options: { label?: string; comment?: string; analysisLevel?: string; scope?: string; configHash?: string }): Promise<string>;
  updateAnalysisLevel(snapshotId: string, level: 'NONE' | 'BASIC' | 'CALL_GRAPH'): Promise<void>;
  getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]>;
  getSnapshot(id: string): Promise<SnapshotInfo | null>;
  deleteSnapshot(id: string): Promise<boolean>;
  getLastConfigHash?(): Promise<string | null>;

  // Function operations - new find methods with consistent naming
  findFunction(functionId: string): Promise<FunctionInfo | null>;
  findFunctionsInSnapshot(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]>;
  findFunctions(options?: QueryOptions): Promise<FunctionInfo[]>;
  getFunctionsBatch(functionIds: string[]): Promise<Map<string, FunctionInfo>>;
  storeFunctions(functions: FunctionInfo[], snapshotId: string): Promise<void>;
  getFunctionsWithDescriptions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]>;
  getFunctionsWithoutDescriptions(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<FunctionInfo[]>;
  getFunctionsNeedingDescriptions(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<FunctionInfo[]>;

  // Function description operations
  saveFunctionDescription(description: FunctionDescription): Promise<void>;
  getFunctionDescription(semanticId: string): Promise<FunctionDescription | null>;
  searchFunctionsByDescription(keyword: string, options?: QueryOptions): Promise<FunctionInfo[]>;


  // Naming evaluation operations (v1.6 enhancement)
  saveNamingEvaluation(evaluation: NamingEvaluation): Promise<void>;
  getNamingEvaluation(functionId: string): Promise<NamingEvaluation | null>;
  getFunctionsNeedingEvaluation(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<Array<{ functionId: string; functionName: string; lastModified: number }>>;
  getFunctionsWithEvaluations(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<Array<{ functionId: string; evaluation: NamingEvaluation }>>;
  updateEvaluationRevisionStatus(functionId: string, revisionNeeded: boolean): Promise<void>;
  batchSaveEvaluations(evaluations: NamingEvaluation[]): Promise<void>;
  getEvaluationStatistics(snapshotId: string): Promise<{
    total: number;
    withEvaluations: number;
    needingEvaluation: number;
    averageRating: number;
    ratingDistribution: Record<1 | 2 | 3, number>;
  }>;

  // Analysis operations
  diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff>;


  // Helper methods for snapshot queries
  getFunctionsBySnapshotId(snapshotId: string): Promise<FunctionInfo[]>;

  // Source file operations (new)
  saveSourceFiles(sourceFiles: SourceFile[], snapshotId: string): Promise<Map<string, string>>;
  getSourceFile(id: string): Promise<SourceFile | null>;
  getSourceFilesBySnapshot(snapshotId: string): Promise<SourceFile[]>;
  getSourceFileByPath(filePath: string, snapshotId: string): Promise<SourceFile | null>;
  findExistingSourceFile(compositeId: string): Promise<string | null>;
  deleteSourceFiles(snapshotId: string): Promise<number>;
  updateSourceFileFunctionCounts(functionCountByFile: Map<string, number>, snapshotId: string): Promise<void>;

  // Function source code extraction
  extractFunctionSourceCode(functionId: string): Promise<string | null>;

  // Call edge operations
  insertCallEdges(edges: CallEdge[], snapshotId: string): Promise<void>;
  getCallEdges(options?: {
    snapshotId?: string;
    callerFunctionId?: string;
    calleeFunctionId?: string;
    calleeName?: string;
    callType?: string;
    limit?: number;
    offset?: number;
  }): Promise<CallEdge[]>;
  getCallEdgesByCaller(callerFunctionId: string, snapshotId: string): Promise<CallEdge[]>;
  getCallEdgesByCallee(calleeFunctionId: string, snapshotId: string): Promise<CallEdge[]>;
  getCallEdgesBySnapshot(snapshotId: string): Promise<CallEdge[]>;
  getInternalCallEdgesBySnapshot(snapshotId: string): Promise<InternalCallEdge[]>;
  deleteCallEdges(functionIds: string[]): Promise<void>;

  // Internal call edge operations (for safe-delete analysis)
  insertInternalCallEdges(edges: InternalCallEdge[]): Promise<void>;
  getInternalCallEdges(filePath: string, snapshotId: string): Promise<InternalCallEdge[]>;
  getInternalCalleesByFunction(callerFunctionId: string, snapshotId: string): Promise<string[]>;
  isInternalFunctionCalled(calleeFunctionId: string, snapshotId: string): Promise<boolean>;

  // Maintenance operations
  cleanup(retentionDays: number): Promise<number>;
  backup(options: BackupOptions): Promise<string>;
  restore(backupData: string): Promise<void>;
}

export interface BackupOptions {
  format: 'sql' | 'json';
  includeSourceCode?: boolean;
  compress?: boolean;
  filters?: QueryFilter[];
}

// Similarity detection types (for future phases)
export interface SimilarityDetector {
  name: string;
  version: string;
  supportedLanguages: string[];
  detect(functions: FunctionInfo[], options: SimilarityOptions, signal?: AbortSignal): Promise<SimilarityResult[]>;
  isAvailable(): Promise<boolean>;
}

export interface SimilarityOptions {
  threshold?: number;
  minLines?: number;
  crossFile?: boolean;
  printCode?: boolean;
  
  
  // Advanced similarity detector options
  kGramSize?: number;
  winnowingWindow?: number;
  lshBits?: number;
  maxLshBucketSize?: number;
  singleStageThreshold?: number;
  cacheSize?: number;
  maxFunctionSize?: number;
  useParallelProcessing?: boolean;
  useTwoStageHierarchicalLsh?: boolean;
}

export interface SimilarityResult {
  type: 'structural' | 'semantic' | 'behavioral';
  similarity: number;
  functions: SimilarFunction[];
  detector: string;
  metadata?: Record<string, unknown>;
}

export interface SimilarFunction {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  originalFunction?: FunctionInfo;
}

// Enhanced configurable thresholds types
export interface QualityThresholds {
  complexity?: MultiLevelThreshold;
  cognitiveComplexity?: MultiLevelThreshold;
  lines?: MultiLevelThreshold;
  totalLines?: MultiLevelThreshold;
  parameters?: MultiLevelThreshold;
  nestingLevel?: MultiLevelThreshold;
  returnStatements?: MultiLevelThreshold;
  branches?: MultiLevelThreshold;
  loops?: MultiLevelThreshold;
  tryCatch?: MultiLevelThreshold;
  asyncAwait?: MultiLevelThreshold;
  callbacks?: MultiLevelThreshold;
  maintainability?: MultiLevelThreshold;
  halsteadVolume?: MultiLevelThreshold;
  halsteadDifficulty?: MultiLevelThreshold;
  codeToCommentRatio?: MultiLevelThreshold;
}

/**
 * Enhanced quality scorer thresholds with configurable penalties
 */
export interface QualityScorerThresholds {
  complexity: {
    warning: number; // Default: 5
    critical: number; // Default: 10
    warningPenalty: number; // Default: 8
    criticalPenalty: number; // Default: 15
  };
  size: {
    warning: number; // Default: 20
    critical: number; // Default: 50
    warningPenalty: number; // Default: 2
    criticalPenalty: number; // Default: 5
  };
  maintainability: {
    critical: number; // Default: 50
    warning: number; // Default: 70
  };
  grading: {
    A: number; // Default: 90
    B: number; // Default: 80
    C: number; // Default: 70
    D: number; // Default: 60
  };
}

/**
 * Similarity detection thresholds with advanced algorithm parameters
 */
export interface SimilarityThresholds {
  threshold: number; // Default: 0.8
  minLines: number; // Default: 3
  advanced: {
    kGramSize: number; // Default: 12 (range: 3-20)
    winnowingWindow: number; // Default: 6 (range: 3-10)
    lshBits: number; // Default: 24 (range: 16-32)
    maxBucketSize: number; // Default: 10
  };
  weights: {
    ast: number; // Default: 0.4
    signature: number; // Default: 0.2
    metrics: number; // Default: 0.2
    parameters: number; // Default: 0.1
    returnType: number; // Default: 0.1
  };
}

/**
 * Naming quality analysis thresholds
 */
export interface NamingThresholds {
  minLength: number; // Default: 3
  maxLength: number; // Default: 50
  weights: {
    basicRules: number; // Default: 0.3
    semantics: number; // Default: 0.4
    consistency: number; // Default: 0.2
    redundancy: number; // Default: 0.1
  };
  penalties: {
    tooShort: number; // Default: 15
    tooLong: number; // Default: 10
  };
}

/**
 * Performance and batch processing thresholds
 */
export interface PerformanceThresholds {
  batchSize: number; // Default: 100
  maxMemoryMB: number; // Default: 100
  dynamicBatchSizing: {
    enabled: boolean; // Default: true
    thresholds: {
      large: { items: number; batchSize: number }; // > 10000 items → 50 batch
      medium: { items: number; batchSize: number }; // > 5000 items → 100 batch
      small: { items: number; batchSize: number }; // > 1000 items → 200 batch
    };
  };
}

/**
 * Comprehensive threshold configuration interface
 */
export interface FuncqcThresholds {
  quality: QualityScorerThresholds;
  similarity: SimilarityThresholds;
  naming: NamingThresholds;
  performance: PerformanceThresholds;
}

export interface MultiLevelThreshold {
  warning?: ThresholdValue;
  error?: ThresholdValue;
  critical?: ThresholdValue;
}

export type ThresholdValue = number | StatisticalThreshold;

export interface StatisticalThreshold {
  method: 'mean+sigma' | 'percentile' | 'median+mad';
  multiplier?: number; // For mean+sigma (default: 1)
  percentile?: number; // For percentile method (0-100)
}

export interface RiskAssessmentConfig {
  highRiskConditions?: RiskCondition[];
  minViolations?: number; // Minimum violations to be considered high risk
  violationWeights?: Record<ViolationLevel, number>;
  compositeScoringMethod?: 'count' | 'weighted' | 'severity' | 'absolute';
}

export interface RiskCondition {
  metric: keyof QualityMetrics;
  threshold: ThresholdValue;
  operator?: '>' | '>=' | '<' | '<=' | '==' | '!=';
}

export type ViolationLevel = 'warning' | 'error' | 'critical';

export interface ProjectContext {
  experienceLevel?: 'junior' | 'mid' | 'senior';
  projectType?: 'prototype' | 'production' | 'legacy';
  codebaseSize?: 'small' | 'medium' | 'large';
  domain?: 'web' | 'api' | 'cli' | 'library' | 'embedded';
}

// ========================================
// PHASE 4: CONFIGURATION PRESETS SYSTEM
// ========================================

/**
 * Project preset templates for different development contexts
 */
export interface ProjectPreset {
  id: string;
  name: string;
  description: string;
  category: PresetCategory;
  context: ProjectContext;
  config: Partial<FuncqcConfig>;
  recommendations?: PresetRecommendation[];
  metadata: PresetMetadata;
}

export type PresetCategory =
  | 'framework' // React, Vue, Angular, etc.
  | 'platform' // Node.js, Browser, Mobile
  | 'domain' // Web, API, CLI, Library
  | 'methodology' // Microservices, Monolith, etc.
  | 'team' // Junior, Senior, Mixed
  | 'custom'; // User-defined presets

export interface PresetRecommendation {
  type: 'warning' | 'info' | 'tip';
  category: 'performance' | 'maintainability' | 'team' | 'ai-optimization';
  message: string;
  action?: string;
}

export interface PresetMetadata {
  version: string;
  author?: string;
  created: number;
  updated?: number;
  compatibility: string[]; // funcqc version compatibility
  tags: string[];
  usageStats?: {
    adoptionRate?: number;
    successRate?: number;
    lastUsed?: number;
  };
}

/**
 * Configuration preset manager for dynamic application
 */
export interface PresetApplyOptions {
  merge: boolean; // Merge with existing config vs replace
  validate: boolean; // Validate before applying
  backup: boolean; // Create backup of current config
  dryRun: boolean; // Show what would change without applying
  interactive: boolean; // Prompt for confirmation on conflicts
}

export interface PresetApplyResult {
  success: boolean;
  applied: ProjectPreset;
  changes: ConfigurationChange[];
  warnings: string[];
  backupPath?: string;
  validationResults?: ConfigValidationResult[];
}

export interface ConfigurationChange {
  path: string; // JSON path to changed value
  oldValue: unknown;
  newValue: unknown;
  impact: 'low' | 'medium' | 'high';
  description: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  field: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

/**
 * Project analysis result for intelligent preset suggestions
 */
export interface ProjectAnalysisResult {
  hasReactComponents: boolean;
  hasApiRoutes: boolean;
  isCLITool: boolean;
  isLibrary: boolean;
  projectSize: 'small' | 'medium' | 'large';
  detectedFrameworks: string[];
  detectedDependencies: {
    frontend: string[];
    backend: string[];
    testing: string[];
    cli: string[];
  };
}

/**
 * CLI command options for configuration management
 */
export interface ConfigCommandOptions extends CommandOptions {
  preset?: string; // Preset ID to work with
  replace?: boolean; // Replace instead of merge
  noValidate?: boolean; // Skip validation
  noBackup?: boolean; // Skip backup creation
  dryRun?: boolean; // Show changes without applying
  interactive?: boolean; // Interactive mode
  output?: string; // Output file path
  json?: boolean; // JSON output for jq/script processing
}

// Statistical analysis types
export interface ProjectStatistics {
  metrics: Record<keyof QualityMetrics, MetricStatistics>;
  totalFunctions: number;
  analysisTimestamp: number;
  averageComplexity: number;
  averageSize: number;
  medianComplexity: number;
  p90Complexity: number;
  complexityDistribution: MetricStatistics;
  sizeDistribution: MetricStatistics;
  riskDistribution: RiskDistribution;
}

export interface MetricStatistics {
  mean: number;
  median: number;
  standardDeviation: number;
  variance: number;
  min: number;
  max: number;
  p90: number;
  p95: number;
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
  mad: number; // Median Absolute Deviation
}

// Threshold violation types
export interface ThresholdViolation {
  metric: keyof QualityMetrics;
  value: number;
  threshold: number;
  level: ViolationLevel;
  excess: number; // How much the value exceeds the threshold
  method: 'absolute' | 'statistical';
  statisticalContext?: {
    method: StatisticalThreshold['method'];
    multiplier?: number;
    percentile?: number;
    baseline: number; // mean, median, etc.
  };
}

export interface FunctionRiskAssessment {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  violations: ThresholdViolation[];
  totalViolations: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  violationsByLevel: Record<ViolationLevel, number>;
  metrics: QualityMetrics;
}

export interface ProjectRiskAssessment {
  totalFunctions: number;
  assessedFunctions: number;
  riskDistribution: Record<'low' | 'medium' | 'high', number>;
  topViolations: ThresholdViolation[];
  worstFunctions: FunctionRiskAssessment[];
  statistics: ProjectStatistics;
  configuredThresholds: QualityThresholds;
}

// Function description types
export interface FunctionDescription {
  semanticId: string;
  description: string;
  source: 'human' | 'ai' | 'jsdoc' | null;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  aiModel?: string;
  confidenceScore?: number;
  validatedForContentId?: string;
  // Structured fields for developer information
  usageExample?: string;
  sideEffects?: string;
  errorConditions?: string;
}

export interface DescribeCommandOptions extends CommandOptions {
  text?: string;
  source?: 'human' | 'ai' | 'jsdoc';
  model?: string;
  confidence?: string;
  input?: string;
  by?: string;
  listUndocumented?: boolean;
  needsDescription?: boolean;
  showId?: boolean;
  force?: boolean;
  json?: boolean;
  // Structured information options
  usageExample?: string;
  sideEffects?: string;
  errorConditions?: string;
  // AI batch features
  generateTemplate?: boolean;
  aiMode?: boolean;
}

export interface SearchCommandOptions extends CommandOptions {
  format?: 'table' | 'json' | 'friendly';
  limit?: string;
  json?: boolean;
  semantic?: boolean; // Enable semantic search using local embeddings
  threshold?: string; // Similarity threshold (0-1) for semantic search
  hybrid?: boolean; // Use hybrid search (keyword + semantic + AST)
  hybridWeight?: string; // Weight for semantic vs keyword (0-1, default 0.5)
  showSimilarity?: boolean; // Show similarity scores in results
  minSimilarity?: string; // Minimum similarity score to include results
  aiHints?: string; // JSON string with AI hints for enhanced search
  similarityWeights?: string; // JSON string with similarity algorithm weights
  contextFunctions?: string; // Comma-separated list of context function IDs
  intermediate?: boolean; // Output intermediate results for AI analysis
}



export interface RiskDistribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

/**
 * Type guard to check if assessment is multiple functions
 * Centralized to prevent duplication across modules
 */
export function isMultipleAssessment(
  assessment: QualityAssessment | MultipleQualityAssessment
): assessment is MultipleQualityAssessment {
  return 'allFunctions' in assessment;
}
