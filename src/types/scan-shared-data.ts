/**
 * Shared data types for scan analysis phases
 * Defines the data pipeline for efficient analysis phase communication
 */

import { FunctionInfo, CallEdge, InternalCallEdge, SourceFile } from './index';
import type { Project } from 'ts-morph';

/**
 * Unified project path type - ensures paths follow /src/... convention
 */
export type UnifiedPath = `/src/${string}`;

/**
 * Results from BASIC analysis phase
 */
export interface BasicAnalysisResult {
  /** Functions are exposed via ScanSharedData.functions */
  // functions: FunctionInfo[]; // removed - use ScanSharedData.functions
  
  /** Number of functions successfully analyzed */
  functionsAnalyzed: number;
  
  /** Analysis errors encountered */
  errors: string[];
  
  /** Batch processing statistics */
  batchStats: {
    totalBatches: number;
    functionsPerBatch: number[];
    processingTimes: number[];
  };
}

/**
 * Function dependency information (JSON-safe)
 */
export type DependencyInfo = {
  callers: string[];
  callees: string[];
  depth: number;
};

/**
 * Type dependency information (JSON-safe)
 */
export type TypeDependencyInfo = {
  usedTypes: string[];
  exposedTypes: string[];
  typeComplexity: number;
};

/**
 * Type safety information (JSON-safe)
 */
export type TypeSafetyInfo = {
  hasAnyTypes: boolean;
  hasUnknownTypes: boolean;
  typeAnnotationRatio: number;
};

/**
 * File coupling information (JSON-safe)
 */
export type FileCouplingInfo = {
  incomingCoupling: number;
  outgoingCoupling: number;
  totalCoupling: number;
};

/**
 * Convert Map to Record for JSON serialization
 */
export function mapToRecord<T>(map: Map<string, T>): Record<string, T> {
  const record: Record<string, T> = {};
  for (const [key, value] of map.entries()) {
    record[key] = value;
  }
  return record;
}

/**
 * Convert nested Map structure to nested Record for JSON serialization
 */
export function nestedMapToRecord<T>(map: Map<string, Map<string, T>>): Record<string, Record<string, T>> {
  const record: Record<string, Record<string, T>> = {};
  for (const [key, innerMap] of map.entries()) {
    record[key] = mapToRecord(innerMap);
  }
  return record;
}

/**
 * Results from CALL_GRAPH analysis phase
 */
export interface CallGraphAnalysisResult {
  /** External call edges between functions */
  callEdges: CallEdge[];
  
  /** Internal call edges within files */
  internalCallEdges: InternalCallEdge[];
  
  /** Function dependency mapping (JSON-safe) */
  dependencyMap: Readonly<Record<string, DependencyInfo>>;
  
  /** Call graph analysis statistics */
  stats: {
    totalEdges: number;
    highConfidenceEdges: number;
    mediumConfidenceEdges: number;
    lowConfidenceEdges: number;
    analysisTime: number;
  };
}

/**
 * Results from TYPE_SYSTEM analysis phase
 */
export interface TypeSystemAnalysisResult {
  /** Number of types analyzed */
  typesAnalyzed: number;
  
  /** Type analysis completion status */
  completed: boolean;
  
  /** Type dependency mapping (JSON-safe) */
  typeDependencyMap: Readonly<Record<string, TypeDependencyInfo>>;
  
  /** Type safety assessment (JSON-safe) */
  typeSafetyMap: Readonly<Record<string, TypeSafetyInfo>>;
  
  /** Type coupling data */
  typeCouplingData: {
    stronglyTypedPairs: Array<{func1: string, func2: string, strength: number}>;
    typeInconsistencies: Array<{edge: CallEdge, issue: string}>;
  };
  
  /** Type system analysis statistics */
  stats: {
    interfaces: number;
    classes: number;
    enums: number;
    typeAliases: number;
    analysisTime: number;
  };
}

/**
 * Results from COUPLING analysis phase
 */
export interface CouplingAnalysisResult {
  /** Function coupling matrix (JSON-safe) */
  functionCouplingMatrix: Readonly<Record<string, Record<string, number>>>;
  
  /** File coupling data (JSON-safe) */
  fileCouplingData: Readonly<Record<string, FileCouplingInfo>>;
  
  /** High coupling functions */
  highCouplingFunctions: Array<{
    functionId: string;
    couplingScore: number;
    reasons: string[];
  }>;
  
  /** Coupling analysis statistics */
  stats: {
    filesCoupled: number;
    couplingRelationships: number;
    analysisTime: number;
  };
}

/**
 * Core shared data that flows through all analysis phases
 */
export interface ScanSharedData {
  /** Snapshot ID for this analysis session */
  snapshotId: string;
  
  /** Source files with content - read once, used by all phases */
  sourceFiles: SourceFile[];
  
  /** Shared ts-morph Project instance - created once, reused by all phases */
  project: Project;
  
  /** Functions extracted in BASIC phase - used by all subsequent phases */
  functions: FunctionInfo[];
  
  /** Source file ID mapping for efficient lookups (internal memory structure - not serialized) */
  sourceFileIdMap: Map<string, string>;
  
  /** File content map for quick access (internal memory structure - not serialized) */
  fileContentMap: Map<string, string>;
  
  /** BASIC analysis results */
  basicResults?: BasicAnalysisResult;
  
  /** CALL_GRAPH analysis results */
  callGraphResults?: CallGraphAnalysisResult;
  
  /** TYPE_SYSTEM analysis results */
  typeSystemResults?: TypeSystemAnalysisResult;
  
  /** COUPLING analysis results */
  couplingResults?: CouplingAnalysisResult;
}

/**
 * Analysis phase context - immutable shared context
 */
export interface AnalysisPhaseContext {
  /** Read-only shared data */
  readonly sharedData: ScanSharedData;
  
  /** Phase-specific options */
  options: {
    verbose?: boolean;
    showProgress?: boolean;
  };
  
  /** Phase execution environment */
  env: import('./environment').CommandEnvironment;
}

/**
 * Analysis phase interface - standardized phase execution
 */
export interface AnalysisPhase<TResult> {
  /** Phase identifier */
  readonly name: string;
  
  /** Execute the analysis phase */
  execute(context: AnalysisPhaseContext): Promise<TResult>;
  
  /** Check if this phase should be skipped */
  shouldSkip?(context: AnalysisPhaseContext): Promise<boolean>;
  
  /** Cleanup phase resources */
  cleanup?(): Promise<void>;
}

/**
 * Scan pipeline configuration
 */
export interface ScanPipelineConfig {
  /** Enable BASIC analysis */
  enableBasic: boolean;
  
  /** Enable CALL_GRAPH analysis */
  enableCallGraph: boolean;
  
  /** Enable TYPE_SYSTEM analysis */
  enableTypeSystem: boolean;
  
  /** Enable COUPLING analysis */
  enableCoupling: boolean;
  
  /** Batch processing configuration */
  batch: {
    size: number;
    /** 1 = sequential, >=2 = parallel */
    maxConcurrency: number;
  };
}