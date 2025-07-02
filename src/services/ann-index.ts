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
  vector: number[];
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
  centroid: number[];
  memberIds: string[];
  memberCount: number;
}

export interface LSHBucket {
  hash: string;
  vectorIds: string[];
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

    // Store vectors for quick lookup
    this.vectorMap.clear();
    for (const embedding of embeddings) {
      this.vectorMap.set(embedding.id, embedding);
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
  async searchApproximate(queryVector: number[], k: number): Promise<SearchResult[]> {
    if (this.clusters.length === 0) {
      return [];
    }

    // Create cache key from query vector (simplified hash)
    const cacheKey = `${queryVector.slice(0, 10).join(',')}_${k}_${this.config.approximationLevel}`;
    const cachedResult = this.queryCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Find nearest cluster centroids
    const clusterDistances = this.clusters.map((cluster, index) => ({
      index,
      distance: this.calculateDistance(queryVector, cluster.centroid)
    }));

    // Sort clusters by distance to query
    clusterDistances.sort((a, b) => a.distance - b.distance);

    // Determine how many clusters to search based on approximation level
    const clustersToSearch = this.getSearchDepth(clusterDistances.length);
    const candidateResults: SearchResult[] = [];

    // Search within top clusters
    for (let i = 0; i < clustersToSearch; i++) {
      const clusterIndex = clusterDistances[i].index;
      const cluster = this.clusters[clusterIndex];

      for (const memberId of cluster.memberIds) {
        const vector = this.vectorMap.get(memberId);
        if (vector) {
          const similarity = this.calculateCosineSimilarity(queryVector, vector.vector);
          candidateResults.push({
            id: vector.id,
            semanticId: vector.semanticId,
            similarity,
            ...(vector.metadata ? { metadata: vector.metadata } : {})
          });
        }
      }
    }

    // Sort by similarity and return top k
    candidateResults.sort((a, b) => b.similarity - a.similarity);
    const results = candidateResults.slice(0, k);
    
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
      clusters.push({
        id: `cluster-${i}`,
        centroid: [...embeddings[selectedIndex].vector],
        memberIds: [],
        memberCount: 0
      });
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
      const newCentroid = new Array(dimension).fill(0);

      for (const memberId of cluster.memberIds) {
        const vector = this.vectorMap.get(memberId);
        if (vector) {
          for (let i = 0; i < dimension; i++) {
            newCentroid[i] += vector.vector[i];
          }
        }
      }

      // Average the coordinates
      for (let i = 0; i < dimension; i++) {
        newCentroid[i] /= cluster.memberIds.length;
      }

      // Check convergence
      const centroidChange = this.calculateDistance(cluster.centroid, newCentroid);
      if (centroidChange > convergenceThreshold) {
        converged = false;
      }

      cluster.centroid = newCentroid;
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

  private calculateDistance(vec1: number[], vec2: number[]): number {
    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      const diff = vec1[i] - vec2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
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
  private randomProjections: number[][] = [];
  private queryCache: LRUCache<string, SearchResult[]>;

  constructor(config: ANNConfig) {
    this.config = config;
    this.queryCache = new LRUCache(config.cacheSize);
  }

  async buildIndex(embeddings: EmbeddingVector[]): Promise<void> {
    if (embeddings.length === 0) {
      return;
    }

    // Store vectors for quick lookup
    this.vectorMap.clear();
    for (const embedding of embeddings) {
      this.vectorMap.set(embedding.id, embedding);
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

  async searchApproximate(queryVector: number[], k: number): Promise<SearchResult[]> {
    if (this.hashTables.length === 0) {
      return [];
    }

    // Create cache key from query vector (simplified hash)
    const cacheKey = `lsh_${queryVector.slice(0, 10).join(',')}_${k}_${this.config.hashBits}`;
    const cachedResult = this.queryCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Get candidate vectors from all hash tables
    const candidateIds = new Set<string>();
    const queryHashes = this.computeHashes(queryVector);

    for (let tableIndex = 0; tableIndex < this.hashTables.length; tableIndex++) {
      const hash = queryHashes[tableIndex];
      const bucket = this.hashTables[tableIndex].get(hash);
      
      if (bucket) {
        for (const vectorId of bucket.vectorIds) {
          candidateIds.add(vectorId);
        }
      }
    }

    // Calculate exact similarities for candidates
    const results: SearchResult[] = [];
    for (const candidateId of candidateIds) {
      const vector = this.vectorMap.get(candidateId);
      if (vector) {
        const similarity = this.calculateCosineSimilarity(queryVector, vector.vector);
        results.push({
          id: vector.id,
          semanticId: vector.semanticId,
          similarity,
          ...(vector.metadata ? { metadata: vector.metadata } : {})
        });
      }
    }

    // Sort by similarity and return top k
    results.sort((a, b) => b.similarity - a.similarity);
    const finalResults = results.slice(0, k);
    
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

  private generateRandomProjections(numTables: number, dimension: number): number[][] {
    const projections: number[][] = [];
    
    for (let table = 0; table < numTables; table++) {
      const projection: number[] = [];
      for (let dim = 0; dim < dimension; dim++) {
        // Random normal distribution (Box-Muller transform)
        const u1 = Math.random();
        const u2 = Math.random();
        const randNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        projection.push(randNormal);
      }
      projections.push(projection);
    }
    
    return projections;
  }

  private computeHashes(vector: number[]): string[] {
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

  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
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

  async searchApproximate(queryVector: number[], k: number): Promise<SearchResult[]> {
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