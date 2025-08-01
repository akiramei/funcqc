/**
 * Layer-based PageRank Analysis
 * 
 * Performs PageRank analysis separately for each architectural layer
 * to avoid cross-layer pollution (e.g., DatabaseError dominating all layers)
 */

import { FunctionInfo, CallEdge } from '../../../types';
import { LayerDefinition } from '../../../types/architecture';
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
  crossLayerRatio: number; // Ratio (0-1) of cross-layer dependencies
}

/**
 * Detect which layer a function belongs to based on architecture config
 */
function detectFunctionLayer(
  functionInfo: FunctionInfo,
  layers: Record<string, string[] | LayerDefinition>
): string | null {
  const normalizedPath = functionInfo.filePath.replace(/\\/g, '/');
  
  for (const [layerName, layerConfig] of Object.entries(layers)) {
    const patterns = Array.isArray(layerConfig) ? layerConfig : layerConfig.patterns;
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
 * Estimate PageRank using Monte Carlo random walks for large layers
 */
function estimatePageRankByMonteCarlo(
  layerFunctions: FunctionInfo[],
  intraLayerEdges: CallEdge[],
  opts = { walksPerNode: 20, walkLength: 12, damping: 0.85 }
): { scores: PageRankScore[], averageScore: number, maxScore: number } {
  const ids = layerFunctions.map(f => f.id);
  const idToIdx = new Map(ids.map((id, i) => [id, i]));
  
  // Build adjacency list
  const adj: number[][] = Array(ids.length).fill(0).map(() => []);
  for (const edge of intraLayerEdges) {
    const u = idToIdx.get(edge.callerFunctionId);
    const v = edge.calleeFunctionId ? idToIdx.get(edge.calleeFunctionId) : undefined;
    if (u !== undefined && v !== undefined) {
      adj[u].push(v);
    }
  }
  
  // Random walk simulation
  const visits = new Float64Array(ids.length);
  
  for (let s = 0; s < ids.length; s++) {
    for (let r = 0; r < opts.walksPerNode; r++) {
      let curr = s;
      for (let t = 0; t < opts.walkLength; t++) {
        visits[curr] += 1;
        const deg = adj[curr].length;
        const shouldTeleport = Math.random() > opts.damping || deg === 0;
        curr = shouldTeleport 
          ? Math.floor(Math.random() * ids.length)
          : adj[curr][Math.floor(Math.random() * deg)];
      }
    }
  }
  
  // Normalize to PageRank-like scores
  const totalVisits = visits.reduce((a, b) => a + b, 0);
  const scores: PageRankScore[] = ids.map((id, i) => {
    const score = visits[i] / (totalVisits || 1);
    return {
      functionId: id,
      functionName: layerFunctions[i].name,
      filePath: layerFunctions[i].filePath,
      startLine: layerFunctions[i].startLine,
      score,
      rank: 0, // Will be set after sorting
      normalizedScore: score,
      importance: score > 0.1 ? 'critical' : score > 0.05 ? 'high' : score > 0.02 ? 'medium' : 'low'
    };
  });
  
  // Sort by score and assign ranks
  scores.sort((a, b) => b.score - a.score);
  scores.forEach((score, index) => {
    score.rank = index + 1;
  });
  
  const averageScore = 1.0 / ids.length;
  const maxScore = Math.max(...scores.map(s => s.score), 0);
  
  return { scores, averageScore, maxScore };
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
  const archConfig = loadArchitectureConfig();
  const { functionsByLayer, functionLayerMap } = groupFunctionsByLayer(functions, archConfig.layers);
  const { edgesByLayer, crossLayerEdgeCount } = categorizeEdgesByLayer(callEdges, functionLayerMap);
  const layerResults = performLayerAnalysis(functionsByLayer, edgesByLayer);
  const crossLayerInsights = generateCrossLayerInsights(layerResults, crossLayerEdgeCount, callEdges.length);
  
  // Calculate cross-layer ratio as fraction (0-1) for consistent data format
  const crossLayerRatio = callEdges.length > 0 
    ? (crossLayerEdgeCount / callEdges.length) 
    : 0;

  return {
    overallMetrics: {
      totalFunctions: functions.length,
      totalLayers: Object.keys(archConfig.layers).length,
      analyzedLayers: layerResults.length
    },
    layerResults: layerResults.sort((a, b) => b.functionCount - a.functionCount),
    crossLayerInsights,
    crossLayerRatio
  };
}

/**
 * Load and validate architecture configuration
 */
function loadArchitectureConfig() {
  const configManager = new ArchitectureConfigManager();
  let archConfig;
  try {
    archConfig = configManager.load();
  } catch (error) {
    throw new Error(
      `Failed to load architecture configuration: ${error instanceof Error ? error.message : String(error)}. ` +
      'Please ensure architecture configuration is properly set up.'
    );
  }
  
  if (!archConfig.layers || Object.keys(archConfig.layers).length === 0) {
    throw new Error('No layer definitions found in architecture configuration');
  }
  
  return archConfig;
}

/**
 * Group functions by their detected layer
 */
function groupFunctionsByLayer(functions: FunctionInfo[], layers: Record<string, string[] | LayerDefinition>) {
  const functionsByLayer = new Map<string, FunctionInfo[]>();
  const functionLayerMap = new Map<string, string>();
  const unmappedFunctions: FunctionInfo[] = [];
  
  for (const func of functions) {
    const layer = detectFunctionLayer(func, layers);
    if (layer) {
      const layerFunctions = functionsByLayer.get(layer) || [];
      layerFunctions.push(func);
      functionsByLayer.set(layer, layerFunctions);
      functionLayerMap.set(func.id, layer);
    } else {
      unmappedFunctions.push(func);
    }
  }
  
  return { functionsByLayer, functionLayerMap, unmappedFunctions };
}

/**
 * Categorize edges as intra-layer or cross-layer
 */
function categorizeEdgesByLayer(
  callEdges: CallEdge[],
  functionLayerMap: Map<string, string>
) {
  const edgesByLayer = new Map<string, CallEdge[]>();
  let crossLayerEdgeCount = 0;
  
  for (const edge of callEdges) {
    const callerLayer = functionLayerMap.get(edge.callerFunctionId);
    const calleeLayer = edge.calleeFunctionId ? functionLayerMap.get(edge.calleeFunctionId) : undefined;
    
    if (callerLayer && calleeLayer && callerLayer === calleeLayer) {
      // Intra-layer edge
      const layerEdges = edgesByLayer.get(callerLayer) || [];
      layerEdges.push(edge);
      edgesByLayer.set(callerLayer, layerEdges);
    } else if (callerLayer && calleeLayer && callerLayer !== calleeLayer) {
      // Cross-layer edge - count for insights
      crossLayerEdgeCount++;
    }
  }
  
  return { edgesByLayer, crossLayerEdgeCount };
}

/**
 * Perform PageRank analysis for each layer
 */
function performLayerAnalysis(
  functionsByLayer: Map<string, FunctionInfo[]>,
  edgesByLayer: Map<string, CallEdge[]>
): LayerPageRankResult[] {
  const layerResults: LayerPageRankResult[] = [];
  const { edgesPerLayer, totalIntraEdges } = calculateEdgeStatistics(functionsByLayer, edgesByLayer);
  
  for (const [layerName, layerFunctions] of functionsByLayer.entries()) {
    if (layerFunctions.length === 0) continue;
    
    const intraLayerEdges = edgesByLayer.get(layerName) || [];
    const edgeCount = edgesPerLayer.get(layerName) ?? 0;
    const maxIterations = calculateLayerIterationBudget(layerFunctions.length, edgeCount, totalIntraEdges);
    
    const result = performLayerPageRankCalculation(layerFunctions, intraLayerEdges, maxIterations);
    const layerResult = buildLayerResult(layerName, layerFunctions, result);
    
    layerResults.push(layerResult);
  }
  
  return layerResults;
}

/**
 * Calculate edge statistics for budget allocation
 */
function calculateEdgeStatistics(
  functionsByLayer: Map<string, FunctionInfo[]>,
  edgesByLayer: Map<string, CallEdge[]>
) {
  const edgesPerLayer = new Map<string, number>();
  let totalIntraEdges = 0;
  
  for (const [layerName] of functionsByLayer.entries()) {
    const edgeCount = edgesByLayer.get(layerName)?.length ?? 0;
    edgesPerLayer.set(layerName, edgeCount);
    totalIntraEdges += edgeCount;
  }
  
  return { edgesPerLayer, totalIntraEdges };
}

/**
 * Calculate iteration budget for a layer based on size and edge density
 */
function calculateLayerIterationBudget(
  layerSize: number,
  edgeCount: number,
  totalIntraEdges: number
): number {
  const BUDGET_MV = Number(process.env['FUNCQC_LAYER_PR_BUDGET_MV'] ?? 150_000);
  const baseIterations = Math.max(8, Math.min(40, 10 + Math.ceil(Math.log2(layerSize))));
  
  if (totalIntraEdges > 0 && edgeCount > 0) {
    const budgetIterations = Math.floor((BUDGET_MV * (edgeCount / totalIntraEdges)) / Math.max(1, edgeCount));
    return Math.max(8, Math.min(baseIterations, budgetIterations || baseIterations));
  }
  
  return baseIterations;
}

/**
 * Perform PageRank calculation for a single layer
 */
function performLayerPageRankCalculation(
  layerFunctions: FunctionInfo[],
  intraLayerEdges: CallEdge[],
  maxIterations: number
) {
  const pageRankCalculator = new PageRankCalculator({
    dampingFactor: 0.85,
    maxIterations,
    tolerance: 1e-5
  });
  
  const isLargeLayer = layerFunctions.length > 1200 || intraLayerEdges.length > 3000;
  
  return isLargeLayer
    ? estimatePageRankByMonteCarlo(layerFunctions, intraLayerEdges)
    : pageRankCalculator.calculatePageRank(layerFunctions, intraLayerEdges);
}

/**
 * Build result object for a single layer
 */
function buildLayerResult(
  layerName: string,
  layerFunctions: FunctionInfo[],
  result: { scores: PageRankScore[]; averageScore: number; maxScore: number }
): LayerPageRankResult {
  const scores = result.scores.map(s => s.normalizedScore);
  const giniCoefficient = calculateGiniCoefficient(scores);
  
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
  
  return {
    layerName,
    functionCount: layerFunctions.length,
    scores: result.scores,
    topFunctions,
    averageScore: result.averageScore,
    maxScore: result.maxScore,
    giniCoefficient
  };
}

/**
 * Generate insights about cross-layer dependencies and patterns (optimized)
 */
function generateCrossLayerInsights(
  layerResults: LayerPageRankResult[],
  crossLayerEdgeCount: number,
  totalEdges: number
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
  
  // Use precomputed cross-layer statistics (no additional O(E) scan)
  if (crossLayerEdgeCount > 0) {
    const crossLayerRatio = (crossLayerEdgeCount / Math.max(1, totalEdges) * 100).toFixed(1);
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