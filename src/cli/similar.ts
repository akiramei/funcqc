import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { SimilarityManager } from '../similarity/similarity-manager';
import { FunctionInfo, SimilarityResult } from '../types';
import { createErrorHandler } from '../utils/error-handler';
import { Logger } from '../utils/cli-utils';

interface SimilarCommandOptions {
  threshold?: string;
  json?: boolean;
  snapshot?: string;
  minLines?: string;
  crossFile?: boolean;
  detectors?: string;
  consensus?: string;
  output?: string;
  limit?: string;
}

export async function similarCommand(options: SimilarCommandOptions, cmd: Command) {
  const parentOpts = cmd.parent?.opts() || {};
  const logger = new Logger(parentOpts['verbose'], parentOpts['quiet']);
  const errorHandler = createErrorHandler(logger);
  const spinner = ora();

  try {
    // Load configuration
    const configManager = new ConfigManager();
    const config = await configManager.load();
    const storage = new PGLiteStorageAdapter(config.storage.path || '.funcqc/funcqc.db');
    
    await storage.init();

    try {
      // Get functions to analyze
      spinner.start('Loading functions...');
      
      let functions: FunctionInfo[];
      if (options.snapshot) {
        // Load from specific snapshot
        functions = await storage.getFunctions(options.snapshot);
      } else {
        // Load from latest snapshot
        const snapshots = await storage.getSnapshots({ limit: 1 });
        if (snapshots.length === 0) {
          throw new Error('No snapshots found. Run "funcqc scan" first.');
        }
        functions = await storage.getFunctions(snapshots[0].id);
      }

      spinner.succeed(`Loaded ${functions.length} functions`);

      // Parse options
      const threshold = options.threshold ? parseFloat(options.threshold) : 0.8;
      const minLines = options.minLines ? parseInt(options.minLines) : 5;
      const limit = options.limit ? parseInt(options.limit) : undefined;

      // Configure similarity detection
      const similarityManager = new SimilarityManager();
      const enabledDetectors = options.detectors ? options.detectors.split(',') : [];

      // Detect similarities
      spinner.start('Detecting similar functions...');
      
      const results = await similarityManager.detectSimilarities(
        functions,
        {
          threshold,
          minLines,
          crossFile: options.crossFile !== false
        },
        enabledDetectors,
        options.consensus ? parseConsensusStrategy(options.consensus) : undefined
      );

      spinner.succeed(`Found ${results.length} groups of similar functions`);

      // Apply limit if specified
      const limitedResults = limit ? results.slice(0, limit) : results;

      // Output results
      if (options.json) {
        outputJSON(limitedResults, options.output);
      } else {
        displayResults(limitedResults, logger);
      }

      // Show summary
      if (!options.json && !parentOpts['quiet']) {
        displaySummary(results, limitedResults, logger);
      }

    } finally {
      await storage.close();
    }

  } catch (error) {
    spinner.fail();
    errorHandler.handleError(error as Error);
  }
}

function parseConsensusStrategy(input: string): any {
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
    
    case 'weighted':
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
    
    default:
      throw new Error(`Unknown consensus strategy: ${strategy}`);
  }
}

function outputJSON(results: SimilarityResult[], outputPath?: string): void {
  const output = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    totalGroups: results.length,
    groups: results.map(result => ({
      type: result.type,
      similarity: result.similarity,
      detector: result.detector,
      functions: result.functions.map(func => ({
        id: func.functionId,
        name: func.functionName,
        file: func.filePath,
        lines: `${func.startLine}-${func.endLine}`,
        metrics: func.originalFunction?.metrics
      })),
      metadata: result.metadata
    }))
  };

  const jsonString = JSON.stringify(output, null, 2);
  
  if (outputPath) {
    const fs = require('fs');
    fs.writeFileSync(outputPath, jsonString);
    console.log(chalk.green(`✓ Saved similarity data to ${outputPath}`));
  } else {
    console.log(jsonString);
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