import chalk from 'chalk';
import { ShowCommandOptions, FunctionInfo, FuncqcConfig, QualityMetrics } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';

export async function showCommand(
  namePattern: string = '',
  options: ShowCommandOptions
): Promise<void> {
  try {
    const { storage, config } = await initializeShowCommand();
    const func = await findTargetFunction(storage, options.id, namePattern);
    
    if (options.json) {
      outputJSON(func);
    } else {
      outputFriendly(func, config);
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to show function:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function initializeShowCommand(): Promise<{ storage: PGLiteStorageAdapter; config: FuncqcConfig }> {
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

async function findFunctionByIdOrThrow(storage: PGLiteStorageAdapter, id: string): Promise<FunctionInfo> {
  const func = await findFunctionById(storage, id);
  if (!func) {
    throw new Error(`Function with ID '${id}' not found.`);
  }
  return func;
}

async function findFunctionByNameOrThrow(storage: PGLiteStorageAdapter, namePattern: string): Promise<FunctionInfo> {
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

async function findFunctionById(storage: PGLiteStorageAdapter, id: string): Promise<FunctionInfo | null> {
  const functions = await storage.queryFunctions();
  return functions.find(f => f.id === id || f.id.startsWith(id)) || null;
}

async function findFunctionsByName(storage: PGLiteStorageAdapter, namePattern: string): Promise<FunctionInfo[]> {
  const functions = await storage.queryFunctions();
  return functions.filter(f => 
    f.name.includes(namePattern) || 
    f.displayName.includes(namePattern)
  );
}

async function selectFunction(candidates: FunctionInfo[]): Promise<FunctionInfo | null> {
  console.log(chalk.cyan('Multiple functions found:'));
  console.log();
  
  candidates.forEach((func, index) => {
    const shortId = func.id.substring(0, 8);
    console.log(`${chalk.bold((index + 1).toString())}. ${func.displayName}() ${chalk.gray(`[${shortId}]`)}`);
    console.log(`   ${chalk.gray(`📍 ${func.filePath}:${func.startLine}`)}`);
    console.log(`   ${chalk.gray(`🔗 ${func.signature}`)}`);
    console.log();
  });
  
  // For now, just return the first one as a placeholder
  // In a real implementation, we'd use a proper interactive selection library
  console.log(chalk.yellow('Auto-selecting the first function. Interactive selection will be implemented in a future version.'));
  return candidates[0];
}

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
      startColumn: func.startColumn,
      endColumn: func.endColumn
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
      contextPath: func.contextPath
    },
    parameters: func.parameters,
    returnType: func.returnType,
    metrics: func.metrics,
    hashes: {
      signature: func.signatureHash,
      ast: func.astHash,
      file: func.fileHash
    },
    documentation: func.jsDoc,
    sourceCode: func.sourceCode
  };
  
  console.log(JSON.stringify(output, null, 2));
}

function outputFriendly(func: FunctionInfo, config: FuncqcConfig): void {
  displayFunctionHeader(func);
  displayFunctionSignature(func);
  displayFunctionAttributes(func);
  displayFunctionParameters(func);
  displayFunctionReturnType(func);
  displayFunctionMetrics(func, config);
  displayFunctionContext(func);
  displayFunctionDocumentation(func);
  displayFunctionTechnicalInfo(func);
}

function displayFunctionHeader(func: FunctionInfo): void {
  const shortId = func.id.substring(0, 8);
  
  console.log(chalk.bold.cyan(`📋 Function Details`));
  console.log();
  console.log(chalk.bold(`🔗 ${func.displayName}()`));
  console.log(`   ${chalk.gray(`ID: ${shortId}`)}`);
  console.log(`   ${chalk.gray(`📍 ${func.filePath}:${func.startLine}-${func.endLine}`)}`);
  console.log();
}

function displayFunctionSignature(func: FunctionInfo): void {
  console.log(chalk.bold(`📝 Signature:`));
  console.log(`   ${func.signature}`);
  console.log();
}

function displayFunctionAttributes(func: FunctionInfo): void {
  console.log(chalk.bold(`🏷️  Attributes:`));
  const attributes = buildAttributesList(func);
  console.log(`   ${attributes.length > 0 ? attributes.join(', ') : chalk.gray('none')}`);
  console.log();
}

function buildAttributesList(func: FunctionInfo): string[] {
  const attributes: string[] = [];
  if (func.isExported) attributes.push(chalk.green('exported'));
  if (func.isAsync) attributes.push(chalk.blue('async'));
  if (func.isGenerator) attributes.push(chalk.yellow('generator'));
  if (func.isArrowFunction) attributes.push(chalk.cyan('arrow'));
  if (func.isMethod) attributes.push(chalk.magenta('method'));
  if (func.isConstructor) attributes.push(chalk.red('constructor'));
  if (func.isStatic) attributes.push(chalk.gray('static'));
  if (func.accessModifier) attributes.push(chalk.white(func.accessModifier));
  return attributes;
}

function displayFunctionParameters(func: FunctionInfo): void {
  if (func.parameters.length === 0) return;
  
  console.log(chalk.bold(`📥 Parameters (${func.parameters.length}):`));
  func.parameters.forEach((param, index) => {
    const optional = param.isOptional ? '?' : '';
    const rest = param.isRest ? '...' : '';
    const defaultVal = param.defaultValue ? ` = ${param.defaultValue}` : '';
    console.log(`   ${index + 1}. ${rest}${param.name}${optional}: ${param.type}${defaultVal}`);
    if (param.description) {
      console.log(`      ${chalk.gray(param.description)}`);
    }
  });
  console.log();
}

function displayFunctionReturnType(func: FunctionInfo): void {
  if (!func.returnType) return;
  
  console.log(chalk.bold(`📤 Return Type:`));
  console.log(`   ${func.returnType.type}`);
  if (func.returnType.isPromise) {
    console.log(`   ${chalk.blue('Promise')}<${func.returnType.promiseType || 'unknown'}>`);
  }
  if (func.returnType.description) {
    console.log(`   ${chalk.gray(func.returnType.description)}`);
  }
  console.log();
}

function displayFunctionMetrics(func: FunctionInfo, config: FuncqcConfig): void {
  if (!func.metrics) return;
  
  console.log(chalk.bold(`📊 Quality Metrics:`));
  displaySizeMetrics(func.metrics, config);
  displayComplexityMetrics(func.metrics, config);
  displayStructureMetrics(func.metrics);
  displayDocumentationMetrics(func.metrics);
  displayAdvancedMetrics(func.metrics);
  console.log();
}

function displaySizeMetrics(metrics: QualityMetrics, config: FuncqcConfig): void {
  console.log(`   ${chalk.bold('Size:')}`);
  console.log(`     Lines of Code: ${formatMetricValue(metrics.linesOfCode, 'lines', config)}`);
  console.log(`     Total Lines: ${metrics.totalLines}`);
  console.log(`     Parameters: ${formatMetricValue(metrics.parameterCount, 'params', config)}`);
}

function displayComplexityMetrics(metrics: QualityMetrics, config: FuncqcConfig): void {
  console.log(`   ${chalk.bold('Complexity:')}`);
  console.log(`     Cyclomatic: ${formatMetricValue(metrics.cyclomaticComplexity, 'complexity', config)}`);
  console.log(`     Cognitive: ${formatMetricValue(metrics.cognitiveComplexity, 'cognitive', config)}`);
  console.log(`     Max Nesting: ${formatMetricValue(metrics.maxNestingLevel, 'nesting', config)}`);
}

function displayStructureMetrics(metrics: QualityMetrics): void {
  console.log(`   ${chalk.bold('Structure:')}`);
  console.log(`     Branches: ${metrics.branchCount}`);
  console.log(`     Loops: ${metrics.loopCount}`);
  console.log(`     Try/Catch: ${metrics.tryCatchCount}`);
  console.log(`     Return Statements: ${metrics.returnStatementCount}`);
  
  if (metrics.asyncAwaitCount > 0) {
    console.log(`     Async/Await: ${metrics.asyncAwaitCount}`);
  }
  if (metrics.callbackCount > 0) {
    console.log(`     Callbacks: ${metrics.callbackCount}`);
  }
}

function displayDocumentationMetrics(metrics: QualityMetrics): void {
  console.log(`   ${chalk.bold('Documentation:')}`);
  console.log(`     Comment Lines: ${metrics.commentLines}`);
  console.log(`     Code-to-Comment Ratio: ${metrics.codeToCommentRatio.toFixed(2)}`);
}

function displayAdvancedMetrics(metrics: QualityMetrics): void {
  if (!metrics.maintainabilityIndex) return;
  
  console.log(`   ${chalk.bold('Advanced:')}`);
  console.log(`     Maintainability Index: ${metrics.maintainabilityIndex.toFixed(1)}`);
  if (metrics.halsteadVolume) {
    console.log(`     Halstead Volume: ${metrics.halsteadVolume.toFixed(1)}`);
  }
  if (metrics.halsteadDifficulty) {
    console.log(`     Halstead Difficulty: ${metrics.halsteadDifficulty.toFixed(1)}`);
  }
}

function displayFunctionContext(func: FunctionInfo): void {
  if (!func.contextPath || func.contextPath.length === 0) return;
  
  console.log(chalk.bold(`🏗️  Context:`));
  console.log(`   Path: ${func.contextPath.join(' → ')}`);
  if (func.functionType) {
    console.log(`   Type: ${func.functionType}`);
  }
  console.log();
}

function displayFunctionDocumentation(func: FunctionInfo): void {
  if (!func.jsDoc) return;
  
  console.log(chalk.bold(`📚 Documentation:`));
  console.log(`   ${func.jsDoc.replace(/\n/g, '\n   ')}`);
  console.log();
}

function displayFunctionTechnicalInfo(func: FunctionInfo): void {
  console.log(chalk.bold(`🔍 Technical Info:`));
  console.log(`   Full ID: ${func.id}`);
  console.log(`   Signature Hash: ${func.signatureHash.substring(0, 8)}...`);
  console.log(`   AST Hash: ${func.astHash}`);
  console.log(`   File Hash: ${func.fileHash.substring(0, 8)}...`);
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