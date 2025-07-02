import chalk from 'chalk';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from '../core/config';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { SearchCommandOptions, FunctionInfo } from '../types';
import path from 'path';

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
      // Perform keyword search
      const functions = await storage.searchFunctionsByDescription(keyword, {
        limit: options.limit ? parseInt(options.limit, 10) : 50
      });

      if (functions.length === 0) {
        logger.info(chalk.yellow(`No functions found matching keyword search: "${keyword}"`));
        
        // Check if function descriptions exist
        const configManager = new ConfigManager();
        const statsConfig = await configManager.load();
        const statsStorage = new PGLiteStorageAdapter(statsConfig.storage.path || '.funcqc/funcqc.db');
        await statsStorage.init();
        const stats = await statsStorage.getEmbeddingStats();
        await statsStorage.close();
        
        if (stats.total === 0) {
          logger.info(chalk.gray(`💡 No function descriptions found. Add descriptions first: ${chalk.cyan('funcqc describe')}`));
        } else {
          logger.info(chalk.gray(`💡 Try searching with partial keywords or check function names with: ${chalk.cyan('funcqc list --name "*pattern*"')}`));
        }
        
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
  logger.info(chalk.bold('ID        Complexity   Function                  File:Line                                Exported Async'));
  logger.info(chalk.gray('─'.repeat(105)));

  // Print function rows
  functions.forEach(func => {
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const complexityColor = getComplexityColor(complexity);
    
    const functionId = chalk.gray(func.id.substring(0, 8));
    const functionName = truncate(func.name, 25).padEnd(25);
    const fileLocation = truncate(`${path.basename(func.filePath)}:${func.startLine}`, 40).padEnd(40);
    const exported = func.isExported ? chalk.green('✓') : chalk.gray('✗');
    const async = func.isAsync ? chalk.blue('✓') : chalk.gray('✗');

    const complexityStr = complexityColor(complexity.toString()).padEnd(12);
    
    logger.info(`${functionId} ${complexityStr} ${functionName} ${fileLocation} ${exported}        ${async}`);
  });
}

function displayFriendly(functions: FunctionInfo[], logger: Logger): void {
  functions.forEach((func, index) => {
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const complexityColor = getComplexityColor(complexity);
    
    logger.info(`${chalk.bold(`${index + 1}.`)} ${chalk.cyan(func.name)} ${chalk.gray(`[ID: ${func.id.substring(0, 8)}]`)}`);
    logger.info(`   File: ${func.filePath}:${func.startLine}`);
    
    const metricLine = `   Complexity: ${complexityColor(complexity.toString())} | ` +
      `Exported: ${func.isExported ? chalk.green('Yes') : chalk.gray('No')} | ` +
      `Async: ${func.isAsync ? chalk.blue('Yes') : chalk.gray('No')}`;
    
    logger.info(metricLine);
    
    if (func.jsDoc) {
      const jsDocPreview = truncate(func.jsDoc.replace(/\n/g, ' '), 80);
      logger.info(`   JSDoc: ${chalk.gray(jsDocPreview)}`);
    }
    
    if (func.description) {
      const descPreview = truncate(func.description, 80);
      logger.info(`   Description: ${chalk.gray(descPreview)}`);
    }
    
    logger.info('');
  });
}

function getComplexityColor(complexity: number): (text: string) => string {
  if (complexity >= 10) return chalk.red;
  if (complexity >= 5) return chalk.yellow;
  return chalk.green;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}