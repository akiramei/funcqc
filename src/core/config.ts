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
  // Legacy support - deprecated in favor of scopes
  roots: ['src'],
  exclude: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
  ],
  
  // New scope-based configuration
  defaultScope: 'src',
  globalExclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
  ],
  
  // スコープ設定: 用途別の独立した品質管理
  scopes: {
    src: {
      roots: ['src'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
      ],
      description: 'Production source code - high quality standards'
    },
    test: {
      roots: ['test', 'tests', '__tests__', 'src/__tests__'],
      include: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js'],
      exclude: [],
      description: 'Test code files - readability focused'
    },
    all: {
      roots: ['src', 'test', 'tests', '__tests__'],
      exclude: [],
      description: 'Complete codebase overview'
    }
  },
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
  
  // Default backup configuration
  backup: {
    outputDir: '.funcqc/backups',
    naming: {
      format: 'YYYYMMDD-HHMMSS',
      includeLabel: true,
      includeGitInfo: true,
    },
    defaults: {
      includeSourceCode: false,
      compress: false,
      format: 'json',
      tableOrder: 'auto',
    },
    retention: {
      maxBackups: 10,
      maxAge: '30d',
      autoCleanup: true,
    },
    schema: {
      autoDetectVersion: true,
      conversionRulesDir: '.funcqc/conversion-rules',
    },
    security: {
      excludeSensitiveData: true,
      encryptBackups: false,
    },
    advanced: {
      parallelTableExport: true,
      verifyIntegrity: true,
      includeMetrics: true,
    },
  },
};

export class ConfigManager {
  private config: FuncqcConfig | undefined;
  private configPath: string | null = null;
  private explorer = cosmiconfigSync('funcqc', {
    searchPlaces: [
      '.funcqcrc',
      '.funcqcrc.json',
      '.funcqcrc.yaml',
      '.funcqcrc.yml',
      '.funcqcrc.js',
      'funcqc.config.js',
      '.funcqc.config.js',
      'package.json'
    ]
  });
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
      this.configPath = result.filepath;
    } else {
      this.config = { ...DEFAULT_CONFIG };
      this.configPath = null;
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
    this.mergeScopesConfig(config, userConfig);
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

  private mergeScopesConfig(config: FuncqcConfig, userConfig: UserConfig): void {
    if (userConfig.scopes && typeof userConfig.scopes === 'object') {
      // User provided scopes configuration - start with default scopes and merge user scopes
      config.scopes = { ...config.scopes };
      
      for (const [scopeName, scopeConfig] of Object.entries(userConfig.scopes)) {
        if (scopeConfig && typeof scopeConfig === 'object' && Array.isArray(scopeConfig.roots)) {
          config.scopes![scopeName] = {
            roots: scopeConfig.roots.filter((root): root is string => typeof root === 'string'),
            exclude: Array.isArray(scopeConfig.exclude) 
              ? scopeConfig.exclude.filter((pattern): pattern is string => typeof pattern === 'string')
              : [],
            ...(Array.isArray(scopeConfig.include) && {
              include: scopeConfig.include.filter((pattern): pattern is string => typeof pattern === 'string')
            }),
            ...(typeof scopeConfig.description === 'string' && {
              description: scopeConfig.description
            })
          };
        }
      }
    } else {
      // User did not provide scopes configuration - remove default scopes to allow fallback
      delete config.scopes;
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

      if (typeof userConfig.metrics.cognitiveComplexityThreshold === 'number') {
        config.metrics.cognitiveComplexityThreshold = Math.max(
          1,
          userConfig.metrics.cognitiveComplexityThreshold
        );
      }

      if (typeof userConfig.metrics.maxNestingLevelThreshold === 'number') {
        config.metrics.maxNestingLevelThreshold = Math.max(
          1,
          userConfig.metrics.maxNestingLevelThreshold
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

    if (result?.filepath) {
      const configDir = path.dirname(result.filepath);
      return path.resolve(configDir, relativePath);
    }

    return path.resolve(process.cwd(), relativePath);
  }

  /**
   * Get the configuration file path
   */
  getConfigPath(): string | null {
    return this.configPath;
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
   * Resolve scope configuration to get scan paths and filters
   */
  resolveScopeConfig(scopeName?: string): { roots: string[]; exclude: string[]; include?: string[]; description?: string } {
    const config = this.config || this.getDefaults();
    
    // Use default scope if none specified
    if (!scopeName) {
      scopeName = config.defaultScope || 'src';
    }
    
    // Check if scope exists in configuration
    if (config.scopes && config.scopes[scopeName]) {
      const scopeConfig = config.scopes[scopeName];
      let excludePatterns = scopeConfig.exclude || [];
      
      // Apply global exclude patterns
      if (config.globalExclude) {
        excludePatterns = Array.from(new Set([...excludePatterns, ...config.globalExclude]));
      }
      
      const result: { roots: string[]; exclude: string[]; include?: string[]; description?: string } = {
        roots: scopeConfig.roots,
        exclude: excludePatterns
      };
      
      // Only include optional properties if they are defined
      if (scopeConfig.include) {
        result.include = scopeConfig.include;
      }
      if (scopeConfig.description) {
        result.description = scopeConfig.description;
      }
      
      return result;
    }

    // If scope doesn't exist, fall back to legacy configuration
    if (scopeName === 'src' || scopeName === 'default') {
      const result: { roots: string[]; exclude: string[]; include?: string[]; description?: string } = {
        roots: config.roots,
        exclude: config.exclude,
        description: 'Legacy default configuration'
      };
      
      // Only include optional properties if they are defined
      if (config.include) {
        result.include = config.include;
      }
      
      return result;
    }

    throw new Error(`Unknown scope: ${scopeName}. Available scopes: ${Object.keys(config.scopes || {}).join(', ')}`);
  }

  /**
   * Get available scope names
   */
  getAvailableScopes(): string[] {
    const config = this.config || this.getDefaults();
    return Object.keys(config.scopes || { src: {} });
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
