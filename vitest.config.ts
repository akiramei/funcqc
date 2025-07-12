import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'test/e2e/**'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 10000, // 10秒でタイムアウト
    hookTimeout: 10000, // beforeEach/afterEachタイムアウト
    teardownTimeout: 5000, // クリーンアップタイムアウト  
    maxConcurrency: 1, // シーケンシャル実行でリソース競合を防ぐ
    fileParallelism: false, // ファイル並列実行を無効化
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'coverage/**',
        'dist/**',
        'test/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/node_modules/**'
      ]
    }
  }
});
