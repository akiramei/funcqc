import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { cosmiconfigSync } from 'cosmiconfig';
import { RiskScoringConfig, DEFAULT_RISK_CONFIG } from '../analyzers/comprehensive-risk-scorer';

/**
 * Risk detection configuration
 */
export interface RiskConfig {
  scoring: RiskScoringConfig;
  detection: {
    enabledPatterns: Array<'wrapper' | 'fake-split' | 'complexity-hotspot' | 'isolated' | 'circular'>;
    wrapperDetection: {
      enabled: boolean;
      minLinesOfCode: number;
      maxComplexity: number;
      parameterMatchTolerance: number;
    };
    fakeSplitDetection: {
      enabled: boolean;
      minClusterSize: number;
      maxFunctionSize: number;
      couplingThreshold: number;
    };
    complexityHotspots: {
      enabled: boolean;
      cyclomaticThreshold: number;
      cognitiveThreshold: number;
      sizeThreshold: number;
    };
    isolatedFunctions: {
      enabled: boolean;
      minSize: number;
      excludeTests: boolean;
      excludeExports: boolean;
    };
    circularDependencies: {
      enabled: boolean;
      minComponentSize: number;
      includeRecursive: boolean;
    };
  };
  reporting: {
    maxResults: number;
    minRiskScore: number;
    groupBy: 'severity' | 'file' | 'pattern' | 'score';
    includeLowRisk: boolean;
    includeRecommendations: boolean;
  };
  customRules: Array<{
    name: string;
    description: string;
    condition: string; // JavaScript expression
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
  }>;
}

/**
 * Default risk configuration
 */
export const DEFAULT_RISK_CONFIG_FULL: RiskConfig = {
  scoring: DEFAULT_RISK_CONFIG,
  detection: {
    enabledPatterns: ['wrapper', 'fake-split', 'complexity-hotspot', 'isolated', 'circular'],
    wrapperDetection: {
      enabled: true,
      minLinesOfCode: 3,
      maxComplexity: 2,
      parameterMatchTolerance: 1,
    },
    fakeSplitDetection: {
      enabled: true,
      minClusterSize: 3,
      maxFunctionSize: 20,
      couplingThreshold: 0.7,
    },
    complexityHotspots: {
      enabled: true,
      cyclomaticThreshold: 15,
      cognitiveThreshold: 15,
      sizeThreshold: 50,
    },
    isolatedFunctions: {
      enabled: true,
      minSize: 3,
      excludeTests: true,
      excludeExports: false,
    },
    circularDependencies: {
      enabled: true,
      minComponentSize: 2,
      includeRecursive: true,
    },
  },
  reporting: {
    maxResults: 50,
    minRiskScore: 40,
    groupBy: 'severity',
    includeLowRisk: false,
    includeRecommendations: true,
  },
  customRules: [],
};

/**
 * Risk configuration manager
 */
export class RiskConfigManager {
  private config: RiskConfig | undefined;
  private explorer = cosmiconfigSync('funcqc-risk', {
    searchPlaces: [
      '.funcqc-risk.yaml',
      '.funcqc-risk.yml',
      '.funcqc-risk.json',
      'funcqc.risk.yaml',
      'funcqc.risk.yml',
      'funcqc.risk.json',
      'package.json',
    ],
  });

  /**
   * Load risk configuration from file
   */
  load(configPath?: string): RiskConfig {
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
      this.config = { ...DEFAULT_RISK_CONFIG_FULL };
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
      throw new Error(`Failed to load risk config from ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get default configuration
   */
  getDefaults(): RiskConfig {
    return { ...DEFAULT_RISK_CONFIG_FULL };
  }

  /**
   * Validate and merge user configuration with defaults
   */
  private validateAndMergeConfig(userConfig: unknown): RiskConfig {
    if (!userConfig || typeof userConfig !== 'object') {
      throw new Error('Risk configuration must be an object');
    }

    const config = userConfig as Record<string, unknown>;
    const result: RiskConfig = { ...DEFAULT_RISK_CONFIG_FULL };

    // Validate and merge scoring configuration
    if (config['scoring'] && typeof config['scoring'] === 'object') {
      result.scoring = this.validateScoringConfig(config['scoring'] as Record<string, unknown>);
    }

    // Validate and merge detection configuration
    if (config['detection'] && typeof config['detection'] === 'object') {
      result.detection = this.validateDetectionConfig(config['detection'] as Record<string, unknown>);
    }

    // Validate and merge reporting configuration
    if (config['reporting'] && typeof config['reporting'] === 'object') {
      result.reporting = this.validateReportingConfig(config['reporting'] as Record<string, unknown>);
    }

    // Validate and merge custom rules
    if (Array.isArray(config['customRules'])) {
      result.customRules = this.validateCustomRules(config['customRules']);
    }

    return result;
  }

  /**
   * Validate scoring configuration
   */
  private validateScoringConfig(scoring: Record<string, unknown>): RiskScoringConfig {
    const result: RiskScoringConfig = { ...DEFAULT_RISK_CONFIG };

    // Validate weights (should sum to ~1.0)
    const weightFields = [
      'cyclomaticComplexityWeight',
      'cognitiveComplexityWeight',
      'nestingDepthWeight',
      'linesOfCodeWeight',
      'parameterCountWeight',
      'fanInWeight',
      'fanOutWeight',
      'wrapperPatternWeight',
      'fakeSplitPatternWeight',
      'isolatedFunctionWeight',
      'stronglyConnectedWeight',
      'recursiveCallWeight',
    ];

    for (const field of weightFields) {
      if (typeof scoring[field] === 'number') {
        const weight = scoring[field] as number;
        if (weight >= 0 && weight <= 1) {
          (result as any)[field] = weight;
        } else {
          throw new Error(`Weight ${field} must be between 0 and 1`);
        }
      }
    }

    // Validate thresholds
    if (scoring['complexityThresholds'] && typeof scoring['complexityThresholds'] === 'object') {
      result.complexityThresholds = this.validateThresholds(
        scoring['complexityThresholds'] as Record<string, unknown>,
        ['low', 'medium', 'high', 'critical']
      );
    }

    if (scoring['sizeThresholds'] && typeof scoring['sizeThresholds'] === 'object') {
      result.sizeThresholds = this.validateThresholds(
        scoring['sizeThresholds'] as Record<string, unknown>,
        ['small', 'medium', 'large', 'huge']
      );
    }

    return result;
  }

  /**
   * Validate threshold configuration
   */
  private validateThresholds(
    thresholds: Record<string, unknown>,
    requiredKeys: string[]
  ): any {
    const result: any = {};

    for (const key of requiredKeys) {
      if (typeof thresholds[key] === 'number') {
        result[key] = thresholds[key];
      } else {
        throw new Error(`Threshold ${key} must be a number`);
      }
    }

    // Validate ascending order
    const values = Object.values(result) as number[];
    for (let i = 1; i < values.length; i++) {
      if (values[i] <= values[i - 1]) {
        throw new Error(`Thresholds must be in ascending order`);
      }
    }

    return result;
  }

  /**
   * Validate detection configuration
   */
  private validateDetectionConfig(detection: Record<string, unknown>): RiskConfig['detection'] {
    const result = { ...DEFAULT_RISK_CONFIG_FULL.detection };

    // Validate enabled patterns
    if (Array.isArray(detection['enabledPatterns'])) {
      const validPatterns = ['wrapper', 'fake-split', 'complexity-hotspot', 'isolated', 'circular'];
      const patterns = detection['enabledPatterns'].filter(p => 
        typeof p === 'string' && validPatterns.includes(p)
      );
      result.enabledPatterns = patterns as any;
    }

    // Validate pattern-specific configurations
    const patternConfigs = [
      'wrapperDetection',
      'fakeSplitDetection',
      'complexityHotspots',
      'isolatedFunctions',
      'circularDependencies',
    ];

    for (const configName of patternConfigs) {
      if (detection[configName] && typeof detection[configName] === 'object') {
        result[configName as keyof typeof result] = {
          ...result[configName as keyof typeof result],
          ...this.validatePatternConfig(detection[configName] as Record<string, unknown>),
        };
      }
    }

    return result;
  }

  /**
   * Validate pattern-specific configuration
   */
  private validatePatternConfig(config: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Validate boolean fields
    const booleanFields = ['enabled', 'excludeTests', 'excludeExports', 'includeRecursive'];
    for (const field of booleanFields) {
      if (typeof config[field] === 'boolean') {
        result[field] = config[field];
      }
    }

    // Validate number fields
    const numberFields = [
      'minLinesOfCode', 'maxComplexity', 'parameterMatchTolerance',
      'minClusterSize', 'maxFunctionSize', 'couplingThreshold',
      'cyclomaticThreshold', 'cognitiveThreshold', 'sizeThreshold',
      'minSize', 'minComponentSize',
    ];
    for (const field of numberFields) {
      if (typeof config[field] === 'number') {
        const value = config[field] as number;
        if (value >= 0) {
          result[field] = value;
        }
      }
    }

    return result;
  }

  /**
   * Validate reporting configuration
   */
  private validateReportingConfig(reporting: Record<string, unknown>): RiskConfig['reporting'] {
    const result = { ...DEFAULT_RISK_CONFIG_FULL.reporting };

    if (typeof reporting['maxResults'] === 'number' && reporting['maxResults'] > 0) {
      result.maxResults = reporting['maxResults'];
    }

    if (typeof reporting['minRiskScore'] === 'number' && 
        reporting['minRiskScore'] >= 0 && 
        reporting['minRiskScore'] <= 100) {
      result.minRiskScore = reporting['minRiskScore'];
    }

    const validGroupBy = ['severity', 'file', 'pattern', 'score'];
    if (typeof reporting['groupBy'] === 'string' && validGroupBy.includes(reporting['groupBy'])) {
      result.groupBy = reporting['groupBy'] as any;
    }

    if (typeof reporting['includeLowRisk'] === 'boolean') {
      result.includeLowRisk = reporting['includeLowRisk'];
    }

    if (typeof reporting['includeRecommendations'] === 'boolean') {
      result.includeRecommendations = reporting['includeRecommendations'];
    }

    return result;
  }

  /**
   * Validate custom rules
   */
  private validateCustomRules(rules: unknown[]): RiskConfig['customRules'] {
    const result: RiskConfig['customRules'] = [];

    for (const rule of rules) {
      if (rule && typeof rule === 'object') {
        const ruleObj = rule as Record<string, unknown>;
        
        if (typeof ruleObj['name'] === 'string' &&
            typeof ruleObj['description'] === 'string' &&
            typeof ruleObj['condition'] === 'string' &&
            typeof ruleObj['message'] === 'string') {
          
          const severity = ruleObj['severity'];
          if (severity === 'critical' || severity === 'high' || 
              severity === 'medium' || severity === 'low') {
            
            result.push({
              name: ruleObj['name'] as string,
              description: ruleObj['description'] as string,
              condition: ruleObj['condition'] as string,
              severity: severity as any,
              message: ruleObj['message'] as string,
            });
          }
        }
      }
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
    const sampleConfig: RiskConfig = {
      scoring: {
        // Complexity weights (total should be ~0.40)
        cyclomaticComplexityWeight: 0.15,
        cognitiveComplexityWeight: 0.15,
        nestingDepthWeight: 0.10,
        
        // Size weights (total should be ~0.20)
        linesOfCodeWeight: 0.15,
        parameterCountWeight: 0.05,
        
        // Dependency weights (total should be ~0.20)
        fanInWeight: 0.10,
        fanOutWeight: 0.10,
        
        // Pattern weights (total should be ~0.15)
        wrapperPatternWeight: 0.05,
        fakeSplitPatternWeight: 0.05,
        isolatedFunctionWeight: 0.05,
        
        // SCC weights (total should be ~0.05)
        stronglyConnectedWeight: 0.03,
        recursiveCallWeight: 0.02,
        
        // Future weights
        maintainabilityWeight: 0.00,
        halsteadVolumeWeight: 0.00,
        
        // Thresholds
        complexityThresholds: {
          low: 5,
          medium: 10,
          high: 20,
          critical: 30,
        },
        sizeThresholds: {
          small: 20,
          medium: 50,
          large: 100,
          huge: 200,
        },
      },
      detection: {
        enabledPatterns: ['wrapper', 'fake-split', 'complexity-hotspot', 'isolated'],
        wrapperDetection: {
          enabled: true,
          minLinesOfCode: 3,
          maxComplexity: 2,
          parameterMatchTolerance: 1,
        },
        fakeSplitDetection: {
          enabled: true,
          minClusterSize: 3,
          maxFunctionSize: 20,
          couplingThreshold: 0.7,
        },
        complexityHotspots: {
          enabled: true,
          cyclomaticThreshold: 15,
          cognitiveThreshold: 15,
          sizeThreshold: 50,
        },
        isolatedFunctions: {
          enabled: true,
          minSize: 5,
          excludeTests: true,
          excludeExports: false,
        },
        circularDependencies: {
          enabled: true,
          minComponentSize: 2,
          includeRecursive: true,
        },
      },
      reporting: {
        maxResults: 50,
        minRiskScore: 40,
        groupBy: 'severity',
        includeLowRisk: false,
        includeRecommendations: true,
      },
      customRules: [
        {
          name: 'large-async-function',
          description: 'Large async functions are hard to test and debug',
          condition: 'func.async && func.metrics.linesOfCode > 30',
          severity: 'medium',
          message: 'Consider breaking down large async functions',
        },
        {
          name: 'many-parameters-no-options',
          description: 'Functions with many parameters should use options objects',
          condition: 'func.parameters.length >= 5 && !func.name.includes("options")',
          severity: 'low',
          message: 'Consider using an options object for functions with many parameters',
        },
      ],
    };

    const yamlContent = yaml.dump(sampleConfig, {
      indent: 2,
      noRefs: true,
      sortKeys: false,
    });

    fs.writeFileSync(outputPath, yamlContent, 'utf8');
  }

  /**
   * Evaluate custom rule condition
   */
  evaluateCustomRule(
    rule: RiskConfig['customRules'][0],
    func: any,
    metrics?: any
  ): boolean {
    try {
      // Create evaluation context
      const context = {
        func,
        metrics,
        // Helper functions
        Math,
        // Safe evaluation environment
      };

      // Simple expression evaluation (in production, use a proper expression evaluator)
      const expression = rule.condition
        .replace(/func\./g, 'context.func.')
        .replace(/metrics\./g, 'context.metrics.');

      return Function('context', `with(context) { return ${expression}; }`)(context);
    } catch (error) {
      console.warn(`Failed to evaluate custom rule ${rule.name}:`, error);
      return false;
    }
  }
}