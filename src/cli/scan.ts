import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ScanCommandOptions, FunctionInfo } from '../types';
import { ConfigManager } from '../core/config';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { QualityCalculator } from '../metrics/quality-calculator';

export async function scanCommand(
  paths: string[] = [],
  options: ScanCommandOptions
): Promise<void> {
  const spinner = ora();
  
  try {
    // Load configuration
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    // Determine scan targets
    const scanPaths = paths.length > 0 ? paths : config.roots;
    
    spinner.start('Initializing funcqc scan...');
    
    // Initialize components
    const analyzer = new TypeScriptAnalyzer();
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    const qualityCalculator = new QualityCalculator();
    
    await storage.init();
    spinner.succeed('Components initialized');
    
    // Find TypeScript files
    spinner.start('Finding TypeScript files...');
    const files = await findTypeScriptFiles(scanPaths, config.exclude);
    spinner.succeed(`Found ${files.length} TypeScript files`);
    
    if (files.length === 0) {
      console.log(chalk.yellow('No TypeScript files found to analyze.'));
      return;
    }
    
    // Analyze functions
    spinner.start('Analyzing functions...');
    const allFunctions: FunctionInfo[] = [];
    const batchSize = parseInt(options.batchSize || '50');
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const batchFunctions = await analyzeBatch(batch, analyzer, qualityCalculator);
      allFunctions.push(...batchFunctions);
      
      spinner.text = `Analyzing functions... (${i + batch.length}/${files.length} files)`;
    }
    
    spinner.succeed(`Analyzed ${allFunctions.length} functions from ${files.length} files`);
    
    // Show analysis summary
    showAnalysisSummary(allFunctions);
    
    // Save to storage (unless dry-run)
    if (options.dryRun) {
      console.log(chalk.blue('🔍 Dry run mode - results not saved to database'));
      return;
    }
    
    spinner.start('Saving to database...');
    const snapshotId = await storage.saveSnapshot(allFunctions, options.label);
    spinner.succeed(`Saved snapshot: ${snapshotId}`);
    
    console.log(chalk.green('✓ Scan completed successfully!'));
    console.log();
    console.log(chalk.blue('Next steps:'));
    console.log(chalk.gray('  • Run `funcqc list` to view functions'));
    console.log(chalk.gray('  • Run `funcqc list --complexity ">5"` to find complex functions'));
    console.log(chalk.gray('  • Run `funcqc status` to see overall statistics'));
    
  } catch (error) {
    spinner.fail('Scan failed');
    console.error(chalk.red('Error:'), error.message);
    
    if (options.verbose) {
      console.error(chalk.gray(error.stack));
    }
    
    process.exit(1);
  }
}

async function findTypeScriptFiles(
  roots: string[],
  excludePatterns: string[]
): Promise<string[]> {
  const files: string[] = [];
  
  for (const root of roots) {
    const rootFiles = await findFilesRecursive(root, excludePatterns);
    files.push(...rootFiles);
  }
  
  return files.filter(file => 
    file.endsWith('.ts') || file.endsWith('.tsx')
  );
}

async function findFilesRecursive(
  dir: string,
  excludePatterns: string[]
): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      // Check exclude patterns
      if (shouldExclude(fullPath, excludePatterns)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        const subFiles = await findFilesRecursive(fullPath, excludePatterns);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Directory might not exist or be inaccessible
    console.warn(chalk.yellow(`Warning: Cannot access ${dir}`));
  }
  
  return files;
}

function shouldExclude(filePath: string, patterns: string[]): boolean {
  // Simple pattern matching - in production, use a proper glob library
  for (const pattern of patterns) {
    if (pattern.includes('**')) {
      // Handle **/ patterns
      const simplifiedPattern = pattern.replace('**/', '').replace('**', '');
      if (filePath.includes(simplifiedPattern)) {
        return true;
      }
    } else if (pattern.includes('*')) {
      // Handle simple * patterns
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(filePath)) {
        return true;
      }
    } else {
      // Exact match
      if (filePath.includes(pattern)) {
        return true;
      }
    }
  }
  
  return false;
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
      console.warn(chalk.yellow(`Warning: Failed to analyze ${file}: ${error.message}`));
    }
  }
  
  return functions;
}

function showAnalysisSummary(functions: FunctionInfo[]): void {
  if (functions.length === 0) {
    return;
  }
  
  const stats = calculateStats(functions);
  
  console.log();
  console.log(chalk.blue('📊 Analysis Summary:'));
  console.log(`  Total functions: ${stats.total}`);
  console.log(`  Exported functions: ${stats.exported}`);
  console.log(`  Async functions: ${stats.async}`);
  console.log(`  Arrow functions: ${stats.arrow}`);
  console.log(`  Methods: ${stats.methods}`);
  console.log();
  console.log(chalk.blue('📈 Quality Metrics:'));
  console.log(`  Average complexity: ${stats.avgComplexity.toFixed(1)}`);
  console.log(`  Average lines: ${stats.avgLines.toFixed(1)}`);
  console.log(`  Max complexity: ${stats.maxComplexity}`);
  console.log(`  Functions over complexity threshold: ${stats.highComplexity}`);
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
