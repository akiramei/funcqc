import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EnhancedVectorStore } from '../../../src/services/embedding/vector-store';
import { EmbeddingVector } from '../../../src/services/embedding/interfaces';

describe('EnhancedVectorStore', () => {
  let vectorStore: EnhancedVectorStore;
  let mockEmbeddings: EmbeddingVector[];

  beforeEach(() => {
    vectorStore = new EnhancedVectorStore({
      algorithm: 'hierarchical',
      clusterCount: 10,
      approximationLevel: 'fast',
      cacheSize: 100,
      bufferSize: 5, // Small buffer for testing
      bufferTimeout: 1000
    });

    // Create mock embeddings
    mockEmbeddings = [
      {
        id: 'vec1',
        semanticId: 'sem1',
        vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
        metadata: { test: 'data1' }
      },
      {
        id: 'vec2',
        semanticId: 'sem2',
        vector: new Float32Array([0.5, 0.6, 0.7, 0.8]),
        metadata: { test: 'data2' }
      },
      {
        id: 'vec3',
        semanticId: 'sem3',
        vector: new Float32Array([0.9, 0.1, 0.2, 0.3]),
        metadata: { test: 'data3' }
      }
    ];
  });

  afterEach(() => {
    // Clean up any timers
    vi.clearAllTimers();
  });

  describe('Index Building', () => {
    it('should build index successfully', async () => {
      expect(vectorStore.isReady()).toBe(false);
      
      await vectorStore.buildIndex(mockEmbeddings);
      
      expect(vectorStore.isReady()).toBe(true);
      
      const stats = vectorStore.getStats();
      expect(stats.totalVectors).toBe(3);
      expect(stats.indexedVectors).toBe(3);
    });

    it('should handle empty embeddings', async () => {
      await vectorStore.buildIndex([]);
      
      expect(vectorStore.isReady()).toBe(false);
      const stats = vectorStore.getStats();
      expect(stats.totalVectors).toBe(0);
    });

    it('should convert number arrays to Float32Array', async () => {
      const numbersEmbedding: EmbeddingVector = {
        id: 'vec4',
        semanticId: 'sem4',
        vector: [0.1, 0.2, 0.3, 0.4] as any, // number[] instead of Float32Array
        metadata: { test: 'conversion' }
      };

      await vectorStore.buildIndex([numbersEmbedding]);
      
      const retrieved = await vectorStore.getEmbeddings(['vec4']);
      expect(retrieved[0].vector).toBeInstanceOf(Float32Array);
    });
  });

  describe('Incremental Updates', () => {
    beforeEach(async () => {
      await vectorStore.buildIndex(mockEmbeddings.slice(0, 2)); // Start with 2 embeddings
    });

    it('should add embeddings to buffer', async () => {
      const newEmbedding: EmbeddingVector = {
        id: 'vec4',
        semanticId: 'sem4',
        vector: new Float32Array([0.2, 0.3, 0.4, 0.5]),
        metadata: { test: 'new' }
      };

      await vectorStore.addEmbeddings([newEmbedding]);
      
      const stats = vectorStore.getStats();
      expect(stats.pendingOperations).toBe(1);
    });

    it('should flush buffer when size limit reached', async () => {
      const newEmbeddings: EmbeddingVector[] = [];
      
      // Add enough embeddings to trigger buffer flush
      for (let i = 0; i < 6; i++) {
        newEmbeddings.push({
          id: `vec${i + 10}`,
          semanticId: `sem${i + 10}`,
          vector: new Float32Array([0.1 * i, 0.2 * i, 0.3 * i, 0.4 * i]),
          metadata: { test: `batch${i}` }
        });
      }

      await vectorStore.addEmbeddings(newEmbeddings);
      
      const stats = vectorStore.getStats();
      expect(stats.pendingOperations).toBe(0); // Should be flushed
      expect(stats.totalVectors).toBe(8); // 2 initial + 6 new
    });

    it('should flush buffer on timeout', async () => {
      vi.useFakeTimers();
      
      const newEmbedding: EmbeddingVector = {
        id: 'vec_timeout',
        semanticId: 'sem_timeout',
        vector: new Float32Array([0.1, 0.1, 0.1, 0.1]),
        metadata: { test: 'timeout' }
      };

      await vectorStore.addEmbeddings([newEmbedding]);
      
      let stats = vectorStore.getStats();
      expect(stats.pendingOperations).toBe(1);
      
      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(1100); // Buffer timeout is 1000ms
      
      // Wait for async operation to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      stats = vectorStore.getStats();
      expect(stats.pendingOperations).toBe(0);
      
      vi.useRealTimers();
    });

    it('should handle remove operations', async () => {
      await vectorStore.removeEmbeddings(['vec1']);
      
      const stats = vectorStore.getStats();
      expect(stats.pendingOperations).toBe(1);
      
      // Force flush to apply removal
      await vectorStore.addEmbeddings([]); // This will trigger flush
      
      const finalStats = vectorStore.getStats();
      expect(finalStats.totalVectors).toBe(1); // Only vec2 should remain
    });
  });

  describe('Search Operations', () => {
    beforeEach(async () => {
      await vectorStore.buildIndex(mockEmbeddings);
    });

    it('should perform search successfully', async () => {
      const queryVector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      
      const results = await vectorStore.search(queryVector, 2);
      
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('similarity');
      expect(typeof results[0].similarity).toBe('number');
    });

    it('should flush buffer before search', async () => {
      const newEmbedding: EmbeddingVector = {
        id: 'vec_search',
        semanticId: 'sem_search',
        vector: new Float32Array([0.05, 0.15, 0.25, 0.35]),
        metadata: { test: 'search' }
      };

      await vectorStore.addEmbeddings([newEmbedding]);
      
      // Search should trigger buffer flush
      const queryVector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const results = await vectorStore.search(queryVector, 5);
      
      // Should include the new embedding in results
      expect(results.length).toBeGreaterThan(0);
      
      const stats = vectorStore.getStats();
      expect(stats.pendingOperations).toBe(0); // Buffer should be flushed
    });

    it('should handle search with no vectors gracefully', async () => {
      // Clear the index to have no vectors
      await vectorStore.clear();
      
      const queryVector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      
      const results = await vectorStore.search(queryVector, 2);
      expect(results).toEqual([]);
    });
  });

  describe('Data Retrieval', () => {
    beforeEach(async () => {
      await vectorStore.buildIndex(mockEmbeddings);
    });

    it('should retrieve embeddings by IDs', async () => {
      const retrieved = await vectorStore.getEmbeddings(['vec1', 'vec3']);
      
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0].id).toBe('vec1');
      expect(retrieved[1].id).toBe('vec3');
    });

    it('should handle non-existent IDs', async () => {
      const retrieved = await vectorStore.getEmbeddings(['vec1', 'nonexistent']);
      
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].id).toBe('vec1');
    });

    it('should return empty array for all non-existent IDs', async () => {
      const retrieved = await vectorStore.getEmbeddings(['nonexistent1', 'nonexistent2']);
      
      expect(retrieved).toHaveLength(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(async () => {
      await vectorStore.buildIndex(mockEmbeddings);
    });

    it('should provide comprehensive statistics', () => {
      const stats = vectorStore.getStats();
      
      expect(stats).toHaveProperty('totalVectors');
      expect(stats).toHaveProperty('indexedVectors');
      expect(stats).toHaveProperty('pendingOperations');
      expect(stats).toHaveProperty('config');
      expect(stats).toHaveProperty('indexStats');
      expect(stats).toHaveProperty('rebuildCount');
    });

    it('should track rebuild operations', async () => {
      const initialStats = vectorStore.getStats();
      const initialRebuildCount = initialStats.rebuildCount;
      
      await vectorStore.buildIndex(mockEmbeddings);
      
      const newStats = vectorStore.getStats();
      expect(newStats.rebuildCount).toBe(initialRebuildCount + 1);
      expect(newStats.lastRebuildTime).toBeGreaterThan(0);
    });

    it('should calculate buffer utilization', async () => {
      const newEmbedding: EmbeddingVector = {
        id: 'vec_util',
        semanticId: 'sem_util',
        vector: new Float32Array([0.1, 0.1, 0.1, 0.1]),
        metadata: { test: 'utilization' }
      };

      await vectorStore.addEmbeddings([newEmbedding]);
      
      const stats = vectorStore.getStats();
      expect(stats.bufferUtilization).toBeGreaterThan(0);
      expect(stats.bufferUtilization).toBeLessThanOrEqual(1);
    });

    it('should track hit rate', async () => {
      const queryVector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      
      // Perform successful search
      await vectorStore.search(queryVector, 2);
      
      const stats = vectorStore.getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });

  describe('Configuration', () => {
    it('should use default configuration when none provided', () => {
      const defaultStore = new EnhancedVectorStore();
      const stats = defaultStore.getStats();
      
      expect(stats.config).toHaveProperty('algorithm', 'hierarchical');
      expect(stats.config).toHaveProperty('clusterCount', 50);
      expect(stats.config).toHaveProperty('approximationLevel', 'balanced');
    });

    it('should merge provided configuration with defaults', () => {
      const customStore = new EnhancedVectorStore({
        clusterCount: 25,
        bufferSize: 200
      });
      
      const stats = customStore.getStats();
      expect(stats.config.clusterCount).toBe(25);
      expect(stats.config.bufferSize).toBe(200);
      expect(stats.config.algorithm).toBe('hierarchical'); // Default
    });
  });

  describe('Clear Operations', () => {
    beforeEach(async () => {
      await vectorStore.buildIndex(mockEmbeddings);
    });

    it('should clear all data and reset state', async () => {
      expect(vectorStore.isReady()).toBe(true);
      
      await vectorStore.clear();
      
      expect(vectorStore.isReady()).toBe(false);
      
      const stats = vectorStore.getStats();
      expect(stats.totalVectors).toBe(0);
      expect(stats.indexedVectors).toBe(0);
      expect(stats.pendingOperations).toBe(0);
    });

    it('should allow rebuilding after clear', async () => {
      await vectorStore.clear();
      await vectorStore.buildIndex(mockEmbeddings.slice(0, 1));
      
      expect(vectorStore.isReady()).toBe(true);
      
      const stats = vectorStore.getStats();
      expect(stats.totalVectors).toBe(1);
    });
  });
});