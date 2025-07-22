import { describe, it, expect } from 'vitest';
import { 
  formatFunctionCountWithDiff
} from '../src/cli/commands/history';

describe('History Format Functions', () => {

  describe('formatFunctionCountWithDiff', () => {
    it('should format positive diff correctly', () => {
      const result = formatFunctionCountWithDiff(820, 115);
      expect(result).toBe('   820(+115)');
    });

    it('should format negative diff correctly', () => {
      const result = formatFunctionCountWithDiff(705, -15);
      expect(result).toBe('    705(-15)');
    });

    it('should format zero diff correctly', () => {
      const result = formatFunctionCountWithDiff(800, 0);
      expect(result).toBe('         800');
    });

    it('should pad correctly for different lengths', () => {
      const result = formatFunctionCountWithDiff(5, 2);
      expect(result).toBe('       5(+2)');
    });
  });

});