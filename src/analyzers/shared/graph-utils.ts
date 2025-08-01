import { IdealCallEdge } from '../ideal-call-graph-analyzer';
import { AnalysisState } from '../staged-analysis/types';

/**
 * Shared graph utilities for analysis stages
 * Common edge management functions to avoid duplication across analyzers
 */

/**
 * Add edge to state with deduplication
 * Prevents duplicate edges by maintaining a key-based index
 */
export function addEdge(edge: IdealCallEdge, state: AnalysisState): void {
  const edgeKey = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
  
  if (!state.edgeKeys.has(edgeKey)) {
    state.edges.push(edge);
    state.edgeKeys.add(edgeKey);
    state.edgeIndex.set(edgeKey, edge);
  }
}