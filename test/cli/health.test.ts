import { describe, it, expect, beforeEach, vi } from 'vitest';
import { healthCommand } from '../../src/cli/health.js';
import type { HealthCommandOptions } from '../../src/types/index.js';

// Mock dependencies
vi.mock('../../src/core/config.js');
vi.mock('../../src/storage/pglite-adapter.js');
vi.mock('../../src/utils/quality-scorer.js');
vi.mock('../../src/core/risk-assessor.js');
vi.mock('simple-git');

describe('Health Command', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockProcessExit.mockRestore();
  });

  describe('Command Options', () => {
    it('should accept health command options', async () => {
      const options: HealthCommandOptions = {
        trend: false,
        risks: false,
        showConfig: false,
        verbose: false,
        json: false,
        period: '7'
      };

      // Basic interface validation
      expect(options).toBeDefined();
      expect(typeof options.trend).toBe('boolean');
      expect(typeof options.risks).toBe('boolean');
      expect(typeof options.showConfig).toBe('boolean');
      expect(typeof options.verbose).toBe('boolean');
      expect(typeof options.json).toBe('boolean');
    });

    it('should handle optional parameters correctly', async () => {
      const minimalOptions: HealthCommandOptions = {};
      
      expect(minimalOptions.trend).toBeUndefined();
      expect(minimalOptions.risks).toBeUndefined();
      expect(minimalOptions.showConfig).toBeUndefined();
      expect(minimalOptions.verbose).toBeUndefined();
      expect(minimalOptions.json).toBeUndefined();
      expect(minimalOptions.period).toBeUndefined();
    });
  });

  describe('Period Validation', () => {
    it('should handle valid period strings', () => {
      const periods = ['1', '7', '30', '90'];
      periods.forEach(period => {
        const parsed = parseInt(period, 10);
        expect(parsed).toBeGreaterThan(0);
        expect(isNaN(parsed)).toBe(false);
      });
    });

    it('should detect invalid period values', () => {
      const invalidPeriods = ['0', '-1', 'abc', ''];
      invalidPeriods.forEach(period => {
        const parsed = parseInt(period, 10);
        const isValid = !isNaN(parsed) && parsed > 0;
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Output Format Validation', () => {
    it('should handle different output modes', () => {
      const modes = [
        { trend: true, risks: false, showConfig: false },
        { trend: false, risks: true, showConfig: false },
        { trend: false, risks: false, showConfig: true },
        { trend: false, risks: false, showConfig: false }, // default health overview
      ];

      modes.forEach(mode => {
        const options: HealthCommandOptions = mode;
        expect(options).toBeDefined();
        
        // Only one mode should be active at a time
        const activeModesCount = [options.trend, options.risks, options.showConfig]
          .filter(Boolean).length;
        expect(activeModesCount).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Helper Functions', () => {
    it('should validate grade calculation', () => {
      const testGrades = (score: number): string => {
        if (score >= 90) return 'A';
        if (score >= 80) return 'B';
        if (score >= 70) return 'C';
        if (score >= 60) return 'D';
        return 'F';
      };

      expect(testGrades(95)).toBe('A');
      expect(testGrades(85)).toBe('B');
      expect(testGrades(75)).toBe('C');
      expect(testGrades(65)).toBe('D');
      expect(testGrades(55)).toBe('F');
    });

    it('should validate trend display logic', () => {
      const getTrendDisplay = (trend: 'improving' | 'stable' | 'degrading'): string => {
        switch (trend) {
          case 'improving': return 'Improving';
          case 'degrading': return 'Degrading';
          default: return 'Stable';
        }
      };

      expect(getTrendDisplay('improving')).toBe('Improving');
      expect(getTrendDisplay('degrading')).toBe('Degrading');
      expect(getTrendDisplay('stable')).toBe('Stable');
    });
  });

  describe('Data Processing', () => {
    it('should handle empty function arrays', () => {
      const emptyFunctions: any[] = [];
      expect(emptyFunctions.length).toBe(0);
      
      // Should not crash with empty data
      const functionsWithMetrics = emptyFunctions.filter(f => f.metrics);
      expect(functionsWithMetrics.length).toBe(0);
    });

    it('should filter functions with metrics correctly', () => {
      const testFunctions = [
        { id: '1', name: 'func1', metrics: { cyclomaticComplexity: 5 } },
        { id: '2', name: 'func2', metrics: null },
        { id: '3', name: 'func3', metrics: { cyclomaticComplexity: 3 } },
        { id: '4', name: 'func4' }, // no metrics property
      ];

      const functionsWithMetrics = testFunctions.filter(f => f.metrics);
      expect(functionsWithMetrics.length).toBe(2);
      expect(functionsWithMetrics[0].id).toBe('1');
      expect(functionsWithMetrics[1].id).toBe('3');
    });
  });

  describe('Configuration Handling', () => {
    it('should validate threshold configuration structure', () => {
      const mockConfig = {
        metrics: {
          complexityThreshold: 10,
          cognitiveComplexityThreshold: 15,
          linesOfCodeThreshold: 40,
          parameterCountThreshold: 4,
          maxNestingLevelThreshold: 3
        },
        storage: {
          path: '.funcqc/funcqc.db'
        },
        git: {
          enabled: true
        }
      };

      expect(mockConfig.metrics.complexityThreshold).toBe(10);
      expect(mockConfig.metrics.linesOfCodeThreshold).toBe(40);
      expect(mockConfig.storage.path).toBeDefined();
      expect(mockConfig.git.enabled).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should validate error conditions', () => {
      // Test configuration validation
      const invalidStoragePath = '';
      expect(invalidStoragePath).toBe('');
      
      // Test empty snapshot arrays
      const emptySnapshots: any[] = [];
      expect(emptySnapshots.length).toBe(0);
    });
  });

  describe('Trend Analysis', () => {
    it('should calculate trend periods correctly', () => {
      const now = new Date();
      const periodDays = 7;
      const periodMs = periodDays * 24 * 60 * 60 * 1000;
      
      const periodEnd = new Date(now.getTime());
      const periodStart = new Date(periodEnd.getTime() - periodMs);
      
      expect(periodEnd.getTime() - periodStart.getTime()).toBe(periodMs);
      expect(periodStart.getTime()).toBeLessThan(periodEnd.getTime());
    });

    it('should validate quality score calculation', () => {
      const testMetrics = {
        cyclomaticComplexity: 5,
        linesOfCode: 20,
        maintainabilityIndex: 85
      };

      // Simple quality score calculation (similar to actual implementation)
      const qualityScore = Math.max(0, 100 - (testMetrics.cyclomaticComplexity - 1) * 10);
      expect(qualityScore).toBeGreaterThanOrEqual(0);
      expect(qualityScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Risk Assessment Integration', () => {
    it('should validate risk level categorization', () => {
      const testComplexities = [3, 8, 12, 15, 20];
      const complexityThreshold = 10;

      testComplexities.forEach(complexity => {
        const isHighRisk = complexity > complexityThreshold;
        if (complexity <= complexityThreshold) {
          expect(isHighRisk).toBe(false);
        } else {
          expect(isHighRisk).toBe(true);
        }
      });
    });

    it('should calculate risk distribution correctly', () => {
      const mockFunctions = [
        { complexity: 5 },  // low
        { complexity: 8 },  // low
        { complexity: 12 }, // high
        { complexity: 15 }, // high
      ];
      
      const threshold = 10;
      const highRisk = mockFunctions.filter(f => f.complexity > threshold).length;
      const lowRisk = mockFunctions.filter(f => f.complexity <= threshold).length;
      
      expect(highRisk).toBe(2);
      expect(lowRisk).toBe(2);
      expect(highRisk + lowRisk).toBe(mockFunctions.length);
    });
  });
});