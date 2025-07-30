import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import { FuncqcConfig, CallEdge, InternalCallEdge, FunctionInfo, SnapshotInfo } from '../types';

/**
 * Application environment containing all shared dependencies
 */
export interface AppEnvironment {
  storage: PGLiteStorageAdapter;
  config: FuncqcConfig;
  logger: Logger;
}

/**
 * Call graph data prepared by the wrapper for commands that require it
 */
export interface CallGraphData {
  snapshot: SnapshotInfo;
  callEdges: CallEdge[];
  internalCallEdges: InternalCallEdge[];
  allEdges: CallEdge[]; // Combined and normalized
  functions: FunctionInfo[];
  lazyAnalysisPerformed?: boolean;
}

/**
 * Command-specific environment that extends the app environment
 */
export interface CommandEnvironment extends AppEnvironment {
  commandLogger: Logger;
  callGraphData?: CallGraphData; // Available for commands that require call graph analysis
}