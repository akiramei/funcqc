/**
 * RTA Analysis Stage
 * Stage 4: Rapid Type Analysis with constructor tracking for refined method call resolution
 */

import { RTAAnalyzer } from '../../rta-analyzer';
import { UnresolvedMethodCall, MethodInfo } from '../../cha-analyzer';
import { FunctionMetadata } from '../../ideal-call-graph-analyzer';
import { Logger } from '../../../utils/cli-utils';
import { AnalysisState, InstantiationEvent } from '../types';
import { addEdge } from '../../shared/graph-utils';

export class RTAAnalysisStage {
  private rtaAnalyzer: RTAAnalyzer;
  private logger: Logger;
  // @ts-expect-error - Reserved for future use
  private _debug: boolean;

  constructor(rtaAnalyzer: RTAAnalyzer, logger?: Logger) {
    this.rtaAnalyzer = rtaAnalyzer;
    this.logger = logger ?? new Logger(false);
    this._debug = process.env['DEBUG_STAGED_ANALYSIS'] === 'true';
  }

  /**
   * Perform RTA analysis using CHA candidates and instantiation events
   */
  async performRTAAnalysis(
    functions: Map<string, FunctionMetadata>,
    chaCandidates: Map<string, MethodInfo[]>,
    unresolvedMethodCallsForRTA: UnresolvedMethodCall[],
    instantiationEvents: InstantiationEvent[],
    classToInterfacesMap: Map<string, string[]>,
    state: AnalysisState
  ): Promise<number> {
    if (chaCandidates.size === 0) {
      this.logger.debug('No CHA candidates for RTA analysis');
      return 0;
    }

    try {
      // Use optimized path with prebuilt instantiation events and class-to-interfaces mapping
      const rtaEdges = await this.rtaAnalyzer.performRTAAnalysisOptimized(
        functions, 
        chaCandidates, 
        unresolvedMethodCallsForRTA,
        instantiationEvents,
        classToInterfacesMap
      );
      
      // Add RTA edges to our collection
      for (const edge of rtaEdges) {
        addEdge(edge, state);
      }
      
      this.logger.debug(`RTA refined ${rtaEdges.length} method calls`);
      return rtaEdges.length;
    } catch (error) {
      this.logger.debug(`RTA analysis failed: ${error}`);
      return 0;
    }
  }

  /**
   * Collect instantiation events from AST nodes for optimization
   * This method processes the instantiation events gathered during earlier stages
   */
  processInstantiationEvents(
    instantiationEvents: InstantiationEvent[]
  ): {
    classInstantiations: Map<string, InstantiationEvent[]>;
    totalEvents: number;
  } {
    const classInstantiations = new Map<string, InstantiationEvent[]>();
    
    for (const event of instantiationEvents) {
      const existing = classInstantiations.get(event.typeName) || [];
      existing.push(event);
      classInstantiations.set(event.typeName, existing);
    }
    
    this.logger.debug(`Processed ${instantiationEvents.length} instantiation events for ${classInstantiations.size} classes`);
    
    return {
      classInstantiations,
      totalEvents: instantiationEvents.length
    };
  }

  /**
   * Filter method candidates based on instantiated classes
   */
  filterCandidatesByInstantiation(
    chaCandidates: Map<string, MethodInfo[]>,
    instantiationEvents: InstantiationEvent[]
  ): Map<string, MethodInfo[]> {
    const instantiatedClasses = new Set(instantiationEvents.map(e => e.typeName));
    const filteredCandidates = new Map<string, MethodInfo[]>();
    
    for (const [methodName, candidates] of chaCandidates) {
      const filteredMethodCandidates = candidates.filter(candidate => 
        instantiatedClasses.has(candidate.className)
      );
      
      if (filteredMethodCandidates.length > 0) {
        filteredCandidates.set(methodName, filteredMethodCandidates);
      }
    }
    
    const originalCount = Array.from(chaCandidates.values()).reduce((sum, arr) => sum + arr.length, 0);
    const filteredCount = Array.from(filteredCandidates.values()).reduce((sum, arr) => sum + arr.length, 0);
    
    this.logger.debug(`RTA filtering: ${originalCount} -> ${filteredCount} candidates (${((1 - filteredCount/originalCount) * 100).toFixed(1)}% reduction)`);
    
    return filteredCandidates;
  }

  /**
   * Get statistics about RTA analysis effectiveness
   */
  getAnalysisStatistics(): {
    candidatesAnalyzed: number;
    edgesGenerated: number;
    reductionRate: number;
  } {
    // The RTAAnalyzer should provide these statistics
    // For now, return placeholder values
    return {
      candidatesAnalyzed: 0,
      edgesGenerated: 0,
      reductionRate: 0
    };
  }


  /**
   * Reset analyzer state for fresh analysis
   */
  reset(): void {
    // The RTA analyzer handles its own state management
    // This method is provided for consistency with other stages
  }
}