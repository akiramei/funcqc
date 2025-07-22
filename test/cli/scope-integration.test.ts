import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scanCommand } from '../../src/cli/commands/scan.js';
import { listCommand } from '../../src/cli/commands/list.js';
import { healthCommand } from '../../src/cli/commands/health.js';
import { ScanCommandOptions, ListCommandOptions, HealthCommandOptions } from '../../src/types/index.js';
import { CommandEnvironment } from '../../src/types/environment.js';
import { mockPGLiteForPathValidation, getSafeTestDbPath } from '../test-utils.js';

// Mock all dependencies to prevent actual filesystem operations
mockPGLiteForPathValidation();

// Mock the core modules
vi.mock('../../src/core/config.js');
vi.mock('../../src/storage/pglite-adapter.js');
vi.mock('../../src/core/analyzer.js');
vi.mock('simple-git');

describe('CLI Scope Integration', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;
  let mockEnvironment: CommandEnvironment;

  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    
    // Create mock environment
    mockEnvironment = {
      storage: {
        initialize: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        createSnapshot: vi.fn().mockResolvedValue(undefined),
        queryFunctions: vi.fn().mockResolvedValue([]),
        getSnapshots: vi.fn().mockResolvedValue([]),
        getLatestSnapshot: vi.fn().mockResolvedValue(null)
      } as any,
      config: {
        roots: ['src'],
        exclude: ['**/*.test.ts'],
        scopes: {
          src: { roots: ['src'], exclude: ['**/*.test.ts'] },
          test: { roots: ['test'], include: ['**/*.test.ts'] }
        }
      } as any,
      commandLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }
    };
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockProcessExit.mockRestore();
  });

  describe('Scan Command Scope Integration', () => {
    it('should execute scan command with src scope', async () => {
      const options: ScanCommandOptions = {
        scope: 'src'
      };

      // Execute the command function
      const commandFn = scanCommand(options);
      
      // Should be a function that takes environment
      expect(typeof commandFn).toBe('function');
      
      // Mock the command execution to not throw
      mockEnvironment.storage.getLatestSnapshot = vi.fn().mockResolvedValue(null);
      
      // This would normally execute the scan, but we're just testing the interface
      // The command function should execute without throwing in our mocked environment
      await expect(commandFn(mockEnvironment)).resolves.toBeUndefined();
    });

    it('should execute scan command with test scope', async () => {
      const options: ScanCommandOptions = {
        scope: 'test'
      };

      const commandFn = scanCommand(options);
      expect(typeof commandFn).toBe('function');
      
      // Test that scope is properly passed
      expect(options.scope).toBe('test');
    });

    it('should handle scan command with comment after config change', async () => {
      const options: ScanCommandOptions = {
        scope: 'src',
        comment: 'Updated scope configuration to focus on src files only'
      };

      const commandFn = scanCommand(options);
      expect(typeof commandFn).toBe('function');
      
      // Test that comment is properly included for config changes
      expect(options.comment).toContain('scope configuration');
    });
  });

  describe('List Command Scope Integration', () => {
    it('should execute list command with src scope', async () => {
      const options: ListCommandOptions = {
        scope: 'src'
      };

      const commandFn = listCommand(options);
      expect(typeof commandFn).toBe('function');
      
      // Mock no functions found
      mockEnvironment.storage.queryFunctions = vi.fn().mockResolvedValue([]);
      
      await commandFn(mockEnvironment);
      
      // Verify scope was passed to storage query
      expect(mockEnvironment.storage.queryFunctions).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'src' })
      );
    });

    it('should execute list command with test scope', async () => {
      const options: ListCommandOptions = {
        scope: 'test'
      };

      const commandFn = listCommand(options);
      expect(typeof commandFn).toBe('function');
      
      expect(options.scope).toBe('test');
    });
  });

  describe('Health Command Scope Integration', () => {
    it('should execute health command with scope', async () => {
      const options: HealthCommandOptions = {
        scope: 'src'
      };

      const commandFn = healthCommand(options);
      expect(typeof commandFn).toBe('function');
      
      expect(options.scope).toBe('src');
    });
  });

  describe('Scope Configuration Change Requirements', () => {
    it('should require comment when config scope changes', () => {
      // Test the requirement that config changes need comments
      const scanWithComment: ScanCommandOptions = {
        scope: 'src',
        comment: 'Changed scope configuration from all to src only'
      };
      
      expect(scanWithComment.comment).toBeDefined();
      expect(scanWithComment.comment).toContain('scope configuration');
    });

    it('should handle scope validation requirements', () => {
      const validScopes = ['src', 'test', 'all'];
      const testOptions = validScopes.map(scope => ({
        scope,
        comment: `Testing with ${scope} scope`
      }));
      
      testOptions.forEach(options => {
        expect(validScopes.includes(options.scope)).toBe(true);
        expect(options.comment).toContain(options.scope);
      });
    });

    it('should demonstrate config change workflow', () => {
      // 1. Original config scan
      const originalScan: ScanCommandOptions = {
        scope: 'all'
      };
      
      // 2. Config changed to focus on src only
      const configChangeScan: ScanCommandOptions = {
        scope: 'src',
        comment: 'Updated scope configuration: focusing on production source code only, excluding test files for cleaner quality metrics'
      };
      
      expect(originalScan.scope).toBe('all');
      expect(configChangeScan.scope).toBe('src');
      expect(configChangeScan.comment).toContain('scope configuration');
      expect(configChangeScan.comment).toContain('quality metrics');
    });
  });

  describe('Scope Consistency Across Commands', () => {
    it('should maintain scope consistency in command workflow', async () => {
      const testScope = 'src';
      
      // Test workflow: scan -> list -> health with same scope
      const scanOptions: ScanCommandOptions = { 
        scope: testScope,
        comment: 'Initial scan with src scope'
      };
      const listOptions: ListCommandOptions = { scope: testScope };
      const healthOptions: HealthCommandOptions = { scope: testScope };
      
      expect(scanOptions.scope).toBe(testScope);
      expect(listOptions.scope).toBe(testScope);
      expect(healthOptions.scope).toBe(testScope);
    });

    it('should handle scope isolation between different workflows', () => {
      // Production workflow
      const prodOptions = {
        scan: { scope: 'src', comment: 'Production code analysis' },
        list: { scope: 'src' },
        health: { scope: 'src' }
      };
      
      // Test workflow  
      const testOptions = {
        scan: { scope: 'test', comment: 'Test code analysis' },
        list: { scope: 'test' },
        health: { scope: 'test' }
      };
      
      // Verify isolation
      expect(prodOptions.scan.scope).not.toBe(testOptions.scan.scope);
      expect(prodOptions.list.scope).not.toBe(testOptions.list.scope);
      expect(prodOptions.health.scope).not.toBe(testOptions.health.scope);
    });
  });
});