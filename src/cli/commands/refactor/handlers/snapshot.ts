/**
 * Snapshot Command Handlers
 * 
 * Handles snapshot creation, listing, and cleanup for refactoring operations.
 * This module provides comprehensive snapshot management capabilities.
 */

import chalk from 'chalk';
import ora from 'ora';
import { CommandEnvironment } from '../../../../types/environment.js';
import { SnapshotManager } from '../../../../utils/snapshot-manager.js';
import { SnapshotInfo } from '../../../../types/index.js';
import { SessionManager } from '../../../../refactoring/session-manager-simple.js';

// Snapshot command options interface
interface SnapshotCommandOptions {
  label?: string;
  comment?: string;
  force?: boolean;
  json?: boolean;
  dryRun?: boolean;
  limit?: number;
  days?: number;
  sessionId?: string;
}

/**
 * Refactor snapshot command implementation
 * Provides snapshot creation and management for refactoring operations
 */
export async function refactorSnapshotCommandImpl(
  action: string,
  args: string[],
  options: Record<string, unknown>,
  env: CommandEnvironment
): Promise<void> {
  try {
    const { SnapshotManager } = await import("../../../../utils/snapshot-manager.js");
    const snapshotManager = new SnapshotManager(
      env.storage,
      env.config,
      {
        enabled: true,
        beforeRefactoring: true,
        afterRefactoring: true,
      },
      env.commandLogger
    );

    switch (action) {
      case "create":
        await handleSnapshotCreate(snapshotManager, args, options, env);
        break;
      case "list":
        await handleSnapshotList(snapshotManager, args, options, env);
        break;
      case "cleanup":
        await handleSnapshotCleanup(snapshotManager, args, options, env);
        break;
      default:
        env.commandLogger.error(`Unknown snapshot action: ${action}`);
        env.commandLogger.info("Available actions: create, list, cleanup");
        return;
    }
  } catch (error) {
    env.commandLogger.error("Snapshot command failed", {
      action,
      args,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Handle snapshot creation
 */
async function handleSnapshotCreate(
  snapshotManager: SnapshotManager,
  args: string[],
  options: SnapshotCommandOptions,
  env: CommandEnvironment
): Promise<void> {
  const label = args[0] || options.label;
  const comment = options.comment || "";

  const spinner = ora("Creating snapshot...").start();
  
  try {
    const snapshotOptions: Parameters<SnapshotManager['createSnapshot']>[0] = {
      comment,
      includeGitInfo: true,
      force: options.force || false,
    };
    
    if (label) {
      snapshotOptions.label = label;
    }
    
    const snapshot = await snapshotManager.createSnapshot(snapshotOptions);

    // Associate snapshot with refactoring session if session-id is provided
    if (options.sessionId) {
      await associateSnapshotWithSession(snapshot.id, options.sessionId, env);
      spinner.succeed(`Snapshot created: ${snapshot.id} (linked to session: ${options.sessionId})`);
    } else {
      spinner.succeed(`Snapshot created: ${snapshot.id}`);
    }
    
    if (options.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      displaySnapshotCreationResult(snapshot, options.sessionId);
    }
  } catch (error) {
    spinner.fail("Failed to create snapshot");
    throw error;
  }
}

/**
 * Associate snapshot with refactoring session
 */
async function associateSnapshotWithSession(
  snapshotId: string,
  sessionId: string,
  env: CommandEnvironment
): Promise<void> {
  try {
    const sessionManager = new SessionManager(env.storage);
    const session = await sessionManager.getSession(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    // Associate snapshot with session using the session manager
    await sessionManager.associateSnapshotWithSession(snapshotId, sessionId);
    env.commandLogger.info(`Snapshot ${snapshotId} successfully associated with session ${sessionId}`);
    
  } catch (error) {
    // Log warning but don't fail the snapshot creation
    env.commandLogger.warn(`Failed to associate snapshot with session: ${error}`);
  }
}

/**
 * Display snapshot creation result
 */
function displaySnapshotCreationResult(snapshot: SnapshotInfo, sessionId?: string): void {
  console.log();
  console.log(chalk.green("✅ Snapshot Created Successfully"));
  console.log();
  
  displaySnapshotBasicInfo(snapshot, sessionId);
  displaySnapshotGitInfoForCreation(snapshot);
}

/**
 * Display basic snapshot information
 */
function displaySnapshotBasicInfo(snapshot: SnapshotInfo, sessionId?: string): void {
  console.log(`${chalk.bold("ID:")} ${snapshot.id}`);
  console.log(`${chalk.bold("Label:")} ${snapshot.label || "N/A"}`);
  console.log(`${chalk.bold("Comment:")} ${snapshot.comment || "N/A"}`);
  console.log(`${chalk.bold("Functions:")} ${snapshot.metadata.totalFunctions}`);
  console.log(`${chalk.bold("Files:")} ${snapshot.metadata.totalFiles}`);
  console.log(`${chalk.bold("Avg Complexity:")} ${snapshot.metadata.avgComplexity}`);
  
  if (sessionId) {
    console.log(`${chalk.bold("Session:")} ${sessionId}`);
  }
}

/**
 * Display Git information for newly created snapshot
 */
function displaySnapshotGitInfoForCreation(snapshot: SnapshotInfo): void {
  if (snapshot.gitCommit) {
    console.log(`${chalk.bold("Git Commit:")} ${snapshot.gitCommit.substring(0, 8)}`);
  }
  if (snapshot.gitBranch) {
    console.log(`${chalk.bold("Git Branch:")} ${snapshot.gitBranch}`);
  }
}

/**
 * Handle snapshot listing
 */
async function handleSnapshotList(
  _snapshotManager: SnapshotManager,
  _args: string[],
  options: SnapshotCommandOptions,
  env: CommandEnvironment
): Promise<void> {
  const spinner = ora("Loading snapshots...").start();
  
  try {
    const snapshots = await env.storage.getSnapshots();
    spinner.stop();
    
    if (snapshots.length === 0) {
      console.log(chalk.yellow("No snapshots found."));
      return;
    }
    
    if (options.json) {
      console.log(JSON.stringify({ snapshots }, null, 2));
      return;
    }
    
    displaySnapshotList(snapshots);
  } catch (error) {
    spinner.fail("Failed to load snapshots");
    throw error;
  }
}

/**
 * Display formatted snapshot list
 */
function displaySnapshotList(snapshots: SnapshotInfo[]): void {
  console.log();
  console.log(chalk.blue.bold("📸 Snapshots"));
  console.log();
  
  // Sort snapshots by creation time (newest first)
  const sortedSnapshots = snapshots.sort((a, b) => b.createdAt - a.createdAt);
  
  for (const snapshot of sortedSnapshots) {
    displaySnapshotItem(snapshot);
  }
  
  console.log(`${chalk.green('Total:')} ${snapshots.length} snapshots`);
}

/**
 * Display individual snapshot item
 */
function displaySnapshotItem(snapshot: SnapshotInfo): void {
  const date = new Date(snapshot.createdAt).toLocaleString();
  // More robust automatic snapshot identification using label patterns
  // Since sessionId and operationType are not in SnapshotMetadata type,
  // we rely on label and comment patterns for identification
  const isAutomatic = snapshot.label?.startsWith('Before refactoring') ||
                     snapshot.label?.startsWith('After refactoring') ||
                     snapshot.label?.includes('Session ') ||
                     snapshot.comment?.includes('Automatic snapshot');
  const typeIcon = isAutomatic ? '🤖' : '👤';
  
  console.log(`${typeIcon} ${chalk.bold(snapshot.id)}`);
  console.log(`   ${chalk.dim('Label:')} ${snapshot.label || 'N/A'}`);
  console.log(`   ${chalk.dim('Created:')} ${date}`);
  console.log(`   ${chalk.dim('Functions:')} ${snapshot.metadata?.totalFunctions || 0}`);
  console.log(`   ${chalk.dim('Files:')} ${snapshot.metadata?.totalFiles || 0}`);
  
  displaySnapshotGitInfo(snapshot);
  displaySnapshotComment(snapshot);
  console.log();
}

/**
 * Display snapshot Git information
 */
function displaySnapshotGitInfo(snapshot: SnapshotInfo): void {
  if (snapshot.gitBranch) {
    console.log(`   ${chalk.dim('Branch:')} ${snapshot.gitBranch}`);
  }
  if (snapshot.gitCommit) {
    console.log(`   ${chalk.dim('Commit:')} ${snapshot.gitCommit.substring(0, 8)}`);
  }
}

/**
 * Display snapshot comment if present
 */
function displaySnapshotComment(snapshot: SnapshotInfo): void {
  if (snapshot.comment) {
    console.log(`   ${chalk.dim('Comment:')} ${snapshot.comment}`);
  }
}

/**
 * Handle snapshot cleanup
 */
async function handleSnapshotCleanup(
  snapshotManager: SnapshotManager,
  _args: string[],
  options: SnapshotCommandOptions,
  env: CommandEnvironment
): Promise<void> {
  const dryRun = options.dryRun || false;
  const force = options.force || false;
  
  if (!dryRun && !force) {
    displayCleanupWarning();
    return;
  }
  
  const spinner = ora(`${dryRun ? 'Analyzing' : 'Cleaning up'} snapshots...`).start();
  
  try {
    if (dryRun) {
      await handleCleanupDryRun(env, spinner);
    } else {
      await handleCleanupExecution(snapshotManager, spinner);
    }
  } catch (error) {
    spinner.fail("Failed to cleanup snapshots");
    throw error;
  }
}

/**
 * Display cleanup warning message
 */
function displayCleanupWarning(): void {
  console.log(chalk.yellow("⚠️  Cleanup will permanently delete old automatic snapshots."));
  console.log("Use --dry-run to preview what would be deleted, or --force to proceed.");
}

/**
 * Handle dry run cleanup analysis
 */
async function handleCleanupDryRun(env: CommandEnvironment, spinner: ReturnType<typeof ora>): Promise<void> {
  const snapshots = await env.storage.getSnapshots();
  const automaticSnapshots = getAutomaticSnapshots(snapshots);
  
  // Sort by creation time (oldest first)
  automaticSnapshots.sort((a, b) => a.createdAt - b.createdAt);
  
  const retentionCount = 20; // Default from SnapshotManager
  const excessCount = automaticSnapshots.length - retentionCount;
  
  spinner.stop();
  
  if (excessCount <= 0) {
    displayNoCleanupNeeded(automaticSnapshots.length, retentionCount);
    return;
  }
  
  displayCleanupPreview(automaticSnapshots, excessCount);
}

/**
 * Handle actual cleanup execution
 */
async function handleCleanupExecution(snapshotManager: SnapshotManager, spinner: ReturnType<typeof ora>): Promise<void> {
  const deletedCount = await snapshotManager.cleanupOldSnapshots();
  spinner.succeed(`Cleaned up ${deletedCount} old snapshots`);
  
  if (deletedCount === 0) {
    console.log(chalk.green("✅ No snapshots needed cleanup"));
  } else {
    console.log(chalk.green(`✅ Successfully deleted ${deletedCount} old automatic snapshots`));
  }
}

/**
 * Filter automatic snapshots
 */
function getAutomaticSnapshots(snapshots: SnapshotInfo[]): SnapshotInfo[] {
  return snapshots.filter(s => 
    s.label?.includes('Session ') || 
    s.comment?.includes('Automatic snapshot')
  );
}

/**
 * Display message when no cleanup is needed
 */
function displayNoCleanupNeeded(currentCount: number, retentionCount: number): void {
  console.log(chalk.green("✅ No snapshots need cleanup"));
  console.log(`Current: ${currentCount}, Retention limit: ${retentionCount}`);
}

/**
 * Display cleanup preview information
 */
function displayCleanupPreview(automaticSnapshots: SnapshotInfo[], excessCount: number): void {
  console.log();
  console.log(chalk.yellow(`🗑️  Would delete ${excessCount} old snapshots:`));
  console.log();
  
  const snapshotsToDelete = automaticSnapshots.slice(0, excessCount);
  for (const snapshot of snapshotsToDelete) {
    const date = new Date(snapshot.createdAt).toLocaleString();
    console.log(`   ${snapshot.id} - ${date} - ${snapshot.label || 'Unlabeled'}`);
  }
  
  console.log();
  console.log(`${chalk.green('Would keep:')} ${automaticSnapshots.length - excessCount} recent snapshots`);
  console.log();
  console.log("Run with --force to perform the cleanup.");
}