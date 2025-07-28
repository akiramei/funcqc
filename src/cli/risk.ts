import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { VoidCommand, BaseCommandOptions } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { FunctionInfo } from '../types';
import { createErrorHandler } from '../utils/error-handler';
import { DatabaseError } from '../storage/pglite-adapter';
import { RiskDetector, RiskAnalysisResult } from '../analyzers/risk-detector';
import { SCCAnalyzer, SCCAnalysisResult, StronglyConnectedComponent } from '../analyzers/scc-analyzer';
import { ComprehensiveRiskScorer, ComprehensiveRiskAssessment } from '../analyzers/comprehensive-risk-scorer';
import { RiskConfigManager, RiskConfig } from '../config/risk-config';
import { DependencyMetricsCalculator } from '../analyzers/dependency-metrics';
import { DotGenerator } from '../visualization/dot-generator';

interface RiskAnalyzeOptions extends BaseCommandOptions {
  config?: string;
  format?: 'table' | 'json' | 'dot';
  severity?: 'critical' | 'high' | 'medium' | 'low';
  pattern?: 'wrapper' | 'fake-split' | 'complexity-hotspot' | 'isolated' | 'circular';
  limit?: string;
  minScore?: string;
  includeRecommendations?: boolean;
  groupBy?: 'severity' | 'file' | 'pattern' | 'score';
  snapshot?: string;
}

interface RiskSCCOptions extends BaseCommandOptions {
  format?: 'table' | 'json';
  minSize?: string;
  includeRecursive?: boolean;
  showMetrics?: boolean;
  snapshot?: string;
}

interface RiskScoreOptions extends BaseCommandOptions {
  functionName?: string;
  functionId?: string;
  config?: string;
  format?: 'table' | 'json';
  includeFactors?: boolean;
  snapshot?: string;
}

/**
 * Analyze risk patterns in the codebase
 */
export const riskAnalyzeCommand: VoidCommand<RiskAnalyzeOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Loading risk configuration...').start();

    try {
      const riskConfig = loadRiskConfig(options.config);
      const analysisData = await loadRiskAnalysisData(env, options, spinner);
      const calculations = await performRiskCalculations(analysisData, riskConfig, spinner);
      const filteredResults = applyRiskFilters(calculations.riskAssessments, options);
      
      spinner.succeed('Risk analysis complete');
      outputRiskResults(calculations.riskAnalysis, filteredResults, riskConfig, analysisData, options);
    } catch (error) {
      handleRiskAnalysisError(spinner, errorHandler, error);
    }
  };

/**
 * Analyze strongly connected components
 */
export const riskSCCCommand: VoidCommand<RiskSCCOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Loading snapshot data...').start();

    try {
      // Get the latest snapshot
      const snapshot = options.snapshot ? 
        await env.storage.getSnapshot(options.snapshot) :
        await env.storage.getLatestSnapshot();

      if (!snapshot) {
        spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      spinner.text = 'Loading call graph...';

      // Get call edges
      const callEdges = await env.storage.getCallEdgesBySnapshot(snapshot.id);

      if (callEdges.length === 0) {
        spinner.fail(chalk.yellow('No call graph data found. The call graph analyzer may need to be run.'));
        return;
      }

      spinner.text = 'Analyzing strongly connected components...';

      // Analyze SCCs
      const sccAnalyzer = new SCCAnalyzer();
      const sccResult = sccAnalyzer.findStronglyConnectedComponents(callEdges);

      spinner.succeed('SCC analysis complete');

      // Apply filters
      let filteredComponents = sccResult.components;

      if (options.minSize) {
        const minSize = parseInt(options.minSize, 10);
        if (!isNaN(minSize) && minSize > 0) {
          filteredComponents = filteredComponents.filter(c => c.size >= minSize);
        }
      }

      if (!options.includeRecursive) {
        filteredComponents = filteredComponents.filter(c => !c.isRecursive || c.size > 1);
      }

      // Output results
      if (options.format === 'json') {
        outputSCCAnalysisJSON(sccResult, filteredComponents, options);
      } else {
        outputSCCAnalysisTable(sccResult, filteredComponents, options, env);
      }

    } catch (error) {
      spinner.fail('Failed to analyze SCCs');
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

/**
 * Score individual functions
 */
export const riskScoreCommand: VoidCommand<RiskScoreOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Loading configuration...').start();

    try {
      // Load risk configuration
      const configManager = new RiskConfigManager();
      const riskConfig = configManager.load(options.config);

      spinner.text = 'Loading snapshot data...';

      // Get the latest snapshot
      const snapshot = options.snapshot ? 
        await env.storage.getSnapshot(options.snapshot) :
        await env.storage.getLatestSnapshot();

      if (!snapshot) {
        spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      // Get all functions
      const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);

      let targetFunction: FunctionInfo | undefined;
      if (options.functionId) {
        targetFunction = functions.find(f => f.id === options.functionId);
        if (!targetFunction) {
          spinner.fail(chalk.red(`Function not found with ID: ${options.functionId}`));
          return;
        }
      } else if (options.functionName) {
        // First try exact match
        targetFunction = functions.find(f => f.name === options.functionName);
        
        if (!targetFunction) {
          // Try partial match
          const matchedFunctions = functions.filter(f => 
            f.name.includes(options.functionName || '')
          );
          
          if (matchedFunctions.length === 0) {
            spinner.fail(chalk.red(`Function not found: ${options.functionName}`));
            return;
          } else if (matchedFunctions.length === 1) {
            targetFunction = matchedFunctions[0];
          } else {
            // Multiple matches found
            spinner.fail(chalk.red(`Multiple functions matched: ${options.functionName}. Please be more specific.`));
            console.log(chalk.gray('\nMatched functions:'));
            matchedFunctions.forEach(f => {
              console.log(`  - ${chalk.cyan(f.name)} ${chalk.gray(`(${f.filePath}:${f.startLine})`)}`);
            });
            console.log(chalk.gray('\nUse --function-id for exact match or provide a more specific name.'));
            return;
          }
        }
      } else {
        spinner.fail(chalk.red('Either --function-name or --function-id must be specified'));
        return;
      }

      spinner.text = 'Calculating risk score...';

      // Get call edges and dependency metrics
      const [callEdges] = await Promise.all([
        env.storage.getCallEdgesBySnapshot(snapshot.id),
      ]);

      // TODO: Performance optimization opportunity
      // Currently, we analyze the entire codebase to score a single function.
      // Future improvement: Implement targeted analysis methods in analyzers:
      // - DependencyMetricsCalculator.calculateForFunction(targetFunction, callEdges)
      // - RiskDetector.analyzeFunction(targetFunction, localContext)
      // - SCCAnalyzer.findComponentContaining(targetFunction, callEdges)
      // This would reduce complexity from O(N) to O(log N) for large codebases.

      // Calculate dependency metrics for the specific function
      const metricsCalculator = new DependencyMetricsCalculator();
      const allMetrics = metricsCalculator.calculateMetrics(
        functions,
        callEdges,
        new Set(),
        new Set()
      );
      const targetMetrics = allMetrics.find(m => m.functionId === targetFunction.id);

      // Detect patterns for the function
      const riskDetector = new RiskDetector();
      const riskAnalysis = riskDetector.analyzeRisks(functions, callEdges, allMetrics);
      const functionPatterns = riskAnalysis.patterns.filter(p => p.functionId === targetFunction.id);

      // Calculate SCC info
      const sccAnalyzer = new SCCAnalyzer();
      const sccResult = sccAnalyzer.findStronglyConnectedComponents(callEdges);

      // Calculate comprehensive risk assessment
      const riskScorer = new ComprehensiveRiskScorer(riskConfig.scoring);
      const allAssessments = riskScorer.assessRisks(
        [targetFunction],
        callEdges,
        targetMetrics ? [targetMetrics] : [],
        functionPatterns,
        sccResult.components
      );

      const assessment = allAssessments[0];

      spinner.succeed('Risk scoring complete');

      // Output results
      if (options.format === 'json') {
        outputRiskScoreJSON(targetFunction, assessment, options);
      } else {
        outputRiskScoreTable(targetFunction, assessment, options);
      }

    } catch (error) {
      spinner.fail('Failed to score function');
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

/**
 * Output risk analysis as JSON
 */
function outputRiskAnalysisJSON(
  analysis: RiskAnalysisResult,
  assessments: ComprehensiveRiskAssessment[],
  _riskConfig: RiskConfig,
  options: RiskAnalyzeOptions
): void {
  const result = {
    summary: analysis.summary,
    assessments: assessments,
    ...(options.includeRecommendations && {
      recommendations: analysis.recommendations,
    }),
    filters: {
      severity: options.severity,
      pattern: options.pattern,
      minScore: options.minScore,
      limit: options.limit,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output risk analysis as formatted table
 */
function outputRiskAnalysisTable(
  analysis: RiskAnalysisResult,
  assessments: ComprehensiveRiskAssessment[],
  _riskConfig: RiskConfig,
  options: RiskAnalyzeOptions
): void {
  console.log(chalk.bold('\n🚨 Risk Analysis Report\n'));

  // Summary
  console.log(`Total functions analyzed: ${chalk.cyan(assessments.length)}`);
  console.log(`Total risks detected: ${chalk.cyan(analysis.summary.totalRisks)}`);
  console.log(`Overall risk score: ${chalk.yellow(analysis.summary.riskScore)}/100`);
  console.log();

  // Risk distribution
  console.log(chalk.bold('📊 Risk Distribution:'));
  const riskCounts = {
    critical: assessments.filter(a => a.riskLevel === 'critical').length,
    high: assessments.filter(a => a.riskLevel === 'high').length,
    medium: assessments.filter(a => a.riskLevel === 'medium').length,
    low: assessments.filter(a => a.riskLevel === 'low').length,
  };

  console.log(`  ${chalk.red('●')} Critical: ${chalk.red(riskCounts.critical)}`);
  console.log(`  ${chalk.yellow('●')} High: ${chalk.yellow(riskCounts.high)}`);
  console.log(`  ${chalk.blue('●')} Medium: ${chalk.blue(riskCounts.medium)}`);
  console.log(`  ${chalk.gray('●')} Low: ${chalk.gray(riskCounts.low)}`);
  console.log();

  if (assessments.length === 0) {
    console.log(chalk.green('✅ No risks found matching the criteria!'));
    return;
  }

  // Group results based on groupBy option
  const outputStrategies = {
    severity: outputByRiskLevel,
    file: outputByFile,
    pattern: outputByPattern,
    score: outputByScore,
  } as const;

  const groupBy = options.groupBy || 'severity';
  const outputStrategy = outputStrategies[groupBy] || outputByScore;
  outputStrategy(assessments, options);

  // Recommendations
  if (options.includeRecommendations && analysis.recommendations.length > 0) {
    console.log(chalk.bold('\n💡 Recommendations:'));
    analysis.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });
  }
}

/**
 * Output assessments grouped by risk level
 */
function outputByRiskLevel(assessments: ComprehensiveRiskAssessment[], options: RiskAnalyzeOptions): void {
  const groupedByLevel = assessments.reduce((groups, assessment) => {
    if (!groups[assessment.riskLevel]) {
      groups[assessment.riskLevel] = [];
    }
    groups[assessment.riskLevel].push(assessment);
    return groups;
  }, {} as Record<string, ComprehensiveRiskAssessment[]>);

  const severityOrder: Array<'critical' | 'high' | 'medium' | 'low'> = ['critical', 'high', 'medium', 'low'];
  const severityColors = { critical: chalk.red, high: chalk.yellow, medium: chalk.blue, low: chalk.gray };
  const severityIcons = { critical: '🔴', high: '🟡', medium: '🔵', low: '⚪' };

  for (const severity of severityOrder) {
    const levelAssessments = groupedByLevel[severity];
    if (!levelAssessments || levelAssessments.length === 0) continue;

    console.log(severityColors[severity].bold(`${severityIcons[severity]} ${severity.toUpperCase()} (${levelAssessments.length}):`));
    console.log();

    // Sort by score within level
    levelAssessments.sort((a, b) => b.overallScore - a.overallScore);

    for (const assessment of levelAssessments.slice(0, 10)) { // Top 10 per level
      console.log(`  ${severityColors[severity]('●')} ${chalk.cyan(assessment.functionName)} (${assessment.overallScore})`);
      console.log(`    ${chalk.gray('File:')} ${assessment.filePath}`);
      console.log(`    ${chalk.gray('Patterns:')} ${assessment.patterns.map(p => p.type).join(', ') || 'none'}`);
      
      if (options.includeRecommendations && assessment.recommendations.length > 0) {
        console.log(`    ${chalk.gray('→')} ${assessment.recommendations[0]}`);
      }
      console.log();
    }
  }
}

/**
 * Output assessments grouped by file
 */
function outputByFile(assessments: ComprehensiveRiskAssessment[], _options: RiskAnalyzeOptions): void {
  const groupedByFile = assessments.reduce((groups, assessment) => {
    if (!groups[assessment.filePath]) {
      groups[assessment.filePath] = [];
    }
    groups[assessment.filePath].push(assessment);
    return groups;
  }, {} as Record<string, ComprehensiveRiskAssessment[]>);

  console.log(chalk.bold('📁 Risks by File:'));
  console.log();

  // Sort files by total risk score
  const sortedFiles = Object.entries(groupedByFile)
    .map(([file, risks]) => ({
      file,
      risks,
      totalScore: risks.reduce((sum, r) => sum + r.overallScore, 0),
      avgScore: risks.reduce((sum, r) => sum + r.overallScore, 0) / risks.length,
    }))
    .sort((a, b) => b.totalScore - a.totalScore);

  for (const { file, risks, avgScore } of sortedFiles.slice(0, 10)) {
    console.log(chalk.underline(file));
    console.log(`  ${chalk.gray('Functions:')} ${risks.length}, ${chalk.gray('Avg Score:')} ${Math.round(avgScore)}`);
    
    // Show top 3 functions in this file
    risks.sort((a, b) => b.overallScore - a.overallScore);
    for (const risk of risks.slice(0, 3)) {
      const color = risk.riskLevel === 'critical' ? chalk.red : 
                   risk.riskLevel === 'high' ? chalk.yellow : 
                   risk.riskLevel === 'medium' ? chalk.blue : chalk.gray;
      console.log(`    ${color('●')} ${risk.functionName} (${risk.overallScore})`);
    }
    console.log();
  }
}

/**
 * Output assessments grouped by pattern
 */
function outputByPattern(assessments: ComprehensiveRiskAssessment[], _options: RiskAnalyzeOptions): void {
  const patternCounts = new Map<string, ComprehensiveRiskAssessment[]>();
  
  for (const assessment of assessments) {
    for (const pattern of assessment.patterns) {
      if (!patternCounts.has(pattern.type)) {
        patternCounts.set(pattern.type, []);
      }
      patternCounts.get(pattern.type)!.push(assessment);
    }
  }

  console.log(chalk.bold('🔍 Risks by Pattern:'));
  console.log();

  // Sort patterns by frequency
  const sortedPatterns = Array.from(patternCounts.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [patternType, risks] of sortedPatterns) {
    console.log(`${chalk.bold(patternType)} (${risks.length} functions):`);
    
    // Show top functions for this pattern
    risks.sort((a, b) => b.overallScore - a.overallScore);
    for (const risk of risks.slice(0, 5)) {
      const color = risk.riskLevel === 'critical' ? chalk.red : 
                   risk.riskLevel === 'high' ? chalk.yellow : 
                   risk.riskLevel === 'medium' ? chalk.blue : chalk.gray;
      console.log(`  ${color('●')} ${risk.functionName} (${risk.overallScore})`);
    }
    console.log();
  }
}

/**
 * Output assessments sorted by score
 */
function outputByScore(assessments: ComprehensiveRiskAssessment[], options: RiskAnalyzeOptions): void {
  console.log(chalk.bold('📈 Top Risk Functions (by score):'));
  console.log();

  // Already sorted by score, just display
  for (const assessment of assessments.slice(0, 20)) {
    const color = assessment.riskLevel === 'critical' ? chalk.red : 
                 assessment.riskLevel === 'high' ? chalk.yellow : 
                 assessment.riskLevel === 'medium' ? chalk.blue : chalk.gray;
    
    console.log(`${color('●')} ${chalk.cyan(assessment.functionName)} (${assessment.overallScore})`);
    console.log(`  ${chalk.gray('File:')} ${assessment.filePath}`);
    console.log(`  ${chalk.gray('Risk Level:')} ${color(assessment.riskLevel)}`);
    console.log(`  ${chalk.gray('Patterns:')} ${assessment.patterns.map(p => p.type).join(', ') || 'none'}`);
    
    if (options.includeRecommendations && assessment.recommendations.length > 0) {
      console.log(`  ${chalk.gray('→')} ${assessment.recommendations[0]}`);
    }
    console.log();
  }
}

/**
 * Output SCC analysis as JSON
 */
function outputSCCAnalysisJSON(
  sccResult: SCCAnalysisResult,
  components: StronglyConnectedComponent[],
  options: RiskSCCOptions
): void {
  const result = {
    summary: {
      totalComponents: sccResult.totalComponents,
      largestComponentSize: sccResult.largestComponentSize,
      recursiveFunctions: sccResult.recursiveFunctions.length,
    },
    components: components,
    filters: {
      minSize: options.minSize,
      includeRecursive: options.includeRecursive,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output SCC analysis as formatted table
 */
function outputSCCAnalysisTable(
  sccResult: SCCAnalysisResult,
  components: StronglyConnectedComponent[],
  options: RiskSCCOptions,
  _env: CommandEnvironment
): void {
  console.log(chalk.bold('\n🔄 Strongly Connected Components Analysis\n'));

  console.log(`Total components: ${chalk.cyan(sccResult.totalComponents)}`);
  console.log(`Largest component: ${chalk.cyan(sccResult.largestComponentSize)} functions`);
  console.log(`Recursive functions: ${chalk.cyan(sccResult.recursiveFunctions.length)}`);
  console.log();

  if (components.length === 0) {
    console.log(chalk.green('✅ No strongly connected components found!'));
    return;
  }

  console.log(chalk.bold('📊 Components:'));
  console.log();

  // Sort by size (descending)
  components.sort((a, b) => b.size - a.size);

  for (const component of components) {
    const sizeColor = component.size > 5 ? chalk.red : 
                     component.size > 3 ? chalk.yellow : chalk.blue;
    
    console.log(`${sizeColor('●')} Component ${component.id} (${component.size} functions)`);
    
    if (component.isRecursive) {
      console.log(`  ${chalk.gray('Type:')} Recursive function`);
    } else {
      console.log(`  ${chalk.gray('Type:')} Circular dependency`);
    }
    
    console.log(`  ${chalk.gray('Functions:')} ${component.functionIds.slice(0, 5).join(', ')}${component.functionIds.length > 5 ? '...' : ''}`);
    console.log(`  ${chalk.gray('Edges:')} ${component.edges.length} internal calls`);
    
    if (options.showMetrics) {
      // Would need to implement complexity calculation here
      console.log(`  ${chalk.gray('Risk:')} ${component.size > 5 ? chalk.red('High') : component.size > 3 ? chalk.yellow('Medium') : chalk.blue('Low')}`);
    }
    
    console.log();
  }
}

/**
 * Output risk score as JSON
 */
function outputRiskScoreJSON(
  func: FunctionInfo,
  assessment: ComprehensiveRiskAssessment,
  options: RiskScoreOptions
): void {
  const result = {
    function: {
      id: func.id,
      name: func.name,
      filePath: func.filePath,
    },
    assessment: assessment,
    ...(options.includeFactors && {
      factors: assessment.factors,
    }),
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output risk score as formatted display
 */
function outputRiskScoreTable(
  func: FunctionInfo,
  assessment: ComprehensiveRiskAssessment,
  options: RiskScoreOptions
): void {
  console.log(chalk.bold(`\n🎯 Risk Assessment for: ${chalk.cyan(func.name)}\n`));

  // Basic info
  console.log(`Function ID: ${chalk.gray(func.id)}`);
  console.log(`File: ${chalk.gray(func.filePath)}:${func.startLine}`);
  console.log();

  // Overall score
  const scoreColor = assessment.riskLevel === 'critical' ? chalk.red : 
                    assessment.riskLevel === 'high' ? chalk.yellow : 
                    assessment.riskLevel === 'medium' ? chalk.blue : chalk.green;
  
  console.log(`Overall Risk Score: ${scoreColor.bold(assessment.overallScore)}/100`);
  console.log(`Risk Level: ${scoreColor.bold(assessment.riskLevel.toUpperCase())}`);
  console.log(`Priority: ${assessment.priority}/100`);
  console.log();

  // Patterns
  if (assessment.patterns.length > 0) {
    console.log(chalk.bold('🔍 Detected Patterns:'));
    for (const pattern of assessment.patterns) {
      const patternColor = pattern.severity === 'critical' ? chalk.red : 
                          pattern.severity === 'high' ? chalk.yellow : 
                          pattern.severity === 'medium' ? chalk.blue : chalk.gray;
      console.log(`  ${patternColor('●')} ${pattern.type}: ${pattern.description}`);
    }
    console.log();
  }

  // Risk factors
  if (options.includeFactors && assessment.factors.length > 0) {
    console.log(chalk.bold('⚖️ Risk Factors:'));
    assessment.factors
      .sort((a, b) => (b.score * b.weight) - (a.score * a.weight))
      .forEach(factor => {
        const barLength = Math.round(factor.score / 5);
        const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
        
        console.log(`  ${factor.name.padEnd(20)} ${factor.score.toString().padStart(3)}/100 ${chalk.gray(bar)} (weight: ${(factor.weight * 100).toFixed(1)}%)`);
        console.log(`    ${chalk.gray(factor.description)}`);
      });
    console.log();
  }

  // Recommendations
  if (assessment.recommendations.length > 0) {
    console.log(chalk.bold('💡 Recommendations:'));
    assessment.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });
    console.log();
  }
}

/**
 * Output risk analysis as DOT format
 * Note: Receives pre-filtered assessments from riskAnalyzeCommand
 */
function outputRiskAnalysisDot(
  functions: import('../types').FunctionInfo[],
  callEdges: import('../types').CallEdge[],
  assessments: ComprehensiveRiskAssessment[],
  options: RiskAnalyzeOptions
): void {
  const dotGenerator = new DotGenerator();
  
  // Filter functions to only include those with risk assessments (assessments are pre-filtered)
  const assessmentFunctionIds = new Set(assessments.map(a => a.functionId));
  const filteredFunctions = functions.filter(func => assessmentFunctionIds.has(func.id));
  
  // Filter call edges to only include those between remaining functions
  const filteredCallEdges = callEdges.filter(edge => 
    assessmentFunctionIds.has(edge.callerFunctionId) && 
    assessmentFunctionIds.has(edge.calleeFunctionId || '')
  );
  
  // Generate DOT graph
  const dotOptions = {
    title: 'Risk Analysis Graph',
    rankdir: 'TB' as const,
    nodeShape: 'box' as const,
    includeMetrics: true,
    clusterBy: (() => {
      switch (options.groupBy) {
        case 'file': return 'file' as const;
        case 'severity': return 'risk' as const;
        case 'pattern': return 'complexity' as const; // pattern complexity maps to complexity clustering
        case 'score': return 'risk' as const; // score-based grouping maps to risk clustering
        default: return 'risk' as const;
      }
    })(),
    showLabels: true,
    maxLabelLength: 30,
  };
  
  const dotOutput = dotGenerator.generateRiskGraph(
    filteredFunctions,
    filteredCallEdges,
    assessments,
    dotOptions
  );
  
  console.log(dotOutput);
}

// ================== Helper Functions for Refactored riskAnalyzeCommand ==================

interface RiskAnalysisData {
  functions: import('../types').FunctionInfo[];
  callEdges: import('../types').CallEdge[];
  dependencyMetrics: import('../analyzers/dependency-metrics').DependencyMetrics[];
}

interface RiskCalculations {
  riskAnalysis: RiskAnalysisResult;
  riskAssessments: ComprehensiveRiskAssessment[];
  sccResult: SCCAnalysisResult;
}

/**
 * Load risk configuration
 */
function loadRiskConfig(configPath?: string): RiskConfig {
  const configManager = new RiskConfigManager();
  return configManager.load(configPath);
}

/**
 * Load all data required for risk analysis
 */
async function loadRiskAnalysisData(
  env: CommandEnvironment, 
  options: RiskAnalyzeOptions, 
  spinner: Ora
): Promise<RiskAnalysisData> {
  spinner.text = 'Loading snapshot data...';

  const snapshot = options.snapshot ? 
    await env.storage.getSnapshot(options.snapshot) :
    await env.storage.getLatestSnapshot();

  if (!snapshot) {
    spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    throw new Error('No snapshots found');
  }

  spinner.text = 'Loading functions and call graph...';

  const [functions, callEdges] = await Promise.all([
    env.storage.getFunctionsBySnapshot(snapshot.id),
    env.storage.getCallEdgesBySnapshot(snapshot.id),
  ]);

  if (functions.length === 0) {
    spinner.fail(chalk.yellow('No functions found in the snapshot.'));
    throw new Error('No functions found');
  }

  spinner.text = 'Calculating dependency metrics...';

  const metricsCalculator = new DependencyMetricsCalculator();
  const dependencyMetrics = metricsCalculator.calculateMetrics(
    functions,
    callEdges,
    new Set(), // entryPoints - empty for now
    new Set()  // cyclicFunctions - empty for now
  );

  return { functions, callEdges, dependencyMetrics };
}

/**
 * Perform all risk calculations
 */
async function performRiskCalculations(
  data: RiskAnalysisData,
  riskConfig: RiskConfig,
  spinner: Ora
): Promise<RiskCalculations> {
  spinner.text = 'Detecting risk patterns...';

  const riskDetector = new RiskDetector({
    wrapperThreshold: riskConfig.detection.wrapperDetection.parameterMatchTolerance,
    fakeSplitThreshold: riskConfig.detection.fakeSplitDetection.couplingThreshold,
    complexityHotspotThreshold: riskConfig.detection.complexityHotspots.cyclomaticThreshold,
    minFunctionSize: riskConfig.detection.isolatedFunctions.minSize,
    includeIsolated: riskConfig.detection.isolatedFunctions.enabled,
  });

  const riskAnalysis = riskDetector.analyzeRisks(data.functions, data.callEdges, data.dependencyMetrics);

  spinner.text = 'Analyzing strongly connected components...';

  const sccAnalyzer = new SCCAnalyzer();
  const sccResult = sccAnalyzer.findStronglyConnectedComponents(data.callEdges);

  spinner.text = 'Calculating comprehensive risk scores...';

  const riskScorer = new ComprehensiveRiskScorer(riskConfig.scoring);
  const riskAssessments = riskScorer.assessRisks(
    data.functions,
    data.callEdges,
    data.dependencyMetrics,
    riskAnalysis.patterns,
    sccResult.components
  );

  return { riskAnalysis, riskAssessments, sccResult };
}

/**
 * Apply filters to risk assessments
 */
function applyRiskFilters(riskAssessments: ComprehensiveRiskAssessment[], options: RiskAnalyzeOptions): ComprehensiveRiskAssessment[] {
  let filteredAssessments = riskAssessments;

  if (options.severity) {
    filteredAssessments = filteredAssessments.filter(a => a.riskLevel === options.severity);
  }

  if (options.pattern) {
    filteredAssessments = filteredAssessments.filter(a => 
      a.patterns.some(p => p.type === options.pattern)
    );
  }

  if (options.minScore) {
    const minScore = parseInt(options.minScore, 10);
    if (!isNaN(minScore) && minScore >= 0 && minScore <= 100) {
      filteredAssessments = filteredAssessments.filter(a => a.overallScore >= minScore);
    }
  }

  if (options.limit) {
    const limit = parseInt(options.limit, 10);
    if (!isNaN(limit) && limit > 0) {
      filteredAssessments = filteredAssessments.slice(0, limit);
    }
  }

  return filteredAssessments;
}

/**
 * Output risk analysis results in the specified format
 */
function outputRiskResults(
  riskAnalysis: RiskAnalysisResult,
  filteredAssessments: ComprehensiveRiskAssessment[],
  riskConfig: RiskConfig,
  data: RiskAnalysisData,
  options: RiskAnalyzeOptions
): void {
  if (options.format === 'dot') {
    outputRiskAnalysisDot(data.functions, data.callEdges, filteredAssessments, options);
  } else if (options.format === 'json') {
    outputRiskAnalysisJSON(riskAnalysis, filteredAssessments, riskConfig, options);
  } else {
    outputRiskAnalysisTable(riskAnalysis, filteredAssessments, riskConfig, options);
  }
}

/**
 * Handle errors in risk analysis
 */
function handleRiskAnalysisError(spinner: Ora, errorHandler: ReturnType<typeof createErrorHandler>, error: unknown): void {
  spinner.fail('Failed to analyze risks');
  if (error instanceof DatabaseError) {
    const funcqcError = errorHandler.createError(
      error.code,
      error.message,
      {},
      error.originalError
    );
    errorHandler.handleError(funcqcError);
  } else {
    errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
  }
}