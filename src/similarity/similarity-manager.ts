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

  constructor(weights?: SimilarityWeights, storage?: PGLiteStorageAdapter) {
    // Register detectors in priority order:
    // 1. Advanced detector with AST canonicalization, Merkle hashing, and SimHash (O(n))
    this.registerDetector(new AdvancedSimilarityDetector());

    // 2. ANN detector for semantic similarity (if storage available)
    if (storage) {
      this.registerDetector(new ANNSimilarityDetector(storage));
    }

    // 3. Hash detector for basic exact/near matches (O(n))
    this.registerDetector(new HashSimilarityDetector());

    // 4. AST detector as comprehensive fallback (O(n²))
    this.registerDetector(new ASTSimilarityDetector(weights));
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
    const detectorsToUse = enabledDetectors.filter(name => this.detectors.has(name));

    if (detectorsToUse.length === 0) {
      throw new Error('No specified detectors available');
    }

    // Run specified detectors in parallel
    const allResults = await Promise.all(
      detectorsToUse.map(async detectorName => {
        try {
          const detector = this.detectors.get(detectorName)!;
          const isAvailable = await detector.isAvailable();
          if (isAvailable) {
            return await detector.detect(functions, options);
          }
          return [];
        } catch (error) {
          console.warn(`Detector ${detectorName} failed:`, error);
          return [];
        }
      })
    );

    const flatResults = allResults.flat();

    // Apply consensus strategy if multiple detectors
    if (detectorsToUse.length > 1 && consensus) {
      return this.applyConsensus(flatResults, consensus, detectorsToUse.length);
    }

    return flatResults;
  }

  private async runPriorityBasedDetection(
    functions: FunctionInfo[],
    options: SimilarityOptions
  ): Promise<SimilarityResult[]> {
    // Try detectors in priority order (registered order)
    // Stop at first successful detector to maximize performance
    for (const [detectorName, detector] of this.detectors) {
      try {
        const isAvailable = await detector.isAvailable();
        if (isAvailable) {
          console.log(`Using detector: ${detectorName}`);

          // Suggest performance optimization if using slower detector
          if (detectorName === 'ast-structural') {
            console.log(
              '💡 Tip: For faster results, consider using "funcqc vectorize" to enable semantic search'
            );
          } else if (detectorName === 'advanced-structural') {
            console.log(
              '🚀 Using advanced similarity detection with AST canonicalization and SimHash'
            );
          }
          const results = await detector.detect(functions, options);

          // If we get good results, return them
          if (results.length > 0) {
            return results;
          }

          // For high-performance detectors (hash), continue to next detector
          // For slower detectors, return empty results to avoid performance issues
          if (detectorName !== 'hash-duplicate') {
            return results;
          }
        }
      } catch (error) {
        console.warn(`Detector ${detectorName} failed:`, error);
        continue;
      }
    }

    return [];
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
