import { CommandEnvironment } from '../types/environment';
import type { FunctionInfo, SnapshotInfo } from '../types';

/**
 * Get functions for a snapshot from cache if available; otherwise load from storage and cache on env.
 * Caches into env.callGraphData to avoid additional shape proliferation.
 */
export async function getOrLoadFunctions(
  env: CommandEnvironment,
  snapshotId: string
): Promise<{ snapshot: SnapshotInfo; functions: FunctionInfo[] }> {
  // Reuse if env already holds the functions for this snapshot
  const cached = env.callGraphData;
  if (cached && cached.snapshot && cached.snapshot.id === snapshotId && Array.isArray(cached.functions)) {
    return { snapshot: cached.snapshot, functions: cached.functions };
  }

  // Load from storage
  const snapshot = await env.storage.getSnapshot(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  const functions = await env.storage.findFunctionsInSnapshot(snapshotId);

  // Cache back into env.callGraphData (preserving existing edges if present)
  const nextData = {
    snapshot,
    functions,
    callEdges: cached?.callEdges || [],
    internalCallEdges: cached?.internalCallEdges || [],
    allEdges: cached?.allEdges || [],
  } as import('../types/environment').CallGraphData;
  if (typeof cached?.lazyAnalysisPerformed === 'boolean') {
    nextData.lazyAnalysisPerformed = cached.lazyAnalysisPerformed;
  }
  env.callGraphData = nextData;

  return { snapshot, functions };
}
