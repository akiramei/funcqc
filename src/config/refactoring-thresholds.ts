import { readFile } from 'fs/promises';
import { join } from 'path';
import { parse } from 'yaml';
import { RefactoringIntent } from '../types/index.js';

/**
 * Configuration structure for refactoring evaluation thresholds
 */
export interface RefactoringThresholds {
  riskDiffTolerance: number;
  maintainDiffTolerance: number;
  complexityReduction: Record<RefactoringIntent, number>;
  functionExplosion: {
    baseThreshold: number;
    slopeCoefficient: number;
    maxThreshold: number;
  };
  maintainabilityImprovement: Record<RefactoringIntent, number>;
  riskImprovement: Record<RefactoringIntent, number>;
  evaluation: {
    useLocalMode: boolean;
    useGlobalMode: boolean;
    requireSignificantChange: boolean;
    statisticalThreshold: number;
  };
}

/**
 * Default thresholds (fallback if file not found)
 */
const DEFAULT_THRESHOLDS: RefactoringThresholds = {
  riskDiffTolerance: 2,
  maintainDiffTolerance: 2,
  complexityReduction: {
    cleanup: 5,
    split: 0,
    extend: -5,
    rename: 0,
    extract: 0,
  },
  functionExplosion: {
    baseThreshold: 0.1,
    slopeCoefficient: 0.05,
    maxThreshold: 0.5,
  },
  maintainabilityImprovement: {
    cleanup: 10,
    split: 0,
    extend: -5,
    rename: 5,
    extract: 15,
  },
  riskImprovement: {
    cleanup: 10,
    split: 0,
    extend: -10,
    rename: 0,
    extract: 5,
  },
  evaluation: {
    useLocalMode: true,
    useGlobalMode: false,
    requireSignificantChange: true,
    statisticalThreshold: 0.05,
  },
};

/**
 * Loads refactoring thresholds from configuration file
 */
export class RefactoringThresholdLoader {
  private static cachedThresholds: RefactoringThresholds | null = null;
  private static lastLoadTime: number = 0;
  private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Load thresholds from thresholds.yaml file
   */
  static async loadThresholds(projectRoot?: string): Promise<RefactoringThresholds> {
    const now = Date.now();
    
    // Return cached version if still valid
    if (
      this.cachedThresholds &&
      now - this.lastLoadTime < this.CACHE_DURATION
    ) {
      return this.cachedThresholds;
    }

    try {
      const root = projectRoot || process.cwd();
      const thresholdsPath = join(root, 'thresholds.yaml');
      
      const content = await readFile(thresholdsPath, 'utf-8');
      const parsed = parse(content) as RefactoringThresholds;
      
      // Validate and merge with defaults
      const thresholds = this.validateAndMergeThresholds(parsed);
      
      // Cache the results
      this.cachedThresholds = thresholds;
      this.lastLoadTime = now;
      
      return thresholds;
    } catch (error) {
      console.warn(`Failed to load thresholds.yaml, using defaults: ${error instanceof Error ? error.message : String(error)}`);
      
      // Cache defaults to avoid repeated file system access
      this.cachedThresholds = DEFAULT_THRESHOLDS;
      this.lastLoadTime = now;
      
      return DEFAULT_THRESHOLDS;
    }
  }

  /**
   * Validate configuration and merge with defaults
   */
  private static validateAndMergeThresholds(parsed: Partial<RefactoringThresholds>): RefactoringThresholds {
    const result: RefactoringThresholds = { ...DEFAULT_THRESHOLDS };

    // Merge numeric values
    if (typeof parsed.riskDiffTolerance === 'number') {
      result.riskDiffTolerance = parsed.riskDiffTolerance;
    }
    if (typeof parsed.maintainDiffTolerance === 'number') {
      result.maintainDiffTolerance = parsed.maintainDiffTolerance;
    }

    // Merge complexity reduction thresholds
    if (parsed.complexityReduction) {
      Object.entries(parsed.complexityReduction).forEach(([intent, value]) => {
        if (typeof value === 'number' && intent in result.complexityReduction) {
          result.complexityReduction[intent as RefactoringIntent] = value;
        }
      });
    }

    // Merge function explosion settings
    if (parsed.functionExplosion) {
      if (typeof parsed.functionExplosion.baseThreshold === 'number') {
        result.functionExplosion.baseThreshold = parsed.functionExplosion.baseThreshold;
      }
      if (typeof parsed.functionExplosion.slopeCoefficient === 'number') {
        result.functionExplosion.slopeCoefficient = parsed.functionExplosion.slopeCoefficient;
      }
      if (typeof parsed.functionExplosion.maxThreshold === 'number') {
        result.functionExplosion.maxThreshold = parsed.functionExplosion.maxThreshold;
      }
    }

    // Merge maintainability improvement thresholds
    if (parsed.maintainabilityImprovement) {
      Object.entries(parsed.maintainabilityImprovement).forEach(([intent, value]) => {
        if (typeof value === 'number' && intent in result.maintainabilityImprovement) {
          result.maintainabilityImprovement[intent as RefactoringIntent] = value;
        }
      });
    }

    // Merge risk improvement thresholds
    if (parsed.riskImprovement) {
      Object.entries(parsed.riskImprovement).forEach(([intent, value]) => {
        if (typeof value === 'number' && intent in result.riskImprovement) {
          result.riskImprovement[intent as RefactoringIntent] = value;
        }
      });
    }

    // Merge evaluation settings
    if (parsed.evaluation) {
      if (typeof parsed.evaluation.useLocalMode === 'boolean') {
        result.evaluation.useLocalMode = parsed.evaluation.useLocalMode;
      }
      if (typeof parsed.evaluation.useGlobalMode === 'boolean') {
        result.evaluation.useGlobalMode = parsed.evaluation.useGlobalMode;
      }
      if (typeof parsed.evaluation.requireSignificantChange === 'boolean') {
        result.evaluation.requireSignificantChange = parsed.evaluation.requireSignificantChange;
      }
      if (typeof parsed.evaluation.statisticalThreshold === 'number') {
        result.evaluation.statisticalThreshold = parsed.evaluation.statisticalThreshold;
      }
    }

    return result;
  }

  /**
   * Get threshold for specific intent and metric
   */
  static async getComplexityReductionThreshold(intent: RefactoringIntent, projectRoot?: string): Promise<number> {
    const thresholds = await this.loadThresholds(projectRoot);
    return thresholds.complexityReduction[intent];
  }

  /**
   * Get function explosion threshold for given function size
   */
  static async getFunctionExplosionThreshold(functionLOC: number, projectRoot?: string): Promise<number> {
    const thresholds = await this.loadThresholds(projectRoot);
    const { baseThreshold, slopeCoefficient, maxThreshold } = thresholds.functionExplosion;
    
    // Validate function LOC input - ensure positive value for log calculation
    const validFunctionLOC = Math.max(1, functionLOC || 10);
    const dynamicThreshold = baseThreshold + slopeCoefficient * Math.log10(validFunctionLOC);
    return Math.min(dynamicThreshold, maxThreshold);
  }

  /**
   * Get maintainability improvement threshold
   */
  static async getMaintainabilityImprovementThreshold(intent: RefactoringIntent, projectRoot?: string): Promise<number> {
    const thresholds = await this.loadThresholds(projectRoot);
    return thresholds.maintainabilityImprovement[intent];
  }

  /**
   * Get risk improvement threshold
   */
  static async getRiskImprovementThreshold(intent: RefactoringIntent, projectRoot?: string): Promise<number> {
    const thresholds = await this.loadThresholds(projectRoot);
    return thresholds.riskImprovement[intent];
  }

  /**
   * Clear cached thresholds (for testing)
   */
  static clearCache(): void {
    this.cachedThresholds = null;
    this.lastLoadTime = 0;
  }
}