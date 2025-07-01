import OpenAI from 'openai';
import { FunctionInfo } from '../types';

export interface EmbeddingConfig {
  apiKey?: string;
  model?: string;
  dimension?: number;
  batchSize?: number;
}

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

  constructor(config: EmbeddingConfig = {}) {
    this.model = config.model || 'text-embedding-ada-002';
    this.batchSize = config.batchSize || 100;

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
   * Prepare function text for embedding
   */
  private prepareFunctionText(func: FunctionInfo): string {
    const parts: string[] = [];

    // Add function name and signature
    parts.push(`Function: ${func.displayName}`);
    parts.push(`Signature: ${func.signature}`);

    // Add description if available
    if (func.description) {
      parts.push(`Description: ${func.description}`);
    }

    // Add JSDoc if available and no description
    if (!func.description && func.jsDoc) {
      const cleanedJsDoc = this.cleanJsDoc(func.jsDoc);
      if (cleanedJsDoc) {
        parts.push(`Documentation: ${cleanedJsDoc}`);
      }
    }

    // Add parameter information
    if (func.parameters.length > 0) {
      const paramInfo = func.parameters
        .map(p => `${p.name}: ${p.typeSimple}`)
        .join(', ');
      parts.push(`Parameters: ${paramInfo}`);
    }

    // Add file context
    parts.push(`File: ${func.filePath}`);

    return parts.join(' | ');
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