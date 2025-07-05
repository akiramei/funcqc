import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

describe('list command options', () => {
  const CLI_PATH = join(__dirname, '../../src/cli.ts');
  
  function runCommand(args: string): string {
    try {
      return execSync(`npx tsx ${CLI_PATH} ${args}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    } catch (error) {
      if (error instanceof Error && 'stdout' in error) {
        return (error as any).stdout.toString().trim();
      }
      throw error;
    }
  }

  beforeAll(() => {
    // Ensure we have scanned before testing list
    try {
      runCommand('scan --quiet');
    } catch {
      // Ignore scan errors
    }
  });

  describe('--limit option', () => {
    it('should limit the number of results', () => {
      const output = runCommand('list --limit 3');
      const lines = output.split('\n');
      // Header (2 lines) + 3 function lines + summary line
      expect(lines.filter(l => l.match(/^[a-f0-9]{8} /))).toHaveLength(3);
      expect(output).toContain('Showing 3 of');
    });

    it('should handle invalid limit', () => {
      const output = runCommand('list --limit abc');
      // Should show all results when limit is invalid
      expect(output).toContain('Total:');
    });
  });

  describe('--sort option', () => {
    it('should sort by complexity', () => {
      const output = runCommand('list --sort cc --limit 5');
      const lines = output.split('\n').filter(l => l.match(/^[a-f0-9]{8} /));
      
      // Extract complexity values
      const complexities = lines.map(line => {
        const parts = line.split(/\s+/);
        return parseInt(parts[2]); // CC is the 3rd column
      });
      
      // Check ascending order
      for (let i = 1; i < complexities.length; i++) {
        expect(complexities[i]).toBeGreaterThanOrEqual(complexities[i - 1]);
      }
    });

    it('should sort by complexity descending with --desc', () => {
      const output = runCommand('list --sort cc --desc --limit 5');
      const lines = output.split('\n').filter(l => l.match(/^[a-f0-9]{8} /));
      
      // Extract complexity values
      const complexities = lines.map(line => {
        const parts = line.split(/\s+/);
        return parseInt(parts[2]); // CC is the 3rd column
      });
      
      // Check descending order
      for (let i = 1; i < complexities.length; i++) {
        expect(complexities[i]).toBeLessThanOrEqual(complexities[i - 1]);
      }
    });
  });

  describe('--cc-ge option', () => {
    it('should filter by minimum complexity', () => {
      const output = runCommand('list --cc-ge 10');
      const lines = output.split('\n').filter(l => l.match(/^[a-f0-9]{8} /));
      
      // Extract complexity values
      const complexities = lines.map(line => {
        const parts = line.split(/\s+/);
        return parseInt(parts[2]); // CC is the 3rd column
      });
      
      // All complexities should be >= 10
      complexities.forEach(cc => {
        expect(cc).toBeGreaterThanOrEqual(10);
      });
      
      expect(output).toContain('filtered functions');
    });
  });

  describe('--file option', () => {
    it('should filter by file path pattern', () => {
      const output = runCommand('list --file analyzer');
      const lines = output.split('\n').filter(l => l.match(/^[a-f0-9]{8} /));
      
      // All results should contain 'analyzer' in the file path
      lines.forEach(line => {
        expect(line.toLowerCase()).toContain('analyzer');
      });
    });
  });

  describe('--name option', () => {
    it('should filter by function name pattern', () => {
      const output = runCommand('list --name analyze --limit 5');
      const lines = output.split('\n').filter(l => l.match(/^[a-f0-9]{8} /));
      
      // Extract function names
      const names = lines.map(line => {
        const parts = line.split(/\s+/);
        return parts[1]; // Name is the 2nd column
      });
      
      // All names should contain 'analyze'
      names.forEach(name => {
        expect(name.toLowerCase()).toContain('analyze');
      });
    });
  });

  describe('combined options', () => {
    it('should work with multiple filters and options', () => {
      const output = runCommand('list --cc-ge 5 --sort loc --desc --limit 10');
      const lines = output.split('\n').filter(l => l.match(/^[a-f0-9]{8} /));
      
      // Should have at most 10 results
      expect(lines.length).toBeLessThanOrEqual(10);
      
      // Extract LOC values
      const locs = lines.map(line => {
        const parts = line.split(/\s+/);
        return parseInt(parts[3]); // LOC is the 4th column
      });
      
      // Check descending order
      for (let i = 1; i < locs.length; i++) {
        expect(locs[i]).toBeLessThanOrEqual(locs[i - 1]);
      }
    });
  });
});