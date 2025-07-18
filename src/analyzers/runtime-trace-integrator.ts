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
  private executionTraceIndex: Map<string, ExecutionTrace> = new Map();
  private functionMetadata: Map<string, FunctionMetadata> = new Map();
  private fileLineOffsetsCache: Map<string, number[]> = new Map();

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
   * Load V8 coverage data if available (async optimized)
   */
  private async loadCoverageData(): Promise<void> {
    try {
      const coverageDir = process.env['NODE_V8_COVERAGE'] || '.nyc_output';
      
      if (!fs.existsSync(coverageDir)) {
        return;
      }
      
      const files = (await fs.promises.readdir(coverageDir)).filter(f => f.endsWith('.json'));
      
      // Process files in parallel for better performance
      const coveragePromises = files.map(async (file) => {
        const filePath = path.join(coverageDir, file);
        const coverageRaw = await fs.promises.readFile(filePath, 'utf8');
        const coverage = JSON.parse(coverageRaw);
        return coverage;
      });
      
      const coverageResults = await Promise.all(coveragePromises);
      
      // Process all coverage data
      for (const coverage of coverageResults) {
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
   * Load execution traces if available (async optimized)
   */
  private async loadExecutionTraces(): Promise<void> {
    try {
      const tracePath = '.funcqc/execution-traces.json';
      
      if (!fs.existsSync(tracePath)) {
        return;
      }
      
      const traceData = await fs.promises.readFile(tracePath, 'utf8');
      this.executionTraces = JSON.parse(traceData);
      
      // Build index for O(1) lookup
      this.rebuildTraceIndex();
      
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
      // Use logarithmic scaling for execution count boost
      const executionBoost = executionCount > 0 ? Math.min(0.15, Math.log10(executionCount + 1) * 0.05) : 0.05;
      updatedEdge.confidenceScore = Math.min(1.0, updatedEdge.confidenceScore + executionBoost);
      
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
    
    // Strategy 6: Cautious fuzzy matching by file basename and function name
    const fileName = path.basename(calleeFunction.filePath);
    for (const [coverageKey, coverageInfo] of this.coverageData) {
      const coverageFileName = path.basename(coverageInfo.filePath);
      
      // Require exact filename match to prevent over-matching
      if (coverageFileName === fileName &&
          // Require sufficient execution count to increase confidence
          coverageInfo.executionCount >= 3 &&
          // Require function name match or anonymous pattern
          (coverageInfo.functionName === calleeFunction.name || 
           (coverageInfo.functionName === 'anonymous' && calleeFunction.name.includes('anonymous')))) {
        
        // Additional safety check: ensure file paths are reasonably similar
        const pathSimilarity = this.calculatePathSimilarity(calleeFunction.filePath, coverageInfo.filePath);
        if (pathSimilarity >= 0.7) {
          return coverageInfo;
        }
      }
    }
    
    return undefined;
  }

  /**
   * Find execution trace matching an edge with direction verification (O(1) lookup)
   */
  private findTraceMatch(edge: IdealCallEdge): ExecutionTrace | undefined {
    const traceKey = `${edge.callerFunctionId}->${edge.calleeFunctionId}`;
    const trace = this.executionTraceIndex.get(traceKey);
    
    if (!trace) {
      return undefined;
    }
    
    // Verify call direction if depth information is available
    if (trace.callerDepth !== undefined && trace.calleeDepth !== undefined) {
      const directionCorrect = trace.callerDepth < trace.calleeDepth;
      if (!directionCorrect) {
        console.warn(`   ⚠️  Direction mismatch: ${trace.caller} -> ${trace.callee} (depths: ${trace.callerDepth} -> ${trace.calleeDepth})`);
        return undefined; // Don't use traces with incorrect direction
      }
    }
    
    return trace;
  }

  /**
   * Generate execution trace for future use with optional depth information
   */
  generateExecutionTrace(
    callerFunctionId: string, 
    calleeFunctionId: string,
    callerDepth?: number,
    calleeDepth?: number
  ): void {
    const traceKey = `${callerFunctionId}->${calleeFunctionId}`;
    const existingTrace = this.executionTraceIndex.get(traceKey);
    
    if (existingTrace) {
      existingTrace.count++;
      existingTrace.lastSeen = new Date().toISOString();
      
      // Update depth information if provided
      if (callerDepth !== undefined && calleeDepth !== undefined) {
        existingTrace.callerDepth = callerDepth;
        existingTrace.calleeDepth = calleeDepth;
        existingTrace.directionVerified = callerDepth < calleeDepth;
      }
    } else {
      const newTrace: ExecutionTrace = {
        caller: callerFunctionId,
        callee: calleeFunctionId,
        count: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        callerDepth,
        calleeDepth,
        directionVerified: callerDepth !== undefined && calleeDepth !== undefined ? callerDepth < calleeDepth : undefined
      };
      
      this.executionTraces.push(newTrace);
      this.executionTraceIndex.set(traceKey, newTrace);
    }
  }

  /**
   * Save execution traces to file (async optimized with atomic writes)
   */
  async saveExecutionTraces(): Promise<void> {
    try {
      const traceDir = '.funcqc';
      if (!fs.existsSync(traceDir)) {
        await fs.promises.mkdir(traceDir, { recursive: true });
      }
      
      const tracePath = path.join(traceDir, 'execution-traces.json');
      const tempPath = `${tracePath}.tmp`;
      
      // Write to temp file first, then atomically rename
      await fs.promises.writeFile(tempPath, JSON.stringify(this.executionTraces, null, 2));
      await fs.promises.rename(tempPath, tracePath);
      
      console.log(`   💾 Saved ${this.executionTraces.length} execution traces`);
    } catch (error) {
      console.log(`   ⚠️  Failed to save execution traces: ${error}`);
    }
  }

  /**
   * Convert file offset to line number for coverage mapping (optimized with caching)
   */
  private offsetToLineNumber(filePath: string, offset: number): number {
    try {
      if (!fs.existsSync(filePath)) {
        return 1; // Default to line 1 if file doesn't exist
      }
      
      // Check cache first
      let lineOffsets = this.fileLineOffsetsCache.get(filePath);
      if (!lineOffsets) {
        // Build and cache line offsets for this file
        const content = fs.readFileSync(filePath, 'utf8');
        lineOffsets = this.buildLineOffsets(content);
        this.fileLineOffsetsCache.set(filePath, lineOffsets);
      }
      
      // Binary search to find the line number
      return this.binarySearchLineNumber(lineOffsets, offset);
    } catch {
      return 1; // Default to line 1 on error
    }
  }

  /**
   * Build array of line start offsets for a file
   */
  private buildLineOffsets(content: string): number[] {
    const offsets = [0]; // Line 1 starts at offset 0
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  /**
   * Binary search to find line number for given offset
   */
  private binarySearchLineNumber(lineOffsets: number[], offset: number): number {
    let left = 0;
    let right = lineOffsets.length - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midOffset = lineOffsets[mid];
      
      if (midOffset <= offset) {
        // Check if this is the last line or the next line starts after our offset
        if (mid === lineOffsets.length - 1 || lineOffsets[mid + 1] > offset) {
          return mid + 1; // Line numbers are 1-indexed
        }
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    return 1; // Fallback to line 1
  }

  /**
   * Calculate path similarity for fuzzy matching safety
   */
  private calculatePathSimilarity(path1: string, path2: string): number {
    const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const norm1 = normalize(path1);
    const norm2 = normalize(path2);
    
    // Split paths into components
    const parts1 = norm1.split('/').filter(p => p);
    const parts2 = norm2.split('/').filter(p => p);
    
    // Calculate Jaccard similarity
    const set1 = new Set(parts1);
    const set2 = new Set(parts2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Rebuild execution trace index for O(1) lookup
   */
  private rebuildTraceIndex(): void {
    this.executionTraceIndex.clear();
    for (const trace of this.executionTraces) {
      const traceKey = `${trace.caller}->${trace.callee}`;
      this.executionTraceIndex.set(traceKey, trace);
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
    this.executionTraceIndex.clear();
    this.functionMetadata.clear();
    this.fileLineOffsetsCache.clear();
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
  callerDepth?: number;
  calleeDepth?: number;
  directionVerified?: boolean;
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