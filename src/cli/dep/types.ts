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
    filePath?: string | undefined;
    startLine?: number | undefined;
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
  scope?: string;
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
  scope?: string;
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
  scope?: string;
}

export interface DepLintOptions extends BaseCommandOptions {
  config?: string;
  format?: 'table' | 'json';
  severity?: 'error' | 'warning' | 'info';
  maxViolations?: string;
  includeMetrics?: boolean;
  // TODO: fix?: boolean; // Reserved for future auto-fix functionality
  failOn?: 'error' | 'warning' | 'any';
  snapshot?: string;
  showLayers?: boolean;
  showRules?: boolean;
  showConfig?: boolean;
  showConsolidation?: boolean;
  dryRun?: boolean;
  scope?: string;
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
  scope?: string;
}

export interface DepCyclesOptions extends BaseCommandOptions {
  minSize?: string;
  maxLength?: string;
  includeExternal?: boolean;
  format?: 'table' | 'json' | 'dot';
  sort?: 'length' | 'complexity' | 'importance';
  limit?: string;
  snapshot?: string;
  scope?: string;
  // New filtering options
  includeRecursive?: boolean;
  includeClear?: boolean;
  includeAll?: boolean;
  excludeRecursive?: boolean;
  excludeClear?: boolean;
  minComplexity?: string;
  crossModuleOnly?: boolean;
  crossLayerOnly?: boolean;
  recursiveOnly?: boolean;
  sortByImportance?: boolean;
}

/**
 * Cycle classification types
 */
export enum CycleType {
  RECURSIVE = 'recursive',    // Single function calling itself
  MUTUAL = 'mutual',         // 2-3 functions mutual calls
  COMPLEX = 'complex'        // 4+ functions complex cycle
}

export enum ImportanceLevel {
  CRITICAL = 'critical',     // Cross-layer cycles
  HIGH = 'high',            // Cross-module cycles
  MEDIUM = 'medium',        // Cross-file cycles
  LOW = 'low'               // Same file cycles
}

/**
 * Classified cycle with importance scoring
 */
export interface ClassifiedCycle {
  id: string;
  nodes: string[];                    // Function IDs in the cycle
  type: CycleType;
  importance: ImportanceLevel;
  score: number;                      // 0-10 importance score
  crossModule: boolean;
  crossLayer: boolean;
  crossFile: boolean;
  fileCount: number;                  // Number of unique files
  moduleCount: number;                // Number of unique modules
  layerCount: number;                 // Number of unique layers
  cyclomaticComplexity: number;       // Total CC of functions in cycle
  averageComplexity: number;          // Average CC per function
  recommendations: string[];          // Suggested improvements
}

/**
 * Enhanced cycles analysis result
 */
export interface CyclesAnalysisResult {
  classifiedCycles: ClassifiedCycle[];
  totalCycles: number;
  filteredCycles: number;
  filterStats: {
    excludedRecursive: number;
    excludedClear: number;
    excludedByComplexity: number;
    excludedBySize: number;
  };
  importanceSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
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