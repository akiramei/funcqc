export interface TypeListOptions {
  // Type filtering
  kind?: string;
  exported?: boolean;
  generic?: boolean;
  file?: string;
  name?: string;
  
  // Member count filtering
  // Properties
  propEq?: string;    // Properties equal to N
  propGe?: string;    // Properties >= N
  propLe?: string;    // Properties <= N
  propGt?: string;    // Properties > N
  propLt?: string;    // Properties < N
  
  // Methods (replacing fn with meth for clarity)
  methEq?: string;    // Methods equal to N
  methGe?: string;    // Methods >= N
  methLe?: string;    // Methods <= N
  methGt?: string;    // Methods > N
  methLt?: string;    // Methods < N
  
  // Functions (legacy - mapped to methods)
  fnEq?: string;      // Functions equal to N
  fnGe?: string;      // Functions >= N
  fnLe?: string;      // Functions <= N
  fnGt?: string;      // Functions > N
  fnLt?: string;      // Functions < N
  
  // Total members
  totalEq?: string;   // Total members equal to N
  totalGe?: string;   // Total members >= N
  totalLe?: string;   // Total members <= N
  totalGt?: string;   // Total members > N
  totalLt?: string;   // Total members < N
  
  // Special filters
  hasIndex?: boolean; // Has index signature
  hasCall?: boolean;  // Has call signature
  
  // Output control
  limit?: number;
  sort?: 'name' | 'kind' | 'file' | 'functions' | 'props' | 'methods' | 'ctors' | 'total' | 'members';
  desc?: boolean;
  json?: boolean;
  detail?: boolean;
  showLocation?: boolean; // Show FILE and LINE columns
  showId?: boolean; // Show ID column for unique identification
  
  // Legacy fields (maintain compatibility)
  risk?: 'low' | 'medium' | 'high' | 'critical';
}

export interface TypeHealthOptions {
  verbose?: boolean;
  json?: boolean;
  thresholds?: string;
  legend?: boolean;
}

export interface TypeDepsOptions {
  depth?: number;
  circular?: boolean;
  json?: boolean;
}

export interface TypeApiOptions {
  typeName?: string;
  json?: boolean;
  detail?: boolean;
  optimize?: boolean;
}

export interface TypeMembersOptions {
  typeName?: string;
  json?: boolean;
  detail?: boolean;
  kind?: 'property' | 'method' | 'getter' | 'setter' | 'constructor' | 'index_signature' | 'call_signature';
  accessModifier?: 'public' | 'protected' | 'private';
}

export interface TypeCoverageOptions {
  typeName?: string;
  json?: boolean;
  hotThreshold?: number;
  writeHubThreshold?: number;
  includePrivate?: boolean;
}

export interface TypeClusterOptions {
  typeName?: string;
  json?: boolean;
  similarityThreshold?: number;
  minClusterSize?: number;
}

export interface TypeRiskOptions {
  typeName?: string;
  json?: boolean;
}

export interface TypeInsightsOptions {
  typeName?: string;
  json?: boolean;
  includeCoverage?: boolean;
  includeApi?: boolean;
  includeCluster?: boolean;
  includeRisk?: boolean;
}

export interface TypeSlicesOptions {
  json?: boolean;
  minSupport?: number;       // Minimum types containing slice (default: 3)
  minSliceSize?: number;     // Minimum properties per slice (default: 2)
  maxSliceSize?: number;     // Maximum properties per slice (default: 5)
  considerMethods?: boolean; // Include methods in analysis (default: false)
  excludeCommon?: boolean;   // Exclude common properties like 'id', 'name' (default: true)
  benefit?: 'high' | 'medium' | 'low'; // Filter by extraction benefit level
  limit?: number;           // Limit number of results
  sort?: 'support' | 'size' | 'impact' | 'benefit'; // Sort criteria (default: impact)
  desc?: boolean;           // Sort in descending order
}

export interface TypeSubsumeOptions {
  json?: boolean;
  minOverlap?: number;        // Minimum overlap ratio (0-1, default: 0.7)
  includePartial?: boolean;   // Include partial matches (default: true)
  showRedundant?: boolean;    // Show only redundant types (default: false)
  considerMethods?: boolean;  // Consider method names (default: false)
  limit?: number;             // Limit number of results
  sort?: 'overlap' | 'impact' | 'types'; // Sort criteria (default: impact)
  desc?: boolean;             // Sort in descending order
}

export interface TypeFingerprintOptions {
  json?: boolean;
  includeCallsOut?: boolean;       // Include outgoing calls (default: true)
  includeCallsIn?: boolean;        // Include incoming calls (default: true)
  minCallFrequency?: number;       // Minimum call frequency (default: 2)
  similarityThreshold?: number;    // Clustering similarity threshold (0-1, default: 0.7)
  maxFingerprintSize?: number;     // Max behavioral vector size (default: 50)
  includeInternalCalls?: boolean;  // Include internal method calls (default: false)
  limit?: number;                  // Limit number of clusters
  sort?: 'similarity' | 'impact' | 'size'; // Sort criteria (default: impact)
  desc?: boolean;                  // Sort in descending order
}

export interface TypeConvertersOptions {
  json?: boolean;
  minConverters?: number;          // Minimum converters to form a network (default: 2)
  includeInternalCalls?: boolean;  // Include internal function calls (default: true)
  includeParsers?: boolean;        // Include parse functions as converters (default: true)
  showChains?: boolean;            // Show conversion chains (default: false)
  canonicalOnly?: boolean;         // Show only canonical types (default: false)
  maxChainLength?: number;         // Maximum conversion chain length (default: 4)
  limit?: number;                  // Limit number of results
  sort?: 'centrality' | 'converters' | 'usage'; // Sort criteria (default: centrality)
  desc?: boolean;                  // Sort in descending order
}

export interface TypeCochangeOptions {
  json?: boolean;
  monthsBack?: number;             // How far back to analyze (default: 6 months)
  minChanges?: number;             // Minimum changes to consider a type (default: 2)
  cochangeThreshold?: number;      // Threshold for co-change significance (0-1, default: 0.3)
  showMatrix?: boolean;            // Show co-change matrix (default: false)
  suggestModules?: boolean;        // Suggest module reorganization (default: true)
  maxCommits?: number;             // Maximum commits to analyze (default: 1000)
  excludePaths?: string | string[]; // Paths to exclude from analysis (default: [])
  limit?: number;                  // Limit number of results
  sort?: 'coupling' | 'changes' | 'volatility'; // Sort criteria (default: coupling)
  desc?: boolean;                  // Sort in descending order
}

// Helper functions
export function isUuidOrPrefix(value: string): boolean {
  return Boolean(
    value.match(/^[0-9a-f]{8}(-[0-9a-f]{4}){0,3}(-[0-9a-f]{12})?$/i) ||
    value.match(/^[0-9a-f]{8,}$/i)
  );
}

export function escapeLike(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}