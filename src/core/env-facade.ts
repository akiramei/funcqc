import type { CommandEnvironment } from '../types/environment';
import type { CallGraphData } from '../types/environment';
import type { SnapshotInfo, FunctionInfo } from '../types';

/**
 * Build CallGraphData safely by merging previous data with provided fields.
 */
export function buildCallGraphData(
  prev: CallGraphData | undefined,
  next: { snapshot: SnapshotInfo; functions?: FunctionInfo[]; callEdges?: import('../types').CallEdge[]; internalCallEdges?: import('../types').InternalCallEdge[]; allEdges?: import('../types').CallEdge[]; lazyAnalysisPerformed?: boolean }
): CallGraphData {
  return {
    snapshot: next.snapshot,
    functions: next.functions ?? prev?.functions ?? [],
    callEdges: next.callEdges ?? prev?.callEdges ?? [],
    internalCallEdges: next.internalCallEdges ?? prev?.internalCallEdges ?? [],
    allEdges: next.allEdges ?? prev?.allEdges ?? [],
    ...(typeof next.lazyAnalysisPerformed === 'boolean' ? { lazyAnalysisPerformed: next.lazyAnalysisPerformed } : (prev?.lazyAnalysisPerformed !== undefined ? { lazyAnalysisPerformed: prev.lazyAnalysisPerformed } : {})),
  } as CallGraphData;
}

/**
 * Prime env with functions after BASIC analysis to avoid reloading from DB in the same process.
 */
export async function primeFunctionsAfterBasic(
  env: CommandEnvironment,
  snapshotId: string,
  functions: FunctionInfo[],
  verbose?: boolean
): Promise<void> {
  const snapshot = await env.storage.getSnapshot(snapshotId);
  if (!snapshot) return;
  env.callGraphData = buildCallGraphData(env.callGraphData, { snapshot, functions });
  if (verbose) {
    env.commandLogger.info(`⚡ Primed env with ${functions.length} functions for snapshot ${snapshotId.substring(0, 8)}`);
  }
}

/**
 * Ensure shared ts-morph project exists in env for the given snapshot and files.
 */
export async function ensureSharedProject(
  env: CommandEnvironment,
  snapshotId: string,
  fileContentMap: Map<string, string>
): Promise<{ isNewlyCreated: boolean } | null> {
  if (!env.projectManager) return null;
  const { isNewlyCreated } = await env.projectManager.getOrCreateProject(snapshotId, fileContentMap);
  return { isNewlyCreated };
}

// Re-export function cache utility for centralized usage
export { getOrLoadFunctions } from '../utils/functions-cache';

