import { describe, it, expect, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { TEST_PROJECT_DIR, TEST_DB_PATH } from './setup';

// Path to the built CLI
const CLI_PATH = path.join(__dirname, '../../dist/cli.js');

describe('funcqc show command E2E Tests', () => {
  let functionId: string;
  
  beforeEach(async () => {
    // Clean up any existing database
    try {
      await fs.unlink(TEST_DB_PATH);
    } catch {
      // File might not exist
    }

    // Initialize and scan to have data
    execSync(`node "${CLI_PATH}" init --root src --db .funcqc/test.db --no-check`, {
      cwd: TEST_PROJECT_DIR,
      encoding: 'utf8'
    });

    execSync(`node "${CLI_PATH}" scan --no-check`, {
      cwd: TEST_PROJECT_DIR,
      encoding: 'utf8'
    });

    // Get a function ID for testing
    const listOutput = execSync(`node "${CLI_PATH}" list --limit 1 --json --no-check`, {
      cwd: TEST_PROJECT_DIR,
      encoding: 'utf8'
    });
    
    const listData = JSON.parse(listOutput);
    functionId = listData.functions[0]?.id;
    
    if (!functionId) {
      throw new Error('No functions found for testing');
    }
  });

  describe('basic show functionality', () => {
    it('should show function details by ID', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      expect(output).toContain('Function:');
      expect(output).toContain(`ID: ${functionId}`);
      expect(output).toContain('Location:');
      expect(output).toContain('Signature:');
    });

    it('should output JSON format', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --json --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      const data = JSON.parse(output);
      expect(data.id).toBe(functionId);
      expect(data).toHaveProperty('name');
      expect(data).toHaveProperty('displayName');
      expect(data).toHaveProperty('signature');
      expect(data).toHaveProperty('file');
      expect(data).toHaveProperty('attributes');
      expect(data).toHaveProperty('structuredData');
    });
  });

  describe('audience-specific display modes', () => {
    it('should display user-focused information with --for-users', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --for-users --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      // Should contain user-friendly information
      expect(output).toContain('📍'); // Location emoji
      expect(output).toContain('Parameters'); // Always show for users
      
      // Should NOT contain technical metrics or IDs
      expect(output).not.toContain('Quality Metrics:');
      expect(output).not.toContain('Technical Information:');
      expect(output).not.toContain('Hash:');
    });

    it('should display maintainer-focused information with --for-maintainers', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --for-maintainers --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      // Should contain technical information
      expect(output).toContain('Quality Metrics:');
      expect(output).toContain('Technical Information:');
      expect(output).toContain(`ID: ${functionId}`);
      
      // Should contain quality warnings/status
      expect(output).toMatch(/Quality (Warnings|Status):/);
    });
  });

  describe('specialized sections', () => {
    it('should display usage information with --usage', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --usage --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      expect(output).toContain('Usage Information for');
      expect(output).toContain('Parameters');
      expect(output).toContain('Function Type:');
    });

    it('should display examples information with --examples', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --examples --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      expect(output).toContain('Examples for');
      expect(output).toContain('Parameters');
    });
  });

  describe('existing functionality preservation', () => {
    it('should still work with --details flag', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --details --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      expect(output).toContain('Function:');
      expect(output).toContain('Parameters');
      expect(output).toContain('Context:');
    });

    it('should still work with --quality flag', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --quality --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      expect(output).toContain('Function:');
      expect(output).toContain('Quality Metrics:');
      expect(output).toContain('Complexity:');
    });

    it('should still work with --technical flag', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --technical --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      expect(output).toContain('Function:');
      expect(output).toContain('Technical Information:');
      expect(output).toContain('Hash:');
    });

    it('should still work with --full flag', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --full --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      expect(output).toContain('Function:');
      expect(output).toContain('Parameters');
      expect(output).toContain('Quality Metrics:');
      expect(output).toContain('Technical Information:');
    });
  });

  describe('JSON output enhancements', () => {
    it('should include structured data in JSON output', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --json --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      const data = JSON.parse(output);
      
      expect(data).toHaveProperty('structuredData');
      expect(data.structuredData).toHaveProperty('usageExamples');
      expect(data.structuredData).toHaveProperty('sideEffects');
      expect(data.structuredData).toHaveProperty('errorConditions');
      expect(data.structuredData).toHaveProperty('userFriendlyAttributes');
      
      expect(Array.isArray(data.structuredData.usageExamples)).toBe(true);
      expect(Array.isArray(data.structuredData.sideEffects)).toBe(true);
      expect(Array.isArray(data.structuredData.errorConditions)).toBe(true);
      expect(Array.isArray(data.structuredData.userFriendlyAttributes)).toBe(true);
    });

    it('should include enhanced documentation structure in JSON output', () => {
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --json --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      const data = JSON.parse(output);
      
      expect(data).toHaveProperty('documentation');
      expect(data.documentation).toHaveProperty('description');
      expect(data.documentation).toHaveProperty('jsDoc');
      expect(data.documentation).toHaveProperty('source');
      expect(data.documentation).toHaveProperty('updatedAt');
    });
  });

  describe('error handling', () => {
    it('should handle invalid function ID gracefully', () => {
      expect(() => {
        execSync(`node "${CLI_PATH}" show --id "invalid-id" --no-check`, {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        });
      }).toThrow();
    });

    it('should handle missing function name pattern gracefully', () => {
      expect(() => {
        execSync(`node "${CLI_PATH}" show "nonexistent-function" --no-check`, {
          cwd: TEST_PROJECT_DIR,
          encoding: 'utf8'
        });
      }).toThrow();
    });
  });

  describe('flag combinations', () => {
    it('should prioritize audience-specific flags over generic flags', () => {
      // --for-users should override --quality
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --for-users --quality --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      // Should show user format, not quality metrics
      expect(output).toContain('📍');
      expect(output).not.toContain('Quality Metrics:');
    });

    it('should prioritize specialized sections over audience flags', () => {
      // --usage should override --for-maintainers
      const output = execSync(`node "${CLI_PATH}" show --id "${functionId}" --usage --for-maintainers --no-check`, {
        cwd: TEST_PROJECT_DIR,
        encoding: 'utf8'
      });

      // Should show usage format
      expect(output).toContain('Usage Information for');
      expect(output).not.toContain('Quality Metrics:');
    });
  });
});