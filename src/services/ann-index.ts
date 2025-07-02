/**
 * Approximate Nearest Neighbor (ANN) Index Service
 * 
 * Implements hierarchical clustering and LSH algorithms for fast approximate
 * vector similarity search, optimized for large codebases without native
 * pgvector support.
 */

export interface ANNConfig {
  algorithm: 'hierarchical' | 'lsh' | 'hybrid';
  clusterCount: number;
  hashBits: number; // for LSH
  approximationLevel: 'fast' | 'balanced' | 'accurate';
  cacheSize: number;
}

export interface EmbeddingVector {
  id: string;
  semanticId: string;
  vector: Float32Array | number[];
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
function toFloat32Array(vector: Float32Array | number[]): Float32Array {
  if (vector instanceof Float32Array) {
    return vector;
  }
  return new Float32Array(vector);
}

function ensureFloat32Array(vector: Float32Array | number[]): Float32Array {
  return toFloat32Array(vector);
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
    dotProduct += vec1[i] * vec2[i] +
                  vec1[i+1] * vec2[i+1] +
                  vec1[i+2] * vec2[i+2] +
                  vec1[i+3] * vec2[i+3];
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
 * Optimized L2 distance calculation
 */
function calculateL2DistanceOptimized(vec1: Float32Array, vec2: Float32Array): number {
  let sum = 0;
  const len = vec1.length;
  
  // Reverse loop can be faster in some JS engines
  for (let i = len - 1; i >= 0; i--) {
    const diff = vec1[i] - vec2[i];
    sum += diff * diff;
  }
  
  return Math.sqrt(sum);
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
function topK<T>(
  arr: T[],
  k: number,
  compare: (a: T, b: T) => number
): T[] {
  if (arr.length <= k) {
    return arr.slice().sort(compare);
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
    return value;
  }

  set(key: K, value: V): void {
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
  async buildIndex(embeddings: EmbeddingVector[]): Promise<void> {
    if (embeddings.length === 0) {
      return;
    }

    // Store vectors for quick lookup and convert to Float32Array
    this.vectorMap.clear();
    this.vectorNorms.clear();
    for (const embedding of embeddings) {
      // Convert to Float32Array for efficiency
      const optimizedEmbedding = {
        ...embedding,
        vector: ensureFloat32Array(embedding.vector)
      };
      this.vectorMap.set(embedding.id, optimizedEmbedding);
      
      // Pre-calculate and cache vector norms
      this.vectorNorms.set(embedding.id, calculateNorm(optimizedEmbedding.vector));
    }

    // Initialize clusters with random centroids
    this.clusters = await this.initializeClusters(embeddings);

    // K-means clustering iteration
    const maxIterations = 50;
    let converged = false;

    for (let iteration = 0; iteration < maxIterations && !converged; iteration++) {
      const newClusters = await this.assignToClusters(embeddings);
      converged = await this.updateCentroids(newClusters);
      this.clusters = newClusters;
    }
  }

  /**
   * Perform approximate nearest neighbor search
   */
  async searchApproximate(queryVector: number[] | Float32Array, k: number): Promise<SearchResult[]> {
    if (this.clusters.length === 0) {
      return [];
    }

    // Convert query vector to Float32Array for optimal performance
    const queryFloat32 = ensureFloat32Array(queryVector);
    const queryNorm = calculateNorm(queryFloat32);

    // Create cache key from query vector (simplified hash)
    const cacheKey = `${queryFloat32.slice(0, 10).join(',')}_${k}_${this.config.approximationLevel}`;
    const cachedResult = this.queryCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Find nearest cluster centroids using optimized distance calculation
    const clusterDistances = this.clusters.map((cluster, index) => ({
      index,
      distance: calculateL2DistanceOptimized(queryFloat32, cluster.centroid)
    }));

    // Use quickselect to find top clusters in O(n) time
    const clustersToSearch = this.getSearchDepth(clusterDistances.length);
    const topClusters = topK(
      clusterDistances,
      clustersToSearch,
      (a, b) => a.distance - b.distance
    );

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
            ...(vector.metadata ? { metadata: vector.metadata } : {})
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
    
    // Cache the results
    this.queryCache.set(cacheKey, results);
    
    return results;
  }

  private async initializeClusters(embeddings: EmbeddingVector[]): Promise<FunctionCluster[]> {
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

        // Find minimum distance to existing centroids
        let minDistance = Infinity;
        for (const selectedIndex of selectedIndices) {
          const distance = this.calculateDistance(
            embeddings[j].vector,
            embeddings[selectedIndex].vector
          );
          minDistance = Math.min(minDistance, distance);
        }
        distances.push(minDistance * minDistance); // Square for weighted selection
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
      const sourceVector = this.vectorMap.get(embeddings[selectedIndex].id)?.vector || embeddings[selectedIndex].vector;
      clusters.push({
        id: `cluster-${i}`,
        centroid: new Float32Array(sourceVector),
        memberIds: [],
        memberCount: 0
      });
      
      // Cache cluster centroid norms
      this.clusterNorms.set(`cluster-${i}`, calculateNorm(clusters[i].centroid));
    }

    return clusters;
  }

  private async assignToClusters(embeddings: EmbeddingVector[]): Promise<FunctionCluster[]> {
    // Reset cluster assignments
    const newClusters = this.clusters.map(cluster => ({
      ...cluster,
      memberIds: [] as string[],
      memberCount: 0
    }));

    // Assign each vector to nearest cluster
    for (const embedding of embeddings) {
      let bestClusterIndex = 0;
      let bestDistance = Infinity;

      for (let i = 0; i < newClusters.length; i++) {
        const distance = this.calculateDistance(embedding.vector, newClusters[i].centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestClusterIndex = i;
        }
      }

      newClusters[bestClusterIndex].memberIds.push(embedding.id);
      newClusters[bestClusterIndex].memberCount++;
    }

    return newClusters;
  }

  private async updateCentroids(clusters: FunctionCluster[]): Promise<boolean> {
    let converged = true;
    const convergenceThreshold = 0.001;

    for (const cluster of clusters) {
      if (cluster.memberIds.length === 0) {
        continue;
      }

      // Calculate new centroid as average of member vectors
      const dimension = cluster.centroid.length;
      const newCentroid = new Float32Array(dimension);

      for (const memberId of cluster.memberIds) {
        const vector = this.vectorMap.get(memberId);
        if (vector && vector.vector instanceof Float32Array) {
          for (let i = 0; i < dimension; i++) {
            newCentroid[i] += vector.vector[i];
          }
        }
      }

      // Average the coordinates
      for (let i = 0; i < dimension; i++) {
        newCentroid[i] /= cluster.memberIds.length;
      }

      // Check convergence using optimized distance
      const centroidChange = calculateL2DistanceOptimized(cluster.centroid, newCentroid);
      if (centroidChange > convergenceThreshold) {
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

  private calculateDistance(vec1: Float32Array | number[], vec2: Float32Array | number[]): number {
    const v1 = ensureFloat32Array(vec1);
    const v2 = ensureFloat32Array(vec2);
    return calculateL2DistanceOptimized(v1, v2);
  }


  getIndexStats(): Record<string, unknown> {
    return {
      clusterCount: this.clusters.length,
      totalVectors: this.vectorMap.size,
      averageClusterSize: this.clusters.length > 0 
        ? this.vectorMap.size / this.clusters.length 
        : 0,
      cacheSize: this.queryCache.size(),
      cacheCapacity: this.config.cacheSize,
      config: this.config
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
  private randomProjections: Float32Array[] = [];
  private queryCache: LRUCache<string, SearchResult[]>;
  private vectorNorms: Map<string, number> = new Map();

  constructor(config: ANNConfig) {
    this.config = config;
    this.queryCache = new LRUCache(config.cacheSize);
  }

  async buildIndex(embeddings: EmbeddingVector[]): Promise<void> {
    if (embeddings.length === 0) {
      return;
    }

    // Store vectors for quick lookup and convert to Float32Array
    this.vectorMap.clear();
    this.vectorNorms.clear();
    for (const embedding of embeddings) {
      // Convert to Float32Array for efficiency
      const optimizedEmbedding = {
        ...embedding,
        vector: ensureFloat32Array(embedding.vector)
      };
      this.vectorMap.set(embedding.id, optimizedEmbedding);
      
      // Pre-calculate and cache vector norms
      this.vectorNorms.set(embedding.id, calculateNorm(optimizedEmbedding.vector));
    }

    // Initialize hash tables and random projections
    const dimension = embeddings[0].vector.length;
    const numTables = this.getOptimalTableCount();
    
    this.hashTables = Array(numTables).fill(null).map(() => new Map<string, LSHBucket>());
    this.randomProjections = this.generateRandomProjections(numTables, dimension);

    // Hash all vectors into buckets
    for (const embedding of embeddings) {
      const hashes = this.computeHashes(embedding.vector);
      
      for (let tableIndex = 0; tableIndex < numTables; tableIndex++) {
        const hash = hashes[tableIndex];
        const bucket = this.hashTables[tableIndex].get(hash);
        
        if (bucket) {
          bucket.vectorIds.push(embedding.id);
        } else {
          this.hashTables[tableIndex].set(hash, {
            hash,
            vectorIds: [embedding.id]
          });
        }
      }
    }
  }

  async searchApproximate(queryVector: number[] | Float32Array, k: number): Promise<SearchResult[]> {
    if (this.hashTables.length === 0) {
      return [];
    }

    // Convert query vector to Float32Array for optimal performance
    const queryFloat32 = ensureFloat32Array(queryVector);
    const queryNorm = calculateNorm(queryFloat32);

    // Create cache key from query vector (simplified hash)
    const cacheKey = `lsh_${queryFloat32.slice(0, 10).join(',')}_${k}_${this.config.hashBits}`;
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
          ...(vector.metadata ? { metadata: vector.metadata } : {})
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
    
    // Cache the results
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

  private generateRandomProjections(numTables: number, dimension: number): Float32Array[] {
    const projections: Float32Array[] = [];
    
    for (let table = 0; table < numTables; table++) {
      const projection = new Float32Array(dimension);
      for (let dim = 0; dim < dimension; dim++) {
        // Random normal distribution (Box-Muller transform)
        const u1 = Math.random();
        const u2 = Math.random();
        const randNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        projection[dim] = randNormal;
      }
      projections.push(projection);
    }
    
    return projections;
  }

  private computeHashes(vector: Float32Array | number[]): string[] {
    const hashes: string[] = [];
    
    for (let tableIndex = 0; tableIndex < this.randomProjections.length; tableIndex++) {
      const projection = this.randomProjections[tableIndex];
      let hash = '';
      
      // Create hash bits based on random projections
      for (let bit = 0; bit < this.config.hashBits; bit++) {
        let dotProduct = 0;
        const startIdx = (bit * vector.length) / this.config.hashBits;
        const endIdx = ((bit + 1) * vector.length) / this.config.hashBits;
        
        for (let i = Math.floor(startIdx); i < Math.floor(endIdx) && i < vector.length; i++) {
          dotProduct += vector[i] * projection[i];
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
      config: this.config
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

  async buildIndex(embeddings: EmbeddingVector[]): Promise<void> {
    await Promise.all([
      this.hierarchicalIndex.buildIndex(embeddings),
      this.lshIndex.buildIndex(embeddings)
    ]);
  }

  async searchApproximate(queryVector: number[] | Float32Array, k: number): Promise<SearchResult[]> {
    // Get results from both indexes
    const [hierarchicalResults, lshResults] = await Promise.all([
      this.hierarchicalIndex.searchApproximate(queryVector, k * 2),
      this.lshIndex.searchApproximate(queryVector, k * 2)
    ]);

    // Combine and deduplicate results
    const combinedResults = new Map<string, SearchResult>();
    
    // Add hierarchical results with weight
    for (const result of hierarchicalResults) {
      combinedResults.set(result.id, {
        ...result,
        similarity: result.similarity * 0.6 // Weight hierarchical results
      });
    }

    // Add or update with LSH results
    for (const result of lshResults) {
      const existing = combinedResults.get(result.id);
      if (existing) {
        // Properly weight and combine similarities if found in both
        // Existing already has 0.6 weight from hierarchical, add 0.4 weight from LSH
        existing.similarity = (existing.similarity / 0.6) * 0.6 + result.similarity * 0.4;
      } else {
        combinedResults.set(result.id, {
          ...result,
          similarity: result.similarity * 0.4 // Weight LSH results
        });
      }
    }

    // Sort by combined similarity and return top k
    const finalResults = Array.from(combinedResults.values());
    finalResults.sort((a, b) => b.similarity - a.similarity);
    return finalResults.slice(0, k);
  }

  getIndexStats(): Record<string, unknown> {
    return {
      algorithm: 'hybrid',
      hierarchical: this.hierarchicalIndex.getIndexStats(),
      lsh: this.lshIndex.getIndexStats(),
      config: this.config
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
  cacheSize: 1000
};