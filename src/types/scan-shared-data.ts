/**
 * Shared data types for scan analysis phases
 * Defines the data pipeline for efficient analysis phase communication
 */

import { FunctionInfo, CallEdge, InternalCallEdge, SourceFile } from './index';
import type { Project } from 'ts-morph';

/**
 * Results from BASIC analysis phase
 */
export interface BasicAnalysisResult {
  /** Functions discovered and analyzed */
  functions: FunctionInfo[];
  
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
 * Results from CALL_GRAPH analysis phase
 */
export interface CallGraphAnalysisResult {
  /** External call edges between functions */
  callEdges: CallEdge[];
  
  /** Internal call edges within files */
  internalCallEdges: InternalCallEdge[];
  
  /** Function dependency mapping */
  dependencyMap: Map<string, {
    callers: string[];
    callees: string[];
    depth: number;
  }>;
  
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
  
  /** Type dependency mapping */
  typeDependencyMap: Map<string, {
    usedTypes: string[];
    exposedTypes: string[];
    typeComplexity: number;
  }>;
  
  /** Type safety assessment */
  typeSafetyMap: Map<string, {
    hasAnyTypes: boolean;
    hasUnknownTypes: boolean;
    typeAnnotationRatio: number;
  }>;
  
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
  /** Function coupling matrix */
  functionCouplingMatrix: Map<string, Map<string, number>>;
  
  /** File coupling data */
  fileCouplingData: Map<string, {
    incomingCoupling: number;
    outgoingCoupling: number;
    totalCoupling: number;
  }>;
  
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
  
  /** Source file ID mapping for efficient lookups */
  sourceFileIdMap: Map<string, string>;
  
  /** File content map for quick access */
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
    parallel: boolean;
  };
}