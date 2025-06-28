import chalk from 'chalk';
import { StatusCommandOptions } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';

export async function statusCommand(options: StatusCommandOptions): Promise<void> {
  try {
    // Load configuration
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    console.log(chalk.blue('📊 funcqc Status'));
    console.log('═'.repeat(50));
    console.log();
    
    // Show configuration
    showConfiguration(config, options.verbose);
    
    // Show database status
    await showDatabaseStatus(config.storage.path!, options.verbose);
    
    // Show Git status if enabled
    if (config.git.enabled) {
      await showGitStatus(options.verbose);
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to get status:'), error.message);
    process.exit(1);
  }
}

function showConfiguration(config: any, verbose: boolean): void {
  console.log(chalk.yellow('📝 Configuration'));
  console.log('─'.repeat(30));
  
  console.log(`  Roots: ${config.roots.join(', ')}`);
  console.log(`  Database: ${config.storage.path}`);
  console.log(`  Git integration: ${config.git.enabled ? chalk.green('enabled') : chalk.gray('disabled')}`);
  
  if (verbose) {
    console.log(`  Exclude patterns: ${config.exclude.length}`);
    config.exclude.slice(0, 3).forEach((pattern: string) => {
      console.log(`    • ${pattern}`);
    });
    if (config.exclude.length > 3) {
      console.log(`    ... and ${config.exclude.length - 3} more`);
    }
    
    console.log('  Thresholds:');
    console.log(`    • Complexity: ${config.metrics.complexityThreshold}`);
    console.log(`    • Lines of code: ${config.metrics.linesOfCodeThreshold}`);
    console.log(`    • Parameters: ${config.metrics.parameterCountThreshold}`);
  }
  
  console.log();
}

async function showDatabaseStatus(dbPath: string, verbose: boolean): Promise<void> {
  console.log(chalk.yellow('💾 Database Status'));
  console.log('─'.repeat(30));
  
  try {
    const storage = new PGLiteStorageAdapter(dbPath);
    await storage.init();
    
    // Get snapshots
    const snapshots = await storage.getSnapshots();
    
    if (snapshots.length === 0) {
      console.log(chalk.gray('  No data found'));
      console.log(chalk.blue('  Run `funcqc scan` to analyze your code'));
      console.log();
      return;
    }
    
    // Latest snapshot info
    const latest = snapshots[0]; // Assuming sorted by date desc
    console.log(`  Latest scan: ${formatDate(latest.createdAt)}`);
    if (latest.label) {
      console.log(`  Label: ${latest.label}`);
    }
    if (latest.gitCommit) {
      console.log(`  Git commit: ${latest.gitCommit.slice(0, 8)}`);
    }
    
    console.log(`  Total snapshots: ${snapshots.length}`);
    console.log(`  Functions analyzed: ${latest.metadata.totalFunctions}`);
    console.log(`  Files analyzed: ${latest.metadata.totalFiles}`);
    console.log(`  Average complexity: ${latest.metadata.avgComplexity.toFixed(1)}`);
    
    if (verbose) {
      // Show recent snapshots
      console.log();
      console.log('  Recent snapshots:');
      snapshots.slice(0, 5).forEach(snapshot => {
        const date = formatDate(snapshot.createdAt);
        const label = snapshot.label ? ` (${snapshot.label})` : '';
        const git = snapshot.gitCommit ? ` [${snapshot.gitCommit.slice(0, 8)}]` : '';
        console.log(`    • ${date}${label}${git}`);
      });
      
      if (snapshots.length > 5) {
        console.log(`    ... and ${snapshots.length - 5} more`);
      }
      
      // Show complexity distribution
      if (latest.metadata.complexityDistribution) {
        console.log();
        console.log('  Complexity distribution:');
        const dist = latest.metadata.complexityDistribution;
        Object.entries(dist)
          .sort(([a], [b]) => Number(a) - Number(b))
          .slice(0, 5)
          .forEach(([complexity, count]) => {
            const bar = '▓'.repeat(Math.min(20, Number(count) / 10));
            console.log(`    ${complexity.padStart(2)}: ${count.toString().padStart(3)} ${bar}`);
          });
      }
    }
    
    await storage.close();
    
  } catch (error) {
    console.log(chalk.red(`  Error: ${error.message}`));
  }
  
  console.log();
}

async function showGitStatus(verbose: boolean): Promise<void> {
  console.log(chalk.yellow('🔧 Git Status'));
  console.log('─'.repeat(30));
  
  try {
    const { execSync } = require('child_process');
    
    // Current branch
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    console.log(`  Current branch: ${branch}`);
    
    // Latest commit
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    console.log(`  Latest commit: ${commit.slice(0, 8)}`);
    
    // Commit message
    const message = execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
    console.log(`  Message: ${message}`);
    
    if (verbose) {
      // Working directory status
      try {
        const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
        if (status) {
          console.log('  Working directory:');
          status.split('\n').slice(0, 5).forEach(line => {
            console.log(`    ${line}`);
          });
        } else {
          console.log('  Working directory: clean');
        }
      } catch {
        console.log('  Working directory: unknown');
      }
      
      // Recent commits
      try {
        const commits = execSync('git log --oneline -5', { encoding: 'utf8' }).trim();
        console.log('  Recent commits:');
        commits.split('\n').forEach(commit => {
          console.log(`    ${commit}`);
        });
      } catch {
        // Ignore
      }
    }
    
  } catch (error) {
    console.log(chalk.gray('  Not a git repository or git not available'));
  }
  
  console.log();
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffHours < 1) {
    return 'just now';
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    return date.toLocaleDateString();
  }
}
