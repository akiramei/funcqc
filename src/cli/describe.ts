import chalk from 'chalk';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from '../core/config';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { DescribeCommandOptions, FunctionDescription } from '../types';
import fs from 'fs';

interface DescribeBatchInput {
  functionId: string;
  description: string;
  source?: 'human' | 'ai' | 'jsdoc';
  aiModel?: string;
  confidenceScore?: number;
  createdBy?: string;
}

export async function describeCommand(
  functionIdOrPattern: string,
  options: DescribeCommandOptions
): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  const errorHandler = createErrorHandler(logger);

  try {
    // Load configuration
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    // Initialize storage
    const storage = new PGLiteStorageAdapter(config.storage.path || '.funcqc/funcqc.db');
    await storage.init();

    try {
      if (options.batch && options.input) {
        await handleBatchDescribe(storage, options, logger);
      } else {
        await handleSingleDescribe(storage, functionIdOrPattern, options, logger);
      }
    } finally {
      await storage.close();
    }

  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      'Failed to execute describe command',
      { functionId: functionIdOrPattern, options },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
    process.exit(1);
  }
}

async function handleBatchDescribe(
  storage: PGLiteStorageAdapter,
  options: DescribeCommandOptions,
  logger: Logger
): Promise<void> {
  if (!options.input) {
    throw new Error('Input file path is required for batch mode');
  }

  if (!fs.existsSync(options.input)) {
    throw new Error(`Input file not found: ${options.input}`);
  }

  let inputData: unknown;
  try {
    inputData = JSON.parse(fs.readFileSync(options.input, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to parse JSON from input file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  if (!Array.isArray(inputData)) {
    throw new Error('Input file must contain an array of descriptions');
  }

  const descriptions = inputData as DescribeBatchInput[];
  
  logger.info(`Processing ${descriptions.length} function descriptions...`);

  for (const desc of descriptions) {
    if (!desc.functionId || !desc.description) {
      logger.warn(`Skipping invalid description entry: ${JSON.stringify(desc)}`);
      continue;
    }

    const description: FunctionDescription = {
      functionId: desc.functionId,
      description: desc.description,
      source: desc.source || options.source || 'human',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(desc.createdBy && { createdBy: desc.createdBy }),
      ...(options.by && { createdBy: options.by }),
      ...(desc.aiModel && { aiModel: desc.aiModel }),
      ...(options.model && { aiModel: options.model }),
      ...(desc.confidenceScore !== undefined && !isNaN(desc.confidenceScore) && { confidenceScore: desc.confidenceScore }),
      ...(options.confidence && !isNaN(parseFloat(options.confidence)) && { confidenceScore: parseFloat(options.confidence) })
    };

    await storage.saveFunctionDescription(description);
    logger.info(`✓ Saved description for function: ${desc.functionId}`);
  }

  logger.info(chalk.green(`Successfully processed ${descriptions.length} function descriptions`));
}

async function handleSingleDescribe(
  storage: PGLiteStorageAdapter,
  functionIdOrPattern: string,
  options: DescribeCommandOptions,
  logger: Logger
): Promise<void> {
  // Check if function exists
  const functions = await storage.queryFunctions({
    filters: [
      {
        field: 'id',
        operator: '=',
        value: functionIdOrPattern
      }
    ]
  });

  if (functions.length === 0) {
    // Try to find by name pattern
    const functionsByName = await storage.queryFunctions({
      filters: [
        {
          field: 'name',
          operator: 'LIKE',
          value: `%${functionIdOrPattern}%`
        }
      ]
    });

    if (functionsByName.length === 0) {
      throw new Error(`Function not found: ${functionIdOrPattern}`);
    }

    if (functionsByName.length > 1) {
      logger.info('Multiple functions found:');
      functionsByName.forEach((func, index) => {
        logger.info(`  ${index + 1}. ${func.id} - ${func.name} (${func.filePath}:${func.startLine})`);
      });
      throw new Error('Multiple functions match the pattern. Please use a specific function ID.');
    }

    // Use the single matched function
    functionIdOrPattern = functionsByName[0].id;
  }

  const targetFunction = functions.length > 0 ? functions[0] : (await storage.queryFunctions({
    filters: [{ field: 'id', operator: '=', value: functionIdOrPattern }]
  }))[0];

  if (!targetFunction) {
    throw new Error(`Function not found: ${functionIdOrPattern}`);
  }

  if (options.text) {
    // Direct text input
    const description: FunctionDescription = {
      functionId: functionIdOrPattern,
      description: options.text,
      source: options.source || 'human',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(options.by && { createdBy: options.by }),
      ...(options.model && { aiModel: options.model }),
      ...(options.confidence && !isNaN(parseFloat(options.confidence)) && { confidenceScore: parseFloat(options.confidence) })
    };

    await storage.saveFunctionDescription(description);
    
    logger.info(chalk.green(`✓ Description saved for function: ${targetFunction.name}`));
    logger.info(`  Function ID: ${functionIdOrPattern}`);
    logger.info(`  Description: ${options.text}`);
    logger.info(`  Source: ${description.source}`);

  } else if (options.interactive) {
    // Interactive mode (future enhancement)
    throw new Error('Interactive mode is not yet implemented. Please use --text option.');
    
  } else {
    // Show current description or prompt for input
    const existingDescription = await storage.getFunctionDescription(functionIdOrPattern);
    
    if (existingDescription) {
      logger.info(chalk.blue(`Current description for ${targetFunction.name}:`));
      logger.info(`  Description: ${existingDescription.description}`);
      logger.info(`  Source: ${existingDescription.source}`);
      logger.info(`  Created: ${new Date(existingDescription.createdAt).toISOString()}`);
      if (existingDescription.createdBy) {
        logger.info(`  Created by: ${existingDescription.createdBy}`);
      }
      if (existingDescription.aiModel) {
        logger.info(`  AI Model: ${existingDescription.aiModel}`);
      }
      if (existingDescription.confidenceScore !== undefined) {
        logger.info(`  Confidence: ${existingDescription.confidenceScore}`);
      }
    } else {
      logger.info(chalk.yellow(`No description found for function: ${targetFunction.name}`));
      logger.info(`  Function ID: ${functionIdOrPattern}`);
      logger.info(`  File: ${targetFunction.filePath}:${targetFunction.startLine}`);
      logger.info(`  Signature: ${targetFunction.signature}`);
      logger.info('');
      logger.info('Use --text to add a description:');
      logger.info(`  funcqc describe ${functionIdOrPattern} --text "Your description here"`);
    }
  }
}