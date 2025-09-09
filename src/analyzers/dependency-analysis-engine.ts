import { FunctionInfo, CallEdge } from '../types';
import { ReachabilityAnalyzer } from './reachability-analyzer';
import { EntryPointDetector } from './entry-point-detector';
import { BatchProcessor } from '../utils/batch-processor';
import { DependencyUtils } from '../utils/dependency-utils';

/**
 * Common configuration for dependency analysis operations
 */
export interface DependencyAnalysisOptions {
  confidenceThreshold: number;     // Minimum confidence score for analysis (default: 0.95)
  maxItemsPerBatch: number;        // Maximum items to process in one batch (default: 100)
  includeExports: boolean;         // Include exported functions in deletion analysis (default: false)
  excludePatterns: string[];       // File patterns to exclude from analysis
  verbose: boolean;               // Enable verbose logging (default: false)
  dryRun: boolean;               // Only analyze without making changes (default: true)
  storage?: import('../types').StorageAdapter; // Storage adapter for internal call edge queries
  snapshotId?: string;           // Snapshot ID for consistent data access
  
  // Additional filtering options for enhanced analysis
  includeStaticMethods?: boolean;  // Include static methods in analysis (default: false)
  excludeTests?: boolean;         // Exclude test functions from analysis (default: false)
}

/**
 * Result of dependency analysis
 */
export interface DependencyAnalysisResult<T = unknown> {
  analysisResults: T[];
  errors: string[];
  warnings: string[];
  metadata: AnalysisMetadata;
}

/**
 * Metadata about the analysis process
 */
export interface AnalysisMetadata {
  timestamp: string;
  totalFunctions: number;
  totalEdges: number;
  highConfidenceEdges: number;
  entryPoints: string[];
  processingTime: {
    total: number;
    phases: Record<string, number>;
  };
  [key: string]: unknown; // Allow additional metadata fields
}

/**
 * Analysis candidate with confidence scoring
 */
export interface AnalysisCandidate {
  functionInfo: FunctionInfo;
  confidenceScore: number;
  analysisReason: string;
  metadata: Record<string, unknown>;
  estimatedImpact: 'low' | 'medium' | 'high';
}

/**
 * Unified Dependency Analysis Engine
 * 
 * Extracted from SafeDeletionSystem to provide a common foundation for:
 * - Safe deletion operations
 * - Dependency analysis (dep command)
 * - Code quality analysis
 * - Reachability analysis
 * 
 * Design principles (inherited from safe-delete):
 * - High-confidence analysis: Only act on reliable data
 * - Conservative approach: Prefer caution over aggressive optimization
 * - Comprehensive validation: Multiple validation layers
 * - Performance optimization: Efficient batching and caching
 * - Rich feedback: Detailed progress and result reporting
 */
export class DependencyAnalysisEngine {
  private reachabilityAnalyzer: ReachabilityAnalyzer;
  private entryPointDetector: EntryPointDetector;
  private processingTimes: Map<string, number> = new Map();

  constructor() {
    this.reachabilityAnalyzer = new ReachabilityAnalyzer();
    this.entryPointDetector = new EntryPointDetector();
  }

  /**
   * Perform comprehensive dependency analysis
   */
  async analyzeDependencies<T extends AnalysisCandidate>(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    candidateGenerator: CandidateGenerator<T>,
    options: Partial<DependencyAnalysisOptions> = {}
  ): Promise<DependencyAnalysisResult<T>> {
    const config = this.getDefaultOptions(options);
    const startTime = Date.now();

    const result: DependencyAnalysisResult<T> = {
      analysisResults: [],
      errors: [],
      warnings: [],
      metadata: {
        timestamp: new Date().toISOString(),
        totalFunctions: functions.length,
        totalEdges: callEdges.length,
        highConfidenceEdges: 0,
        entryPoints: [],
        processingTime: {
          total: 0,
          phases: {}
        }
      }
    };

    if (config.verbose) {
      console.log('🔍 Starting dependency analysis...');
      console.log(`   Functions: ${functions.length}`);
      console.log(`   Call edges: ${callEdges.length}`);
      console.log(`   Confidence threshold: ${config.confidenceThreshold}`);
    }

    try {
      // Phase 1: Filter high-confidence edges
      const phaseStart = Date.now();
      const highConfidenceEdges = DependencyUtils.filterHighConfidenceEdges(callEdges, config.confidenceThreshold);
      this.recordPhaseTime('filterHighConfidenceEdges', phaseStart);
      
      result.metadata.highConfidenceEdges = highConfidenceEdges.length;
      
      if (config.verbose) {
        console.log(`   🎯 High-confidence edges: ${highConfidenceEdges.length}/${callEdges.length}`);
      }

      // Phase 2: Build analysis foundation
      const foundationData = await this.buildAnalysisFoundation(functions, highConfidenceEdges, config);
      result.metadata.entryPoints = foundationData.entryPoints.map(ep => ep.functionId);

      // Phase 3: Generate candidates using provided generator
      const candidates = await candidateGenerator.generateCandidates(
        functions,
        highConfidenceEdges,
        foundationData,
        config
      );

      // Phase 4: Process candidates in batches
      result.analysisResults = await this.processCandidatesInBatches(
        candidates,
        config,
        result.warnings
      );

      // Record total processing time
      result.metadata.processingTime.total = Date.now() - startTime;
      result.metadata.processingTime.phases = Object.fromEntries(this.processingTimes);

      if (config.verbose) {
        console.log(`   ✅ Analysis completed in ${result.metadata.processingTime.total}ms`);
        console.log(`   📊 Found ${result.analysisResults.length} analysis results`);
      }

      return result;

    } catch (error) {
      result.errors.push(`Dependency analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      result.metadata.processingTime.total = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Build foundation data needed for analysis
   */
  private async buildAnalysisFoundation(
    functions: FunctionInfo[],
    highConfidenceEdges: CallEdge[],
    config: DependencyAnalysisOptions
  ): Promise<AnalysisFoundationData> {
    const phaseStart = Date.now();

    // Build function lookup map
    const functionsById = DependencyUtils.createFunctionMap(functions);

    // Detect entry points
    const detectedEntryPoints = this.entryPointDetector.detectEntryPoints(functions);
    
    // Filter entry points based on options (like DeadCodeAnalyzer does)
    const filteredEntryPoints = this.filterEntryPoints(detectedEntryPoints, config);
    
    // Convert EntryPoint to expected format
    const entryPoints = filteredEntryPoints.map(ep => ({
      functionId: ep.functionId,
      name: ep.functionId, // Use functionId as name for now
      type: 'entrypoint' // Use a default type since EntryPoint doesn't have a type property
    }));

    // Perform reachability analysis with filtered entry points
    const reachabilityResult = this.reachabilityAnalyzer.analyzeReachability(
      functions,
      highConfidenceEdges,
      filteredEntryPoints
    );

    // Build reverse call graph for caller analysis
    const reverseCallGraph = DependencyUtils.buildReverseCallGraph(highConfidenceEdges);

    // Build high-confidence edge lookup
    const highConfidenceEdgeMap = DependencyUtils.buildHighConfidenceEdgeMap(highConfidenceEdges);

    this.recordPhaseTime('buildAnalysisFoundation', phaseStart);

    if (config.verbose) {
      console.log(`   📊 Entry points: ${entryPoints.length} (filtered from ${detectedEntryPoints.length})`);
      console.log(`   📊 Reachable functions: ${reachabilityResult.reachable.size}`);
      console.log(`   📊 Unreachable functions: ${reachabilityResult.unreachable.size}`);
    }

    return {
      functionsById,
      entryPoints,
      reachabilityResult,
      reverseCallGraph,
      highConfidenceEdgeMap,
      ...(config.storage && { storage: config.storage }),
      ...(config.snapshotId && { snapshotId: config.snapshotId })
    };
  }


  /**
   * Process candidates in efficient batches
   */
  private async processCandidatesInBatches<T extends AnalysisCandidate>(
    candidates: T[],
    config: DependencyAnalysisOptions,
    warnings: string[]
  ): Promise<T[]> {
    if (candidates.length === 0) {
      return candidates;
    }

    const phaseStart = Date.now();
    
    // Use optimized batch size from BatchProcessor
    const batchSize = BatchProcessor.getOptimalBatchSize(
      candidates.length,
      5, // Estimated size per candidate in KB
      50  // Max memory in MB
    );

    const processedCandidates: T[] = [];

    const batches = BatchProcessor.batchArray(candidates, Math.min(batchSize, config.maxItemsPerBatch));
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      if (config.verbose) {
        console.log(`   🔄 Processing batch ${i + 1}/${batches.length} (${batch.length} items)...`);
      }

      try {
        // Process batch with validation
        const processedBatch = await this.processCandidateBatch(batch, config);
        processedCandidates.push(...processedBatch);

        if (config.verbose) {
          console.log(`   ✅ Batch ${i + 1} completed (${processedBatch.length} items processed)`);
        }

      } catch (error) {
        const errorMessage = `Batch ${i + 1} processing failed: ${error instanceof Error ? error.message : String(error)}`;
        warnings.push(errorMessage);
        
        if (config.verbose) {
          console.warn(`   ⚠️  ${errorMessage}`);
        }
      }
    }

    this.recordPhaseTime('processCandidatesInBatches', phaseStart);
    return processedCandidates;
  }

  /**
   * Process a single batch of candidates
   */
  private async processCandidateBatch<T extends AnalysisCandidate>(
    batch: T[],
    config: DependencyAnalysisOptions
  ): Promise<T[]> {
    const processedBatch: T[] = [];

    for (const candidate of batch) {
      try {
        // Apply exclusion filters (inherited from safe-delete logic)
        if (!config.includeExports && candidate.functionInfo.isExported) {
          continue;
        }

        if (DependencyUtils.isExcludedByPattern(candidate.functionInfo.filePath, config.excludePatterns)) {
          continue;
        }

        if (DependencyUtils.isExternalLibraryFunction(candidate.functionInfo.filePath)) {
          continue;
        }

        // Additional candidate validation can be added here
        processedBatch.push(candidate);

      } catch (error) {
        if (config.verbose) {
          console.warn(`   ⚠️  Failed to process candidate ${candidate.functionInfo.name}: ${error}`);
        }
      }
    }

    return processedBatch;
  }


  /**
   * Record processing time for a phase
   */
  private recordPhaseTime(phaseName: string, startTime: number): void {
    this.processingTimes.set(phaseName, Date.now() - startTime);
  }

  /**
   * Get default options with user overrides
   */
  private getDefaultOptions(options: Partial<DependencyAnalysisOptions>): DependencyAnalysisOptions {
    return {
      confidenceThreshold: 0.90,
      maxItemsPerBatch: 100,
      includeExports: false, // Default: protect exports from deletion (safe mode)
      excludePatterns: DependencyUtils.getDefaultExclusionPatterns(),
      verbose: false,
      dryRun: true,
      ...options
    };
  }

  /**
   * Calculate confidence score using safe-delete's proven algorithm
   */
  static calculateConfidenceScore(
    baseScore: number,
    factors: ConfidenceFactors
  ): number {
    let confidence = baseScore;

    // Apply various confidence factors
    if (factors.hasHighConfidenceCallers !== undefined) {
      confidence += factors.hasHighConfidenceCallers ? 0.05 : -0.10;
    }

    if (factors.isExported !== undefined) {
      confidence += factors.isExported ? 0.02 : 0.05; // Exported functions are slightly riskier
    }

    if (factors.callersCount !== undefined) {
      // More callers = lower confidence for deletion, but higher confidence for dependency
      const callersFactor = Math.min(0.1, factors.callersCount * 0.02);
      confidence += factors.inverseCallers ? -callersFactor : callersFactor;
    }

    if (factors.functionSize !== undefined) {
      // Larger functions are riskier to delete
      const sizeFactor = Math.min(0.05, factors.functionSize / 100);
      confidence += factors.inverseSize ? -sizeFactor : sizeFactor;
    }

    // Ensure confidence stays within bounds
    return Math.max(0.0, Math.min(1.0, confidence));
  }

  /**
   * Filter entry points based on options
   * IMPORTANT: includeExports=false means PROTECT exports (keep as entry points)
   * includeExports=true means ALLOW export deletion (remove from entry points)
   */
  private filterEntryPoints(
    entryPoints: import('./entry-point-detector').EntryPoint[],
    config: DependencyAnalysisOptions
  ): import('./entry-point-detector').EntryPoint[] {
    let filtered = [...entryPoints];

    // When includeExports=true, remove exported functions from entry points
    // This allows them to be deleted if they are truly unused
    if (config.includeExports) {
      const beforeCount = filtered.length;
      
      filtered = filtered.filter(ep => ep.reason !== 'exported');
      const afterCount = filtered.length;
      if (config.verbose) {
        console.log(`🔧 DEBUG: includeExports=true, filtered ${beforeCount} → ${afterCount} entry points`);
      }
    } else {
      if (config.verbose) {
        console.log(`🔧 DEBUG: includeExports=false, keeping all ${filtered.length} entry points`);
      }
    }

    if (config.excludeTests) {
      filtered = filtered.filter(ep => ep.reason !== 'test');
    }

    // Note: excludeStaticMethods not available in DependencyAnalysisOptions yet
    // if (config.excludeStaticMethods) {
    //   filtered = filtered.filter(ep => ep.reason !== 'static-method');
    // }

    return filtered;
  }

  /**
   * Estimate impact of analysis result (inherited from safe-delete)
   */
  static estimateImpact(func: FunctionInfo, callersCount: number): 'low' | 'medium' | 'high' {
    return DependencyUtils.estimateImpact(func, callersCount);
  }
}

/**
 * Foundation data for dependency analysis
 */
export interface AnalysisFoundationData {
  functionsById: Map<string, FunctionInfo>;
  entryPoints: Array<{ functionId: string; name: string; type: string; }>;
  reachabilityResult: {
    reachable: Set<string>;
    unreachable: Set<string>;
  };
  reverseCallGraph: Map<string, Set<string>>;
  highConfidenceEdgeMap: Map<string, Set<string>>;
  storage?: import('../types').StorageAdapter; // Storage adapter for internal call edge queries
  snapshotId?: string; // Snapshot ID for consistent data access
}

/**
 * Interface for generating analysis candidates
 */
export interface CandidateGenerator<T extends AnalysisCandidate> {
  generateCandidates(
    functions: FunctionInfo[],
    highConfidenceEdges: CallEdge[],
    foundationData: AnalysisFoundationData,
    config: DependencyAnalysisOptions
  ): Promise<T[]>;
}

/**
 * Factors that influence confidence scoring
 */
export interface ConfidenceFactors {
  hasHighConfidenceCallers?: boolean;
  isExported?: boolean;
  callersCount?: number;
  functionSize?: number;
  inverseCallers?: boolean; // If true, more callers decreases confidence
  inverseSize?: boolean;    // If true, larger size decreases confidence
}
