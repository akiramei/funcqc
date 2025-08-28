/**
 * Behavioral Fingerprint Analyzer
 * 
 * Analyzes behavioral patterns of functions to identify functional similarity
 * and clustering opportunities. This includes:
 * - Call pattern analysis (what functions does a function call)
 * - Usage pattern analysis (what functions call this function)
 * - Behavioral clustering (functions with similar interaction patterns)
 * - Role-based grouping (functions serving similar purposes)
 */

import type { 
  StorageQueryInterface
} from './types';

import { 
  CrossTypeAnalyzer, 
  type CrossTypeAnalysisOptions,
  type CrossTypePattern
} from './cross-type-analyzer';

export interface BehavioralFingerprintOptions extends CrossTypeAnalysisOptions {
  includeCallsOut: boolean;     // Include functions this function calls
  includeCallsIn: boolean;      // Include functions that call this function
  minCallFrequency: number;     // Minimum call frequency to consider
  clusterSimilarityThreshold: number; // Threshold for behavioral clustering (0-1)
  maxFingerprintSize: number;   // Maximum size of behavioral fingerprint
  includeInternalCalls: boolean; // Include internal method calls
}

export interface FunctionBehavioralInfo {
  functionId: string;
  functionName: string;
  file: string;
  callsOut: string[];           // Functions this function calls
  callsIn: string[];            // Functions that call this function
  callFrequencies: Map<string, number>; // Call frequency distribution
  behavioralVector: number[];   // Numerical representation of behavior
}

export interface BehavioralCluster {
  id: string;
  clusterId: string;
  functions: string[];          // Function IDs in this cluster
  functionNames: string[];      // Function names for display
  commonBehaviors: string[];    // Shared behavioral patterns
  clusterSignature: string[];   // Distinctive behavioral signature
  roleDescription: string;      // Inferred role/purpose of this cluster
  similarity: number;           // Internal similarity score
  suggestedAction: string;
  impactScore: number;
  confidence: number;
}

export class BehavioralFingerprintAnalyzer extends CrossTypeAnalyzer {
  private behavioralOptions: BehavioralFingerprintOptions;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<BehavioralFingerprintOptions> = {}
  ) {
    super(storage, options);
    
    this.behavioralOptions = {
      ...this.options,
      includeCallsOut: options.includeCallsOut ?? true,
      includeCallsIn: options.includeCallsIn ?? true,
      minCallFrequency: options.minCallFrequency ?? 2,
      clusterSimilarityThreshold: options.clusterSimilarityThreshold ?? 0.7,
      maxFingerprintSize: options.maxFingerprintSize ?? 50,
      includeInternalCalls: options.includeInternalCalls ?? false
    };
  }

  /**
   * Analyze behavioral patterns and create function clusters
   */
  async analyze(snapshotId?: string): Promise<CrossTypePattern[]> {
    try {
      const behavioralInfo = await this.loadBehavioralInformation(snapshotId);
      
      if (behavioralInfo.length < 2) {
        return [];
      }

      const clusters = await this.performBehavioralClustering(behavioralInfo);
      const patterns = this.convertClustersToPatterns(clusters);
      
      return this.filterPatterns(patterns);
    } catch (error) {
      throw new Error(`Failed to analyze behavioral fingerprints: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load behavioral information for all functions
   */
  private async loadBehavioralInformation(snapshotId?: string): Promise<FunctionBehavioralInfo[]> {
    try {
      // Load functions
      const functionsQuery = snapshotId 
        ? `SELECT id, name, file_path FROM functions WHERE snapshot_id = $1`
        : `SELECT id, name, file_path FROM functions`;
        
      const functionsResult = await this.storage.query(functionsQuery, snapshotId ? [snapshotId] : []);
      
      // Load call edges
      const callEdgesQuery = snapshotId
        ? `SELECT caller_function_id, callee_function_id, callee_name FROM call_edges WHERE snapshot_id = $1`
        : `SELECT caller_function_id, callee_function_id, callee_name FROM call_edges`;
        
      const callEdgesResult = await this.storage.query(callEdgesQuery, snapshotId ? [snapshotId] : []);
      
      // Load internal call edges if enabled
      let internalCallEdgesResult: { rows: unknown[] } = { rows: [] };
      if (this.behavioralOptions.includeInternalCalls) {
        const internalCallEdgesQuery = snapshotId
          ? `SELECT caller_function_id, callee_function_id, callee_name FROM internal_call_edges WHERE snapshot_id = $1`
          : `SELECT caller_function_id, callee_function_id, callee_name FROM internal_call_edges`;
          
        internalCallEdgesResult = await this.storage.query(internalCallEdgesQuery, snapshotId ? [snapshotId] : []);
      }

      const functionMap = new Map<string, FunctionBehavioralInfo>();

      // Initialize function info
      for (const row of functionsResult.rows) {
        const r = row as Record<string, unknown>;
        const functionInfo: FunctionBehavioralInfo = {
          functionId: r['id'] as string,
          functionName: r['name'] as string,
          file: (r['file_path'] as string)?.replace(/\\/g, '/'),
          callsOut: [],
          callsIn: [],
          callFrequencies: new Map(),
          behavioralVector: []
        };
        functionMap.set(functionInfo.functionId, functionInfo);
      }

      // Process call edges
      const allCallEdges = [...callEdgesResult.rows, ...internalCallEdgesResult.rows];
      
      for (const row of allCallEdges) {
        const r = row as Record<string, unknown>;
        const callerId = r['caller_function_id'] as string;
        const calleeId = r['callee_function_id'] as string;
        const calleeName = r['callee_name'] as string;

        const caller = functionMap.get(callerId);
        const callee = functionMap.get(calleeId);

        if (caller && this.behavioralOptions.includeCallsOut) {
          caller.callsOut.push(calleeName);
          
          // Update frequency
          const currentFreq = caller.callFrequencies.get(calleeName) || 0;
          caller.callFrequencies.set(calleeName, currentFreq + 1);
        }

        if (callee && caller && this.behavioralOptions.includeCallsIn) {
          callee.callsIn.push(caller.functionName);
        }
      }

      // Filter out functions with insufficient call data
      const result = Array.from(functionMap.values())
        .filter(func => func.callsOut.length > 0 || func.callsIn.length > 0)
        .filter(func => {
          const totalCalls = Math.max(func.callsOut.length, func.callsIn.length);
          return totalCalls >= this.behavioralOptions.minCallFrequency;
        });

      // Generate behavioral vectors
      for (const func of result) {
        func.behavioralVector = this.generateBehavioralVector(func, result);
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to load behavioral information: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a numerical behavioral vector for a function
   */
  private generateBehavioralVector(
    func: FunctionBehavioralInfo,
    allFunctions: FunctionBehavioralInfo[]
  ): number[] {
    // Create a vocabulary of all unique function names across all functions
    const vocabulary = new Set<string>();
    
    for (const f of allFunctions) {
      f.callsOut.forEach(call => vocabulary.add(call));
      f.callsIn.forEach(call => vocabulary.add(call));
    }

    const vocabArray = Array.from(vocabulary).sort();
    const vector: number[] = [];

    // Create TF-IDF style vector
    for (const term of vocabArray) {
      let termFrequency = 0;
      
      if (this.behavioralOptions.includeCallsOut) {
        termFrequency += func.callsOut.filter(call => call === term).length;
      }
      
      if (this.behavioralOptions.includeCallsIn) {
        termFrequency += func.callsIn.filter(call => call === term).length;
      }

      // Apply frequency normalization
      const maxFreq = Math.max(func.callsOut.length, func.callsIn.length);
      const normalizedTF = maxFreq > 0 ? termFrequency / maxFreq : 0;
      
      vector.push(normalizedTF);
    }

    // Limit vector size
    return vector.slice(0, this.behavioralOptions.maxFingerprintSize);
  }

  /**
   * Perform behavioral clustering using cosine similarity
   */
  private async performBehavioralClustering(
    behavioralFunctions: FunctionBehavioralInfo[]
  ): Promise<BehavioralCluster[]> {
    const clusters: BehavioralCluster[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < behavioralFunctions.length; i++) {
      const func1 = behavioralFunctions[i];
      
      if (processed.has(func1.functionId)) continue;

      const clusterFunctions: FunctionBehavioralInfo[] = [func1];
      processed.add(func1.functionId);

      // Find similar functions
      for (let j = i + 1; j < behavioralFunctions.length; j++) {
        const func2 = behavioralFunctions[j];
        
        if (processed.has(func2.functionId)) continue;

        const similarity = this.calculateCosineSimilarity(
          func1.behavioralVector,
          func2.behavioralVector
        );

        if (similarity >= this.behavioralOptions.clusterSimilarityThreshold) {
          clusterFunctions.push(func2);
          processed.add(func2.functionId);
        }
      }

      // Only create clusters with multiple functions
      if (clusterFunctions.length >= 2) {
        const cluster = this.createCluster(clusterFunctions);
        clusters.push(cluster);
      }
    }

    return clusters.sort((a, b) => b.impactScore - a.impactScore);
  }

  /**
   * Calculate cosine similarity between two behavioral vectors
   */
  private calculateCosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Create a behavioral cluster from a group of similar functions
   */
  private createCluster(functions: FunctionBehavioralInfo[]): BehavioralCluster {
    const functionIds = functions.map(f => f.functionId);
    const functionNames = functions.map(f => f.functionName);

    // Find common behaviors (functions called by most cluster members)
    const commonBehaviors = this.findCommonBehaviors(functions);
    
    // Create cluster signature (distinctive behaviors)
    const clusterSignature = this.createClusterSignature(functions, commonBehaviors);
    
    // Infer role from patterns
    const roleDescription = this.inferRole(functionNames, commonBehaviors);
    
    // Calculate internal similarity
    const similarity = this.calculateClusterSimilarity(functions);
    
    // Calculate impact score
    const impactScore = this.calculateClusterImpact(functions, commonBehaviors);

    return {
      id: `cluster_${functionIds[0]}_${functionIds.length}`,
      clusterId: `behavioral_${Math.random().toString(36).substr(2, 8)}`,
      functions: functionIds,
      functionNames: functionNames,
      commonBehaviors: commonBehaviors,
      clusterSignature: clusterSignature,
      roleDescription: roleDescription,
      similarity: similarity,
      suggestedAction: this.generateClusterAction(functionNames, roleDescription, commonBehaviors),
      impactScore: impactScore,
      confidence: Math.min(similarity + 0.2, 1.0)
    };
  }

  /**
   * Find behaviors common to most functions in the cluster
   */
  private findCommonBehaviors(functions: FunctionBehavioralInfo[]): string[] {
    const behaviorCounts = new Map<string, number>();
    const threshold = Math.ceil(functions.length * 0.6); // 60% of functions must share

    for (const func of functions) {
      const allBehaviors = [...func.callsOut, ...func.callsIn];
      const uniqueBehaviors = Array.from(new Set(allBehaviors));
      
      for (const behavior of uniqueBehaviors) {
        behaviorCounts.set(behavior, (behaviorCounts.get(behavior) || 0) + 1);
      }
    }

    return Array.from(behaviorCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([behavior, _]) => behavior)
      .sort();
  }

  /**
   * Create a distinctive signature for the cluster
   */
  private createClusterSignature(
    _functions: FunctionBehavioralInfo[], 
    commonBehaviors: string[]
  ): string[] {
    // Return the top distinctive patterns
    return commonBehaviors.slice(0, 10);
  }

  /**
   * Infer the role/purpose of a function cluster
   */
  private inferRole(functionNames: string[], commonBehaviors: string[]): string {
    const namePattern = this.analyzeNamePatterns(functionNames);
    const behaviorPattern = this.analyzeBehaviorPatterns(commonBehaviors);

    if (namePattern && behaviorPattern) {
      return `${namePattern} with ${behaviorPattern}`;
    } else if (namePattern) {
      return namePattern;
    } else if (behaviorPattern) {
      return behaviorPattern;
    } else {
      return `${functionNames.length} functions with similar behavior`;
    }
  }

  /**
   * Analyze naming patterns in function names
   */
  private analyzeNamePatterns(names: string[]): string | null {
    const patterns = [
      { pattern: /^get|fetch|load|read/i, description: 'data retrieval operations' },
      { pattern: /^set|save|store|write|update/i, description: 'data persistence operations' },
      { pattern: /^create|generate|build|make/i, description: 'object creation operations' },
      { pattern: /^delete|remove|clear|destroy/i, description: 'cleanup operations' },
      { pattern: /^validate|check|verify|ensure/i, description: 'validation operations' },
      { pattern: /^format|transform|convert|parse/i, description: 'data transformation operations' },
      { pattern: /^handle|process|execute|perform/i, description: 'processing operations' }
    ];

    for (const { pattern, description } of patterns) {
      const matchCount = names.filter(name => pattern.test(name)).length;
      if (matchCount >= Math.ceil(names.length * 0.5)) {
        return description;
      }
    }

    return null;
  }

  /**
   * Analyze behavior patterns in common behaviors
   */
  private analyzeBehaviorPatterns(behaviors: string[]): string | null {
    const patterns = [
      { keywords: ['query', 'select', 'find', 'search'], description: 'database query patterns' },
      { keywords: ['error', 'throw', 'catch', 'handle'], description: 'error handling patterns' },
      { keywords: ['log', 'debug', 'info', 'warn'], description: 'logging patterns' },
      { keywords: ['validate', 'check', 'verify'], description: 'validation patterns' },
      { keywords: ['parse', 'stringify', 'format'], description: 'data formatting patterns' }
    ];

    for (const { keywords, description } of patterns) {
      const matchCount = behaviors.filter(behavior => 
        keywords.some(keyword => behavior.toLowerCase().includes(keyword))
      ).length;
      
      if (matchCount >= 2) {
        return description;
      }
    }

    return null;
  }

  /**
   * Calculate internal similarity of a cluster
   */
  private calculateClusterSimilarity(functions: FunctionBehavioralInfo[]): number {
    if (functions.length < 2) return 1.0;

    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < functions.length; i++) {
      for (let j = i + 1; j < functions.length; j++) {
        const similarity = this.calculateCosineSimilarity(
          functions[i].behavioralVector,
          functions[j].behavioralVector
        );
        totalSimilarity += similarity;
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  /**
   * Calculate the impact score for a cluster
   */
  private calculateClusterImpact(
    functions: FunctionBehavioralInfo[], 
    commonBehaviors: string[]
  ): number {
    let score = 0;

    // Base score from cluster size
    score += functions.length * 10;

    // Bonus for shared behaviors
    score += commonBehaviors.length * 5;

    // Bonus for high internal similarity
    const avgSimilarity = this.calculateClusterSimilarity(functions);
    score += avgSimilarity * 20;

    // Bonus for functions from same file (higher refactoring potential)
    const fileGroups = new Set(functions.map(f => f.file));
    if (fileGroups.size === 1) {
      score += 15;
    } else if (fileGroups.size <= 3) {
      score += 10;
    }

    return Math.round(score);
  }

  /**
   * Generate suggested action for a cluster
   */
  private generateClusterAction(
    functionNames: string[], 
    roleDescription: string, 
    commonBehaviors: string[]
  ): string {
    const functionCount = functionNames.length;
    
    if (commonBehaviors.length >= 3) {
      return `Extract common interface: Create shared interface for ${functionCount} functions performing ${roleDescription}`;
    } else if (functionCount >= 5) {
      return `Consider module consolidation: ${functionCount} functions with similar behavior could be grouped into a dedicated module`;
    } else {
      return `Review functional similarity: ${functionCount} functions show behavioral patterns that suggest shared responsibility`;
    }
  }

  /**
   * Convert behavioral clusters to CrossTypePattern format
   */
  private convertClustersToPatterns(clusters: BehavioralCluster[]): CrossTypePattern[] {
    return clusters.map(cluster => ({
      id: cluster.id,
      pattern: cluster.clusterSignature,
      support: cluster.functions.length,
      confidence: cluster.confidence,
      lift: cluster.similarity,
      types: cluster.functions,
      suggestedAction: cluster.suggestedAction,
      impactScore: cluster.impactScore
    }));
  }

  /**
   * Get detailed behavioral clustering results (used by CLI)
   */
  async getDetailedResults(snapshotId?: string): Promise<BehavioralCluster[]> {
    try {
      const behavioralInfo = await this.loadBehavioralInformation(snapshotId);
      return await this.performBehavioralClustering(behavioralInfo);
    } catch (error) {
      throw new Error(`Failed to get detailed behavioral results: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get configuration specific to behavioral analysis
   */
  getBehavioralConfiguration(): BehavioralFingerprintOptions {
    return { ...this.behavioralOptions };
  }

  /**
   * Update behavioral-specific configuration
   */
  updateBehavioralConfiguration(newOptions: Partial<BehavioralFingerprintOptions>): void {
    this.behavioralOptions = { ...this.behavioralOptions, ...newOptions };
    this.updateConfiguration(newOptions);
  }
}
