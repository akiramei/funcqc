/**
 * Use Cases module exports
 *
 * This module exports all use case classes and related types for vectorization operations.
 * Use cases encapsulate business logic separate from CLI concerns.
 */

export { VectorizeUseCase } from './vectorize-use-case';
export type {
  VectorizeResult,
  VectorizeData,
  StatusData,
  IndexData,
  BenchmarkData,
  VectorizeUseCaseDependencies,
} from './vectorize-use-case';

export { VectorizeOptionsValidator } from './vectorize-options';
export type {
  VectorizeOptions,
  ANNAlgorithm,
  EmbeddingModel,
  OutputFormat,
  ValidationResult,
  ParsedIndexConfig,
} from './vectorize-options';

export { ConfirmationHandler } from './confirmation-handler';
export type { ConfirmationOptions, ConfirmationResult } from './confirmation-handler';

export { OutputFormatter } from './output-formatter';
export type { FormatterOptions } from './output-formatter';
