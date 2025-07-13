import { ShowCommandOptions, FunctionInfo } from '../../types';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { calculateFileHash, fileExists } from '../../utils/file-utils';
import chalk from 'chalk';

/**
 * Show command as a Reader function
 */
export const showCommand = (namePattern: string = '') => (options: ShowCommandOptions) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const func = await findTargetFunction(namePattern, options)(env);
      
      if (options.json) {
        outputJSON(func);
      } else {
        await outputFriendly(func, env);
      }
    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to show function: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Find target function - Reader function
 */
const findTargetFunction = (namePattern: string, options: ShowCommandOptions) =>
  async (env: CommandEnvironment): Promise<FunctionInfo> => {
    let targetFunction: FunctionInfo | undefined;

    if (options.id) {
      // Search by ID
      const functions = await env.storage.queryFunctions({});
      targetFunction = functions.find(f => f.id === options.id || f.id.startsWith(options.id || ''));
      
      if (!targetFunction) {
        throw new Error(`Function with ID '${options.id}' not found.`);
      }
    } else if (namePattern) {
      // Search by name pattern
      const functions = await env.storage.queryFunctions({});
      const matches = functions.filter(f => 
        f.name.includes(namePattern) || 
        f.name.toLowerCase().includes(namePattern.toLowerCase())
      );

      if (matches.length === 0) {
        throw new Error(`No functions found matching pattern: ${namePattern}`);
      }

      if (matches.length === 1) {
        targetFunction = matches[0];
      } else {
        // Multiple matches - show list and ask user to be more specific
        console.log('Multiple functions found:\n');
        matches.forEach((f, i) => {
          const shortId = f.id.substring(0, 8);
          console.log(`${i + 1}. ${f.displayName || f.name}() [${shortId}]`);
          console.log(`   📍 ${f.filePath}:${f.startLine}`);
          console.log(`   🔗 ${f.signature || 'No signature available'}`);
          console.log('');
        });
        throw new Error(`Multiple functions found. Please specify by ID or use a more specific pattern.`);
      }
    } else {
      throw new Error('Please specify either --id or provide a function name pattern.');
    }

    return targetFunction;
  };

/**
 * Output JSON format
 */
function outputJSON(func: FunctionInfo): void {
  const output = {
    id: func.id,
    name: func.name,
    displayName: func.displayName,
    signature: func.signature,
    file: {
      path: func.filePath,
      startLine: func.startLine,
      endLine: func.endLine,
    },
    metrics: func.metrics,
    jsDoc: func.jsDoc,
    description: func.description,
    exported: func.isExported,
    async: func.isAsync,
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output friendly format - Reader function accessing environment
 */
async function outputFriendly(func: FunctionInfo, env: CommandEnvironment): Promise<void> {
  // Header
  console.log(chalk.bold.blue('\n📋 Function Details\n'));
  
  // Basic info
  console.log(`${chalk.bold('Name:')} ${func.displayName || func.name}`);
  console.log(`${chalk.bold('ID:')} ${func.id}`);
  console.log(`${chalk.bold('File:')} ${func.filePath}:${func.startLine}-${func.endLine}`);
  
  if (func.signature) {
    console.log(`${chalk.bold('Signature:')} ${func.signature}`);
  }
  
  // Flags
  const flags: string[] = [];
  if (func.isExported) flags.push('exported');
  if (func.isAsync) flags.push('async');
  if (flags.length > 0) {
    console.log(`${chalk.bold('Flags:')} ${flags.join(', ')}`);
  }

  // Metrics
  if (func.metrics) {
    console.log(chalk.bold('\n📊 Quality Metrics'));
    console.log(`  Cyclomatic Complexity: ${func.metrics.cyclomaticComplexity}`);
    console.log(`  Lines of Code: ${func.metrics.linesOfCode}`);
    console.log(`  Total Lines: ${func.metrics.totalLines}`);
    console.log(`  Parameters: ${func.metrics.parameterCount}`);
    console.log(`  Nesting Depth: ${func.metrics.maxNestingLevel}`);
    
    if (func.metrics.maintainabilityIndex !== undefined) {
      console.log(`  Maintainability Index: ${func.metrics.maintainabilityIndex.toFixed(1)}`);
    }
  }

  // Documentation
  if (func.jsDoc) {
    console.log(chalk.bold('\n📚 JSDoc'));
    console.log(func.jsDoc);
  }

  if (func.description) {
    console.log(chalk.bold('\n📝 Description'));
    console.log(func.description);
  }

  // File content preview
  await displayFileContent(func, env);
}

/**
 * Display file content around the function
 */
async function displayFileContent(func: FunctionInfo, env: CommandEnvironment): Promise<void> {
  try {
    if (!fileExists(func.filePath)) {
      env.commandLogger.warn(`File not found: ${func.filePath}`);
      return;
    }

    // Check if file has changed
    const currentHash = await calculateFileHash(func.filePath);
    if ((func as any).fileHash && currentHash !== (func as any).fileHash) {
      console.log(chalk.yellow('\n⚠️  Warning: File has been modified since last scan'));
    }

    console.log(chalk.bold(`\n📄 Source Code (${func.filePath}:${func.startLine}-${func.endLine})`));
    console.log(chalk.gray('─'.repeat(80)));
    
    // For now, just show the location info
    // In a full implementation, you could read and display the actual code
    console.log(`Function spans lines ${func.startLine} to ${func.endLine}`);
    console.log(chalk.gray('(Use your editor to view the full source code)'));
    
  } catch (error) {
    env.commandLogger.error(`Failed to read file: ${error}`);
  }
}