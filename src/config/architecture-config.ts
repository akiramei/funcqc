import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { cosmiconfigSync } from 'cosmiconfig';
import { ArchitectureConfig, ArchitectureRule, ArchitectureSettings, LayerDefinition, ConsolidationStrategies, ConsolidationStrategy } from '../types/architecture';

/**
 * Default architecture configuration
 */
const DEFAULT_ARCHITECTURE_CONFIG: ArchitectureConfig = {
  layers: {},
  rules: [],
  settings: {
    allowSameLayer: true,
    strictMode: false,
    defaultSeverity: 'error',
    ignoreExternal: true,
  },
};

/**
 * Configuration manager for architecture validation
 */
export class ArchitectureConfigManager {
  private config: ArchitectureConfig | undefined;
  private explorer = cosmiconfigSync('funcqc-arch', {
    searchPlaces: [
      '.funcqc-arch.yaml',
      '.funcqc-arch.yml',
      '.funcqc-arch.json',
      'funcqc.arch.yaml',
      'funcqc.arch.yml',
      'funcqc.arch.json',
      'package.json',
    ],
  });

  /**
   * Load architecture configuration from file
   */
  load(configPath?: string): ArchitectureConfig {
    if (this.config) {
      return this.config;
    }

    let result;
    
    if (configPath) {
      // Load from specified path
      result = this.loadFromPath(configPath);
    } else {
      // Search for config file
      result = this.explorer.search();
    }

    if (result) {
      this.config = this.validateAndMergeConfig(result.config);
    } else {
      this.config = { ...DEFAULT_ARCHITECTURE_CONFIG };
    }

    return this.config;
  }

  /**
   * Load configuration from a specific file path
   */
  private loadFromPath(configPath: string): { config: unknown; filepath: string } | null {
    try {
      const fullPath = path.resolve(configPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      
      let config;
      if (fullPath.endsWith('.yaml') || fullPath.endsWith('.yml')) {
        config = yaml.load(content);
      } else if (fullPath.endsWith('.json')) {
        config = JSON.parse(content);
      } else {
        throw new Error(`Unsupported config file format: ${fullPath}`);
      }

      return { config, filepath: fullPath };
    } catch (error) {
      throw new Error(`Failed to load architecture config from ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get default configuration
   */
  getDefaults(): ArchitectureConfig {
    return { ...DEFAULT_ARCHITECTURE_CONFIG };
  }

  /**
   * Validate and merge user configuration with defaults
   */
  private validateAndMergeConfig(userConfig: unknown): ArchitectureConfig {
    if (!userConfig || typeof userConfig !== 'object') {
      throw new Error('Architecture configuration must be an object');
    }

    const config = userConfig as Record<string, unknown>;
    const result: ArchitectureConfig = { ...DEFAULT_ARCHITECTURE_CONFIG };

    // Validate and merge layers
    if (config['layers'] && typeof config['layers'] === 'object' && !Array.isArray(config['layers'])) {
      result.layers = this.validateLayers(config['layers'] as Record<string, unknown>);
    }

    // Validate and merge rules
    if (Array.isArray(config['rules'])) {
      result.rules = this.validateRules(config['rules']);
    }

    // Validate and merge settings
    if (config['settings'] && typeof config['settings'] === 'object') {
      result.settings = this.validateSettings(config['settings'] as Record<string, unknown>);
    }

    // Validate and merge consolidation strategies
    if (config['consolidationStrategies'] && typeof config['consolidationStrategies'] === 'object') {
      result.consolidationStrategies = this.validateConsolidationStrategies(config['consolidationStrategies'] as Record<string, unknown>);
    }

    return result;
  }

  /**
   * Validate layer definitions (supports both simple patterns and extended LayerDefinition)
   */
  private validateLayers(layers: Record<string, unknown>): Record<string, string[] | LayerDefinition> {
    const result: Record<string, string[] | LayerDefinition> = {};

    for (const [layerName, layerConfig] of Object.entries(layers)) {
      if (!layerName || typeof layerName !== 'string') {
        throw new Error(`Invalid layer name: ${layerName}`);
      }

      // Handle simple pattern arrays (legacy format)
      if (Array.isArray(layerConfig)) {
        const validPatterns = layerConfig.filter(p => typeof p === 'string' && p.length > 0);
        if (validPatterns.length !== layerConfig.length) {
          throw new Error(`Layer '${layerName}' contains invalid patterns`);
        }
        result[layerName] = validPatterns;
      } 
      // Handle single pattern string (legacy format)
      else if (typeof layerConfig === 'string' && layerConfig.length > 0) {
        result[layerName] = [layerConfig];
      } 
      // Handle extended LayerDefinition format
      else if (layerConfig && typeof layerConfig === 'object') {
        result[layerName] = this.validateLayerDefinition(layerName, layerConfig as Record<string, unknown>);
      } 
      else {
        throw new Error(`Layer '${layerName}' must have string, string array, or LayerDefinition patterns`);
      }
    }

    return result;
  }

  /**
   * Validate extended layer definition
   */
  private validateLayerDefinition(layerName: string, layerConfig: Record<string, unknown>): LayerDefinition {
    // Validate required patterns field
    const patterns = layerConfig['patterns'];
    if (!Array.isArray(patterns)) {
      throw new Error(`Layer '${layerName}' must have a 'patterns' array in LayerDefinition format`);
    }
    
    const validPatterns = patterns.filter(p => typeof p === 'string' && p.length > 0);
    if (validPatterns.length !== patterns.length) {
      throw new Error(`Layer '${layerName}' contains invalid patterns in 'patterns' field`);
    }

    const layerDef: LayerDefinition = {
      patterns: validPatterns,
    };

    // Validate optional fields
    if (layerConfig['role'] && typeof layerConfig['role'] === 'string') {
      layerDef.role = layerConfig['role'];
    }

    if (layerConfig['consolidationStrategy'] && 
        ['aggressive', 'conservative', 'none'].includes(layerConfig['consolidationStrategy'] as string)) {
      layerDef.consolidationStrategy = layerConfig['consolidationStrategy'] as 'aggressive' | 'conservative' | 'none';
    }

    if (typeof layerConfig['consolidationTarget'] === 'boolean') {
      layerDef.consolidationTarget = layerConfig['consolidationTarget'];
    }

    if (Array.isArray(layerConfig['internalUtils'])) {
      const validUtils = layerConfig['internalUtils'].filter(u => typeof u === 'string' && u.length > 0);
      if (validUtils.length > 0) {
        layerDef.internalUtils = validUtils;
      }
    }

    if (Array.isArray(layerConfig['avoidCrossLayerSharing'])) {
      const validPatterns = layerConfig['avoidCrossLayerSharing'].filter(p => typeof p === 'string' && p.length > 0);
      if (validPatterns.length > 0) {
        layerDef.avoidCrossLayerSharing = validPatterns;
      }
    }

    if (Array.isArray(layerConfig['maxDependencies'])) {
      const validDeps = layerConfig['maxDependencies'].filter(d => typeof d === 'string' && d.length > 0);
      if (validDeps.length > 0) {
        layerDef.maxDependencies = validDeps;
      }
    }

    return layerDef;
  }

  /**
   * Validate architecture rules
   */
  private validateRules(rules: unknown[]): ArchitectureRule[] {
    const result: ArchitectureRule[] = [];

    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') {
        throw new Error('Rule must be an object');
      }

      const ruleObj = rule as Record<string, unknown>;
      const validatedRule = this.validateRule(ruleObj);
      result.push(validatedRule);
    }

    return result;
  }

  /**
   * Validate a single architecture rule
   */
  private validateRule(rule: Record<string, unknown>): ArchitectureRule {
    // Validate type
    let type: 'allow' | 'forbid' = 'forbid';
    if (rule['type'] === 'allow' || rule['type'] === 'forbid') {
      type = rule['type'];
    } else if (rule['allow'] !== undefined) {
      // Support legacy 'allow' boolean format
      type = rule['allow'] ? 'allow' : 'forbid';
    } else if (rule['forbid'] !== undefined) {
      // Support 'forbid' string format like "layer1 -> layer2"
      type = 'forbid';
    }

    // Parse from/to patterns
    let from: string | string[];
    let to: string | string[];

    if (rule['from'] && rule['to']) {
      // Explicit from/to format
      from = this.validateLayerPattern(rule['from'], 'from');
      to = this.validateLayerPattern(rule['to'], 'to');
    } else if (rule['forbid'] && typeof rule['forbid'] === 'string') {
      // Parse "layer1 -> layer2" format
      const match = rule['forbid'].match(/^(.+?)\s*->\s*(.+)$/);
      if (!match) {
        throw new Error(`Invalid forbid rule format: ${rule['forbid']}. Expected "from -> to"`);
      }
      from = match[1].trim();
      to = match[2].trim();
    } else if (rule['allow'] && typeof rule['allow'] === 'string') {
      // Parse "layer1 -> layer2" format for allow rules
      const match = rule['allow'].match(/^(.+?)\s*->\s*(.+)$/);
      if (!match) {
        throw new Error(`Invalid allow rule format: ${rule['allow']}. Expected "from -> to"`);
      }
      from = match[1].trim();
      to = match[2].trim();
    } else {
      throw new Error('Rule must specify from/to or use forbid/allow string format');
    }

    // Validate severity
    const severity = this.validateSeverity(rule['severity']);

    const description = typeof rule['description'] === 'string' ? rule['description'] : undefined;

    return {
      type,
      from,
      to,
      ...(description && { description }),
      severity,
    };
  }

  /**
   * Validate layer pattern (string or string array)
   */
  private validateLayerPattern(pattern: unknown, field: string): string | string[] {
    if (typeof pattern === 'string' && pattern.length > 0) {
      return pattern;
    } else if (Array.isArray(pattern)) {
      const validPatterns = pattern.filter(p => typeof p === 'string' && p.length > 0);
      if (validPatterns.length !== pattern.length) {
        throw new Error(`Invalid ${field} pattern: contains non-string values`);
      }
      return validPatterns;
    } else {
      throw new Error(`Invalid ${field} pattern: must be string or string array`);
    }
  }

  /**
   * Validate severity level
   */
  private validateSeverity(severity: unknown): 'error' | 'warning' | 'info' {
    if (severity === 'error' || severity === 'warning' || severity === 'info') {
      return severity;
    }
    return DEFAULT_ARCHITECTURE_CONFIG.settings!.defaultSeverity!;
  }

  /**
   * Validate architecture settings
   */
  private validateSettings(settings: Record<string, unknown>): ArchitectureSettings {
    const result: ArchitectureSettings = { ...DEFAULT_ARCHITECTURE_CONFIG.settings! };

    if (typeof settings['allowSameLayer'] === 'boolean') {
      result.allowSameLayer = settings['allowSameLayer'];
    }

    if (typeof settings['strictMode'] === 'boolean') {
      result.strictMode = settings['strictMode'];
    }

    if (settings['defaultSeverity'] === 'error' || settings['defaultSeverity'] === 'warning' || settings['defaultSeverity'] === 'info') {
      result.defaultSeverity = settings['defaultSeverity'];
    }

    if (typeof settings['ignoreExternal'] === 'boolean') {
      result.ignoreExternal = settings['ignoreExternal'];
    }

    return result;
  }

  /**
   * Validate consolidation strategies
   */
  private validateConsolidationStrategies(strategies: Record<string, unknown>): ConsolidationStrategies {
    const result: ConsolidationStrategies = {};

    if (strategies['globalUtils'] && typeof strategies['globalUtils'] === 'object') {
      result.globalUtils = this.validateConsolidationStrategy(strategies['globalUtils'] as Record<string, unknown>);
    }

    if (strategies['layerUtils'] && typeof strategies['layerUtils'] === 'object') {
      result.layerUtils = this.validateConsolidationStrategy(strategies['layerUtils'] as Record<string, unknown>);
    }

    if (strategies['keepInPlace'] && typeof strategies['keepInPlace'] === 'object') {
      result.keepInPlace = this.validateConsolidationStrategy(strategies['keepInPlace'] as Record<string, unknown>);
    }

    return result;
  }

  /**
   * Validate individual consolidation strategy
   */
  private validateConsolidationStrategy(strategy: Record<string, unknown>): ConsolidationStrategy {
    if (!strategy['target'] || typeof strategy['target'] !== 'string') {
      throw new Error('Consolidation strategy must have a target string');
    }

    if (!Array.isArray(strategy['criteria'])) {
      throw new Error('Consolidation strategy must have a criteria array');
    }

    const validCriteria = strategy['criteria'].filter(c => typeof c === 'string' && c.length > 0);
    if (validCriteria.length === 0) {
      throw new Error('Consolidation strategy must have at least one valid criterion');
    }

    const result: ConsolidationStrategy = {
      target: strategy['target'] as string,
      criteria: validCriteria,
    };

    // Optional fields
    if (Array.isArray(strategy['examples'])) {
      const validExamples = strategy['examples'].filter(e => typeof e === 'string' && e.length > 0);
      if (validExamples.length > 0) {
        result.examples = validExamples;
      }
    }

    if (strategy['confidence'] && ['high', 'medium', 'low'].includes(strategy['confidence'] as string)) {
      result.confidence = strategy['confidence'] as 'high' | 'medium' | 'low';
    }

    return result;
  }

  /**
   * Clear cached configuration (for testing)
   */
  clearCache(): void {
    this.config = undefined;
    this.explorer.clearCaches();
  }

  /**
   * Create a sample configuration file
   */
  createSampleConfig(outputPath: string): void {
    const sampleConfig = {
      layers: {
        app: ['src/app/**'],
        core: ['src/core/**'],
        infra: ['src/infra/**'],
        utils: ['src/utils/**'],
      },
      rules: [
        {
          forbid: 'core -> infra',
          description: 'Core layer should not depend on infrastructure',
          severity: 'error',
        },
        {
          forbid: 'infra -> app',
          description: 'Infrastructure should not depend on application layer',
          severity: 'error',
        },
        {
          forbid: 'utils -> *',
          description: 'Utilities should be dependency-free',
          severity: 'warning',
        },
      ],
      settings: {
        allowSameLayer: true,
        strictMode: false,
        defaultSeverity: 'error',
        ignoreExternal: true,
      },
    };

    const yamlContent = yaml.dump(sampleConfig, {
      indent: 2,
      noRefs: true,
      sortKeys: false,
    });

    fs.writeFileSync(outputPath, yamlContent, 'utf8');
  }
}