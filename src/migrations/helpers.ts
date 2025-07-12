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
  db: Kysely<any>, 
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
    const rowCount = parseInt((result.rows[0] as any)?.count || '0');
    
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
    const backupRowCount = parseInt((backupResult.rows[0] as any)?.count || '0');
    
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
  db: Kysely<any>,
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
    } catch (error) {
      console.error(`Failed to preserve table ${tableName}, continuing with others...`);
      // 他のテーブルのバックアップは継続
    }
  }
  
  return backupMap;
}

/**
 * テーブルの存在確認
 */
export async function checkTableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
  try {
    const result = await sql.raw(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '${tableName}'
      )
    `).execute(db);
    
    return (result.rows[0] as any)?.exists === true;
  } catch (error) {
    console.warn(`Could not check existence of table ${tableName}:`, error);
    return false;
  }
}

/**
 * カラムの存在確認
 */
export async function checkColumnExists(
  db: Kysely<any>, 
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
    
    return (result.rows[0] as any)?.exists === true;
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
export async function cleanupOldBackups(db: Kysely<any>, daysOld: number = 30): Promise<void> {
  console.log(`🧹 Cleaning up backup tables older than ${daysOld} days...`);
  
  try {
    // OLD_で始まるテーブル一覧を取得
    const result = await sql.raw(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename LIKE 'OLD_%'
    `).execute(db);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let deletedCount = 0;
    
    for (const row of result.rows) {
      const tableName = (row as any).tablename;
      
      // テーブル名から日時を抽出（例: OLD_functions_2025_01_12T14_30_00）
      const dateMatch = tableName.match(/(\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2})/);
      if (dateMatch) {
        const dateStr = dateMatch[1].replace(/_/g, ':').substring(0, 19);
        const tableDate = new Date(dateStr.replace(/_/g, '-'));
        
        if (tableDate < cutoffDate) {
          try {
            await sql.raw(`DROP TABLE ${tableName}`).execute(db);
            console.log(`   Deleted old backup: ${tableName}`);
            deletedCount++;
          } catch (error) {
            console.warn(`   Could not delete ${tableName}:`, error);
          }
        }
      }
    }
    
    console.log(`✅ Cleaned up ${deletedCount} old backup tables`);
    
  } catch (error) {
    console.error('Failed to cleanup old backups:', error);
    throw error;
  }
}

/**
 * バックアップテーブル一覧を取得
 */
export async function listBackupTables(db: Kysely<any>): Promise<Array<{ name: string; created?: Date | undefined; size?: number | undefined }>> {
  try {
    const result = await sql.raw(`
      SELECT 
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename LIKE 'OLD_%'
      ORDER BY tablename
    `).execute(db);
    
    return result.rows.map((row: any) => {
      // テーブル名から作成日時を推測
      const dateMatch = row.tablename.match(/(\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2})/);
      let created: Date | undefined;
      
      if (dateMatch) {
        const dateStr = dateMatch[1].replace(/_/g, ':').substring(0, 19);
        try {
          created = new Date(dateStr.replace(/_/g, '-'));
        } catch {
          // 日時パースに失敗した場合はundefined
        }
      }
      
      return {
        name: row.tablename as string,
        created,
        size: row.size ? parseInt(row.size) : undefined
      };
    });
    
  } catch (error) {
    console.error('Failed to list backup tables:', error);
    throw error;
  }
}

/**
 * 安全なテーブル削除（外部キー制約を考慮）
 */
export async function safeDropTable(db: Kysely<any>, tableName: string): Promise<void> {
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
  db: Kysely<any>,
  sourceTable: string,
  targetTable: string
): Promise<{ sourceRows: number; targetRows: number; isConsistent: boolean }> {
  try {
    const [sourceResult, targetResult] = await Promise.all([
      sql.raw(`SELECT COUNT(*) as count FROM ${sourceTable}`).execute(db),
      sql.raw(`SELECT COUNT(*) as count FROM ${targetTable}`).execute(db)
    ]);
    
    const sourceRows = parseInt((sourceResult.rows[0] as any)?.count || '0');
    const targetRows = parseInt((targetResult.rows[0] as any)?.count || '0');
    
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