import { Kysely, sql } from 'kysely';
import * as fs from 'fs/promises';

/**
 * Parse PostgreSQL statements properly, handling dollar-quoted strings
 */
function parsePostgreSQLStatements(content: string): string[] {
  const statements: string[] = [];
  let currentStatement = '';
  let inDollarQuote = false;
  let dollarQuoteTag = '';
  let i = 0;
  
  while (i < content.length) {
    const char = content[i];
    
    if (!inDollarQuote && char === '$') {
      // Check if this is the start of a dollar quote
      // Support both empty dollar quotes $$ and tagged ones $tag$
      const match = content.substring(i).match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/);
      if (match) {
        inDollarQuote = true;
        dollarQuoteTag = match[0];
        currentStatement += dollarQuoteTag;
        i += dollarQuoteTag.length;
        continue;
      }
    } else if (inDollarQuote && char === '$') {
      // Check if this is the end of the current dollar quote
      const endTag = content.substring(i, i + dollarQuoteTag.length);
      if (endTag === dollarQuoteTag) {
        inDollarQuote = false;
        currentStatement += dollarQuoteTag;
        i += dollarQuoteTag.length;
        dollarQuoteTag = '';
        continue;
      }
    }
    
    if (!inDollarQuote && char === ';') {
      // End of statement
      const trimmed = currentStatement.trim();
      if (trimmed) {
        statements.push(addIfNotExists(trimmed));
      }
      currentStatement = '';
    } else {
      currentStatement += char;
    }
    
    i++;
  }
  
  // Add any remaining statement
  const trimmed = currentStatement.trim();
  if (trimmed) {
    statements.push(addIfNotExists(trimmed));
  }
  
  return statements.filter(stmt => stmt.length > 0);
}

/**
 * Add IF NOT EXISTS to CREATE statements for safety
 */
function addIfNotExists(statement: string): string {
  const upperStatement = statement.toUpperCase();
  
  if (upperStatement.startsWith('CREATE TABLE ')) {
    return statement.replace(/CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ');
  }
  if (upperStatement.startsWith('CREATE INDEX ')) {
    return statement.replace(/CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ');
  }
  if (upperStatement.startsWith('CREATE UNIQUE INDEX ')) {
    return statement.replace(/CREATE UNIQUE INDEX /i, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
  }
  if (upperStatement.startsWith('CREATE OR REPLACE FUNCTION')) {
    // Functions with OR REPLACE don't need modification
    return statement;
  }
  if (upperStatement.startsWith('CREATE TRIGGER')) {
    // Triggers don't support IF NOT EXISTS, so we need to drop first
    const triggerMatch = statement.match(/CREATE TRIGGER\s+(\w+)/i);
    if (triggerMatch) {
      const triggerName = triggerMatch[1];
      return `DROP TRIGGER IF EXISTS ${triggerName} ON ${extractTableFromTrigger(statement)}; ${statement}`;
    }
  }
  
  return statement;
}

function extractTableFromTrigger(triggerStatement: string): string {
  const match = triggerStatement.match(/ON\s+(\w+)/i);
  return match ? match[1] : '';
}

/**
 * Execute multiple SQL statements from a schema file
 * PGLite requires statements to be executed individually
 */
async function executeMultipleStatements(db: Kysely<Record<string, unknown>>, sqlContent: string): Promise<void> {
  // Remove comment lines first
  const cleanContent = sqlContent
    .split('\n')
    .filter(line => !line.trim().startsWith('--')) // Remove comment lines
    .join('\n');
  
  // Parse SQL statements properly, handling dollar-quoted strings
  const statements = parsePostgreSQLStatements(cleanContent);

  console.log(`Executing ${statements.length} SQL statements...`);

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    if (statement.trim()) {
      try {
        // Check if this is a multi-statement (DROP + CREATE trigger)
        if (statement.includes('DROP TRIGGER IF EXISTS') && statement.includes('CREATE TRIGGER')) {
          // Split only for the special case of DROP + CREATE trigger statements
          const subStatements = statement.split(';').map(s => s.trim()).filter(s => s.length > 0);
          for (const subStatement of subStatements) {
            await sql.raw(subStatement).execute(db);
          }
        } else {
          // Execute single statement directly - parsing already handled semicolons correctly
          await sql.raw(statement).execute(db);
        }
        
        if (i % 10 === 0) {
          console.log(`   Executed ${i + 1}/${statements.length} statements...`);
        }
      } catch (error) {
        // Log the error but continue with other statements for certain error types
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
          console.log(`   Skipped statement ${i + 1} (already exists): ${statement.substring(0, 50)}...`);
        } else {
          console.error(`Failed to execute statement ${i + 1}:`, statement.substring(0, 100) + '...');
          console.error('Error:', errorMsg);
          throw error;
        }
      }
    }
  }
}

/**
 * 初回マイグレーション: 既存のdatabase.sqlをベースとした完全なスキーマ作成
 * 
 * このマイグレーションは、既存のfuncqcデータベーススキーマを
 * Kyselyマイグレーションシステムに移行するための初回セットアップです。
 */

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  console.log('📋 Creating initial funcqc database schema...');

  try {
    // 既存のdatabase.sqlファイルを読み込み
    const schemaPath = new URL('../schemas/database.sql', import.meta.url).pathname;
    const schemaContent = await fs.readFile(schemaPath, 'utf-8');
    
    // database.sqlの内容を実行
    // 注意: PGLiteでは複数のSQL文を分割して実行する必要がある
    await executeMultipleStatements(db, schemaContent);
    
    console.log('✅ Initial schema created successfully');
    
    // スキーマ作成後の検証（新しいトランザクションで実行）
    await validateInitialSchemaInNewTransaction(db);
    
  } catch (error) {
    console.error('❌ Failed to create initial schema:', error);
    throw error;
  }
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  console.log('🗑️  Dropping all funcqc tables...');

  try {
    // 依存関係を考慮してテーブルを削除
    // 外部キー制約のある子テーブルから順番に削除
    const tablesToDrop = [
      // Level 4: Independent tables
      'lineages',
      'ann_index_metadata',
      
      // Level 3: Dependent tables
      'refactoring_opportunities',
      'session_functions',
      'naming_evaluations',
      'function_embeddings',
      'function_documentation',
      'quality_metrics',
      'function_parameters',
      'function_descriptions',
      
      // Level 2: Core entities
      'functions',
      
      // Level 1: Base tables
      'refactoring_sessions',
      'snapshots'
    ];

    for (const tableName of tablesToDrop) {
      try {
        await sql.raw(`DROP TABLE IF EXISTS ${tableName} CASCADE`).execute(db);
        console.log(`   Dropped table: ${tableName}`);
      } catch (tableError) {
        console.warn(`   Warning: Could not drop table ${tableName}:`, tableError);
        // 個別のテーブル削除エラーは警告のみ（他のテーブル削除を継続）
      }
    }
    
    // 関数とトリガーも削除
    await sql.raw(`DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE`).execute(db);
    await sql.raw(`DROP FUNCTION IF EXISTS mark_function_for_review() CASCADE`).execute(db);
    
    console.log('✅ All tables dropped successfully');
    
  } catch (error) {
    console.error('❌ Failed to drop tables:', error);
    throw error;
  }
}

/**
 * 初回スキーマ作成後の検証（新しいトランザクションで実行）
 */
async function validateInitialSchemaInNewTransaction(db: Kysely<Record<string, unknown>>): Promise<void> {
  // Force a new transaction by committing any existing transaction first
  try {
    await sql.raw('COMMIT').execute(db);
  } catch {
    // Ignore errors - there might not be an active transaction
  }
  
  await validateInitialSchema(db);
}

/**
 * 初回スキーマ作成後の検証
 */
async function validateInitialSchema(db: Kysely<Record<string, unknown>>): Promise<void> {
  console.log('🔍 Validating initial schema...');

  // 必須テーブルの存在確認
  const requiredTables = [
    'snapshots',
    'functions', 
    'function_parameters',
    'quality_metrics',
    'function_descriptions',
    'function_embeddings',
    'naming_evaluations',
    'lineages',
    'ann_index_metadata',
    'refactoring_sessions',
    'session_functions',
    'refactoring_opportunities',
    'refactoring_changesets',
    'function_documentation'
  ];

  const missingTables: string[] = [];

  for (const tableName of requiredTables) {
    try {
      const result = await sql.raw(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = '${tableName}'
        )
      `).execute(db);
      
      const existsRow = result.rows[0] as Record<string, unknown>;
      const exists = existsRow?.['exists'];
      if (!exists) {
        missingTables.push(tableName);
      }
    } catch (error) {
      console.warn(`Could not verify table ${tableName}:`, error);
      missingTables.push(tableName);
    }
  }

  if (missingTables.length > 0) {
    throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
  }

  // 重要なインデックスの存在確認（一部のみ）
  const criticalIndexes = [
    'idx_functions_snapshot_id',
    'idx_functions_semantic_id',
    'idx_functions_content_id',
    'idx_quality_metrics_complexity'
  ];

  for (const indexName of criticalIndexes) {
    try {
      const result = await sql.raw(`
        SELECT EXISTS (
          SELECT FROM pg_indexes 
          WHERE indexname = '${indexName}'
        )
      `).execute(db);
      
      const indexExistsRow = result.rows[0] as Record<string, unknown>;
      const exists = indexExistsRow?.['exists'];
      if (!exists) {
        console.warn(`⚠️  Critical index missing: ${indexName}`);
      }
    } catch (error) {
      console.warn(`Could not verify index ${indexName}:`, error);
    }
  }

  // 基本的な関数とトリガーの存在確認
  try {
    const result = await sql.raw(`
      SELECT EXISTS (
        SELECT FROM pg_proc 
        WHERE proname = 'update_updated_at_column'
      )
    `).execute(db);
    
    const functionExistsRow = result.rows[0] as Record<string, unknown>;
    if (!functionExistsRow?.['exists']) {
      console.warn('⚠️  Warning: update_updated_at_column function not found');
    }
  } catch (error) {
    console.warn('Could not verify functions:', error);
  }

  console.log('✅ Schema validation completed');
}