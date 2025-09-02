import { FunctionInfo, CallEdge } from '../types';
import { DependencyUtils } from '../utils/dependency-utils';
import { Logger } from '../utils/cli-utils';
import { FunctionClassifier } from '../utils/function-classifier';
import { 
  AnalysisCandidate, 
  CandidateGenerator, 
  AnalysisFoundationData, 
  DependencyAnalysisOptions 
} from './dependency-analysis-engine';
import { TypeAwareDeletionSafety, TypeAwareDeletionInfo } from './type-aware-deletion-safety';

/**
 * Safe Deletion Candidate with specialized properties
 */
export interface SafeDeletionCandidate extends AnalysisCandidate {
  reason: 'unreachable' | 'no-high-confidence-callers' | 'isolated';
  callersCount: number;
  sourceLines: string[];
  typeInfo?: TypeAwareDeletionInfo;
}

/**
 * Candidate Generator for Safe Deletion Analysis
 * 
 * Implements the CandidateGenerator interface to integrate with DependencyAnalysisEngine.
 * Uses the proven safe-delete logic for identifying deletion candidates.
 */
export class SafeDeletionCandidateGenerator implements CandidateGenerator<SafeDeletionCandidate> {
  private logger: Logger;
  private typeAwareSafety: TypeAwareDeletionSafety;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(false, false);
    this.typeAwareSafety = new TypeAwareDeletionSafety(this.logger);
  }
  
  /**
   * Generate safe deletion candidates using high-confidence analysis
   */
  async generateCandidates(
    _functions: FunctionInfo[],
    _highConfidenceEdges: CallEdge[],
    foundationData: AnalysisFoundationData,
    config: DependencyAnalysisOptions
  ): Promise<SafeDeletionCandidate[]> {
    
    console.time('processCandidates');
    
    const candidates: SafeDeletionCandidate[] = [];
    const stats = { 
      skippedAnonymous: 0, 
      skippedInternal: 0, 
      skippedTypeProtected: 0,
      skippedStaticMethod: 0,
      skippedTestFunction: 0
    };

    // Set up type-aware safety analysis
    if (foundationData.storage) {
      this.typeAwareSafety.setStorage(foundationData.storage);
    }
    
    // Process only truly unreachable functions
    for (const functionId of foundationData.reachabilityResult.unreachable) {
      const func = foundationData.functionsById.get(functionId);
      if (!func) continue;

      const skipReason = await this.shouldSkipFunction(func, config, foundationData);
      if (skipReason) {
        this.updateSkipStats(stats, skipReason);
        continue;
      }

      // DISABLED: Type-aware deletion safety uses heuristics and speculation
      // Only use actual call graph data for deletion decisions
      // 
      // Reasoning: Functions should only be protected if they are:
      // 1. Actually called (detected by call graph analysis)
      // 2. Entry points (detected by entry point analysis)  
      // 3. Genuinely unsafe to delete (anonymous callbacks, etc.)
      //
      // Type information should NOT be used for speculative protection
      // as it leads to false positives and prevents legitimate dead code removal
      
      let typeInfo: TypeAwareDeletionInfo | undefined;
      // Skip type-aware protection entirely - rely on call graph analysis only

      const callers = foundationData.reverseCallGraph.get(functionId) || new Set();
      const highConfidenceCallersSet = foundationData.highConfidenceEdgeMap.get(functionId) || new Set();
      const highConfidenceCallers = Array.from(callers).filter(callerId => 
        highConfidenceCallersSet.has(callerId)
      );

      // 🔧 FIXED: Improved deletion reason logic
      let reason: SafeDeletionCandidate['reason'] = 'unreachable';
      let confidenceScore = 1.0;
      
      const reachable = foundationData.reachabilityResult.reachable;
      const hasReachableHighConfidenceCaller = highConfidenceCallers.some((id) => reachable.has(id));

      if (callers.size === 0) {
        reason = 'unreachable';
        confidenceScore = 1.0;
      } else if (hasReachableHighConfidenceCaller) {
        // Marked unreachable but has reachable high-confidence callers → inconsistent, skip
        if (config.verbose) {
          console.warn(`⚠️  Function ${func.name} marked as unreachable but has reachable high-confidence callers. Skipping deletion.`);
        }
        continue;
      } else if (highConfidenceCallers.length === 0) {
        // Has callers but none are high-confidence - conservative approach
        reason = 'no-high-confidence-callers';
        confidenceScore = 0.90;
      } else {
        // Has callers but all are unreachable high-confidence
        // Conservative approach: if this unreachable function has high-confidence callers,
        // skip it to avoid breaking internal dependencies between unreachable functions
        if (config.verbose) {
          console.warn(`⚠️  Function ${func.name} is unreachable but called by other unreachable functions. Skipping deletion.`);
        }
        continue;
      }

      // Skip source line loading in dry run mode for performance
      const sourceLines = config.dryRun ? [] : await this.extractSourceLines(func);

      const candidate: SafeDeletionCandidate = {
        functionInfo: func,
        reason,
        confidenceScore,
        callersCount: callers.size,
        sourceLines,
        analysisReason: `Function is ${reason}`,
        metadata: {
          reason,
          callersCount: callers.size,
          highConfidenceCallers: highConfidenceCallers.length,
          typeProtection: typeInfo?.protectionReason || 'none',
          typeEvidence: typeInfo ? {
            interfaceCount: typeInfo.evidenceStrength.interfaceCount,
            classCount: typeInfo.evidenceStrength.classCount,
            overrideCount: typeInfo.evidenceStrength.overrideCount,
            compatibilityScore: typeInfo.signatureCompatibility?.compatibilityScore || 0,
            protectionScore: typeInfo.confidenceScore
          } : null
        },
        estimatedImpact: DependencyUtils.estimateImpact(func, callers.size)
      };

      if (typeInfo) {
        candidate.typeInfo = typeInfo;
      }

      candidates.push(candidate);
    }
    
    console.timeEnd('processCandidates');
    
    // Log safety check summary (only if verbose or if significant skips occurred)
    if (config.verbose || stats.skippedAnonymous > 0 || stats.skippedInternal > 0 || stats.skippedTypeProtected > 0) {
      this.logger.info(
        `Safety checks: ${stats.skippedAnonymous} anonymous functions, ` +
        `${stats.skippedInternal} internal functions, ` +
        `${stats.skippedTypeProtected} type-protected functions`
      );
    }
    
    // Sort candidates by confidence score and impact (safer deletions first)
    const sortedCandidates = this.sortDeletionCandidates(candidates);
    return sortedCandidates;
  }

  /**
   * Extract source lines for a function
   */
  private async extractSourceLines(func: FunctionInfo): Promise<string[]> {
    try {
      const fs = await import('fs/promises');
      const fileContent = await fs.readFile(func.filePath, 'utf8');
      const lines = fileContent.split('\n');
      return lines.slice(func.startLine - 1, func.endLine);
    } catch (error) {
      return [`// Error reading source: ${error}`];
    }
  }

  /**
   * Sort deletion candidates by confidence score and impact
   */
  private sortDeletionCandidates(candidates: SafeDeletionCandidate[]): SafeDeletionCandidate[] {
    return candidates.sort((a, b) => {
      // Primary sort: confidence score (higher first)
      if (a.confidenceScore !== b.confidenceScore) {
        return b.confidenceScore - a.confidenceScore;
      }
      
      // Secondary sort: impact (lower first - safer to delete)
      const impactOrder = { low: 0, medium: 1, high: 2 };
      return impactOrder[a.estimatedImpact] - impactOrder[b.estimatedImpact];
    });
  }

  /**
   * Check if a function is an inline anonymous function (likely used as callback)
   * This is a critical safety check to prevent deletion of callbacks passed to
   * higher-order functions like map, filter, reduce, forEach, etc.
   */
  private isInlineAnonymousFunction(func: FunctionInfo): boolean {
    // Check if the function is anonymous or arrow function
    const isAnonymous = !func.name || 
                        func.name === 'anonymous' || 
                        func.name === '<anonymous>' ||
                        func.name === '' ||
                        /^anonymous_\d+/.test(func.name) ||  // Actual pattern used in funcqc
                        /^arrow_\d+/.test(func.name) ||      // Common pattern for unnamed arrow functions
                        /^__\d+/.test(func.name);            // Another common pattern
    
    // Conservative approach: ALL anonymous functions are excluded from deletion
    // This is because we cannot reliably determine if they are used as callbacks
    // without proper call graph analysis that tracks function arguments
    return isAnonymous;
  }



  // (removed) isFactoryMethod: deprecated and unused















  

  /**
   * Determine if a function should be skipped and why
   */
  private async shouldSkipFunction(func: FunctionInfo, config: DependencyAnalysisOptions, _foundationData?: AnalysisFoundationData): Promise<string | null> {
    // Apply exclusion filters
    // Skip exported functions UNLESS includeExports is true
    if (!config.includeExports && func.isExported) return 'exported';
    if (DependencyUtils.isExcludedByPattern(func.filePath, config.excludePatterns)) return 'internal';
    if (DependencyUtils.isExternalLibraryFunction(func.filePath)) return 'internal';

    // Use shared function classification logic
    // Filter static methods if not explicitly included
    if (!config.includeStaticMethods && FunctionClassifier.isStaticMethod(func)) return 'static-method';
    
    // TEMPORARILY ALLOW: Constructor deletion for testing
    // Constructors of unused classes should be deletable
    // if (FunctionClassifier.isConstructor(func)) return 'internal';
    if (FunctionClassifier.isTestFunction(func) && config.excludeTests) return 'test-function';

    // Essential safety conditions (keep these)
    if (this.isInlineAnonymousFunction(func)) return 'anonymous';
    
    // TEMPORARILY DISABLED: Additional safety checks for testing
    // if (this.isLocalFunction(func)) return 'internal';
    // if (await this.isWorkerEntryFunction(func)) return 'internal';
    
    // REMOVED: Overly conservative speculative checks
    // These were blocking legitimate dead code deletion:
    // - isFactoryMethod: Too speculative, many legitimate unused functions
    // - isInstantiatedClassMethod: Should rely on actual call graph data
    // - isCallbackFunction: Too broad, blocks many unused functions
    // - isObjectLiteralFunction: Should rely on actual usage analysis
    // - isFunctionReference: Too speculative
    // - isInternalHelperFunction: Already covered by reachability analysis
    
    // TEMPORARILY DISABLED: Internal helper function check
    // This was blocking all 30 unused functions from being detected
    // The reachability analysis should already cover truly reachable functions
    // if (foundationData && await this.isInternalHelperFunction(func, foundationData)) return 'internal';
    
    return null; // Function can be processed
  }

  /**
   * Update skip statistics based on skip reason
   */
  private updateSkipStats(stats: { 
    skippedAnonymous: number; 
    skippedInternal: number; 
    skippedTypeProtected: number;
    skippedStaticMethod: number;
    skippedTestFunction: number;
  }, reason: string): void {
    switch (reason) {
      case 'anonymous':
        stats.skippedAnonymous++;
        break;
      case 'internal':
        stats.skippedInternal++;
        break;
      case 'static-method':
        stats.skippedStaticMethod++;
        break;
      case 'test-function':
        stats.skippedTestFunction++;
        break;
      default:
        // Unknown reason, could log or handle specially
        break;
    }
  }

}