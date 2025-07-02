/**
 * Enhanced embedding service with builder pattern and clean exports
 */

// Export interfaces
export * from './interfaces';

// Export implementations
export { OpenAIEmbeddingsClient } from './openai-client';
export { EnhancedVectorStore } from './vector-store';
export { EnhancedEmbeddingService } from './enhanced-service';

// Re-export from original service for backward compatibility
export { EmbeddingService, EmbeddingConfig, EMBEDDING_MODELS } from '../embedding-service';

import {
  EnhancedEmbeddingConfig,
  EmbeddingsClientConfig,
  VectorStoreConfig,
  RuntimeOptions,
  EmbeddingModel
} from './interfaces';
import { EnhancedEmbeddingService } from './enhanced-service';

/**
 * Builder class for enhanced embedding service
 */
export class EmbeddingServiceBuilder {
  private config: EnhancedEmbeddingConfig = {};

  /**
   * Configure OpenAI embeddings client
   */
  withOpenAIClient(clientConfig: EmbeddingsClientConfig): EmbeddingServiceBuilder {
    this.config.client = clientConfig;
    return this;
  }

  /**
   * Configure vector store
   */
  withVectorStore(storeConfig: VectorStoreConfig): EmbeddingServiceBuilder {
    this.config.vectorStore = storeConfig;
    return this;
  }

  /**
   * Configure runtime options
   */
  withRuntimeOptions(runtimeOptions: RuntimeOptions): EmbeddingServiceBuilder {
    this.config.runtime = runtimeOptions;
    return this;
  }

  /**
   * Enable or disable ANN indexing
   */
  withANN(enabled: boolean): EmbeddingServiceBuilder {
    this.config.enableANN = enabled;
    return this;
  }

  /**
   * Quick configuration for OpenAI with API key
   */
  withOpenAIKey(apiKey: string, model: EmbeddingModel = EmbeddingModel.SMALL_3): EmbeddingServiceBuilder {
    this.config.client = {
      apiKey,
      model,
      timeout: 30000,
      maxRetries: 3
    };
    return this;
  }

  /**
   * Quick configuration for production use
   */
  forProduction(): EmbeddingServiceBuilder {
    this.config.vectorStore = {
      algorithm: 'hierarchical',
      clusterCount: 100,
      approximationLevel: 'balanced',
      cacheSize: 2000,
      bufferSize: 500,
      bufferTimeout: 3000
    };

    this.config.runtime = {
      timeout: 60000,
      retryAttempts: 5,
      retryDelay: 1000,
      concurrency: 3,
      enableMetrics: true
    };

    this.config.enableANN = true;
    return this;
  }

  /**
   * Quick configuration for development use
   */
  forDevelopment(): EmbeddingServiceBuilder {
    this.config.vectorStore = {
      algorithm: 'hierarchical',
      clusterCount: 20,
      approximationLevel: 'fast',
      cacheSize: 500,
      bufferSize: 50,
      bufferTimeout: 10000
    };

    this.config.runtime = {
      timeout: 30000,
      retryAttempts: 2,
      retryDelay: 500,
      concurrency: 2,
      enableMetrics: false
    };

    this.config.enableANN = true;
    return this;
  }

  /**
   * Build the enhanced service
   */
  build(): EnhancedEmbeddingService {
    return new EnhancedEmbeddingService(this.config);
  }

  /**
   * Build and initialize the service
   */
  async buildAndInitialize(): Promise<EnhancedEmbeddingService> {
    const service = new EnhancedEmbeddingService(this.config);
    await service.initialize(this.config);
    return service;
  }
}

/**
 * Factory functions for convenience
 */
export const EmbeddingServiceFactory = {
  /**
   * Create a builder instance
   */
  builder(): EmbeddingServiceBuilder {
    return new EmbeddingServiceBuilder();
  },

  /**
   * Create service with OpenAI client
   */
  createWithOpenAI(apiKey: string, model: EmbeddingModel = EmbeddingModel.SMALL_3): EnhancedEmbeddingService {
    return new EmbeddingServiceBuilder()
      .withOpenAIKey(apiKey, model)
      .forProduction()
      .build();
  },

  /**
   * Create service for development
   */
  createForDevelopment(apiKey?: string): EnhancedEmbeddingService {
    const builder = new EmbeddingServiceBuilder().forDevelopment();
    
    if (apiKey) {
      builder.withOpenAIKey(apiKey);
    }
    
    return builder.build();
  },

  /**
   * Create service for production
   */
  createForProduction(apiKey: string, model: EmbeddingModel = EmbeddingModel.SMALL_3): EnhancedEmbeddingService {
    return new EmbeddingServiceBuilder()
      .withOpenAIKey(apiKey, model)
      .forProduction()
      .build();
  }
};