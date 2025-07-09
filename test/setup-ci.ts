import { vi } from 'vitest';

// Global mock for PGLite to prevent filesystem pollution during tests
// This setup file is used for CI environments and any test that might cause
// filesystem pollution through PGLite's directory creation behavior.

console.log('Setting up PGLite mock to prevent filesystem pollution');

vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn().mockImplementation((path: string) => {
    // Don't create actual filesystem structures for any path in tests
    // This prevents creation of :memory:, C:, D:, etc. directories
    console.log(`PGLite mock: intercepted path "${path}"`);
    return {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(undefined),
      path: path, // Store path but don't use it for filesystem operations
    };
  }),
}));