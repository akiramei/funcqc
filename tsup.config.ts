import { defineConfig } from 'tsup';

export default defineConfig([
  // CLI build
  {
    entry: ['src/cli.ts'],
    format: ['cjs'],
    target: 'node18',
    outDir: 'dist',
    clean: true,
    minify: false,
    sourcemap: true,
    banner: {
      js: '#!/usr/bin/env node'
    }
  },
  // Library build
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    target: 'node18',
    outDir: 'dist',
    dts: true,
    sourcemap: true,
    external: [
      'typescript',
      '@electric-sql/pglite',
      'kysely'
    ]
  }
]);
