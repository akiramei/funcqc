/**
 * Helper functions for managing ScanSharedData lifecycle
 */

import { ScanSharedData, BasicAnalysisResult, CallGraphAnalysisResult, TypeSystemAnalysisResult, CouplingAnalysisResult } from '../types/scan-shared-data';
import { CommandEnvironment } from '../types/environment';
import { FunctionInfo } from '../types';

/**
 * Initialize ScanSharedData from snapshot
 */
export async function initializeScanSharedData(
  env: CommandEnvironment,
  snapshotId: string
): Promise<ScanSharedData> {
  // Ensure project exists
  if (!env.projectManager) {
    throw new Error('ProjectManager not available in environment');
  }

  const project = env.projectManager.getProject(snapshotId);
  const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
  
  // Build file mappings
  const sourceFileIdMap = new Map<string, string>();
  const fileContentMap = new Map<string, string>();
  
  for (const sourceFile of sourceFiles) {
    sourceFileIdMap.set(sourceFile.filePath, sourceFile.id);
    fileContentMap.set(sourceFile.filePath, sourceFile.fileContent);
  }

  return {
    snapshotId,
    project,
    sourceFiles,
    functions: [], // Will be populated by BASIC analysis
    sourceFileIdMap,
    fileContentMap
  };
}

/**
 * Set ScanSharedData in environment and ensure it's initialized
 */
export async function ensureScanSharedData(
  env: CommandEnvironment,
  snapshotId: string
): Promise<void> {
  if (!env.scanSharedData || env.scanSharedData.snapshotId !== snapshotId) {
    env.scanSharedData = await initializeScanSharedData(env, snapshotId);
  }
}

/**
 * Load existing analysis results from database and populate shared data
 */
export async function loadExistingAnalysisResults(
  env: CommandEnvironment,
  snapshotId: string
): Promise<void> {
  await ensureScanSharedData(env, snapshotId);
  
  const sharedData = env.scanSharedData!;

  // Load functions if not already loaded
  if (sharedData.functions.length === 0) {
    sharedData.functions = await env.storage.findFunctionsInSnapshot(snapshotId);
    
    if (sharedData.functions.length > 0) {
      // Create basic analysis result from loaded functions
      sharedData.basicResults = {
        functions: sharedData.functions,
        functionsAnalyzed: sharedData.functions.length,
        errors: [],
        batchStats: {
          totalBatches: 1,
          functionsPerBatch: [sharedData.functions.length],
          processingTimes: [0]
        }
      };
    }
  }

  // Load call graph results if available
  try {
    const callEdges = await env.storage.getCallEdgesBySnapshot(snapshotId);
    const internalCallEdges = await env.storage.getInternalCallEdgesBySnapshot(snapshotId);
    
    if (callEdges.length > 0 || internalCallEdges.length > 0) {
      // Build dependency map
      const dependencyMap = new Map<string, {callers: string[], callees: string[], depth: number}>();
      
      for (const edge of callEdges) {
        if (edge.callerFunctionId && edge.calleeFunctionId) {
          // Add to callee's callers
          if (!dependencyMap.has(edge.calleeFunctionId)) {
            dependencyMap.set(edge.calleeFunctionId, {callers: [], callees: [], depth: 0});
          }
          dependencyMap.get(edge.calleeFunctionId)!.callers.push(edge.callerFunctionId);
          
          // Add to caller's callees
          if (!dependencyMap.has(edge.callerFunctionId)) {
            dependencyMap.set(edge.callerFunctionId, {callers: [], callees: [], depth: 0});
          }
          dependencyMap.get(edge.callerFunctionId)!.callees.push(edge.calleeFunctionId);
        }
      }
      
      const highConfidenceEdges = callEdges.filter(e => e.confidenceScore && e.confidenceScore >= 0.95).length;
      const mediumConfidenceEdges = callEdges.filter(e => e.confidenceScore && e.confidenceScore >= 0.7 && e.confidenceScore < 0.95).length;
      const lowConfidenceEdges = callEdges.length - highConfidenceEdges - mediumConfidenceEdges;

      sharedData.callGraphResults = {
        callEdges,
        internalCallEdges,
        dependencyMap,
        stats: {
          totalEdges: callEdges.length,
          highConfidenceEdges,
          mediumConfidenceEdges,
          lowConfidenceEdges,
          analysisTime: 0
        }
      };
    }
  } catch (error) {
    // Call graph data not available - this is okay for some scenarios
    env.commandLogger.debug(`Call graph data not available for snapshot ${snapshotId}: ${error}`);
  }

  // TODO: Load type system results when implemented
  // TODO: Load coupling results when implemented
}

/**
 * Update basic analysis results in shared data
 */
export function setBasicAnalysisResults(
  env: CommandEnvironment,
  result: BasicAnalysisResult
): void {
  if (!env.scanSharedData) {
    throw new Error('ScanSharedData not initialized');
  }
  
  env.scanSharedData.functions = result.functions;
  env.scanSharedData.basicResults = result;
}

/**
 * Update call graph analysis results in shared data
 */
export function setCallGraphAnalysisResults(
  env: CommandEnvironment,
  result: CallGraphAnalysisResult
): void {
  if (!env.scanSharedData) {
    throw new Error('ScanSharedData not initialized');
  }
  
  env.scanSharedData.callGraphResults = result;
}

/**
 * Update type system analysis results in shared data
 */
export function setTypeSystemAnalysisResults(
  env: CommandEnvironment,
  result: TypeSystemAnalysisResult
): void {
  if (!env.scanSharedData) {
    throw new Error('ScanSharedData not initialized');
  }
  
  env.scanSharedData.typeSystemResults = result;
}

/**
 * Update coupling analysis results in shared data
 */
export function setCouplingAnalysisResults(
  env: CommandEnvironment,
  result: CouplingAnalysisResult
): void {
  if (!env.scanSharedData) {
    throw new Error('ScanSharedData not initialized');
  }
  
  env.scanSharedData.couplingResults = result;
}

/**
 * Check if specific analysis results are available
 */
export function hasAnalysisResults(
  env: CommandEnvironment,
  analysisType: 'basic' | 'callGraph' | 'typeSystem' | 'coupling'
): boolean {
  if (!env.scanSharedData) {
    return false;
  }

  switch (analysisType) {
    case 'basic':
      return !!env.scanSharedData.basicResults && env.scanSharedData.functions.length > 0;
    case 'callGraph':
      return !!env.scanSharedData.callGraphResults;
    case 'typeSystem':
      return !!env.scanSharedData.typeSystemResults;
    case 'coupling':
      return !!env.scanSharedData.couplingResults;
    default:
      return false;
  }
}

/**
 * Get functions from shared data with fallback to database
 */
export async function getFunctions(env: CommandEnvironment, snapshotId: string): Promise<FunctionInfo[]> {
  // Try to get from shared data first
  if (env.scanSharedData?.snapshotId === snapshotId && env.scanSharedData.functions.length > 0) {
    return env.scanSharedData.functions;
  }

  // Fallback to database
  return await env.storage.findFunctionsInSnapshot(snapshotId);
}

/**
 * Cleanup shared data to free memory
 */
export function cleanupScanSharedData(env: CommandEnvironment): void {
  if (env.scanSharedData) {
    // Clear large data structures
    env.scanSharedData.fileContentMap.clear();
    env.scanSharedData.sourceFileIdMap.clear();
    
    // Clear analysis results (delete optional properties)
    delete env.scanSharedData.basicResults;
    delete env.scanSharedData.callGraphResults;
    delete env.scanSharedData.typeSystemResults;
    delete env.scanSharedData.couplingResults;
    
    // Clear the entire shared data
    delete env.scanSharedData;
  }
}