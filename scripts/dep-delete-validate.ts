import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Scenario = {
  id: string;
  title: string;
  args: string[];
};

type JsonSummary = {
  summary: {
    candidates: number;
    deleted: number;
    skipped: number;
    errors: number;
    warnings: number;
    backupPath?: string | null;
  };
};

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) + '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

function extractJson(stdout: string): JsonSummary | null {
  // CLI mixes preface text and JSON. Extract the first JSON object.
  const firstBrace = stdout.indexOf('{');
  if (firstBrace < 0) return null;
  const jsonText = stdout.slice(firstBrace).trim();
  try {
    return JSON.parse(jsonText) as JsonSummary;
  } catch {
    // Try to find last closing brace
    const lastBrace = jsonText.lastIndexOf('}');
    if (lastBrace > 0) {
      const candidate = jsonText.slice(0, lastBrace + 1);
      try {
        return JSON.parse(candidate) as JsonSummary;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function runScenario(baseDir: string, scenario: Scenario) {
  const outPath = join(baseDir, `out-${scenario.id}.json`);
  const errPath = join(baseDir, `err-${scenario.id}.log`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const start = process.hrtime.bigint();
  const proc = spawnSync(
    npmCmd,
    ['run', 'dev', '--silent', '--', 'dep', 'delete', ...scenario.args, '--format', 'json'],
    { encoding: 'utf8' }
  );
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;

  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';

  writeFileSync(outPath, stdout, 'utf8');
  writeFileSync(errPath, stderr, 'utf8');

  const parsed = extractJson(stdout);
  const candidates = parsed?.summary.candidates ?? -1;
  const errors = parsed?.summary.errors ?? -1;
  const deleted = parsed?.summary.deleted ?? 0;
  const skipped = parsed?.summary.skipped ?? 0;

  return { ms, candidates, errors, deleted, skipped };
}

function main() {
  const ts = nowStamp();
  const baseDir = join('validation', 'dep-delete', ts);
  ensureDir(baseDir);

  const scenarios: Scenario[] = [
    {
      id: 'base-0.995',
      title: 'Base (edge 0.995, maxBatch 200)',
      args: ['--dry-run', '--confidence-threshold', '0.995', '--max-batch', '200'],
    },
    {
      id: 'base-0.95',
      title: 'Base (edge 0.95, maxBatch 200)',
      args: ['--dry-run', '--confidence-threshold', '0.95', '--max-batch', '200'],
    },
    {
      id: 'include-exports',
      title: 'Include exports (edge 0.99, maxBatch 500)',
      args: ['--dry-run', '--include-exports', '--confidence-threshold', '0.99', '--max-batch', '500'],
    },
    {
      id: 'high-recall',
      title: 'High recall preset',
      args: ['--dry-run', '--high-recall', '--max-batch', '500'],
    },
    {
      id: 'min-candidate-0.95',
      title: 'Candidate min-confidence 0.95',
      args: ['--dry-run', '--confidence-threshold', '0.995', '--min-confidence', '0.95', '--max-batch', '200'],
    },
  ];

  const lines: string[] = [];
  lines.push('scenario,ms,candidates,deleted,skipped,errors');

  for (const sc of scenarios) {
    const r = runScenario(baseDir, sc);
    lines.push(`${sc.id},${Math.round(r.ms)},${r.candidates},${r.deleted},${r.skipped},${r.errors}`);
  }

  writeFileSync(join(baseDir, 'summary.csv'), lines.join('\n') + '\n', 'utf8');

  const report = [
    `# dep delete validation (${ts})`,
    '',
    '目標: 型安全なコードでデッドコードを高リコールで検出する（anyやunsafeは仕様上対象外）',
    '',
    '## シナリオと結果',
    '',
    '| Scenario | Time (ms) | Candidates | Deleted | Skipped | Errors |',
    '|---------:|----------:|-----------:|--------:|--------:|-------:|',
    ...lines.slice(1).map(l => {
      const [id, ms, cand, del, skip, err] = l.split(',');
      return `| ${id} | ${ms} | ${cand} | ${del} | ${skip} | ${err} |`;
    }),
    '',
    '## 実行方法',
    '',
    '`npm run validate:dep-delete` を実行すると、validation/dep-delete/<timestamp>/ に結果が保存されます。',
  ].join('\n');

  writeFileSync(join(baseDir, 'report.md'), report, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Report written to: ${join(baseDir, 'report.md')}`);
}

main();
