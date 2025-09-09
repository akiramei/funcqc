import { IdealCallEdge } from './ideal-call-graph-analyzer';
import { FunctionInfo } from '../types';

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
    // Stage 2: RTA は到達型の特定に成功したケースでは安全側に引き上げる
    'rta_resolved': 0.95,
    'runtime_confirmed': 1.0,
    'external_detected': 0.7,
    'callback_registration': 0.8
  };


  /**
   * Calculate confidence scores for all edges with enhanced analysis
   */
  async calculateConfidenceScores(edges: IdealCallEdge[], functions?: FunctionInfo[]): Promise<IdealCallEdge[]> {
    console.log('📊 Calculating enhanced confidence scores...');
    
    // Build usage context if functions provided
    const usageContext = functions ? this.buildUsageContext(functions, edges) : null;
    
    const scoredEdges = edges.map(edge => ({
      ...edge,
      confidenceScore: this.calculateEnhancedEdgeConfidence(edge, usageContext)
    }));
    
    console.log(`✅ Calculated enhanced confidence for ${scoredEdges.length} edges`);
    return scoredEdges;
  }

  /**
   * Enhanced confidence calculation with duplicate detection and usage analysis
   */
  private calculateEnhancedEdgeConfidence(edge: IdealCallEdge, usageContext?: UsageContext | null): number {
    const baseConfidence = ConfidenceCalculator.BASE_CONFIDENCE[edge.resolutionLevel as string];

    // Handle unknown resolution levels
    if (baseConfidence === undefined) {
      console.warn(`Unknown resolution level: ${edge.resolutionLevel}`);
      return 0.5;
    }

    let confidence = baseConfidence;
    
    // Apply original modifiers
    confidence = this.applyBaseModifiers(confidence, edge);
    
    // Apply enhanced context-aware modifiers
    if (usageContext) {
      confidence = this.applyContextModifiers(confidence, edge, usageContext);
    }
    
    return Math.max(0.0, Math.min(1.0, confidence));
  }

  /**
   * Apply base confidence modifiers (original logic)
   */
  private applyBaseModifiers(confidence: number, edge: IdealCallEdge): number {
    // Runtime confirmation boost
    if (edge.runtimeConfirmed) {
      confidence = Math.min(1.0, confidence + 0.05);
    }
    
    // Multiple candidates penalty (uncertainty)
    if (edge.candidates.length > 1) {
      const penalty = Math.min(0.2, (edge.candidates.length - 1) * 0.05);
      confidence = Math.max(0.5, confidence - penalty);
    }
    
    // Unique candidate boost for CHA/RTA（解決先が一意 → 高信頼と見なす）
    if (edge.candidates.length === 1 && (edge.resolutionLevel === 'rta_resolved' || edge.resolutionLevel === 'cha_resolved')) {
      confidence = Math.max(confidence, edge.resolutionLevel === 'rta_resolved' ? 0.96 : 0.9);
    }
    
    // Execution count boost (if available)
    if (edge.executionCount && edge.executionCount > 0) {
      confidence = Math.min(1.0, confidence + 0.02);
    }
    
    return confidence;
  }

  /**
   * Apply context-aware modifiers based on usage analysis
   */
  private applyContextModifiers(confidence: number, edge: IdealCallEdge, usageContext: UsageContext): number {
    if (!edge.calleeFunctionId) return confidence;
    
    const calleeAnalysis = usageContext.functionAnalysis.get(edge.calleeFunctionId);
    if (!calleeAnalysis) return confidence;
    
    // Duplicate implementation penalty
    if (calleeAnalysis.isDuplicateImplementation) {
      // If this is a duplicate, but has no callers, it's likely obsolete
      if (calleeAnalysis.incomingCallCount === 0) {
        confidence = Math.min(1.0, confidence + 0.15); // Higher confidence for deletion
      } else {
        // Has callers but is duplicate - needs manual review
        confidence = Math.max(0.6, confidence - 0.1);
      }
    }
    
    // Zero usage boost for deletion confidence
    if (calleeAnalysis.incomingCallCount === 0 && calleeAnalysis.exportUsageCount === 0) {
      confidence = Math.min(1.0, confidence + 0.1);
    }
    
    // Export usage penalty (function is exported and might be used externally)
    if (calleeAnalysis.isExported && calleeAnalysis.exportUsageCount === 0) {
      // Exported but no detected usage - conservative approach
      confidence = Math.max(0.7, confidence - 0.05);
    }
    
    // Test function penalty (test functions should not be deleted casually)
    if (calleeAnalysis.isTestFunction) {
      confidence = Math.max(0.5, confidence - 0.2);
    }
    
    // Utility function pattern detection
    if (calleeAnalysis.isUtilityFunction) {
      // Utility functions with no callers are good deletion candidates
      if (calleeAnalysis.incomingCallCount === 0) {
        confidence = Math.min(1.0, confidence + 0.05);
      }
    }
    
    return confidence;
  }

  /**
   * Build usage context for enhanced analysis
   */
  private buildUsageContext(functions: FunctionInfo[], edges: IdealCallEdge[]): UsageContext {
    const functionAnalysis = new Map<string, UsageAnalysis>();
    const duplicateGroups = this.detectDuplicateImplementations(functions);
    
    // Build call count map
    const incomingCallCounts = new Map<string, number>();
    for (const edge of edges) {
      if (edge.calleeFunctionId) {
        const count = incomingCallCounts.get(edge.calleeFunctionId) || 0;
        incomingCallCounts.set(edge.calleeFunctionId, count + 1);
      }
    }
    
    // Analyze each function
    for (const func of functions) {
      const analysis: UsageAnalysis = {
        functionId: func.id,
        incomingCallCount: incomingCallCounts.get(func.id) || 0,
        exportUsageCount: 0, // TODO: Could be enhanced with export analysis
        isExported: this.isExportedFunction(func),
        isTestFunction: this.isTestFunction(func),
        isUtilityFunction: this.isUtilityFunction(func),
        isDuplicateImplementation: duplicateGroups.some(group => group.includes(func.id)),
        duplicateGroup: duplicateGroups.find(group => group.includes(func.id)) || []
      };
      
      functionAnalysis.set(func.id, analysis);
    }
    
    return {
      functionAnalysis,
      duplicateGroups,
      totalFunctions: functions.length
    };
  }

  /**
   * Detect duplicate implementations based on function signatures and patterns
   */
  private detectDuplicateImplementations(functions: FunctionInfo[]): string[][] {
    const signatureGroups = new Map<string, string[]>();
    
    for (const func of functions) {
      // Create a signature based on name patterns and file structure
      const signature = this.createFunctionSignature(func);
      
      if (!signatureGroups.has(signature)) {
        signatureGroups.set(signature, []);
      }
      signatureGroups.get(signature)!.push(func.id);
    }
    
    // Return groups with more than one function (duplicates)
    return Array.from(signatureGroups.values()).filter(group => group.length > 1);
  }

  /**
   * Create function signature for duplicate detection
   */
  private createFunctionSignature(func: FunctionInfo): string {
    // Normalize function name (remove file-specific prefixes/suffixes)
    const normalizedName = func.name
      .replace(/^_+/, '') // Remove leading underscores
      .replace(/\d+$/, '') // Remove trailing numbers
      .toLowerCase();
    
    // Include parameter count as signature component
    const parameterCount = (func.parameters || []).length;
    // Use function length as complexity approximation
    const lineCount = (func.endLine || 0) - (func.startLine || 0);
    const complexityBucket = Math.floor(lineCount / 10) * 10;
    
    return `${normalizedName}:${parameterCount}:${complexityBucket}`;
  }

  /**
   * Check if function is exported
   */
  private isExportedFunction(func: FunctionInfo): boolean {
    // Simple heuristic - could be enhanced with actual export analysis
    return func.name.startsWith('export') || 
           func.filePath.includes('index.') ||
           Boolean(func.name.match(/^[A-Z]/)); // PascalCase often indicates exported functions
  }

  /**
   * Check if function is a test function
   */
  private isTestFunction(func: FunctionInfo): boolean {
    return func.filePath.includes('.test.') ||
           func.filePath.includes('.spec.') ||
           func.filePath.includes('/test/') ||
           func.name.includes('test') ||
           func.name.includes('Test');
  }

  /**
   * Check if function is a utility function
   */
  private isUtilityFunction(func: FunctionInfo): boolean {
    return func.filePath.includes('/utils/') ||
           func.filePath.includes('/util/') ||
           func.filePath.includes('/helpers/') ||
           func.name.startsWith('format') ||
           func.name.startsWith('parse') ||
           func.name.startsWith('validate');
  }


  /**
   * Get edges by confidence level with improved thresholds
   */
  /**
   * Original method preserved for backward compatibility
   */
  // Removed - replaced with calculateEnhancedEdgeConfidence

  getEdgesByConfidence(edges: IdealCallEdge[]): {
    high: IdealCallEdge[];     // >= 0.90 (lowered from 0.95)
    medium: IdealCallEdge[];   // 0.7 - 0.90
    low: IdealCallEdge[];      // < 0.7
  } {
    const high = edges.filter(e => e.confidenceScore >= 0.90);
    const medium = edges.filter(e => e.confidenceScore >= 0.7 && e.confidenceScore < 0.90);
    const low = edges.filter(e => e.confidenceScore < 0.7);
    
    return { high, medium, low };
  }

  /**
   * Get safe deletion candidates with improved logic
   */
  getSafeDeletionCandidates(edges: IdealCallEdge[]): IdealCallEdge[] {
    return edges.filter(edge => 
      edge.confidenceScore >= 0.90 && // Lowered from 0.95
      edge.calleeFunctionId &&
      (edge.candidates.length === 1 || edge.confidenceScore >= 0.95) // Allow multiple candidates if very high confidence
    );
  }

  /**
   * Get edges requiring manual review
   */
  getReviewCandidates(edges: IdealCallEdge[]): IdealCallEdge[] {
    return edges.filter(edge => 
      edge.confidenceScore >= 0.7 && 
      edge.confidenceScore < 0.90 // Updated threshold
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

// Supporting interfaces for enhanced analysis
interface UsageContext {
  functionAnalysis: Map<string, UsageAnalysis>;
  duplicateGroups: string[][];
  totalFunctions: number;
}

interface UsageAnalysis {
  functionId: string;
  incomingCallCount: number;
  exportUsageCount: number;
  isExported: boolean;
  isTestFunction: boolean;
  isUtilityFunction: boolean;
  isDuplicateImplementation: boolean;
  duplicateGroup: string[];
}
