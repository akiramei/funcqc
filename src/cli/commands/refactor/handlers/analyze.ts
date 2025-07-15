/**
 * Analyze Command Handler
 * 
 * Handles the refactor analyze command which performs comprehensive 
 * project analysis for refactoring opportunities.
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  RefactorAnalyzeOptions, 
  RefactoringPattern,
  RefactoringReport,
  RefactoringOpportunity 
} from '../../../../types/index.js';
import { CommandEnvironment } from '../../../../types/environment.js';
import { RefactoringAnalyzer } from '../../../../refactoring/refactoring-analyzer.js';
import { generateMarkdownReport, displayAnalysisReport } from '../utils/report-generator.js';

// ============================================
// CONSTANTS
// ============================================

const REFACTORING_EFFORT_MAP: Record<string, number> = {
  [RefactoringPattern.ExtractMethod]: 2,
  [RefactoringPattern.SplitFunction]: 3,
  [RefactoringPattern.ReduceParameters]: 1,
  [RefactoringPattern.ExtractClass]: 5,
  [RefactoringPattern.InlineFunction]: 1,
  [RefactoringPattern.RenameFunction]: 1
};


// ============================================
// MAIN COMMAND HANDLER
// ============================================

/**
 * Main analyze command implementation
 */
export async function refactorAnalyzeCommandImpl(
  options: RefactorAnalyzeOptions,
  env: CommandEnvironment
): Promise<void> {
  env.commandLogger.info('Starting refactoring analysis...');
  
  try {
    env.commandLogger.info('🔍 Analyzing project for refactoring opportunities...');
    
    const analyzer = new RefactoringAnalyzer(env.storage);
    const analysisOptions = buildAnalysisOptions(options);
    const report = await analyzer.analyzeProject(analysisOptions);
    
    updateReportSummary(report);
    await handleReportOutput(report, options, env);
    
  } catch (error) {
    env.commandLogger.error('Failed to analyze project for refactoring', error);
    process.exit(1);
  }
}

/**
 * Build analysis options from command options
 */
function buildAnalysisOptions(options: RefactorAnalyzeOptions): {
  complexityThreshold?: number;
  sizeThreshold?: number;
  since?: string;
  patterns?: RefactoringPattern[];
} {
  const analysisOptions: {
    complexityThreshold?: number;
    sizeThreshold?: number;
    since?: string;
    patterns?: RefactoringPattern[];
  } = {};
  
  if (options.complexityThreshold !== undefined) {
    analysisOptions.complexityThreshold = options.complexityThreshold;
  }
  if (options.sizeThreshold !== undefined) {
    analysisOptions.sizeThreshold = options.sizeThreshold;
  }
  if (options.since !== undefined) {
    analysisOptions.since = options.since;
  }
  
  const patterns = parsePatterns(options.patterns);
  if (patterns !== undefined) {
    analysisOptions.patterns = patterns;
  }
  
  return analysisOptions;
}

/**
 * Update report summary with calculated values
 */
function updateReportSummary(report: RefactoringReport): void {
  report.projectSummary.opportunitiesFound = report.opportunities.length;
  report.projectSummary.estimatedEffort = calculateTotalEffortFromOpportunities(report.opportunities);
}

/**
 * Handle report output to file and console
 */
async function handleReportOutput(
  report: RefactoringReport,
  options: RefactorAnalyzeOptions,
  env: CommandEnvironment
): Promise<void> {
  if (options.output) {
    await saveReportToFile(report, options.output, options.format || 'detailed');
    env.commandLogger.success(`📄 Report saved to: ${options.output}`);
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    displayAnalysisReport(report, options.format || 'summary', options.output);
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Parse comma-separated patterns string into RefactoringPattern array
 */
function parsePatterns(patternsString?: string): RefactoringPattern[] | undefined {
  if (!patternsString) return undefined;
  
  const patternMap: Record<string, RefactoringPattern> = {
    'extract-method': RefactoringPattern.ExtractMethod,
    'split-function': RefactoringPattern.SplitFunction,
    'reduce-parameters': RefactoringPattern.ReduceParameters,
    'extract-class': RefactoringPattern.ExtractClass,
    'inline-function': RefactoringPattern.InlineFunction,
    'rename-function': RefactoringPattern.RenameFunction
  };
  
  return patternsString
    .split(',')
    .map(p => p.trim())
    .map(p => patternMap[p])
    .filter(Boolean);
}

/**
 * Calculate total effort from opportunities using pattern-based mapping
 */
function calculateTotalEffortFromOpportunities(opportunities: RefactoringOpportunity[]): number {
  return opportunities.reduce((total: number, opp: RefactoringOpportunity) => total + (REFACTORING_EFFORT_MAP[opp.pattern] || 2), 0);
}

/**
 * Save report to file in specified format
 */
async function saveReportToFile(
  report: RefactoringReport, 
  outputPath: string, 
  format: string
): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.promises.mkdir(dir, { recursive: true });
  
  let content: string;
  
  if (format === 'json') {
    content = JSON.stringify(report, null, 2);
  } else {
    content = generateMarkdownReport(report, format);
  }
  
  await fs.promises.writeFile(outputPath, content, 'utf8');
}