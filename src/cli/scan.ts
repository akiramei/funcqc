import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { globby } from 'globby';
import {
  ScanCommandOptions,
  FunctionInfo,
  CliComponents,
  FuncqcConfig,
  SpinnerInterface,
} from '../types';
import { ConfigManager } from '../core/config';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { QualityCalculator } from '../metrics/quality-calculator';
import { QualityScorer } from '../utils/quality-scorer';
import { ParallelFileProcessor, ParallelProcessingResult } from '../utils/parallel-processor';
import { RealTimeQualityGate, QualityAssessment } from '../core/realtime-quality-gate.js';

export async function scanCommand(options: ScanCommandOptions): Promise<void> {
  const spinner = ora();

  try {
    const config = await initializeScan();

    // Handle realtime gate mode
    if (options.realtimeGate) {
      await runRealtimeGateMode(config, options, spinner);
      return;
    }

    // Check for configuration changes and enforce comment requirement
    await checkConfigurationChanges(config, options, spinner);

    const scanPaths = determineScanPaths(config);
    const components = await initializeComponents(config, spinner);
    const files = await discoverFiles(scanPaths, config, spinner);

    if (files.length === 0) {
      console.log(chalk.yellow('No TypeScript files found to analyze.'));
      return;
    }

    const allFunctions = await performAnalysis(files, components, spinner);
    showAnalysisSummary(allFunctions);

    await saveResults(allFunctions, components.storage, options, spinner);
    showCompletionMessage();
  } catch (error) {
    handleScanError(error, options, spinner);
  }
}

async function initializeScan(): Promise<FuncqcConfig> {
  const configManager = new ConfigManager();
  return await configManager.load();
}

async function checkConfigurationChanges(
  config: FuncqcConfig,
  options: ScanCommandOptions,
  spinner: SpinnerInterface
): Promise<void> {
  const configManager = new ConfigManager();
  const currentConfigHash = configManager.generateScanConfigHash(config);

  // Initialize storage to check previous config
  const storage = new PGLiteStorageAdapter(config.storage.path!);
  await storage.init();

  try {
    const lastConfigHash = await storage.getLastConfigHash();

    if (lastConfigHash && lastConfigHash !== currentConfigHash && lastConfigHash !== 'unknown') {
      // Configuration has changed
      if (!options.comment) {
        spinner.fail('Configuration change detected');
        console.error(chalk.red('🚨 Scan configuration has changed since last snapshot!'));
        console.error(chalk.yellow('Previous config hash:'), lastConfigHash);
        console.error(chalk.yellow('Current config hash: '), currentConfigHash);
        console.error();
        console.error(chalk.red('A comment is required to document this change.'));
        console.error(chalk.blue('Usage: funcqc scan --comment "Reason for configuration change"'));
        console.error();
        console.error(chalk.gray('Examples:'));
        console.error(chalk.gray('  funcqc scan --comment "Added new src/components directory"'));
        console.error(
          chalk.gray('  funcqc scan --comment "Moved from src/ to lib/ folder structure"')
        );
        console.error(
          chalk.gray('  funcqc scan --comment "Updated exclude patterns for test files"')
        );

        process.exit(1);
      }

      // Valid comment provided
      console.log(chalk.blue('ℹ️  Configuration change detected and documented:'));
      console.log(chalk.gray(`   "${options.comment}"`));
      console.log();
    }
  } finally {
    await storage.close();
  }
}

function determineScanPaths(config: FuncqcConfig): string[] {
  return config.roots;
}

async function initializeComponents(
  config: FuncqcConfig,
  spinner: SpinnerInterface
): Promise<CliComponents> {
  spinner.start('Initializing funcqc scan...');

  // Configure analyzer based on expected project size
  // Parse NODE_OPTIONS to check for increased memory allocation
  const nodeOptions = process.env['NODE_OPTIONS'] || '';
  const hasIncreasedMemory = /--max-old-space-size[= ](\d+)/.test(nodeOptions);
  const maxSourceFilesInMemory = hasIncreasedMemory ? 100 : 50;
  const analyzer = new TypeScriptAnalyzer(maxSourceFilesInMemory);
  const storage = new PGLiteStorageAdapter(config.storage.path!);
  const qualityCalculator = new QualityCalculator();

  await storage.init();
  spinner.succeed('Components initialized');

  return { analyzer, storage, qualityCalculator };
}

async function discoverFiles(
  scanPaths: string[],
  config: FuncqcConfig,
  spinner: SpinnerInterface
): Promise<string[]> {
  spinner.start('Finding TypeScript files...');
  const files = await findTypeScriptFiles(scanPaths, config.exclude);
  spinner.succeed(`Found ${files.length} TypeScript files`);
  return files;
}

async function performAnalysis(
  files: string[],
  components: CliComponents,
  spinner: SpinnerInterface
): Promise<FunctionInfo[]> {
  spinner.start('Analyzing functions...');

  const allFunctions = await performFullAnalysis(files, components, spinner);

  spinner.succeed(`Analyzed ${allFunctions.length} functions from ${files.length} files`);
  return allFunctions;
}

async function performFullAnalysis(
  files: string[],
  components: CliComponents,
  spinner: SpinnerInterface
): Promise<FunctionInfo[]> {
  const allFunctions: FunctionInfo[] = [];

  // Determine processing strategy based on project size and system capabilities
  const useParallel = ParallelFileProcessor.shouldUseParallelProcessing(files.length);
  const useStreaming = files.length > 1000 && !useParallel; // Use streaming for very large projects when parallel isn't suitable

  if (useParallel) {
    spinner.text = `Using parallel processing for ${files.length} files...`;
    const result = await performParallelAnalysis(files, spinner);
    allFunctions.push(...result.functions);

    // Show parallel processing stats
    if (result.stats.workersUsed > 1) {
      spinner.text = `Parallel analysis completed: ${result.stats.workersUsed} workers, ${result.stats.avgFunctionsPerFile.toFixed(1)} functions/file`;
    }
  } else if (useStreaming) {
    spinner.text = `Using streaming mode for ${files.length} files...`;
    await performStreamingAnalysis(files, components, allFunctions, spinner);
  } else {
    const batchSize = 50; // Fixed batch size for smaller projects
    await performBatchAnalysis(files, components, allFunctions, batchSize, spinner);
  }

  return allFunctions;
}

async function performBatchAnalysis(
  files: string[],
  components: CliComponents,
  allFunctions: FunctionInfo[],
  batchSize: number,
  spinner: SpinnerInterface
): Promise<void> {
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchFunctions = await analyzeBatch(
      batch,
      components.analyzer,
      components.qualityCalculator
    );
    allFunctions.push(...batchFunctions);

    spinner.text = `Analyzing functions... (${i + batch.length}/${files.length} files)`;
  }
}

async function performParallelAnalysis(
  files: string[],
  spinner: SpinnerInterface
): Promise<ParallelProcessingResult> {
  const processor = new ParallelFileProcessor(ParallelFileProcessor.getRecommendedConfig());

  let completedFiles = 0;
  try {
    const result = await processor.processFiles(files, {
      onProgress: completed => {
        completedFiles = completed;
        spinner.text = `Parallel analysis: ${completedFiles}/${files.length} files processed...`;
      },
    });
    return result;
  } catch (error) {
    spinner.text = `Parallel processing failed, falling back to sequential analysis...`;
    console.warn(
      `Parallel processing error: ${error instanceof Error ? error.message : String(error)}`
    );

    // Fallback to sequential processing
    const analyzer = new TypeScriptAnalyzer();
    const qualityCalculator = new QualityCalculator();
    const allFunctions: FunctionInfo[] = [];
    const startTime = Date.now();

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      try {
        const functions = await analyzer.analyzeFile(filePath);
        for (const func of functions) {
          func.metrics = await qualityCalculator.calculate(func);
        }
        allFunctions.push(...functions);
      } catch (fileError) {
        console.warn(
          `Failed to analyze ${filePath}: ${fileError instanceof Error ? fileError.message : String(fileError)}`
        );
      }

      spinner.text = `Sequential analysis: ${i + 1}/${files.length} files processed...`;
    }

    await analyzer.cleanup();

    return {
      functions: allFunctions,
      stats: {
        totalFiles: files.length,
        totalFunctions: allFunctions.length,
        avgFunctionsPerFile: files.length > 0 ? allFunctions.length / files.length : 0,
        totalProcessingTime: Date.now() - startTime,
        workersUsed: 0, // Sequential processing uses 0 workers
      },
    };
  }
}

async function performStreamingAnalysis(
  files: string[],
  components: CliComponents,
  allFunctions: FunctionInfo[],
  spinner: SpinnerInterface
): Promise<void> {
  // Note: Streaming analysis requires analyzer method extension
  // For now, fall back to batch processing for large projects
  await performBatchAnalysis(files, components, allFunctions, 25, spinner); // Smaller batches for memory efficiency
}

async function saveResults(
  allFunctions: FunctionInfo[],
  storage: CliComponents['storage'],
  options: ScanCommandOptions,
  spinner: SpinnerInterface
): Promise<void> {
  spinner.start('Saving to database...');

  // Show estimated time for large datasets
  if (allFunctions.length > 5000) {
    const estimatedSeconds = Math.ceil(allFunctions.length / 200); // Rough estimate: 200 functions per second
    spinner.text = `Saving ${allFunctions.length} functions to database (estimated ${estimatedSeconds}s)...`;
  }

  const startTime = Date.now();
  const snapshotId = await storage.saveSnapshot(allFunctions, options.label, options.comment);
  const elapsed = Math.ceil((Date.now() - startTime) / 1000);

  if (allFunctions.length > 1000) {
    const functionsPerSecond = Math.round(allFunctions.length / elapsed);
    spinner.succeed(
      `Saved snapshot: ${snapshotId} (${elapsed}s, ${functionsPerSecond} functions/sec)`
    );
  } else {
    spinner.succeed(`Saved snapshot: ${snapshotId}`);
  }
}

function showCompletionMessage(): void {
  console.log(chalk.green('✓ Scan completed successfully!'));
  console.log();
  console.log(chalk.blue('Next steps:'));
  console.log(chalk.gray('  • Run `funcqc list` to view functions'));
  console.log(chalk.gray('  • Run `funcqc list --complexity ">5"` to find complex functions'));
  console.log(chalk.gray('  • Run `funcqc status` to see overall statistics'));
  console.log();
  console.log(chalk.blue('💡 Performance tips:'));
  console.log(
    chalk.gray('  • Set NODE_OPTIONS="--max-old-space-size=4096" for very large projects')
  );
}

function handleScanError(
  error: unknown,
  options: ScanCommandOptions,
  spinner: SpinnerInterface
): void {
  spinner.fail('Scan failed');
  console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));

  if (options.verbose && error instanceof Error) {
    console.error(chalk.gray(error.stack));
  }

  process.exit(1);
}

async function findTypeScriptFiles(roots: string[], excludePatterns: string[]): Promise<string[]> {
  // Create include patterns for TypeScript files in all roots
  const includePatterns = roots.flatMap(root => [
    path.join(root, '**/*.ts'),
    path.join(root, '**/*.tsx'),
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
      followSymbolicLinks: false,
    });

    return files;
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Warning: Error finding files: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return [];
  }
}

async function analyzeBatch(
  files: string[],
  analyzer: CliComponents['analyzer'],
  qualityCalculator: CliComponents['qualityCalculator']
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
      console.warn(
        chalk.yellow(
          `Warning: Failed to analyze ${file}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
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
  const gradeColor =
    qualityScore.overallGrade === 'A'
      ? chalk.green
      : qualityScore.overallGrade === 'B'
        ? chalk.blue
        : qualityScore.overallGrade === 'C'
          ? chalk.yellow
          : qualityScore.overallGrade === 'D'
            ? chalk.red
            : chalk.red;

  console.log(
    `  Overall Grade: ${gradeColor(qualityScore.overallGrade)} (${qualityScore.score}/100)`
  );
  console.log(
    `  Functions Analyzed: ${qualityScore.totalFunctions} in ${calculateFileCount(functions)} files`
  );

  if (qualityScore.highRiskFunctions > 0) {
    console.log(chalk.yellow(`  ⚠️  High Risk Functions: ${qualityScore.highRiskFunctions}`));
  } else {
    console.log(chalk.green(`  ✓ No high-risk functions detected`));
  }

  // Show performance statistics for large projects
  if (functions.length > 1000) {
    console.log();
    console.log(chalk.blue('🚀 Performance Stats:'));
    console.log(
      `  Project Size: ${functions.length > 10000 ? 'Very Large' : 'Large'} (${functions.length} functions)`
    );
    console.log(`  Memory Usage: ${estimateMemoryUsage(functions)} MB (estimated)`);
    console.log(
      `  Processing Mode: ${functions.length > 1000 ? 'Streaming' : 'Batch'} processing used`
    );
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

function estimateMemoryUsage(functions: FunctionInfo[]): number {
  // Rough estimation: each function uses about 2-5KB in memory
  const avgFunctionSize = 3; // KB
  return Math.round((functions.length * avgFunctionSize) / 1024); // Convert to MB
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
    highComplexity,
  };
}

/**
 * Run real-time quality gate mode with adaptive thresholds
 */
async function runRealtimeGateMode(
  config: FuncqcConfig,
  _options: ScanCommandOptions,
  spinner: typeof ora.prototype
): Promise<void> {
  spinner.start('Initializing real-time quality gate...');

  try {
    // Initialize storage and load existing baseline
    const storage = new PGLiteStorageAdapter(config.storage.path || '.funcqc/funcqc.db');
    await storage.init();

    // Get historical functions to build baseline
    const recentSnapshots = await storage.getSnapshots({ limit: 5 });
    const allHistoricalFunctions: FunctionInfo[] = [];

    for (const snapshot of recentSnapshots) {
      const functions = await storage.getFunctions(snapshot.id);
      allHistoricalFunctions.push(...functions);
    }

    // Initialize quality gate with baseline
    const qualityGate = new RealTimeQualityGate({
      warningThreshold: 2.0,
      criticalThreshold: 3.0,
      minBaselineFunctions: 20,
    });

    if (allHistoricalFunctions.length > 0) {
      qualityGate.updateBaseline(allHistoricalFunctions);
      spinner.succeed(
        `Baseline established from ${allHistoricalFunctions.length} historical functions`
      );
    } else {
      spinner.warn('No historical data found - using static thresholds');
    }

    // Analyze current files with real-time gate
    const scanPaths = determineScanPaths(config);
    const files = await discoverFiles(scanPaths, config, ora());

    if (files.length === 0) {
      console.log(chalk.yellow('No TypeScript files found to analyze.'));
      return;
    }

    console.log(chalk.cyan('\n🚀 Real-time Quality Gate Analysis\n'));

    let totalViolations = 0;
    let criticalViolations = 0;

    for (const file of files) {
      try {
        const fileContent = await import('fs/promises').then(fs => fs.readFile(file, 'utf-8'));
        const assessment = await qualityGate.evaluateCode(fileContent, { filename: file });

        if (
          !assessment.acceptable ||
          assessment.violations.length > 0 ||
          assessment.structuralAnomalies.length > 0
        ) {
          await displayQualityAssessment(file, assessment);
          totalViolations += assessment.violations.length + assessment.structuralAnomalies.length;
          criticalViolations +=
            assessment.violations.filter(v => v.severity === 'critical').length +
            assessment.structuralAnomalies.filter(a => a.severity === 'critical').length;
        }
      } catch (error) {
        console.log(
          chalk.red(
            `✗ Failed to analyze ${path.relative(process.cwd(), file)}: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }

    // Summary
    console.log(chalk.cyan('\n📊 Real-time Analysis Summary'));
    console.log(`Files analyzed: ${files.length}`);
    console.log(`Total violations: ${totalViolations}`);
    console.log(`Critical violations: ${criticalViolations}`);

    if (criticalViolations > 0) {
      console.log(
        chalk.red(`\n❌ Quality gate failed: ${criticalViolations} critical violations found`)
      );
      process.exit(1);
    } else if (totalViolations > 0) {
      console.log(
        chalk.yellow(`\n⚠️  Quality gate passed with warnings: ${totalViolations} violations found`)
      );
    } else {
      console.log(chalk.green('\n✅ Quality gate passed: All code meets quality standards'));
    }
  } catch (error) {
    spinner.fail(
      `Real-time quality gate failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * Display quality assessment results
 */
async function displayQualityAssessment(
  filePath: string,
  assessment: QualityAssessment
): Promise<void> {
  const relativePath = path.relative(process.cwd(), filePath);

  console.log(chalk.magenta(`\n📁 ${relativePath}`));
  console.log(`   Quality Score: ${assessment.qualityScore}/100`);
  console.log(`   Response Time: ${assessment.responseTime.toFixed(1)}ms`);

  if (assessment.violations.length > 0) {
    console.log(chalk.yellow('   Violations:'));
    for (const violation of assessment.violations) {
      const icon = violation.severity === 'critical' ? '🔴' : '🟡';
      console.log(
        `   ${icon} ${violation.metric}: ${violation.value} (threshold: ${violation.threshold.toFixed(1)})`
      );
      console.log(`      ${violation.suggestion}`);
    }
  }

  if (assessment.structuralAnomalies.length > 0) {
    console.log(chalk.magenta('   Structural Anomalies:'));
    for (const anomaly of assessment.structuralAnomalies) {
      const icon = anomaly.severity === 'critical' ? '🔴' : '🟡';
      console.log(
        `   ${icon} ${anomaly.metric}: ${anomaly.value.toFixed(3)} (expected: ${anomaly.expectedRange[0]}-${anomaly.expectedRange[1]})`
      );
      console.log(`      ${anomaly.suggestion}`);
    }
  }

  if (assessment.improvementInstruction) {
    console.log(chalk.blue(`   💡 Suggestion: ${assessment.improvementInstruction}`));
  }
}
