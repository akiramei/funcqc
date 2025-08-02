import { BaseCommandOptions } from '../../../types/command';
import { IneffectiveSplitRule } from '../../../analyzers/ineffective-split-detector';

/**
 * Options for detect command
 */
export interface DetectCommandOptions extends BaseCommandOptions {
  json?: boolean;
  format?: 'table' | 'json';
  minSeverity?: string;
  includeTest?: boolean;
  includeBoundaries?: boolean;
  limit?: string;
  threshold?: string;
  snapshot?: string;
}

/**
 * Subcommand types for detect
 */
export type DetectSubcommand = 'ineffective-splits';

/**
 * Output format for ineffective splits detection
 */
export interface IneffectiveSplitsOutput {
  summary: {
    totalFindings: number;
    displayedFindings: number;
    severityBreakdown: {
      high: number;
      medium: number;
      low: number;
    };
    displayedSeverityBreakdown: {
      high: number;
      medium: number;
      low: number;
    };
    filters: {
      minSeverity?: string;
      includeTest: boolean;
      includeBoundaries: boolean;
      threshold?: number;
    };
  };
  findings: Array<{
    id: string;
    name: string;
    file: string;
    line: number;
    severity: 'High' | 'Medium' | 'Low';
    score: number;
    rules: Array<{
      code: IneffectiveSplitRule;
      evidence: string;
    }>;
    metrics: {
      cc: number;
      sloc: number;
      fanIn: number;
      fanOut: number;
    };
    suggestions: string[];
    callers: string[];
    callees: string[];
  }>;
}

/**
 * Severity level for findings
 */
export type SeverityLevel = 'High' | 'Medium' | 'Low';

/**
 * Display options for formatted output
 */
export interface DisplayOptions {
  showMetrics: boolean;
  showSuggestions: boolean;
  showRelated: boolean;
  useColor: boolean;
}