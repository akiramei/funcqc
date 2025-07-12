import { vi } from 'vitest';

/**
 * Mock PGLite constructor to prevent filesystem operations for specific test paths
 * This is a targeted approach to prevent creation of problematic directories
 * while allowing normal database operations for other tests.
 */
export function mockPGLiteForPathValidation() {
  return vi.mock('@electric-sql/pglite', () => ({
    PGlite: vi.fn().mockImplementation((path: string) => {
      // Log the path being used for debugging
      console.log(`PGLite mock intercepted: ${path}`);
      
      // Return a mock that doesn't create filesystem structures
      return {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        close: vi.fn().mockResolvedValue(undefined),
        exec: vi.fn().mockResolvedValue(undefined),
        path: path,
      };
    }),
  }));
}

/**
 * Check if we're in a CI environment where we need to be more careful
 * about filesystem operations
 */
export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.BUILD_NUMBER
  );
}

/**
 * Get a safe temporary database path that won't create problematic directories
 */
export function getSafeTestDbPath(): string {
  if (isCI()) {
    // Use a safe temporary file path instead of :memory: 
    // since PGLite doesn't support true in-memory databases
    const os = require('os');
    const path = require('path');
    return path.join(os.tmpdir(), `funcqc-ci-test-${process.pid}.db`);
  }
  return './test-db.sqlite';
}