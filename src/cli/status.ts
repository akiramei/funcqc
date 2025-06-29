import chalk from 'chalk';
import simpleGit, { SimpleGit } from 'simple-git';
import { StatusCommandOptions, FunctionInfo, FuncqcConfig, SnapshotInfo, TrendDataSnapshot } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { QualityScorer } from '../utils/quality-scorer';

export async function statusCommand(options: StatusCommandOptions): Promise<void> {
  try {
    // Load configuration
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    console.log(chalk.blue('📊 funcqc Status'));
    console.log('═'.repeat(50));
    console.log();
    
    // Show configuration
    showConfiguration(config, options.verbose || false);
    
    // Show database status
    await showDatabaseStatus(config.storage.path!, options.verbose || false);
    
    // Show Git status if enabled
    if (config.git.enabled) {
      await showGitStatus(options.verbose || false);
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to get status:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function showConfiguration(config: FuncqcConfig, verbose: boolean): void {
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
    
    const snapshots = await storage.getSnapshots();
    
    if (snapshots.length === 0) {
      showNoDataMessage();
      return;
    }
    
    const latest = snapshots[0];
    showLatestSnapshotInfo(latest);
    
    // Get detailed function data for quality analysis
    const functions = await storage.getFunctions(latest.id);
    await showQualityOverview(functions, latest, verbose);
    
    showBasicStats(snapshots, latest);
    
    if (verbose) {
      showRecentSnapshots(snapshots);
      showComplexityDistribution(latest);
      await showActionableInsights(functions, storage, snapshots);
    }
    
    await storage.close();
    
  } catch (error) {
    console.log(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
  }
  
  console.log();
}

function showNoDataMessage(): void {
  console.log(chalk.gray('  No data found'));
  console.log(chalk.blue('  Run `funcqc scan` to analyze your code'));
  console.log();
}

function showLatestSnapshotInfo(latest: SnapshotInfo): void {
  console.log(`  Latest scan: ${formatDate(latest.createdAt)}`);
  if (latest.label) {
    console.log(`  Label: ${latest.label}`);
  }
  if (latest.gitCommit) {
    console.log(`  Git commit: ${latest.gitCommit.slice(0, 8)}`);
  }
}

function showBasicStats(snapshots: SnapshotInfo[], latest: SnapshotInfo): void {
  console.log(`  Total snapshots: ${snapshots.length}`);
  console.log(`  Functions analyzed: ${latest.metadata.totalFunctions}`);
  console.log(`  Files analyzed: ${latest.metadata.totalFiles}`);
  console.log(`  Average complexity: ${latest.metadata.avgComplexity.toFixed(1)}`);
}

function showRecentSnapshots(snapshots: SnapshotInfo[]): void {
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
}

function showComplexityDistribution(latest: SnapshotInfo): void {
  if (!latest.metadata.complexityDistribution) return;
  
  console.log();
  console.log('  Complexity distribution:');
  const dist = latest.metadata.complexityDistribution;
  Object.entries(dist)
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(0, 5)
    .forEach(([complexity, count]) => {
      const bar = '▓'.repeat(Math.min(20, Number(count) / 10));
      console.log(`    ${complexity.padStart(2)}: ${String(count).padStart(3)} ${bar}`);
    });
}

async function showGitStatus(verbose: boolean): Promise<void> {
  console.log(chalk.yellow('🔧 Git Status'));
  console.log('─'.repeat(30));
  
  const git: SimpleGit = simpleGit();
  
  try {
    if (!(await checkGitRepository(git))) {
      return;
    }
    
    await displayBasicGitInfo(git);
    
    if (verbose) {
      await displayVerboseGitInfo(git);
    }
    
  } catch (error) {
    console.log(chalk.gray('  Git operation failed:'), error instanceof Error ? error.message : String(error));
  }
  
  console.log();
}

async function checkGitRepository(git: SimpleGit): Promise<boolean> {
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    console.log(chalk.gray('  Not a git repository'));
    console.log();
    return false;
  }
  return true;
}

async function displayBasicGitInfo(git: SimpleGit): Promise<void> {
  const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
  console.log(`  Current branch: ${branch}`);
  
  const commit = await git.revparse(['HEAD']);
  console.log(`  Latest commit: ${commit.slice(0, 8)}`);
  
  const log = await git.log(['-1']);
  const latestCommit = log.latest;
  if (latestCommit) {
    console.log(`  Message: ${latestCommit.message}`);
  }
}

async function displayVerboseGitInfo(git: SimpleGit): Promise<void> {
  await displayWorkingDirectoryStatus(git);
  await displayRecentCommits(git);
}

async function displayWorkingDirectoryStatus(git: SimpleGit): Promise<void> {
  const status = await git.status();
  
  if (status.files.length === 0) {
    console.log('  Working directory: clean');
    return;
  }
  
  console.log('  Working directory:');
  status.files.slice(0, 5).forEach(file => {
    const statusChar = file.working_dir || file.index || '?';
    console.log(`    ${statusChar} ${file.path}`);
  });
  
  if (status.files.length > 5) {
    console.log(`    ... and ${status.files.length - 5} more files`);
  }
}

async function displayRecentCommits(git: SimpleGit): Promise<void> {
  const recentLog = await git.log(['-5']);
  
  if (recentLog.all.length === 0) {
    return;
  }
  
  console.log('  Recent commits:');
  recentLog.all.forEach(commit => {
    console.log(`    ${commit.hash.slice(0, 8)} ${commit.message}`);
  });
}

async function showQualityOverview(functions: FunctionInfo[], _latest: SnapshotInfo, verbose: boolean): Promise<void> {
  console.log(chalk.yellow('🎯 Quality Overview'));
  console.log('─'.repeat(30));
  
  if (functions.length === 0) {
    console.log(chalk.gray('  No function data available'));
    return;
  }
  
  const qualityScorer = new QualityScorer();
  const qualityScore = qualityScorer.calculateProjectScore(functions);
  
  // Overall grade with color coding
  const gradeColor = qualityScore.overallGrade === 'A' ? chalk.green :
                     qualityScore.overallGrade === 'B' ? chalk.blue :
                     qualityScore.overallGrade === 'C' ? chalk.yellow :
                     qualityScore.overallGrade === 'D' ? chalk.red : chalk.red;
  
  console.log(`  Overall Grade: ${gradeColor.bold(qualityScore.overallGrade)} (${qualityScore.score}/100)`);
  
  // Quality status indicator
  const qualityStatus = getQualityStatus(qualityScore.score);
  console.log(`  Quality Status: ${qualityStatus.icon} ${qualityStatus.color(qualityStatus.description)}`);
  
  // High risk functions warning
  if (qualityScore.highRiskFunctions > 0) {
    console.log(`  ${chalk.red('⚠️')} High Risk Functions: ${chalk.red.bold(qualityScore.highRiskFunctions)} need attention`);
  } else {
    console.log(`  ${chalk.green('✅')} No high-risk functions detected`);
  }
  
  // Quality breakdown (show if verbose or if there are issues)
  if (verbose || qualityScore.score < 80) {
    console.log();
    console.log('  Quality Breakdown:');
    console.log(`    Complexity: ${getScoreDisplay(qualityScore.complexityScore)}`);
    console.log(`    Maintainability: ${getScoreDisplay(qualityScore.maintainabilityScore)}`);
    console.log(`    Size Management: ${getScoreDisplay(qualityScore.sizeScore)}`);
    console.log(`    Code Quality: ${getScoreDisplay(qualityScore.codeQualityScore)}`);
  }
  
  // Top problematic functions
  if (qualityScore.topProblematicFunctions.length > 0) {
    console.log();
    console.log('  Functions Needing Attention:');
    qualityScore.topProblematicFunctions.slice(0, 3).forEach((func, index) => {
      const shortPath = func.filePath.split('/').slice(-2).join('/');
      console.log(`    ${index + 1}. ${chalk.cyan(func.name)} (${shortPath})`);
      console.log(`       ${func.reason}`);
    });
  }
  
  console.log();
}

function getQualityStatus(score: number) {
  if (score >= 90) {
    return {
      icon: '🟢',
      color: chalk.green,
      description: 'Excellent - Maintain current standards'
    };
  } else if (score >= 80) {
    return {
      icon: '🔵', 
      color: chalk.blue,
      description: 'Good - Minor improvements possible'
    };
  } else if (score >= 70) {
    return {
      icon: '🟡',
      color: chalk.yellow,
      description: 'Fair - Some refactoring recommended'
    };
  } else if (score >= 60) {
    return {
      icon: '🟠',
      color: chalk.yellow,
      description: 'Poor - Significant improvements needed'
    };
  } else {
    return {
      icon: '🔴',
      color: chalk.red,
      description: 'Critical - Immediate action required'
    };
  }
}

function getScoreDisplay(score: number): string {
  const color = score >= 80 ? chalk.green :
                score >= 60 ? chalk.yellow :
                chalk.red;
  return color(`${score}/100`);
}

async function showActionableInsights(functions: FunctionInfo[], storage: PGLiteStorageAdapter, snapshots: SnapshotInfo[]): Promise<void> {
  console.log(chalk.yellow('💡 Actionable Insights'));
  console.log('─'.repeat(30));
  
  // Recent quality trend
  if (snapshots.length >= 2) {
    await showRecentQualityTrend(storage, snapshots);
  }
  
  // Specific recommendations
  const recommendations = generateRecommendations(functions);
  if (recommendations.length > 0) {
    console.log();
    console.log('  Immediate Actions:');
    recommendations.forEach((rec, index) => {
      console.log(`    ${index + 1}. ${rec}`);
    });
  }
  
  // Development workflow suggestions
  console.log();
  console.log('  Development Workflow:');
  console.log('    • Run `funcqc scan --compare-with latest` before commits');
  console.log('    • Use `funcqc list --urgent` to find 15-min quick fixes');
  console.log('    • Check `funcqc trend --weekly` for quality progress');
  
  console.log();
}

async function showRecentQualityTrend(_storage: PGLiteStorageAdapter, snapshots: SnapshotInfo[]): Promise<void> {
  try {
    const trendData = extractTrendData(snapshots);
    if (!trendData) return;
    
    console.log('  Recent Trend:');
    displayComplexityTrend(trendData.complexityChange);
    displayFunctionCountTrend(trendData.functionChange);
    
  } catch (error) {
    // Silently handle errors in trend calculation
  }
}

function extractTrendData(snapshots: SnapshotInfo[]): TrendDataSnapshot | null {
  const latest = snapshots[0];
  const previous = snapshots[1];
  
  if (!latest || !previous) return null;
  
  const latestComplexity = latest.metadata.avgComplexity || 0;
  const previousComplexity = previous.metadata.avgComplexity || 0;
  const complexityChange = latestComplexity - previousComplexity;
  
  const latestFunctions = latest.metadata.totalFunctions || 0;
  const previousFunctions = previous.metadata.totalFunctions || 0;
  const functionChange = latestFunctions - previousFunctions;
  
  return { complexityChange, functionChange };
}

function displayComplexityTrend(complexityChange: number): void {
  if (Math.abs(complexityChange) > 0.1) {
    const direction = complexityChange > 0 ? 'increased' : 'decreased';
    const color = complexityChange > 0 ? chalk.red : chalk.green;
    const icon = complexityChange > 0 ? '📈' : '📉';
    console.log(`    ${icon} Complexity ${direction} by ${color(Math.abs(complexityChange).toFixed(1))}`);
  } else {
    console.log(`    ➡️  Complexity remained stable`);
  }
}

function displayFunctionCountTrend(functionChange: number): void {
  if (functionChange !== 0) {
    const direction = functionChange > 0 ? 'added' : 'removed';
    const icon = functionChange > 0 ? '➕' : '➖';
    console.log(`    ${icon} ${Math.abs(functionChange)} functions ${direction}`);
  }
}

function generateRecommendations(functions: FunctionInfo[]): string[] {
  const recommendations: string[] = [];
  
  // Find high complexity functions
  const highComplexityFunctions = functions.filter(f => 
    f.metrics && f.metrics.cyclomaticComplexity > 10
  );
  
  if (highComplexityFunctions.length > 0) {
    const count = Math.min(3, highComplexityFunctions.length);
    recommendations.push(`Refactor ${count} high-complexity functions (complexity > 10)`);
  }
  
  // Find long functions
  const longFunctions = functions.filter(f => 
    f.metrics && f.metrics.linesOfCode > 50
  );
  
  if (longFunctions.length > 0) {
    const count = Math.min(3, longFunctions.length);
    recommendations.push(`Break down ${count} large functions (>50 lines)`);
  }
  
  // Find functions with many parameters
  const manyParamFunctions = functions.filter(f => 
    f.parameters && f.parameters.length > 5
  );
  
  if (manyParamFunctions.length > 0) {
    recommendations.push(`Simplify ${manyParamFunctions.length} functions with too many parameters`);
  }
  
  // If no issues, provide positive recommendations
  if (recommendations.length === 0) {
    recommendations.push('Code quality is good! Consider adding more comprehensive tests');
    recommendations.push('Share your quality practices with other teams');
  }
  
  return recommendations;
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
