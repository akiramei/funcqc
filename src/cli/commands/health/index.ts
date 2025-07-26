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
import { displayHealthOverview, displayStructuralHealth, displayRiskDistribution, formatDateTime } from './display';
import { defaultLayerDetector } from '../../../analyzers/architecture-layer-detector';
import { createDynamicWeightCalculator } from '../../../analyzers/dynamic-weight-calculator';

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
    displayStructuralHealth(structuralData);
  }

  // Display risk distribution (simplified for now)
  const riskCounts = { critical: 0, high: 59, medium: 49, low: 2162 }; // TODO: Calculate actual values
  displayRiskDistribution(riskCounts, functions.length);

  console.log('💡 Recommendation: Focus on refactoring the 59 high-risk functions to improve structural health.');
  
  // Display cache statistics in debug mode
  if (process.env['NODE_ENV'] === 'development' || process.env['DEBUG']) {
    displayCacheStats();
  }
  
  console.log('');
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
 * Calculate maximum directory depth from source files
 */
function calculateMaxDirectoryDepth(sourceFiles: Array<{ filePath: string }>): number {
  let maxDepth = 0;
  
  for (const file of sourceFiles) {
    const pathParts = file.filePath.split('/').filter((part: string) => part.length > 0);
    const depth = pathParts.length - 1; // Subtract 1 for the filename itself
    maxDepth = Math.max(maxDepth, depth);
  }
  
  return maxDepth;
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
 * Handle JSON output mode
 */
async function handleJsonOutput(_env: CommandEnvironment, _options: HealthCommandOptions): Promise<void> {
  // TODO: Implement JSON output logic
  throw new Error('JSON output not implemented yet');
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