/**
 * Snapshot Command Handlers
 * 
 * Handles snapshot creation, listing, and cleanup for refactoring operations.
 * This module provides comprehensive snapshot management capabilities.
 */

import chalk from 'chalk';
import ora from 'ora';
import { CommandEnvironment } from '../../../../types/environment.js';

/**
 * Refactor snapshot command implementation
 * Provides snapshot creation and management for refactoring operations
 */
export async function refactorSnapshotCommandImpl(
  action: string,
  args: string[],
  options: any,
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
  snapshotManager: any,
  args: string[],
  options: any,
  _env: CommandEnvironment
): Promise<void> {
  const label = args[0] || options.label;
  const comment = options.comment || "";

  const spinner = ora("Creating snapshot...").start();
  
  try {
    const snapshot = await snapshotManager.createSnapshot({
      label,
      comment,
      includeGitInfo: true,
      force: options.force || false,
    });

    spinner.succeed(`Snapshot created: ${snapshot.id}`);
    
    if (options.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      console.log();
      console.log(chalk.green("✅ Snapshot Created Successfully"));
      console.log();
      console.log(`${chalk.bold("ID:")} ${snapshot.id}`);
      console.log(`${chalk.bold("Label:")} ${snapshot.label || "N/A"}`);
      console.log(`${chalk.bold("Comment:")} ${snapshot.comment || "N/A"}`);
      console.log(`${chalk.bold("Functions:")} ${snapshot.metadata.totalFunctions}`);
      console.log(`${chalk.bold("Files:")} ${snapshot.metadata.totalFiles}`);
      console.log(`${chalk.bold("Avg Complexity:")} ${snapshot.metadata.avgComplexity}`);
      
      if (snapshot.gitCommit) {
        console.log(`${chalk.bold("Git Commit:")} ${snapshot.gitCommit.substring(0, 8)}`);
      }
      if (snapshot.gitBranch) {
        console.log(`${chalk.bold("Git Branch:")} ${snapshot.gitBranch}`);
      }
    }
  } catch (error) {
    spinner.fail("Failed to create snapshot");
    throw error;
  }
}

/**
 * Handle snapshot listing
 */
async function handleSnapshotList(
  _snapshotManager: any,
  _args: string[],
  options: any,
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
    
    console.log();
    console.log(chalk.blue.bold("📸 Snapshots"));
    console.log();
    
    // Sort snapshots by creation time (newest first)
    const sortedSnapshots = snapshots.sort((a, b) => b.createdAt - a.createdAt);
    
    for (const snapshot of sortedSnapshots) {
      const date = new Date(snapshot.createdAt).toLocaleString();
      const isAutomatic = snapshot.label?.includes('Session ') || snapshot.comment?.includes('Automatic');
      const typeIcon = isAutomatic ? '🤖' : '👤';
      
      console.log(`${typeIcon} ${chalk.bold(snapshot.id)}`);
      console.log(`   ${chalk.dim('Label:')} ${snapshot.label || 'N/A'}`);
      console.log(`   ${chalk.dim('Created:')} ${date}`);
      console.log(`   ${chalk.dim('Functions:')} ${snapshot.metadata?.totalFunctions || 0}`);
      console.log(`   ${chalk.dim('Files:')} ${snapshot.metadata?.totalFiles || 0}`);
      
      if (snapshot.gitBranch) {
        console.log(`   ${chalk.dim('Branch:')} ${snapshot.gitBranch}`);
      }
      if (snapshot.gitCommit) {
        console.log(`   ${chalk.dim('Commit:')} ${snapshot.gitCommit.substring(0, 8)}`);
      }
      if (snapshot.comment) {
        console.log(`   ${chalk.dim('Comment:')} ${snapshot.comment}`);
      }
      console.log();
    }
    
    console.log(`${chalk.green('Total:')} ${snapshots.length} snapshots`);
  } catch (error) {
    spinner.fail("Failed to load snapshots");
    throw error;
  }
}

/**
 * Handle snapshot cleanup
 */
async function handleSnapshotCleanup(
  snapshotManager: any,
  _args: string[],
  options: any,
  env: CommandEnvironment
): Promise<void> {
  const dryRun = options.dryRun || false;
  const force = options.force || false;
  
  if (!dryRun && !force) {
    console.log(chalk.yellow("⚠️  Cleanup will permanently delete old automatic snapshots."));
    console.log("Use --dry-run to preview what would be deleted, or --force to proceed.");
    return;
  }
  
  const spinner = ora(`${dryRun ? 'Analyzing' : 'Cleaning up'} snapshots...`).start();
  
  try {
    if (dryRun) {
      // Preview mode - show what would be deleted
      const snapshots = await env.storage.getSnapshots();
      const automaticSnapshots = snapshots.filter(s => 
        s.label?.includes('Session ') || 
        s.comment?.includes('Automatic snapshot')
      );
      
      // Sort by creation time (oldest first)
      automaticSnapshots.sort((a, b) => a.createdAt - b.createdAt);
      
      const retentionCount = 20; // Default from SnapshotManager
      const excessCount = automaticSnapshots.length - retentionCount;
      
      spinner.stop();
      
      if (excessCount <= 0) {
        console.log(chalk.green("✅ No snapshots need cleanup"));
        console.log(`Current: ${automaticSnapshots.length}, Retention limit: ${retentionCount}`);
        return;
      }
      
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
      
    } else {
      // Actual cleanup
      const deletedCount = await snapshotManager.cleanupOldSnapshots();
      spinner.succeed(`Cleaned up ${deletedCount} old snapshots`);
      
      if (deletedCount === 0) {
        console.log(chalk.green("✅ No snapshots needed cleanup"));
      } else {
        console.log(chalk.green(`✅ Successfully deleted ${deletedCount} old automatic snapshots`));
      }
    }
  } catch (error) {
    spinner.fail("Failed to cleanup snapshots");
    throw error;
  }
}