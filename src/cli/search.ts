import chalk from 'chalk';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from '../core/config';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { SearchCommandOptions, FunctionInfo } from '../types';

export async function searchCommand(
  keyword: string,
  options: SearchCommandOptions
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
      const functions = await storage.searchFunctionsByDescription(keyword, {
        limit: options.limit ? parseInt(options.limit, 10) : 50
      });

      if (functions.length === 0) {
        logger.info(chalk.yellow(`No functions found matching keyword: "${keyword}"`));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(functions, null, 2));
        return;
      }

      // Display results in formatted output
      displaySearchResults(functions, keyword, logger, options);

    } finally {
      await storage.close();
    }

  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      'Failed to execute search command',
      { keyword, options },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
    process.exit(1);
  }
}

function displaySearchResults(
  functions: FunctionInfo[],
  keyword: string,
  logger: Logger,
  options: SearchCommandOptions
): void {
  const format = options.format || 'table';

  logger.info(chalk.blue(`Search results for "${keyword}" (${functions.length} functions found)`));
  logger.info('');

  if (format === 'table') {
    displayTable(functions, logger);
  } else if (format === 'friendly') {
    displayFriendly(functions, logger);
  } else {
    // Default to table format
    displayTable(functions, logger);
  }
}

function displayTable(functions: FunctionInfo[], logger: Logger): void {
  // Print table header
  logger.info(chalk.bold('Complexity   Function                  File:Line                                Exported Async'));
  logger.info(chalk.gray('─'.repeat(95)));

  // Print function rows
  functions.forEach(func => {
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const complexityColor = getComplexityColor(complexity);
    
    const functionName = truncate(func.name, 25).padEnd(25);
    const fileLocation = truncate(`${path.basename(func.filePath)}:${func.startLine}`, 40).padEnd(40);
    const exported = func.isExported ? chalk.green('✓') : chalk.gray('✗');
    const async = func.isAsync ? chalk.blue('✓') : chalk.gray('✗');

    const complexityStr = complexityColor(complexity.toString()).padEnd(12);
    logger.info(`${complexityStr} ${functionName} ${fileLocation} ${exported}        ${async}`);
  });
}

function displayFriendly(functions: FunctionInfo[], logger: Logger): void {
  functions.forEach((func, index) => {
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const complexityColor = getComplexityColor(complexity);
    
    logger.info(`${chalk.bold(`${index + 1}.`)} ${chalk.cyan(func.name)}`);
    logger.info(`   File: ${func.filePath}:${func.startLine}`);
    logger.info(`   Complexity: ${complexityColor(complexity.toString())} | ` +
      `Exported: ${func.isExported ? chalk.green('Yes') : chalk.gray('No')} | ` +
      `Async: ${func.isAsync ? chalk.blue('Yes') : chalk.gray('No')}`);
    
    if (func.jsDoc) {
      const jsDocPreview = truncate(func.jsDoc.replace(/\n/g, ' '), 80);
      logger.info(`   JSDoc: ${chalk.gray(jsDocPreview)}`);
    }
    
    logger.info('');
  });
}

function getComplexityColor(complexity: number): (text: string) => string {
  if (complexity >= 10) return chalk.red;
  if (complexity >= 5) return chalk.yellow;
  return chalk.green;
}

// Import path module for basename
import path from 'path';

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}