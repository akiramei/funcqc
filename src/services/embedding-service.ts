import OpenAI from 'openai';
import { FunctionInfo } from '../types';
import {
  ANNConfig,
  EmbeddingVector,
  HierarchicalIndex,
  LSHIndex,
  HybridANNIndex,
  createANNIndex,
  DEFAULT_ANN_CONFIG,
} from './ann-index';
// Enhanced embedding service available in ./embedding module

export interface EmbeddingConfig {
  apiKey?: string;
  model?: string;
  dimension?: number;
  batchSize?: number;
  annConfig?: ANNConfig;
  enableANN?: boolean;
}

// Supported embedding models with their configurations
export const EMBEDDING_MODELS = {
  'text-embedding-ada-002': { dimension: 1536, maxTokens: 8191 },
  'text-embedding-3-small': { dimension: 1536, maxTokens: 8191 },
  'text-embedding-3-large': { dimension: 3072, maxTokens: 8191 },
} as const;

export type EmbeddingModelName = keyof typeof EMBEDDING_MODELS;

export interface EmbeddingResult {
  functionId: string;
  semanticId: string;
  embedding: number[];
  model: string;
  timestamp: number;
}

export interface SemanticSearchOptions {
  useANN?: boolean;
  threshold?: number;
  limit?: number;
  approximationLevel?: 'fast' | 'balanced' | 'accurate';
}

export class EmbeddingService {
  private openai: OpenAI | null = null;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly modelConfig: { dimension: number; maxTokens: number };
  private readonly annConfig: ANNConfig;
  private readonly enableANN: boolean;
  private annIndex: HierarchicalIndex | LSHIndex | HybridANNIndex | null = null;
  private indexedEmbeddings: Map<string, EmbeddingVector> = new Map();

  constructor(config: EmbeddingConfig = {}) {
    this.model = config.model || 'text-embedding-3-small';
    this.batchSize = config.batchSize || 100;
    this.enableANN = config.enableANN ?? true;
    this.annConfig = { ...DEFAULT_ANN_CONFIG, ...config.annConfig };

    // Validate and get model configuration
    if (!(this.model in EMBEDDING_MODELS)) {
      throw new Error(
        `Unsupported embedding model: ${this.model}. Supported models: ${Object.keys(EMBEDDING_MODELS).join(', ')}`
      );
    }
    this.modelConfig = EMBEDDING_MODELS[this.model as EmbeddingModelName];

    if (config.apiKey) {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    }

    // Initialize ANN index if enabled
    if (this.enableANN) {
      this.annIndex = createANNIndex(this.annConfig);
    }
  }

  /**
   * Initialize OpenAI client with API key
   */
  initialize(apiKey: string): void {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.openai !== null;
  }

  /**
   * Get model information
   */
  getModelInfo(): { model: string; dimension: number; maxTokens: number } {
    return {
      model: this.model,
      dimension: this.modelConfig.dimension,
      maxTokens: this.modelConfig.maxTokens,
    };
  }

  /**
   * Get ANN configuration and status
   */
  getANNInfo(): { enabled: boolean; config: ANNConfig; indexStats?: Record<string, unknown> } {
    const indexStats = this.annIndex?.getIndexStats();
    return {
      enabled: this.enableANN,
      config: this.annConfig,
      ...(indexStats ? { indexStats } : {}),
    };
  }

  /**
   * Build ANN index from stored embeddings
   */
  async buildANNIndex(embeddings: EmbeddingResult[]): Promise<void> {
    if (!this.enableANN || !this.annIndex) {
      throw new Error('ANN index is not enabled or initialized');
    }

    // Convert EmbeddingResult to EmbeddingVector format
    const embeddingVectors: EmbeddingVector[] = embeddings.map(result => ({
      id: result.functionId,
      semanticId: result.semanticId,
      vector: new Float32Array(result.embedding),
      metadata: {
        model: result.model,
        timestamp: result.timestamp,
      },
    }));

    // Build the index
    this.annIndex.buildIndex(embeddingVectors);

    // Store embeddings for quick lookup during search
    this.indexedEmbeddings.clear();
    for (const vector of embeddingVectors) {
      this.indexedEmbeddings.set(vector.id, vector);
    }
  }

  /**
   * Add new embeddings to existing ANN index (incremental update)
   */
  async addToANNIndex(newEmbeddings: EmbeddingResult[]): Promise<void> {
    if (!this.enableANN || !this.annIndex) {
      return;
    }

    // Convert to EmbeddingVector format
    const newVectors: EmbeddingVector[] = newEmbeddings.map(result => ({
      id: result.functionId,
      semanticId: result.semanticId,
      vector: new Float32Array(result.embedding),
      metadata: {
        model: result.model,
        timestamp: result.timestamp,
      },
    }));

    // Add to local storage
    for (const vector of newVectors) {
      this.indexedEmbeddings.set(vector.id, vector);
    }

    // Rebuild index with all embeddings (for now - future: incremental updates)
    const allVectors = Array.from(this.indexedEmbeddings.values());
    this.annIndex.buildIndex(allVectors);
  }

  /**
   * Perform semantic search using ANN index or fall back to exact search
   */
  async semanticSearch(
    queryText: string,
    allEmbeddings: EmbeddingResult[],
    options: SemanticSearchOptions = {}
  ): Promise<
    Array<{
      functionId: string;
      semanticId: string;
      similarity: number;
      metadata?: Record<string, unknown>;
    }>
  > {
    // Generate embedding for query
    const queryEmbedding = await this.generateEmbedding(queryText);

    // Use ANN search if enabled and available
    if (
      options.useANN !== false &&
      this.enableANN &&
      this.annIndex &&
      this.indexedEmbeddings.size > 0
    ) {
      try {
        // TODO: Pass approximation level per search instead of modifying shared state
        // This requires updating ANN index interface to accept approximationLevel parameter
        // For now, we'll document this limitation
        const searchResults = this.annIndex.searchApproximate(queryEmbedding, options.limit || 20);

        // Filter by threshold if specified
        const threshold = options.threshold || 0;
        return searchResults
          .filter(result => result.similarity >= threshold)
          .map(result => ({
            functionId: result.id,
            semanticId: result.semanticId,
            similarity: result.similarity,
            ...(result.metadata ? { metadata: result.metadata } : {}),
          }));
      } catch (error) {
        // Fall back to exact search if ANN search fails
        console.warn('ANN search failed, falling back to exact search:', error);
      }
    }

    // Exact search (original implementation)
    return this.exactSemanticSearch(queryEmbedding, allEmbeddings, options);
  }

  /**
   * Exact semantic search (original implementation)
   */
  private exactSemanticSearch(
    queryEmbedding: number[],
    allEmbeddings: EmbeddingResult[],
    options: SemanticSearchOptions = {}
  ): Array<{
    functionId: string;
    semanticId: string;
    similarity: number;
    metadata?: Record<string, unknown>;
  }> {
    const results: Array<{
      functionId: string;
      semanticId: string;
      similarity: number;
      metadata?: Record<string, unknown>;
    }> = [];

    for (const embeddingResult of allEmbeddings) {
      const similarity = EmbeddingService.cosineSimilarity(
        queryEmbedding,
        embeddingResult.embedding
      );

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
          },
        });
      }
    }

    // Sort by similarity (descending) and limit results
    results.sort((a, b) => b.similarity - a.similarity);
    const limit = options.limit || results.length;
    return results.slice(0, limit);
  }

  /**
   * Check if ANN index is built and ready
   */
  isANNIndexReady(): boolean {
    return this.enableANN && this.annIndex !== null && this.indexedEmbeddings.size > 0;
  }

  /**
   * Get statistics about the current ANN index
   */
  getIndexStatistics(): Record<string, unknown> | null {
    if (!this.enableANN || !this.annIndex) {
      return null;
    }

    return {
      ...this.annIndex.getIndexStats(),
      indexedCount: this.indexedEmbeddings.size,
      ready: this.isANNIndexReady(),
    };
  }

  /**
   * Rebuild ANN index with updated configuration
   */
  async rebuildANNIndex(newConfig?: Partial<ANNConfig>): Promise<void> {
    if (!this.enableANN) {
      throw new Error('ANN index is disabled');
    }

    // Update configuration if provided
    if (newConfig) {
      Object.assign(this.annConfig, newConfig);
      this.annIndex = createANNIndex(this.annConfig);
    }

    // Rebuild index with existing embeddings
    if (this.indexedEmbeddings.size > 0) {
      const allVectors = Array.from(this.indexedEmbeddings.values());
      this.annIndex?.buildIndex(allVectors);
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Please provide API key.');
    }

    try {
      const response = await this.openai.embeddings.create({
        input: text,
        model: this.model,
      });

      return response.data[0].embedding;
    } catch (error) {
      throw new Error(
        `Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async batchGenerateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Please provide API key.');
    }

    const embeddings: number[][] = [];

    // Process in batches to respect API limits
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      try {
        const response = await this.openai.embeddings.create({
          input: batch,
          model: this.model,
        });

        embeddings.push(...response.data.map(d => d.embedding));
      } catch (error) {
        throw new Error(
          `Failed to generate embeddings for batch ${i / this.batchSize + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return embeddings;
  }

  /**
   * Generate embeddings for functions based on their descriptions
   */
  async generateFunctionEmbeddings(functions: FunctionInfo[]): Promise<EmbeddingResult[]> {
    const textsToEmbed: string[] = [];
    const functionMap = new Map<number, FunctionInfo>();

    // Prepare texts for embedding
    functions.forEach(func => {
      const text = this.prepareFunctionText(func);
      if (text) {
        textsToEmbed.push(text);
        functionMap.set(textsToEmbed.length - 1, func);
      }
    });

    if (textsToEmbed.length === 0) {
      return [];
    }

    // Generate embeddings
    const embeddings = await this.batchGenerateEmbeddings(textsToEmbed);

    // Map embeddings back to functions
    const results: EmbeddingResult[] = [];
    embeddings.forEach((embedding, index) => {
      const func = functionMap.get(index);
      if (func) {
        results.push({
          functionId: func.id,
          semanticId: func.semanticId,
          embedding,
          model: this.model,
          timestamp: Date.now(),
        });
      }
    });

    return results;
  }

  /**
   * Prepare function text for embedding with prioritized content structure
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
   * Calculate cosine similarity between two vectors
   */
  static cosineSimilarity(vec1: number[], vec2: number[]): number {
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
   * Calculate euclidean distance between two vectors
   */
  static euclideanDistance(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      const diff = vec1[i] - vec2[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }
}

/**
 * ENHANCED SERVICE AVAILABLE
 *
 * For new implementations, consider using the enhanced embedding service:
 *
 * @example
 * import { EmbeddingServiceFactory, EmbeddingModel } from './embedding';
 *
 * // Builder pattern for flexible configuration
 * const service = EmbeddingServiceFactory.builder()
 *   .withOpenAIKey('your-api-key', EmbeddingModel.SMALL_3)
 *   .forProduction()
 *   .build();
 *
 * // Or use factory methods
 * const service = EmbeddingServiceFactory.createForProduction('your-api-key');
 *
 * Benefits of enhanced service:
 * - Incremental index updates (3-5x faster)
 * - Enhanced error handling with retry logic
 * - TypedArray optimization (50% memory reduction)
 * - Concurrent processing with rate limiting
 * - Separation of concerns architecture
 * - Production-ready logging and metrics
 */
