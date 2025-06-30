import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import { FunctionInfo, FuncqcConfig, RefactorCommandOptions, RefactoringAnalysisResult, RefactoringOpportunity } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { SimilarityManager } from '../similarity/similarity-manager';
import { RefactoringAnalyzer } from '../analyzers/refactoring-analyzer';
import { createErrorHandler } from '../utils/error-handler';
import { Logger } from '../utils/cli-utils';

// Note: RefactorCommandOptions and RefactoringOpportunity are now defined in types/index.ts

export async function refactorCommand(options: RefactorCommandOptions): Promise<void> {
  const logger = new Logger(false, false);
  const errorHandler = createErrorHandler(logger);
  const spinner = ora();

  try {
    // Load configuration
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    // Initialize storage
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();
    
    try {
      // Load functions from specified snapshot or latest
      const functions = await loadFunctions(storage, options, spinner);
      
      // Initialize analyzers
      const refactoringAnalyzer = new RefactoringAnalyzer();
      const similarityManager = new SimilarityManager();
      
      // Perform comprehensive refactoring analysis
      const analysisResult = await performRefactoringAnalysis(
        functions,
        config,
        refactoringAnalyzer,
        similarityManager,
        options,
        spinner
      );
      
      // Output results
      outputResults(analysisResult, options);
      
    } finally {
      await storage.close();
    }
    
  } catch (error) {
    spinner.fail();
    errorHandler.handleError(error as Error);
  }
}

async function loadFunctions(
  storage: PGLiteStorageAdapter,
  options: RefactorCommandOptions,
  spinner: ReturnType<typeof ora>
): Promise<FunctionInfo[]> {
  spinner.start('Loading functions for analysis...');
  
  let functions: FunctionInfo[];
  if (options.snapshot) {
    functions = await storage.getFunctions(options.snapshot);
  } else {
    const snapshots = await storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) {
      throw new Error('No snapshots found. Run "funcqc scan" first.');
    }
    functions = await storage.getFunctions(snapshots[0].id);
  }
  
  spinner.succeed(`Loaded ${functions.length} functions`);
  return functions;
}

async function performRefactoringAnalysis(
  functions: FunctionInfo[],
  config: FuncqcConfig,
  refactoringAnalyzer: RefactoringAnalyzer,
  similarityManager: SimilarityManager,
  options: RefactorCommandOptions,
  spinner: ReturnType<typeof ora>
): Promise<RefactoringAnalysisResult> {
  const analysisOptions = parseAnalysisOptions(options);
  const allOpportunities = await gatherRefactoringOpportunities(
    functions, 
    config, 
    refactoringAnalyzer, 
    similarityManager, 
    analysisOptions, 
    spinner
  );
  
  return buildAnalysisResult(functions, allOpportunities, analysisOptions);
}

interface AnalysisOptions {
  threshold: number;
  minLines: number;
  maxFunctions: number;
  includePatterns: boolean;
  includeTrends: boolean;
  priorityMetric?: string;
}

function parseAnalysisOptions(options: RefactorCommandOptions): AnalysisOptions {
  const result: AnalysisOptions = {
    threshold: options.threshold ? parseFloat(options.threshold) : 10,
    minLines: options.minLines ? parseInt(options.minLines) : 5,
    maxFunctions: options.maxFunctions ? parseInt(options.maxFunctions) : 50,
    includePatterns: options.includePatterns || false,
    includeTrends: options.includeTrends || false
  };
  
  if (options.priorityMetric) {
    result.priorityMetric = options.priorityMetric;
  }
  
  return result;
}

async function gatherRefactoringOpportunities(
  functions: FunctionInfo[],
  config: FuncqcConfig,
  refactoringAnalyzer: RefactoringAnalyzer,
  similarityManager: SimilarityManager,
  options: AnalysisOptions,
  spinner: ReturnType<typeof ora>
): Promise<RefactoringOpportunity[]> {
  // Phase 1: Complexity Analysis
  spinner.start('Analyzing complexity-based refactoring opportunities...');
  const complexityOpportunities = analyzeComplexityOpportunities(functions, options.threshold);
  spinner.succeed(`Found ${complexityOpportunities.length} complexity-based opportunities`);
  
  // Phase 2: Length Analysis
  spinner.start('Analyzing length-based refactoring opportunities...');
  const lengthOpportunities = analyzeLengthOpportunities(functions, config.metrics.linesOfCodeThreshold);
  spinner.succeed(`Found ${lengthOpportunities.length} length-based opportunities`);
  
  // Phase 3: Similarity Analysis
  spinner.start('Detecting similar functions for consolidation...');
  const similarityResults = await similarityManager.detectSimilarities(
    functions,
    {
      threshold: 0.7,
      minLines: options.minLines,
      crossFile: true
    }
  );
  const similarityOpportunities = analyzeSimilarityOpportunities(similarityResults);
  spinner.succeed(`Found ${similarityOpportunities.length} similarity-based opportunities`);
  
  // Phase 4: Pattern Analysis (if enabled)
  let patternOpportunities: RefactoringOpportunity[] = [];
  if (options.includePatterns) {
    spinner.start('Analyzing common patterns for extraction...');
    patternOpportunities = await refactoringAnalyzer.analyzeCommonPatterns(functions);
    spinner.succeed(`Found ${patternOpportunities.length} pattern-based opportunities`);
  }
  
  spinner.start('Aggregating analysis results...');
  const allOpportunities = [
    ...complexityOpportunities,
    ...lengthOpportunities,
    ...similarityOpportunities,
    ...patternOpportunities
  ];
  
  const prioritizedOpportunities = prioritizeOpportunities(allOpportunities, options.priorityMetric);
  const limitedOpportunities = options.maxFunctions > 0 
    ? prioritizedOpportunities.slice(0, options.maxFunctions)
    : prioritizedOpportunities;
  
  spinner.succeed('Analysis complete');
  
  return limitedOpportunities;
}

function buildAnalysisResult(
  functions: FunctionInfo[],
  opportunities: RefactoringOpportunity[],
  options: AnalysisOptions
): RefactoringAnalysisResult {
  const statistics = generateStatistics(functions, opportunities);
  
  return {
    version: '2.0',
    timestamp: new Date().toISOString(),
    configuration: {
      complexityThreshold: options.threshold,
      minLines: options.minLines,
      maxFunctions: options.maxFunctions,
      includePatterns: options.includePatterns,
      includeTrends: options.includeTrends
    },
    summary: {
      totalFunctions: functions.length,
      totalOpportunities: opportunities.length,
      displayedOpportunities: opportunities.length,
      priorityDistribution: calculatePriorityDistribution(opportunities),
      typeDistribution: calculateTypeDistribution(opportunities),
      estimatedImpact: calculateTotalImpact(opportunities)
    },
    opportunities,
    statistics,
    recommendations: generateRecommendations(opportunities)
  };
}

function analyzeComplexityOpportunities(functions: FunctionInfo[], threshold: number): RefactoringOpportunity[] {
  const highComplexityFunctions = functions
    .filter(func => func.metrics && func.metrics.cyclomaticComplexity > threshold)
    .sort((a, b) => (b.metrics?.cyclomaticComplexity || 0) - (a.metrics?.cyclomaticComplexity || 0));
  
  const opportunities: RefactoringOpportunity[] = [];
  
  for (const func of highComplexityFunctions) {
    const complexity = func.metrics?.cyclomaticComplexity || 0;
    const lines = func.metrics?.linesOfCode || 0;
    
    let priority: 'high' | 'medium' | 'low' = 'low';
    if (complexity > threshold * 2) priority = 'high';
    else if (complexity > threshold * 1.5) priority = 'medium';
    
    opportunities.push({
      type: 'complexity',
      priority,
      functions: [func],
      metrics: {
        totalComplexity: complexity,
        totalLines: lines,
        avgComplexity: complexity,
        maxComplexity: complexity,
        potentialSavings: Math.max(0, complexity - threshold)
      },
      description: `High complexity function (CC=${complexity})`,
      recommendation: complexity > 15 
        ? 'Consider breaking this function into smaller, more focused functions'
        : 'Consider simplifying conditional logic or extracting complex sub-operations'
    });
  }
  
  return opportunities;
}

function analyzeLengthOpportunities(functions: FunctionInfo[], threshold: number): RefactoringOpportunity[] {
  const longFunctions = functions
    .filter(func => func.metrics && func.metrics.linesOfCode > threshold)
    .sort((a, b) => (b.metrics?.linesOfCode || 0) - (a.metrics?.linesOfCode || 0));
  
  const opportunities: RefactoringOpportunity[] = [];
  
  for (const func of longFunctions) {
    const lines = func.metrics?.linesOfCode || 0;
    const complexity = func.metrics?.cyclomaticComplexity || 0;
    
    let priority: 'high' | 'medium' | 'low' = 'low';
    if (lines > threshold * 3) priority = 'high';
    else if (lines > threshold * 2) priority = 'medium';
    
    opportunities.push({
      type: 'length',
      priority,
      functions: [func],
      metrics: {
        totalComplexity: complexity,
        totalLines: lines,
        avgComplexity: complexity,
        maxComplexity: complexity,
        potentialSavings: Math.max(0, lines - threshold)
      },
      description: `Long function (${lines} lines)`,
      recommendation: lines > 100
        ? 'Consider breaking this function into logical sub-functions'
        : 'Consider extracting repeated or complex sections into helper functions'
    });
  }
  
  return opportunities;
}

function analyzeSimilarityOpportunities(similarityResults: Array<{ functions: Array<{ originalFunction?: FunctionInfo }>; similarity: number }>): RefactoringOpportunity[] {
  const opportunities: RefactoringOpportunity[] = [];
  
  for (const result of similarityResults) {
    if (result.functions.length < 2) continue;
    
    const functions = result.functions.map(f => f.originalFunction).filter((func: FunctionInfo | undefined): func is FunctionInfo => Boolean(func));
    const totalLines = functions.reduce((sum: number, func: FunctionInfo) => 
      sum + (func.metrics?.linesOfCode || 0), 0);
    const totalComplexity = functions.reduce((sum: number, func: FunctionInfo) => 
      sum + (func.metrics?.cyclomaticComplexity || 0), 0);
    const avgComplexity = totalComplexity / functions.length;
    const maxComplexity = Math.max(...functions.map((f: FunctionInfo) => f.metrics?.cyclomaticComplexity || 0));
    
    let priority: 'high' | 'medium' | 'low' = 'low';
    if (result.similarity > 0.9 && totalLines > 50) priority = 'high';
    else if (result.similarity > 0.8 && totalLines > 25) priority = 'medium';
    
    const duplicatedLines = totalLines * (result.similarity * 0.8); // Estimate
    
    opportunities.push({
      type: 'similarity',
      priority,
      functions,
      metrics: {
        totalComplexity,
        totalLines,
        avgComplexity,
        maxComplexity,
        potentialSavings: duplicatedLines
      },
      description: `Similar functions (${Math.round(result.similarity * 100)}% similarity, ${functions.length} functions)`,
      recommendation: result.similarity > 0.9
        ? 'Consider extracting common logic into a shared function'
        : 'Consider creating a common base function or utility'
    });
  }
  
  return opportunities;
}

function prioritizeOpportunities(opportunities: RefactoringOpportunity[], priorityMetric?: string): RefactoringOpportunity[] {
  return opportunities.sort((a, b) => {
    // First sort by priority level
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    
    // Then by the specified metric or default (potential savings)
    switch (priorityMetric) {
      case 'complexity':
        return b.metrics.totalComplexity - a.metrics.totalComplexity;
      case 'lines':
        return b.metrics.totalLines - a.metrics.totalLines;
      case 'functions':
        return b.functions.length - a.functions.length;
      default:
        return b.metrics.potentialSavings - a.metrics.potentialSavings;
    }
  });
}

function generateStatistics(functions: FunctionInfo[], opportunities: RefactoringOpportunity[]) {
  const totalComplexity = functions.reduce((sum, func) => 
    sum + (func.metrics?.cyclomaticComplexity || 0), 0);
  const totalLines = functions.reduce((sum, func) => 
    sum + (func.metrics?.linesOfCode || 0), 0);
  const avgComplexity = totalComplexity / functions.length;
  
  const complexityDistribution = functions.reduce((dist, func) => {
    const complexity = func.metrics?.cyclomaticComplexity || 0;
    const bucket = Math.floor(complexity / 5) * 5; // Group by 5s
    dist[bucket] = (dist[bucket] || 0) + 1;
    return dist;
  }, {} as Record<number, number>);
  
  const affectedFunctions = new Set();
  opportunities.forEach(opp => {
    opp.functions.forEach(func => affectedFunctions.add(func.id));
  });
  
  return {
    codebaseMetrics: {
      totalFunctions: functions.length,
      totalComplexity,
      totalLines,
      avgComplexity: Number(avgComplexity.toFixed(2)),
      complexityDistribution
    },
    refactoringImpact: {
      affectedFunctions: affectedFunctions.size,
      totalPotentialSavings: opportunities.reduce((sum, opp) => sum + opp.metrics.potentialSavings, 0),
      estimatedEffort: calculateEffortEstimate(opportunities)
    }
  };
}

function calculateEffortEstimate(opportunities: RefactoringOpportunity[]): string {
  const totalImpact = opportunities.reduce((sum, opp) => {
    const basePoints = opp.priority === 'high' ? 3 : opp.priority === 'medium' ? 2 : 1;
    const complexityPoints = Math.min(5, Math.floor(opp.metrics.avgComplexity / 5));
    const functionPoints = Math.min(3, opp.functions.length);
    return sum + (basePoints + complexityPoints + functionPoints);
  }, 0);
  
  if (totalImpact < 20) return 'Low (1-2 days)';
  if (totalImpact < 50) return 'Medium (3-5 days)';
  if (totalImpact < 100) return 'High (1-2 weeks)';
  return 'Very High (2+ weeks)';
}

function calculatePriorityDistribution(opportunities: RefactoringOpportunity[]) {
  return opportunities.reduce((dist, opp) => {
    dist[opp.priority] = (dist[opp.priority] || 0) + 1;
    return dist;
  }, {} as Record<string, number>);
}

function calculateTypeDistribution(opportunities: RefactoringOpportunity[]) {
  return opportunities.reduce((dist, opp) => {
    dist[opp.type] = (dist[opp.type] || 0) + 1;
    return dist;
  }, {} as Record<string, number>);
}

function calculateTotalImpact(opportunities: RefactoringOpportunity[]): number {
  return opportunities.reduce((sum, opp) => sum + opp.metrics.potentialSavings, 0);
}

function generateRecommendations(opportunities: RefactoringOpportunity[]): string[] {
  const recommendations: string[] = [];
  
  const highPriority = opportunities.filter(opp => opp.priority === 'high');
  if (highPriority.length > 0) {
    recommendations.push(
      `Start with ${highPriority.length} high-priority opportunities for maximum impact`
    );
  }
  
  const complexityOps = opportunities.filter(opp => opp.type === 'complexity');
  if (complexityOps.length > 5) {
    recommendations.push(
      'Consider implementing a complexity monitoring system to prevent future issues'
    );
  }
  
  const similarityOps = opportunities.filter(opp => opp.type === 'similarity');
  if (similarityOps.length > 3) {
    recommendations.push(
      'Focus on extracting common patterns to reduce code duplication'
    );
  }
  
  const totalSavings = opportunities.reduce((sum, opp) => sum + opp.metrics.potentialSavings, 0);
  if (totalSavings > 500) {
    recommendations.push(
      'Consider a phased refactoring approach due to the large scope of improvements'
    );
  }
  
  return recommendations;
}

function outputResults(result: RefactoringAnalysisResult, options: RefactorCommandOptions): void {
  if (options.json) {
    outputJSON(result, options.output);
  } else {
    displayResults(result, options);
  }
}

function outputJSON(result: RefactoringAnalysisResult, outputPath?: string): void {
  const jsonString = JSON.stringify(result, null, 2);
  
  if (outputPath) {
    fs.writeFileSync(outputPath, jsonString);
    console.log(chalk.green(`✓ Saved refactoring analysis to ${outputPath}`));
  } else {
    console.log(jsonString);
  }
}

function displayResults(result: RefactoringAnalysisResult, options: RefactorCommandOptions): void {
  console.log(chalk.bold.cyan('\n🔧 Refactoring Opportunity Analysis\n'));
  
  // Summary
  displaySummary(result.summary);
  
  // Opportunities
  if (options.format === 'summary') {
    displayOpportunitiesSummary(result.opportunities);
  } else {
    displayOpportunitiesDetailed(result.opportunities);
  }
  
  // Statistics
  displayStatistics(result.statistics);
  
  // Recommendations
  displayRecommendations(result.recommendations);
}

function displaySummary(summary: RefactoringAnalysisResult['summary']): void {
  console.log(chalk.bold('📊 Analysis Summary:'));
  console.log(`   Functions Analyzed: ${summary.totalFunctions}`);
  console.log(`   Opportunities Found: ${summary.totalOpportunities}`);
  console.log(`   Displayed: ${summary.displayedOpportunities}`);
  console.log(`   Estimated Impact: ${summary.estimatedImpact.toFixed(1)} potential savings`);
  
  console.log('\n   Priority Distribution:');
  Object.entries(summary.priorityDistribution).forEach(([priority, count]) => {
    const color = priority === 'high' ? chalk.red : priority === 'medium' ? chalk.yellow : chalk.green;
    console.log(`     ${color(priority)}: ${count}`);
  });
  
  console.log('\n   Type Distribution:');
  Object.entries(summary.typeDistribution).forEach(([type, count]) => {
    console.log(`     ${type}: ${count}`);
  });
  
  console.log();
}

function displayOpportunitiesSummary(opportunities: RefactoringOpportunity[]): void {
  console.log(chalk.bold('🎯 Top Opportunities:'));
  
  opportunities.slice(0, 10).forEach((opp, index) => {
    const priorityColor = opp.priority === 'high' ? chalk.red : 
                         opp.priority === 'medium' ? chalk.yellow : chalk.green;
    
    console.log(`${index + 1}. ${priorityColor(opp.priority.toUpperCase())} - ${opp.description}`);
    console.log(`   Impact: ${opp.metrics.potentialSavings.toFixed(1)} | Functions: ${opp.functions.length}`);
  });
  
  console.log();
}

function displayOpportunitiesDetailed(opportunities: RefactoringOpportunity[]): void {
  console.log(chalk.bold('🎯 Refactoring Opportunities:\n'));
  
  opportunities.forEach((opp, index) => {
    const priorityColor = opp.priority === 'high' ? chalk.red : 
                         opp.priority === 'medium' ? chalk.yellow : chalk.green;
    
    console.log(chalk.yellow(`${index + 1}. ${opp.description}`));
    console.log(`   Priority: ${priorityColor(opp.priority.toUpperCase())}`);
    console.log(`   Type: ${opp.type}`);
    console.log(`   Potential Savings: ${opp.metrics.potentialSavings.toFixed(1)}`);
    console.log(`   Recommendation: ${opp.recommendation}`);
    
    console.log(chalk.gray('   Affected Functions:'));
    opp.functions.forEach(func => {
      const complexity = func.metrics?.cyclomaticComplexity || 0;
      const lines = func.metrics?.linesOfCode || 0;
      console.log(chalk.gray(`     - ${func.name} (${func.filePath}:${func.startLine}) - CC:${complexity}, LOC:${lines}`));
    });
    
    console.log();
  });
}

function displayStatistics(statistics: RefactoringAnalysisResult['statistics']): void {
  console.log(chalk.bold('📈 Codebase Statistics:'));
  console.log(`   Total Functions: ${statistics.codebaseMetrics.totalFunctions}`);
  console.log(`   Total Complexity: ${statistics.codebaseMetrics.totalComplexity}`);
  console.log(`   Average Complexity: ${statistics.codebaseMetrics.avgComplexity}`);
  console.log(`   Total Lines: ${statistics.codebaseMetrics.totalLines}`);
  
  console.log('\n   Refactoring Impact:');
  console.log(`   Affected Functions: ${statistics.refactoringImpact.affectedFunctions}`);
  console.log(`   Total Potential Savings: ${statistics.refactoringImpact.totalPotentialSavings.toFixed(1)}`);
  console.log(`   Estimated Effort: ${statistics.refactoringImpact.estimatedEffort}`);
  
  console.log();
}

function displayRecommendations(recommendations: string[]): void {
  if (recommendations.length === 0) return;
  
  console.log(chalk.bold('💡 Recommendations:'));
  recommendations.forEach((rec, index) => {
    console.log(`   ${index + 1}. ${rec}`);
  });
  
  console.log();
}