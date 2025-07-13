import { HealthCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import chalk from 'chalk';

interface HealthSummary {
  totalFunctions: number;
  highRiskFunctions: number;
  overallGrade: string;
  overallScore: number;
  lastAnalyzed: string;
  riskDistribution: {
    high: number;
    medium: number;
    low: number;
  };
  qualityBreakdown: {
    complexity: number;
    maintainability: number;
    size: number;
  };
}

/**
 * Health command as a Reader function
 */
export const healthCommand: VoidCommand<HealthCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const healthData = await gatherHealthData(options)(env);
      
      if (options.json || options.aiOptimized) {
        outputHealthJSON(healthData);
      } else {
        outputHealthReport(healthData, env);
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
          `Failed to generate health report: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Gather health data - Reader function
 */
const gatherHealthData = (_options: HealthCommandOptions) =>
  async (env: CommandEnvironment): Promise<HealthSummary> => {
    // Get all functions
    const functions = await env.storage.queryFunctions({});
    
    if (functions.length === 0) {
      throw new Error('No functions found. Run `funcqc scan` first.');
    }

    // Calculate basic stats
    const totalFunctions = functions.length;
    
    // Calculate risk distribution
    const highRiskFunctions = functions.filter(f => isHighRisk(f)).length;
    const mediumRiskFunctions = functions.filter(f => isMediumRisk(f)).length;
    const lowRiskFunctions = totalFunctions - highRiskFunctions - mediumRiskFunctions;

    // Calculate quality scores
    const complexityScore = calculateComplexityScore(functions);
    const maintainabilityScore = calculateMaintainabilityScore(functions);
    const sizeScore = calculateSizeScore(functions);
    
    const overallScore = Math.round((complexityScore + maintainabilityScore + sizeScore) / 3);
    const overallGrade = getGradeFromScore(overallScore);

    // Get last analyzed date (from most recent function)
    const lastAnalyzed = functions.reduce((latest, f) => {
      const funcDate = new Date((f as any).createdAt || 0);
      return funcDate > latest ? funcDate : latest;
    }, new Date(0)).toISOString();

    return {
      totalFunctions,
      highRiskFunctions,
      overallGrade,
      overallScore,
      lastAnalyzed,
      riskDistribution: {
        high: highRiskFunctions,
        medium: mediumRiskFunctions,
        low: lowRiskFunctions,
      },
      qualityBreakdown: {
        complexity: complexityScore,
        maintainability: maintainabilityScore,
        size: sizeScore,
      },
    };
  };

/**
 * Check if function is high risk
 */
function isHighRisk(func: any): boolean {
  const metrics = func.metrics;
  if (!metrics) return false;
  
  return (
    (metrics.cyclomaticComplexity && metrics.cyclomaticComplexity > 10) ||
    (metrics.linesOfCode && metrics.linesOfCode > 50) ||
    (metrics.nestingDepth && metrics.nestingDepth > 4) ||
    (metrics.parameterCount && metrics.parameterCount > 5)
  );
}

/**
 * Check if function is medium risk
 */
function isMediumRisk(func: any): boolean {
  if (isHighRisk(func)) return false;
  
  const metrics = func.metrics;
  if (!metrics) return false;
  
  return (
    (metrics.cyclomaticComplexity && metrics.cyclomaticComplexity > 5) ||
    (metrics.linesOfCode && metrics.linesOfCode > 25) ||
    (metrics.nestingDepth && metrics.nestingDepth > 2) ||
    (metrics.parameterCount && metrics.parameterCount > 3)
  );
}

/**
 * Calculate complexity score (0-100)
 */
function calculateComplexityScore(functions: any[]): number {
  const avgComplexity = functions
    .filter(f => f.metrics?.cyclomaticComplexity)
    .reduce((sum, f) => sum + f.metrics.cyclomaticComplexity, 0) / functions.length;
  
  // Score: 100 = complexity 1, 0 = complexity 20+
  return Math.max(0, Math.min(100, 100 - (avgComplexity - 1) * 5));
}

/**
 * Calculate maintainability score (0-100)
 */
function calculateMaintainabilityScore(functions: any[]): number {
  const functionsWithMaintainability = functions.filter(f => f.metrics?.maintainabilityIndex);
  
  if (functionsWithMaintainability.length === 0) return 80; // Default
  
  const avgMaintainability = functionsWithMaintainability
    .reduce((sum, f) => sum + f.metrics.maintainabilityIndex, 0) / functionsWithMaintainability.length;
  
  // Maintainability index typically ranges 0-100
  return Math.max(0, Math.min(100, avgMaintainability));
}

/**
 * Calculate size score (0-100)
 */
function calculateSizeScore(functions: any[]): number {
  const avgLines = functions
    .filter(f => f.metrics?.linesOfCode)
    .reduce((sum, f) => sum + f.metrics.linesOfCode, 0) / functions.length;
  
  // Score: 100 = 10 lines, 0 = 100+ lines
  return Math.max(0, Math.min(100, 100 - (avgLines - 10) * 1.1));
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
 * Output health data as JSON
 */
function outputHealthJSON(health: HealthSummary): void {
  const output = {
    summary: {
      total_functions: health.totalFunctions,
      high_risk_functions: health.highRiskFunctions,
      overall_grade: health.overallGrade,
      overall_score: health.overallScore,
      last_analyzed: health.lastAnalyzed,
    },
    risk_distribution: health.riskDistribution,
    quality_breakdown: health.qualityBreakdown,
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output formatted health report
 */
function outputHealthReport(health: HealthSummary, env: CommandEnvironment): void {
  console.log(chalk.bold.blue('funcqc Health Report'));
  console.log('─'.repeat(50));
  console.log('');

  // Project Overview
  console.log(chalk.bold('Project Overview:'));
  console.log(`  Total Functions: ${health.totalFunctions}`);
  console.log(`  Last Analyzed: ${new Date(health.lastAnalyzed).toLocaleDateString()}`);
  console.log(`  Database: ${env.config.storage.path || '.funcqc/funcqc.db'}`);
  console.log('');

  // Quality Overview
  console.log(chalk.bold('Quality Overview:'));
  const gradeColor = health.overallGrade === 'A' ? chalk.green : 
                    health.overallGrade === 'B' ? chalk.yellow : chalk.red;
  console.log(`  Overall Grade: ${gradeColor(health.overallGrade)} (${health.overallScore}/100)`);
  
  const riskColor = health.highRiskFunctions === 0 ? chalk.green :
                    health.highRiskFunctions < 5 ? chalk.yellow : chalk.red;
  console.log(`  High Risk Functions: ${riskColor(health.highRiskFunctions)} (${((health.highRiskFunctions / health.totalFunctions) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('  Details:');
  console.log(`    Complexity: ${getScoreDescription(health.qualityBreakdown.complexity)} (${health.qualityBreakdown.complexity}/100)`);
  console.log(`    Maintainability: ${getScoreDescription(health.qualityBreakdown.maintainability)} (${health.qualityBreakdown.maintainability}/100)`);
  console.log(`    Code Size: ${getScoreDescription(health.qualityBreakdown.size)} (${health.qualityBreakdown.size}/100)`);
  console.log('');

  // Risk Distribution
  console.log(chalk.bold('Risk Distribution:'));
  const total = health.totalFunctions;
  console.log(`  High Risk: ${health.riskDistribution.high} functions (${((health.riskDistribution.high / total) * 100).toFixed(1)}%)`);
  console.log(`  Medium Risk: ${health.riskDistribution.medium} functions (${((health.riskDistribution.medium / total) * 100).toFixed(1)}%)`);
  console.log(`  Low Risk: ${health.riskDistribution.low} functions (${((health.riskDistribution.low / total) * 100).toFixed(1)}%)`);
  console.log('');

  // Recommendations
  if (health.highRiskFunctions > 0) {
    console.log(chalk.bold('🎯 Recommendations:'));
    console.log(`  • Focus on the ${health.highRiskFunctions} high-risk functions first`);
    console.log(`  • Use ${chalk.cyan('funcqc list --cc-ge 10')} to find complex functions`);
    console.log(`  • Consider breaking down large functions (>50 lines)`);
    console.log('');
  }
}

/**
 * Get description for score
 */
function getScoreDescription(score: number): string {
  if (score >= 90) return chalk.green('Excellent');
  if (score >= 80) return chalk.yellow('Good');
  if (score >= 70) return chalk.hex('#FFA500')('Fair'); // orange color
  if (score >= 60) return chalk.red('Poor');
  return chalk.red.bold('Critical');
}