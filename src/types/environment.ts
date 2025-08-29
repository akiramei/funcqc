import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { Logger } from '../utils/cli-utils';
import { FuncqcConfig, CallEdge, InternalCallEdge, FunctionInfo, SnapshotInfo } from '../types';
import type { Project } from 'ts-morph';

/**
 * Project manager interface to provide a single shared ts-morph Project per snapshot
 */
export interface ProjectManager {
  getOrCreateProject(
    snapshotId: string,
    fileContentMap: Map<string, string>
  ): Promise<{ project: Project; isNewlyCreated: boolean }>;
  getProject(snapshotId: string): Project;
  getCachedProject(snapshotId: string): Project | null;
  disposeProject(snapshotId: string): void;
  clearAll(): void;
  getCacheStats(): { cachedProjects: number; totalFiles: number };
}

/**
 * Application environment containing all shared dependencies
 */
export interface AppEnvironment {
  storage: PGLiteStorageAdapter;
  config: FuncqcConfig;
  logger: Logger;
  // Make optional for backward-compatibility (tests may not provide this)
  projectManager?: ProjectManager;
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
  advancedAssessmentResult?: unknown; // For storing assessment results between commands (decoupled to avoid circular deps)
  callGraphData?: CallGraphData; // Available for commands that require call graph analysis
  scanSharedData?: import('./scan-shared-data').ScanSharedData; // Shared analysis data across scan phases
}
