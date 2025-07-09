import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    // CI環境での安定性のため、並列実行を無効化
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    // メモリ制限を増やす
    maxConcurrency: 1,
    // より長いタイムアウト
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    // CI環境では個別テストファイルでモックを管理
    // setupFiles: ['test/setup-ci.ts'] // 削除：グローバルモックは使用しない
  }
});