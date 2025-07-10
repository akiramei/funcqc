import chalk from 'chalk';
import { ShowCommandOptions, FunctionInfo, FuncqcConfig, QualityMetrics } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter, DatabaseError } from '../storage/pglite-adapter';
import { calculateFileHash, fileExists } from '../utils/file-utils';
import { ErrorCode, createErrorHandler } from '../utils/error-handler';
import { Logger } from '../utils/cli-utils';

export async function showCommand(
  namePattern: string = '',
  options: ShowCommandOptions
): Promise<void> {
  const logger = new Logger();
  const errorHandler = createErrorHandler(logger);

  try {
    const { storage, config } = await initializeShowCommand();
    const func = await findTargetFunction(storage, options.id, namePattern);

    if (options.json) {
      outputJSON(func);
    } else {
      await outputFriendly(func, config, options);
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
}

async function initializeShowCommand(): Promise<{
  storage: PGLiteStorageAdapter;
  config: FuncqcConfig;
}> {
  const configManager = new ConfigManager();
  const config = await configManager.load();

  const storage = new PGLiteStorageAdapter(config.storage.path!);
  await storage.init();

  return { storage, config };
}

async function findTargetFunction(
  storage: PGLiteStorageAdapter,
  id?: string,
  namePattern?: string
): Promise<FunctionInfo> {
  if (id) {
    return await findFunctionByIdOrThrow(storage, id);
  }

  if (namePattern) {
    return await findFunctionByNameOrThrow(storage, namePattern);
  }

  throw new Error('Either --id or a name pattern must be provided.');
}

async function findFunctionByIdOrThrow(
  storage: PGLiteStorageAdapter,
  id: string
): Promise<FunctionInfo> {
  const func = await findFunctionById(storage, id);
  if (!func) {
    throw new Error(`Function with ID '${id}' not found.`);
  }
  return func;
}

async function findFunctionByNameOrThrow(
  storage: PGLiteStorageAdapter,
  namePattern: string
): Promise<FunctionInfo> {
  const candidates = await findFunctionsByName(storage, namePattern);

  if (candidates.length === 0) {
    throw new Error(`No functions found matching pattern '${namePattern}'.`);
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const selected = await selectFunction(candidates);
  if (!selected) {
    throw new Error('No function selected.');
  }

  return selected;
}

async function findFunctionById(
  storage: PGLiteStorageAdapter,
  id: string
): Promise<FunctionInfo | null> {
  // Get the latest snapshot first
  const snapshots = await storage.getSnapshots({ sort: 'created_at', limit: 1 });
  if (snapshots.length === 0) {
    return null;
  }

  // Try to get function with description first
  const functionsWithDescriptions = await storage.getFunctionsWithDescriptions(snapshots[0].id);
  const func = functionsWithDescriptions.find(f => f.id === id || f.id.startsWith(id));

  if (func) {
    return func;
  }

  // Fallback to regular query if not found in functions with descriptions
  const functions = await storage.queryFunctions();
  return functions.find(f => f.id === id || f.id.startsWith(id)) || null;
}

async function findFunctionsByName(
  storage: PGLiteStorageAdapter,
  namePattern: string
): Promise<FunctionInfo[]> {
  // Get the latest snapshot first
  const snapshots = await storage.getSnapshots({ sort: 'created_at', limit: 1 });
  if (snapshots.length === 0) {
    return [];
  }

  // Try to get functions with descriptions first
  const functionsWithDescriptions = await storage.getFunctionsWithDescriptions(snapshots[0].id);
  const matchingWithDesc = functionsWithDescriptions.filter(
    f => f.name.includes(namePattern) || f.displayName.includes(namePattern)
  );

  if (matchingWithDesc.length > 0) {
    return matchingWithDesc;
  }

  // Fallback to regular query
  const functions = await storage.queryFunctions();
  return functions.filter(f => f.name.includes(namePattern) || f.displayName.includes(namePattern));
}

async function selectFunction(candidates: FunctionInfo[]): Promise<FunctionInfo | null> {
  console.log(chalk.cyan('Multiple functions found:'));
  console.log();

  candidates.forEach((func, index) => {
    const shortId = func.id.substring(0, 8);
    console.log(
      `${chalk.bold((index + 1).toString())}. ${func.displayName}() ${chalk.gray(`[${shortId}]`)}`
    );
    console.log(`   ${chalk.gray(`📍 ${func.filePath}:${func.startLine}`)}`);
    console.log(`   ${chalk.gray(`🔗 ${func.signature}`)}`);
    console.log();
  });

  // For now, just return the first one as a placeholder
  // In a real implementation, we'd use a proper interactive selection library
  console.log(
    chalk.yellow(
      'Auto-selecting the first function. Interactive selection will be implemented in a future version.'
    )
  );
  return candidates[0];
}

function outputJSON(func: FunctionInfo): void {
  // Extract usage examples from description or JSDoc
  const usageExamples = extractUsageExamples(func);

  // Extract side effects information
  const sideEffects = extractSideEffects(func);

  // Extract error conditions
  const errorConditions = extractErrorConditions(func);

  const output = {
    id: func.id,
    name: func.name,
    displayName: func.displayName,
    signature: func.signature,
    file: {
      path: func.filePath,
      startLine: func.startLine,
      endLine: func.endLine,
      startColumn: func.startColumn,
      endColumn: func.endColumn,
    },
    attributes: {
      isExported: func.isExported,
      isAsync: func.isAsync,
      isGenerator: func.isGenerator,
      isArrowFunction: func.isArrowFunction,
      isMethod: func.isMethod,
      isConstructor: func.isConstructor,
      isStatic: func.isStatic,
      accessModifier: func.accessModifier,
      contextPath: func.contextPath,
    },
    parameters: func.parameters,
    returnType: func.returnType,
    metrics: func.metrics,
    hashes: {
      signature: func.signatureHash,
      ast: func.astHash,
      file: func.fileHash,
    },
    documentation: {
      description: func.description,
      jsDoc: func.jsDoc,
      source: func.descriptionSource,
      updatedAt: func.descriptionUpdatedAt,
      aiModel: func.descriptionAiModel,
    },
    structuredData: {
      usageExamples,
      sideEffects,
      errorConditions,
      userFriendlyAttributes: buildUserFriendlyAttributes(func),
    },
    sourceCode: func.sourceCode,
  };

  console.log(JSON.stringify(output, null, 2));
}

// Helper functions for JSON output extraction

function extractUsageExamples(func: FunctionInfo): string[] {
  const examples: string[] = [];

  if (func.description?.toLowerCase().includes('example')) {
    const lines = func.description.split('\n');
    const exampleStart = lines.findIndex(line => line.toLowerCase().includes('example'));
    if (exampleStart >= 0) {
      examples.push(...lines.slice(exampleStart));
    }
  }

  if (func.jsDoc?.toLowerCase().includes('@example')) {
    const jsDocLines = func.jsDoc.split('\n');
    const exampleStart = jsDocLines.findIndex(line => line.toLowerCase().includes('@example'));
    if (exampleStart >= 0) {
      const exampleLines = jsDocLines
        .slice(exampleStart + 1)
        .filter(line => line.trim() && !line.trim().startsWith('@'))
        .map(line => line.replace(/^\s*\*?\s?/, ''));
      examples.push(...exampleLines);
    }
  }

  return examples;
}

function extractSideEffects(func: FunctionInfo): string[] {
  const effects: string[] = [];

  if (func.description) {
    const lines = func.description.split('\n');
    const effectLines = lines.filter(
      line =>
        line.toLowerCase().includes('side effect') ||
        line.toLowerCase().includes('modifies') ||
        line.toLowerCase().includes('mutates') ||
        line.toLowerCase().includes('writes to') ||
        line.toLowerCase().includes('updates')
    );
    effects.push(...effectLines.map(line => line.trim()));
  }

  if (func.isAsync || (func.metrics && func.metrics.asyncAwaitCount > 0)) {
    effects.push('This is an async function - may have asynchronous side effects');
  }

  return effects;
}

function extractErrorConditions(func: FunctionInfo): string[] {
  const conditions: string[] = [];

  if (func.description) {
    const lines = func.description.split('\n');
    const errorLines = lines.filter(
      line =>
        line.toLowerCase().includes('error') ||
        line.toLowerCase().includes('throw') ||
        line.toLowerCase().includes('exception') ||
        line.toLowerCase().includes('fail')
    );
    conditions.push(...errorLines.map(line => line.trim()));
  }

  if (func.jsDoc?.toLowerCase().includes('@throws')) {
    const jsDocLines = func.jsDoc.split('\n');
    const throwsLines = jsDocLines.filter(line => line.toLowerCase().includes('@throws'));
    conditions.push(...throwsLines.map(line => line.replace(/^\s*\*?\s?@throws\s?/, '').trim()));
  }

  if (func.metrics && func.metrics.tryCatchCount > 0) {
    conditions.push('Function includes try/catch error handling');
  }

  return conditions;
}

function buildUserFriendlyAttributes(func: FunctionInfo): string[] {
  const attributes: string[] = [];
  if (func.isExported) attributes.push('Exported');
  if (func.isAsync) attributes.push('Async');
  if (func.isGenerator) attributes.push('Generator');
  if (func.isMethod) attributes.push('Method');
  if (func.isConstructor) attributes.push('Constructor');
  if (func.isStatic) attributes.push('Static');
  if (func.accessModifier) attributes.push(func.accessModifier);
  return attributes;
}

async function outputFriendly(
  func: FunctionInfo,
  config: FuncqcConfig,
  options: ShowCommandOptions
): Promise<void> {
  // Handle audience-specific display modes
  if (options.forUsers) {
    displayForUsers(func, options);
    return;
  }

  if (options.forMaintainers) {
    displayForMaintainers(func, config, options);
    return;
  }

  // Handle specialized sections
  if (options.usage) {
    displayUsageSection(func);
    return;
  }

  if (options.examples) {
    displayExamplesSection(func);
    return;
  }

  if (options.source) {
    await displaySourceSection(func, options);
    return;
  }

  // Default behavior (existing logic)
  displayFunctionHeader(func);
  displayUserDescription(func);

  if (options.details || options.full) {
    displayFunctionParameters(func);
    displayFunctionReturnType(func);
    displayFunctionContext(func);
  }

  if (options.quality || options.full) {
    displayFunctionMetrics(func, config);
  }

  if (options.technical || options.full) {
    displayFunctionTechnicalInfo(func);
  }

  // Always show JSDoc if available and no user description
  if (!func.description && func.jsDoc) {
    displayJSDocSection(func);
  }
}

function displayFunctionHeader(func: FunctionInfo): void {
  console.log(chalk.bold(`Function: ${func.displayName}()`));
  console.log(`ID: ${func.id}`);
  console.log(`Location: ${func.filePath}:${func.startLine}-${func.endLine}`);
  console.log(`Signature: ${func.signature}`);

  const attributes = buildAttributesList(func);
  if (attributes.length > 0) {
    console.log(`Attributes: ${attributes.join(', ')}`);
  }
  console.log();
}

function displayUserDescription(func: FunctionInfo): void {
  if (!func.description) return;

  console.log(chalk.bold('Description:'));
  console.log(`  ${func.description.replace(/\n/g, '\n  ')}`);

  // Show source attribution using the proper property names
  const source = func.descriptionSource || 'unknown';
  const timestamp = func.descriptionUpdatedAt
    ? new Date(func.descriptionUpdatedAt).toISOString().split('T')[0]
    : 'unknown';

  if (source === 'ai' && func.descriptionAiModel) {
    console.log(`  [Source: ${source} (${func.descriptionAiModel}) | Updated: ${timestamp}]`);
  } else {
    console.log(`  [Source: ${source} | Updated: ${timestamp}]`);
  }
  console.log();
}

function displayJSDocSection(func: FunctionInfo): void {
  if (!func.jsDoc) return;

  console.log(chalk.bold('JSDoc:'));
  console.log(`  ${func.jsDoc.replace(/\n/g, '\n  ')}`);
  console.log();
}

function buildAttributesList(func: FunctionInfo): string[] {
  const attributes: string[] = [];
  if (func.isExported) attributes.push('exported');
  if (func.isAsync) attributes.push('async');
  if (func.isGenerator) attributes.push('generator');
  if (func.isArrowFunction) attributes.push('arrow');
  if (func.isMethod) attributes.push('method');
  if (func.isConstructor) attributes.push('constructor');
  if (func.isStatic) attributes.push('static');
  if (func.accessModifier) attributes.push(func.accessModifier);
  return attributes;
}

function displayFunctionParameters(func: FunctionInfo): void {
  if (func.parameters.length === 0) return;

  console.log(chalk.bold(`Parameters (${func.parameters.length}):`));
  func.parameters.forEach((param, index) => {
    const optional = param.isOptional ? '?' : '';
    const rest = param.isRest ? '...' : '';
    const defaultVal = param.defaultValue ? ` = ${param.defaultValue}` : '';
    console.log(`  ${index + 1}. ${rest}${param.name}${optional}: ${param.type}${defaultVal}`);
    if (param.description) {
      console.log(`     ${chalk.gray(param.description)}`);
    }
  });
  console.log();
}

function displayFunctionReturnType(func: FunctionInfo): void {
  if (!func.returnType) return;

  console.log(chalk.bold('Return Type:'));
  console.log(`  ${func.returnType.type}`);
  if (func.returnType.isPromise) {
    console.log(`  ${chalk.blue('Promise')}<${func.returnType.promiseType || 'unknown'}>`);
  }
  if (func.returnType.description) {
    console.log(`  ${chalk.gray(func.returnType.description)}`);
  }
  console.log();
}

function displayFunctionMetrics(func: FunctionInfo, config: FuncqcConfig): void {
  if (!func.metrics) return;

  console.log(chalk.bold('Quality Metrics:'));
  displaySizeMetrics(func.metrics, config);
  displayComplexityMetrics(func.metrics, config);
  displayStructureMetrics(func.metrics);
  displayDocumentationMetrics(func.metrics);
  displayAdvancedMetrics(func.metrics);
  console.log();
}

function displaySizeMetrics(metrics: QualityMetrics, config: FuncqcConfig): void {
  console.log(`  ${chalk.bold('Size:')}`);
  console.log(`    Lines of Code: ${formatMetricValue(metrics.linesOfCode, 'lines', config)}`);
  console.log(`    Total Lines: ${metrics.totalLines}`);
  console.log(`    Parameters: ${formatMetricValue(metrics.parameterCount, 'params', config)}`);
}

function displayComplexityMetrics(metrics: QualityMetrics, config: FuncqcConfig): void {
  console.log(`  ${chalk.bold('Complexity:')}`);
  console.log(
    `    Cyclomatic: ${formatMetricValue(metrics.cyclomaticComplexity, 'complexity', config)}`
  );
  console.log(
    `    Cognitive: ${formatMetricValue(metrics.cognitiveComplexity, 'cognitive', config)}`
  );
  console.log(`    Max Nesting: ${formatMetricValue(metrics.maxNestingLevel, 'nesting', config)}`);
}

function displayStructureMetrics(metrics: QualityMetrics): void {
  console.log(`  ${chalk.bold('Structure:')}`);
  console.log(`    Branches: ${metrics.branchCount}`);
  console.log(`    Loops: ${metrics.loopCount}`);
  console.log(`    Try/Catch: ${metrics.tryCatchCount}`);
  console.log(`    Return Statements: ${metrics.returnStatementCount}`);

  if (metrics.asyncAwaitCount > 0) {
    console.log(`    Async/Await: ${metrics.asyncAwaitCount}`);
  }
  if (metrics.callbackCount > 0) {
    console.log(`    Callbacks: ${metrics.callbackCount}`);
  }
}

function displayDocumentationMetrics(metrics: QualityMetrics): void {
  console.log(`  ${chalk.bold('Documentation:')}`);
  console.log(`    Comment Lines: ${metrics.commentLines}`);
  console.log(`    Code-to-Comment Ratio: ${metrics.codeToCommentRatio.toFixed(2)}`);
}

function displayAdvancedMetrics(metrics: QualityMetrics): void {
  if (!metrics.maintainabilityIndex) return;

  console.log(`  ${chalk.bold('Advanced:')}`);
  console.log(`    Maintainability Index: ${metrics.maintainabilityIndex.toFixed(1)}`);
  if (metrics.halsteadVolume) {
    console.log(`    Halstead Volume: ${metrics.halsteadVolume.toFixed(1)}`);
  }
  if (metrics.halsteadDifficulty) {
    console.log(`    Halstead Difficulty: ${metrics.halsteadDifficulty.toFixed(1)}`);
  }
}

function displayFunctionContext(func: FunctionInfo): void {
  if (!func.contextPath || func.contextPath.length === 0) return;

  console.log(chalk.bold('Context:'));
  console.log(`  Path: ${func.contextPath.join(' → ')}`);
  if (func.functionType) {
    console.log(`  Type: ${func.functionType}`);
  }
  console.log();
}

function displayFunctionTechnicalInfo(func: FunctionInfo): void {
  console.log(chalk.bold('Technical Information:'));
  console.log(`  Full ID: ${func.id}`);
  console.log(`  Signature Hash: ${func.signatureHash.substring(0, 8)}...`);
  console.log(`  AST Hash: ${func.astHash}`);
  console.log(`  File Hash: ${func.fileHash.substring(0, 8)}...`);
  console.log();
}

function formatMetricValue(value: number, type: string, config: FuncqcConfig): string {
  let threshold = 0;

  switch (type) {
    case 'lines':
      threshold = config.metrics.linesOfCodeThreshold;
      break;
    case 'complexity':
      threshold = config.metrics.complexityThreshold;
      break;
    case 'cognitive':
      threshold = config.metrics.cognitiveComplexityThreshold;
      break;
    case 'params':
      threshold = config.metrics.parameterCountThreshold;
      break;
    case 'nesting':
      threshold = config.metrics.maxNestingLevelThreshold;
      break;
    default:
      return value.toString();
  }

  if (value > threshold) {
    return chalk.red(`${value} (>${threshold})`);
  } else if (value > threshold * 0.8) {
    return chalk.yellow(value.toString());
  } else {
    return chalk.green(value.toString());
  }
}

// New display functions for audience-specific modes

function displayForUsers(func: FunctionInfo, _options: ShowCommandOptions): void {
  // User-focused header (simplified)
  console.log(chalk.bold(`${func.displayName}()`));
  console.log(`📍 ${func.filePath}:${func.startLine}`);
  console.log();

  // Always show description for users
  displayUserDescription(func);

  // Show JSDoc if no user description
  if (!func.description && func.jsDoc) {
    displayJSDocSection(func);
  }

  // Always show parameters for users
  displayFunctionParameters(func);
  displayFunctionReturnType(func);

  // Show usage examples if available
  displayUsageExamples(func);

  // Show side effects if available
  displaySideEffects(func);

  // Show error conditions if available
  displayErrorConditions(func);

  // Show function attributes in user-friendly way
  displayUserFriendlyAttributes(func);
}

function displayForMaintainers(
  func: FunctionInfo,
  config: FuncqcConfig,
  options: ShowCommandOptions
): void {
  // Maintainer header with technical details
  console.log(chalk.bold(`Function: ${func.displayName}()`));
  console.log(`ID: ${func.id}`);
  console.log(`Location: ${func.filePath}:${func.startLine}-${func.endLine}`);
  console.log();

  // Quality metrics and warnings (primary focus)
  displayFunctionMetrics(func, config);
  displayQualityWarnings(func, config);

  // Technical information
  displayFunctionTechnicalInfo(func);

  // Historical/change tracking (if available)
  displayChangeTracking(func);

  // Basic info only if requested
  if (options.details) {
    displayFunctionParameters(func);
    displayFunctionReturnType(func);
    displayFunctionContext(func);
  }
}

function displayUsageSection(func: FunctionInfo): void {
  console.log(chalk.bold(`Usage Information for ${func.displayName}()`));
  console.log();

  displayUserDescription(func);
  displayFunctionParameters(func);
  displayFunctionReturnType(func);
  displayUsageExamples(func);
  displayUserFriendlyAttributes(func);
}

function displayExamplesSection(func: FunctionInfo): void {
  console.log(chalk.bold(`Examples for ${func.displayName}()`));
  console.log();

  displayUsageExamples(func);
  displayFunctionParameters(func);
  displaySideEffects(func);
  displayErrorConditions(func);
}

async function displaySourceSection(
  func: FunctionInfo,
  options: ShowCommandOptions
): Promise<void> {
  console.log(chalk.bold(`Source Code: ${func.displayName}()`));
  console.log(`📍 ${func.filePath}:${func.startLine}-${func.endLine}`);
  console.log();

  // Check if file exists and hash matches
  const canShowSource = await validateSourceIntegrity(func);

  if (canShowSource && func.sourceCode) {
    if (options.syntax) {
      // For syntax highlighting, we'll use a simple approach with chalk
      displaySyntaxHighlightedCode(func.sourceCode);
    } else {
      console.log(chalk.gray('--- Source Code ---'));
      console.log(func.sourceCode);
      console.log(chalk.gray('--- End Source ---'));
    }
  } else if (!canShowSource) {
    console.log(chalk.yellow('⚠️  File has been modified since last scan'));
    console.log('   Run a new scan to update the snapshot and view current source code.');
  } else {
    console.log(chalk.yellow('⚠️  Source code not available'));
    console.log('   Run a new scan to capture source code information.');
  }

  console.log();

  // Show basic function info
  console.log(chalk.yellow('Function Information:'));
  console.log(`  Type: ${func.functionType}`);
  console.log(`  Exported: ${func.isExported ? 'Yes' : 'No'}`);
  console.log(`  Async: ${func.isAsync ? 'Yes' : 'No'}`);
  console.log(`  Parameters: ${func.parameters.length}`);

  if (func.metrics) {
    console.log();
    console.log(chalk.yellow('Quick Metrics:'));
    console.log(`  Lines of Code: ${func.metrics.linesOfCode}`);
    console.log(`  Complexity: ${func.metrics.cyclomaticComplexity}`);
    console.log(`  Maintainability: ${func.metrics.maintainabilityIndex?.toFixed(1) || 'N/A'}`);
  }
}

function displaySyntaxHighlightedCode(sourceCode: string): void {
  console.log(chalk.gray('--- Source Code (with basic highlighting) ---'));

  const lines = sourceCode.split('\n');
  lines.forEach((line, index) => {
    const lineNumber = (index + 1).toString().padStart(3, ' ');
    const highlightedLine = applySyntaxHighlighting(line);
    console.log(`${chalk.gray(lineNumber)}  ${highlightedLine}`);
  });

  console.log(chalk.gray('--- End Source ---'));
}

function applySyntaxHighlighting(line: string): string {
  // Simple syntax highlighting with chalk
  let highlighted = line;

  // Keywords
  highlighted = highlighted.replace(
    /\b(function|const|let|var|if|else|for|while|return|async|await|import|export|interface|type|class)\b/g,
    chalk.blue('$1')
  );

  // Strings
  highlighted = highlighted.replace(/(["'`][^"'`]*["'`])/g, chalk.green('$1'));

  // Comments
  highlighted = highlighted.replace(/(\/\/.*$|\/\*.*?\*\/)/g, chalk.gray('$1'));

  // Functions calls (simple pattern)
  highlighted = highlighted.replace(/\b(\w+)\s*\(/g, chalk.yellow('$1') + '(');

  return highlighted;
}

// Helper functions for new sections

async function validateSourceIntegrity(func: FunctionInfo): Promise<boolean> {
  try {
    // Check if file exists
    const exists = await fileExists(func.filePath);
    if (!exists) {
      return false;
    }

    // Explicitly check if fileHash is null or undefined (no hash set)
    if (func.fileHash === null || func.fileHash === undefined) {
      // No hash available for comparison, cannot validate integrity
      return false;
    }

    // Calculate current file hash
    const currentHash = await calculateFileHash(func.filePath);

    // Compare with stored hash
    return currentHash === func.fileHash;
  } catch (error) {
    // Log debug information for troubleshooting
    console.debug(
      `Failed to validate source integrity for ${func.filePath}:`,
      error instanceof Error ? error.message : String(error)
    );
    // If we can't calculate hash, assume file is modified
    return false;
  }
}

function displayUsageExamples(func: FunctionInfo): void {
  if (func.description?.toLowerCase().includes('example')) {
    // Extract examples from description
    const lines = func.description.split('\n');
    const exampleStart = lines.findIndex(line => line.toLowerCase().includes('example'));
    if (exampleStart >= 0) {
      console.log(chalk.bold('Usage Examples:'));
      lines.slice(exampleStart).forEach(line => {
        console.log(`  ${line}`);
      });
      console.log();
    }
  } else if (func.jsDoc?.toLowerCase().includes('@example')) {
    // Extract examples from JSDoc
    const jsDocLines = func.jsDoc.split('\n');
    const exampleStart = jsDocLines.findIndex(line => line.toLowerCase().includes('@example'));
    if (exampleStart >= 0) {
      console.log(chalk.bold('Usage Examples:'));
      jsDocLines.slice(exampleStart + 1).forEach(line => {
        if (line.trim() && !line.trim().startsWith('@')) {
          console.log(`  ${line.replace(/^\s*\*?\s?/, '')}`);
        }
      });
      console.log();
    }
  }
}

/**
 * Common patterns for detecting side effects in descriptions
 */
const SIDE_EFFECT_KEYWORDS = ['side effect', 'modifies', 'mutates', 'writes to', 'updates'];

/**
 * Filter lines from description that contain specific keywords
 */
function filterDescriptionLines(description: string, keywords: string[]): string[] {
  const lines = description.split('\n');
  return lines.filter(line => keywords.some(keyword => line.toLowerCase().includes(keyword)));
}

/**
 * Display sections based on description content
 */
function displayDescriptionSection(
  func: FunctionInfo,
  title: string,
  keywords: string[],
  fallbackCheck?: () => boolean,
  fallbackMessage?: string
): boolean {
  let hasContent = false;

  if (
    func.description &&
    keywords.some(keyword => func.description!.toLowerCase().includes(keyword))
  ) {
    console.log(chalk.bold(`${title}:`));
    const matchingLines = filterDescriptionLines(func.description, keywords);

    if (matchingLines.length > 0) {
      matchingLines.forEach(line => {
        console.log(`  ${line.trim()}`);
      });
      hasContent = true;
    }
  }

  if (!hasContent && fallbackCheck && fallbackCheck()) {
    console.log(chalk.bold(`${title}:`));
    if (fallbackMessage) {
      console.log(`  ${fallbackMessage}`);
    }
    hasContent = true;
  }

  if (hasContent) {
    console.log();
  }

  return hasContent;
}

function displaySideEffects(func: FunctionInfo): void {
  displayDescriptionSection(
    func,
    'Side Effects',
    SIDE_EFFECT_KEYWORDS,
    () => func.isAsync || (func.metrics?.asyncAwaitCount ?? 0) > 0,
    chalk.yellow('⚠️  This is an async function - may have asynchronous side effects')
  );
}

/**
 * Common patterns for detecting error conditions in descriptions
 */
const ERROR_KEYWORDS = ['error', 'throw', 'exception', 'fail'];

/**
 * Extract JSDoc @throws information
 */
function extractJsDocThrows(jsDoc: string): string[] {
  const jsDocLines = jsDoc.split('\n');
  const throwsLines = jsDocLines.filter(line => line.toLowerCase().includes('@throws'));
  return throwsLines.map(line => line.replace(/^\s*\*?\s?@throws\s?/, '').trim());
}

function displayErrorConditions(func: FunctionInfo): void {
  let hasErrorInfo = false;

  // Check description for error keywords
  hasErrorInfo = displayDescriptionSection(func, 'Error Conditions', ERROR_KEYWORDS);

  // Check for try/catch error handling
  if (!hasErrorInfo && func.metrics?.tryCatchCount && func.metrics.tryCatchCount > 0) {
    console.log(chalk.bold('Error Handling:'));
    console.log(`  ${chalk.blue('✓ Function includes try/catch error handling')}`);
    hasErrorInfo = true;
  }

  // Check JSDoc for @throws
  if (!hasErrorInfo && func.jsDoc?.toLowerCase().includes('@throws')) {
    console.log(chalk.bold('Error Conditions:'));
    const throwsInfo = extractJsDocThrows(func.jsDoc);
    throwsInfo.forEach(info => {
      console.log(`  ${info}`);
    });
    hasErrorInfo = true;
  }

  if (hasErrorInfo) {
    console.log();
  }
}

function displayUserFriendlyAttributes(func: FunctionInfo): void {
  const attributes = [];
  if (func.isExported) attributes.push('📤 Exported');
  if (func.isAsync) attributes.push('⏱️  Async');
  if (func.isGenerator) attributes.push('🔄 Generator');
  if (func.isMethod) attributes.push('🔧 Method');

  if (attributes.length > 0) {
    console.log(chalk.bold('Function Type:'));
    console.log(`  ${attributes.join(', ')}`);
    console.log();
  }
}

function displayQualityWarnings(func: FunctionInfo, config: FuncqcConfig): void {
  if (!func.metrics) return;

  const warnings = [];

  if (func.metrics.cyclomaticComplexity > config.metrics.complexityThreshold) {
    warnings.push(
      `🚨 High complexity (${func.metrics.cyclomaticComplexity} > ${config.metrics.complexityThreshold})`
    );
  }

  if (func.metrics.linesOfCode > config.metrics.linesOfCodeThreshold) {
    warnings.push(
      `🚨 Large function (${func.metrics.linesOfCode} lines > ${config.metrics.linesOfCodeThreshold})`
    );
  }

  if (func.metrics.parameterCount > config.metrics.parameterCountThreshold) {
    warnings.push(
      `🚨 Too many parameters (${func.metrics.parameterCount} > ${config.metrics.parameterCountThreshold})`
    );
  }

  if (func.metrics.maxNestingLevel > config.metrics.maxNestingLevelThreshold) {
    warnings.push(
      `🚨 Deep nesting (${func.metrics.maxNestingLevel} > ${config.metrics.maxNestingLevelThreshold})`
    );
  }

  if (warnings.length > 0) {
    console.log(chalk.bold('Quality Warnings:'));
    warnings.forEach(warning => {
      console.log(`  ${chalk.red(warning)}`);
    });
    console.log();
  } else {
    console.log(chalk.bold('Quality Status:'));
    console.log(`  ${chalk.green('✅ All quality thresholds met')}`);
    console.log();
  }
}

function displayChangeTracking(func: FunctionInfo): void {
  // Placeholder for future change tracking functionality
  // This would show historical data, recent changes, etc.
  console.log(chalk.bold('Change Tracking:'));
  console.log(`  Last analyzed: ${new Date().toISOString().split('T')[0]}`);
  console.log(`  Content ID: ${func.contentId || 'unknown'}`);
  console.log();
}
