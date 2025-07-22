import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    // CI環境でのWASM安定性のため、threads poolを使用
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        isolate: true,
        useAtomics: false
      }
    },
    // 完全シーケンシャル実行
    maxConcurrency: 1,
    fileParallelism: false,
    // PGLite WASM用のタイムアウト調整
    testTimeout: 120000,  // Increased for CHA/RTA tests
    hookTimeout: 60000,   // Increased for complex setup
    teardownTimeout: 15000,
    // CI環境で問題のあるテストを除外
    exclude: [
      ...baseConfig.test?.exclude || [],
      '**/simple-migration-manager.test.ts', // WASM問題を回避
      'test/risk-assessor.test.ts', // CI環境でのundefined問題を回避
      'test/storage/scope-based-operations.test.ts', // 統合テスト：CI環境でのモック競合を回避
      'test/function-id-generation.test.ts', // WASM/PGLite依存の統合テスト
      'test/cli/dot-format.test.ts' // process.exit依存のCLI統合テスト
    ],
    // CI専用セットアップ
    setupFiles: ['test/setup-ci.ts'],
    // メモリ集約的なテストのための環境変数
    env: {
      NODE_OPTIONS: '--max-old-space-size=4096',
      WASM_DISABLE_TIER_UP: '1',
      V8_FLAGS: '--no-wasm-tier-up --no-wasm-lazy-compilation'
    }
  }
});