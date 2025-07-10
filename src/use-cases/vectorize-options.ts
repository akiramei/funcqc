/**
 * Validation schemas and types for vectorize command options
 */

import { z } from 'zod';

// Valid ANN algorithms
export const ANNAlgorithmSchema = z.enum(['hierarchical', 'lsh', 'hybrid']);
export type ANNAlgorithm = z.infer<typeof ANNAlgorithmSchema>;

// Valid embedding models
export const EmbeddingModelSchema = z.enum([
  'text-embedding-ada-002',
  'text-embedding-3-small',
  'text-embedding-3-large',
]);
export type EmbeddingModel = z.infer<typeof EmbeddingModelSchema>;

// Output format options
export const OutputFormatSchema = z.enum(['console', 'json']);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

// Base vectorize options schema
export const VectorizeOptionsSchema = z
  .object({
    // Operation modes (mutually exclusive)
    all: z.boolean().optional(),
    recent: z.boolean().optional(),
    status: z.boolean().optional(),

    // Index operations
    rebuildIndex: z.boolean().optional(),
    benchmark: z.boolean().optional(),
    indexStats: z.boolean().optional(),

    // Configuration options
    apiKey: z.string().optional(),
    model: EmbeddingModelSchema.default('text-embedding-3-small'),
    batchSize: z.coerce.number().min(1).max(1000).default(100),
    limit: z.coerce.number().min(1).optional(),

    // ANN Index options
    indexAlgorithm: ANNAlgorithmSchema.default('hierarchical'),
    indexConfig: z.string().optional(), // JSON string

    // Output options
    output: OutputFormatSchema.default('console'),
    quiet: z.boolean().optional(),

    // Confirmation options
    force: z.boolean().optional(), // Skip confirmation prompts
  })
  .refine(
    data => {
      // Mutual exclusion: only one operation mode can be specified
      const operationModes = [data.all, data.recent, data.status].filter(Boolean);
      return operationModes.length <= 1;
    },
    {
      message: 'Cannot specify multiple operation modes (--all, --recent, --status) simultaneously',
      path: ['all', 'recent', 'status'],
    }
  )
  .transform(data => {
    // If no operation mode is specified, default to recent
    const operationModes = [data.all, data.recent, data.status].filter(Boolean);
    if (operationModes.length === 0) {
      return { ...data, recent: true };
    }
    return data;
  });

export type VectorizeOptions = z.infer<typeof VectorizeOptionsSchema>;

// Validation result types
export interface ValidationResult {
  success: boolean;
  data?: VectorizeOptions;
  errors?: string[];
}

// Parsed index config type
export interface ParsedIndexConfig {
  clusters: number | undefined;
  hashBits: number | undefined;
  projectionCount: number | undefined;
  maxLeafSize: number | undefined;
  buildThreshold: number | undefined;
}

/**
 * Validates and parses vectorize command options
 */
export class VectorizeOptionsValidator {
  /**
   * Validate options with comprehensive error reporting
   */
  validate(rawOptions: unknown): ValidationResult {
    try {
      const data = VectorizeOptionsSchema.parse(rawOptions);
      return { success: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
        return { success: false, errors };
      }
      return {
        success: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  /**
   * Parse and validate JSON index configuration
   */
  parseIndexConfig(configJson?: string): ParsedIndexConfig | null {
    if (!configJson) return null;

    try {
      const parsed = JSON.parse(configJson);

      // Validate the structure (strict mode - no unknown keys)
      const schema = z
        .object({
          clusters: z.number().min(1).optional(),
          hashBits: z.number().min(1).max(64).optional(),
          projectionCount: z.number().min(1).optional(),
          maxLeafSize: z.number().min(1).optional(),
          buildThreshold: z.number().min(1).optional(),
        })
        .strict();

      const result = schema.parse(parsed);
      return {
        clusters: result.clusters || undefined,
        hashBits: result.hashBits || undefined,
        projectionCount: result.projectionCount || undefined,
        maxLeafSize: result.maxLeafSize || undefined,
        buildThreshold: result.buildThreshold || undefined,
      };
    } catch (error) {
      throw new Error(
        `Invalid index configuration JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if the operation requires API key
   */
  requiresApiKey(options: VectorizeOptions): boolean {
    return Boolean(options.all || options.recent || options.rebuildIndex);
  }

  /**
   * Check if the operation is potentially dangerous
   */
  isDangerousOperation(options: VectorizeOptions): boolean {
    return Boolean(options.all);
  }

  /**
   * Get operation description for confirmation prompts
   */
  getOperationDescription(options: VectorizeOptions): string {
    if (options.all) {
      return 'Re-vectorize ALL functions with descriptions (this may be expensive)';
    }
    if (options.recent) {
      return 'Vectorize functions without embeddings';
    }
    if (options.rebuildIndex) {
      return 'Rebuild ANN index for faster search';
    }
    if (options.status) {
      return 'Show vectorization status';
    }
    return 'Unknown operation';
  }
}
