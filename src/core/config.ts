import { cosmiconfigSync } from 'cosmiconfig';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  FuncqcConfig,
  UserConfig,
  QualityThresholds,
  MultiLevelThreshold,
  ThresholdValue,
  StatisticalThreshold,
  RiskAssessmentConfig,
  RiskCondition,
  ProjectContext,
  QualityScorerThresholds,
  FuncqcThresholds,
} from '../types';
import {
  ThresholdConfigManager,
  parseQualityThresholdConfig,
} from '../config/thresholds-simple.js';

const DEFAULT_CONFIG: FuncqcConfig = {
  roots: ['src'],
  exclude: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
  ],
  storage: {
    type: 'pglite',
    path: '.funcqc/funcqc.db',
  },
  metrics: {
    complexityThreshold: 10, // Cyclomatic Complexity > 10
    cognitiveComplexityThreshold: 15, // Cognitive Complexity > 15
    linesOfCodeThreshold: 40, // Lines of Code > 40
    parameterCountThreshold: 4, // Parameter Count > 4
    maxNestingLevelThreshold: 3, // Nesting Depth > 3
  },
  git: {
    enabled: true,
    autoLabel: true,
  },
};

export class ConfigManager {
  private config: FuncqcConfig | undefined;
  private explorer = cosmiconfigSync('funcqc');
  private thresholdManager: ThresholdConfigManager | undefined;

  // Static cache for lightweight config
  private static lightweightCache: { storage: { path: string } } | undefined;

  async load(): Promise<FuncqcConfig> {
    if (this.config) {
      return this.config;
    }

    const result = this.explorer.search();

    if (result) {
      this.config = this.validateAndMergeConfig(result.config);
    } else {
      this.config = { ...DEFAULT_CONFIG };
    }

    // Initialize threshold manager with config
    const qualityConfig = this.config.funcqcThresholds?.quality;
    this.thresholdManager = new ThresholdConfigManager(qualityConfig);

    return this.config;
  }

  getDefaults(): FuncqcConfig {
    return { ...DEFAULT_CONFIG };
  }

  /**
   * Lightweight config loading for read-only commands.
   * Only loads essential settings like storage path.
   */
  loadLightweight(): { storage: { path: string } } {
    if (ConfigManager.lightweightCache) {
      return ConfigManager.lightweightCache;
    }

    try {
      const result = this.explorer.search();
      const storagePath = result?.config?.storage?.path || DEFAULT_CONFIG.storage.path!;

      ConfigManager.lightweightCache = {
        storage: { path: storagePath },
      };

      return ConfigManager.lightweightCache;
    } catch {
      // Fallback to defaults if config loading fails
      ConfigManager.lightweightCache = {
        storage: { path: DEFAULT_CONFIG.storage.path! },
      };

      return ConfigManager.lightweightCache;
    }
  }

  private validateAndMergeConfig(userConfig: UserConfig): FuncqcConfig {
    const config: FuncqcConfig = { ...DEFAULT_CONFIG };

    this.mergeArrayConfigs(config, userConfig);
    this.mergeStorageConfig(config, userConfig);
    this.mergeMetricsConfig(config, userConfig);
    this.mergeGitConfig(config, userConfig);
    this.mergeSimilarityConfig(config, userConfig);
    this.mergeThresholdsConfig(config, userConfig);
    this.mergeFuncqcThresholdsConfig(config, userConfig);
    this.mergeAssessmentConfig(config, userConfig);
    this.mergeProjectContextConfig(config, userConfig);

    return config;
  }

  private mergeArrayConfigs(config: FuncqcConfig, userConfig: UserConfig): void {
    if (Array.isArray(userConfig.roots)) {
      config.roots = userConfig.roots.filter((root): root is string => typeof root === 'string');
    }

    if (Array.isArray(userConfig.exclude)) {
      config.exclude = userConfig.exclude.filter(
        (pattern): pattern is string => typeof pattern === 'string'
      );
    }

    if (Array.isArray(userConfig.include)) {
      config.include = userConfig.include.filter(
        (pattern): pattern is string => typeof pattern === 'string'
      );
    }
  }

  private mergeStorageConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.storage && typeof userConfig.storage === 'object') {
      if (userConfig.storage.type === 'pglite' || userConfig.storage.type === 'postgres') {
        config.storage.type = userConfig.storage.type;
      }

      if (typeof userConfig.storage.path === 'string') {
        config.storage.path = userConfig.storage.path;
      }

      if (typeof userConfig.storage.url === 'string') {
        config.storage.url = userConfig.storage.url;
      }
    }
  }

  private mergeMetricsConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.metrics && typeof userConfig.metrics === 'object') {
      if (typeof userConfig.metrics.complexityThreshold === 'number') {
        config.metrics.complexityThreshold = Math.max(1, userConfig.metrics.complexityThreshold);
      }

      if (typeof userConfig.metrics.linesOfCodeThreshold === 'number') {
        config.metrics.linesOfCodeThreshold = Math.max(1, userConfig.metrics.linesOfCodeThreshold);
      }

      if (typeof userConfig.metrics.parameterCountThreshold === 'number') {
        config.metrics.parameterCountThreshold = Math.max(
          1,
          userConfig.metrics.parameterCountThreshold
        );
      }
    }
  }

  private mergeGitConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.git && typeof userConfig.git === 'object') {
      if (typeof userConfig.git.enabled === 'boolean') {
        config.git.enabled = userConfig.git.enabled;
      }

      if (typeof userConfig.git.autoLabel === 'boolean') {
        config.git.autoLabel = userConfig.git.autoLabel;
      }
    }
  }

  private mergeSimilarityConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.similarity && typeof userConfig.similarity === 'object') {
      config.similarity = {
        detectors: {},
        consensus: { strategy: 'majority' },
        ...userConfig.similarity,
      };
    }
  }

  /**
   * Resolve a path relative to the config file location
   */
  resolvePath(relativePath: string): string {
    const result = this.explorer.search();

    if (result && result.filepath) {
      const configDir = path.dirname(result.filepath);
      return path.resolve(configDir, relativePath);
    }

    return path.resolve(process.cwd(), relativePath);
  }

  /**
   * Get the configuration file path
   */
  getConfigPath(): string | null {
    const result = this.explorer.search();
    return result ? result.filepath : null;
  }

  /**
   * Get threshold configuration manager
   */
  getThresholdManager(): ThresholdConfigManager {
    if (!this.thresholdManager) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.thresholdManager;
  }

  /**
   * Get quality scorer thresholds configuration
   */
  getQualityThresholds(): QualityScorerThresholds {
    return this.getThresholdManager().getQualityThresholds();
  }

  /**
   * Update quality scorer thresholds configuration
   */
  updateQualityThresholds(thresholds: Partial<QualityScorerThresholds>): void {
    this.getThresholdManager().updateThresholds(thresholds);

    // Update the cached config as well
    if (this.config) {
      if (!this.config.funcqcThresholds) {
        this.config.funcqcThresholds = {};
      }
      this.config.funcqcThresholds.quality = {
        ...this.config.funcqcThresholds.quality,
        ...thresholds,
      } as QualityScorerThresholds;
    }
  }

  /**
   * Invalidate cached config (for testing)
   */
  clearCache(): void {
    this.config = undefined;
    this.explorer.clearCaches();
    this.thresholdManager = new ThresholdConfigManager();
    ConfigManager.lightweightCache = undefined;
  }

  /**
   * Generate a hash of the scan-relevant configuration
   * This includes roots, exclude, include patterns that affect scan scope
   */
  generateScanConfigHash(config: FuncqcConfig): string {
    const scanRelevantConfig = {
      roots: config.roots.sort(), // Sort for consistent hashing
      exclude: config.exclude.sort(),
      include: config.include?.sort() || [],
    };

    const configString = JSON.stringify(scanRelevantConfig);
    return crypto.createHash('sha256').update(configString).digest('hex').substring(0, 12);
  }

  /**
   * Get current scan configuration hash
   */
  async getCurrentScanConfigHash(): Promise<string> {
    const config = await this.load();
    return this.generateScanConfigHash(config);
  }

  private mergeThresholdsConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.thresholds && typeof userConfig.thresholds === 'object') {
      config.thresholds = this.validateThresholds(userConfig.thresholds);
    }
  }

  private mergeAssessmentConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.assessment && typeof userConfig.assessment === 'object') {
      config.assessment = this.validateAssessmentConfig(userConfig.assessment);
    }
  }

  private mergeProjectContextConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.projectContext && typeof userConfig.projectContext === 'object') {
      config.projectContext = this.validateProjectContext(userConfig.projectContext);
    }
  }

  private mergeFuncqcThresholdsConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.funcqcThresholds && typeof userConfig.funcqcThresholds === 'object') {
      try {
        const parsedThresholds = parseQualityThresholdConfig(userConfig);
        if (parsedThresholds) {
          // For now, only store the quality thresholds
          config.funcqcThresholds = { quality: parsedThresholds } as Partial<FuncqcThresholds>;
        }
      } catch (error) {
        console.warn(
          `Invalid funcqc threshold configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  private validateThresholds(thresholds: Record<string, unknown>): QualityThresholds {
    const validatedThresholds: Partial<QualityThresholds> = {};

    const metricNames = [
      'complexity',
      'cognitiveComplexity',
      'lines',
      'totalLines',
      'parameters',
      'nestingLevel',
      'returnStatements',
      'branches',
      'loops',
      'tryCatch',
      'asyncAwait',
      'callbacks',
      'maintainability',
      'halsteadVolume',
      'halsteadDifficulty',
      'codeToCommentRatio',
    ];

    for (const metricName of metricNames) {
      if (thresholds[metricName] && typeof thresholds[metricName] === 'object') {
        validatedThresholds[metricName as keyof QualityThresholds] =
          this.validateMultiLevelThreshold(thresholds[metricName] as Record<string, unknown>);
      }
    }

    return validatedThresholds as QualityThresholds;
  }

  private validateMultiLevelThreshold(threshold: Record<string, unknown>): MultiLevelThreshold {
    const validated: Partial<MultiLevelThreshold> = {};

    (['warning', 'error', 'critical'] as const).forEach(level => {
      if (threshold[level] !== undefined) {
        validated[level] = this.validateThresholdValue(threshold[level]);
      }
    });

    return validated as MultiLevelThreshold;
  }

  private validateThresholdValue(value: unknown): ThresholdValue {
    if (typeof value === 'number' && value > 0) {
      return value;
    }

    if (typeof value === 'object' && value !== null && 'method' in value) {
      const validMethods = ['mean+sigma', 'percentile', 'median+mad'] as const;
      const method = (value as Record<string, unknown>)['method'];
      if (
        typeof method === 'string' &&
        validMethods.includes(method as (typeof validMethods)[number])
      ) {
        const validated: Partial<StatisticalThreshold> = {
          method: method as StatisticalThreshold['method'],
        };

        const valueObj = value as Record<string, unknown>;
        if (typeof valueObj['multiplier'] === 'number' && valueObj['multiplier'] > 0) {
          validated.multiplier = valueObj['multiplier'];
        }

        if (
          typeof valueObj['percentile'] === 'number' &&
          valueObj['percentile'] >= 0 &&
          valueObj['percentile'] <= 100
        ) {
          validated.percentile = valueObj['percentile'];
        }

        return validated as StatisticalThreshold;
      }
    }

    throw new Error(`Invalid threshold value: ${JSON.stringify(value)}`);
  }

  private validateAssessmentConfig(assessment: Record<string, unknown>): RiskAssessmentConfig {
    const validated: Partial<RiskAssessmentConfig> = {};

    if (Array.isArray(assessment['highRiskConditions'])) {
      validated.highRiskConditions = (assessment['highRiskConditions'] as unknown[]).filter(
        (condition): condition is RiskCondition =>
          typeof condition === 'object' &&
          condition !== null &&
          'metric' in condition &&
          'threshold' in condition
      );
    }

    if (typeof assessment['minViolations'] === 'number' && assessment['minViolations'] >= 0) {
      validated.minViolations = Math.floor(assessment['minViolations']);
    }

    if (assessment['violationWeights'] && typeof assessment['violationWeights'] === 'object') {
      validated.violationWeights = {} as Record<'warning' | 'error' | 'critical', number>;
      const weights = assessment['violationWeights'] as Record<string, unknown>;
      (['warning', 'error', 'critical'] as const).forEach(level => {
        if (typeof weights[level] === 'number' && weights[level] > 0) {
          validated.violationWeights![level] = weights[level];
        }
      });
    }

    const scoringMethod = assessment['compositeScoringMethod'];
    if (
      typeof scoringMethod === 'string' &&
      ['count', 'weighted', 'severity'].includes(scoringMethod)
    ) {
      validated.compositeScoringMethod = scoringMethod as 'count' | 'weighted' | 'severity';
    }

    return validated as RiskAssessmentConfig;
  }

  private validateProjectContext(context: Record<string, unknown>): ProjectContext {
    const validated: Partial<ProjectContext> = {};

    const experienceLevel = context['experienceLevel'];
    if (
      typeof experienceLevel === 'string' &&
      ['junior', 'mid', 'senior'].includes(experienceLevel)
    ) {
      validated.experienceLevel = experienceLevel as 'junior' | 'mid' | 'senior';
    }

    const projectType = context['projectType'];
    if (
      typeof projectType === 'string' &&
      ['prototype', 'production', 'legacy'].includes(projectType)
    ) {
      validated.projectType = projectType as 'prototype' | 'production' | 'legacy';
    }

    const codebaseSize = context['codebaseSize'];
    if (typeof codebaseSize === 'string' && ['small', 'medium', 'large'].includes(codebaseSize)) {
      validated.codebaseSize = codebaseSize as 'small' | 'medium' | 'large';
    }

    const domain = context['domain'];
    if (
      typeof domain === 'string' &&
      ['web', 'api', 'cli', 'library', 'embedded'].includes(domain)
    ) {
      validated.domain = domain as 'web' | 'api' | 'cli' | 'library' | 'embedded';
    }

    return validated as ProjectContext;
  }
}
