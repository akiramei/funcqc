import { FunctionInfo, CallEdge } from '../types';
import { minimatch } from 'minimatch';

/**
 * Unified Dependency Analysis Utilities
 * 
 * Common utility functions shared between dependency analysis and safe deletion.
 * Extracted from DependencyAnalysisEngine and SafeDeletionSystem to eliminate
 * code duplication and provide a single source of truth.
 */
export class DependencyUtils {
  /**
   * Filter call edges for high confidence only
   * 
   * @param callEdges All call edges
   * @param threshold Minimum confidence threshold (default: 0.95)
   * @returns High-confidence edges only
   */
  static filterHighConfidenceEdges(callEdges: CallEdge[], threshold: number = 0.95): CallEdge[] {
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
   * Build reverse call graph for caller analysis
   * 
   * @param callEdges Call edges to analyze
   * @returns Map from function ID to set of caller IDs
   */
  static buildReverseCallGraph(callEdges: CallEdge[]): Map<string, Set<string>> {
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
   * Build high-confidence edge lookup for fast access
   * 
   * @param highConfidenceEdges Pre-filtered high-confidence edges
   * @returns Map for fast edge lookup
   */
  static buildHighConfidenceEdgeMap(highConfidenceEdges: CallEdge[]): Map<string, Set<string>> {
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
   * Estimate impact of function modification/deletion
   * 
   * @param func Function to analyze
   * @param callersCount Number of callers
   * @returns Impact level
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

  /**
   * Check if file is excluded by patterns
   * 
   * @param filePath File path to check
   * @param patterns Glob patterns to match against
   * @returns True if file should be excluded
   */
  static isExcludedByPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern =>
      minimatch(filePath, pattern, { dot: true })
    );
  }

  /**
   * Check if function is from external library
   * 
   * @param filePath File path to check
   * @returns True if function is from external library
   */
  static isExternalLibraryFunction(filePath: string): boolean {
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
   * Create function lookup map by ID
   * 
   * @param functions Array of functions
   * @returns Map from function ID to function info
   */
  static createFunctionMap(functions: FunctionInfo[]): Map<string, FunctionInfo> {
    return new Map(functions.map(f => [f.id, f]));
  }

  /**
   * Calculate confidence-based statistics
   * 
   * @param edges Call edges with confidence scores
   * @param threshold Confidence threshold
   * @returns Statistics about confidence distribution
   */
  static calculateConfidenceStats(edges: CallEdge[], threshold: number) {
    const totalEdges = edges.length;
    const highConfidenceEdges = edges.filter(edge => 
      edge.confidenceScore && edge.confidenceScore >= threshold
    ).length;
    
    const confidenceScores = edges
      .map(edge => edge.confidenceScore)
      .filter((score): score is number => score !== undefined);
    
    const averageConfidence = confidenceScores.length > 0 
      ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length 
      : 0;

    return {
      totalEdges,
      highConfidenceEdges,
      highConfidenceRatio: totalEdges > 0 ? highConfidenceEdges / totalEdges : 0,
      averageConfidence
    };
  }

  /**
   * Create default exclusion patterns
   * 
   * @returns Standard patterns for excluding external code
   */
  static getDefaultExclusionPatterns(): string[] {
    return [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/coverage/**',
      '**/*.d.ts'
    ];
  }
}