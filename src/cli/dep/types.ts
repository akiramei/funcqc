import { BaseCommandOptions } from '../../types/command';

export interface RouteComplexityInfo {
  path: string[];           // Function IDs in the route
  pathNames: string[];      // Function names in the route
  totalDepth: number;       // Route length
  totalComplexity: number;  // Sum of cyclomatic complexity for all functions in route
  avgComplexity: number;    // Average complexity per function
  complexityBreakdown: Array<{
    functionId: string;
    functionName: string;
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
  }>;
}

export interface DepListOptions extends BaseCommandOptions {
  caller?: string;
  callee?: string;
  callerClass?: string;
  calleeClass?: string;
  file?: string;
  type?: 'direct' | 'async' | 'conditional' | 'external';
  limit?: string;
  sort?: 'caller' | 'callee' | 'file' | 'line';
  desc?: boolean;
  json?: boolean;
  snapshot?: string;
}

export interface DepShowOptions extends BaseCommandOptions {
  direction?: 'in' | 'out' | 'both';
  depth?: string;
  includeExternal?: boolean;
  externalFilter?: 'all' | 'transit' | 'none';
  showComplexity?: boolean;    // Show complexity metrics for each function in routes
  rankByLength?: boolean;      // Sort routes by depth (longest first)
  maxRoutes?: string;          // Limit number of displayed routes
  json?: boolean;
  snapshot?: string;
}

export interface DepStatsOptions extends BaseCommandOptions {
  sort?: 'fanin' | 'fanout' | 'depth' | 'name';
  limit?: string;
  showHubs?: boolean;
  showUtility?: boolean;
  showIsolated?: boolean;
  hubThreshold?: string;
  utilityThreshold?: string;
  maxHubFunctions?: string;
  maxUtilityFunctions?: string;
  json?: boolean;
  format?: 'table' | 'json' | 'dot';
  snapshot?: string;
}

export interface DepLintOptions extends BaseCommandOptions {
  config?: string;
  format?: 'table' | 'json';
  severity?: 'error' | 'warning' | 'info';
  maxViolations?: string;
  includeMetrics?: boolean;
  fix?: boolean;
  snapshot?: string;
}

export interface DepDeadOptions extends BaseCommandOptions {
  excludeTests?: boolean;
  excludeExports?: boolean;
  excludeSmall?: boolean;
  threshold?: string;
  format?: 'table' | 'json' | 'dot';
  showReasons?: boolean;
  verbose?: boolean;
  snapshot?: string;
  layerEntryPoints?: string; // Comma-separated list of layer names
}

export interface DepCyclesOptions extends BaseCommandOptions {
  minLength?: string;
  maxLength?: string;
  includeExternal?: boolean;
  format?: 'table' | 'json' | 'dot';
  sort?: 'length' | 'complexity';
  limit?: string;
  snapshot?: string;
}

export interface DependencyTreeNode {
  id: string;
  name: string;
  depth: number;
  dependencies: Array<{
    direction: 'in' | 'out';
    edge: import('../../types').CallEdge;
    subtree: DependencyTreeNode | null;
  }>;
  routes?: RouteComplexityInfo[];
  isExternal?: boolean;
  isVirtual?: boolean;
  frameworkInfo?: string;
}

export interface DependencyTreeConfig {
  maxDepth: number;
  includeExternal: boolean;
  externalFilter: 'all' | 'transit' | 'none';
  showComplexity: boolean;
  rankByLength: boolean;
}