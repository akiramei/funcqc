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
  // Additional rate calculations
  highRiskFunctionRate?: number; // Percentage of high risk functions
  criticalViolationRate?: number; // Percentage of critical violations
  totalFunctionCount?: number; // Total number of functions analyzed
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
    filePath: string;
    startLine: number;
    centrality: number;
  }>;
  // Layer-based analysis (optional)
  layerBasedAnalysis?: {
    overallMetrics: {
      totalFunctions: number;
      totalLayers: number;
      analyzedLayers: number;
    };
    layerResults: Array<{
      layerName: string;
      functionCount: number;
      topFunctions: Array<{
        functionId: string;
        functionName: string;
        filePath: string;
        startLine: number;
        centrality: number;
      }>;
      giniCoefficient: number;
    }>;
    crossLayerInsights: string[];
  };
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

export interface RecommendedAction {
  priority: number;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  riskScore: number;
  action: string;
  suggestions: string[];
  metrics: {
    cyclomaticComplexity: number;
    linesOfCode: number;
  };
}

export interface RiskDistribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

// RESTORED: Original HealthData interface for JSON output
export interface HealthDataForJSON {
  status: 'success' | 'no-data';
  message?: string;
  snapshot?: {
    id: string;
    createdAt: string;
    totalFunctions: number;
  };
  quality?: {
    overallGrade: string;
    overallScore: number;
    // NEW: Integrated health scoring
    healthIndex?: number;
    healthGrade?: string;
    structuralDanger?: number;
    highRiskRate?: number;
    criticalViolationRate?: number;
    averageRiskScore?: number;
    complexity: {
      grade: string;
      score: number;
    };
    maintainability: {
      grade: string;
      score: number;
    };
    size: {
      grade: string;
      score: number;
    };
  };
  risk?: {
    distribution: RiskDistribution;
    percentages: {
      high: number;
      medium: number;
      low: number;
      critical: number;
    };
    averageRiskScore?: number;
    highestRiskFunction?: {
      name: string;
      riskScore: number;
      location: string;
    } | undefined;
  };
  git?: unknown;
  recommendations?: RecommendedAction[] | undefined;
}

export interface FunctionRiskAssessment {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  violations: Array<{
    type: string;
    level: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    threshold?: number;
    actual?: number;
  }>;
  metrics: {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    linesOfCode: number;
    maintainabilityIndex: number;
    parameterCount: number;
    nestingDepth: number;
  };
}

// RESTORED: Trend analysis types from original implementation
export interface TrendData {
  period: string;
  snapshots: Array<{ id: string; createdAt: number; metadata?: { avgComplexity?: number; totalFunctions?: number; complexityDistribution?: Record<string, number> } }>;
  avgComplexity: number;
  totalFunctions: number;
  highRiskCount: number;
  qualityScore: number;
  healthIndex?: number;
  structuralDanger?: number;
  trend: 'improving' | 'stable' | 'degrading';
}

export interface TrendAnalysis {
  periods: TrendData[];
  overallTrend: 'improving' | 'stable' | 'degrading';
  keyInsights: string[];
  recommendations: string[];
}