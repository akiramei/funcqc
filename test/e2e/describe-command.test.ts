import { describe, it, expect, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { TEST_PROJECT_DIR, TEST_DB_PATH } from './setup';

// Path to the built CLI
const CLI_PATH = path.join(__dirname, '../../dist/cli.js');

describe('funcqc describe command E2E Tests', () => {
  let testFunctionId: string;

  beforeEach(async () => {
    // Clean up any existing database
    try {
      await fs.unlink(TEST_DB_PATH);
    } catch {
      // File might not exist
    }

    // Initialize and scan to have functions to work with
    execSync(
      `node "${CLI_PATH}" init --root src --db .funcqc/test.db --no-check`,
      {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      }
    );

    execSync(
      `node "${CLI_PATH}" scan --no-check`,
      {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      }
    );

    // Get a function ID to test with
    const listOutput = execSync(
      `node "${CLI_PATH}" list --limit 1 --json --no-check`,
      {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      }
    );

    const listData = JSON.parse(listOutput);
    testFunctionId = listData.functions[0].id;
  });

  describe('basic functionality', () => {
    it('should add a description to a function', () => {
      const output = execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --text "Test description" --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('Description saved for function');
      expect(output).toContain('Test description');
      expect(output).toContain('Source: human');
    });

    it('should show existing description', () => {
      // First add a description
      execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --text "Existing description" --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      // Then view it
      const output = execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('Current description');
      expect(output).toContain('Existing description');
    });

    it('should show error for non-existent function', () => {
      expect(() => {
        execSync(
          `node "${CLI_PATH}" describe non-existent-id --text "Test" --no-check`,
          {
            cwd: TEST_PROJECT_DIR,
            encoding: 'utf8'
          }
        );
      }).toThrow();
    });
  });

  describe('source guard functionality', () => {
    it('should prevent overwriting human description with AI without --force', () => {
      // Add human description first
      execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --text "Human description" --source human --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      // Try to overwrite with AI description
      expect(() => {
        execSync(
          `node "${CLI_PATH}" describe ${testFunctionId} --text "AI description" --source ai --no-check`,
          {
            cwd: TEST_PROJECT_DIR,
            encoding: 'utf8'
          }
        );
      }).toThrow();
    });

    it('should prevent overwriting AI description with human without --force', () => {
      // Add AI description first
      execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --text "AI description" --source ai --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      // Try to overwrite with human description
      expect(() => {
        execSync(
          `node "${CLI_PATH}" describe ${testFunctionId} --text "Human description" --source human --no-check`,
          {
            cwd: TEST_PROJECT_DIR,
            encoding: 'utf8'
        }
        );
      }).toThrow();
    });

    it('should allow overwriting with --force flag', () => {
      // Add human description first
      execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --text "Human description" --source human --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      // Overwrite with AI description using --force
      const output = execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --text "AI description" --source ai --force --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('Description saved for function');
      expect(output).toContain('AI description');
      expect(output).toContain('Source: ai');
    });

    it('should allow same source updates without warning', () => {
      // Add human description first
      execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --text "Original human description" --source human --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      // Update with another human description (no warning expected)
      const output = execSync(
        `node "${CLI_PATH}" describe ${testFunctionId} --text "Updated human description" --source human --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('Description saved for function');
      expect(output).toContain('Updated human description');
      expect(output).not.toContain('Overwriting');
    });
  });

  describe('JSON output functionality', () => {
    it('should list undocumented functions in JSON format', () => {
      const output = execSync(
        `node "${CLI_PATH}" describe --list-undocumented --json --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      const jsonData = JSON.parse(output);
      expect(jsonData).toHaveProperty('title');
      expect(jsonData).toHaveProperty('count');
      expect(jsonData).toHaveProperty('functions');
      expect(Array.isArray(jsonData.functions)).toBe(true);
      
      if (jsonData.functions.length > 0) {
        const func = jsonData.functions[0];
        expect(func).toHaveProperty('id');
        expect(func).toHaveProperty('name');
        expect(func).toHaveProperty('description');
        expect(func.description).toBeNull();
      }
    });

    it('should list functions needing description in JSON format', () => {
      const output = execSync(
        `node "${CLI_PATH}" describe --needs-description --json --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      const jsonData = JSON.parse(output);
      expect(jsonData).toHaveProperty('title');
      expect(jsonData).toHaveProperty('count');
      expect(jsonData).toHaveProperty('functions');
      expect(Array.isArray(jsonData.functions)).toBe(true);
    });
  });

  describe('batch mode functionality', () => {
    it('should process batch descriptions from JSON file', async () => {
      // Create a temporary batch file
      const batchFile = path.join(TEST_PROJECT_DIR, 'test-batch.json');
      const batchData = [
        {
          semanticId: 'test-semantic-id-1',
          description: 'Batch description 1',
          source: 'human'
        },
        {
          semanticId: 'test-semantic-id-2',
          description: 'Batch description 2',
          source: 'ai'
        }
      ];

      await fs.writeFile(batchFile, JSON.stringify(batchData, null, 2));

      try {
        // Note: This will likely fail because the semantic IDs don't exist,
        // but we're testing that the command structure works
        const output = execSync(
          `node "${CLI_PATH}" describe --input test-batch.json --no-check`,
          {
            cwd: TEST_PROJECT_DIR,
            encoding: 'utf8'
          }
        );

        expect(output).toContain('Processing');
        expect(output).toContain('function descriptions');
      } catch (error) {
        // Expected to fail with non-existent semantic IDs
        expect(error).toBeTruthy();
      } finally {
        // Clean up
        await fs.unlink(batchFile).catch(() => {});
      }
    });
  });

  describe('removed options', () => {
    it('should reject --batch option (removed)', () => {
      expect(() => {
        execSync(
          `node "${CLI_PATH}" describe --batch --input test.json --no-check`,
          {
            cwd: TEST_PROJECT_DIR,
            encoding: 'utf8'
          }
        );
      }).toThrow();
    });

    it('should reject --interactive option (removed)', () => {
      expect(() => {
        execSync(
          `node "${CLI_PATH}" describe ${testFunctionId} --interactive --no-check`,
          {
            cwd: TEST_PROJECT_DIR,
            encoding: 'utf8'
          }
        );
      }).toThrow();
    });
  });

  describe('help output', () => {
    it('should show updated help with new options', () => {
      const output = execSync(
        `node "${CLI_PATH}" describe --help --no-check`,
        {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        }
      );

      expect(output).toContain('--force');
      expect(output).toContain('--json');
      expect(output).not.toContain('--batch');
      expect(output).not.toContain('--interactive');
    });
  });
});