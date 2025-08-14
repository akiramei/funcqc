/**
 * Type analysis result definitions for funcqc
 * These types represent various analysis results and reports for type insights
 */

// Re-export all type analysis report types
export type { 
  CochangeAnalysisReport,
  CochangeAnalysisOptions,
  TypeChangeInfo,
  CochangeRelation,
  ModuleSuggestion,
  GitCommitInfo,
  GitProvider
} from '../analyzers/type-insights/cochange-analyzer';

// Common analysis interfaces that could be extended for other analyzers
export interface AnalysisMetadata {
  snapshotId?: string;
  analysisDate: Date;
  analysisType: string;
  version: string;
}

export interface AnalysisStatistics {
  totalItems: number;
  analyzedItems: number;
  timeSpan: string;
  executionTime?: number;
}