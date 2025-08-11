/**
 * Argument Usage Aggregator
 * 
 * Aggregates argument usage data from ArgumentUsageAnalyzer and calculates
 * the 5 key metrics: LocalCoverage, TransitiveCoverage, PassThroughRatio,
 * PropertyCoUsage, and DemeterDepth.
 */

import { ArgumentUsage, ParameterUsage, PassThroughInfo } from './argument-usage-analyzer';
import { CallEdge } from '../types';

export interface ArgumentUsageMetrics {
  functionId: string;
  functionName: string;
  filePath: string;
  parameterMetrics: ParameterMetrics[];
  overallMetrics: FunctionOverallMetrics;
}

export interface ParameterMetrics {
  parameterName: string;
  parameterIndex: number;
  parameterType?: string | undefined;
  
  // Core 5 metrics
  localCoverage: number;           // 0-1: used properties / total properties
  transitiveCoverage: number;      // 0-1: including downstream usage
  passThroughRatio: number;        // 0-1: passthrough / total usage
  passThroughChainLength: number;  // Max depth of passthrough chain
  demeterDepth: number;           // Max property access depth
  
  // Supporting data
  totalProperties: number;         // Total properties available in type
  usedProperties: number;          // Properties accessed locally
  passThroughCount: number;        // Number of passthrough occurrences
  totalUsageCount: number;         // Total parameter usage count
  coUsageClusterId?: string;       // ID for property co-usage cluster
  
  // Detailed information
  propertyUsageMap: Map<string, PropertyUsageInfo>;
  passThroughTargets: string[];    // Function names this param is passed to
  demeterViolations: Array<{
    chain: string[];
    depth: number;
    location: { line: number; column: number };
  }>;
}

export interface PropertyUsageInfo {
  property: string;
  localUsageCount: number;
  transitiveUsageCount: number;
  isPassedThrough: boolean;
  coUsageFrequency: number; // How often used with other properties (0-1)
}

export interface FunctionOverallMetrics {
  averageLocalCoverage: number;
  averageTransitiveCoverage: number;
  maxPassThroughRatio: number;
  maxDemeterDepth: number;
  totalParameters: number;
  problematicParameters: number; // Parameters with issues
  overFetchScore: number;        // Overall over-fetch penalty
  passThroughScore: number;      // Overall pass-through penalty  
  demeterScore: number;          // Overall Demeter penalty
}

export interface PropertyCoUsageCluster {
  clusterId: string;
  properties: string[];
  functions: string[];
  coUsageFrequency: number;
  suggestedTypeName?: string;
}

export interface AggregationConfig {
  localCoverageThreshold: number;      // Default: 0.6
  passThroughRatioThreshold: number;   // Default: 0.6
  demeterDepthThreshold: number;       // Default: 3
  transitiveAnalysisDepth: number;     // Default: 2
  minClusterSize: number;              // Default: 2
  layerWeights?: Map<string, number>;  // Layer-specific penalty weights
}

export class ArgumentUsageAggregator {
  private config: AggregationConfig;
  private callGraph: Map<string, CallEdge[]>;
  
  constructor(
    config: Partial<AggregationConfig> = {},
    callEdges: CallEdge[] = []
  ) {
    this.config = {
      localCoverageThreshold: 0.6,
      passThroughRatioThreshold: 0.6,
      demeterDepthThreshold: 3,
      transitiveAnalysisDepth: 2,
      minClusterSize: 2,
      ...config
    };
    
    // Build call graph for transitive analysis
    this.callGraph = this.buildCallGraph(callEdges);
  }
  
  /**
   * Aggregate argument usage data into comprehensive metrics
   */
  aggregateUsageData(usageData: ArgumentUsage[]): ArgumentUsageMetrics[] {
    const results: ArgumentUsageMetrics[] = [];
    
    // First pass: calculate basic metrics
    for (const usage of usageData) {
      const metrics = this.calculateBasicMetrics(usage);
      results.push(metrics);
    }
    
    // Second pass: calculate transitive coverage using call graph
    this.calculateTransitiveCoverage(results);
    
    // Third pass: identify co-usage clusters
    const clusters = this.identifyCoUsageClusters(results);
    this.assignCoUsageClusters(results, clusters);
    
    return results;
  }
  
  private calculateBasicMetrics(usage: ArgumentUsage): ArgumentUsageMetrics {
    const parameterMetrics: ParameterMetrics[] = [];
    
    for (const paramUsage of usage.parameterUsages) {
      const metrics = this.calculateParameterMetrics(paramUsage);
      parameterMetrics.push(metrics);
    }
    
    const overallMetrics = this.calculateOverallMetrics(parameterMetrics);
    
    return {
      functionId: usage.functionId,
      functionName: usage.functionName,
      filePath: usage.filePath,
      parameterMetrics,
      overallMetrics
    };
  }
  
  private calculateParameterMetrics(paramUsage: ParameterUsage): ParameterMetrics {
    // Use accurate property count if available, otherwise fall back to estimation
    const totalProperties = paramUsage.actualPropertyCount !== undefined
      ? paramUsage.actualPropertyCount
      : this.estimateTypeProperties(paramUsage.parameterType);
    const usedProperties = paramUsage.localUsage.accessedProperties.size;
    
    // Calculate local coverage
    const localCoverage = totalProperties > 0 ? usedProperties / totalProperties : 1.0;
    
    // Calculate pass-through ratio
    const passThroughCount = paramUsage.passThrough.length;
    const totalUsageCount = paramUsage.localUsage.totalAccesses + passThroughCount;
    const passThroughRatio = totalUsageCount > 0 ? passThroughCount / totalUsageCount : 0;
    
    // Calculate pass-through chain length (max depth)
    const passThroughChainLength = this.calculateMaxPassThroughChain(paramUsage.passThrough);
    
    // Get Demeter depth
    const demeterDepth = Math.max(
      paramUsage.localUsage.maxDepth,
      ...paramUsage.demeterViolations.map(v => v.depth)
    );
    
    // Build property usage map
    const propertyUsageMap = this.buildPropertyUsageMap(paramUsage);
    
    // Get pass-through targets
    const passThroughTargets = paramUsage.passThrough.map(pt => pt.targetFunctionName);
    
    return {
      parameterName: paramUsage.parameterName,
      parameterIndex: paramUsage.parameterIndex,
      parameterType: paramUsage.parameterType ?? undefined,
      localCoverage,
      transitiveCoverage: localCoverage, // Will be updated in second pass
      passThroughRatio,
      passThroughChainLength,
      demeterDepth,
      totalProperties,
      usedProperties,
      passThroughCount,
      totalUsageCount,
      propertyUsageMap,
      passThroughTargets,
      demeterViolations: paramUsage.demeterViolations.map(v => ({
        chain: v.propertyChain,
        depth: v.depth,
        location: v.location
      }))
    };
  }
  
  private calculateOverallMetrics(parameterMetrics: ParameterMetrics[]): FunctionOverallMetrics {
    if (parameterMetrics.length === 0) {
      return {
        averageLocalCoverage: 1.0,
        averageTransitiveCoverage: 1.0,
        maxPassThroughRatio: 0,
        maxDemeterDepth: 0,
        totalParameters: 0,
        problematicParameters: 0,
        overFetchScore: 0,
        passThroughScore: 0,
        demeterScore: 0
      };
    }
    
    const averageLocalCoverage = parameterMetrics.reduce((sum, p) => sum + p.localCoverage, 0) / parameterMetrics.length;
    const averageTransitiveCoverage = parameterMetrics.reduce((sum, p) => sum + p.transitiveCoverage, 0) / parameterMetrics.length;
    const maxPassThroughRatio = Math.max(...parameterMetrics.map(p => p.passThroughRatio));
    const maxDemeterDepth = Math.max(...parameterMetrics.map(p => p.demeterDepth));
    
    // Count problematic parameters
    const problematicParameters = parameterMetrics.filter(p => 
      p.localCoverage < this.config.localCoverageThreshold ||
      p.passThroughRatio > this.config.passThroughRatioThreshold ||
      p.demeterDepth >= this.config.demeterDepthThreshold
    ).length;
    
    // Calculate penalty scores
    const overFetchScore = this.calculateOverFetchScore(parameterMetrics);
    const passThroughScore = this.calculatePassThroughScore(parameterMetrics);
    const demeterScore = this.calculateDemeterScore(parameterMetrics);
    
    return {
      averageLocalCoverage,
      averageTransitiveCoverage,
      maxPassThroughRatio,
      maxDemeterDepth,
      totalParameters: parameterMetrics.length,
      problematicParameters,
      overFetchScore,
      passThroughScore,
      demeterScore
    };
  }
  
  private calculateTransitiveCoverage(results: ArgumentUsageMetrics[]): void {
    // Build function ID to results mapping
    const functionMap = new Map<string, ArgumentUsageMetrics>();
    for (const result of results) {
      functionMap.set(result.functionId, result);
    }
    
    // For each parameter, analyze downstream usage through call graph
    for (const result of results) {
      for (const paramMetric of result.parameterMetrics) {
        const transitiveUsage = this.analyzeTransitiveUsage(
          result.functionId,
          paramMetric,
          functionMap,
          0,
          new Set()
        );
        
        // Update transitive coverage
        const totalTransitiveProperties = Math.max(paramMetric.totalProperties, 1);
        paramMetric.transitiveCoverage = Math.min(1.0, transitiveUsage.size / totalTransitiveProperties);
        
        // Update property usage map with transitive data
        for (const [property, usageInfo] of paramMetric.propertyUsageMap) {
          usageInfo.transitiveUsageCount = transitiveUsage.has(property) ? 1 : 0;
        }
      }
      
      // Recalculate overall metrics with updated transitive coverage
      result.overallMetrics.averageTransitiveCoverage = 
        result.parameterMetrics.reduce((sum, p) => sum + p.transitiveCoverage, 0) / 
        Math.max(result.parameterMetrics.length, 1);
    }
  }
  
  private analyzeTransitiveUsage(
    functionId: string,
    paramMetric: ParameterMetrics,
    functionMap: Map<string, ArgumentUsageMetrics>,
    depth: number,
    visited: Set<string>
  ): Set<string> {
    if (depth >= this.config.transitiveAnalysisDepth || visited.has(functionId)) {
      return new Set();
    }
    
    visited.add(functionId);
    const transitiveProperties = new Set<string>();
    
    // Add locally used properties
    for (const property of paramMetric.propertyUsageMap.keys()) {
      transitiveProperties.add(property);
    }
    
    // Analyze pass-through targets
    const callEdges = this.callGraph.get(functionId) || [];
    
    for (const edge of callEdges) {
      const targetMetrics = functionMap.get(edge.calleeFunctionId || '');
      if (targetMetrics) {
        // Find corresponding parameter in target function
        const targetParam = targetMetrics.parameterMetrics.find(p => 
          p.parameterIndex === paramMetric.parameterIndex // Simplified matching
        );
        
        if (targetParam) {
          const downstreamUsage = this.analyzeTransitiveUsage(
            edge.calleeFunctionId || '',
            targetParam,
            functionMap,
            depth + 1,
            new Set(visited)
          );
          
          for (const property of downstreamUsage) {
            transitiveProperties.add(property);
          }
        }
      }
    }
    
    return transitiveProperties;
  }
  
  private identifyCoUsageClusters(_results: ArgumentUsageMetrics[]): PropertyCoUsageCluster[] {
    // Simplified clustering - return empty for now to avoid complexity
    return [];
  }
  
  private assignCoUsageClusters(_results: ArgumentUsageMetrics[], _clusters: PropertyCoUsageCluster[]): void {
    // Skip for now - simplified implementation
  }
  
  // Helper methods
  private buildCallGraph(callEdges: CallEdge[]): Map<string, CallEdge[]> {
    const graph = new Map<string, CallEdge[]>();
    
    for (const edge of callEdges) {
      const callerId = edge.callerFunctionId;
      if (!graph.has(callerId)) {
        graph.set(callerId, []);
      }
      graph.get(callerId)!.push(edge);
    }
    
    return graph;
  }
  
  private estimateTypeProperties(parameterType?: string): number {
    if (!parameterType) return 5; // Default assumption
    
    // Simple heuristic based on type string
    if (parameterType.includes('|')) {
      return 3; // Union type, likely fewer properties
    }
    if (parameterType.includes('&')) {
      return 8; // Intersection type, likely more properties
    }
    if (parameterType.includes('<')) {
      return 6; // Generic type
    }
    
    // Basic types
    const basicTypes = ['string', 'number', 'boolean', 'Date'];
    if (basicTypes.some(t => parameterType.includes(t))) {
      return 1;
    }
    
    return 5; // Default for object types
  }
  
  private calculateMaxPassThroughChain(passThroughInfo: PassThroughInfo[]): number {
    if (passThroughInfo.length === 0) return 0;
    
    // For now, return the count of pass-through occurrences
    return passThroughInfo.length;
  }
  
  private buildPropertyUsageMap(paramUsage: ParameterUsage): Map<string, PropertyUsageInfo> {
    const map = new Map<string, PropertyUsageInfo>();
    
    for (const property of paramUsage.localUsage.accessedProperties) {
      const localCount = paramUsage.localUsage.accessTypes.get(property)?.length || 0;
      const isPassedThrough = paramUsage.passThrough.some(pt => 
        pt.passedProperties.includes(property)
      );
      
      map.set(property, {
        property,
        localUsageCount: localCount,
        transitiveUsageCount: 0, // Will be updated later
        isPassedThrough,
        coUsageFrequency: 0 // Will be calculated in clustering phase
      });
    }
    
    return map;
  }
  
  private calculateOverFetchScore(parameterMetrics: ParameterMetrics[]): number {
    let totalPenalty = 0;
    
    for (const param of parameterMetrics) {
      const threshold = this.config.localCoverageThreshold;
      if (param.localCoverage < threshold) {
        const penalty = (threshold - param.localCoverage) * 25; // Base penalty
        const transitiveReduction = Math.pow(1 - param.transitiveCoverage, 0.5);
        totalPenalty += penalty * transitiveReduction;
      }
    }
    
    return Math.min(100, totalPenalty);
  }
  
  private calculatePassThroughScore(parameterMetrics: ParameterMetrics[]): number {
    let totalPenalty = 0;
    
    for (const param of parameterMetrics) {
      if (param.passThroughRatio > this.config.passThroughRatioThreshold) {
        const sigmoid = 1 / (1 + Math.exp(-(param.passThroughRatio - 0.6) * 10));
        const chainPenalty = 1 + Math.log1p(param.passThroughChainLength);
        totalPenalty += sigmoid * chainPenalty * 20;
      }
    }
    
    return Math.min(100, totalPenalty);
  }
  
  private calculateDemeterScore(parameterMetrics: ParameterMetrics[]): number {
    let totalPenalty = 0;
    
    for (const param of parameterMetrics) {
      if (param.demeterDepth >= this.config.demeterDepthThreshold) {
        const excessDepth = param.demeterDepth - this.config.demeterDepthThreshold + 1;
        totalPenalty += excessDepth * 15; // 15 points per excess depth level
      }
    }
    
    return Math.min(100, totalPenalty);
  }
}