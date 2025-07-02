/**
 * Unit tests for VectorizeUseCase
 */

import { describe, it, expect, vi } from 'vitest';
import { VectorizeUseCase } from '../../src/use-cases/vectorize-use-case';
import { VectorizeOptions } from '../../src/use-cases/vectorize-options';

// Mock dependencies
const mockStorage = {
  getSnapshots: vi.fn(),
  getFunctionsWithDescriptions: vi.fn(),
  getFunctionsWithoutEmbeddings: vi.fn(),
  getEmbeddingStats: vi.fn(),
  bulkSaveEmbeddings: vi.fn(),
} as any;

const mockEmbeddingService = {
  generateFunctionEmbeddings: vi.fn(),
} as any;

describe('VectorizeUseCase', () => {
  describe('error handling with appropriate empty data', () => {
    it('should return appropriate empty VectorizeData for vectorize operations', async () => {
      const useCase = new VectorizeUseCase({
        storage: mockStorage,
        embeddingService: mockEmbeddingService
      });

      // Mock storage to throw an error
      mockStorage.getSnapshots.mockRejectedValue(new Error('Storage error'));

      const options: VectorizeOptions = {
        recent: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('vectorize');
      expect(result.errors).toEqual(['Storage error']);
      
      // Verify the data structure matches VectorizeData
      expect(result.data).toEqual({
        functionsProcessed: 0,
        model: 'text-embedding-3-small',
        dimension: 1536,
        batchSize: 100,
        embeddings: []
      });
    });

    it('should return appropriate empty StatusData for status operations', async () => {
      const useCase = new VectorizeUseCase({
        storage: mockStorage,
        embeddingService: undefined
      });

      // Mock storage to throw an error
      mockStorage.getEmbeddingStats.mockRejectedValue(new Error('Stats error'));

      const options: VectorizeOptions = {
        status: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('status');
      expect(result.errors).toEqual(['Stats error']);
      
      // Verify the data structure matches StatusData
      expect(result.data).toEqual({
        total: 0,
        withEmbeddings: 0,
        withoutEmbeddings: 0,
        coverage: 0,
        models: [],
        indexStatus: { isBuilt: false }
      });
    });

    it('should return appropriate empty IndexData for rebuild-index operations', async () => {
      const useCase = new VectorizeUseCase({
        storage: mockStorage,
        embeddingService: mockEmbeddingService
      });

      const options: VectorizeOptions = {
        rebuildIndex: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(false);
      expect(result.operation).toBe('rebuild-index');
      expect(result.errors).toEqual(['Index rebuilding feature is not yet available with current embedding service']);
      
      // Verify the data structure matches IndexData
      expect(result.data).toEqual({
        algorithm: 'hierarchical',
        vectorCount: 0,
        buildTime: 0,
        indexSize: 0
      });
    });

    it('should return appropriate empty BenchmarkData for benchmark operations', async () => {
      const useCase = new VectorizeUseCase({
        storage: mockStorage,
        embeddingService: mockEmbeddingService
      });

      const options: VectorizeOptions = {
        benchmark: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true); // benchmark returns mock data successfully
      expect(result.operation).toBe('benchmark');
      
      // Verify the data structure matches BenchmarkData
      expect(result.data).toEqual({
        algorithm: 'hierarchical',
        queryCount: 100,
        avgQueryTime: 5.2,
        accuracy: 0.95,
        throughput: 192.3
      });
    });
  });
});