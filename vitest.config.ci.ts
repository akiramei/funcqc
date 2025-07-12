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
    testTimeout: 45000,
    hookTimeout: 45000,
    teardownTimeout: 15000,
    // CI環境で問題のあるテストを除外
    exclude: [
      ...baseConfig.test?.exclude || [],
      '**/simple-migration-manager.test.ts' // WASM問題を回避
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