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
    
    const tables = result.rows.map(row => (row as { table_name: string }).table_name);
    
    if (tables.length === 0) {
      console.log(chalk.yellow('No tables found. Run `funcqc scan` to create data.'));
      return;
    }

    for (const table of tables) {
      console.log(chalk.white(`  • ${table}`));
    }
    
    console.log();
    console.log(chalk.gray('Usage: funcqc db --table <table_name> [options]'));
    console.log(chalk.gray('Example: funcqc db --table snapshots --limit 5'));
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
    // Build query
    const columns = options.columns ? options.columns.split(',').map(c => c.trim()).join(', ') : '*';
    let query = `SELECT ${columns} FROM ${tableName}`;
    const params: (string | number)[] = [];
    
    // Add WHERE clause if specified
    if (options.where) {
      query += ` WHERE ${sanitizeWhereClause(options.where)}`;
    }
    
    // Add ORDER BY for consistent results (if the column exists)
    if (tableName === 'snapshots' || tableName === 'functions') {
      query += ` ORDER BY created_at DESC`;
    } else {
      // For tables without created_at, use the first column
      query += ` ORDER BY 1`;
    }
    
    // Add LIMIT
    const limit = options.limit ? parseInt(options.limit, 10) : 10;
    if (limit > 0 && limit <= 1000) { // Safety limit
      query += ` LIMIT ${limit}`;
    }

    const result = await env.storage.query(query, params);
    
    if (result.rows.length === 0) {
      console.log(chalk.yellow(`No data found in table '${tableName}'.`));
      return;
    }

    if (options.json) {
      outputJSON(result.rows, tableName);
    } else {
      outputTable(result.rows, tableName, limit);
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
 * Sanitize WHERE clause for basic safety
 * Note: This is a simple implementation - in production, use parameterized queries
 */
function sanitizeWhereClause(whereClause: string): string {
  // Remove potentially dangerous keywords and characters
  const dangerous = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', '--', ';'];
  let sanitized = whereClause;
  
  for (const keyword of dangerous) {
    const regex = new RegExp(keyword, 'gi');
    if (regex.test(sanitized)) {
      throw new Error(`Dangerous keyword '${keyword}' not allowed in WHERE clause`);
    }
  }
  
  return sanitized;
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
  console.log(chalk.cyan(`📊 Table: ${tableName} (showing ${rows.length} rows, limit: ${limit})`));
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
  console.log(chalk.gray(`💡 Use --json for complete data or --columns to select specific columns`));
}