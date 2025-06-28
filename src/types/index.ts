// Core configuration types
export interface FuncqcConfig {
  roots: string[];
  exclude: string[];
  include?: string[];
  
  storage: {
    type: 'pglite' | 'postgres';
    path?: string;
    url?: string;
  };
  
  metrics: {
    complexityThreshold: number;
    linesOfCodeThreshold: number;
    parameterCountThreshold: number;
  };
  
  git: {
    enabled: boolean;
    autoLabel: boolean;
  };
  
  similarity?: {
    detectors: Record<string, SimilarityDetectorConfig>;
    consensus: ConsensusStrategy;
  };
}

export interface SimilarityDetectorConfig {
  enabled: boolean;
  threshold: number;
  options?: Record<string, any>;
}

export interface ConsensusStrategy {
  strategy: 'majority' | 'intersection' | 'union' | 'weighted';
  weightings?: Record<string, number>;
  threshold?: number;
}

// Function analysis types
export interface FunctionInfo {
  id: string;
  name: string;
  displayName: string;
  signature: string;
  signatureHash: string;
  filePath: string;
  fileHash: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  astHash: string;
  
  // Function attributes
  isExported: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  isArrowFunction: boolean;
  isMethod: boolean;
  isConstructor: boolean;
  isStatic: boolean;
  accessModifier?: 'public' | 'private' | 'protected';
  parentClass?: string;
  parentNamespace?: string;
  
  // Documentation
  jsDoc?: string;
  sourceCode?: string;
  
  // Relations
  parameters: ParameterInfo[];
  returnType?: ReturnTypeInfo;
  metrics?: QualityMetrics;
  dependencies?: DependencyInfo[];
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
  gitCommit?: string;
  gitBranch?: string;
  gitTag?: string;
  projectRoot: string;
  configHash: string;
  metadata: SnapshotMetadata;
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
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN';
  value: any;
}

export interface QueryOptions {
  filters?: QueryFilter[];
  sort?: string;
  limit?: number;
  offset?: number;
  fields?: string[];
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
  oldValue: any;
  newValue: any;
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
  details?: any;
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
  dryRun?: boolean;
  incremental?: boolean;
  force?: boolean;
  batchSize?: string;
  quick?: boolean;
}

export interface ListCommandOptions extends CommandOptions {
  name?: string;
  file?: string;
  exported?: boolean;
  async?: boolean;
  complexity?: string;
  lines?: string;
  params?: string;
  format?: 'table' | 'json' | 'csv';
  fields?: string;
  sort?: string;
  limit?: string;
  json?: boolean;
  csv?: boolean;
}

export interface StatusCommandOptions extends CommandOptions {
  verbose?: boolean;
}

// Storage adapter interface
export interface StorageAdapter {
  init(): Promise<void>;
  close(): Promise<void>;
  
  // Snapshot operations
  saveSnapshot(functions: FunctionInfo[], label?: string): Promise<string>;
  getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]>;
  getSnapshot(id: string): Promise<SnapshotInfo | null>;
  deleteSnapshot(id: string): Promise<boolean>;
  
  // Function operations
  getFunctions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]>;
  queryFunctions(options?: QueryOptions): Promise<FunctionInfo[]>;
  
  // Analysis operations
  diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff>;
  
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
  detect(functions: FunctionInfo[], options: SimilarityOptions): Promise<SimilarityResult[]>;
  isAvailable(): Promise<boolean>;
}

export interface SimilarityOptions {
  threshold?: number;
  minLines?: number;
  crossFile?: boolean;
  printCode?: boolean;
}

export interface SimilarityResult {
  type: 'structural' | 'semantic' | 'behavioral';
  similarity: number;
  functions: SimilarFunction[];
  detector: string;
  metadata?: Record<string, any>;
}

export interface SimilarFunction {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  originalFunction?: FunctionInfo;
}
