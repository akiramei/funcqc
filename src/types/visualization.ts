/**
 * Visualization types for funcqc graph generation and rendering
 */

/** Supported output formats for graph visualization */
export type GraphFormat = 'dot' | 'svg' | 'png' | 'mermaid' | 'json';

/** Graph layout algorithms for positioning nodes and edges */
export type GraphLayoutAlgorithm = 'hierarchical' | 'force' | 'circular' | 'tree';

/** Graph rank direction for hierarchical layouts */
export type GraphRankDirection = 'TB' | 'LR' | 'BT' | 'RL';

/** Available node shapes for graph visualization */
export type GraphNodeShape = 'box' | 'circle' | 'ellipse' | 'diamond' | 'hexagon';

/** Risk levels used throughout the application - shared type for consistency */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

/** 
 * Clustering strategies for grouping related nodes
 * Note: undefined means no clustering (preferred over 'none')
 */
export type GraphClusterBy = 'file' | 'risk' | 'complexity' | 'scc';

/** ISO 8601 date string for consistent date formatting */
export type ISODateString = string;

export interface GraphNode {
  id: string;
  label: string;
  type: 'function' | 'file' | 'risk' | 'cycle' | 'scc';
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  color?: string;
  shape?: GraphNodeShape;
  cluster?: string;
  metadata?: Record<string, unknown>;
  metrics?: {
    /** Cyclomatic complexity score (typically 1-20+) */
    complexity?: number;
    /** Lines of code count */
    linesOfCode?: number;
    /** Number of functions calling this function */
    fanIn?: number;
    /** Number of functions called by this function */
    fanOut?: number;
    /** Risk score (0-100) */
    riskScore?: number;
    /** Risk level classification */
    riskLevel?: RiskLevel;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Edge type - 'dependency' is preferred over 'depends' for consistency */
  type: 'call' | 'dependency' | 'similar' | 'risk' | 'cycle' | 'scc';
  /** Edge weight (0-1 for normalized weights, or positive integer for counts) */
  weight?: number;
  color?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphCluster {
  id: string;
  label: string;
  type: 'file' | 'risk' | 'complexity' | 'scc';
  /** Read-only array of node IDs belonging to this cluster */
  nodes: readonly string[];
  color?: string;
  style?: 'filled' | 'outlined' | 'dashed';
  metadata?: Readonly<Record<string, unknown>>;
}

export interface GraphData {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  clusters: readonly GraphCluster[];
  metadata: {
    title: string;
    description?: string;
    /** ISO 8601 timestamp of graph generation */
    generated: ISODateString;
    source: string;
    version: string;
    filters?: Record<string, unknown>;
    options?: Record<string, unknown>;
  };
}

export interface GraphRenderOptions {
  title?: string;
  description?: string;
  rankdir?: GraphRankDirection;
  layout?: GraphLayoutAlgorithm;
  nodeShape?: GraphNodeShape;
  nodeColor?: string;
  edgeColor?: string;
  highlightColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontFamily?: string;
  showLabels?: boolean;
  showTooltips?: boolean;
  maxLabelLength?: number;
  includeMetrics?: boolean;
  clusterBy?: GraphClusterBy;
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  theme?: 'light' | 'dark' | 'auto';
}

export interface DependencyGraphOptions extends GraphRenderOptions {
  /** Feature flags for dependency graph visualization */
  features?: Partial<Record<'showFanIn' | 'showFanOut' | 'showDepth' | 'highlightHubs' | 'highlightUtility' | 'highlightIsolated', boolean>>;
  /** Threshold for considering a node as a hub (fan-in count) */
  hubThreshold?: number;
  /** Threshold for considering a node as utility (fan-out count) */
  utilityThreshold?: number;
}

export interface RiskGraphOptions extends GraphRenderOptions {
  /** Feature flags for risk graph visualization */
  features?: Partial<Record<'showRiskScores' | 'showPatterns' | 'showRecommendations', boolean>>;
  /** Type-safe risk level to color mapping */
  riskLevelColors?: Partial<Record<RiskLevel, string>>;
  patternColors?: Record<string, string>;
  /** Minimum risk score filter (0-100) */
  minRiskScore?: number;
  /** Maximum risk score filter (0-100) */
  maxRiskScore?: number;
}

export interface CircularDependencyGraphOptions extends GraphRenderOptions {
  /** Feature flags for circular dependency visualization */
  features?: Partial<Record<'showCycleNumbers' | 'showCyclePaths', boolean>>;
  cycleLengthColors?: Record<number, string>;
  /** Minimum cycle length to display */
  minCycleLength?: number;
  /** Maximum cycle length to display */
  maxCycleLength?: number;
}

export interface SCCGraphOptions extends GraphRenderOptions {
  /** Feature flags for SCC visualization */
  features?: Partial<Record<'showComponentSizes' | 'showRecursiveIndicators', boolean>>;
  componentSizeColors?: Record<number, string>;
  recursiveColor?: string;
  /** Minimum component size to display */
  minComponentSize?: number;
  /** Maximum component size to display */
  maxComponentSize?: number;
}

export interface DeadCodeGraphOptions extends GraphRenderOptions {
  /** Feature flags for dead code visualization */
  features?: Partial<Record<'showDeadCodeClusters' | 'showLiveCodeClusters' | 'showReachabilityPaths', boolean>>;
  deadCodeColor?: string;
  liveCodeColor?: string;
}

export interface ExportOptions {
  format: GraphFormat;
  filename?: string;
  quality?: 'low' | 'medium' | 'high';
  compression?: boolean;
  metadata?: boolean;
  embedStyles?: boolean;
}

export interface GraphFilter {
  nodes?: {
    types?: string[];
    /** Minimum complexity threshold (typically 1-20+) */
    minComplexity?: number;
    /** Maximum complexity threshold (typically 1-20+) */
    maxComplexity?: number;
    /** Minimum risk score filter (0-100) */
    minRiskScore?: number;
    /** Maximum risk score filter (0-100) */
    maxRiskScore?: number;
    files?: string[];
    /** Regular expression pattern for node name filtering */
    namePattern?: string | RegExp;
  };
  edges?: {
    types?: string[];
    /** Minimum edge weight threshold */
    minWeight?: number;
    /** Maximum edge weight threshold */
    maxWeight?: number;
    includeExternal?: boolean;
  };
  clusters?: {
    types?: string[];
    /** Minimum cluster size (number of nodes) */
    minSize?: number;
    /** Maximum cluster size (number of nodes) */
    maxSize?: number;
  };
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  averageNodeDegree: number;
  maxNodeDegree: number;
  minNodeDegree: number;
  connectedComponents: number;
  density: number;
  diameter?: number;
  averagePathLength?: number;
}

export interface GraphValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  stats: GraphStats;
}

export interface GraphRenderer {
  render(data: GraphData, options: GraphRenderOptions): Promise<string>;
  export(data: GraphData, options: ExportOptions): Promise<Buffer>;
  validate(data: GraphData): GraphValidationResult;
}

export interface GraphGenerator {
  generateGraph(data: unknown, options: GraphRenderOptions): GraphData;
  applyFilters(data: GraphData, filters: GraphFilter): GraphData;
  calculateStats(data: GraphData): GraphStats;
}

// Utility types for specific graph types
export type DependencyGraphData = GraphData & {
  metadata: GraphData['metadata'] & {
    dependencyStats: {
      totalDependencies: number;
      averageFanIn: number;
      averageFanOut: number;
      maxFanIn: number;
      maxFanOut: number;
      hubFunctions: string[];
      utilityFunctions: string[];
      isolatedFunctions: string[];
    };
  };
};

export type RiskGraphData = GraphData & {
  metadata: GraphData['metadata'] & {
    riskStats: {
      totalRisks: number;
      averageRiskScore: number;
      riskDistribution: Record<string, number>;
      criticalFunctions: string[];
      highRiskFunctions: string[];
      riskPatterns: string[];
    };
  };
};

export type CircularDependencyGraphData = GraphData & {
  metadata: GraphData['metadata'] & {
    cycleStats: {
      totalCycles: number;
      averageCycleLength: number;
      maxCycleLength: number;
      minCycleLength: number;
      cycleDistribution: Record<number, number>;
    };
  };
};

export type SCCGraphData = GraphData & {
  metadata: GraphData['metadata'] & {
    sccStats: {
      totalComponents: number;
      largestComponentSize: number;
      averageComponentSize: number;
      recursiveComponents: number;
      componentDistribution: Record<number, number>;
    };
  };
};

export type DeadCodeGraphData = GraphData & {
  metadata: GraphData['metadata'] & {
    deadCodeStats: {
      totalFunctions: number;
      deadFunctions: number;
      liveFunctions: number;
      deadCodePercentage: number;
      unreachableFromEntryPoints: string[];
      unusedExports: string[];
    };
  };
};

// Graph analysis types
export interface GraphAnalysis {
  type: 'dependency' | 'risk' | 'circular' | 'scc' | 'dead-code';
  data: GraphData;
  insights: GraphInsight[];
  recommendations: GraphRecommendation[];
}

export interface GraphInsight {
  type: 'pattern' | 'anomaly' | 'trend' | 'hotspot';
  severity: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  /** Read-only array of affected node IDs */
  affectedNodes: readonly string[];
  /** Read-only array of affected edge IDs */
  affectedEdges: readonly string[];
  metrics?: Readonly<Record<string, number>>;
}

export interface GraphRecommendation {
  type: 'refactor' | 'architectural' | 'performance' | 'maintenance';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  /** Read-only array of affected node IDs */
  affectedNodes: readonly string[];
  /** Read-only array of action items */
  actionItems: readonly string[];
}

// Mermaid-specific types
export interface MermaidOptions {
  theme?: 'default' | 'dark' | 'forest' | 'neutral';
  direction?: 'TB' | 'TD' | 'BT' | 'RL' | 'LR';
  nodeShape?: 'rectangle' | 'round' | 'stadium' | 'subroutine' | 'cylindrical' | 'circle' | 'asymmetric' | 'rhombus' | 'hexagon' | 'parallelogram';
  linkStyle?: 'normal' | 'thick' | 'dotted';
  showLabels?: boolean;
  maxLabelLength?: number;
}

export interface MermaidGraphData {
  type: 'graph' | 'flowchart' | 'gitgraph' | 'journey' | 'timeline';
  direction: MermaidOptions['direction'];
  nodes: Array<{
    id: string;
    label: string;
    shape: MermaidOptions['nodeShape'];
    class?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: 'arrow' | 'line' | 'dotted' | 'thick';
    label?: string;
  }>;
  classes: Array<{
    name: string;
    style: string;
  }>;
}