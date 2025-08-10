// pr-get.ts
// Usage: npx tsx pr-get.ts <PR_NUMBER> --repo <owner/repo> [--out pr/NN/comments] [--dry-run]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ==== Types ====

interface ReviewComment {
  id: number;
  path?: string;
  line?: number;
  body: string;
  user: { login: string };
  created_at: string; // ISO8601
}

// ==== CLI args ====

function parseArgs() {
  const prNumber = process.argv[2];
  const repoIndex = process.argv.indexOf('--repo');
  const outIndex = process.argv.indexOf('--out');
  const dryRun = process.argv.includes('--dry-run');

  if (!prNumber || repoIndex === -1) {
    console.error('Usage: npx tsx pr-get.ts <PR_NUMBER> --repo <owner/repo> [--out pr/NN/comments] [--dry-run]');
    process.exit(1);
  }

  const repo = process.argv[repoIndex + 1];
  if (!repo) {
    console.error('Error: --repo <owner/repo> is required.');
    process.exit(1);
  }
  const out = outIndex > -1 ? process.argv[outIndex + 1] : `pr/${prNumber}/comments`;

  return { prNumber, repo, out, dryRun };
}

// ==== Utils ====

function sanitizeFilename(text: string): string {
  return (text || 'no-path')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-') // keep . _ -
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

function writeMarkdown(comment: ReviewComment, index: number, outDir: string, dryRun: boolean) {
  const base = sanitizeFilename(comment.path ?? 'no-path');
  const filename = `comment-${String(index + 1).padStart(4, '0')}-${base}.md`;
  const filepath = path.join(outDir, filename);

  const content = `---
commentId: ${comment.id}
reviewer: ${comment.user?.login ?? 'unknown'}
createdAt: ${comment.created_at}
filePath: ${comment.path ?? 'N/A'}
line: ${comment.line ?? 'N/A'}
---

${(comment.body ?? '').trim()}

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
    fs.writeFileSync(filepath, content, 'utf-8');
    console.log(`✅ Wrote: ${filepath}`);
  }
}

function loadLastFetchedTime(outDir: string): string | null {
  const filePath = path.join(outDir, '.last_fetched.json');
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return typeof data.lastFetched === 'string' ? data.lastFetched : null;
    } catch {
      return null;
    }
  }
  return null;
}

function saveLastFetchedTime(outDir: string, time: string) {
  const filePath = path.join(outDir, '.last_fetched.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ lastFetched: time }, null, 2), 'utf-8');
}

// ==== gh runner (streaming; no ENOBUFS) ====

function runGh(endpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['api', endpoint], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';

    child.stdout.on('data', (c) => { out += c.toString('utf-8'); });
    child.stderr.on('data', (c) => { err += c.toString('utf-8'); });

    child.on('error', (e) => {
      reject(new Error(`Failed to spawn gh: ${e instanceof Error ? e.message : String(e)}`));
    });

    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `gh exited with code ${code}`));
    });
  });
}

// ==== Pagination (自動で最後まで; ページ数の指定は不要) ====

async function fetchAllComments(repo: string, prNumber: string, perPage = 100): Promise<ReviewComment[]> {
  let page = 1;
  const all: ReviewComment[] = [];

  for (;;) {
    const endpoint = `repos/${repo}/pulls/${prNumber}/comments?page=${page}&per_page=${perPage}`;
    const json = await runGh(endpoint);

    let items: ReviewComment[];
    try {
      items = JSON.parse(json);
    } catch (e) {
      throw new Error(`Failed to parse JSON on page ${page}: ${(e as Error).message}`);
    }

    if (!Array.isArray(items) || items.length === 0) break;

    all.push(...items);
    if (items.length < perPage) break; // 最終ページ（次ページは空配列）
    page++;
  }

  return all;
}

// ==== Main ====

async function main() {
  const { prNumber, repo, out, dryRun } = parseArgs();

  console.log(`ℹ️ Fetching review comments: repo=${repo}, PR#${prNumber}`);
  const comments = await fetchAllComments(repo, prNumber);

  console.log(`ℹ️ Total comments fetched: ${comments.length}`);

  const lastFetched = loadLastFetchedTime(out);
  const newComments = lastFetched
    ? comments.filter(c => new Date(c.created_at) > new Date(lastFetched))
    : comments;

  if (newComments.length === 0) {
    console.log('No new review comments found.');
    return;
  }

  // 安定出力のため created_at 昇順で書き出し
  newComments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  newComments.forEach((comment, index) => {
    writeMarkdown(comment, index, out, dryRun);
  });

  // 最新時刻を保存（全体から算出）
  const latestTime = comments.reduce(
    (latest, c) => new Date(c.created_at) > new Date(latest) ? c.created_at : latest,
    lastFetched ?? '1970-01-01T00:00:00Z'
  );

  if (!dryRun) {
    saveLastFetchedTime(out, latestTime);
    console.log(`📝 Updated last fetched time: ${latestTime}`);
  } else {
    console.log(`[dry-run] Would update last fetched time: ${latestTime}`);
  }
}

main().catch(err => {
  console.error('❌ Error:', err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
