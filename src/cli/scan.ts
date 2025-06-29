import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { globby } from 'globby';
import { ScanCommandOptions, FunctionInfo } from '../types';
import { ConfigManager } from '../core/config';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { QualityCalculator } from '../metrics/quality-calculator';
import { QualityScorer } from '../utils/quality-scorer';

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
