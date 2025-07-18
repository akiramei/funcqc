import { IdealCallEdge } from './ideal-call-graph-analyzer';

/**
 * Confidence Calculator
 * 
 * Calculates confidence scores for call graph edges based on:
 * - Resolution level (Local > Import > CHA > RTA)
 * - Analysis method reliability
 * - Runtime confirmation
 * - Edge validation
 */
export class ConfidenceCalculator {
  
  /**
   * Base confidence scores by resolution level
   */
  private static readonly BASE_CONFIDENCE: Record<string, number> = {
    'local_exact': 1.0,
    'import_exact': 0.95,
    'cha_resolved': 0.8,
    'rta_resolved': 0.9,
    'runtime_confirmed': 1.0
  };

  /**
   * Calculate confidence scores for all edges
   */
  async calculateConfidenceScores(edges: IdealCallEdge[]): Promise<IdealCallEdge[]> {
    console.log('   📊 Calculating confidence scores...');
    
    const scoredEdges = edges.map(edge => ({
      ...edge,
      confidenceScore: this.calculateEdgeConfidence(edge)
    }));
    
    // Sort by confidence (highest first)
    scoredEdges.sort((a, b) => b.confidenceScore - a.confidenceScore);
    
    console.log(`   ✅ Calculated confidence for ${scoredEdges.length} edges`);
    return scoredEdges;
  }

  /**
   * Calculate confidence score for a single edge
   */
  private calculateEdgeConfidence(edge: IdealCallEdge): number {
    const baseConfidence = ConfidenceCalculator.BASE_CONFIDENCE[edge.resolutionLevel as string];
    
    // Apply modifiers based on edge characteristics
    let confidence = baseConfidence;
    
    // Runtime confirmation boost
    if (edge.runtimeConfirmed) {
      confidence = Math.min(1.0, confidence + 0.05);
    }
    
    // Multiple candidates penalty (uncertainty)
    if (edge.candidates.length > 1) {
      const penalty = Math.min(0.2, (edge.candidates.length - 1) * 0.05);
      confidence = Math.max(0.5, confidence - penalty);
    }
    
    // Execution count boost (if available)
    if (edge.executionCount && edge.executionCount > 0) {
      confidence = Math.min(1.0, confidence + 0.02);
    }
    
    // Ensure confidence is in valid range
    return Math.max(0.0, Math.min(1.0, confidence));
  }

  /**
   * Get edges by confidence level
   */
  getEdgesByConfidence(edges: IdealCallEdge[]): {
    high: IdealCallEdge[];     // >= 0.95
    medium: IdealCallEdge[];   // 0.7 - 0.95
    low: IdealCallEdge[];      // < 0.7
  } {
    const high = edges.filter(e => e.confidenceScore >= 0.95);
    const medium = edges.filter(e => e.confidenceScore >= 0.7 && e.confidenceScore < 0.95);
    const low = edges.filter(e => e.confidenceScore < 0.7);
    
    return { high, medium, low };
  }

  /**
   * Get safe deletion candidates (high confidence only)
   */
  getSafeDeletionCandidates(edges: IdealCallEdge[]): IdealCallEdge[] {
    return edges.filter(edge => 
      edge.confidenceScore >= 0.95 &&
      edge.calleeFunctionId &&
      edge.candidates.length === 1
    );
  }

  /**
   * Get edges requiring manual review
   */
  getReviewCandidates(edges: IdealCallEdge[]): IdealCallEdge[] {
    return edges.filter(edge => 
      edge.confidenceScore >= 0.7 && 
      edge.confidenceScore < 0.95
    );
  }

  /**
   * Validate edge consistency
   */
  validateEdge(edge: IdealCallEdge): boolean {
    // Basic validation
    if (!edge.callerFunctionId) return false;
    if (!edge.candidates || edge.candidates.length === 0) return false;
    if (edge.confidenceScore < 0 || edge.confidenceScore > 1) return false;
    
    // If calleeFunctionId is specified, it should be in candidates
    if (edge.calleeFunctionId && !edge.candidates.includes(edge.calleeFunctionId)) {
      return false;
    }
    
    return true;
  }

  /**
   * Get confidence statistics
   */
  getConfidenceStats(edges: IdealCallEdge[]): {
    averageConfidence: number;
    medianConfidence: number;
    confidenceDistribution: Map<string, number>;
  } {
    if (edges.length === 0) {
      return {
        averageConfidence: 0,
        medianConfidence: 0,
        confidenceDistribution: new Map()
      };
    }
    
    const scores = edges.map(e => e.confidenceScore).sort((a, b) => a - b);
    
    const averageConfidence = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const medianConfidence = scores[Math.floor(scores.length / 2)];
    
    // Distribution by 0.1 buckets
    const distribution = new Map<string, number>();
    for (const score of scores) {
      const bucket = Math.floor(score * 10) / 10;
      const key = `${bucket.toFixed(1)}-${(bucket + 0.1).toFixed(1)}`;
      distribution.set(key, (distribution.get(key) || 0) + 1);
    }
    
    return {
      averageConfidence,
      medianConfidence,
      confidenceDistribution: distribution
    };
  }
}