/**
 * OpenAI embeddings client implementation with enhanced reliability and performance
 */

import OpenAI from 'openai';
import { EmbeddingsClient, EmbeddingsClientConfig, EmbeddingModel, RuntimeOptions } from './interfaces';

// Model configurations
const MODEL_CONFIGS = {
  [EmbeddingModel.ADA_002]: { dimension: 1536, maxTokens: 8191 },
  [EmbeddingModel.SMALL_3]: { dimension: 1536, maxTokens: 8191 },
  [EmbeddingModel.LARGE_3]: { dimension: 3072, maxTokens: 8191 }
} as const;

interface ClientStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retryCount: number;
  avgResponseTime: number;
  lastError?: string;
}

export class OpenAIEmbeddingsClient implements EmbeddingsClient {
  private openai: OpenAI | null = null;
  private readonly model: EmbeddingModel;
  private readonly batchSize: number;
  private readonly stats: ClientStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retryCount: 0,
    avgResponseTime: 0
  };

  constructor(private readonly config: EmbeddingsClientConfig) {
    this.model = config.model || EmbeddingModel.SMALL_3;
    this.batchSize = 100; // OpenAI recommended batch size

    if (config.apiKey) {
      this.initializeClient(config.apiKey);
    }
  }

  private initializeClient(apiKey: string): void {
    this.openai = new OpenAI({
      apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout || 30000,
      maxRetries: this.config.maxRetries || 3
    });
  }

  /**
   * Initialize client with API key
   */
  initialize(apiKey: string): void {
    this.initializeClient(apiKey);
  }

  /**
   * Generate single embedding with retry mechanism
   */
  async generateEmbedding(text: string, options?: RuntimeOptions): Promise<Float32Array> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Please provide API key.');
    }

    const startTime = performance.now();
    const maxRetries = options?.retryAttempts || this.config.maxRetries || 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.stats.totalRequests++;

        const response = await this.openai.embeddings.create({
          input: text,
          model: this.model,
        });

        const embedding = new Float32Array(response.data[0].embedding);
        
        // Update stats
        this.stats.successfulRequests++;
        this.updateResponseTime(startTime);

        return embedding;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.stats.retryCount++;

        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          break;
        }

        // Exponential backoff
        if (attempt < maxRetries) {
          const delay = this.calculateBackoffDelay(attempt, options?.retryDelay || 1000);
          await this.sleep(delay);
        }
      }
    }

    this.stats.failedRequests++;
    this.stats.lastError = lastError?.message || 'Unknown error';
    throw new Error(`Failed to generate embedding after ${maxRetries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Generate multiple embeddings with concurrent processing and rate limiting
   */
  async batchGenerateEmbeddings(texts: string[], options?: RuntimeOptions): Promise<Float32Array[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Please provide API key.');
    }

    if (texts.length === 0) {
      return [];
    }

    const embeddings: Float32Array[] = [];
    const concurrency = options?.concurrency || 3; // OpenAI rate limit consideration
    
    // Process in batches with controlled concurrency
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      
      // Split batch into concurrent chunks
      const chunks: string[][] = [];
      const chunkSize = Math.ceil(batch.length / concurrency);
      
      for (let j = 0; j < batch.length; j += chunkSize) {
        chunks.push(batch.slice(j, j + chunkSize));
      }

      // Process chunks concurrently
      const chunkPromises = chunks.map(chunk => 
        this.processBatchChunk(chunk, options)
      );

      const chunkResults = await Promise.all(chunkPromises);
      
      // Flatten results
      for (const chunkResult of chunkResults) {
        embeddings.push(...chunkResult);
      }

      // Rate limiting delay between batches
      if (i + this.batchSize < texts.length) {
        await this.sleep(100); // Small delay between batch groups
      }
    }

    return embeddings;
  }

  /**
   * Process a chunk of texts as a single API call
   */
  private async processBatchChunk(texts: string[], options?: RuntimeOptions): Promise<Float32Array[]> {
    const startTime = performance.now();
    const maxRetries = options?.retryAttempts || this.config.maxRetries || 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.stats.totalRequests++;

        const response = await this.openai!.embeddings.create({
          input: texts,
          model: this.model,
        });

        const embeddings = response.data.map(d => new Float32Array(d.embedding));
        
        this.stats.successfulRequests++;
        this.updateResponseTime(startTime);

        return embeddings;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.stats.retryCount++;

        if (this.isNonRetryableError(error)) {
          break;
        }

        if (attempt < maxRetries) {
          const delay = this.calculateBackoffDelay(attempt, options?.retryDelay || 1000);
          await this.sleep(delay);
        }
      }
    }

    this.stats.failedRequests++;
    this.stats.lastError = lastError?.message || 'Unknown error';
    throw new Error(`Failed to generate batch embeddings after ${maxRetries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Get model information
   */
  getModelInfo(): { model: string; dimension: number; maxTokens: number } {
    const config = MODEL_CONFIGS[this.model];
    return {
      model: this.model,
      dimension: config.dimension,
      maxTokens: config.maxTokens
    };
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.openai !== null;
  }

  /**
   * Get client statistics
   */
  getStats(): Record<string, unknown> {
    return {
      ...this.stats,
      model: this.model,
      batchSize: this.batchSize,
      successRate: this.stats.totalRequests > 0 
        ? this.stats.successfulRequests / this.stats.totalRequests 
        : 0
    };
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Don't retry on authentication, invalid input, or quota errors
      return message.includes('invalid api key') || 
             message.includes('unauthorized') ||
             message.includes('forbidden') ||
             message.includes('quota') ||
             message.includes('invalid');
    }
    return false;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number, baseDelay: number): number {
    const jitter = Math.random() * 0.1; // 10% jitter
    return Math.floor(baseDelay * Math.pow(2, attempt) * (1 + jitter));
  }

  /**
   * Sleep utility function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update response time statistics
   */
  private updateResponseTime(startTime: number): void {
    const responseTime = performance.now() - startTime;
    this.stats.avgResponseTime = this.stats.successfulRequests === 1
      ? responseTime
      : (this.stats.avgResponseTime * (this.stats.successfulRequests - 1) + responseTime) / this.stats.successfulRequests;
  }
}