import chalk from 'chalk';
import { ShowCommandOptions, FunctionInfo } from '../../types';
import { ErrorCode, createErrorHandler, type DatabaseErrorLike } from '../../utils/error-handler';
import { CommandEnvironment } from '../../types/environment';

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
        if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
          const dbErr = error as DatabaseErrorLike;
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          dbErr.message,
          { dbCode: dbErr.code },
          dbErr.originalError
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
    const func = await findFunctionById(env, functionId);
    if (func) {
      return func;
    }
    throw new Error(`Function with ID '${functionId}' not found`);
  }

  // Priority 2: Search by name pattern
  if (namePattern) {
    const functions = await env.storage.findFunctions();
    
    // First try exact match
    let matches = functions.filter(f => f.displayName === namePattern || f.name === namePattern);
    
    // If no exact match, try pattern matching
    if (matches.length === 0) {
      const pattern = createSafeWildcardPattern(namePattern);
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

/**
 * Find function by ID with support for partial ID matching
 */
async function findFunctionById(
  env: CommandEnvironment,
  id: string
): Promise<FunctionInfo | null> {
  // Get the latest snapshot first
  const snapshots = await env.storage.getSnapshots({ sort: 'created_at', limit: 1 });
  if (snapshots.length === 0) {
    return null;
  }

  // Try to get function with description first
  const functionsWithDescriptions = await env.storage.getFunctionsWithDescriptions(snapshots[0].id);
  const func = functionsWithDescriptions.find(f => f.id === id || f.id.startsWith(id));

  if (func) {
    return func;
  }

  // Fallback to regular query if not found in functions with descriptions
  const functions = await env.storage.findFunctions();
  return functions.find(f => f.id === id || f.id.startsWith(id)) || null;
}

function outputJSON(func: FunctionInfo): void {
  console.log(JSON.stringify(func, null, 2));
}

interface DisplayConfig {
  showUsage: boolean;
  showCurrent: boolean;
  showHistory: boolean;
  showSource: boolean;
}

function createDisplayConfig(options: ShowCommandOptions): DisplayConfig {
  // デフォルトは --current モード（オプションが何も指定されていない場合）
  const hasSpecificOption = !!(options.usage || options.current || options.history);
  const defaultToCurrent = !hasSpecificOption;

  return {
    showUsage: !!options.usage,
    showCurrent: !!(options.current || defaultToCurrent),
    showHistory: !!options.history,
    showSource: !!options.source
  };
}

async function outputFriendly(
  func: FunctionInfo,
  env: CommandEnvironment,
  options: ShowCommandOptions
): Promise<void> {
  const config = createDisplayConfig(options);

  // Header
  console.log(chalk.blue.bold(`\n📍 Function: ${func.displayName}`));
  console.log('─'.repeat(60));

  // Basic information (always shown)
  await displayBasicInfo(func, env);

  // Conditional sections based on configuration
  if (config.showUsage) {
    await displayUsageInfo(func, env);
    displayExamples(func);
  }

  if (config.showCurrent) {
    displayParametersAndReturn(func);
    displayQualityMetrics(func);
  }

  if (config.showHistory) {
    await displayHistoryInfo(func, env, config.showSource);
  }

  if (config.showSource && !config.showHistory) {
    await displaySourceCode(func, env);
  }

  console.log(); // Empty line at end
}

async function displayBasicInfo(func: FunctionInfo, _env: CommandEnvironment): Promise<void> {
  console.log(chalk.cyan('📋 Basic Information:'));
  
  // Show ID first as the primary identifier
  console.log(`  ID: ${func.id}`);
  
  // Build function signature
  const signature = buildFunctionSignature(func);
  console.log(`  Definition: ${signature}`);
  console.log(`  Location: ${func.filePath}:${func.startLine}-${func.endLine}`);
  
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

async function displaySourceCode(func: FunctionInfo, env: CommandEnvironment): Promise<void> {
  // First try to get source code from function's sourceCode field
  let sourceCode: string | null = func.sourceCode || null;
  
  // If not available, extract from database using precise line/column positions
  if (!sourceCode) {
    try {
      sourceCode = await env.storage.extractFunctionSourceCode(func.id);
    } catch (error) {
      console.log(chalk.yellow('📄 Source Code: Failed to extract from database'));
      console.log(chalk.gray(`  Error: ${error instanceof Error ? error.message : String(error)}`));
      console.log();
      return;
    }
  }
  
  if (!sourceCode) {
    console.log(chalk.cyan('📄 Source Code: Not available'));
    console.log();
    return;
  }

  console.log(chalk.cyan('📄 Source Code:'));
  console.log('─'.repeat(60));
  
  // Basic syntax highlighting (simplified)
  const highlighted = sourceCode
    .replace(/\b(function|const|let|var|if|else|for|while|return|async|await)\b/g, chalk.blue('$1'))
    .replace(/\b(true|false|null|undefined)\b/g, chalk.magenta('$1'))
    .replace(/"([^"]*)"/g, chalk.green('"$1"'))
    .replace(/'([^']*)'/g, chalk.green("'$1'"));
  
  console.log(highlighted);
  
  console.log('─'.repeat(60));
  console.log();
}



interface HistoryRow {
  id: string;
  snapshot_id: string;
  display_name: string;
  file_path: string;
  start_line: number;
  end_line: number;
  ast_hash: string;
  is_exported: boolean;
  is_async: boolean;
  is_arrow_function: boolean;
  lines_of_code: number | null;
  cyclomatic_complexity: number | null;
  cognitive_complexity: number | null;
  max_nesting_level: number | null;
  parameter_count: number | null;
  source_code: string | null;
  snapshot_created_at: string;
  snapshot_label: string | null;
}

async function getSemanticId(func: FunctionInfo, env: CommandEnvironment): Promise<string | null> {
  let semanticId = func.semanticId;
  
  if (!semanticId) {
    try {
      const funcResult = await env.storage.getDb().query(`
        SELECT semantic_id FROM functions WHERE id = $1 LIMIT 1
      `, [func.id]);
      
      if (funcResult.rows.length > 0) {
        semanticId = (funcResult.rows[0] as { semantic_id: string }).semantic_id;
      }
    } catch {
      // Continue with fallback approach
    }
  }
  
  return semanticId;
}

async function fetchHistoricalVersions(semanticId: string, env: CommandEnvironment): Promise<HistoryRow[]> {
  const result = await env.storage.getDb().query(`
    SELECT 
      f.id, f.snapshot_id, f.display_name, f.file_path, f.start_line, f.end_line,
      f.ast_hash, f.is_exported, f.is_async, f.is_arrow_function, f.source_code,
      q.lines_of_code, q.cyclomatic_complexity, q.cognitive_complexity, 
      q.max_nesting_level, q.parameter_count,
      s.created_at as snapshot_created_at, s.label as snapshot_label
    FROM functions f
    JOIN snapshots s ON f.snapshot_id = s.id
    LEFT JOIN quality_metrics q ON f.id = q.function_id
    WHERE f.semantic_id = $1
      AND (f.ast_hash, s.created_at) IN (
        SELECT f2.ast_hash, MIN(s2.created_at)
        FROM functions f2
        JOIN snapshots s2 ON f2.snapshot_id = s2.id
        WHERE f2.semantic_id = $1
        GROUP BY f2.ast_hash
      )
    ORDER BY s.created_at ASC
  `, [semanticId]);

  return (result.rows as HistoryRow[]).filter(row => row.lines_of_code !== null);
}

function displayMetricsTable(historicalVersions: HistoryRow[]): void {
  console.log(`\n  📊 Metrics History (${historicalVersions.length} unique AST versions):`);
  console.log('  ' + '─'.repeat(85));
  
  // Table header
  console.log(`  ${'Snapshot'.padEnd(12)} ${'Date'.padEnd(12)} ${'CC'.padStart(4)} ${'Lines'.padStart(6)} ${'Nest'.padStart(5)} ${'Cognitive'.padStart(9)} ${'Change Type'.padEnd(12)}`);
  console.log('  ' + '─'.repeat(85));
  
  // Historical data rows with change indicators
  historicalVersions.forEach((row, index) => {
    const isLatest = index === historicalVersions.length - 1;
    const snapshotId = row.snapshot_id.substring(0, 8);
    const date = new Date(row.snapshot_created_at).toISOString().split('T')[0];
    const cc = row.cyclomatic_complexity || 1;
    const lines = row.lines_of_code || 0;
    const nest = row.max_nesting_level || 0;
    const cognitive = row.cognitive_complexity || 0;
    
    // Determine change type based on position and metrics
    let changeType = '';
    if (index === 0) {
      changeType = chalk.gray('Initial');
    } else {
      const prevRow = historicalVersions[index - 1];
      const metricsChanged = (
        (prevRow.cyclomatic_complexity || 1) !== cc ||
        (prevRow.lines_of_code || 0) !== lines ||
        (prevRow.max_nesting_level || 0) !== nest ||
        (prevRow.cognitive_complexity || 0) !== cognitive
      );
      
      if (metricsChanged) {
        changeType = chalk.cyan('Code+Metrics');
      } else {
        changeType = chalk.blue('Code Change');
      }
    }
    
    const line = `  ${snapshotId.padEnd(12)} ${date.padEnd(12)} ${cc.toString().padStart(4)} ${lines.toString().padStart(6)} ${nest.toString().padStart(5)} ${cognitive.toString().padStart(9)} ${changeType}`;
    
    if (isLatest) {
      console.log(chalk.green(line + ' ← current'));
    } else {
      console.log(line);
    }
  });
}

function displayTrendAnalysis(historicalVersions: HistoryRow[]): void {
  if (historicalVersions.length < 2) {
    return;
  }

  const first = historicalVersions[0];
  const latest = historicalVersions[historicalVersions.length - 1];
  
  console.log('\n  📈 Overall Trend Analysis:');
  const ccChange = (latest.cyclomatic_complexity || 1) - (first.cyclomatic_complexity || 1);
  const linesChange = (latest.lines_of_code || 0) - (first.lines_of_code || 0);
  const nestChange = (latest.max_nesting_level || 0) - (first.max_nesting_level || 0);
  const cognitiveChange = (latest.cognitive_complexity || 0) - (first.cognitive_complexity || 0);
  
  console.log(`    Cyclomatic Complexity: ${getTrendIndicator(ccChange)} (${ccChange > 0 ? '+' : ''}${ccChange})`);
  console.log(`    Lines of Code: ${getTrendIndicator(linesChange)} (${linesChange > 0 ? '+' : ''}${linesChange})`);
  console.log(`    Max Nesting: ${getTrendIndicator(nestChange)} (${nestChange > 0 ? '+' : ''}${nestChange})`);
  console.log(`    Cognitive Complexity: ${getTrendIndicator(cognitiveChange)} (${cognitiveChange > 0 ? '+' : ''}${cognitiveChange})`);
  
  // Show time span
  const firstDate = new Date(first.snapshot_created_at);
  const latestDate = new Date(latest.snapshot_created_at);
  const daysDiff = Math.ceil((latestDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysDiff > 0) {
    console.log(chalk.gray(`    Time span: ${daysDiff} day${daysDiff > 1 ? 's' : ''} (${historicalVersions.length - 1} significant changes)`));
  }
}

function displaySourceHistory(historicalVersions: HistoryRow[]): void {
  console.log('\n  📄 Source Code History:');
  console.log('  ' + '═'.repeat(85));
  
  historicalVersions.forEach((row, index) => {
    const isLatest = index === historicalVersions.length - 1;
    const snapshotId = row.snapshot_id.substring(0, 8);
    const date = new Date(row.snapshot_created_at).toISOString().split('T')[0];
    const versionLabel = isLatest ? ' (current)' : '';
    
    console.log(`\n  📝 Version ${index + 1}/${historicalVersions.length} - ${snapshotId} (${date})${versionLabel}`);
    console.log('  ' + '─'.repeat(60));
    
    if (row.source_code) {
      // Apply basic syntax highlighting
      const highlighted = row.source_code
        .replace(/\b(function|const|let|var|if|else|for|while|return|async|await|export|import)\b/g, chalk.blue('$1'))
        .replace(/\b(true|false|null|undefined)\b/g, chalk.magenta('$1'))
        .replace(/"([^"]*)"/g, chalk.green('"$1"'))
        .replace(/'([^']*)'/g, chalk.green("'$1'"));
      
      // Add line numbers and indentation  
      const lines = highlighted.split('\n');
      lines.forEach((line, lineIndex) => {
        const lineNumber = (lineIndex + 1).toString().padStart(3, ' ');
        console.log(`  ${chalk.gray(lineNumber)}│ ${line}`);
      });
    } else {
      console.log(chalk.gray('    Source code not available for this version'));
    }
    
    if (index < historicalVersions.length - 1) {
      console.log('  ' + '─'.repeat(60));
    }
  });
  
  console.log('  ' + '═'.repeat(85));
}

async function displayHistoryInfo(func: FunctionInfo, env: CommandEnvironment, showSource = false): Promise<void> {
  console.log(chalk.cyan('📈 Historical Information:'));
  
  const semanticId = await getSemanticId(func, env);
  
  if (!semanticId) {
    console.log(`  No semantic ID available for historical tracking (ID: ${func.id})`);
    console.log();
    return;
  }
  
  try {
    const historicalVersions = await fetchHistoricalVersions(semanticId, env);

    if (historicalVersions.length <= 1) {
      console.log('  No meaningful historical changes found with metrics data');
      console.log();
      return;
    }

    displayMetricsTable(historicalVersions);
    displayTrendAnalysis(historicalVersions);

    if (showSource) {
      displaySourceHistory(historicalVersions);
    }

  } catch (error) {
    console.log(chalk.yellow(`  Error retrieving historical data: ${error instanceof Error ? error.message : String(error)}`));
  }
  
  console.log();
}

function getTrendIndicator(change: number): string {
  if (change > 0) {
    return chalk.red('↗ increased');
  } else if (change < 0) {
    return chalk.green('↘ decreased');
  } else {
    return chalk.gray('→ unchanged');
  }
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

function buildFunctionSignature(func: FunctionInfo): string {
  // Build export prefix
  const exportPrefix = func.isExported ? 'export ' : '';
  
  // Build async prefix
  const asyncPrefix = func.isAsync ? 'async ' : '';
  
  // Build parameters
  const params = func.parameters?.map(p => {
    const rest = p.isRest ? '...' : '';
    const optional = p.isOptional ? '?' : '';
    const defaultVal = p.defaultValue ? ` = ${p.defaultValue}` : '';
    return `${rest}${p.name}${optional}: ${p.type}${defaultVal}`;
  }).join(', ') || '';
  
  // Build return type
  const returnType = func.returnType?.type || 'void';
  
  // Build function declaration based on type
  if (func.isArrowFunction) {
    return `${exportPrefix}const ${func.name} = ${asyncPrefix}(${params}): ${returnType} => { ... }`;
  } else {
    return `${exportPrefix}${asyncPrefix}function ${func.name}(${params}): ${returnType} { ... }`;
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

/**
 * Create a safe wildcard pattern that prevents ReDoS attacks.
 * 
 * Only allows '*' as wildcard character, all other regex metacharacters are escaped.
 * This prevents malicious users from injecting complex regex patterns that could
 * cause exponential backtracking and DoS attacks.
 * 
 * @param input User input string that may contain wildcards
 * @returns RegExp Safe compiled regular expression
 */
function createSafeWildcardPattern(input: string): RegExp {
  // Escape all regex metacharacters except '*'
  // This prevents regex injection attacks while preserving wildcard functionality
  const escaped = input.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  
  // Convert '*' to '.*' for wildcard matching
  const pattern = escaped.replace(/\*/g, '.*');
  
  return new RegExp(pattern, 'i');
}