import { FunctionInfo, SimilarityDetector, SimilarityOptions, SimilarityResult, ConsensusStrategy, SimilarFunction } from '../types';
import { ASTSimilarityDetector } from './ast-similarity-detector';

export class SimilarityManager {
  private detectors: Map<string, SimilarityDetector> = new Map();

  constructor() {
    // Register default detectors
    this.registerDetector(new ASTSimilarityDetector());
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
    const detectorsToUse = enabledDetectors.length > 0
      ? enabledDetectors.filter(name => this.detectors.has(name))
      : Array.from(this.detectors.keys());

    if (detectorsToUse.length === 0) {
      throw new Error('No similarity detectors available');
    }

    // Run all detectors in parallel
    const allResults = await Promise.all(
      detectorsToUse.map(async detectorName => {
        const detector = this.detectors.get(detectorName)!;
        if (await detector.isAvailable()) {
          return detector.detect(functions, options);
        }
        return [];
      })
    );

    // Flatten results
    const flatResults = allResults.flat();

    // Apply consensus strategy if multiple detectors
    if (detectorsToUse.length > 1 && consensus) {
      return this.applyConsensus(flatResults, consensus);
    }

    return flatResults;
  }

  private applyConsensus(results: SimilarityResult[], strategy: ConsensusStrategy): SimilarityResult[] {
    switch (strategy.strategy) {
      case 'majority':
        return this.majorityConsensus(results, strategy.threshold || 0.5);
      
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

  private majorityConsensus(results: SimilarityResult[], threshold: number): SimilarityResult[] {
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
    const totalDetectors = this.detectors.size;

    for (const [, entry] of pairCounts) {
      if (entry.count / totalDetectors >= threshold) {
        // Average the similarity scores
        const avgSimilarity = entry.results.reduce((sum, r) => sum + r.similarity, 0) / entry.results.length;
        
        consensusResults.push({
          ...entry.results[0],
          similarity: avgSimilarity,
          detector: 'consensus-majority',
          metadata: {
            ...entry.results[0].metadata,
            detectorCount: entry.count,
            detectors: entry.results.map(r => r.detector)
          }
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
        const avgSimilarity = matchingResults.reduce((sum, r) => sum + r.similarity, 0) / matchingResults.length;
        
        consensusResults.push({
          ...matchingResults[0],
          similarity: avgSimilarity,
          detector: 'consensus-intersection',
          metadata: {
            ...matchingResults[0].metadata,
            detectorCount: matchingResults.length,
            detectors: matchingResults.map(r => r.detector)
          }
        });
      }
    }

    return consensusResults;
  }

  private weightedConsensus(results: SimilarityResult[], weightings: Record<string, number>): SimilarityResult[] {
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
            weights: weightings
          }
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

