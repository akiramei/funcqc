import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { globby } from 'globby';
import { ScanCommandOptions, FunctionInfo, SnapshotDiff } from '../types';
import { ConfigManager } from '../core/config';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { QualityCalculator } from '../metrics/quality-calculator';
import { QualityScorer } from '../utils/quality-scorer';
import simpleGit from 'simple-git';

export async function scanCommand(
  paths: string[] = [],
  options: ScanCommandOptions
): Promise<void> {
  const spinner = ora();
  
  try {
    const config = await initializeScan();
    const scanPaths = determineScanPaths(paths, config);
    const components = await initializeComponents(config, spinner);
    const files = await discoverFiles(scanPaths, config, spinner);
    
    if (files.length === 0) {
      console.log(chalk.yellow('No TypeScript files found to analyze.'));
      return;
    }
    
    const allFunctions = await performAnalysis(files, components, options, spinner);
    showAnalysisSummary(allFunctions);
    
    // Handle comparison if requested
    if (options.compareWith) {
      await handleComparison(allFunctions, components.storage, options, spinner);
    }
    
    if (options.dryRun) {
      console.log(chalk.blue('🔍 Dry run mode - results not saved to database'));
      return;
    }
    
    await saveResults(allFunctions, components.storage, options, spinner);
    showCompletionMessage();
    
  } catch (error) {
    handleScanError(error, options, spinner);
  }
}

async function initializeScan() {
  const configManager = new ConfigManager();
  return await configManager.load();
}

function determineScanPaths(paths: string[], config: any): string[] {
  return paths.length > 0 ? paths : config.roots;
}

async function initializeComponents(config: any, spinner: any) {
  spinner.start('Initializing funcqc scan...');
  
  const analyzer = new TypeScriptAnalyzer();
  const storage = new PGLiteStorageAdapter(config.storage.path!);
  const qualityCalculator = new QualityCalculator();
  
  await storage.init();
  spinner.succeed('Components initialized');
  
  return { analyzer, storage, qualityCalculator };
}

async function discoverFiles(scanPaths: string[], config: any, spinner: any): Promise<string[]> {
  spinner.start('Finding TypeScript files...');
  const files = await findTypeScriptFiles(scanPaths, config.exclude);
  spinner.succeed(`Found ${files.length} TypeScript files`);
  return files;
}

async function performAnalysis(files: string[], components: any, options: ScanCommandOptions, spinner: any): Promise<FunctionInfo[]> {
  spinner.start('Analyzing functions...');
  const allFunctions: FunctionInfo[] = [];
  
  if (options.quick) {
    const batchFunctions = await performQuickAnalysis(files, components, spinner);
    allFunctions.push(...batchFunctions);
  } else {
    const batchFunctions = await performFullAnalysis(files, components, options, spinner);
    allFunctions.push(...batchFunctions);
  }
  
  spinner.succeed(`Analyzed ${allFunctions.length} functions from ${files.length} files`);
  return allFunctions;
}

async function performQuickAnalysis(files: string[], components: any, spinner: any): Promise<FunctionInfo[]> {
  const maxFiles = 100;
  const filesToAnalyze = files.length > maxFiles ? files.slice(0, maxFiles) : files;
  
  if (files.length > maxFiles) {
    spinner.text = `Quick scan: analyzing ${maxFiles} of ${files.length} files...`;
  }
  
  const batchFunctions = await analyzeBatch(filesToAnalyze, components.analyzer, components.qualityCalculator);
  
  if (files.length > maxFiles) {
    console.log(chalk.blue(`\nℹ️  Quick scan analyzed ${maxFiles}/${files.length} files (${Math.round((maxFiles/files.length)*100)}% sample)`));
  }
  
  return batchFunctions;
}

async function performFullAnalysis(files: string[], components: any, options: ScanCommandOptions, spinner: any): Promise<FunctionInfo[]> {
  const allFunctions: FunctionInfo[] = [];
  const batchSize = parseInt(options.batchSize || '50');
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchFunctions = await analyzeBatch(batch, components.analyzer, components.qualityCalculator);
    allFunctions.push(...batchFunctions);
    
    spinner.text = `Analyzing functions... (${i + batch.length}/${files.length} files)`;
  }
  
  return allFunctions;
}

async function saveResults(allFunctions: FunctionInfo[], storage: any, options: ScanCommandOptions, spinner: any): Promise<void> {
  spinner.start('Saving to database...');
  const snapshotId = await storage.saveSnapshot(allFunctions, options.label);
  spinner.succeed(`Saved snapshot: ${snapshotId}`);
}

function showCompletionMessage(): void {
  console.log(chalk.green('✓ Scan completed successfully!'));
  console.log();
  console.log(chalk.blue('Next steps:'));
  console.log(chalk.gray('  • Run `funcqc list` to view functions'));
  console.log(chalk.gray('  • Run `funcqc list --complexity ">5"` to find complex functions'));
  console.log(chalk.gray('  • Run `funcqc status` to see overall statistics'));
}

function handleScanError(error: any, options: ScanCommandOptions, spinner: any): void {
  spinner.fail('Scan failed');
  console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
  
  if (options.verbose && error instanceof Error) {
    console.error(chalk.gray(error.stack));
  }
  
  process.exit(1);
}

async function findTypeScriptFiles(
  roots: string[],
  excludePatterns: string[]
): Promise<string[]> {
  // Create include patterns for TypeScript files in all roots
  const includePatterns = roots.flatMap(root => [
    path.join(root, '**/*.ts'),
    path.join(root, '**/*.tsx')
  ]);

  // Convert exclude patterns to proper ignore patterns
  const ignorePatterns = excludePatterns.map(pattern => {
    // If pattern doesn't contain wildcards, treat as directory/file name
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return `**/${pattern}/**`;
    }
    return pattern;
  });

  try {
    const files = await globby(includePatterns, {
      ignore: ignorePatterns,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false
    });

    return files;
  } catch (error) {
    console.warn(chalk.yellow(`Warning: Error finding files: ${error instanceof Error ? error.message : String(error)}`));
    return [];
  }
}

async function analyzeBatch(
  files: string[],
  analyzer: TypeScriptAnalyzer,
  qualityCalculator: QualityCalculator
): Promise<FunctionInfo[]> {
  const functions: FunctionInfo[] = [];
  
  for (const file of files) {
    try {
      const fileFunctions = await analyzer.analyzeFile(file);
      
      // Calculate quality metrics for each function
      for (const func of fileFunctions) {
        func.metrics = await qualityCalculator.calculate(func);
      }
      
      functions.push(...fileFunctions);
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Failed to analyze ${file}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  
  return functions;
}

function showAnalysisSummary(functions: FunctionInfo[]): void {
  if (functions.length === 0) {
    return;
  }
  
  const stats = calculateStats(functions);
  const qualityScorer = new QualityScorer();
  const qualityScore = qualityScorer.calculateProjectScore(functions);
  
  console.log();
  console.log(chalk.blue('📊 Project Quality Overview:'));
  
  // Quality grade with color coding
  const gradeColor = qualityScore.overallGrade === 'A' ? chalk.green :
                     qualityScore.overallGrade === 'B' ? chalk.blue :
                     qualityScore.overallGrade === 'C' ? chalk.yellow :
                     qualityScore.overallGrade === 'D' ? chalk.red : chalk.red;
  
  console.log(`  Overall Grade: ${gradeColor(qualityScore.overallGrade)} (${qualityScore.score}/100)`);
  console.log(`  Functions Analyzed: ${qualityScore.totalFunctions} in ${calculateFileCount(functions)} files`);
  
  if (qualityScore.highRiskFunctions > 0) {
    console.log(chalk.yellow(`  ⚠️  High Risk Functions: ${qualityScore.highRiskFunctions}`));
  } else {
    console.log(chalk.green(`  ✓ No high-risk functions detected`));
  }
  
  console.log();
  console.log(chalk.blue('📈 Quality Breakdown:'));
  console.log(`  Complexity Score: ${qualityScore.complexityScore}/100`);
  console.log(`  Maintainability Score: ${qualityScore.maintainabilityScore}/100`);
  console.log(`  Size Score: ${qualityScore.sizeScore}/100`);
  console.log(`  Code Quality Score: ${qualityScore.codeQualityScore}/100`);
  
  // Show top problematic functions if any
  if (qualityScore.topProblematicFunctions.length > 0) {
    console.log();
    console.log(chalk.yellow('🏆 Top Functions Needing Attention:'));
    qualityScore.topProblematicFunctions.slice(0, 3).forEach((func, index) => {
      const shortPath = func.filePath.split('/').slice(-2).join('/');
      console.log(`  ${index + 1}. ${chalk.cyan(func.name)} (${shortPath})`);
      console.log(`     Complexity: ${func.complexity}, ${func.reason}`);
    });
  }
  
  console.log();
  console.log(chalk.blue('📊 Additional Stats:'));
  console.log(`  Exported functions: ${stats.exported}`);
  console.log(`  Async functions: ${stats.async}`);
  console.log(`  Average complexity: ${stats.avgComplexity.toFixed(1)}`);
  console.log(`  Average lines: ${stats.avgLines.toFixed(1)}`);
}

function calculateFileCount(functions: FunctionInfo[]): number {
  const uniqueFiles = new Set(functions.map(f => f.filePath));
  return uniqueFiles.size;
}

function calculateStats(functions: FunctionInfo[]) {
  const total = functions.length;
  const exported = functions.filter(f => f.isExported).length;
  const async = functions.filter(f => f.isAsync).length;
  const arrow = functions.filter(f => f.isArrowFunction).length;
  const methods = functions.filter(f => f.isMethod).length;
  
  const complexities = functions.map(f => f.metrics?.cyclomaticComplexity || 1);
  const lines = functions.map(f => f.metrics?.linesOfCode || 0);
  
  const avgComplexity = complexities.reduce((a, b) => a + b, 0) / total;
  const avgLines = lines.reduce((a, b) => a + b, 0) / total;
  const maxComplexity = Math.max(...complexities);
  const highComplexity = complexities.filter(c => c > 10).length;
  
  return {
    total,
    exported,
    async,
    arrow,
    methods,
    avgComplexity,
    avgLines,
    maxComplexity,
    highComplexity
  };
}

async function handleComparison(
  currentFunctions: FunctionInfo[],
  storage: PGLiteStorageAdapter,
  options: ScanCommandOptions,
  spinner: any
): Promise<void> {
  try {
    spinner.start('Comparing with previous snapshot...');
    
    // Resolve the comparison snapshot ID
    const compareSnapshotId = await resolveComparisonSnapshot(storage, options.compareWith!);
    
    if (!compareSnapshotId) {
      spinner.warn(`Could not find snapshot: ${options.compareWith}`);
      return;
    }
    
    // Create temporary snapshot for current state
    const tempSnapshotId = await storage.saveSnapshot(currentFunctions, 'temp-comparison');
    
    // Calculate diff
    const diff = await storage.diffSnapshots(compareSnapshotId, tempSnapshotId);
    
    // Delete temporary snapshot
    await storage.deleteSnapshot(tempSnapshotId);
    
    spinner.succeed('Comparison completed');
    
    // Display quality change report
    displayQualityChangeReport(diff);
    
  } catch (error) {
    spinner.fail('Comparison failed');
    console.error(chalk.red('Comparison error:'), error instanceof Error ? error.message : String(error));
  }
}

async function resolveComparisonSnapshot(storage: PGLiteStorageAdapter, identifier: string): Promise<string | null> {
  const result = await trySpecialIdentifiers(storage, identifier);
  if (result) return result;
  
  return await tryGeneralResolution(storage, identifier);
}

async function trySpecialIdentifiers(storage: PGLiteStorageAdapter, identifier: string): Promise<string | null> {
  if (identifier === 'latest' || identifier === 'HEAD') {
    return await resolveLatestSnapshot(storage);
  }
  
  if (identifier === 'yesterday') {
    return await resolveYesterdaySnapshot(storage);
  }
  
  if (identifier === 'main') {
    return await resolveMainBranchSnapshot(storage);
  }
  
  if (identifier.startsWith('HEAD~')) {
    return await resolveHeadOffsetSnapshot(storage, identifier);
  }
  
  return null;
}

async function resolveLatestSnapshot(storage: PGLiteStorageAdapter): Promise<string | null> {
  const snapshots = await storage.getSnapshots({ limit: 1 });
  return snapshots[0]?.id || null;
}

async function resolveYesterdaySnapshot(storage: PGLiteStorageAdapter): Promise<string | null> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(23, 59, 59, 999);
  
  const snapshots = await storage.getSnapshots();
  const snapshot = snapshots.find(s => s.createdAt <= yesterday.getTime());
  return snapshot?.id || null;
}

async function resolveMainBranchSnapshot(storage: PGLiteStorageAdapter): Promise<string | null> {
  const git = simpleGit();
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return null;
    
    const snapshots = await storage.getSnapshots();
    
    // Try main commit first
    const mainCommit = await git.revparse(['main']);
    const commitSnapshot = snapshots.find(s => s.gitCommit === mainCommit);
    if (commitSnapshot) return commitSnapshot.id;
    
    // Fallback to main branch
    const branchSnapshot = snapshots.find(s => s.gitBranch === 'main');
    return branchSnapshot?.id || null;
  } catch {
    return null;
  }
}

async function resolveHeadOffsetSnapshot(storage: PGLiteStorageAdapter, identifier: string): Promise<string | null> {
  const offset = parseInt(identifier.slice(5)) || 1;
  const snapshots = await storage.getSnapshots();
  const target = snapshots[offset];
  return target?.id || null;
}

async function tryGeneralResolution(storage: PGLiteStorageAdapter, identifier: string): Promise<string | null> {
  // Try exact match
  const exact = await storage.getSnapshot(identifier);
  if (exact) return identifier;
  
  const snapshots = await storage.getSnapshots();
  
  // Try partial ID match
  const partial = snapshots.find(s => s.id.startsWith(identifier));
  if (partial) return partial.id;
  
  // Try label match
  const labeled = snapshots.find(s => s.label === identifier);
  return labeled?.id || null;
}

function displayQualityChangeReport(diff: SnapshotDiff): void {
  displayQualityChangeHeader(diff);
  displayQualityDirection(diff);
  displayFunctionChangesOverview(diff);
  displayQualityMetricsChanges(diff);
  displayOptionalSections(diff);
}

function displayQualityChangeHeader(diff: SnapshotDiff): void {
  console.log();
  console.log(chalk.cyan.bold('📊 Quality Change Summary'));
  console.log('═'.repeat(50));
  console.log();
  
  const fromTime = formatDate(diff.from.createdAt);
  const toTime = 'current scan';
  console.log(`${chalk.bold('Comparing:')} ${fromTime} → ${toTime}`);
  console.log();
}

function displayQualityDirection(diff: SnapshotDiff): void {
  const qualityDirection = getQualityDirection(diff);
  console.log(`${qualityDirection.icon} ${qualityDirection.color.bold('Overall Quality:')} ${qualityDirection.color(qualityDirection.description)}`);
  console.log();
}

function displayFunctionChangesOverview(diff: SnapshotDiff): void {
  const stats = diff.statistics;
  
  console.log(chalk.bold('📈 Function Changes:'));
  if (stats.addedCount > 0) {
    console.log(`  ${chalk.green('✅')} ${chalk.green.bold(stats.addedCount)} functions added`);
  }
  if (stats.removedCount > 0) {
    console.log(`  ${chalk.red('❌')} ${chalk.red.bold(stats.removedCount)} functions removed`);
  }
  if (stats.modifiedCount > 0) {
    console.log(`  ${chalk.yellow('🔄')} ${chalk.yellow.bold(stats.modifiedCount)} functions modified`);
  }
  if (diff.unchanged.length > 0) {
    console.log(`  ${chalk.gray('➖')} ${chalk.gray(diff.unchanged.length)} functions unchanged`);
  }
  console.log();
}

function displayQualityMetricsChanges(diff: SnapshotDiff): void {
  const stats = diff.statistics;
  
  console.log(chalk.bold('📊 Quality Metrics:'));
  
  if (stats.complexityChange !== 0) {
    displayComplexityChange(stats.complexityChange);
  }
  
  if (stats.linesChange !== 0) {
    displayLinesChange(stats.linesChange);
  }
  
  if (stats.complexityChange === 0 && stats.linesChange === 0) {
    console.log(`  ${chalk.green('✅')} No significant metric changes detected`);
  }
  console.log();
}

function displayComplexityChange(complexityChange: number): void {
  const complexityIcon = complexityChange > 0 ? '⚠️' : '✅';
  const complexityColor = complexityChange > 0 ? chalk.red : chalk.green;
  const changeStr = complexityChange > 0 ? `+${complexityChange}` : complexityChange.toString();
  const description = complexityChange > 0 ? '(increased)' : '(improved)';
  console.log(`  ${complexityIcon} Complexity: ${complexityColor(changeStr)} ${description}`);
}

function displayLinesChange(linesChange: number): void {
  const linesIcon = linesChange > 0 ? '📝' : '✂️';
  const changeStr = linesChange > 0 ? `+${linesChange}` : linesChange.toString();
  console.log(`  ${linesIcon} Lines of Code: ${chalk.blue(changeStr)}`);
}

function displayOptionalSections(diff: SnapshotDiff): void {
  if (diff.modified.length > 0 || diff.statistics.complexityChange > 0) {
    displayActionableRecommendations(diff);
  }
  
  const topChanges = getTopFunctionChanges(diff.modified);
  if (topChanges.improved.length > 0 || topChanges.degraded.length > 0) {
    displayTopChanges(topChanges);
  }
}

function getQualityDirection(diff: SnapshotDiff) {
  const { complexityChange, addedCount, removedCount } = diff.statistics;
  
  // Calculate overall impact score
  let score = 0;
  score -= complexityChange * 2; // Complexity changes are heavily weighted
  score += addedCount * 0.5; // New functions are slightly positive
  score -= removedCount * 0.3; // Removed functions are slightly negative
  
  // Count improved vs degraded functions
  const improvedFunctions = diff.modified.filter(f => 
    f.changes.some(c => c.field === 'cyclomaticComplexity' && Number(c.newValue) < Number(c.oldValue))
  ).length;
  
  const degradedFunctions = diff.modified.filter(f => 
    f.changes.some(c => c.field === 'cyclomaticComplexity' && Number(c.newValue) > Number(c.oldValue))
  ).length;
  
  score += improvedFunctions * 2;
  score -= degradedFunctions * 3;
  
  if (score > 2) {
    return {
      icon: '🟢',
      color: chalk.green,
      description: 'Quality improved significantly'
    };
  } else if (score > 0) {
    return {
      icon: '🔵',
      color: chalk.blue,
      description: 'Quality improved slightly'
    };
  } else if (score > -2) {
    return {
      icon: '🟡',
      color: chalk.yellow,
      description: 'Quality remained stable'
    };
  } else {
    return {
      icon: '🔴',
      color: chalk.red,
      description: 'Quality degraded - attention needed'
    };
  }
}

function displayActionableRecommendations(diff: SnapshotDiff): void {
  console.log(chalk.bold('🎯 Recommended Actions:'));
  
  const highImpactChanges = diff.modified.filter(f => 
    f.changes.some(c => c.impact === 'high')
  );
  
  if (highImpactChanges.length > 0) {
    console.log(`  ${chalk.red('🚨')} ${highImpactChanges.length} functions need immediate attention:`);
    highImpactChanges.slice(0, 3).forEach(func => {
      const complexityChange = func.changes.find(c => c.field === 'cyclomaticComplexity');
      if (complexityChange && Number(complexityChange.newValue) > Number(complexityChange.oldValue)) {
        const increase = Number(complexityChange.newValue) - Number(complexityChange.oldValue);
        console.log(`     • ${chalk.cyan(func.after.name)} (+${increase} complexity) - Consider refactoring`);
      }
    });
  }
  
  const improvedFunctions = diff.modified.filter(f => 
    f.changes.some(c => c.field === 'cyclomaticComplexity' && Number(c.newValue) < Number(c.oldValue))
  );
  
  if (improvedFunctions.length > 0) {
    console.log(`  ${chalk.green('✅')} ${improvedFunctions.length} functions improved - great work!`);
    console.log(`     Consider documenting successful refactoring patterns for team sharing`);
  }
  
  console.log();
}

function getTopFunctionChanges(modified: any[]) {
  const improved = modified
    .filter(f => f.changes.some((c: any) => c.field === 'cyclomaticComplexity' && Number(c.newValue) < Number(c.oldValue)))
    .sort((a, b) => {
      const aChange = a.changes.find((c: any) => c.field === 'cyclomaticComplexity');
      const bChange = b.changes.find((c: any) => c.field === 'cyclomaticComplexity');
      const aImprovement = Number(aChange?.oldValue || 0) - Number(aChange?.newValue || 0);
      const bImprovement = Number(bChange?.oldValue || 0) - Number(bChange?.newValue || 0);
      return bImprovement - aImprovement;
    })
    .slice(0, 3);
  
  const degraded = modified
    .filter(f => f.changes.some((c: any) => c.field === 'cyclomaticComplexity' && Number(c.newValue) > Number(c.oldValue)))
    .sort((a, b) => {
      const aChange = a.changes.find((c: any) => c.field === 'cyclomaticComplexity');
      const bChange = b.changes.find((c: any) => c.field === 'cyclomaticComplexity');
      const aDegradation = Number(aChange?.newValue || 0) - Number(aChange?.oldValue || 0);
      const bDegradation = Number(bChange?.newValue || 0) - Number(bChange?.oldValue || 0);
      return bDegradation - aDegradation;
    })
    .slice(0, 3);
  
  return { improved, degraded };
}

function displayTopChanges(changes: { improved: any[], degraded: any[] }): void {
  if (changes.improved.length > 0) {
    console.log(chalk.green.bold('🏆 Top Improved Functions:'));
    changes.improved.forEach((func, index) => {
      const complexityChange = func.changes.find((c: any) => c.field === 'cyclomaticComplexity');
      const improvement = Number(complexityChange.oldValue) - Number(complexityChange.newValue);
      const shortPath = func.after.filePath.split('/').slice(-2).join('/');
      console.log(`  ${index + 1}. ${chalk.cyan(func.after.name)} (${shortPath})`);
      console.log(`     Complexity: ${complexityChange.oldValue} → ${complexityChange.newValue} (${chalk.green(`-${improvement}`)})`);
    });
    console.log();
  }
  
  if (changes.degraded.length > 0) {
    console.log(chalk.red.bold('⚠️  Functions Needing Attention:'));
    changes.degraded.forEach((func, index) => {
      const complexityChange = func.changes.find((c: any) => c.field === 'cyclomaticComplexity');
      const degradation = Number(complexityChange.newValue) - Number(complexityChange.oldValue);
      const shortPath = func.after.filePath.split('/').slice(-2).join('/');
      console.log(`  ${index + 1}. ${chalk.cyan(func.after.name)} (${shortPath})`);
      console.log(`     Complexity: ${complexityChange.oldValue} → ${complexityChange.newValue} (${chalk.red(`+${degradation}`)})`);
      console.log(`     ${chalk.gray('→ Consider breaking into smaller functions or reducing conditional logic')}`);
    });
    console.log();
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  // Less than 1 hour ago
  if (diffMs < 60 * 60 * 1000) {
    const minutes = Math.floor(diffMs / (60 * 1000));
    return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  }
  
  // Less than 24 hours ago
  if (diffMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    return `${hours}h ago`;
  }
  
  // Less than 7 days ago
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }
  
  // More than 7 days ago - show date
  return date.toLocaleDateString();
}
