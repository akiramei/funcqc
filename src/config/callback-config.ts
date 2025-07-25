/**
 * Configuration manager for callback registration analysis
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { cosmiconfigSync } from 'cosmiconfig';
import { CallbackAnalysisConfig, FrameworkConfig } from '../analyzers/callback-registration/types';

/**
 * Default configuration for callback analysis
 */
const DEFAULT_CALLBACK_CONFIG: CallbackAnalysisConfig = {
  enabled: true,
  frameworks: {
    commander: {
      enabled: true,
      triggerMethods: ['parse', 'parseAsync'],
      registrationMethods: ['action', 'hook'],
      defaultConfidence: 0.9,
      options: {
        detectSubcommands: true,
        includeAliases: true
      }
    },
    express: {
      enabled: false, // Disabled by default until implemented
      triggerMethods: ['listen'],
      registrationMethods: ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all', 'use'],
      defaultConfidence: 0.85,
      options: {
        includeMiddleware: true,
        includeErrorHandlers: true
      }
    },
    react: {
      enabled: false, // Disabled by default until implemented
      triggerMethods: ['render', 'mount'],
      registrationMethods: ['onClick', 'onChange', 'onSubmit', 'useEffect', 'useCallback'],
      defaultConfidence: 0.8,
      options: {
        includeHooks: true,
        includeEventHandlers: true
      }
    }
  },
  options: {
    maxDepth: 10,
    includeLowConfidence: false,
    minConfidence: 0.7
  }
};

/**
 * Configuration manager for callback registration analysis
 */
export class CallbackConfigManager {
  private config: CallbackAnalysisConfig | undefined;
  private explorer = cosmiconfigSync('funcqc-callbacks', {
    searchPlaces: [
      '.funcqc-callbacks.yaml',
      '.funcqc-callbacks.yml',
      '.funcqc-callbacks.json',
      'funcqc.callbacks.yaml',
      'funcqc.callbacks.yml', 
      'funcqc.callbacks.json',
      'package.json',
    ],
  });

  /**
   * Load callback analysis configuration from file
   */
  load(configPath?: string): CallbackAnalysisConfig {
    if (this.config) {
      return this.config;
    }

    let result;
    
    if (configPath) {
      // Load from specified path
      result = this.loadFromPath(configPath);
    } else {
      // Search for configuration files
      result = this.explorer.search();
    }

    if (result?.config) {
      this.config = this.mergeWithDefaults(result.config);
    } else {
      this.config = { ...DEFAULT_CALLBACK_CONFIG };
    }

    this.validateConfig(this.config);
    return this.config;
  }

  /**
   * Get configuration for a specific framework
   */
  getFrameworkConfig(frameworkName: string): FrameworkConfig | null {
    const config = this.load();
    return config.frameworks[frameworkName] || null;
  }

  /**
   * Check if callback analysis is enabled globally
   */
  isEnabled(): boolean {
    return this.load().enabled;
  }

  /**
   * Check if a specific framework is enabled
   */
  isFrameworkEnabled(frameworkName: string): boolean {
    const frameworkConfig = this.getFrameworkConfig(frameworkName);
    return frameworkConfig?.enabled ?? false;
  }

  /**
   * Get global analysis options
   */
  getGlobalOptions(): CallbackAnalysisConfig['options'] {
    return this.load().options;
  }

  /**
   * Reset cached configuration
   */
  reset(): void {
    this.config = undefined;
  }

  /**
   * Load configuration from a specific file path
   */
  private loadFromPath(configPath: string): { config: Partial<CallbackAnalysisConfig> } | null {
    try {
      if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`);
      }

      const ext = path.extname(configPath).toLowerCase();
      const content = fs.readFileSync(configPath, 'utf8');

      let config: Partial<CallbackAnalysisConfig>;
      
      if (ext === '.yaml' || ext === '.yml') {
        config = yaml.load(content) as Partial<CallbackAnalysisConfig>;
      } else if (ext === '.json') {
        config = JSON.parse(content);
      } else {
        throw new Error(`Unsupported configuration file format: ${ext}`);
      }

      return { config };
    } catch (error) {
      throw new Error(`Failed to load configuration from ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Merge user configuration with defaults
   */
  private mergeWithDefaults(userConfig: Partial<CallbackAnalysisConfig>): CallbackAnalysisConfig {
    const merged = { ...DEFAULT_CALLBACK_CONFIG };

    // Merge global settings
    if (userConfig.enabled !== undefined) {
      merged.enabled = userConfig.enabled;
    }

    if (userConfig.options) {
      merged.options = { ...merged.options, ...userConfig.options };
    }

    // Merge framework configurations
    if (userConfig.frameworks) {
      for (const [frameworkName, frameworkConfig] of Object.entries(userConfig.frameworks)) {
        if (merged.frameworks[frameworkName]) {
          // Merge with existing framework config
          merged.frameworks[frameworkName] = {
            ...merged.frameworks[frameworkName],
            ...frameworkConfig,
            options: {
              ...merged.frameworks[frameworkName].options,
              ...frameworkConfig.options
            }
          };
        } else {
          // Add new framework config
          merged.frameworks[frameworkName] = {
            defaultConfidence: 0.8,
            ...frameworkConfig
          };
        }
      }
    }

    return merged;
  }

  /**
   * Validate configuration values
   */
  private validateConfig(config: CallbackAnalysisConfig): void {
    // Validate global options
    if (config.options) {
      if (config.options.maxDepth !== undefined && config.options.maxDepth < 1) {
        throw new Error('maxDepth must be at least 1');
      }
      if (config.options.minConfidence !== undefined && 
          (config.options.minConfidence < 0 || config.options.minConfidence > 1)) {
        throw new Error('minConfidence must be between 0 and 1');
      }
    }

    // Validate framework configurations
    for (const [frameworkName, frameworkConfig] of Object.entries(config.frameworks)) {
      if (frameworkConfig.defaultConfidence !== undefined &&
          (frameworkConfig.defaultConfidence < 0 || frameworkConfig.defaultConfidence > 1)) {
        throw new Error(`defaultConfidence for ${frameworkName} must be between 0 and 1`);
      }

      if (!Array.isArray(frameworkConfig.triggerMethods)) {
        throw new Error(`triggerMethods for ${frameworkName} must be an array`);
      }

      if (!Array.isArray(frameworkConfig.registrationMethods)) {
        throw new Error(`registrationMethods for ${frameworkName} must be an array`);
      }
    }
  }

  /**
   * Get the default configuration (useful for init command)
   */
  static getDefaultConfig(): CallbackAnalysisConfig {
    return { ...DEFAULT_CALLBACK_CONFIG };
  }

  /**
   * Create a sample configuration file
   */
  createSampleConfig(outputPath: string): void {
    const sampleConfig = {
      enabled: true,
      frameworks: {
        commander: {
          enabled: true,
          triggerMethods: ['parse', 'parseAsync'],
          registrationMethods: ['action', 'hook'],
          defaultConfidence: 0.9
        },
        express: {
          enabled: false,
          triggerMethods: ['listen'],
          registrationMethods: ['get', 'post', 'use'],
          defaultConfidence: 0.85
        }
      },
      options: {
        maxDepth: 10,
        includeLowConfidence: false,
        minConfidence: 0.7
      }
    };

    const yamlContent = yaml.dump(sampleConfig, {
      indent: 2,
      lineWidth: 100,
      noRefs: true
    });

    const fullContent = `# funcqc callback registration analysis configuration
# This file configures how funcqc detects and tracks callback registration patterns
# in various frameworks like Commander.js, Express.js, etc.

${yamlContent}`;

    fs.writeFileSync(outputPath, fullContent, 'utf8');
  }
}