/**
 * Layer-based PageRank Analysis
 * 
 * Performs PageRank analysis separately for each architectural layer
 * to avoid cross-layer pollution (e.g., DatabaseError dominating all layers)
 */

import { FunctionInfo, CallEdge } from '../../../types';
import { PageRankCalculator, PageRankScore } from '../../../analyzers/pagerank-calculator';
import { ArchitectureConfigManager } from '../../../config/architecture-config';

export interface LayerPageRankResult {
  layerName: string;
  functionCount: number;
  scores: PageRankScore[];
  topFunctions: Array<{
    functionId: string;
    functionName: string;
    filePath: string;
    startLine: number;
    centrality: number;
    absoluteScore: number;
  }>;
  averageScore: number;
  maxScore: number;
  giniCoefficient: number;
}

export interface LayerBasedPageRankAnalysis {
  overallMetrics: {
    totalFunctions: number;
    totalLayers: number;
    analyzedLayers: number;
  };
  layerResults: LayerPageRankResult[];
  crossLayerInsights: string[];
}

/**
 * Detect which layer a function belongs to based on architecture config
 */
function detectFunctionLayer(
  functionInfo: FunctionInfo,
  layers: Record<string, string[]>
): string | null {
  const normalizedPath = functionInfo.filePath.replace(/\\/g, '/');
  
  for (const [layerName, patterns] of Object.entries(layers)) {
    for (const pattern of patterns) {
      if (matchesPattern(normalizedPath, pattern)) {
        return layerName;
      }
    }
  }
  
  return null;
}

/**
 * Match file path against glob-like pattern
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Remove leading ./ if present
  const cleanPattern = pattern.replace(/^\.\//, '');
  const cleanPath = filePath.replace(/^\.\//, '');
  
  // Convert glob pattern to regex
  const regexPattern = cleanPattern
    .replace(/\*\*/g, '§§DOUBLESTAR§§')  // Temporary placeholder
    .replace(/\*/g, '[^/]*')              // Single * matches anything except /
    .replace(/§§DOUBLESTAR§§/g, '.*')    // ** matches anything including /
    .replace(/\?/g, '[^/]');              // ? matches single character except /
  
  const regex = new RegExp(`${regexPattern}`, 'i');
  return regex.test(cleanPath);
}

/**
 * Calculate Gini coefficient for a set of scores
 */
function calculateGiniCoefficient(scores: number[]): number {
  if (scores.length === 0) return 0;
  
  const sortedScores = [...scores].sort((a, b) => a - b);
  const n = sortedScores.length;
  const meanScore = scores.reduce((sum, score) => sum + score, 0) / n;
  
  if (meanScore === 0) return 0;
  
  let giniSum = 0;
  for (let i = 0; i < n; i++) {
    giniSum += (2 * (i + 1) - n - 1) * sortedScores[i];
  }
  
  return giniSum / (n * meanScore * (n - 1));
}

/**
 * Perform layer-based PageRank analysis
 */
export async function performLayerBasedPageRank(
  functions: FunctionInfo[],
  callEdges: CallEdge[]
): Promise<LayerBasedPageRankAnalysis> {
  // Load architecture configuration
  const configManager = new ArchitectureConfigManager();
  const archConfig = configManager.load();
  
  if (!archConfig.layers || Object.keys(archConfig.layers).length === 0) {
    throw new Error('No layer definitions found in architecture configuration');
  }
  
  // Group functions by layer
  const functionsByLayer = new Map<string, FunctionInfo[]>();
  const unmappedFunctions: FunctionInfo[] = [];
  
  for (const func of functions) {
    const layer = detectFunctionLayer(func, archConfig.layers);
    if (layer) {
      const layerFunctions = functionsByLayer.get(layer) || [];
      layerFunctions.push(func);
      functionsByLayer.set(layer, layerFunctions);
    } else {
      unmappedFunctions.push(func);
    }
  }
  
  // Create function ID to layer mapping for edge filtering
  const functionLayerMap = new Map<string, string>();
  for (const [layer, funcs] of functionsByLayer.entries()) {
    for (const func of funcs) {
      functionLayerMap.set(func.id, layer);
    }
  }
  
  // Perform PageRank analysis for each layer
  const layerResults: LayerPageRankResult[] = [];
  const pageRankCalculator = new PageRankCalculator({
    dampingFactor: 0.85,
    maxIterations: 100,
    tolerance: 1e-6
  });
  
  for (const [layerName, layerFunctions] of functionsByLayer.entries()) {
    if (layerFunctions.length === 0) continue;
    
    // Filter call edges to only include intra-layer calls
    const layerFunctionIds = new Set(layerFunctions.map(f => f.id));
    const intraLayerEdges = callEdges.filter(edge => 
      layerFunctionIds.has(edge.callerFunctionId) && 
      edge.calleeFunctionId && 
      layerFunctionIds.has(edge.calleeFunctionId)
    );
    
    // Calculate PageRank for this layer
    const result = pageRankCalculator.calculatePageRank(layerFunctions, intraLayerEdges);
    
    // Calculate Gini coefficient
    const scores = result.scores.map(s => s.normalizedScore);
    const giniCoefficient = calculateGiniCoefficient(scores);
    
    // Get top 5 functions with detailed info
    const topFunctions = result.scores
      .slice(0, 5)
      .map(score => ({
        functionId: score.functionId,
        functionName: score.functionName,
        filePath: score.filePath,
        startLine: score.startLine,
        centrality: score.normalizedScore,
        absoluteScore: score.score
      }));
    
    layerResults.push({
      layerName,
      functionCount: layerFunctions.length,
      scores: result.scores,
      topFunctions,
      averageScore: result.averageScore,
      maxScore: result.maxScore,
      giniCoefficient
    });
  }
  
  // Sort layers by function count (descending)
  layerResults.sort((a, b) => b.functionCount - a.functionCount);
  
  // Generate cross-layer insights
  const crossLayerInsights = generateCrossLayerInsights(
    layerResults,
    callEdges,
    functionLayerMap
  );
  
  return {
    overallMetrics: {
      totalFunctions: functions.length,
      totalLayers: Object.keys(archConfig.layers).length,
      analyzedLayers: layerResults.length
    },
    layerResults,
    crossLayerInsights
  };
}

/**
 * Generate insights about cross-layer dependencies and patterns
 */
function generateCrossLayerInsights(
  layerResults: LayerPageRankResult[],
  callEdges: CallEdge[],
  functionLayerMap: Map<string, string>
): string[] {
  const insights: string[] = [];
  
  // Analyze Gini coefficients across layers
  const highInequalityLayers = layerResults.filter(r => r.giniCoefficient > 0.7);
  if (highInequalityLayers.length > 0) {
    insights.push(
      `High centrality inequality detected in layers: ${highInequalityLayers
        .map(l => `${l.layerName} (${(l.giniCoefficient * 100).toFixed(1)}%)`)
        .join(', ')}`
    );
  }
  
  // Find layers with distributed architecture (low Gini)
  const distributedLayers = layerResults.filter(r => r.giniCoefficient < 0.4);
  if (distributedLayers.length > 0) {
    insights.push(
      `Well-distributed architecture in layers: ${distributedLayers
        .map(l => l.layerName)
        .join(', ')}`
    );
  }
  
  // Analyze cross-layer dependencies
  const crossLayerEdges = callEdges.filter(edge => {
    const callerLayer = functionLayerMap.get(edge.callerFunctionId);
    const calleeLayer = edge.calleeFunctionId ? functionLayerMap.get(edge.calleeFunctionId) : null;
    return callerLayer && calleeLayer && callerLayer !== calleeLayer;
  });
  
  if (crossLayerEdges.length > 0) {
    const crossLayerRatio = (crossLayerEdges.length / callEdges.length * 100).toFixed(1);
    insights.push(`Cross-layer dependencies: ${crossLayerRatio}% of all function calls`);
  }
  
  // Identify potential architectural concerns
  for (const result of layerResults) {
    if (result.topFunctions.length > 0 && result.topFunctions[0].centrality > 0.8) {
      const topFunc = result.topFunctions[0];
      insights.push(
        `⚠️ Potential bottleneck in ${result.layerName}: ${topFunc.functionName} ` +
        `has ${(topFunc.centrality * 100).toFixed(1)}% centrality within layer`
      );
    }
  }
  
  return insights;
}