import { Kysely, sql } from 'kysely';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 初回マイグレーション: 既存のdatabase.sqlをベースとした完全なスキーマ作成
 * 
 * このマイグレーションは、既存のfuncqcデータベーススキーマを
 * Kyselyマイグレーションシステムに移行するための初回セットアップです。
 */

export async function up(db: Kysely<any>): Promise<void> {
  console.log('📋 Creating initial funcqc database schema...');

  try {
    // 既存のdatabase.sqlファイルを読み込み
    const schemaPath = path.join(__dirname, '../schemas/database.sql');
    const schemaContent = await fs.readFile(schemaPath, 'utf-8');
    
    // database.sqlの内容を実行
    // 注意: PGLiteではsql.rawを使用してDDL文を実行
    await sql.raw(schemaContent).execute(db);
    
    console.log('✅ Initial schema created successfully');
    
    // スキーマ作成後の検証
    await validateInitialSchema(db);
    
  } catch (error) {
    console.error('❌ Failed to create initial schema:', error);
    throw error;
  }
}

export async function down(db: Kysely<any>): Promise<void> {
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
 * 初回スキーマ作成後の検証
 */
async function validateInitialSchema(db: Kysely<any>): Promise<void> {
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
      
      const exists = (result.rows[0] as any)?.exists;
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
      
      const exists = (result.rows[0] as any)?.exists;
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
    
    if (!(result.rows[0] as any)?.exists) {
      console.warn('⚠️  Warning: update_updated_at_column function not found');
    }
  } catch (error) {
    console.warn('Could not verify functions:', error);
  }

  console.log('✅ Schema validation completed');
}