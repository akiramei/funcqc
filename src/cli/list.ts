import chalk from 'chalk';
import { table } from 'table';
import { ListCommandOptions, FunctionInfo, QueryFilter } from '../types';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { UrgencyAssessor } from '../utils/urgency-assessor';

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
    const queryOptions: any = { filters };
    if (options.sort) queryOptions.sort = options.sort;
    if (options.limit) queryOptions.limit = parseInt(options.limit);
    
    let functions = await storage.queryFunctions();
    
    // Apply urgency filtering
    functions = applyUrgencyFiltering(functions, options);
    
    if (functions.length === 0) {
      console.log(chalk.yellow('No functions found matching the criteria.'));
      console.log(chalk.blue('Try running `funcqc scan` first to analyze your code.'));
      return;
    }
    
    // Output results
    await outputResults(functions, options);
    
  } catch (error) {
    console.error(chalk.red('Failed to list functions:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function applyUrgencyFiltering(functions: FunctionInfo[], options: ListCommandOptions): FunctionInfo[] {
  const urgencyAssessor = new UrgencyAssessor();
  
  // Early return if no urgency filtering is needed
  if (!options.urgent && !options.weekly && !options.team && !options.low) {
    return functions;
  }
  
  // Determine the urgency level to filter by
  const urgencyLevel = getUrgencyLevel(options);
  if (!urgencyLevel) return functions;
  
  return urgencyAssessor.filterByUrgencyLevel(functions, urgencyLevel);
}

function getUrgencyLevel(options: ListCommandOptions): 'urgent' | 'weekly' | 'team' | 'low' | null {
  if (options.urgent) return 'urgent';
  if (options.weekly) return 'weekly';
  if (options.team) return 'team';
  if (options.low) return 'low';
  return null;
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

async function outputResults(functions: FunctionInfo[], options: ListCommandOptions): Promise<void> {
  // Determine output format
  let format = options.format || 'table';
  
  if (options.json) format = 'json';
  if (options.csv) format = 'csv';
  
  // Use friendly format for urgency views
  if (options.urgent || options.weekly || options.team || options.low) {
    format = 'friendly';
  }
  
  switch (format) {
    case 'json':
      outputJSON(functions);
      break;
    case 'csv':
      outputCSV(functions, options);
      break;
    case 'friendly':
      outputFriendly(functions, options);
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

function outputCSV(functions: FunctionInfo[], options: ListCommandOptions): void {
  const fields = getFields(options);
  
  // Header
  console.log(fields.join(','));
  
  // Data rows
  for (const func of functions) {
    const row = fields.map(field => {
      const value = getFieldValue(func, field);
      // Escape CSV values
      return typeof value === 'string' && value.includes(',') 
        ? `"${value.replace(/"/g, '""')}"` 
        : value;
    });
    console.log(row.join(','));
  }
}

function outputTable(functions: FunctionInfo[], options: ListCommandOptions): void {
  const fields = getFields(options);
  
  // Prepare table data
  const headerRow = fields.map(field => chalk.bold(formatFieldName(field)));
  const dataRows = functions.map(func => 
    fields.map(field => formatFieldValue(func, field))
  );
  
  const tableData = [headerRow, ...dataRows];
  
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
    columns: {
      0: { width: 20, wrapWord: true }, // Name
      1: { width: 30, wrapWord: true }, // File
      2: { width: 8, alignment: 'right' }, // Lines
      3: { width: 10, alignment: 'right' } // Complexity
    }
  };
  
  // @ts-ignore - Table configuration type issue
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
  
  // Default fields
  return ['name', 'file', 'lines', 'complexity', 'exported', 'async'];
}

function formatFieldName(field: string): string {
  const names: Record<string, string> = {
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

function getFieldValue(func: FunctionInfo, field: string): any {
  switch (field) {
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

function outputFriendly(functions: FunctionInfo[], options: ListCommandOptions): void {
  const urgencyAssessor = new UrgencyAssessor();
  
  if (functions.length === 0) {
    console.log(chalk.green('🎉 素晴らしい！該当する関数はありません。'));
    return;
  }

  // Sort by urgency score (highest priority first)
  const assessedFunctions = functions.map(func => ({
    func,
    assessment: urgencyAssessor.assessFunction(func)
  })).sort((a, b) => b.assessment.estimatedMinutes - a.assessment.estimatedMinutes);

  let title: string;
  if (options.urgent) {
    title = '🚨 今日対応推奨';
  } else if (options.weekly) {
    title = '📅 今週計画推奨';
  } else if (options.team) {
    title = '👥 チーム検討推奨';
  } else if (options.low) {
    title = '🟢 軽微な改善推奨';
  } else {
    title = '📋 関数一覧';
  }

  console.log(chalk.bold.cyan(`${title} (${functions.length}関数)`));
  console.log();

  assessedFunctions.forEach((item, index) => {
    const { func, assessment } = item;
    const number = (index + 1).toString().padStart(2, ' ');
    
    // Function header with urgency indicator
    console.log(chalk.bold(`${number}. ${func.displayName}() ${chalk.yellow(`[${assessment.estimatedMinutes}分で改善可能]`)}`));
    console.log(chalk.gray(`   📍 ${func.filePath}:${func.startLine}`));
    
    // Risk and impact description
    console.log(`   ⚠️  リスク: ${assessment.riskDescription}`);
    console.log(`   💡 改善案: ${assessment.improvementStrategy}`);
    console.log(`   📈 効果: ${assessment.impact}`);
    
    // Show specific issues if any
    if (assessment.reasons.length > 0) {
      console.log(`   🔍 課題: ${assessment.reasons.join('、')}`);
    }
    
    console.log();
  });

  // Summary
  const totalMinutes = assessedFunctions.reduce((sum, item) => sum + item.assessment.estimatedMinutes, 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  
  console.log(chalk.blue('📊 概要:'));
  console.log(chalk.blue(`   合計改善時間: ${totalHours}時間${remainingMinutes}分`));
  
  const urgentCount = assessedFunctions.filter(item => item.assessment.level === 'urgent').length;
  const weeklyCount = assessedFunctions.filter(item => item.assessment.level === 'weekly').length;
  const teamCount = assessedFunctions.filter(item => item.assessment.level === 'team').length;
  
  if (urgentCount > 0) console.log(chalk.red(`   🚨 緊急: ${urgentCount}件`));
  if (weeklyCount > 0) console.log(chalk.yellow(`   📅 今週: ${weeklyCount}件`));
  if (teamCount > 0) console.log(chalk.blue(`   👥 チーム: ${teamCount}件`));
  
  console.log();
  console.log(chalk.gray('💡 ヒント: 具体的な優先度で絞り込むには --urgent, --weekly, --team オプションを使用してください'));
}

function formatFieldValue(func: FunctionInfo, field: string): string {
  const value = getFieldValue(func, field);
  
  switch (field) {
    case 'file':
      // Shorten file paths
      return value.length > 30 ? '...' + value.slice(-27) : value;
    case 'exported':
      return value ? chalk.green('✓') : chalk.gray('✗');
    case 'async':
      return value ? chalk.blue('async') : '';
    case 'complexity': {
      // Color code complexity
      const complexity = value as number;
      if (complexity > 10) return chalk.red(complexity.toString());
      if (complexity > 5) return chalk.yellow(complexity.toString());
      return chalk.green(complexity.toString());
    }
    default:
      return value.toString();
  }
}
