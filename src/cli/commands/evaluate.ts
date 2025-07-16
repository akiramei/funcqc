/**
 * Evaluate command for AI-generated code quality assessment
 * Provides immediate feedback for code generation workflows
 * 
 * This is the Reader function version that uses shared storage and config
 */

import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EvaluateCommandOptions, FunctionInfo } from '../../types/index.js';
import {
  RealTimeQualityGate,
  QualityAssessment,
  QualityViolation,
} from '../../core/realtime-quality-gate.js';
import { StructuralAnomaly } from '../../utils/structural-analyzer.js';
import { outputJson, isJsonOutput } from '../../utils/format-helpers.js';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';

/**
 * Evaluate command as a Reader function
 * Uses shared storage and config from environment
 */
export function evaluateCommand(input: string): VoidCommand<EvaluateCommandOptions> {
  return (options) => async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora();

    try {
      await executeEvaluateCommand(env, input, options, spinner);
    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  };
}

async function executeEvaluateCommand(
  env: CommandEnvironment,
  input: string,
  options: EvaluateCommandOptions,
  spinner: typeof ora.prototype
): Promise<void> {
  // Load baseline from historical data
  const qualityGate = await initializeQualityGate(env, spinner);

  // Get code to evaluate
  let code: string;
  let filename: string;

  if (options.stdin) {
    code = await readFromStdin();
    filename = 'stdin.ts';
  } else {
    // Input is a file path
    filename = path.resolve(input);
    code = await fs.readFile(filename, 'utf-8');
  }

  spinner.start('Evaluating code quality...');

  // Perform evaluation
  const assessment: QualityAssessment = await qualityGate.evaluateCode(code, { filename });

  spinner.stop();

  // Output results
  if (isJsonOutput(options)) {
    await outputJsonResults(assessment, options);
  } else {
    await displayHumanResults(assessment, filename, options);
  }

  // Exit with appropriate code
  if (options.aiGenerated) {
    // For AI generation: exit 1 if not acceptable, 0 otherwise
    process.exit(assessment.acceptable ? 0 : 1);
  } else {
    // For normal evaluation: always exit 0 unless critical errors
    const criticalViolations = assessment.violations.filter(v => v.severity === 'critical').length;
    const criticalAnomalies = assessment.structuralAnomalies.filter(a => a.severity === 'critical').length;
    
    if ((criticalViolations > 0 || criticalAnomalies > 0) && options.strict) {
      process.exit(1);
    }
  }
}


/**
 * Initialize quality gate with historical baseline using shared storage
 */
async function initializeQualityGate(
  env: CommandEnvironment,
  spinner: typeof ora.prototype
): Promise<RealTimeQualityGate> {
  spinner.start('Loading project baseline...');

  const qualityGate = new RealTimeQualityGate({
    warningThreshold: 2.0,
    criticalThreshold: 3.0,
    minBaselineFunctions: 10, // Lower threshold for evaluate command
    maxAnalysisTime: 5000, // 5 second timeout for single evaluation
  });

  try {
    // Get most recent snapshot to build baseline
    const recentSnapshots = await env.storage.getSnapshots({ limit: 1 });
    const allHistoricalFunctions: FunctionInfo[] = [];

    for (const snapshot of recentSnapshots) {
      const functions = await env.storage.getFunctions(snapshot.id);
      allHistoricalFunctions.push(...functions);
    }

    if (allHistoricalFunctions.length > 0) {
      qualityGate.updateBaseline(allHistoricalFunctions);
      spinner.succeed(`Baseline loaded from ${allHistoricalFunctions.length} functions`);
    } else {
      spinner.warn('No historical data - using static thresholds');
    }
  } catch {
    spinner.warn('Failed to load baseline - using static thresholds');
  }

  return qualityGate;
}

/**
 * Read code from stdin
 */
async function readFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('readable', () => {
      const chunk = process.stdin.read();
      if (chunk !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      if (data.trim() === '') {
        reject(new Error('No input provided'));
      } else {
        resolve(data);
      }
    });

    process.stdin.on('error', reject);

    // Set timeout for stdin read
    setTimeout(() => {
      reject(new Error('Timeout waiting for stdin input'));
    }, 10000); // 10 second timeout
  });
}

/**
 * Output results in JSON format
 */
async function outputJsonResults(
  assessment: QualityAssessment,
  options: EvaluateCommandOptions
): Promise<void> {
  // Single function assessment
  const result = {
    evaluationMode: 'single-function',
    acceptable: assessment.acceptable,
    qualityScore: assessment.qualityScore,
    structuralScore: assessment.structuralScore,
    responseTime: assessment.responseTime,
    violations: assessment.violations.map(v => ({
      metric: v.metric,
      value: v.value,
      threshold: v.threshold,
      zScore: v.zScore,
      severity: v.severity,
      suggestion: v.suggestion,
    })),
    structuralAnomalies: assessment.structuralAnomalies.map(a => ({
      metric: a.metric,
      value: a.value,
      expectedRange: a.expectedRange,
      severity: a.severity,
      description: a.description,
      suggestion: a.suggestion,
    })),
    structuralMetrics: assessment.structuralMetrics,
    improvementInstruction: assessment.improvementInstruction || null,
    metadata: {
      evaluationTime: new Date().toISOString(),
      mode: options.aiGenerated ? 'ai-generation' : 'evaluation',
      baseline: 'adaptive',
      evaluateAll: false,
    },
  };

  outputJson(result, options);
}

/**
 * Display results in human-readable format
 */
async function displayHumanResults(
  assessment: QualityAssessment,
  filename: string,
  options: EvaluateCommandOptions
): Promise<void> {
  displaySingleAssessmentResults(assessment, filename, options);
}

/**
 * Display single function assessment results
 */
function displaySingleAssessmentResults(
  assessment: QualityAssessment,
  filename: string,
  options: EvaluateCommandOptions
): void {
  displayAssessmentHeader(assessment, filename);
  displayOverallStatus(assessment);
  displayViolations(assessment.violations);
  displayStructuralAnomalies(assessment.structuralAnomalies);
  displayImprovementSuggestions(assessment);
  displayAIFeedback(assessment, options);
  console.log(); // Empty line for spacing
}


function displayAssessmentHeader(assessment: QualityAssessment, filename: string): void {
  const relativePath = path.relative(process.cwd(), filename);
  
  console.log(chalk.cyan('\n🎯 Code Quality Evaluation\n'));
  console.log(`📁 File: ${chalk.bold(relativePath)}`);
  console.log(`⚡ Response Time: ${chalk.green(assessment.responseTime.toFixed(1))}ms`);
  console.log(
    `📊 Quality Score: ${getScoreColor(assessment.qualityScore)(`${assessment.qualityScore}/100`)}`
  );
  console.log(
    `🏗️  Structural Score: ${getScoreColor(assessment.structuralScore)(`${assessment.structuralScore}/100`)}`
  );
}

function displayOverallStatus(assessment: QualityAssessment): void {
  if (assessment.acceptable) {
    console.log(chalk.green('\n✅ Code quality: ACCEPTABLE'));
  } else {
    console.log(chalk.red('\n❌ Code quality: NEEDS IMPROVEMENT'));
  }
}

function displayViolations(violations: QualityViolation[]): void {
  if (violations.length === 0) {
    return;
  }

  console.log(chalk.yellow('\n⚠️  Quality Violations:'));
  
  const criticalViolations = violations.filter(v => v.severity === 'critical');
  const warningViolations = violations.filter(v => v.severity === 'warning');

  displayViolationsByType(criticalViolations, 'Critical', chalk.red, '🔴');
  displayViolationsByType(warningViolations, 'Warnings', chalk.yellow, '🟡');
}

function displayViolationsByType(
  violations: QualityViolation[], 
  title: string, 
  colorFn: (text: string) => string, 
  icon: string
): void {
  if (violations.length === 0) {
    return;
  }

  console.log(colorFn(`\n  ${title}:`));
  for (const violation of violations) {
    displayViolation(violation, icon);
  }
}

function displayStructuralAnomalies(anomalies: StructuralAnomaly[]): void {
  if (anomalies.length === 0) {
    return;
  }

  console.log(chalk.magenta('\n🔗 Structural Anomalies:'));
  
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
  const warningAnomalies = anomalies.filter(a => a.severity === 'warning');

  displayAnomaliesByType(criticalAnomalies, 'Critical', chalk.red, '🔴');
  displayAnomaliesByType(warningAnomalies, 'Warnings', chalk.yellow, '🟡');
}

function displayAnomaliesByType(
  anomalies: StructuralAnomaly[], 
  title: string, 
  colorFn: (text: string) => string, 
  icon: string
): void {
  if (anomalies.length === 0) {
    return;
  }

  console.log(colorFn(`\n  ${title}:`));
  for (const anomaly of anomalies) {
    displayStructuralAnomaly(anomaly, icon);
  }
}

function displayImprovementSuggestions(assessment: QualityAssessment): void {
  if (!assessment.improvementInstruction) {
    return;
  }

  console.log(chalk.blue('\n💡 Suggested Improvements:'));
  console.log(`   ${assessment.improvementInstruction}`);
}

function displayAIFeedback(assessment: QualityAssessment, options: EvaluateCommandOptions): void {
  if (!options.aiGenerated) {
    return;
  }

  console.log(chalk.magenta('\n🤖 AI Generation Feedback:'));
  if (assessment.acceptable) {
    console.log('   ✅ Generated code meets quality standards');
  } else {
    console.log('   🔄 Regeneration recommended with improvements');
  }
}

/**
 * Display individual violation
 */
function displayViolation(violation: QualityViolation, icon: string): void {
  console.log(
    `   ${icon} ${chalk.bold(violation.metric)}: ${violation.value} (threshold: ${violation.threshold.toFixed(1)})`
  );
  if (violation.zScore !== 0) {
    console.log(
      `      Z-score: ${violation.zScore.toFixed(2)} (${Math.abs(violation.zScore).toFixed(1)}σ from project mean)`
    );
  }
  console.log(`      ${violation.suggestion}`);
}

/**
 * Display individual structural anomaly
 */
function displayStructuralAnomaly(anomaly: StructuralAnomaly, icon: string): void {
  console.log(
    `   ${icon} ${chalk.bold(anomaly.metric)}: ${anomaly.value.toFixed(3)} (expected: ${anomaly.expectedRange[0]}-${anomaly.expectedRange[1]})`
  );
  console.log(`      ${anomaly.description}`);
  console.log(`      ${anomaly.suggestion}`);
}

/**
 * Get color for score display
 */
function getScoreColor(score: number): typeof chalk.green {
  if (score >= 90) return chalk.green;
  if (score >= 80) return chalk.yellow;
  if (score >= 70) return chalk.yellow; // chalk doesn't have orange
  return chalk.red;
}