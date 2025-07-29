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
  // Load architecture configuration
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
  
  // Pre-build layer function ID sets for efficient lookup
  const layerFunctionIdSet = new Map<string, Set<string>>();
  for (const [layer, funcs] of functionsByLayer.entries()) {
    layerFunctionIdSet.set(layer, new Set(funcs.map(f => f.id)));
  }
  
  // One-pass edge bucketing: O(E) instead of O(L×E)
  // Also collect cross-layer statistics during the same pass
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
  
  // Budget-based iteration control: limit total matrix-vector multiplications across all layers
  const BUDGET_MV = Number(process.env['FUNCQC_LAYER_PR_BUDGET_MV'] ?? 150_000);
  
  // Pre-calculate edges per layer for budget allocation
  const edgesPerLayer = new Map<string, number>();
  let totalIntraEdges = 0;
  for (const [layerName] of functionsByLayer.entries()) {
    const edgeCount = edgesByLayer.get(layerName)?.length ?? 0;
    edgesPerLayer.set(layerName, edgeCount);
    totalIntraEdges += edgeCount;
  }

  for (const [layerName, layerFunctions] of functionsByLayer.entries()) {
    if (layerFunctions.length === 0) continue;
    
    // Use pre-built edges instead of filtering every time
    const intraLayerEdges = edgesByLayer.get(layerName) || [];
    const edgeCount = edgesPerLayer.get(layerName) ?? 0;
    
    // Budget allocation: distribute iteration budget based on layer edge density
    const layerSize = layerFunctions.length;
    const baseIterations = Math.max(8, Math.min(40, 10 + Math.ceil(Math.log2(layerSize))));
    
    let maxIterations = baseIterations;
    if (totalIntraEdges > 0 && edgeCount > 0) {
      // Allocate budget proportionally to edge density
      const budgetIterations = Math.floor((BUDGET_MV * (edgeCount / totalIntraEdges)) / Math.max(1, edgeCount));
      maxIterations = Math.max(8, Math.min(baseIterations, budgetIterations || baseIterations));
    }
    
    const pageRankCalculator = new PageRankCalculator({
      dampingFactor: 0.85,
      maxIterations,
      tolerance: 1e-5
    });
    
    // Large layers use Monte Carlo approximation for better performance
    const isLargeLayer = layerFunctions.length > 1200 || edgeCount > 3000;
    
    const result = isLargeLayer
      ? estimatePageRankByMonteCarlo(layerFunctions, intraLayerEdges)
      : pageRankCalculator.calculatePageRank(layerFunctions, intraLayerEdges);
    
    
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
  
  // Generate cross-layer insights using precomputed statistics
  const crossLayerInsights = generateCrossLayerInsights(
    layerResults,
    crossLayerEdgeCount,
    callEdges.length
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