import { describe, it, expect } from 'vitest';
import { BatchProcessor, TransactionalBatchProcessor } from '../src/utils/batch-processor';

describe('BatchProcessor', () => {
  describe('batchArray', () => {
    it('should batch arrays correctly', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const batches = BatchProcessor.batchArray(items, 3);
      
      expect(batches).toHaveLength(4);
      expect(batches[0]).toEqual([1, 2, 3]);
      expect(batches[1]).toEqual([4, 5, 6]);
      expect(batches[2]).toEqual([7, 8, 9]);
      expect(batches[3]).toEqual([10]);
    });

    it('should handle empty arrays', () => {
      const items: number[] = [];
      const batches = BatchProcessor.batchArray(items, 5);
      
      expect(batches).toHaveLength(0);
    });

    it('should use default batch size when not specified', () => {
      const items = Array(250).fill(0);
      const batches = BatchProcessor.batchArray(items);
      
      expect(batches).toHaveLength(3); // 250/100 = 2.5 -> 3 batches
      expect(batches[0]).toHaveLength(100);
      expect(batches[2]).toHaveLength(50);
    });

    it('should throw error for invalid batch size', () => {
      expect(() => BatchProcessor.batchArray([1, 2, 3], 0)).toThrow('Batch size must be greater than 0');
      expect(() => BatchProcessor.batchArray([1, 2, 3], -5)).toThrow('Batch size must be greater than 0');
    });
  });

  describe('processWithProgress', () => {
    it('should process items with progress callback', async () => {
      const items = [1, 2, 3, 4, 5];
      const results: number[] = [];
      const progressUpdates: Array<{ completed: number; total: number }> = [];
      
      const processed = await BatchProcessor.processWithProgress(
        items,
        async (item) => item * 2,
        (completed, total) => progressUpdates.push({ completed, total }),
        2 // batch size of 2
      );
      
      expect(processed).toEqual([2, 4, 6, 8, 10]);
      expect(progressUpdates).toHaveLength(3); // 3 batches: [1,2], [3,4], [5]
      expect(progressUpdates[0]).toEqual({ completed: 2, total: 5 });
      expect(progressUpdates[2]).toEqual({ completed: 5, total: 5 });
    });
  });

  describe('getOptimalBatchSize', () => {
    it('should calculate optimal batch size for different dataset sizes', () => {
      // Small dataset
      expect(BatchProcessor.getOptimalBatchSize(500, 5, 100)).toBeLessThanOrEqual(500);
      
      // Medium dataset
      const mediumBatch = BatchProcessor.getOptimalBatchSize(2000, 5, 100);
      expect(mediumBatch).toBeLessThanOrEqual(200);
      
      // Large dataset
      const largeBatch = BatchProcessor.getOptimalBatchSize(6000, 5, 100);
      expect(largeBatch).toBeLessThanOrEqual(100);
      
      // Very large dataset
      const xlBatch = BatchProcessor.getOptimalBatchSize(15000, 5, 100);
      expect(xlBatch).toBeLessThanOrEqual(50);
    });

    it('should respect memory constraints', () => {
      const batchSize = BatchProcessor.getOptimalBatchSize(1000, 10, 50); // 10KB per item, 50MB max
      const expectedMax = Math.floor((50 * 1024) / 10); // ~5120 items
      expect(batchSize).toBeLessThanOrEqual(expectedMax);
    });
  });
});

describe('TransactionalBatchProcessor', () => {
  it('should process batches successfully', async () => {
    const items = [1, 2, 3, 4, 5];
    const processedBatches: number[][] = [];
    const successBatches: number[][] = [];
    
    await TransactionalBatchProcessor.processWithTransaction(
      items,
      {
        processBatch: async (batch) => {
          processedBatches.push([...batch]);
        },
        onError: async () => {},
        onSuccess: async (batch) => {
          successBatches.push([...batch]);
        }
      },
      2
    );
    
    expect(processedBatches).toHaveLength(3);
    expect(successBatches).toHaveLength(3);
    expect(processedBatches[0]).toEqual([1, 2]);
    expect(processedBatches[2]).toEqual([5]);
  });

  it('should handle errors and stop processing', async () => {
    const items = [1, 2, 3, 4, 5];
    const processedBatches: number[][] = [];
    let errorBatch: number[] | null = null;
    
    await expect(
      TransactionalBatchProcessor.processWithTransaction(
        items,
        {
          processBatch: async (batch) => {
            processedBatches.push([...batch]);
            if (batch.includes(3)) {
              throw new Error('Test error');
            }
          },
          onError: async (error, batch) => {
            errorBatch = [...batch];
          },
          onSuccess: async () => {}
        },
        2
      )
    ).rejects.toThrow('Test error');
    
    expect(processedBatches).toHaveLength(2); // Only processed first 2 batches
    expect(errorBatch).toEqual([3, 4]); // Error occurred on second batch
  });
});