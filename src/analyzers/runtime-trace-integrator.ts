import { IdealCallEdge, ResolutionLevel, FunctionMetadata } from './ideal-call-graph-analyzer';
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
  private functionMetadata: Map<string, FunctionMetadata> = new Map();

  /**
   * Integrate runtime traces with static analysis edges
   */
  async integrateTraces(edges: IdealCallEdge[], functions: Map<string, FunctionMetadata>): Promise<IdealCallEdge[]> {
    console.log('   🔄 Integrating runtime traces...');
    
    // Store function metadata for coverage mapping
    this.functionMetadata = functions;
    
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
      const coverageDir = process.env['NODE_V8_COVERAGE'] || '.nyc_output';
      
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
  private processCoverageData(coverage: V8CoverageData): void {
    if (!coverage.result) return;
    
    for (const script of coverage.result) {
      if (!script.url || !script.functions) continue;
      
      const filePath = script.url.replace('file://', '');
      const functions = script.functions;
      
      for (const func of functions) {
        if (func.isBlockCoverage && func.ranges) {
          const executedRanges = func.ranges.filter((r: V8CoverageRange) => r.count > 0);
          
          if (executedRanges.length > 0) {
            // Convert file offset to line number for mapping
            const startLine = this.offsetToLineNumber(filePath, func.ranges[0].startOffset);
            const coverageKey = `${filePath}:${startLine}`;
            
            this.coverageData.set(coverageKey, {
              filePath,
              functionName: func.functionName || 'anonymous',
              executionCount: executedRanges[0].count,
              startLine,
              startOffset: func.ranges[0].startOffset,
              executedRanges: executedRanges.map((r: V8CoverageRange) => ({
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
      ...(executionCount > 0 && { executionCount })
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
    // Get function metadata for callee
    const calleeFunction = this.functionMetadata.get(edge.calleeFunctionId);
    if (!calleeFunction) {
      return undefined;
    }
    
    // Try to find coverage data by multiple strategies
    const strategies = [
      // Strategy 1: Exact file path and line number match
      `${calleeFunction.filePath}:${calleeFunction.startLine}`,
      
      // Strategy 2: Normalize file path (remove file://, resolve relative paths)
      `${path.resolve(calleeFunction.filePath)}:${calleeFunction.startLine}`,
      
      // Strategy 3: Try with different path separators
      `${calleeFunction.filePath.replace(/\\/g, '/')}:${calleeFunction.startLine}`,
      
      // Strategy 4: Try with file:// prefix
      `file://${calleeFunction.filePath}:${calleeFunction.startLine}`,
      
      // Strategy 5: Try with file:// prefix and normalized path
      `file://${path.resolve(calleeFunction.filePath)}:${calleeFunction.startLine}`
    ];
    
    for (const strategy of strategies) {
      const match = this.coverageData.get(strategy);
      if (match) {
        return match;
      }
    }
    
    // Strategy 6: Fuzzy matching by file basename and function name
    const fileName = path.basename(calleeFunction.filePath);
    for (const [coverageKey, coverageInfo] of this.coverageData) {
      if (coverageKey.includes(fileName) && 
          (coverageInfo.functionName === calleeFunction.name || 
           coverageInfo.functionName === 'anonymous' && calleeFunction.name.includes('anonymous'))) {
        return coverageInfo;
      }
    }
    
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
   * Convert file offset to line number for coverage mapping
   */
  private offsetToLineNumber(filePath: string, offset: number): number {
    try {
      if (!fs.existsSync(filePath)) {
        return 1; // Default to line 1 if file doesn't exist
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.substring(0, offset).split('\n');
      return lines.length;
    } catch {
      return 1; // Default to line 1 on error
    }
  }

  /**
   * Get coverage statistics
   */
  getCoverageStats(): {
    totalCoveredFunctions: number;
    totalExecutions: number;
    averageExecutionCount: number;
  } {
    const totalCoveredFunctions = this.coverageData.size;
    const totalExecutions = Array.from(this.coverageData.values())
      .reduce((sum, info) => sum + info.executionCount, 0);
    const averageExecutionCount = totalCoveredFunctions > 0 ? totalExecutions / totalCoveredFunctions : 0;
    
    return {
      totalCoveredFunctions,
      totalExecutions,
      averageExecutionCount
    };
  }

  /**
   * Clear loaded data
   */
  clear(): void {
    this.coverageData.clear();
    this.executionTraces = [];
    this.functionMetadata.clear();
  }
}

interface CoverageInfo {
  filePath: string;
  functionName: string;
  executionCount: number;
  startLine: number;
  startOffset: number;
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

interface V8CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

interface V8CoverageFunction {
  functionName: string;
  isBlockCoverage: boolean;
  ranges: V8CoverageRange[];
}

interface V8CoverageScript {
  url: string;
  functions: V8CoverageFunction[];
}

interface V8CoverageData {
  result: V8CoverageScript[];
}