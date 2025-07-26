/**
 * Type definitions for health command
 */

// Type definitions for health command

export interface ComponentScore {
  grade: string;
  score: number;
}

export interface HealthData {
  overallGrade: string;
  overallScore: number;
  healthIndex: number;
  healthGrade: string;
  complexity: ComponentScore;
  maintainability: ComponentScore;
  codeSize: ComponentScore;
  structuralDangerScore: number;
  structure?: StructuralMetrics;
  rawHealthIndex?: number; // Before risk multiplier adjustment
}

export interface StructuralMetrics {
  totalComponents: number;
  largestComponentSize: number;
  cyclicFunctions: number;
  hubFunctions: number;
  avgFanIn: number;
  avgFanOut: number;
  maxFanIn: number;
  maxFanOut: number;
  structuralRisk: 'low' | 'medium' | 'high' | 'critical';
  hubThreshold?: number; // Dynamic threshold used for hub detection
  penaltyBreakdown?: StructuralPenaltyBreakdown; // Detailed penalty information
  // Additional data for overlap detection
  hubFunctionIds?: string[]; // IDs of hub functions
  cyclicFunctionIds?: string[]; // IDs of cyclic functions
  // PageRank centrality data
  pageRank?: PageRankMetrics;
}

export interface PageRankMetrics {
  totalFunctions: number;
  converged: boolean;
  iterations: number;
  averageScore: number;
  maxScore: number;
  centralityVariance: number;
  centralityGini: number;
  importanceDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  topCentralFunctions: Array<{
    functionId: string;
    functionName: string;
    centrality: number;
  }>;
}

export interface StructuralPenaltyBreakdown {
  largestComponent: number;    // Penalty from largest SCC component
  cyclicFunctions: number;     // Penalty from cyclic functions
  hubFunctions: number;        // Penalty from excessive hub functions
  maxFanIn: number;           // Penalty from high fan-in coupling
  totalPenalty: number;       // Sum of all penalties
  riskMultiplier: number;     // Risk-based adjustment multiplier
  duplicateAdjustment?: number; // Reduction for hub∩cycle overlap
  hubCyclicOverlap?: number;   // Number of functions that are both hub and cyclic
}

export interface RiskCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface HealthComparisonData {
  current: HealthData;
  previous: HealthData;
  changes: {
    healthIndex: number;
    overallScore: number;
    riskCounts: {
      high: number;
      medium: number;
      low: number;
    };
  };
}

export interface EnhancedRiskStats {
  average: number;
  median: number;
  p90: number;
  riskPerLOC: number;
}

export interface TrendPoint {
  date: string;
  healthIndex: number;
  overallScore: number;
  highRiskCount: number;
}