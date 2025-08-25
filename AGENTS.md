# Repository Guidelines
Please provide all answers in Japanese

## Project Structure & Module Organization
- Source: `src/` (CLI in `src/cli.ts`, utilities in `src/utils`, services in `src/services`, config in `src/config`).
- Tests: `test/` with `*.test.ts` plus helpers in `test/setup*.ts` and `test/fixtures/`.
- Binaries: `bin/funcqc.js` (CLI entry), build output in `dist/`.
- Docs & scripts: `docs/` (architecture, env), `scripts/` (benchmarks, helpers), `examples/`.

## Build, Test, and Development Commands
- `npm run dev`: Run the CLI from sources (e.g., `npm run dev -- scan`).
- `npm run build`: Bundle with tsup to `dist/`.
- `npm test`: Run Vitest unit/integration tests. Use `npm run test:ci` in CI.
- `npm run test:coverage`: Generate coverage.
- `npm run typecheck`: TypeScript no‑emit type checking.
- `npm run lint` / `npm run lint:fix`: Lint (ESLint) and auto‑fix.
- `npm run format` / `npm run format:check`: Prettier formatting.

## Coding Style & Naming Conventions
- Language: TypeScript (Node 18+). Use explicit types; avoid `any`.
- Formatting: Prettier 2‑space indent, single quotes, semicolons, width 100.
- Linting: ESLint (`@typescript-eslint` rules; no unused vars except prefixed `_`).
- Naming: files `kebab-case.ts`; classes/types `PascalCase`; functions/vars `camelCase`; constants `UPPER_SNAKE_CASE`.

## Testing Guidelines
- Framework: Vitest with `*.test.ts` files in `test/`.
- Run: `npm test` (watch: `npm run test:watch`). Coverage via `npm run test:coverage`.
- Conventions: Describe behavior, cover edge cases, prefer AAA, mock external IO.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits for semantic‑release, e.g.:
  - `feat(cli): add health command`
  - `fix(analyzer): handle arrow methods`
- PRs: Include clear description, linked issues, test evidence, and note breaking changes. Ensure CI green (typecheck, lint, tests, build). Use screenshots when output changes.

## Security & Configuration Tips
- Config: See `.funcqc.config.js` and docs in `docs/architecture/environment-variables.md` and `DEBUG_ENVIRONMENT_VARIABLES.md`.
- Secrets: Use environment vars (e.g., `.env.local`) and never commit secrets. Debug flags (e.g., `DEBUG_DB=true`) may log sensitive data—avoid in production.

