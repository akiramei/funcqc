/**
 * CHA Analysis Stage
 * Stage 3: Class Hierarchy Analysis for method call resolution
 */

import { CHAAnalyzer, UnresolvedMethodCall, MethodInfo } from '../../cha-analyzer';
import { FunctionMetadata } from '../../ideal-call-graph-analyzer';
import { Logger } from '../../../utils/cli-utils';
import { AnalysisState } from '../types';
import { addEdge } from '../../shared/graph-utils';

export class CHAAnalysisStage {
  private chaAnalyzer: CHAAnalyzer;
  private logger: Logger;
  private _debug: boolean;

  constructor(chaAnalyzer: CHAAnalyzer, logger?: Logger) {
    this.chaAnalyzer = chaAnalyzer;
    this.logger = logger ?? new Logger(false);
    this._debug = process.env['DEBUG_STAGED_ANALYSIS'] === 'true';
  }

  /**
   * Perform CHA analysis on unresolved method calls
   */
  async performCHAAnalysis(
    functions: Map<string, FunctionMetadata>,
    unresolvedMethodCalls: UnresolvedMethodCall[],
    state: AnalysisState,
    snapshotId?: string
  ): Promise<{
    resolvedEdges: number;
    chaCandidates: Map<string, MethodInfo[]>;
    unresolvedMethodCallsForRTA: UnresolvedMethodCall[];
  }> {
    this.logger.debug(`CHA received ${unresolvedMethodCalls.length} unresolved method calls`);
    
    if (unresolvedMethodCalls.length === 0) {
      this.logger.debug('No unresolved method calls for CHA analysis');
      return {
        resolvedEdges: 0,
        chaCandidates: new Map(),
        unresolvedMethodCallsForRTA: []
      };
    }

    if (this._debug) {
      for (const call of unresolvedMethodCalls.slice(0, 5)) { // Log first 5 calls
        this.logger.debug(`🐛 Unresolved call: ${call.methodName} on ${call.receiverType || 'unknown'} from ${call.callerFunctionId}`);
      }
    }

    try {
      // Copy unresolved method calls for RTA analysis before CHA processes them
      const unresolvedMethodCallsForRTA = [...unresolvedMethodCalls];
      
      // Perform CHA analysis
      const chaEdges = await this.chaAnalyzer.performCHAAnalysis(functions, unresolvedMethodCalls, snapshotId);
      
      // Add CHA edges to our collection
      for (const edge of chaEdges) {
        addEdge(edge, state);
      }
      
      // Collect CHA candidates for RTA analysis
      const chaCandidates = this.collectCHACandidatesForRTA();
      
      this.logger.debug(`CHA resolved ${chaEdges.length} method calls`);
      
      return {
        resolvedEdges: chaEdges.length,
        chaCandidates,
        unresolvedMethodCallsForRTA
      };
    } catch (error) {
      this.logger.debug(`CHA analysis failed: ${error}`);
      return {
        resolvedEdges: 0,
        chaCandidates: new Map(),
        unresolvedMethodCallsForRTA: unresolvedMethodCalls
      };
    }
  }

  /**
   * Collect CHA candidates for RTA analysis
   */
  private collectCHACandidatesForRTA(): Map<string, MethodInfo[]> {
    const chaCandidates = new Map<string, MethodInfo[]>();
    
    // Get method candidates from CHA analyzer
    const methodIndex = this.chaAnalyzer.getMethodIndex();
    
    for (const [methodName, methodInfoSet] of methodIndex) {
      if (methodInfoSet.size > 0) {
        chaCandidates.set(methodName, Array.from(methodInfoSet));
      }
    }
    
    this.logger.debug(`Collected ${chaCandidates.size} CHA candidate groups for RTA`);
    return chaCandidates;
  }

  /**
   * Get the class-to-interfaces mapping from CHA analyzer
   */
  getClassToInterfacesMap(): Map<string, string[]> {
    return this.chaAnalyzer.getClassToInterfacesMap();
  }


  /**
   * Reset analyzer state for fresh analysis
   */
  reset(): void {
    // The CHA analyzer handles its own state management
    // This method is provided for consistency with other stages
  }
}