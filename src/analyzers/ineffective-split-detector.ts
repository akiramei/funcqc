import { FunctionInfo, CallEdge } from '../types';
import { Project, SourceFile, FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, ConstructorDeclaration, SyntaxKind, ts, Node } from 'ts-morph';
import { ScriptTarget, ModuleKind } from 'typescript';
import { analyzePassthroughAST, scoreR2AST } from './ast-passthrough-analyzer';

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
  scoreMode?: 'sum' | 'prob'; // New: scoring strategy
  r2Ast?: boolean; // Enable AST-based R2 analysis
  r2MaxCandidates?: number; // Limit AST analysis to top N candidates
  sourceProvider?: (filePath: string) => string | undefined; // Provide actual source code for AST
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
  private sharedProject?: Project; // Shared ts-morph project for performance
  
  private readonly GENERIC_NAMES = new Set([
    'set', 'get', 'do', 'run', 'helper', 'process', 
    'handle', 'exec', 'execute', 'wrapper', 'delegate',
    'forward', 'call', 'invoke', 'proxy'
  ]);

  private readonly BOUNDARY_PATTERNS = [
    /\/(cli|commands|adapter|transport|controller)\//,
    /\/(usecase|application|infra|ports|gateway|entrypoints)\//,
    /\/(middleware|interceptor|handler|presenter)\//,
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
    
    // Pre-filter and prioritize candidates for R2 AST analysis
    const r2Candidates = this.prioritizeR2Candidates(functions, callsByFunction, options);
    
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
      
      // R2: Thin wrapper (enhanced with optional AST)
      const r2 = this.checkThinWrapperEnhanced(func, metrics, callsByFunction.outgoing, options, r2Candidates);
      if (r2) rulesHit.push(r2);
      
      // R3: Linear chain CC=1
      const r3 = this.checkLinearChain(func, metrics, callsByFunction, functionMap);
      if (r3) rulesHit.push(r3);
      
      // R4: Parent CC unchanged
      const r4 = this.checkParentComplexity(func, metrics, callsByFunction.incoming, functionMap, options);
      if (r4) rulesHit.push(r4);
      
      // R5: Generic name low reuse
      const r5 = this.checkGenericNameLowReuse(func, metrics);
      if (r5) rulesHit.push(r5);
      
      // R6: Pseudo boundary
      const r6 = this.checkPseudoBoundary(func, metrics);
      if (r6) rulesHit.push(r6);
      
      // R7: Local throwaway
      const r7 = this.checkLocalThrowaway(func, callsByFunction.incoming, functionMap);
      if (r7) rulesHit.push(r7);
      
      // Calculate total score and severity
      if (rulesHit.length > 0) {
        const totalScore = this.calculateTotalScore(rulesHit, options);
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
   * Prioritize R2 candidates for AST analysis
   */
  private prioritizeR2Candidates(
    functions: FunctionInfo[],
    callsByFunction: { incoming: Map<string, Set<string>>; outgoing: Map<string, Set<string>> },
    options: DetectionOptions
  ): Set<string> {
    if (!options.r2Ast) return new Set();

    const maxCandidates = options.r2MaxCandidates || 200;
    
    // Score functions for R2 candidacy
    const candidates = functions
      .map(func => {
        const fanIn = callsByFunction.incoming.get(func.id)?.size || 0;
        const fanOut = callsByFunction.outgoing.get(func.id)?.size || 0;
        const cc = func.metrics?.cyclomaticComplexity || 1;
        const sloc = func.metrics?.linesOfCode || 0;
        
        // Basic R2 criteria: single callee, low complexity, limited reuse
        if (fanOut === 1 && cc <= 2 && fanIn <= 3) {
          // Priority score: lower is better for AST analysis
          const priority = fanIn + cc * 2 + Math.max(0, sloc - 10) * 0.1;
          return { id: func.id, priority };
        }
        return null;
      })
      .filter((candidate): candidate is { id: string; priority: number } => candidate !== null)
      .sort((a, b) => a.priority - b.priority)
      .slice(0, maxCandidates)
      .map(c => c.id);

    return new Set(candidates);
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
    metrics: { cc: number; sloc: number; fanIn: number; fanOut: number },
    incomingCalls: Map<string, Set<string>>,
    functionMap: Map<string, FunctionInfo>,
    options: DetectionOptions = {}
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    const callers = incomingCalls.get(func.id) || new Set();
    
    // Check single caller with high complexity
    if (callers.size === 1 && metrics.cc <= 2) {
      const callerId = Array.from(callers)[0];
      const caller = functionMap.get(callerId);
      
      if (caller && caller.metrics?.cyclomaticComplexity && caller.metrics.cyclomaticComplexity >= 5) {
        let score = 0.8;
        let evidence = `parent cc=${caller.metrics.cyclomaticComplexity}, child cc=${metrics.cc}`;
        
        // Initialize shared project for branch density analysis if needed
        if (options.sourceProvider && !this.sharedProject) {
          this.sharedProject = new Project({
            useInMemoryFileSystem: true,
            compilerOptions: {
              target: ScriptTarget.ES2022,
              module: ModuleKind.ESNext,
              allowJs: true,
              declaration: false,
            },
          });
        }
        
        // Enhanced R4: Check branch density at call site if source is available
        if (options.sourceProvider && this.sharedProject) {
          try {
            const source = options.sourceProvider(caller.filePath);
            if (source) {
              const density = this.computeBranchDensityNearCall(source, caller, func.name);
              if (density > 0) {
                const adj = Math.min(0.5, density * 0.5); // 0..0.5 bonus
                score += adj;
                evidence += `, site density=${density.toFixed(2)}`;
              }
            }
          } catch {
            // Silently fall back to basic analysis
          }
        }
        
        // Ensure score stays within bounds
        score = Math.min(1, score);
        
        return {
          code: IneffectiveSplitRule.PARENT_CC_UNCHANGED,
          score,
          evidence
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
    metrics: { cc: number; sloc: number; fanIn: number; fanOut: number }
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
   * Enhanced R2 check with optional AST analysis
   */
  private checkThinWrapperEnhanced(
    func: FunctionInfo,
    metrics: { cc: number; sloc: number; fanIn: number; fanOut: number },
    outgoingCalls: Map<string, Set<string>>,
    options: DetectionOptions,
    r2Candidates: Set<string>
  ): { code: IneffectiveSplitRule; score: number; evidence: string } | null {
    const callees = outgoingCalls.get(func.id) || new Set();
    
    // Basic requirements: single callee, low complexity, limited reuse
    const allowCc = options.r2Ast ? 2 : 1;
    if (callees.size === 1 && metrics.cc <= allowCc && metrics.fanIn <= 2) {
      // First-stage heuristic analysis
      const basicAnalysis = this.analyzePassthrough(func);
      
      if (basicAnalysis.isPassthrough && basicAnalysis.passthroughRatio >= 0.6) {
        // Use AST analysis if enabled and function qualifies
        if (options.r2Ast && r2Candidates.has(func.id)) {
          const astScore = this.analyzeWithAST(func, options);
          if (astScore > 0) {
            return {
              code: IneffectiveSplitRule.THIN_WRAPPER,
              score: astScore,
              evidence: `AST: single call, fanIn=${metrics.fanIn}, ast-score=${astScore.toFixed(2)}`
            };
          }
        } else {
          // Fallback to basic analysis
          return {
            code: IneffectiveSplitRule.THIN_WRAPPER,
            score: basicAnalysis.passthroughRatio,
            evidence: `single call, fanIn=${metrics.fanIn}, passthrough≈${basicAnalysis.passthroughRatio.toFixed(2)}`
          };
        }
      }
    }
    
    return null;
  }

  /**
   * AST-based analysis for thin wrapper detection
   */
  private analyzeWithAST(func: FunctionInfo, options: DetectionOptions): number {
    try {
      // Get actual source code
      const sourceCode = options.sourceProvider?.(func.filePath);
      if (!sourceCode) {
        return 0; // No source available, fallback to basic analysis
      }

      // Initialize shared project if needed
      if (!this.sharedProject) {
        this.sharedProject = new Project({
          useInMemoryFileSystem: true,
          compilerOptions: {
            target: ScriptTarget.ES2022,
            module: ModuleKind.ESNext,
            allowJs: true,
            declaration: false,
          },
        });
      }

      // Create or update source file
      const sourceFile = this.sharedProject.createSourceFile(func.filePath, sourceCode, { overwrite: true });
      
      // Find the specific function node by position
      const functionNode = this.findFunctionNodeByPosition(sourceFile, func);
      if (functionNode) {
        // Use the imported functions
        const astAnalysis = analyzePassthroughAST(functionNode);
        return scoreR2AST(astAnalysis);
      }
    } catch (error) {
      // Fallback to basic analysis on AST errors
      console.warn(`AST analysis failed for function ${func.name}:`, error);
    }
    
    return 0;
  }

  /**
   * Find function node by start/end position with robust fallback
   */
  private findFunctionNodeByPosition(sourceFile: SourceFile, func: FunctionInfo): FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration | undefined {
    // Find all function-like nodes
    const functions = sourceFile.getFunctions();
    const methods = sourceFile.getClasses().flatMap(c => c.getMethods());
    const ctors = sourceFile.getClasses().flatMap(c => c.getConstructors());
    const arrows = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
    const funExprs = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression);
    
    const allFunctions = [...functions, ...methods, ...ctors, ...funExprs, ...arrows];
    
    // First try: exact match with small variance
    let node = allFunctions.find(fn => {
      const start = fn.getStartLineNumber();
      const end = fn.getEndLineNumber();
      return start === func.startLine && Math.abs(end - func.endLine) <= 2;
    });
    
    // Fallback: find the closest function that contains the start line
    if (!node) {
      const byContain = allFunctions
        .filter(fn => {
          const start = fn.getStartLineNumber();
          const end = fn.getEndLineNumber();
          return start <= func.startLine && func.startLine <= end;
        })
        .map(fn => ({ 
          fn, 
          dist: Math.abs(fn.getStartLineNumber() - func.startLine) 
        }))
        .sort((a, b) => a.dist - b.dist)[0]?.fn;
      node = byContain;
    }
    
    return node;
  }

  /**
   * Compute branch density near call site (R4 enhancement)
   */
  private computeBranchDensityNearCall(source: string, caller: FunctionInfo, childFunctionName: string): number {
    try {
      if (!this.sharedProject) return 0;
      
      const sourceFile = this.sharedProject.createSourceFile(caller.filePath, source, { overwrite: true });
      const callerNode = this.findFunctionNodeByPosition(sourceFile, caller);
      
      if (!callerNode) return 0;
      
      // Find call expressions to the child function
      const callExpressions = callerNode.getDescendantsOfKind(SyntaxKind.CallExpression);
      const childCalls = callExpressions.filter(call => {
        const expr = call.getExpression();
        return expr.getText() === childFunctionName || 
               (expr.getKind() === SyntaxKind.PropertyAccessExpression && 
                expr.getText().endsWith(`.${childFunctionName}`));
      });
      
      if (childCalls.length === 0) return 0;
      
      // For each call, find the containing block and count branch constructs
      let totalDensity = 0;
      for (const call of childCalls) {
        const containingBlock = this.findContainingBlock(call);
        if (containingBlock) {
          const branchCount = this.countBranchConstructs(containingBlock);
          const lineCount = containingBlock.getEndLineNumber() - containingBlock.getStartLineNumber() + 1;
          const density = lineCount > 0 ? branchCount / lineCount : 0;
          totalDensity += density;
        }
      }
      
      return childCalls.length > 0 ? totalDensity / childCalls.length : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Find the smallest containing block (function body, if/for/while block, etc.)
   */
  private findContainingBlock(node: Node): Node | null {
    let current = node.getParent();
    
    while (current) {
      // Look for blocks, function bodies, etc. (exclude SourceFile to avoid density dilution)
      if (current.getKind() === SyntaxKind.Block ||
          current.getKind() === SyntaxKind.FunctionDeclaration ||
          current.getKind() === SyntaxKind.MethodDeclaration ||
          current.getKind() === SyntaxKind.ArrowFunction) {
        return current;
      }
      current = current.getParent();
    }
    
    return null;
  }

  /**
   * Count branch constructs (if/switch/?:/&&/||/catch) in a block
   */
  private countBranchConstructs(block: Node): number {
    const branchKinds = [
      SyntaxKind.IfStatement,
      SyntaxKind.SwitchStatement,
      SyntaxKind.ConditionalExpression,
      SyntaxKind.BinaryExpression, // For && and || operators
      SyntaxKind.CatchClause,
      SyntaxKind.ForStatement,
      SyntaxKind.ForInStatement,
      SyntaxKind.ForOfStatement,
      SyntaxKind.WhileStatement,
      SyntaxKind.DoStatement
    ];
    
    let count = 0;
    for (const kind of branchKinds) {
      const nodes = block.getDescendantsOfKind(kind);
      if (kind === SyntaxKind.BinaryExpression) {
        // Only count logical AND/OR operations
        count += nodes.filter((node: Node) => {
          // Type guard for BinaryExpression
          if (Node.isBinaryExpression(node)) {
            const op = node.getOperatorToken().getKind();
            return op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken;
          }
          return false;
        }).length;
      } else {
        count += nodes.length;
      }
    }
    
    return count;
  }

  /**
   * Analyze passthrough characteristics (conservative)
   */
  private analyzePassthrough(func: FunctionInfo): PassthroughAnalysis {
    // Simple heuristic based on function signature and name
    // In a real implementation, this would use AST analysis
    
    // Check for side effects (logging, metrics, validation, etc.)
    if (this.hasSideEffectSuspicion(func)) {
      return {
        isPassthrough: false,
        passthroughRatio: 0,
        argPassthroughCount: 0,
        totalArgs: func.parameters.length
      };
    }
    
    // Check if function name suggests delegation
    const delegationPatterns = /^(handle|process|execute|forward|delegate|proxy|wrap)/i;
    const isDelegationName = delegationPatterns.test(func.name);
    
    // Estimate based on parameters
    const paramCount = func.parameters.length;
    
    // Conservative heuristic: delegation name suggests passthrough, but lower confidence
    if (isDelegationName && paramCount > 0) {
      return {
        isPassthrough: true,
        passthroughRatio: 0.6, // Conservative estimate (reduced from 0.9)
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
   * Check if function likely has side effects (logging, validation, etc.)
   */
  private hasSideEffectSuspicion(func: FunctionInfo): boolean {
    const sideEffectPatterns = [
      /log/i, /audit/i, /metric/i, /track/i, /monitor/i,
      /validate/i, /check/i, /verify/i, /ensure/i,
      /cache/i, /store/i, /save/i, /persist/i,
      /console/i, /process/i, /fs/i, /file/i
    ];
    
    // Check function name
    for (const pattern of sideEffectPatterns) {
      if (pattern.test(func.name)) return true;
    }
    
    // Check file path for side effect contexts
    const filePath = func.filePath.toLowerCase();
    if (filePath.includes('middleware') || filePath.includes('interceptor') || 
        filePath.includes('logger') || filePath.includes('validator')) {
      return true;
    }
    
    return false;
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
  private calculateTotalScore(rulesHit: Array<{ score: number }>, options: DetectionOptions = {}): number {
    const scoreMode = options.scoreMode || 'prob';
    
    if (scoreMode === 'sum') {
      // Legacy: Weighted sum with linear normalization
      const rawScore = rulesHit.reduce((sum, rule) => sum + rule.score, 0);
      const penalty = 0;
      return Math.min(10, Math.max(0, rawScore * 3 - penalty));
    } else {
      // New: Independent probability combination
      return this.calculateProbabilisticScore(rulesHit);
    }
  }

  /**
   * Calculate score using independent probability combination
   */
  private calculateProbabilisticScore(rulesHit: Array<{ score: number }>): number {
    // Convert rule scores to probabilities (0-1 range)
    const probabilities = rulesHit.map(rule => Math.max(0, Math.min(1, rule.score)));
    
    // Combine independent probabilities: P_total = 1 - ∏(1 - p_i)
    const combinedProb = this.combineProbabilities(probabilities);
    
    // Convert to 0-10 scale
    return this.toTenScale(combinedProb);
  }

  /**
   * Combine independent probabilities
   */
  private combineProbabilities(probabilities: number[]): number {
    let complement = 1;
    for (const p of probabilities) {
      complement *= (1 - Math.max(0, Math.min(1, p)));
    }
    return 1 - complement; // 0..1
  }

  /**
   * Convert probability to 0-10 scale
   */
  private toTenScale(probability: number): number {
    return Math.round(Math.max(0, Math.min(1, probability)) * 10 * 10) / 10; // 1 decimal place
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