import { CallEdge, FunctionInfo } from '../types';

/**
 * PageRank configuration options
 */
export interface PageRankOptions {
  dampingFactor?: number;      // Default: 0.85
  maxIterations?: number;      // Default: 100
  tolerance?: number;          // Default: 1e-6
  initialValue?: number;       // Default: 1.0
}

/**
 * PageRank result for a single function
 */
export interface PageRankScore {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  score: number;
  rank: number;               // 1-based ranking
  normalizedScore: number;    // Score normalized to 0-1 range
  importance: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * PageRank analysis result
 */
export interface PageRankResult {
  scores: PageRankScore[];
  iterations: number;
  converged: boolean;
  totalFunctions: number;
  averageScore: number;
  maxScore: number;
  minScore: number;
  importanceDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * PageRank calculator using call graph data
 * Implements the standard PageRank algorithm adapted for function importance
 */
export class PageRankCalculator {
  private readonly dampingFactor: number;
  private readonly maxIterations: number;
  private readonly tolerance: number;
  private readonly initialValue: number;

  constructor(options: PageRankOptions = {}) {
    this.dampingFactor = options.dampingFactor ?? 0.85;
    this.maxIterations = options.maxIterations ?? 100;
    this.tolerance = options.tolerance ?? 1e-6;
    this.initialValue = options.initialValue ?? 1.0;
  }

  /**
   * Calculate PageRank scores for all functions
   */
  calculatePageRank(
    functions: FunctionInfo[],
    callEdges: CallEdge[]
  ): PageRankResult {
    // Build function index and call graph
    const functionMap = this.buildFunctionMap(functions);
    const { outLinks, inLinks } = this.buildCallGraph(callEdges, functionMap);
    
    const functionIds = Array.from(functionMap.keys());
    const numFunctions = functionIds.length;
    
    if (numFunctions === 0) {
      return this.createEmptyResult();
    }

    // Initialize PageRank scores
    const scores = new Map<string, number>();
    const newScores = new Map<string, number>();
    
    for (const functionId of functionIds) {
      scores.set(functionId, this.initialValue);
      newScores.set(functionId, 0);
    }

    // Iterative PageRank computation
    let iteration = 0;
    let converged = false;

    for (iteration = 0; iteration < this.maxIterations; iteration++) {
      // Calculate new scores
      for (const functionId of functionIds) {
        let newScore = (1 - this.dampingFactor) / numFunctions;
        
        const incomingLinks = inLinks.get(functionId) || [];
        for (const callerId of incomingLinks) {
          const callerScore = scores.get(callerId) || 0;
          const callerOutDegree = (outLinks.get(callerId) || []).length;
          
          if (callerOutDegree > 0) {
            newScore += this.dampingFactor * (callerScore / callerOutDegree);
          }
        }
        
        newScores.set(functionId, newScore);
      }

      // Check convergence
      let maxDiff = 0;
      for (const functionId of functionIds) {
        const oldScore = scores.get(functionId) || 0;
        const newScore = newScores.get(functionId) || 0;
        const diff = Math.abs(newScore - oldScore);
        maxDiff = Math.max(maxDiff, diff);
        scores.set(functionId, newScore);
      }

      if (maxDiff < this.tolerance) {
        converged = true;
        break;
      }
    }

    // Create result with rankings and importance levels
    return this.createResult(
      scores,
      functionMap,
      iteration + 1,
      converged
    );
  }

  /**
   * Build function ID to function info mapping
   */
  private buildFunctionMap(functions: FunctionInfo[]): Map<string, FunctionInfo> {
    const map = new Map<string, FunctionInfo>();
    for (const func of functions) {
      map.set(func.id, func);
    }
    return map;
  }

  /**
   * Build call graph from call edges
   */
  private buildCallGraph(
    callEdges: CallEdge[],
    functionMap: Map<string, FunctionInfo>
  ): {
    outLinks: Map<string, string[]>;
    inLinks: Map<string, string[]>;
  } {
    const outLinks = new Map<string, string[]>();
    const inLinks = new Map<string, string[]>();

    // Initialize maps
    for (const functionId of functionMap.keys()) {
      outLinks.set(functionId, []);
      inLinks.set(functionId, []);
    }

    // Process call edges
    for (const edge of callEdges) {
      const callerId = edge.callerFunctionId;
      const calleeId = edge.calleeFunctionId;

      // Skip external calls (callee not in our function set)
      if (!calleeId || !functionMap.has(calleeId)) {
        continue;
      }

      // Skip self-loops to avoid inflation
      if (callerId === calleeId) {
        continue;
      }

      // Add to outgoing links
      const callerOut = outLinks.get(callerId) || [];
      if (!callerOut.includes(calleeId)) {
        callerOut.push(calleeId);
        outLinks.set(callerId, callerOut);
      }

      // Add to incoming links
      const calleeIn = inLinks.get(calleeId) || [];
      if (!calleeIn.includes(callerId)) {
        calleeIn.push(callerId);
        inLinks.set(calleeId, calleeIn);
      }
    }

    return { outLinks, inLinks };
  }

  /**
   * Create PageRank result with rankings and analysis
   */
  private createResult(
    scores: Map<string, number>,
    functionMap: Map<string, FunctionInfo>,
    iterations: number,
    converged: boolean
  ): PageRankResult {
    // Convert to array and sort by score
    const scoreArray: Array<{
      functionId: string;
      score: number;
      functionInfo: FunctionInfo;
    }> = [];

    for (const [functionId, score] of scores.entries()) {
      const functionInfo = functionMap.get(functionId);
      if (functionInfo) {
        scoreArray.push({ functionId, score, functionInfo });
      }
    }

    scoreArray.sort((a, b) => b.score - a.score);

    // Calculate statistics
    const allScores = scoreArray.map(item => item.score);
    const maxScore = Math.max(...allScores);
    const minScore = Math.min(...allScores);
    const averageScore = allScores.reduce((sum, score) => sum + score, 0) / allScores.length;

    // Create PageRank scores with rankings
    const pageRankScores: PageRankScore[] = scoreArray.map((item, index) => {
      const normalizedScore = maxScore > minScore ? 
        (item.score - minScore) / (maxScore - minScore) : 0;
      
      const importance = this.calculateImportance(normalizedScore);

      return {
        functionId: item.functionId,
        functionName: item.functionInfo.name,
        filePath: item.functionInfo.filePath,
        startLine: item.functionInfo.startLine,
        score: item.score,
        rank: index + 1,
        normalizedScore,
        importance
      };
    });

    // Calculate importance distribution
    const importanceDistribution = {
      critical: pageRankScores.filter(s => s.importance === 'critical').length,
      high: pageRankScores.filter(s => s.importance === 'high').length,
      medium: pageRankScores.filter(s => s.importance === 'medium').length,
      low: pageRankScores.filter(s => s.importance === 'low').length
    };

    return {
      scores: pageRankScores,
      iterations,
      converged,
      totalFunctions: pageRankScores.length,
      averageScore,
      maxScore,
      minScore,
      importanceDistribution
    };
  }

  /**
   * Calculate importance level based on normalized score
   */
  private calculateImportance(normalizedScore: number): 'critical' | 'high' | 'medium' | 'low' {
    if (normalizedScore >= 0.9) return 'critical';
    if (normalizedScore >= 0.7) return 'high';
    if (normalizedScore >= 0.3) return 'medium';
    return 'low';
  }

  /**
   * Create empty result for edge cases
   */
  private createEmptyResult(): PageRankResult {
    return {
      scores: [],
      iterations: 0,
      converged: true,
      totalFunctions: 0,
      averageScore: 0,
      maxScore: 0,
      minScore: 0,
      importanceDistribution: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    };
  }

  /**
   * Calculate PageRank-based centrality metrics for structural analysis
   */
  calculateCentralityMetrics(
    functions: FunctionInfo[],
    callEdges: CallEdge[]
  ): {
    centralityScores: Map<string, number>;
    topCentralFunctions: Array<{ functionId: string; functionName: string; filePath: string; startLine: number; centrality: number }>;
    centralityVariance: number;
    centralityGini: number;
  } {
    const result = this.calculatePageRank(functions, callEdges);
    
    // Extract centrality scores (normalized PageRank scores)
    const centralityScores = new Map<string, number>();
    const centralityValues: number[] = [];
    
    for (const score of result.scores) {
      centralityScores.set(score.functionId, score.normalizedScore);
      centralityValues.push(score.normalizedScore);
    }

    // Calculate centrality variance
    const avgCentrality = centralityValues.reduce((sum, val) => sum + val, 0) / centralityValues.length;
    const centralityVariance = centralityValues.reduce(
      (sum, val) => sum + Math.pow(val - avgCentrality, 2), 
      0
    ) / centralityValues.length;

    // Calculate Gini coefficient for centrality distribution
    const sortedCentrality = [...centralityValues].sort((a, b) => a - b);
    const n = sortedCentrality.length;
    let giniSum = 0;
    
    for (let i = 0; i < n; i++) {
      giniSum += (2 * (i + 1) - n - 1) * sortedCentrality[i];
    }
    
    const centralityGini = n > 1 ? giniSum / (n * avgCentrality * (n - 1)) : 0;

    // Get top central functions
    const topCentralFunctions = result.scores
      .slice(0, 10)
      .map(score => ({
        functionId: score.functionId,
        functionName: score.functionName,
        filePath: score.filePath,
        startLine: score.startLine,
        centrality: score.normalizedScore
      }));

    return {
      centralityScores,
      topCentralFunctions,
      centralityVariance,
      centralityGini
    };
  }
}