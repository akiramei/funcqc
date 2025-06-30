import { describe, it, expect } from 'vitest';
import { BatchProcessor } from '../src/utils/batch-processor';

describe('BatchProcessor', () => {
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

  it('should calculate optimal batch size', () => {
    const batchSize = BatchProcessor.getOptimalBatchSize(1000, 5, 100);
    expect(batchSize).toBeGreaterThan(0);
    expect(batchSize).toBeLessThanOrEqual(1000);
  });
});