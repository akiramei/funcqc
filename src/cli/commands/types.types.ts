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