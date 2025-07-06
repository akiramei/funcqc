import { describe, it, expect, beforeEach, vi } from 'vitest';
import { explainCommand } from '../../src/cli/explain.js';
import { 
  getMetricExplanation, 
  getConceptExplanation, 
  getAllMetrics,
  searchMetrics,
  METRIC_EXPLANATIONS,
  CONCEPT_EXPLANATIONS
} from '../../src/data/metric-explanations.js';
import type { ExplainCommandOptions } from '../../src/types/index.js';

describe('Explain Command', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockProcessExit.mockRestore();
  });

  describe('Command Options', () => {
    it('should accept explain command options', () => {
      const options: ExplainCommandOptions = {
        metric: 'cyclomaticComplexity',
        concept: 'complexity',
        threshold: true,
        all: false,
        examples: true,
        format: 'detailed'
      };

      expect(options).toBeDefined();
      expect(options.metric).toBe('cyclomaticComplexity');
      expect(options.concept).toBe('complexity');
      expect(options.threshold).toBe(true);
      expect(options.all).toBe(false);
      expect(options.examples).toBe(true);
      expect(options.format).toBe('detailed');
    });

    it('should handle optional parameters correctly', () => {
      const minimalOptions: ExplainCommandOptions = {};
      
      expect(minimalOptions.metric).toBeUndefined();
      expect(minimalOptions.concept).toBeUndefined();
      expect(minimalOptions.threshold).toBeUndefined();
      expect(minimalOptions.all).toBeUndefined();
      expect(minimalOptions.examples).toBeUndefined();
      expect(minimalOptions.format).toBeUndefined();
    });
  });

  describe('Metric Explanations Data', () => {
    it('should have all required metrics defined', () => {
      const requiredMetrics = [
        'cyclomaticComplexity',
        'cognitiveComplexity',
        'linesOfCode',
        'totalLines',
        'parameterCount',
        'maxNestingLevel',
        'branchCount',
        'loopCount',
        'returnStatementCount',
        'tryCatchCount',
        'asyncAwaitCount',
        'callbackCount',
        'commentLines',
        'codeToCommentRatio',
        'halsteadVolume',
        'halsteadDifficulty',
        'maintainabilityIndex'
      ];

      requiredMetrics.forEach(metric => {
        const explanation = getMetricExplanation(metric);
        expect(explanation).toBeDefined();
        expect(explanation?.name).toBe(metric);
        expect(explanation?.displayName).toBeDefined();
        expect(explanation?.definition).toBeDefined();
        expect(explanation?.purpose).toBeDefined();
        expect(explanation?.calculation).toBeDefined();
      });
    });

    it('should have valid threshold data for each metric', () => {
      const allMetrics = getAllMetrics();
      
      allMetrics.forEach(metric => {
        expect(metric.thresholds).toBeDefined();
        expect(metric.thresholds.low).toBeDefined();
        expect(metric.thresholds.medium).toBeDefined();
        expect(metric.thresholds.high).toBeDefined();
        
        expect(typeof metric.thresholds.low.value).toBe('number');
        expect(typeof metric.thresholds.medium.value).toBe('number');
        expect(typeof metric.thresholds.high.value).toBe('number');
        
        expect(metric.thresholds.low.description).toBeDefined();
        expect(metric.thresholds.medium.description).toBeDefined();
        expect(metric.thresholds.high.description).toBeDefined();
      });
    });

    it('should categorize metrics correctly', () => {
      const categories = ['complexity', 'size', 'structure', 'documentation', 'advanced', 'patterns'];
      const allMetrics = getAllMetrics();
      
      allMetrics.forEach(metric => {
        expect(categories).toContain(metric.category);
      });
    });

    it('should have industry standards and best practices', () => {
      const allMetrics = getAllMetrics();
      
      allMetrics.forEach(metric => {
        expect(metric.industryStandards).toBeDefined();
        expect(metric.industryStandards.length).toBeGreaterThan(0);
        expect(Array.isArray(metric.bestPractices)).toBe(true);
        expect(metric.bestPractices.length).toBeGreaterThan(0);
        expect(Array.isArray(metric.relatedMetrics)).toBe(true);
      });
    });
  });

  describe('Concept Explanations Data', () => {
    it('should have all required concepts defined', () => {
      const requiredConcepts = [
        'complexity',
        'maintainability',
        'quality',
        'testing',
        'refactoring'
      ];

      requiredConcepts.forEach(concept => {
        const explanation = getConceptExplanation(concept);
        expect(explanation).toBeDefined();
        expect(explanation?.name).toBeDefined();
        expect(explanation?.definition).toBeDefined();
        expect(explanation?.importance).toBeDefined();
        expect(Array.isArray(explanation?.keyPrinciples)).toBe(true);
        expect(Array.isArray(explanation?.relatedMetrics)).toBe(true);
        expect(Array.isArray(explanation?.practicalTips)).toBe(true);
      });
    });

    it('should have valid structure for each concept', () => {
      const allConcepts = Object.values(CONCEPT_EXPLANATIONS);
      
      allConcepts.forEach(concept => {
        expect(concept.name).toBeDefined();
        expect(concept.definition).toBeDefined();
        expect(concept.importance).toBeDefined();
        expect(concept.keyPrinciples.length).toBeGreaterThan(0);
        expect(concept.practicalTips.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Search Functionality', () => {
    it('should find metrics by exact name', () => {
      const result = searchMetrics('cyclomaticComplexity');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('cyclomaticComplexity');
    });

    it('should find metrics by partial name', () => {
      const result = searchMetrics('complexity');
      expect(result.length).toBeGreaterThan(0);
      
      // Should find both cyclomaticComplexity and cognitiveComplexity
      const names = result.map(r => r.name);
      expect(names).toContain('cyclomaticComplexity');
      expect(names).toContain('cognitiveComplexity');
    });

    it('should find metrics by display name', () => {
      const result = searchMetrics('Cyclomatic');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].displayName).toContain('Cyclomatic');
    });

    it('should find metrics by definition keywords', () => {
      const result = searchMetrics('linearly independent paths');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].definition).toContain('linearly independent paths');
    });

    it('should return empty array for unknown search terms', () => {
      const result = searchMetrics('nonexistentmetric');
      expect(result.length).toBe(0);
    });

    it('should be case insensitive', () => {
      const lowerResult = searchMetrics('complexity');
      const upperResult = searchMetrics('COMPLEXITY');
      const mixedResult = searchMetrics('Complexity');
      
      expect(lowerResult.length).toBe(upperResult.length);
      expect(lowerResult.length).toBe(mixedResult.length);
    });
  });

  describe('Metric Retrieval Functions', () => {
    it('should retrieve specific metric explanations', () => {
      const cyclomatic = getMetricExplanation('cyclomaticComplexity');
      expect(cyclomatic).toBeDefined();
      expect(cyclomatic?.name).toBe('cyclomaticComplexity');
      expect(cyclomatic?.displayName).toBe('Cyclomatic Complexity');
    });

    it('should return undefined for unknown metrics', () => {
      const unknown = getMetricExplanation('unknownMetric');
      expect(unknown).toBeUndefined();
    });

    it('should retrieve specific concept explanations', () => {
      const complexity = getConceptExplanation('complexity');
      expect(complexity).toBeDefined();
      expect(complexity?.name).toBe('Code Complexity');
    });

    it('should handle case-insensitive concept retrieval', () => {
      const lower = getConceptExplanation('complexity');
      const upper = getConceptExplanation('COMPLEXITY');
      const mixed = getConceptExplanation('Complexity');
      
      expect(lower).toBeDefined();
      expect(upper).toBeDefined();
      expect(mixed).toBeDefined();
      expect(lower?.name).toBe(upper?.name);
      expect(lower?.name).toBe(mixed?.name);
    });

    it('should return undefined for unknown concepts', () => {
      const unknown = getConceptExplanation('unknownConcept');
      expect(unknown).toBeUndefined();
    });
  });

  describe('Data Consistency', () => {
    it('should have consistent metric categories', () => {
      const expectedCategories = ['complexity', 'size', 'structure', 'documentation', 'advanced', 'patterns'];
      const allMetrics = getAllMetrics();
      
      const usedCategories = [...new Set(allMetrics.map(m => m.category))];
      usedCategories.forEach(category => {
        expect(expectedCategories).toContain(category);
      });
    });

    it('should have valid threshold ordering', () => {
      const allMetrics = getAllMetrics();
      
      allMetrics.forEach(metric => {
        const { low, medium, high } = metric.thresholds;
        // For most metrics, low < medium < high (except for maintainabilityIndex)
        if (metric.name !== 'maintainabilityIndex') {
          expect(low.value).toBeLessThanOrEqual(medium.value);
        }
      });
    });

    it('should have non-empty required fields', () => {
      const allMetrics = getAllMetrics();
      
      allMetrics.forEach(metric => {
        expect(metric.name.length).toBeGreaterThan(0);
        expect(metric.displayName.length).toBeGreaterThan(0);
        expect(metric.definition.length).toBeGreaterThan(0);
        expect(metric.purpose.length).toBeGreaterThan(0);
        expect(metric.calculation.length).toBeGreaterThan(0);
        expect(metric.industryStandards.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Related Metrics Validation', () => {
    it('should have valid related metrics references', () => {
      const allMetrics = getAllMetrics();
      const allMetricNames = allMetrics.map(m => m.name);
      
      allMetrics.forEach(metric => {
        metric.relatedMetrics.forEach(relatedName => {
          // Related metrics should either exist in our metrics or be reasonable external references
          if (!allMetricNames.includes(relatedName)) {
            // Allow some external/conceptual metrics that might not be in our collection
            const allowedExternal = ['testCoverage', 'changeFrequency', 'bugDensity'];
            expect(allowedExternal).toContain(relatedName);
          }
        });
      });
    });
  });
});