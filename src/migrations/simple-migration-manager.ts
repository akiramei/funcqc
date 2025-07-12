import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * マイグレーション情報の型定義
 */
export interface MigrationInfo {
  name: string;
  version: number;
  executedAt?: Date;
  checksum?: string;
}

/**
 * マイグレーション結果の型定義
 */
export interface MigrationResult {
  success: boolean;
  migrationName: string;
  error?: string;
  executionTimeMs?: number;
}

/**
 * funcqc専用のシンプルなマイグレーション管理クラス
 * PoCとして、Kyselyを使わずPGLiteの生機能でマイグレーション管理を実装
 */
export class SimpleMigrationManager {
  constructor(private db: PGlite, _dbPath: string) {
    // dbPathは将来のマイグレーションファイル読み込み用にパラメータとして受け取る
    // 現在のPoCでは使用していない
  }

  /**
   * マイグレーション履歴テーブルを作成
   */
  private async ensureMigrationTable(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS funcqc_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        checksum TEXT,
        execution_time_ms INTEGER
      )
    `);
  }

  /**
   * 適用済みマイグレーション一覧を取得
   */
  async getAppliedMigrations(): Promise<MigrationInfo[]> {
    await this.ensureMigrationTable();
    
    const result = await this.db.query(`
      SELECT name, version, executed_at, checksum 
      FROM funcqc_migrations 
      ORDER BY version ASC
    `);
    
    return result.rows.map((row: unknown) => {
      const migrationRow = row as Record<string, unknown>;
      return {
        name: migrationRow['name'] as string,
        version: migrationRow['version'] as number,
        executedAt: new Date(migrationRow['executed_at'] as string),
        checksum: migrationRow['checksum'] as string
      };
    });
  }

  /**
   * database.sqlベースの初回マイグレーションを実行
   */
  async runInitialMigration(): Promise<MigrationResult> {
    const migrationName = '001_initial_schema';
    const startTime = Date.now();
    
    console.log('📋 Running initial schema migration...');
    
    try {
      // 既に適用済みかチェック
      const applied = await this.getAppliedMigrations();
      if (applied.some(m => m.name === migrationName)) {
        console.log('✅ Initial migration already applied');
        return {
          success: true,
          migrationName,
          executionTimeMs: 0
        };
      }
      
      // database.sqlを読み込んで実行
      const schemaPath = path.join(__dirname, '../schemas/database.sql');
      
      try {
        const schemaContent = await fs.readFile(schemaPath, 'utf-8');
        
        // トランザクション内で実行
        await this.db.exec('BEGIN');
        
        // スキーマを実行
        await this.db.exec(schemaContent);
        
        // マイグレーション履歴に記録
        const executionTime = Date.now() - startTime;
        await this.db.query(`
          INSERT INTO funcqc_migrations (name, version, execution_time_ms, checksum)
          VALUES ($1, $2, $3, $4)
        `, [migrationName, 1, executionTime, this.generateChecksum(schemaContent)]);
        
        await this.db.exec('COMMIT');
        
        console.log(`✅ Initial migration completed in ${executionTime}ms`);
        
        return {
          success: true,
          migrationName,
          executionTimeMs: executionTime
        };
        
      } catch (error) {
        await this.db.exec('ROLLBACK');
        throw error;
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Initial migration failed: ${errorMessage}`);
      
      return {
        success: false,
        migrationName,
        error: errorMessage,
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * カスタムマイグレーションを実行
   */
  async runCustomMigration(sqlStatements: string[], migrationName: string, version: number): Promise<MigrationResult> {
    const startTime = Date.now();
    
    console.log(`🔄 Running migration: ${migrationName}...`);
    
    try {
      // 既に適用済みかチェック
      const applied = await this.getAppliedMigrations();
      if (applied.some(m => m.name === migrationName)) {
        console.log(`✅ Migration ${migrationName} already applied`);
        return {
          success: true,
          migrationName,
          executionTimeMs: 0
        };
      }
      
      // トランザクション内で実行
      await this.db.exec('BEGIN');
      
      // 各SQL文を順次実行
      for (const sql of sqlStatements) {
        if (sql.trim()) {
          await this.db.exec(sql);
        }
      }
      
      // マイグレーション履歴に記録
      const executionTime = Date.now() - startTime;
      const checksum = this.generateChecksum(sqlStatements.join('\n'));
      
      await this.db.query(`
        INSERT INTO funcqc_migrations (name, version, execution_time_ms, checksum)
        VALUES ($1, $2, $3, $4)
      `, [migrationName, version, executionTime, checksum]);
      
      await this.db.exec('COMMIT');
      
      console.log(`✅ Migration ${migrationName} completed in ${executionTime}ms`);
      
      return {
        success: true,
        migrationName,
        executionTimeMs: executionTime
      };
      
    } catch (error) {
      await this.db.exec('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Migration ${migrationName} failed: ${errorMessage}`);
      
      return {
        success: false,
        migrationName,
        error: errorMessage,
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * データ保全付きのテーブル変更マイグレーション
   */
  async runTableMigration(
    tableName: string,
    preserveData: boolean,
    newTableSQL: string,
    dataMigrationSQL?: string
  ): Promise<MigrationResult> {
    const migrationName = `alter_${tableName}_${Date.now()}`;
    const startTime = Date.now();
    
    console.log(`🔄 Running table migration: ${tableName}...`);
    
    try {
      // マイグレーション履歴テーブルを確保
      await this.ensureMigrationTable();
      
      await this.db.exec('BEGIN');
      
      // テーブルが存在するかチェック
      const tableExistsResult = await this.db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [tableName]);
      
      const tableExistsRow = tableExistsResult.rows[0] as Record<string, unknown>;
      if (tableExistsRow?.['exists']) {
        if (preserveData) {
          // データ保全が必要な場合はバックアップを作成
          const backupTableName = `old_${tableName}_${new Date().toISOString().substring(0, 19).replace(/[:-]/g, '_')}`;
          await this.db.exec(`CREATE TABLE ${backupTableName} AS SELECT * FROM ${tableName}`);
          console.log(`📦 Data preserved in ${backupTableName}`);
        }
        
        // 既存テーブルを削除（データ保全の有無に関わらず）
        await this.db.exec(`DROP TABLE ${tableName} CASCADE`);
      }
      
      // 新しいテーブルを作成
      await this.db.exec(newTableSQL);
      console.log(`✅ New table structure created: ${tableName}`);
      
      // データ移行SQLがある場合は実行
      if (dataMigrationSQL) {
        await this.db.exec(dataMigrationSQL);
        console.log(`✅ Data migration completed`);
      }
      
      // マイグレーション履歴に記録
      const executionTime = Date.now() - startTime;
      await this.db.query(`
        INSERT INTO funcqc_migrations (name, version, execution_time_ms)
        VALUES ($1, $2, $3)
      `, [migrationName, Math.floor(Date.now() / 1000), executionTime]);
      
      await this.db.exec('COMMIT');
      
      console.log(`✅ Table migration ${tableName} completed in ${executionTime}ms`);
      
      return {
        success: true,
        migrationName,
        executionTimeMs: executionTime
      };
      
    } catch (error) {
      await this.db.exec('ROLLBACK');
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Table migration ${tableName} failed: ${errorMessage}`);
      
      return {
        success: false,
        migrationName,
        error: errorMessage,
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * マイグレーション状態をチェック
   */
  async getStatus(): Promise<{ applied: MigrationInfo[]; pending: string[] }> {
    const applied = await this.getAppliedMigrations();
    
    // 実際のマイグレーションファイルスキャンは今のところスキップ
    // PoCでは初回マイグレーションのみフォーカス
    const pending: string[] = [];
    
    if (!applied.some(m => m.name === '001_initial_schema')) {
      pending.push('001_initial_schema');
    }
    
    return { applied, pending };
  }

  /**
   * 開発用：マイグレーション履歴をリセット
   */
  async resetMigrations(): Promise<void> {
    console.log('⚠️  Resetting migration history...');
    await this.db.exec('DROP TABLE IF EXISTS funcqc_migrations CASCADE');
    console.log('✅ Migration history reset completed');
  }

  /**
   * バックアップテーブル一覧を取得
   */
  async listBackupTables(): Promise<string[]> {
    const result = await this.db.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' AND tablename LIKE 'old_%'
      ORDER BY tablename
    `);
    
    return result.rows.map((row: unknown) => {
      const tableRow = row as Record<string, unknown>;
      return tableRow['tablename'] as string;
    });
  }

  /**
   * 古いバックアップテーブルをクリーンアップ
   */
  async cleanupOldBackups(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const backupTables = await this.listBackupTables();
    let deletedCount = 0;
    
    for (const tableName of backupTables) {
      const dateMatch = tableName.match(/(\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2})/);
      if (dateMatch) {
        const dateStr = dateMatch[1].replace(/_/g, ':').substring(0, 19);
        try {
          const tableDate = new Date(dateStr.replace(/_/g, '-'));
          
          if (tableDate < cutoffDate) {
            await this.db.exec(`DROP TABLE ${tableName}`);
            console.log(`🗑️  Deleted old backup: ${tableName}`);
            deletedCount++;
          }
        } catch (error) {
          console.warn(`Could not process date for ${tableName}:`, error);
        }
      }
    }
    
    console.log(`✅ Cleaned up ${deletedCount} old backup tables`);
    return deletedCount;
  }

  /**
   * 簡単なチェックサム生成
   */
  private generateChecksum(content: string): string {
    // シンプルなハッシュ（本格実装では crypto.createHash を使用）
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit整数に変換
    }
    return hash.toString(16);
  }

  /**
   * PGLiteデータベースインスタンスを取得
   */
  getRawDatabase(): PGlite {
    return this.db;
  }
}