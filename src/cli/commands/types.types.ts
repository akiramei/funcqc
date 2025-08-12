export interface TypeListOptions {
  // Type filtering
  kind?: string;
  exported?: boolean;
  generic?: boolean;
  file?: string;
  name?: string;
  
  // Function count filtering (similar to cc-ge in list command)
  fnEq?: string;      // Functions equal to N
  fnGe?: string;      // Functions greater than or equal to N
  fnLe?: string;      // Functions less than or equal to N
  fnGt?: string;      // Functions greater than N
  fnLt?: string;      // Functions less than N
  
  // Output control
  limit?: number;
  sort?: 'name' | 'kind' | 'file' | 'functions' | 'members';
  desc?: boolean;
  json?: boolean;
  detail?: boolean;
  
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