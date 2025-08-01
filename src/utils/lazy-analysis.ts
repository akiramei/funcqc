import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { StorageAdapter } from '../types';
import { CommandEnvironment } from '../types/environment';
import { FunctionAnalyzer } from '../core/analyzer';

/**
 * Lazy analysis utility for ensuring call graph data is available
 * Used by dep/dead/clean/safe-delete commands to automatically trigger call graph analysis when needed
 */

/**
 * Check if call graph analysis is required for the latest snapshot
 */
export async function isCallGraphAnalysisRequired(storage: StorageAdapter): Promise<{
  required: boolean;
  snapshot: import('../types').SnapshotInfo | null;
  reason?: string;
}> {
  const snapshots = await storage.getSnapshots({ limit: 1 });
  const snapshot = snapshots.length > 0 ? snapshots[0] : null;
  
  if (!snapshot) {
    return {
      required: false,
      snapshot: null,
      reason: 'No snapshots found'
    };
  }

  // Check if call graph analysis is already completed
  const callGraphCompleted = snapshot.metadata && 'callGraphAnalysisCompleted' in snapshot.metadata ? 
    snapshot.metadata.callGraphAnalysisCompleted : false;
  if (callGraphCompleted) {
    return {
      required: false,
      snapshot,
      reason: 'Call graph analysis already completed'
    };
  }

  // Check if basic analysis is completed (prerequisite for call graph)
  const basicCompleted = snapshot.metadata && 'basicAnalysisCompleted' in snapshot.metadata ? 
    snapshot.metadata.basicAnalysisCompleted : false;
  if (!basicCompleted) {
    return {
      required: false,
      snapshot,
      reason: 'Basic analysis not completed - run `funcqc scan` first'
    };
  }

  return {
    required: true,
    snapshot,
    reason: 'Call graph analysis required for dependency commands'
  };
}

/**
 * Ensure call graph data is available, performing analysis if needed
 */
export async function ensureCallGraphData(
  env: CommandEnvironment,
  options: {
    showProgress?: boolean;
    requireCallGraph?: boolean;
  } = {}
): Promise<{
  success: boolean;
  snapshot: import('../types').SnapshotInfo | null;
  callEdges: import('../types').CallEdge[];
  message?: string;
}> {
  const { showProgress = true, requireCallGraph = true } = options;
  
  let spinner: Ora | undefined;
  if (showProgress) {
    spinner = ora('Checking analysis status...').start();
  }

  try {
    const analysisStatus = await checkAnalysisStatus(env.storage, spinner);
    if (!analysisStatus.snapshot) {
      return createErrorResult('No snapshots found', null, spinner);
    }

    if (!analysisStatus.required) {
      return await loadExistingCallGraphData(env, analysisStatus.snapshot, spinner);
    }

    if (!requireCallGraph) {
      return createCallGraphRequiredResult(analysisStatus.snapshot, spinner);
    }

    return await performNewCallGraphAnalysis(env, analysisStatus.snapshot, spinner);
  } catch (error) {
    return createErrorResult(
      error instanceof Error ? error.message : String(error),
      null,
      spinner
    );
  }
}

/**
 * Perform lazy call graph analysis on an existing snapshot
 */
async function performLazyCallGraphAnalysis(
  env: CommandEnvironment,
  snapshotId: string,
  spinner?: Ora
): Promise<{
  success: boolean;
  callEdges: import('../types').CallEdge[];
  error?: string;
}> {
  try {
    // Get source files for the snapshot
    const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
    
    if (sourceFiles.length === 0) {
      return {
        success: false,
        callEdges: [],
        error: 'No source files found in snapshot'
      };
    }

    if (spinner) {
      spinner.text = `Analyzing call graph from ${sourceFiles.length} files...`;
    }

    // Create analyzer instance and get existing functions
    const analyzer = new FunctionAnalyzer(env.config);
    const functions = await env.storage.findFunctionsInSnapshot(snapshotId);
    
    // Create file content map
    const fileContentMap = new Map<string, string>();
    sourceFiles.forEach(file => {
      fileContentMap.set(file.filePath, file.fileContent);
    });

    // Perform call graph analysis from stored content
    const result = await analyzer.analyzeCallGraphFromContent(
      fileContentMap,
      functions
    );

    // Store call graph results
    await env.storage.insertCallEdges(result.callEdges, snapshotId);
    
    try {
      // Update the snapshot_id from 'temp' to the actual snapshot ID
      const internalCallEdgesWithCorrectSnapshotId = result.internalCallEdges.map(edge => ({
        ...edge,
        snapshotId: snapshotId
      }));
      
      await env.storage.insertInternalCallEdges(internalCallEdgesWithCorrectSnapshotId);
    } catch (error) {
      console.error(`❌ Failed to insert internal call edges:`, error);
      throw error;
    }
    
    await env.storage.updateAnalysisLevel(snapshotId, 'CALL_GRAPH');

    return {
      success: true,
      callEdges: result.callEdges
    };

  } catch (error) {
    return {
      success: false,
      callEdges: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Load call graph data with lazy analysis fallback
 * This is a convenience function for commands that need call graph data
 */
export async function loadCallGraphWithLazyAnalysis(
  env: CommandEnvironment,
  options: {
    showProgress?: boolean;
    snapshotId?: string | undefined;
  } = {}
): Promise<{
  snapshot: import('../types').SnapshotInfo | null;
  callEdges: import('../types').CallEdge[];
  functions: import('../types').FunctionInfo[];
  lazyAnalysisPerformed?: boolean;
}> {
  const { showProgress = true, snapshotId } = options;

  // Get specific snapshot or latest
  const snapshot = snapshotId 
    ? await env.storage.getSnapshot(snapshotId)
    : await env.storage.getLatestSnapshot();

  if (!snapshot) {
    throw new Error('No snapshots found. Run `funcqc scan` first.');
  }

  // Get functions first
  const functions = await env.storage.findFunctionsInSnapshot(snapshot.id);

  // Ensure call graph data is available
  const callGraphResult = await ensureCallGraphData(env, { showProgress });

  if (!callGraphResult.success) {
    throw new Error('Failed to load call graph data');
  }

  const messageStr = callGraphResult.message ? String(callGraphResult.message) : '';
  const lazyAnalysisPerformed = messageStr.includes('completed');
  
  return {
    snapshot,
    callEdges: callGraphResult.callEdges || [],
    functions,
    ...(lazyAnalysisPerformed !== undefined && { lazyAnalysisPerformed })
  };
}

/**
 * Load comprehensive call graph data including internal call edges
 * This combines both external call_edges and internal_call_edges for complete analysis
 */
export async function loadComprehensiveCallGraphData(
  env: CommandEnvironment,
  options: {
    showProgress?: boolean;
    snapshotId?: string | undefined;
  } = {}
): Promise<{
  snapshot: import('../types').SnapshotInfo | null;
  callEdges: import('../types').CallEdge[];
  internalCallEdges: import('../types').InternalCallEdge[];
  allEdges: import('../types').CallEdge[]; // Combined and normalized
  functions: import('../types').FunctionInfo[];
  lazyAnalysisPerformed?: boolean;
}> {
  const { showProgress = true, snapshotId } = options;

  // Get basic call graph data first
  const basicResult = await loadCallGraphWithLazyAnalysis(env, { showProgress, snapshotId });
  
  if (!basicResult.snapshot) {
    throw new Error('Failed to load snapshot');
  }

  // Get internal call edges for complete analysis
  const internalCallEdges = await env.storage.getInternalCallEdgesBySnapshot(basicResult.snapshot.id);

  // Convert internal call edges to CallEdge format for unified processing
  const convertedInternalEdges: import('../types').CallEdge[] = internalCallEdges.map(edge => ({
    id: edge.id,
    callerFunctionId: edge.callerFunctionId,
    calleeFunctionId: edge.calleeFunctionId,
    calleeName: edge.calleeName,
    calleeSignature: undefined,
    callerClassName: edge.callerClassName,
    calleeClassName: edge.calleeClassName,
    callType: edge.callType,
    callContext: edge.callContext,
    lineNumber: edge.lineNumber,
    columnNumber: edge.columnNumber,
    isAsync: false,
    isChained: false,
    confidenceScore: edge.confidenceScore,
    metadata: { source: 'internal', filePath: edge.filePath },
    createdAt: edge.createdAt,
  }));

  // Combine all edges for unified analysis
  const allEdges = [...basicResult.callEdges, ...convertedInternalEdges];

  return {
    ...basicResult,
    internalCallEdges,
    allEdges
  };
}

/**
 * Create a progress message for lazy analysis
 */
export function createLazyAnalysisMessage(
  commandName: string,
  isRequired: boolean
): string {
  if (isRequired) {
    return chalk.blue(
      `🔍 ${commandName} requires call graph analysis. Performing analysis now...`
    );
  } else {
    return chalk.gray(
      `📊 Loading existing call graph data for ${commandName}...`
    );
  }
}

/**
 * Validate that command can proceed with available data
 */
export function validateCallGraphRequirements(
  callEdges: import('../types').CallEdge[],
  commandName: string
): void {
  if (callEdges.length === 0) {
    console.log(chalk.yellow(
      `⚠️  No call graph data found. ${commandName} requires function dependencies to be analyzed.`
    ));
    console.log(chalk.gray('This could mean:'));
    console.log(chalk.gray('  • No function calls were detected in your code'));
    console.log(chalk.gray('  • Call graph analysis encountered errors'));
    console.log(chalk.gray('  • Project contains only isolated functions'));
    console.log();
    console.log(chalk.blue('💡 Try running `funcqc scan` to re-analyze your project.'));
    throw new Error('Insufficient call graph data for analysis');
  }
}

// ================== Helper Functions for Refactored ensureCallGraphData ==================

type CallGraphResult = {
  success: boolean;
  snapshot: import('../types').SnapshotInfo | null;
  callEdges: import('../types').CallEdge[];
  message?: string;
};

/**
 * Check if call graph analysis is required and return status
 */
async function checkAnalysisStatus(
  storage: StorageAdapter,
  spinner?: Ora
): Promise<{ snapshot: import('../types').SnapshotInfo | null; required: boolean }> {
  const analysisCheck = await isCallGraphAnalysisRequired(storage);
  
  if (!analysisCheck.snapshot) {
    if (spinner) spinner.fail('No snapshots found. Run `funcqc scan` first.');
  }
  
  return analysisCheck;
}

/**
 * Load existing call graph data from storage
 */
async function loadExistingCallGraphData(
  env: CommandEnvironment,
  snapshot: import('../types').SnapshotInfo,
  spinner?: Ora
): Promise<CallGraphResult> {
  if (spinner) {
    spinner.text = 'Loading existing call graph data...';
  }
  
  const callEdges = await env.storage.getCallEdgesBySnapshot(snapshot.id);
  
  if (spinner) {
    spinner.succeed(`Call graph data loaded: ${callEdges.length} edges`);
  }
  
  return {
    success: true,
    snapshot,
    callEdges,
    message: 'Existing call graph data loaded'
  };
}

/**
 * Create result when call graph analysis is required but not requested
 */
function createCallGraphRequiredResult(
  snapshot: import('../types').SnapshotInfo,
  spinner?: Ora
): CallGraphResult {
  if (spinner) {
    spinner.warn('Call graph analysis required but not requested');
  }
  
  return {
    success: false,
    snapshot,
    callEdges: [],
    message: 'Call graph analysis required'
  };
}

/**
 * Perform new call graph analysis
 */
async function performNewCallGraphAnalysis(
  env: CommandEnvironment,
  snapshot: import('../types').SnapshotInfo,
  spinner?: Ora
): Promise<CallGraphResult> {
  if (spinner) {
    spinner.text = 'Performing call graph analysis...';
  }

  const result = await performLazyCallGraphAnalysis(
    env,
    snapshot.id,
    spinner
  );

  if (result.success) {
    if (spinner) {
      spinner.succeed(`Call graph analysis completed: ${result.callEdges.length} edges found`);
    }
    return {
      success: true,
      snapshot,
      callEdges: result.callEdges,
      message: 'Call graph analysis completed'
    };
  } else {
    if (spinner) {
      spinner.fail('Call graph analysis failed');
    }
    return {
      success: false,
      snapshot,
      callEdges: [],
      message: result.error || 'Call graph analysis failed'
    };
  }
}

/**
 * Create error result with consistent format
 */
function createErrorResult(
  message: string,
  snapshot: import('../types').SnapshotInfo | null,
  spinner?: Ora
): CallGraphResult {
  if (spinner) {
    spinner.fail('Error during call graph analysis');
  }
  
  return {
    success: false,
    snapshot,
    callEdges: [],
    message
  };
}