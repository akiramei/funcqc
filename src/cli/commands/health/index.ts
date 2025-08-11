/**
 * Health command main entry point
 */

import chalk from 'chalk';
import { HealthCommandOptions } from '../../../types';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { ErrorCode, createErrorHandler } from '../../../utils/error-handler';
import { DatabaseError } from '../../../storage/pglite-adapter';
import { resolveSnapshotId } from '../../../utils/snapshot-resolver';
import { calculateQualityMetrics } from './calculator';
import { SnapshotInfo, FunctionInfo, EvaluationMode, DynamicWeightConfig } from '../../../types';
import { analyzeStructuralMetrics, getSCCCacheStats } from './structural-analyzer';
import { calculateMaxDirectoryDepth } from '../../../utils/file-utils';
import { displayHealthOverview, displayStructuralHealth, formatDateTime } from './display';
import { defaultLayerDetector } from '../../../analyzers/architecture-layer-detector';
import { createDynamicWeightCalculator } from '../../../analyzers/dynamic-weight-calculator';
import { 
  StatisticalEvaluator, 
  ThresholdEvaluator, 
  assessAllFunctions, 
  calculateRiskDistribution,
  calculateAverageRiskScore,
  calculateEnhancedRiskStats 
} from './risk-evaluator';
import { generateRiskAnalysis } from './recommendations';
import { displayTrendAnalysis } from './trend-analyzer';
import { HealthDataForJSON, FunctionRiskAssessment, StructuralMetrics, HealthData, PageRankMetrics } from './types';
import { FunctionContext } from '../../../types/dynamic-weights';
import { DynamicWeightCalculator } from '../../../analyzers/dynamic-weight-calculator';
import { analyzeProgrammingStyleDistribution, displayProgrammingStyleDistribution } from './programming-style-analyzer';
import { ArgumentUsageAnalyzer } from '../../../analyzers/argument-usage-analyzer';
import { ArgumentUsageAggregator, type ArgumentUsageMetrics } from '../../../analyzers/argument-usage-aggregator';

/**
 * Health command as a Reader function
 * Uses shared storage and config from environment
 */
export const healthCommand: VoidCommand<HealthCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.log('🔍 Analyzing project health...');
      
      await executeHealthCommand(env, options);
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
          `Health analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute health command with options
 */
async function executeHealthCommand(env: CommandEnvironment, options: HealthCommandOptions): Promise<void> {
  // Force JSON mode if --json flag is present in command line
  const isJsonMode = options.json || options.aiOptimized || process.argv.includes('--json');

  if (isJsonMode) {
    await handleJsonOutput(env, options);
  } else {
    await displayHealthOverview_Interactive(env, options);
    
    // RESTORED: Trend analysis functionality
    if (options.trend) {
      await displayTrendAnalysis(env, options);
    }
  }
}

/**
 * Display snapshot information header
 */
function displaySnapshotInfo(targetSnapshot: SnapshotInfo, functions: FunctionInfo[], env: CommandEnvironment): void {
  console.log('funcqc Health Report');
  console.log('--------------------------------------------------');
  console.log('');
  console.log('Project Overview:');
  console.log(`  Snapshot ID: ${targetSnapshot.id.slice(0, 8)}`);
  console.log(`  Total Functions: ${functions.length}`);
  console.log(`  Last Analyzed: ${formatDateTime(targetSnapshot.createdAt)}`);
  console.log(`  Database: ${env.config.storage.path}`);
  console.log('');
}

/**
 * Perform argument usage analysis on source files (temporarily disabled)
 * TODO: Re-enable once aggregator syntax issues are resolved
 */
async function performArgumentUsageAnalysis(
  _functions: FunctionInfo[],
  targetSnapshot: SnapshotInfo,
  env: CommandEnvironment
): Promise<ArgumentUsageMetrics[]> {
  try {
    const analyzer = new ArgumentUsageAnalyzer();
    const allSourceFiles = await env.storage.getSourceFilesBySnapshot(targetSnapshot.id);
    
    // Performance: Limit to first 10 files for initial testing
    const sampleFiles = allSourceFiles.slice(0, 10);
    env.commandLogger.debug(`Analyzing argument usage for ${sampleFiles.length} files (sampled from ${allSourceFiles.length})`);
    
    // Get ts-morph project from source files
    const { Project } = await import('ts-morph');
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true
    });
    
    const allArgumentUsage: import('../../../analyzers/argument-usage-analyzer').ArgumentUsage[] = [];
    
    for (const sourceFile of sampleFiles) {
      try {
        const tsMorphSourceFile = project.createSourceFile(sourceFile.filePath, sourceFile.fileContent, { overwrite: true });
        const usageData = analyzer.analyzeSourceFile(tsMorphSourceFile);
        allArgumentUsage.push(...usageData);
      } catch (error) {
        env.commandLogger.debug(`Failed to analyze argument usage for ${sourceFile.filePath}: ${error}`);
      }
    }
    
    if (allArgumentUsage.length === 0) {
      return [];
    }
    
    // Load call edges for transitive analysis
    const callEdges = await env.storage.getCallEdgesBySnapshot(targetSnapshot.id);
    
    // Create aggregator and process data
    const aggregator = new ArgumentUsageAggregator({}, callEdges);
    const argumentUsageMetrics = aggregator.aggregateUsageData(allArgumentUsage);
    
    env.commandLogger.debug(`Analyzed argument usage for ${argumentUsageMetrics.length} functions`);
    return argumentUsageMetrics;
  } catch (error) {
    env.commandLogger.debug(`Argument usage analysis failed: ${error}`);
    return [];
  }
}

/**
 * Perform structural analysis and calculate quality metrics
 */
async function performStructuralAnalysis(
  functions: FunctionInfo[],
  targetSnapshot: SnapshotInfo,
  env: CommandEnvironment,
  mode: EvaluationMode
): Promise<{ structuralData: StructuralMetrics; qualityData: HealthData; argumentUsageData: ArgumentUsageMetrics[] }> {
  // Perform argument usage analysis (with timeout protection)
  env.commandLogger.debug('Starting argument usage analysis...');
  const argumentUsageData = await performArgumentUsageAnalysis(functions, targetSnapshot, env);
  
  // Perform complete structural analysis for comprehensive health assessment
  const structuralData = await analyzeStructuralMetrics(functions, targetSnapshot.id, env, mode);
  
  // Calculate quality metrics and risk assessments (now includes argument usage penalties)
  const qualityData = await calculateQualityMetrics(functions, structuralData, argumentUsageData);
  
  return { structuralData, qualityData, argumentUsageData };
}

/**
 * Execute risk evaluation and generate assessments
 */
async function executeRiskEvaluation(functions: FunctionInfo[]): Promise<{
  riskAssessments: FunctionRiskAssessment[];
  enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>;
} | null> {
  const functionsWithMetrics = functions.filter(f => f.metrics);
  if (functionsWithMetrics.length === 0) {
    return null;
  }

  const statisticalEvaluator = new StatisticalEvaluator();
  const thresholdEvaluator = new ThresholdEvaluator();
  const allMetrics = functionsWithMetrics.map(f => f.metrics!);
  const projectStats = statisticalEvaluator.calculateProjectStatistics(allMetrics);
  const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
  const riskAssessments = await assessAllFunctions(functionsWithMetrics, projectStats, thresholds);
  const enhancedRiskStats = calculateEnhancedRiskStats(riskAssessments, functions);
  
  return { riskAssessments, enhancedRiskStats };
}

/**
 * Calculate adaptive PageRank thresholds based on distribution characteristics
 */
function calculateAdaptivePageRankThresholds(
  allPRScores: number[], 
  pageRankMetrics?: PageRankMetrics
): { highCentralityThreshold: number; criticalCentralityThreshold: number } {
  if (allPRScores.length === 0 || !pageRankMetrics) {
    return { highCentralityThreshold: 0.9, criticalCentralityThreshold: 0.95 };
  }
  
  // Analyze distribution characteristics
  const giniCoefficient = pageRankMetrics.centralityGini;
  const totalFunctions = pageRankMetrics.totalFunctions;
  
  // Adaptive thresholds based on inequality and project size
  let highCentralityThreshold: number;
  let criticalCentralityThreshold: number;
  
  if (giniCoefficient > 0.8) {
    // High inequality: Lower thresholds to capture more centrality
    highCentralityThreshold = Math.max(0.8, 0.95 - (giniCoefficient - 0.8) * 0.5);
    criticalCentralityThreshold = Math.max(0.85, highCentralityThreshold + 0.05);
  } else if (giniCoefficient > 0.6) {
    // Moderate inequality: Standard thresholds
    highCentralityThreshold = 0.9;
    criticalCentralityThreshold = 0.95;
  } else {
    // Low inequality: Higher thresholds since centrality is more evenly distributed
    highCentralityThreshold = Math.min(0.95, 0.9 + (0.6 - giniCoefficient) * 0.25);
    criticalCentralityThreshold = Math.min(0.98, highCentralityThreshold + 0.03);
  }
  
  // Adjust for project size
  if (totalFunctions < 100) {
    // Small projects: More lenient thresholds
    highCentralityThreshold = Math.max(0.75, highCentralityThreshold - 0.1);
    criticalCentralityThreshold = Math.max(0.8, criticalCentralityThreshold - 0.1);
  } else if (totalFunctions > 1000) {
    // Large projects: More selective thresholds
    highCentralityThreshold = Math.min(0.95, highCentralityThreshold + 0.05);
    criticalCentralityThreshold = Math.min(0.99, criticalCentralityThreshold + 0.04);
  }
  
  return { highCentralityThreshold, criticalCentralityThreshold };
}

/**
 * Apply structural weights to risk assessments for better prioritization
 */
function applyStructuralWeights(
  riskAssessments: FunctionRiskAssessment[],
  structuralData: StructuralMetrics
): FunctionRiskAssessment[] {
  // Create lookup sets for efficient membership testing
  const hubSet = new Set(structuralData.hubFunctionIds || []);
  const cyclicSet = new Set(structuralData.cyclicFunctionIds || []);
  
  // Build PageRank score map from topCentralFunctions
  const pageRankMap = new Map<string, number>();
  if (structuralData.pageRank?.topCentralFunctions) {
    structuralData.pageRank.topCentralFunctions.forEach(func => {
      pageRankMap.set(func.functionId, func.centrality);
    });
  }
  
  // Calculate all PageRank scores for percentile calculation
  const allPRScores = Array.from(pageRankMap.values());
  allPRScores.sort((a, b) => b - a);
  
  function calculatePercentile(score: number, scores: number[]): number {
    if (scores.length === 0) return 0;
    // FIXED: Calculate upper-tail percentile (high centrality = high percentile)
    // Count scores less than or equal to the target score
    let countLowerOrEqual = 0;
    for (const s of scores) {
      if (s <= score) countLowerOrEqual++;
    }
    return countLowerOrEqual / scores.length; // Higher centrality → higher percentile (closer to 1.0)
  }
  
  // IMPROVED: Calculate adaptive PageRank thresholds based on distribution (priority 3)
  const adaptiveThresholds = calculateAdaptivePageRankThresholds(allPRScores, structuralData.pageRank);
  
  return riskAssessments.map(assessment => {
    // Calculate structural context
    const prScore = pageRankMap.get(assessment.functionId);
    // CONSISTENT: Unregistered PR functions get 0.0 percentile (= no centrality influence)
    // This ensures structural multiplier = 1.0 for functions not in topCentralFunctions
    const prPercentile = prScore !== undefined ? calculatePercentile(prScore, allPRScores) : 0.0;
    const isHub = hubSet.has(assessment.functionId);
    const isCyclic = cyclicSet.has(assessment.functionId);
    
    // IMPROVED: Calculate adaptive structural multiplier based on percentile thresholds
    let pageRankMultiplier = 1.0;
    if (prPercentile > adaptiveThresholds.criticalCentralityThreshold) {
      // Critical centrality: 40% increase
      pageRankMultiplier = 1.4;
    } else if (prPercentile > adaptiveThresholds.highCentralityThreshold) {
      // High centrality: 25% increase  
      pageRankMultiplier = 1.25;
    } else if (prPercentile > 0.7) {
      // Moderate centrality: 10% increase
      pageRankMultiplier = 1.1;
    }
    
    const structuralMultiplier = 
      pageRankMultiplier *                          // Adaptive PageRank influence
      (1 + (isHub ? 0.2 : 0)) *                     // Hub influence (20% increase)
      (1 + (isCyclic ? 0.25 : 0));                  // Cyclic influence (25% increase)
    
    // Apply structural weighting
    const originalRiskScore = assessment.riskScore;
    const weightedRiskScore = originalRiskScore * structuralMultiplier;
    
    // Generate structural tags for display
    const structuralTags: string[] = [];
    if (prPercentile > adaptiveThresholds.criticalCentralityThreshold) {
      structuralTags.push('Critical Centrality');
    } else if (prPercentile > adaptiveThresholds.highCentralityThreshold) {
      structuralTags.push('High Centrality');
    }
    if (isHub) structuralTags.push('Hub');
    if (isCyclic) structuralTags.push('Cyclic');
    
    // IMPROVED: Threshold-based complete re-evaluation for consistent risk level assignment
    let newRiskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (weightedRiskScore >= 8) {
      newRiskLevel = 'critical';
    } else if (weightedRiskScore >= 5) {
      newRiskLevel = 'high';
    } else if (weightedRiskScore >= 2) {
      newRiskLevel = 'medium';
    } else {
      newRiskLevel = 'low';
    }
    
    return {
      ...assessment,
      riskScore: Math.round(weightedRiskScore * 100) / 100,
      riskLevel: newRiskLevel,
      ...(structuralTags.length > 0 && { structuralTags }),
      originalRiskScore: originalRiskScore
    };
  });
}

/**
 * Display all health analysis results
 */
async function displayHealthResults(
  qualityData: HealthData,
  structuralData: StructuralMetrics,
  riskEvaluation: { riskAssessments: FunctionRiskAssessment[]; enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats> } | null,
  functions: FunctionInfo[],
  options: HealthCommandOptions,
  env: CommandEnvironment,
  targetSnapshot: SnapshotInfo
): Promise<void> {
  const mode = options.mode || 'static';
  
  // Display health overview
  displayHealthOverview(qualityData);
  
  // Phase 2: Display project structure analysis for dynamic mode
  if (mode === 'dynamic') {
    await displayPhase2Analysis(env, targetSnapshot.id, functions);
  }

  // Display structural health
  if (structuralData) {
    displayStructuralHealth(structuralData, options.verbose);
  }

  // Display programming style distribution
  const styleDistribution = analyzeProgrammingStyleDistribution(functions);
  displayProgrammingStyleDistribution(styleDistribution, options.verbose);
  
  console.log();

  // Display risk assessment and recommendations
  if (riskEvaluation) {
    await displayOriginalHealthFormat(
      functions,
      riskEvaluation.riskAssessments,
      riskEvaluation.enhancedRiskStats,
      structuralData,
      targetSnapshot.id,
      env,
      options.verbose || false,
      options
    );
  }
  
  // Display cache statistics in debug mode
  if (process.env['NODE_ENV'] === 'development' || process.env['DEBUG']) {
    displayCacheStats();
  }
}

/**
 * Display interactive health overview with global timeout protection
 */
async function displayHealthOverview_Interactive(env: CommandEnvironment, options: HealthCommandOptions): Promise<void> {
  const GLOBAL_HEALTH_TIMEOUT_MS = 35000; // 35 seconds total timeout
  let timeoutId: NodeJS.Timeout | undefined;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Health analysis exceeded global timeout of ${GLOBAL_HEALTH_TIMEOUT_MS}ms. Try using --json mode for faster results or run 'funcqc scan' to refresh data.`));
    }, GLOBAL_HEALTH_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      performHealthAnalysis(env, options),
      timeoutPromise
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('timeout')) {
      console.log('⚠️  Health analysis timed out. Showing basic information instead.');
      await displayBasicHealthFallback(env, options);
    } else {
      throw error;
    }
  } finally {
    // Clear the timeout to prevent the process from hanging
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Perform the main health analysis logic
 */
async function performHealthAnalysis(env: CommandEnvironment, options: HealthCommandOptions): Promise<void> {
  // Get target snapshot and functions
  const { targetSnapshot, functions } = await getTargetSnapshotAndFunctions(env, options);
  
  // Display snapshot information
  displaySnapshotInfo(targetSnapshot, functions, env);
  
  const mode = options.mode || 'static';
  
  // Handle explain weight functionality early return
  if (options.explainWeight) {
    await handleExplainWeight(functions, targetSnapshot.id, options.explainWeight, mode, env);
    return;
  }
  
  // Perform structural analysis
  const { structuralData, qualityData, argumentUsageData: _argumentUsageData } = await performStructuralAnalysis(functions, targetSnapshot, env, mode);
  
  // Execute risk evaluation
  let riskEvaluation = await executeRiskEvaluation(functions);
  
  // Apply structural weights to risk assessments for better prioritization
  if (riskEvaluation && structuralData) {
    const weightedRiskAssessments = applyStructuralWeights(riskEvaluation.riskAssessments, structuralData);
    // Recalculate enhanced risk stats with weighted assessments
    const weightedEnhancedRiskStats = calculateEnhancedRiskStats(weightedRiskAssessments, functions);
    riskEvaluation = {
      riskAssessments: weightedRiskAssessments,
      enhancedRiskStats: weightedEnhancedRiskStats
    };
  }
  
  // Display all results
  await displayHealthResults(qualityData, structuralData, riskEvaluation, functions, options, env, targetSnapshot);
  
  console.log('');
}

/**
 * Display basic health information when full analysis times out
 */
async function displayBasicHealthFallback(env: CommandEnvironment, options: HealthCommandOptions): Promise<void> {
  try {
    const { functions } = await getTargetSnapshotAndFunctions(env, options);
    
    // Show basic statistics without complex analysis
    console.log('📊 Basic Health Overview (Simplified)');
    console.log('━'.repeat(50));
    
    // Calculate basic metrics from function data
    const functionsWithMetrics = functions.filter(f => f.metrics);
    if (functionsWithMetrics.length > 0) {
      const complexityValues = functionsWithMetrics.map(f => f.metrics?.cyclomaticComplexity || 0);
      const avgComplexity = complexityValues.reduce((a, b) => a + b, 0) / complexityValues.length;
      const highComplexityCount = complexityValues.filter(c => c > 10).length;
      
      console.log(`📋 Functions: ${functions.length} total, ${functionsWithMetrics.length} with metrics`);
      console.log(`🔄 Average Complexity: ${avgComplexity.toFixed(1)}`);
      console.log(`⚠️  High Complexity (>10): ${highComplexityCount} functions`);
      console.log(`📈 High Risk Rate: ${((highComplexityCount / functionsWithMetrics.length) * 100).toFixed(1)}%`);
    }
    
    console.log('');
    console.log('💡 For complete analysis, try:');
    console.log('   • funcqc health --json (faster JSON output)');
    console.log('   • funcqc scan (refresh data)');
    console.log('   • Reduce project size or check for infinite loops in code');
    
  } catch (fallbackError) {
    console.log('❌ Unable to display even basic health information.');
    console.log(`Error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
  }
}

/**
 * Display original health format exactly as shown in screenshot
 */
async function displayOriginalHealthFormat(
  functions: FunctionInfo[],
  riskAssessments: FunctionRiskAssessment[],
  enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>,
  structuralData: StructuralMetrics | null,
  snapshotId: string,
  env: CommandEnvironment,
  verbose: boolean,
  options: HealthCommandOptions
): Promise<void> {
  // Calculate high-risk functions
  const highRiskFunctions = riskAssessments.filter(a => a.riskLevel === 'high' || a.riskLevel === 'critical');
  
  // Display main recommendation
  console.log(`🔸 ${chalk.yellow('Recommendation')}: Focus on refactoring the ${highRiskFunctions.length} high-risk functions to improve structural health.`);
  console.log('');
  
  // Display top high-risk functions header
  console.log(`🔸 ${chalk.yellow('Top High-Risk Functions')}:`);
  
  // Import and call the enhanced structural recommendations display
  const { displayTopRisksWithDetails } = await import('./detailed-recommendations');
  if (structuralData && structuralData.depMetrics) {
    await displayTopRisksWithDetails(
      functions, 
      riskAssessments, 
      enhancedRiskStats, 
      structuralData,
      structuralData.depMetrics,
      snapshotId,
      env,
      verbose, 
      options.topN
    );
  } else {
    console.log('⚠️  Structural analysis not available - using simplified recommendations');
    await displayTopRisksWithDetails(
      functions, 
      riskAssessments, 
      enhancedRiskStats, 
      { totalComponents: 0, largestComponentSize: 0, cyclicFunctions: 0, hubFunctions: 0, avgFanIn: 0, avgFanOut: 0, maxFanIn: 0, maxFanOut: 0, structuralRisk: 'low' } as StructuralMetrics,
      [],
      snapshotId,
      env,
      verbose, 
      options.topN
    );
  }
}

/**
 * Phase 2: Display project structure analysis
 */
async function displayPhase2Analysis(env: CommandEnvironment, snapshotId: string, functions: FunctionInfo[]): Promise<void> {
  console.log(chalk.blue('\n📊 Phase 2: Project Structure Analysis'));
  console.log('━'.repeat(50));
  
  const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
  const fileCount = sourceFiles.length;
  const avgFunctionsPerFile = fileCount > 0 ? functions.length / fileCount : 0;
  const maxDirectoryDepth = calculateMaxDirectoryDepth(sourceFiles);
  
  console.log(`📁 Files: ${fileCount}`);
  console.log(`📊 Functions per File: ${avgFunctionsPerFile.toFixed(1)} avg`);
  console.log(`📂 Max Directory Depth: ${maxDirectoryDepth}`);
  console.log(`📈 Project Scale: ${getProjectScale(functions.length)}`);
  console.log(`🏗️  File Organization: ${getFileOrganizationLevel(fileCount, functions.length)}`);
  console.log(`📋 Structure Complexity: ${getStructureComplexity(maxDirectoryDepth)}`);
}


/**
 * Get project scale category
 */
function getProjectScale(functionCount: number): string {
  if (functionCount < 50) return '🔬 Micro';
  if (functionCount < 200) return '🏠 Very Small';
  if (functionCount < 800) return '🏢 Small';
  if (functionCount < 3000) return '🏙️ Medium';
  if (functionCount < 8000) return '🌆 Large';
  if (functionCount < 20000) return '🌃 Very Large';
  return '🌉 Enterprise';
}

/**
 * Get file organization level
 */
function getFileOrganizationLevel(fileCount: number, functionCount: number): string {
  const ratio = fileCount / functionCount;
  
  if (ratio > 0.8) return '🟢 Excellent';
  if (ratio > 0.5) return '🟡 Good';
  if (ratio > 0.3) return '🟠 Moderate';
  if (ratio > 0.2) return '🔴 Poor';
  return '⚫ Very Poor';
}

/**
 * Get structure complexity level
 */
function getStructureComplexity(maxDepth: number): string {
  if (maxDepth <= 2) return '🟢 Flat';
  if (maxDepth <= 3) return '🟡 Simple';
  if (maxDepth <= 5) return '🟠 Moderate';
  if (maxDepth <= 8) return '🔴 Complex';
  return '⚫ Very Complex';
}

/**
 * Display SCC cache statistics for debugging
 */
function displayCacheStats(): void {
  const stats = getSCCCacheStats();
  if (stats.size === 0) {
    console.log('🗄️  SCC Cache: Empty');
    return;
  }
  
  console.log(`🗄️  SCC Cache Stats: ${stats.size} entries`);
  stats.entries.forEach(entry => {
    console.log(`  ├── ${entry.snapshotId}: ${entry.age}s old`);
  });
}

/**
 * Handle JSON output mode - RESTORED from original implementation
 */
async function handleJsonOutput(env: CommandEnvironment, options: HealthCommandOptions): Promise<void> {
  if (options.aiOptimized) {
    env.commandLogger.warn('Warning: --ai-optimized option is deprecated. Use --json instead.');
  }

  const health = await generateHealthData(env, options);
  console.log(JSON.stringify(health, null, 2));
}

/**
 * Generate health data - RESTORED from original implementation
 */
/**
 * Generate snapshot data for health report
 */
function generateSnapshotData(targetSnapshot: SnapshotInfo, functions: FunctionInfo[]) {
  return {
    id: targetSnapshot.id,
    createdAt: new Date(targetSnapshot.createdAt).toISOString(),
    totalFunctions: functions.length,
  };
}

/**
 * Generate quality metrics data for health report
 */
function generateQualityMetricsData(
  qualityData: Awaited<ReturnType<typeof calculateQualityMetrics>>,
  riskDistribution: ReturnType<typeof calculateRiskDistribution>,
  averageRiskScore: number,
  totalFunctions: number
) {
  return {
    overallGrade: qualityData.overallGrade,
    overallScore: qualityData.overallScore,
    healthIndex: qualityData.healthIndex,
    healthGrade: qualityData.healthGrade,
    structuralDanger: qualityData.structuralDangerScore,
    highRiskRate: ((riskDistribution.high + riskDistribution.critical) / totalFunctions) * 100,
    criticalViolationRate: (riskDistribution.critical / totalFunctions) * 100,
    averageRiskScore,
    complexity: {
      grade: qualityData.complexity.grade,
      score: qualityData.complexity.score,
    },
    maintainability: {
      grade: qualityData.maintainability.grade,
      score: qualityData.maintainability.score,
    },
    size: {
      grade: qualityData.codeSize.grade,
      score: qualityData.codeSize.score,
    },
  };
}

/**
 * Generate risk analysis data for health report
 */
function generateRiskAnalysisData(
  riskDistribution: ReturnType<typeof calculateRiskDistribution>,
  averageRiskScore: number,
  riskAssessments: Awaited<ReturnType<typeof assessAllFunctions>>,
  functions: FunctionInfo[]
) {
  // Find highest risk function
  const highestRiskAssessment = riskAssessments
    .sort((a, b) => b.riskScore - a.riskScore)[0];
  
  const highestRiskFunction = highestRiskAssessment && functions.find(f => f.id === highestRiskAssessment.functionId);
  const totalFunctions = functions.length;

  return {
    distribution: riskDistribution,
    percentages: {
      high: totalFunctions > 0 ? (riskDistribution.high / totalFunctions) * 100 : 0,
      medium: totalFunctions > 0 ? (riskDistribution.medium / totalFunctions) * 100 : 0,
      low: totalFunctions > 0 ? (riskDistribution.low / totalFunctions) * 100 : 0,
      critical: totalFunctions > 0 ? (riskDistribution.critical / totalFunctions) * 100 : 0,
    },
    averageRiskScore,
    highestRiskFunction: highestRiskFunction ? {
      name: highestRiskFunction.displayName,
      riskScore: Math.round(highestRiskAssessment.riskScore),
      location: `${highestRiskFunction.filePath}:${highestRiskFunction.startLine}`,
    } : undefined,
  };
}

/**
 * Generate comprehensive health data by orchestrating all analysis components
 */
async function generateHealthData(env: CommandEnvironment, options: HealthCommandOptions): Promise<HealthDataForJSON> {
  const { targetSnapshot, functions } = await getTargetSnapshotAndFunctions(env, options);
  
  if (!targetSnapshot) {
    return {
      status: 'no-data',
      message: 'No snapshots found. Run `funcqc scan` to create your first snapshot.',
    };
  }

  // Calculate structural data and quality metrics
  const mode = options.mode || 'static';
  const structuralData = await analyzeStructuralMetrics(functions, targetSnapshot.id, env, mode);
  const qualityData = await calculateQualityMetrics(functions, structuralData);
  
  // Perform risk assessment
  const statisticalEvaluator = new StatisticalEvaluator();
  const thresholdEvaluator = new ThresholdEvaluator();
  
  const functionsWithMetrics = functions.filter(f => f.metrics);
  const allMetrics = functionsWithMetrics.map(f => f.metrics!);
  const projectStats = statisticalEvaluator.calculateProjectStatistics(allMetrics);
  const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
  
  const riskAssessments = await assessAllFunctions(functions, projectStats, thresholds);
  
  // Generate recommendations and calculate risk metrics
  const includeRisks = options.risks !== false;
  const { recommendations } = await generateRiskAnalysis(
    riskAssessments, functions, includeRisks
  );

  const riskDistribution = calculateRiskDistribution(riskAssessments);
  const averageRiskScore = calculateAverageRiskScore(riskAssessments);
  
  // Assemble final health data
  return {
    status: 'success',
    snapshot: generateSnapshotData(targetSnapshot, functions),
    quality: generateQualityMetricsData(qualityData, riskDistribution, averageRiskScore, functions.length),
    risk: generateRiskAnalysisData(riskDistribution, averageRiskScore, riskAssessments, functions),
    recommendations: recommendations,
  };
}


/**
 * Get target snapshot and functions
 */
async function getTargetSnapshotAndFunctions(env: CommandEnvironment, options: HealthCommandOptions): Promise<{ targetSnapshot: SnapshotInfo; functions: FunctionInfo[] }> {
  const targetSnapshotId = options.snapshot || 'latest';
  const resolvedSnapshotId = await resolveSnapshotId(env, targetSnapshotId);
  
  if (!resolvedSnapshotId) {
    throw new Error('No snapshot found. Please run "funcqc scan" first.');
  }

  const targetSnapshot = await env.storage.getSnapshot(resolvedSnapshotId);
  if (!targetSnapshot) {
    throw new Error('Snapshot not found');
  }

  const functions = await env.storage.findFunctionsInSnapshot(resolvedSnapshotId);
  
  if (functions.length === 0) {
    throw new Error('No functions found in the latest snapshot');
  }

  return { targetSnapshot, functions };
}

/**
 * Find target function by ID or name
 */
function findTargetFunction(functions: FunctionInfo[], functionIdOrName: string): FunctionInfo | null {
  return functions.find(f => 
    f.id === functionIdOrName || 
    f.name === functionIdOrName ||
    f.id.startsWith(functionIdOrName)
  ) || null;
}

/**
 * Display function not found error with suggestions
 */
function displayFunctionNotFound(functionIdOrName: string, functions: FunctionInfo[]): void {
  console.log(`❌ Function not found: ${functionIdOrName}`);
  console.log();
  console.log('💡 Available functions (showing first 10):');
  functions.slice(0, 10).forEach(f => {
    console.log(`  • ${f.name} (ID: ${f.id.slice(0, 8)})`);
  });
}

/**
 * Calculate dependency metrics for a specific function
 */
async function calculateDependencyMetrics(
  functions: FunctionInfo[],
  snapshotId: string,
  targetFunction: FunctionInfo,
  env: CommandEnvironment
): Promise<{ fanIn: number; fanOut: number }> {
  const callEdges = await env.storage.getCallEdgesBySnapshot(snapshotId);
  const dependencyCalculator = new (await import('../../../analyzers/dependency-metrics')).DependencyMetricsCalculator();
  const entryPoints = new Set<string>();
  const cyclicFunctions = new Set<string>();
  const depMetrics = dependencyCalculator.calculateMetrics(functions, callEdges, entryPoints, cyclicFunctions);
  
  const functionDepMetric = depMetrics.find(m => m.functionId === targetFunction.id);
  return {
    fanIn: functionDepMetric?.fanIn || 0,
    fanOut: functionDepMetric?.fanOut || 0
  };
}

/**
 * Display function information section
 */
function displayFunctionInfo(targetFunction: FunctionInfo): void {
  console.log(`📋 Function: ${targetFunction.name}`);
  console.log(`📂 File: ${targetFunction.filePath}:${targetFunction.startLine}`);
  console.log(`🆔 ID: ${targetFunction.id}`);
  console.log();
}

/**
 * Display function context information
 */
function displayFunctionContext(functionContext: FunctionContext): void {
  console.log('📊 Function Context:');
  console.log(`  ├── Layer: ${functionContext.layer}`);
  console.log(`  ├── Role: ${functionContext.role}`);
  console.log(`  ├── Criticality: ${functionContext.criticality}`);
  console.log(`  ├── Fan-in: ${functionContext.fanIn}`);
  console.log(`  └── Fan-out: ${functionContext.fanOut}`);
  console.log();
}

/**
 * Display project context information
 */
function displayProjectContext(dynamicConfig: DynamicWeightConfig): void {
  console.log('🏗️  Project Context:');
  console.log(`  ├── Size: ${dynamicConfig.projectSize} functions`);
  console.log(`  ├── Architecture: ${dynamicConfig.architecturePattern}`);
  console.log(`  ├── Domain Complexity: ${dynamicConfig.domainComplexity}`);
  console.log(`  └── Team Experience: ${dynamicConfig.teamExperience}`);
  console.log();
}

/**
 * Display dynamic thresholds comparison
 */
function displayDynamicThresholds(mode: EvaluationMode, dynamicCalculator: DynamicWeightCalculator, dynamicConfig: DynamicWeightConfig): void {
  if (mode === 'dynamic') {
    const dynamicThresholds = dynamicCalculator.calculateDynamicThresholds(dynamicConfig);
    console.log('🎯 Dynamic Thresholds (vs. Static):');
    console.log(`  ├── Hub Threshold: ${dynamicThresholds.hubThreshold} (static: 5)`);
    console.log(`  ├── Complexity Threshold: ${dynamicThresholds.complexityThreshold} (static: 10)`);
    console.log(`  ├── LOC Threshold: ${dynamicThresholds.locThreshold} (static: 40)`);
    console.log(`  └── Cognitive Complexity: ${dynamicThresholds.cognitiveComplexityThreshold} (static: 15)`);
  } else {
    console.log('📋 Static mode - using default thresholds without dynamic adjustment');
  }
}

/**
 * Handle explain weight functionality
 */
async function handleExplainWeight(
  functions: FunctionInfo[],
  snapshotId: string,
  functionIdOrName: string,
  mode: EvaluationMode,
  env: CommandEnvironment
): Promise<void> {
  console.log('🔍 Dynamic Weight Explanation');
  console.log('━'.repeat(60));
  console.log();

  // Find the target function
  const targetFunction = findTargetFunction(functions, functionIdOrName);
  
  if (!targetFunction) {
    displayFunctionNotFound(functionIdOrName, functions);
    return;
  }

  // Calculate dependency metrics
  const { fanIn, fanOut } = await calculateDependencyMetrics(functions, snapshotId, targetFunction, env);

  // Create function context
  const functionContext = defaultLayerDetector.createFunctionContext(
    targetFunction,
    fanIn,
    fanOut,
    functions.length
  );

  // Setup dynamic weight configuration
  const architecturePattern = defaultLayerDetector.analyzeArchitecturePattern(functions);
  const dynamicConfig: DynamicWeightConfig = {
    projectSize: functions.length,
    architecturePattern,
    domainComplexity: 'Medium',
    teamExperience: 'Mixed',
    mode
  };

  // Create weight calculator and explain
  const dynamicCalculator = createDynamicWeightCalculator(dynamicConfig);
  const explanations = dynamicCalculator.explainWeight(functionContext, 'complexity');

  // Display all information sections
  displayFunctionInfo(targetFunction);
  displayFunctionContext(functionContext);
  displayProjectContext(dynamicConfig);
  
  // Display weight explanation
  explanations.forEach(line => console.log(line));
  console.log();

  // Display dynamic thresholds
  displayDynamicThresholds(mode, dynamicCalculator, dynamicConfig);
  console.log();
}


