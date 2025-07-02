import { describe, it, expect, beforeEach } from 'vitest';
import { 
  HierarchicalIndex, 
  LSHIndex, 
  HybridANNIndex, 
  createANNIndex, 
  DEFAULT_ANN_CONFIG,
  ANNConfig,
  EmbeddingVector 
} from '../../src/services/ann-index';

describe('ANN Index Services', () => {
  let testEmbeddings: EmbeddingVector[];
  let config: ANNConfig;

  beforeEach(() => {
    // Create test embeddings (simplified 3D vectors for testing)
    testEmbeddings = [
      { id: '1', semanticId: 'sem1', vector: [1, 0, 0], metadata: { test: true } },
      { id: '2', semanticId: 'sem2', vector: [0, 1, 0], metadata: { test: true } },
      { id: '3', semanticId: 'sem3', vector: [0, 0, 1], metadata: { test: true } },
      { id: '4', semanticId: 'sem4', vector: [0.7, 0.7, 0], metadata: { test: true } },
      { id: '5', semanticId: 'sem5', vector: [0.5, 0.5, 0.5], metadata: { test: true } }
    ];

    config = {
      algorithm: 'hierarchical',
      clusterCount: 2,
      hashBits: 8,
      approximationLevel: 'balanced',
      cacheSize: 10
    };
  });

  describe('HierarchicalIndex', () => {
    it('should create index with correct configuration', () => {
      const index = new HierarchicalIndex(config);
      const stats = index.getIndexStats();
      
      expect(stats.config).toEqual(config);
      expect(stats.clusterCount).toBe(0); // No clusters before building
      expect(stats.totalVectors).toBe(0);
    });

    it('should build index with embeddings', async () => {
      const index = new HierarchicalIndex(config);
      await index.buildIndex(testEmbeddings);
      
      const stats = index.getIndexStats();
      expect(stats.clusterCount).toBe(config.clusterCount);
      expect(stats.totalVectors).toBe(testEmbeddings.length);
      expect(stats.averageClusterSize).toBeGreaterThan(0);
    });

    it('should perform approximate search', async () => {
      const index = new HierarchicalIndex(config);
      await index.buildIndex(testEmbeddings);
      
      // Search for vector similar to [1, 0, 0]
      const results = await index.searchApproximate([0.9, 0.1, 0], 2);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(2);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('semanticId');
      expect(results[0]).toHaveProperty('similarity');
      expect(results[0].similarity).toBeGreaterThan(0);
    });

    it('should cache search results', async () => {
      const index = new HierarchicalIndex(config);
      await index.buildIndex(testEmbeddings);
      
      const queryVector = [0.9, 0.1, 0];
      
      // First search
      const results1 = await index.searchApproximate(queryVector, 2);
      const stats1 = index.getIndexStats();
      
      // Second identical search (should be cached)
      const results2 = await index.searchApproximate(queryVector, 2);
      const stats2 = index.getIndexStats();
      
      expect(results1).toEqual(results2);
      expect(stats2.cacheSize).toBeGreaterThan(0);
    });

    it('should handle empty embeddings gracefully', async () => {
      const index = new HierarchicalIndex(config);
      await index.buildIndex([]);
      
      const results = await index.searchApproximate([1, 0, 0], 5);
      expect(results).toEqual([]);
    });

    it('should respect approximation levels', async () => {
      const fastConfig = { ...config, approximationLevel: 'fast' as const };
      const accurateConfig = { ...config, approximationLevel: 'accurate' as const };
      
      const fastIndex = new HierarchicalIndex(fastConfig);
      const accurateIndex = new HierarchicalIndex(accurateConfig);
      
      await fastIndex.buildIndex(testEmbeddings);
      await accurateIndex.buildIndex(testEmbeddings);
      
      const query = [0.9, 0.1, 0];
      const fastResults = await fastIndex.searchApproximate(query, 3);
      const accurateResults = await accurateIndex.searchApproximate(query, 3);
      
      // Both should return results (exact comparison would require larger dataset)
      expect(fastResults.length).toBeGreaterThan(0);
      expect(accurateResults.length).toBeGreaterThan(0);
    });
  });

  describe('LSHIndex', () => {
    it('should create LSH index with correct configuration', () => {
      const lshConfig = { ...config, algorithm: 'lsh' as const };
      const index = new LSHIndex(lshConfig);
      const stats = index.getIndexStats();
      
      expect(stats.config).toEqual(lshConfig);
      expect(stats.totalVectors).toBe(0);
      expect(stats.tableCount).toBe(0);
    });

    it('should build LSH index with embeddings', async () => {
      const lshConfig = { ...config, algorithm: 'lsh' as const };
      const index = new LSHIndex(lshConfig);
      await index.buildIndex(testEmbeddings);
      
      const stats = index.getIndexStats();
      expect(stats.totalVectors).toBe(testEmbeddings.length);
      expect(stats.tableCount).toBeGreaterThan(0);
      expect(stats.totalBuckets).toBeGreaterThan(0);
    });

    it('should perform LSH approximate search', async () => {
      const lshConfig = { ...config, algorithm: 'lsh' as const };
      const index = new LSHIndex(lshConfig);
      await index.buildIndex(testEmbeddings);
      
      const results = await index.searchApproximate([0.9, 0.1, 0], 2);
      
      expect(results.length).toBeGreaterThanOrEqual(0);
      expect(results.length).toBeLessThanOrEqual(2);
      
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('id');
        expect(results[0]).toHaveProperty('similarity');
      }
    });

    it('should cache LSH search results', async () => {
      const lshConfig = { ...config, algorithm: 'lsh' as const };
      const index = new LSHIndex(lshConfig);
      await index.buildIndex(testEmbeddings);
      
      const queryVector = [0.9, 0.1, 0];
      
      // First search
      await index.searchApproximate(queryVector, 2);
      const stats = index.getIndexStats();
      
      expect(stats.cacheSize).toBeGreaterThan(0);
    });
  });

  describe('HybridANNIndex', () => {
    it('should create hybrid index', () => {
      const hybridConfig = { ...config, algorithm: 'hybrid' as const };
      const index = new HybridANNIndex(hybridConfig);
      const stats = index.getIndexStats();
      
      expect(stats.algorithm).toBe('hybrid');
      expect(stats).toHaveProperty('hierarchical');
      expect(stats).toHaveProperty('lsh');
    });

    it('should build hybrid index', async () => {
      const hybridConfig = { ...config, algorithm: 'hybrid' as const };
      const index = new HybridANNIndex(hybridConfig);
      await index.buildIndex(testEmbeddings);
      
      const stats = index.getIndexStats();
      expect(stats.algorithm).toBe('hybrid');
      
      // Both sub-indexes should be built
      const hierarchicalStats = stats.hierarchical as Record<string, unknown>;
      const lshStats = stats.lsh as Record<string, unknown>;
      
      expect(hierarchicalStats.totalVectors).toBe(testEmbeddings.length);
      expect(lshStats.totalVectors).toBe(testEmbeddings.length);
    });

    it('should perform hybrid search combining both algorithms', async () => {
      const hybridConfig = { ...config, algorithm: 'hybrid' as const };
      const index = new HybridANNIndex(hybridConfig);
      await index.buildIndex(testEmbeddings);
      
      const results = await index.searchApproximate([0.9, 0.1, 0], 3);
      
      expect(results.length).toBeGreaterThanOrEqual(0);
      expect(results.length).toBeLessThanOrEqual(3);
      
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('similarity');
        // Hybrid results should be sorted by similarity
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
        }
      }
    });
  });

  describe('Factory function', () => {
    it('should create correct index type based on algorithm', () => {
      const hierarchicalIndex = createANNIndex({ ...config, algorithm: 'hierarchical' });
      const lshIndex = createANNIndex({ ...config, algorithm: 'lsh' });
      const hybridIndex = createANNIndex({ ...config, algorithm: 'hybrid' });
      
      expect(hierarchicalIndex).toBeInstanceOf(HierarchicalIndex);
      expect(lshIndex).toBeInstanceOf(LSHIndex);
      expect(hybridIndex).toBeInstanceOf(HybridANNIndex);
    });

    it('should throw error for unsupported algorithm', () => {
      expect(() => {
        createANNIndex({ ...config, algorithm: 'unsupported' as any });
      }).toThrow('Unsupported ANN algorithm: unsupported');
    });
  });

  describe('DEFAULT_ANN_CONFIG', () => {
    it('should have valid default configuration', () => {
      expect(DEFAULT_ANN_CONFIG.algorithm).toBeDefined();
      expect(DEFAULT_ANN_CONFIG.clusterCount).toBeGreaterThan(0);
      expect(DEFAULT_ANN_CONFIG.hashBits).toBeGreaterThan(0);
      expect(DEFAULT_ANN_CONFIG.approximationLevel).toBeDefined();
      expect(DEFAULT_ANN_CONFIG.cacheSize).toBeGreaterThan(0);
    });

    it('should create working index with default config', async () => {
      const index = createANNIndex(DEFAULT_ANN_CONFIG);
      await index.buildIndex(testEmbeddings);
      
      const results = await index.searchApproximate([1, 0, 0], 2);
      expect(results).toBeDefined();
    });
  });

  describe('Performance characteristics', () => {
    it('should handle larger datasets efficiently', async () => {
      // Create larger test dataset
      const largeEmbeddings: EmbeddingVector[] = [];
      for (let i = 0; i < 100; i++) {
        largeEmbeddings.push({
          id: `large-${i}`,
          semanticId: `sem-large-${i}`,
          vector: [Math.random(), Math.random(), Math.random()],
          metadata: { index: i }
        });
      }

      const index = new HierarchicalIndex(config);
      
      const buildStart = Date.now();
      await index.buildIndex(largeEmbeddings);
      const buildTime = Date.now() - buildStart;
      
      const searchStart = Date.now();
      const results = await index.searchApproximate([0.5, 0.5, 0.5], 10);
      const searchTime = Date.now() - searchStart;
      
      // Basic performance expectations (configurable for different environments)
      const buildTimeLimit = parseInt(process.env['ANN_BUILD_TIME_LIMIT'] || '5000', 10);
      const searchTimeLimit = parseInt(process.env['ANN_SEARCH_TIME_LIMIT'] || '1000', 10);
      expect(buildTime).toBeLessThan(buildTimeLimit);
      expect(searchTime).toBeLessThan(searchTimeLimit);
      expect(results.length).toBeLessThanOrEqual(10);
      
      const stats = index.getIndexStats();
      expect(stats.totalVectors).toBe(largeEmbeddings.length);
    });

    it('should maintain similarity ordering', async () => {
      const index = new HierarchicalIndex(config);
      await index.buildIndex(testEmbeddings);
      
      const results = await index.searchApproximate([1, 0, 0], 5);
      
      // Results should be ordered by similarity (descending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });
  });

  describe('Error handling', () => {
    it('should handle search on unbuilt index', async () => {
      const index = new HierarchicalIndex(config);
      const results = await index.searchApproximate([1, 0, 0], 5);
      expect(results).toEqual([]);
    });

    it('should handle invalid vector dimensions gracefully', async () => {
      const index = new HierarchicalIndex(config);
      await index.buildIndex(testEmbeddings);
      
      // This test would depend on implementation - some might throw, others might handle gracefully
      const results = await index.searchApproximate([1], 2); // Wrong dimension
      expect(results).toBeDefined(); // Should not crash
    });
  });
});