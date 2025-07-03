/**
 * Simplified configurable threshold system for funcqc
 * Provides default values and basic configuration for quality scorer thresholds
 */

import { 
  QualityScorerThresholds,
  UserConfig
} from '../types/index.js';

/**
 * Default quality scorer thresholds
 */
export const DEFAULT_QUALITY_SCORER_THRESHOLDS: QualityScorerThresholds = {
  complexity: {
    warning: 5,
    critical: 10,
    warningPenalty: 8,
    criticalPenalty: 15
  },
  size: {
    warning: 20,
    critical: 50,
    warningPenalty: 2,
    criticalPenalty: 5
  },
  maintainability: {
    critical: 50,
    warning: 70
  },
  grading: {
    A: 90,
    B: 80,
    C: 70,
    D: 60
  }
};

/**
 * Threshold configuration manager
 */
export class ThresholdConfigManager {
  private thresholds: QualityScorerThresholds;

  constructor(userConfig?: Partial<QualityScorerThresholds>) {
    this.thresholds = this.mergeWithDefaults(userConfig);
  }

  /**
   * Get quality scorer thresholds
   */
  getQualityThresholds(): QualityScorerThresholds {
    return { ...this.thresholds };
  }

  /**
   * Update threshold configuration
   */
  updateThresholds(newThresholds: Partial<QualityScorerThresholds>): void {
    this.thresholds = this.mergeWithDefaults(newThresholds);
    this.validateThresholds();
  }

  /**
   * Validate threshold configuration
   */
  validateThresholds(): boolean {
    const { complexity, size, maintainability, grading } = this.thresholds;
    
    // Validate complexity thresholds
    if (complexity.warning >= complexity.critical) {
      throw new Error('Complexity warning threshold must be less than critical threshold');
    }
    
    // Validate size thresholds
    if (size.warning >= size.critical) {
      throw new Error('Size warning threshold must be less than critical threshold');
    }
    
    // Validate maintainability thresholds
    if (maintainability.critical >= maintainability.warning) {
      throw new Error('Maintainability critical threshold must be less than warning threshold');
    }
    
    // Validate grading thresholds are in descending order
    if (grading.A <= grading.B || grading.B <= grading.C || grading.C <= grading.D) {
      throw new Error('Grading thresholds must be in descending order (A > B > C > D)');
    }

    return true;
  }

  /**
   * Merge user configuration with defaults
   */
  private mergeWithDefaults(userConfig?: Partial<QualityScorerThresholds>): QualityScorerThresholds {
    if (!userConfig) {
      return { ...DEFAULT_QUALITY_SCORER_THRESHOLDS };
    }

    return {
      complexity: { ...DEFAULT_QUALITY_SCORER_THRESHOLDS.complexity, ...userConfig.complexity },
      size: { ...DEFAULT_QUALITY_SCORER_THRESHOLDS.size, ...userConfig.size },
      maintainability: { ...DEFAULT_QUALITY_SCORER_THRESHOLDS.maintainability, ...userConfig.maintainability },
      grading: { ...DEFAULT_QUALITY_SCORER_THRESHOLDS.grading, ...userConfig.grading }
    };
  }
}

/**
 * Parse threshold configuration from user input
 */
export function parseQualityThresholdConfig(userConfig: UserConfig): Partial<QualityScorerThresholds> | null {
  if (!userConfig.funcqcThresholds || typeof userConfig.funcqcThresholds !== 'object') {
    return null;
  }

  const config = userConfig.funcqcThresholds as Record<string, unknown>;
  const qualityConfig = config['quality'];
  
  if (!qualityConfig || typeof qualityConfig !== 'object') {
    return null;
  }

  try {
    return parseQualityThresholds(qualityConfig as Record<string, unknown>);
  } catch (error) {
    throw new Error(`Invalid quality threshold configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function parseQualityThresholds(config: Record<string, unknown>): Partial<QualityScorerThresholds> {
  const parsed: Partial<QualityScorerThresholds> = {};

  if (config['complexity'] && typeof config['complexity'] === 'object') {
    const complexity = config['complexity'] as Record<string, unknown>;
    parsed.complexity = {
      warning: typeof complexity['warning'] === 'number' ? complexity['warning'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.complexity.warning,
      critical: typeof complexity['critical'] === 'number' ? complexity['critical'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.complexity.critical,
      warningPenalty: typeof complexity['warningPenalty'] === 'number' ? complexity['warningPenalty'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.complexity.warningPenalty,
      criticalPenalty: typeof complexity['criticalPenalty'] === 'number' ? complexity['criticalPenalty'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.complexity.criticalPenalty
    };
  }

  if (config['size'] && typeof config['size'] === 'object') {
    const size = config['size'] as Record<string, unknown>;
    parsed.size = {
      warning: typeof size['warning'] === 'number' ? size['warning'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.size.warning,
      critical: typeof size['critical'] === 'number' ? size['critical'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.size.critical,
      warningPenalty: typeof size['warningPenalty'] === 'number' ? size['warningPenalty'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.size.warningPenalty,
      criticalPenalty: typeof size['criticalPenalty'] === 'number' ? size['criticalPenalty'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.size.criticalPenalty
    };
  }

  if (config['maintainability'] && typeof config['maintainability'] === 'object') {
    const maintainability = config['maintainability'] as Record<string, unknown>;
    parsed.maintainability = {
      critical: typeof maintainability['critical'] === 'number' ? maintainability['critical'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.maintainability.critical,
      warning: typeof maintainability['warning'] === 'number' ? maintainability['warning'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.maintainability.warning
    };
  }

  if (config['grading'] && typeof config['grading'] === 'object') {
    const grading = config['grading'] as Record<string, unknown>;
    parsed.grading = {
      A: typeof grading['A'] === 'number' ? grading['A'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.grading.A,
      B: typeof grading['B'] === 'number' ? grading['B'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.grading.B,
      C: typeof grading['C'] === 'number' ? grading['C'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.grading.C,
      D: typeof grading['D'] === 'number' ? grading['D'] : DEFAULT_QUALITY_SCORER_THRESHOLDS.grading.D
    };
  }

  return parsed;
}