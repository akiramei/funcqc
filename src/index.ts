// funcqc - Function Quality Control for TypeScript
export * from './types';
export * from './core/analyzer';
export * from './core/config';
export * from './analyzers/typescript-analyzer';
export * from './storage/pglite-adapter';
export * from './metrics/quality-calculator';

// Re-export main classes for programmatic usage
export { TypeScriptAnalyzer } from './analyzers/typescript-analyzer';
export { PGLiteStorageAdapter } from './storage/pglite-adapter';
export { QualityCalculator } from './metrics/quality-calculator';
export { ConfigManager } from './core/config';
