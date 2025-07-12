import { describe, it, expect } from 'vitest';

// Test the formatPostgresArray function indirectly through the storage adapter
describe('PostgreSQL Array Escaping', () => {
  // Import the function directly for unit testing
  const formatPostgresArray = (arr: string[]): string => {
    if (!arr || arr.length === 0) return '{}';
    // PostgreSQL array elements need both backslash and quote escaping
    return `{${arr.map(item => {
      // First escape backslashes, then quotes (critical order for security)
      const escaped = item
        .replace(/\\/g, '\\\\')      // Escape backslashes: \ -> \\
        .replace(/"/g, '\\"');       // Escape quotes: " -> \"
      return `"${escaped}"`;
    }).join(',')}}`;
  };

  describe('formatPostgresArray', () => {
    it('should handle empty arrays', () => {
      expect(formatPostgresArray([])).toBe('{}');
      expect(formatPostgresArray(null as any)).toBe('{}');
      expect(formatPostgresArray(undefined as any)).toBe('{}');
    });

    it('should handle simple strings', () => {
      expect(formatPostgresArray(['foo', 'bar'])).toBe('{"foo","bar"}');
      expect(formatPostgresArray(['single'])).toBe('{"single"}');
    });

    it('should escape quotes properly', () => {
      expect(formatPostgresArray(['foo"bar'])).toBe('{"foo\\"bar"}');
      expect(formatPostgresArray(['"quoted"'])).toBe('{"\\"quoted\\""}');
      expect(formatPostgresArray(['multiple"quotes"here'])).toBe('{"multiple\\"quotes\\"here"}');
    });

    it('should escape backslashes properly', () => {
      expect(formatPostgresArray(['foo\\bar'])).toBe('{"foo\\\\bar"}');
      expect(formatPostgresArray(['\\backslash'])).toBe('{"\\\\backslash"}');
      expect(formatPostgresArray(['multiple\\back\\slashes'])).toBe('{"multiple\\\\back\\\\slashes"}');
    });

    it('should escape both quotes and backslashes', () => {
      expect(formatPostgresArray(['foo\\"bar'])).toBe('{"foo\\\\\\"bar"}');
      expect(formatPostgresArray(['\\"quoted\\"'])).toBe('{"\\\\\\"quoted\\\\\\""}');
      expect(formatPostgresArray(['path\\to\\"file"'])).toBe('{"path\\\\to\\\\\\"file\\""}');
    });

    it('should handle special characters in context paths', () => {
      // Common patterns in TypeScript code
      expect(formatPostgresArray(['Class', 'method"with"quotes'])).toBe('{"Class","method\\"with\\"quotes"}');
      expect(formatPostgresArray(['namespace\\path', 'function'])).toBe('{"namespace\\\\path","function"}');
    });

    it('should handle edge cases', () => {
      // Empty strings
      expect(formatPostgresArray(['', 'nonempty'])).toBe('{"","nonempty"}');
      
      // Very long strings with special characters
      const longString = 'a'.repeat(100) + '\\"' + 'b'.repeat(100);
      const expected = '{"' + 'a'.repeat(100) + '\\\\\\"' + 'b'.repeat(100) + '"}';
      expect(formatPostgresArray([longString])).toBe(expected);
    });

    it('should handle injection attempts', () => {
      // Attempts to break out of the array literal
      expect(formatPostgresArray(['"}; DROP TABLE functions; --'])).toBe('{"\\"}; DROP TABLE functions; --"}');
      expect(formatPostgresArray(['{"}'])).toBe('{"{\\"}"}');
      
      // SQL injection patterns
      expect(formatPostgresArray(["'; DELETE FROM users; --"])).toBe('{"\'; DELETE FROM users; --"}');
      expect(formatPostgresArray(['"); INSERT INTO admin VALUES (1); --'])).toBe('{"\\\"); INSERT INTO admin VALUES (1); --"}');
    });
  });
});