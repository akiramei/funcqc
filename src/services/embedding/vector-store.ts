/**
 * Enhanced vector store with incremental updates and buffering
 */

import {
  VectorStore,
  VectorStoreConfig,
  EmbeddingVector,
  SearchResult,
  SemanticSearchOptions
} from './interfaces';
import {
  HierarchicalIndex,
  LSHIndex,
  HybridANNIndex,
  createANNIndex,
  ANNConfig
} from '../ann-index';

interface BufferedOperation {
  type: 'add' | 'remove';
  embeddings?: EmbeddingVector[];
  ids?: string[];
  timestamp: number;
}

interface VectorStoreStats {
  totalVectors: number;
  indexedVectors: number;
  pendingOperations: number;
  lastRebuildTime?: number;
  rebuildCount: number;
  bufferHits: number;
  bufferMisses: number;
}

export class EnhancedVectorStore implements VectorStore {
  private annIndex: HierarchicalIndex | LSHIndex | HybridANNIndex | null = null;
  private vectorMap: Map<string, EmbeddingVector> = new Map();
  private operationBuffer: BufferedOperation[] = [];
  private bufferTimer: NodeJS.Timeout | null = null;
  private readonly config: Required<VectorStoreConfig>;
  private readonly stats: VectorStoreStats = {
    totalVectors: 0,
    indexedVectors: 0,
    pendingOperations: 0,
    rebuildCount: 0,
    bufferHits: 0,
    bufferMisses: 0
  };

  constructor(config: VectorStoreConfig = {}) {
    // Set defaults for all config options
    this.config = {
      algorithm: config.algorithm || 'hierarchical',
      clusterCount: config.clusterCount || 50,
      hashBits: config.hashBits || 16,
      approximationLevel: config.approximationLevel || 'balanced',
      cacheSize: config.cacheSize || 1000,
      bufferSize: config.bufferSize || 100,
      bufferTimeout: config.bufferTimeout || 5000
    };

    this.initializeIndex();
  }

  /**
   * Initialize ANN index based on configuration
   */
  private initializeIndex(): void {
    const annConfig: ANNConfig = {
      algorithm: this.config.algorithm,
      clusterCount: this.config.clusterCount,
      hashBits: this.config.hashBits,
      approximationLevel: this.config.approximationLevel,
      cacheSize: this.config.cacheSize
    };

    this.annIndex = createANNIndex(annConfig);
  }

  /**
   * Build initial index from embeddings
   */
  async buildIndex(embeddings: EmbeddingVector[]): Promise<void> {
    if (!this.annIndex) {
      throw new Error('ANN index not initialized');
    }

    // Clear existing state
    this.vectorMap.clear();
    this.clearBuffer();

    // Convert all vectors to Float32Array for consistency
    const optimizedEmbeddings = embeddings.map(embedding => ({
      ...embedding,
      vector: embedding.vector instanceof Float32Array 
        ? embedding.vector 
        : new Float32Array(embedding.vector)
    }));

    // Store in local map
    for (const embedding of optimizedEmbeddings) {
      this.vectorMap.set(embedding.id, embedding);
    }

    // Build index
    await this.annIndex.buildIndex(optimizedEmbeddings);

    // Update stats
    this.stats.totalVectors = embeddings.length;
    this.stats.indexedVectors = embeddings.length;
    this.stats.lastRebuildTime = Date.now();
    this.stats.rebuildCount++;
  }

  /**
   * Add new embeddings with buffering for performance
   */
  async addEmbeddings(embeddings: EmbeddingVector[]): Promise<void> {
    if (embeddings.length === 0) {
      return;
    }

    // Convert to Float32Array
    const optimizedEmbeddings = embeddings.map(embedding => ({
      ...embedding,
      vector: embedding.vector instanceof Float32Array 
        ? embedding.vector 
        : new Float32Array(embedding.vector)
    }));

    // Add to buffer
    this.operationBuffer.push({
      type: 'add',
      embeddings: optimizedEmbeddings,
      timestamp: Date.now()
    });

    this.stats.pendingOperations = this.operationBuffer.length;

    // Check if we should flush buffer
    if (this.shouldFlushBuffer()) {
      await this.flushBuffer();
    } else {
      this.scheduleBufferFlush();
    }
  }

  /**
   * Remove embeddings by IDs
   */
  async removeEmbeddings(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    // Add to buffer
    this.operationBuffer.push({
      type: 'remove',
      ids,
      timestamp: Date.now()
    });

    this.stats.pendingOperations = this.operationBuffer.length;

    // Check if we should flush buffer
    if (this.shouldFlushBuffer()) {
      await this.flushBuffer();
    } else {
      this.scheduleBufferFlush();
    }
  }

  /**
   * Perform search with buffer consideration
   */
  async search(
    queryVector: Float32Array, 
    k: number, 
    _options?: SemanticSearchOptions
  ): Promise<SearchResult[]> {
    if (!this.annIndex) {
      throw new Error('ANN index not initialized');
    }

    // Ensure buffer is flushed for most recent data
    if (this.operationBuffer.length > 0) {
      await this.flushBuffer();
    }

    // Check if we have any vectors to search
    if (this.vectorMap.size === 0) {
      return [];
    }

    try {
      const results = await this.annIndex.searchApproximate(queryVector, k);
      this.stats.bufferHits++;
      return results;
    } catch (error) {
      this.stats.bufferMisses++;
      throw error;
    }
  }

  /**
   * Check if index is ready
   */
  isReady(): boolean {
    return this.annIndex !== null && this.stats.indexedVectors > 0;
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): Record<string, unknown> {
    const indexStats = this.annIndex?.getIndexStats() || {};
    
    return {
      ...this.stats,
      config: this.config,
      indexStats,
      bufferUtilization: this.operationBuffer.length / this.config.bufferSize,
      hitRate: this.stats.bufferHits + this.stats.bufferMisses > 0
        ? this.stats.bufferHits / (this.stats.bufferHits + this.stats.bufferMisses)
        : 0
    };
  }

  /**
   * Clear index and reset state
   */
  async clear(): Promise<void> {
    this.vectorMap.clear();
    this.clearBuffer();
    this.initializeIndex();
    
    this.stats.totalVectors = 0;
    this.stats.indexedVectors = 0;
    this.stats.pendingOperations = 0;
  }

  /**
   * Get embeddings by IDs
   */
  async getEmbeddings(ids: string[]): Promise<EmbeddingVector[]> {
    const embeddings: EmbeddingVector[] = [];
    
    for (const id of ids) {
      const embedding = this.vectorMap.get(id);
      if (embedding) {
        embeddings.push(embedding);
      }
    }
    
    return embeddings;
  }

  /**
   * Check if buffer should be flushed
   */
  private shouldFlushBuffer(): boolean {
    return this.operationBuffer.length >= this.config.bufferSize;
  }

  /**
   * Schedule buffer flush after timeout
   */
  private scheduleBufferFlush(): void {
    if (this.bufferTimer) {
      return; // Timer already scheduled
    }

    this.bufferTimer = setTimeout(async () => {
      await this.flushBuffer();
    }, this.config.bufferTimeout);
  }

  /**
   * Flush buffered operations to index
   */
  private async flushBuffer(): Promise<void> {
    if (this.operationBuffer.length === 0) {
      return;
    }

    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }

    // Process buffered operations
    for (const operation of this.operationBuffer) {
      if (operation.type === 'add' && operation.embeddings) {
        // Add to local storage
        for (const embedding of operation.embeddings) {
          this.vectorMap.set(embedding.id, embedding);
        }
      } else if (operation.type === 'remove' && operation.ids) {
        // Remove from local storage
        for (const id of operation.ids) {
          this.vectorMap.delete(id);
        }
      }
    }

    // Rebuild index with current state
    if (this.annIndex && this.vectorMap.size > 0) {
      const allVectors = Array.from(this.vectorMap.values());
      await this.annIndex.buildIndex(allVectors);
      
      this.stats.indexedVectors = allVectors.length;
      this.stats.lastRebuildTime = Date.now();
      this.stats.rebuildCount++;
    }

    // Update stats
    this.stats.totalVectors = this.vectorMap.size;
    this.stats.pendingOperations = 0;
    
    // Clear buffer
    this.operationBuffer = [];
  }

  /**
   * Clear buffer and timer
   */
  private clearBuffer(): void {
    this.operationBuffer = [];
    this.stats.pendingOperations = 0;
    
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
  }
}