/**
 * Evaluate command for funcqc v1.6
 * 
 * Implements the 3-level naming evaluation system:
 * - Rating 1 (Appropriate): Function name accurately represents processing
 * - Rating 2 (Partially Correct): Partially correct but includes extra responsibilities
 * - Rating 3 (Inappropriate): Function name does not match processing
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { EvaluateCommandOptions, NamingEvaluation, EvaluationBatch, FunctionInfo } from '../types';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from '../core/config';

interface EvaluateOptions extends EvaluateCommandOptions {
  functionId?: string;
  rating?: string;
  issues?: string;
  suggestions?: string;
  batch?: boolean;
  input?: string;
  aiModel?: string;
  confidence?: string;
  evaluatedBy?: string;
  format?: 'table' | 'json' | 'friendly';
}

export function createEvaluateCommand(): Command {
  return new Command('evaluate')
    .description('Evaluate function naming quality using 3-level rating system')
    .argument('[function-id]', 'Function ID to evaluate (use "funcqc list --show-id" to find IDs)')
    .option('--rating <1-3>', 'Rating: 1=Appropriate, 2=Partially Correct, 3=Inappropriate')
    .option('--issues <description>', 'Issues found with the function name')
    .option('--suggestions <text>', 'Suggestions for improvement')
    .option('--batch', 'Batch evaluation mode using JSON input file')
    .option('--input <file>', 'Input JSON file for batch evaluation')
    .option('--ai-model <model>', 'AI model used for evaluation (for metadata)')
    .option('--confidence <0-1>', 'Confidence score for AI evaluations (0.0-1.0)')
    .option('--evaluated-by <evaluator>', 'Evaluator type: human, ai, auto', 'human')
    .option('--format <format>', 'Output format: table, json, friendly', 'table')
    .action(async (functionId: string | undefined, options: EvaluateOptions) => {
      const spinner = ora();
      
      try {
        // Validate options
        validateEvaluateOptions(functionId, options);
        
        // Load configuration
        const configManager = new ConfigManager();
        const config = await configManager.load();
        const storage = new PGLiteStorageAdapter(config.storage.path!);
        await storage.init();

        if (options.batch) {
          await handleBatchEvaluation(options, storage, spinner);
        } else {
          await handleSingleEvaluation(functionId!, options, storage, spinner);
        }

        await storage.close();
      } catch (error) {
        spinner.fail('Evaluation failed');
        
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });
}

function validateEvaluateOptions(functionId: string | undefined, options: EvaluateOptions): void {
  if (options.batch) {
    if (!options.input) {
      throw new Error('Batch evaluation requires --input parameter');
    }
  } else {
    if (!functionId) {
      throw new Error('Function ID is required for single evaluation. Use "funcqc list --show-id" to find function IDs');
    }

    if (!options.rating) {
      throw new Error('Rating is required for single evaluation. Provide rating using --rating parameter (1, 2, or 3)');
    }

    const rating = parseInt(options.rating);
    if (isNaN(rating) || rating < 1 || rating > 3) {
      throw new Error(`Rating must be 1, 2, or 3. Provided: ${options.rating}`);
    }
  }

  if (options.confidence) {
    const confidence = parseFloat(options.confidence);
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`Confidence must be between 0.0 and 1.0. Provided: ${options.confidence}`);
    }
  }

  if (options.evaluatedBy && !['human', 'ai', 'auto'].includes(options.evaluatedBy)) {
    throw new Error(`Evaluator must be human, ai, or auto. Provided: ${options.evaluatedBy}`);
  }
}

async function handleSingleEvaluation(
  functionId: string,
  options: EvaluateOptions,
  storage: PGLiteStorageAdapter,
  spinner: Ora
): Promise<void> {
  spinner.start(`Evaluating function ${functionId}...`);

  // Get function information to validate ID exists
  const functions = await storage.queryFunctions({ 
    filters: [{ field: 'id', operator: '=', value: functionId }] 
  });

  if (functions.length === 0) {
    throw new Error(`Function with ID "${functionId}" not found. Check function ID using "funcqc list --show-id"`);
  }

  const functionInfo = functions[0] as FunctionInfo;
  
  // Create evaluation
  const evaluation: NamingEvaluation = {
    functionId,
    semanticId: functionInfo.semanticId,
    functionName: functionInfo.name,
    descriptionHash: generateDescriptionHash(functionInfo),
    rating: parseInt(options.rating!) as 1 | 2 | 3,
    evaluatedAt: Date.now(),
    evaluatedBy: (options.evaluatedBy as 'human' | 'ai' | 'auto') || 'human',
    revisionNeeded: false,
    ...(options.issues && { issues: options.issues }),
    ...(options.suggestions && { suggestions: options.suggestions }),
    ...(options.aiModel && { aiModel: options.aiModel }),
    ...(options.confidence && { confidence: parseFloat(options.confidence) })
  };

  // Save evaluation
  await storage.saveNamingEvaluation(evaluation);

  spinner.succeed(`Evaluation saved for function "${functionInfo.displayName}"`);

  // Display result
  displayEvaluationResult(evaluation, functionInfo, options.format || 'table');
}

async function handleBatchEvaluation(
  options: EvaluateOptions,
  storage: PGLiteStorageAdapter,
  spinner: Ora
): Promise<void> {
  spinner.start(`Loading batch evaluation data from ${options.input}...`);

  // Read and parse input file
  const inputPath = resolve(options.input!);
  let batchData: EvaluationBatch;
  
  try {
    const fileContent = readFileSync(inputPath, 'utf-8');
    batchData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to read or parse input file: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Validate batch data structure
  if (!batchData.evaluations || !Array.isArray(batchData.evaluations)) {
    throw new Error('Input file must contain "evaluations" array');
  }

  spinner.text = `Processing ${batchData.evaluations.length} evaluations...`;

  // Convert batch data to NamingEvaluation objects
  const evaluations: NamingEvaluation[] = [];
  const errors: string[] = [];

  for (const [index, evalData] of batchData.evaluations.entries()) {
    try {
      // Validate required fields
      if (!evalData.functionId || !evalData.rating) {
        errors.push(`Evaluation ${index + 1}: Missing required fields (functionId, rating)`);
        continue;
      }

      if (![1, 2, 3].includes(evalData.rating)) {
        errors.push(`Evaluation ${index + 1}: Invalid rating ${evalData.rating} (must be 1, 2, or 3)`);
        continue;
      }

      // Get function information
      const functions = await storage.queryFunctions({ 
        filters: [{ field: 'id', operator: '=', value: evalData.functionId }] 
      });

      if (functions.length === 0) {
        errors.push(`Evaluation ${index + 1}: Function "${evalData.functionId}" not found`);
        continue;
      }

      const functionInfo = functions[0] as FunctionInfo;

      // Create evaluation
      const evaluation: NamingEvaluation = {
        functionId: evalData.functionId,
        semanticId: functionInfo.semanticId,
        functionName: functionInfo.name,
        descriptionHash: generateDescriptionHash(functionInfo),
        rating: evalData.rating,
        evaluatedAt: Date.now(),
        evaluatedBy: batchData.metadata?.evaluatedBy || options.evaluatedBy as 'human' | 'ai' | 'auto' || 'human',
        revisionNeeded: false,
        ...(evalData.issues && { issues: evalData.issues }),
        ...(evalData.suggestions && { suggestions: evalData.suggestions }),
        ...((batchData.metadata?.aiModel || options.aiModel) && { aiModel: batchData.metadata?.aiModel || options.aiModel }),
        ...(batchData.metadata?.confidence && { confidence: batchData.metadata.confidence }),
        ...(options.confidence && { confidence: parseFloat(options.confidence) })
      };

      evaluations.push(evaluation);
    } catch (error) {
      errors.push(`Evaluation ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Display errors if any
  if (errors.length > 0) {
    console.warn(chalk.yellow('⚠ Some evaluations could not be processed:'));
    errors.forEach(error => console.warn(chalk.yellow(`  ${error}`)));
    console.log();
  }

  if (evaluations.length === 0) {
    throw new Error('No valid evaluations to process. Fix validation errors in input file');
  }

  // Save evaluations in batch
  spinner.text = `Saving ${evaluations.length} evaluations...`;
  await storage.batchSaveEvaluations(evaluations);

  spinner.succeed(`Batch evaluation completed: ${evaluations.length} evaluations saved`);

  // Display summary
  displayBatchSummary(evaluations, batchData.evaluations.length, errors.length, options.format || 'table');
}

function generateDescriptionHash(functionInfo: FunctionInfo): string {
  // Create hash based on function description or signature if no description
  const content = functionInfo.description || functionInfo.signature || functionInfo.name;
  return createHash('md5').update(content).digest('hex');
}

function displayEvaluationResult(
  evaluation: NamingEvaluation,
  functionInfo: FunctionInfo,
  format: string
): void {
  if (format === 'json') {
    console.log(JSON.stringify({
      functionId: evaluation.functionId,
      functionName: evaluation.functionName,
      rating: evaluation.rating,
      ratingDescription: getRatingDescription(evaluation.rating),
      evaluatedBy: evaluation.evaluatedBy,
      evaluatedAt: new Date(evaluation.evaluatedAt).toISOString(),
      issues: evaluation.issues,
      suggestions: evaluation.suggestions
    }, null, 2));
    return;
  }

  console.log();
  console.log(chalk.green('✓ Evaluation completed successfully'));
  console.log();
  console.log(`${chalk.bold('Function:')} ${functionInfo.displayName}`);
  console.log(`${chalk.bold('File:')} ${functionInfo.filePath}:${functionInfo.startLine}`);
  console.log(`${chalk.bold('Rating:')} ${evaluation.rating} - ${getRatingDescription(evaluation.rating)}`);
  console.log(`${chalk.bold('Evaluated by:')} ${evaluation.evaluatedBy}`);
  console.log(`${chalk.bold('Evaluated at:')} ${new Date(evaluation.evaluatedAt).toLocaleString()}`);
  
  if (evaluation.issues) {
    console.log(`${chalk.bold('Issues:')} ${evaluation.issues}`);
  }
  
  if (evaluation.suggestions) {
    console.log(`${chalk.bold('Suggestions:')} ${evaluation.suggestions}`);
  }
  
  if (evaluation.confidence) {
    console.log(`${chalk.bold('Confidence:')} ${(evaluation.confidence * 100).toFixed(1)}%`);
  }

  console.log();
}

function displayBatchSummary(
  evaluations: NamingEvaluation[],
  totalCount: number,
  errorCount: number,
  format: string
): void {
  if (format === 'json') {
    const ratingCounts = evaluations.reduce((acc, evaluation) => {
      acc[evaluation.rating] = (acc[evaluation.rating] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    console.log(JSON.stringify({
      summary: {
        total: totalCount,
        successful: evaluations.length,
        errors: errorCount,
        ratingDistribution: ratingCounts
      },
      evaluations: evaluations.map(evaluation => ({
        functionId: evaluation.functionId,
        functionName: evaluation.functionName,
        rating: evaluation.rating
      }))
    }, null, 2));
    return;
  }

  console.log();
  console.log(chalk.green('📊 Batch Evaluation Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`${chalk.bold('Total evaluations:')} ${totalCount}`);
  console.log(`${chalk.bold('Successful:')} ${chalk.green(evaluations.length)}`);
  if (errorCount > 0) {
    console.log(`${chalk.bold('Errors:')} ${chalk.red(errorCount)}`);
  }

  // Rating distribution
  const ratingCounts = evaluations.reduce((acc, evaluation) => {
    acc[evaluation.rating] = (acc[evaluation.rating] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  console.log();
  console.log(chalk.bold('Rating Distribution:'));
  console.log(`  ${chalk.green('1 (Appropriate):')} ${ratingCounts[1] || 0}`);
  console.log(`  ${chalk.yellow('2 (Partially Correct):')} ${ratingCounts[2] || 0}`);
  console.log(`  ${chalk.red('3 (Inappropriate):')} ${ratingCounts[3] || 0}`);
  console.log();
}

function getRatingDescription(rating: 1 | 2 | 3): string {
  switch (rating) {
    case 1: return chalk.green('Appropriate - Function name accurately represents processing');
    case 2: return chalk.yellow('Partially Correct - Name partially correct but includes extra responsibilities');
    case 3: return chalk.red('Inappropriate - Function name does not match processing');
  }
}

// Export validation function for testing
export { validateEvaluateOptions };