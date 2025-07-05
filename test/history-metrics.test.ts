import { describe, it, expect } from 'vitest';
import { 
  calculateP95Complexity, 
  calculateHighRiskCount, 
  formatFunctionCountWithDiff, 
  formatHighRiskCount 
} from '../src/cli/history';

describe('History Metrics Calculations', () => {
  describe('calculateP95Complexity', () => {
    it('should calculate P95 complexity correctly', () => {
      // Test data: complexity distribution with various values
      const distribution = {
        1: 50,   // 50 functions with complexity 1
        2: 30,   // 30 functions with complexity 2
        3: 15,   // 15 functions with complexity 3
        5: 4,    // 4 functions with complexity 5
        10: 1    // 1 function with complexity 10
      };
      // Total: 100 functions
      // 95th percentile should be complexity 3
      // (95% of 100 = 95, cumulative: 50+30+15 = 95)
      
      const result = calculateP95Complexity(distribution);
      expect(result).toBe(3);
    });

    it('should handle empty distribution', () => {
      const distribution = {};
      const result = calculateP95Complexity(distribution);
      expect(result).toBe(0);
    });

    it('should handle single complexity value', () => {
      const distribution = { 5: 10 };
      const result = calculateP95Complexity(distribution);
      expect(result).toBe(5);
    });

    it('should handle high percentile correctly', () => {
      const distribution = {
        1: 90,   // 90 functions with complexity 1
        2: 5,    // 5 functions with complexity 2
        3: 3,    // 3 functions with complexity 3
        10: 2    // 2 functions with complexity 10
      };
      // Total: 100 functions
      // 95th percentile should be complexity 2
      // (95% of 100 = 95, cumulative: 90+5 = 95)
      
      const result = calculateP95Complexity(distribution);
      expect(result).toBe(2);
    });
  });

  describe('calculateHighRiskCount', () => {
    it('should count functions with CC >= 10', () => {
      const distribution = {
        1: 50,
        5: 30,
        8: 15,
        10: 5,   // High risk
        15: 3,   // High risk
        20: 2    // High risk
      };
      const result = calculateHighRiskCount(distribution);
      expect(result).toBe(10); // 5 + 3 + 2 = 10
    });

    it('should return 0 when no high risk functions', () => {
      const distribution = {
        1: 50,
        3: 30,
        5: 15,
        8: 5
      };
      const result = calculateHighRiskCount(distribution);
      expect(result).toBe(0);
    });

    it('should handle empty distribution', () => {
      const distribution = {};
      const result = calculateHighRiskCount(distribution);
      expect(result).toBe(0);
    });

    it('should handle boundary case CC = 10', () => {
      const distribution = {
        9: 5,
        10: 3,   // Exactly 10 should be counted
        11: 2    // High risk
      };
      const result = calculateHighRiskCount(distribution);
      expect(result).toBe(5); // 3 + 2 = 5
    });
  });

  describe('formatFunctionCountWithDiff', () => {
    it('should format positive diff correctly', () => {
      const result = formatFunctionCountWithDiff(820, 115);
      expect(result).toBe(' 820(+115)');
    });

    it('should format negative diff correctly', () => {
      const result = formatFunctionCountWithDiff(705, -15);
      expect(result).toBe('  705(-15)');
    });

    it('should format zero diff correctly', () => {
      const result = formatFunctionCountWithDiff(800, 0);
      expect(result).toBe('       800');
    });

    it('should pad correctly for different lengths', () => {
      const result = formatFunctionCountWithDiff(5, 2);
      expect(result).toBe('     5(+2)');
    });
  });

  describe('formatHighRiskCount', () => {
    it('should format high risk count correctly', () => {
      const result = formatHighRiskCount(12);
      expect(result).toBe(' 12(CC≥10)');
    });

    it('should format zero count correctly', () => {
      const result = formatHighRiskCount(0);
      expect(result).toBe('         0');
    });

    it('should pad correctly for different lengths', () => {
      const result = formatHighRiskCount(5);
      expect(result).toBe('  5(CC≥10)');
    });
  });
});