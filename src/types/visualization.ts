/**
 * Visualization types for funcqc graph generation and rendering
 */

export type GraphFormat = 'dot' | 'svg' | 'png' | 'mermaid' | 'json';

export type GraphLayoutAlgorithm = 'hierarchical' | 'force' | 'circular' | 'tree';

export type GraphRankDirection = 'TB' | 'LR' | 'BT' | 'RL';

export type GraphNodeShape = 'box' | 'circle' | 'ellipse' | 'diamond' | 'hexagon';

export type GraphClusterBy = 'file' | 'risk' | 'complexity' | 'scc' | 'none';

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
    complexity?: number;
    linesOfCode?: number;
    fanIn?: number;
    fanOut?: number;
    riskScore?: number;
    riskLevel?: 'critical' | 'high' | 'medium' | 'low';
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'call' | 'depends' | 'similar' | 'risk' | 'cycle' | 'scc';
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
  nodes: string[];
  color?: string;
  style?: 'filled' | 'outlined' | 'dashed';
  metadata?: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  metadata: {
    title: string;
    description?: string;
    generated: string;
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
  showFanIn?: boolean;
  showFanOut?: boolean;
  showDepth?: boolean;
  highlightHubs?: boolean;
  highlightUtility?: boolean;
  highlightIsolated?: boolean;
  hubThreshold?: number;
  utilityThreshold?: number;
}

export interface RiskGraphOptions extends GraphRenderOptions {
  showRiskScores?: boolean;
  showPatterns?: boolean;
  showRecommendations?: boolean;
  riskLevelColors?: Record<string, string>;
  patternColors?: Record<string, string>;
  minRiskScore?: number;
  maxRiskScore?: number;
}

export interface CircularDependencyGraphOptions extends GraphRenderOptions {
  showCycleNumbers?: boolean;
  showCyclePaths?: boolean;
  cycleLengthColors?: Record<number, string>;
  minCycleLength?: number;
  maxCycleLength?: number;
}

export interface SCCGraphOptions extends GraphRenderOptions {
  showComponentSizes?: boolean;
  showRecursiveIndicators?: boolean;
  componentSizeColors?: Record<number, string>;
  recursiveColor?: string;
  minComponentSize?: number;
  maxComponentSize?: number;
}

export interface DeadCodeGraphOptions extends GraphRenderOptions {
  showDeadCodeClusters?: boolean;
  showLiveCodeClusters?: boolean;
  deadCodeColor?: string;
  liveCodeColor?: string;
  showReachabilityPaths?: boolean;
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
    minComplexity?: number;
    maxComplexity?: number;
    minRiskScore?: number;
    maxRiskScore?: number;
    files?: string[];
    namePattern?: string;
  };
  edges?: {
    types?: string[];
    minWeight?: number;
    maxWeight?: number;
    includeExternal?: boolean;
  };
  clusters?: {
    types?: string[];
    minSize?: number;
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
  affectedNodes: string[];
  affectedEdges: string[];
  metrics?: Record<string, number>;
}

export interface GraphRecommendation {
  type: 'refactor' | 'architectural' | 'performance' | 'maintenance';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  affectedNodes: string[];
  actionItems: string[];
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