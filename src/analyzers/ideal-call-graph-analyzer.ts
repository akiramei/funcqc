import { Project, TypeChecker } from 'ts-morph';
import { FunctionRegistry } from './function-registry';
import { StagedAnalysisEngine } from './staged-analysis/staged-analysis-engine-refactored';
import { ConfidenceCalculator } from './confidence-calculator';
import { RuntimeTraceIntegrator } from './runtime-trace-integrator';
import { CallEdge, StorageAdapter } from '../types';
import { Logger } from '../utils/cli-utils';

export interface IdealCallEdge extends CallEdge {
  // Enhanced fields for ideal system
  confidenceScore: number;     // 0.0 - 1.0
  resolutionLevel: ResolutionLevel;
  resolutionSource: string;
  runtimeConfirmed: boolean;
  executionCount?: number;
  candidates: string[];       // Function IDs of potential targets
  analysisMetadata: {
    timestamp: number;
    analysisVersion: string;
    sourceHash: string;
  };
}

export enum ResolutionLevel {
  LOCAL_EXACT = 'local_exact',           // confidence: 1.0
  IMPORT_EXACT = 'import_exact',         // confidence: 0.95
  CHA_RESOLVED = 'cha_resolved',         // confidence: 0.8
  RTA_RESOLVED = 'rta_resolved',         // confidence: 0.9
  RUNTIME_CONFIRMED = 'runtime_confirmed', // confidence: 1.0
  EXTERNAL_DETECTED = 'external_detected',  // confidence: 0.7-0.95
  CALLBACK_REGISTRATION = 'callback_registration' // confidence: 0.8-0.95
}

export interface CallGraphResult {
  edges: IdealCallEdge[];
  functions: Map<string, FunctionMetadata>;
  analysisStats: {
    totalFunctions: number;
    totalEdges: number;
    resolutionBreakdown: Map<ResolutionLevel, number>;
    confidenceDistribution: {
      high: number;    // >= 0.95
      medium: number;  // 0.7 - 0.95
      low: number;     // < 0.7
    };
  };
}

export interface FunctionMetadata {
  id: string;
  name: string;
  filePath: string;
  lexicalPath: string;  // file#outer.inner
  nodeKind: string;
  isExported: boolean;
  isMethod: boolean;
  isStatic?: boolean;
  className?: string;
  signature: string;
  startLine: number;
  endLine: number;
  positionId?: string;
  contentHash: string;
}

/**
 * Ideal Call Graph Analyzer
 * 
 * Design principles:
 * 1. Complete precision over coverage
 * 2. Staged analysis with confidence scoring
 * 3. Runtime trace integration
 * 4. Safe deletion with zero false positives
 */
export class IdealCallGraphAnalyzer {
  private functionRegistry: FunctionRegistry;
  private analysisEngine: StagedAnalysisEngine;
  private confidenceCalculator: ConfidenceCalculator;
  private runtimeIntegrator: RuntimeTraceIntegrator;
  private typeChecker: TypeChecker;
  private logger: import('../utils/cli-utils').Logger;
  private snapshotId: string | undefined;
  private storage: StorageAdapter | undefined;

  constructor(project: Project, options: { 
    logger?: Logger;
    snapshotId?: string;
    storage?: StorageAdapter;
    existingFunctionIds?: Map<string, string>;
    normalizedPathMapping?: Map<string, string>;
  } = {}) {
    this.typeChecker = project.getTypeChecker();
    this.functionRegistry = new FunctionRegistry(project, options.snapshotId, options.existingFunctionIds, options.normalizedPathMapping);
    this.logger = options.logger || new Logger();
    this.snapshotId = options.snapshotId;
    this.storage = options.storage;
    this.analysisEngine = new StagedAnalysisEngine(project, this.typeChecker, { 
      logger: this.logger,
      ...(this.snapshotId && { snapshotId: this.snapshotId }),
      ...(this.storage && { storage: this.storage })
    });
    this.confidenceCalculator = new ConfidenceCalculator();
    this.runtimeIntegrator = new RuntimeTraceIntegrator();
  }

  /**
   * Perform complete call graph analysis with maximum precision
   */
  async analyzeProject(): Promise<CallGraphResult> {
    this.logger.debug('Starting ideal call graph analysis...');
    
    // Phase 1: Comprehensive Function Collection
    this.logger.debug('Phase 1: Collecting all function-like nodes...');
    const functions = await this.functionRegistry.collectAllFunctions();
    this.logger.debug(`Found ${functions.size} functions`);

    // Phase 2: Staged Analysis (Local → Import → CHA → RTA)
    this.logger.debug('Phase 2: Performing staged analysis...');
    const rawEdges = await this.analysisEngine.performStagedAnalysis(functions, this.snapshotId);
    this.logger.debug(`Generated ${rawEdges.length} raw edges`);

    // Phase 3: Confidence Calculation
    this.logger.debug('Phase 3: Calculating confidence scores...');
    const confidenceEdges = await this.confidenceCalculator.calculateConfidenceScores(rawEdges);
    
    // Phase 4: Runtime Trace Integration (if available)
    this.logger.debug('Phase 4: Integrating runtime traces...');
    const finalEdges = await this.runtimeIntegrator.integrateTraces(confidenceEdges, functions);

    // Phase 5: Generate Results
    const result = this.generateResults(finalEdges, functions);
    
    this.logger.debug('Ideal call graph analysis completed');
    this.printAnalysisStats(result);
    
    return result;
  }

  private generateResults(
    edges: IdealCallEdge[], 
    functions: Map<string, FunctionMetadata>
  ): CallGraphResult {
    const resolutionBreakdown = new Map<ResolutionLevel, number>();
    let high = 0, medium = 0, low = 0;

    for (const edge of edges) {
      // Count by resolution level
      const current = resolutionBreakdown.get(edge.resolutionLevel) || 0;
      resolutionBreakdown.set(edge.resolutionLevel, current + 1);

      // Count by confidence
      if (edge.confidenceScore >= 0.95) high++;
      else if (edge.confidenceScore >= 0.7) medium++;
      else low++;
    }

    return {
      edges,
      functions,
      analysisStats: {
        totalFunctions: functions.size,
        totalEdges: edges.length,
        resolutionBreakdown,
        confidenceDistribution: { high, medium, low }
      }
    };
  }

  private printAnalysisStats(result: CallGraphResult): void {
    const { analysisStats } = result;
    
    this.logger.debug('Analysis Statistics:');
    this.logger.debug(`Total Functions: ${analysisStats.totalFunctions}`);
    this.logger.debug(`Total Edges: ${analysisStats.totalEdges}`);
    
    this.logger.debug('Resolution Breakdown:');
    for (const [level, count] of analysisStats.resolutionBreakdown) {
      const percentage = ((count / analysisStats.totalEdges) * 100).toFixed(1);
      this.logger.debug(`${level}: ${count} (${percentage}%)`);
    }
    
    this.logger.debug('Confidence Distribution:');
    const { high, medium, low } = analysisStats.confidenceDistribution;
    this.logger.debug(`High (≥0.95): ${high} (${((high / analysisStats.totalEdges) * 100).toFixed(1)}%)`);
    this.logger.debug(`Medium (0.7-0.95): ${medium} (${((medium / analysisStats.totalEdges) * 100).toFixed(1)}%)`);
    this.logger.debug(`Low (<0.7): ${low} (${((low / analysisStats.totalEdges) * 100).toFixed(1)}%)`);
  }

  /**
   * Get edges suitable for safe deletion (high confidence only)
   */
  getSafeEdges(): IdealCallEdge[] {
    // Implementation will be added after basic system is working
    return [];
  }

  /**
   * Get edges requiring manual review
   */
  getReviewEdges(): IdealCallEdge[] {
    // Implementation will be added after basic system is working
    return [];
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    // Cleanup will be implemented as needed
  }
}