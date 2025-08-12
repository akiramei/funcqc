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
}

export interface TypeMembersOptions {
  typeName?: string;
  json?: boolean;
  detail?: boolean;
  kind?: 'property' | 'method' | 'getter' | 'setter' | 'constructor' | 'index_signature' | 'call_signature';
  accessModifier?: 'public' | 'protected' | 'private';
}