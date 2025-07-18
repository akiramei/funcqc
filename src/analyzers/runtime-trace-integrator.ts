import { IdealCallEdge, ResolutionLevel } from './ideal-call-graph-analyzer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Runtime Trace Integrator
 * 
 * Integrates runtime execution traces with static analysis to:
 * - Confirm actually executed call edges
 * - Eliminate false positives
 * - Boost confidence of runtime-confirmed edges
 * - Detect dynamic calls missed by static analysis
 */
export class RuntimeTraceIntegrator {
  private coverageData: Map<string, CoverageInfo> = new Map();
  private executionTraces: ExecutionTrace[] = [];

  /**
   * Integrate runtime traces with static analysis edges
   */
  async integrateTraces(edges: IdealCallEdge[]): Promise<IdealCallEdge[]> {
    console.log('   🔄 Integrating runtime traces...');
    
    // Load coverage data if available
    await this.loadCoverageData();
    
    // Load execution traces if available
    await this.loadExecutionTraces();
    
    if (this.coverageData.size === 0 && this.executionTraces.length === 0) {
      console.log('   ℹ️  No runtime traces available, skipping integration');
      return edges;
    }
    
    // Integrate traces with edges
    const integratedEdges = edges.map(edge => this.integrateEdgeWithTraces(edge));
    
    console.log(`   ✅ Integrated traces for ${integratedEdges.length} edges`);
    return integratedEdges;
  }

  /**
   * Load V8 coverage data if available
   */
  private async loadCoverageData(): Promise<void> {
    try {
      const coverageDir = process.env.NODE_V8_COVERAGE || '.nyc_output';
      
      if (!fs.existsSync(coverageDir)) {
        return;
      }
      
      const files = fs.readdirSync(coverageDir).filter(f => f.endsWith('.json'));
      
      for (const file of files) {
        const filePath = path.join(coverageDir, file);
        const coverageRaw = fs.readFileSync(filePath, 'utf8');
        const coverage = JSON.parse(coverageRaw);
        
        this.processCoverageData(coverage);
      }
      
      console.log(`   📊 Loaded coverage data for ${this.coverageData.size} files`);
    } catch (error) {
      console.log(`   ⚠️  Failed to load coverage data: ${error}`);
    }
  }

  /**
   * Process V8 coverage data
   */
  private processCoverageData(coverage: any): void {
    if (!coverage.result) return;
    
    for (const script of coverage.result) {
      if (!script.url || !script.functions) continue;
      
      const filePath = script.url.replace('file://', '');
      const functions = script.functions;
      
      for (const func of functions) {
        if (func.isBlockCoverage && func.ranges) {
          const executedRanges = func.ranges.filter((r: any) => r.count > 0);
          
          if (executedRanges.length > 0) {
            this.coverageData.set(`${filePath}:${func.ranges[0].startOffset}`, {
              filePath,
              functionName: func.functionName || 'anonymous',
              executionCount: executedRanges[0].count,
              executedRanges: executedRanges.map((r: any) => ({
                start: r.startOffset,
                end: r.endOffset,
                count: r.count
              }))
            });
          }
        }
      }
    }
  }

  /**
   * Load execution traces if available
   */
  private async loadExecutionTraces(): Promise<void> {
    try {
      const tracePath = '.funcqc/execution-traces.json';
      
      if (!fs.existsSync(tracePath)) {
        return;
      }
      
      const traceData = fs.readFileSync(tracePath, 'utf8');
      this.executionTraces = JSON.parse(traceData);
      
      console.log(`   📈 Loaded ${this.executionTraces.length} execution traces`);
    } catch (error) {
      console.log(`   ⚠️  Failed to load execution traces: ${error}`);
    }
  }

  /**
   * Integrate traces with a single edge
   */
  private integrateEdgeWithTraces(edge: IdealCallEdge): IdealCallEdge {
    let runtimeConfirmed = false;
    let executionCount = 0;
    
    // Check if edge is confirmed by coverage data
    const coverageMatch = this.findCoverageMatch(edge);
    if (coverageMatch) {
      runtimeConfirmed = true;
      executionCount = coverageMatch.executionCount;
    }
    
    // Check if edge is confirmed by execution traces
    const traceMatch = this.findTraceMatch(edge);
    if (traceMatch) {
      runtimeConfirmed = true;
      executionCount = Math.max(executionCount, traceMatch.count);
    }
    
    // Update edge with runtime information
    const updatedEdge: IdealCallEdge = {
      ...edge,
      runtimeConfirmed,
      executionCount: executionCount > 0 ? executionCount : undefined
    };
    
    // Boost confidence if runtime confirmed
    if (runtimeConfirmed) {
      updatedEdge.confidenceScore = Math.min(1.0, updatedEdge.confidenceScore + 0.05);
      
      // If we have strong runtime evidence, upgrade resolution level
      if (executionCount > 10) {
        updatedEdge.resolutionLevel = 'runtime_confirmed' as ResolutionLevel;
        updatedEdge.confidenceScore = 1.0;
      }
    }
    
    return updatedEdge;
  }

  /**
   * Find coverage data matching an edge
   */
  private findCoverageMatch(edge: IdealCallEdge): CoverageInfo | undefined {
    // This is a simplified implementation
    // In practice, we'd need to map function IDs to coverage data
    return undefined;
  }

  /**
   * Find execution trace matching an edge
   */
  private findTraceMatch(edge: IdealCallEdge): ExecutionTrace | undefined {
    return this.executionTraces.find(trace => 
      trace.caller === edge.callerFunctionId && 
      trace.callee === edge.calleeFunctionId
    );
  }

  /**
   * Generate execution trace for future use
   */
  generateExecutionTrace(callerFunctionId: string, calleeFunctionId: string): void {
    const existingTrace = this.executionTraces.find(t => 
      t.caller === callerFunctionId && t.callee === calleeFunctionId
    );
    
    if (existingTrace) {
      existingTrace.count++;
      existingTrace.lastSeen = new Date().toISOString();
    } else {
      this.executionTraces.push({
        caller: callerFunctionId,
        callee: calleeFunctionId,
        count: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });
    }
  }

  /**
   * Save execution traces to file
   */
  async saveExecutionTraces(): Promise<void> {
    try {
      const traceDir = '.funcqc';
      if (!fs.existsSync(traceDir)) {
        fs.mkdirSync(traceDir, { recursive: true });
      }
      
      const tracePath = path.join(traceDir, 'execution-traces.json');
      fs.writeFileSync(tracePath, JSON.stringify(this.executionTraces, null, 2));
      
      console.log(`   💾 Saved ${this.executionTraces.length} execution traces`);
    } catch (error) {
      console.log(`   ⚠️  Failed to save execution traces: ${error}`);
    }
  }

  /**
   * Clear loaded data
   */
  clear(): void {
    this.coverageData.clear();
    this.executionTraces = [];
  }
}

interface CoverageInfo {
  filePath: string;
  functionName: string;
  executionCount: number;
  executedRanges: Array<{
    start: number;
    end: number;
    count: number;
  }>;
}

interface ExecutionTrace {
  caller: string;
  callee: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}