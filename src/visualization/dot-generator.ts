import { FunctionInfo, CallEdge } from '../types';
import { DependencyMetrics } from '../analyzers/dependency-metrics';
import { ComprehensiveRiskAssessment } from '../analyzers/comprehensive-risk-scorer';
import { StronglyConnectedComponent } from '../analyzers/scc-analyzer';
import { GraphClusterBy } from '../types/visualization';

export interface DotGraphOptions {
  title?: string;
  rankdir?: 'TB' | 'LR' | 'BT' | 'RL';
  nodeShape?: 'box' | 'circle' | 'ellipse' | 'diamond';
  nodeColor?: string;
  edgeColor?: string;
  highlightColor?: string;
  showLabels?: boolean;
  maxLabelLength?: number;
  includeMetrics?: boolean;
  clusterBy?: GraphClusterBy;
}

export interface DotNode {
  id: string;
  label: string;
  attributes: Record<string, string>;
  cluster?: string | undefined;
}

export interface DotEdge {
  source: string;
  target: string;
  attributes: Record<string, string>;
}

export interface DotGraph {
  nodes: DotNode[];
  edges: DotEdge[];
  clusters: Map<string, { label: string; attributes: Record<string, string> }>;
}

/**
 * DOT format graph generator for various funcqc visualizations
 */
export class DotGenerator {
  private sanitizedIdMap = new Map<string, string>();
  private sanitizedIdCounter = 0;
  
  private readonly defaultOptions: Required<DotGraphOptions> = {
    title: 'Function Graph',
    rankdir: 'TB',
    nodeShape: 'box',
    nodeColor: 'lightblue',
    edgeColor: 'black',
    highlightColor: 'red',
    showLabels: true,
    maxLabelLength: 30,
    includeMetrics: false,
    clusterBy: 'file',
  };

  /**
   * Generate DOT graph from dependency metrics
   */
  generateDependencyGraph(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    dependencyMetrics: DependencyMetrics[],
    options: Partial<DotGraphOptions> = {}
  ): string {
    const opts = { ...this.defaultOptions, ...options };
    const graph = this.createDependencyGraph(functions, callEdges, dependencyMetrics, opts);
    
    return this.renderDotGraph(graph, opts);
  }

  /**
   * Generate DOT graph from risk assessment
   */
  generateRiskGraph(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    riskAssessments: ComprehensiveRiskAssessment[],
    options: Partial<DotGraphOptions> = {}
  ): string {
    const opts = { ...this.defaultOptions, ...options };
    const graph = this.createRiskGraph(functions, callEdges, riskAssessments, opts);
    
    return this.renderDotGraph(graph, opts);
  }

  /**
   * Generate DOT graph from circular dependencies
   */
  generateCircularDependencyGraph(
    functions: FunctionInfo[],
    cycles: string[][],
    options: Partial<DotGraphOptions> = {}
  ): string {
    const opts = { ...this.defaultOptions, ...options };
    const graph = this.createCircularDependencyGraph(functions, cycles, opts);
    
    return this.renderDotGraph(graph, opts);
  }

  /**
   * Generate DOT graph from strongly connected components
   */
  generateSCCGraph(
    functions: FunctionInfo[],
    components: StronglyConnectedComponent[],
    options: Partial<DotGraphOptions> = {}
  ): string {
    const opts = { ...this.defaultOptions, ...options };
    const graph = this.createSCCGraph(functions, components, opts);
    
    return this.renderDotGraph(graph, opts);
  }

  /**
   * Generate DOT graph for dead code analysis
   */
  generateDeadCodeGraph(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    deadFunctions: Set<string>,
    options: Partial<DotGraphOptions> = {}
  ): string {
    const opts = { ...this.defaultOptions, ...options };
    const graph = this.createDeadCodeGraph(functions, callEdges, deadFunctions, opts);
    
    return this.renderDotGraph(graph, opts);
  }

  private createDependencyGraph(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    dependencyMetrics: DependencyMetrics[],
    options: Required<DotGraphOptions>
  ): DotGraph {
    const graph: DotGraph = { nodes: [], edges: [], clusters: new Map() };
    const functionMap = new Map(functions.map(f => [f.id, f]));
    const metricsMap = new Map(dependencyMetrics.map(m => [m.functionId, m]));

    // Create nodes
    for (const func of functions) {
      const metrics = metricsMap.get(func.id);
      const label = this.truncateLabel(func.name, options.maxLabelLength);
      
      const attributes: Record<string, string> = {
        shape: options.nodeShape,
        style: 'filled',
        fillcolor: this.getDependencyNodeColor(metrics, options),
        label: options.showLabels ? `"${label}"` : `"${func.name}"`,
      };

      if (options.includeMetrics && metrics) {
        attributes['tooltip'] = `"Fan-in: ${metrics.fanIn}\\nFan-out: ${metrics.fanOut}"`;
      }

      const clusterId = options.clusterBy === 'file' 
        ? `cluster_${this.sanitizeNodeId(func.filePath)}`
        : undefined;

      graph.nodes.push({
        id: this.sanitizeNodeId(func.id),
        label,
        attributes,
        cluster: clusterId,
      });
    }

    // Create edges
    for (const edge of callEdges) {
      const caller = functionMap.get(edge.callerFunctionId);
      const callee = functionMap.get(edge.calleeFunctionId || '');
      
      if (!caller || !callee) continue;

      const attributes: Record<string, string> = {
        color: options.edgeColor,
        tooltip: `"${caller.name} → ${callee.name}"`,
      };

      // Color edges based on call type
      if (edge.callType === 'conditional') {
        attributes['style'] = 'dashed';
      }

      graph.edges.push({
        source: this.sanitizeNodeId(edge.callerFunctionId),
        target: this.sanitizeNodeId(edge.calleeFunctionId || ''),
        attributes,
      });
    }

    // Create clusters
    if (options.clusterBy === 'file') {
      this.createFileClusters(graph, functions);
    } else if (options.clusterBy === 'complexity') {
      this.createComplexityClusters(graph, functions, dependencyMetrics);
    }

    return graph;
  }

  private createRiskGraph(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    riskAssessments: ComprehensiveRiskAssessment[],
    options: Required<DotGraphOptions>
  ): DotGraph {
    const graph: DotGraph = { nodes: [], edges: [], clusters: new Map() };
    const functionMap = new Map(functions.map(f => [f.id, f]));
    const riskMap = new Map(riskAssessments.map(r => [r.functionId, r]));

    // Create nodes
    for (const func of functions) {
      const risk = riskMap.get(func.id);
      const label = this.truncateLabel(func.name, options.maxLabelLength);
      
      const attributes: Record<string, string> = {
        shape: options.nodeShape,
        style: 'filled',
        fillcolor: this.getRiskNodeColor(risk, options),
        label: options.showLabels ? `"${label}"` : `"${func.name}"`,
      };

      if (options.includeMetrics && risk) {
        attributes['tooltip'] = `"Risk: ${risk.overallScore}\\nLevel: ${risk.riskLevel}\\nPriority: ${risk.priority}"`;
      }

      const clusterId = options.clusterBy === 'risk' && risk?.riskLevel 
        ? `cluster_risk_${risk.riskLevel}` 
        : options.clusterBy === 'file' 
        ? `cluster_${this.sanitizeNodeId(func.filePath)}`
        : undefined;

      graph.nodes.push({
        id: this.sanitizeNodeId(func.id),
        label,
        attributes,
        cluster: clusterId,
      });
    }

    // Create edges (same as dependency graph)
    for (const edge of callEdges) {
      const caller = functionMap.get(edge.callerFunctionId);
      const callee = functionMap.get(edge.calleeFunctionId || '');
      
      if (!caller || !callee) continue;

      const callerRisk = riskMap.get(edge.callerFunctionId);
      const calleeRisk = riskMap.get(edge.calleeFunctionId || '');
      
      const attributes: Record<string, string> = {
        color: this.getRiskEdgeColor(callerRisk, calleeRisk, options),
        tooltip: `"${caller.name} → ${callee.name}"`,
      };

      graph.edges.push({
        source: this.sanitizeNodeId(edge.callerFunctionId),
        target: this.sanitizeNodeId(edge.calleeFunctionId || ''),
        attributes,
      });
    }

    // Create clusters
    if (options.clusterBy === 'risk') {
      this.createRiskClusters(graph, riskAssessments);
    } else if (options.clusterBy === 'file') {
      this.createFileClusters(graph, functions);
    } else if (options.clusterBy === 'complexity') {
      this.createComplexityClusters(graph, functions, riskAssessments);
    }

    return graph;
  }

  private createCircularDependencyGraph(
    functions: FunctionInfo[],
    cycles: string[][],
    options: Required<DotGraphOptions>
  ): DotGraph {
    const graph: DotGraph = { nodes: [], edges: [], clusters: new Map() };
    const cycleNodes = new Set<string>();

    // Collect all functions in cycles
    for (const cycle of cycles) {
      for (const funcName of cycle) {
        cycleNodes.add(funcName);
      }
    }

    // Create nodes
    for (const func of functions) {
      if (!cycleNodes.has(func.name)) continue;

      const label = this.truncateLabel(func.name, options.maxLabelLength);
      const attributes: Record<string, string> = {
        shape: options.nodeShape,
        style: 'filled',
        fillcolor: options.highlightColor,
        label: options.showLabels ? `"${label}"` : `"${func.name}"`,
      };

      graph.nodes.push({
        id: this.sanitizeNodeId(func.name),
        label,
        attributes,
      });
    }

    // Create edges for cycles
    for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex++) {
      const cycle = cycles[cycleIndex];
      
      for (let i = 0; i < cycle.length; i++) {
        const from = cycle[i];
        const to = cycle[(i + 1) % cycle.length];
        
        const attributes: Record<string, string> = {
          color: options.highlightColor,
          penwidth: '2',
          tooltip: `"Cycle ${cycleIndex + 1}: ${from} → ${to}"`,
        };

        graph.edges.push({
          source: this.sanitizeNodeId(from),
          target: this.sanitizeNodeId(to),
          attributes,
        });
      }
    }

    return graph;
  }

  private createSCCGraph(
    functions: FunctionInfo[],
    components: StronglyConnectedComponent[],
    options: Required<DotGraphOptions>
  ): DotGraph {
    const graph: DotGraph = { nodes: [], edges: [], clusters: new Map() };
    const functionMap = new Map(functions.map(f => [f.id, f]));

    // Create nodes
    for (const component of components) {
      for (const funcId of component.functionIds) {
        const func = functionMap.get(funcId);
        if (!func) continue;

        const label = this.truncateLabel(func.name, options.maxLabelLength);
        const attributes: Record<string, string> = {
          shape: options.nodeShape,
          style: 'filled',
          fillcolor: this.getSCCNodeColor(component, options),
          label: options.showLabels ? `"${label}"` : `"${func.name}"`,
        };

        if (options.includeMetrics) {
          attributes['tooltip'] = `"Component: ${component.id}\\nSize: ${component.size}\\nRecursive: ${component.isRecursive}"`;
        }

        graph.nodes.push({
          id: this.sanitizeNodeId(funcId),
          label,
          attributes,
          cluster: `cluster_${component.id}`,
        });
      }
    }

    // Create edges
    for (const component of components) {
      for (const edge of component.edges) {
        const attributes: Record<string, string> = {
          color: options.highlightColor,
          penwidth: '2',
          tooltip: `"SCC ${component.id} internal call"`,
        };

        if (edge.calleeFunctionId) {
          graph.edges.push({
            source: this.sanitizeNodeId(edge.callerFunctionId),
            target: this.sanitizeNodeId(edge.calleeFunctionId),
            attributes,
          });
        }
      }
    }

    // Create SCC clusters
    for (const component of components) {
      graph.clusters.set(`cluster_${component.id}`, {
        label: `SCC ${component.id} (${component.size} functions)`,
        attributes: {
          style: 'filled',
          fillcolor: 'lightgray',
          color: 'black',
        },
      });
    }

    return graph;
  }

  private createDeadCodeGraph(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    deadFunctions: Set<string>,
    options: Required<DotGraphOptions>
  ): DotGraph {
    const graph: DotGraph = { nodes: [], edges: [], clusters: new Map() };
    const functionMap = new Map(functions.map(f => [f.id, f]));

    // Create nodes
    for (const func of functions) {
      const isDead = deadFunctions.has(func.id);
      const label = this.truncateLabel(func.name, options.maxLabelLength);
      
      const attributes: Record<string, string> = {
        shape: options.nodeShape,
        style: 'filled',
        fillcolor: isDead ? 'lightcoral' : options.nodeColor,
        label: options.showLabels ? `"${label}"` : `"${func.name}"`,
      };

      if (isDead) {
        attributes['style'] = 'filled,dashed';
        attributes['tooltip'] = `"Dead code: ${func.name}"`;
      }

      graph.nodes.push({
        id: this.sanitizeNodeId(func.id),
        label,
        attributes,
        cluster: isDead ? 'cluster_dead' : 'cluster_live',
      });
    }

    // Create edges
    for (const edge of callEdges) {
      const caller = functionMap.get(edge.callerFunctionId);
      const callee = functionMap.get(edge.calleeFunctionId || '');
      
      if (!caller || !callee) continue;

      const callerDead = deadFunctions.has(edge.callerFunctionId);
      const calleeDead = deadFunctions.has(edge.calleeFunctionId || '');
      
      const attributes: Record<string, string> = {
        color: (callerDead || calleeDead) ? 'lightcoral' : options.edgeColor,
        tooltip: `"${caller.name} → ${callee.name}"`,
      };

      if (callerDead || calleeDead) {
        attributes['style'] = 'dashed';
      }

      graph.edges.push({
        source: this.sanitizeNodeId(edge.callerFunctionId),
        target: this.sanitizeNodeId(edge.calleeFunctionId || ''),
        attributes,
      });
    }

    // Create clusters
    graph.clusters.set('cluster_live', {
      label: 'Live Code',
      attributes: {
        style: 'filled',
        fillcolor: 'lightgreen',
        color: 'darkgreen',
      },
    });

    graph.clusters.set('cluster_dead', {
      label: 'Dead Code',
      attributes: {
        style: 'filled',
        fillcolor: 'lightcoral',
        color: 'darkred',
      },
    });

    return graph;
  }

  private renderDotGraph(graph: DotGraph, options: Required<DotGraphOptions>): string {
    const lines: string[] = [];
    
    // Graph header
    lines.push('digraph G {');
    lines.push(`  label="${options.title}";`);
    lines.push(`  rankdir=${options.rankdir};`);
    lines.push('  node [fontsize=10];');
    lines.push('  edge [fontsize=8];');
    lines.push('');

    // Clusters
    for (const [clusterId, cluster] of graph.clusters) {
      lines.push(`  subgraph ${clusterId} {`);
      lines.push(`    label="${cluster.label}";`);
      
      for (const [key, value] of Object.entries(cluster.attributes)) {
        lines.push(`    ${key}=${value};`);
      }
      
      // Add nodes belonging to this cluster
      for (const node of graph.nodes) {
        if (node.cluster === clusterId) {
          const attrs = Object.entries(node.attributes)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ');
          lines.push(`    "${node.id}" [${attrs}];`);
        }
      }
      
      lines.push('  }');
      lines.push('');
    }

    // Standalone nodes (not in clusters)
    for (const node of graph.nodes) {
      if (!node.cluster) {
        const attrs = Object.entries(node.attributes)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ');
        lines.push(`  "${node.id}" [${attrs}];`);
      }
    }

    if (graph.nodes.some(n => !n.cluster)) {
      lines.push('');
    }

    // Edges
    for (const edge of graph.edges) {
      const attrs = Object.entries(edge.attributes)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
      lines.push(`  "${edge.source}" -> "${edge.target}" [${attrs}];`);
    }

    lines.push('}');
    
    return lines.join('\n');
  }

  private getDependencyNodeColor(metrics: DependencyMetrics | undefined, options: Required<DotGraphOptions>): string {
    if (!metrics) return options.nodeColor;
    
    // High priority: Super-hub (both central collector and distributor)
    if (metrics.fanIn > 5 && metrics.fanOut > 5) return 'red';
    
    // Medium priority: Single-axis characteristics
    if (metrics.fanIn > 5) return 'orange';        // Hub (many callers)
    if (metrics.fanOut > 5) return 'yellow';       // Utility (many callees)
    if (metrics.fanIn === 0 && metrics.fanOut === 0) return 'lightgray';  // Isolated
    
    return options.nodeColor;
  }

  private getRiskNodeColor(risk: ComprehensiveRiskAssessment | undefined, options: Required<DotGraphOptions>): string {
    if (!risk) return options.nodeColor;
    
    switch (risk.riskLevel) {
      case 'critical': return 'red';
      case 'high': return 'orange';
      case 'medium': return 'yellow';
      case 'low': return 'lightgreen';
      default: return options.nodeColor;
    }
  }

  private getRiskEdgeColor(callerRisk: ComprehensiveRiskAssessment | undefined, calleeRisk: ComprehensiveRiskAssessment | undefined, options: Required<DotGraphOptions>): string {
    if (callerRisk?.riskLevel === 'critical' || calleeRisk?.riskLevel === 'critical') {
      return 'red';
    }
    if (callerRisk?.riskLevel === 'high' || calleeRisk?.riskLevel === 'high') {
      return 'orange';
    }
    return options.edgeColor;
  }

  private getSCCNodeColor(component: StronglyConnectedComponent, options: Required<DotGraphOptions>): string {
    if (component.isRecursive) return 'lightyellow';
    if (component.size > 5) return 'lightcoral';
    if (component.size > 2) return 'lightblue';
    return options.nodeColor;
  }

  private createFileClusters(graph: DotGraph, functions: FunctionInfo[]): void {
    const clusterMap = new Map<string, string>();
    const fileClusterAttrs = {
      style: 'filled',
      fillcolor: 'lightgray',
      color: 'black',
    };
    
    // O(N) optimization: Pre-build function lookup map
    const functionMap = new Map(functions.map(f => [this.sanitizeNodeId(f.id), f]));
    
    // O(N): Single pass through nodes to assign clusters
    for (const node of graph.nodes) {
      // Find corresponding function to get file path
      const func = functionMap.get(node.id);
      if (!func) continue;
      
      const file = func.filePath;
      let clusterId = clusterMap.get(file);
      
      if (!clusterId) {
        clusterId = `cluster_${this.sanitizeNodeId(file)}`;
        clusterMap.set(file, clusterId);
        graph.clusters.set(clusterId, {
          label: file,
          attributes: fileClusterAttrs,
        });
      }
      
      node.cluster = clusterId;
    }
  }

  private createComplexityClusters(
    graph: DotGraph, 
    functions: FunctionInfo[], 
    metricsOrRiskAssessments: DependencyMetrics[] | ComprehensiveRiskAssessment[]
  ): void {
    const clusterMap = new Map<string, string>();
    const complexityColors = {
      low: 'lightgreen',      // CC: 1-5
      medium: 'lightyellow',  // CC: 6-10
      high: 'orange',         // CC: 11-15
      critical: 'lightcoral', // CC: 16+
    };
    
    // O(N) optimization: Pre-build lookup maps
    const functionMap = new Map(functions.map(f => [this.sanitizeNodeId(f.id), f]));
    
    let riskAssessmentMap: Map<string, ComprehensiveRiskAssessment> | undefined;
    let metricsMap: Map<string, DependencyMetrics> | undefined;
    
    if (metricsOrRiskAssessments.length > 0) {
      const firstItem = metricsOrRiskAssessments[0];
      if ('overallScore' in firstItem) {
        // RiskAssessment case
        riskAssessmentMap = new Map(
          (metricsOrRiskAssessments as ComprehensiveRiskAssessment[])
            .map(r => [r.functionId, r])
        );
      } else {
        // DependencyMetrics case
        metricsMap = new Map(
          (metricsOrRiskAssessments as DependencyMetrics[])
            .map(m => [m.functionId, m])
        );
      }
    }
    
    // O(N): Single pass through nodes to assign complexity clusters
    for (const node of graph.nodes) {
      const func = functionMap.get(node.id);
      if (!func) continue;
      
      // Extract complexity metric from either DependencyMetrics or RiskAssessment
      let complexityValue = 5; // default medium complexity
      
      if (riskAssessmentMap) {
        const riskAssessment = riskAssessmentMap.get(func.id);
        complexityValue = Math.round((riskAssessment?.overallScore || 50) / 5); // Map 0-100 to 0-20
      } else if (metricsMap) {
        const metrics = metricsMap.get(func.id);
        complexityValue = (metrics?.fanIn || 0) + (metrics?.fanOut || 0);
      }
      
      // Bucket complexity into categories
      const complexityLevel = complexityValue <= 5 ? 'low' :
                            complexityValue <= 10 ? 'medium' :
                            complexityValue <= 15 ? 'high' : 'critical';
      
      let clusterId = clusterMap.get(complexityLevel);
      
      if (!clusterId) {
        clusterId = `cluster_complexity_${complexityLevel}`;
        clusterMap.set(complexityLevel, clusterId);
        graph.clusters.set(clusterId, {
          label: `${complexityLevel.toUpperCase()} Complexity`,
          attributes: {
            style: 'filled',
            fillcolor: complexityColors[complexityLevel as keyof typeof complexityColors],
            color: 'black',
          },
        });
      }
      
      node.cluster = clusterId;
    }
  }

  private createRiskClusters(graph: DotGraph, riskAssessments: ComprehensiveRiskAssessment[]): void {
    const riskGroups = new Map<string, string[]>();
    
    for (const assessment of riskAssessments) {
      const level = assessment.riskLevel;
      if (!riskGroups.has(level)) {
        riskGroups.set(level, []);
      }
      riskGroups.get(level)!.push(assessment.functionId);
    }

    const riskColors = {
      critical: 'lightcoral',
      high: 'lightyellow',
      medium: 'lightblue',
      low: 'lightgreen',
    };

    for (const [level, funcIds] of riskGroups) {
      const clusterId = `cluster_risk_${level}`;
      graph.clusters.set(clusterId, {
        label: `${level.toUpperCase()} Risk`,
        attributes: {
          style: 'filled',
          fillcolor: riskColors[level as keyof typeof riskColors] || 'lightgray',
          color: 'black',
        },
      });

      // Update node clusters - O(N) optimization using Set for fast lookup
      const sanitizedIdsSet = new Set(funcIds.map(id => this.sanitizeNodeId(id)));
      for (const node of graph.nodes) {
        if (sanitizedIdsSet.has(node.id)) {
          node.cluster = clusterId;
        }
      }
    }
  }

  private truncateLabel(label: string, maxLength: number): string {
    if (label.length <= maxLength) return label;
    return label.substring(0, maxLength - 3) + '...';
  }

  private sanitizeNodeId(id: string): string {
    // Check if already sanitized
    const cached = this.sanitizedIdMap.get(id);
    if (cached) return cached;
    
    // Replace characters that are problematic in DOT format
    const cleaned = id.replace(/[^a-zA-Z0-9_]/g, '_');
    
    // DOT requires identifiers to start with letter or underscore, not digit
    let result = /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
    
    // Check for collision with existing sanitized IDs
    const existingValues = Array.from(this.sanitizedIdMap.values());
    if (existingValues.includes(result)) {
      result = `${result}_${this.sanitizedIdCounter++}`;
    }
    
    this.sanitizedIdMap.set(id, result);
    return result;
  }
}