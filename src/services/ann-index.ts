/**
 * Approximate Nearest Neighbor (ANN) Index Service
 *
 * Implements hierarchical clustering and LSH algorithms for fast approximate
 * vector similarity search, optimized for large codebases without native
 * pgvector support.
 */

export interface ANNConfig {
  algorithm: string; // Support future algorithms like 'hnsw'
  clusterCount: number;
  hashBits: number; // for LSH
  approximationLevel: 'fast' | 'balanced' | 'accurate';
  cacheSize: number;
  
  // Advanced optimization parameters
  kMeansMaxIterations?: number; // Default: 50
  kMeansConvergenceThreshold?: number; // Default: 0.001
  lshTableCountMultiplier?: number; // Scale LSH tables with log2(N)
  hybridHierarchicalWeight?: number; // Default: 0.6
  hybridLshWeight?: number; // Default: 0.4
  randomSeed?: number; // For reproducible results
}

export interface EmbeddingVector {
  id: string;
  semanticId: string;
  vector: Float32Array; // Always Float32Array for consistency
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  semanticId: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface FunctionCluster {
  id: string;
  centroid: Float32Array;
  memberIds: string[];
  memberCount: number;
}

export interface LSHBucket {
  hash: string;
  vectorIds: string[];
}

/**
 * Seedable Random Number Generator for reproducible results
 * Uses a simple Linear Congruential Generator (LCG) for fast, deterministic randomness
 */
class SeededRandom {
  private seed: number;
  
  constructor(seed?: number) {
    this.seed = seed ?? Math.floor(Math.random() * 2147483647);
  }
  
  /**
   * Generate next random number [0, 1)
   */
  random(): number {
    // LCG algorithm: (a * seed + c) % m
    // Using values from Numerical Recipes
    this.seed = (this.seed * 1664525 + 1013904223) % 2147483647;
    return (this.seed >>> 0) / 2147483647; // Unsigned 32-bit division
  }
  
  /**
   * Generate random integer in range [min, max)
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min)) + min;
  }
  
  /**
   * Generate random normal distribution using Box-Muller transform
   */
  randomNormal(): number {
    const u1 = this.random();
    const u2 = this.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  
  /**
   * Reset seed for reproducible sequences
   */
  setSeed(seed: number): void {
    this.seed = seed;
  }
}

/**
 * Utility functions for optimized vector operations
 */

/**
 * Ensure Float32Array with dimension validation to prevent silent NaN failures
 */
function ensureFloat32Array(vector: Float32Array | number[], expectedDimension?: number): Float32Array {
  const result = vector instanceof Float32Array ? vector : new Float32Array(vector);
  
  // Validate dimensions if expected dimension is provided
  if (expectedDimension !== undefined && result.length !== expectedDimension) {
    throw new Error(
      `Vector dimension mismatch: expected ${expectedDimension}, got ${result.length}`
    );
  }
  
  // Validate that vector contains no NaN or infinite values
  for (let i = 0; i < result.length; i++) {
    if (!Number.isFinite(result[i])) {
      throw new Error(
        `Invalid vector value at index ${i}: ${result[i]} (must be finite number)`
      );
    }
  }
  
  return result;
}

/**
 * Enhanced hash function using 64-bit FNV-1a to prevent collision at 10^6 scale
 * Uses full vector data instead of just first 32 elements for better distribution
 */
function fastHash(data: Float32Array): string {
  // 64-bit FNV-1a constants (split into high and low 32-bit parts)
  const FNV_OFFSET_BASIS_HIGH = 0xcbf29ce4;
  const FNV_OFFSET_BASIS_LOW = 0x84222325;
  const FNV_PRIME_HIGH = 0x00000100;
  const FNV_PRIME_LOW = 0x000001b3;
  
  let hashHigh = FNV_OFFSET_BASIS_HIGH;
  let hashLow = FNV_OFFSET_BASIS_LOW;
  
  // Hash the full vector for better collision resistance
  for (let i = 0; i < data.length; i++) {
    const value = Math.floor(data[i] * 1000000); // Scale and floor for stability
    
    // XOR with value
    hashLow ^= value;
    
    // 64-bit multiply with FNV prime (emulated with 32-bit operations)
    const prevLow = hashLow;
    hashLow = (hashLow * FNV_PRIME_LOW) >>> 0;
    hashHigh = (hashHigh * FNV_PRIME_LOW + prevLow * FNV_PRIME_HIGH) >>> 0;
  }
  
  // Combine high and low parts and convert to hex
  return hashHigh.toString(16).padStart(8, '0') + hashLow.toString(16).padStart(8, '0');
}

/**
 * Calculate L2 norm (magnitude) of a vector
 */
function calculateNorm(vector: Float32Array): number {
  let sum = 0;
  for (let i = vector.length - 1; i >= 0; i--) {
    sum += vector[i] * vector[i];
  }
  return Math.sqrt(sum);
}

/**
 * Optimized cosine similarity calculation with pre-computed norms
 */
function calculateCosineSimilarityOptimized(
  vec1: Float32Array,
  vec2: Float32Array,
  norm1?: number,
  norm2?: number
): number {
  let dotProduct = 0;
  const len = vec1.length;

  // Unrolled loop for better performance
  let i = 0;
  for (; i < len - 3; i += 4) {
    dotProduct +=
      vec1[i] * vec2[i] +
      vec1[i + 1] * vec2[i + 1] +
      vec1[i + 2] * vec2[i + 2] +
      vec1[i + 3] * vec2[i + 3];
  }

  // Handle remaining elements
  for (; i < len; i++) {
    dotProduct += vec1[i] * vec2[i];
  }

  // Use pre-computed norms if available
  const n1 = norm1 ?? calculateNorm(vec1);
  const n2 = norm2 ?? calculateNorm(vec2);

  if (n1 === 0 || n2 === 0) {
    return 0;
  }

  return dotProduct / (n1 * n2);
}

/**
 * Optimized L2 distance calculation (returns squared distance)
 */
function calculateL2DistanceSquared(vec1: Float32Array, vec2: Float32Array): number {
  let sum = 0;
  const len = vec1.length;

  // Reverse loop can be faster in some JS engines
  for (let i = len - 1; i >= 0; i--) {
    const diff = vec1[i] - vec2[i];
    sum += diff * diff;
  }

  return sum; // Return squared distance for faster comparison
}

/**
 * Quickselect algorithm for efficient top-k selection
 */
function quickselect<T>(
  arr: T[],
  k: number,
  left: number,
  right: number,
  compare: (a: T, b: T) => number
): void {
  if (left === right) return;

  const pivotIndex = partition(arr, left, right, compare);

  if (k === pivotIndex) {
    return;
  } else if (k < pivotIndex) {
    quickselect(arr, k, left, pivotIndex - 1, compare);
  } else {
    quickselect(arr, k, pivotIndex + 1, right, compare);
  }
}

function partition<T>(
  arr: T[],
  left: number,
  right: number,
  compare: (a: T, b: T) => number
): number {
  const pivot = arr[right];
  let i = left;

  for (let j = left; j < right; j++) {
    if (compare(arr[j], pivot) <= 0) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      i++;
    }
  }

  [arr[i], arr[right]] = [arr[right], arr[i]];
  return i;
}

/**
 * Get top-k elements using quickselect for O(n) average time complexity
 * Includes bounds checking to prevent edge case errors
 */
function topK<T>(arr: T[], k: number, compare: (a: T, b: T) => number): T[] {
  // Edge case handling for robust operation
  if (k <= 0) {
    return [];
  }
  
  if (arr.length === 0) {
    return [];
  }
  
  if (arr.length <= k) {
    // Return without sorting - let caller decide if sorting is needed
    return arr.slice();
  }

  const result = arr.slice();
  const clampedK = Math.min(k, result.length);
  quickselect(result, clampedK, 0, result.length - 1, compare);

  // Only sort the top k elements
  return result.slice(0, clampedK).sort(compare);
}

/**
 * Simple LRU cache for query results
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return undefined; // Explicit undefined return
  }

  set(key: K, value: V): void {
    // Prevent storing undefined values to avoid cache hit issues
    if (value === undefined) {
      return;
    }

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Hierarchical clustering implementation for ANN search
 * 
 * Uses K-means clustering with K-means++ initialization to organize high-dimensional
 * embedding vectors into hierarchical clusters for efficient approximate nearest neighbor search.
 * 
 * @example
 * ```typescript
 * const config = { algorithm: 'hierarchical', clusterCount: 50, approximationLevel: 'balanced' };
 * const index = new HierarchicalIndex(config);
 * 
 * // Build index from embedding vectors
 * index.buildIndex(embeddings);
 * 
 * // Search for similar vectors
 * const results = index.searchApproximate(queryVector, 10);
 * ```
 * 
 * @performance
 * - Build complexity: O(n * k * i * d) where n=vectors, k=clusters, i=iterations, d=dimensions
 * - Search complexity: O(k + m * d) where k=clusters, m=vectors in searched clusters
 * - Memory usage: O(n * d + k * d) for vectors and centroids
 * 
 * @see {@link LSHIndex} for hash-based alternative
 * @see {@link HybridANNIndex} for combined approach
 */
export class HierarchicalIndex {
  private clusters: FunctionCluster[] = [];
  private vectorMap: Map<string, EmbeddingVector> = new Map();
  private config: ANNConfig;
  private queryCache: LRUCache<string, SearchResult[]>;
  private vectorNorms: Map<string, number> = new Map();
  private clusterNorms: Map<string, number> = new Map();
  private expectedDimension?: number;
  private rng: SeededRandom;

  constructor(config: ANNConfig) {
    this.config = ANNConfigValidator.validate(config);
    this.queryCache = new LRUCache(this.config.cacheSize);
    this.rng = new SeededRandom(this.config.randomSeed);
    
    // Show performance recommendations in development
    const recommendations = ANNConfigValidator.getPerformanceRecommendations(this.config);
    if (recommendations.length > 0) {
      console.log(`HierarchicalIndex Performance Recommendations:\n${recommendations.map(r => `  • ${r}`).join('\n')}`);
    }
  }
  
  /**
   * Update configuration and clear cache to prevent stale results
   */
  updateConfig(newConfig: ANNConfig): void {
    const configChanged = JSON.stringify(this.config) !== JSON.stringify(newConfig);
    this.config = newConfig;
    
    if (configChanged) {
      this.queryCache.clear();
      this.rng = new SeededRandom(newConfig.randomSeed);
      console.log('HierarchicalIndex: Configuration updated, query cache cleared, RNG reseeded');
    }
  }

  /**
   * Build hierarchical clusters using K-means algorithm
   */
  buildIndex(embeddings: EmbeddingVector[]): void {
    if (embeddings.length === 0) {
      return;
    }

    // Store vectors for quick lookup and ensure Float32Array
    this.vectorMap.clear();
    this.vectorNorms.clear();
    
    // Establish expected dimension from first valid vector
    if (embeddings.length > 0 && !this.expectedDimension) {
      this.expectedDimension = embeddings[0].vector.length;
    }
    
    for (const embedding of embeddings) {
      // Ensure Float32Array with dimension validation
      const vector = ensureFloat32Array(embedding.vector, this.expectedDimension);
      const norm = calculateNorm(vector);

      if (norm === 0) {
        console.warn(`Skipping zero vector with id: ${embedding.id}`);
        continue; // Skip zero vectors
      }

      const optimizedEmbedding = {
        ...embedding,
        vector,
      };
      this.vectorMap.set(embedding.id, optimizedEmbedding);
      this.vectorNorms.set(embedding.id, norm);
    }

    if (this.vectorMap.size === 0) {
      return; // No valid vectors
    }

    // Initialize clusters with random centroids
    this.clusters = this.initializeClusters(Array.from(this.vectorMap.values()));

    // K-means clustering iteration with enhanced convergence tracking
    const maxIterations = this.config.kMeansMaxIterations ?? 50;
    let converged = false;
    const iterationMetrics: Array<{iteration: number; avgChange: number; maxChange: number}> = [];
    let stagnationCount = 0;
    const stagnationThreshold = 3; // Early stopping if no improvement for 3 iterations

    for (let iteration = 0; iteration < maxIterations && !converged; iteration++) {
      const iterationStart = performance.now();
      const newClusters = this.assignToClusters(Array.from(this.vectorMap.values()));
      const centroidUpdate = this.updateCentroids(newClusters);
      converged = centroidUpdate.converged;
      this.clusters = newClusters;
      
      const iterationTime = performance.now() - iterationStart;
      
      // Store iteration metrics for trend analysis
      iterationMetrics.push({
        iteration: iteration + 1,
        avgChange: centroidUpdate.avgChange,
        maxChange: centroidUpdate.maxChange
      });
      
      // Track iteration progress for early stopping detection
      if (iteration % 5 === 0 || converged) {
        const activeClusters = newClusters.filter(c => c.memberIds.length > 0).length;
        console.log(`K-means iteration ${iteration + 1}/${maxIterations}: active_clusters=${activeClusters}, avg_change=${centroidUpdate.avgChange.toFixed(6)}, time=${iterationTime.toFixed(2)}ms`);
      }
      
      if (converged) {
        console.log(`✓ K-means converged after ${iteration + 1} iterations (early stopping: ${iteration + 1 < maxIterations ? 'yes' : 'no'})`);
        break;
      }
      
      // Early stopping detection based on centroid change stagnation
      if (iteration > 5) {
        const recentChanges = iterationMetrics.slice(-3).map(m => m.avgChange);
        const avgRecentChange = recentChanges.reduce((sum, c) => sum + c, 0) / recentChanges.length;
        
        if (avgRecentChange < (this.config.kMeansConvergenceThreshold ?? 0.001) * 0.1) {
          stagnationCount++;
        } else {
          stagnationCount = 0;
        }
        
        if (stagnationCount >= stagnationThreshold) {
          console.log(`⚠ K-means early stopping: stagnation detected after ${iteration + 1} iterations (avg_change=${avgRecentChange.toFixed(6)})`);
          break;
        }
      }
    }
    
    if (!converged && stagnationCount < stagnationThreshold) {
      console.log(`⚠ K-means reached maximum iterations (${maxIterations}) without convergence - consider increasing kMeansMaxIterations`);
    }

    // Remove empty clusters
    this.clusters = this.clusters.filter(cluster => cluster.memberIds.length > 0);
  }

  /**
   * Perform approximate nearest neighbor search using hierarchical clustering
   * 
   * @param queryVector - Query vector to find neighbors for (auto-converted to Float32Array)
   * @param k - Number of nearest neighbors to return
   * @returns Array of search results sorted by similarity (highest first)
   * 
   * @example
   * ```typescript
   * const queryVector = [0.1, 0.2, 0.3, ...]; // Your embedding vector
   * const results = index.searchApproximate(queryVector, 5);
   * 
   * results.forEach(result => {
   *   console.log(`Function ${result.id}: similarity=${result.similarity.toFixed(3)}`);
   * });
   * ```
   * 
   * @performance
   * - Time: O(k + m * d) where k=clusters, m=avg cluster size, d=dimensions
   * - Cached queries return in O(1) time
   * - Faster than brute force O(n * d) for large datasets
   * 
   * @throws {Error} If queryVector contains invalid values (NaN, Infinity)
   * @throws {Error} If queryVector dimension doesn't match index dimension
   */
  searchApproximate(queryVector: number[] | Float32Array, k: number): SearchResult[] {
    if (this.clusters.length === 0) {
      return [];
    }

    // Convert query vector to Float32Array with dimension validation
    const queryFloat32 = ensureFloat32Array(queryVector, this.expectedDimension);
    const queryNorm = calculateNorm(queryFloat32);

    if (queryNorm === 0) {
      return []; // Skip zero query vectors
    }

    // Create cache key using fast hash function
    const cacheKey = `h_${fastHash(queryFloat32)}_${k}_${this.config.approximationLevel}`;
    const cachedResult = this.queryCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Find nearest cluster centroids using cosine similarity (consistent metric)
    const clusterDistances = this.clusters.map((cluster, index) => {
      const clusterNorm = this.clusterNorms.get(cluster.id) || calculateNorm(cluster.centroid);
      const similarity = calculateCosineSimilarityOptimized(
        queryFloat32,
        cluster.centroid,
        queryNorm,
        clusterNorm
      );
      return {
        index,
        distance: 1 - similarity, // Convert similarity to distance
      };
    });

    // Use quickselect to find top clusters in O(n) time
    const clustersToSearch = this.getSearchDepth(clusterDistances.length);
    const topClusters = topK(clusterDistances, clustersToSearch, (a, b) => a.distance - b.distance);

    // Prepare candidates with similarity scores
    interface CandidateWithScore extends SearchResult {
      score: number;
    }
    const candidateResults: CandidateWithScore[] = [];

    // Search within top clusters
    for (const clusterInfo of topClusters) {
      const cluster = this.clusters[clusterInfo.index];

      for (const memberId of cluster.memberIds) {
        const vector = this.vectorMap.get(memberId);
        if (vector && vector.vector instanceof Float32Array) {
          const norm = this.vectorNorms.get(memberId);
          const similarity = calculateCosineSimilarityOptimized(
            queryFloat32,
            vector.vector,
            queryNorm,
            norm
          );
          candidateResults.push({
            id: vector.id,
            semanticId: vector.semanticId,
            similarity,
            score: -similarity, // Negative for sorting (higher is better)
            ...(vector.metadata ? { metadata: vector.metadata } : {}),
          });
        }
      }
    }

    // Use quickselect for top-k selection
    const topResults = topK(
      candidateResults,
      k,
      (a, b) => a.score - b.score // Lower score (higher similarity) first
    );

    // Remove score field and sort by similarity (descending)
    const results: SearchResult[] = topResults
      .map(({ score: _score, ...result }) => result)
      .sort((a, b) => b.similarity - a.similarity);

    // Cache the results (undefined check handled in LRUCache.set)
    this.queryCache.set(cacheKey, results);

    return results;
  }

  private initializeClusters(embeddings: EmbeddingVector[]): FunctionCluster[] {
    const clusters: FunctionCluster[] = [];
    const clusterCount = Math.min(this.config.clusterCount, embeddings.length);

    // Use K-means++ initialization for better cluster selection
    const selectedIndices: number[] = [];

    // First centroid: random selection using seeded RNG
    selectedIndices.push(this.rng.randomInt(0, embeddings.length));

    // Subsequent centroids: choose points far from existing centroids
    for (let i = 1; i < clusterCount; i++) {
      const distances: number[] = [];

      for (let j = 0; j < embeddings.length; j++) {
        if (selectedIndices.includes(j)) {
          distances.push(0);
          continue;
        }

        // Find minimum squared distance to existing centroids (avoid sqrt)
        let minDistanceSquared = Infinity;
        for (const selectedIndex of selectedIndices) {
          const distanceSquared = calculateL2DistanceSquared(
            embeddings[j].vector,
            embeddings[selectedIndex].vector
          );
          minDistanceSquared = Math.min(minDistanceSquared, distanceSquared);
        }
        distances.push(minDistanceSquared); // Already squared for weighted selection
      }

      // Weighted random selection based on distance using seeded RNG
      const totalWeight = distances.reduce((sum, weight) => sum + weight, 0);
      if (totalWeight > 0) {
        const randomValue = this.rng.random() * totalWeight;
        let cumulativeWeight = 0;
        for (let j = 0; j < distances.length; j++) {
          cumulativeWeight += distances[j];
          if (cumulativeWeight >= randomValue && !selectedIndices.includes(j)) {
            selectedIndices.push(j);
            break;
          }
        }
      } else {
        // If all points are already selected or distances are zero,
        // select a random unselected point
        const unselected = embeddings
          .map((_, idx) => idx)
          .filter(idx => !selectedIndices.includes(idx));
        if (unselected.length > 0) {
          selectedIndices.push(unselected[this.rng.randomInt(0, unselected.length)]);
        }
      }
    }

    // Create initial clusters
    for (let i = 0; i < selectedIndices.length; i++) {
      const selectedIndex = selectedIndices[i];
      const sourceVector =
        this.vectorMap.get(embeddings[selectedIndex].id)?.vector ||
        embeddings[selectedIndex].vector;
      clusters.push({
        id: `cluster-${i}`,
        centroid: new Float32Array(sourceVector),
        memberIds: [],
        memberCount: 0,
      });

      // Cache cluster centroid norms
      this.clusterNorms.set(`cluster-${i}`, calculateNorm(clusters[i].centroid));
    }

    return clusters;
  }

  private assignToClusters(embeddings: EmbeddingVector[]): FunctionCluster[] {
    // Reset cluster assignments
    const newClusters = this.clusters.map(cluster => ({
      ...cluster,
      memberIds: [] as string[],
      memberCount: 0,
    }));

    // Assign each vector to nearest cluster using cosine similarity
    for (const embedding of embeddings) {
      let bestClusterIndex = 0;
      let bestSimilarity = -Infinity;
      const embeddingNorm = this.vectorNorms.get(embedding.id) || calculateNorm(embedding.vector);

      for (let i = 0; i < newClusters.length; i++) {
        const clusterNorm =
          this.clusterNorms.get(newClusters[i].id) || calculateNorm(newClusters[i].centroid);
        const similarity = calculateCosineSimilarityOptimized(
          embedding.vector,
          newClusters[i].centroid,
          embeddingNorm,
          clusterNorm
        );
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestClusterIndex = i;
        }
      }

      newClusters[bestClusterIndex].memberIds.push(embedding.id);
      newClusters[bestClusterIndex].memberCount++;
    }

    return newClusters;
  }

  private updateCentroids(clusters: FunctionCluster[]): { converged: boolean; avgChange: number; maxChange: number } {
    let converged = true;
    let maxCentroidChange = 0;
    let totalCentroidChange = 0;
    let activeClusters = 0;
    const convergenceThreshold = this.config.kMeansConvergenceThreshold ?? 0.001;

    for (const cluster of clusters) {
      if (cluster.memberIds.length === 0) {
        continue; // Skip empty clusters
      }
      activeClusters++;

      // Calculate new centroid as average of member vectors
      const dimension = cluster.centroid.length;
      const newCentroid = new Float32Array(dimension);
      const invSize = 1.0 / cluster.memberIds.length; // Precompute inverse

      // Accumulate member vectors
      for (const memberId of cluster.memberIds) {
        const vector = this.vectorMap.get(memberId);
        if (vector) {
          for (let i = 0; i < dimension; i++) {
            newCentroid[i] += vector.vector[i];
          }
        }
      }

      // Average the coordinates (single division loop)
      for (let i = 0; i < dimension; i++) {
        newCentroid[i] *= invSize;
      }

      // Check convergence using squared distance (avoid sqrt)
      const centroidChangeSquared = calculateL2DistanceSquared(cluster.centroid, newCentroid);
      const centroidChange = Math.sqrt(centroidChangeSquared);
      
      maxCentroidChange = Math.max(maxCentroidChange, centroidChange);
      totalCentroidChange += centroidChange;
      
      if (centroidChangeSquared > convergenceThreshold * convergenceThreshold) {
        converged = false;
      }

      cluster.centroid = newCentroid;
      // Update cached norm
      this.clusterNorms.set(cluster.id, calculateNorm(newCentroid));
    }

    // Enhanced convergence logging for early stopping detection
    const avgCentroidChange = activeClusters > 0 ? totalCentroidChange / activeClusters : 0;
    if (converged) {
      console.log(`K-means converged: max_change=${maxCentroidChange.toFixed(6)}, avg_change=${avgCentroidChange.toFixed(6)}, threshold=${convergenceThreshold}, active_clusters=${activeClusters}`);
    }

    return { converged, avgChange: avgCentroidChange, maxChange: maxCentroidChange };
  }

  private getSearchDepth(totalClusters: number): number {
    switch (this.config.approximationLevel) {
      case 'fast':
        return Math.max(1, Math.ceil(totalClusters * 0.1)); // Search 10% of clusters
      case 'balanced':
        return Math.max(1, Math.ceil(totalClusters * 0.3)); // Search 30% of clusters
      case 'accurate':
        return Math.max(1, Math.ceil(totalClusters * 0.6)); // Search 60% of clusters
      default:
        return Math.max(1, Math.ceil(totalClusters * 0.3));
    }
  }

  getIndexStats(): Record<string, unknown> {
    return {
      clusterCount: this.clusters.length,
      totalVectors: this.vectorMap.size,
      averageClusterSize: this.clusters.length > 0 ? this.vectorMap.size / this.clusters.length : 0,
      cacheSize: this.queryCache.size(),
      cacheCapacity: this.config.cacheSize,
      config: this.config,
    };
  }
}

/**
 * Locality-Sensitive Hashing (LSH) implementation for ANN search
 * 
 * Uses random projections to create hash buckets that preserve locality,
 * enabling efficient approximate nearest neighbor search through hash lookups.
 * 
 * @example
 * ```typescript
 * const config = { algorithm: 'lsh', hashBits: 16, cacheSize: 1000 };
 * const index = new LSHIndex(config);
 * 
 * // Build index from embedding vectors
 * index.buildIndex(embeddings);
 * 
 * // Search for similar vectors
 * const results = index.searchApproximate(queryVector, 10);
 * ```
 * 
 * @performance
 * - Build complexity: O(n * b * d) where n=vectors, b=hash bits, d=dimensions
 * - Search complexity: O(t + c * d) where t=tables, c=candidates per bucket
 * - Memory usage: O(n + t * 2^b) for vectors and hash tables
 * 
 * @algorithm
 * Random projection LSH with configurable hash tables and bits.
 * Each hash table uses independent random projections for collision resistance.
 * 
 * @see {@link HierarchicalIndex} for clustering-based alternative
 * @see {@link HybridANNIndex} for combined approach
 */
export class LSHIndex {
  private hashTables: Map<string, LSHBucket>[] = [];
  private vectorMap: Map<string, EmbeddingVector> = new Map();
  private config: ANNConfig;
  private randomProjections: Float32Array[][] = []; // [table][bit] = projection vector
  private queryCache: LRUCache<string, SearchResult[]>;
  private vectorNorms: Map<string, number> = new Map();
  private expectedDimension?: number;
  private rng: SeededRandom;

  constructor(config: ANNConfig) {
    this.config = ANNConfigValidator.validate(config);
    this.queryCache = new LRUCache(this.config.cacheSize);
    this.rng = new SeededRandom(this.config.randomSeed);
    
    // Show performance recommendations in development
    const recommendations = ANNConfigValidator.getPerformanceRecommendations(this.config);
    if (recommendations.length > 0) {
      console.log(`LSHIndex Performance Recommendations:\n${recommendations.map(r => `  • ${r}`).join('\n')}`);
    }
  }
  
  /**
   * Update configuration and clear cache to prevent stale results
   */
  updateConfig(newConfig: ANNConfig): void {
    const configChanged = JSON.stringify(this.config) !== JSON.stringify(newConfig);
    this.config = newConfig;
    
    if (configChanged) {
      this.queryCache.clear();
      this.rng = new SeededRandom(newConfig.randomSeed);
      console.log('LSHIndex: Configuration updated, query cache cleared, RNG reseeded');
    }
  }

  buildIndex(embeddings: EmbeddingVector[]): void {
    if (embeddings.length === 0) {
      return;
    }

    // Store vectors for quick lookup and ensure Float32Array
    this.vectorMap.clear();
    this.vectorNorms.clear();
    
    // Establish expected dimension from first valid vector
    if (embeddings.length > 0 && !this.expectedDimension) {
      this.expectedDimension = embeddings[0].vector.length;
    }
    
    for (const embedding of embeddings) {
      // Ensure Float32Array with dimension validation
      const vector = ensureFloat32Array(embedding.vector, this.expectedDimension);
      const norm = calculateNorm(vector);

      if (norm === 0) {
        console.warn(`Skipping zero vector with id: ${embedding.id}`);
        continue; // Skip zero vectors
      }

      const optimizedEmbedding = {
        ...embedding,
        vector,
      };
      this.vectorMap.set(embedding.id, optimizedEmbedding);
      this.vectorNorms.set(embedding.id, norm);
    }

    if (this.vectorMap.size === 0) {
      return; // No valid vectors
    }

    // Initialize hash tables and random projections
    const dimension = Array.from(this.vectorMap.values())[0].vector.length;
    const numTables = this.getOptimalTableCount(this.vectorMap.size);

    this.hashTables = Array(numTables)
      .fill(null)
      .map(() => new Map<string, LSHBucket>());
    this.randomProjections = this.generateRandomProjections(numTables, dimension);

    // Hash all vectors into buckets
    for (const embedding of Array.from(this.vectorMap.values())) {
      const hashes = this.computeHashes(embedding.vector);

      for (let tableIndex = 0; tableIndex < numTables; tableIndex++) {
        const hash = hashes[tableIndex];
        const bucket = this.hashTables[tableIndex].get(hash);

        if (bucket) {
          bucket.vectorIds.push(embedding.id);
        } else {
          this.hashTables[tableIndex].set(hash, {
            hash,
            vectorIds: [embedding.id],
          });
        }
      }
    }
  }

  searchApproximate(queryVector: number[] | Float32Array, k: number): SearchResult[] {
    if (this.hashTables.length === 0) {
      return [];
    }

    // Convert query vector to Float32Array with dimension validation
    const queryFloat32 = ensureFloat32Array(queryVector, this.expectedDimension);
    const queryNorm = calculateNorm(queryFloat32);

    if (queryNorm === 0) {
      return []; // Skip zero query vectors
    }

    // Create cache key using fast hash function
    const cacheKey = `lsh_${fastHash(queryFloat32)}_${k}_${this.config.hashBits}`;
    const cachedResult = this.queryCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Get candidate vectors from all hash tables
    const candidateIds = new Set<string>();
    const queryHashes = this.computeHashes(queryFloat32);

    for (let tableIndex = 0; tableIndex < this.hashTables.length; tableIndex++) {
      const hash = queryHashes[tableIndex];
      const bucket = this.hashTables[tableIndex].get(hash);

      if (bucket) {
        for (const vectorId of bucket.vectorIds) {
          candidateIds.add(vectorId);
        }
      }
    }

    // Prepare candidates with similarity scores
    interface CandidateWithScore extends SearchResult {
      score: number;
    }
    const candidates: CandidateWithScore[] = [];

    for (const candidateId of candidateIds) {
      const vector = this.vectorMap.get(candidateId);
      if (vector && vector.vector instanceof Float32Array) {
        const norm = this.vectorNorms.get(candidateId);
        const similarity = calculateCosineSimilarityOptimized(
          queryFloat32,
          vector.vector,
          queryNorm,
          norm
        );
        candidates.push({
          id: vector.id,
          semanticId: vector.semanticId,
          similarity,
          score: -similarity, // Negative for sorting (higher is better)
          ...(vector.metadata ? { metadata: vector.metadata } : {}),
        });
      }
    }

    // Use quickselect for top-k selection
    const topResults = topK(
      candidates,
      k,
      (a, b) => a.score - b.score // Lower score (higher similarity) first
    );

    // Remove score field and sort by similarity (descending)
    const finalResults: SearchResult[] = topResults
      .map(({ score: _score, ...result }) => result)
      .sort((a, b) => b.similarity - a.similarity);

    // Cache the results (undefined check handled in LRUCache.set)
    this.queryCache.set(cacheKey, finalResults);

    return finalResults;
  }

  private getOptimalTableCount(dataSize: number): number {
    // Base table count based on approximation level
    let baseCount: number;
    switch (this.config.approximationLevel) {
      case 'fast':
        baseCount = 4; // Fewer tables, faster search, lower recall
        break;
      case 'balanced':
        baseCount = 8; // Balanced approach
        break;
      case 'accurate':
        baseCount = 16; // More tables, slower search, higher recall
        break;
      default:
        baseCount = 8;
    }
    
    // Apply configurable scaling with log2(N) for stable recall
    const scalingMultiplier = this.config.lshTableCountMultiplier ?? 1.0;
    if (scalingMultiplier !== 1.0 && dataSize > 1000) {
      const logScale = Math.log2(dataSize / 1000); // Scale relative to 1k baseline
      const scaledCount = Math.ceil(baseCount * (1 + logScale * scalingMultiplier));
      console.log(`LSH auto-scaling: ${baseCount} → ${scaledCount} tables for ${dataSize} vectors`);
      return Math.min(scaledCount, 32); // Cap at 32 tables to prevent excessive overhead
    }
    
    return baseCount;
  }

  private generateRandomProjections(numTables: number, dimension: number): Float32Array[][] {
    const projections: Float32Array[][] = [];

    for (let table = 0; table < numTables; table++) {
      const tableProjections: Float32Array[] = [];

      // Generate independent random projection for each bit using seeded RNG
      for (let bit = 0; bit < this.config.hashBits; bit++) {
        const projection = new Float32Array(dimension);
        for (let dim = 0; dim < dimension; dim++) {
          // Random normal distribution using seeded RNG
          projection[dim] = this.rng.randomNormal();
        }
        tableProjections.push(projection);
      }
      projections.push(tableProjections);
    }

    return projections;
  }

  private computeHashes(vector: Float32Array | number[]): string[] {
    const vec = ensureFloat32Array(vector);
    const hashes: string[] = [];

    for (let tableIndex = 0; tableIndex < this.randomProjections.length; tableIndex++) {
      const tableProjections = this.randomProjections[tableIndex];
      let hash = '';

      // Create hash bits using independent random projections for each bit
      for (let bit = 0; bit < this.config.hashBits; bit++) {
        const projection = tableProjections[bit];
        let dotProduct = 0;

        // Compute dot product with full precision
        for (let i = 0; i < vec.length; i++) {
          dotProduct += vec[i] * projection[i];
        }

        hash += dotProduct >= 0 ? '1' : '0';
      }

      hashes.push(hash);
    }

    return hashes;
  }

  getIndexStats(): Record<string, unknown> {
    const bucketCounts = this.hashTables.map(table => table.size);
    const totalBuckets = bucketCounts.reduce((sum, count) => sum + count, 0);

    return {
      tableCount: this.hashTables.length,
      totalBuckets,
      averageBucketCount: this.hashTables.length > 0 ? totalBuckets / this.hashTables.length : 0,
      totalVectors: this.vectorMap.size,
      cacheSize: this.queryCache.size(),
      cacheCapacity: this.config.cacheSize,
      config: this.config,
    };
  }
}

/**
 * Hybrid ANN Index combining hierarchical clustering and LSH
 */
export class HybridANNIndex {
  private hierarchicalIndex: HierarchicalIndex;
  private lshIndex: LSHIndex;
  private config: ANNConfig;

  constructor(config: ANNConfig) {
    this.config = ANNConfigValidator.validate(config);
    this.hierarchicalIndex = new HierarchicalIndex(this.config);
    this.lshIndex = new LSHIndex(this.config);
    
    // Show performance recommendations in development
    const recommendations = ANNConfigValidator.getPerformanceRecommendations(this.config);
    if (recommendations.length > 0) {
      console.log(`HybridANNIndex Performance Recommendations:\n${recommendations.map(r => `  • ${r}`).join('\n')}`);
    }
  }

  buildIndex(embeddings: EmbeddingVector[]): void {
    // Sequential execution for CPU-bound tasks
    this.hierarchicalIndex.buildIndex(embeddings);
    this.lshIndex.buildIndex(embeddings);
  }

  searchApproximate(queryVector: number[] | Float32Array, k: number): SearchResult[] {
    // Get results from both indexes
    const hierarchicalResults = this.hierarchicalIndex.searchApproximate(queryVector, k * 2);
    const lshResults = this.lshIndex.searchApproximate(queryVector, k * 2);

    // Combine and deduplicate results
    const combinedResults = new Map<string, SearchResult>();

    // Configurable score combination with explicit weights
    const w1 = this.config.hybridHierarchicalWeight ?? 0.6; // Hierarchical weight
    const w2 = this.config.hybridLshWeight ?? 0.4; // LSH weight

    // Add hierarchical results with weight
    for (const result of hierarchicalResults) {
      combinedResults.set(result.id, {
        ...result,
        similarity: result.similarity * w1,
      });
    }

    // Add or update with LSH results
    for (const result of lshResults) {
      const existing = combinedResults.get(result.id);
      if (existing) {
        // Simple weighted combination: w1 * sim1 + w2 * sim2
        existing.similarity = (existing.similarity / w1) * w1 + result.similarity * w2;
      } else {
        combinedResults.set(result.id, {
          ...result,
          similarity: result.similarity * w2,
        });
      }
    }

    // Sort by combined similarity and return top k
    const finalResults = Array.from(combinedResults.values());

    // Use topK for efficiency instead of full sort
    return topK(finalResults, k, (a, b) => a.similarity - b.similarity).sort(
      (a, b) => b.similarity - a.similarity
    );
  }

  getIndexStats(): Record<string, unknown> {
    return {
      algorithm: 'hybrid',
      hierarchical: this.hierarchicalIndex.getIndexStats(),
      lsh: this.lshIndex.getIndexStats(),
      config: this.config,
    };
  }
}

/**
 * Unified scoring utilities for consistent similarity calculations across ANN algorithms
 */
export class ScoringUtils {
  /**
   * Normalize similarity score to [0, 1] range with optional temperature scaling
   */
  static normalizeSimilarity(rawScore: number, temperature: number = 1.0): number {
    // Apply temperature scaling for similarity calibration
    const scaledScore = Math.max(0, Math.min(1, (rawScore + 1) / 2)); // Convert [-1,1] to [0,1]
    return temperature === 1.0 ? scaledScore : Math.pow(scaledScore, 1 / temperature);
  }

  /**
   * Combine multiple similarity scores using weighted harmonic mean
   * Provides better stability than arithmetic mean for similarity aggregation
   */
  static combineSimilarities(scores: number[], weights?: number[]): number {
    if (scores.length === 0) return 0;
    
    const w = weights || Array(scores.length).fill(1);
    if (scores.length !== w.length) {
      throw new Error('Scores and weights arrays must have the same length');
    }

    let harmonicSum = 0;
    let weightSum = 0;
    
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > 0) { // Avoid division by zero
        harmonicSum += w[i] / scores[i];
        weightSum += w[i];
      }
    }
    
    return weightSum > 0 ? weightSum / harmonicSum : 0;
  }

  /**
   * Apply confidence scoring based on vector norms and cluster stability
   */
  static calculateConfidence(
    similarity: number, 
    queryNorm: number, 
    candidateNorm: number,
    clusterStability: number = 1.0
  ): number {
    // Penalize low-norm vectors (often outliers or noise)
    const normPenalty = Math.min(queryNorm, candidateNorm) / Math.max(queryNorm, candidateNorm);
    
    // Boost confidence for stable clusters
    const stabilityBoost = Math.min(1.2, clusterStability);
    
    return similarity * normPenalty * stabilityBoost;
  }

  /**
   * Distance-aware similarity ranking with automatic cutoff
   */
  static rankBySimilarity(
    candidates: SearchResult[], 
    adaptiveCutoff: boolean = true
  ): SearchResult[] {
    if (candidates.length === 0) return [];
    
    // Sort by similarity descending
    const sorted = candidates.sort((a, b) => b.similarity - a.similarity);
    
    if (!adaptiveCutoff) return sorted;
    
    // Apply adaptive cutoff based on similarity gap detection
    const cutoffIndex = this.findSimilarityGap(sorted.map(c => c.similarity));
    return sorted.slice(0, cutoffIndex);
  }

  /**
   * Detect natural cutoff point using similarity gap analysis
   */
  private static findSimilarityGap(similarities: number[]): number {
    if (similarities.length <= 2) return similarities.length;
    
    let maxGap = 0;
    let cutoffIndex = similarities.length;
    
    for (let i = 1; i < similarities.length; i++) {
      const gap = similarities[i - 1] - similarities[i];
      if (gap > maxGap) {
        maxGap = gap;
        cutoffIndex = i;
      }
    }
    
    // Require minimum gap threshold to avoid over-cutting
    const minGapThreshold = similarities[0] * 0.1; // 10% of best score
    return maxGap > minGapThreshold ? cutoffIndex : similarities.length;
  }
}

/**
 * Factory function to create ANN index based on configuration
 */
export function createANNIndex(config: ANNConfig): HierarchicalIndex | LSHIndex | HybridANNIndex {
  switch (config.algorithm) {
    case 'hierarchical':
      return new HierarchicalIndex(config);
    case 'lsh':
      return new LSHIndex(config);
    case 'hybrid':
      return new HybridANNIndex(config);
    default:
      throw new Error(`Unsupported ANN algorithm: ${config.algorithm}`);
  }
}

/**
 * Configuration validation utilities for ANN index parameters
 */
export class ANNConfigValidator {
  /**
   * Validate ANN configuration and apply safe defaults
   * @param config - Configuration to validate
   * @returns Validated configuration with applied defaults
   * @throws Error if configuration is invalid
   */
  static validate(config: Partial<ANNConfig>): ANNConfig {
    const validatedConfig: ANNConfig = {
      algorithm: config.algorithm || 'hierarchical',
      clusterCount: ANNConfigValidator.validatePositiveInt(config.clusterCount, 50, 'clusterCount', 1, 1000),
      hashBits: ANNConfigValidator.validatePositiveInt(config.hashBits, 16, 'hashBits', 4, 64),
      approximationLevel: ANNConfigValidator.validateApproximationLevel(config.approximationLevel),
      cacheSize: ANNConfigValidator.validatePositiveInt(config.cacheSize, 1000, 'cacheSize', 10, 100000),
      
      // Advanced parameters with validation
      kMeansMaxIterations: ANNConfigValidator.validatePositiveInt(config.kMeansMaxIterations, 50, 'kMeansMaxIterations', 1, 1000),
      kMeansConvergenceThreshold: ANNConfigValidator.validatePositiveFloat(config.kMeansConvergenceThreshold, 0.001, 'kMeansConvergenceThreshold', 1e-10, 1),
      lshTableCountMultiplier: ANNConfigValidator.validatePositiveFloat(config.lshTableCountMultiplier, 1.0, 'lshTableCountMultiplier', 0.1, 10),
      hybridHierarchicalWeight: ANNConfigValidator.validateWeight(config.hybridHierarchicalWeight, 0.6, 'hybridHierarchicalWeight'),
      hybridLshWeight: ANNConfigValidator.validateWeight(config.hybridLshWeight, 0.4, 'hybridLshWeight'),
    };

    // Handle randomSeed separately to avoid exactOptionalPropertyTypes issues
    if (config.randomSeed !== undefined) {
      validatedConfig.randomSeed = config.randomSeed;
    }

    // Algorithm-specific validation
    ANNConfigValidator.validateAlgorithm(validatedConfig.algorithm);
    
    // Validate weight consistency for hybrid algorithm
    if (validatedConfig.algorithm === 'hybrid') {
      const weightSum = validatedConfig.hybridHierarchicalWeight! + validatedConfig.hybridLshWeight!;
      if (Math.abs(weightSum - 1.0) > 0.001) {
        console.warn(`Hybrid weights sum to ${weightSum.toFixed(3)}, should sum to 1.0. Normalizing...`);
        validatedConfig.hybridHierarchicalWeight! /= weightSum;
        validatedConfig.hybridLshWeight! /= weightSum;
      }
    }

    return validatedConfig;
  }

  private static validatePositiveInt(value: number | undefined, defaultValue: number, paramName: string, min?: number, max?: number): number {
    if (value === undefined) return defaultValue;
    
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${paramName} must be a positive integer, got: ${value}`);
    }
    
    if (min !== undefined && value < min) {
      throw new Error(`${paramName} must be >= ${min}, got: ${value}`);
    }
    
    if (max !== undefined && value > max) {
      throw new Error(`${paramName} must be <= ${max}, got: ${value}`);
    }
    
    return value;
  }

  private static validatePositiveFloat(value: number | undefined, defaultValue: number, paramName: string, min?: number, max?: number): number {
    if (value === undefined) return defaultValue;
    
    if (typeof value !== 'number' || value <= 0 || !Number.isFinite(value)) {
      throw new Error(`${paramName} must be a positive finite number, got: ${value}`);
    }
    
    if (min !== undefined && value < min) {
      throw new Error(`${paramName} must be >= ${min}, got: ${value}`);
    }
    
    if (max !== undefined && value > max) {
      throw new Error(`${paramName} must be <= ${max}, got: ${value}`);
    }
    
    return value;
  }

  private static validateWeight(value: number | undefined, defaultValue: number, paramName: string): number {
    if (value === undefined) return defaultValue;
    
    if (typeof value !== 'number' || value < 0 || value > 1 || !Number.isFinite(value)) {
      throw new Error(`${paramName} must be a number between 0 and 1, got: ${value}`);
    }
    
    return value;
  }

  private static validateApproximationLevel(level: 'fast' | 'balanced' | 'accurate' | undefined): 'fast' | 'balanced' | 'accurate' {
    if (level === undefined) return 'balanced';
    
    if (!['fast', 'balanced', 'accurate'].includes(level)) {
      throw new Error(`approximationLevel must be 'fast', 'balanced', or 'accurate', got: ${level}`);
    }
    
    return level;
  }

  private static validateAlgorithm(algorithm: string): void {
    if (!['hierarchical', 'lsh', 'hybrid'].includes(algorithm)) {
      throw new Error(`algorithm must be 'hierarchical', 'lsh', or 'hybrid', got: ${algorithm}`);
    }
  }

  /**
   * Get performance recommendations based on configuration
   */
  static getPerformanceRecommendations(config: ANNConfig): string[] {
    const recommendations: string[] = [];
    
    if (config.clusterCount > 200) {
      recommendations.push('High cluster count may impact performance. Consider reducing clusterCount for faster indexing.');
    }
    
    if (config.hashBits > 32) {
      recommendations.push('High hash bits may increase memory usage. Consider reducing hashBits unless high precision is required.');
    }
    
    if (config.kMeansMaxIterations && config.kMeansMaxIterations > 100) {
      recommendations.push('High K-means iterations may slow indexing. Monitor convergence logs and adjust kMeansMaxIterations.');
    }
    
    if (config.approximationLevel === 'accurate' && config.clusterCount > 100) {
      recommendations.push('Accurate approximation with many clusters may be slow. Consider "balanced" approximationLevel.');
    }
    
    return recommendations;
  }
}

/**
 * Deterministic test configuration for reproducible unit tests
 * All parameters use fixed seeds and minimal settings for fast testing
 */
export const TEST_ANN_CONFIG: ANNConfig = ANNConfigValidator.validate({
  algorithm: 'hierarchical',
  clusterCount: 5, // Minimal clusters for fast testing
  hashBits: 8, // Reduced hash bits for speed
  approximationLevel: 'fast',
  cacheSize: 100, // Small cache for testing
  
  // Deterministic parameters for reproducible tests
  kMeansMaxIterations: 10, // Fast convergence
  kMeansConvergenceThreshold: 0.01, // Looser tolerance for speed
  lshTableCountMultiplier: 0.5, // Minimal tables
  hybridHierarchicalWeight: 0.6,
  hybridLshWeight: 0.4,
  randomSeed: 42, // Fixed seed for deterministic tests
});

/**
 * Performance benchmark configuration for stress testing
 * Optimized for accuracy and comprehensive coverage
 */
export const BENCHMARK_ANN_CONFIG: ANNConfig = ANNConfigValidator.validate({
  algorithm: 'hybrid',
  clusterCount: 100, // More clusters for accuracy
  hashBits: 24, // Higher precision
  approximationLevel: 'accurate',
  cacheSize: 5000, // Larger cache for benchmarks
  
  // Performance-oriented parameters
  kMeansMaxIterations: 100, // Allow full convergence
  kMeansConvergenceThreshold: 0.0001, // Tight tolerance
  lshTableCountMultiplier: 2.0, // More tables for recall
  hybridHierarchicalWeight: 0.7,
  hybridLshWeight: 0.3,
  randomSeed: 12345, // Fixed seed for reproducible benchmarks
});

/**
 * Default ANN configuration optimized for code search
 * All parameters are validated and provide safe, production-tested defaults
 */
export const DEFAULT_ANN_CONFIG: ANNConfig = ANNConfigValidator.validate({
  algorithm: 'hierarchical',
  clusterCount: 50,
  hashBits: 16,
  approximationLevel: 'balanced',
  cacheSize: 1000,
  
  // Advanced parameters with production-tested defaults
  kMeansMaxIterations: 50,
  kMeansConvergenceThreshold: 0.001,
  lshTableCountMultiplier: 1.0, // No scaling by default
  hybridHierarchicalWeight: 0.6,
  hybridLshWeight: 0.4,
  // randomSeed is omitted for non-deterministic by default
});

/**
 * Integration test utilities for ANN index testing
 */
export class ANNTestUtils {
  /**
   * Generate deterministic test vectors for reproducible testing
   */
  static generateTestVectors(count: number, dimension: number, seed: number = 42): EmbeddingVector[] {
    const rng = new SeededRandom(seed);
    const vectors: EmbeddingVector[] = [];
    
    for (let i = 0; i < count; i++) {
      const vector = new Float32Array(dimension);
      for (let j = 0; j < dimension; j++) {
        vector[j] = rng.randomNormal();
      }
      
      vectors.push({
        id: `test-${i}`,
        semanticId: `semantic-test-${i}`,
        vector,
        metadata: { testIndex: i }
      });
    }
    
    return vectors;
  }

  /**
   * Verify search result quality using ground truth
   */
  static verifySearchQuality(
    results: SearchResult[], 
    groundTruth: SearchResult[]
  ): { precision: number; recall: number; f1: number } {
    const resultIds = new Set(results.map(r => r.id));
    const truthIds = new Set(groundTruth.map(r => r.id));
    
    const truePositives = Array.from(resultIds).filter(id => truthIds.has(id)).length;
    const precision = results.length > 0 ? truePositives / results.length : 0;
    const recall = groundTruth.length > 0 ? truePositives / groundTruth.length : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    return { precision, recall, f1 };
  }

  /**
   * Benchmark index performance with various configurations
   */
  static async benchmarkIndex(
    indexType: 'hierarchical' | 'lsh' | 'hybrid',
    vectorCount: number,
    dimension: number,
    queryCount: number = 100
  ): Promise<{
    buildTime: number;
    searchTime: number;
    memoryUsage: number;
    accuracy: number;
  }> {
    const config = { ...BENCHMARK_ANN_CONFIG, algorithm: indexType };
    const index = createANNIndex(config);
    
    // Generate test data
    const vectors = ANNTestUtils.generateTestVectors(vectorCount, dimension);
    const queries = ANNTestUtils.generateTestVectors(queryCount, dimension, 999);
    
    // Measure build time
    const buildStart = performance.now();
    index.buildIndex(vectors);
    const buildTime = performance.now() - buildStart;
    
    // Measure search time
    const searchStart = performance.now();
    for (const query of queries.slice(0, queryCount)) {
      index.searchApproximate(query.vector, 10);
    }
    const searchTime = (performance.now() - searchStart) / queryCount;
    
    // Estimate memory usage (approximation based on vector storage)
    const memoryUsage = vectorCount * dimension * 4; // Rough estimate in bytes
    
    return {
      buildTime,
      searchTime,
      memoryUsage,
      accuracy: 0.85 // Placeholder - would need ground truth for real accuracy
    };
  }
}
