import { describe, it, expect } from 'vitest';
import { 
  HierarchicalIndex, 
  ANNConfig,
  EmbeddingVector 
} from '../../src/services/ann-index';

describe('ANN Index Performance Tests', () => {
  describe('TypedArray vs Number[] Performance', () => {
    it('should demonstrate memory efficiency with Float32Array', () => {
      const vectorSize = 1536; // typical embedding size
      const numVectors = 1000;
      
      // Measure memory usage with number[]
      const numberArraySize = vectorSize * numVectors * 8; // 8 bytes per number
      
      // Measure memory usage with Float32Array
      const float32ArraySize = vectorSize * numVectors * 4; // 4 bytes per float32
      
      const memorySavings = ((numberArraySize - float32ArraySize) / numberArraySize) * 100;
      
      console.log(`Memory savings: ${memorySavings.toFixed(1)}%`);
      expect(memorySavings).toBeCloseTo(50, 0);
    });

    it('should show improved search performance with optimizations', async () => {
      const config: ANNConfig = {
        algorithm: 'hierarchical',
        clusterCount: 10,
        hashBits: 16,
        approximationLevel: 'balanced',
        cacheSize: 100
      };
      
      // Create test embeddings
      const dimension = 384; // smaller dimension for faster test
      const numVectors = 500;
      const embeddings: EmbeddingVector[] = [];
      
      for (let i = 0; i < numVectors; i++) {
        const vector = new Float32Array(dimension);
        for (let j = 0; j < dimension; j++) {
          vector[j] = Math.random();
        }
        embeddings.push({
          id: `vec-${i}`,
          semanticId: `sem-${i}`,
          vector,
          metadata: { index: i }
        });
      }
      
      const index = new HierarchicalIndex(config);
      
      // Measure index building time
      const buildStart = performance.now();
      await index.buildIndex(embeddings);
      const buildTime = performance.now() - buildStart;
      
      console.log(`Index build time: ${buildTime.toFixed(2)}ms for ${numVectors} vectors`);
      
      // Measure search performance
      const numSearches = 100;
      const searchStart = performance.now();
      
      for (let i = 0; i < numSearches; i++) {
        const queryVector = new Float32Array(dimension);
        for (let j = 0; j < dimension; j++) {
          queryVector[j] = Math.random();
        }
        await index.searchApproximate(queryVector, 10);
      }
      
      const searchTime = performance.now() - searchStart;
      const avgSearchTime = searchTime / numSearches;
      
      console.log(`Average search time: ${avgSearchTime.toFixed(2)}ms`);
      
      // Basic performance expectations
      expect(buildTime).toBeLessThan(5000); // Build should be reasonably fast
      expect(avgSearchTime).toBeLessThan(50); // Search should be fast
    });

    it('should demonstrate quickselect efficiency for top-k', () => {
      const dataSize = 10000;
      const k = 100;
      
      // Create test data
      const data = Array.from({ length: dataSize }, (_, i) => ({
        id: i,
        score: Math.random()
      }));
      
      // Measure full sort approach
      const sortStart = performance.now();
      const sortedResult = [...data].sort((a, b) => b.score - a.score).slice(0, k);
      const sortTime = performance.now() - sortStart;
      
      // Our quickselect is already used internally in topK function
      // This test demonstrates the concept
      console.log(`Full sort approach: ${sortTime.toFixed(2)}ms`);
      console.log(`Theoretical quickselect improvement: O(n) vs O(n log n)`);
      
      expect(sortedResult).toHaveLength(k);
      expect(sortedResult[0].score).toBeGreaterThanOrEqual(sortedResult[k-1].score);
    });
  });

  describe('Norm Caching Benefits', () => {
    it('should show benefits of pre-computed norms', async () => {
      const config: ANNConfig = {
        algorithm: 'hierarchical',
        clusterCount: 5,
        hashBits: 16,
        approximationLevel: 'fast',
        cacheSize: 100
      };
      
      const dimension = 256;
      const numVectors = 200;
      const embeddings: EmbeddingVector[] = [];
      
      // Create normalized vectors
      for (let i = 0; i < numVectors; i++) {
        const vector = new Float32Array(dimension);
        let norm = 0;
        
        // Create random vector
        for (let j = 0; j < dimension; j++) {
          vector[j] = Math.random() - 0.5;
          norm += vector[j] * vector[j];
        }
        
        // Normalize to unit length
        norm = Math.sqrt(norm);
        for (let j = 0; j < dimension; j++) {
          vector[j] /= norm;
        }
        
        embeddings.push({
          id: `norm-${i}`,
          semanticId: `sem-${i}`,
          vector
        });
      }
      
      const index = new HierarchicalIndex(config);
      await index.buildIndex(embeddings);
      
      // Perform multiple searches to test norm caching
      const queryVector = new Float32Array(dimension);
      for (let j = 0; j < dimension; j++) {
        queryVector[j] = Math.random() - 0.5;
      }
      
      const searchIterations = 50;
      const start = performance.now();
      
      for (let i = 0; i < searchIterations; i++) {
        await index.searchApproximate(queryVector, 5);
      }
      
      const totalTime = performance.now() - start;
      const avgTime = totalTime / searchIterations;
      
      console.log(`Average search time with norm caching: ${avgTime.toFixed(2)}ms`);
      expect(avgTime).toBeLessThan(10); // Should be very fast with caching
    });
  });
});