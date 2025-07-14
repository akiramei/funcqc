import { Kysely, sql } from 'kysely';

/**
 * データ保全用ヘルパー関数
 * スキーマ変更時に既存データを安全に保護するためのユーティリティ
 */

/**
 * テーブルデータをOLD_プレフィックス付きでバックアップ
 * 
 * @param db Kyselyデータベースインスタンス
 * @param tableName バックアップ対象のテーブル名
 * @param version バージョン文字列（省略時は現在のタイムスタンプ）
 * @returns バックアップテーブル名
 */
export async function preserveTableData(
  db: Kysely<Record<string, unknown>>, 
  tableName: string,
  version?: string
): Promise<string> {
  const timestamp = version || new Date().toISOString().substring(0, 19).replace(/[:-]/g, '_');
  const backupTableName = `OLD_${tableName}_${timestamp}`;
  
  console.log(`📦 Preserving ${tableName} as ${backupTableName}...`);
  
  try {
    // テーブルが存在するかチェック
    const tableExists = await checkTableExists(db, tableName);
    if (!tableExists) {
      console.log(`⚠️  Table ${tableName} does not exist, skipping preservation`);
      return backupTableName;
    }
    
    // データの行数をチェック
    const result = await sql.raw(`SELECT COUNT(*) as count FROM ${tableName}`).execute(db);
    const row = result.rows[0] as Record<string, unknown>;
    const rowCount = parseInt(row?.['count'] as string || '0');
    
    if (rowCount === 0) {
      console.log(`⚠️  Table ${tableName} is empty, skipping preservation`);
      return backupTableName;
    }
    
    // バックアップテーブルが既に存在する場合は削除
    await sql.raw(`DROP TABLE IF EXISTS ${backupTableName}`).execute(db);
    
    // CREATE TABLE AS SELECT でデータをコピー
    await sql.raw(`
      CREATE TABLE ${backupTableName} AS 
      SELECT * FROM ${tableName}
    `).execute(db);
    
    // 保存されたデータの行数を確認
    const backupResult = await sql.raw(`SELECT COUNT(*) as count FROM ${backupTableName}`).execute(db);
    const backupRow = backupResult.rows[0] as Record<string, unknown>;
    const backupRowCount = parseInt(backupRow?.['count'] as string || '0');
    
    if (backupRowCount !== rowCount) {
      throw new Error(`Data preservation failed: ${rowCount} rows in source, ${backupRowCount} rows in backup`);
    }
    
    console.log(`✅ Preserved ${rowCount} rows from ${tableName} to ${backupTableName}`);
    return backupTableName;
    
  } catch (error) {
    console.error(`❌ Failed to preserve table ${tableName}:`, error);
    throw error;
  }
}

/**
 * 複数のテーブルを一括でバックアップ
 * 
 * @param db Kyselyデータベースインスタンス
 * @param tableNames バックアップ対象のテーブル名配列
 * @param version バージョン文字列（省略時は現在のタイムスタンプ）
 * @returns バックアップテーブル名のマップ
 */
export async function preserveMultipleTables(
  db: Kysely<Record<string, unknown>>,
  tableNames: string[],
  version?: string
): Promise<Map<string, string>> {
  const backupMap = new Map<string, string>();
  const timestamp = version || new Date().toISOString().substring(0, 19).replace(/[:-]/g, '_');
  
  console.log(`📦 Preserving ${tableNames.length} tables with version ${timestamp}...`);
  
  for (const tableName of tableNames) {
    try {
      const backupTableName = await preserveTableData(db, tableName, timestamp);
      backupMap.set(tableName, backupTableName);
    } catch {
      console.error(`Failed to preserve table ${tableName}, continuing with others...`);
      // 他のテーブルのバックアップは継続
    }
  }
  
  return backupMap;
}

/**
 * テーブルの存在確認
 */
export async function checkTableExists(db: Kysely<Record<string, unknown>>, tableName: string): Promise<boolean> {
  try {
    const result = await sql.raw(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '${tableName}'
      )
    `).execute(db);
    
    const existsRow = result.rows[0] as Record<string, unknown>;
    return existsRow?.['exists'] === true;
  } catch (error) {
    console.warn(`Could not check existence of table ${tableName}:`, error);
    return false;
  }
}

/**
 * カラムの存在確認
 */
export async function checkColumnExists(
  db: Kysely<Record<string, unknown>>, 
  tableName: string, 
  columnName: string
): Promise<boolean> {
  try {
    const result = await sql.raw(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = '${tableName}' 
        AND column_name = '${columnName}'
      )
    `).execute(db);
    
    const columnExistsRow = result.rows[0] as Record<string, unknown>;
    return columnExistsRow?.['exists'] === true;
  } catch (error) {
    console.warn(`Could not check existence of column ${columnName} in ${tableName}:`, error);
    return false;
  }
}

/**
 * 古いバックアップテーブルのクリーンアップ
 * 
 * @param db Kyselyデータベースインスタンス
 * @param daysOld 削除対象の日数（デフォルト30日）
 */
// Constants for better maintainability
const DEFAULT_CLEANUP_DAYS = 30;
const BACKUP_TABLE_PREFIX = 'OLD_';
const DATE_PATTERN = /(\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2})/;

export async function cleanupOldBackups(db: Kysely<Record<string, unknown>>, daysOld: number = DEFAULT_CLEANUP_DAYS): Promise<void> {
  console.log(`🧹 Cleaning up backup tables older than ${daysOld} days...`);
  
  try {
    const backupTables = await getBackupTables(db);
    const cutoffDate = calculateCutoffDate(daysOld);
    const deletedCount = await deleteOldBackupTables(db, backupTables, cutoffDate);
    
    console.log(`✅ Cleaned up ${deletedCount} old backup tables`);
  } catch (error) {
    console.error('Failed to cleanup old backups:', error);
    throw error;
  }
}

/**
 * Get all backup tables from the database
 */
async function getBackupTables(db: Kysely<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const result = await sql.raw(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename LIKE '${BACKUP_TABLE_PREFIX}%'
  `).execute(db);
  
  return result.rows as Array<Record<string, unknown>>;
}

/**
 * Calculate the cutoff date for cleanup
 */
function calculateCutoffDate(daysOld: number): Date {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  return cutoffDate;
}

/**
 * Delete backup tables older than the cutoff date
 */
async function deleteOldBackupTables(
  db: Kysely<Record<string, unknown>>, 
  tables: Array<Record<string, unknown>>, 
  cutoffDate: Date
): Promise<number> {
  let deletedCount = 0;
  
  for (const row of tables) {
    const tableName = row['tablename'] as string;
    const tableDate = extractTableDate(tableName);
    
    if (!tableDate) continue;
    if (tableDate >= cutoffDate) continue;
    
    const deleted = await tryDeleteTable(db, tableName);
    if (deleted) deletedCount++;
  }
  
  return deletedCount;
}

/**
 * Extract date from backup table name
 */
function extractTableDate(tableName: string): Date | null {
  const dateMatch = tableName.match(DATE_PATTERN);
  if (!dateMatch) return null;
  
  const dateStr = dateMatch[1].replace(/_/g, ':').substring(0, 19);
  const tableDate = new Date(dateStr.replace(/_/g, '-'));
  
  return isNaN(tableDate.getTime()) ? null : tableDate;
}

/**
 * Try to delete a single table, handling errors gracefully
 */
async function tryDeleteTable(db: Kysely<Record<string, unknown>>, tableName: string): Promise<boolean> {
  try {
    await sql.raw(`DROP TABLE ${tableName}`).execute(db);
    console.log(`   Deleted old backup: ${tableName}`);
    return true;
  } catch (error) {
    console.warn(`   Could not delete ${tableName}:`, error);
    return false;
  }
}

// Constants for date parsing
const DATE_STRING_LENGTH = 19;
const BACKUP_TABLE_PREFIX = 'OLD_';
const DATE_PATTERN = /(\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2})/;

/**
 * Extracts and parses creation date from backup table name
 */
function extractCreationDate(tableName: string): Date | undefined {
  const dateMatch = tableName.match(DATE_PATTERN);
  if (!dateMatch) return undefined;
  
  const dateStr = dateMatch[1].replace(/_/g, ':').substring(0, DATE_STRING_LENGTH);
  try {
    return new Date(dateStr.replace(/_/g, '-'));
  } catch {
    return undefined;
  }
}

/**
 * Transforms database row to backup table info
 */
function transformBackupRow(row: unknown): { name: string; created?: Date; size?: number } {
  const backupRow = row as Record<string, unknown>;
  const tableName = backupRow['tablename'] as string;
  
  return {
    name: tableName,
    created: extractCreationDate(tableName),
    size: backupRow['size'] ? parseInt(backupRow['size'] as string) : undefined
  };
}

/**
 * バックアップテーブル一覧を取得
 */
export async function listBackupTables(db: Kysely<Record<string, unknown>>): Promise<Array<{ name: string; created?: Date | undefined; size?: number | undefined }>> {
  try {
    const result = await sql.raw(`
      SELECT 
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename LIKE '${BACKUP_TABLE_PREFIX}%'
      ORDER BY tablename
    `).execute(db);
    
    return result.rows.map(transformBackupRow);
    
  } catch (error) {
    console.error('Failed to list backup tables:', error);
    throw error;
  }
}

/**
 * 安全なテーブル削除（外部キー制約を考慮）
 */
export async function safeDropTable(db: Kysely<Record<string, unknown>>, tableName: string): Promise<void> {
  try {
    const exists = await checkTableExists(db, tableName);
    if (!exists) {
      console.log(`Table ${tableName} does not exist, skipping drop`);
      return;
    }
    
    await sql.raw(`DROP TABLE ${tableName} CASCADE`).execute(db);
    console.log(`✅ Dropped table: ${tableName}`);
    
  } catch (error) {
    console.error(`Failed to drop table ${tableName}:`, error);
    throw error;
  }
}

/**
 * データ移行の統計情報を取得
 */
export async function getMigrationStats(
  db: Kysely<Record<string, unknown>>,
  sourceTable: string,
  targetTable: string
): Promise<{ sourceRows: number; targetRows: number; isConsistent: boolean }> {
  try {
    const [sourceResult, targetResult] = await Promise.all([
      sql.raw(`SELECT COUNT(*) as count FROM ${sourceTable}`).execute(db),
      sql.raw(`SELECT COUNT(*) as count FROM ${targetTable}`).execute(db)
    ]);
    
    const sourceRow = sourceResult.rows[0] as Record<string, unknown>;
    const targetRow = targetResult.rows[0] as Record<string, unknown>;
    const sourceRows = parseInt(sourceRow?.['count'] as string || '0');
    const targetRows = parseInt(targetRow?.['count'] as string || '0');
    
    return {
      sourceRows,
      targetRows,
      isConsistent: sourceRows === targetRows
    };
    
  } catch (error) {
    console.error(`Failed to get migration stats for ${sourceTable} -> ${targetTable}:`, error);
    throw error;
  }
}