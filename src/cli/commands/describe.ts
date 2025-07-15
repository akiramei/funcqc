import chalk from 'chalk';
import { DescribeCommandOptions, FunctionDescription, FunctionInfo } from '../../types';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import fs from 'fs';

interface DescribeBatchInput {
  semanticId: string;
  description: string;
  source?: 'human' | 'ai' | 'jsdoc' | null;
  aiModel?: string;
  confidenceScore?: number;
  createdBy?: string;
  // Structured fields for developer information
  usageExample?: string;
  sideEffects?: string;
  errorConditions?: string;
}

/**
 * Describe command as a Reader function
 * Uses shared storage from environment
 */
export const describeCommand = (functionIdOrPattern: string = '') => 
  (options: DescribeCommandOptions) => 
    async (env: CommandEnvironment): Promise<void> => {
      const errorHandler = createErrorHandler(env.commandLogger);

      try {
        if (options.generateTemplate) {
          await handleGenerateTemplate(env, functionIdOrPattern, options);
        } else if (options.input) {
          await handleBatchDescribe(env, options);
        } else if (options.listUndocumented || options.needsDescription) {
          await handleListFunctions(env, options);
        } else {
          await handleSingleDescribe(env, functionIdOrPattern, options);
        }
      } catch (error) {
        if (error instanceof DatabaseError) {
          const funcqcError = errorHandler.createError(
            error.code,
            error.message,
            { functionId: functionIdOrPattern, options },
            error.originalError
          );
          errorHandler.handleError(funcqcError);
        } else {
          const funcqcError = errorHandler.createError(
            ErrorCode.UNKNOWN_ERROR,
            'Failed to execute describe command',
            { functionId: functionIdOrPattern, options },
            error instanceof Error ? error : undefined
          );
          errorHandler.handleError(funcqcError);
        }
      }
    };

async function handleBatchDescribe(env: CommandEnvironment, options: DescribeCommandOptions): Promise<void> {
  const descriptions = await loadBatchDescriptions(options.input!);

  env.commandLogger.info(`Processing ${descriptions.length} function descriptions...`);

  for (const desc of descriptions) {
    await processBatchDescription(env, desc, options);
  }

  env.commandLogger.info(chalk.green(`Successfully processed ${descriptions.length} function descriptions`));
}

async function loadBatchDescriptions(inputPath: string): Promise<DescribeBatchInput[]> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  let inputData: unknown;
  try {
    inputData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from input file: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  if (!Array.isArray(inputData)) {
    throw new Error('Input file must contain an array of descriptions');
  }

  return inputData as DescribeBatchInput[];
}

/**
 * Validates batch description input
 */
function validateBatchInput(
  env: CommandEnvironment,
  desc: DescribeBatchInput
): boolean {
  if (!desc.semanticId || !desc.description) {
    env.commandLogger.warn(`Skipping invalid description entry: ${JSON.stringify(desc)}`);
    return false;
  }
  return true;
}

/**
 * Checks source guard permissions for batch operations
 */
function checkSourceGuardPermissions(
  env: CommandEnvironment,
  existingDescription: FunctionDescription | null,
  newSource: 'human' | 'ai' | 'jsdoc',
  semanticId: string,
  force: boolean
): boolean {
  if (!existingDescription || force) {
    return true;
  }

  const sourceGuardWarning = validateSourceGuard(existingDescription.source, newSource);
  if (sourceGuardWarning) {
    env.commandLogger.warn(`⚠️  Skipping ${semanticId}: ${sourceGuardWarning}`);
    env.commandLogger.info(
      `    → Use "source": "${existingDescription.source}" in JSON or --force to override`
    );
    return false;
  }
  return true;
}

/**
 * Creates description object with merged options
 */
function buildDescriptionObject(
  desc: DescribeBatchInput,
  options: DescribeCommandOptions,
  validatedForContentId: string,
  newSource: 'human' | 'ai' | 'jsdoc'
) {
  return createFunctionDescription(desc.semanticId, desc.description, {
    source: newSource,
    validatedForContentId,
    createdBy: desc.createdBy || options.by,
    aiModel: desc.aiModel || options.model,
    confidenceScore:
      desc.confidenceScore ?? (options.confidence ? parseFloat(options.confidence) : undefined),
    usageExample: desc.usageExample || options.usageExample,
    sideEffects: desc.sideEffects || options.sideEffects,
    errorConditions: desc.errorConditions || options.errorConditions,
  });
}

async function processBatchDescription(
  env: CommandEnvironment,
  desc: DescribeBatchInput,
  options: DescribeCommandOptions
): Promise<void> {
  if (!validateBatchInput(env, desc)) {
    return;
  }

  const validatedForContentId = await findContentIdBySemanticId(env, desc.semanticId);
  const existingDescription = await env.storage.getFunctionDescription(desc.semanticId);
  const newSource: 'human' | 'ai' | 'jsdoc' = (desc.source as 'human' | 'ai' | 'jsdoc') || options.source || 'human';

  if (!checkSourceGuardPermissions(env, existingDescription, newSource, desc.semanticId, Boolean(options.force))) {
    return;
  }

  const description = buildDescriptionObject(desc, options, validatedForContentId || '', newSource);
  await env.storage.saveFunctionDescription(description);
  env.commandLogger.info(`✓ Saved description for semantic ID: ${desc.semanticId}`);
}

async function findContentIdBySemanticId(
  env: CommandEnvironment,
  semanticId: string
): Promise<string | undefined> {
  try {
    const functions = await env.storage.queryFunctions({
      filters: [
        {
          field: 'semantic_id',
          operator: '=',
          value: semanticId,
        },
      ],
      limit: 1,
    });

    return functions.length > 0 ? functions[0].contentId : undefined;
  } catch (error) {
    env.commandLogger.warn(
      `Could not find function with semantic ID ${semanticId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return undefined;
  }
}

async function handleSingleDescribe(
  env: CommandEnvironment,
  functionIdOrPattern: string,
  options: DescribeCommandOptions
): Promise<void> {
  const targetFunction = await findTargetFunction(env, functionIdOrPattern);

  if (!targetFunction) {
    return;
  }

  if (options.text || options.usageExample || options.sideEffects || options.errorConditions) {
    await saveDescription(env, targetFunction, options);
  } else {
    await showExistingDescription(env, targetFunction);
  }
}

async function findTargetFunction(
  env: CommandEnvironment,
  functionIdOrPattern: string
): Promise<FunctionInfo | null> {
  // Try exact ID match first
  let functions = await findFunctionById(env, functionIdOrPattern);

  // Try partial ID match
  if (functions.length === 0) {
    functions = await findFunctionByPartialId(env, functionIdOrPattern);
  }

  // Try name pattern match
  if (functions.length === 0) {
    const result = await findFunctionByName(env, functionIdOrPattern);
    if (!result) return null;

    if (typeof result === 'string') {
      // Single match, use its ID
      functions = await findFunctionById(env, result);
    } else {
      // Multiple matches were displayed
      return null;
    }
  }

  if (functions.length === 0) {
    showFunctionNotFound(env.commandLogger, functionIdOrPattern);
    return null;
  }

  return functions[0];
}

async function findFunctionById(
  env: CommandEnvironment,
  functionId: string
): Promise<FunctionInfo[]> {
  return await env.storage.queryFunctions({
    filters: [
      {
        field: 'id',
        operator: '=',
        value: functionId,
      },
    ],
  });
}

async function findFunctionByPartialId(
  env: CommandEnvironment,
  partialId: string
): Promise<FunctionInfo[]> {
  return await env.storage.queryFunctions({
    filters: [
      {
        field: 'id',
        operator: 'LIKE',
        value: `${partialId}%`,
      },
    ],
  });
}

async function findFunctionByName(
  env: CommandEnvironment,
  namePattern: string
): Promise<string | boolean | null> {
  const functions = await env.storage.queryFunctions({
    filters: [
      {
        field: 'name',
        operator: 'LIKE',
        value: `%${namePattern}%`,
      },
    ],
  });

  if (functions.length === 0) {
    showFunctionNotFound(env.commandLogger, namePattern);
    return null;
  }

  if (functions.length > 1) {
    showMultipleMatches(env.commandLogger, functions, namePattern);
    return false;
  }

  return functions[0].id;
}

function showFunctionNotFound(logger: import('../../utils/cli-utils').Logger, pattern: string): void {
  logger.info(chalk.red(`❌ Function not found: ${pattern}`));
  logger.info(chalk.blue('💡 Tips:'));
  logger.info('  • Use `funcqc list` to see all available functions with their IDs');
  logger.info('  • Use `funcqc search <keyword>` to find functions by content');
  logger.info('  • Function IDs are shown in the first column of list/search results');
}

function showMultipleMatches(logger: import('../../utils/cli-utils').Logger, functions: FunctionInfo[], pattern: string): void {
  logger.info(
    chalk.yellow(`Multiple functions found matching "${pattern}". Please specify a function ID:`)
  );
  logger.info('');

  functions.forEach((func, index) => {
    const riskIcon = getRiskIcon(func);
    logger.info(
      `  ${index + 1}. ${chalk.cyan(func.id.substring(0, 8))} - ${riskIcon} ${func.displayName}`
    );
    logger.info(`     📍 ${func.filePath}:${func.startLine}`);

    if (func.jsDoc) {
      const jsDocPreview = func.jsDoc.replace(/\n/g, ' ').substring(0, 80);
      logger.info(`     📝 ${chalk.gray(jsDocPreview)}${func.jsDoc.length > 80 ? '...' : ''}`);
    }
    logger.info('');
  });

  logger.info(chalk.blue('Usage examples:'));
  logger.info(`  funcqc describe ${functions[0].id.substring(0, 8)} --text "Your description"`);
  logger.info(`  funcqc describe ${functions[0].id} --text "Your description"`);
}

/**
 * Validate source guard and show resolution instructions
 */
function handleSourceGuardValidation(
  existingDescription: FunctionDescription | null,
  newSource: 'human' | 'ai' | 'jsdoc',
  targetFunction: FunctionInfo,
  logger: import('../../utils/cli-utils').Logger,
  force: boolean
): void {
  if (existingDescription && !force) {
    const sourceGuardWarning = validateSourceGuard(existingDescription.source, newSource);
    if (sourceGuardWarning) {
      logger.warn(chalk.yellow(`⚠️  ${sourceGuardWarning}`));
      logger.info('');
      logger.info(chalk.blue('To resolve this:'));
      logger.info(
        `  1. Use matching source: ${chalk.cyan(`--source ${existingDescription.source}`)}`
      );
      logger.info(`  2. Or force overwrite: ${chalk.cyan('--force')}`);
      logger.info('');
      logger.info(chalk.gray('Example:'));
      logger.info(
        chalk.gray(
          `  funcqc describe ${targetFunction.id.substring(0, 8)} --text "..." --source ${existingDescription.source}`
        )
      );
      process.exit(1);
    }
  }
}

/**
 * Create function description object from options
 */
function buildFunctionDescription(
  targetFunction: FunctionInfo,
  descriptionText: string,
  options: DescribeCommandOptions
): FunctionDescription {
  const newSource = options.source || 'human';

  return createFunctionDescription(targetFunction.semanticId, descriptionText, {
    source: newSource,
    validatedForContentId: targetFunction.contentId,
    createdBy: options.by,
    aiModel: options.model,
    confidenceScore: options.confidence ? parseFloat(options.confidence) : undefined,
    usageExample: options.usageExample,
    sideEffects: options.sideEffects,
    errorConditions: options.errorConditions,
  });
}

/**
 * Display save confirmation with description details
 */
function displaySaveConfirmation(
  targetFunction: FunctionInfo,
  description: FunctionDescription,
  text: string | undefined,
  options: DescribeCommandOptions,
  logger: any
): void {
  logger.info(chalk.green(`✓ Description saved for function: ${targetFunction.name}`));
  logger.info(`  Function ID: ${targetFunction.id}`);
  logger.info(`  Semantic ID: ${targetFunction.semanticId}`);

  if (text) {
    logger.info(`  Description: ${text}`);
  }

  const truncateText = (text: string): string =>
    text.length > 80 ? `${text.substring(0, 80)}...` : text;

  if (options.usageExample) {
    logger.info(`  Usage Example: ${truncateText(options.usageExample)}`);
  }
  if (options.sideEffects) {
    logger.info(`  Side Effects: ${truncateText(options.sideEffects)}`);
  }
  if (options.errorConditions) {
    logger.info(`  Error Conditions: ${truncateText(options.errorConditions)}`);
  }

  logger.info(`  Source: ${description.source}`);
}

async function saveDescription(
  env: CommandEnvironment,
  targetFunction: FunctionInfo,
  options: DescribeCommandOptions
): Promise<void> {
  const existingDescription = await env.storage.getFunctionDescription(targetFunction.semanticId);
  const newSource = options.source || 'human';

  handleSourceGuardValidation(
    existingDescription,
    newSource,
    targetFunction,
    env.commandLogger,
    options.force || false
  );

  const descriptionText = options.text || existingDescription?.description || '';
  const description = buildFunctionDescription(targetFunction, descriptionText, options);

  await env.storage.saveFunctionDescription(description);

  displaySaveConfirmation(targetFunction, description, options.text, options, env.commandLogger);
}

async function showExistingDescription(
  env: CommandEnvironment,
  targetFunction: FunctionInfo
): Promise<void> {
  const existingDescription = await env.storage.getFunctionDescription(targetFunction.semanticId);

  if (existingDescription) {
    displayDescription(env.commandLogger, targetFunction, existingDescription);
  } else {
    showNoDescription(env.commandLogger, targetFunction);
  }
}

function displayDescription(
  logger: import('../../utils/cli-utils').Logger,
  func: FunctionInfo,
  description: FunctionDescription
): void {
  logger.info(chalk.blue(`Current description for ${func.name}:`));
  logger.info(`  Description: ${description.description}`);
  logger.info(`  Source: ${description.source}`);
  logger.info(`  Created: ${new Date(description.createdAt).toISOString()}`);

  if (description.createdBy) {
    logger.info(`  Created by: ${description.createdBy}`);
  }
  if (description.aiModel) {
    logger.info(`  AI Model: ${description.aiModel}`);
  }
  if (description.confidenceScore !== undefined) {
    logger.info(`  Confidence: ${description.confidenceScore}`);
  }

  // Display structured fields if present
  if (description.usageExample) {
    logger.info('');
    logger.info(chalk.green('  Usage Example:'));
    const lines = description.usageExample.split('\n');
    lines.forEach(line => logger.info(`    ${line}`));
  }

  if (description.sideEffects) {
    logger.info('');
    logger.info(chalk.yellow('  Side Effects:'));
    const lines = description.sideEffects.split('\n');
    lines.forEach(line => logger.info(`    ${line}`));
  }

  if (description.errorConditions) {
    logger.info('');
    logger.info(chalk.red('  Error Conditions:'));
    const lines = description.errorConditions.split('\n');
    lines.forEach(line => logger.info(`    ${line}`));
  }
}

function showNoDescription(logger: import('../../utils/cli-utils').Logger, func: FunctionInfo): void {
  logger.info(chalk.yellow(`No description found for function: ${func.name}`));
  logger.info(`  Function ID: ${func.id}`);
  logger.info(`  File: ${func.filePath}:${func.startLine}`);
  logger.info(`  Signature: ${func.signature}`);
  logger.info('');
  logger.info('Use --text to add a description:');
  logger.info(`  funcqc describe ${func.id} --text "Your description here"`);
}

function validateSourceGuard(
  existingSource: 'human' | 'ai' | 'jsdoc' | null,
  newSource: 'human' | 'ai' | 'jsdoc'
): string | null {
  // Allow updates if existing source is null/none (anyone can edit)
  if (existingSource === null) {
    return null;
  }

  // Allow updates if source is the same
  if (existingSource === newSource) {
    return null;
  }

  // Warn about cross-source updates
  return `Overwriting ${existingSource} description with ${newSource} description.`;
}

function createFunctionDescription(
  semanticId: string,
  description: string,
  options: {
    source: 'human' | 'ai' | 'jsdoc';
    validatedForContentId?: string | undefined;
    createdBy?: string | undefined;
    aiModel?: string | undefined;
    confidenceScore?: number | undefined;
    usageExample?: string | undefined;
    sideEffects?: string | undefined;
    errorConditions?: string | undefined;
  }
): FunctionDescription {
  const now = Date.now();

  return {
    semanticId,
    description,
    source: options.source,
    createdAt: now,
    updatedAt: now,
    ...(options.validatedForContentId && { validatedForContentId: options.validatedForContentId }),
    ...(options.createdBy && { createdBy: options.createdBy }),
    ...(options.aiModel && { aiModel: options.aiModel }),
    ...(options.confidenceScore !== undefined &&
      !isNaN(options.confidenceScore) && {
        confidenceScore: options.confidenceScore,
      }),
    ...(options.usageExample && { usageExample: options.usageExample }),
    ...(options.sideEffects && { sideEffects: options.sideEffects }),
    ...(options.errorConditions && { errorConditions: options.errorConditions }),
  };
}

function getRiskIcon(func: FunctionInfo): string {
  if (!func.metrics) {
    return ''; // No metrics available
  }

  const {
    cyclomaticComplexity,
    linesOfCode,
    cognitiveComplexity,
    parameterCount,
    maxNestingLevel,
  } = func.metrics;

  // Determine if function is high risk based on common thresholds
  const isHighRisk =
    cyclomaticComplexity > 10 ||
    (cognitiveComplexity ?? 0) > 15 ||
    linesOfCode > 40 ||
    parameterCount > 4 ||
    maxNestingLevel > 3;

  return isHighRisk ? chalk.red('⚠️') : chalk.green('✅');
}

async function handleListFunctions(env: CommandEnvironment, options: DescribeCommandOptions): Promise<void> {
  // Get the latest snapshot ID
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    env.commandLogger.warn('No snapshots found. Please run `funcqc scan` first.');
    return;
  }
  const latestSnapshotId = snapshots[0].id;

  let functions: FunctionInfo[];
  let title: string;

  if (options.listUndocumented) {
    functions = await env.storage.getFunctionsWithoutDescriptions(latestSnapshotId);
    title = 'Functions without descriptions';
    env.commandLogger.debug(`Found ${functions.length} functions without descriptions`);
  } else if (options.needsDescription) {
    functions = await env.storage.getFunctionsNeedingDescriptions(latestSnapshotId);
    title = 'Functions needing description updates';
    env.commandLogger.debug(`Found ${functions.length} functions needing description updates`);
  } else {
    env.commandLogger.warn('No list option specified');
    return;
  }

  if (functions.length === 0) {
    env.commandLogger.info(chalk.green(`✓ No functions found for: ${title.toLowerCase()}`));
    return;
  }

  // Get descriptions for functions that have them
  const functionsWithDescriptions = await Promise.all(
    functions.map(async func => {
      const description = await env.storage.getFunctionDescription(func.semanticId);
      return {
        ...func,
        currentDescription: description?.description || undefined,
      };
    })
  );

  if (options.json) {
    const jsonOutput = {
      title: title.toLowerCase(),
      count: functions.length,
      functions: functionsWithDescriptions.map(func => ({
        id: func.id,
        semanticId: func.semanticId,
        name: func.name,
        displayName: func.displayName,
        filePath: func.filePath,
        startLine: func.startLine,
        description: func.currentDescription || null,
        metrics: func.metrics || null,
      })),
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    console.log(chalk.blue(`${title} (${functions.length} functions):`));
    console.log('');
    displayFunctionTable(functionsWithDescriptions, options);
  }
}

interface FunctionWithDescription extends FunctionInfo {
  currentDescription: string | undefined;
}

function displayFunctionTable(
  functions: FunctionWithDescription[],
  options: DescribeCommandOptions
): void {
  // Table header
  const idHeader = options.showId ? 'ID'.padEnd(16) : 'ID'.padEnd(8);
  const nameHeader = 'Name'.padEnd(31);
  const descHeader = 'Description';

  console.log(`${idHeader} ${nameHeader} ${descHeader}`);
  console.log(`${'-'.repeat(idHeader.length)} ${'-'.repeat(31)} ${'-'.repeat(40)}`);

  // Table rows
  functions.forEach(func => {
    const id = options.showId ? func.id : func.id.substring(0, 8);
    const idCol = id.padEnd(idHeader.length);
    const nameCol =
      func.displayName.length > 31
        ? func.displayName.substring(0, 28) + '...'
        : func.displayName.padEnd(31);

    let descCol = '';
    if (func.currentDescription) {
      descCol =
        func.currentDescription.length > 40
          ? func.currentDescription.substring(0, 37) + '...'
          : func.currentDescription;
    }

    console.log(`${idCol} ${nameCol} ${descCol}`);
  });

  console.log('');
  if (!options.showId) {
    console.log(chalk.blue('💡 Use --show-id to see complete function IDs'));
  }
  console.log(chalk.blue('Usage: funcqc describe <ID> --text "description" to add descriptions'));
}

async function handleGenerateTemplate(
  env: CommandEnvironment,
  functionIdOrPattern: string,
  options: DescribeCommandOptions
): Promise<void> {
  if (!functionIdOrPattern) {
    throw new Error('Function ID or name pattern is required for template generation');
  }

  const targetFunction = await findTargetFunction(env, functionIdOrPattern);

  if (!targetFunction) {
    return;
  }

  // Generate template based on function information
  const template: DescribeBatchInput = {
    semanticId: targetFunction.semanticId,
    description: `[TODO] Describe the purpose and behavior of ${targetFunction.name}`,
    source: 'ai',
    aiModel: 'claude-3-sonnet',
    confidenceScore: 0.0,
    createdBy: 'ai-assistant',
    usageExample: `[TODO] Add usage example for ${targetFunction.name}(${targetFunction.parameters.map(p => p.name).join(', ')})`,
    sideEffects: '[TODO] Document any side effects or state modifications',
    errorConditions: '[TODO] Document error conditions and exception handling',
  };

  // Add function context for AI to understand
  const contextInfo = {
    // Function metadata for AI analysis
    _functionInfo: {
      name: targetFunction.name,
      filePath: targetFunction.filePath,
      startLine: targetFunction.startLine,
      endLine: targetFunction.endLine,
      signature: targetFunction.signature,
      parameters: targetFunction.parameters,
      isAsync: targetFunction.isAsync,
      isExported: targetFunction.isExported,
      functionType: targetFunction.functionType,
      sourceCode: targetFunction.sourceCode,
      metrics: targetFunction.metrics,
    },
    // Template for batch processing
    template: [template],
  };

  if (options.aiMode) {
    // AI-optimized output with context
    console.log(JSON.stringify(contextInfo, null, 2));
    env.commandLogger.info(chalk.blue('💡 AI Mode: Complete context provided for analysis'));
    env.commandLogger.info(chalk.blue('💡 Extract the "template" array for batch processing'));
  } else {
    // Human-friendly template output
    console.log(JSON.stringify([template], null, 2));
    env.commandLogger.info(chalk.blue('💡 Template generated successfully'));
    env.commandLogger.info(chalk.blue('💡 Edit the template and use: funcqc describe --input template.json'));
  }
}