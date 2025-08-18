import chalk from 'chalk';
import { DbCommandOptions } from '../../types';
import { ErrorCode, createErrorHandler, type DatabaseErrorLike } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { IDResolver } from '../../utils/id-resolver';

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
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  funcqc db --list  # Show all tables'));
        console.log(chalk.gray('  funcqc db --table snapshots --limit 5'));
        console.log(chalk.gray('  funcqc db --table call_edges --where "call_type=\'external\'" --limit 5'));
        console.log(chalk.gray('  funcqc db --table functions --where "name LIKE \'analyze%\'" --limit 5'));
        console.log(chalk.gray('  funcqc db --table call_edges --where "caller_function_id=\'a1b2c3d4\'" --limit 10  # Short ID expansion'));
        return;
      }

      await queryTable(env, options);
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
    
    const rows = extractRows(result) as Array<{ table_name?: string }>;
    const tables = rows.map(r => r.table_name).filter(Boolean) as string[];
    
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
    console.log(chalk.gray('  funcqc db --table call_edges --where "call_type=\'external\'" --limit 10'));
    console.log(chalk.gray('  funcqc db --table functions --where "cyclomatic_complexity>10" --json'));
    console.log(chalk.gray('  funcqc db --table functions --where "name LIKE \'analyze%\'" --limit 5'));
    console.log(chalk.gray('  funcqc db --table call_edges --where "caller_function_id=\'a1b2c3d4\'" --limit 10  # Short ID auto-expansion'));
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
  
  // Special handling for common tables using storage API
  if (tableName === 'snapshots' && !options.where) {
    await querySnapshotsViaStorage(env, options);
    return;
  }
  
  if (tableName === 'functions' && !options.where) {
    await queryFunctionsViaStorage(env, options);
    return;
  }
  
  // Special handling for edge tables using Storage API (more efficient)
  if (tableName === 'call_edges' && !options.where) {
    await queryCallEdgesViaStorage(env, options);
    return;
  }
  
  if (tableName === 'internal_call_edges' && !options.where) {
    await queryInternalCallEdgesViaStorage(env, options);
    return;
  }
  
  // Special handling for type system tables using Storage API
  if (tableName === 'type_definitions' && !options.where) {
    await queryTypeDefinitionsViaStorage(env, options);
    return;
  }
  
  if (tableName === 'type_relationships' && !options.where) {
    await queryTypeRelationshipsViaStorage(env, options);
    return;
  }
  
  if (tableName === 'type_members' && !options.where) {
    await queryTypeMembersViaStorage(env, options);
    return;
  }
  
  if (tableName === 'method_overrides' && !options.where) {
    await queryMethodOverridesViaStorage(env, options);
    return;
  }
  
  // For other cases, use direct SQL query
  await queryTableDirect(env, options);
}

/**
 * Query snapshots using storage API
 */
async function querySnapshotsViaStorage(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const limit = validateAndParseLimit(options.limit, options.limitAll);
  const snapshots = await env.storage.getSnapshots({ limit });
  
  if (options.json) {
    console.log(JSON.stringify({ rows: snapshots }, null, 2));
  } else {
    if (snapshots.length === 0) {
      console.log(chalk.yellow('No data found in table \'snapshots\'.'));
    } else {
      console.log(chalk.cyan('Query Results:'));
      console.table(snapshots);
    }
  }
}

/**
 * Query call_edges using Storage API
 */
async function queryCallEdgesViaStorage(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const limit = validateAndParseLimit(options.limit, options.limitAll);
  
  // Get latest snapshot
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return;
  }
  
  const latestSnapshot = snapshots[0];
  const callEdges = await env.storage.getCallEdgesBySnapshot(latestSnapshot.id);
  
  // Apply limit if specified
  const limitedEdges = limit > 0 ? callEdges.slice(0, limit) : callEdges;
  
  if (options.json) {
    console.log(JSON.stringify({ 
      table: 'call_edges',
      snapshot: latestSnapshot.id,
      rowCount: limitedEdges.length,
      totalCount: callEdges.length,
      rows: limitedEdges 
    }, null, 2));
  } else {
    if (limitedEdges.length === 0) {
      console.log(chalk.yellow('No call edges found in latest snapshot.'));
    } else {
      const limitDisplay = limit === 0 ? 'unlimited' : limit.toString();
      console.log(chalk.cyan(`📊 Table: call_edges (showing ${limitedEdges.length} of ${callEdges.length} rows, limit: ${limitDisplay})`));
      console.log();
      
      // Convert to display format
      const displayData = limitedEdges.map(edge => ({
        id: edge.id || 'N/A',
        caller_function_id: edge.callerFunctionId,
        callee_function_id: edge.calleeFunctionId || 'N/A',
        callee_name: edge.calleeName || 'N/A',
        call_type: edge.callType || 'N/A',
        line_number: edge.lineNumber || 'N/A',
        column_number: edge.columnNumber || 'N/A'
      }));
      
      console.table(displayData);
      console.log();
      console.log(chalk.gray(`📍 Data from snapshot: ${latestSnapshot.id.substring(0, 8)}... (${new Date(latestSnapshot.createdAt).toLocaleString()})`));
      console.log(chalk.gray(`💡 Use --json for complete data or --limit-all for all ${callEdges.length} rows`));
    }
  }
}

/**
 * Query internal_call_edges using Storage API
 */
async function queryInternalCallEdgesViaStorage(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const limit = validateAndParseLimit(options.limit, options.limitAll);
  
  // Get latest snapshot
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return;
  }
  
  const latestSnapshot = snapshots[0];
  const internalEdges = await env.storage.getInternalCallEdgesBySnapshot(latestSnapshot.id);
  
  // Apply limit if specified
  const limitedEdges = limit > 0 ? internalEdges.slice(0, limit) : internalEdges;
  
  if (options.json) {
    console.log(JSON.stringify({ 
      table: 'internal_call_edges',
      snapshot: latestSnapshot.id,
      rowCount: limitedEdges.length,
      totalCount: internalEdges.length,
      rows: limitedEdges 
    }, null, 2));
  } else {
    if (limitedEdges.length === 0) {
      console.log(chalk.yellow('No internal call edges found in latest snapshot.'));
    } else {
      const limitDisplay = limit === 0 ? 'unlimited' : limit.toString();
      console.log(chalk.cyan(`📊 Table: internal_call_edges (showing ${limitedEdges.length} of ${internalEdges.length} rows, limit: ${limitDisplay})`));
      console.log();
      
      // Convert to display format
      const displayData = limitedEdges.map(edge => ({
        id: edge.id || 'N/A',
        file_path: edge.filePath,
        caller_function_id: edge.callerFunctionId,
        callee_function_id: edge.calleeFunctionId,
        caller_name: edge.callerName || 'N/A',
        callee_name: edge.calleeName || 'N/A',
        line_number: edge.lineNumber || 'N/A',
        call_type: edge.callType || 'N/A'
      }));
      
      console.table(displayData);
      console.log();
      console.log(chalk.gray(`📍 Data from snapshot: ${latestSnapshot.id.substring(0, 8)}... (${new Date(latestSnapshot.createdAt).toLocaleString()})`));
      console.log(chalk.gray(`💡 Use --json for complete data or --limit-all for all ${internalEdges.length} rows`));
    }
  }
}


/**
 * Query functions using storage API
 */
async function queryFunctionsViaStorage(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const limit = validateAndParseLimit(options.limit, options.limitAll);
  
  // Get latest snapshot
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return;
  }
  
  const functions = await env.storage.findFunctionsInSnapshot(snapshots[0].id, { limit });
  
  if (options.json) {
    console.log(JSON.stringify({ rows: functions }, null, 2));
  } else {
    if (functions.length === 0) {
      console.log(chalk.yellow('No data found in table \'functions\'.'));
    } else {
      console.log(chalk.cyan('Query Results:'));
      console.table(functions.map(f => ({
        id: f.id,
        name: f.name,
        file_path: f.filePath,
        cyclomatic_complexity: f.metrics?.cyclomaticComplexity || 0,
        lines_of_code: f.metrics?.linesOfCode || 0
      })));
    }
  }
}

/**
 * Query table directly with SQL
 */
async function queryTableDirect(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const tableName = options.table!;
  
  // Validate table name to prevent SQL injection
  if (!isValidTableName(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  try {
    // Build base query
    const columns = options.columns ? validateAndBuildColumns(options.columns) : '*';
    let query = buildSelectQuery(tableName, columns);
    let params: (string | number)[] = [];
    
    // Add WHERE clause if specified
    if (options.where) {
      const whereResult = await addWhereClause(query, options.where, params, env);
      query = whereResult.query;
      params = whereResult.params;
    }
    
    // Add ORDER BY clause
    query = addOrderByClause(query, tableName);
    
    // Add LIMIT clause
    const limit = validateAndParseLimit(options.limit, options.limitAll);
    const limitResult = addLimitClause(query, params, limit);
    query = limitResult.query;
    params = limitResult.params;

    // Execute query
    const result = await env.storage.query(query, params);
    logQueryResults(result);
    
    // Process and output results
    const rows = extractRows(result);
    handleQueryOutput(rows, tableName, limit, options);
    
  } catch (error) {
    throw new Error(`Failed to query table '${tableName}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Build the base SELECT query with columns
 */
function buildSelectQuery(tableName: string, columns: string): string {
  return `SELECT ${columns} FROM ${tableName}`;
}

/**
 * Add WHERE clause to query with parameters and ID resolution
 */
async function addWhereClause(
  query: string, 
  whereCondition: string, 
  params: (string | number)[],
  env: CommandEnvironment
): Promise<{ query: string; params: (string | number)[] }> {
  const { whereClause, whereParams } = await buildParameterizedWhereClause(whereCondition, params.length, env);
  const updatedQuery = `${query} WHERE ${whereClause}`;
  const updatedParams = [...params, ...whereParams];
  
  logWhereClause(whereClause, whereParams, updatedQuery, updatedParams);
  
  return { query: updatedQuery, params: updatedParams };
}

/**
 * Add ORDER BY clause based on table type
 */
function addOrderByClause(query: string, tableName: string): string {
  if (tableName === 'snapshots' || tableName === 'functions') {
    return `${query} ORDER BY created_at DESC`;
  } else {
    return `${query} ORDER BY 1`;
  }
}

/**
 * Add LIMIT clause with proper parameterization
 */
function addLimitClause(
  query: string, 
  params: (string | number)[], 
  limit: number
): { query: string; params: (string | number)[] } {
  if (limit <= 0) {
    return { query, params };
  }
  
  if (params.length > 0) {
    return {
      query: `${query} LIMIT $${params.length + 1}`,
      params: [...params, limit]
    };
  } else {
    return {
      query: `${query} LIMIT ${limit}`,
      params
    };
  }
}

/**
 * Log WHERE clause debug information
 */
function logWhereClause(
  whereClause: string, 
  whereParams: (string | number)[], 
  fullQuery: string, 
  allParams: (string | number)[]
): void {
  if (process.env['DEBUG_DB']) {
    console.log(`Debug: WHERE clause: "${whereClause}"`);
    console.log(`Debug: WHERE params: [${whereParams.join(', ')}]`);
    console.log(`Debug: Full query: ${fullQuery}`);
    console.log(`Debug: All params: [${allParams.join(', ')}]`);
  }
}

/**
 * Log query execution results
 */
function logQueryResults(result: unknown): void {
  if (process.env['DEBUG_DB']) {
    console.log(`Debug: Query executed successfully`);
    const rowCount = result && typeof result === 'object' && 'rows' in result 
      ? (result as { rows: unknown[] }).rows.length 
      : 0;
    console.log(`Debug: Result rows count: ${rowCount}`);
  }
}

/**
 * Extract rows from PGLite query result
 */
function extractRows(result: unknown): unknown[] {
  return (result && typeof result === 'object' && 'rows' in result) 
    ? (result as { rows: unknown[] }).rows || []
    : [];
}

/**
 * Handle query results output
 */
function handleQueryOutput(
  rows: unknown[], 
  tableName: string, 
  limit: number, 
  options: DbCommandOptions
): void {
  if (rows.length === 0) {
    console.log(chalk.yellow(`No data found in table '${tableName}'.`));
    return;
  }

  if (options.json) {
    outputJSON(rows, tableName);
  } else {
    outputTable(rows, tableName, limit);
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
 * Build parameterized WHERE clause from simple conditions with ID resolution
 * Supports: column=value, column>value, column LIKE 'pattern%', short ID expansion
 */
async function buildParameterizedWhereClause(
  whereClause: string, 
  paramOffset: number, 
  env: CommandEnvironment
): Promise<{ whereClause: string; whereParams: (string | number)[] }> {
  // First, validate for dangerous patterns
  validateWhereClauseSafety(whereClause);
  
  // Initialize ID resolver for short ID expansion
  const idResolver = new IDResolver(env);
  
  // Parse simple conditions (column operator value)
  const params: (string | number)[] = [];
  let parameterizedClause = whereClause;
  let currentParamIndex = paramOffset + 1;
  
  // Enhanced patterns that include multi-character operators and ILIKE
  const patterns = [
    // String values with single quotes: supports >=, <=, <>, !=, LIKE, ILIKE
    /([a-zA-Z_][a-zA-Z0-9_.]*)(\s*(?:>=|<=|<>|!=|=|>|<|LIKE|ILIKE)\s*)'([^']*)'/gi,
    // String values with double quotes: supports >=, <=, <>, !=, LIKE, ILIKE
    /([a-zA-Z_][a-zA-Z0-9_.]*)(\s*(?:>=|<=|<>|!=|=|>|<|LIKE|ILIKE)\s*)"([^"]*)"/gi,
    // Numeric values: supports all multi-character operators
    /([a-zA-Z_][a-zA-Z0-9_.]*)(\s*(?:>=|<=|<>|!=|=|>|<)\s*)(\d+(?:\.\d+)?)/g
  ];
  
  // Handle string values with single quotes (including LIKE patterns)
  const singleQuoteMatches = Array.from(whereClause.matchAll(patterns[0]));
  for (const match of singleQuoteMatches) {
    const [fullMatch, column, operator, value] = match;
    
    if (!isValidColumnName(column)) {
      throw new Error(`Invalid column name in WHERE clause: ${column}`);
    }
    
    let processedValue = value;
    const isLike = /\bLIKE\b/i.test(operator);
    
    // Try to resolve short IDs if this looks like an ID field and value looks like a short ID
    if (isIDField(column) && idResolver.isShortID(value)) {
      try {
        const resolved = await idResolver.resolveID(value, { minConfidence: 'high' });
        if (resolved && resolved.confidence !== 'low') {
          processedValue = resolved.id;
          if (process.env['DEBUG_DB']) {
            console.log(`Debug: Expanded short ID '${value}' to '${processedValue}' for column '${column}'`);
          }
        }
      } catch (error) {
        // If ID resolution fails, continue with original value
        if (process.env['DEBUG_DB']) {
          console.log(`Debug: ID resolution failed for '${value}': ${error}`);
        }
      }
    } else if (isIDField(column) && isLike) {
      // Support patterns like 'a1b2c3d4%' -> expand only if uniquely resolvable
      const m = value.match(/^([a-f0-9]{8})([%_].*)?$/i);
      if (m) {
        const shortPart = m[1];
        const suffix = m[2] ?? '';
        try {
          const resolved = await idResolver.resolveID(shortPart, { minConfidence: 'exact' });
          if (resolved && resolved.confidence === 'exact') {
            processedValue = resolved.id + suffix;
            if (process.env['DEBUG_DB']) {
              console.log(`Debug: Expanded LIKE short ID '${value}' -> '${processedValue}' for column '${column}'`);
            }
          }
        } catch (error) {
          if (process.env['DEBUG_DB']) {
            console.log(`Debug: LIKE short ID resolution failed for '${value}': ${error}`);
          }
        }
      }
    }
    
    params.push(processedValue);
    const replacement = `${column}${operator}$${currentParamIndex++}`;
    parameterizedClause = parameterizedClause.replace(fullMatch, replacement);
  }
  
  // Handle string values with double quotes (including LIKE patterns)
  const doubleQuoteMatches = Array.from(parameterizedClause.matchAll(patterns[1]));
  for (const match of doubleQuoteMatches) {
    const [fullMatch, column, operator, value] = match;
    
    if (!isValidColumnName(column)) {
      throw new Error(`Invalid column name in WHERE clause: ${column}`);
    }
    
    let processedValue = value;
    const isLike = /\bLIKE\b/i.test(operator);
    
    // Try to resolve short IDs if this looks like an ID field and value looks like a short ID
    if (isIDField(column) && idResolver.isShortID(value)) {
      try {
        const resolved = await idResolver.resolveID(value, { minConfidence: 'high' });
        if (resolved && resolved.confidence !== 'low') {
          processedValue = resolved.id;
          if (process.env['DEBUG_DB']) {
            console.log(`Debug: Expanded short ID '${value}' to '${processedValue}' for column '${column}'`);
          }
        }
      } catch (error) {
        // If ID resolution fails, continue with original value
        if (process.env['DEBUG_DB']) {
          console.log(`Debug: ID resolution failed for '${value}': ${error}`);
        }
      }
    } else if (isIDField(column) && isLike) {
      // Support patterns like "a1b2c3d4%" -> expand only if uniquely resolvable
      const m = value.match(/^([a-f0-9]{8})([%_].*)?$/i);
      if (m) {
        const shortPart = m[1];
        const suffix = m[2] ?? '';
        try {
          const resolved = await idResolver.resolveID(shortPart, { minConfidence: 'exact' });
          if (resolved && resolved.confidence === 'exact') {
            processedValue = resolved.id + suffix;
            if (process.env['DEBUG_DB']) {
              console.log(`Debug: Expanded LIKE short ID '${value}' -> '${processedValue}' for column '${column}'`);
            }
          }
        } catch (error) {
          if (process.env['DEBUG_DB']) {
            console.log(`Debug: LIKE short ID resolution failed for '${value}': ${error}`);
          }
        }
      }
    }
    
    params.push(processedValue);
    const replacement = `${column}${operator}$${currentParamIndex++}`;
    parameterizedClause = parameterizedClause.replace(fullMatch, replacement);
  }
  
  // Handle numeric values
  const numericMatches = Array.from(parameterizedClause.matchAll(patterns[2]));
  for (const match of numericMatches) {
    const [fullMatch, column, operator, value] = match;
    
    if (!isValidColumnName(column)) {
      throw new Error(`Invalid column name in WHERE clause: ${column}`);
    }
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      throw new Error(`Invalid numeric value in WHERE clause: ${value}`);
    }
    
    params.push(numValue);
    const replacement = `${column}${operator}$${currentParamIndex++}`;
    parameterizedClause = parameterizedClause.replace(fullMatch, replacement);
  }
  
  return { whereClause: parameterizedClause, whereParams: params };
}

/**
 * Check if a column name indicates it contains ID values
 */
function isIDField(columnName: string): boolean {
  const lowerName = columnName.toLowerCase();
  return lowerName.includes('id') || 
         lowerName.includes('function_id') ||
         lowerName.includes('caller_function_id') ||
         lowerName.includes('callee_function_id') ||
         lowerName.includes('type_id') ||
         lowerName.includes('snapshot_id');
}

/**
 * Validate WHERE clause for dangerous patterns
 * Now allows LIKE operator and % wildcards for pattern matching
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
  
  // Additional pattern checks - now allows % for LIKE patterns and LIKE keyword
  if (upperClause.match(/[^a-zA-Z0-9\s=><'"._(),%-]/)) {
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
  
  // Show quick debug suggestions if result count is low
  if (rows.length < 5 && limit >= 5) {
    console.log(chalk.yellow(`💡 Debug tip: Try removing WHERE clause or increasing --limit for more data`));
  }
}

/**
 * Query type_definitions using Storage API
 */
async function queryTypeDefinitionsViaStorage(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const limit = validateAndParseLimit(options.limit, options.limitAll);
  
  // Get latest snapshot
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return;
  }
  
  const latestSnapshot = snapshots[0];
  const typeDefinitions = await env.storage.getTypeDefinitions(latestSnapshot.id);
  
  // Apply limit if specified
  const limitedTypes = limit > 0 ? typeDefinitions.slice(0, limit) : typeDefinitions;
  
  if (options.json) {
    console.log(JSON.stringify({ 
      table: 'type_definitions',
      snapshot: latestSnapshot.id,
      rowCount: limitedTypes.length,
      totalCount: typeDefinitions.length,
      rows: limitedTypes 
    }, null, 2));
  } else {
    if (limitedTypes.length === 0) {
      console.log(chalk.yellow('No type definitions found in latest snapshot.'));
      console.log(chalk.gray('Type information may not be available. Make sure type extraction is enabled.'));
    } else {
      const limitDisplay = limit === 0 ? 'unlimited' : limit.toString();
      console.log(chalk.cyan(`📊 Table: type_definitions (showing ${limitedTypes.length} of ${typeDefinitions.length} rows, limit: ${limitDisplay})`));
      console.log();
      
      // Convert to display format
      const displayData = limitedTypes.map(type => ({
        id: type.id.substring(0, 8) + '...',
        name: type.name,
        kind: type.kind,
        file_path: type.filePath.replace(process.cwd(), '.'),
        start_line: type.startLine,
        is_exported: type.isExported ? 'yes' : 'no',
        is_generic: type.isGeneric ? 'yes' : 'no'
      }));
      
      console.table(displayData);
      console.log();
      console.log(chalk.gray(`📍 Data from snapshot: ${latestSnapshot.id.substring(0, 8)}... (${new Date(latestSnapshot.createdAt).toLocaleString()})`));
      console.log(chalk.gray(`💡 Use --json for complete data or --limit-all for all ${typeDefinitions.length} rows`));
    }
  }
}

/**
 * Query type_relationships using Storage API
 */
async function queryTypeRelationshipsViaStorage(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const limit = validateAndParseLimit(options.limit, options.limitAll);
  
  // Get latest snapshot
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return;
  }
  
  const latestSnapshot = snapshots[0];
  const relationships = await env.storage.getTypeRelationships(latestSnapshot.id);
  
  // Apply limit if specified
  const limitedRelationships = limit > 0 ? relationships.slice(0, limit) : relationships;
  
  if (options.json) {
    console.log(JSON.stringify({ 
      table: 'type_relationships',
      snapshot: latestSnapshot.id,
      rowCount: limitedRelationships.length,
      totalCount: relationships.length,
      rows: limitedRelationships 
    }, null, 2));
  } else {
    if (limitedRelationships.length === 0) {
      console.log(chalk.yellow('No type relationships found in latest snapshot.'));
    } else {
      const limitDisplay = limit === 0 ? 'unlimited' : limit.toString();
      console.log(chalk.cyan(`📊 Table: type_relationships (showing ${limitedRelationships.length} of ${relationships.length} rows, limit: ${limitDisplay})`));
      console.log();
      
      // Convert to display format
      const displayData = limitedRelationships.map(rel => ({
        id: rel.id.substring(0, 8) + '...',
        source_type_id: rel.sourceTypeId.substring(0, 8) + '...',
        target_name: rel.targetName,
        relationship_kind: rel.relationshipKind,
        confidence_score: rel.confidenceScore.toFixed(2)
      }));
      
      console.table(displayData);
      console.log();
      console.log(chalk.gray(`📍 Data from snapshot: ${latestSnapshot.id.substring(0, 8)}... (${new Date(latestSnapshot.createdAt).toLocaleString()})`));
      console.log(chalk.gray(`💡 Use --json for complete data or --limit-all for all ${relationships.length} rows`));
    }
  }
}

/**
 * Query type_members using Storage API
 */
async function queryTypeMembersViaStorage(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const limit = validateAndParseLimit(options.limit, options.limitAll);
  
  // Get latest snapshot
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return;
  }
  
  const latestSnapshot = snapshots[0];
  // Since getTypeMembers requires a typeId, we'll get all type definitions first
  const typeDefinitions = await env.storage.getTypeDefinitions(latestSnapshot.id);
  
  if (typeDefinitions.length === 0) {
    console.log(chalk.yellow('No type definitions found. Cannot query type members.'));
    return;
  }
  
  // Get members for all types (this could be optimized)
  const allMembers = [];
  for (const type of typeDefinitions.slice(0, Math.min(10, typeDefinitions.length))) {
    const members = await env.storage.getTypeMembers(type.id);
    allMembers.push(...members);
  }
  
  // Apply limit if specified
  const limitedMembers = limit > 0 ? allMembers.slice(0, limit) : allMembers;
  
  if (options.json) {
    console.log(JSON.stringify({ 
      table: 'type_members',
      snapshot: latestSnapshot.id,
      rowCount: limitedMembers.length,
      totalCount: allMembers.length,
      rows: limitedMembers 
    }, null, 2));
  } else {
    if (limitedMembers.length === 0) {
      console.log(chalk.yellow('No type members found in latest snapshot.'));
    } else {
      const limitDisplay = limit === 0 ? 'unlimited' : limit.toString();
      console.log(chalk.cyan(`📊 Table: type_members (showing ${limitedMembers.length} of ${allMembers.length} rows, limit: ${limitDisplay})`));
      console.log();
      
      // Convert to display format
      const displayData = limitedMembers.map(member => ({
        id: member.id.substring(0, 8) + '...',
        type_id: member.typeId.substring(0, 8) + '...',
        name: member.name,
        member_kind: member.memberKind,
        is_static: member.isStatic ? 'yes' : 'no',
        access_modifier: member.accessModifier || 'public'
      }));
      
      console.table(displayData);
      console.log();
      console.log(chalk.gray(`📍 Data from snapshot: ${latestSnapshot.id.substring(0, 8)}... (${new Date(latestSnapshot.createdAt).toLocaleString()})`));
      console.log(chalk.gray(`💡 Use --json for complete data or --limit-all for all ${allMembers.length} rows`));
    }
  }
}

/**
 * Query method_overrides using Storage API
 */
async function queryMethodOverridesViaStorage(env: CommandEnvironment, options: DbCommandOptions): Promise<void> {
  const limit = validateAndParseLimit(options.limit, options.limitAll);
  
  // Get latest snapshot
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return;
  }
  
  const latestSnapshot = snapshots[0];
  const overrides = await env.storage.getMethodOverrides(latestSnapshot.id);
  
  // Apply limit if specified
  const limitedOverrides = limit > 0 ? overrides.slice(0, limit) : overrides;
  
  if (options.json) {
    console.log(JSON.stringify({ 
      table: 'method_overrides',
      snapshot: latestSnapshot.id,
      rowCount: limitedOverrides.length,
      totalCount: overrides.length,
      rows: limitedOverrides 
    }, null, 2));
  } else {
    if (limitedOverrides.length === 0) {
      console.log(chalk.yellow('No method overrides found in latest snapshot.'));
    } else {
      const limitDisplay = limit === 0 ? 'unlimited' : limit.toString();
      console.log(chalk.cyan(`📊 Table: method_overrides (showing ${limitedOverrides.length} of ${overrides.length} rows, limit: ${limitDisplay})`));
      console.log();
      
      // Convert to display format
      const displayData = limitedOverrides.map(override => ({
        id: override.id.substring(0, 8) + '...',
        method_member_id: override.methodMemberId.substring(0, 8) + '...',
        source_type_id: override.sourceTypeId.substring(0, 8) + '...',
        override_kind: override.overrideKind,
        is_compatible: override.isCompatible ? 'yes' : 'no',
        confidence_score: override.confidenceScore.toFixed(2)
      }));
      
      console.table(displayData);
      console.log();
      console.log(chalk.gray(`📍 Data from snapshot: ${latestSnapshot.id.substring(0, 8)}... (${new Date(latestSnapshot.createdAt).toLocaleString()})`));
      console.log(chalk.gray(`💡 Use --json for complete data or --limit-all for all ${overrides.length} rows`));
    }
  }
}