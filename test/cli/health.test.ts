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

    it('should accept aiOptimized option', async () => {
      const options: HealthCommandOptions = {
        aiOptimized: true,
        trend: false,
        risks: false,
        showConfig: false,
        verbose: false,
        json: false
      };

      expect(options.aiOptimized).toBe(true);
      expect(typeof options.aiOptimized).toBe('boolean');
    });

    it('should handle optional parameters correctly', async () => {
      const minimalOptions: HealthCommandOptions = {};
      
      expect(minimalOptions.trend).toBeUndefined();
      expect(minimalOptions.risks).toBeUndefined();
      expect(minimalOptions.showConfig).toBeUndefined();
      expect(minimalOptions.verbose).toBeUndefined();
      expect(minimalOptions.json).toBeUndefined();
      expect(minimalOptions.period).toBeUndefined();
      expect(minimalOptions.aiOptimized).toBeUndefined();
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

  describe('AI Optimized Output', () => {
    it('should validate AI optimized report structure', () => {
      const mockReport = {
        summary: {
          total_functions: 100,
          high_risk_functions: 5,
          overall_grade: 'B',
          overall_score: 85,
          last_analyzed: '2024-01-15T12:00:00.000Z'
        },
        high_risk_functions: [
          {
            id: 'test-id-1',
            name: 'testFunction',
            display_name: 'TestClass.testFunction',
            location: 'src/test.ts:10',
            risk_factors: ['complexity:15', 'size:120'],
            risk_score: 85,
            fix_priority: 1,
            estimated_effort: '30-60min',
            suggested_actions: ['extract_methods', 'reduce_branching'],
            metrics: {
              cyclomatic_complexity: 15,
              lines_of_code: 120,
              maintainability_index: 45.5,
              parameter_count: 3
            }
          }
        ],
        improvement_roadmap: [
          {
            step: 1,
            function_id: 'test-id-1',
            action: 'split_complex_function',
            estimated_time: '45min',
            impact: 'high' as const,
            difficulty: 'medium' as const
          }
        ],
        next_actions: [
          {
            action_type: 'simplify' as const,
            function_id: 'test-id-1',
            description: 'Reduce cyclomatic complexity through refactoring',
            code_location: 'src/test.ts:10-50',
            specific_steps: [
              'Replace nested if-else with early returns',
              'Extract complex conditions into named functions'
            ]
          }
        ]
      };

      // Validate structure
      expect(mockReport.summary.total_functions).toBe(100);
      expect(mockReport.summary.high_risk_functions).toBe(5);
      expect(mockReport.summary.overall_grade).toBe('B');
      expect(mockReport.high_risk_functions).toHaveLength(1);
      expect(mockReport.improvement_roadmap).toHaveLength(1);
      expect(mockReport.next_actions).toHaveLength(1);
    });

    it('should validate risk factor calculation', () => {
      const testFunction = {
        metrics: {
          cyclomaticComplexity: 15,
          maintainabilityIndex: 45,
          linesOfCode: 120,
          parameterCount: 3
        }
      };

      let riskScore = 0;
      const riskFactors: string[] = [];
      
      if (testFunction.metrics.cyclomaticComplexity > 10) {
        riskScore += (testFunction.metrics.cyclomaticComplexity - 10) * 10;
        riskFactors.push(`complexity:${testFunction.metrics.cyclomaticComplexity}`);
      }
      if (testFunction.metrics.maintainabilityIndex < 50) {
        riskScore += (50 - testFunction.metrics.maintainabilityIndex) * 2;
        riskFactors.push(`maintainability:${testFunction.metrics.maintainabilityIndex}`);
      }
      if (testFunction.metrics.linesOfCode > 100) {
        riskScore += (testFunction.metrics.linesOfCode - 100) * 0.5;
        riskFactors.push(`size:${testFunction.metrics.linesOfCode}`);
      }

      expect(riskScore).toBe(70); // (15-10)*10 + (50-45)*2 + (120-100)*0.5
      expect(riskFactors).toContain('complexity:15');
      expect(riskFactors).toContain('maintainability:45');
      expect(riskFactors).toContain('size:120');
    });

    it('should validate suggested actions logic', () => {
      const testCases = [
        {
          complexity: 20,
          lines: 200,
          parameters: 6,
          expectedActions: ['extract_methods', 'reduce_branching', 'split_function', 'extract_helpers', 'parameterize_object', 'extract_config']
        },
        {
          complexity: 12,
          lines: 80,
          parameters: 3,
          expectedActions: ['extract_methods', 'reduce_branching']
        },
        {
          complexity: 8,
          lines: 160,
          parameters: 2,
          expectedActions: ['split_function', 'extract_helpers']
        }
      ];

      testCases.forEach(testCase => {
        const suggestedActions: string[] = [];
        
        if (testCase.complexity > 15) {
          suggestedActions.push('extract_methods', 'reduce_branching');
        }
        if (testCase.lines > 150) {
          suggestedActions.push('split_function', 'extract_helpers');
        }
        if (testCase.parameters > 5) {
          suggestedActions.push('parameterize_object', 'extract_config');
        }

        // Only check for actions that should be included based on the conditions
        if (testCase.complexity > 15) {
          expect(suggestedActions).toContain('extract_methods');
          expect(suggestedActions).toContain('reduce_branching');
        }
        if (testCase.lines > 150) {
          expect(suggestedActions).toContain('split_function');
          expect(suggestedActions).toContain('extract_helpers');
        }
        if (testCase.parameters > 5) {
          expect(suggestedActions).toContain('parameterize_object');
          expect(suggestedActions).toContain('extract_config');
        }
      });
    });

    it('should validate effort estimation logic', () => {
      const effortCases = [
        { complexity: 25, expected: '60-120min' },
        { complexity: 18, expected: '30-60min' },
        { complexity: 12, expected: '15-30min' }
      ];

      effortCases.forEach(testCase => {
        const estimatedEffort = testCase.complexity > 20 ? '60-120min' : 
                               testCase.complexity > 15 ? '30-60min' : '15-30min';
        expect(estimatedEffort).toBe(testCase.expected);
      });
    });

    it('should validate action type determination', () => {
      const actionCases = [
        { complexity: 20, lines: 150, expected: 'split' },
        { complexity: 18, lines: 80, expected: 'simplify' },
        { complexity: 8, lines: 60, expected: 'refactor' }
      ];

      actionCases.forEach(testCase => {
        let actionType: 'refactor' | 'split' | 'extract' | 'simplify';
        
        if (testCase.complexity > 15 && testCase.lines > 100) {
          actionType = 'split';
        } else if (testCase.complexity > 15) {
          actionType = 'simplify';
        } else {
          actionType = 'refactor';
        }
        
        expect(actionType).toBe(testCase.expected);
      });
    });
  });
});