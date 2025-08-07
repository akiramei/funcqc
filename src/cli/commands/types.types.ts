export interface TypeListOptions {
  kind?: string;
  exported?: boolean;
  generic?: boolean;
  file?: string;
  limit?: number;
  sort?: 'name' | 'fields' | 'complexity' | 'usage';
  desc?: boolean;
  risk?: 'low' | 'medium' | 'high' | 'critical';
  json?: boolean;
  detail?: boolean;
}

export interface TypeHealthOptions {
  verbose?: boolean;
  json?: boolean;
  thresholds?: string;
}

export interface TypeDepsOptions {
  depth?: number;
  circular?: boolean;
  json?: boolean;
}