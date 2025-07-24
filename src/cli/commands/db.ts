import chalk from 'chalk';
import { DbCommandOptions } from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';

/**
 * Database CLI command for inspecting PGLite database contents
 * Provides read-only access to database tables for debugging and testing
 */
export const dbCommand: VoidCommand<DbCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (options.list) {
        await listTables(env);
        return;
      }

      if (!options.table) {
        console.log(chalk.yellow('Please specify a table name with --table, or use --list to see available tables.'));
        console.log(chalk.gray('Example: funcqc db --table snapshots --limit 5'));
        return;
      }

      await queryTable(env, options);
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
          `Database command failed: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * List all available tables in the database
 */
async function listTables(env: CommandEnvironment): Promise<void> {
  try {
    const result = await env.storage.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

    console.log(chalk.cyan('📋 Available Tables:'));
    console.log();
    
    const resultArray = result as Array<{ rows: { table_name: string }[] }>;
    const tables = resultArray[0]?.rows?.map(row => row.table_name) || [];
    
    if (tables.length === 0) {
      console.log(chalk.yellow('No tables found. Run `funcqc scan` to create data.'));
      return;
    }

    for (const table of tables) {
      console.log(chalk.white(`  • ${table}`));
    }
    
    console.log();
    console.log(chalk.gray('Usage: funcqc db --table <table_name> [options]'));
    console.log(chalk.gray('Examples:'));
    console.log(chalk.gray('  funcqc db --table snapshots --limit 5'));
    console.log(chalk.gray('  funcqc db --table source_contents --limit-all'));
  } catch (error) {
    throw new Error(`Failed to list tables: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Query a specific table with filtering options
 */
async function queryTable(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const tableName = options.table!;
  
  // Validate table name to prevent SQL injection
  if (!isValidTableName(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  try {
    // Validate and build column list
    const columns = options.columns ? validateAndBuildColumns(options.columns) : '*';
    let query = `SELECT ${columns} FROM ${tableName}`;
    const params: (string | number)[] = [];
    
    // Add WHERE clause with parameterized queries
    if (options.where) {
      const { whereClause, whereParams } = buildParameterizedWhereClause(options.where, params.length);
      query += ` WHERE ${whereClause}`;
      params.push(...whereParams);
    }
    
    // Add ORDER BY for consistent results (if the column exists)
    if (tableName === 'snapshots' || tableName === 'functions') {
      query += ` ORDER BY created_at DESC`;
    } else {
      // For tables without created_at, use the first column
      query += ` ORDER BY 1`;
    }
    
    // Add LIMIT with validation
    const limit = validateAndParseLimit(options.limit, options.limitAll);
    if (limit > 0) {
      if (params.length > 0) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(limit);
      } else {
        query += ` LIMIT ${limit}`;
      }
    }

    const result = await env.storage.query(query, params) as Array<{ rows: unknown[] }>;
    const rows = result[0]?.rows || [];
    
    if (rows.length === 0) {
      console.log(chalk.yellow(`No data found in table '${tableName}'.`));
      return;
    }

    if (options.json) {
      outputJSON(rows, tableName);
    } else {
      outputTable(rows, tableName, limit);
    }
  } catch (error) {
    throw new Error(`Failed to query table '${tableName}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate table name to prevent SQL injection
 */
function isValidTableName(tableName: string): boolean {
  // Allow only alphanumeric characters and underscores
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName);
}

/**
 * Validate and build column list with proper escaping
 */
function validateAndBuildColumns(columnsStr: string): string {
  const columns = columnsStr.split(',').map(c => c.trim());
  
  for (const column of columns) {
    if (!isValidColumnName(column)) {
      throw new Error(`Invalid column name: ${column}`);
    }
  }
  
  return columns.join(', ');
}

/**
 * Validate column name to prevent SQL injection
 */
function isValidColumnName(columnName: string): boolean {
  // Allow only alphanumeric characters, underscores, and dots (for table.column)
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(columnName) && columnName.length <= 64;
}

/**
 * Build parameterized WHERE clause from simple conditions
 * Supports basic conditions like: column=value, column>value, etc.
 */
function buildParameterizedWhereClause(whereClause: string, paramOffset: number): { whereClause: string; whereParams: (string | number)[] } {
  // First, validate for dangerous patterns
  validateWhereClauseSafety(whereClause);
  
  // Parse simple conditions (column operator value)
  const params: (string | number)[] = [];
  let parameterizedClause = whereClause;
  let currentParamIndex = paramOffset + 1;
  
  // Replace simple patterns like column='value' or column=123
  // This is a basic implementation - for complex queries, consider a proper SQL parser
  const patterns = [
    // String values: column='value' or column="value"
    /([a-zA-Z_][a-zA-Z0-9_.]*)(\s*[=><]\s*)(['"])([^'"]*)(\3)/g,
    // Numeric values: column=123 or column>456  
    /([a-zA-Z_][a-zA-Z0-9_.]*)(\s*[=><]\s*)(\d+(?:\.\d+)?)/g
  ];
  
  // Handle string values
  parameterizedClause = parameterizedClause.replace(patterns[0], (_match, column, operator, _quote, value) => {
    if (!isValidColumnName(column)) {
      throw new Error(`Invalid column name in WHERE clause: ${column}`);
    }
    params.push(value);
    return `${column}${operator}$${currentParamIndex++}`;
  });
  
  // Handle numeric values
  parameterizedClause = parameterizedClause.replace(patterns[1], (_match, column, operator, value) => {
    if (!isValidColumnName(column)) {
      throw new Error(`Invalid column name in WHERE clause: ${column}`);
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      throw new Error(`Invalid numeric value in WHERE clause: ${value}`);
    }
    params.push(numValue);
    return `${column}${operator}$${currentParamIndex++}`;
  });
  
  return { whereClause: parameterizedClause, whereParams: params };
}

/**
 * Validate WHERE clause for dangerous patterns
 */
function validateWhereClauseSafety(whereClause: string): void {
  // Block dangerous keywords and patterns
  const dangerous = [
    'DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'EXEC', 'EXECUTE',
    'TRUNCATE', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK',
    '--', '/*', '*/', ';', 'UNION', 'OR 1=1', 'OR TRUE'
  ];
  
  const upperClause = whereClause.toUpperCase();
  
  for (const keyword of dangerous) {
    if (upperClause.includes(keyword)) {
      throw new Error(`Dangerous pattern '${keyword}' not allowed in WHERE clause`);
    }
  }
  
  // Additional pattern checks
  if (upperClause.match(/[^a-zA-Z0-9\s=><'"._(),-]/)) {
    throw new Error('WHERE clause contains potentially dangerous characters');
  }
}

/**
 * Validate and parse limit parameter
 */
function validateAndParseLimit(limitStr?: string, limitAll?: boolean): number {
  if (limitAll) {
    return 0; // No limit (0 means unlimited)
  }
  
  if (!limitStr) {
    return 10; // Default limit
  }
  
  const limit = parseInt(limitStr, 10);
  
  if (isNaN(limit)) {
    throw new Error(`Invalid limit value: ${limitStr}. Must be a number.`);
  }
  
  if (limit < 0) {
    throw new Error(`Invalid limit value: ${limit}. Must be non-negative.`);
  }
  
  if (limit > 10000) {
    throw new Error(`Limit too large: ${limit}. Maximum allowed is 10000.`);
  }
  
  return limit;
}

/**
 * Output query results as JSON
 */
function outputJSON(rows: unknown[], tableName: string): void {
  const output = {
    table: tableName,
    rowCount: rows.length,
    rows: rows
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output query results as formatted table
 */
function outputTable(rows: unknown[], tableName: string, limit: number): void {
  const limitDisplay = limit === 0 ? 'unlimited' : limit.toString();
  console.log(chalk.cyan(`📊 Table: ${tableName} (showing ${rows.length} rows, limit: ${limitDisplay})`));
  console.log();
  
  if (rows.length === 0) {
    console.log(chalk.yellow('No rows found.'));
    return;
  }

  // Get column names from first row
  const firstRow = rows[0] as Record<string, unknown>;
  const columns = Object.keys(firstRow);
  
  // Calculate column widths
  const columnWidths = columns.map(col => {
    const maxContentWidth = Math.max(
      col.length,
      ...rows.map(row => String((row as Record<string, unknown>)[col] || '').length)
    );
    return Math.min(maxContentWidth, 50); // Max width of 50 characters
  });
  
  // Header
  const header = columns.map((col, i) => col.padEnd(columnWidths[i])).join(' | ');
  console.log(chalk.bold(header));
  console.log(columns.map((_, i) => '-'.repeat(columnWidths[i])).join('-|-'));
  
  // Rows
  for (const row of rows) {
    const rowData = row as Record<string, unknown>;
    const formattedRow = columns.map((col, i) => {
      const value = rowData[col];
      let displayValue = String(value || '');
      
      // Truncate long values
      if (displayValue.length > columnWidths[i]) {
        displayValue = displayValue.substring(0, columnWidths[i] - 3) + '...';
      }
      
      return displayValue.padEnd(columnWidths[i]);
    }).join(' | ');
    
    console.log(formattedRow);
  }
  
  console.log();
  console.log(chalk.gray(`💡 Use --json for complete data, --columns to select specific columns, or --limit-all for all rows`));
}