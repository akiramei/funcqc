// pr-get.ts
// Usage: tsx pr-get.ts <PR_NUMBER> [--repo <owner/repo>] [--out pr/NN/comments/] [--dry-run]

import { spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';

interface ReviewComment {
  id: number;
  path: string;
  line?: number;
  body: string;
  user: { login: string };
  created_at: string;
}

// ---- CHANGED: execSync → spawn (streaming) to avoid ENOBUFS ----
function run(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c.toString('utf-8'); });
    child.stderr.on('data', (c) => { err += c.toString('utf-8'); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `Command failed with exit code ${code}: ${command}`));
    });
  });
}

function parseArgs() {
  const prNumber = process.argv[2];
  const repoIndex = process.argv.indexOf('--repo');
  const outIndex = process.argv.indexOf('--out');
  const dryRun = process.argv.includes('--dry-run');

  // Validate PR number and usage
  const usage = 'Usage: tsx pr-get.ts <PR_NUMBER> --repo <owner/repo> [--out pr/NN/comments/] [--dry-run]';
  if (!prNumber || repoIndex === -1) {
    console.error(usage);
    process.exit(1);
  }
  if (!/^\d+$/.test(prNumber)) {
    console.error('Error: <PR_NUMBER> must be an integer.');
    process.exit(1);
  }

  // Validate repo format
  const repo = process.argv[repoIndex + 1];
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    console.error('Error: --repo must be in the form <owner>/<repo>.');
    process.exit(1);
  }

  // Validate --out value when provided
  if (outIndex > -1 && (!process.argv[outIndex + 1] || process.argv[outIndex + 1].startsWith('--'))) {
    console.error('Error: --out requires a value.');
    process.exit(1);
  }
  const out = outIndex > -1
    ? process.argv[outIndex + 1]
    : `pr/${prNumber}/comments`;

  return { prNumber, repo, out, dryRun };
}

function sanitizeFilename(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40);
}

function writeMarkdown(comment: ReviewComment, index: number, outDir: string, dryRun: boolean) {
  // comment.id は GitHub 側で一意なので、再実行時も衝突しない
  const filename = `comment-${String(comment.id).padStart(8, '0')}-${sanitizeFilename(comment.path)}.md`;
  const filepath = path.join(outDir, filename);

  const content = `---
commentId: ${comment.id}
reviewer: ${comment.user.login}
createdAt: ${comment.created_at}
filePath: ${comment.path}
line: ${comment.line ?? 'N/A'}
---

${comment.body.trim()}

## 対応ログ
- [ ] 理解完了
- [ ] 対応方針決定
- [ ] 修正実施済み
- [ ] テスト確認
`;

  if (dryRun) {
    console.log(`[dry-run] Would write: ${filepath}`);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(filepath, content);
    console.log(`✅ Wrote: ${filepath}`);
  }
}

function loadLastFetchedTime(outDir: string): string | null {
  const filePath = path.join(outDir, '.last_fetched.json');
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return data.lastFetched;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function saveLastFetchedTime(outDir: string, time: string) {
  const filePath = path.join(outDir, '.last_fetched.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ lastFetched: time }, null, 2));
}

async function main() {
  const { prNumber, repo, out, dryRun } = parseArgs();

  // 元仕様のまま: --paginate を使って全件取得
  const cmd = `gh api repos/${repo}/pulls/${prNumber}/comments --paginate`;

  // ---- CHANGED: await run(cmd) によるストリーミング読み取り ----
  const json = await run(cmd);

  // ここで gh の出力が巨大でも ENOBUFS にならない
  let comments: ReviewComment[];
  try {
    comments = JSON.parse(json);
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${(e as Error).message}`);
  }

  if (!Array.isArray(comments)) {
    // 例: {"message":"Not Found"} / {"message":"Requires authentication"} 等
    throw new Error(`Unexpected GitHub API response: ${json.slice(0, 200)}`);
  }

  const lastFetched = loadLastFetchedTime(out);

  const newComments = lastFetched
    ? comments.filter(c => new Date(c.created_at) > new Date(lastFetched))
    : comments;

  if (newComments.length === 0) {
    console.log('No new review comments found.');
    return;
  }

  newComments.forEach((comment, index) => {
    writeMarkdown(comment, index, out, dryRun);
  });

  const latestTime = comments.reduce((latest, c) =>
    new Date(c.created_at) > new Date(latest) ? c.created_at : latest,
    lastFetched ?? '1970-01-01T00:00:00Z'
  );

  if (!dryRun) {
    saveLastFetchedTime(out, latestTime);
  }
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
