import { FunctionInfo, CallEdge } from '../types';

/**
 * Configuration for confidence calculation
 */
export interface ConfidenceCalculationOptions {
  baseConfidence: number;           // Base confidence score (default: 0.9)
  preferredResolutionLevels: string[]; // Preferred resolution levels for higher confidence
  penaltyFactors: ConfidencePenaltyFactors;
  bonusFactors: ConfidenceBonusFactors;
}

/**
 * Factors that decrease confidence
 */
export interface ConfidencePenaltyFactors {
  multipleCandidates: number;       // Penalty per additional candidate (default: 0.05)
  lowResolutionLevel: number;       // Penalty for CHA/RTA vs exact resolution (default: 0.1)
  externalDependency: number;       // Penalty for external library calls (default: 0.05)
  abstractImplementation: number;   // Penalty for abstract methods (default: 0.02)
}

/**
 * Factors that increase confidence
 */
export interface ConfidenceBonusFactors {
  concreteImplementation: number;   // Bonus for concrete methods (default: 0.05)
  constructorCall: number;          // Bonus for constructor instantiation (default: 0.02)
  singleCandidate: number;          // Bonus for unique resolution (default: 0.05)
  exactResolution: number;          // Bonus for exact resolution levels (default: 0.03)
  localResolution: number;          // Bonus for local/same-file resolution (default: 0.02)
}

/**
 * Result of confidence calculation
 */
export interface ConfidenceCalculationResult {
  finalScore: number;
  baseScore: number;
  adjustments: ConfidenceAdjustment[];
  metadata: {
    calculationMethod: string;
    timestamp: string;
    factors: Record<string, unknown>;
  };
}

/**
 * Individual confidence adjustment
 */
export interface ConfidenceAdjustment {
  factor: string;
  adjustment: number;
  reason: string;
}

/**
 * Unified Confidence Calculator
 * 
 * Extracted from safe-delete and RTA analyzer to provide consistent
 * confidence scoring across all dependency analysis operations.
 * 
 * Features inherited from safe-delete:
 * - Multi-factor confidence calculation
 * - Resolution level preferences  
 * - Conservative scoring approach
 * - Detailed adjustment tracking
 */
export class ConfidenceCalculator {
  private static readonly DEFAULT_OPTIONS: ConfidenceCalculationOptions = {
    baseConfidence: 0.9,
    preferredResolutionLevels: ['local_exact', 'import_exact', 'runtime_confirmed'],
    penaltyFactors: {
      multipleCandidates: 0.05,
      lowResolutionLevel: 0.1,
      externalDependency: 0.05,
      abstractImplementation: 0.02
    },
    bonusFactors: {
      concreteImplementation: 0.05,
      constructorCall: 0.02,
      singleCandidate: 0.05,
      exactResolution: 0.03,
      localResolution: 0.02
    }
  };

  /**
   * Calculate confidence score for RTA analysis (inherited from RTA analyzer)
   */
  static calculateRTAConfidence(
    candidatesCount: number,
    isAbstract: boolean = false,
    hasConstructorInstantiation: boolean = false,
    hasInterfaceMatch: boolean = false,
    options: Partial<ConfidenceCalculationOptions> = {}
  ): ConfidenceCalculationResult {
    const config = { ...this.DEFAULT_OPTIONS, ...options };
    const adjustments: ConfidenceAdjustment[] = [];
    
    let confidence = config.baseConfidence;

    // Non-linear penalty for multiple candidates (inherited from RTA)
    if (candidatesCount > 1) {
      const candidatePenalty = Math.min(0.2, 1 - (1 / Math.sqrt(candidatesCount)));
      confidence -= candidatePenalty;
      adjustments.push({
        factor: 'multiple_candidates',
        adjustment: -candidatePenalty,
        reason: `${candidatesCount} candidates reduce confidence (non-linear penalty)`
      });
    } else {
      confidence += config.bonusFactors.singleCandidate;
      adjustments.push({
        factor: 'single_candidate',
        adjustment: config.bonusFactors.singleCandidate,
        reason: 'Single candidate increases confidence'
      });
    }

    // Concrete implementation bonus
    if (!isAbstract) {
      confidence += config.bonusFactors.concreteImplementation;
      adjustments.push({
        factor: 'concrete_implementation',
        adjustment: config.bonusFactors.concreteImplementation,
        reason: 'Concrete implementation increases confidence'
      });
    } else {
      confidence -= config.penaltyFactors.abstractImplementation;
      adjustments.push({
        factor: 'abstract_implementation',
        adjustment: -config.penaltyFactors.abstractImplementation,
        reason: 'Abstract implementation decreases confidence'
      });
    }

    // Constructor instantiation bonus
    if (hasConstructorInstantiation) {
      confidence += config.bonusFactors.constructorCall;
      adjustments.push({
        factor: 'constructor_instantiation',
        adjustment: config.bonusFactors.constructorCall,
        reason: 'Constructor instantiation increases confidence'
      });
    }

    // Interface match bonus
    if (hasInterfaceMatch) {
      const interfaceBonus = 0.01; // Small bonus for interface match
      confidence += interfaceBonus;
      adjustments.push({
        factor: 'interface_match',
        adjustment: interfaceBonus,
        reason: 'Interface implementation match increases confidence'
      });
    }

    // Ensure confidence stays within bounds
    const finalScore = Math.max(0.7, Math.min(1.0, confidence));

    return {
      finalScore,
      baseScore: config.baseConfidence,
      adjustments,
      metadata: {
        calculationMethod: 'rta_confidence',
        timestamp: new Date().toISOString(),
        factors: {
          candidatesCount,
          isAbstract,
          hasConstructorInstantiation,
          hasInterfaceMatch
        }
      }
    };
  }

  /**
   * Calculate confidence score for call edge resolution
   */
  static calculateCallEdgeConfidence(
    edge: CallEdge,
    candidatesCount: number = 1,
    options: Partial<ConfidenceCalculationOptions> = {}
  ): ConfidenceCalculationResult {
    const config = { ...this.DEFAULT_OPTIONS, ...options };
    const adjustments: ConfidenceAdjustment[] = [];
    
    let confidence = config.baseConfidence;

    // Resolution level factor
    if (edge.resolutionLevel) {
      if (config.preferredResolutionLevels.includes(edge.resolutionLevel)) {
        confidence += config.bonusFactors.exactResolution;
        adjustments.push({
          factor: 'preferred_resolution',
          adjustment: config.bonusFactors.exactResolution,
          reason: `Preferred resolution level: ${edge.resolutionLevel}`
        });
      } else {
        confidence -= config.penaltyFactors.lowResolutionLevel;
        adjustments.push({
          factor: 'low_resolution',
          adjustment: -config.penaltyFactors.lowResolutionLevel,
          reason: `Lower confidence resolution level: ${edge.resolutionLevel}`
        });
      }
    }

    // Multiple candidates penalty
    if (candidatesCount > 1) {
      const penalty = Math.min(0.2, candidatesCount * config.penaltyFactors.multipleCandidates);
      confidence -= penalty;
      adjustments.push({
        factor: 'multiple_candidates',
        adjustment: -penalty,
        reason: `${candidatesCount} candidates reduce confidence`
      });
    }

    // Runtime confirmed bonus
    if (edge.runtimeConfirmed) {
      const runtimeBonus = 0.1; // Significant bonus for runtime confirmation
      confidence += runtimeBonus;
      adjustments.push({
        factor: 'runtime_confirmed',
        adjustment: runtimeBonus,
        reason: 'Runtime confirmation increases confidence'
      });
    }

    // Local resolution bonus (same file)
    if (edge.metadata?.['sameFile']) {
      confidence += config.bonusFactors.localResolution;
      adjustments.push({
        factor: 'local_resolution',
        adjustment: config.bonusFactors.localResolution,
        reason: 'Same-file resolution increases confidence'
      });
    }

    const finalScore = Math.max(0.0, Math.min(1.0, confidence));

    return {
      finalScore,
      baseScore: config.baseConfidence,
      adjustments,
      metadata: {
        calculationMethod: 'call_edge_confidence',
        timestamp: new Date().toISOString(),
        factors: {
          resolutionLevel: edge.resolutionLevel,
          candidatesCount,
          runtimeConfirmed: edge.runtimeConfirmed,
          callContext: edge.callContext
        }
      }
    };
  }

  /**
   * Calculate confidence for deletion candidates (inherited from safe-delete)
   */
  static calculateDeletionConfidence(
    func: FunctionInfo,
    callersCount: number,
    highConfidenceCallersCount: number,
    reason: 'unreachable' | 'no-high-confidence-callers' | 'isolated',
    options: Partial<ConfidenceCalculationOptions> = {}
  ): ConfidenceCalculationResult {
    const config = { ...this.DEFAULT_OPTIONS, ...options };
    const adjustments: ConfidenceAdjustment[] = [];
    
    let confidence: number;

    // Base confidence depends on deletion reason
    switch (reason) {
      case 'unreachable':
        confidence = 1.0; // Highest confidence for truly unreachable functions
        adjustments.push({
          factor: 'unreachable',
          adjustment: 0.1,
          reason: 'Function is unreachable from entry points'
        });
        break;
      case 'no-high-confidence-callers':
        confidence = 0.90; // Lower confidence when callers exist but aren't high-confidence
        adjustments.push({
          factor: 'no_high_confidence_callers',
          adjustment: -0.1,
          reason: 'Function has callers but none are high-confidence'
        });
        break;
      case 'isolated':
        confidence = 0.85; // Medium confidence for isolated functions
        adjustments.push({
          factor: 'isolated',
          adjustment: -0.15,
          reason: 'Function appears isolated but may have hidden dependencies'
        });
        break;
    }

    // Export penalty (exported functions are riskier to delete)
    if (func.isExported) {
      const exportPenalty = 0.2; // Significant penalty for exported functions
      confidence -= exportPenalty;
      adjustments.push({
        factor: 'exported_function',
        adjustment: -exportPenalty,
        reason: 'Exported functions are risky to delete'
      });
    }

    // Size factor (larger functions are riskier)
    const functionSize = func.endLine - func.startLine;
    if (functionSize > 50) {
      const sizePenalty = Math.min(0.1, (functionSize - 50) / 500);
      confidence -= sizePenalty;
      adjustments.push({
        factor: 'large_function',
        adjustment: -sizePenalty,
        reason: `Large function (${functionSize} lines) is riskier to delete`
      });
    }

    // Callers factor
    if (callersCount > 0 && highConfidenceCallersCount === 0) {
      const callersPenalty = Math.min(0.15, callersCount * 0.02);
      confidence -= callersPenalty;
      adjustments.push({
        factor: 'low_confidence_callers',
        adjustment: -callersPenalty,
        reason: `${callersCount} callers with low confidence increase risk`
      });
    }

    // Ensure minimum threshold for deletion operations
    const finalScore = Math.max(0.5, Math.min(1.0, confidence));

    return {
      finalScore,
      baseScore: config.baseConfidence,
      adjustments,
      metadata: {
        calculationMethod: 'deletion_confidence',
        timestamp: new Date().toISOString(),
        factors: {
          reason,
          isExported: func.isExported,
          functionSize,
          callersCount,
          highConfidenceCallersCount
        }
      }
    };
  }

  /**
   * Calculate general dependency confidence (for dep command)
   */
  static calculateDependencyConfidence(
    _func: FunctionInfo,
    dependencyMetrics: DependencyMetrics,
    options: Partial<ConfidenceCalculationOptions> = {}
  ): ConfidenceCalculationResult {
    const config = { ...this.DEFAULT_OPTIONS, ...options };
    const adjustments: ConfidenceAdjustment[] = [];
    
    let confidence = config.baseConfidence;

    // Stability factor based on caller consistency
    if (dependencyMetrics.callerConsistency > 0.8) {
      const stabilityBonus = 0.1;
      confidence += stabilityBonus;
      adjustments.push({
        factor: 'high_caller_consistency',
        adjustment: stabilityBonus,
        reason: `High caller consistency (${(dependencyMetrics.callerConsistency * 100).toFixed(1)}%)`
      });
    }

    // Architecture compliance factor
    if (dependencyMetrics.architectureViolations === 0) {
      const complianceBonus = 0.05;
      confidence += complianceBonus;
      adjustments.push({
        factor: 'architecture_compliant',
        adjustment: complianceBonus,
        reason: 'No architecture violations detected'
      });
    } else {
      const violationPenalty = Math.min(0.2, dependencyMetrics.architectureViolations * 0.05);
      confidence -= violationPenalty;
      adjustments.push({
        factor: 'architecture_violations',
        adjustment: -violationPenalty,
        reason: `${dependencyMetrics.architectureViolations} architecture violations`
      });
    }

    // Coupling factor
    if (dependencyMetrics.couplingScore > 0.7) {
      const couplingPenalty = 0.1;
      confidence -= couplingPenalty;
      adjustments.push({
        factor: 'high_coupling',
        adjustment: -couplingPenalty,
        reason: `High coupling score (${(dependencyMetrics.couplingScore * 100).toFixed(1)}%)`
      });
    }

    const finalScore = Math.max(0.0, Math.min(1.0, confidence));

    return {
      finalScore,
      baseScore: config.baseConfidence,
      adjustments,
      metadata: {
        calculationMethod: 'dependency_confidence',
        timestamp: new Date().toISOString(),
        factors: {
          callerConsistency: dependencyMetrics.callerConsistency,
          architectureViolations: dependencyMetrics.architectureViolations,
          couplingScore: dependencyMetrics.couplingScore
        }
      }
    };
  }

  /**
   * Get summary statistics for a collection of confidence results
   */
  static summarizeConfidenceResults(results: ConfidenceCalculationResult[]): ConfidenceSummary {
    if (results.length === 0) {
      return {
        count: 0,
        averageScore: 0,
        medianScore: 0,
        minScore: 0,
        maxScore: 0,
        distribution: { low: 0, medium: 0, high: 0 },
        topAdjustmentFactors: []
      };
    }

    const scores = results.map(r => r.finalScore);
    const sortedScores = [...scores].sort((a, b) => a - b);
    
    // Calculate statistics
    const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const medianScore = sortedScores[Math.floor(sortedScores.length / 2)];
    const minScore = sortedScores[0];
    const maxScore = sortedScores[sortedScores.length - 1];

    // Calculate distribution
    const distribution = {
      low: scores.filter(s => s < 0.7).length,
      medium: scores.filter(s => s >= 0.7 && s < 0.9).length,
      high: scores.filter(s => s >= 0.9).length
    };

    // Find top adjustment factors
    const factorCounts = new Map<string, number>();
    for (const result of results) {
      for (const adjustment of result.adjustments) {
        factorCounts.set(adjustment.factor, (factorCounts.get(adjustment.factor) || 0) + 1);
      }
    }
    
    const topAdjustmentFactors = Array.from(factorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([factor, count]) => ({ factor, count }));

    return {
      count: results.length,
      averageScore,
      medianScore,
      minScore,
      maxScore,
      distribution,
      topAdjustmentFactors
    };
  }
}

/**
 * Metrics for dependency analysis confidence calculation
 */
export interface DependencyMetrics {
  callerConsistency: number;        // 0-1, how consistent the callers are
  architectureViolations: number;   // Count of architecture violations
  couplingScore: number;           // 0-1, coupling strength
}

/**
 * Summary of confidence calculation results
 */
export interface ConfidenceSummary {
  count: number;
  averageScore: number;
  medianScore: number;
  minScore: number;
  maxScore: number;
  distribution: {
    low: number;    // < 0.7
    medium: number; // 0.7 - 0.9
    high: number;   // >= 0.9
  };
  topAdjustmentFactors: Array<{
    factor: string;
    count: number;
  }>;
}