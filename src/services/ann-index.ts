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
 * Utility functions for optimized vector operations
 */

function ensureFloat32Array(vector: Float32Array | number[]): Float32Array {
  if (vector instanceof Float32Array) {
    return vector; // No copy needed
  }
  return new Float32Array(vector);
}

/**
 * Fast hash function for cache keys (xxHash-like)
 */
function fastHash(data: Float32Array): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < Math.min(data.length, 32); i++) {
    // Hash first 32 elements
    const value = Math.floor(data[i] * 1000000); // Scale and floor for stability
    hash ^= value;
    hash = (hash * 0x01000193) >>> 0; // FNV prime, keep as 32-bit
  }
  return hash.toString(16);
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
 */
function topK<T>(arr: T[], k: number, compare: (a: T, b: T) => number): T[] {
  if (arr.length <= k) {
    // Return without sorting - let caller decide if sorting is needed
    return arr.slice();
  }

  const result = arr.slice();
  quickselect(result, k, 0, result.length - 1, compare);

  // Only sort the top k elements
  return result.slice(0, k).sort(compare);
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
 */
export class HierarchicalIndex {
  private clusters: FunctionCluster[] = [];
  private vectorMap: Map<string, EmbeddingVector> = new Map();
  private config: ANNConfig;
  private queryCache: LRUCache<string, SearchResult[]>;
  private vectorNorms: Map<string, number> = new Map();
  private clusterNorms: Map<string, number> = new Map();

  constructor(config: ANNConfig) {
    this.config = config;
    this.queryCache = new LRUCache(config.cacheSize);
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
    for (const embedding of embeddings) {
      // Ensure Float32Array and validate non-zero vectors
      const vector = ensureFloat32Array(embedding.vector);
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

    // K-means clustering iteration
    const maxIterations = 50;
    let converged = false;

    for (let iteration = 0; iteration < maxIterations && !converged; iteration++) {
      const newClusters = this.assignToClusters(Array.from(this.vectorMap.values()));
      converged = this.updateCentroids(newClusters);
      this.clusters = newClusters;
    }

    // Remove empty clusters
    this.clusters = this.clusters.filter(cluster => cluster.memberIds.length > 0);
  }

  /**
   * Perform approximate nearest neighbor search
   */
  searchApproximate(queryVector: number[] | Float32Array, k: number): SearchResult[] {
    if (this.clusters.length === 0) {
      return [];
    }

    // Convert query vector to Float32Array for optimal performance
    const queryFloat32 = ensureFloat32Array(queryVector);
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

    // Remove score field and return
    const results: SearchResult[] = topResults.map(({ score: _score, ...result }) => result);

    // Cache the results (undefined check handled in LRUCache.set)
    this.queryCache.set(cacheKey, results);

    return results;
  }

  private initializeClusters(embeddings: EmbeddingVector[]): FunctionCluster[] {
    const clusters: FunctionCluster[] = [];
    const clusterCount = Math.min(this.config.clusterCount, embeddings.length);

    // Use K-means++ initialization for better cluster selection
    const selectedIndices: number[] = [];

    // First centroid: random selection
    selectedIndices.push(Math.floor(Math.random() * embeddings.length));

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

      // Weighted random selection based on distance
      const totalWeight = distances.reduce((sum, weight) => sum + weight, 0);
      if (totalWeight > 0) {
        const randomValue = Math.random() * totalWeight;
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
          selectedIndices.push(unselected[Math.floor(Math.random() * unselected.length)]);
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

  private updateCentroids(clusters: FunctionCluster[]): boolean {
    let converged = true;
    const convergenceThreshold = 0.001;

    for (const cluster of clusters) {
      if (cluster.memberIds.length === 0) {
        continue; // Skip empty clusters
      }

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
      if (centroidChangeSquared > convergenceThreshold * convergenceThreshold) {
        converged = false;
      }

      cluster.centroid = newCentroid;
      // Update cached norm
      this.clusterNorms.set(cluster.id, calculateNorm(newCentroid));
    }

    return converged;
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
 * Locality-Sensitive Hashing implementation for ANN search
 */
export class LSHIndex {
  private hashTables: Map<string, LSHBucket>[] = [];
  private vectorMap: Map<string, EmbeddingVector> = new Map();
  private config: ANNConfig;
  private randomProjections: Float32Array[][] = []; // [table][bit] = projection vector
  private queryCache: LRUCache<string, SearchResult[]>;
  private vectorNorms: Map<string, number> = new Map();

  constructor(config: ANNConfig) {
    this.config = config;
    this.queryCache = new LRUCache(config.cacheSize);
  }

  buildIndex(embeddings: EmbeddingVector[]): void {
    if (embeddings.length === 0) {
      return;
    }

    // Store vectors for quick lookup and ensure Float32Array
    this.vectorMap.clear();
    this.vectorNorms.clear();
    for (const embedding of embeddings) {
      // Ensure Float32Array and validate non-zero vectors
      const vector = ensureFloat32Array(embedding.vector);
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
    const numTables = this.getOptimalTableCount();

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

    // Convert query vector to Float32Array for optimal performance
    const queryFloat32 = ensureFloat32Array(queryVector);
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

    // Remove score field and return
    const finalResults: SearchResult[] = topResults.map(({ score: _score, ...result }) => result);

    // Cache the results (undefined check handled in LRUCache.set)
    this.queryCache.set(cacheKey, finalResults);

    return finalResults;
  }

  private getOptimalTableCount(): number {
    switch (this.config.approximationLevel) {
      case 'fast':
        return 4; // Fewer tables, faster search, lower recall
      case 'balanced':
        return 8; // Balanced approach
      case 'accurate':
        return 16; // More tables, slower search, higher recall
      default:
        return 8;
    }
  }

  private generateRandomProjections(numTables: number, dimension: number): Float32Array[][] {
    const projections: Float32Array[][] = [];

    for (let table = 0; table < numTables; table++) {
      const tableProjections: Float32Array[] = [];

      // Generate independent random projection for each bit
      for (let bit = 0; bit < this.config.hashBits; bit++) {
        const projection = new Float32Array(dimension);
        for (let dim = 0; dim < dimension; dim++) {
          // Random normal distribution (Box-Muller transform)
          const u1 = Math.random();
          const u2 = Math.random();
          const randNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          projection[dim] = randNormal;
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
    this.config = config;
    this.hierarchicalIndex = new HierarchicalIndex(config);
    this.lshIndex = new LSHIndex(config);
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

    // Cleaner score combination with explicit weights
    const w1 = 0.6; // Hierarchical weight
    const w2 = 0.4; // LSH weight

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
 * Default ANN configuration optimized for code search
 */
export const DEFAULT_ANN_CONFIG: ANNConfig = {
  algorithm: 'hierarchical',
  clusterCount: 50,
  hashBits: 16,
  approximationLevel: 'balanced',
  cacheSize: 1000,
};
