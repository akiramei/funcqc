import { FunctionInfo, CallEdge } from '../types';
import { DependencyUtils } from '../utils/dependency-utils';
import { Logger } from '../utils/cli-utils';
import { 
  AnalysisCandidate, 
  CandidateGenerator, 
  AnalysisFoundationData, 
  DependencyAnalysisOptions 
} from './dependency-analysis-engine';

/**
 * Safe Deletion Candidate with specialized properties
 */
export interface SafeDeletionCandidate extends AnalysisCandidate {
  reason: 'unreachable' | 'no-high-confidence-callers' | 'isolated';
  callersCount: number;
  sourceLines: string[];
}

/**
 * Candidate Generator for Safe Deletion Analysis
 * 
 * Implements the CandidateGenerator interface to integrate with DependencyAnalysisEngine.
 * Uses the proven safe-delete logic for identifying deletion candidates.
 */
export class SafeDeletionCandidateGenerator implements CandidateGenerator<SafeDeletionCandidate> {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(false, false);
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
    let skippedAnonymous = 0;
    let skippedInternal = 0;
    
    // 🚨 CRITICAL FIX: Only process truly unreachable functions
    // Functions that are reachable from entry points should NEVER be deletion candidates
    for (const functionId of foundationData.reachabilityResult.unreachable) {
      const func = foundationData.functionsById.get(functionId);
      if (!func) continue;

      // Apply exclusion filters
      if (config.excludeExports && func.isExported) continue;
      if (DependencyUtils.isExcludedByPattern(func.filePath, config.excludePatterns)) continue;
      if (DependencyUtils.isExternalLibraryFunction(func.filePath)) continue;

      // 🚨 CRITICAL SAFETY CHECK: Never delete inline anonymous functions
      // These are typically used as callbacks in map/filter/reduce and are incorrectly marked as unreachable
      // due to limitations in call graph analysis (callbacks are not tracked as call edges)
      if (this.isInlineAnonymousFunction(func)) {
        skippedAnonymous++;
        continue;
      }

      // 🚨 CRITICAL SAFETY CHECK: Never delete internal functions in same file as exported functions
      // Internal functions are often helper functions used by exported functions and may not be detected
      // by call graph analysis due to line number mismatches or other parsing inconsistencies
      if (await this.isInternalHelperFunction(func, foundationData)) {
        skippedInternal++;
        continue;
      }

      const callers = foundationData.reverseCallGraph.get(functionId) || new Set();
      const highConfidenceCallersSet = foundationData.highConfidenceEdgeMap.get(functionId) || new Set();
      const highConfidenceCallers = Array.from(callers).filter(callerId => 
        highConfidenceCallersSet.has(callerId)
      );

      // 🔧 FIXED: Improved deletion reason logic
      let reason: SafeDeletionCandidate['reason'] = 'unreachable';
      let confidenceScore = 1.0;
      
      // If function is truly unreachable from entry points, it's safe to delete
      if (callers.size === 0) {
        reason = 'unreachable';
        confidenceScore = 1.0;
      } else if (highConfidenceCallers.length === 0) {
        // Has callers but none are high-confidence - conservative approach
        reason = 'no-high-confidence-callers';
        confidenceScore = 0.90;
      } else {
        // 🚨 CRITICAL: If there are high-confidence callers, this function should NOT be unreachable
        // This indicates a bug in reachability analysis - skip this function
        if (config.verbose) {
          console.warn(`⚠️  Function ${func.name} marked as unreachable but has ${highConfidenceCallers.length} high-confidence callers. Skipping deletion.`);
        }
        continue;
      }

      // Skip source line loading in dry run mode for performance
      const sourceLines = config.dryRun ? [] : await this.extractSourceLines(func);

      candidates.push({
        functionInfo: func,
        reason,
        confidenceScore,
        callersCount: callers.size,
        sourceLines,
        analysisReason: `Function is ${reason}`,
        metadata: {
          reason,
          callersCount: callers.size,
          highConfidenceCallers: highConfidenceCallers.length
        },
        estimatedImpact: DependencyUtils.estimateImpact(func, callers.size)
      });
    }
    
    console.timeEnd('processCandidates');
    
    // Log safety check summary (only if verbose or if significant skips occurred)
    if (config.verbose || skippedAnonymous > 0 || skippedInternal > 0) {
      this.logger.info(`Safety checks: ${skippedAnonymous} anonymous functions, ${skippedInternal} internal functions protected`);
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

  /**
   * Check if a function is an internal helper function that should not be deleted
   * Uses existing call edge data to determine if non-exported functions are actually called within the same file
   * Falls back to AST analysis if call graph data is incomplete
   */
  private async isInternalHelperFunction(func: FunctionInfo, foundationData: AnalysisFoundationData): Promise<boolean> {
    // Skip if function is exported (exported functions can be safely analyzed)
    if (func.isExported) {
      return false;
    }

    // Check if the function is actually called within the same file using existing call edge data
    // This bypasses potential CallGraphAnalyzer issues while being more precise than blanket protection
    return await this.isCalledWithinFile(func, foundationData);
  }

  /**
   * Check if a function is called within its own file using existing call edge data
   * Falls back to AST analysis if call graph data is incomplete or missing
   */
  private async isCalledWithinFile(func: FunctionInfo, foundationData: AnalysisFoundationData): Promise<boolean> {
    // Get all functions that call this function
    const callers = foundationData.reverseCallGraph.get(func.id) || new Set();
    
    // First attempt: Use existing call edge data (most efficient)
    if (callers.size > 0) {
      // Check if any caller is in the same file
      for (const callerId of callers) {
        const callerFunc = foundationData.functionsById.get(callerId);
        if (callerFunc && callerFunc.filePath === func.filePath) {
          // Found a caller in the same file - this function is used locally
          return true;
        }
      }
      // Found callers but none in same file
      return false;
    }

    // Fallback: AST-based analysis for cases where call graph analysis fails
    // This is critical for handling IdealCallGraphAnalyzer limitations
    this.logger.debug(`No call edges found for ${func.name}, falling back to AST analysis`);
    return await this.isCalledWithinFileAST(func);
  }

  /**
   * AST-based fallback method to check if function is called within the same file
   * This method is used when call graph data is incomplete or missing
   */
  private async isCalledWithinFileAST(func: FunctionInfo): Promise<boolean> {
    try {
      const { Project, Node } = await import('ts-morph');
      
      // Create minimal project for this specific file analysis
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: true,
        skipLoadingLibFiles: true,
        compilerOptions: {
          isolatedModules: true,
        },
      });
      
      const sourceFile = project.addSourceFileAtPath(func.filePath);
      let isUsed = false;
      
      // Look for function calls that match our function name
      sourceFile.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
          const expression = node.getExpression();
          if (Node.isIdentifier(expression)) {
            const calledName = expression.getText();
            if (calledName === func.name) {
              // Found a call to this function in the same file
              isUsed = true;
              return true; // Stop traversal
            }
          }
        }
      });
      
      // Clean up memory
      project.removeSourceFile(sourceFile);
      
      return isUsed;
    } catch (error) {
      this.logger.warn(`AST analysis failed for ${func.name}: ${error instanceof Error ? error.message : String(error)}`);
      // Conservative fallback: protect the function if AST analysis fails
      return true;
    }
  }
}