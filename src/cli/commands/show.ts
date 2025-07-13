import chalk from 'chalk';
import { ShowCommandOptions, FunctionInfo } from '../../types';
import { calculateFileHash, fileExists } from '../../utils/file-utils';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';

/**
 * Show command as a Reader function
 * Uses shared storage from environment
 */
export const showCommand = (namePattern: string = '') => 
  (options: ShowCommandOptions) => 
    async (env: CommandEnvironment): Promise<void> => {
      const errorHandler = createErrorHandler(env.commandLogger);

      try {
        const func = await findTargetFunction(env, options.id, namePattern);

        if (options.json) {
          outputJSON(func);
        } else {
          await outputFriendly(func, env, options);
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

async function findTargetFunction(
  env: CommandEnvironment,
  functionId?: string,
  namePattern?: string
): Promise<FunctionInfo> {
  // Priority 1: Search by ID if provided
  if (functionId) {
    const func = await env.storage.getFunction(functionId);
    if (func) {
      return func;
    }
    throw new Error(`Function with ID '${functionId}' not found`);
  }

  // Priority 2: Search by name pattern
  if (namePattern) {
    const functions = await env.storage.queryFunctions();
    
    // First try exact match
    let matches = functions.filter(f => f.displayName === namePattern || f.name === namePattern);
    
    // If no exact match, try pattern matching
    if (matches.length === 0) {
      const pattern = new RegExp(namePattern.replace(/\*/g, '.*'), 'i');
      matches = functions.filter(f => pattern.test(f.displayName) || pattern.test(f.name));
    }

    if (matches.length === 0) {
      throw new Error(`No functions found matching pattern '${namePattern}'`);
    }
    
    if (matches.length === 1) {
      return matches[0];
    }

    // Multiple matches - show options
    console.log(chalk.yellow(`Multiple functions match '${namePattern}':`));
    matches.slice(0, 10).forEach((func, index) => {
      console.log(`  ${index + 1}. ${func.displayName} (${func.filePath}:${func.startLine})`);
    });
    
    if (matches.length > 10) {
      console.log(chalk.gray(`  ... and ${matches.length - 10} more`));
    }
    
    throw new Error(`Multiple matches found. Please use --id option or be more specific.`);
  }

  throw new Error('Please provide either --id <function-id> or a function name pattern');
}

function outputJSON(func: FunctionInfo): void {
  console.log(JSON.stringify(func, null, 2));
}

async function outputFriendly(
  func: FunctionInfo,
  env: CommandEnvironment,
  options: ShowCommandOptions
): Promise<void> {
  const showAll = options.full;
  const showForUsers = options.forUsers;
  const showForMaintainers = options.forMaintainers;

  // Header
  console.log(chalk.blue.bold(`\n📍 Function: ${func.displayName}`));
  console.log('─'.repeat(60));

  // Basic information (always shown)
  await displayBasicInfo(func, env);

  // Conditional sections based on options
  if (showAll || options.details || showForMaintainers) {
    displayParametersAndReturn(func);
  }

  if (showAll || options.quality || showForMaintainers) {
    displayQualityMetrics(func);
  }

  if (showAll || options.technical || showForMaintainers) {
    displayTechnicalInfo(func);
  }

  if (showAll || options.usage || showForUsers) {
    await displayUsageInfo(func, env);
  }

  if (showAll || options.examples || showForUsers) {
    displayExamples(func);
  }

  if (showAll || options.source) {
    displaySourceCode(func, options.syntax);
  }

  console.log(); // Empty line at end
}

async function displayBasicInfo(func: FunctionInfo, _env: CommandEnvironment): Promise<void> {
  console.log(chalk.cyan('📋 Basic Information:'));
  console.log(`  Name: ${func.displayName}`);
  console.log(`  File: ${func.filePath}:${func.startLine}-${func.endLine}`);
  console.log(`  Type: ${func.functionType || 'function'}`);
  
  if (func.modifiers && func.modifiers.length > 0) {
    console.log(`  Modifiers: ${func.modifiers.join(', ')}`);
  }
  
  console.log(`  Exported: ${func.isExported ? '✅' : '❌'}`);
  console.log(`  Async: ${func.isAsync ? '✅' : '❌'}`);
  
  // File status check
  if (await fileExists(func.filePath)) {
    const currentHash = await calculateFileHash(func.filePath);
    if (currentHash === func.fileHash) {
      console.log(chalk.green('  File Status: ✅ Up to date'));
    } else {
      console.log(chalk.yellow('  File Status: ⚠️ Modified since last scan'));
    }
  } else {
    console.log(chalk.red('  File Status: ❌ File not found'));
  }

  // Description if available
  if (func.description) {
    console.log(chalk.cyan('\n📝 Description:'));
    console.log(`  ${func.description}`);
    
    if (func.descriptionSource) {
      const sourceInfo = func.descriptionSource === 'ai' && func.descriptionAiModel 
        ? `${func.descriptionSource} (${func.descriptionAiModel})`
        : func.descriptionSource;
      console.log(chalk.gray(`  Source: ${sourceInfo}`));
    }
  }

  console.log();
}

function displayParametersAndReturn(func: FunctionInfo): void {
  console.log(chalk.cyan('🔧 Signature Details:'));
  
  if (func.parameters && func.parameters.length > 0) {
    console.log('  Parameters:');
    func.parameters.forEach((param, index) => {
      const optional = param.isOptional ? '?' : '';
      const rest = param.isRest ? '...' : '';
      const defaultVal = param.defaultValue ? ` = ${param.defaultValue}` : '';
      
      console.log(`    ${index + 1}. ${rest}${param.name}${optional}: ${param.type}${defaultVal}`);
      
      if (param.description) {
        console.log(chalk.gray(`       ${param.description}`));
      }
    });
  } else {
    console.log('  Parameters: None');
  }

  if (func.returnType) {
    console.log(`  Returns: ${func.returnType.type}`);
    if (func.returnType.description) {
      console.log(chalk.gray(`    ${func.returnType.description}`));
    }
  }

  console.log();
}

function displayQualityMetrics(func: FunctionInfo): void {
  if (!func.metrics) {
    console.log(chalk.cyan('📊 Quality Metrics: Not available'));
    console.log();
    return;
  }

  const metrics = func.metrics;
  console.log(chalk.cyan('📊 Quality Metrics:'));
  
  // Complexity metrics
  console.log('  Complexity:');
  console.log(`    Cyclomatic: ${getMetricWithColor(metrics.cyclomaticComplexity, 5, 10)}`);
  console.log(`    Cognitive: ${getMetricWithColor(metrics.cognitiveComplexity, 10, 15)}`);
  console.log(`    Max Nesting: ${getMetricWithColor(metrics.maxNestingLevel, 3, 5)}`);
  
  // Size metrics
  console.log('  Size:');
  console.log(`    Lines of Code: ${getMetricWithColor(metrics.linesOfCode, 20, 50)}`);
  console.log(`    Total Lines: ${metrics.totalLines}`);
  console.log(`    Parameters: ${getMetricWithColor(metrics.parameterCount, 3, 5)}`);
  
  // Structure metrics
  console.log('  Structure:');
  console.log(`    Branches: ${metrics.branchCount}`);
  console.log(`    Loops: ${metrics.loopCount}`);
  console.log(`    Return Statements: ${metrics.returnStatementCount}`);
  console.log(`    Try-Catch Blocks: ${metrics.tryCatchCount}`);
  
  // Advanced metrics
  if (metrics.maintainabilityIndex !== undefined) {
    console.log('  Advanced:');
    console.log(`    Maintainability Index: ${getMetricWithColor(metrics.maintainabilityIndex, 70, 50, true)}`);
    
    if (metrics.halsteadVolume !== undefined) {
      console.log(`    Halstead Volume: ${metrics.halsteadVolume.toFixed(2)}`);
    }
    
    if (metrics.halsteadDifficulty !== undefined) {
      console.log(`    Halstead Difficulty: ${metrics.halsteadDifficulty.toFixed(2)}`);
    }
  }

  // Code quality metrics
  console.log('  Code Quality:');
  console.log(`    Comment Lines: ${metrics.commentLines}`);
  console.log(`    Code-to-Comment Ratio: ${metrics.codeToCommentRatio.toFixed(2)}`);
  
  console.log();
}

function displayTechnicalInfo(func: FunctionInfo): void {
  console.log(chalk.cyan('🔧 Technical Information:'));
  console.log(`  Function ID: ${func.id}`);
  console.log(`  Semantic ID: ${func.semanticId}`);
  console.log(`  Content ID: ${func.contentId}`);
  console.log(`  AST Hash: ${func.astHash}`);
  console.log(`  Signature Hash: ${func.signatureHash}`);
  console.log(`  File Hash: ${func.fileHash}`);
  
  if (func.contextPath && func.contextPath.length > 0) {
    console.log(`  Context Path: ${func.contextPath.join(' > ')}`);
  }
  
  console.log();
}

async function displayUsageInfo(func: FunctionInfo, _env: CommandEnvironment): Promise<void> {
  console.log(chalk.cyan('🎯 Usage Information:'));
  
  // Function description usage patterns
  if (func.description) {
    console.log('  Purpose:');
    console.log(`    ${func.description}`);
  }
  
  console.log('  Call Pattern:');
  if (func.isMethod && func.contextPath && func.contextPath.length > 0) {
    const className = func.contextPath[func.contextPath.length - 1];
    console.log(`    ${className}.${func.name}(${getParameterPattern(func)})`);
  } else {
    console.log(`    ${func.name}(${getParameterPattern(func)})`);
  }
  
  // Show if function is async
  if (func.isAsync) {
    console.log(chalk.yellow('  ⚠️ Note: This is an async function - remember to use await'));
  }
  
  console.log();
}

function displayExamples(func: FunctionInfo): void {
  console.log(chalk.cyan('💡 Usage Examples:'));
  
  // Generate simple usage example
  const paramExample = func.parameters?.map(p => {
    if (p.defaultValue) return `${p.name}?`;
    return p.name;
  }).join(', ') || '';
  
  const callPrefix = func.isAsync ? 'await ' : '';
  const objectPrefix = func.isMethod && func.contextPath 
    ? `${func.contextPath[func.contextPath.length - 1].toLowerCase()}.`
    : '';
  
  console.log(`  ${callPrefix}${objectPrefix}${func.name}(${paramExample})`);
  
  if (func.returnType && func.returnType.type !== 'void') {
    console.log(`  // Returns: ${func.returnType.type}`);
  }
  
  console.log();
}

function displaySourceCode(func: FunctionInfo, withSyntax?: boolean): void {
  if (!func.sourceCode) {
    console.log(chalk.cyan('📄 Source Code: Not available'));
    console.log();
    return;
  }

  console.log(chalk.cyan('📄 Source Code:'));
  console.log('─'.repeat(60));
  
  if (withSyntax) {
    // Basic syntax highlighting (simplified)
    const highlighted = func.sourceCode
      .replace(/\b(function|const|let|var|if|else|for|while|return|async|await)\b/g, chalk.blue('$1'))
      .replace(/\b(true|false|null|undefined)\b/g, chalk.magenta('$1'))
      .replace(/"([^"]*)"/g, chalk.green('"$1"'))
      .replace(/'([^']*)'/g, chalk.green("'$1'"));
    
    console.log(highlighted);
  } else {
    console.log(func.sourceCode);
  }
  
  console.log('─'.repeat(60));
  console.log();
}

function getMetricWithColor(value: number, warning: number, critical: number, reverse = false): string {
  const isWarning = reverse ? value < warning : value >= warning;
  const isCritical = reverse ? value < critical : value >= critical;
  
  if (isCritical) {
    return chalk.red(value.toString());
  } else if (isWarning) {
    return chalk.yellow(value.toString());
  } else {
    return chalk.green(value.toString());
  }
}

function getParameterPattern(func: FunctionInfo): string {
  if (!func.parameters || func.parameters.length === 0) {
    return '';
  }
  
  return func.parameters.map(p => {
    const rest = p.isRest ? '...' : '';
    const optional = p.isOptional || p.defaultValue ? '?' : '';
    return `${rest}${p.name}${optional}`;
  }).join(', ');
}