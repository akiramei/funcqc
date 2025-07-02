/**
 * Refactored vectorize command with improved architecture and UX
 * Addresses issues from #68 and #74: separation of concerns, validation, and better error handling
 */

import { Command } from 'commander';
import ora, { Ora } from 'ora';
import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { EmbeddingService } from '../services/embedding-service';
import { VectorizeUseCase } from '../use-cases/vectorize-use-case';
import { VectorizeOptionsValidator } from '../use-cases/vectorize-options';
import { ConfirmationHandler } from '../use-cases/confirmation-handler';
import { OutputFormatter } from '../use-cases/output-formatter';

interface VectorizeContext {
  storage: PGLiteStorageAdapter;
  embeddingService: EmbeddingService | undefined;
  validator: VectorizeOptionsValidator;
  spinner: Ora;
}

export function createVectorizeCommand(): Command {
  return new Command('vectorize')
    .description('Generate and manage embeddings for function descriptions')
    .option('--all', 'vectorize all functions with descriptions')
    .option('--recent', 'vectorize only functions without embeddings (default)')
    .option('--status', 'show vectorization status')
    .option('--rebuild-index', 'rebuild ANN index for faster search')
    .option('--index-algorithm <algorithm>', 'ANN algorithm (hierarchical, lsh, hybrid)', 'hierarchical')
    .option('--index-config <config>', 'JSON config for ANN index (clusters, hash bits, etc.)')
    .option('--benchmark', 'benchmark ANN index performance')
    .option('--index-stats', 'show ANN index statistics')
    .option('--api-key <key>', 'OpenAI API key (or use OPENAI_API_KEY env var)')
    .option('--model <model>', 'embedding model to use', 'text-embedding-3-small')
    .option('--batch-size <size>', 'batch size for processing', '100')
    .option('--limit <n>', 'limit number of functions to process')
    .option('--output <format>', 'output format (console, json)', 'console')
    .option('--force', 'skip confirmation prompts')
    .option('--quiet', 'reduce output verbosity')
    .action(vectorizeActionHandler);
}

async function vectorizeActionHandler(rawOptions: any): Promise<void> {
  const spinner = ora();
  let storage: PGLiteStorageAdapter | null = null;
  
  try {
    const validator = new VectorizeOptionsValidator();
    const options = await validateOptions(validator, rawOptions);
    
    storage = await initializeStorage(spinner);
    const embeddingService = await initializeEmbeddingService(options, validator);
    
    const context: VectorizeContext = {
      storage,
      embeddingService,
      validator,
      spinner
    };
    
    await handleConfirmationIfNeeded(context, options);
    const result = await executeVectorizeOperation(context, options);
    await displayResults(result, options);
    
    if (!result.success) {
      process.exit(1);
    }
    
  } catch (error) {
    await handleError(error, rawOptions, spinner);
  } finally {
    await cleanup(storage);
  }
}

async function validateOptions(validator: VectorizeOptionsValidator, rawOptions: any) {
  const validation = validator.validate(rawOptions);
  
  if (!validation.success) {
    console.error(chalk.red('❌ Invalid options:'));
    validation.errors?.forEach(error => {
      console.error(chalk.red(`  • ${error}`));
    });
    process.exit(1);
  }
  
  return validation.data!;
}

async function initializeStorage(spinner: Ora): Promise<PGLiteStorageAdapter> {
  spinner.start('Initializing...');
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const storage = new PGLiteStorageAdapter(config.storage.path || '.funcqc/funcqc.db');
  await storage.init();
  return storage;
}

async function initializeEmbeddingService(
  options: any, 
  validator: VectorizeOptionsValidator
): Promise<EmbeddingService | undefined> {
  const apiKey = options.apiKey || process.env['OPENAI_API_KEY'];
  
  if (validator.requiresApiKey(options) && !apiKey) {
    console.error(chalk.red('OpenAI API key is required for this operation'));
    console.log('Provide it via --api-key option or OPENAI_API_KEY environment variable');
    process.exit(1);
  }
  
  if (apiKey && validator.requiresApiKey(options)) {
    return new EmbeddingService({
      apiKey,
      model: options.model,
      batchSize: options.batchSize
    });
  }
  
  return undefined;
}

async function handleConfirmationIfNeeded(
  context: VectorizeContext, 
  options: any
): Promise<void> {
  if (!context.validator.isDangerousOperation(options) || options.force) {
    return;
  }
  
  const functionCount = await getFunctionCount(context.storage, options);
  const confirmationHandler = new ConfirmationHandler();
  
  const estimatedCost = confirmationHandler.estimateEmbeddingCost(
    functionCount, 
    options.model
  );
  
  const message = confirmationHandler.createVectorizeConfirmationMessage(
    context.validator.getOperationDescription(options),
    functionCount,
    estimatedCost
  );
  
  context.spinner.stop();
  const confirmation = await confirmationHandler.confirm({
    message,
    defaultValue: false
  });
  
  if (!confirmation.confirmed) {
    console.log(chalk.yellow('Operation cancelled by user.'));
    process.exit(0);
  }
}

async function getFunctionCount(storage: PGLiteStorageAdapter, options: any): Promise<number> {
  try {
    const snapshots = await storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) return 0;
    
    const functions = await storage.getFunctionsWithDescriptions(snapshots[0].id);
    return options.limit ? Math.min(functions.length, options.limit) : functions.length;
  } catch {
    return 0;
  }
}

async function executeVectorizeOperation(context: VectorizeContext, options: any) {
  const operationDescription = context.validator.getOperationDescription(options);
  context.spinner.start(`Executing ${operationDescription.toLowerCase()}...`);
  
  const useCase = new VectorizeUseCase({
    storage: context.storage,
    embeddingService: context.embeddingService
  });
  
  const result = await useCase.execute(options);
  context.spinner.stop();
  
  return result;
}

async function displayResults(result: any, options: any): Promise<void> {
  const formatter = new OutputFormatter({
    format: options.output,
    quiet: options.quiet || false,
    color: process.stdout.isTTY
  });
  
  const output = formatter.format(result);
  console.log(output);
}

async function handleError(error: unknown, rawOptions: any, spinner: Ora): Promise<void> {
  spinner.fail('Operation failed');
  
  if (rawOptions.output === 'json') {
    const errorOutput = {
      success: false,
      operation: 'unknown',
      timestamp: new Date().toISOString(),
      errors: [error instanceof Error ? error.message : String(error)]
    };
    console.log(JSON.stringify(errorOutput, null, 2));
  } else {
    console.error(chalk.red('❌ Error:'), error instanceof Error ? error.message : String(error));
  }
  
  process.exit(1);
}

async function cleanup(storage: PGLiteStorageAdapter | null): Promise<void> {
  if (!storage) return;
  
  try {
    await storage.close();
  } catch {
    console.warn(chalk.yellow('Warning: Failed to close storage connection'));
  }
}