import simpleGit, { SimpleGit } from 'simple-git';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { CommandEnvironment } from '../types/environment';
import { FunctionInfo } from '../types';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { QualityCalculator } from '../metrics/quality-calculator';

/**
 * Resolves a snapshot identifier to an actual snapshot ID.
 * Supports various identifier formats:
 * - Exact snapshot ID
 * - Partial snapshot ID (with collision detection)
 * - Snapshot label
 * - Special keywords: 'latest', 'HEAD'
 * - HEAD~N notation
 * - Git commit references (hash, branch, tag)
 */
export async function resolveSnapshotId(
  env: CommandEnvironment,
  identifier: string
): Promise<string | null> {
  // Try exact match first
  const exact = await env.storage.getSnapshot(identifier);
  if (exact) return identifier;

  // Try partial ID match with collision detection
  const snapshots = await env.storage.getSnapshots();

  if (partialMatches.length === 1) {
    return partialMatches[0].id;
  } else if (partialMatches.length > 1) {
    const matchList = partialMatches.map(s => s.id.substring(0, 8)).join(', ');
      `Ambiguous snapshot ID '${identifier}' matches ${partialMatches.length} snapshots: ${matchList}. Please provide more characters.`
    );
  }

  // Try label match
  const labeled = snapshots.find(s => s.label === identifier);
  if (labeled) return labeled.id;
  // Try special keywords
  if (identifier === 'latest' || identifier === 'HEAD') {
    const latest = snapshots[0]; // snapshots are ordered by created_at DESC
    return latest ? latest.id : null;
  }

  if (identifier.startsWith('HEAD~')) {
    const offset = parseInt(identifier.slice(5)) || 1;
    const target = snapshots[offset];
    return target ? target.id : null;
  }

  // Try git commit reference
  const gitCommitId = await resolveGitCommitReference(env, identifier);
  if (gitCommitId) return gitCommitId;

  return null;
}

/**
 * Resolves a git commit reference to a snapshot ID.
 * Creates a new snapshot if one doesn't exist for the commit.
 */
async function resolveGitCommitReference(
  env: CommandEnvironment,
  identifier: string
): Promise<string | null> {
  try {
    const git = simpleGit();

    // Check if identifier looks like a git reference
    const isGitReference = await isValidGitReference(git, identifier);
    if (!isGitReference) return null;

    // Get actual commit hash
    const commitHash = await git.revparse([identifier]);

    // Check if we already have a snapshot for this commit
    const existingSnapshot = await findSnapshotByGitCommit(env, commitHash);
    if (existingSnapshot) {
      return existingSnapshot.id;
    }

    // Create snapshot for this commit
    const snapshotId = await createSnapshotForGitCommit(env, git, identifier, commitHash);
    return snapshotId;
  } catch {
    // Not a valid git reference, return null to continue with other resolution methods
    return null;
  }
}

/**
 * Checks if the given identifier is a valid git reference.
 */
async function isValidGitReference(git: SimpleGit, identifier: string): Promise<boolean> {
  try {
    // Check for commit hash pattern (7-40 hex chars)
    if (/^[0-9a-f]{7,40}$/i.test(identifier)) {
      return true;
    }

    // Check for git references (HEAD~N, branch names, tag names)
    if (identifier.startsWith('HEAD~') || identifier.startsWith('HEAD^')) {
      return true;
    }

    // Check if it's a valid branch/tag name
    const branches = await git.branchLocal();
    if (branches.all.includes(identifier)) {
      return true;
    }

    const tags = await git.tags();
    if (tags.all.includes(identifier)) {
      return true;
    }

    // Try to resolve as git reference
    await git.revparse([identifier]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds an existing snapshot for the given git commit hash.
 */
async function findSnapshotByGitCommit(
  env: CommandEnvironment,
  commitHash: string
): Promise<{ id: string } | null> {
  const snapshots = await env.storage.getSnapshots();
  return snapshots.find(s => s.gitCommit === commitHash) || null;
}

/**
 * Creates a new snapshot for the given git commit.
 */
async function createSnapshotForGitCommit(
  env: CommandEnvironment,
  git: SimpleGit,
  identifier: string,
  commitHash: string
): Promise<string> {
  const tempDir = path.join(process.cwd(), '.funcqc-temp', `snapshot-${uuidv4()}`);

  try {
    // Create worktree for the specific commit
    await fs.promises.mkdir(tempDir, { recursive: true });
    await git.raw(['worktree', 'add', tempDir, commitHash]);

    // Get commit info for labeling
    const commitInfo = await git.show([commitHash, '--no-patch', '--format=%s']);
    const commitMessage = commitInfo.split('\n')[0] || 'Unknown commit';

    // Create label for the snapshot
    const label = `${identifier}@${commitHash.substring(0, 8)}`;
    const description = `Auto-created snapshot for ${identifier}: ${commitMessage}`;

    // Analyze functions in the worktree
    const analyzer = new TypeScriptAnalyzer();
    const calculator = new QualityCalculator();

    // Find TypeScript files in the worktree
    const tsFiles = await findTypeScriptFiles(tempDir);

    // Analyze all files and collect functions
    const allFunctions: FunctionInfo[] = [];
    for (const filePath of tsFiles) {
      const functions = await analyzer.analyzeFile(filePath);
      allFunctions.push(...functions);
    }

    // Add metrics to functions
    const functionsWithMetrics = await Promise.all(
      allFunctions.map(async (func: FunctionInfo) => ({
        ...func,
        metrics: await calculator.calculate(func),
      }))
    );

    // Create snapshot using existing saveSnapshot method
    const snapshotId = await env.storage.saveSnapshot(functionsWithMetrics, label, description);

    return snapshotId;
  } finally {
    // Clean up worktree
    try {
      await git.raw(['worktree', 'remove', tempDir, '--force']);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Constants for file filtering
const EXCLUDED_DIRECTORIES = ['node_modules', '.git', 'dist', 'build', 'coverage'];
const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Checks if directory should be excluded from scanning
 */
function shouldExcludeDirectory(dirName: string): boolean {
  return EXCLUDED_DIRECTORIES.includes(dirName);
}

/**
 * Checks if file is a TypeScript file
 */
function isTypeScriptFile(fileName: string): boolean {
  return TYPESCRIPT_EXTENSIONS.some(ext => fileName.endsWith(ext));
}

/**
 * Processes a single directory entry during file walking
 */
async function processDirectoryEntry(
  entry: fs.Dirent, 
  currentDir: string, 
  files: string[], 
  walk: (dir: string) => Promise<void>
): Promise<void> {
  const fullPath = path.join(currentDir, entry.name);
  
  if (entry.isDirectory()) {
    if (!shouldExcludeDirectory(entry.name)) {
      await walk(fullPath);
    }
  } else if (entry.isFile() && isTypeScriptFile(entry.name)) {
    files.push(fullPath);
  }
}

/**
 * Recursively finds all TypeScript files in the given directory.
 */
async function findTypeScriptFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      await processDirectoryEntry(entry, currentDir, files, walk);
    }
  }

  await walk(dir);
  return files;
}