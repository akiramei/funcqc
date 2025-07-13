import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { EmbeddingService } from '../../services/embedding-service';
import { VectorizeUseCase, VectorizeResult } from '../../use-cases/vectorize-use-case';
import { VectorizeOptionsValidator, VectorizeOptions } from '../../use-cases/vectorize-options';
import { ConfirmationHandler } from '../../use-cases/confirmation-handler';
import { OutputFormatter } from '../../use-cases/output-formatter';
import { VectorizeCommandOptions } from '../../types';

/**
 * Raw options from Commander.js before validation
 */
interface RawVectorizeOptions {
  all: boolean | undefined;
  recent: boolean | undefined;
  status: boolean | undefined;
  rebuildIndex: boolean | undefined;
  benchmark: boolean | undefined;
  indexStats: boolean | undefined;
  apiKey: string | undefined;
  model: string | undefined;
  batchSize: string | undefined;
  limit: string | undefined;
  indexAlgorithm: string | undefined;
  indexConfig: string | undefined;
  output: string | undefined;
  quiet: boolean | undefined;
  force: boolean | undefined;
}

/**
 * Vectorize command as a Reader function
 * Uses shared storage from environment and dependency injection
 */
export const vectorizeCommand: VoidCommand<VectorizeCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora();
    let embeddingService: EmbeddingService | undefined;

    try {
      // Convert to raw options for validation
      const rawOptions: RawVectorizeOptions = {
        all: options.all,
        recent: options.recent,
        status: options.status,
        rebuildIndex: options.rebuildIndex,
        benchmark: options.benchmark,
        indexStats: options.indexStats,
        apiKey: options.apiKey,
        model: options.model,
        batchSize: options.batchSize,
        limit: options.limit,
        indexAlgorithm: options.indexAlgorithm,
        indexConfig: options.indexConfig,
        output: options.output,
        quiet: options.quiet,
        force: options.force,
      };

      // Validate options
      const validator = new VectorizeOptionsValidator();
      const validation = await validateOptions(validator, rawOptions, errorHandler);
      
      // Initialize embedding service if needed
      embeddingService = await initializeEmbeddingService(validation, validator, errorHandler);

      // Handle confirmation if needed
      await handleConfirmationIfNeeded(env, spinner, validation, validator, embeddingService);

      // Execute vectorize operation
      const result = await executeVectorizeOperation(env, spinner, validation, embeddingService);

      // Display results
      await displayResults(result, validation, options);

      if (!result.success) {
        process.exit(1);
      }
    } catch (error) {
      await handleError(error, options, spinner, errorHandler);
    }
  };

async function validateOptions(
  validator: VectorizeOptionsValidator,
  rawOptions: RawVectorizeOptions,
  errorHandler: ReturnType<typeof createErrorHandler>
): Promise<VectorizeOptions> {
  const validation = validator.validate(rawOptions);

  if (!validation.success) {
    console.error(chalk.red('❌ Invalid options:'));
    validation.errors?.forEach(error => {
      console.error(chalk.red(`  • ${error}`));
    });
    
    const funcqcError = errorHandler.createError(
      ErrorCode.INVALID_CONFIG,
      'Invalid vectorize command options',
      { errors: validation.errors }
    );
    errorHandler.handleError(funcqcError);
    process.exit(1);
  }

  return validation.data!;
}

async function initializeEmbeddingService(
  options: VectorizeOptions,
  validator: VectorizeOptionsValidator,
  errorHandler: ReturnType<typeof createErrorHandler>
): Promise<EmbeddingService | undefined> {
  const apiKey = options.apiKey || process.env['OPENAI_API_KEY'];

  if (validator.requiresApiKey(options) && !apiKey) {
    console.error(chalk.red('OpenAI API key is required for this operation'));
    console.log('Provide it via --api-key option or OPENAI_API_KEY environment variable');
    
    const funcqcError = errorHandler.createError(
      ErrorCode.INVALID_CONFIG,
      'Missing required OpenAI API key',
      { operation: validator.getOperationDescription(options) }
    );
    errorHandler.handleError(funcqcError);
    process.exit(1);
  }

  if (apiKey && validator.requiresApiKey(options)) {
    return new EmbeddingService({
      apiKey,
      model: options.model,
      batchSize: options.batchSize,
    });
  }

  return undefined;
}

async function handleConfirmationIfNeeded(
  env: CommandEnvironment,
  spinner: Ora,
  options: VectorizeOptions,
  validator: VectorizeOptionsValidator,
  _embeddingService: EmbeddingService | undefined
): Promise<void> {
  if (!validator.isDangerousOperation(options) || options.force) {
    return;
  }

  const functionCount = await getFunctionCount(env, options);
  const confirmationHandler = new ConfirmationHandler();

  const estimatedCost = confirmationHandler.estimateEmbeddingCost(functionCount, options.model);

  const message = confirmationHandler.createVectorizeConfirmationMessage(
    validator.getOperationDescription(options),
    functionCount,
    estimatedCost
  );

  spinner.stop();
  const confirmation = await confirmationHandler.confirm({
    message,
    defaultValue: false,
  });

  if (!confirmation.confirmed) {
    console.log(chalk.yellow('Operation cancelled by user.'));
    process.exit(0);
  }
}

async function getFunctionCount(
  env: CommandEnvironment,
  options: VectorizeOptions
): Promise<number> {
  try {
    const snapshots = await env.storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) return 0;

    const functions = await env.storage.getFunctionsWithDescriptions(snapshots[0].id);

    if (options.limit !== undefined) {
      return Math.min(functions.length, options.limit);
    }

    return functions.length;
  } catch (error) {
    // Log the error for debugging purposes while returning safe fallback
    console.warn(
      'Failed to get function count:',
      error instanceof Error ? error.message : String(error)
    );
    return 0;
  }
}

async function executeVectorizeOperation(
  env: CommandEnvironment,
  spinner: Ora,
  options: VectorizeOptions,
  embeddingService: EmbeddingService | undefined
): Promise<VectorizeResult> {
  const validator = new VectorizeOptionsValidator();
  const operationDescription = validator.getOperationDescription(options);
  spinner.start(`Executing ${operationDescription.toLowerCase()}...`);

  const useCase = new VectorizeUseCase({
    storage: env.storage,
    embeddingService,
  });

  const result = await useCase.execute(options);
  spinner.stop();

  return result;
}

async function displayResults(
  result: VectorizeResult,
  options: VectorizeOptions,
  _commandOptions: VectorizeCommandOptions
): Promise<void> {
  const formatter = new OutputFormatter({
    format: options.output,
    quiet: options.quiet || false,
    color: process.stdout.isTTY,
  });

  const output = formatter.format(result);
  console.log(output);
}

async function handleError(
  error: unknown,
  options: VectorizeCommandOptions,
  spinner: Ora,
  errorHandler: ReturnType<typeof createErrorHandler>
): Promise<void> {
  spinner.fail('Operation failed');

  if (options.output === 'json') {
    const errorOutput = {
      success: false,
      operation: 'unknown',
      timestamp: new Date().toISOString(),
      errors: [error instanceof Error ? error.message : String(error)],
    };
    console.log(JSON.stringify(errorOutput, null, 2));
  } else {
    console.error(chalk.red('❌ Error:'), error instanceof Error ? error.message : String(error));
  }

  const funcqcError = errorHandler.createError(
    ErrorCode.UNKNOWN_ERROR,
    `Vectorize command failed: ${error instanceof Error ? error.message : String(error)}`,
    { options },
    error instanceof Error ? error : undefined
  );
  errorHandler.handleError(funcqcError);
  process.exit(1);
}