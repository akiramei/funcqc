import { FunctionInfo, CallEdge } from '../types';
import { DependencyMetrics } from './dependency-metrics';

/**
 * Risk patterns detected in the codebase
 */
export interface RiskPattern {
  type: 'wrapper' | 'fake-split' | 'circular' | 'isolated' | 'complexity-hotspot';
  severity: 'critical' | 'high' | 'medium' | 'low';
  functionId: string;
  functionName: string;
  filePath: string;
  description: string;
  details: Record<string, unknown>;
  score: number; // 0-100
}

/**
 * Options for risk detection
 */
export interface RiskDetectionOptions {
  wrapperThreshold?: number; // Default: 0.8
  fakeSplitThreshold?: number; // Default: 0.7
  complexityHotspotThreshold?: number; // Default: 20
  minFunctionSize?: number; // Default: 3
  includeIsolated?: boolean; // Default: true
}

/**
 * Risk analysis result
 */
export interface RiskAnalysisResult {
  patterns: RiskPattern[];
  summary: {
    totalRisks: number;
    criticalRisks: number;
    highRisks: number;
    mediumRisks: number;
    lowRisks: number;
    riskScore: number; // 0-100 overall risk score
  };
  recommendations: string[];
}

/**
 * Enhanced risk detection for code quality issues
 */
export class RiskDetector {
  private options: Required<RiskDetectionOptions>;

  constructor(options: RiskDetectionOptions = {}) {
    this.options = {
      wrapperThreshold: options.wrapperThreshold ?? 0.8,
      fakeSplitThreshold: options.fakeSplitThreshold ?? 0.7,
      complexityHotspotThreshold: options.complexityHotspotThreshold ?? 20,
      minFunctionSize: options.minFunctionSize ?? 3,
      includeIsolated: options.includeIsolated ?? true,
    };
  }

  /**
   * Analyze functions for risk patterns
   */
  analyzeRisks(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    metrics: DependencyMetrics[]
  ): RiskAnalysisResult {
    const patterns: RiskPattern[] = [];
    
    // Create lookup maps
    const functionMap = new Map(functions.map(f => [f.id, f]));
    const metricsMap = new Map(metrics.map(m => [m.functionId, m]));
    const callEdgesByFunction = this.groupCallEdgesByFunction(callEdges);

    // Detect wrapper functions
    const wrapperPatterns = this.detectWrapperFunctions(
      functions,
      callEdgesByFunction,
      functionMap
    );
    patterns.push(...wrapperPatterns);

    // Detect fake split patterns
    const fakeSplitPatterns = this.detectFakeSplitPatterns(
      functions,
      callEdgesByFunction,
      functionMap,
      metricsMap
    );
    patterns.push(...fakeSplitPatterns);

    // Detect complexity hotspots
    const hotspotPatterns = this.detectComplexityHotspots(
      functions,
      metricsMap
    );
    patterns.push(...hotspotPatterns);

    // Include isolated functions if requested
    if (this.options.includeIsolated) {
      const isolatedPatterns = this.detectIsolatedFunctions(
        functions,
        metricsMap
      );
      patterns.push(...isolatedPatterns);
    }

    // Calculate summary and recommendations
    const summary = this.calculateSummary(patterns);
    const recommendations = this.generateRecommendations(patterns, summary);

    return {
      patterns,
      summary,
      recommendations,
    };
  }

  /**
   * Detect wrapper functions (functions that only call one other function)
   */
  private detectWrapperFunctions(
    functions: FunctionInfo[],
    _callEdgesByFunction: Map<string, CallEdge[]>,
    _functionMap: Map<string, FunctionInfo>
  ): RiskPattern[] {
    const patterns: RiskPattern[] = [];

    for (const func of functions) {
      // Skip functions without metrics or small functions
      if (!func.metrics || func.metrics.linesOfCode < this.options.minFunctionSize) {
        continue;
      }

      const outgoingCalls = _callEdgesByFunction.get(func.id) || [];
      
      // Check if function is a wrapper
      if (this.isWrapperFunction(func, outgoingCalls, _functionMap)) {
        const wrappedFunction = _functionMap.get(outgoingCalls[0].calleeFunctionId || '');
        const score = this.calculateWrapperScore(func, outgoingCalls[0], wrappedFunction);
        
        patterns.push({
          type: 'wrapper',
          severity: this.calculateWrapperSeverity(score),
          functionId: func.id,
          functionName: func.name,
          filePath: func.filePath,
          description: `Function appears to be a wrapper around ${wrappedFunction?.name || 'unknown'}`,
          details: {
            wrappedFunctionId: outgoingCalls[0].calleeFunctionId,
            wrappedFunctionName: wrappedFunction?.name,
            callType: outgoingCalls[0].callType,
            linesOfCode: func.metrics.linesOfCode,
            hasParameters: func.parameters.length > 0,
            hasReturnType: func.returnType?.type !== 'void',
          },
          score,
        });
      }
    }

    return patterns;
  }

  /**
   * Check if a function is a wrapper
   */
  private isWrapperFunction(
    func: FunctionInfo,
    outgoingCalls: CallEdge[],
    _functionMap: Map<string, FunctionInfo>
  ): boolean {
    // Must have exactly one outgoing call
    if (outgoingCalls.length !== 1) {
      return false;
    }

    const calledFunction = _functionMap.get(outgoingCalls[0].calleeFunctionId || '');
    if (!calledFunction) {
      return false;
    }

    // Check if the function body is mostly just the call
    if (!func.metrics) {
      return false;
    }
    const bodyComplexity = func.metrics.cyclomaticComplexity;
    const bodyLines = func.metrics.linesOfCode;
    
    // Simple heuristic: low complexity and small size
    if (bodyComplexity > 2 || bodyLines > 10) {
      return false;
    }

    // Check if parameter count matches (likely just passing through)
    const paramCountSimilar = Math.abs(func.parameters.length - calledFunction.parameters.length) <= 1;
    
    // Check if return types are compatible
    const returnTypesCompatible = this.areReturnTypesCompatible(func.returnType?.type || '', calledFunction?.returnType?.type || '');
    
    return paramCountSimilar && returnTypesCompatible;
  }

  /**
   * Calculate wrapper function risk score
   */
  private calculateWrapperScore(
    wrapper: FunctionInfo,
    _edge: CallEdge,
    wrapped?: FunctionInfo
  ): number {
    let score = 70; // Base score for wrapper

    if (!wrapper.metrics) {
      return score;
    }

    // Adjust based on function size
    if (wrapper.metrics.linesOfCode <= 3) {
      score += 20; // Very small wrapper
    } else if (wrapper.metrics.linesOfCode <= 5) {
      score += 10; // Small wrapper
    }

    // Adjust based on complexity
    if (wrapper.metrics.cyclomaticComplexity === 1) {
      score += 10; // No branching
    }

    // Adjust based on parameter matching
    if (wrapped && wrapper.parameters.length === wrapped.parameters.length) {
      score += 5; // Exact parameter match
    }

    // Cap at 100
    return Math.min(score, 100);
  }

  /**
   * Calculate wrapper severity based on score
   */
  private calculateWrapperSeverity(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 90) return 'high';
    if (score >= 70) return 'medium';
    return 'low';
  }

  /**
   * Detect fake split patterns (complexity artificially distributed)
   */
  private detectFakeSplitPatterns(
    functions: FunctionInfo[],
    _callEdgesByFunction: Map<string, CallEdge[]>,
    _functionMap: Map<string, FunctionInfo>,
    _metricsMap: Map<string, DependencyMetrics>
  ): RiskPattern[] {
    const patterns: RiskPattern[] = [];
    
    // Group functions by file
    const functionsByFile = this.groupFunctionsByFile(functions);
    
    for (const [_filePath, fileFunctions] of functionsByFile.entries()) {
      // Look for clusters of small functions with high coupling
      const clusters = this.findFunctionClusters(fileFunctions, _callEdgesByFunction);
      
      for (const cluster of clusters) {
        if (this.isFakeSplitCluster(cluster, _callEdgesByFunction, _metricsMap)) {
          const score = this.calculateFakeSplitScore(cluster, _callEdgesByFunction, _metricsMap);
          
          for (const func of cluster) {
            patterns.push({
              type: 'fake-split',
              severity: this.calculateFakeSplitSeverity(score),
              functionId: func.id,
              functionName: func.name,
              filePath: func.filePath,
              description: 'Function appears to be part of an artificially split complex function',
              details: {
                clusterSize: cluster.length,
                totalComplexity: cluster.reduce((sum, f) => sum + (f.metrics?.cyclomaticComplexity || 0), 0),
                totalLines: cluster.reduce((sum, f) => sum + (f.metrics?.linesOfCode || 0), 0),
                clusterFunctions: cluster.map(f => ({ id: f.id, name: f.name })),
              },
              score,
            });
          }
        }
      }
    }
    
    return patterns;
  }

  /**
   * Find clusters of highly coupled functions
   */
  private findFunctionClusters(
    functions: FunctionInfo[],
    _callEdgesByFunction: Map<string, CallEdge[]>
  ): FunctionInfo[][] {
    const clusters: FunctionInfo[][] = [];
    const visited = new Set<string>();
    
    for (const func of functions) {
      if (visited.has(func.id)) continue;
      
      const cluster = this.expandCluster(func, functions, _callEdgesByFunction, visited);
      if (cluster.length >= 3) { // Minimum cluster size
        clusters.push(cluster);
      }
    }
    
    return clusters;
  }

  /**
   * Expand a cluster of related functions
   */
  private expandCluster(
    startFunc: FunctionInfo,
    allFunctions: FunctionInfo[],
    _callEdgesByFunction: Map<string, CallEdge[]>,
    visited: Set<string>
  ): FunctionInfo[] {
    const cluster: FunctionInfo[] = [];
    const queue = [startFunc];
    const clusterIds = new Set<string>();
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (clusterIds.has(current.id)) continue;
      
      clusterIds.add(current.id);
      visited.add(current.id);
      cluster.push(current);
      
      // Find directly connected functions in the same file
      const edges = _callEdgesByFunction.get(current.id) || [];
      for (const edge of edges) {
        const targetFunc = allFunctions.find(f => f.id === edge.calleeFunctionId);
        if (targetFunc && 
            targetFunc.filePath === current.filePath &&
            !clusterIds.has(targetFunc.id) &&
            (targetFunc.metrics?.linesOfCode || 0) < 20) { // Small functions only
          queue.push(targetFunc);
        }
      }
    }
    
    return cluster;
  }

  /**
   * Check if a cluster represents a fake split pattern
   */
  private isFakeSplitCluster(
    cluster: FunctionInfo[],
    _callEdgesByFunction: Map<string, CallEdge[]>,
    _metricsMap: Map<string, DependencyMetrics>
  ): boolean {
    // All functions should be small
    const allSmall = cluster.every(f => (f.metrics?.linesOfCode || 0) < 20);
    if (!allSmall) return false;
    
    // High coupling within cluster
    let internalCalls = 0;
    let externalCalls = 0;
    
    for (const func of cluster) {
      const edges = _callEdgesByFunction.get(func.id) || [];
      for (const edge of edges) {
        if (cluster.some(f => f.id === edge.calleeFunctionId)) {
          internalCalls++;
        } else {
          externalCalls++;
        }
      }
    }
    
    const couplingRatio = internalCalls / (internalCalls + externalCalls + 1);
    return couplingRatio > this.options.fakeSplitThreshold;
  }

  /**
   * Calculate fake split risk score
   */
  private calculateFakeSplitScore(
    cluster: FunctionInfo[],
    _callEdgesByFunction: Map<string, CallEdge[]>,
    _metricsMap: Map<string, DependencyMetrics>
  ): number {
    let score = 60; // Base score
    
    // Total complexity
    const totalComplexity = cluster.reduce((sum, f) => sum + (f.metrics?.cyclomaticComplexity || 0), 0);
    if (totalComplexity > 20) score += 20;
    else if (totalComplexity > 15) score += 10;
    
    // Cluster size
    if (cluster.length > 5) score += 15;
    else if (cluster.length > 3) score += 10;
    
    // Naming similarity (likely related)
    const nameSimilarity = this.calculateNameSimilarity(cluster);
    score += nameSimilarity * 10;
    
    return Math.min(score, 100);
  }

  /**
   * Calculate naming similarity in a cluster
   */
  private calculateNameSimilarity(cluster: FunctionInfo[]): number {
    const names = cluster.map(f => f.name.toLowerCase());
    let similarPairs = 0;
    let totalPairs = 0;
    
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        totalPairs++;
        if (this.areNamesSimilar(names[i], names[j])) {
          similarPairs++;
        }
      }
    }
    
    return totalPairs > 0 ? similarPairs / totalPairs : 0;
  }

  /**
   * Check if two function names are similar
   */
  private areNamesSimilar(name1: string, name2: string): boolean {
    // Common patterns: handle*, process*, validate*, etc.
    const prefixPattern = /^(handle|process|validate|check|get|set|update|create|delete|find)/;
    const match1 = name1.match(prefixPattern);
    const match2 = name2.match(prefixPattern);
    
    if (match1 && match2 && match1[1] === match2[1]) {
      return true;
    }
    
    // Check for common substrings
    const longerName = name1.length > name2.length ? name1 : name2;
    const shorterName = name1.length > name2.length ? name2 : name1;
    
    return longerName.includes(shorterName) || this.haveSimilarTokens(name1, name2);
  }

  /**
   * Check if names have similar tokens
   */
  private haveSimilarTokens(name1: string, name2: string): boolean {
    const tokens1 = this.tokenizeName(name1);
    const tokens2 = this.tokenizeName(name2);
    
    const commonTokens = tokens1.filter(t => tokens2.includes(t));
    const similarity = (commonTokens.length * 2) / (tokens1.length + tokens2.length);
    
    return similarity > 0.5;
  }

  /**
   * Tokenize a function name
   */
  private tokenizeName(name: string): string[] {
    // Split on camelCase, snake_case, etc.
    return name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 2); // Ignore short tokens
  }

  /**
   * Calculate fake split severity
   */
  private calculateFakeSplitSeverity(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 85) return 'high';
    if (score >= 70) return 'medium';
    return 'low';
  }

  /**
   * Detect complexity hotspots
   */
  private detectComplexityHotspots(
    functions: FunctionInfo[],
    _metricsMap: Map<string, DependencyMetrics>
  ): RiskPattern[] {
    const patterns: RiskPattern[] = [];
    
    for (const func of functions) {
      const metrics = _metricsMap.get(func.id);
      if (!metrics) continue;
      
      if (!func.metrics) continue;
      
      const complexity = func.metrics.cyclomaticComplexity;
      if (complexity >= this.options.complexityHotspotThreshold) {
        const score = this.calculateComplexityScore(func, metrics);
        
        patterns.push({
          type: 'complexity-hotspot',
          severity: this.calculateComplexitySeverity(complexity),
          functionId: func.id,
          functionName: func.name,
          filePath: func.filePath,
          description: `Function has very high complexity (${complexity})`,
          details: {
            cyclomaticComplexity: complexity,
            cognitiveComplexity: func.metrics.cognitiveComplexity,
            linesOfCode: func.metrics.linesOfCode,
            nestingDepth: func.metrics.maxNestingLevel,
            fanIn: metrics.fanIn,
            fanOut: metrics.fanOut,
          },
          score,
        });
      }
    }
    
    return patterns;
  }

  /**
   * Calculate complexity risk score
   */
  private calculateComplexityScore(func: FunctionInfo, metrics: DependencyMetrics): number {
    let score = 50; // Base score
    
    if (!func.metrics) {
      return score;
    }
    
    // Cyclomatic complexity
    if (func.metrics.cyclomaticComplexity > 30) score += 30;
    else if (func.metrics.cyclomaticComplexity > 20) score += 20;
    else score += 10;
    
    // Size
    if (func.metrics.linesOfCode > 100) score += 10;
    else if (func.metrics.linesOfCode > 50) score += 5;
    
    // Dependencies
    if (metrics.fanIn > 10 || metrics.fanOut > 10) score += 10;
    
    return Math.min(score, 100);
  }

  /**
   * Calculate complexity severity
   */
  private calculateComplexitySeverity(complexity: number): 'critical' | 'high' | 'medium' | 'low' {
    if (complexity >= 30) return 'critical';
    if (complexity >= 20) return 'high';
    return 'medium';
  }

  /**
   * Detect isolated functions
   */
  private detectIsolatedFunctions(
    functions: FunctionInfo[],
    _metricsMap: Map<string, DependencyMetrics>
  ): RiskPattern[] {
    const patterns: RiskPattern[] = [];
    
    for (const func of functions) {
      const metrics = _metricsMap.get(func.id);
      if (!metrics) continue;
      
      // Skip small utility functions or functions without metrics
      if (!func.metrics || func.metrics.linesOfCode < this.options.minFunctionSize) {
        continue;
      }
      
      // Check if isolated
      if (metrics.fanIn === 0 && metrics.fanOut === 0 && !func.isExported) {
        patterns.push({
          type: 'isolated',
          severity: 'low',
          functionId: func.id,
          functionName: func.name,
          filePath: func.filePath,
          description: 'Function is completely isolated with no callers or callees',
          details: {
            linesOfCode: func.metrics.linesOfCode,
            isExported: func.isExported,
            hasTests: func.filePath.includes('test') || func.filePath.includes('spec'),
          },
          score: 40,
        });
      }
    }
    
    return patterns;
  }

  /**
   * Group call edges by calling function
   */
  private groupCallEdgesByFunction(callEdges: CallEdge[]): Map<string, CallEdge[]> {
    const map = new Map<string, CallEdge[]>();
    
    for (const edge of callEdges) {
      const existing = map.get(edge.callerFunctionId) || [];
      existing.push(edge);
      map.set(edge.callerFunctionId, existing);
    }
    
    return map;
  }

  /**
   * Group functions by file
   */
  private groupFunctionsByFile(functions: FunctionInfo[]): Map<string, FunctionInfo[]> {
    const map = new Map<string, FunctionInfo[]>();
    
    for (const func of functions) {
      const existing = map.get(func.filePath) || [];
      existing.push(func);
      map.set(func.filePath, existing);
    }
    
    return map;
  }

  /**
   * Check if return types are compatible
   */
  private areReturnTypesCompatible(type1: string, type2: string): boolean {
    // Simple check - could be enhanced
    return type1 === type2 || 
           type1 === 'any' || 
           type2 === 'any' ||
           (type1.includes('Promise') && type2.includes('Promise'));
  }

  /**
   * Calculate risk summary
   */
  private calculateSummary(patterns: RiskPattern[]): RiskAnalysisResult['summary'] {
    const severityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    
    for (const pattern of patterns) {
      severityCounts[pattern.severity]++;
    }
    
    // Calculate overall risk score (weighted by severity)
    const weightedScore = 
      severityCounts.critical * 100 +
      severityCounts.high * 75 +
      severityCounts.medium * 50 +
      severityCounts.low * 25;
    
    const maxPossibleScore = patterns.length * 100;
    const riskScore = maxPossibleScore > 0 ? 
      Math.round((weightedScore / maxPossibleScore) * 100) : 0;
    
    return {
      totalRisks: patterns.length,
      criticalRisks: severityCounts.critical,
      highRisks: severityCounts.high,
      mediumRisks: severityCounts.medium,
      lowRisks: severityCounts.low,
      riskScore,
    };
  }

  /**
   * Generate recommendations based on detected patterns
   */
  private generateRecommendations(
    patterns: RiskPattern[],
    summary: RiskAnalysisResult['summary']
  ): string[] {
    const recommendations: string[] = [];
    
    // Check for wrapper functions
    const wrapperCount = patterns.filter(p => p.type === 'wrapper').length;
    if (wrapperCount > 5) {
      recommendations.push(
        `Consider removing ${wrapperCount} wrapper functions that add no value`
      );
    }
    
    // Check for fake splits
    const fakeSplitCount = patterns.filter(p => p.type === 'fake-split').length;
    if (fakeSplitCount > 0) {
      recommendations.push(
        `Review ${fakeSplitCount} functions that appear to be artificially split`
      );
    }
    
    // Check for complexity hotspots
    const complexityCount = patterns.filter(p => p.type === 'complexity-hotspot').length;
    if (complexityCount > 0) {
      recommendations.push(
        `Refactor ${complexityCount} high-complexity functions to improve maintainability`
      );
    }
    
    // Overall risk level
    if (summary.riskScore > 70) {
      recommendations.push(
        'High overall risk score - prioritize refactoring critical and high-risk patterns'
      );
    } else if (summary.riskScore > 40) {
      recommendations.push(
        'Moderate risk level - consider addressing high-risk patterns in next refactoring cycle'
      );
    }
    
    return recommendations;
  }
}