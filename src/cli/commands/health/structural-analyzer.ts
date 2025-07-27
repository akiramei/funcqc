/**
 * Structural analysis logic using SCC and dependency metrics
 */

import { FunctionInfo, DynamicWeightConfig, EvaluationMode, CallEdge, SourceFile } from '../../../types';
import { CommandEnvironment } from '../../../types/environment';
import { SCCAnalyzer, SCCAnalysisResult } from '../../../analyzers/scc-analyzer';
import { DependencyMetricsCalculator, DependencyMetrics } from '../../../analyzers/dependency-metrics';
import { PageRankCalculator } from '../../../analyzers/pagerank-calculator';
import { defaultLayerDetector } from '../../../analyzers/architecture-layer-detector';
import { createDynamicWeightCalculator } from '../../../analyzers/dynamic-weight-calculator';
import { StructuralMetrics, PageRankMetrics } from './types';
import { calculateStructuralPenaltyBreakdown } from './calculator';
import { performLayerBasedPageRank } from './layer-based-pagerank';

// In-memory cache for SCC analysis results
interface SCCCacheEntry {
  structuralMetrics: StructuralMetrics;
  timestamp: number;
  callEdgesHash: string;
}

const sccCache = new Map<string, SCCCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

/**
 * Perform comprehensive structural analysis using SCC and dependency metrics
 */
export async function analyzeStructuralMetrics(
  functions: FunctionInfo[], 
  snapshotId: string, 
  env: CommandEnvironment,
  mode: EvaluationMode = 'static'
): Promise<StructuralMetrics> {
  try {
    // Get call edges for the snapshot
    const callEdges = await env.storage.getCallEdgesBySnapshot(snapshotId);
    
    // Create a hash of call edges for cache validation
    const callEdgesHash = createCallEdgesHash(callEdges);
    
    // Check cache first
    const cachedResult = getCachedStructuralMetrics(snapshotId, callEdgesHash);
    if (cachedResult) {
      env.commandLogger.debug(`Using cached SCC analysis for snapshot ${snapshotId}`);
      return cachedResult;
    }
    
    env.commandLogger.debug(`Computing SCC analysis for snapshot ${snapshotId}`);
    
    // Perform SCC analysis
    const sccAnalyzer = new SCCAnalyzer();
    const sccResult = sccAnalyzer.findStronglyConnectedComponents(callEdges);
    
    // Calculate dependency metrics
    const depCalculator = new DependencyMetricsCalculator();
    const entryPoints = new Set<string>(); // Simplified - could be enhanced later
    const cyclicFunctions = new Set(sccResult.recursiveFunctions);
    const depMetrics = depCalculator.calculateMetrics(functions, callEdges, entryPoints, cyclicFunctions);
    
    // Calculate PageRank centrality scores
    const pageRankCalculator = new PageRankCalculator();
    const pageRankResult = pageRankCalculator.calculatePageRank(functions, callEdges);
    const centralityMetrics = pageRankCalculator.calculateCentralityMetrics(functions, callEdges);
    
    // Calculate fan-in/fan-out statistics
    const fanIns = depMetrics.map((m: DependencyMetrics) => m.fanIn);
    const fanOuts = depMetrics.map((m: DependencyMetrics) => m.fanOut);
    const avgFanIn = fanIns.reduce((a: number, b: number) => a + b, 0) / fanIns.length || 0;
    const avgFanOut = fanOuts.reduce((a: number, b: number) => a + b, 0) / fanOuts.length || 0;
    const maxFanIn = Math.max(...fanIns, 0);
    const maxFanOut = Math.max(...fanOuts, 0);
    
    // Setup dynamic weight system with Phase 2 enhancements
    const architecturePattern = defaultLayerDetector.analyzeArchitecturePattern(functions);
    
    // Phase 2: Calculate project structure metrics
    const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
    const fileCount = sourceFiles.length;
    const avgFunctionsPerFile = fileCount > 0 ? functions.length / fileCount : 0;
    const maxDirectoryDepth = calculateMaxDirectoryDepth(sourceFiles);
    
    const dynamicConfig: DynamicWeightConfig = {
      projectSize: functions.length,
      architecturePattern,
      domainComplexity: 'Medium', // TODO: Make configurable
      teamExperience: 'Mixed',     // TODO: Make configurable
      mode,
      // Phase 2: Enhanced project structure metrics
      fileCount,
      maxDirectoryDepth,
      avgFunctionsPerFile
    };
    
    // Calculate dynamic thresholds
    let hubThreshold: number;
    if (mode === 'dynamic') {
      const dynamicCalculator = createDynamicWeightCalculator(dynamicConfig);
      const dynamicThresholds = dynamicCalculator.calculateDynamicThresholds(dynamicConfig);
      hubThreshold = dynamicThresholds.hubThreshold;
      
      env.commandLogger.debug(`Phase 2 Project Metrics: functions=${functions.length}, files=${fileCount}, avgPerFile=${avgFunctionsPerFile.toFixed(1)}, maxDepth=${maxDirectoryDepth}`);
      env.commandLogger.debug(`Dynamic thresholds: hub=${hubThreshold}, complexity=${dynamicThresholds.complexityThreshold}`);
    } else {
      // Use legacy static calculation
      hubThreshold = calculateDynamicHubThreshold(fanIns, avgFanIn);
    }
    
    // Identify hub functions using dynamic threshold
    const hubMetrics = depMetrics.filter((m: DependencyMetrics) => m.fanIn >= hubThreshold);
    const hubFunctions = hubMetrics.length;
    const hubFunctionIds = hubMetrics.map((m: DependencyMetrics) => m.functionId);
    
    // Calculate structural risk level
    const structuralRisk = calculateStructuralRisk(sccResult, hubFunctions, maxFanIn, maxFanOut);
    
    // Perform layer-based PageRank analysis (optional)
    let layerBasedAnalysis;
    try {
      const layerAnalysis = await performLayerBasedPageRank(functions, callEdges);
      layerBasedAnalysis = {
        overallMetrics: layerAnalysis.overallMetrics,
        layerResults: layerAnalysis.layerResults.map(result => ({
          layerName: result.layerName,
          functionCount: result.functionCount,
          topFunctions: result.topFunctions,
          giniCoefficient: result.giniCoefficient
        })),
        crossLayerInsights: layerAnalysis.crossLayerInsights
      };
    } catch (error) {
      // Layer-based analysis is optional, log error but continue
      env.commandLogger.debug('Layer-based PageRank analysis failed:', error);
    }
    
    // Create PageRank metrics object
    const pageRankMetrics: PageRankMetrics = {
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

    // Create base structural metrics object
    const baseMetrics: StructuralMetrics = {
      totalComponents: sccResult.totalComponents,
      largestComponentSize: sccResult.largestComponentSize,
      cyclicFunctions: sccResult.recursiveFunctions.length,
      hubFunctions,
      avgFanIn: Math.round(avgFanIn * 10) / 10,
      avgFanOut: Math.round(avgFanOut * 10) / 10,
      maxFanIn,
      maxFanOut,
      structuralRisk,
      hubThreshold,
      hubFunctionIds,
      cyclicFunctionIds: sccResult.recursiveFunctions,
      pageRank: pageRankMetrics
    };
    
    // Calculate penalty breakdown for transparency
    const penaltyBreakdown = calculateStructuralPenaltyBreakdown(baseMetrics);
    baseMetrics.penaltyBreakdown = penaltyBreakdown;
    
    // Cache the result
    setCachedStructuralMetrics(snapshotId, callEdgesHash, baseMetrics);
    
    return baseMetrics;
  } catch (error) {
    env.commandLogger.warn('Structural analysis failed, using defaults:', error);
    return {
      totalComponents: 0,
      largestComponentSize: 0,
      cyclicFunctions: 0,
      hubFunctions: 0,
      avgFanIn: 0,
      avgFanOut: 0,
      maxFanIn: 0,
      maxFanOut: 0,
      structuralRisk: 'low'
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
 * Create a hash of call edges for cache validation
 */
function createCallEdgesHash(callEdges: CallEdge[]): string {
  // Simple hash based on call edges count and first/last edge structure
  // More sophisticated hashing could be implemented if needed
  const edgesSummary = {
    count: callEdges.length,
    firstEdge: callEdges[0] ? `${callEdges[0].callerFunctionId}->${callEdges[0].calleeFunctionId}` : '',
    lastEdge: callEdges[callEdges.length - 1] ? `${callEdges[callEdges.length - 1].callerFunctionId}->${callEdges[callEdges.length - 1].calleeFunctionId}` : ''
  };
  
  return JSON.stringify(edgesSummary);
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
 * Phase 2: Calculate maximum directory depth from source files
 */
export function calculateMaxDirectoryDepth(sourceFiles: SourceFile[]): number {
  let maxDepth = 0;
  
  for (const file of sourceFiles) {
    const pathParts = file.filePath.split('/').filter((part: string) => part.length > 0);
    const depth = pathParts.length - 1; // Subtract 1 for the filename itself
    maxDepth = Math.max(maxDepth, depth);
  }
  
  return maxDepth;
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