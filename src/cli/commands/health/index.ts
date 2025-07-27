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
import { analyzeStructuralMetrics, getSCCCacheStats, calculateMaxDirectoryDepth } from './structural-analyzer';
import { displayHealthOverview, displayStructuralHealth, formatDateTime } from './display';
import { defaultLayerDetector } from '../../../analyzers/architecture-layer-detector';
import { createDynamicWeightCalculator } from '../../../analyzers/dynamic-weight-calculator';
import { 
  StatisticalEvaluator, 
  ThresholdEvaluator, 
  assessAllFunctions, 
  calculateRiskDistribution,
  calculateEnhancedRiskStats 
} from './risk-evaluator';
import { generateRiskAnalysis } from './recommendations';
import { displayTrendAnalysis } from './trend-analyzer';
import { HealthDataForJSON, FunctionRiskAssessment } from './types';

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
 * Display interactive health overview
 */
async function displayHealthOverview_Interactive(env: CommandEnvironment, options: HealthCommandOptions): Promise<void> {
  // Get target snapshot and functions
  const { targetSnapshot, functions } = await getTargetSnapshotAndFunctions(env, options);

  console.log('funcqc Health Report');
  console.log('--------------------------------------------------');
  console.log('');
  console.log('Project Overview:');
  console.log(`  Snapshot ID: ${targetSnapshot.id.slice(0, 8)}`);
  console.log(`  Total Functions: ${functions.length}`);
  console.log(`  Last Analyzed: ${formatDateTime(targetSnapshot.createdAt)}`);
  console.log(`  Database: ${env.config.storage.path}`);
  console.log('');

  // Perform complete structural analysis for comprehensive health assessment
  const mode = options.mode || 'static';
  const structuralData = await analyzeStructuralMetrics(functions, targetSnapshot.id, env, mode);
  
  // Calculate quality metrics and risk assessments
  const qualityData = await calculateQualityMetrics(functions, structuralData);
  
  // Handle explain weight functionality
  if (options.explainWeight) {
    await handleExplainWeight(functions, targetSnapshot.id, options.explainWeight, mode, env);
    return;
  }

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

  // RESTORED: Original risk assessment and recommendations from the screenshot
  const functionsWithMetrics = functions.filter(f => f.metrics);
  if (functionsWithMetrics.length > 0) {
    const statisticalEvaluator = new StatisticalEvaluator();
    const thresholdEvaluator = new ThresholdEvaluator();
    const allMetrics = functionsWithMetrics.map(f => f.metrics!);
    const projectStats = statisticalEvaluator.calculateProjectStatistics(allMetrics);
    const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
    const riskAssessments = await assessAllFunctions(functionsWithMetrics, projectStats, thresholds);
    const enhancedRiskStats = calculateEnhancedRiskStats(riskAssessments, functions);
    
    // Display original recommendation format exactly as in screenshot
    await displayOriginalHealthFormat(functions, riskAssessments, enhancedRiskStats, options.verbose || false);
  }
  
  // Display cache statistics in debug mode
  if (process.env['NODE_ENV'] === 'development' || process.env['DEBUG']) {
    displayCacheStats();
  }
  
  console.log('');
}

/**
 * Display original health format exactly as shown in screenshot
 */
async function displayOriginalHealthFormat(
  functions: FunctionInfo[],
  riskAssessments: FunctionRiskAssessment[],
  enhancedRiskStats: ReturnType<typeof calculateEnhancedRiskStats>,
  verbose: boolean
): Promise<void> {
  // Calculate high-risk functions
  const highRiskFunctions = riskAssessments.filter(a => a.riskLevel === 'high' || a.riskLevel === 'critical');
  
  // Display main recommendation
  console.log(`🔸 ${chalk.yellow('Recommendation')}: Focus on refactoring the ${highRiskFunctions.length} high-risk functions to improve structural health.`);
  console.log('');
  
  // Display top high-risk functions header
  console.log(`🔸 ${chalk.yellow('Top High-Risk Functions')}:`);
  
  // Import and call the detailed recommendations display
  const { displayTopRisksWithDetails } = await import('./detailed-recommendations');
  await displayTopRisksWithDetails(functions, riskAssessments, enhancedRiskStats, verbose);
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
async function generateHealthData(env: CommandEnvironment, options: HealthCommandOptions): Promise<HealthDataForJSON> {
  const { targetSnapshot, functions } = await getTargetSnapshotAndFunctions(env, options);
  
  if (!targetSnapshot) {
    return {
      status: 'no-data',
      message: 'No snapshots found. Run `funcqc scan` to create your first snapshot.',
    };
  }

  // Calculate structural data for complete health assessment
  const mode = options.mode || 'static';
  const structuralData = await analyzeStructuralMetrics(functions, targetSnapshot.id, env, mode);
  
  // Calculate quality metrics with structural integration
  const qualityData = await calculateQualityMetrics(functions, structuralData);
  
  // ThresholdEvaluator-based risk assessment
  const statisticalEvaluator = new StatisticalEvaluator();
  const thresholdEvaluator = new ThresholdEvaluator();
  
  const functionsWithMetrics = functions.filter(f => f.metrics);
  const allMetrics = functionsWithMetrics.map(f => f.metrics!);
  const projectStats = statisticalEvaluator.calculateProjectStatistics(allMetrics);
  const thresholds = thresholdEvaluator.getDefaultQualityThresholds();
  
  const riskAssessments = await assessAllFunctions(functions, projectStats, thresholds);
  
  // Generate recommendations and risk details
  const includeRisks = options.risks !== false;
  const { recommendations } = await generateRiskAnalysis(
    riskAssessments, functions, includeRisks
  );

  // Calculate additional metrics for enhanced health data
  const riskDistribution = calculateRiskDistribution(riskAssessments);
  const averageRiskScore = calculateAverageRiskScore(riskAssessments);
  
  // Find highest risk function
  const highestRiskAssessment = riskAssessments
    .sort((a, b) => b.riskScore - a.riskScore)[0];
  
  const highestRiskFunction = highestRiskAssessment && functions.find(f => f.id === highestRiskAssessment.functionId);

  return {
    status: 'success',
    snapshot: {
      id: targetSnapshot.id,
      createdAt: new Date(targetSnapshot.createdAt).toISOString(),
      totalFunctions: functions.length,
    },
    quality: {
      overallGrade: qualityData.overallGrade,
      overallScore: qualityData.overallScore,
      healthIndex: qualityData.healthIndex,
      healthGrade: qualityData.healthGrade,
      structuralDanger: qualityData.structuralDangerScore,
      highRiskRate: ((riskDistribution.high + riskDistribution.critical) / functions.length) * 100,
      criticalViolationRate: (riskDistribution.critical / functions.length) * 100,
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
    },
    risk: {
      distribution: riskDistribution,
      percentages: {
        high: functions.length > 0 ? (riskDistribution.high / functions.length) * 100 : 0,
        medium: functions.length > 0 ? (riskDistribution.medium / functions.length) * 100 : 0,
        low: functions.length > 0 ? (riskDistribution.low / functions.length) * 100 : 0,
        critical: functions.length > 0 ? (riskDistribution.critical / functions.length) * 100 : 0,
      },
      averageRiskScore,
      highestRiskFunction: highestRiskFunction ? {
        name: highestRiskFunction.displayName,
        riskScore: Math.round(highestRiskAssessment.riskScore),
        location: `${highestRiskFunction.filePath}:${highestRiskFunction.startLine}`,
      } : undefined,
    },
    recommendations: recommendations,
  };
}

/**
 * Calculate average risk score - RESTORED from original implementation
 */
function calculateAverageRiskScore(riskAssessments: FunctionRiskAssessment[]): number {
  if (riskAssessments.length === 0) return 0;
  
  const totalRiskScore = riskAssessments.reduce((sum, assessment) => sum + assessment.riskScore, 0);
  return totalRiskScore / riskAssessments.length;
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

  const functions = await env.storage.getFunctionsBySnapshot(resolvedSnapshotId);
  
  if (functions.length === 0) {
    throw new Error('No functions found in the latest snapshot');
  }

  return { targetSnapshot, functions };
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
  const targetFunction = functions.find(f => 
    f.id === functionIdOrName || 
    f.name === functionIdOrName ||
    f.id.startsWith(functionIdOrName)
  );

  if (!targetFunction) {
    console.log(`❌ Function not found: ${functionIdOrName}`);
    console.log();
    console.log('💡 Available functions (showing first 10):');
    functions.slice(0, 10).forEach(f => {
      console.log(`  • ${f.name} (ID: ${f.id.slice(0, 8)})`);
    });
    return;
  }

  // Get dependency metrics for the function
  const callEdges = await env.storage.getCallEdgesBySnapshot(snapshotId);
  const dependencyCalculator = new (await import('../../../analyzers/dependency-metrics')).DependencyMetricsCalculator();
  const entryPoints = new Set<string>();
  const cyclicFunctions = new Set<string>();
  const depMetrics = dependencyCalculator.calculateMetrics(functions, callEdges, entryPoints, cyclicFunctions);
  
  const functionDepMetric = depMetrics.find(m => m.functionId === targetFunction!.id);
  const fanIn = functionDepMetric?.fanIn || 0;
  const fanOut = functionDepMetric?.fanOut || 0;

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

  // Display function information
  console.log(`📋 Function: ${targetFunction.name}`);
  console.log(`📂 File: ${targetFunction.filePath}:${targetFunction.startLine}`);
  console.log(`🆔 ID: ${targetFunction.id}`);
  console.log();

  // Display function context
  console.log('📊 Function Context:');
  console.log(`  ├── Layer: ${functionContext.layer}`);
  console.log(`  ├── Role: ${functionContext.role}`);
  console.log(`  ├── Criticality: ${functionContext.criticality}`);
  console.log(`  ├── Fan-in: ${functionContext.fanIn}`);
  console.log(`  └── Fan-out: ${functionContext.fanOut}`);
  console.log();

  // Display project context
  console.log('🏗️  Project Context:');
  console.log(`  ├── Size: ${dynamicConfig.projectSize} functions`);
  console.log(`  ├── Architecture: ${dynamicConfig.architecturePattern}`);
  console.log(`  ├── Domain Complexity: ${dynamicConfig.domainComplexity}`);
  console.log(`  └── Team Experience: ${dynamicConfig.teamExperience}`);
  console.log();

  // Display weight explanation
  explanations.forEach(line => console.log(line));
  console.log();

  // Display dynamic thresholds if in dynamic mode
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

  console.log();
}


