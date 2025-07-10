/**
 * Simplified configurable threshold system for funcqc
 * Provides default values and basic configuration for quality scorer thresholds
 */

import { QualityScorerThresholds, UserConfig } from '../types/index.js';

/**
 * Default quality scorer thresholds
 */
export const DEFAULT_QUALITY_SCORER_THRESHOLDS: QualityScorerThresholds = {
  complexity: {
    warning: 5,
    critical: 10,
    warningPenalty: 8,
    criticalPenalty: 15,
  },
  size: {
    warning: 20,
    critical: 50,
    warningPenalty: 2,
    criticalPenalty: 5,
  },
  maintainability: {
    critical: 50,
    warning: 70,
  },
  grading: {
    A: 90,
    B: 80,
    C: 70,
    D: 60,
  },
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
  private mergeWithDefaults(
    userConfig?: Partial<QualityScorerThresholds>
  ): QualityScorerThresholds {
    if (!userConfig) {
      return { ...DEFAULT_QUALITY_SCORER_THRESHOLDS };
    }

    return {
      complexity: { ...DEFAULT_QUALITY_SCORER_THRESHOLDS.complexity, ...userConfig.complexity },
      size: { ...DEFAULT_QUALITY_SCORER_THRESHOLDS.size, ...userConfig.size },
      maintainability: {
        ...DEFAULT_QUALITY_SCORER_THRESHOLDS.maintainability,
        ...userConfig.maintainability,
      },
      grading: { ...DEFAULT_QUALITY_SCORER_THRESHOLDS.grading, ...userConfig.grading },
    };
  }
}

/**
 * Parse threshold configuration from user input
 */
export function parseQualityThresholdConfig(
  userConfig: UserConfig
): Partial<QualityScorerThresholds> | null {
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
    throw new Error(
      `Invalid quality threshold configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Helper function to parse number field with default value
 */
function parseNumberField(
  config: Record<string, unknown>,
  field: string,
  defaultValue: number
): number {
  return typeof config[field] === 'number' ? config[field] : defaultValue;
}

/**
 * Helper function to parse threshold section with given field names
 */
function parseThresholdSection<T extends Record<string, number>>(
  config: Record<string, unknown>,
  sectionName: string,
  defaultSection: T,
  fieldNames: (keyof T)[]
): T | undefined {
  const section = config[sectionName];
  if (!section || typeof section !== 'object') {
    return undefined;
  }

  const sectionConfig = section as Record<string, unknown>;
  const parsed: Record<string, number> = {};

  for (const field of fieldNames) {
    const fieldName = field as string;
    const defaultValue = defaultSection[field];
    parsed[fieldName] = parseNumberField(sectionConfig, fieldName, defaultValue);
  }

  return parsed as T;
}

function parseQualityThresholds(config: Record<string, unknown>): Partial<QualityScorerThresholds> {
  const parsed: Partial<QualityScorerThresholds> = {};

  // Parse complexity section
  const complexity = parseThresholdSection(
    config,
    'complexity',
    DEFAULT_QUALITY_SCORER_THRESHOLDS.complexity,
    ['warning', 'critical', 'warningPenalty', 'criticalPenalty']
  );
  if (complexity) {
    parsed.complexity = complexity;
  }

  // Parse size section
  const size = parseThresholdSection(config, 'size', DEFAULT_QUALITY_SCORER_THRESHOLDS.size, [
    'warning',
    'critical',
    'warningPenalty',
    'criticalPenalty',
  ]);
  if (size) {
    parsed.size = size;
  }

  // Parse maintainability section
  const maintainability = parseThresholdSection(
    config,
    'maintainability',
    DEFAULT_QUALITY_SCORER_THRESHOLDS.maintainability,
    ['critical', 'warning']
  );
  if (maintainability) {
    parsed.maintainability = maintainability;
  }

  // Parse grading section
  const grading = parseThresholdSection(
    config,
    'grading',
    DEFAULT_QUALITY_SCORER_THRESHOLDS.grading,
    ['A', 'B', 'C', 'D']
  );
  if (grading) {
    parsed.grading = grading;
  }

  return parsed;
}
