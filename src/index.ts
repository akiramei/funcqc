// funcqc - Function Quality Control for TypeScript
export * from './types';
export * from './core/analyzer';
export * from './core/config';
export * from './analyzers/typescript-analyzer';
export * from './storage/pglite-adapter';
export * from './metrics/quality-calculator';
export * from './utils/quality-scorer-v16';
export * from './config/thresholds-simple';

// Re-export main classes for programmatic usage
export { TypeScriptAnalyzer } from './analyzers/typescript-analyzer';
export { PGLiteStorageAdapter } from './storage/pglite-adapter';
export { QualityCalculator } from './metrics/quality-calculator';
export { ConfigManager } from './core/config';
export { QualityScorerV16 } from './utils/quality-scorer-v16';
export { ThresholdConfigManager, DEFAULT_QUALITY_SCORER_THRESHOLDS } from './config/thresholds-simple';

// Re-export new quality gate and candidate evaluator classes
export { RealTimeQualityGate } from './core/realtime-quality-gate';
