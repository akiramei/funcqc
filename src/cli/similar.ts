import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { SimilarityManager } from '../similarity/similarity-manager';
import { FunctionInfo, SimilarityResult, ConsensusStrategy } from '../types';
import { createErrorHandler } from '../utils/error-handler';
import { Logger } from '../utils/cli-utils';

interface SimilarCommandOptions {
  threshold?: string;
  json?: boolean;
  jsonl?: boolean;  // JSON Lines format
  snapshot?: string;
  minLines?: string;
  crossFile?: boolean;
  detectors?: string;
  consensus?: string;
  output?: string;
  limit?: string;
}

interface CommandContext {
  logger: Logger;
  errorHandler: ReturnType<typeof createErrorHandler>;
  parentOpts: Record<string, unknown>;
}

interface DetectionConfig {
  threshold: number;
  minLines: number;
  limit: number | undefined;
  enabledDetectors: string[];
  consensusStrategy: ConsensusStrategy | undefined;
  crossFile: boolean;
}

export async function similarCommand(options: SimilarCommandOptions, cmd: Command): Promise<void> {
  const context = initializeCommand(options, cmd);
  const spinner = ora();

  try {
    const storage = await initializeStorage();
    
    try {
      const functions = await loadFunctions(storage, options, spinner);
      const detectionConfig = parseDetectionOptions(options);
      const results = await detectSimilarities(functions, detectionConfig, spinner);
      const limitedResults = applyLimit(results, detectionConfig.limit);
      
      outputResults(limitedResults, options, context.logger);
      showSummaryIfNeeded(results, limitedResults, options, context);

    } finally {
      await storage.close();
    }

  } catch (error) {
    spinner.fail();
    context.errorHandler.handleError(error as Error);
  }
}

function initializeCommand(_options: SimilarCommandOptions, cmd: Command): CommandContext {
  const parentOpts = cmd.parent?.opts() || {};
  const logger = new Logger(parentOpts['verbose'], parentOpts['quiet']);
  const errorHandler = createErrorHandler(logger);
  
  return {
    logger,
    errorHandler,
    parentOpts
  };
}

async function initializeStorage(): Promise<PGLiteStorageAdapter> {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const storage = new PGLiteStorageAdapter(config.storage.path || '.funcqc/funcqc.db');
  
  await storage.init();
  return storage;
}

async function loadFunctions(
  storage: PGLiteStorageAdapter, 
  options: SimilarCommandOptions, 
  spinner: ReturnType<typeof ora>
): Promise<FunctionInfo[]> {
  spinner.start('Loading functions...');
  
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

function parseDetectionOptions(options: SimilarCommandOptions): DetectionConfig {
  const threshold = options.threshold ? parseFloat(options.threshold) : 0.8;
  const minLines = options.minLines ? parseInt(options.minLines) : 5;
  const limit = options.limit ? parseInt(options.limit) : undefined;
  const enabledDetectors = options.detectors ? options.detectors.split(',') : [];
  const consensusStrategy = options.consensus ? parseConsensusStrategy(options.consensus) : undefined;
  const crossFile = options.crossFile !== false;
  
  return {
    threshold,
    minLines,
    limit,
    enabledDetectors,
    consensusStrategy,
    crossFile
  };
}

async function detectSimilarities(
  functions: FunctionInfo[],
  config: DetectionConfig,
  spinner: ReturnType<typeof ora>
): Promise<SimilarityResult[]> {
  const similarityManager = new SimilarityManager();
  
  spinner.start('Detecting similar functions...');
  
  const results = await similarityManager.detectSimilarities(
    functions,
    {
      threshold: config.threshold,
      minLines: config.minLines,
      crossFile: config.crossFile
    },
    config.enabledDetectors,
    config.consensusStrategy
  );

  spinner.succeed(`Found ${results.length} groups of similar functions`);
  return results;
}

function applyLimit(results: SimilarityResult[], limit: number | undefined): SimilarityResult[] {
  return limit ? results.slice(0, limit) : results;
}

function outputResults(
  results: SimilarityResult[], 
  options: SimilarCommandOptions, 
  logger: Logger
): void {
  if (options.json || options.jsonl) {
    outputJSON(results, options.output, options.jsonl);
  } else {
    displayResults(results, logger);
  }
}

function showSummaryIfNeeded(
  allResults: SimilarityResult[],
  displayedResults: SimilarityResult[],
  options: SimilarCommandOptions,
  context: CommandContext
): void {
  if (!options.json && !context.parentOpts['quiet']) {
    displaySummary(allResults, displayedResults, context.logger);
  }
}

function parseConsensusStrategy(input: string): ConsensusStrategy {
  const parts = input.split(':');
  const strategy = parts[0];
  
  switch (strategy) {
    case 'majority':
      return {
        strategy: 'majority',
        threshold: parts[1] ? parseFloat(parts[1]) : 0.5
      };
    
    case 'intersection':
      return { strategy: 'intersection' };
    
    case 'union':
      return { strategy: 'union' };
    
    case 'weighted': {
      // Parse weighted format: weighted:detector1=0.5,detector2=0.3
      const weightings: Record<string, number> = {};
      if (parts[1]) {
        const weights = parts[1].split(',');
        for (const weight of weights) {
          const [detector, value] = weight.split('=');
          weightings[detector] = parseFloat(value);
        }
      }
      return { strategy: 'weighted', weightings };
    }
    
    default:
      throw new Error(`Unknown consensus strategy: ${strategy}`);
  }
}

function calculatePriority(result: SimilarityResult): number {
  // Priority based on similarity score and total lines of code
  const totalLines = result.functions.reduce((sum, func) => {
    const lines = func.originalFunction?.metrics?.linesOfCode || 0;
    return sum + lines;
  }, 0);
  
  return result.similarity * totalLines;
}

function outputJSON(results: SimilarityResult[], outputPath?: string, jsonLines: boolean = false): void {
  // Add priority and sort by it
  const enrichedResults = results
    .map(result => ({
      ...result,
      priority: calculatePriority(result),
      refactoringImpact: calculateRefactoringImpact(result)
    }))
    .sort((a, b) => b.priority - a.priority);

  if (jsonLines) {
    outputJSONLines(enrichedResults, outputPath);
    return;
  }

  const output = {
    version: '2.0', // Updated version for improved format
    timestamp: new Date().toISOString(),
    totalGroups: results.length,
    groups: enrichedResults.map(result => ({
      type: result.type,
      similarity: result.similarity,
      detector: result.detector,
      priority: result.priority,
      refactoringImpact: result.refactoringImpact,
      functions: result.functions.map(func => ({
        id: func.functionId,
        name: func.functionName,
        file: func.filePath,
        lines: {
          start: func.startLine,
          end: func.endLine
        },
        metrics: func.originalFunction?.metrics
      })),
      metadata: result.metadata
    }))
  };

  const jsonString = JSON.stringify(output, null, 2);
  
  if (outputPath) {
    fs.writeFileSync(outputPath, jsonString);
    console.log(chalk.green(`✓ Saved similarity data to ${outputPath}`));
  } else {
    console.log(jsonString);
  }
}

function calculateRefactoringImpact(result: SimilarityResult): 'high' | 'medium' | 'low' {
  const avgComplexity = result.functions.reduce((sum, func) => {
    const complexity = func.originalFunction?.metrics?.cyclomaticComplexity || 0;
    return sum + complexity;
  }, 0) / result.functions.length;

  const totalLines = result.functions.reduce((sum, func) => {
    const lines = func.originalFunction?.metrics?.linesOfCode || 0;
    return sum + lines;
  }, 0);

  if (avgComplexity > 8 && totalLines > 100) return 'high';
  if (avgComplexity > 5 || totalLines > 50) return 'medium';
  return 'low';
}

function outputJSONLines(results: Array<SimilarityResult & { priority: number; refactoringImpact: string }>, outputPath?: string): void {
  const lines = results.map(result => JSON.stringify({
    type: result.type,
    similarity: result.similarity,
    detector: result.detector,
    priority: result.priority,
    refactoringImpact: result.refactoringImpact,
    functions: result.functions.map(func => ({
      id: func.functionId,
      name: func.functionName,
      file: func.filePath,
      lines: {
        start: func.startLine,
        end: func.endLine
      },
      metrics: func.originalFunction?.metrics
    })),
    metadata: result.metadata
  }));

  const output = lines.join('\n');
  
  if (outputPath) {
    fs.writeFileSync(outputPath, output);
    console.log(chalk.green(`✓ Saved similarity data (JSON Lines) to ${outputPath}`));
  } else {
    console.log(output);
  }
}

function displayResults(results: SimilarityResult[], logger: Logger): void {
  if (results.length === 0) {
    logger.info('No similar functions found with the given criteria.');
    return;
  }

  console.log(chalk.bold('\nSimilar Function Groups:\n'));

  results.forEach((result, index) => {
    console.log(chalk.yellow(`Group ${index + 1}`) + chalk.gray(` (${result.detector})`));
    console.log(chalk.cyan(`Similarity: ${(result.similarity * 100).toFixed(1)}%`));
    
    if (result.metadata?.['groupSize']) {
      console.log(chalk.gray(`Group size: ${result.metadata['groupSize']} functions`));
    }
    
    console.log(chalk.gray('Functions:'));
    
    result.functions.forEach((func, i) => {
      const metrics = func.originalFunction?.metrics;
      const complexity = metrics ? `complexity: ${metrics.cyclomaticComplexity}` : '';
      const lines = metrics ? `lines: ${metrics.linesOfCode}` : '';
      
      console.log(
        `  ${i + 1}. ${chalk.green(func.functionName)} ` +
        chalk.gray(`(${func.filePath}:${func.startLine})`) +
        (complexity || lines ? chalk.gray(` - ${[complexity, lines].filter(Boolean).join(', ')}`) : '')
      );
    });
    
    console.log();
  });
}

function displaySummary(allResults: SimilarityResult[], displayedResults: SimilarityResult[], _logger: Logger): void {
  const totalFunctions = new Set<string>();
  allResults.forEach(result => {
    result.functions.forEach(func => totalFunctions.add(func.functionId));
  });

  console.log(chalk.bold('\nSummary:'));
  console.log(`  Total similar groups: ${allResults.length}`);
  console.log(`  Total functions involved: ${totalFunctions.size}`);
  
  if (displayedResults.length < allResults.length) {
    console.log(`  Displayed: ${displayedResults.length} (use --limit to see more)`);
  }

  // Distribution by similarity levels
  const distribution = {
    high: allResults.filter(r => r.similarity >= 0.9).length,
    medium: allResults.filter(r => r.similarity >= 0.7 && r.similarity < 0.9).length,
    low: allResults.filter(r => r.similarity < 0.7).length
  };

  console.log('\n  Similarity distribution:');
  console.log(`    High (≥90%): ${distribution.high}`);
  console.log(`    Medium (70-90%): ${distribution.medium}`);
  console.log(`    Low (<70%): ${distribution.low}`);
}