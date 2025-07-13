import chalk from 'chalk';
import simpleGit, { SimpleGit } from 'simple-git';
import {
  HealthCommandOptions,
  FunctionInfo,
  FuncqcConfig,
  SnapshotInfo,
  QualityMetrics,
} from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter, DatabaseError } from '../storage/pglite-adapter';
import { QualityScorer } from '../utils/quality-scorer';
import { riskAssessor } from '../core/risk-assessor';
import { Logger } from '../utils/cli-utils';
import { ErrorCode, createErrorHandler, ErrorHandler } from '../utils/error-handler';

interface TrendData {
  period: string;
  snapshots: SnapshotInfo[];
  avgComplexity: number;
  totalFunctions: number;
  highRiskCount: number;
  qualityScore: number;
  trend: 'improving' | 'stable' | 'degrading';
}

interface TrendAnalysis {
  periods: TrendData[];
  overallTrend: 'improving' | 'stable' | 'degrading';
  keyInsights: string[];
  recommendations: string[];
}

export async function healthCommand(options: HealthCommandOptions): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  const errorHandler = createErrorHandler(logger);

  try {
    const { storage, config } = await setupHealthCommand(options, logger);
    await executeHealthCommand(storage, config, options, logger);
    await storage.close();
  } catch (error) {
    handleHealthError(error, errorHandler);
  }
}

async function setupHealthCommand(options: HealthCommandOptions, logger: Logger) {
  const configManager = new ConfigManager();
  const config = await configManager.load();

  if (!config.storage.path) {
    logger.error('Storage path is not configured');
    process.exit(1);
  }

  // Use quiet logger for JSON output to avoid stdout contamination
  const isJsonMode = options.json || options.aiOptimized || process.argv.includes('--json');
  const storageLogger = isJsonMode 
    ? new Logger(false, true) // verbose=false, quiet=true
    : logger;

  const storage = new PGLiteStorageAdapter(config.storage.path, storageLogger);
  await storage.init();

  return { storage, config };
}

async function executeHealthCommand(storage: PGLiteStorageAdapter, config: FuncqcConfig, options: HealthCommandOptions, logger: Logger) {
  // Force JSON mode if --json flag is present in command line
  const isJsonMode = options.json || options.aiOptimized || process.argv.includes('--json');
  
  if (options.trend) {
    await displayTrendAnalysis(storage, options, logger);
  } else if (options.showConfig) {
    displayConfigurationDetails(config, options.verbose || false);
  } else if (isJsonMode) {
    await handleJsonOutput(storage, config, options, logger);
  } else {
    await displayHealthOverview(storage, config, options);
  }
}

async function handleJsonOutput(storage: PGLiteStorageAdapter, config: FuncqcConfig, options: HealthCommandOptions, logger: Logger) {
  if (options.aiOptimized) {
    logger.warn('Warning: --ai-optimized option is deprecated. Use --json instead.');
  }
  await displayAIOptimizedHealth(storage, config, options);
}

function handleHealthError(error: unknown, errorHandler: ErrorHandler): void {
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
      `Failed to generate health report: ${error instanceof Error ? error.message : String(error)}`,
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

async function displayHealthOverview(
  storage: PGLiteStorageAdapter,
  config: FuncqcConfig,
  options: HealthCommandOptions
): Promise<void> {
  console.log(chalk.blue('funcqc Health Report'));
  console.log('-'.repeat(50));
  console.log();

  const snapshots = await storage.getSnapshots({ sort: 'created_at', limit: 1 });

  if (snapshots.length === 0) {
    console.log(chalk.yellow('Warning: No data found'));
    console.log('Run "funcqc scan" to analyze your project');
    return;
  }

  const latest = snapshots[0];
  const functions = await storage.getFunctions(latest.id);

  if (functions.length === 0) {
    console.log(chalk.yellow('Warning: No functions found in latest snapshot'));
    return;
  }

  // Project Overview
  console.log(chalk.yellow('Project Overview:'));
  console.log(`  Total Functions: ${functions.length}`);
  console.log(`  Last Analyzed: ${new Date(latest.createdAt).toISOString().split('T')[0]}`);
  console.log(`  Database: ${config.storage.path}`);
  console.log();

  // Get risk assessment once for reuse
  const functionsWithMetrics = functions.filter(f => f.metrics);
  let riskAssessment = null;
  let assessmentSummary = null;
  let sortedHighRiskFunctions: Array<{ function: FunctionInfo; riskScore: number; riskFactors: string[] }> = [];
  
  if (functionsWithMetrics.length > 0) {
    try {
      riskAssessment = await riskAssessor.assessProject(
        functionsWithMetrics,
        config.thresholds,
        config.assessment
      );
      assessmentSummary = riskAssessor.createAssessmentSummary(riskAssessment);
      
      // Get high-risk functions sorted by calculateRiskScore
      sortedHighRiskFunctions = await assessHighRiskFunctions(functionsWithMetrics, config);
    } catch {
      // Continue without risk assessment
    }
  }

  // Quality Overview
  await displayQualityOverview(functions, config, assessmentSummary, options.verbose || false);

  // Risk Distribution
  await displayRiskDistribution(functions, config, options.verbose || false);

  // Risk Details
  await displayRiskDetails(functionsWithMetrics, sortedHighRiskFunctions, assessmentSummary, options.verbose || false);

  // Recommended Actions
  await displayRecommendedActions(sortedHighRiskFunctions, config, options.verbose || false);

  // Git Status (if enabled)
  if (config.git.enabled) {
    await displayGitStatus(options.verbose || false);
  }

  if (options.verbose) {
    await displayDetailedInsights(functions, storage, snapshots);
  }
}

async function displayQualityOverview(
  functions: FunctionInfo[],
  _config: FuncqcConfig,
  assessmentSummary: unknown,
  verbose: boolean
): Promise<void> {
  console.log(chalk.yellow('Quality Overview:'));

  const functionsWithMetrics = functions.filter(f => f.metrics);
  if (functionsWithMetrics.length === 0) {
    console.log('  No quality metrics available');
    return;
  }

  const scorer = new QualityScorer();
  const projectScore = scorer.calculateProjectScore(functionsWithMetrics);

  // Display overall assessments first
  console.log(`  Overall Grade: ${projectScore.overallGrade} (${projectScore.score}/100)`);
  
  // Use the pre-calculated assessment summary
  if (assessmentSummary && typeof assessmentSummary === 'object' && assessmentSummary !== null && 'averageRiskScore' in assessmentSummary) {
    const avgScore = (assessmentSummary as { averageRiskScore: number }).averageRiskScore;
    const scoreInterpretation = getScoreInterpretation(avgScore);
    const scoreColor = getScoreColor(avgScore);
    console.log(`  Average Risk Score: ${scoreColor(avgScore.toFixed(1))} ${scoreInterpretation}`);
  }
  
  console.log();
  console.log('  Details:');
  console.log(`    Complexity: ${getGradeLabel(projectScore.complexityScore)} (${projectScore.complexityScore}/100)`);
  console.log(`    Maintainability: ${getGradeLabel(projectScore.maintainabilityScore)} (${projectScore.maintainabilityScore}/100)`);
  console.log(`    Code Size: ${getGradeLabel(projectScore.sizeScore)} (${projectScore.sizeScore}/100)`);

  if (verbose) {
    console.log(`    Code Quality: ${getGradeLabel(projectScore.codeQualityScore)} (${projectScore.codeQualityScore}/100)`);
    console.log();
    console.log(`  High Risk Functions: ${projectScore.highRiskFunctions}`);

    if (projectScore.topProblematicFunctions.length > 0) {
      console.log('  Most Problematic Functions:');
      projectScore.topProblematicFunctions.slice(0, 3).forEach((func, index) => {
        console.log(`    ${index + 1}. ${func.name} (${func.reason})`);
      });
    }
  }
  console.log();
}

async function displayRiskDistribution(
  functions: FunctionInfo[],
  config: FuncqcConfig,
  verbose: boolean = false
): Promise<void> {
  console.log(chalk.yellow('Risk Distribution:'));

  const functionsWithMetrics = functions.filter(f => f.metrics);
  if (functionsWithMetrics.length === 0) {
    console.log('  No risk assessment available');
    return;
  }

  try {
    const riskAssessment = await riskAssessor.assessProject(
      functionsWithMetrics,
      config.thresholds,
      config.assessment
    );

    const { riskDistribution } = riskAssessment;
    const total = riskDistribution.high + riskDistribution.medium + riskDistribution.low;

    console.log(
      `  High Risk: ${riskDistribution.high} functions (${((riskDistribution.high / total) * 100).toFixed(1)}%)`
    );
    console.log(
      `  Medium Risk: ${riskDistribution.medium} functions (${((riskDistribution.medium / total) * 100).toFixed(1)}%)`
    );
    console.log(
      `  Low Risk: ${riskDistribution.low} functions (${((riskDistribution.low / total) * 100).toFixed(1)}%)`
    );
    console.log();
  } catch (error) {
    console.log('  Risk assessment failed');
    if (verbose) {
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log();
  }
}

async function displayRiskDetails(
  functionsWithMetrics: FunctionInfo[],
  sortedHighRiskFunctions: Array<{ function: FunctionInfo; riskScore: number; riskFactors: string[] }>,
  summary: unknown,
  _verbose: boolean = false
): Promise<void> {
  console.log(chalk.yellow('Risk Details:'));

  if (!summary || functionsWithMetrics.length === 0) {
    console.log('  No risk assessment available');
    console.log();
    return;
  }

  // Type guard for summary
  const hasSummaryProperties = summary && typeof summary === 'object' && summary !== null && 
    'criticalViolations' in summary && 'errorViolations' in summary && 'warningViolations' in summary;
  
  if (hasSummaryProperties) {
    const summaryObj = summary as { criticalViolations: number; errorViolations: number; warningViolations: number; mostCommonViolation?: string };
    console.log(`  Threshold Violations: Critical: ${summaryObj.criticalViolations}, Error: ${summaryObj.errorViolations}, Warning: ${summaryObj.warningViolations}`);
    
    if (summaryObj.mostCommonViolation) {
      console.log(`  Most Common Violation: ${summaryObj.mostCommonViolation}`);
    }
  }
  
  // Use the highest risk function from sortedHighRiskFunctions (calculateRiskScore based)
  if (sortedHighRiskFunctions.length > 0) {
    const highest = sortedHighRiskFunctions[0];
    const scoreColor = getScoreColor(highest.riskScore);
    console.log(`  Highest Risk Function: ${highest.function.displayName}() (Risk: ${scoreColor(highest.riskScore.toFixed(0))})`);
    console.log(`    Location: ${highest.function.filePath}:${highest.function.startLine}`);
  }

  console.log();
}

async function displayRecommendedActions(
  sortedHighRiskFunctions: Array<{ function: FunctionInfo; riskScore: number; riskFactors: string[] }>,
  config: FuncqcConfig,
  verbose: boolean = false
): Promise<void> {
  console.log(chalk.yellow('Recommended Actions:'));

  if (sortedHighRiskFunctions.length === 0) {
    console.log('  No immediate actions needed - code quality is good!');
    console.log();
    return;
  }

  // Generate recommended actions (top 3 by default, more if verbose)
  const nextActions = generateNextActions(
    sortedHighRiskFunctions.slice(0, verbose ? 5 : 3), 
    config
  );

  nextActions.forEach((action, index) => {
    const func = sortedHighRiskFunctions.find(item => item.function.id === action.function_id)?.function;
    if (func) {
      console.log(`  ${index + 1}. ${func.displayName}() in ${action.code_location}`);
      console.log(`     Action: ${action.description}`);
      
      // Show first 2 steps by default, all if verbose
      const stepsToShow = verbose ? action.specific_steps : action.specific_steps.slice(0, 2);
      stepsToShow.forEach(step => {
        console.log(`     - ${step}`);
      });
      
      if (!verbose && action.specific_steps.length > 2) {
        console.log(`     ... and ${action.specific_steps.length - 2} more steps`);
      }
      
      if (index < nextActions.length - 1) {
        console.log();
      }
    }
  });

  console.log();
}

async function displayTrendAnalysis(
  storage: PGLiteStorageAdapter,
  options: HealthCommandOptions,
  _logger: Logger
): Promise<void> {
  console.log(chalk.blue('funcqc Trend Analysis'));
  console.log('-'.repeat(50));
  console.log();

  const snapshots = await storage.getSnapshots();

  if (snapshots.length < 2) {
    console.log(chalk.yellow('Warning: Not enough data for trend analysis'));
    console.log('Need at least 2 snapshots to show trends');
    console.log('Run "funcqc scan" to create more snapshots');
    return;
  }

  const periodDays = determinePeriod(options);
  const trendData = await analyzeTrends(snapshots, periodDays, storage);

  if (options.json) {
    console.log(JSON.stringify(trendData, null, 2));
  } else {
    displayFullTrendAnalysis(trendData, periodDays);
  }
}

function determinePeriod(options: HealthCommandOptions): number {
  if (options.period) {
    const parsed = parseInt(options.period, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid period value: ${options.period}. Must be a positive number.`);
    }
    return parsed;
  }
  return 7; // Default to weekly
}

async function analyzeTrends(
  snapshots: SnapshotInfo[],
  periodDays: number,
  storage: PGLiteStorageAdapter
): Promise<TrendAnalysis> {
  const now = new Date();
  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  const periods: TrendData[] = [];
  const maxPeriods = 8;

  for (let i = 0; i < maxPeriods; i++) {
    const periodEnd = new Date(now.getTime() - i * periodMs);
    const periodStart = new Date(periodEnd.getTime() - periodMs);

    const periodSnapshots = snapshots.filter(s => {
      const snapshotDate = new Date(s.createdAt);
      return snapshotDate >= periodStart && snapshotDate < periodEnd;
    });

    if (periodSnapshots.length === 0) continue;

    const functions = await storage.getFunctions(periodSnapshots[0].id);
    const functionsWithMetrics = functions.filter(f => f.metrics);

    if (functionsWithMetrics.length === 0) continue;

    const avgComplexity =
      functionsWithMetrics.reduce((sum, f) => sum + f.metrics!.cyclomaticComplexity, 0) /
      functionsWithMetrics.length;

    // Simple quality score calculation
    const qualityScore = Math.max(0, 100 - (avgComplexity - 1) * 10);

    const highRiskCount = functionsWithMetrics.filter(
      f => f.metrics!.cyclomaticComplexity > 10
    ).length;

    periods.push({
      period: periodStart.toISOString().split('T')[0],
      snapshots: periodSnapshots,
      avgComplexity,
      totalFunctions: functionsWithMetrics.length,
      highRiskCount,
      qualityScore,
      trend: 'stable', // Simple implementation
    });
  }

  // Calculate overall trend
  const overallTrend =
    periods.length >= 2 && periods[0].qualityScore > periods[1].qualityScore
      ? 'improving'
      : periods.length >= 2 && periods[0].qualityScore < periods[1].qualityScore
        ? 'degrading'
        : 'stable';

  return {
    periods: periods.reverse(),
    overallTrend,
    keyInsights: generateKeyInsights(periods),
    recommendations: generateRecommendations(periods),
  };
}

function generateKeyInsights(periods: TrendData[]): string[] {
  const insights: string[] = [];

  if (periods.length >= 2) {
    const latest = periods[periods.length - 1];
    const previous = periods[periods.length - 2];

    const complexityChange = latest.avgComplexity - previous.avgComplexity;
    if (Math.abs(complexityChange) > 0.5) {
      insights.push(
        `Complexity ${complexityChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(complexityChange).toFixed(1)}`
      );
    }

    const riskChange = latest.highRiskCount - previous.highRiskCount;
    if (riskChange !== 0) {
      insights.push(
        `High-risk functions ${riskChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(riskChange)}`
      );
    }
  }

  return insights;
}

function generateRecommendations(periods: TrendData[]): string[] {
  const recommendations: string[] = [];

  if (periods.length > 0) {
    const latest = periods[periods.length - 1];

    if (latest.highRiskCount > 0) {
      recommendations.push('Review high-risk functions for refactoring opportunities');
    }

    if (latest.avgComplexity > 5) {
      recommendations.push('Consider breaking down complex functions');
    }
  }

  return recommendations;
}

function displayFullTrendAnalysis(trendData: TrendAnalysis, periodDays: number): void {
  console.log(chalk.yellow('Trend Summary:'));
  console.log(`  Period: ${periodDays} days`);
  console.log(`  Overall Trend: ${getTrendDisplay(trendData.overallTrend)}`);
  console.log(`  Data Points: ${trendData.periods.length}`);
  console.log();

  if (trendData.periods.length > 0) {
    console.log(chalk.yellow('Period Details:'));
    trendData.periods.forEach(period => {
      console.log(`  ${period.period}:`);
      console.log(`    Functions: ${period.totalFunctions}`);
      console.log(`    Avg Complexity: ${period.avgComplexity.toFixed(1)}`);
      console.log(`    High Risk: ${period.highRiskCount}`);
      console.log(`    Quality Score: ${period.qualityScore.toFixed(1)}`);
    });
    console.log();
  }

  if (trendData.keyInsights.length > 0) {
    console.log(chalk.yellow('Key Insights:'));
    trendData.keyInsights.forEach(insight => {
      console.log(`  - ${insight}`);
    });
    console.log();
  }

  if (trendData.recommendations.length > 0) {
    console.log(chalk.yellow('Recommendations:'));
    trendData.recommendations.forEach(rec => {
      console.log(`  - ${rec}`);
    });
    console.log();
  }
}

function displayConfigurationDetails(config: FuncqcConfig, verbose: boolean): void {
  console.log(chalk.blue('funcqc Configuration'));
  console.log('-'.repeat(50));
  console.log();

  console.log(chalk.yellow('Project Settings:'));
  console.log(`  Root Directories: ${config.roots.join(', ')}`);
  console.log(`  Database Path: ${config.storage.path}`);
  console.log(`  Git Integration: ${config.git.enabled ? 'enabled' : 'disabled'}`);
  console.log();

  console.log(chalk.yellow('Quality Thresholds:'));
  console.log(`  Cyclomatic Complexity: <= ${config.metrics.complexityThreshold}`);
  console.log(`  Cognitive Complexity: <= ${config.metrics.cognitiveComplexityThreshold}`);
  console.log(`  Lines of Code: <= ${config.metrics.linesOfCodeThreshold}`);
  console.log(`  Parameter Count: <= ${config.metrics.parameterCountThreshold}`);
  console.log(`  Max Nesting Level: <= ${config.metrics.maxNestingLevelThreshold}`);
  console.log();

  if (verbose) {
    console.log(chalk.yellow('Exclude Patterns:'));
    if (config.exclude.length === 0) {
      console.log('  (none)');
    } else {
      config.exclude.slice(0, 10).forEach(pattern => {
        console.log(`  - ${pattern}`);
      });
      if (config.exclude.length > 10) {
        console.log(`  ... and ${config.exclude.length - 10} more`);
      }
    }
    console.log();
  }
}

async function displayGitStatus(verbose: boolean): Promise<void> {
  try {
    const git: SimpleGit = simpleGit();
    const status = await git.status();

    console.log(chalk.yellow('Git Status:'));
    console.log(`  Branch: ${status.current || 'unknown'}`);
    console.log(`  Staged Files: ${status.staged.length}`);
    console.log(`  Modified Files: ${status.modified.length}`);

    if (verbose && (status.staged.length > 0 || status.modified.length > 0)) {
      if (status.staged.length > 0) {
        console.log('  Staged:');
        status.staged.slice(0, 5).forEach(file => {
          console.log(`    + ${file}`);
        });
      }
      if (status.modified.length > 0) {
        console.log('  Modified:');
        status.modified.slice(0, 5).forEach(file => {
          console.log(`    ~ ${file}`);
        });
      }
    }
    console.log();
  } catch {
    // Git status failed - not a git repository or git not available
    console.log(chalk.yellow('Git Status: Not available'));
    console.log();
  }
}

async function displayDetailedInsights(
  functions: FunctionInfo[],
  _storage: PGLiteStorageAdapter,
  snapshots: SnapshotInfo[]
): Promise<void> {
  console.log(chalk.yellow('Detailed Insights:'));

  const functionsWithMetrics = functions.filter(f => f.metrics);
  if (functionsWithMetrics.length === 0) return;

  // Find most complex functions
  const mostComplex = functionsWithMetrics
    .sort((a, b) => b.metrics!.cyclomaticComplexity - a.metrics!.cyclomaticComplexity)
    .slice(0, 3);

  console.log('  Most Complex Functions:');
  mostComplex.forEach((func, index) => {
    console.log(
      `    ${index + 1}. ${func.displayName}() (CC: ${func.metrics!.cyclomaticComplexity})`
    );
    console.log(`       ${func.filePath}:${func.startLine}`);
  });
  console.log();

  // Analysis history
  console.log(`  Analysis History: ${snapshots.length} snapshots`);
  if (snapshots.length > 1) {
    const oldest = snapshots[snapshots.length - 1];
    const daysSince = Math.floor((Date.now() - oldest.createdAt) / (1000 * 60 * 60 * 24));
    console.log(`  First Analysis: ${daysSince} days ago`);
  }
  console.log();
}

function getTrendDisplay(trend: 'improving' | 'stable' | 'degrading'): string {
  switch (trend) {
    case 'improving':
      return chalk.green('Improving');
    case 'degrading':
      return chalk.red('Degrading');
    default:
      return chalk.yellow('Stable');
  }
}

interface AIOptimizedHealthReport {
  summary: {
    total_functions: number;
    high_risk_functions: number;
    overall_grade: string;
    overall_score: number;
    last_analyzed: string;
  };
  high_risk_functions: Array<{
    id: string;
    name: string;
    display_name: string;
    location: string;
    risk_factors: string[];
    risk_score: number;
    fix_priority: number;
    estimated_effort: string;
    suggested_actions: string[];
    metrics: {
      cyclomatic_complexity: number;
      cognitive_complexity: number;
      lines_of_code: number;
      maintainability_index: number | null;
      parameter_count: number;
      max_nesting_level: number;
      branch_count: number;
      halstead_volume: number;
      halstead_difficulty: number;
      return_statement_count: number;
      async_await_count: number;
      try_catch_count: number;
      loop_count: number;
    };
  }>;
  improvement_roadmap: Array<{
    step: number;
    function_id: string;
    action: string;
    estimated_time: string;
    impact: 'high' | 'medium' | 'low';
    difficulty: 'easy' | 'medium' | 'hard';
  }>;
  next_actions: Array<{
    action_type: 'refactor' | 'split' | 'extract' | 'simplify';
    function_id: string;
    description: string;
    code_location: string;
    specific_steps: string[];
  }>;
}

// Extracted helper functions for displayAIOptimizedHealth refactoring

async function validateHealthData(
  storage: PGLiteStorageAdapter
): Promise<{ latest: SnapshotInfo; functionsWithMetrics: FunctionInfo[] } | null> {
  const snapshots = await storage.getSnapshots({ sort: 'created_at', limit: 1 });
  
  if (snapshots.length === 0) {
    console.log(JSON.stringify({
      error: 'No data found',
      suggestion: 'Run "funcqc scan" to analyze your project'
    }, null, 2));
    return null;
  }

  const latest = snapshots[0];
  const functions = await storage.getFunctions(latest.id);
  const functionsWithMetrics = functions.filter(f => f.metrics);
  
  if (functionsWithMetrics.length === 0) {
    console.log(JSON.stringify({
      error: 'No functions with metrics found'
    }, null, 2));
    return null;
  }

  return { latest, functionsWithMetrics };
}


async function assessHighRiskFunctions(
  functionsWithMetrics: FunctionInfo[],
  config: FuncqcConfig
): Promise<{ function: FunctionInfo; riskScore: number; riskFactors: string[] }[]> {
  // Use RiskAssessor to get consistent high-risk functions (matches --risks display)
  const riskAssessment = await riskAssessor.assessProject(
    functionsWithMetrics,
    config.thresholds,
    config.assessment
  );

  // Get ALL functions assessed as "high" risk level (matches --risks count: 134)
  // Note: We need to re-assess functions to get all high-risk ones, not just top 10
  const highRiskFunctions = [];
  for (const func of functionsWithMetrics) {
    const assessment = await riskAssessor.assessFunction(
      func,
      riskAssessment.statistics,
      config.thresholds,
      config.assessment
    );
    if (assessment.riskLevel === 'high') {
      highRiskFunctions.push(func);
    }
  }

  // Sort by risk score (complexity + size + maintainability issues)
  return highRiskFunctions
    .map(f => {
      const { riskScore, riskFactors } = calculateRiskScore(f, config);
      return {
        function: f,
        riskScore,
        riskFactors,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

function generateHealthReport(
  functionsWithMetrics: FunctionInfo[],
  sortedHighRiskFunctions: { function: FunctionInfo; riskScore: number; riskFactors: string[] }[],
  projectScore: ReturnType<QualityScorer['calculateProjectScore']>,
  latest: SnapshotInfo,
  config: FuncqcConfig
): AIOptimizedHealthReport {
  return {
    summary: {
      total_functions: functionsWithMetrics.length,
      high_risk_functions: sortedHighRiskFunctions.length,
      overall_grade: projectScore.overallGrade,
      overall_score: projectScore.score,
      last_analyzed: new Date(latest.createdAt).toISOString(),
    },
    high_risk_functions: sortedHighRiskFunctions.map((item, index) => {
      const f = item.function;
      const complexity = f.metrics?.cyclomaticComplexity || 1;
      const lines = f.metrics?.linesOfCode || 0;

      return {
        id: f.id,
        name: f.name,
        display_name: f.displayName,
        location: `${f.filePath}:${f.startLine}`,
        risk_factors: item.riskFactors,
        risk_score: Math.round(item.riskScore),
        fix_priority: index + 1,
        estimated_effort: estimateEffort(complexity, config),
        suggested_actions: generateSuggestedActions(f, config),
        metrics: {
          cyclomatic_complexity: complexity,
          cognitive_complexity: f.metrics?.cognitiveComplexity || 0,
          lines_of_code: lines,
          maintainability_index: f.metrics?.maintainabilityIndex || null,
          parameter_count: f.metrics?.parameterCount || 0,
          max_nesting_level: f.metrics?.maxNestingLevel || 0,
          branch_count: f.metrics?.branchCount || 0,
          halstead_volume: f.metrics?.halsteadVolume || 0,
          halstead_difficulty: f.metrics?.halsteadDifficulty || 0,
          return_statement_count: f.metrics?.returnStatementCount || 0,
          async_await_count: f.metrics?.asyncAwaitCount || 0,
          try_catch_count: f.metrics?.tryCatchCount || 0,
          loop_count: f.metrics?.loopCount || 0,
        },
      };
    }),
    improvement_roadmap: generateImprovementRoadmap(sortedHighRiskFunctions, config),
    next_actions: generateNextActions(sortedHighRiskFunctions, config),
  };
}

async function displayAIOptimizedHealth(
  storage: PGLiteStorageAdapter,
  config: FuncqcConfig,
  _options: HealthCommandOptions
): Promise<void> {
  try {
    // Data validation
    const validatedData = await validateHealthData(storage);
    if (!validatedData) return;
    
    const { latest, functionsWithMetrics } = validatedData;
    
    // Project score calculation
    const scorer = new QualityScorer();
    const projectScore = scorer.calculateProjectScore(functionsWithMetrics);
    
    // High-risk function assessment
    const sortedHighRiskFunctions = await assessHighRiskFunctions(functionsWithMetrics, config);
    
    // Report generation and output
    const report = generateHealthReport(functionsWithMetrics, sortedHighRiskFunctions, projectScore, latest, config);
    console.log(JSON.stringify(report, null, 2));
    
  } catch (error) {
    console.log(JSON.stringify({
      error: 'Failed to generate health report',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, null, 2));
  }
}

interface MetricEvaluation {
  score: number;
  factor?: string;
}

function evaluateComplexityRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const complexity = metrics?.cyclomaticComplexity || 1;
  if (complexity > config.metrics.complexityThreshold) {
    return {
      score: (complexity - config.metrics.complexityThreshold) * 10,
      factor: `complexity:${complexity}`
    };
  }
  return { score: 0 };
}

function evaluateCognitiveComplexityRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const cognitiveComplexity = metrics?.cognitiveComplexity || 0;
  if (cognitiveComplexity > config.metrics.cognitiveComplexityThreshold) {
    return {
      score: (cognitiveComplexity - config.metrics.cognitiveComplexityThreshold) * 12,
      factor: `cognitive_complexity:${cognitiveComplexity}`
    };
  }
  return { score: 0 };
}

function evaluateMaintainabilityRisk(metrics: QualityMetrics | undefined): MetricEvaluation {
  const maintainability = metrics?.maintainabilityIndex || 100;
  if (maintainability < 50) {
    return {
      score: (50 - maintainability) * 2,
      factor: `maintainability:${maintainability.toFixed(1)}`
    };
  }
  return { score: 0 };
}

function evaluateSizeRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const lines = metrics?.linesOfCode || 0;
  if (lines > config.metrics.linesOfCodeThreshold) {
    return {
      score: (lines - config.metrics.linesOfCodeThreshold) * 0.5,
      factor: `size:${lines}`
    };
  }
  return { score: 0 };
}

function evaluateNestingRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const nesting = metrics?.maxNestingLevel || 0;
  if (nesting > config.metrics.maxNestingLevelThreshold) {
    return {
      score: (nesting - config.metrics.maxNestingLevelThreshold) * 15,
      factor: `deep_nesting:${nesting}`
    };
  }
  return { score: 0 };
}

function evaluateBranchingRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const branches = metrics?.branchCount || 0;
  const branchThreshold = Math.max(5, config.metrics.complexityThreshold / 2);
  if (branches > branchThreshold) {
    return {
      score: (branches - branchThreshold) * 8,
      factor: `excessive_branching:${branches}`
    };
  }
  return { score: 0 };
}

function evaluateHalsteadVolumeRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const halsteadVolume = metrics?.halsteadVolume || 0;
  const threshold = typeof config.thresholds?.halsteadVolume?.warning === 'number' 
    ? config.thresholds.halsteadVolume.warning : 1000;
  if (halsteadVolume > threshold) {
    return {
      score: (halsteadVolume - threshold) * 0.05,
      factor: `high_halstead_volume:${Math.round(halsteadVolume)}`
    };
  }
  return { score: 0 };
}

function evaluateHalsteadDifficultyRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const halsteadDifficulty = metrics?.halsteadDifficulty || 0;
  const threshold = typeof config.thresholds?.halsteadDifficulty?.warning === 'number' 
    ? config.thresholds.halsteadDifficulty.warning : 20;
  if (halsteadDifficulty > threshold) {
    return {
      score: (halsteadDifficulty - threshold) * 3,
      factor: `high_halstead_difficulty:${Math.round(halsteadDifficulty)}`
    };
  }
  return { score: 0 };
}

function evaluateReturnStatementsRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const returnStatements = metrics?.returnStatementCount || 0;
  const threshold = typeof config.thresholds?.returnStatements?.warning === 'number' 
    ? config.thresholds.returnStatements.warning : 3;
  if (returnStatements > threshold) {
    return {
      score: (returnStatements - threshold) * 6,
      factor: `multiple_returns:${returnStatements}`
    };
  }
  return { score: 0 };
}

function evaluateAsyncAwaitRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const asyncAwaitCount = metrics?.asyncAwaitCount || 0;
  const threshold = typeof config.thresholds?.asyncAwait?.warning === 'number' 
    ? config.thresholds.asyncAwait.warning : 3;
  if (asyncAwaitCount > threshold) {
    return {
      score: (asyncAwaitCount - threshold) * 4,
      factor: `heavy_async:${asyncAwaitCount}`
    };
  }
  return { score: 0 };
}

function evaluateTryCatchRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const tryCatchCount = metrics?.tryCatchCount || 0;
  const threshold = typeof config.thresholds?.tryCatch?.warning === 'number' 
    ? config.thresholds.tryCatch.warning : 2;
  if (tryCatchCount > threshold) {
    return {
      score: (tryCatchCount - threshold) * 5,
      factor: `complex_error_handling:${tryCatchCount}`
    };
  }
  return { score: 0 };
}

function evaluateLoopRisk(metrics: QualityMetrics | undefined, config: FuncqcConfig): MetricEvaluation {
  const loopCount = metrics?.loopCount || 0;
  const threshold = typeof config.thresholds?.loops?.warning === 'number' 
    ? config.thresholds.loops.warning : 3;
  if (loopCount > threshold) {
    return {
      score: (loopCount - threshold) * 7,
      factor: `excessive_loops:${loopCount}`
    };
  }
  return { score: 0 };
}

function calculateRiskScore(
  f: FunctionInfo,
  config: FuncqcConfig
): { riskScore: number; riskFactors: string[] } {
  const metrics = f.metrics;
  const evaluations = [
    evaluateComplexityRisk(metrics, config),
    evaluateCognitiveComplexityRisk(metrics, config),
    evaluateMaintainabilityRisk(metrics),
    evaluateSizeRisk(metrics, config),
    evaluateNestingRisk(metrics, config),
    evaluateBranchingRisk(metrics, config),
    evaluateHalsteadVolumeRisk(metrics, config),
    evaluateHalsteadDifficultyRisk(metrics, config),
    evaluateReturnStatementsRisk(metrics, config),
    evaluateAsyncAwaitRisk(metrics, config),
    evaluateTryCatchRisk(metrics, config),
    evaluateLoopRisk(metrics, config)
  ];

  const riskScore = evaluations.reduce((total, evaluation) => total + evaluation.score, 0);
  const riskFactors = evaluations
    .filter(evaluation => evaluation.factor)
    .map(evaluation => evaluation.factor!);

  return { riskScore, riskFactors };
}

function generateSuggestedActions(f: FunctionInfo, config: FuncqcConfig): string[] {
  const metrics = f.metrics;
  if (!metrics) return [];

  const actions = new Set<string>();

  // Complexity-based actions
  if (metrics.cyclomaticComplexity > config.metrics.complexityThreshold) {
    actions.add('extract_methods');
    actions.add('reduce_branching');
  }

  if (metrics.cognitiveComplexity > config.metrics.cognitiveComplexityThreshold) {
    actions.add('simplify_logic');
    actions.add('reduce_cognitive_load');
  }

  // Size-based actions
  if (metrics.linesOfCode > config.metrics.linesOfCodeThreshold) {
    actions.add('split_function');
    actions.add('extract_helpers');
  }

  // Parameter-based actions
  if (metrics.parameterCount > config.metrics.parameterCountThreshold) {
    actions.add('parameterize_object');
    actions.add('extract_config');
  }

  // Nesting-based actions
  if (metrics.maxNestingLevel > config.metrics.maxNestingLevelThreshold) {
    actions.add('flatten_structure');
    actions.add('use_early_returns');
  }

  // Additional actions based on specific metrics
  if (metrics.branchCount > Math.max(5, config.metrics.complexityThreshold / 2)) {
    actions.add('consolidate_branches');
    actions.add('extract_switch_logic');
  }

  const halsteadVolumeThreshold = typeof config.thresholds?.halsteadVolume?.warning === 'number' ? config.thresholds.halsteadVolume.warning : 1000;
  if ((metrics.halsteadVolume || 0) > halsteadVolumeThreshold) {
    actions.add('reduce_vocabulary');
    actions.add('extract_constants');
  }

  const returnThreshold = typeof config.thresholds?.returnStatements?.warning === 'number' ? config.thresholds.returnStatements.warning : 3;
  if (metrics.returnStatementCount > returnThreshold) {
    actions.add('unify_returns');
    actions.add('extract_result_builder');
  }

  const asyncThreshold = typeof config.thresholds?.asyncAwait?.warning === 'number' ? config.thresholds.asyncAwait.warning : 3;
  if (metrics.asyncAwaitCount > asyncThreshold) {
    actions.add('extract_async_helpers');
    actions.add('simplify_async_flow');
  }

  return Array.from(actions);
}

function estimateEffort(complexity: number, config: FuncqcConfig): string {
  if (complexity > config.metrics.complexityThreshold * 2) return '60-120min';
  if (complexity > config.metrics.complexityThreshold * 1.5) return '30-60min';
  return '15-30min';
}

function generateImprovementRoadmap(
  sortedHighRiskFunctions: Array<{
    function: FunctionInfo;
    riskScore: number;
    riskFactors: string[];
  }>,
  config: FuncqcConfig
): Array<{
  step: number;
  function_id: string;
  action: string;
  estimated_time: string;
  impact: 'high' | 'medium' | 'low';
  difficulty: 'easy' | 'medium' | 'hard';
}> {
  return sortedHighRiskFunctions.slice(0, 5).map((item, index) => {
    const f = item.function;
    const complexity = f.metrics?.cyclomaticComplexity || 1;
    const highThreshold = config.metrics.complexityThreshold * 2;
    const mediumThreshold = config.metrics.complexityThreshold * 1.5;

    return {
      step: index + 1,
      function_id: f.id,
      action: complexity > mediumThreshold ? 'split_complex_function' : 'refactor_simplify',
      estimated_time: complexity > highThreshold ? '90min' : '45min',
      impact: complexity > highThreshold ? 'high' : complexity > mediumThreshold ? 'medium' : 'low',
      difficulty: complexity > highThreshold ? 'hard' : complexity > mediumThreshold ? 'medium' : 'easy',
    };
  });
}

function generateNextActions(
  sortedHighRiskFunctions: Array<{
    function: FunctionInfo;
    riskScore: number;
    riskFactors: string[];
  }>,
  config: FuncqcConfig
): Array<{
  action_type: 'refactor' | 'split' | 'extract' | 'simplify';
  function_id: string;
  description: string;
  code_location: string;
  specific_steps: string[];
}> {
  return sortedHighRiskFunctions.slice(0, 3).map(item => {
    const f = item.function;
    const complexity = f.metrics?.cyclomaticComplexity || 1;
    const lines = f.metrics?.linesOfCode || 0;

    let actionType: 'refactor' | 'split' | 'extract' | 'simplify';
    let description: string;
    let specificSteps: string[];

    if (complexity > config.metrics.complexityThreshold * 1.5 && lines > config.metrics.linesOfCodeThreshold * 2) {
      actionType = 'split';
      description = 'Split large, complex function into smaller, focused functions';
      specificSteps = [
        'Identify logical sections within the function',
        'Extract each section into a separate function',
        'Reduce main function to coordinating calls',
        'Verify tests still pass',
      ];
    } else if (complexity > config.metrics.complexityThreshold * 1.5) {
      actionType = 'simplify';
      description = 'Reduce cyclomatic complexity through refactoring';
      specificSteps = [
        'Replace nested if-else with early returns',
        'Extract complex conditions into named functions',
        'Use strategy pattern for multiple similar branches',
        'Simplify boolean expressions',
      ];
    } else {
      actionType = 'refactor';
      description = 'General refactoring to improve maintainability';
      specificSteps = [
        'Extract magic numbers into constants',
        'Improve variable naming',
        'Add appropriate comments',
        'Reduce parameter count if needed',
      ];
    }

    return {
      action_type: actionType,
      function_id: f.id,
      description,
      code_location: `${f.filePath}:${f.startLine}-${f.endLine}`,
      specific_steps: specificSteps,
    };
  });
}

/**
 * Get color function based on risk score level
 */
function getScoreColor(score: number): (text: string) => string {
  if (score <= 20) return chalk.green;      // Excellent: 0-20
  if (score <= 50) return chalk.yellow;     // Good: 21-50
  if (score <= 100) return chalk.cyan;      // Fair: 51-100
  if (score <= 200) return chalk.magenta;   // Poor: 101-200
  return chalk.red;                         // Critical: 200+
}

/**
 * Get interpretation text for risk score
 */
function getScoreInterpretation(score: number): string {
  if (score <= 20) return '(Excellent - Low technical debt)';
  if (score <= 50) return '(Good - Manageable complexity)';
  if (score <= 100) return '(Fair - Some refactoring needed)';
  if (score <= 200) return '(Poor - Significant technical debt)';
  return '(Critical - Urgent refactoring required)';
}

/**
 * Get grade label for quality scores
 */
function getGradeLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Fair';
  if (score >= 60) return 'Poor';
  return 'Critical';
}
