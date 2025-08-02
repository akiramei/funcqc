import { FunctionInfo, CallEdge } from '../types';

/**
 * Detection rules for ineffective function splits
 */
export enum IneffectiveSplitRule {
  INLINE_CANDIDATE = 'R1',      // fanIn=1, CC<=1, SLOC<=6
  THIN_WRAPPER = 'R2',          // Single call with high passthrough
  LINEAR_CHAIN_CC1 = 'R3',      // CC=1 function chains
  PARENT_CC_UNCHANGED = 'R4',   // Parent CC>=5, child CC<=2
  GENERIC_NAME_LOW_REUSE = 'R5', // Generic names with fanIn<=1
  PSEUDO_BOUNDARY = 'R6',       // Non-boundary thin functions
  LOCAL_THROWAWAY = 'R7'        // Used only within parent
}

export interface IneffectiveSplitFinding {
  functionId: string;
  name: string;
  file: string;
  range: { startLine: number; endLine: number };
  metrics: {
    cc: number;
    sloc: number;
    fanIn: number;
    fanOut: number;
  };
  rulesHit: Array<{
    code: IneffectiveSplitRule;
    score: number;
    evidence: string;
  }>;
  totalScore: number;
  severity: 'High' | 'Medium' | 'Low';
  suggestions: string[];
  related: {
    callers: string[];
    callees: string[];
    chainSample?: string[];
  };
}

export interface DetectionOptions {
  threshold?: number;
  minLines?: number;
  includeTest?: boolean;
  includeBoundaries?: boolean;
}

export interface PassthroughAnalysis {
  isPassthrough: boolean;
  passthroughRatio: number;
  calleeName?: string;
  argPassthroughCount: number;
  totalArgs: number;
}

/**
 * Analyzer for detecting ineffective function splits
 * Identifies patterns where function splitting adds no value
 */
export class IneffectiveSplitDetector {
  private readonly GENERIC_NAMES = new Set([
    'set', 'get', 'do', 'run', 'helper', 'process', 
    'handle', 'exec', 'execute', 'wrapper', 'delegate',
    'forward', 'call', 'invoke', 'proxy'
  ]);

  private readonly BOUNDARY_PATTERNS = [
    /\/(cli|commands|adapter|transport|controller)\//,
    /^(main|handler|execute|bootstrap|index)$/,
    /\.(route|controller|adapter|service)\.ts$/
  ];

  private readonly TEST_PATTERNS = [
    /__tests?__|\.spec\.|\.test\.|fixture|mock|stub/i
  ];

  /**
   * Analyze functions to detect ineffective splits
   */
  detectIneffectiveSplits(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    options: DetectionOptions = {}
  ): IneffectiveSplitFinding[] {
    const findings: IneffectiveSplitFinding[] = [];
    
    // Build lookup maps
    const functionMap = new Map(functions.map(f => [f.id, f]));
    const callsByFunction = this.buildCallMaps(callEdges);
    
    // Analyze each function
    for (const func of functions) {
      // Skip test files if requested
      if (!options.includeTest && this.isTestFile(func.filePath)) {
        continue;
      }
      
      // Get metrics (use unique call counts from Sets)
      const metrics = {
        cc: func.metrics?.cyclomaticComplexity || 1,
        sloc: func.metrics?.linesOfCode || 0,
        fanIn: callsByFunction.incoming.get(func.id)?.size || 0,
        fanOut: callsByFunction.outgoing.get(func.id)?.size || 0
      };
      
      // Skip if below minimum lines threshold
      if (options.minLines && metrics.sloc < options.minLines) {
        continue;
      }
      
      // Check all rules
      const rulesHit = [];
      
      // R1: Inline candidate
      const r1 = this.checkInlineCandidate(func, metrics, options);
      if (r1) rulesHit.push(r1);
      
      // R2: Thin wrapper
      const r2 = this.checkThinWrapper(func, metrics, callsByFunction.outgoing);
      if (r2) rulesHit.push(r2);
      
      // R3: Linear chain CC=1
      const r3 = this.checkLinearChain(func, metrics, callsByFunction, functionMap);
      if (r3) rulesHit.push(r3);
      
      // R4: Parent CC unchanged
      const r4 = this.checkParentComplexity(func, metrics, callsByFunction.incoming, functionMap);
      if (r4) rulesHit.push(r4);
      
      // R5: Generic name low reuse
      const r5 = this.checkGenericNameLowReuse(func, metrics);
      if (r5) rulesHit.push(r5);
      
      // R6: Pseudo boundary
      const r6 = this.checkPseudoBoundary(func, metrics, options);
      if (r6) rulesHit.push(r6);
      
      // R7: Local throwaway
      const r7 = this.checkLocalThrowaway(func, metrics, callsByFunction.incoming, functionMap);
      if (r7) rulesHit.push(r7);
      
      // Calculate total score and severity
      if (rulesHit.length > 0) {
        const totalScore = this.calculateTotalScore(rulesHit);
        const severity = this.calculateSeverity(totalScore);
        
        // Apply threshold filter
        if (options.threshold && totalScore < options.threshold) {
          continue;
        }
        
        // Generate chain sample for CC=1 chains
        const chainSample = this.generateChainSample(func, callsByFunction, functionMap, rulesHit);
        
        findings.push({
          functionId: func.id,
          name: func.name,
          file: func.filePath,
          range: { startLine: func.startLine, endLine: func.endLine },
          metrics,
          rulesHit,
          totalScore,
          severity,
          suggestions: this.generateSuggestions(rulesHit),
          related: {
            callers: Array.from(callsByFunction.incoming.get(func.id) || []),
            callees: Array.from(callsByFunction.outgoing.get(func.id) || []),
            ...(chainSample && { chainSample })
          }
        });
      }
    }
    
    // Sort by score descending
    return findings.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * Build call maps for efficient lookup
   */
  private buildCallMaps(callEdges: CallEdge[]): {
    incoming: Map<string, Set<string>>;
    outgoing: Map<string, Set<string>>;
  } {
    const incoming = new Map<string, Set<string>>();
    const outgoing = new Map<string, Set<string>>();
    
    for (const edge of callEdges) {
      // Skip external calls or invalid edges
      if (!edge.calleeFunctionId || !edge.callerFunctionId) continue;
      
      // Incoming
      if (!incoming.has(edge.calleeFunctionId)) {
        incoming.set(edge.calleeFunctionId, new Set());
      }
      incoming.get(edge.calleeFunctionId)!.add(edge.callerFunctionId);
      
      // Outgoing
      if (!outgoing.has(edge.callerFunctionId)) {
        outgoing.set(edge.callerFunctionId, new Set());
      }
      outgoing.get(edge.callerFunctionId)!.add(edge.calleeFunctionId);
    }
    
    return { incoming, outgoing };
  }


  /**
   * R1: Check if function is an inline candidate
   */
  private checkInlineCandidate(
    func: FunctionInfo,
    metrics: { cc: number; sloc: number; fanIn: number; fanOut: number },
    options: DetectionOptions
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    // Skip if boundary candidate unless explicitly included
    if (!options.includeBoundaries && this.isBoundaryCandidate(func)) {
      return null;
    }
    
    if (metrics.fanIn === 1 && metrics.cc <= 1 && metrics.sloc <= 6) {
      // Check if it's likely a pure function (simple heuristic)
      const isPureish = this.isPureish(func);
      
      if (isPureish) {
        return {
          code: IneffectiveSplitRule.INLINE_CANDIDATE,
          score: 1.0,
          evidence: `fanIn=1, cc=${metrics.cc}, sloc=${metrics.sloc}, pureish`
        };
      }
    }
    
    return null;
  }

  /**
   * R2: Check if function is a thin wrapper
   */
  private checkThinWrapper(
    func: FunctionInfo,
    metrics: { cc: number; sloc: number; fanIn: number; fanOut: number },
    outgoingCalls: Map<string, Set<string>>
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    const callees = outgoingCalls.get(func.id) || new Set();
    
    // Check single callee, low complexity, and limited reuse (improved precision)
    if (callees.size === 1 && metrics.cc <= 1 && metrics.fanIn <= 2) {
      // Analyze passthrough characteristics
      const passthroughAnalysis = this.analyzePassthrough(func);
      
      if (passthroughAnalysis.isPassthrough && passthroughAnalysis.passthroughRatio >= 0.8) {
        return {
          code: IneffectiveSplitRule.THIN_WRAPPER,
          score: 0.9,
          evidence: `single call, fanIn=${metrics.fanIn}, passthrough≈${passthroughAnalysis.passthroughRatio.toFixed(2)}`
        };
      }
    }
    
    return null;
  }

  /**
   * R3: Check for linear CC=1 chains
   */
  private checkLinearChain(
    func: FunctionInfo,
    metrics: { cc: number; sloc: number; fanIn: number; fanOut: number },
    callMaps: { incoming: Map<string, Set<string>>; outgoing: Map<string, Set<string>> },
    functionMap: Map<string, FunctionInfo>
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    if (metrics.cc !== 1 || metrics.fanIn > 1) return null;
    
    // Trace CC=1 chain
    let chainLength = 0;
    let current = func.id;
    const visited = new Set<string>();
    
    while (!visited.has(current)) {
      visited.add(current);
      
      const callees = callMaps.outgoing.get(current) || new Set();
      if (callees.size !== 1) break;
      
      const nextId = Array.from(callees)[0];
      const nextFunc = functionMap.get(nextId);
      
      if (!nextFunc || nextFunc.metrics?.cyclomaticComplexity !== 1) break;
      
      chainLength++;
      current = nextId;
    }
    
    if (chainLength >= 2) {
      return {
        code: IneffectiveSplitRule.LINEAR_CHAIN_CC1,
        score: 0.7 + 0.05 * Math.min(5, chainLength - 2),
        evidence: `linear chain CC=1 length=${chainLength}`
      };
    }
    
    return null;
  }

  /**
   * R4: Check if parent complexity remains high
   */
  private checkParentComplexity(
    func: FunctionInfo,
    _metrics: { cc: number; sloc: number; fanIn: number; fanOut: number },
    incomingCalls: Map<string, Set<string>>,
    functionMap: Map<string, FunctionInfo>
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    const callers = incomingCalls.get(func.id) || new Set();
    
    // Check single caller with high complexity
    if (callers.size === 1 && _metrics.cc <= 2) {
      const callerId = Array.from(callers)[0];
      const caller = functionMap.get(callerId);
      
      if (caller && caller.metrics?.cyclomaticComplexity && caller.metrics.cyclomaticComplexity >= 5) {
        return {
          code: IneffectiveSplitRule.PARENT_CC_UNCHANGED,
          score: 0.8,
          evidence: `parent cc=${caller.metrics.cyclomaticComplexity}, child cc=${_metrics.cc}`
        };
      }
    }
    
    return null;
  }

  /**
   * R5: Check for generic names with low reuse
   */
  private checkGenericNameLowReuse(
    func: FunctionInfo,
    metrics: { cc: number; sloc: number; fanIn: number; fanOut: number }
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    const genericScore = this.calculateGenericNameScore(func.name);
    
    if (genericScore >= 0.6 && metrics.cc <= 1 && metrics.fanIn <= 1) {
      return {
        code: IneffectiveSplitRule.GENERIC_NAME_LOW_REUSE,
        score: 0.6,
        evidence: `generic name="${func.name}", fanIn=${metrics.fanIn}`
      };
    }
    
    return null;
  }

  /**
   * R6: Check for pseudo boundary functions
   */
  private checkPseudoBoundary(
    func: FunctionInfo,
    metrics: { cc: number; sloc: number; fanIn: number; fanOut: number },
    _options: DetectionOptions
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    // Check if it's NOT a boundary but looks like one
    if (!this.isBoundaryCandidate(func) && 
        metrics.cc <= 1 && 
        metrics.sloc <= 3 && 
        metrics.fanOut <= 1) {
      return {
        code: IneffectiveSplitRule.PSEUDO_BOUNDARY,
        score: 0.5,
        evidence: `non-boundary thin function, cc=${metrics.cc}, sloc=${metrics.sloc}`
      };
    }
    
    return null;
  }

  /**
   * R7: Check for local throwaway functions
   */
  private checkLocalThrowaway(
    func: FunctionInfo,
    _metrics: { cc: number; sloc: number; fanIn: number; fanOut: number },
    incomingCalls: Map<string, Set<string>>,
    functionMap: Map<string, FunctionInfo>
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    const callers = incomingCalls.get(func.id) || new Set();
    
    if (callers.size === 1) {
      const callerId = Array.from(callers)[0];
      const caller = functionMap.get(callerId);
      
      // Check if declared in same file and not exported
      if (caller && caller.filePath === func.filePath && !func.isExported) {
        return {
          code: IneffectiveSplitRule.LOCAL_THROWAWAY,
          score: 0.7,
          evidence: `local function used only by ${caller.name}`
        };
      }
    }
    
    return null;
  }

  /**
   * Analyze passthrough characteristics
   */
  private analyzePassthrough(func: FunctionInfo): PassthroughAnalysis {
    // Simple heuristic based on function signature and name
    // In a real implementation, this would use AST analysis
    
    // Check if function name suggests delegation
    const delegationPatterns = /^(handle|process|execute|forward|delegate|proxy|wrap)/i;
    const isDelegationName = delegationPatterns.test(func.name);
    
    // Estimate based on parameters
    const paramCount = func.parameters.length;
    
    // Simple heuristic: if it has delegation name and parameters, likely passthrough
    if (isDelegationName && paramCount > 0) {
      return {
        isPassthrough: true,
        passthroughRatio: 0.9, // High estimate for delegation patterns
        argPassthroughCount: paramCount,
        totalArgs: paramCount
      };
    }
    
    return {
      isPassthrough: false,
      passthroughRatio: 0,
      argPassthroughCount: 0,
      totalArgs: paramCount
    };
  }

  /**
   * Check if function is likely pure
   */
  private isPureish(func: FunctionInfo): boolean {
    // Simple heuristic: no async, no generator, short functions
    return !func.isAsync && 
           !func.isGenerator && 
           func.metrics?.linesOfCode !== undefined && 
           func.metrics.linesOfCode <= 10;
  }

  /**
   * Check if function is a boundary candidate
   */
  private isBoundaryCandidate(func: FunctionInfo): boolean {
    // Normalize path for Windows compatibility
    const normalizedPath = func.filePath.replace(/\\/g, '/');
    
    // Check file path patterns
    for (const pattern of this.BOUNDARY_PATTERNS) {
      if (pattern.test(normalizedPath)) return true;
    }
    
    // Check function names
    if (/^(main|handler|execute|bootstrap|index)$/.test(func.name)) {
      return true;
    }
    
    // Check if exported from index files
    if (func.isExported && normalizedPath.endsWith('/index.ts')) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath: string): boolean {
    for (const pattern of this.TEST_PATTERNS) {
      if (pattern.test(filePath)) return true;
    }
    return false;
  }

  /**
   * Calculate generic name score
   */
  private calculateGenericNameScore(name: string): number {
    const lowerName = name.toLowerCase();
    
    // Exact match
    if (this.GENERIC_NAMES.has(lowerName)) return 1.0;
    
    // Word boundary match (more precise)
    for (const generic of this.GENERIC_NAMES) {
      const regex = new RegExp(`\\b${generic}\\b`, 'i');
      if (regex.test(name)) return 0.7;
    }
    
    // Pattern match
    if (/^(get|set|do|run|handle|process)/.test(lowerName)) return 0.6;
    
    return 0;
  }

  /**
   * Calculate total score from rules
   */
  private calculateTotalScore(rulesHit: Array<{ score: number }>): number {
    // Weighted sum with linear normalization
    const rawScore = rulesHit.reduce((sum, rule) => sum + rule.score, 0);
    
    // Apply penalties for suppression patterns
    const penalty = 0;
    
    // Normalize to 0-10 scale
    return Math.min(10, Math.max(0, rawScore * 3 - penalty));
  }

  /**
   * Calculate severity from score
   */
  private calculateSeverity(score: number): 'High' | 'Medium' | 'Low' {
    if (score >= 7.5) return 'High';
    if (score >= 5.5) return 'Medium';
    return 'Low';
  }

  /**
   * Generate chain sample for CC=1 chains
   */
  private generateChainSample(
    func: FunctionInfo,
    callMaps: { incoming: Map<string, Set<string>>; outgoing: Map<string, Set<string>> },
    functionMap: Map<string, FunctionInfo>,
    rulesHit: Array<{ code: IneffectiveSplitRule }>
  ): string[] | undefined {
    // Only generate for CC=1 chain rules
    const hasChainRule = rulesHit.some(rule => rule.code === IneffectiveSplitRule.LINEAR_CHAIN_CC1);
    if (!hasChainRule) return undefined;
    
    const chainSample: string[] = [func.name];
    let current = func.id;
    const visited = new Set<string>();
    
    // Follow the chain
    while (!visited.has(current) && chainSample.length < 5) {
      visited.add(current);
      
      const callees = callMaps.outgoing.get(current) || new Set();
      if (callees.size !== 1) break;
      
      const nextId = Array.from(callees)[0];
      const nextFunc = functionMap.get(nextId);
      
      if (!nextFunc || nextFunc.metrics?.cyclomaticComplexity !== 1) break;
      
      chainSample.push(nextFunc.name);
      current = nextId;
    }
    
    return chainSample.length > 1 ? chainSample : undefined;
  }

  /**
   * Generate suggestions based on rules hit
   */
  private generateSuggestions(rulesHit: Array<{ code: IneffectiveSplitRule }>): string[] {
    const suggestions = new Set<string>();
    
    for (const rule of rulesHit) {
      switch (rule.code) {
        case IneffectiveSplitRule.INLINE_CANDIDATE:
          suggestions.add('Consider inlining into parent function');
          suggestions.add('Move to local scope if needed for clarity');
          break;
          
        case IneffectiveSplitRule.THIN_WRAPPER:
          suggestions.add('Remove wrapper and use target function directly');
          suggestions.add('Consider renaming target if wrapper name is clearer');
          break;
          
        case IneffectiveSplitRule.LINEAR_CHAIN_CC1:
          suggestions.add('Consolidate CC=1 chain into single function');
          suggestions.add('Review if intermediate steps add clarity');
          break;
          
        case IneffectiveSplitRule.PARENT_CC_UNCHANGED:
          suggestions.add('Parent complexity remains high - reconsider split strategy');
          suggestions.add('Extract different logical sections instead');
          break;
          
        case IneffectiveSplitRule.GENERIC_NAME_LOW_REUSE:
          suggestions.add('Use more specific naming or inline the function');
          suggestions.add('Consider if abstraction provides value');
          break;
          
        case IneffectiveSplitRule.PSEUDO_BOUNDARY:
          suggestions.add('Not a true boundary - consider consolidation');
          suggestions.add('Move to appropriate layer if boundary intended');
          break;
          
        case IneffectiveSplitRule.LOCAL_THROWAWAY:
          suggestions.add('Inline local function into its single caller');
          suggestions.add('Keep separate only if aids testing');
          break;
      }
    }
    
    // Add annotation suggestion
    suggestions.add('Add "// funcqc: keep-split <reason>" if split is intentional');
    
    return Array.from(suggestions);
  }
}