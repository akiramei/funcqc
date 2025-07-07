import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('history --id command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Save current directory
    originalCwd = process.cwd();
    
    // Create temporary directory
    tempDir = path.join(tmpdir(), `funcqc-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    
    // Create test TypeScript file
    const testFile = `
export function testFunction(a: number, b: number): number {
  if (a > b) {
    return a - b;
  } else if (a < b) {
    return b - a;
  } else {
    return 0;
  }
}

export function anotherFunction(): void {
  console.log('test');
}
`;
    writeFileSync(path.join(tempDir, 'test.ts'), testFile);
    
    // Change to temp directory
    process.chdir(tempDir);
    
    // Initialize funcqc
    execSync('npx funcqc init', { encoding: 'utf8' });
  });

  afterEach(() => {
    // Change back to original directory
    process.chdir(originalCwd);
    
    // Clean up
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should show function history with default formatting', () => {
    // Run initial scan
    execSync('npx funcqc scan', { encoding: 'utf8' });
    
    // Get function list to find ID
    const listOutput = execSync('npx funcqc list --json', { encoding: 'utf8' });
    const functions = JSON.parse(listOutput).functions;
    const testFunc = functions.find((f: any) => f.name === 'testFunction');
    expect(testFunc).toBeDefined();
    
    // Run history command
    const output = execSync(`npx funcqc history --id ${testFunc.id.substring(0, 8)}`, { encoding: 'utf8' });
    
    // Check output format
    expect(output).toContain('Function History: testFunction');
    expect(output).toContain('Commit   Date        Branch');
    expect(output).not.toContain('snap_'); // Should not show internal snapshot ID
    expect(output).toContain('Function Summary:');
    expect(output).toContain('Presence: 1/1 snapshots');
  });

  it('should output JSON format when --json is used', () => {
    // Run initial scan
    execSync('npx funcqc scan', { encoding: 'utf8' });
    
    // Get function list to find ID
    const listOutput = execSync('npx funcqc list --json', { encoding: 'utf8' });
    const functions = JSON.parse(listOutput).functions;
    const testFunc = functions.find((f: any) => f.name === 'testFunction');
    
    // Run history command with JSON output
    const output = execSync(`npx funcqc history --id ${testFunc.id} --json`, { encoding: 'utf8' });
    const historyData = JSON.parse(output);
    
    // Check JSON structure
    expect(historyData).toHaveProperty('functionId');
    expect(historyData).toHaveProperty('functionName', 'testFunction');
    expect(historyData).toHaveProperty('snapshots');
    expect(historyData).toHaveProperty('summary');
    
    expect(historyData.snapshots).toBeInstanceOf(Array);
    expect(historyData.snapshots.length).toBeGreaterThan(0);
    
    const firstSnapshot = historyData.snapshots[0];
    expect(firstSnapshot).toHaveProperty('commitId');
    expect(firstSnapshot).toHaveProperty('timestamp');
    expect(firstSnapshot).toHaveProperty('branch');
    expect(firstSnapshot).toHaveProperty('complexity');
    expect(firstSnapshot).toHaveProperty('linesOfCode');
    expect(firstSnapshot).toHaveProperty('exists', true);
  });

  it('should handle non-existent function ID gracefully', () => {
    // Run initial scan
    execSync('npx funcqc scan', { encoding: 'utf8' });
    
    // Run history command with non-existent ID
    const output = execSync('npx funcqc history --id nonexistent', { encoding: 'utf8' });
    
    expect(output).toContain('No history found for function ID');
  });

  it('should handle partial function IDs', () => {
    // Run initial scan
    execSync('npx funcqc scan', { encoding: 'utf8' });
    
    // Get function list to find ID
    const listOutput = execSync('npx funcqc list --json', { encoding: 'utf8' });
    const functions = JSON.parse(listOutput).functions;
    const testFunc = functions.find((f: any) => f.name === 'testFunction');
    
    // Use partial ID (first 6 characters)
    const partialId = testFunc.id.substring(0, 6);
    const output = execSync(`npx funcqc history --id ${partialId}`, { encoding: 'utf8' });
    
    expect(output).toContain('Function History: testFunction');
  });

  it('should show only existing functions by default', () => {
    // Run initial scan
    execSync('npx funcqc scan', { encoding: 'utf8' });
    
    // Get function ID
    const listOutput = execSync('npx funcqc list --json', { encoding: 'utf8' });
    const functions = JSON.parse(listOutput).functions;
    const testFunc = functions.find((f: any) => f.name === 'testFunction');
    
    // Modify file to remove function
    const modifiedFile = `
export function anotherFunction(): void {
  console.log('test');
}
`;
    writeFileSync(path.join(tempDir, 'test.ts'), modifiedFile);
    
    // Run another scan
    execSync('npx funcqc scan', { encoding: 'utf8' });
    
    // Check history without --all
    const output = execSync(`npx funcqc history --id ${testFunc.id} --json`, { encoding: 'utf8' });
    const historyData = JSON.parse(output);
    
    // Should only show snapshots where function exists
    expect(historyData.snapshots.every((s: any) => s.exists)).toBe(true);
  });
});