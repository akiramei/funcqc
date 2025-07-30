import {
  FunctionInfo,
  SimilarityDetector,
  SimilarityOptions,
  SimilarityResult,
  ConsensusStrategy,
  SimilarFunction,
  SimilarityWeights,
} from '../types';
import { ASTSimilarityDetector } from './ast-similarity-detector';
import { ANNSimilarityDetector } from './ann-similarity-detector';
import { HashSimilarityDetector } from './hash-similarity-detector';
import { AdvancedSimilarityDetector } from './advanced-similarity-detector';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';

export class SimilarityManager {
  private detectors: Map<string, SimilarityDetector> = new Map();

  constructor(weights?: SimilarityWeights, storage?: PGLiteStorageAdapter, similarityOptions?: SimilarityOptions) {
    // Register detectors in priority order:
    // 1. AST detector as primary (reliable for move detection)
    this.registerDetector(new ASTSimilarityDetector(weights));

    // 2. ANN detector for semantic similarity (if storage available)
    if (storage) {
      this.registerDetector(new ANNSimilarityDetector(storage));
    }

    // 3. Hash detector for basic exact/near matches (O(n))
    this.registerDetector(new HashSimilarityDetector());

    // 4. Advanced detector with AST canonicalization (experimental)
    this.registerDetector(new AdvancedSimilarityDetector(similarityOptions));
  }

  registerDetector(detector: SimilarityDetector): void {
    this.detectors.set(detector.name, detector);
  }

  async detectSimilarities(
    functions: FunctionInfo[],
    options: SimilarityOptions = {},
    enabledDetectors: string[] = [],
    consensus?: ConsensusStrategy
  ): Promise<SimilarityResult[]> {
    // If specific detectors are requested, use those
    if (enabledDetectors.length > 0) {
      return this.runSpecificDetectors(functions, options, enabledDetectors, consensus);
    }

    // Otherwise, use priority-based detection for optimal performance
    return this.runPriorityBasedDetection(functions, options);
  }

  private async runSpecificDetectors(
    functions: FunctionInfo[],
    options: SimilarityOptions,
    enabledDetectors: string[],
    consensus?: ConsensusStrategy
  ): Promise<SimilarityResult[]> {
    const presentDetectors = enabledDetectors.filter(name => this.detectors.has(name));

    if (presentDetectors.length === 0) {
      throw new Error('No specified detectors available');
    }

    // Track actually executed detectors for consensus calculation
    const actuallyExecuted: string[] = [];
    const allResults: SimilarityResult[] = [];

    // Run specified detectors in parallel
    const detectorPromises = presentDetectors.map(async detectorName => {
      try {
        const detector = this.detectors.get(detectorName)!;
        const isAvailable = await detector.isAvailable();
        if (isAvailable) {
          const results = await detector.detect(functions, options);
          actuallyExecuted.push(detectorName);
          return results;
        } else {
          return [];
        }
      } catch {
        return [];
      }
    });

    const detectorResults = await Promise.all(detectorPromises);
    allResults.push(...detectorResults.flat());

    // Apply consensus strategy using only actually executed detectors
    if (actuallyExecuted.length > 1 && consensus) {
      return this.applyConsensus(allResults, consensus, actuallyExecuted.length);
    }

    return this.dedupeResults(allResults);
  }

  private async runPriorityBasedDetection(
    functions: FunctionInfo[],
    options: SimilarityOptions
  ): Promise<SimilarityResult[]> {
    const count = functions.length;

    if (count < 100) {
      // Small scale: Progressive deepening with quality gates
      return this.runProgressiveDeepening(functions, options, 'small');
    } else if (count < 1000) {
      // Medium scale: Balanced approach with parallel stages
      return this.runProgressiveDeepening(functions, options, 'medium');
    } else {
      // Large scale: Performance-focused with limited stages
      return this.runProgressiveDeepening(functions, options, 'large');
    }
  }

  /**
   * Progressive deepening: try fast detectors first, deepen only if needed
   */
  private async runProgressiveDeepening(
    functions: FunctionInfo[],
    options: SimilarityOptions,
    scale: 'small' | 'medium' | 'large'
  ): Promise<SimilarityResult[]> {
    const count = functions.length;
    
    // Stage 1: Fast detectors (hash)
    const stage1 = await this.runStageParallel(['hash-duplicate'], functions, options, 10000);

    if (this.meetsExitCriteria(stage1, count, scale, 1)) {
      return stage1;
    }

    // Stage 2: Medium-cost detectors (AST)
    const stage2 = await this.runStageParallel(['ast-structural'], functions, options, 
      scale === 'small' ? 30000 : scale === 'medium' ? 60000 : 120000);
    const merged12 = this.mergeAndDedupeResults(stage1, stage2);

    if (this.meetsExitCriteria(merged12, count, scale, 2)) {
      return merged12;
    }

    // Stage 3: Expensive detectors (Advanced) - only for small/medium scale
    if (scale !== 'large') {
      const stage3 = await this.runStageParallel(['advanced-structural'], functions, options,
        scale === 'small' ? 60000 : 120000);
      const merged123 = this.mergeAndDedupeResults(merged12, stage3);
      return merged123;
    }

    return merged12;
  }

  /**
   * Run stage with limited parallelism (max 2 detectors)
   */
  private async runStageParallel(
    detectorNames: string[],
    functions: FunctionInfo[],
    options: SimilarityOptions,
    timeoutMs: number
  ): Promise<SimilarityResult[]> {
    const availableDetectors = await this.getAvailableDetectorInstances(detectorNames);
    if (availableDetectors.length === 0) return [];

    // Limit parallelism to prevent resource exhaustion
    const limitedDetectors = availableDetectors.slice(0, 2);
    
    const tasks = limitedDetectors.map(detector => 
      this.runDetectorWithTimeout(detector, functions, options, timeoutMs)
    );

    const results = await Promise.allSettled(tasks);
    const successfulResults: SimilarityResult[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        successfulResults.push(...result.value);
      }
    }

    return this.dedupeResults(successfulResults);
  }

  /**
   * Get available detector instances from names
   */
  private async getAvailableDetectorInstances(names: string[]): Promise<SimilarityDetector[]> {
    const available: SimilarityDetector[] = [];
    
    for (const name of names) {
      const detector = this.detectors.get(name);
      if (detector) {
        try {
          if (await detector.isAvailable()) {
            available.push(detector);
          }
        } catch (error) {
          console.warn(`Detector ${name} availability check failed:`, error);
        }
      }
    }
    
    return available;
  }

  /**
   * Check if results meet exit criteria for current stage
   */
  private meetsExitCriteria(
    results: SimilarityResult[],
    totalFunctions: number,
    scale: 'small' | 'medium' | 'large',
    stage: number
  ): boolean {
    const resultCount = results.length;
    const coverage = this.calculateCoverage(results, totalFunctions);

    switch (scale) {
      case 'small':
        // Small scale: be thorough
        return stage === 1 && resultCount >= 20 && coverage >= 0.1;
      case 'medium':  
        // Medium scale: balance speed and coverage
        return (stage === 1 && resultCount >= 30 && coverage >= 0.05) ||
               (stage === 2 && resultCount >= 50);
      case 'large':
        // Large scale: prioritize speed
        return (stage === 1 && resultCount >= 50 && coverage >= 0.02) ||
               (stage === 2 && resultCount >= 100);
      default:
        return false;
    }
  }

  /**
   * Calculate coverage: what fraction of functions are involved in similarity results
   */
  private calculateCoverage(results: SimilarityResult[], totalFunctions: number): number {
    if (totalFunctions === 0) return 0;
    
    const involvedFunctions = new Set<string>();
    for (const result of results) {
      for (const func of result.functions) {
        involvedFunctions.add(func.functionId);
      }
    }
    
    return involvedFunctions.size / totalFunctions;
  }

  /**
   * Merge and deduplicate results from multiple stages
   */
  private mergeAndDedupeResults(...resultArrays: SimilarityResult[][]): SimilarityResult[] {
    const allResults = resultArrays.flat();
    return this.dedupeResults(allResults);
  }

  /**
   * Deduplicate results by function pair
   */
  private dedupeResults(results: SimilarityResult[]): SimilarityResult[] {
    const bestResults = new Map<string, SimilarityResult>();
    const detectorPriority = new Map([
      ['ast-structural', 3],
      ['advanced-structural', 3], 
      ['hash-duplicate', 1]
    ]);

    for (const result of results) {
      const key = this.getPairKey(result.functions);
      const existing = bestResults.get(key);
      
      if (!existing) {
        bestResults.set(key, result);
        continue;
      }

      // Keep result with higher similarity, or higher detector priority if tied
      const shouldReplace = 
        result.similarity > existing.similarity ||
        (result.similarity === existing.similarity && 
         (detectorPriority.get(result.detector) || 0) > (detectorPriority.get(existing.detector) || 0));
      
      if (shouldReplace) {
        bestResults.set(key, result);
      }
    }

    return Array.from(bestResults.values());
  }


  /**
   * Run detector with timeout and graceful cancellation
   */
  private async runDetectorWithTimeout(
    detector: SimilarityDetector,
    functions: FunctionInfo[],
    options: SimilarityOptions,
    timeoutMs: number
  ): Promise<SimilarityResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Detector ${detector.name} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      // Pass AbortSignal to detector (if supported)
      const results = await detector.detect(functions, options, controller.signal);
      return results;
    } catch (error) {
      // Re-throw timeout errors with context
      if (controller.signal.aborted) {
        throw new Error(`Detector ${detector.name} was cancelled after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private applyConsensus(
    results: SimilarityResult[],
    strategy: ConsensusStrategy,
    detectorCount?: number
  ): SimilarityResult[] {
    switch (strategy.strategy) {
      case 'majority':
        return this.majorityConsensus(results, strategy.threshold || 0.5, detectorCount);

      case 'intersection':
        return this.intersectionConsensus(results);

      case 'union':
        return results;

      case 'weighted':
        return this.weightedConsensus(results, strategy.weightings || {});

      default:
        return results;
    }
  }

  private majorityConsensus(
    results: SimilarityResult[],
    threshold: number,
    detectorCount?: number
  ): SimilarityResult[] {
    // Group results by function pairs
    const pairCounts = new Map<string, { count: number; results: SimilarityResult[] }>();

    for (const result of results) {
      const key = this.getPairKey(result.functions);
      if (!pairCounts.has(key)) {
        pairCounts.set(key, { count: 0, results: [] });
      }
      const entry = pairCounts.get(key)!;
      entry.count++;
      entry.results.push(result);
    }

    // Filter by majority threshold
    const consensusResults: SimilarityResult[] = [];
    const totalDetectors = detectorCount || this.detectors.size;

    for (const [, entry] of pairCounts) {
      if (entry.count / totalDetectors >= threshold) {
        // Average the similarity scores
        const avgSimilarity =
          entry.results.reduce((sum, r) => sum + r.similarity, 0) / entry.results.length;

        consensusResults.push({
          ...entry.results[0],
          similarity: avgSimilarity,
          detector: 'consensus-majority',
          metadata: {
            ...entry.results[0].metadata,
            detectorCount: entry.count,
            detectors: entry.results.map(r => r.detector),
          },
        });
      }
    }

    return consensusResults;
  }

  private intersectionConsensus(results: SimilarityResult[]): SimilarityResult[] {
    // Only include pairs detected by all detectors
    const pairsByDetector = new Map<string, Set<string>>();

    for (const result of results) {
      const detector = result.detector;
      if (!pairsByDetector.has(detector)) {
        pairsByDetector.set(detector, new Set());
      }
      pairsByDetector.get(detector)!.add(this.getPairKey(result.functions));
    }

    // Find intersection
    const allPairs = Array.from(pairsByDetector.values());
    if (allPairs.length === 0) return [];

    const intersection = allPairs.reduce((acc, curr) => {
      return new Set(Array.from(acc).filter(x => curr.has(x)));
    });

    // Build consensus results
    const consensusResults: SimilarityResult[] = [];
    for (const pairKey of intersection) {
      const matchingResults = results.filter(r => this.getPairKey(r.functions) === pairKey);
      if (matchingResults.length > 0) {
        const avgSimilarity =
          matchingResults.reduce((sum, r) => sum + r.similarity, 0) / matchingResults.length;

        consensusResults.push({
          ...matchingResults[0],
          similarity: avgSimilarity,
          detector: 'consensus-intersection',
          metadata: {
            ...matchingResults[0].metadata,
            detectorCount: matchingResults.length,
            detectors: matchingResults.map(r => r.detector),
          },
        });
      }
    }

    return consensusResults;
  }

  private weightedConsensus(
    results: SimilarityResult[],
    weightings: Record<string, number>
  ): SimilarityResult[] {
    // Group results by function pairs
    const pairGroups = new Map<string, SimilarityResult[]>();

    for (const result of results) {
      const key = this.getPairKey(result.functions);
      if (!pairGroups.has(key)) {
        pairGroups.set(key, []);
      }
      pairGroups.get(key)!.push(result);
    }

    // Calculate weighted scores
    const consensusResults: SimilarityResult[] = [];

    for (const [, group] of pairGroups) {
      let weightedSum = 0;
      let totalWeight = 0;

      for (const result of group) {
        const weight = weightings[result.detector] || 1;
        weightedSum += result.similarity * weight;
        totalWeight += weight;
      }

      if (totalWeight > 0) {
        const weightedSimilarity = weightedSum / totalWeight;

        consensusResults.push({
          ...group[0],
          similarity: weightedSimilarity,
          detector: 'consensus-weighted',
          metadata: {
            ...group[0].metadata,
            detectorCount: group.length,
            detectors: group.map(r => r.detector),
            weights: weightings,
          },
        });
      }
    }

    return consensusResults;
  }

  private getPairKey(functions: SimilarFunction[]): string {
    return functions
      .map(f => f.functionId)
      .sort()
      .join('|');
  }

  getAvailableDetectors(): string[] {
    return Array.from(this.detectors.keys());
  }
}
