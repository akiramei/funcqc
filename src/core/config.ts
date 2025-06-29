import { cosmiconfigSync } from 'cosmiconfig';
import * as path from 'path';
import { FuncqcConfig } from '../types';

const DEFAULT_CONFIG: FuncqcConfig = {
  roots: ['src'],
  exclude: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**'
  ],
  storage: {
    type: 'pglite',
    path: '.funcqc/funcqc.db'
  },
  metrics: {
    complexityThreshold: 10,           // Cyclomatic Complexity > 10
    cognitiveComplexityThreshold: 15,  // Cognitive Complexity > 15
    linesOfCodeThreshold: 40,          // Lines of Code > 40
    parameterCountThreshold: 4,        // Parameter Count > 4
    maxNestingLevelThreshold: 3        // Nesting Depth > 3
  },
  git: {
    enabled: true,
    autoLabel: true
  }
};

export class ConfigManager {
  private config?: FuncqcConfig;
  private explorer = cosmiconfigSync('funcqc');

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

    return this.config;
  }

  getDefaults(): FuncqcConfig {
    return { ...DEFAULT_CONFIG };
  }

  private validateAndMergeConfig(userConfig: any): FuncqcConfig {
    const config: FuncqcConfig = { ...DEFAULT_CONFIG };

    this.mergeArrayConfigs(config, userConfig);
    this.mergeStorageConfig(config, userConfig);
    this.mergeMetricsConfig(config, userConfig);
    this.mergeGitConfig(config, userConfig);
    this.mergeSimilarityConfig(config, userConfig);
    this.mergeThresholdsConfig(config, userConfig);
    this.mergeAssessmentConfig(config, userConfig);
    this.mergeProjectContextConfig(config, userConfig);

    return config;
  }

  private mergeArrayConfigs(config: FuncqcConfig, userConfig: any): void {
    if (Array.isArray(userConfig.roots)) {
      config.roots = userConfig.roots.filter(
        (root: any) => typeof root === 'string'
      );
    }

    if (Array.isArray(userConfig.exclude)) {
      config.exclude = userConfig.exclude.filter(
        (pattern: any) => typeof pattern === 'string'
      );
    }

    if (Array.isArray(userConfig.include)) {
      config.include = userConfig.include.filter(
        (pattern: any) => typeof pattern === 'string'
      );
    }
  }

  private mergeStorageConfig(config: FuncqcConfig, userConfig: any): void {
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

  private mergeMetricsConfig(config: FuncqcConfig, userConfig: any): void {
    if (userConfig.metrics && typeof userConfig.metrics === 'object') {
      if (typeof userConfig.metrics.complexityThreshold === 'number') {
        config.metrics.complexityThreshold = Math.max(1, userConfig.metrics.complexityThreshold);
      }
      
      if (typeof userConfig.metrics.linesOfCodeThreshold === 'number') {
        config.metrics.linesOfCodeThreshold = Math.max(1, userConfig.metrics.linesOfCodeThreshold);
      }
      
      if (typeof userConfig.metrics.parameterCountThreshold === 'number') {
        config.metrics.parameterCountThreshold = Math.max(1, userConfig.metrics.parameterCountThreshold);
      }
    }
  }

  private mergeGitConfig(config: FuncqcConfig, userConfig: any): void {
    if (userConfig.git && typeof userConfig.git === 'object') {
      if (typeof userConfig.git.enabled === 'boolean') {
        config.git.enabled = userConfig.git.enabled;
      }
      
      if (typeof userConfig.git.autoLabel === 'boolean') {
        config.git.autoLabel = userConfig.git.autoLabel;
      }
    }
  }

  private mergeSimilarityConfig(config: FuncqcConfig, userConfig: any): void {
    if (userConfig.similarity && typeof userConfig.similarity === 'object') {
      config.similarity = {
        detectors: {},
        consensus: { strategy: 'majority' },
        ...userConfig.similarity
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
   * Invalidate cached config (for testing)
   */
  clearCache(): void {
    this.config = undefined as any; // Temporary fix for exactOptionalPropertyTypes
    this.explorer.clearCaches();
  }

  private mergeThresholdsConfig(config: FuncqcConfig, userConfig: any): void {
    if (userConfig.thresholds && typeof userConfig.thresholds === 'object') {
      config.thresholds = this.validateThresholds(userConfig.thresholds);
    }
  }

  private mergeAssessmentConfig(config: FuncqcConfig, userConfig: any): void {
    if (userConfig.assessment && typeof userConfig.assessment === 'object') {
      config.assessment = this.validateAssessmentConfig(userConfig.assessment);
    }
  }

  private mergeProjectContextConfig(config: FuncqcConfig, userConfig: any): void {
    if (userConfig.projectContext && typeof userConfig.projectContext === 'object') {
      config.projectContext = this.validateProjectContext(userConfig.projectContext);
    }
  }

  private validateThresholds(thresholds: any): any {
    const validatedThresholds: any = {};
    
    const metricNames = [
      'complexity', 'cognitiveComplexity', 'lines', 'totalLines', 'parameters',
      'nestingLevel', 'returnStatements', 'branches', 'loops', 'tryCatch',
      'asyncAwait', 'callbacks', 'maintainability', 'halsteadVolume',
      'halsteadDifficulty', 'codeToCommentRatio'
    ];

    for (const metricName of metricNames) {
      if (thresholds[metricName] && typeof thresholds[metricName] === 'object') {
        validatedThresholds[metricName] = this.validateMultiLevelThreshold(thresholds[metricName]);
      }
    }

    return validatedThresholds;
  }

  private validateMultiLevelThreshold(threshold: any): any {
    const validated: any = {};
    
    ['warning', 'error', 'critical'].forEach(level => {
      if (threshold[level] !== undefined) {
        validated[level] = this.validateThresholdValue(threshold[level]);
      }
    });

    return validated;
  }

  private validateThresholdValue(value: any): any {
    if (typeof value === 'number' && value > 0) {
      return value;
    }
    
    if (typeof value === 'object' && value.method) {
      const validMethods = ['mean+sigma', 'percentile', 'median+mad'];
      if (validMethods.includes(value.method)) {
        const validated: any = { method: value.method };
        
        if (typeof value.multiplier === 'number' && value.multiplier > 0) {
          validated.multiplier = value.multiplier;
        }
        
        if (typeof value.percentile === 'number' && value.percentile >= 0 && value.percentile <= 100) {
          validated.percentile = value.percentile;
        }
        
        return validated;
      }
    }

    throw new Error(`Invalid threshold value: ${JSON.stringify(value)}`);
  }

  private validateAssessmentConfig(assessment: any): any {
    const validated: any = {};
    
    if (Array.isArray(assessment.highRiskConditions)) {
      validated.highRiskConditions = assessment.highRiskConditions.filter((condition: any) => 
        condition.metric && condition.threshold !== undefined
      );
    }
    
    if (typeof assessment.minViolations === 'number' && assessment.minViolations >= 0) {
      validated.minViolations = Math.floor(assessment.minViolations);
    }
    
    if (assessment.violationWeights && typeof assessment.violationWeights === 'object') {
      validated.violationWeights = {};
      ['warning', 'error', 'critical'].forEach(level => {
        if (typeof assessment.violationWeights[level] === 'number' && assessment.violationWeights[level] > 0) {
          validated.violationWeights[level] = assessment.violationWeights[level];
        }
      });
    }
    
    if (['count', 'weighted', 'severity'].includes(assessment.compositeScoringMethod)) {
      validated.compositeScoringMethod = assessment.compositeScoringMethod;
    }

    return validated;
  }

  private validateProjectContext(context: any): any {
    const validated: any = {};
    
    if (['junior', 'mid', 'senior'].includes(context.experienceLevel)) {
      validated.experienceLevel = context.experienceLevel;
    }
    
    if (['prototype', 'production', 'legacy'].includes(context.projectType)) {
      validated.projectType = context.projectType;
    }
    
    if (['small', 'medium', 'large'].includes(context.codebaseSize)) {
      validated.codebaseSize = context.codebaseSize;
    }
    
    if (['web', 'api', 'cli', 'library', 'embedded'].includes(context.domain)) {
      validated.domain = context.domain;
    }

    return validated;
  }
}
