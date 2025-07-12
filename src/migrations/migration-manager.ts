import { Kysely, Migrator, FileMigrationProvider, MigrationResult, MigrationResultSet } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * PGLite専用のシンプルなSQL実行ラッパー
 * KyselyとPGLiteの直接統合は複雑なため、sql.rawでのDDL実行に特化
 */
class SimplePGLiteExecutor {
  constructor(private db: PGlite) {}

  async executeRawSQL(sqlStatement: string): Promise<void> {
    try {
      await this.db.exec(sqlStatement);
    } catch (error) {
      throw new Error(`SQL execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async queryRawSQL(sqlStatement: string, params: unknown[] = []): Promise<any> {
    try {
      return await this.db.query(sqlStatement, params);
    } catch (error) {
      throw new Error(`Query execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * funcqc専用のマイグレーション管理クラス
 * PGLiteとKyselyを統合し、データ保全機能を提供
 */
export class MigrationManager {
  private kysely: Kysely<any>;
  private migrator: Migrator;
  private migrationsPath: string;

  constructor(private db: PGlite, dbPath: string) {
    this.kysely = createPGLiteKysely(db);
    this.migrationsPath = path.join(path.dirname(dbPath), '../src/migrations');
    
    this.migrator = new Migrator({
      db: this.kysely,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: this.migrationsPath,
      }),
    });
  }

  /**
   * 保留中のマイグレーションを全て適用
   */
  async migrateToLatest(): Promise<MigrationResultSet> {
    console.log('🔄 Running database migrations...');
    
    try {
      const { error, results } = await this.migrator.migrateToLatest();
      
      if (results) {
        for (const result of results) {
          if (result.status === 'Success') {
            console.log(`✅ Migration "${result.migrationName}" executed successfully`);
          } else if (result.status === 'Error') {
            console.error(`❌ Failed to execute migration "${result.migrationName}"`);
            if (result.error) {
              console.error(`   Error: ${result.error.message}`);
            }
          }
        }
      }
      
      if (error) {
        console.error('🚨 Migration failed:', error.message);
        throw error;
      }
      
      console.log('✅ All migrations completed successfully');
      return { error, results };
      
    } catch (err) {
      console.error('🚨 Unexpected error during migration:', err);
      throw err;
    }
  }

  /**
   * 最後のマイグレーションをロールバック
   */
  async migrateDown(): Promise<MigrationResultSet> {
    console.log('⏪ Rolling back last migration...');
    
    try {
      const { error, results } = await this.migrator.migrateDown();
      
      if (results) {
        for (const result of results) {
          if (result.status === 'Success') {
            console.log(`✅ Rollback "${result.migrationName}" executed successfully`);
          } else if (result.status === 'Error') {
            console.error(`❌ Failed to rollback migration "${result.migrationName}"`);
            if (result.error) {
              console.error(`   Error: ${result.error.message}`);
            }
          }
        }
      }
      
      if (error) {
        console.error('🚨 Rollback failed:', error.message);
        throw error;
      }
      
      console.log('✅ Rollback completed successfully');
      return { error, results };
      
    } catch (err) {
      console.error('🚨 Unexpected error during rollback:', err);
      throw err;
    }
  }

  /**
   * マイグレーション状態を取得
   */
  async getMigrationStatus(): Promise<Array<{ name: string; executedAt?: Date }>> {
    try {
      const migrations = await this.migrator.getMigrations();
      return migrations.map(migration => ({
        name: migration.name,
        executedAt: migration.executedAt,
      }));
    } catch (error) {
      console.error('Failed to get migration status:', error);
      throw error;
    }
  }

  /**
   * 保留中のマイグレーション数を取得
   */
  async getPendingMigrations(): Promise<string[]> {
    try {
      const migrations = await this.migrator.getMigrations();
      return migrations
        .filter(migration => !migration.executedAt)
        .map(migration => migration.name);
    } catch (error) {
      console.error('Failed to get pending migrations:', error);
      throw error;
    }
  }

  /**
   * マイグレーション履歴をクリア（開発・テスト用）
   */
  async resetMigrations(): Promise<void> {
    console.log('⚠️  Resetting migration history...');
    
    try {
      // kysely_migration テーブルを削除
      await this.db.exec('DROP TABLE IF EXISTS kysely_migration CASCADE');
      console.log('✅ Migration history reset completed');
    } catch (error) {
      console.error('Failed to reset migrations:', error);
      throw error;
    }
  }

  /**
   * リソースクリーンアップ
   */
  async destroy(): Promise<void> {
    try {
      await this.kysely.destroy();
    } catch (error) {
      console.error('Error during migration manager cleanup:', error);
    }
  }

  /**
   * PGLiteの生のデータベース接続を取得（デバッグ用）
   */
  getRawDatabase(): PGlite {
    return this.db;
  }

  /**
   * Kyselyインスタンスを取得（高度な操作用）
   */
  getKysely(): Kysely<any> {
    return this.kysely;
  }
}

/**
 * マイグレーション結果のユーティリティ関数
 */
export function summarizeMigrationResults(results: MigrationResult[] | undefined): string {
  if (!results || results.length === 0) {
    return 'No migrations executed';
  }

  const successful = results.filter(r => r.status === 'Success').length;
  const failed = results.filter(r => r.status === 'Error').length;
  
  if (failed > 0) {
    return `${failed} migration(s) failed, ${successful} succeeded`;
  }
  
  return `${successful} migration(s) executed successfully`;
}