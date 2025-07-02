/**
 * Enhanced embedding service with separated concerns and improved performance
 */

import { FunctionInfo } from '../../types';
import {
  IEmbeddingService,
  EnhancedEmbeddingConfig,
  EmbeddingResult,
  SemanticSearchOptions,
  EmbeddingsClient,
  VectorStore,
} from './interfaces';
import { OpenAIEmbeddingsClient } from './openai-client';
import { EnhancedVectorStore } from './vector-store';

interface ServiceStats {
  totalFunctionsProcessed: number;
  totalSearches: number;
  avgSearchTime: number;
  indexBuilds: number;
  errors: number;
  lastError?: string;
}

export class EnhancedEmbeddingService implements IEmbeddingService {
  private client: EmbeddingsClient | null = null;
  private vectorStore: VectorStore | null = null;
  private readonly enableANN: boolean;
  private readonly stats: ServiceStats = {
    totalFunctionsProcessed: 0,
    totalSearches: 0,
    avgSearchTime: 0,
    indexBuilds: 0,
    errors: 0
  };

  constructor(config: EnhancedEmbeddingConfig = {}) {
    this.enableANN = config.enableANN ?? true;
    this.initializeComponents(config);
  }

  /**
   * Initialize service with full configuration
   */
  async initialize(config: EnhancedEmbeddingConfig): Promise<void> {
    try {
      this.initializeComponents(config);
      
      // If API key provided, initialize client immediately
      if (config.client?.apiKey && this.client) {
        (this.client as OpenAIEmbeddingsClient).initialize(config.client.apiKey);
      }

    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize embedding service: ${this.stats.lastError}`);
    }
  }

  /**
   * Initialize components based on configuration
   */
  private initializeComponents(config: EnhancedEmbeddingConfig): void {
    // Initialize embeddings client
    if (config.client) {
      this.client = new OpenAIEmbeddingsClient(config.client);
    }
    
    // Initialize vector store
    if (this.enableANN && config.vectorStore) {
      this.vectorStore = new EnhancedVectorStore(config.vectorStore);
    }
  }

  /**
   * Generate embeddings for functions with enhanced text preparation
   */
  async generateFunctionEmbeddings(functions: FunctionInfo[]): Promise<EmbeddingResult[]> {
    if (!this.client || !this.client.isInitialized()) {
      throw new Error('Embeddings client not initialized');
    }

    try {
      const textsToEmbed: string[] = [];
      const functionMap = new Map<number, FunctionInfo>();

      // Prepare enhanced texts for embedding
      functions.forEach((func) => {
        const text = this.prepareFunctionText(func);
        if (text) {
          textsToEmbed.push(text);
          functionMap.set(textsToEmbed.length - 1, func);
        }
      });

      if (textsToEmbed.length === 0) {
        return [];
      }

      // Generate embeddings using enhanced client
      const embeddings = await this.client.batchGenerateEmbeddings(textsToEmbed);

      // Map embeddings back to functions
      const results: EmbeddingResult[] = [];
      embeddings.forEach((embedding, index) => {
        const func = functionMap.get(index);
        if (func) {
          results.push({
            functionId: func.id,
            semanticId: func.semanticId,
            embedding, // Already Float32Array from enhanced client
            model: this.client!.getModelInfo().model,
            timestamp: Date.now(),
            tokenCount: this.estimateTokenCount(textsToEmbed[index])
          });
        }
      });

      this.stats.totalFunctionsProcessed += results.length;
      return results;

    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate function embeddings: ${this.stats.lastError}`);
    }
  }

  /**
   * Build vector index from embeddings
   */
  async buildIndex(embeddings: EmbeddingResult[]): Promise<void> {
    if (!this.enableANN || !this.vectorStore) {
      return; // ANN disabled
    }

    try {
      // Convert EmbeddingResult to EmbeddingVector format
      const embeddingVectors = embeddings.map(result => ({
        id: result.functionId,
        semanticId: result.semanticId,
        vector: result.embedding,
        metadata: {
          model: result.model,
          timestamp: result.timestamp,
          tokenCount: result.tokenCount
        }
      }));

      await this.vectorStore.buildIndex(embeddingVectors);
      this.stats.indexBuilds++;

    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to build index: ${this.stats.lastError}`);
    }
  }

  /**
   * Add new embeddings to existing index using incremental updates
   */
  async addToIndex(newEmbeddings: EmbeddingResult[]): Promise<void> {
    if (!this.enableANN || !this.vectorStore) {
      return; // ANN disabled
    }

    try {
      // Convert to vector format
      const embeddingVectors = newEmbeddings.map(result => ({
        id: result.functionId,
        semanticId: result.semanticId,
        vector: result.embedding,
        metadata: {
          model: result.model,
          timestamp: result.timestamp,
          tokenCount: result.tokenCount
        }
      }));

      // Use incremental update instead of full rebuild
      await this.vectorStore.addEmbeddings(embeddingVectors);

    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to add to index: ${this.stats.lastError}`);
    }
  }

  /**
   * Perform semantic search with fallback
   */
  async semanticSearch(
    queryText: string,
    allEmbeddings: EmbeddingResult[],
    options: SemanticSearchOptions = {}
  ): Promise<Array<{ functionId: string; semanticId: string; similarity: number; metadata?: Record<string, unknown> }>> {
    if (!this.client || !this.client.isInitialized()) {
      throw new Error('Embeddings client not initialized');
    }

    const startTime = performance.now();

    try {
      // Generate query embedding
      const queryEmbedding = await this.client.generateEmbedding(queryText);

      // Use ANN search if enabled and available
      if (options.useANN !== false && this.enableANN && this.vectorStore && this.vectorStore.isReady()) {
        try {
          const searchResults = await this.vectorStore.search(
            queryEmbedding,
            options.limit || 20,
            options
          );

          // Filter by threshold if specified
          const threshold = options.threshold || 0;
          const results = searchResults
            .filter(result => result.similarity >= threshold)
            .map(result => ({
              functionId: result.id,
              semanticId: result.semanticId,
              similarity: result.similarity,
              ...(result.metadata ? { metadata: result.metadata } : {})
            }));

          this.updateSearchStats(startTime);
          return results;

        } catch (error) {
          // Fall back to exact search if ANN search fails
          console.warn('ANN search failed, falling back to exact search:', error);
        }
      }

      // Exact search fallback
      const results = this.exactSemanticSearch(queryEmbedding, allEmbeddings, options);
      this.updateSearchStats(startTime);
      return results;

    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to perform semantic search: ${this.stats.lastError}`);
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    const clientReady = this.client?.isInitialized() ?? false;
    // For ANN disabled, vector store readiness is not required
    const vectorStoreReady = this.enableANN ? (this.vectorStore?.isReady() ?? true) : true;
    
    return clientReady && vectorStoreReady;
  }

  /**
   * Get comprehensive service statistics
   */
  getStats(): {
    client: Record<string, unknown>;
    vectorStore: Record<string, unknown>;
    service: Record<string, unknown>;
  } {
    return {
      client: this.client?.getStats() || {},
      vectorStore: this.vectorStore?.getStats() || {},
      service: {
        ...this.stats,
        enableANN: this.enableANN,
        ready: this.isReady()
      }
    };
  }

  /**
   * Enhanced function text preparation with prioritized structure
   */
  private prepareFunctionText(func: FunctionInfo): string {
    const parts: string[] = [];

    // Start with description (most important for semantic understanding)
    if (func.description) {
      parts.push(`Primary: ${func.description}`);
    }

    // Add function identity
    parts.push(`Function: ${func.displayName}`);
    parts.push(`Signature: ${func.signature}`);

    // Add JSDoc if available and no description, or extract examples
    if (func.jsDoc) {
      const cleanedJsDoc = this.cleanJsDoc(func.jsDoc);
      if (cleanedJsDoc) {
        if (!func.description) {
          parts.push(`Documentation: ${cleanedJsDoc}`);
        } else {
          // Extract examples even if description exists
          const examples = this.extractJsDocExamples(func.jsDoc);
          if (examples) {
            parts.push(`Examples: ${examples}`);
          }
        }
      }
    }

    // Add detailed parameter information
    if (func.parameters.length > 0) {
      const paramInfo = func.parameters
        .map(p => {
          const optional = p.isOptional ? '?' : '';
          const rest = p.isRest ? '...' : '';
          const defaultVal = p.defaultValue ? ` = ${p.defaultValue}` : '';
          return `${rest}${p.name}${optional}: ${p.typeSimple}${defaultVal}`;
        })
        .join(', ');
      parts.push(`Parameters: ${paramInfo}`);
    }

    // Add context information
    if (func.contextPath && func.contextPath.length > 0) {
      parts.push(`Context: ${func.contextPath.join('.')}`);
    }
    
    // Add file context (least important for semantic search)
    parts.push(`File: ${func.filePath}`);

    return parts.join(' | ');
  }

  /**
   * Extract examples from JSDoc @example tags
   */
  private extractJsDocExamples(jsDoc: string): string {
    const exampleMatches = jsDoc.match(/@example\s+([\s\S]*?)(?=@\w+|$)/g);
    if (!exampleMatches) return '';
    
    return exampleMatches
      .map(match => match.replace(/@example\s+/, '').trim())
      .filter(example => example.length > 0)
      .join(' | ');
  }

  /**
   * Clean JSDoc comment for embedding
   */
  private cleanJsDoc(jsDoc: string): string {
    // Remove JSDoc comment markers
    let cleaned = jsDoc
      .replace(/^\/\*\*\s*/, '')
      .replace(/\s*\*\/$/, '')
      .replace(/^\s*\*\s?/gm, '')
      .trim();

    // Remove @param, @returns etc but keep their descriptions
    cleaned = cleaned
      .replace(/@param\s+\{[^}]+\}\s+(\w+)\s*/g, '$1: ')
      .replace(/@returns?\s+\{[^}]+\}\s*/g, 'Returns: ')
      .replace(/@\w+/g, '')
      .trim();

    return cleaned;
  }

  /**
   * Exact semantic search implementation
   */
  private exactSemanticSearch(
    queryEmbedding: Float32Array,
    allEmbeddings: EmbeddingResult[],
    options: SemanticSearchOptions = {}
  ): Array<{ functionId: string; semanticId: string; similarity: number; metadata?: Record<string, unknown> }> {
    const results: Array<{ functionId: string; semanticId: string; similarity: number; metadata?: Record<string, unknown> }> = [];

    for (const embeddingResult of allEmbeddings) {
      const similarity = this.cosineSimilarity(queryEmbedding, embeddingResult.embedding);
      
      // Apply threshold filter
      const threshold = options.threshold || 0;
      if (similarity >= threshold) {
        results.push({
          functionId: embeddingResult.functionId,
          semanticId: embeddingResult.semanticId,
          similarity,
          metadata: {
            model: embeddingResult.model,
            timestamp: embeddingResult.timestamp,
            tokenCount: embeddingResult.tokenCount
          }
        });
      }
    }

    // Sort by similarity (descending) and limit results
    results.sort((a, b) => b.similarity - a.similarity);
    const limit = options.limit || results.length;
    return results.slice(0, limit);
  }

  /**
   * Calculate cosine similarity between Float32Arrays
   */
  private cosineSimilarity(vec1: Float32Array, vec2: Float32Array): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Estimate token count for text (rough approximation)
   */
  private estimateTokenCount(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters for English
    return Math.ceil(text.length / 4);
  }

  /**
   * Update search statistics
   */
  private updateSearchStats(startTime: number): void {
    const searchTime = performance.now() - startTime;
    this.stats.totalSearches++;
    
    this.stats.avgSearchTime = this.stats.totalSearches === 1
      ? searchTime
      : (this.stats.avgSearchTime * (this.stats.totalSearches - 1) + searchTime) / this.stats.totalSearches;
  }
}