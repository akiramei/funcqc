import { FunctionInfo, CallEdge } from '../types';
import { DependencyUtils } from '../utils/dependency-utils';
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
    
    // 🚨 CRITICAL FIX: Only process truly unreachable functions
    // Functions that are reachable from entry points should NEVER be deletion candidates
    for (const functionId of foundationData.reachabilityResult.unreachable) {
      const func = foundationData.functionsById.get(functionId);
      if (!func) continue;

      // Apply exclusion filters
      if (config.excludeExports && func.isExported) continue;
      if (DependencyUtils.isExcludedByPattern(func.filePath, config.excludePatterns)) continue;
      if (DependencyUtils.isExternalLibraryFunction(func.filePath)) continue;

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
}