import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 10000,
    globals: true,
    environment: 'node',
    setupFiles: ['test/e2e/setup.ts']
  }
});
