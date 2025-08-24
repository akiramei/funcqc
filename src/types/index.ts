// Re-export common types
export * from './common';

// Scope configuration for file filtering
export interface ScopeConfig {
  roots: string[];
  exclude?: string[];
  include?: string[];
  description?: string;
}

// Re-export quality enhancement types
export * from './quality-enhancements';

// Re-export architecture types
export * from './architecture';

// Re-export dynamic weights types
export * from './dynamic-weights';

// Re-export debug residue types
export * from './debug-residue';

// Re-export type system types
export * from './type-system';

// Re-export type analysis types
export * from './type-analysis';

import { NamingEvaluation } from './quality-enhancements';
import { QualityAssessment, MultipleQualityAssessment } from '../core/realtime-quality-gate.js';
import { TypeDefinition, TypeRelationship, TypeMember, MethodOverride } from './type-system';

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
    [scopeName: string]: ScopeConfig;
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

  // Backup and data protection configuration
  backup?: BackupConfig;
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
  snapshotId: string; // Snapshot reference for composite primary key
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
  sourceFileRefId?: string; // Reference to source_file_refs table

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
  
  // Change frequency tracking (computed from database)
  changeCount?: number; // Number of times this function has been modified (based on content_id changes)
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


// Analysis levels for progressive scan
export type AnalysisLevel = 
  | 'NONE'           // No analysis performed
  | 'BASIC'          // Basic function information
  | 'COUPLING'       // Coupling analysis completed
  | 'CALL_GRAPH'     // Call graph analysis completed
  | 'TYPE_SYSTEM'    // Type system analysis completed
  | 'COMPLETE';      // All analyses completed

export interface SnapshotMetadata {
  // Analysis status flags
  basicAnalysisCompleted?: boolean;
  couplingAnalysisCompleted?: boolean;
  callGraphAnalysisCompleted?: boolean;
  typeSystemAnalysisCompleted?: boolean;
  analysisLevel?: AnalysisLevel;
  scanDuration?: number; // Time taken for scan in milliseconds
  scanMode?: 'quick' | 'basic' | 'standard' | 'full';
  
  // Statistical metadata
  totalFunctions?: number;
  totalFiles?: number;
  avgComplexity?: number;
  maxComplexity?: number;
  exportedFunctions?: number;
  asyncFunctions?: number;
  complexityDistribution?: Record<number, number>;
  fileExtensions?: Record<string, number>;
  
  [key: string]: unknown; // Allow additional metadata
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
  analysisLevel?: AnalysisLevel; // Use the new AnalysisLevel type
  basicAnalysisCompleted?: boolean; // Deprecated, use metadata
  callGraphAnalysisCompleted?: boolean; // Deprecated, use metadata
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
  configPath?: string;
}

export interface ScanCommandOptions extends CommandOptions {
  label?: string;
  comment?: string;
  scope?: string; // Scan specific scope (src, test, all, or custom scope)
  realtimeGate?: boolean; // Enable real-time quality gate with adaptive thresholds
  json?: boolean;
  force?: boolean;
  skipBasicAnalysis?: boolean; // Skip basic analysis for fast scan
  // Performance-focused scan levels
  quick?: boolean; // Quick scan (5-10s): snapshot only
  withBasic?: boolean; // Basic scan (15-20s): includes basic analysis only
  withCoupling?: boolean; // Coupling scan (40-50s): includes basic + coupling analysis
  withGraph?: boolean; // Standard scan (30-40s): includes call graph
  withTypes?: boolean; // Extended scan: includes type system analysis
  full?: boolean; // Full scan (50-60s): all analyses
  async?: boolean; // Run heavy analyses in background
}

export interface ListCommandOptions extends CommandOptions {
  json?: boolean; // JSON output for jq/script processing
  limit?: string;
  sort?: string;
  desc?: boolean;
  ccGe?: string;
  changesGe?: string; // Filter by change count (functions changed >= n times)
  file?: string;
  name?: string;
  scope?: string; // Filter by scope (src, test, all, or custom scope)
  includeTypes?: boolean; // Include type context information for functions
  fullId?: boolean; // Display full UUIDs instead of 8-character short IDs
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
  topN?: number; // Number of top recommendations to show (default: 3, verbose: 10)
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
    analyzeContent(content: string, virtualPath: string, snapshotId?: string): Promise<FunctionInfo[]>;
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

// Coupling analysis types
export interface ParameterPropertyUsageData {
  functionId: string;
  parameterName: string;
  parameterTypeId: string | null;
  accessedProperty: string;
  accessType: 'read' | 'write' | 'modify' | 'pass';
  accessLine: number;
  accessContext: string;
}

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
  updateAnalysisLevel(snapshotId: string, level: AnalysisLevel): Promise<void>;
  getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]>;
  getSnapshot(id: string): Promise<SnapshotInfo | null>;
  getLatestSnapshot(scope?: string): Promise<SnapshotInfo | null>;
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

  // Unified virtual project analysis support
  getSnapshotContentsForAnalysis(snapshotId: string): Promise<Array<{
    filePath: string;      // Normalized path (stored in DB)
    content: string;       // File content for virtual project
    contentId: string;     // Content ID for deduplication
    refId: string;         // Source file reference ID
    fileHash: string;      // SHA-256 of content (mirrors source_contents.file_hash)
    fileSizeBytes: number; // Mirrors source_contents.file_size_bytes
    lineCount: number;     // Mirrors source_contents.line_count
    encoding: string;      // e.g. 'utf-8'
  }>>;

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

  // Type system operations
  saveTypeDefinitions(types: TypeDefinition[]): Promise<void>;
  saveTypeRelationships(relationships: TypeRelationship[]): Promise<void>;
  saveTypeMembers(members: TypeMember[]): Promise<void>;
  saveMethodOverrides(overrides: MethodOverride[]): Promise<void>;
  
  // Transactional type save operation
  saveAllTypeInformation(typeInfo: {
    typeDefinitions: TypeDefinition[];
    typeRelationships: TypeRelationship[];
    typeMembers: TypeMember[];
    methodOverrides: MethodOverride[];
  }): Promise<void>;
  
  getTypeDefinitions(snapshotId: string): Promise<TypeDefinition[]>;
  getTypeRelationships(snapshotId: string): Promise<TypeRelationship[]>;
  getTypeMembers(typeId: string): Promise<TypeMember[]>;
  getMethodOverrides(snapshotId: string): Promise<MethodOverride[]>;
  
  // Type query operations
  findTypeByName(name: string, snapshotId: string): Promise<TypeDefinition | null>;
  getImplementingClasses(interfaceId: string): Promise<TypeDefinition[]>;
  getMethodOverridesByFunction(functionId: string): Promise<MethodOverride[]>;
  
  // Raw query operations  
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  
  // Coupling analysis operations
  storeParameterPropertyUsage(couplingData: ParameterPropertyUsageData[], snapshotId: string): Promise<void>;
}

export interface BackupOptions {
  format: 'sql' | 'json';
  includeSourceCode?: boolean;
  compress?: boolean;
  filters?: QueryFilter[];
}

// Enhanced backup configuration for comprehensive data protection
export interface BackupConfig {
  // Output directory configuration
  outputDir: string;
  
  // Naming conventions
  naming: {
    format: string;           // 'YYYYMMDD-HHMMSS' format
    includeLabel: boolean;    // Include --label in directory name
    includeGitInfo: boolean;  // Include git branch/commit info
  };
  
  // Default export settings
  defaults: {
    includeSourceCode: boolean;
    compress: boolean;
    format: 'sql' | 'json';
    tableOrder: 'auto' | 'manual' | string[];
  };
  
  // Retention policy
  retention: {
    maxBackups: number;       // Maximum number of backups to keep
    maxAge: string;           // Maximum age (e.g., '30d', '6m', '1y')
    autoCleanup: boolean;     // Automatically clean old backups
  };
  
  // Schema management
  schema: {
    autoDetectVersion: boolean;     // Automatically detect schema version
    conversionRulesDir: string;     // Directory for conversion rules
  };
  
  // Security settings
  security: {
    excludeSensitiveData: boolean;  // Exclude potentially sensitive data
    encryptBackups: boolean;        // Encrypt backup files
  };
  
  // Advanced options
  advanced: {
    parallelTableExport: boolean;   // Export tables in parallel
    verifyIntegrity: boolean;       // Verify backup integrity
    includeMetrics: boolean;        // Include quality metrics
  };
}

// Backup manifest structure
export interface BackupManifest {
  createdAt: string;
  schemaHash: string;
  label?: string;
  tableOrder: string[];
  tables: Record<string, {
    rows: number;
    dependencies: string[];
  }>;
  schemaInfo: {
    version: string;
    constraints: 'verified' | 'warning' | 'error';
    circularDeps: string[];
  };
  metadata: {
    funcqcVersion: string;
    backupFormat: string;
    compressed: boolean;
    includesSourceCode: boolean;
  };
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
  
  // Recall strategy - determines completeness vs performance trade-off
  recall?: 'guaranteed' | 'fast';
  
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
  show?: boolean; // Show current configuration
  set?: string; // Set configuration value
  get?: string; // Get configuration value
  reset?: boolean; // Reset configuration
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


export interface InspectCommandOptions extends CommandOptions {
  type?: 'functions' | 'files'; // Type of inspection (default: functions)
  json?: boolean; // JSON output for jq/script processing
  limit?: number; // Limit number of results
  sort?: string; // Sort by field (cc, loc, changes, name, file)
  desc?: boolean; // Sort in descending order
  format?: 'table' | 'card' | 'compact'; // Output format (default: card)
  stats?: boolean; // Show statistics (for files)
  
  // Function filters (from list command)
  ccGe?: number; // Filter functions with complexity >= N
  changesGe?: number; // Filter by change count
  file?: string; // Filter by file path pattern
  name?: string; // Filter/search by function name pattern
  scope?: string; // Filter by scope
  
  // Detail level (unified interface)
  level?: 'basic' | 'detailed' | 'expert'; // Detail level for output
  detailed?: boolean; // Show detailed information (like show command)
  
  // Show options (from show command)
  id?: string; // Specific function ID to inspect
  usage?: boolean; // Show usage information
  current?: boolean; // Show current metrics (default)
  history?: boolean; // Show historical data
  source?: boolean; // Show source code
}

export interface MeasureCommandOptions extends CommandOptions {
  // Core measurement options
  label?: string; // Label for the measurement snapshot
  comment?: string; // Comment for measurement changes
  scope?: string; // Measurement scope (src, test, all, or custom scope)
  json?: boolean; // JSON output for script processing
  history?: boolean; // Display snapshot history instead of creating measurements
  
  // Measurement level (unified scan + analyze)
  level?: 'quick' | 'basic' | 'standard' | 'deep' | 'complete'; // Measurement depth
  
  // Specific analysis types (from analyze command)
  callGraph?: boolean; // Include call graph analysis
  types?: boolean; // Include TypeScript type system analysis
  coupling?: boolean; // Include coupling analysis
  
  // Quality and performance options
  realtimeGate?: boolean; // Enable real-time quality gate
  async?: boolean; // Run heavy analyses in background
  force?: boolean; // Force measurement even if snapshot exists
  
  // Output and verbosity
  verbose?: boolean; // Detailed progress output
  quiet?: boolean; // Minimal output
  
  // Compatibility aliases (for transition from scan/analyze)
  full?: boolean; // Alias for level=complete
  withBasic?: boolean; // Alias for level=basic
  withGraph?: boolean; // Alias for callGraph=true
  withTypes?: boolean; // Alias for types=true
  withCoupling?: boolean; // Alias for coupling=true
}

export interface SearchCommandOptions extends CommandOptions {
  format?: 'table' | 'json' | 'friendly';
  limit?: string;
  json?: boolean;
  semantic?: boolean; // Enable semantic search using local embeddings
  threshold?: string; // Similarity threshold (0-1) for semantic search
  hybrid?: boolean; // Enable hybrid search (semantic + text)
  minSimilarity?: number; // Minimum similarity threshold
  aiHints?: boolean; // Enable AI-generated search hints
  similarityWeights?: string; // Custom similarity weights
  intermediate?: boolean; // Show intermediate results
  showSimilarity?: boolean; // Show similarity scores in output
  hybridWeight?: number; // Weight for hybrid search scoring
  contextFunctions?: number; // Number of context functions to include
}

export interface ImproveCommandOptions extends CommandOptions {
  type?: 'duplicates' | 'safety' | 'dead-code'; // Type of improvement (default: show all options)
  scope?: string; // Analyze improvements within specific scope (src, test, all, or custom scope)
  json?: boolean; // JSON output for script processing
  autoApply?: boolean; // Automatically apply safe improvements
  threshold?: string; // Similarity threshold for duplicate detection
  risky?: boolean; // Include risky improvements
  preview?: boolean; // Preview changes before applying
}

export interface AssessCommandOptions extends CommandOptions {
  type?: 'health' | 'quality' | 'types'; // Type of assessment (default: comprehensive)
  json?: boolean; // JSON output for script processing
  trend?: boolean; // Show trend analysis
  risks?: boolean; // Show detailed risk assessment
  scope?: string; // Assessment scope (src, test, all, or custom scope)
  baseline?: string; // Baseline snapshot for comparison
  threshold?: string; // Quality threshold for pass/fail determination
  
  // Advanced assessment options
  mode?: 'static' | 'dynamic'; // Evaluation mode (default: static)
  advanced?: boolean; // Enable advanced analysis features
  includeStructural?: boolean; // Include structural analysis
  includeRisk?: boolean; // Include risk evaluation
  includeGate?: boolean; // Include quality gate evaluation
  
  // Dynamic assessment configuration
  teamExperience?: 'Senior' | 'Mixed' | 'Junior'; // Team experience level for weight adjustment
  domainComplexity?: 'High' | 'Medium' | 'Low'; // Domain complexity for threshold adjustment
  architecturePattern?: 'MVC' | 'Microservices' | 'Layered' | 'Unknown'; // Architecture pattern detection
  
  // Output and reporting options
  exportReport?: string; // Export comprehensive report to file (html|json|markdown)
  includeRecommendations?: boolean; // Include improvement recommendations
  showWeightBreakdown?: boolean; // Show weight calculation breakdown (for dynamic mode)
  explainScoring?: boolean; // Explain scoring methodology
}

export interface SetupCommandOptions extends CommandOptions {
  action?: 'init' | 'config' | 'check'; // Setup action (default: interactive)
  
  // Init options
  force?: boolean; // Force initialization even if already exists
  configPath?: string; // Path to configuration file
  
  // Config options
  show?: boolean; // Show current configuration
  set?: string; // Set configuration value (key=value format)
  get?: string; // Get configuration value by key
  reset?: boolean; // Reset configuration to defaults
  
  // Output options
  json?: boolean; // JSON output for script processing
}

export interface ManageCommandOptions extends CommandOptions {
  action?: 'db' | 'diff' | 'export' | 'import' | 'convert' | 'list-backups' | 'history'; // Management action (default: status)
  
  // Database options (db action)
  list?: boolean; // List all tables
  table?: string; // Table name to query
  where?: string; // WHERE clause for database queries
  columns?: string; // Columns to select (comma-separated)
  limit?: number; // Limit number of rows
  count?: boolean; // Show count instead of data
  
  // Diff options (diff action)
  from?: string; // Source snapshot for comparison
  to?: string; // Target snapshot for comparison
  insights?: boolean; // Show detailed insights
  similarityThreshold?: number; // Similarity threshold for analysis
  
  // Export/Import options
  format?: 'json' | 'sql' | 'csv'; // Export/import format
  file?: string; // File path for export/import operations
  includeSourceCode?: boolean; // Include source code in export
  compress?: boolean; // Compress exported data
  
  // History options (history action)
  since?: string; // Filter history since date/snapshot
  until?: string; // Filter history until date/snapshot
  branch?: string; // Filter by git branch
  label?: string; // Filter by snapshot label
  scope?: string; // Filter by scope
  
  // Output options
  json?: boolean; // JSON output for script processing
  verbose?: boolean; // Detailed output
}

export interface DependenciesCommandOptions extends CommandOptions {
  action?: 'list' | 'show' | 'stats' | 'lint' | 'dead' | 'cycles'; // Dependency analysis action (default: overview)
  
  // Common options across all dependency actions
  snapshot?: string; // Snapshot ID for analysis
  scope?: string; // Analyze dependencies within specific scope (src, test, all, or custom scope)
  json?: boolean; // JSON output for script processing
  format?: 'table' | 'json' | 'dot'; // Output format
  verbose?: boolean; // Detailed output
  
  // List action options (from DepListOptions)
  caller?: string; // Filter by caller function
  callee?: string; // Filter by callee function
  callerClass?: string; // Filter by caller class
  calleeClass?: string; // Filter by callee class
  file?: string; // Filter by file path
  type?: 'direct' | 'async' | 'conditional' | 'external'; // Call type filter
  limit?: string; // Limit number of results
  sort?: 'caller' | 'callee' | 'file' | 'line' | 'fanin' | 'fanout' | 'depth' | 'name' | 'length' | 'complexity' | 'importance'; // Sort criteria
  desc?: boolean; // Sort in descending order
  
  // Show action options (from DepShowOptions)
  direction?: 'in' | 'out' | 'both'; // Dependency direction
  depth?: string; // Analysis depth
  includeExternal?: boolean; // Include external dependencies
  externalFilter?: 'all' | 'transit' | 'none'; // External dependency filter
  showComplexity?: boolean; // Show complexity metrics
  rankByLength?: boolean; // Sort routes by depth
  maxRoutes?: string; // Limit number of routes
  
  // Stats action options (from DepStatsOptions)
  showHubs?: boolean; // Show hub functions
  showUtility?: boolean; // Show utility functions
  showIsolated?: boolean; // Show isolated functions
  hubThreshold?: string; // Hub threshold value
  utilityThreshold?: string; // Utility threshold value
  maxHubFunctions?: string; // Max hub functions to show
  maxUtilityFunctions?: string; // Max utility functions to show
  
  // Lint action options (from DepLintOptions)
  config?: string; // Configuration file path
  severity?: 'error' | 'warning' | 'info'; // Minimum severity level
  maxViolations?: string; // Maximum violations to show
  includeMetrics?: boolean; // Include metrics in output
  failOn?: 'error' | 'warning' | 'any'; // Fail criteria
  showLayers?: boolean; // Show layer information
  showRules?: boolean; // Show applied rules
  showConfig?: boolean; // Show configuration
  showConsolidation?: boolean; // Show consolidation strategies
  dryRun?: boolean; // Dry run mode
  
  // Dead action options (from DepDeadOptions)
  excludeTests?: boolean; // Exclude test files
  excludeExports?: boolean; // Exclude exported functions
  excludeSmall?: boolean; // Exclude small functions
  threshold?: string; // Size threshold
  showReasons?: boolean; // Show reasons for dead code
  layerEntryPoints?: string; // Layer entry points
  
  // Cycles action options (from DepCyclesOptions)
  minSize?: string; // Minimum cycle size
  maxLength?: string; // Maximum cycle length
  includeRecursive?: boolean; // Include recursive cycles
  includeClear?: boolean; // Include clear cycles
  includeAll?: boolean; // Include all cycles
  excludeRecursive?: boolean; // Exclude recursive cycles
  excludeClear?: boolean; // Exclude clear cycles
  minComplexity?: string; // Minimum complexity
  crossModuleOnly?: boolean; // Cross-module cycles only
  crossLayerOnly?: boolean; // Cross-layer cycles only
  recursiveOnly?: boolean; // Recursive cycles only
  sortByImportance?: boolean; // Sort by importance
}

export interface RefactorCommandOptions extends CommandOptions {
  action?: 'guard' | 'extract-vo' | 'discriminate' | 'canonicalize' | 'type-replace' | 'overview'; // Refactoring action (default: overview)
  
  // Common options across all refactor actions
  snapshot?: string; // Snapshot ID for analysis
  json?: boolean; // JSON output for script processing
  format?: 'table' | 'json' | 'markdown'; // Output format
  verbose?: boolean; // Detailed output
  dryRun?: boolean; // Preview changes without applying them
  output?: string; // Output file path
  
  // Refactor Guard action options
  type?: string; // Target type name for guard analysis
  operation?: 'replace' | 'merge' | 'split' | 'extract' | 'inline'; // Refactoring operation
  includeTests?: boolean; // Include test templates
  includeBehavioral?: boolean; // Include behavioral checks
  includeCochange?: boolean; // Include co-change analysis
  riskThreshold?: 'low' | 'medium' | 'high'; // Risk assessment threshold
  prTemplate?: boolean; // Generate PR template
  
  // Extract Value Objects action options
  minSupport?: number; // Minimum support for patterns
  minConfidence?: number; // Minimum confidence threshold
  minCohesion?: number; // Minimum cohesion score
  includeComputed?: boolean; // Include computed methods
  generateConstructors?: boolean; // Generate smart constructors
  inferInvariants?: boolean; // Try to infer business rules
  preserveOriginal?: boolean; // Keep original types during transition
  outputCode?: string; // Directory to output generated VO code
  maxCandidates?: number; // Maximum number of VO candidates
  showOpportunities?: boolean; // Show extraction opportunities
  showGenerated?: boolean; // Show generated code samples
  domainFilter?: string; // Filter by domain context
  complexityFilter?: 'low' | 'medium' | 'high'; // Filter by extraction complexity
  
  // Discriminate action options (discriminated unions)
  targetTypes?: string; // Comma-separated list of specific types to analyze
  minCoverage?: string; // Minimum coverage threshold (0-1)
  maxCases?: string; // Maximum union cases per type
  includeBooleans?: boolean; // Include boolean discriminants
  includeEnums?: boolean; // Include enum discriminants
  allowBreaking?: boolean; // Allow breaking changes during transformation
  transform?: boolean; // Apply transformations automatically
  
  // Canonicalize action options (DTO canonicalization)
  canonicalizeBehavioral?: boolean; // Include behavioral analysis for canonicalization
  generateCodemod?: boolean; // Generate codemod actions
  requireMinimalImpact?: boolean; // Only suggest low-impact changes
  preserveOptionality?: boolean; // Preserve optional property differences
  showArtifacts?: boolean; // Show generated artifacts
  
  // Type Replace action options
  from?: string; // Source type name
  to?: string; // Target type name
  checkOnly?: boolean; // Only perform compatibility check
  migrationPlan?: boolean; // Generate migration plan
  tsConfig?: string; // Path to TypeScript config
  allowUnsafe?: boolean; // Allow unsafe replacements with warnings
  teamSize?: number; // Team size for migration planning
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive'; // Risk tolerance level
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
