import chalk from 'chalk';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from '../core/config';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { DescribeCommandOptions, FunctionDescription, FunctionInfo } from '../types';
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

interface DescribeContext {
  storage: PGLiteStorageAdapter;
  logger: Logger;
  options: DescribeCommandOptions;
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

    const context: DescribeContext = { storage, logger, options };

    try {
      if (options.input) {
        await handleBatchDescribe(context);
      } else if (options.listUndocumented || options.needsDescription) {
        await handleListFunctions(context);
      } else {
        await handleSingleDescribe(context, functionIdOrPattern);
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

async function handleBatchDescribe(context: DescribeContext): Promise<void> {
  const { storage, logger, options } = context;
  
  const descriptions = await loadBatchDescriptions(options.input!);
  
  logger.info(`Processing ${descriptions.length} function descriptions...`);

  for (const desc of descriptions) {
    await processBatchDescription(storage, desc, options, logger);
  }

  logger.info(chalk.green(`Successfully processed ${descriptions.length} function descriptions`));
}

async function loadBatchDescriptions(inputPath: string): Promise<DescribeBatchInput[]> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  let inputData: unknown;
  try {
    inputData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to parse JSON from input file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  if (!Array.isArray(inputData)) {
    throw new Error('Input file must contain an array of descriptions');
  }

  return inputData as DescribeBatchInput[];
}

async function processBatchDescription(
  storage: PGLiteStorageAdapter,
  desc: DescribeBatchInput,
  options: DescribeCommandOptions,
  logger: Logger
): Promise<void> {
  if (!desc.semanticId || !desc.description) {
    logger.warn(`Skipping invalid description entry: ${JSON.stringify(desc)}`);
    return;
  }

  const validatedForContentId = await findContentIdBySemanticId(storage, desc.semanticId, logger);

  // Check for existing description and validate source guard for batch operations
  const existingDescription = await storage.getFunctionDescription(desc.semanticId);
  const newSource = desc.source || options.source || 'human';
  
  if (existingDescription && !options.force) {
    const sourceGuardWarning = validateSourceGuard(existingDescription.source, newSource);
    if (sourceGuardWarning) {
      logger.warn(`⚠️  Skipping ${desc.semanticId}: ${sourceGuardWarning} (use --force to override)`);
      return;
    }
  }

  const description = createFunctionDescription(
    desc.semanticId,
    desc.description,
    {
      source: newSource,
      validatedForContentId,
      createdBy: desc.createdBy || options.by,
      aiModel: desc.aiModel || options.model,
      confidenceScore: desc.confidenceScore ?? (options.confidence ? parseFloat(options.confidence) : undefined),
      usageExample: desc.usageExample || options.usageExample,
      sideEffects: desc.sideEffects || options.sideEffects,
      errorConditions: desc.errorConditions || options.errorConditions
    }
  );

  await storage.saveFunctionDescription(description);
  logger.info(`✓ Saved description for semantic ID: ${desc.semanticId}`);
}

async function findContentIdBySemanticId(
  storage: PGLiteStorageAdapter,
  semanticId: string,
  logger: Logger
): Promise<string | undefined> {
  try {
    const functions = await storage.queryFunctions({
      filters: [
        {
          field: 'semantic_id',
          operator: '=',
          value: semanticId
        }
      ],
      limit: 1
    });
    
    return functions.length > 0 ? functions[0].contentId : undefined;
  } catch (error) {
    logger.warn(`Could not find function with semantic ID ${semanticId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return undefined;
  }
}

async function handleSingleDescribe(
  context: DescribeContext,
  functionIdOrPattern: string
): Promise<void> {
  const { storage, logger, options } = context;
  
  const targetFunction = await findTargetFunction(storage, functionIdOrPattern, logger);
  
  if (!targetFunction) {
    return;
  }

  if (options.text || options.usageExample || options.sideEffects || options.errorConditions) {
    await saveDescription(context, targetFunction, options.text);
  } else {
    await showExistingDescription(context, targetFunction);
  }
}

async function findTargetFunction(
  storage: PGLiteStorageAdapter,
  functionIdOrPattern: string,
  logger: Logger
): Promise<FunctionInfo | null> {
  // Try exact ID match first
  let functions = await findFunctionById(storage, functionIdOrPattern);
  
  // Try partial ID match
  if (functions.length === 0) {
    functions = await findFunctionByPartialId(storage, functionIdOrPattern);
  }
  
  // Try name pattern match
  if (functions.length === 0) {
    const result = await findFunctionByName(storage, functionIdOrPattern, logger);
    if (!result) return null;
    
    if (typeof result === 'string') {
      // Single match, use its ID
      functions = await findFunctionById(storage, result);
    } else {
      // Multiple matches were displayed
      return null;
    }
  }
  
  if (functions.length === 0) {
    showFunctionNotFound(logger, functionIdOrPattern);
    return null;
  }
  
  return functions[0];
}

async function findFunctionById(
  storage: PGLiteStorageAdapter,
  functionId: string
): Promise<FunctionInfo[]> {
  return await storage.queryFunctions({
    filters: [
      {
        field: 'id',
        operator: '=',
        value: functionId
      }
    ]
  });
}

async function findFunctionByPartialId(
  storage: PGLiteStorageAdapter,
  partialId: string
): Promise<FunctionInfo[]> {
  return await storage.queryFunctions({
    filters: [
      {
        field: 'id',
        operator: 'LIKE',
        value: `${partialId}%`
      }
    ]
  });
}

async function findFunctionByName(
  storage: PGLiteStorageAdapter,
  namePattern: string,
  logger: Logger
): Promise<string | boolean | null> {
  const functions = await storage.queryFunctions({
    filters: [
      {
        field: 'name',
        operator: 'LIKE',
        value: `%${namePattern}%`
      }
    ]
  });

  if (functions.length === 0) {
    showFunctionNotFound(logger, namePattern);
    return null;
  }

  if (functions.length > 1) {
    showMultipleMatches(logger, functions, namePattern);
    return false;
  }

  return functions[0].id;
}

function showFunctionNotFound(logger: Logger, pattern: string): void {
  logger.info(chalk.red(`❌ Function not found: ${pattern}`));
  logger.info(chalk.blue('💡 Tips:'));
  logger.info('  • Use `funcqc list` to see all available functions with their IDs');
  logger.info('  • Use `funcqc search <keyword>` to find functions by content');
  logger.info('  • Function IDs are shown in the first column of list/search results');
}

function showMultipleMatches(logger: Logger, functions: FunctionInfo[], pattern: string): void {
  logger.info(chalk.yellow(`Multiple functions found matching "${pattern}". Please specify a function ID:`));
  logger.info('');
  
  functions.forEach((func, index) => {
    const riskIcon = getRiskIcon(func);
    logger.info(`  ${index + 1}. ${chalk.cyan(func.id.substring(0, 8))} - ${riskIcon} ${func.displayName}`);
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

async function saveDescription(
  context: DescribeContext,
  targetFunction: FunctionInfo,
  text: string | undefined
): Promise<void> {
  const { storage, logger, options } = context;
  
  // Check for existing description and validate source guard
  const existingDescription = await storage.getFunctionDescription(targetFunction.semanticId);
  const newSource = options.source || 'human';
  
  if (existingDescription && !options.force) {
    const sourceGuardWarning = validateSourceGuard(existingDescription.source, newSource);
    if (sourceGuardWarning) {
      logger.warn(chalk.yellow(`⚠️  ${sourceGuardWarning}`));
      logger.info(chalk.blue('💡 Use --force to bypass source guard protection'));
      process.exit(1);
    }
  }
  
  // If we're updating structured fields but not the main description, keep the existing description
  const descriptionText = text || existingDescription?.description || '';
  
  const description = createFunctionDescription(
    targetFunction.semanticId,
    descriptionText,
    {
      source: newSource,
      validatedForContentId: targetFunction.contentId,
      createdBy: options.by,
      aiModel: options.model,
      confidenceScore: options.confidence ? parseFloat(options.confidence) : undefined,
      usageExample: options.usageExample,
      sideEffects: options.sideEffects,
      errorConditions: options.errorConditions
    }
  );

  await storage.saveFunctionDescription(description);
  
  logger.info(chalk.green(`✓ Description saved for function: ${targetFunction.name}`));
  logger.info(`  Function ID: ${targetFunction.id}`);
  logger.info(`  Semantic ID: ${targetFunction.semanticId}`);
  if (text) {
    logger.info(`  Description: ${text}`);
  }
  if (options.usageExample) {
    logger.info(`  Usage Example: ${options.usageExample.substring(0, 80)}${options.usageExample.length > 80 ? '...' : ''}`);
  }
  if (options.sideEffects) {
    logger.info(`  Side Effects: ${options.sideEffects.substring(0, 80)}${options.sideEffects.length > 80 ? '...' : ''}`);
  }
  if (options.errorConditions) {
    logger.info(`  Error Conditions: ${options.errorConditions.substring(0, 80)}${options.errorConditions.length > 80 ? '...' : ''}`);
  }
  logger.info(`  Source: ${description.source}`);
}

async function showExistingDescription(
  context: DescribeContext,
  targetFunction: FunctionInfo
): Promise<void> {
  const { storage, logger } = context;
  
  const existingDescription = await storage.getFunctionDescription(targetFunction.semanticId);
  
  if (existingDescription) {
    displayDescription(logger, targetFunction, existingDescription);
  } else {
    showNoDescription(logger, targetFunction);
  }
}

function displayDescription(
  logger: Logger,
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

function showNoDescription(logger: Logger, func: FunctionInfo): void {
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
    ...(options.confidenceScore !== undefined && !isNaN(options.confidenceScore) && { 
      confidenceScore: options.confidenceScore 
    }),
    ...(options.usageExample && { usageExample: options.usageExample }),
    ...(options.sideEffects && { sideEffects: options.sideEffects }),
    ...(options.errorConditions && { errorConditions: options.errorConditions })
  };
}

function getRiskIcon(func: FunctionInfo): string {
  if (!func.metrics) {
    return ''; // No metrics available
  }
  
  const { cyclomaticComplexity, linesOfCode, cognitiveComplexity, parameterCount, maxNestingLevel } = func.metrics;
  
  // Determine if function is high risk based on common thresholds
  const isHighRisk = (
    cyclomaticComplexity > 10 ||
    (cognitiveComplexity ?? 0) > 15 ||
    linesOfCode > 40 ||
    parameterCount > 4 ||
    maxNestingLevel > 3
  );
  
  return isHighRisk ? chalk.red('⚠️') : chalk.green('✅');
}

async function handleListFunctions(context: DescribeContext): Promise<void> {
  const { storage, logger, options } = context;
  
  // Get the latest snapshot ID
  const snapshots = await storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    logger.warn('No snapshots found. Please run `funcqc scan` first.');
    return;
  }
  const latestSnapshotId = snapshots[0].id;
  
  let functions: FunctionInfo[];
  let title: string;
  
  if (options.listUndocumented) {
    functions = await storage.getFunctionsWithoutDescriptions(latestSnapshotId);
    title = 'Functions without descriptions';
    logger.debug(`Found ${functions.length} functions without descriptions`);
  } else if (options.needsDescription) {
    functions = await storage.getFunctionsNeedingDescriptions(latestSnapshotId);
    title = 'Functions needing description updates';
    logger.debug(`Found ${functions.length} functions needing description updates`);
  } else {
    logger.warn('No list option specified');
    return;
  }
  
  if (functions.length === 0) {
    logger.info(chalk.green(`✓ No functions found for: ${title.toLowerCase()}`));
    return;
  }
  
  // Get descriptions for functions that have them
  const functionsWithDescriptions = await Promise.all(
    functions.map(async (func) => {
      const description = await storage.getFunctionDescription(func.semanticId);
      return {
        ...func,
        currentDescription: description?.description || undefined
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
        metrics: func.metrics || null
      }))
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
    const nameCol = func.displayName.length > 31 
      ? func.displayName.substring(0, 28) + '...' 
      : func.displayName.padEnd(31);
    
    let descCol = '';
    if (func.currentDescription) {
      descCol = func.currentDescription.length > 40
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