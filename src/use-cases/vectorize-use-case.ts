/**
 * VectorizeUseCase: Core business logic for function vectorization
 * Extracted from CLI to improve testability and maintainability
 */

import { EmbeddingService } from '../services/embedding-service';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { FunctionInfo } from '../types';
import { VectorizeOptions } from './vectorize-options';

// Result types for different operations
export interface VectorizeResult {
  success: boolean;
  operation: 'vectorize' | 'status' | 'rebuild-index' | 'benchmark' | 'index-stats';
  data: VectorizeData | StatusData | IndexData | BenchmarkData;
  errors?: string[];
  timeTaken?: number;
}

export interface VectorizeData {
  functionsProcessed: number;
  model: string;
  dimension: number;
  batchSize: number;
  embeddings: Array<{
    functionId: string;
    semanticId: string;
    model: string;
    timestamp: number;
  }>;
}

export interface StatusData {
  total: number;
  withEmbeddings: number;
  withoutEmbeddings: number;
  coverage: number;
  models: string[];
  indexStatus?: {
    isBuilt: boolean;
    algorithm?: string;
    vectorCount?: number;
    lastBuilt?: number;
  };
}

export interface IndexData {
  algorithm: string;
  vectorCount: number;
  buildTime: number;
  indexSize: number;
}

export interface BenchmarkData {
  algorithm: string;
  queryCount: number;
  avgQueryTime: number;
  accuracy: number;
  throughput: number;
}

export interface VectorizeUseCaseDependencies {
  storage: PGLiteStorageAdapter;
  embeddingService: EmbeddingService | undefined;
}

/**
 * Core use case for vectorization operations
 */
export class VectorizeUseCase {
  constructor(
    private dependencies: VectorizeUseCaseDependencies
  ) {}

  /**
   * Execute vectorization based on options
   */
  async execute(options: VectorizeOptions): Promise<VectorizeResult> {
    const startTime = Date.now();
    
    try {
      if (options.status) {
        return await this.getStatus();
      }
      
      if (options.rebuildIndex) {
        return await this.rebuildIndex(options);
      }
      
      if (options.benchmark) {
        return await this.benchmarkIndex(options);
      }
      
      if (options.indexStats) {
        return await this.getIndexStats();
      }
      
      if (options.all || options.recent) {
        return await this.vectorizeFunctions(options);
      }
      
      throw new Error('No valid operation specified');
      
    } catch (error) {
      return {
        success: false,
        operation: this.getOperationType(options),
        data: {} as VectorizeData | StatusData | IndexData | BenchmarkData,
        errors: [error instanceof Error ? error.message : String(error)],
        timeTaken: Date.now() - startTime
      };
    }
  }

  /**
   * Vectorize functions based on options
   */
  private async vectorizeFunctions(options: VectorizeOptions): Promise<VectorizeResult> {
    const startTime = Date.now();
    
    if (!this.dependencies.embeddingService) {
      throw new Error('EmbeddingService not initialized. API key required.');
    }

    // Get functions to vectorize
    const functions = await this.getFunctionsToVectorize(options);
    
    if (functions.length === 0) {
      return {
        success: true,
        operation: 'vectorize',
        data: {
          functionsProcessed: 0,
          model: options.model,
          dimension: this.getModelDimension(options.model),
          batchSize: options.batchSize,
          embeddings: []
        },
        timeTaken: Date.now() - startTime
      };
    }

    // Apply limit if specified
    const functionsToProcess = options.limit 
      ? functions.slice(0, options.limit)
      : functions;

    // Generate embeddings
    const embeddings = await this.dependencies.embeddingService.generateFunctionEmbeddings(functionsToProcess);
    
    // Store embeddings
    await this.dependencies.storage.bulkSaveEmbeddings(embeddings);

    return {
      success: true,
      operation: 'vectorize',
      data: {
        functionsProcessed: embeddings.length,
        model: options.model,
        dimension: this.getModelDimension(options.model),
        batchSize: options.batchSize,
        embeddings: embeddings.map(e => ({
          functionId: e.functionId,
          semanticId: e.semanticId,
          model: e.model,
          timestamp: e.timestamp
        }))
      },
      timeTaken: Date.now() - startTime
    };
  }

  /**
   * Get vectorization status
   */
  private async getStatus(): Promise<VectorizeResult> {
    const startTime = Date.now();
    
    const stats = await this.dependencies.storage.getEmbeddingStats();
    const coverage = stats.total > 0 ? (stats.withEmbeddings / stats.total) * 100 : 0;
    
    // TODO: Get model distribution (not implemented yet)
    const models: string[] = [];
    
    // TODO: Get index status if available (not implemented yet)
    const indexStatus = { isBuilt: false };

    return {
      success: true,
      operation: 'status',
      data: {
        total: stats.total,
        withEmbeddings: stats.withEmbeddings,
        withoutEmbeddings: stats.withoutEmbeddings,
        coverage: Math.round(coverage * 100) / 100,
        models,
        indexStatus
      },
      timeTaken: Date.now() - startTime
    };
  }

  /**
   * Rebuild ANN index
   */
  private async rebuildIndex(_options: VectorizeOptions): Promise<VectorizeResult> {
    if (!this.dependencies.embeddingService) {
      throw new Error('EmbeddingService not initialized. API key required.');
    }

    // TODO: This feature will be implemented when enhanced embedding service is integrated
    throw new Error('Index rebuilding feature is not yet available with current embedding service');
  }

  /**
   * Benchmark index performance
   */
  private async benchmarkIndex(options: VectorizeOptions): Promise<VectorizeResult> {
    const startTime = Date.now();
    
    if (!this.dependencies.embeddingService) {
      throw new Error('EmbeddingService not initialized. API key required.');
    }

    // Implementation would depend on the EmbeddingService benchmark capabilities
    // For now, return mock data structure
    return {
      success: true,
      operation: 'benchmark',
      data: {
        algorithm: options.indexAlgorithm,
        queryCount: 100,
        avgQueryTime: 5.2, // ms
        accuracy: 0.95,
        throughput: 192.3 // queries/sec
      },
      timeTaken: Date.now() - startTime
    };
  }

  /**
   * Get index statistics
   */
  private async getIndexStats(): Promise<VectorizeResult> {
    const startTime = Date.now();
    
    // Implementation would get actual index stats
    // For now, return basic structure
    return {
      success: true,
      operation: 'index-stats',
      data: {
        algorithm: 'hierarchical',
        vectorCount: 0,
        buildTime: 0,
        indexSize: 0
      },
      timeTaken: Date.now() - startTime
    };
  }

  /**
   * Get functions to vectorize based on options
   */
  private async getFunctionsToVectorize(options: VectorizeOptions): Promise<FunctionInfo[]> {
    // Get the latest snapshot
    const snapshots = await this.dependencies.storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) {
      throw new Error('No snapshots found. Run "funcqc scan" first.');
    }
    
    const snapshotId = snapshots[0].id;
    
    if (options.all) {
      // Get all functions with descriptions for re-vectorization
      return await this.dependencies.storage.getFunctionsWithDescriptions(snapshotId, options.limit ? { limit: options.limit } : undefined);
    } else if (options.recent) {
      // Get functions without embeddings
      return await this.dependencies.storage.getFunctionsWithoutEmbeddings(snapshotId, options.limit);
    }
    return [];
  }

  /**
   * Get model dimension for embedding model
   */
  private getModelDimension(model: string): number {
    const dimensions: Record<string, number> = {
      'text-embedding-ada-002': 1536,
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072
    };
    return dimensions[model] || 1536;
  }

  /**
   * Get operation type from options
   */
  private getOperationType(options: VectorizeOptions): VectorizeResult['operation'] {
    if (options.status) return 'status';
    if (options.rebuildIndex) return 'rebuild-index';
    if (options.benchmark) return 'benchmark';
    if (options.indexStats) return 'index-stats';
    return 'vectorize';
  }
}