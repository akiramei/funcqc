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
    // Check if call graph analysis is required
    const analysisCheck = await isCallGraphAnalysisRequired(env.storage);
    
    if (!analysisCheck.snapshot) {
      if (spinner) spinner.fail('No snapshots found. Run `funcqc scan` first.');
      return {
        success: false,
        snapshot: null,
        callEdges: [],
        message: 'No snapshots found'
      };
    }

    // If call graph analysis is not required, load existing data
    if (!analysisCheck.required) {
      if (spinner) {
        spinner.text = 'Loading existing call graph data...';
      }
      
      const callEdges = await env.storage.getCallEdgesBySnapshot(analysisCheck.snapshot.id);
      
      // If no call edges found, force re-analysis
      if (callEdges.length === 0) {
        console.log(`📊 No call edges found in existing data, forcing re-analysis`);
        // Continue to perform analysis below instead of returning here
      } else {
        if (spinner) {
          spinner.succeed(`Call graph data loaded: ${callEdges.length} edges`);
        }
        
        return {
          success: true,
          snapshot: analysisCheck.snapshot,
          callEdges,
          message: 'Existing call graph data loaded'
        };
      }
    }

    // Call graph analysis is required
    if (!requireCallGraph) {
      if (spinner) {
        spinner.warn('Call graph analysis required but not requested');
      }
      return {
        success: false,
        snapshot: analysisCheck.snapshot,
        callEdges: [],
        message: 'Call graph analysis required'
      };
    }

    if (spinner) {
      spinner.text = 'Performing call graph analysis...';
    }

    // Perform call graph analysis
    const result = await performLazyCallGraphAnalysis(
      env,
      analysisCheck.snapshot.id,
      spinner
    );

    if (result.success) {
      if (spinner) {
        spinner.succeed(`Call graph analysis completed: ${result.callEdges.length} edges found`);
      }
      return {
        success: true,
        snapshot: analysisCheck.snapshot,
        callEdges: result.callEdges,
        message: 'Call graph analysis completed'
      };
    } else {
      if (spinner) {
        spinner.fail('Call graph analysis failed');
      }
      return {
        success: false,
        snapshot: analysisCheck.snapshot,
        callEdges: [],
        message: result.error || 'Call graph analysis failed'
      };
    }

  } catch (error) {
    if (spinner) {
      spinner.fail('Error during call graph analysis');
    }
    
    return {
      success: false,
      snapshot: null,
      callEdges: [],
      message: error instanceof Error ? error.message : String(error)
    };
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
    const functions = await env.storage.getFunctionsBySnapshot(snapshotId);
    
    // Create file content map
    const fileContentMap = new Map<string, string>();
    sourceFiles.forEach(file => {
      fileContentMap.set(file.filePath, file.fileContent);
    });

    // Perform call graph analysis from stored content
    console.log(`📊 Starting call graph analysis from content with ${functions.length} functions`);
    const result = await analyzer.analyzeCallGraphFromContent(
      fileContentMap,
      functions
    );
    console.log(`📊 Call graph analysis completed with ${result.callEdges.length} call edges`);

    // Store call graph results
    await env.storage.insertCallEdges(result.callEdges, snapshotId);
    // TODO: Fix internal call edges schema mismatch - skip for now
    // await env.storage.insertInternalCallEdges(result.internalCallEdges);
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
  const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);

  // Ensure call graph data is available
  const callGraphResult = await ensureCallGraphData(env, { showProgress });

  if (!callGraphResult.success) {
    throw new Error(callGraphResult.message || 'Failed to load call graph data');
  }

  const lazyAnalysisPerformed = callGraphResult.message?.includes('completed');
  
  return {
    snapshot,
    callEdges: callGraphResult.callEdges || [],
    functions,
    ...(lazyAnalysisPerformed !== undefined && { lazyAnalysisPerformed })
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