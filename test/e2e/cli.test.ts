import { describe, it, expect, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { TEST_PROJECT_DIR, TEST_DB_PATH } from './setup';

// Path to the built CLI
const CLI_PATH = path.join(__dirname, '../../dist/cli.js');

describe('funcqc CLI E2E Tests', () => {
  beforeEach(async () => {
    // Clean up any existing database
    try {
      await fs.unlink(TEST_DB_PATH);
    } catch {
      // File might not exist
    }
  });

  describe('init command', () => {
    it('should initialize funcqc in a project', () => {
      const output = execSync(
        `node "${CLI_PATH}" init --root src --db .funcqc/test.db`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('funcqc initialized successfully');
    });

    it('should show existing configuration', () => {
      const output = execSync(
        `node "${CLI_PATH}" init --show`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('Current configuration');
    });
  });

  describe('scan command', () => {
    it('should scan TypeScript files and analyze functions', () => {
      const output = execSync(
        `node "${CLI_PATH}" scan --label "test-scan"`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('Scan completed successfully');
      expect(output).toContain('functions from');
      expect(output).toContain('files');
    });

    it('should perform dry run without saving to database', () => {
      const output = execSync(
        `node "${CLI_PATH}" scan --dry-run`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('Dry run mode');
      expect(output).toContain('results not saved');
    });
  });

  describe('list command', () => {
    beforeEach(() => {
      // Ensure we have data to list
      execSync(
        `node "${CLI_PATH}" scan --label "test-data"`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );
    });

    it('should list all functions', () => {
      const output = execSync(
        `node "${CLI_PATH}" list`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('add');
      expect(output).toContain('multiply');
      expect(output).toContain('fetchData');
    });

    it('should filter functions by name pattern', () => {
      const output = execSync(
        `node "${CLI_PATH}" list --name "add*"`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('add');
      expect(output).not.toContain('multiply');
    });

    it('should filter functions by exported status', () => {
      const output = execSync(
        `node "${CLI_PATH}" list --exported`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('add');
      expect(output).toContain('multiply');
    });

    it('should filter functions by async status', () => {
      const output = execSync(
        `node "${CLI_PATH}" list --async`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('fetchData');
    });

    it('should filter functions by complexity', () => {
      const output = execSync(
        `node "${CLI_PATH}" list --complexity ">5"`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('complexFunction');
    });

    it('should output functions in JSON format', () => {
      const output = execSync(
        `node "${CLI_PATH}" list --json`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('meta');
      expect(parsed).toHaveProperty('functions');
      expect(Array.isArray(parsed.functions)).toBe(true);
    });

    it('should limit number of results', () => {
      const output = execSync(
        `node "${CLI_PATH}" list --limit 2 --json`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      const parsed = JSON.parse(output);
      expect(parsed.functions.length).toBeLessThanOrEqual(2);
    });
  });

  describe('status command', () => {
    beforeEach(() => {
      // Ensure we have data for status
      execSync(
        `node "${CLI_PATH}" scan --label "status-test"`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );
    });

    it('should show project status', () => {
      const output = execSync(
        `node "${CLI_PATH}" status`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('funcqc Status');
      expect(output).toContain('Configuration');
      expect(output).toContain('Database Status');
    });

    it('should show verbose status information', () => {
      const output = execSync(
        `node "${CLI_PATH}" status --verbose`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('Recent snapshots');
      expect(output).toContain('Complexity distribution');
    });
  });

  describe('error handling', () => {
    it('should handle invalid commands gracefully', () => {
      try {
        execSync(
          `node "${CLI_PATH}" invalid-command`,
          {
            cwd: TEST_PROJECT_DIR,
            encoding: 'utf8'
          }
        );
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect((error as any).status).toBe(1);
      }
    });

    it('should handle missing configuration gracefully', () => {
      // Remove config file
      const configPath = path.join(TEST_PROJECT_DIR, '.funcqc.config.js');
      try {
        execSync(`rm "${configPath}"`, { cwd: TEST_PROJECT_DIR });
      } catch {
        // File might not exist
      }

      const output = execSync(
        `node "${CLI_PATH}" status`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      // Should use default configuration
      expect(output).toContain('Configuration');
    });
  });


  describe('workflow integration', () => {
    it('should support complete analysis workflow', () => {
      // Initialize
      const initOutput = execSync(
        `node "${CLI_PATH}" init --root src`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );
      expect(initOutput).toContain('initialized successfully');

      // Scan
      const scanOutput = execSync(
        `node "${CLI_PATH}" scan --label "workflow-test"`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );
      expect(scanOutput).toContain('Scan completed');

      // List
      const listOutput = execSync(
        `node "${CLI_PATH}" list --json`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );
      const listData = JSON.parse(listOutput);
      expect(listData.functions.length).toBeGreaterThan(0);


      // Status
      const statusOutput = execSync(
        `node "${CLI_PATH}" status`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );
      expect(statusOutput).toContain('Latest scan');
    });
  });
});
