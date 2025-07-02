/**
 * Core interfaces for embedding service architecture
 * Provides separation of concerns with clear boundaries between components
 */

import { FunctionInfo } from '../../types';

// Model definitions with strict typing
export const enum EmbeddingModel {
  ADA_002 = 'text-embedding-ada-002',
  SMALL_3 = 'text-embedding-3-small',
  LARGE_3 = 'text-embedding-3-large'
}

// Runtime options for configuration
export interface RuntimeOptions {
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  concurrency?: number;
  enableMetrics?: boolean;
}

// Embedding vector representation
export interface EmbeddingVector {
  id: string;
  semanticId: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
}

// Embedding generation result
export interface EmbeddingResult {
  functionId: string;
  semanticId: string;
  embedding: Float32Array;
  model: string;
  timestamp: number;
  tokenCount?: number;
}

// Search options for semantic queries
export interface SemanticSearchOptions {
  useANN?: boolean;
  threshold?: number;
  limit?: number;
  approximationLevel?: 'fast' | 'balanced' | 'accurate';
}

// Search result from vector store
export interface SearchResult {
  id: string;
  semanticId: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

/**
 * Abstract interface for embedding generation clients
 * Allows swapping between OpenAI, Azure, local models, etc.
 */
export interface EmbeddingsClient {
  /**
   * Generate single embedding
   */
  generateEmbedding(text: string, options?: RuntimeOptions): Promise<Float32Array>;

  /**
   * Generate multiple embeddings in batch
   */
  batchGenerateEmbeddings(texts: string[], options?: RuntimeOptions): Promise<Float32Array[]>;

  /**
   * Get client model information
   */
  getModelInfo(): { model: string; dimension: number; maxTokens: number };

  /**
   * Check if client is properly initialized
   */
  isInitialized(): boolean;

  /**
   * Get client statistics (API calls, errors, etc.)
   */
  getStats(): Record<string, unknown>;
}

/**
 * Abstract interface for vector storage and indexing
 * Handles ANN operations and vector management
 */
export interface VectorStore {
  /**
   * Build initial index from embeddings
   */
  buildIndex(embeddings: EmbeddingVector[]): Promise<void>;

  /**
   * Add new embeddings incrementally
   */
  addEmbeddings(embeddings: EmbeddingVector[]): Promise<void>;

  /**
   * Remove embeddings by IDs
   */
  removeEmbeddings(ids: string[]): Promise<void>;

  /**
   * Perform approximate nearest neighbor search
   */
  search(queryVector: Float32Array, k: number, options?: SemanticSearchOptions): Promise<SearchResult[]>;

  /**
   * Check if index is built and ready
   */
  isReady(): boolean;

  /**
   * Get index statistics and metrics
   */
  getStats(): Record<string, unknown>;

  /**
   * Clear index and reset state
   */
  clear(): Promise<void>;

  /**
   * Get embeddings by IDs
   */
  getEmbeddings(ids: string[]): Promise<EmbeddingVector[]>;
}

/**
 * Configuration for embeddings client
 */
export interface EmbeddingsClientConfig {
  apiKey?: string;
  model?: EmbeddingModel;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Configuration for vector store
 */
export interface VectorStoreConfig {
  algorithm?: 'hierarchical' | 'lsh' | 'hybrid';
  clusterCount?: number;
  hashBits?: number;
  approximationLevel?: 'fast' | 'balanced' | 'accurate';
  cacheSize?: number;
  bufferSize?: number; // For incremental updates
  bufferTimeout?: number; // For incremental updates
}

/**
 * Enhanced configuration for the main service
 */
export interface EnhancedEmbeddingConfig {
  client?: EmbeddingsClientConfig;
  vectorStore?: VectorStoreConfig;
  runtime?: RuntimeOptions;
  enableANN?: boolean;
}

/**
 * Enhanced embedding service interface
 */
export interface IEmbeddingService {
  /**
   * Initialize service with configuration
   */
  initialize(config: EnhancedEmbeddingConfig): Promise<void>;

  /**
   * Generate embeddings for functions
   */
  generateFunctionEmbeddings(functions: FunctionInfo[]): Promise<EmbeddingResult[]>;

  /**
   * Build vector index from embeddings
   */
  buildIndex(embeddings: EmbeddingResult[]): Promise<void>;

  /**
   * Add new embeddings to existing index
   */
  addToIndex(newEmbeddings: EmbeddingResult[]): Promise<void>;

  /**
   * Perform semantic search
   */
  semanticSearch(
    queryText: string,
    allEmbeddings: EmbeddingResult[],
    options?: SemanticSearchOptions
  ): Promise<Array<{ functionId: string; semanticId: string; similarity: number; metadata?: Record<string, unknown> }>>;

  /**
   * Check service readiness
   */
  isReady(): boolean;

  /**
   * Get comprehensive service statistics
   */
  getStats(): {
    client: Record<string, unknown>;
    vectorStore: Record<string, unknown>;
    service: Record<string, unknown>;
  };
}