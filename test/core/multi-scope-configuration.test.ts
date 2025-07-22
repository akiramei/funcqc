import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager } from '../../src/core/config.js';
import { FuncqcConfig } from '../../src/types/index.js';
import { mockPGLiteForPathValidation, getSafeTestDbPath } from '../test-utils.js';

// Mock PGLite to prevent filesystem operations
mockPGLiteForPathValidation();

// Mock cosmiconfig to control configuration loading
vi.mock('cosmiconfig', () => ({
  cosmiconfigSync: vi.fn(() => ({
    search: vi.fn(),
    clearCaches: vi.fn(),
  })),
}));

describe('Multi-Scope Configuration', () => {
  let configManager: ConfigManager;
  let mockCosmiconfigSearch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { cosmiconfigSync } = vi.mocked(await import('cosmiconfig'));
    mockCosmiconfigSearch = vi.fn();
    cosmiconfigSync.mockReturnValue({
      search: mockCosmiconfigSearch,
      clearCaches: vi.fn(),
    });

    configManager = new ConfigManager();
  });

  afterEach(() => {
    configManager.clearCache();
    vi.clearAllMocks();
  });

  describe('Default Scope Configuration', () => {
    it('should provide default multi-scope configuration', async () => {
      // Mock no config file found
      mockCosmiconfigSearch.mockReturnValue(null);

      const config = await configManager.load();

      expect(config.scopes).toBeDefined();
      expect(config.scopes!.src).toBeDefined();
      expect(config.scopes!.test).toBeDefined();
      expect(config.scopes!.all).toBeDefined();
    });

    it('should have correct default src scope configuration', async () => {
      mockCosmiconfigSearch.mockReturnValue(null);

      const config = await configManager.load();
      const srcScope = config.scopes!.src;

      expect(srcScope.roots).toEqual(['src']);
      expect(srcScope.exclude).toContain('**/*.test.ts');
      expect(srcScope.exclude).toContain('**/*.spec.ts');
      expect(srcScope.exclude).toContain('**/__tests__/**');
      expect(srcScope.description).toBe('Production source code');
    });

    it('should have correct default test scope configuration', async () => {
      mockCosmiconfigSearch.mockReturnValue(null);

      const config = await configManager.load();
      const testScope = config.scopes!.test;

      expect(testScope.roots).toEqual(['test', 'tests', '__tests__', 'src/__tests__']);
      expect(testScope.include).toContain('**/*.test.ts');
      expect(testScope.include).toContain('**/*.spec.ts');
      expect(testScope.include).toContain('**/*.test.js');
      expect(testScope.include).toContain('**/*.spec.js');
      expect(testScope.exclude).toEqual([]);
      expect(testScope.description).toBe('Test code files');
    });

    it('should have correct default all scope configuration', async () => {
      mockCosmiconfigSearch.mockReturnValue(null);

      const config = await configManager.load();
      const allScope = config.scopes!.all;

      expect(allScope.roots).toEqual(['src', 'test', 'tests', '__tests__']);
      expect(allScope.exclude).toContain('**/node_modules/**');
      expect(allScope.exclude).toContain('**/dist/**');
      expect(allScope.exclude).toContain('**/build/**');
      expect(allScope.description).toBe('All source and test code');
    });
  });

  describe('Scope Resolution', () => {
    beforeEach(async () => {
      mockCosmiconfigSearch.mockReturnValue(null);
      await configManager.load();
    });

    it('should resolve src scope correctly', () => {
      const scopeConfig = configManager.resolveScopeConfig('src');

      expect(scopeConfig.roots).toEqual(['src']);
      expect(scopeConfig.exclude).toContain('**/*.test.ts');
      expect(scopeConfig.description).toBe('Production source code');
    });

    it('should resolve test scope correctly', () => {
      const scopeConfig = configManager.resolveScopeConfig('test');

      expect(scopeConfig.roots).toEqual(['test', 'tests', '__tests__', 'src/__tests__']);
      expect(scopeConfig.include).toContain('**/*.test.ts');
      expect(scopeConfig.exclude).toEqual([]);
      expect(scopeConfig.description).toBe('Test code files');
    });

    it('should resolve all scope correctly', () => {
      const scopeConfig = configManager.resolveScopeConfig('all');

      expect(scopeConfig.roots).toEqual(['src', 'test', 'tests', '__tests__']);
      expect(scopeConfig.exclude).toContain('**/node_modules/**');
      expect(scopeConfig.description).toBe('All source and test code');
    });

    it('should default to src scope when no scope specified', () => {
      const scopeConfig = configManager.resolveScopeConfig();

      expect(scopeConfig.roots).toEqual(['src']);
      expect(scopeConfig.description).toBe('Production source code');
    });

    it('should default to src scope for undefined scope', () => {
      const scopeConfig = configManager.resolveScopeConfig(undefined);

      expect(scopeConfig.roots).toEqual(['src']);
      expect(scopeConfig.description).toBe('Production source code');
    });
  });

  describe('Custom Scope Configuration', () => {
    it('should merge custom scope configurations', async () => {
      const customConfig: FuncqcConfig = {
        roots: ['src'],
        exclude: [],
        scopes: {
          custom: {
            roots: ['custom'],
            exclude: ['**/*.ignore.ts'],
            description: 'Custom scope'
          },
          // Override default src scope
          src: {
            roots: ['source'],
            exclude: ['**/*.test.ts'],
            description: 'Modified src scope'
          }
        },
        storage: { type: 'pglite', path: '.funcqc/test.db' },
        metrics: {
          complexityThreshold: 10,
          cognitiveComplexityThreshold: 15,
          linesOfCodeThreshold: 40,
          parameterCountThreshold: 4,
          maxNestingLevelThreshold: 3
        },
        git: { enabled: false, autoLabel: false }
      };

      mockCosmiconfigSearch.mockReturnValue({
        config: customConfig,
        filepath: '/test/.funcqcrc'
      });

      const config = await configManager.load();

      // Should have custom scope
      expect(config.scopes!.custom).toBeDefined();
      expect(config.scopes!.custom.roots).toEqual(['custom']);
      expect(config.scopes!.custom.exclude).toContain('**/*.ignore.ts');
      expect(config.scopes!.custom.description).toBe('Custom scope');

      // Should override default src scope
      expect(config.scopes!.src.roots).toEqual(['source']);
      expect(config.scopes!.src.description).toBe('Modified src scope');

      // Should keep default test and all scopes
      expect(config.scopes!.test).toBeDefined();
      expect(config.scopes!.all).toBeDefined();
    });

    it('should resolve custom scope configuration', async () => {
      const customConfig = {
        scopes: {
          frontend: {
            roots: ['src/frontend'],
            exclude: ['**/*.test.ts', '**/*.spec.ts'],
            include: ['**/*.tsx', '**/*.ts'],
            description: 'Frontend components'
          }
        }
      };

      mockCosmiconfigSearch.mockReturnValue({
        config: customConfig,
        filepath: '/test/.funcqcrc'
      });

      await configManager.load();

      const scopeConfig = configManager.resolveScopeConfig('frontend');

      expect(scopeConfig.roots).toEqual(['src/frontend']);
      expect(scopeConfig.exclude).toContain('**/*.test.ts');
      expect(scopeConfig.include).toContain('**/*.tsx');
      expect(scopeConfig.description).toBe('Frontend components');
    });
  });

  describe('Scope Validation and Error Handling', () => {
    beforeEach(async () => {
      mockCosmiconfigSearch.mockReturnValue(null);
      await configManager.load();
    });

    it('should throw error for unknown scope', () => {
      expect(() => {
        configManager.resolveScopeConfig('nonexistent');
      }).toThrow('Unknown scope: nonexistent');
    });

    it('should provide helpful error message with available scopes', () => {
      expect(() => {
        configManager.resolveScopeConfig('invalid');
      }).toThrow(/Available scopes.*src.*test.*all/);
    });

    it('should get available scopes', () => {
      const scopes = configManager.getAvailableScopes();

      expect(scopes).toContain('src');
      expect(scopes).toContain('test');
      expect(scopes).toContain('all');
      expect(scopes).toHaveLength(3);
    });

    it('should handle empty scopes configuration', async () => {
      const configWithoutScopes = { roots: ['src'], exclude: [] };
      
      mockCosmiconfigSearch.mockReturnValue({
        config: configWithoutScopes,
        filepath: '/test/.funcqcrc'
      });

      configManager.clearCache();
      await configManager.load();

      const scopes = configManager.getAvailableScopes();
      expect(scopes).toContain('src'); // Default fallback
    });
  });

  describe('Optional Properties Handling', () => {
    it('should handle scope without include property', () => {
      const scopeConfig = configManager.resolveScopeConfig('src');

      expect(scopeConfig.include).toBeUndefined();
      expect(scopeConfig.roots).toBeDefined();
      expect(scopeConfig.exclude).toBeDefined();
    });

    it('should handle scope without description property', async () => {
      const customConfig = {
        scopes: {
          minimal: {
            roots: ['minimal'],
            exclude: []
            // No description property
          }
        }
      };

      mockCosmiconfigSearch.mockReturnValue({
        config: customConfig,
        filepath: '/test/.funcqcrc'
      });

      configManager.clearCache();
      await configManager.load();

      const scopeConfig = configManager.resolveScopeConfig('minimal');

      expect(scopeConfig.description).toBeUndefined();
      expect(scopeConfig.roots).toEqual(['minimal']);
      expect(scopeConfig.exclude).toEqual([]);
    });

    it('should handle scope with all optional properties', async () => {
      const customConfig = {
        scopes: {
          complete: {
            roots: ['complete'],
            exclude: ['**/ignore/**'],
            include: ['**/*.complete.ts'],
            description: 'Complete scope configuration'
          }
        }
      };

      mockCosmiconfigSearch.mockReturnValue({
        config: customConfig,
        filepath: '/test/.funcqcrc'
      });

      configManager.clearCache();
      await configManager.load();

      const scopeConfig = configManager.resolveScopeConfig('complete');

      expect(scopeConfig.description).toBe('Complete scope configuration');
      expect(scopeConfig.include).toEqual(['**/*.complete.ts']);
      expect(scopeConfig.exclude).toEqual(['**/ignore/**']);
      expect(scopeConfig.roots).toEqual(['complete']);
    });
  });

  describe('Fallback Behavior', () => {
    it('should fallback to default config for src scope when scopes not defined', async () => {
      const configWithoutScopes = {
        roots: ['source'],
        exclude: ['**/custom.exclude.ts'],
        include: ['**/custom.include.ts']
      };

      mockCosmiconfigSearch.mockReturnValue({
        config: configWithoutScopes,
        filepath: '/test/.funcqcrc'
      });

      configManager.clearCache();
      await configManager.load();

      const scopeConfig = configManager.resolveScopeConfig('src');

      expect(scopeConfig.roots).toEqual(['source']);
      expect(scopeConfig.exclude).toEqual(['**/custom.exclude.ts']);
      expect(scopeConfig.include).toEqual(['**/custom.include.ts']);
      expect(scopeConfig.description).toBe('Default scope configuration');
    });

    it('should fallback to default config for default scope', async () => {
      const configWithoutScopes = {
        roots: ['source'],
        exclude: ['**/custom.exclude.ts']
      };

      mockCosmiconfigSearch.mockReturnValue({
        config: configWithoutScopes,
        filepath: '/test/.funcqcrc'
      });

      configManager.clearCache();
      await configManager.load();

      const scopeConfig = configManager.resolveScopeConfig('default');

      expect(scopeConfig.roots).toEqual(['source']);
      expect(scopeConfig.exclude).toEqual(['**/custom.exclude.ts']);
      expect(scopeConfig.description).toBe('Default scope configuration');
    });
  });

  describe('Cache Management', () => {
    it('should clear cache and reload configuration', async () => {
      // First load
      mockCosmiconfigSearch.mockReturnValue(null);
      const config1 = await configManager.load();
      expect(config1.scopes!.src.roots).toEqual(['src']);

      // Change mock return value
      const customConfig = {
        scopes: {
          src: {
            roots: ['modified-src'],
            exclude: [],
            description: 'Modified src'
          }
        }
      };

      mockCosmiconfigSearch.mockReturnValue({
        config: customConfig,
        filepath: '/test/.funcqcrc'
      });

      // Should still return cached config
      const config2 = await configManager.load();
      expect(config2.scopes!.src.roots).toEqual(['src']); // Still cached

      // Clear cache and reload
      configManager.clearCache();
      const config3 = await configManager.load();
      expect(config3.scopes!.src.roots).toEqual(['modified-src']); // New config
    });
  });

  describe('Scope Configuration Integration', () => {
    it('should maintain scope configuration integrity across operations', async () => {
      const complexConfig = {
        roots: ['main'],
        exclude: ['**/global.exclude.ts'],
        scopes: {
          frontend: {
            roots: ['src/frontend', 'src/components'],
            exclude: ['**/*.test.tsx', '**/*.stories.tsx'],
            include: ['**/*.tsx', '**/*.ts'],
            description: 'Frontend React components and logic'
          },
          backend: {
            roots: ['src/backend', 'src/api'],
            exclude: ['**/*.test.ts', '**/*.mock.ts'],
            include: ['**/*.service.ts', '**/*.controller.ts'],
            description: 'Backend services and API'
          },
          integration: {
            roots: ['tests/integration'],
            exclude: [],
            include: ['**/*.integration.test.ts'],
            description: 'Integration tests'
          }
        }
      };

      mockCosmiconfigSearch.mockReturnValue({
        config: complexConfig,
        filepath: '/test/.funcqcrc'
      });

      await configManager.load();

      // Test all scopes
      const frontendScope = configManager.resolveScopeConfig('frontend');
      expect(frontendScope.roots).toEqual(['src/frontend', 'src/components']);
      expect(frontendScope.include).toContain('**/*.tsx');

      const backendScope = configManager.resolveScopeConfig('backend');
      expect(backendScope.roots).toEqual(['src/backend', 'src/api']);
      expect(backendScope.include).toContain('**/*.service.ts');

      const integrationScope = configManager.resolveScopeConfig('integration');
      expect(integrationScope.roots).toEqual(['tests/integration']);
      expect(integrationScope.include).toContain('**/*.integration.test.ts');

      // Test available scopes
      const scopes = configManager.getAvailableScopes();
      expect(scopes).toContain('frontend');
      expect(scopes).toContain('backend');
      expect(scopes).toContain('integration');
      expect(scopes).toContain('src'); // Default scopes should still exist
      expect(scopes).toContain('test');
      expect(scopes).toContain('all');
    });
  });
});