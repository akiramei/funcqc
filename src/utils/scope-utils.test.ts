import { describe, test, expect } from 'vitest';
import { isPathInScope, getScopePathPatterns, buildScopeWhereClause, filterPathsByScope } from './scope-utils';
import { ScopeConfig } from '../types';

describe('scope-utils', () => {
  describe('getScopePathPatterns', () => {
    test('should extract patterns from scope config', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['src', 'lib'],
        exclude: ['**/*.test.ts', '**/*.spec.ts'],
        include: ['**/*.ts', '**/*.js'],
        description: 'Test scope'
      };

      const patterns = getScopePathPatterns(scopeConfig);

      expect(patterns.roots).toEqual(['src', 'lib']);
      expect(patterns.exclude).toEqual(['**/*.test.ts', '**/*.spec.ts']);
      expect(patterns.include).toEqual(['**/*.ts', '**/*.js']);
    });

    test('should handle undefined patterns', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['src'],
        description: 'Test scope'
      };

      const patterns = getScopePathPatterns(scopeConfig);

      expect(patterns.roots).toEqual(['src']);
      expect(patterns.exclude).toEqual([]);
      expect(patterns.include).toEqual([]);
    });
  });

  describe('isPathInScope', () => {
    test('should return true for path within src scope', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['src'],
        exclude: ['**/*.test.ts'],
        description: 'Source code'
      };

      expect(isPathInScope('src/utils/helper.ts', scopeConfig)).toBe(true);
      expect(isPathInScope('src/components/Button.tsx', scopeConfig)).toBe(true);
    });

    test('should return false for excluded path', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['src'],
        exclude: ['**/*.test.ts'],
        description: 'Source code'
      };

      expect(isPathInScope('src/utils/helper.test.ts', scopeConfig)).toBe(false);
    });

    test('should return false for path outside roots', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['src'],
        description: 'Source code'
      };

      expect(isPathInScope('test/unit/helper.test.ts', scopeConfig)).toBe(false);
      expect(isPathInScope('docs/readme.md', scopeConfig)).toBe(false);
    });

    test('should handle include patterns correctly', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['test'],
        include: ['**/*.test.ts', '**/*.spec.ts'],
        description: 'Test files'
      };

      expect(isPathInScope('test/unit/helper.test.ts', scopeConfig)).toBe(true);
      expect(isPathInScope('test/integration/api.spec.ts', scopeConfig)).toBe(true);
      expect(isPathInScope('test/utils/helper.ts', scopeConfig)).toBe(false);
    });

    test('should handle multiple roots', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['src', 'lib'],
        description: 'All source'
      };

      expect(isPathInScope('src/utils/helper.ts', scopeConfig)).toBe(true);
      expect(isPathInScope('lib/vendor/module.js', scopeConfig)).toBe(true);
      expect(isPathInScope('test/helper.test.ts', scopeConfig)).toBe(false);
    });
  });

  describe('buildScopeWhereClause', () => {
    test('should build WHERE clause for simple scope', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['src'],
        exclude: ['**/*.test.ts'],
        description: 'Source code'
      };

      const result = buildScopeWhereClause(scopeConfig, 'file_path', 0);

      expect(result.whereClause).toContain('file_path LIKE');
      expect(result.whereClause).toContain('file_path NOT LIKE');
      expect(result.params).toContain('src/%');
      expect(result.params).toContain('%/%.test.ts');
    });

    test('should handle multiple roots', () => {
      const scopeConfig: ScopeConfig = {
        roots: ['src', 'lib'],
        description: 'All source'
      };

      const result = buildScopeWhereClause(scopeConfig, 'file_path', 0);

      expect(result.params).toContain('src/%');
      expect(result.params).toContain('lib/%');
      expect(result.params).toContain('src');
      expect(result.params).toContain('lib');
    });

    test('should return default clause for empty scope', () => {
      const scopeConfig: ScopeConfig = {
        roots: [],
        description: 'Empty scope'
      };

      const result = buildScopeWhereClause(scopeConfig, 'file_path', 0);

      expect(result.whereClause).toBe('1=1');
      expect(result.params).toEqual([]);
    });
  });

  describe('filterPathsByScope', () => {
    test('should filter paths by scope', () => {
      const paths = [
        'src/utils/helper.ts',
        'src/components/Button.tsx',
        'src/utils/helper.test.ts',
        'test/integration/api.test.ts',
        'docs/readme.md'
      ];

      const scopeConfig: ScopeConfig = {
        roots: ['src'],
        exclude: ['**/*.test.ts'],
        description: 'Source code'
      };

      const filtered = filterPathsByScope(paths, scopeConfig);

      expect(filtered).toEqual([
        'src/utils/helper.ts',
        'src/components/Button.tsx'
      ]);
    });

    test('should return all paths when no exclusions', () => {
      const paths = [
        'src/utils/helper.ts',
        'src/components/Button.tsx'
      ];

      const scopeConfig: ScopeConfig = {
        roots: ['src'],
        description: 'Source code'
      };

      const filtered = filterPathsByScope(paths, scopeConfig);

      expect(filtered).toEqual(paths);
    });
  });
});