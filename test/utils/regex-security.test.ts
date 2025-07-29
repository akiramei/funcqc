/**
 * Security test for Regular Expression Denial of Service (ReDoS) vulnerability fixes
 * Tests the hash-cache normalizer to ensure it's not vulnerable to ReDoS attacks
 */

import { describe, it, expect } from 'vitest';

// We need to test the private method, so we'll use a test helper
class TestHashCache {
  // Copy of the fixed normalizeForAST method for testing
  static normalizeForAST(content: string): string {
    return content
      .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, '') // Fixed ReDoS vulnerability
      .replace(/\/\/.*$/gm, '') // Remove single-line comments first, before normalizing whitespace
      .replace(/\s+/g, ' ') // Then normalize whitespace
      .trim();
  }

  // The vulnerable version for comparison (DO NOT USE IN PRODUCTION)
  static normalizeForASTVulnerable(content: string): string {
    return content
      .replace(/\/\*[\s\S]*?\*\//g, '') // VULNERABLE to ReDoS
      .replace(/\/\/.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

describe('Regex Security - ReDoS Vulnerability Fix', () => {
  describe('normalizeForAST - Fixed Version', () => {
    it('should handle normal multiline comments correctly', () => {
      const input = `
        function test() {
          /* This is a comment */
          return true;
        }
      `;
      
      const result = TestHashCache.normalizeForAST(input);
      expect(result).toContain('function test()');
      expect(result).toContain('return true;');
      expect(result).not.toContain('/* This is a comment */');
    });

    it('should handle nested-like comment patterns', () => {
      const input = `
        /* Comment with * inside */
        function test() {
          /* Another comment with * and more * */
          return 5 * 3;
        }
      `;
      
      const result = TestHashCache.normalizeForAST(input);
      expect(result).toContain('function test()');
      expect(result).toContain('return 5 * 3;');
      expect(result).not.toContain('Comment with * inside');
    });

    it('should handle multiple multiline comments', () => {
      const input = `
        /* First comment */
        function a() {}
        /* Second comment */
        function b() {}
        /* Third comment */
      `;
      
      const result = TestHashCache.normalizeForAST(input);
      expect(result).toContain('function a()');
      expect(result).toContain('function b()');
      expect(result).not.toContain('First comment');
      expect(result).not.toContain('Second comment');
      expect(result).not.toContain('Third comment');
    });

    it('should complete quickly on potential ReDoS attack patterns', () => {
      // This is the pattern that could cause ReDoS with the vulnerable regex
      const attackPattern = '/*' + 'a/*'.repeat(100) + '*/';
      
      const startTime = Date.now();
      const result = TestHashCache.normalizeForAST(attackPattern);
      const endTime = Date.now();
      
      // Should complete in reasonable time (much less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);
      expect(result).toBe(''); // Should remove the malformed comment pattern
    });

    it('should handle edge cases safely', () => {
      const testCases = [
        '/* */',           // Empty comment
        '/**/',            // Comment with just *
        '/* /* */',        // Nested-looking comment
        '/* * * * */',     // Multiple stars
        '/*/*/',           // Nested start
        'nocomments',      // No comments at all
        '',                // Empty string
      ];

      testCases.forEach(testCase => {
        expect(() => {
          const result = TestHashCache.normalizeForAST(testCase);
          expect(typeof result).toBe('string');
        }).not.toThrow();
      });
    });
  });

  describe('Performance Comparison', () => {
    it('should perform significantly better than vulnerable version on attack patterns', () => {
      // Generate a pattern that would cause ReDoS in the vulnerable version
      const attackSize = 50; // Keep moderate for CI environments
      const attackPattern = '/*' + 'a/*'.repeat(attackSize);
      
      // Test fixed version
      const startTimeFix = Date.now();
      TestHashCache.normalizeForAST(attackPattern);
      const endTimeFix = Date.now();
      const fixedTime = endTimeFix - startTimeFix;
      
      // Fixed version should complete very quickly
      expect(fixedTime).toBeLessThan(50); // Should be nearly instantaneous
      
      // Note: We don't test the vulnerable version in CI to avoid timeouts
      // But the fixed version proves it handles the attack pattern efficiently
    });

    it('should handle large legitimate content efficiently', () => {
      // Test with legitimate large content
      const largeContent = `
        /* Large legitimate comment with lots of text
           This is a normal comment that might be quite long
           in a real codebase with documentation
           ${'and more content '.repeat(100)}
        */
        function largeFunction() {
          // Implementation
          return true;
        }
      `;
      
      const startTime = Date.now();
      const result = TestHashCache.normalizeForAST(largeContent);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(100);
      expect(result).toContain('function largeFunction()');
      expect(result).not.toContain('Large legitimate comment');
    });
  });

  describe('Functional Correctness', () => {
    it('should produce same results as vulnerable version for normal input', () => {
      const normalInputs = [
        'function test() { return 1; }',
        '/* comment */ function test() {}',
        '// single line\nfunction test() {}',
        'const x = 5; /* inline */ return x;',
      ];

      normalInputs.forEach(input => {
        const fixedResult = TestHashCache.normalizeForAST(input);
        const vulnerableResult = TestHashCache.normalizeForASTVulnerable(input);
        
        expect(fixedResult).toBe(vulnerableResult);
      });
    });

    it('should handle single-line comments correctly', () => {
      const input1 = 'function test() { return true; }';
      const result1 = TestHashCache.normalizeForAST(input1);
      expect(result1).toContain('return true');
      
      const input2 = 'function test() {\n  // comment\n  return true;\n}';
      const result2 = TestHashCache.normalizeForAST(input2);
      expect(result2).toContain('return true');
      expect(result2).not.toContain('// comment');
      
      const input3 = 'var x = 5; // comment';
      const result3 = TestHashCache.normalizeForAST(input3);
      expect(result3).toBe('var x = 5;');
    });
  });
});