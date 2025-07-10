/**
 * Comprehensive unit tests for MetricThresholdRule table
 * Tests all metric rules systematically to ensure type safety and functionality
 */

import { describe, it, expect } from 'vitest';
import { QualityMetrics, FuncqcConfig } from '../src/types';

// Extract the logic for testing (in a real implementation, this would be exported from health.ts)
interface MetricActionRule {
  condition: (value: number, threshold: number) => boolean;
  actions: string[];
}

interface MetricThresholdRule {
  name: keyof QualityMetrics;
  getValue: (metrics: QualityMetrics) => number;
  getThreshold: (config: FuncqcConfig) => number;
  rule: MetricActionRule;
}

// Mock configuration for testing
const createMockConfig = (): FuncqcConfig => ({
  roots: ['src'],
  exclude: ['**/*.test.ts'],
  storage: { type: 'pglite', path: 'test.db' },
  metrics: {
    complexityThreshold: 10,
    cognitiveComplexityThreshold: 15,
    linesOfCodeThreshold: 50,
    parameterCountThreshold: 5,
    maxNestingLevelThreshold: 4
  },
  git: { enabled: true, autoLabel: true },
  thresholds: {
    halsteadVolume: { warning: 1000 },
    halsteadDifficulty: { warning: 20 },
    returnStatements: { warning: 3 },
    asyncAwait: { warning: 3 },
    tryCatch: { warning: 2 },
    loops: { warning: 3 }
  }
});

// Mock QualityMetrics for testing
const createMockMetrics = (overrides: Partial<QualityMetrics> = {}): QualityMetrics => ({
  linesOfCode: 25,
  totalLines: 30,
  cyclomaticComplexity: 5,
  cognitiveComplexity: 8,
  maxNestingLevel: 2,
  parameterCount: 3,
  returnStatementCount: 1,
  branchCount: 3,
  loopCount: 1,
  tryCatchCount: 0,
  asyncAwaitCount: 1,
  callbackCount: 0,
  commentLines: 5,
  codeToCommentRatio: 5.0,
  halsteadVolume: 500,
  halsteadDifficulty: 10,
  maintainabilityIndex: 85,
  ...overrides
});

// Helper function to get configurable threshold with fallback
const getConfigurableThreshold = (
  config: FuncqcConfig,
  thresholdPath: string,
  defaultValue: number
): number => {
  const thresholdConfig = config.thresholds?.[thresholdPath as keyof typeof config.thresholds];
  return (typeof thresholdConfig?.warning === 'number') 
    ? thresholdConfig.warning : defaultValue;
};

// Define the actual metric rules (this mirrors the implementation in health.ts)
const createMetricRules = (config: FuncqcConfig): MetricThresholdRule[] => [
  {
    name: 'cyclomaticComplexity',
    getValue: (m) => m.cyclomaticComplexity || 1,
    getThreshold: (c) => c.metrics.complexityThreshold,
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['extract_methods', 'reduce_branching']
    }
  },
  {
    name: 'cognitiveComplexity',
    getValue: (m) => m.cognitiveComplexity || 0,
    getThreshold: (c) => c.metrics.cognitiveComplexityThreshold,
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['simplify_logic', 'reduce_cognitive_load']
    }
  },
  {
    name: 'linesOfCode',
    getValue: (m) => m.linesOfCode || 0,
    getThreshold: (c) => c.metrics.linesOfCodeThreshold * 3,
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['split_function', 'extract_helpers']
    }
  },
  {
    name: 'parameterCount',
    getValue: (m) => m.parameterCount || 0,
    getThreshold: (c) => c.metrics.parameterCountThreshold,
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['parameterize_object', 'extract_config']
    }
  },
  {
    name: 'maxNestingLevel',
    getValue: (m) => m.maxNestingLevel || 0,
    getThreshold: (c) => c.metrics.maxNestingLevelThreshold,
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['flatten_structure', 'use_early_returns']
    }
  },
  {
    name: 'branchCount',
    getValue: (m) => m.branchCount || 0,
    getThreshold: (c) => Math.max(5, c.metrics.complexityThreshold / 2),
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['consolidate_branches', 'extract_switch_logic']
    }
  },
  {
    name: 'halsteadVolume',
    getValue: (m) => m.halsteadVolume || 0,
    getThreshold: () => getConfigurableThreshold(config, 'halsteadVolume', 1000),
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['reduce_vocabulary', 'extract_constants']
    }
  },
  {
    name: 'halsteadDifficulty',
    getValue: (m) => m.halsteadDifficulty || 0,
    getThreshold: () => getConfigurableThreshold(config, 'halsteadDifficulty', 20),
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['simplify_expressions', 'improve_readability']
    }
  },
  {
    name: 'returnStatementCount',
    getValue: (m) => m.returnStatementCount || 0,
    getThreshold: () => getConfigurableThreshold(config, 'returnStatements', 3),
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['unify_returns', 'extract_result_builder']
    }
  },
  {
    name: 'asyncAwaitCount',
    getValue: (m) => m.asyncAwaitCount || 0,
    getThreshold: () => getConfigurableThreshold(config, 'asyncAwait', 3),
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['extract_async_helpers', 'simplify_async_flow']
    }
  },
  {
    name: 'tryCatchCount',
    getValue: (m) => m.tryCatchCount || 0,
    getThreshold: () => getConfigurableThreshold(config, 'tryCatch', 2),
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['consolidate_error_handling', 'extract_error_handlers']
    }
  },
  {
    name: 'loopCount',
    getValue: (m) => m.loopCount || 0,
    getThreshold: () => getConfigurableThreshold(config, 'loops', 3),
    rule: {
      condition: (val, threshold) => val > threshold,
      actions: ['extract_loop_logic', 'use_functional_style']
    }
  }
];

describe('MetricThresholdRule Table', () => {
  const config = createMockConfig();
  const metricRules = createMetricRules(config);

  describe('Type Safety', () => {
    it('should have all rule names as valid QualityMetrics keys', () => {
      const validKeys: Array<keyof QualityMetrics> = [
        'linesOfCode', 'totalLines', 'cyclomaticComplexity', 'cognitiveComplexity',
        'maxNestingLevel', 'parameterCount', 'returnStatementCount', 'branchCount',
        'loopCount', 'tryCatchCount', 'asyncAwaitCount', 'callbackCount',
        'commentLines', 'codeToCommentRatio', 'halsteadVolume', 'halsteadDifficulty',
        'maintainabilityIndex'
      ];

      metricRules.forEach(rule => {
        expect(validKeys).toContain(rule.name);
      });
    });

    it('should have getValue functions that return numbers', () => {
      const metrics = createMockMetrics();
      
      metricRules.forEach(rule => {
        const value = rule.getValue(metrics);
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      });
    });

    it('should have getThreshold functions that return positive numbers', () => {
      metricRules.forEach(rule => {
        const threshold = rule.getThreshold(config);
        expect(typeof threshold).toBe('number');
        expect(threshold).toBeGreaterThan(0);
      });
    });
  });

  describe('Rule Coverage', () => {
    it('should cover all essential quality metrics', () => {
      const ruleNames = metricRules.map(rule => rule.name);
      
      // Essential metrics that should have rules
      const essentialMetrics: Array<keyof QualityMetrics> = [
        'cyclomaticComplexity',
        'cognitiveComplexity', 
        'linesOfCode',
        'parameterCount',
        'maxNestingLevel',
        'branchCount'
      ];

      essentialMetrics.forEach(metric => {
        expect(ruleNames).toContain(metric);
      });
    });

    it('should have non-empty action arrays for all rules', () => {
      metricRules.forEach(rule => {
        expect(rule.rule.actions).toBeInstanceOf(Array);
        expect(rule.rule.actions.length).toBeGreaterThan(0);
        
        rule.rule.actions.forEach(action => {
          expect(typeof action).toBe('string');
          expect(action.length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe('Individual Rule Behavior', () => {
    describe.each(metricRules)('$name rule', (rule) => {
      it('should trigger when value exceeds threshold', () => {
        const metrics = createMockMetrics();
        const threshold = rule.getThreshold(config);
        const highValue = threshold + 1;
        
        // Create metrics with high value for this specific metric
        const highMetrics = createMockMetrics({
          [rule.name]: highValue
        } as Partial<QualityMetrics>);
        
        const value = rule.getValue(highMetrics);
        const shouldTrigger = rule.rule.condition(value, threshold);
        
        expect(shouldTrigger).toBe(true);
      });

      it('should not trigger when value is at or below threshold', () => {
        const metrics = createMockMetrics();
        const threshold = rule.getThreshold(config);
        
        // Create metrics with value at threshold
        const lowMetrics = createMockMetrics({
          [rule.name]: threshold
        } as Partial<QualityMetrics>);
        
        const value = rule.getValue(lowMetrics);
        const shouldTrigger = rule.rule.condition(value, threshold);
        
        expect(shouldTrigger).toBe(false);
      });

      it('should handle undefined/zero values gracefully', () => {
        // Create metrics with undefined value for this metric
        const emptyMetrics = createMockMetrics({
          [rule.name]: undefined
        } as Partial<QualityMetrics>);
        
        const value = rule.getValue(emptyMetrics);
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Threshold Configuration', () => {
    it('should use config values for basic metrics', () => {
      const cyclomaticRule = metricRules.find(r => r.name === 'cyclomaticComplexity')!;
      const threshold = cyclomaticRule.getThreshold(config);
      expect(threshold).toBe(config.metrics.complexityThreshold);
    });

    it('should use calculated values for derived thresholds', () => {
      const branchRule = metricRules.find(r => r.name === 'branchCount')!;
      const threshold = branchRule.getThreshold(config);
      const expected = Math.max(5, config.metrics.complexityThreshold / 2);
      expect(threshold).toBe(expected);
    });

    it('should use configurable thresholds with fallbacks', () => {
      const halsteadVolumeRule = metricRules.find(r => r.name === 'halsteadVolume')!;
      const threshold = halsteadVolumeRule.getThreshold(config);
      expect(threshold).toBe(1000); // From config.thresholds.halsteadVolume.warning
    });
  });

  describe('Action Recommendations', () => {
    it('should provide domain-specific actions for complexity', () => {
      const complexityRule = metricRules.find(r => r.name === 'cyclomaticComplexity')!;
      expect(complexityRule.rule.actions).toContain('extract_methods');
      expect(complexityRule.rule.actions).toContain('reduce_branching');
    });

    it('should provide domain-specific actions for size', () => {
      const sizeRule = metricRules.find(r => r.name === 'linesOfCode')!;
      expect(sizeRule.rule.actions).toContain('split_function');
      expect(sizeRule.rule.actions).toContain('extract_helpers');
    });

    it('should provide domain-specific actions for maintainability', () => {
      const nestingRule = metricRules.find(r => r.name === 'maxNestingLevel')!;
      expect(nestingRule.rule.actions).toContain('flatten_structure');
      expect(nestingRule.rule.actions).toContain('use_early_returns');
    });
  });

  describe('Integration Testing', () => {
    it('should process all rules for a high-risk function', () => {
      // Create metrics that violate multiple thresholds
      const highRiskMetrics = createMockMetrics({
        cyclomaticComplexity: 15,        // > 10 threshold
        cognitiveComplexity: 20,         // > 15 threshold  
        linesOfCode: 200,                // > 150 threshold (50 * 3)
        parameterCount: 8,               // > 5 threshold
        maxNestingLevel: 6,              // > 4 threshold
        branchCount: 8,                  // > 5 threshold
        halsteadVolume: 1500,            // > 1000 threshold
        returnStatementCount: 5          // > 3 threshold
      });

      const suggestedActions = new Set<string>();
      
      metricRules.forEach(rule => {
        const value = rule.getValue(highRiskMetrics);
        const threshold = rule.getThreshold(config);
        
        if (rule.rule.condition(value, threshold)) {
          rule.rule.actions.forEach(action => suggestedActions.add(action));
        }
      });

      // Should generate comprehensive action list
      expect(suggestedActions.size).toBeGreaterThan(10);
      expect(Array.from(suggestedActions)).toContain('extract_methods');
      expect(Array.from(suggestedActions)).toContain('split_function');
      expect(Array.from(suggestedActions)).toContain('flatten_structure');
    });

    it('should handle low-risk function without false positives', () => {
      // Create metrics that are well within thresholds
      const lowRiskMetrics = createMockMetrics({
        cyclomaticComplexity: 3,
        cognitiveComplexity: 5,
        linesOfCode: 15,
        parameterCount: 2,
        maxNestingLevel: 1,
        branchCount: 2,
        halsteadVolume: 300,
        returnStatementCount: 1
      });

      const triggeredRules = metricRules.filter(rule => {
        const value = rule.getValue(lowRiskMetrics);
        const threshold = rule.getThreshold(config);
        return rule.rule.condition(value, threshold);
      });

      expect(triggeredRules).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero values correctly', () => {
      const zeroMetrics = createMockMetrics({
        cyclomaticComplexity: 0,
        cognitiveComplexity: 0,
        linesOfCode: 0,
        parameterCount: 0,
        maxNestingLevel: 0,
        branchCount: 0
      });

      metricRules.forEach(rule => {
        const value = rule.getValue(zeroMetrics);
        const threshold = rule.getThreshold(config);
        
        // getValue should handle zero values appropriately
        expect(value).toBeGreaterThanOrEqual(0);
        
        // No rule should trigger for zero values
        const shouldTrigger = rule.rule.condition(value, threshold);
        expect(shouldTrigger).toBe(false);
      });
    });

    it('should handle missing optional metrics', () => {
      const minimalMetrics = createMockMetrics({
        halsteadVolume: undefined,
        halsteadDifficulty: undefined,
        maintainabilityIndex: undefined
      });

      const halsteadVolumeRule = metricRules.find(r => r.name === 'halsteadVolume')!;
      const halsteadDifficultyRule = metricRules.find(r => r.name === 'halsteadDifficulty')!;
      
      const volume = halsteadVolumeRule.getValue(minimalMetrics);
      const difficulty = halsteadDifficultyRule.getValue(minimalMetrics);
      
      expect(volume).toBe(0);
      expect(difficulty).toBe(0);
    });
  });
});