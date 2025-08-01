/**
 * Structural analysis logic using SCC and dependency metrics
 */

import { FunctionInfo, DynamicWeightConfig, EvaluationMode, CallEdge, InternalCallEdge } from '../../../types';
import { CommandEnvironment } from '../../../types/environment';
import { SCCAnalyzer, SCCAnalysisResult } from '../../../analyzers/scc-analyzer';
import { DependencyMetricsCalculator, DependencyMetrics } from '../../../analyzers/dependency-metrics';
import { PageRankCalculator } from '../../../analyzers/pagerank-calculator';
import { defaultLayerDetector } from '../../../analyzers/architecture-layer-detector';
import { createDynamicWeightCalculator } from '../../../analyzers/dynamic-weight-calculator';
import { StructuralMetrics, PageRankMetrics } from './types';
import { calculateStructuralPenaltyBreakdown } from './calculator';
import { performLayerBasedPageRank } from './layer-based-pagerank';
import { calculateMaxDirectoryDepth } from '../../../utils/file-utils';

// In-memory cache for SCC analysis results
interface SCCCacheEntry {
  structuralMetrics: StructuralMetrics;
  timestamp: number;
  callEdgesHash: string;
}

const sccCache = new Map<string, SCCCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

// Type definitions for analysis results
interface FanStatistics {
  fanIns: number[];
  fanOuts: number[];
  avgFanIn: number;
  avgFanOut: number;
  maxFanIn: number;
  maxFanOut: number;
}


/**
 * Perform SCC analysis and calculate dependency metrics
 */
function performSCCAnalysis(
  functions: FunctionInfo[], 
  callEdges: CallEdge[]
): { sccResult: SCCAnalysisResult; depMetrics: DependencyMetrics[]; fanStats: FanStatistics } {
  const sccAnalyzer = new SCCAnalyzer();
  const sccResult = sccAnalyzer.findStronglyConnectedComponents(callEdges);
  
  const depCalculator = new DependencyMetricsCalculator();
  const entryPoints = new Set<string>();
  const cyclicFunctions = new Set(sccResult.recursiveFunctions);
  const depMetrics = depCalculator.calculateMetrics(functions, callEdges, entryPoints, cyclicFunctions);
  
  // Calculate fan-in/fan-out statistics
  const fanIns = depMetrics.map((m: DependencyMetrics) => m.fanIn);
  const fanOuts = depMetrics.map((m: DependencyMetrics) => m.fanOut);
  const avgFanIn = fanIns.reduce((a: number, b: number) => a + b, 0) / fanIns.length || 0;
  const avgFanOut = fanOuts.reduce((a: number, b: number) => a + b, 0) / fanOuts.length || 0;
  const maxFanIn = Math.max(...fanIns, 0);
  const maxFanOut = Math.max(...fanOuts, 0);
  
  return {
    sccResult,
    depMetrics,
    fanStats: { fanIns, fanOuts, avgFanIn, avgFanOut, maxFanIn, maxFanOut }
  };
}

/**
 * Calculate PageRank analysis including layer-based analysis
 */
async function performPageRankAnalysis(
  functions: FunctionInfo[], 
  pageRankEdges: CallEdge[], 
  env: CommandEnvironment
): Promise<PageRankMetrics> {
  // Use adaptive convergence settings based on graph size
  const pageRankCalculator = new PageRankCalculator({
    dampingFactor: 0.85,
    maxIterations: Math.min(100, Math.max(50, Math.ceil(Math.log2(functions.length)) * 2)),
    tolerance: pageRankEdges.length > 1000 ? 1e-3 : 1e-4  // Relaxed tolerance for large graphs
  });
  const pageRankResult = pageRankCalculator.calculatePageRank(functions, pageRankEdges);
  const centralityMetrics = pageRankCalculator.calculateCentralityMetrics(functions, pageRankEdges);
  
  
  // Perform layer-based PageRank analysis (optimized with budgeting and Monte Carlo)
  let layerBasedAnalysis;
  const enableLayerPageRank = process.env['FUNCQC_ENABLE_LAYER_PAGERANK'] === 'true' || 
                              pageRankEdges.length < 10000; // Enable for medium-sized projects with optimizations
  
  if (enableLayerPageRank) {
    try {
      const layerAnalysis = await performLayerBasedPageRank(functions, pageRankEdges);
      layerBasedAnalysis = {
        overallMetrics: layerAnalysis.overallMetrics,
        layerResults: layerAnalysis.layerResults.map(result => ({
          layerName: result.layerName,
          functionCount: result.functionCount,
          topFunctions: result.topFunctions,
          giniCoefficient: result.giniCoefficient
        })),
        crossLayerInsights: layerAnalysis.crossLayerInsights,
        crossLayerRatio: layerAnalysis.crossLayerRatio
      };
      env.commandLogger.debug(`Layer-based PageRank completed for ${layerAnalysis.layerResults.length} layers`);
    } catch (error) {
      env.commandLogger.debug('Layer-based PageRank analysis failed:', error);
    }
  } else {
    env.commandLogger.debug(`Layer-based PageRank skipped (${pageRankEdges.length} edges). Set FUNCQC_ENABLE_LAYER_PAGERANK=true to force enable.`);
  }
  
  return {
    totalFunctions: pageRankResult.totalFunctions,
    converged: pageRankResult.converged,
    iterations: pageRankResult.iterations,
    averageScore: pageRankResult.averageScore,
    maxScore: pageRankResult.maxScore,
    centralityVariance: centralityMetrics.centralityVariance,
    centralityGini: centralityMetrics.centralityGini,
    importanceDistribution: pageRankResult.importanceDistribution,
    topCentralFunctions: centralityMetrics.topCentralFunctions,
    ...(layerBasedAnalysis && { layerBasedAnalysis })
  };
}

/**
 * Calculate project structure metrics and dynamic configuration
 */
async function calculateProjectStructureMetrics(
  functions: FunctionInfo[], 
  snapshotId: string, 
  env: CommandEnvironment, 
  mode: EvaluationMode,
  fanStats: FanStatistics
): Promise<{ dynamicConfig: DynamicWeightConfig; hubThreshold: number }> {
  const architecturePattern = defaultLayerDetector.analyzeArchitecturePattern(functions);
  
  const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
  const fileCount = sourceFiles.length;
  const avgFunctionsPerFile = fileCount > 0 ? functions.length / fileCount : 0;
  const maxDirectoryDepth = calculateMaxDirectoryDepth(sourceFiles);
  
  const dynamicConfig: DynamicWeightConfig = {
    projectSize: functions.length,
    architecturePattern,
    domainComplexity: 'Medium',
    teamExperience: 'Mixed',
    mode,
    fileCount,
    maxDirectoryDepth,
    avgFunctionsPerFile
  };
  
  let hubThreshold: number;
  if (mode === 'dynamic') {
    const dynamicCalculator = createDynamicWeightCalculator(dynamicConfig);
    const dynamicThresholds = dynamicCalculator.calculateDynamicThresholds(dynamicConfig);
    hubThreshold = dynamicThresholds.hubThreshold;
    
    env.commandLogger.debug(`Phase 2 Project Metrics: functions=${functions.length}, files=${fileCount}, avgPerFile=${avgFunctionsPerFile.toFixed(1)}, maxDepth=${maxDirectoryDepth}`);
    env.commandLogger.debug(`Dynamic thresholds: hub=${hubThreshold}, complexity=${dynamicThresholds.complexityThreshold}`);
  } else {
    hubThreshold = calculateDynamicHubThreshold(fanStats.fanIns, fanStats.avgFanIn);
  }
  
  return { dynamicConfig, hubThreshold };
}

/**
 * Aggregate all metrics into final structural metrics object
 */
function aggregateStructuralMetrics(
  sccResult: SCCAnalysisResult,
  fanStats: FanStatistics,
  depMetrics: DependencyMetrics[],
  hubThreshold: number,
  pageRankMetrics: PageRankMetrics,
  snapshotId: string,
  callEdgesHash: string
): StructuralMetrics {
  const hubMetrics = depMetrics.filter((m: DependencyMetrics) => m.fanIn >= hubThreshold);
  const hubFunctions = hubMetrics.length;
  const hubFunctionIds = hubMetrics.map((m: DependencyMetrics) => m.functionId);
  
  const structuralRisk = calculateStructuralRisk(sccResult, hubFunctions, fanStats.maxFanIn, fanStats.maxFanOut);
  
  const baseMetrics: StructuralMetrics = {
    totalComponents: sccResult.totalComponents,
    largestComponentSize: sccResult.largestComponentSize,
    cyclicFunctions: sccResult.recursiveFunctions.length,
    hubFunctions,
    avgFanIn: Math.round(fanStats.avgFanIn * 10) / 10,
    avgFanOut: Math.round(fanStats.avgFanOut * 10) / 10,
    maxFanIn: fanStats.maxFanIn,
    maxFanOut: fanStats.maxFanOut,
    structuralRisk,
    hubThreshold,
    hubFunctionIds,
    cyclicFunctionIds: sccResult.recursiveFunctions,
    pageRank: pageRankMetrics,
    depMetrics // Include dependency metrics for structural recommendations
  };
  
  const penaltyBreakdown = calculateStructuralPenaltyBreakdown(baseMetrics);
  baseMetrics.penaltyBreakdown = penaltyBreakdown;
  
  setCachedStructuralMetrics(snapshotId, callEdgesHash, baseMetrics);
  
  return baseMetrics;
}

/**
 * Create minimal structural metrics for extremely large datasets
 */
function createMinimalStructuralMetrics(
  functions: FunctionInfo[],
  callEdges: CallEdge[]
): StructuralMetrics {
  // Ultra-minimal metrics for very large datasets - avoid all expensive operations
  const totalFunctions = functions.length;
  const totalEdges = callEdges.length;
  
  // Rough estimations without expensive calculations
  const avgFanIn = totalEdges > 0 ? totalEdges / totalFunctions : 0;
  const avgFanOut = avgFanIn; // Same for undirected approximation
  const estimatedHubThreshold = Math.max(3, Math.ceil(avgFanIn * 1.5));
  
  // Ultra-lightweight PageRank for massive datasets (minimal iterations)
  const pageRankCalculator = new PageRankCalculator({
    dampingFactor: 0.85,
    maxIterations: Math.min(5, Math.max(2, Math.ceil(Math.log2(totalFunctions)))), // Minimal iterations
    tolerance: 1e-1  // Very relaxed tolerance
  });
  
  let pageRankMetrics: PageRankMetrics;
  try {
    const pageRankResult = pageRankCalculator.calculatePageRank(functions, callEdges);
    const centralityMetrics = pageRankCalculator.calculateCentralityMetrics(functions, callEdges);
    
    pageRankMetrics = {
      totalFunctions: pageRankResult.totalFunctions,
      converged: pageRankResult.converged,
      iterations: pageRankResult.iterations,
      averageScore: pageRankResult.averageScore,
      maxScore: pageRankResult.maxScore,
      centralityVariance: centralityMetrics.centralityVariance,
      centralityGini: centralityMetrics.centralityGini,
      importanceDistribution: pageRankResult.importanceDistribution,
      topCentralFunctions: centralityMetrics.topCentralFunctions.slice(0, 2) // Top 2 only
    };
  } catch {
    // Ultra-minimal fallback for extreme cases
    pageRankMetrics = {
      totalFunctions,
      converged: false,
      iterations: 0,
      averageScore: 1.0 / totalFunctions,
      maxScore: 1.0,
      centralityVariance: 0,
      centralityGini: 0,
      importanceDistribution: { critical: 0, high: 0, medium: 0, low: totalFunctions },
      topCentralFunctions: []
    };
  }
  
  return {
    totalComponents: 1,
    largestComponentSize: totalFunctions,
    cyclicFunctions: 0,
    hubFunctions: Math.ceil(totalFunctions * 0.05), // Estimate 5% as hubs
    avgFanIn: Math.round(avgFanIn * 10) / 10,
    avgFanOut: Math.round(avgFanOut * 10) / 10,
    maxFanIn: Math.ceil(avgFanIn * 3), // Estimate
    maxFanOut: Math.ceil(avgFanOut * 3), // Estimate
    structuralRisk: totalEdges > 15000 ? 'critical' : totalEdges > 10000 ? 'high' : 'medium',
    hubThreshold: estimatedHubThreshold,
    hubFunctionIds: [],
    cyclicFunctionIds: [],
    pageRank: pageRankMetrics
  };
}

/**
 * Perform simplified structural analysis for very large datasets
 */
async function performSimplifiedStructuralAnalysis(
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  _snapshotId: string,
  env: CommandEnvironment,
  _mode: EvaluationMode
): Promise<StructuralMetrics> {
  env.commandLogger.debug('Starting ultra-fast simplified structural analysis');
  
  // Ultra-fast analysis: skip dependency metrics calculation for very large datasets
  if (callEdges.length > 5000 || functions.length > 2000) {
    env.commandLogger.debug(`Using minimal metrics for dataset: ${callEdges.length} edges, ${functions.length} functions`);
    return createMinimalStructuralMetrics(functions, callEdges);
  }
  
  // Basic metrics without expensive PageRank or SCC
  const depCalculator = new DependencyMetricsCalculator();
  const entryPoints = new Set<string>();
  const cyclicFunctions = new Set<string>(); // Skip SCC for now
  const depMetrics = depCalculator.calculateMetrics(functions, callEdges, entryPoints, cyclicFunctions);
  
  // Calculate basic fan-in/fan-out statistics
  const fanIns = depMetrics.map(m => m.fanIn);
  const fanOuts = depMetrics.map(m => m.fanOut);
  const avgFanIn = fanIns.reduce((a, b) => a + b, 0) / fanIns.length || 0;
  const avgFanOut = fanOuts.reduce((a, b) => a + b, 0) / fanOuts.length || 0;
  const maxFanIn = Math.max(...fanIns, 0);
  const maxFanOut = Math.max(...fanOuts, 0);
  
  const hubThreshold = calculateDynamicHubThreshold(fanIns, avgFanIn);
  const hubMetrics = depMetrics.filter(m => m.fanIn >= hubThreshold);
  const hubFunctions = hubMetrics.length;
  const hubFunctionIds = hubMetrics.map(m => m.functionId);
  
  // Lightweight PageRank for simplified analysis (reduced iterations for performance)
  const pageRankCalculator = new PageRankCalculator({
    dampingFactor: 0.85,
    maxIterations: Math.min(10, Math.max(3, Math.ceil(Math.log2(functions.length)))), // Very limited iterations
    tolerance: 1e-2  // Relaxed tolerance for speed
  });
  
  let pageRankMetrics: PageRankMetrics;
  try {
    const pageRankResult = pageRankCalculator.calculatePageRank(functions, callEdges);
    const centralityMetrics = pageRankCalculator.calculateCentralityMetrics(functions, callEdges);
    
    pageRankMetrics = {
      totalFunctions: pageRankResult.totalFunctions,
      converged: pageRankResult.converged,
      iterations: pageRankResult.iterations,
      averageScore: pageRankResult.averageScore,
      maxScore: pageRankResult.maxScore,
      centralityVariance: centralityMetrics.centralityVariance,
      centralityGini: centralityMetrics.centralityGini,
      importanceDistribution: pageRankResult.importanceDistribution,
      topCentralFunctions: centralityMetrics.topCentralFunctions.slice(0, 3) // Limit to top 3 for performance
    };
  } catch (error) {
    // Fallback to minimal metrics if PageRank fails
    env.commandLogger.debug(`Simplified PageRank failed: ${error}, using fallback metrics`);
    pageRankMetrics = {
      totalFunctions: functions.length,
      converged: false,
      iterations: 0,
      averageScore: 1.0 / functions.length,
      maxScore: 1.0,
      centralityVariance: 0,
      centralityGini: 0,
      importanceDistribution: { critical: 0, high: 0, medium: 0, low: functions.length },
      topCentralFunctions: []
    };
  }
  
  return {
    totalComponents: 1, // Simplified assumption
    largestComponentSize: functions.length,
    cyclicFunctions: 0,
    hubFunctions,
    avgFanIn: Math.round(avgFanIn * 10) / 10,
    avgFanOut: Math.round(avgFanOut * 10) / 10,
    maxFanIn,
    maxFanOut,
    structuralRisk: calculateStructuralRisk(
      { 
        totalComponents: 1, 
        largestComponentSize: functions.length, 
        recursiveFunctions: [],
        components: [],
        componentMap: new Map()
      },
      hubFunctions,
      maxFanIn,
      maxFanOut
    ),
    hubThreshold,
    hubFunctionIds,
    cyclicFunctionIds: [],
    pageRank: pageRankMetrics
  };
}

/**
 * Perform comprehensive structural analysis using SCC and dependency metrics
 */
export async function analyzeStructuralMetrics(
  functions: FunctionInfo[], 
  snapshotId: string, 
  env: CommandEnvironment,
  mode: EvaluationMode = 'static'
): Promise<StructuralMetrics> {
  const startTime = Date.now();
  
  try {
    env.commandLogger.debug(`Starting structural analysis for ${functions.length} functions`);
    
    const callEdges = await env.storage.getCallEdgesBySnapshot(snapshotId);
    
    // Calculate hash once and reuse throughout the analysis
    const callEdgesHash = createCallEdgesHash(callEdges);
    
    // Check cache first (before any expensive operations)
    const cachedResult = getCachedStructuralMetrics(snapshotId, callEdgesHash);
    if (cachedResult) {
      env.commandLogger.debug('Using cached structural metrics');
      return cachedResult;
    }
    
    // Conditionally fetch internal call edges only if needed
    const excludeIntraFileCalls = process.env['FUNCQC_EXCLUDE_INTRA_FILE_CALLS'] !== 'false';
    let internalCallEdges: InternalCallEdge[] = [];
    let pageRankEdges = callEdges;
    
    
    if (excludeIntraFileCalls) {
      internalCallEdges = await env.storage.getInternalCallEdgesBySnapshot(snapshotId);
      
      if (internalCallEdges.length > 0) {
        // Use nested Map to avoid string concatenation for better memory efficiency
        const intraFileCallMap = new Map<string, Set<string>>();
        for (const edge of internalCallEdges) {
          if (!intraFileCallMap.has(edge.callerFunctionId)) {
            intraFileCallMap.set(edge.callerFunctionId, new Set());
          }
          intraFileCallMap.get(edge.callerFunctionId)!.add(edge.calleeFunctionId);
        }
        
        // Filter out intra-file calls and external calls from all call edges
        // Focus on inter-file internal calls only (most relevant for architectural analysis)
        pageRankEdges = callEdges.filter(edge => {
          const isExternal = edge.calleeFunctionId === null || edge.calleeFunctionId === undefined;
          if (isExternal) return false;
          
          const calleeSet = intraFileCallMap.get(edge.callerFunctionId);
          const isIntraFile = calleeSet?.has(edge.calleeFunctionId!) ?? false;
          return !isIntraFile;
        });
        
        
      }
    }
    
    // For large datasets, use simplified analysis to prevent timeout
    // Use filtered pageRankEdges for accurate threshold judgment after edge filtering
    if (pageRankEdges.length > 3500) {
      const simplifiedResult = await performSimplifiedStructuralAnalysis(functions, pageRankEdges, snapshotId, env, mode);
      // Cache the simplified result too
      setCachedStructuralMetrics(snapshotId, callEdgesHash, simplifiedResult);
      return simplifiedResult;
    }
    
    env.commandLogger.debug(`Computing SCC analysis for snapshot ${snapshotId}`);
    
    // Perform analysis in stages with progress logging
    let sccResult: SCCAnalysisResult, depMetrics: DependencyMetrics[], fanStats: FanStatistics;
    try {
      const sccAnalysisResult = performSCCAnalysis(functions, callEdges);
      sccResult = sccAnalysisResult.sccResult;
      depMetrics = sccAnalysisResult.depMetrics;
      fanStats = sccAnalysisResult.fanStats;
      env.commandLogger.debug(`SCC analysis completed in ${Date.now() - startTime}ms`);
    } catch (sccError) {
      env.commandLogger.error(`SCC analysis failed: ${sccError}`);
      throw sccError;
    }
    
    let pageRankMetrics: PageRankMetrics;
    try {
      // Use optimized edge set for PageRank (internal edges only for better performance and relevance)
      pageRankMetrics = await performPageRankAnalysis(functions, pageRankEdges, env);
      env.commandLogger.debug(`PageRank analysis completed in ${Date.now() - startTime}ms (using ${pageRankEdges.length} edges)`);
    } catch (pageRankError) {
      env.commandLogger.error(`PageRank analysis failed: ${pageRankError}`);
      throw pageRankError;
    }
    
    const { hubThreshold } = await calculateProjectStructureMetrics(functions, snapshotId, env, mode, fanStats);
    
    // Aggregate results (reuse the hash calculated at the beginning)
    const result = aggregateStructuralMetrics(sccResult, fanStats, depMetrics, hubThreshold, pageRankMetrics, snapshotId, callEdgesHash);
    
    env.commandLogger.debug(`Structural analysis completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    env.commandLogger.warn(`Structural analysis failed after ${Date.now() - startTime}ms: ${errorMessage}`);
    
    // Provide a meaningful default response with detailed error context
    return {
      totalComponents: 0,
      largestComponentSize: 0,
      cyclicFunctions: 0,
      hubFunctions: 0,
      avgFanIn: 0,
      avgFanOut: 0,
      maxFanIn: 0,
      maxFanOut: 0,
      structuralRisk: 'low',
      analysisError: errorMessage,
      failedAfterMs: Date.now() - startTime
    };
  }
}

/**
 * Calculate dynamic hub threshold based on project characteristics
 */
function calculateDynamicHubThreshold(fanIns: number[], avgFanIn: number): number {
  if (fanIns.length === 0) return 5; // Fallback to original default
  
  // Method 1: Based on average fan-in with minimum threshold
  const avgBasedThreshold = Math.max(5, Math.floor(avgFanIn * 2.5));
  
  // Method 2: Based on 90th percentile (statistical approach)
  const sortedFanIns = [...fanIns].sort((a, b) => a - b);
  const p90Index = Math.floor(sortedFanIns.length * 0.9);
  const p90Threshold = sortedFanIns[p90Index] || 5;
  
  // Method 3: Project size adaptive threshold
  const projectSize = fanIns.length;
  let sizeBasedThreshold = 5;
  if (projectSize > 1000) sizeBasedThreshold = 10;
  else if (projectSize > 500) sizeBasedThreshold = 8;
  else if (projectSize > 100) sizeBasedThreshold = 6;
  
  // Use the maximum of all methods to avoid false positives
  const dynamicThreshold = Math.max(avgBasedThreshold, p90Threshold, sizeBasedThreshold);
  
  // Cap at reasonable maximum to prevent extreme values
  return Math.min(dynamicThreshold, 50);
}

/**
 * Calculate structural risk level based on SCC and coupling metrics
 */
function calculateStructuralRisk(
  sccResult: SCCAnalysisResult,
  hubFunctions: number, 
  maxFanIn: number, 
  maxFanOut: number
): 'low' | 'medium' | 'high' | 'critical' {
  let riskScore = 0;
  
  // SCC size penalty
  if (sccResult.largestComponentSize >= 10) riskScore += 3;
  else if (sccResult.largestComponentSize >= 5) riskScore += 2;
  else if (sccResult.largestComponentSize >= 2) riskScore += 1;
  
  // Cyclic functions penalty
  if (sccResult.recursiveFunctions.length >= 20) riskScore += 3;
  else if (sccResult.recursiveFunctions.length >= 10) riskScore += 2;
  else if (sccResult.recursiveFunctions.length >= 5) riskScore += 1;
  
  // Hub functions (could be good or bad)
  if (hubFunctions >= 20) riskScore += 2;
  else if (hubFunctions >= 10) riskScore += 1;
  
  // High coupling penalty
  if (maxFanIn >= 50) riskScore += 2;
  else if (maxFanIn >= 25) riskScore += 1;
  
  if (maxFanOut >= 20) riskScore += 2;
  else if (maxFanOut >= 10) riskScore += 1;
  
  // Map risk score to level
  if (riskScore >= 7) return 'critical';
  if (riskScore >= 5) return 'high';
  if (riskScore >= 3) return 'medium';
  return 'low';
}

/**
 * Create a robust, order-independent hash of call edges for cache validation
 */
function createCallEdgesHash(callEdges: CallEdge[]): string {
  if (callEdges.length === 0) {
    return 'empty';
  }
  
  // Create order-independent hash by sorting edge pairs and using simple checksum
  const edgePairs = callEdges
    .map(edge => {
      const caller = edge.callerFunctionId;
      const callee = edge.calleeFunctionId || '';
      // Normalize edge pair to ensure consistent ordering
      return caller <= callee ? `${caller}->${callee}` : `${callee}<-${caller}`;
    })
    .sort(); // Sort to make hash order-independent
  
  // Simple but effective hash combining count and content
  let hash = edgePairs.length;
  for (let i = 0; i < edgePairs.length; i++) {
    const str = edgePairs[i];
    for (let j = 0; j < str.length; j++) {
      hash = ((hash << 5) - hash + str.charCodeAt(j)) & 0x7fffffff;
    }
  }
  
  return `${edgePairs.length}-${hash.toString(16)}`;
}

/**
 * Get cached structural metrics if valid
 */
function getCachedStructuralMetrics(snapshotId: string, callEdgesHash: string): StructuralMetrics | null {
  const cacheEntry = sccCache.get(snapshotId);
  
  if (!cacheEntry) {
    return null;
  }
  
  // Check if cache entry is expired
  const now = Date.now();
  if (now - cacheEntry.timestamp > CACHE_TTL_MS) {
    sccCache.delete(snapshotId);
    return null;
  }
  
  // Check if call edges have changed
  if (cacheEntry.callEdgesHash !== callEdgesHash) {
    sccCache.delete(snapshotId);
    return null;
  }
  
  return cacheEntry.structuralMetrics;
}

/**
 * Set cached structural metrics
 */
function setCachedStructuralMetrics(snapshotId: string, callEdgesHash: string, metrics: StructuralMetrics): void {
  sccCache.set(snapshotId, {
    structuralMetrics: metrics,
    timestamp: Date.now(),
    callEdgesHash
  });
  
  // Clean up expired entries
  cleanupExpiredCacheEntries();
}

/**
 * Clean up expired cache entries
 */
function cleanupExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of sccCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      sccCache.delete(key);
    }
  }
}


/**
 * Get cache statistics for debugging
 */
export function getSCCCacheStats(): { size: number; entries: Array<{ snapshotId: string; age: number }> } {
  const now = Date.now();
  const entries: Array<{ snapshotId: string; age: number }> = [];
  
  for (const [snapshotId, entry] of sccCache.entries()) {
    entries.push({
      snapshotId,
      age: Math.round((now - entry.timestamp) / 1000) // age in seconds
    });
  }
  
  return {
    size: sccCache.size,
    entries
  };
}