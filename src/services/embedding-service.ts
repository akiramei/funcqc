import OpenAI from 'openai';
import { FunctionInfo } from '../types';

export interface EmbeddingConfig {
  apiKey?: string;
  model?: string;
  dimension?: number;
  batchSize?: number;
}

// Supported embedding models with their configurations
export const EMBEDDING_MODELS = {
  'text-embedding-ada-002': { dimension: 1536, maxTokens: 8191 },
  'text-embedding-3-small': { dimension: 1536, maxTokens: 8191 },
  'text-embedding-3-large': { dimension: 3072, maxTokens: 8191 }
} as const;

export type EmbeddingModelName = keyof typeof EMBEDDING_MODELS;

export interface EmbeddingResult {
  functionId: string;
  semanticId: string;
  embedding: number[];
  model: string;
  timestamp: number;
}

export class EmbeddingService {
  private openai: OpenAI | null = null;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly modelConfig: { dimension: number; maxTokens: number };

  constructor(config: EmbeddingConfig = {}) {
    this.model = config.model || 'text-embedding-3-small';
    this.batchSize = config.batchSize || 100;
    
    // Validate and get model configuration
    if (!(this.model in EMBEDDING_MODELS)) {
      throw new Error(`Unsupported embedding model: ${this.model}. Supported models: ${Object.keys(EMBEDDING_MODELS).join(', ')}`);
    }
    this.modelConfig = EMBEDDING_MODELS[this.model as EmbeddingModelName];

    if (config.apiKey) {
      this.openai = new OpenAI({ apiKey: config.apiKey });
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
      maxTokens: this.modelConfig.maxTokens
    };
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
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
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
        throw new Error(`Failed to generate embeddings for batch ${i / this.batchSize + 1}: ${error instanceof Error ? error.message : String(error)}`);
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
          timestamp: Date.now()
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