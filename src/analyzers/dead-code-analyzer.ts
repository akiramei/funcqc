import { FunctionInfo, CallEdge } from '../types';
import { EntryPoint, EntryPointDetector, EntryPointDetectionOptions } from './entry-point-detector';
import { ReachabilityAnalyzer, ReachabilityResult, DeadCodeInfo } from './reachability-analyzer';
import { FunctionClassifier } from '../utils/function-classifier';

export interface DeadCodeAnalysisOptions {
  // Entry point detection options
  verbose?: boolean;
  debug?: boolean;
  layerEntryPoints?: string[];
  excludeStaticMethods?: boolean;

  // Filtering options
  excludeTests?: boolean;
  includeExports?: boolean;  // Include exported functions in deletion analysis (default: false)
  excludeSmall?: boolean;
  threshold?: number; // Minimum function size threshold

  // Additional filters
  includeStaticMethods?: boolean;
  excludeHandlers?: boolean;
  excludeConstructors?: boolean;
}

export interface DeadCodeAnalysisResult {
  reachabilityResult: ReachabilityResult;
  deadCodeInfo: DeadCodeInfo[];
  unusedExportInfo: DeadCodeInfo[];
  staticMethodsInfo: {
    staticMethods: DeadCodeInfo[];
    byClass: Map<string, DeadCodeInfo[]>;
  };
  entryPoints: EntryPoint[];
  analysisMetadata: {
    totalFunctions: number;
    reachableFunctions: number;
    unreachableFunctions: number;
    filteredOutFunctions: number;
    entryPointCount: number;
    coverage: number;
  };
}

/**
 * Base analyzer for dead code analysis
 * Provides shared functionality for both dep dead and dep delete commands
 * 
 * This class unifies the logic previously scattered between:
 * - ReachabilityAnalyzer
 * - EntryPointDetector  
 * - Individual command implementations
 */
export class DeadCodeAnalyzer {
  private reachabilityAnalyzer: ReachabilityAnalyzer;
  private entryPointDetector: EntryPointDetector;

  constructor(options: DeadCodeAnalysisOptions = {}) {
    this.reachabilityAnalyzer = new ReachabilityAnalyzer();
    
    // Configure entry point detector based on options
    const entryPointOptions: EntryPointDetectionOptions = {};
    
    if (options.verbose !== undefined) {
      entryPointOptions.verbose = options.verbose;
    }
    if (options.debug !== undefined) {
      entryPointOptions.debug = options.debug;
    }
    if (options.layerEntryPoints !== undefined) {
      entryPointOptions.layerEntryPoints = options.layerEntryPoints;
    }
    if (options.excludeStaticMethods !== undefined) {
      entryPointOptions.excludeStaticMethods = options.excludeStaticMethods;
    }
    if (options.includeExports !== undefined) {
      entryPointOptions.includeExports = options.includeExports;
    }
    
    this.entryPointDetector = new EntryPointDetector(entryPointOptions);
  }

  /**
   * Perform comprehensive dead code analysis
   */
  analyzeDeadCode(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    options: DeadCodeAnalysisOptions = {}
  ): DeadCodeAnalysisResult {
    // Step 1: Detect entry points
    let entryPoints = this.entryPointDetector.detectEntryPoints(functions);

    // Step 2: Apply entry point filters
    entryPoints = this.filterEntryPoints(entryPoints, options);

    // Step 3: Perform reachability analysis
    const reachabilityResult = this.reachabilityAnalyzer.analyzeReachability(
      functions,
      callEdges,
      entryPoints
    );

    // Step 4: Get detailed dead code information with shared filtering
    const deadCodeInfo = this.getFilteredDeadCodeInfo(
      reachabilityResult.unreachable,
      functions,
      callEdges,
      options
    );

    // Step 5: Get unused export information
    const unusedExportInfo = this.reachabilityAnalyzer.getDeadCodeInfo(
      reachabilityResult.unusedExports,
      functions,
      callEdges,
      {
        excludeTests: false,
        excludeSmallFunctions: false,
        minFunctionSize: 1,
      }
    );

    // Step 6: Get static methods information using shared logic
    const staticMethodsInfo = this.getStaticMethodsInfo(deadCodeInfo, functions);

    // Step 7: Calculate analysis metadata
    const analysisMetadata = this.calculateAnalysisMetadata(
      functions,
      reachabilityResult,
      deadCodeInfo
    );

    return {
      reachabilityResult,
      deadCodeInfo,
      unusedExportInfo,
      staticMethodsInfo,
      entryPoints,
      analysisMetadata,
    };
  }

  /**
   * Filter entry points based on options
   */
  private filterEntryPoints(
    entryPoints: EntryPoint[],
    options: DeadCodeAnalysisOptions
  ): EntryPoint[] {
    let filtered = [...entryPoints];


    if (options.excludeTests) {
      filtered = filtered.filter(ep => ep.reason !== 'test');
    }

    if (options.excludeStaticMethods) {
      filtered = filtered.filter(ep => ep.reason !== 'static-method');
    }

    return filtered;
  }

  /**
   * Get filtered dead code information using shared logic
   */
  private getFilteredDeadCodeInfo(
    unreachableFunctions: Set<string>,
    allFunctions: FunctionInfo[],
    callEdges: CallEdge[],
    options: DeadCodeAnalysisOptions
  ): DeadCodeInfo[] {
    // Use ReachabilityAnalyzer for basic dead code info
    const basicDeadCodeInfo = this.reachabilityAnalyzer.getDeadCodeInfo(
      unreachableFunctions,
      allFunctions,
      callEdges,
      {
        excludeTests: options.excludeTests ?? false,
        excludeSmallFunctions: options.excludeSmall ?? false,
        minFunctionSize: options.threshold ? parseInt(String(options.threshold)) : 3,
      }
    );

    // Apply additional filters using FunctionClassifier
    return basicDeadCodeInfo.filter(deadInfo => {
      const func = allFunctions.find(f => f.id === deadInfo.functionId);
      if (!func) return true;

      // Filter static methods if requested
      if (!options.includeStaticMethods && FunctionClassifier.isStaticMethod(func)) {
        return false;
      }

      // Filter handlers if requested
      if (options.excludeHandlers && FunctionClassifier.isHandlerFunction(func)) {
        return false;
      }

      // Filter constructors if requested
      if (options.excludeConstructors && FunctionClassifier.isConstructor(func)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get static methods information using shared classification logic
   */
  private getStaticMethodsInfo(
    deadCodeInfo: DeadCodeInfo[],
    functions: FunctionInfo[]
  ): { staticMethods: DeadCodeInfo[]; byClass: Map<string, DeadCodeInfo[]> } {
    const staticMethods: DeadCodeInfo[] = [];
    const byClass = new Map<string, DeadCodeInfo[]>();
    const funcMap = new Map(functions.map(f => [f.id, f]));

    for (const deadInfo of deadCodeInfo) {
      const func = funcMap.get(deadInfo.functionId);
      if (!func) continue;

      // Use shared classification logic
      if (FunctionClassifier.isStaticMethod(func)) {
        staticMethods.push(deadInfo);

        const className = func.className ?? 
          (func.contextPath && func.contextPath.length > 0 ? func.contextPath[0] : 'Unknown');
        
        if (!byClass.has(className)) {
          byClass.set(className, []);
        }
        byClass.get(className)!.push(deadInfo);
      }
    }

    return { staticMethods, byClass };
  }

  /**
   * Calculate analysis metadata
   */
  private calculateAnalysisMetadata(
    functions: FunctionInfo[],
    reachabilityResult: ReachabilityResult,
    deadCodeInfo: DeadCodeInfo[]
  ): DeadCodeAnalysisResult['analysisMetadata'] {
    const totalFunctions = functions.length;
    const reachableFunctions = reachabilityResult.reachable.size;
    const unreachableFunctions = reachabilityResult.unreachable.size;
    const filteredOutFunctions = unreachableFunctions - deadCodeInfo.length;
    const coverage = totalFunctions === 0 ? 0 : (reachableFunctions / totalFunctions) * 100;

    return {
      totalFunctions,
      reachableFunctions,
      unreachableFunctions,
      filteredOutFunctions,
      entryPointCount: reachabilityResult.entryPoints.size,
      coverage,
    };
  }

  /**
   * Check if a function should be considered for deletion
   * This method can be overridden by subclasses for specific deletion criteria
   */
  protected shouldConsiderForDeletion(
    func: FunctionInfo,
    options: DeadCodeAnalysisOptions
  ): boolean {
    // Base implementation applies common filters
    const metadata = FunctionClassifier.getMetadata(func);

    // Export はデフォルトで除外。includeExports=true で明示的に含める
    if (metadata.isExported && !options.includeExports) {
      return false;
    }

    // Exclude test functions if requested
    if (options.excludeTests && metadata.isTest) {
      return false;
    }

    // Exclude static methods unless explicitly included
    if (!options.includeStaticMethods && metadata.isStaticMethod) {
      return false;
    }

    // Exclude handlers if requested
    if (options.excludeHandlers && metadata.isHandler) {
      return false;
    }

    // Exclude constructors if requested
    if (options.excludeConstructors && metadata.isConstructor) {
      return false;
    }

    return true;
  }
}