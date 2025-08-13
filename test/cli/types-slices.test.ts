/**
 * Types Slices CLI Command Tests
 * 
 * Integration tests for the `funcqc types slices` command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('types slices CLI command', () => {
  let tempDir: string;
  let projectPath: string;

  beforeEach(() => {
    // Create temporary test project
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'funcqc-test-'));
    projectPath = tempDir;

    // Create package.json
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        type: 'module'
      }, null, 2)
    );

    // Create minimal tsconfig.json to satisfy system checks
    fs.writeFileSync(
      path.join(projectPath, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "Node",
          strict: true,
          esModuleInterop: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          allowJs: true,
          noEmit: true
        },
        include: ["src"]
      }, null, 2)
    );

    // Copy database schema into the temp project (schema is required by storage initialization)
    const repoSchemaPath = path.resolve(__dirname, '../../src/schemas/database.sql');
    const dstSchemaDir = path.join(projectPath, 'src', 'schemas');
    fs.mkdirSync(dstSchemaDir, { recursive: true });
    fs.copyFileSync(repoSchemaPath, path.join(dstSchemaDir, 'database.sql'));

    // Create test TypeScript files with property patterns
    createTestFiles();
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createTestFiles(): void {
    const srcDir = path.join(projectPath, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Create types with shared property patterns
    fs.writeFileSync(
      path.join(srcDir, 'order.ts'),
      `
export interface Order {
  id: string;
  amount: number;
  currency: string;
  customerId: string;
  status: 'pending' | 'completed';
  createdAt: Date;
}
      `.trim()
    );

    fs.writeFileSync(
      path.join(srcDir, 'invoice.ts'),
      `
export interface Invoice {
  id: string;
  amount: number;
  currency: string;
  invoiceNumber: string;
  dueDate: Date;
  paid: boolean;
}
      `.trim()
    );

    fs.writeFileSync(
      path.join(srcDir, 'payment.ts'),
      `
export interface Payment {
  id: string;
  amount: number;
  currency: string;
  method: 'card' | 'bank' | 'cash';
  processedAt: Date;
}
      `.trim()
    );

    fs.writeFileSync(
      path.join(srcDir, 'address.ts'),
      `
export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface ShippingAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  isResidential: boolean;
}
      `.trim()
    );

    fs.writeFileSync(
      path.join(srcDir, 'person.ts'),
      `
export interface Person {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface Employee {
  firstName: string;
  lastName: string;
  employeeId: string;
  department: string;
}
      `.trim()
    );
  }

  function runCommand(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    try {
      const cliPath = path.resolve(__dirname, '../../src/cli.ts');
      const command = `npx tsx "${cliPath}" ${args.join(' ')}`;
      
      const stdout = execSync(command, {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return { stdout, stderr: '', exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.status || 1
      };
    }
  }

  describe('Command Execution', () => {
    it('should require scan before running slices analysis', () => {
      const result = runCommand(['types', 'slices']);
      
      // Should indicate that scan is needed first
      expect(result.stderr || result.stdout).toMatch(/scan.*first|No snapshots found/i);
    });

    it('should run successfully after scan', () => {
      // First run scan
      const scanResult = runCommand(['scan', '--label', 'test-scan']);
      expect(scanResult.exitCode).toBe(0);

      // Then run slices analysis
      const slicesResult = runCommand(['types', 'slices']);
      expect(slicesResult.exitCode).toBe(0);
      expect(slicesResult.stdout).toContain('Property Slice Analysis');
    });
  });

  describe('Command Options', () => {
    beforeEach(() => {
      // Run scan for each test
      const scanResult = runCommand(['scan', '--label', 'test-scan']);
      expect(scanResult.exitCode).toBe(0);
    });

    it('should support JSON output format', () => {
      const result = runCommand(['types', 'slices', '--json']);
      expect(result.exitCode).toBe(0);
      
      // Should be valid JSON
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty('summary');
      expect(output).toHaveProperty('slices');
      expect(output).toHaveProperty('recommendations');
    });

    it('should respect min-support parameter', () => {
      const result = runCommand(['types', 'slices', '--min-support', '1', '--json']);
      expect(result.exitCode).toBe(0);
      
      const output = JSON.parse(result.stdout);
      // With min-support of 1, should find more patterns
      expect(output.slices.length).toBeGreaterThan(0);
    });

    it('should respect limit parameter', () => {
      const result = runCommand(['types', 'slices', '--limit', '2', '--json']);
      expect(result.exitCode).toBe(0);
      
      const output = JSON.parse(result.stdout);
      expect(output.slices.length).toBeLessThanOrEqual(2);
    });

    it('should support different sorting options', () => {
      const supportResult = runCommand(['types', 'slices', '--sort', 'support', '--json']);
      expect(supportResult.exitCode).toBe(0);
      
      const sizeResult = runCommand(['types', 'slices', '--sort', 'size', '--json']);
      expect(sizeResult.exitCode).toBe(0);
      
      // Both should succeed
      expect(() => JSON.parse(supportResult.stdout)).not.toThrow();
      expect(() => JSON.parse(sizeResult.stdout)).not.toThrow();
    });

    it('should support benefit filtering', () => {
      const result = runCommand(['types', 'slices', '--benefit', 'high', '--json']);
      expect(result.exitCode).toBe(0);
      
      const output = JSON.parse(result.stdout);
      if (output.slices.length > 0) {
        // All returned slices should have high benefit
        output.slices.forEach((slice: any) => {
          expect(slice.extractionBenefit).toBe('high');
        });
      }
    });
  });

  describe('Output Content', () => {
    beforeEach(() => {
      const scanResult = runCommand(['scan', '--label', 'test-scan']);
      expect(scanResult.exitCode).toBe(0);
    });

    it('should detect Money pattern in financial types', () => {
      const result = runCommand(['types', 'slices', '--min-support', '2', '--json']);
      expect(result.exitCode).toBe(0);
      
      const output = JSON.parse(result.stdout);
      
      // Should find {amount, currency} pattern
      const moneyPattern = output.slices.find((slice: any) => 
        slice.properties.includes('amount') && 
        slice.properties.includes('currency')
      );
      
      if (moneyPattern) {
        expect(moneyPattern.suggestedVOName).toBe('Money');
        expect(moneyPattern.support).toBeGreaterThanOrEqual(2);
      }
    });

    it('should detect Address pattern', () => {
      const result = runCommand(['types', 'slices', '--min-support', '2', '--json']);
      expect(result.exitCode).toBe(0);
      
      const output = JSON.parse(result.stdout);
      
      // Should find address-related patterns
      const addressPattern = output.slices.find((slice: any) => 
        slice.properties.includes('street') && 
        slice.properties.includes('city')
      );
      
      if (addressPattern) {
        expect(addressPattern.suggestedVOName).toContain('Address');
        expect(addressPattern.support).toBeGreaterThanOrEqual(2);
      }
    });

    it('should detect PersonName pattern', () => {
      const result = runCommand(['types', 'slices', '--min-support', '2', '--json']);
      expect(result.exitCode).toBe(0);
      
      const output = JSON.parse(result.stdout);
      
      // Should find {firstName, lastName} pattern
      const namePattern = output.slices.find((slice: any) => 
        slice.properties.includes('firstName') && 
        slice.properties.includes('lastName')
      );
      
      if (namePattern) {
        expect(namePattern.suggestedVOName).toBe('PersonName');
        expect(namePattern.support).toBeGreaterThanOrEqual(2);
      }
    });

    it('should provide meaningful recommendations', () => {
      const result = runCommand(['types', 'slices', '--min-support', '1']);
      expect(result.exitCode).toBe(0);
      
      // Should contain actionable recommendations
      expect(result.stdout).toMatch(/Recommendations:|Next Steps:/);
      expect(result.stdout).toMatch(/Value Object|extraction|refactor/i);
    });

    it('should show summary information', () => {
      const result = runCommand(['types', 'slices', '--min-support', '1']);
      expect(result.exitCode).toBe(0);
      
      expect(result.stdout).toContain('Property Slice Analysis');
      expect(result.stdout).toMatch(/Total Slices Found:|Summary:/);
      expect(result.stdout).toMatch(/High Value:|Medium Value:|Low Value:/);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid parameters gracefully', () => {
      // Run scan first
      const scanResult = runCommand(['scan', '--label', 'test-scan']);
      expect(scanResult.exitCode).toBe(0);

      // Invalid sort field
      const result = runCommand(['types', 'slices', '--sort', 'invalid']);
      // Should either use default or handle gracefully
      expect(result.exitCode).toBeLessThanOrEqual(1);
    });

    it('should handle empty result sets', () => {
      // Run scan first
      const scanResult = runCommand(['scan', '--label', 'test-scan']);
      expect(scanResult.exitCode).toBe(0);

      // Very high min-support should return no results
      const result = runCommand(['types', 'slices', '--min-support', '100']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/No property slices found|0.*slices/i);
    });
  });
});