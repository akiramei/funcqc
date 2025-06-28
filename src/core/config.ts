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
    complexityThreshold: 10,
    linesOfCodeThreshold: 50,
    parameterCountThreshold: 5
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
}
