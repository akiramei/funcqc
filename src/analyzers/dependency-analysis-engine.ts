import { FunctionInfo, CallEdge } from '../types';
import { ReachabilityAnalyzer } from './reachability-analyzer';
import { EntryPointDetector } from './entry-point-detector';
import { BatchProcessor } from '../utils/batch-processor';
import { minimatch } from 'minimatch';

/**
 * Common configuration for dependency analysis operations
 */
export interface DependencyAnalysisOptions {
  confidenceThreshold: number;     // Minimum confidence score for analysis (default: 0.95)
  maxItemsPerBatch: number;        // Maximum items to process in one batch (default: 100)
  excludeExports: boolean;         // Exclude exported functions from analysis (default: false)
  excludePatterns: string[];       // File patterns to exclude from analysis
  verbose: boolean;               // Enable verbose logging (default: false)
  dryRun: boolean;               // Only analyze without making changes (default: true)
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
      const highConfidenceEdges = this.filterHighConfidenceEdges(callEdges, config.confidenceThreshold);
      this.recordPhaseTime('filterHighConfidenceEdges', phaseStart);
      
      result.metadata.highConfidenceEdges = highConfidenceEdges.length;
      
      if (config.verbose) {
        console.log(`   🎯 High-confidence edges: ${highConfidenceEdges.length}/${callEdges.length}`);
      }

      // Phase 2: Build analysis foundation
      const foundationData = await this.buildAnalysisFoundation(functions, highConfidenceEdges, config);
      result.metadata.entryPoints = foundationData.entryPoints.map(ep => ep.id);

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
    const functionsById = new Map(functions.map(f => [f.id, f]));

    // Detect entry points
    const entryPoints = this.entryPointDetector.detectEntryPoints(functions);

    // Perform reachability analysis
    const reachabilityResult = this.reachabilityAnalyzer.analyzeReachability(
      functions,
      highConfidenceEdges,
      entryPoints
    );

    // Build reverse call graph for caller analysis
    const reverseCallGraph = this.buildReverseCallGraph(highConfidenceEdges);

    // Build high-confidence edge lookup
    const highConfidenceEdgeMap = this.buildHighConfidenceEdgeMap(highConfidenceEdges);

    this.recordPhaseTime('buildAnalysisFoundation', phaseStart);

    if (config.verbose) {
      console.log(`   📊 Entry points: ${entryPoints.length}`);
      console.log(`   📊 Reachable functions: ${reachabilityResult.reachable.size}`);
      console.log(`   📊 Unreachable functions: ${reachabilityResult.unreachable.size}`);
    }

    return {
      functionsById,
      entryPoints,
      reachabilityResult,
      reverseCallGraph,
      highConfidenceEdgeMap
    };
  }

  /**
   * Filter call edges for high confidence only (inherited from safe-delete)
   */
  private filterHighConfidenceEdges(callEdges: CallEdge[], threshold: number): CallEdge[] {
    return callEdges.filter(edge => {
      // Only use edges with confidence score above threshold
      if (!edge.confidenceScore || edge.confidenceScore < threshold) {
        return false;
      }

      // Additional safety checks for ideal call graph edges
      if (edge.resolutionLevel) {
        // Prefer local_exact and import_exact over CHA/RTA
        const preferredLevels = ['local_exact', 'import_exact', 'runtime_confirmed'];
        return preferredLevels.includes(edge.resolutionLevel);
      }

      return true;
    });
  }

  /**
   * Build reverse call graph for caller analysis (inherited from safe-delete)
   */
  private buildReverseCallGraph(callEdges: CallEdge[]): Map<string, Set<string>> {
    const reverseGraph = new Map<string, Set<string>>();

    for (const edge of callEdges) {
      if (!edge.calleeFunctionId) continue;

      if (!reverseGraph.has(edge.calleeFunctionId)) {
        reverseGraph.set(edge.calleeFunctionId, new Set());
      }
      reverseGraph.get(edge.calleeFunctionId)!.add(edge.callerFunctionId);
    }

    return reverseGraph;
  }

  /**
   * Build high-confidence edge lookup for fast access (inherited from safe-delete)
   */
  private buildHighConfidenceEdgeMap(highConfidenceEdges: CallEdge[]): Map<string, Set<string>> {
    const edgeMap = new Map<string, Set<string>>();
    
    for (const edge of highConfidenceEdges) {
      if (!edge.calleeFunctionId) continue;
      
      if (!edgeMap.has(edge.calleeFunctionId)) {
        edgeMap.set(edge.calleeFunctionId, new Set());
      }
      edgeMap.get(edge.calleeFunctionId)!.add(edge.callerFunctionId);
    }
    
    return edgeMap;
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
        if (config.excludeExports && candidate.functionInfo.isExported) {
          continue;
        }

        if (this.isExcludedByPattern(candidate.functionInfo.filePath, config.excludePatterns)) {
          continue;
        }

        if (this.isExternalLibraryFunction(candidate.functionInfo.filePath)) {
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
   * Check if file is excluded by patterns (inherited from safe-delete)
   */
  private isExcludedByPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern =>
      minimatch(filePath, pattern, { dot: true })
    );
  }

  /**
   * Check if function is from external library (inherited from safe-delete)
   */
  private isExternalLibraryFunction(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Check for node_modules
    if (normalizedPath.includes('/node_modules/')) {
      return true;
    }
    
    // Check for TypeScript declaration files
    if (normalizedPath.endsWith('.d.ts')) {
      return true;
    }
    
    // Check for common external library patterns
    const externalPatterns = [
      '/@types/',
      '/types/',
      '/lib/',
      '/dist/',
      '/build/',
      '/vendor/',
      '/third-party/',
      '/external/'
    ];
    
    return externalPatterns.some(pattern => normalizedPath.includes(pattern));
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
      confidenceThreshold: 0.95,
      maxItemsPerBatch: 100,
      excludeExports: false, // Different default from safe-delete - include exports for dep analysis
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**'],
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
   * Estimate impact of analysis result (inherited from safe-delete)
   */
  static estimateImpact(func: FunctionInfo, callersCount: number): 'low' | 'medium' | 'high' {
    // High impact: exported functions, large functions, many callers
    if (func.isExported || callersCount > 5) {
      return 'high';
    }

    // Medium impact: moderate size or some callers
    const functionSize = func.endLine - func.startLine;
    if (functionSize > 20 || callersCount > 2) {
      return 'medium';
    }

    // Low impact: small, isolated functions
    return 'low';
  }
}

/**
 * Foundation data for dependency analysis
 */
export interface AnalysisFoundationData {
  functionsById: Map<string, FunctionInfo>;
  entryPoints: FunctionInfo[];
  reachabilityResult: {
    reachable: Set<string>;
    unreachable: Set<string>;
  };
  reverseCallGraph: Map<string, Set<string>>;
  highConfidenceEdgeMap: Map<string, Set<string>>;
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