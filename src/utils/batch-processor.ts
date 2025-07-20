import { FunctionInfo } from '../types';

/**
 * Utility for processing large datasets in batches to optimize memory usage and performance
 */
export class BatchProcessor {
  public static readonly DEFAULT_BATCH_SIZE = 100;

  /**
   * Split an array into smaller batches
   */
  static batchArray<T>(array: T[], batchSize: number = BatchProcessor.DEFAULT_BATCH_SIZE): T[][] {
    if (batchSize <= 0) {
      throw new Error('Batch size must be greater than 0');
    }

    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process functions in batches with callback
   */
  static async processFunctionsBatch<TResult>(
    functions: FunctionInfo[],
    processor: (batch: FunctionInfo[]) => Promise<TResult>,
    batchSize: number = BatchProcessor.DEFAULT_BATCH_SIZE
  ): Promise<TResult[]> {
    const batches = BatchProcessor.batchArray(functions, batchSize);
    const results: TResult[] = [];

    for (const batch of batches) {
      const result = await processor(batch);
      results.push(result);
    }

    return results;
  }

  /**
   * Process items with progress callback
   */
  static async processWithProgress<T, TResult>(
    items: T[],
    processor: (item: T) => Promise<TResult>,
    onProgress?: (completed: number, total: number) => void,
    batchSize: number = BatchProcessor.DEFAULT_BATCH_SIZE
  ): Promise<TResult[]> {
    const results: TResult[] = [];
    const batches = BatchProcessor.batchArray(items, batchSize);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);

      if (onProgress) {
        const completed = (batchIndex + 1) * batchSize;
        onProgress(Math.min(completed, items.length), items.length);
      }
    }

    return results;
  }

  /**
   * Get optimal batch size based on memory constraints
   */
  static getOptimalBatchSize(
    itemCount: number,
    estimatedItemSizeKB: number = 5,
    maxMemoryMB: number = 100
  ): number {
    const maxMemoryKB = maxMemoryMB * 1024;
    const maxItemsInMemory = Math.floor(maxMemoryKB / estimatedItemSizeKB);

    // Use larger batches for better database performance (bulk operations are much faster)
    if (itemCount > 1000) return Math.min(maxItemsInMemory, 1000);

    return Math.min(maxItemsInMemory, 500);
  }

  /**
   * Calculate memory-safe batch size for functions
   */
  static calculateFunctionBatchSize(functions: FunctionInfo[]): number {
    if (functions.length === 0) return BatchProcessor.DEFAULT_BATCH_SIZE;

    // Estimate function size based on source code length
    const sampleFunc = functions[0];
    const estimatedSize = (sampleFunc.sourceCode?.length || 1000) / 1024; // KB

    return BatchProcessor.getOptimalBatchSize(functions.length, estimatedSize);
  }
}

/**
 * Interface for batch processing operations with transactions
 */
export interface BatchTransactionProcessor<T> {
  processBatch(items: T[]): Promise<void>;
  onError(error: Error, batch: T[]): Promise<void>;
  onSuccess(batch: T[]): Promise<void>;
}

/**
 * Enhanced batch processor with transaction support
 */
export class TransactionalBatchProcessor {
  /**
   * Process items in batches with transaction support
   */
  static async processWithTransaction<T>(
    items: T[],
    processor: BatchTransactionProcessor<T>,
    batchSize: number = BatchProcessor.DEFAULT_BATCH_SIZE,
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    const batches = BatchProcessor.batchArray(items, batchSize);
    let processedCount = 0;

    for (const batch of batches) {
      try {
        await processor.processBatch(batch);
        await processor.onSuccess(batch);
        processedCount += batch.length;

        if (onProgress) {
          onProgress(processedCount, items.length);
        }
      } catch (error) {
        await processor.onError(error as Error, batch);
        throw error; // Re-throw to stop processing
      }
    }
  }
}
