import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'test/e2e/**'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30000, // 30秒でタイムアウト（analyzer系テストが重いため）
    hookTimeout: 15000, // beforeEach/afterEachタイムアウト
    teardownTimeout: 10000, // クリーンアップタイムアウト  
    maxConcurrency: 8, // 並列実行を有効化（CPUコア数に応じて調整）
    fileParallelism: true, // ファイル並列実行を有効化
    isolate: false, // テスト間でWorkerを再利用してオーバーヘッドを削減
    pool: 'threads', // スレッドプールを使用（forks より高速）
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
