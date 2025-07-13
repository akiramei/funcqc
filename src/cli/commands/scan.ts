import { ScanCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { TypeScriptAnalyzer } from '../../analyzers/typescript-analyzer';
import { QualityCalculator } from '../../metrics/quality-calculator';
import chalk from 'chalk';
import { globby } from 'globby';

interface ScanResult {
  snapshotId: string;
  functionsAnalyzed: number;
  filesScanned: number;
  processingTime: number;
  qualityOverview: {
    averageComplexity: number;
    highRiskFunctions: number;
    overallGrade: string;
  };
}

/**
 * Scan command as a Reader function
 */
export const scanCommand: VoidCommand<ScanCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🔍 Starting TypeScript function analysis...');
      
      const result = await performScan(options)(env);
      
      if (options.json) {
        outputScanJSON(result);
      } else {
        outputScanReport(result, env);
      }
    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Scan failed: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Perform the actual scan - Reader function
 */
const performScan = (options: ScanCommandOptions) =>
  async (env: CommandEnvironment): Promise<ScanResult> => {
    const startTime = Date.now();
    
    // Find TypeScript files
    const files = await findTypeScriptFiles(env);
    env.commandLogger.info(`📁 Found ${files.length} TypeScript files`);
    
    if (files.length === 0) {
      throw new Error('No TypeScript files found. Are you in a TypeScript project?');
    }

    // Analyze files
    const analyzer = new TypeScriptAnalyzer();
    const qualityCalculator = new QualityCalculator();
    const allFunctions: any[] = [];

    let processedFiles = 0;
    for (const file of files) {
      try {
        // Check if we should skip this file (unless forced)
        if (!options.force && !shouldProcessFile(file, env)) {
          continue;
        }

        env.commandLogger.log(`📝 Analyzing ${file}...`);
        
        // Analyze the file
        const functions = await analyzer.analyzeFile(file);
        
        // Calculate metrics for each function
        for (const func of functions) {
          const metrics = (qualityCalculator as any).calculateMetrics(func);
          allFunctions.push({
            ...func,
            metrics,
            filePath: file,
          });
        }
        
        processedFiles++;
      } catch (error) {
        env.commandLogger.warn(`⚠️  Failed to analyze ${file}: ${error}`);
      }
    }

    if (allFunctions.length === 0) {
      throw new Error('No functions found in the analyzed files.');
    }

    // Save to database
    env.commandLogger.info(`💾 Saving ${allFunctions.length} functions to database...`);
    const snapshotId = await (env.storage as any).saveFunctions(allFunctions, {
      gitCommit: await getGitCommit(),
      timestamp: new Date().toISOString(),
      totalFiles: processedFiles,
      config: env.config,
    });

    const processingTime = Date.now() - startTime;

    // Calculate quality overview
    const averageComplexity = allFunctions
      .filter(f => f.metrics?.cyclomaticComplexity)
      .reduce((sum, f) => sum + f.metrics.cyclomaticComplexity, 0) / allFunctions.length;
    
    const highRiskFunctions = allFunctions.filter(f => 
      f.metrics?.cyclomaticComplexity > 10 || 
      f.metrics?.linesOfCode > 50
    ).length;

    const qualityScore = calculateQualityScore(allFunctions);
    const overallGrade = getGradeFromScore(qualityScore) || 'Unknown';

    return {
      snapshotId,
      functionsAnalyzed: allFunctions.length,
      filesScanned: processedFiles,
      processingTime,
      qualityOverview: {
        averageComplexity: Math.round(averageComplexity * 10) / 10,
        highRiskFunctions,
        overallGrade,
      },
    };
  };

/**
 * Find TypeScript files to analyze
 */
async function findTypeScriptFiles(env: CommandEnvironment): Promise<string[]> {
  const excludePatterns = [
    'node_modules/**',
    'dist/**',
    'build/**',
    '.git/**',
    '**/*.d.ts', // Exclude type definition files
    '**/*.test.ts',
    '**/*.spec.ts',
    ...((env.config as any).analysis?.excludePatterns || []),
  ];

  const includePatterns = (env.config as any).analysis?.includePatterns || [
    '**/*.ts',
    '**/*.tsx',
  ];

  const files = await globby(includePatterns, {
    ignore: excludePatterns,
    absolute: true,
  });

  return files.sort();
}

/**
 * Check if file should be processed (based on modification time, etc.)
 */
function shouldProcessFile(_file: string, _env: CommandEnvironment): boolean {
  // For now, always process (in a real implementation, you'd check modification times)
  return true;
}

/**
 * Get current git commit hash
 */
async function getGitCommit(): Promise<string | undefined> {
  try {
    const { execSync } = require('child_process');
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    return commit;
  } catch {
    return undefined;
  }
}

/**
 * Calculate overall quality score
 */
function calculateQualityScore(functions: any[]): number {
  if (functions.length === 0) return 0;

  const complexityScore = Math.max(0, 100 - (functions
    .filter(f => f.metrics?.cyclomaticComplexity)
    .reduce((sum, f) => sum + f.metrics.cyclomaticComplexity, 0) / functions.length) * 5);

  const sizeScore = Math.max(0, 100 - (functions
    .filter(f => f.metrics?.linesOfCode)
    .reduce((sum, f) => sum + f.metrics.linesOfCode, 0) / functions.length) * 2);

  return Math.round((complexityScore + sizeScore) / 2);
}

/**
 * Get letter grade from numeric score
 */
function getGradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Output scan results as JSON
 */
function outputScanJSON(result: ScanResult): void {
  const output = {
    snapshot_id: result.snapshotId,
    functions_analyzed: result.functionsAnalyzed,
    files_scanned: result.filesScanned,
    processing_time_ms: result.processingTime,
    quality_overview: result.qualityOverview,
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output formatted scan report
 */
function outputScanReport(result: ScanResult, _env: CommandEnvironment): void {
  console.log(chalk.green('✅ Scan completed successfully!\n'));
  
  console.log(chalk.bold('📊 Project Quality Overview:'));
  const gradeColor = result.qualityOverview.overallGrade === 'A' ? chalk.green : 
                    result.qualityOverview.overallGrade === 'B' ? chalk.yellow : chalk.red;
  console.log(`  Overall Grade: ${gradeColor(result.qualityOverview.overallGrade)}`);
  console.log(`  Functions Analyzed: ${result.functionsAnalyzed} in ${result.filesScanned} files`);
  
  if (result.qualityOverview.highRiskFunctions > 0) {
    console.log(chalk.yellow(`  ⚠️  High Risk Functions: ${result.qualityOverview.highRiskFunctions}`));
  } else {
    console.log(chalk.green(`  ✅ High Risk Functions: ${result.qualityOverview.highRiskFunctions}`));
  }
  console.log('');

  console.log(chalk.bold('🚀 Performance Stats:'));
  const processingSpeed = Math.round(result.functionsAnalyzed / (result.processingTime / 1000));
  console.log(`  Processing Time: ${(result.processingTime / 1000).toFixed(1)}s`);
  console.log(`  Analysis Speed: ${processingSpeed} functions/sec`);
  console.log(`  Average Complexity: ${result.qualityOverview.averageComplexity}`);
  console.log('');

  console.log(chalk.bold('📋 Quality Breakdown:'));
  console.log(`  Complexity Score: ${getComplexityDescription(result.qualityOverview.averageComplexity)}`);
  console.log(`  Snapshot ID: ${result.snapshotId.substring(0, 8)}`);
  console.log('');

  console.log(chalk.gray('Next steps:'));
  console.log(chalk.gray('  • Run `funcqc list` to view functions'));
  console.log(chalk.gray('  • Run `funcqc list --complexity ">5"` to find complex functions'));
  console.log(chalk.gray('  • Run `funcqc health` to see overall project health'));
  
  if (result.qualityOverview.highRiskFunctions > 0) {
    console.log('');
    console.log(chalk.yellow('💡 Recommendations:'));
    console.log(chalk.yellow(`  • Review the ${result.qualityOverview.highRiskFunctions} high-risk functions`));
    console.log(chalk.yellow('  • Consider breaking down complex functions'));
    console.log(chalk.yellow('  • Use `funcqc show <function-name>` for detailed analysis'));
  }
}

/**
 * Get description for complexity score
 */
function getComplexityDescription(avgComplexity: number): string {
  if (avgComplexity <= 2) return chalk.green('Excellent');
  if (avgComplexity <= 4) return chalk.yellow('Good');
  if (avgComplexity <= 6) return chalk.hex('#FFA500')('Fair'); // orange color
  return chalk.red('Needs Improvement');
}