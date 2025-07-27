/**
 * Dynamic Weight Calculator
 * 
 * Calculates dynamic weights for function quality metrics based on
 * project characteristics and function context.
 */

import { 
  DynamicWeightConfig,
  FunctionContext, 
  WeightCalculationResult,
  WeightBreakdown,
  DynamicWeightOptions,
  DynamicThresholds,
  DEFAULT_WEIGHT_BOUNDS
} from '../types/dynamic-weights';

/**
 * Weight multipliers for different project sizes (Phase 2: Enhanced scaling)
 */
const PROJECT_SIZE_MULTIPLIERS = {
  micro: { threshold: 50, multiplier: 0.7 },         // < 50 functions (prototypes)
  verySmall: { threshold: 200, multiplier: 0.8 },    // < 200 functions
  small: { threshold: 800, multiplier: 0.9 },        // < 800 functions  
  medium: { threshold: 3000, multiplier: 1.0 },      // < 3000 functions
  large: { threshold: 8000, multiplier: 1.1 },       // < 8000 functions
  veryLarge: { threshold: 20000, multiplier: 1.2 },  // < 20000 functions
  enterprise: { threshold: Infinity, multiplier: 1.3 } // >= 20000 functions
};

/**
 * Weight multipliers for architectural layers
 */
const LAYER_MULTIPLIERS = {
  presentation: 0.9,    // Controllers can have higher fan-out
  business: 1.1,        // Business logic should be cleaner
  data: 1.0,           // Standard evaluation
  utility: 0.7,        // Utilities can be more coupled
  infrastructure: 1.0,  // Standard evaluation  
  unknown: 1.0         // Default weight
};

/**
 * Weight multipliers for function roles
 */
const ROLE_MULTIPLIERS = {
  core: 1.2,      // Core functions should be highest quality
  support: 1.0,   // Standard evaluation
  utility: 0.8,   // Utilities can be more lenient
  facade: 0.9,    // Facades can have higher fan-out
  unknown: 1.0    // Default weight
};

/**
 * Weight multipliers for criticality levels
 */
const CRITICALITY_MULTIPLIERS = {
  Critical: 1.3,   // Critical functions need highest quality
  Important: 1.1,  // Important functions need good quality
  Normal: 1.0,     // Standard evaluation
  Low: 0.9         // Low priority can be more lenient
};

/**
 * Weight multipliers for domain complexity
 */
const DOMAIN_COMPLEXITY_MULTIPLIERS = {
  High: 1.15,     // High complexity domains need stricter standards
  Medium: 1.0,    // Standard evaluation
  Low: 0.9        // Low complexity can be more lenient
};

/**
 * Phase 2: File structure complexity multipliers
 */
const FILE_STRUCTURE_MULTIPLIERS = {
  flat: { maxDepth: 2, multiplier: 0.9 },           // Simple flat structure
  simple: { maxDepth: 3, multiplier: 1.0 },         // Basic hierarchy
  moderate: { maxDepth: 5, multiplier: 1.1 },       // Moderate nesting
  complex: { maxDepth: 8, multiplier: 1.15 },       // Deep hierarchy
  veryComplex: { maxDepth: Infinity, multiplier: 1.2 } // Very deep nesting
};

/**
 * Dynamic Weight Calculator
 */
export class DynamicWeightCalculator {
  private options: DynamicWeightOptions;

  constructor(options: DynamicWeightOptions) {
    this.options = {
      ...options,
      weightBounds: options.weightBounds || DEFAULT_WEIGHT_BOUNDS
    };
  }

  /**
   * Calculate dynamic weight for a function metric
   */
  calculateWeight(
    baseMetric: number,
    context: FunctionContext,
    metricType: 'fanIn' | 'fanOut' | 'complexity' | 'loc' = 'complexity'
  ): WeightCalculationResult {
    const config = this.options.config;
    
    // Skip dynamic calculation if in static mode
    if (config.mode === 'static') {
      return {
        finalWeight: 1.0,
        baseMetric,
        weightedMetric: baseMetric,
        breakdown: this.createEmptyBreakdown(),
        isDynamic: false
      };
    }

    // Calculate individual weight components
    const projectSizeWeight = this.calculateProjectSizeWeight(config.projectSize);
    const layerWeight = this.calculateLayerWeight(context.layer);
    const roleWeight = this.calculateRoleWeight(context.role);
    const criticalityWeight = this.calculateCriticalityWeight(context.criticality);
    const domainWeight = this.calculateDomainWeight(config.domainComplexity);

    // Apply custom multipliers if provided
    const customMultipliers = this.options.customMultipliers || {};
    const finalProjectSizeWeight = projectSizeWeight * (customMultipliers.projectSize || 1.0);
    const finalLayerWeight = layerWeight * (customMultipliers.layer || 1.0);
    const finalRoleWeight = roleWeight * (customMultipliers.role || 1.0);
    const finalCriticalityWeight = criticalityWeight * (customMultipliers.criticality || 1.0);
    const finalDomainWeight = domainWeight * (customMultipliers.domain || 1.0);

    // Calculate combined weight
    let finalWeight = finalProjectSizeWeight * 
                     finalLayerWeight * 
                     finalRoleWeight * 
                     finalCriticalityWeight * 
                     finalDomainWeight;

    // Apply bounds to prevent extreme values
    const bounds = this.options.weightBounds!;
    finalWeight = Math.max(bounds.min, Math.min(bounds.max, finalWeight));

    // Calculate weighted metric
    const weightedMetric = baseMetric * finalWeight;

    // Create breakdown for transparency
    const breakdown: WeightBreakdown = {
      projectSizeWeight: finalProjectSizeWeight,
      layerWeight: finalLayerWeight,
      roleWeight: finalRoleWeight,
      criticalityWeight: finalCriticalityWeight,
      domainWeight: finalDomainWeight,
      appliedRules: this.generateAppliedRules(context, config, metricType)
    };

    return {
      finalWeight,
      baseMetric,
      weightedMetric,
      breakdown,
      isDynamic: true
    };
  }

  /**
   * Calculate dynamic thresholds based on project characteristics
   */
  calculateDynamicThresholds(config: DynamicWeightConfig): DynamicThresholds {
    const baseThresholds = {
      hubThreshold: 5,
      utilityThreshold: 5,
      complexityThreshold: 10,
      locThreshold: 40,
      cognitiveComplexityThreshold: 15
    };

    if (config.mode === 'static') {
      return baseThresholds;
    }

    // Phase 1: Basic adjustments
    const sizeMultiplier = this.calculateProjectSizeWeight(config.projectSize);
    const domainMultiplier = this.calculateDomainWeight(config.domainComplexity);
    
    // Phase 2: Additional project structure adjustments
    const fileStructureMultiplier = this.calculateFileStructureWeight(config);
    const fileDensityMultiplier = this.calculateFileDensityWeight(config);
    const maturityMultiplier = this.calculateProjectMaturityWeight(config);
    
    // Combined adjustment factor (Phase 2 enhanced)
    const adjustmentFactor = sizeMultiplier * 
                           domainMultiplier * 
                           fileStructureMultiplier * 
                           fileDensityMultiplier * 
                           maturityMultiplier;

    return {
      hubThreshold: Math.round(baseThresholds.hubThreshold * adjustmentFactor),
      utilityThreshold: Math.round(baseThresholds.utilityThreshold * adjustmentFactor),
      complexityThreshold: Math.round(baseThresholds.complexityThreshold * adjustmentFactor),
      locThreshold: Math.round(baseThresholds.locThreshold * adjustmentFactor),
      cognitiveComplexityThreshold: Math.round(baseThresholds.cognitiveComplexityThreshold * adjustmentFactor)
    };
  }

  /**
   * Explain weight calculation for a function
   */
  explainWeight(context: FunctionContext, metricType: 'fanIn' | 'fanOut' | 'complexity' | 'loc' = 'complexity'): string[] {
    const result = this.calculateWeight(10, context, metricType); // Use dummy base metric
    const breakdown = result.breakdown;
    
    const explanations: string[] = [];
    
    explanations.push(`🎯 Weight Calculation for Function: ${context.functionId}`);
    explanations.push(`📊 Mode: ${this.options.config.mode}`);
    
    if (!result.isDynamic) {
      explanations.push(`📋 Static mode - using default weight: 1.0`);
      return explanations;
    }
    
    explanations.push('');
    explanations.push('📈 Weight Components:');
    explanations.push(`  ├── Project Size: ${breakdown.projectSizeWeight.toFixed(2)}x`);
    explanations.push(`  ├── Layer (${context.layer}): ${breakdown.layerWeight.toFixed(2)}x`);
    explanations.push(`  ├── Role (${context.role}): ${breakdown.roleWeight.toFixed(2)}x`);
    explanations.push(`  ├── Criticality (${context.criticality}): ${breakdown.criticalityWeight.toFixed(2)}x`);
    explanations.push(`  └── Domain: ${breakdown.domainWeight.toFixed(2)}x`);
    explanations.push('');
    explanations.push(`🎯 Final Weight: ${result.finalWeight.toFixed(2)}x`);
    
    if (breakdown.appliedRules.length > 0) {
      explanations.push('');
      explanations.push('📋 Applied Rules:');
      for (const rule of breakdown.appliedRules) {
        explanations.push(`  • ${rule.rule}: ${rule.multiplier.toFixed(2)}x - ${rule.reason}`);
      }
    }
    
    return explanations;
  }

  /**
   * Calculate project size weight
   */
  private calculateProjectSizeWeight(projectSize: number): number {
    for (const config of Object.values(PROJECT_SIZE_MULTIPLIERS)) {
      if (projectSize < config.threshold) {
        return config.multiplier;
      }
    }
    return PROJECT_SIZE_MULTIPLIERS.veryLarge.multiplier;
  }

  /**
   * Calculate layer weight
   */
  private calculateLayerWeight(layer: string): number {
    return LAYER_MULTIPLIERS[layer as keyof typeof LAYER_MULTIPLIERS] || 1.0;
  }

  /**
   * Calculate role weight
   */
  private calculateRoleWeight(role: string): number {
    return ROLE_MULTIPLIERS[role as keyof typeof ROLE_MULTIPLIERS] || 1.0;
  }

  /**
   * Calculate criticality weight
   */
  private calculateCriticalityWeight(criticality: string): number {
    return CRITICALITY_MULTIPLIERS[criticality as keyof typeof CRITICALITY_MULTIPLIERS] || 1.0;
  }

  /**
   * Calculate domain complexity weight
   */
  private calculateDomainWeight(domainComplexity: string): number {
    return DOMAIN_COMPLEXITY_MULTIPLIERS[domainComplexity as keyof typeof DOMAIN_COMPLEXITY_MULTIPLIERS] || 1.0;
  }

  /**
   * Phase 2: Calculate file structure complexity weight
   */
  private calculateFileStructureWeight(config: DynamicWeightConfig): number {
    if (!config.maxDirectoryDepth) {
      return 1.0; // No data available, use default
    }

    for (const [_key, structConfig] of Object.entries(FILE_STRUCTURE_MULTIPLIERS)) {
      if (config.maxDirectoryDepth <= structConfig.maxDepth) {
        return structConfig.multiplier;
      }
    }
    return FILE_STRUCTURE_MULTIPLIERS.veryComplex.multiplier;
  }

  /**
   * Phase 2: Calculate file density weight (functions per file ratio)
   */
  private calculateFileDensityWeight(config: DynamicWeightConfig): number {
    if (!config.avgFunctionsPerFile) {
      return 1.0; // No data available, use default
    }

    const ratio = config.avgFunctionsPerFile;
    
    // Adjust based on function density per file
    if (ratio < 5) return 0.9;      // Very sparse - lower standards
    if (ratio < 15) return 1.0;     // Normal density
    if (ratio < 25) return 1.05;    // Dense - slightly higher standards
    if (ratio < 40) return 1.1;     // Very dense - higher standards
    return 1.15;                    // Extremely dense - strictest standards
  }

  /**
   * Phase 2: Calculate project maturity weight based on file organization
   */
  private calculateProjectMaturityWeight(config: DynamicWeightConfig): number {
    if (!config.fileCount || !config.projectSize) {
      return 1.0;
    }

    // Calculate files-to-functions ratio as a maturity indicator
    const fileToFunctionRatio = config.fileCount / config.projectSize;
    
    // Higher file count relative to functions indicates better organization
    if (fileToFunctionRatio > 0.8) return 0.95;  // Very well organized
    if (fileToFunctionRatio > 0.5) return 1.0;   // Well organized
    if (fileToFunctionRatio > 0.3) return 1.05;  // Moderately organized
    if (fileToFunctionRatio > 0.2) return 1.1;   // Poorly organized
    return 1.15;                                  // Very poorly organized
  }

  /**
   * Generate applied rules for transparency
   */
  private generateAppliedRules(
    context: FunctionContext, 
    config: DynamicWeightConfig,
    metricType: 'fanIn' | 'fanOut' | 'complexity' | 'loc'
  ): Array<{ rule: string; multiplier: number; reason: string }> {
    const rules = [];
    
    // Project size rules
    const sizeMultiplier = this.calculateProjectSizeWeight(config.projectSize);
    if (sizeMultiplier !== 1.0) {
      rules.push({
        rule: 'Project Size Adjustment',
        multiplier: sizeMultiplier,
        reason: `${config.projectSize} functions project needs ${sizeMultiplier > 1 ? 'stricter' : 'more lenient'} standards`
      });
    }
    
    // Layer-specific rules
    const layerMultiplier = this.calculateLayerWeight(context.layer);
    if (layerMultiplier !== 1.0) {
      const reason = this.getLayerRuleReason(context.layer, metricType);
      rules.push({
        rule: `${context.layer} Layer Rule`,
        multiplier: layerMultiplier,
        reason
      });
    }
    
    // Role-specific rules
    const roleMultiplier = this.calculateRoleWeight(context.role);
    if (roleMultiplier !== 1.0) {
      const reason = this.getRoleRuleReason(context.role, metricType);
      rules.push({
        rule: `${context.role} Role Rule`,
        multiplier: roleMultiplier,
        reason
      });
    }
    
    // Criticality rules
    const criticalityMultiplier = this.calculateCriticalityWeight(context.criticality);
    if (criticalityMultiplier !== 1.0) {
      rules.push({
        rule: `${context.criticality} Priority Rule`,
        multiplier: criticalityMultiplier,
        reason: `${context.criticality} functions require ${criticalityMultiplier > 1 ? 'higher' : 'lower'} quality standards`
      });
    }
    
    return rules;
  }

  /**
   * Get explanation for layer-specific rules
   */
  private getLayerRuleReason(layer: string, _metricType: 'fanIn' | 'fanOut' | 'complexity' | 'loc'): string {
    const reasons: Record<string, string> = {
      presentation: 'Presentation layer functions can have higher fan-out for coordination',
      business: 'Business logic requires stricter quality standards',
      data: 'Data access functions use standard evaluation',
      utility: 'Utility functions are allowed higher coupling for reusability',
      infrastructure: 'Infrastructure code uses standard evaluation'
    };
    
    return reasons[layer] || 'Standard evaluation for unknown layer';
  }

  /**
   * Get explanation for role-specific rules
   */
  private getRoleRuleReason(role: string, _metricType: 'fanIn' | 'fanOut' | 'complexity' | 'loc'): string {
    const reasons: Record<string, string> = {
      core: 'Core business functions require highest quality standards',
      support: 'Supporting functions use standard evaluation',
      utility: 'Utility functions allow more lenient coupling standards',
      facade: 'Facade functions are allowed higher fan-out for coordination'
    };
    
    return reasons[role] || 'Standard evaluation for unknown role';
  }

  /**
   * Create empty breakdown for static mode
   */
  private createEmptyBreakdown(): WeightBreakdown {
    return {
      projectSizeWeight: 1.0,
      layerWeight: 1.0,
      roleWeight: 1.0,
      criticalityWeight: 1.0,
      domainWeight: 1.0,
      appliedRules: []
    };
  }
}

/**
 * Create default dynamic weight calculator
 */
export function createDynamicWeightCalculator(config: DynamicWeightConfig): DynamicWeightCalculator {
  return new DynamicWeightCalculator({
    config,
    enableExplanation: true
  });
}