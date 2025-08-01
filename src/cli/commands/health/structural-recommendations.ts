/**
 * Structural Recommendations System
 * Provides detailed structural analysis and recommendations for function improvements
 */

import { FunctionInfo } from '../../../types';
import { FunctionRiskAssessment, StructuralMetrics } from './types';
import { CommandEnvironment } from '../../../types/environment';
import { defaultLayerDetector } from '../../../analyzers/architecture-layer-detector';

export interface StructuralRecommendation {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  fanIn: number;
  crossLayerInfo: string | undefined;
  sccInfo: string | undefined;
  topCallers: Array<{ functionName: string; callCount: number; layer: string }>;
  expectedImpact: {
    fanInReduction: string;
    penaltyReduction: string;
  };
  refactorSteps: string[];
  successCriteria: string[];
}

export interface CallAnalysis {
  functionId: string;
  totalInboundCalls: number;
  callersByLayer: Map<string, Array<{ functionName: string; callCount: number }>>;
  crossLayerCallers: Array<{ functionName: string; layer: string; callCount: number }>;
}

/**
 * Analyze call patterns using existing dependency metrics (more efficient and accurate)
 */
export async function analyzeCallPatternsWithDepMetrics(
  functions: FunctionInfo[],
  depMetrics: import('../../../analyzers/dependency-metrics').DependencyMetrics[],
  snapshotId: string,
  env: CommandEnvironment
): Promise<Map<string, CallAnalysis>> {
  const callAnalysisMap = new Map<string, CallAnalysis>();
  const callEdges = await env.storage.getCallEdgesBySnapshot(snapshotId);
  
  // Create function lookup map
  const functionMap = new Map<string, FunctionInfo>();
  for (const func of functions) {
    functionMap.set(func.id, func);
  }
  
  // Create dependency metrics lookup map
  const depMetricsMap = new Map<string, import('../../../analyzers/dependency-metrics').DependencyMetrics>();
  for (const depMetric of depMetrics) {
    depMetricsMap.set(depMetric.functionId, depMetric);
  }
  
  // OPTIMIZED: Build reverse index map once for O(E+F) complexity instead of O(E×F)
  const inboundByCallee = new Map<string, Array<{callerFunctionId: string; count: number}>>();
  const edgeCountMap = new Map<string, number>();
  
  for (const edge of callEdges) {
    if (edge.calleeFunctionId === null || edge.callerFunctionId === null) continue;
    
    const edgeKey = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
    edgeCountMap.set(edgeKey, (edgeCountMap.get(edgeKey) || 0) + 1);
  }
  
  for (const [edgeKey, count] of edgeCountMap) {
    const [callerFunctionId, calleeFunctionId] = edgeKey.split('->');
    if (!inboundByCallee.has(calleeFunctionId)) {
      inboundByCallee.set(calleeFunctionId, []);
    }
    inboundByCallee.get(calleeFunctionId)!.push({ callerFunctionId, count });
  }
  
  // Build call analysis using existing dependency metrics data
  for (const func of functions) {
    const depMetric = depMetricsMap.get(func.id);
    if (!depMetric) continue;
    
    // OPTIMIZED: Get inbound edges from pre-built index (O(1) lookup)
    const inboundEdges = inboundByCallee.get(func.id) || [];
    
    const callersByLayer = new Map<string, Array<{ functionName: string; callCount: number }>>();
    const crossLayerCallers: Array<{ functionName: string; layer: string; callCount: number }> = [];
    
    // OPTIMIZED: Direct use of pre-calculated call counts from reverse index
    for (const inboundEdge of inboundEdges) {
      const callerId = inboundEdge.callerFunctionId;
      const callCount = inboundEdge.count;
      const callerFunc = functionMap.get(callerId);
      if (!callerFunc) continue;
      
      const callerLayer = defaultLayerDetector.detectLayer(callerFunc.filePath);
      const targetLayer = defaultLayerDetector.detectLayer(func.filePath);
      
      const callerInfo = { functionName: callerFunc.name, callCount };
      
      if (!callersByLayer.has(callerLayer)) {
        callersByLayer.set(callerLayer, []);
      }
      callersByLayer.get(callerLayer)?.push(callerInfo);
      
      // Track cross-layer calls
      if (callerLayer !== targetLayer) {
        crossLayerCallers.push({
          functionName: callerFunc.name,
          layer: callerLayer,
          callCount
        });
      }
    }
    
    // Use dependency metrics fan-in (this is the correct value)
    const analysis = {
      functionId: func.id,
      totalInboundCalls: depMetric.fanIn, // Use existing calculated fan-in!
      callersByLayer,
      crossLayerCallers
    };
    
    callAnalysisMap.set(func.id, analysis);
  }
  
  return callAnalysisMap;
}

/**
 * Get SCC participation info for a function
 */
export function getSCCParticipation(
  functionId: string,
  structuralMetrics: StructuralMetrics
): string | undefined {
  if (!structuralMetrics.cyclicFunctionIds?.includes(functionId)) {
    return undefined;
  }
  
  // For now, return simple participation info
  // In a full implementation, this would include component ID and size
  return `Participates in circular dependency (${structuralMetrics.cyclicFunctions} total cyclic functions)`;
}

/**
 * Calculate expected structural impact of improvements
 */
export function calculateStructuralImpact(
  currentFanIn: number,
  targetFanInReduction: number
): { fanInReduction: string; penaltyReduction: string } {
  const newFanIn = Math.max(5, currentFanIn - targetFanInReduction);
  const fanInReduction = `${currentFanIn}→${newFanIn}`;
  
  // Estimate penalty reduction based on fan-in improvement
  // This is a simplified calculation - actual penalty is more complex
  const fanInPenaltyReduction = Math.min(targetFanInReduction * 1.5, 50);
  const penaltyReduction = `~${fanInPenaltyReduction}pts reduction (before capping)`;
  
  return { fanInReduction, penaltyReduction };
}

/**
 * Generate refactor steps based on structural issues
 */
export function generateRefactorSteps(
  fanIn: number,
  hasCrossLayerCalls: boolean,
  isInSCC: boolean
): string[] {
  const steps: string[] = [];
  
  if (fanIn > 50) {
    steps.push('Split into purpose-specific APIs (byId/latest/range/search)');
    steps.push('Redirect high-frequency callers to specialized APIs');
  } else if (fanIn > 20) {
    steps.push('Split into 2-3 purpose-specific APIs');
    steps.push('Redirect callers to appropriate specialized APIs');
  }
  
  if (hasCrossLayerCalls) {
    steps.push('Add service layer facades for cross-layer calls');
    steps.push('Establish clear architectural boundaries');
  }
  
  if (isInSCC) {
    steps.push('Apply dependency inversion to break circular dependencies');
    steps.push('Extract interfaces to decouple dependencies');
  }
  
  steps.push('Extract query/mapping responsibilities into helper functions');
  
  return steps;
}

/**
 * Generate success criteria for structural improvements
 */
export function generateSuccessCriteria(
  currentFanIn: number,
  structuralMetrics: StructuralMetrics
): string[] {
  const criteria: string[] = [];
  
  const targetFanIn = Math.max(20, Math.floor(currentFanIn * 0.7));
  criteria.push(`Max Fan-in < ${targetFanIn}`);
  
  if (structuralMetrics.hubFunctions > 30) {
    criteria.push('Hub functions < 30');
  }
  
  // Estimate cross-layer improvement target
  const layerAnalysis = structuralMetrics.pageRank?.layerBasedAnalysis;
  if (layerAnalysis?.crossLayerRatio && layerAnalysis.crossLayerRatio > 0.6) {
    // crossLayerRatio is already a ratio (0-1), so convert to percentage correctly
    const currentCrossLayerPercent = layerAnalysis.crossLayerRatio * 100;
    const targetCrossLayerPercent = Math.floor(currentCrossLayerPercent * 0.85);
    criteria.push(`Cross-layer calls < ${targetCrossLayerPercent}%`);
  }
  
  criteria.push('PageRank centrality rank reduced to High or Medium');
  
  return criteria;
}

/**
 * Generate comprehensive structural recommendations
 */
export async function generateStructuralRecommendations(
  riskAssessments: FunctionRiskAssessment[],
  functions: FunctionInfo[],
  structuralMetrics: StructuralMetrics,
  depMetrics: import('../../../analyzers/dependency-metrics').DependencyMetrics[],
  snapshotId: string,
  env: CommandEnvironment,
  topN: number = 3
): Promise<StructuralRecommendation[]> {
  const callAnalysisMap = await analyzeCallPatternsWithDepMetrics(functions, depMetrics, snapshotId, env);
  const recommendations: StructuralRecommendation[] = [];
  
  // Get top risk functions with structural context
  const topRiskAssessments = riskAssessments
    .filter(assessment => assessment.riskLevel === 'high' || assessment.riskLevel === 'critical')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, topN);
  
  for (const assessment of topRiskAssessments) {
    const func = functions.find(f => f.id === assessment.functionId);
    if (!func) continue;
    
    const callAnalysis = callAnalysisMap.get(func.id);
    if (!callAnalysis) continue;
    
    const fanIn = callAnalysis.totalInboundCalls;
    const hasCrossLayerCalls = callAnalysis.crossLayerCallers.length > 0;
    const isInSCC = structuralMetrics.cyclicFunctionIds?.includes(func.id) ?? false;
    
    // Generate cross-layer info
    let crossLayerInfo: string | undefined;
    if (hasCrossLayerCalls) {
      const targetLayer = defaultLayerDetector.detectLayer(func.filePath);
      const callerLayers = [...new Set(callAnalysis.crossLayerCallers.map(c => c.layer))];
      crossLayerInfo = `${targetLayer}←${callerLayers.join(',')}`;
    }
    
    // Get SCC info
    const sccInfo = getSCCParticipation(func.id, structuralMetrics);
    
    // Get top callers (limit to 10)
    const topCallers: Array<{ functionName: string; callCount: number; layer: string }> = [];
    for (const [layer, callers] of callAnalysis.callersByLayer) {
      for (const caller of callers.slice(0, 3)) { // Top 3 per layer
        topCallers.push({ ...caller, layer });
      }
    }
    topCallers.sort((a, b) => b.callCount - a.callCount);
    
    // Calculate expected impact
    const targetReduction = Math.max(10, Math.floor(fanIn * 0.3));
    const expectedImpact = calculateStructuralImpact(fanIn, targetReduction);
    
    // Generate refactor steps and success criteria
    const refactorSteps = generateRefactorSteps(fanIn, hasCrossLayerCalls, isInSCC);
    const successCriteria = generateSuccessCriteria(fanIn, structuralMetrics);
    
    recommendations.push({
      functionId: func.id,
      functionName: func.name,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: func.endLine ?? func.startLine + (func.metrics?.linesOfCode || 10),
      fanIn,
      crossLayerInfo,
      sccInfo,
      topCallers: topCallers.slice(0, 10),
      expectedImpact,
      refactorSteps,
      successCriteria
    });
  }
  
  return recommendations;
}