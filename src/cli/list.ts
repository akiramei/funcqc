import chalk from 'chalk';
import { table } from 'table';
import { ListCommandOptions, FunctionInfo, QueryFilter, FuncqcConfig, QualityMetrics, ProjectRiskAssessment, FunctionRiskAssessment, QueryOptions, FieldValue, ThresholdViolation } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { riskAssessor } from '../core/risk-assessor.js';

export async function listCommand(
  patterns: string[] = [],
  options: ListCommandOptions
): Promise<void> {
  try {
    // Load configuration
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    // Initialize storage
    const storage = new PGLiteStorageAdapter(config.storage.path!);
    await storage.init();
    
    // Build query filters
    const filters = buildFilters(patterns, options);
    
    // Query functions
    const queryOptions: QueryOptions = { filters };
    if (options.sort) queryOptions.sort = options.sort;
    if (options.limit) queryOptions.limit = parseInt(options.limit);
    
    let functions = await storage.queryFunctions();
    
    // Apply threshold-based filtering
    functions = await applyThresholdFiltering(functions, options, config);
    
    if (functions.length === 0) {
      console.log(chalk.yellow('No functions found matching the criteria.'));
      console.log(chalk.blue('Try running `funcqc scan` first to analyze your code.'));
      return;
    }
    
    // Output results
    await outputResults(functions, options, config);
    
  } catch (error) {
    console.error(chalk.red('Failed to list functions:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function applyThresholdFiltering(functions: FunctionInfo[], options: ListCommandOptions, config: FuncqcConfig): Promise<FunctionInfo[]> {
  if (!options.thresholdViolations) {
    return functions;
  }
  
  try {
    // Use enhanced threshold system for filtering
    const assessment = await riskAssessor.assessProject(
      functions,
      config.thresholds,
      config.assessment,
      config.projectContext
    );
    
    // Filter functions that have any violations
    const functionsWithViolations = assessment.worstFunctions
      .filter(fa => fa.totalViolations > 0)
      .map(fa => fa.functionId);
    
    return functions.filter(func => functionsWithViolations.includes(func.id));
  } catch {
    // Fallback to legacy threshold filtering if enhanced system fails
    console.warn(chalk.yellow('Warning: Enhanced threshold evaluation failed, using legacy system'));
    return applyLegacyThresholdFiltering(functions, config);
  }
}

function applyLegacyThresholdFiltering(functions: FunctionInfo[], config: FuncqcConfig): FunctionInfo[] {
  // Fallback to legacy threshold filtering
  return functions.filter(func => {
    const metrics = func.metrics;
    if (!metrics) return false;
    
    const {
      complexityThreshold,
      cognitiveComplexityThreshold,
      linesOfCodeThreshold,
      parameterCountThreshold,
      maxNestingLevelThreshold
    } = config.metrics;
    
    return (
      metrics.cyclomaticComplexity > complexityThreshold ||
      metrics.cognitiveComplexity > cognitiveComplexityThreshold ||
      metrics.linesOfCode > linesOfCodeThreshold ||
      metrics.parameterCount > parameterCountThreshold ||
      metrics.maxNestingLevel > maxNestingLevelThreshold
    );
  });
}

function buildFilters(patterns: string[], options: ListCommandOptions): QueryFilter[] {
  const filters: QueryFilter[] = [];
  
  // Name patterns
  if (patterns.length > 0) {
    const namePattern = patterns.join('|');
    filters.push({
      field: 'name',
      operator: 'LIKE',
      value: `%${namePattern}%`
    });
  }
  
  if (options.name) {
    filters.push({
      field: 'name',
      operator: 'LIKE',
      value: `%${options.name}%`
    });
  }
  
  // File pattern
  if (options.file) {
    filters.push({
      field: 'file_path',
      operator: 'LIKE',
      value: `%${options.file}%`
    });
  }
  
  // Boolean filters
  if (options.exported) {
    filters.push({
      field: 'is_exported',
      operator: '=',
      value: true
    });
  }
  
  if (options.async) {
    filters.push({
      field: 'is_async',
      operator: '=',
      value: true
    });
  }
  
  // Numeric filters
  if (options.complexity) {
    const complexityFilter = parseNumericCondition('cyclomatic_complexity', options.complexity);
    if (complexityFilter) filters.push(complexityFilter);
  }
  
  if (options.lines) {
    const linesFilter = parseNumericCondition('lines_of_code', options.lines);
    if (linesFilter) filters.push(linesFilter);
  }
  
  if (options.params) {
    const paramsFilter = parseNumericCondition('parameter_count', options.params);
    if (paramsFilter) filters.push(paramsFilter);
  }
  
  return filters;
}

function parseNumericCondition(field: string, condition: string): QueryFilter | null {
  // Handle conditions like ">5", "<=3", "5..10", "5,8,10"
  
  // Early return for empty conditions
  if (!condition || condition.trim() === '') {
    return null;
  }
  
  // Add validation for field parameter
  if (!field) {
    return null;
  }

  // Handle range conditions
  if (condition.includes('..')) {
    return parseRangeCondition(field, condition);
  }
  
  // Handle multiple values
  if (condition.includes(',')) {
    return parseMultipleValues(field, condition);
  }
  
  // Handle comparison operators
  return parseComparisonOperator(field, condition);
}

function parseRangeCondition(field: string, condition: string): QueryFilter | null {
  const [min, max] = condition.split('..').map(Number);
  if (!isNaN(min) && !isNaN(max)) {
    return {
      field,
      operator: '>=',
      value: min
    };
    // Note: For ranges, we'd need to return multiple filters
    // This is simplified for the example
  }
  return null;
}

function parseMultipleValues(field: string, condition: string): QueryFilter | null {
  const values = condition.split(',').map(Number).filter(n => !isNaN(n));
  if (values.length > 0) {
    return {
      field,
      operator: 'IN',
      value: values
    };
  }
  return null;
}

function parseComparisonOperator(field: string, condition: string): QueryFilter | null {
  // Define operator patterns
  const operators = [
    { pattern: '>=', slice: 2 },
    { pattern: '<=', slice: 2 },
    { pattern: '>', slice: 1 },
    { pattern: '<', slice: 1 }
  ];
  
  // Check each operator pattern
  for (const { pattern, slice } of operators) {
    if (condition.startsWith(pattern)) {
      const value = Number(condition.slice(slice));
      if (!isNaN(value)) {
        return { field, operator: pattern as QueryFilter['operator'], value };
      }
    }
  }
  
  // Handle exact match
  const value = Number(condition);
  if (!isNaN(value)) {
    return { field, operator: '=', value };
  }
  
  return null;
}

async function outputResults(functions: FunctionInfo[], options: ListCommandOptions, config: FuncqcConfig): Promise<void> {
  // Determine output format
  let format = options.format || 'table';
  
  if (options.json) format = 'json';
  
  // Use friendly format for threshold violations
  if (options.thresholdViolations) {
    format = 'friendly';
  }
  
  
  switch (format) {
    case 'json':
      outputJSON(functions);
      break;
    case 'friendly':
      await outputFriendly(functions, options, config);
      break;
    default:
      outputTable(functions, options);
      break;
  }
}

function outputJSON(functions: FunctionInfo[]): void {
  const output = {
    meta: {
      total: functions.length,
      timestamp: new Date().toISOString()
    },
    functions: functions.map(func => ({
      id: func.id,
      name: func.name,
      file: func.filePath,
      signature: func.signature,
      startLine: func.startLine,
      endLine: func.endLine,
      isExported: func.isExported,
      isAsync: func.isAsync,
      isArrowFunction: func.isArrowFunction,
      isMethod: func.isMethod,
      metrics: func.metrics
    }))
  };
  
  console.log(JSON.stringify(output, null, 2));
}


function outputTable(functions: FunctionInfo[], options: ListCommandOptions): void {
  const fields = getFields(options);
  
  // Prepare table data
  const headerRow = fields.map(field => chalk.bold(formatFieldName(field)));
  const dataRows = functions.map(func => 
    fields.map(field => formatFieldValue(func, field))
  );
  
  const tableData = [headerRow, ...dataRows];
  
  // Configure table columns dynamically based on fields
  const hasIdField = fields.includes('id');
  const baseColumns = hasIdField ? {
    0: { width: 10, alignment: 'left' }, // ID (shortened)
    1: { width: 18, wrapWord: true }, // Name
    2: { width: 28, wrapWord: true }, // File
    3: { width: 8, alignment: 'right' }, // Lines
    4: { width: 10, alignment: 'right' } // Complexity
  } : {
    0: { width: 20, wrapWord: true }, // Name
    1: { width: 30, wrapWord: true }, // File
    2: { width: 8, alignment: 'right' }, // Lines
    3: { width: 10, alignment: 'right' } // Complexity
  };
  
  // Configure table
  const config = {
    border: {
      topBody: '─',
      topJoin: '┬',
      topLeft: '┌',
      topRight: '┐',
      bottomBody: '─',
      bottomJoin: '┴',
      bottomLeft: '└',
      bottomRight: '┘',
      bodyLeft: '│',
      bodyRight: '│',
      bodyJoin: '│',
      joinBody: '─',
      joinLeft: '├',
      joinRight: '┤',
      joinJoin: '┼'
    },
    columnDefault: {
      paddingLeft: 1,
      paddingRight: 1
    },
    columns: baseColumns
  };
  
  // @ts-expect-error - Table configuration type issue
  console.log(table(tableData, config));
  
  // Show summary
  console.log();
  console.log(chalk.blue(`📊 Total: ${functions.length} functions`));
  
  if (functions.length > 0) {
    const avgComplexity = functions.reduce((sum, f) => 
      sum + (f.metrics?.cyclomaticComplexity || 1), 0) / functions.length;
    console.log(chalk.blue(`📈 Average complexity: ${avgComplexity.toFixed(1)}`));
  }
}

function getFields(options: ListCommandOptions): string[] {
  if (options.fields) {
    return options.fields.split(',').map(f => f.trim());
  }
  
  // Default fields - include ID if requested
  const defaultFields = ['name', 'file', 'lines', 'complexity', 'exported', 'async'];
  if (options.showId) {
    return ['id', ...defaultFields];
  }
  return defaultFields;
}

function formatFieldName(field: string): string {
  const names: Record<string, string> = {
    id: 'ID',
    name: 'Name',
    file: 'File',
    lines: 'Lines',
    complexity: 'Complexity',
    exported: 'Exported',
    async: 'Async',
    params: 'Params',
    signature: 'Signature'
  };
  
  return names[field] || field;
}

function getFieldValue(func: FunctionInfo, field: string): FieldValue {
  switch (field) {
    case 'id':
      return func.id;
    case 'name':
      return func.name;
    case 'file':
      return func.filePath;
    case 'lines':
      return func.metrics?.linesOfCode || 0;
    case 'complexity':
      return func.metrics?.cyclomaticComplexity || 1;
    case 'exported':
      return func.isExported;
    case 'async':
      return func.isAsync;
    case 'params':
      return func.parameters.length;
    case 'signature':
      return func.signature;
    default:
      return '';
  }
}

async function outputFriendly(functions: FunctionInfo[], options: ListCommandOptions, config: FuncqcConfig): Promise<void> {
  if (functions.length === 0) {
    console.log(chalk.green('No functions found matching the criteria.'));
    return;
  }

  const sortedFunctions = sortFunctionsByComplexity(functions);
  displayFriendlyHeader(functions.length, options.thresholdViolations);
  
  if (options.thresholdViolations) {
    await displayEnhancedFunctionList(sortedFunctions, config);
  } else {
    displayFunctionList(sortedFunctions, options, config);
  }
  
  displayFriendlySummary(functions, config);
}

function sortFunctionsByComplexity(functions: FunctionInfo[]): FunctionInfo[] {
  return functions.sort((a, b) => {
    const aComplexity = a.metrics?.cyclomaticComplexity || 1;
    const bComplexity = b.metrics?.cyclomaticComplexity || 1;
    return bComplexity - aComplexity;
  });
}

function displayFriendlyHeader(functionCount: number, isThresholdViolations?: boolean): void {
  const title = isThresholdViolations ? 
    `🚨 Threshold Violations (${functionCount} functions)` :
    `📋 Function List (${functionCount} functions)`;
  console.log(chalk.bold.cyan(title));
  console.log();
}

function displayFunctionList(functions: FunctionInfo[], options: ListCommandOptions, config: FuncqcConfig): void {
  functions.forEach((func, index) => {
    const number = (index + 1).toString().padStart(2, ' ');
    displayFunctionHeader(number, func, options.showId);
    displayFunctionMetrics(func.metrics);
    
    if (options.thresholdViolations && func.metrics) {
      displayThresholdViolations(func.metrics, config.metrics);
    }
    
    console.log();
  });
}

function displayFunctionHeader(number: string, func: FunctionInfo, showId?: boolean): void {
  const idText = showId ? chalk.gray(` [ID: ${func.id.substring(0, 8)}]`) : '';
  console.log(chalk.bold(`${number}. ${func.displayName}()${idText}`));
  console.log(chalk.gray(`   📍 ${func.filePath}:${func.startLine}`));
}

function displayFunctionMetrics(metrics?: QualityMetrics): void {
  if (!metrics) return;
  
  console.log(`   📊 Metrics: CC=${metrics.cyclomaticComplexity}, LOC=${metrics.linesOfCode}, Params=${metrics.parameterCount}`);
  
  if (metrics.maintainabilityIndex) {
    console.log(`   📈 Maintainability Index: ${metrics.maintainabilityIndex.toFixed(1)}`);
  }
  
  if (metrics.maxNestingLevel > 1) {
    console.log(`   🔄 Max Nesting Level: ${metrics.maxNestingLevel}`);
  }
}

function displayThresholdViolations(metrics: QualityMetrics, thresholds: FuncqcConfig['metrics']): void {
  const violations = buildViolationsList(metrics, thresholds);
  
  if (violations.length > 0) {
    console.log(`   ⚠️  Violations: ${violations.join(', ')}`);
  }
}

function buildViolationsList(metrics: QualityMetrics, thresholds: FuncqcConfig['metrics']): string[] {
  const violations: string[] = [];
  
  if (metrics.cyclomaticComplexity > thresholds.complexityThreshold) {
    violations.push(`CC=${metrics.cyclomaticComplexity}(+${(metrics.cyclomaticComplexity - thresholds.complexityThreshold).toFixed(1)})`);
  }
  
  if (metrics.cognitiveComplexity > thresholds.cognitiveComplexityThreshold) {
    violations.push(`CogC=${metrics.cognitiveComplexity}(+${(metrics.cognitiveComplexity - thresholds.cognitiveComplexityThreshold).toFixed(1)})`);
  }
  
  if (metrics.linesOfCode > thresholds.linesOfCodeThreshold) {
    violations.push(`LOC=${metrics.linesOfCode}(+${metrics.linesOfCode - thresholds.linesOfCodeThreshold})`);
  }
  
  if (metrics.parameterCount > thresholds.parameterCountThreshold) {
    violations.push(`Params=${metrics.parameterCount}(+${metrics.parameterCount - thresholds.parameterCountThreshold})`);
  }
  
  if (metrics.maxNestingLevel > thresholds.maxNestingLevelThreshold) {
    violations.push(`Nesting=${metrics.maxNestingLevel}(+${metrics.maxNestingLevel - thresholds.maxNestingLevelThreshold})`);
  }
  
  return violations;
}

function displayFriendlySummary(functions: FunctionInfo[], config: FuncqcConfig): void {
  const avgComplexity = calculateAverageComplexity(functions);
  const avgLines = calculateAverageLines(functions);
  
  console.log(chalk.blue('📊 Summary:'));
  console.log(chalk.blue(`   Average Complexity: ${avgComplexity.toFixed(1)}`));
  console.log(chalk.blue(`   Average Lines of Code: ${avgLines.toFixed(1)}`));
  
  displayQualityBreakdown(functions, config.metrics);
}

function calculateAverageComplexity(functions: FunctionInfo[]): number {
  return functions.reduce((sum, f) => 
    sum + (f.metrics?.cyclomaticComplexity || 1), 0) / functions.length;
}

function calculateAverageLines(functions: FunctionInfo[]): number {
  return functions.reduce((sum, f) => 
    sum + (f.metrics?.linesOfCode || 0), 0) / functions.length;
}

async function displayEnhancedFunctionList(functions: FunctionInfo[], config: FuncqcConfig): Promise<void> {
  try {
    // Get comprehensive risk assessment
    const assessment = await riskAssessor.assessProject(
      functions,
      config.thresholds,
      config.assessment,
      config.projectContext
    );

    // Display functions with their detailed violation information
    for (let i = 0; i < functions.length; i++) {
      const func = functions[i];
      const number = (i + 1).toString().padStart(2, ' ');
      
      displayFunctionHeader(number, func, true); // Always show ID in enhanced mode
      displayFunctionMetrics(func.metrics);
      
      // Find the risk assessment for this function
      const functionAssessment = assessment.worstFunctions.find(fa => fa.functionId === func.id);
      if (functionAssessment) {
        displayEnhancedViolations(functionAssessment);
      }
      
      console.log();
    }

    // Display project-level summary
    displayEnhancedSummary(assessment);
  } catch {
    console.warn(chalk.yellow('Warning: Enhanced violation display failed, using legacy display'));
    functions.forEach((func, index) => {
      const number = (index + 1).toString().padStart(2, ' ');
      displayFunctionHeader(number, func, true); // Always show ID in enhanced mode
      displayFunctionMetrics(func.metrics);
      
      if (func.metrics) {
        displayThresholdViolations(func.metrics, config.metrics);
      }
      
      console.log();
    });
  }
}

function displayEnhancedViolations(functionAssessment: FunctionRiskAssessment): void {
  if (functionAssessment.violations.length === 0) {
    return;
  }

  const violationsByLevel = {
    critical: functionAssessment.violations.filter(v => v.level === 'critical'),
    error: functionAssessment.violations.filter(v => v.level === 'error'),
    warning: functionAssessment.violations.filter(v => v.level === 'warning'),
  };

  // Display violations by severity
  ['critical', 'error', 'warning'].forEach(level => {
    const violations = violationsByLevel[level as keyof typeof violationsByLevel];
    if (violations.length === 0) return;

    const levelColor = level === 'critical' ? chalk.red : 
                     level === 'error' ? chalk.yellow : chalk.blue;
    const icon = level === 'critical' ? '🚨' : 
                level === 'error' ? '⚠️' : 'ℹ️';

    const violationTexts = violations.map(v => formatViolationText(v));
    console.log(`   ${icon} ${levelColor(level.toUpperCase())}: ${violationTexts.join(', ')}`);
  });

  // Display risk assessment
  const riskColor = functionAssessment.riskLevel === 'high' ? chalk.red :
                   functionAssessment.riskLevel === 'medium' ? chalk.yellow : chalk.green;
  console.log(`   🎯 Risk Level: ${riskColor(functionAssessment.riskLevel.toUpperCase())} (score: ${functionAssessment.riskScore.toFixed(1)})`);
}

function formatViolationText(violation: ThresholdViolation): string {
  const excessText = violation.excess > 0 ? `(+${violation.excess.toFixed(1)})` : '';
  
  if (violation.method === 'statistical' && violation.statisticalContext) {
    const ctx = violation.statisticalContext;
    let methodText = '';
    
    switch (ctx.method) {
      case 'mean+sigma':
        methodText = `(${ctx.baseline.toFixed(1)}+${(ctx.multiplier || 1)}σ)`;
        break;
      case 'percentile':
        methodText = `(p${ctx.percentile || 95})`;
        break;
      case 'median+mad':
        methodText = `(med+${(ctx.multiplier || 1)}mad)`;
        break;
    }
    
    return `${violation.metric}=${violation.value}${methodText}${excessText}`;
  }
  
  return `${violation.metric}=${violation.value}${excessText}`;
}

function displayEnhancedSummary(assessment: ProjectRiskAssessment): void {
  console.log(chalk.blue('📊 Enhanced Quality Assessment:'));
  
  const summary = riskAssessor.createAssessmentSummary(assessment);
  
  console.log(chalk.blue(`   Functions Analyzed: ${summary.totalFunctions}`));
  console.log(chalk.blue(`   Risk Distribution: ${chalk.red(summary.highRiskFunctions + ' high')}, ${chalk.yellow(summary.mediumRiskFunctions + ' medium')}, ${chalk.green(summary.lowRiskFunctions + ' low')}`));
  
  if (summary.totalViolations > 0) {
    console.log(chalk.blue(`   Total Violations: ${summary.totalViolations} (${chalk.red(summary.criticalViolations + ' critical')}, ${chalk.yellow(summary.errorViolations + ' error')}, ${chalk.blue(summary.warningViolations + ' warning')})`));
  }
  
  if (summary.mostCommonViolation) {
    console.log(chalk.blue(`   Most Common Issue: ${summary.mostCommonViolation}`));
  }
  
  if (summary.averageRiskScore > 0) {
    console.log(chalk.blue(`   Average Risk Score: ${summary.averageRiskScore.toFixed(1)}`));
  }
}

function displayQualityBreakdown(functions: FunctionInfo[], thresholds: FuncqcConfig['metrics']): void {
  const highComplexityCount = functions.filter(f => 
    (f.metrics?.cyclomaticComplexity || 1) > thresholds.complexityThreshold).length;
  const longFunctionCount = functions.filter(f => 
    (f.metrics?.linesOfCode || 0) > thresholds.linesOfCodeThreshold).length;
  
  if (highComplexityCount > 0) {
    console.log(chalk.yellow(`   🔍 High Complexity (>${thresholds.complexityThreshold}): ${highComplexityCount} functions`));
  }
  
  if (longFunctionCount > 0) {
    console.log(chalk.yellow(`   📏 Long Functions (>${thresholds.linesOfCodeThreshold} LOC): ${longFunctionCount} functions`));
  }
}

function formatFieldValue(func: FunctionInfo, field: string): string {
  const value = getFieldValue(func, field);
  
  // valueがnullまたはundefinedの場合は早期に空文字列を返す
  if (value === null || value === undefined) {
    return '';
  }

  switch (field) {
    case 'id':
      // valueがstringであることを確認してからsubstringを使用
      if (typeof value === 'string') {
        return chalk.gray(value.substring(0, 8));
      }
      break;
    case 'file':
      // valueがstringであることを確認してからlengthとsliceを使用
      if (typeof value === 'string') {
        return value.length > 30 ? '...' + value.slice(-27) : value;
      }
      break;
    case 'exported':
      return value ? chalk.green('✓') : chalk.gray('✗');
    case 'async':
      return value ? chalk.blue('async') : '';
    case 'complexity': {
      const complexity = value as number;
      if (complexity > 10) return chalk.red(complexity.toString());
      if (complexity > 5) return chalk.yellow(complexity.toString());
      return chalk.green(complexity.toString());
    }
  }
  
  // 上記のcaseで処理されなかった全ての値を文字列に変換して返す
  return String(value);
}
