/**
 * Runtime Trace Integration Stage
 * Stage 5: Integrate V8 coverage data and execution traces for ultimate confidence
 */

import { RuntimeTraceIntegrator } from '../../runtime-trace-integrator';
import { IdealCallEdge, FunctionMetadata, ResolutionLevel } from '../../ideal-call-graph-analyzer';
import { Logger } from '../../../utils/cli-utils';
import { generateStableEdgeId } from '../../../utils/edge-id-generator';

// Runtime trace types
interface RuntimeTrace {
  callerFunctionId: string;
  calleeFunctionId: string;
  calleeName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export class RuntimeTraceIntegrationStage {
  private runtimeTraceIntegrator: RuntimeTraceIntegrator;
  private logger: Logger;
  // @ts-expect-error - Reserved for future use
  private _debug: boolean;

  constructor(runtimeTraceIntegrator: RuntimeTraceIntegrator, logger?: Logger) {
    this.runtimeTraceIntegrator = runtimeTraceIntegrator;
    this.logger = logger ?? new Logger(false);
    this._debug = process.env['DEBUG_STAGED_ANALYSIS'] === 'true';
  }

  /**
   * Integrate runtime traces with existing call graph edges
   */
  async performRuntimeTraceIntegration(
    edges: IdealCallEdge[],
    functions: Map<string, FunctionMetadata>
  ): Promise<{
    integratedEdges: IdealCallEdge[];
    enhancedEdgesCount: number;
    coverageStats: {
      totalCoveredFunctions: number;
      totalExecutions: number;
      coveragePercentage: number;
    };
  }> {
    try {
      // Integrate runtime traces
      const integratedEdges = await this.runtimeTraceIntegrator.integrateTraces(edges, functions);
      
      // Count how many edges were actually enhanced with runtime data
      const enhancedEdges = integratedEdges.filter(edge => edge.runtimeConfirmed).length;
      
      // Get coverage statistics
      const coverageStats = this.runtimeTraceIntegrator.getCoverageStats();
      
      if (coverageStats.totalCoveredFunctions > 0) {
        this.logger.debug(`Coverage: ${coverageStats.totalCoveredFunctions} functions, ${coverageStats.totalExecutions} executions`);
      }
      
      this.logger.debug(`Runtime integration enhanced ${enhancedEdges} edges with execution data`);
      
      return {
        integratedEdges,
        enhancedEdgesCount: enhancedEdges,
        coverageStats: {
          totalCoveredFunctions: coverageStats.totalCoveredFunctions,
          totalExecutions: coverageStats.totalExecutions,
          coveragePercentage: this.calculateCoveragePercentage(coverageStats.totalCoveredFunctions, functions.size)
        }
      };
    } catch (error) {
      this.logger.debug(`Runtime trace integration failed: ${error}`);
      
      return {
        integratedEdges: edges, // Return original edges if integration fails
        enhancedEdgesCount: 0,
        coverageStats: {
          totalCoveredFunctions: 0,
          totalExecutions: 0,
          coveragePercentage: 0
        }
      };
    }
  }

  /**
   * Validate runtime traces against static analysis
   */
  validateTraces(
    staticEdges: IdealCallEdge[],
    runtimeTraces: RuntimeTrace[]
  ): {
    confirmedEdges: IdealCallEdge[];
    contradictedEdges: IdealCallEdge[];
    newRuntimeEdges: IdealCallEdge[];
  } {
    const confirmedEdges: IdealCallEdge[] = [];
    const contradictedEdges: IdealCallEdge[] = [];
    const newRuntimeEdges: IdealCallEdge[] = [];

    // Create lookup maps for efficient comparison
    const staticEdgeMap = new Map<string, IdealCallEdge>();
    for (const edge of staticEdges) {
      const key = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
      staticEdgeMap.set(key, edge);
    }

    // Process runtime traces
    for (const trace of runtimeTraces) {
      const edgeKey = `${trace.callerFunctionId}->${trace.calleeFunctionId}`;
      const staticEdge = staticEdgeMap.get(edgeKey);
      
      if (staticEdge) {
        // Runtime confirms static analysis
        confirmedEdges.push({
          ...staticEdge,
          runtimeConfirmed: true,
          confidenceScore: 1.0 // Perfect confidence
        });
      } else {
        // Runtime discovered new edge not found by static analysis
        newRuntimeEdges.push({
          id: generateStableEdgeId(trace.callerFunctionId, trace.calleeFunctionId),
          callerFunctionId: trace.callerFunctionId,
          calleeFunctionId: trace.calleeFunctionId,
          calleeName: trace.calleeName || 'unknown',
          calleeSignature: undefined,
          callerClassName: undefined,
          calleeClassName: undefined,
          callType: 'direct',
          callContext: undefined,
          lineNumber: trace.lineNumber || 0,
          columnNumber: trace.columnNumber || 0,
          isAsync: false,
          isChained: false,
          metadata: { runtimeOnly: true },
          createdAt: new Date().toISOString(),
          candidates: [trace.calleeFunctionId],
          confidenceScore: 1.0,
          resolutionLevel: ResolutionLevel.RUNTIME_CONFIRMED,
          resolutionSource: 'runtime_verified',
          runtimeConfirmed: true,
          analysisMetadata: {
            timestamp: Date.now(),
            analysisVersion: '1.0',
            sourceHash: 'runtime'
          }
        });
      }
    }

    // Find static edges that were never executed (potential false positives)
    for (const edge of staticEdges) {
      const edgeKey = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
      if (!runtimeTraces.some(trace => 
        `${trace.callerFunctionId}->${trace.calleeFunctionId}` === edgeKey
      )) {
        // This static edge was never observed at runtime
        // It might be a false positive or just not executed in this run
        contradictedEdges.push(edge);
      }
    }

    this.logger.debug(`Runtime validation: ${confirmedEdges.length} confirmed, ${contradictedEdges.length} unexecuted, ${newRuntimeEdges.length} new runtime edges`);

    return {
      confirmedEdges,
      contradictedEdges,
      newRuntimeEdges
    };
  }

  /**
   * Get runtime trace statistics
   */
  getRuntimeStatistics(): {
    tracesCollected: number;
    functionsWithTraces: number;
    averageExecutionsPerFunction: number;
  } {
    const stats = this.runtimeTraceIntegrator.getCoverageStats();
    
    return {
      tracesCollected: stats.totalExecutions,
      functionsWithTraces: stats.totalCoveredFunctions,
      averageExecutionsPerFunction: stats.totalCoveredFunctions > 0 
        ? stats.totalExecutions / stats.totalCoveredFunctions 
        : 0
    };
  }

  /**
   * Check if runtime traces are available
   */
  hasRuntimeTraces(): boolean {
    const stats = this.runtimeTraceIntegrator.getCoverageStats();
    return stats.totalCoveredFunctions > 0;
  }

  /**
   * Calculate coverage percentage
   */
  private calculateCoveragePercentage(coveredFunctions: number, totalFunctions: number): number {
    if (totalFunctions === 0) return 0;
    return (coveredFunctions / totalFunctions) * 100;
  }

  /**
   * Reset integrator state for fresh analysis
   */
  reset(): void {
    // The runtime trace integrator handles its own state management
    // This method is provided for consistency with other stages
  }
}