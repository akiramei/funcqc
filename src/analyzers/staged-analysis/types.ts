/**
 * Type definitions for the Staged Analysis Engine
 */

import { IdealCallEdge, FunctionMetadata } from '../ideal-call-graph-analyzer';
import { UnresolvedMethodCall, MethodInfo } from '../cha-analyzer';
import { Logger } from '../../utils/cli-utils';
import { Node, Symbol as TsMorphSymbol } from 'ts-morph';

/**
 * Options for the Staged Analysis Engine
 */
export interface StagedAnalysisOptions {
  logger?: Logger;
}

/**
 * Instantiation event for RTA analysis
 */
export interface InstantiationEvent {
  typeName: string;
  filePath: string;
  lineNumber: number;
  instantiationType: 'constructor' | 'factory';
  node: Node;
  contextFunctionId?: string;
}

/**
 * Internal data structures for the analysis engine
 */
export interface AnalysisState {
  edges: IdealCallEdge[];
  edgeKeys: Set<string>;
  edgeIndex: Map<string, IdealCallEdge>;
  functionLookupMap: Map<string, string>;
  unresolvedMethodCalls: UnresolvedMethodCall[];
  instantiationEvents: InstantiationEvent[];
  unresolvedMethodCallsForRTA: UnresolvedMethodCall[];
  unresolvedMethodCallsSet: Set<string>;
  chaCandidates: Map<string, MethodInfo[]>;
  fileToFunctionsMap: Map<string, FunctionMetadata[]>;
  functionContainmentMaps: Map<string, Array<{start: number, end: number, id: string}>>;
  positionIdCache: WeakMap<Node, string>;
}

/**
 * Cache structure for symbol resolution
 */
export interface SymbolCacheData {
  node: Node;
  symbol: TsMorphSymbol | undefined;
}

/**
 * Statistics for analysis performance
 */
export interface AnalysisStatistics {
  localExactCount: number;
  importExactCount: number;
  chaResolvedCount: number;
  rtaResolvedCount: number;
  runtimeConfirmedCount: number;
  unresolvedCount: number;
  totalTime: number;
  stageTimings: {
    localExact: number;
    importExact: number;
    cha: number;
    rta: number;
    runtime: number;
  };
}